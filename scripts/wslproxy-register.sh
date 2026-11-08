#!/usr/bin/env bash
# Register (idempotently) the VYLTZERO vhosts + routing rule on the WSLProxy
# edge control plane, from the committed records in deploy/wslproxy/data/.
#
#   ./scripts/wslproxy-register.sh            # import + activate (go live)
#   ./scripts/wslproxy-register.sh --dry-run  # show what would be imported
#   ./scripts/wslproxy-register.sh --stage    # import with config_status=false
#
# The control plane is only reachable from the LAN, so run this from a LAN
# machine (not a GitHub-hosted runner). Records are keyed by their committed
# ids, so re-running is a no-op.
#
# Env:
#   WSLPROXY_GATEWAY_DOMAIN  default https://lon1.pop0.uk
#   WSLPROXY_TOKEN           bearer token; else log in with:
#   WSLPROXY_ADMIN_EMAIL     default debian@wslproxy.org
#   WSLPROXY_ADMIN_PASSWORD  prompted for if unset
#   PROFILE                  WSLProxy profile dir, default prod
set -euo pipefail
cd "$(dirname "$0")/.."

GATEWAY="${WSLPROXY_GATEWAY_DOMAIN:-https://lon1.pop0.uk}"
PROFILE="${PROFILE:-prod}"
ACTIVATE=true
DRY_RUN=false
case "${1:-}" in
  --dry-run) DRY_RUN=true ;;
  --stage) ACTIVATE=false ;;
  "") ;;
  *) echo "usage: $0 [--dry-run|--stage]" >&2; exit 2 ;;
esac

RULES_DIR="deploy/wslproxy/data/rules/${PROFILE}"
SERVERS_DIR="deploy/wslproxy/data/servers/${PROFILE}"

# Every server must reference a committed rule.
for f in "$SERVERS_DIR"/*.json; do
  rid="$(jq -r '.rules // empty' "$f")"
  [ -z "$rid" ] || [ -f "$RULES_DIR/$rid.json" ] \
    || { echo "error: $(basename "$f") references missing rule '$rid'" >&2; exit 1; }
done

RULES_ARR="$(jq -s '.' "$RULES_DIR"/*.json)"
SERVERS_ARR="$(jq -s --argjson active "$ACTIVATE" 'map(.config_status = $active)' "$SERVERS_DIR"/*.json)"

if $DRY_RUN; then
  echo "rules:";   echo "$RULES_ARR"   | jq -c '.[] | {id, backends: [.match.response.backends[].address], servers}'
  echo "servers:"; echo "$SERVERS_ARR" | jq -c '.[] | {id, rules, config_status}'
  exit 0
fi

TOKEN="${WSLPROXY_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  email="${WSLPROXY_ADMIN_EMAIL:-debian@wslproxy.org}"
  pw="${WSLPROXY_ADMIN_PASSWORD:-}"
  if [ -z "$pw" ]; then read -rsp "WSLProxy password for ${email}: " pw; echo; fi
  TOKEN="$(curl -sS --max-time 30 --connect-timeout 10 -X POST "${GATEWAY%/}/api/user/login" \
    -H 'Content-Type: application/json' \
    -d "$(jq -cn --arg e "$email" --arg p "$pw" '{email: $e, password: $p}')" | jq -r '.data.accessToken // empty')"
  [ -n "$TOKEN" ] || { echo "error: WSLProxy login failed" >&2; exit 1; }
fi

import() {
  local dtype="$1" arr="$2" resp code
  resp="$(curl -sS --max-time 60 --connect-timeout 10 -w '\n%{http_code}' \
    -X POST "${GATEWAY%/}/api/projects/import?_format=json" \
    -H "Authorization: Bearer $TOKEN" -H 'x-platform: react-admin' -H 'Content-Type: application/json' \
    --data-raw "$(jq -cn --argjson data "$arr" --arg dt "$dtype" '{data: $data, dataType: $dt}')")"
  code="$(echo "$resp" | tail -n1)"
  echo "  ${dtype}: HTTP ${code}"
  [ "$code" = 200 ] || [ "$code" = 201 ] || { echo "$resp" | sed '$d' >&2; return 1; }
}

# Rules first so the servers' rule references resolve. dataType MUST be the
# plural "servers" — that is the directory the gateway serves vhosts from.
import rules "$RULES_ARR"
import servers "$SERVERS_ARR"
echo "WSLProxy ${PROFILE}: $(echo "$RULES_ARR" | jq length) rule(s), $(echo "$SERVERS_ARR" | jq length) vhost(s), active=${ACTIVATE}"
