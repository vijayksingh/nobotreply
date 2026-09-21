#!/usr/bin/env bash
set -euo pipefail

# Point nobotreply.com at the Cloudflare Pages project.
#
#   sudo scripts/reconcile-dns.sh
#
# Uses the infra Cloudflare token by default. If that token's DNS permission does
# not include the nobotreply.com zone, pass a token that does instead — no need to
# change the shared secret store:
#
#   sudo CF_DNS_API_TOKEN='<token with DNS:Edit on nobotreply.com>' scripts/reconcile-dns.sh
ZONE_NAME="nobotreply.com"
PAGES_HOST="nobotreply.pages.dev"
CLOUDFLARE_SECRETS="${CLOUDFLARE_SECRETS:-/opt/infra/secrets/cloudflare.env}"

if [ -n "${CF_DNS_API_TOKEN:-}" ]; then
  echo "[dns] using CF_DNS_API_TOKEN from the environment"
else
  [ -r "$CLOUDFLARE_SECRETS" ] || { echo "[dns] cannot read Cloudflare credentials; run with sudo, or set CF_DNS_API_TOKEN" >&2; exit 1; }
  set -a
  # shellcheck disable=SC1090
  . "$CLOUDFLARE_SECRETS"
  set +a
fi

api_ip="$(curl --noproxy '*' -fsS \
  --resolve cloudflare-dns.com:443:1.1.1.1 \
  -H 'accept: application/dns-json' \
  'https://cloudflare-dns.com/dns-query?name=api.cloudflare.com&type=A' \
  | jq -er '.Answer[] | select(.type == 1) | .data' | head -n 1)"

cf_curl() {
  curl --noproxy '*' -fsS --retry 3 --retry-delay 2 \
    --resolve "api.cloudflare.com:443:$api_ip" \
    -H "Authorization: Bearer $CF_DNS_API_TOKEN" \
    "$@"
}

zone_id="$(cf_curl "https://api.cloudflare.com/client/v4/zones?name=$ZONE_NAME" | jq -er '.result[0].id')"
echo "[dns] zone $ZONE_NAME = $zone_id"

record_id="$(cf_curl "https://api.cloudflare.com/client/v4/zones/$zone_id/dns_records?name=$ZONE_NAME" \
  | jq -r '.result[] | select(.type == "CNAME" or .type == "A") | .id' | head -n 1 || true)"

# Proxied CNAME: Cloudflare flattens it at the apex, so this works on a bare domain.
upsert_record() {
  local name="$1" id body
  id="$(cf_curl "https://api.cloudflare.com/client/v4/zones/$zone_id/dns_records?name=$name" \
    | jq -r '.result[] | select(.type == "CNAME") | .id' | head -n 1 || true)"
  body="$(jq -nc --arg name "$name" --arg content "$PAGES_HOST" \
    '{type:"CNAME",name:$name,content:$content,ttl:1,proxied:true}')"
  if [ -n "$id" ]; then
    cf_curl -X PUT -H 'content-type: application/json' --data "$body" \
      "https://api.cloudflare.com/client/v4/zones/$zone_id/dns_records/$id" >/dev/null
    echo "[dns] updated $name -> $PAGES_HOST (proxied)"
  else
    cf_curl -X POST -H 'content-type: application/json' --data "$body" \
      "https://api.cloudflare.com/client/v4/zones/$zone_id/dns_records" >/dev/null
    echo "[dns] created $name -> $PAGES_HOST (proxied)"
  fi
}

if [ -n "$record_id" ]; then
  cf_curl -X DELETE "https://api.cloudflare.com/client/v4/zones/$zone_id/dns_records/$record_id" >/dev/null
  echo "[dns] removed pre-existing A/CNAME at the apex"
fi

upsert_record "$ZONE_NAME"
upsert_record "www.$ZONE_NAME"

echo "[dns] verifying"
for _ in $(seq 1 15); do
  if [ -n "$(dig +short "$ZONE_NAME" @1.1.1.1)" ]; then
    echo "[dns] $ZONE_NAME resolves"
    exit 0
  fi
  sleep 4
done
echo "[dns] record written but not resolving yet; check the Cloudflare dashboard" >&2
