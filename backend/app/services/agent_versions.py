"""Desktop agent version comparison for trust and update-required decisions.

A single place to decide whether a reported ``agent_version`` is recent enough
to be trusted. Used by the workday timeline (to reject counter jumps from
releases known to over-count sleep/hibernate freezes) and by the heartbeat
handler (to signal an update-required state). The floor is configurable via
``settings.required_agent_version`` so operators can raise it without a code
change.
"""

from __future__ import annotations

# The first release whose client counters are trusted across long gaps. Version
# 1.1.96 added trackingTick(), which discards tick gaps > 60s, so its cumulative
# active/idle counters no longer absorb a sleep/hibernate freeze as active work.
# Releases at or below 1.1.95 did (see commit 09a209b). Keep in sync with
# ``settings.required_agent_version``; this constant is only the fallback used
# when no configured minimum is supplied.
DEFAULT_REQUIRED_AGENT_VERSION = "1.1.96"


def parse_agent_version(value: str | None) -> tuple[int, ...] | None:
    """Parse a dotted version like ``"1.1.96"`` into a comparable tuple.

    Returns ``None`` for a missing or unparseable value so callers can treat an
    unknown version as untrusted. Tolerates a trailing pre-release suffix
    (``"1.2.0-beta"`` -> ``(1, 2, 0)``) by taking the leading digits of each
    dotted part and stopping at the first non-numeric part.
    """
    if not isinstance(value, str):
        return None
    parts = value.strip().split(".")
    numbers: list[int] = []
    for part in parts:
        digits = ""
        for character in part:
            if character.isdigit():
                digits += character
            else:
                break
        if not digits:
            break
        numbers.append(int(digits))
    return tuple(numbers) if numbers else None


def agent_version_counters_trusted(
    value: str | None,
    minimum: str | None = DEFAULT_REQUIRED_AGENT_VERSION,
) -> bool:
    """Whether a client's cumulative counters may be trusted across a long gap.

    Only a *known* release below ``minimum`` is distrusted (the specific
    <= 1.1.95 range that over-counted sleep/hibernate freezes). An unknown or
    unparseable version is given the benefit of the doubt, because real clients
    always report a version and the safeguard must not silently reclassify work
    from clients it cannot identify. Distinct from ``is_agent_version_supported``,
    which is strict (unknown -> unsupported) for the update-required signal.
    """
    parsed = parse_agent_version(value)
    if parsed is None:
        return True
    floor = parse_agent_version(minimum)
    if floor is None:
        return True
    return parsed >= floor


def is_agent_version_supported(
    value: str | None,
    minimum: str | None = DEFAULT_REQUIRED_AGENT_VERSION,
) -> bool:
    """True when ``value`` is a known version at or above ``minimum``.

    An unknown/unparseable ``value`` is treated as unsupported (untrusted) — the
    conservative choice for a safeguard. An unparseable ``minimum`` disables the
    check (everything is considered supported).
    """
    parsed = parse_agent_version(value)
    if parsed is None:
        return False
    floor = parse_agent_version(minimum)
    if floor is None:
        return True
    return parsed >= floor
