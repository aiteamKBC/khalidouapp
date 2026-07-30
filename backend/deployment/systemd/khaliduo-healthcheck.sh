#!/usr/bin/env bash
set -uo pipefail

check_and_recover() {
  local service_name="$1"
  local health_url="$2"

  if curl \
    --silent \
    --show-error \
    --fail \
    --max-time 10 \
    --retry 2 \
    --retry-connrefused \
    --retry-delay 2 \
    "$health_url" >/dev/null; then
    return 0
  fi

  logger -t khaliduo-healthcheck "$service_name failed $health_url; restarting"
  systemctl restart "$service_name"
  sleep 5

  if ! curl \
    --silent \
    --show-error \
    --fail \
    --max-time 10 \
    --retry 2 \
    --retry-connrefused \
    --retry-delay 2 \
    "$health_url" >/dev/null; then
    logger -p user.err -t khaliduo-healthcheck \
      "$service_name is still unhealthy after restart"
    return 1
  fi

  logger -t khaliduo-healthcheck "$service_name recovered after restart"
}

result=0
check_and_recover \
  "khaliduo-api.service" \
  "http://127.0.0.1:8000/api/v1/health/db" || result=1
check_and_recover \
  "khaliduo-dashboard.service" \
  "http://127.0.0.1:3100/" || result=1
exit "$result"
