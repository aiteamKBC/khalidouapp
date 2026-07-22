from collections import defaultdict, deque
from ipaddress import ip_address
from threading import Lock
from time import monotonic

from fastapi import Request

from app.core.config import settings
from app.core.exceptions import ApiError


class InMemoryRateLimiter:
    """Small per-process limiter for sensitive unauthenticated endpoints.

    The production reverse proxy should still enforce its own distributed
    limits. This layer protects the current single-process deployment and local
    installations even when proxy rules are missing.
    """

    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()
        self._last_cleanup = 0.0

    def check(self, key: str, *, limit: int, window_seconds: int) -> None:
        now = monotonic()
        cutoff = now - window_seconds
        with self._lock:
            if now - self._last_cleanup >= 300:
                stale_keys = [
                    item_key
                    for item_key, item_events in self._events.items()
                    if not item_events or now - item_events[-1] > 3600
                ]
                for item_key in stale_keys:
                    self._events.pop(item_key, None)
                self._last_cleanup = now
            events = self._events[key]
            while events and events[0] <= cutoff:
                events.popleft()
            if len(events) >= limit:
                retry_after = max(1, int(window_seconds - (now - events[0])))
                raise ApiError(
                    "RATE_LIMITED",
                    "Too many attempts. Please wait and try again.",
                    429,
                    {"retry_after_seconds": retry_after},
                )
            events.append(now)


limiter = InMemoryRateLimiter()


def request_client_ip(request: Request) -> str:
    peer = request.client.host if request.client else "unknown"
    if peer not in settings.trusted_proxy_ips:
        return peer
    forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    if not forwarded:
        return peer
    try:
        return str(ip_address(forwarded))
    except ValueError:
        return peer


def enforce_rate_limit(
    request: Request,
    *,
    action: str,
    limit: int,
    window_seconds: int,
) -> None:
    if settings.app_env.lower() == "testing":
        return
    client = request_client_ip(request)
    limiter.check(f"{action}:{client}", limit=limit, window_seconds=window_seconds)
