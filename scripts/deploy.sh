#!/usr/bin/env bash
# Deploy do ContentFlow na Cloudflare (plano Free, sem cartão). Rode do seu computador, depois de `npx wrangler login`.
#
#   scripts/deploy.sh --check            só verifica pré-requisitos, não altera nada
#   scripts/deploy.sh --create-db        cria o D1 (se ainda não existe) e grava o database_id no wrangler.toml
#   scripts/deploy.sh                    migra o banco remoto, publica e roda o teste de fumaça
#   opções: --yes (não pergunta) · --skip-checks (pula typecheck/testes)
#
# Entrada: TURNSTILE_SITE_KEY (público) no ambiente. Os segredos SESSION_PEPPER e TURNSTILE_SECRET ficam no
# Cloudflare (`wrangler secret`); o script pede o TURNSTILE_SECRET sem ecoar e gera o SESSION_PEPPER sozinho.
# Recusa continuar se faltar algo ou se o wrangler.toml tiver recurso que não é do plano gratuito (R1/R2).
set -euo pipefail
cd "$(dirname "$0")/.."
API=apps/api
TOML=$API/wrangler.toml
CHECK=0; CREATE_DB=0; YES=0; SKIP=0
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;; --create-db) CREATE_DB=1 ;; --yes) YES=1 ;; --skip-checks) SKIP=1 ;;
    *) echo "opção desconhecida: $a" >&2; exit 2 ;;
  esac
done
fail() { echo "✗ $*" >&2; exit 1; }
ok() { echo "✓ $*"; }
wr() { (cd "$API" && npx --no-install wrangler "$@"); }

# 1. R1/R2: nada que cobre ou exija cartão
if grep -n -E '^\s*\[\[?(r2_buckets|queues|ai|vectorize|hyperdrive|browser|durable_objects|analytics_engine_datasets|kv_namespaces|services)' "$TOML" >/dev/null; then
  fail "wrangler.toml tem recurso fora do plano gratuito/escopo (R1/R2). Remova antes de publicar."
fi
ok "wrangler.toml só usa assets, D1 e Cron"

# 2. ferramentas e login
command -v pnpm >/dev/null || fail "pnpm não encontrado"
[ -d node_modules ] || pnpm install --frozen-lockfile
wr --version >/dev/null 2>&1 || fail "wrangler não instalado (rode pnpm install)"
wr whoami 2>&1 | grep -q -i "not authenticated\|You are not" && fail "faça login antes: npx wrangler login"
ok "wrangler autenticado"

# 3. D1
if grep -q "SET_AFTER_WRANGLER_D1_CREATE" "$TOML"; then
  if [ "$CREATE_DB" = 1 ] && [ "$CHECK" = 0 ]; then
    out=$(wr d1 create contentflow 2>&1) || { echo "$out"; fail "não foi possível criar o D1 (já existe? use 'wrangler d1 list' e cole o id no wrangler.toml)"; }
    id=$(printf '%s\n' "$out" | grep -o -E '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
    [ -n "$id" ] || { echo "$out"; fail "não achei o database_id na saída"; }
    sed -i.bak "s/SET_AFTER_WRANGLER_D1_CREATE/$id/" "$TOML" && rm -f "$TOML.bak"
    ok "D1 criado; database_id gravado em $TOML (faça commit dessa alteração)"
  else
    fail "database_id ainda é o marcador. Rode: scripts/deploy.sh --create-db"
  fi
else
  ok "database_id configurado"
fi

# 3b. Turnstile (site key é público; precisa ir como variável)
: "${TURNSTILE_SITE_KEY:=}"
[ -n "$TURNSTILE_SITE_KEY" ] || fail "defina TURNSTILE_SITE_KEY (painel Cloudflare > Turnstile, gratuito). Ex.: TURNSTILE_SITE_KEY=0x4AAA... scripts/deploy.sh"

# 4. segredos
secrets=$(wr secret list 2>/dev/null || true)
has() { printf '%s' "$secrets" | grep -q "\"$1\""; }
missing=()
has SESSION_PEPPER || missing+=(SESSION_PEPPER)
has TURNSTILE_SECRET || missing+=(TURNSTILE_SECRET)
if [ "$CHECK" = 1 ]; then
  [ ${#missing[@]} -eq 0 ] && ok "segredos presentes" || echo "• faltam segredos: ${missing[*]} (o deploy completo os cria)"
  echo "Verificação concluída (nada foi alterado)."; exit 0
fi

# 5. confirmação humana (R6: publicar é uma ação externa)
if [ "$YES" = 0 ]; then
  read -r -p "Publicar em produção na sua conta Cloudflare (plano Free)? [s/N] " r
  [ "$r" = s ] || [ "$r" = S ] || fail "cancelado"
fi

for s in "${missing[@]}"; do
  case "$s" in
    SESSION_PEPPER) head -c 48 /dev/urandom | base64 | tr -d '\n=+/' | head -c 48 | wr secret put SESSION_PEPPER >/dev/null; ok "SESSION_PEPPER gerado e gravado" ;;
    TURNSTILE_SECRET) read -r -s -p "Cole o TURNSTILE_SECRET (não aparece na tela): " v; echo; [ -n "$v" ] || fail "vazio"; printf '%s' "$v" | wr secret put TURNSTILE_SECRET >/dev/null; ok "TURNSTILE_SECRET gravado" ;;
  esac
done

# 6. verificações locais, build, migração, publicação
if [ "$SKIP" = 0 ]; then pnpm -s typecheck && pnpm -s lint && pnpm -s test; ok "typecheck, lint e testes"; fi
pnpm -s --filter web build; ok "frontend compilado"
wr d1 migrations apply contentflow --remote; ok "migrações aplicadas"
out=$(wr deploy --var "TURNSTILE_SITE_KEY:$TURNSTILE_SITE_KEY" 2>&1) || { echo "$out"; fail "deploy falhou"; }
echo "$out" | tail -5
url=$(printf '%s\n' "$out" | grep -o -E 'https://[A-Za-z0-9._-]+\.workers\.dev' | head -1)
ok "publicado${url:+ em $url}"

# 7. teste de fumaça (só leitura)
if [ -n "$url" ]; then
  sleep 3
  curl -fsS "$url/api/health" >/dev/null && ok "/api/health responde" || fail "/api/health não respondeu"
  cfg=$(curl -fsS "$url/api/config") || fail "/api/config não respondeu"
  printf '%s' "$cfg" | grep -q '"enforced"' && ok "Turnstile ativo (modo enforced)" || echo "! Turnstile não está em modo enforced: confira o secret e a site key"
  code=$(curl -s -o /dev/null -w '%{http_code}' "$url/billing"); [ "$code" = 404 ] && ok "/billing é 404 (R7)" || echo "! /billing devolveu $code"
fi
cat <<MSG

Próximos passos (manuais):
 1. No Turnstile, inclua o domínio publicado na lista de hostnames.
 2. Cadastre-se no site e torne-se admin global (docs/admin.md).
 3. Confira os cabeçalhos: curl -sI $url/ (CSP, X-Content-Type-Options).
 4. Assine docs/free-tier-limits.md e docs/video-viability.md.
MSG
