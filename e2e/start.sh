#!/usr/bin/env bash
# Sobe API + frontend (assets) em workerd local com D1 limpo para os testes E2E.
set -euo pipefail
cd "$(dirname "$0")/../apps/api"
[ -f .dev.vars ] || printf 'SESSION_PEPPER=%s\nENVIRONMENT=development\n' "$(head -c 48 /dev/urandom | base64 | tr -d '\n=+/' | head -c 48)" > .dev.vars
rm -rf .e2e-state
npx wrangler d1 migrations apply contentflow --local --persist-to .e2e-state >/dev/null
# Em E2E todas as requisições vêm do mesmo IP local: afrouxa só o rate limit (nunca em produção).
npx wrangler d1 execute contentflow --local --persist-to .e2e-state \
  --command "update system_settings set value='1000' where key like 'rate_limit.%.max'" >/dev/null
exec npx wrangler dev --port 8787 --persist-to .e2e-state
