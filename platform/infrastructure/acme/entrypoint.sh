#!/usr/bin/env sh
set -eu

case "${CF_Token:-}" in
  ""|"__CONFIGURE_CLOUDFLARE_TOKEN__")
    echo "CLOUDFLARE_API_TOKEN/CF_Token obrigatório para ACME DNS-01" >&2
    exit 64
    ;;
esac
DOMAIN="${ACME_DOMAIN:?ACME_DOMAIN obrigatório}"
EMAIL="${ACME_EMAIL:?ACME_EMAIL obrigatório}"
STAGING="${ACME_STAGING:-false}"
DNS_SLEEP="${ACME_DNS_SLEEP:-20}"
CHECK_INTERVAL="${ACME_CHECK_INTERVAL_SECONDS:-43200}"
SERVER="letsencrypt"

# acme.sh usa LOG_LEVEL como valor numérico. O .env da plataforma usa
# LOG_LEVEL=INFO para a aplicação Python; não deixe esse valor textual vazar
# para o acme.sh, pois ele provoca mensagens como "sh: INFO: out of range".
ACME_LOG_LEVEL="${ACME_LOG_LEVEL:-1}"
case "$ACME_LOG_LEVEL" in
  ''|*[!0-9]*) ACME_LOG_LEVEL=1 ;;
esac
export LOG_LEVEL="$ACME_LOG_LEVEL"

if [ "$STAGING" = "true" ] || [ "$STAGING" = "1" ]; then
  SERVER="letsencrypt_test"
fi

mkdir -p /certs /acme.sh
find /acme.sh -type f -name '*.conf' -exec sed -i '/^CF_Zone_ID=/d' {} \; 2>/dev/null || true
unset CF_Zone_ID || true
acme.sh --set-default-ca --server "$SERVER"
acme.sh --register-account -m "$EMAIL" --server "$SERVER" || true

issue_certificate() {
  acme.sh --issue --dns dns_cf -d "$DOMAIN" -d "*.$DOMAIN" \
    --keylength ec-256 --server "$SERVER" --dnssleep "$DNS_SLEEP"
}

install_bundle() {
  acme.sh --install-cert -d "$DOMAIN" --ecc \
    --fullchain-file /certs/fullchain.pem \
    --key-file /certs/privkey.pem \
    --ca-file /certs/ca.pem \
    --cert-file /certs/cert.pem \
    --reloadcmd "date -Iseconds > /certs/last-installed-at.txt"
  chmod 0600 /certs/privkey.pem
  chmod 0644 /certs/fullchain.pem /certs/cert.pem /certs/ca.pem
  date -Iseconds > /certs/last-acme-run-at.txt
}

if ! issue_certificate; then
  acme.sh --renew -d "$DOMAIN" --ecc --server "$SERVER" || true
fi
install_bundle

cat > /certs/README.txt <<DOC
Connect|API Platform - certificado ACME
Domínio: $DOMAIN
Wildcard: *.$DOMAIN
Desafio: DNS-01 Cloudflare
DOC
chmod 0644 /certs/README.txt

while :; do
  sleep "$CHECK_INTERVAL"
  acme.sh --cron --home /acme.sh || true
  install_bundle || true
done
