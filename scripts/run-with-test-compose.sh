#!/usr/bin/env bash
# Bring up docker-compose.test.yml, run jest with the given config + args, then tear down.
# Usage: bash scripts/run-with-test-compose.sh <jest-config.js> [jest options...]
# Example: npm run test:e2e:only -- -t "Product Service E2E"

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

COMPOSE_FILE="docker-compose.test.yml"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <jest.config.js> [jest options...]" >&2
  exit 2
fi

JEST_CONFIG="$1"
shift

down() {
  docker compose -f "$COMPOSE_FILE" down -v
}

set +e
docker compose -f "$COMPOSE_FILE" up -d --wait
up_ec=$?
set -e

if [[ "$up_ec" -ne 0 ]]; then
  echo "" >&2
  echo "run-with-test-compose: docker compose up --wait failed (exit $up_ec)." >&2
  echo "LocalStack did not become healthy; Jest was not started." >&2
  echo "Check: docker compose -f $COMPOSE_FILE logs" >&2
  down || true
  exit "$up_ec"
fi

jest --config "$JEST_CONFIG" "$@"
ec=$?

down || true
exit "$ec"
