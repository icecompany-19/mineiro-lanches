#!/usr/bin/env bash
# Sobe o "Supabase local" de teste: Postgres 16 (porta 54322) + stub + PostgREST (3000) + proxy (54321).
# Uso: bash scripts/supabase-local/iniciar.sh [--reset]   (--reset recria o banco do zero)
# Depois: aplicar o SQL com  psql postgresql://postgres@localhost:54322/postgres -f supabase/setup.sql
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
PGDATA=/home/user/.pg/data
PGBIN=/usr/lib/postgresql/16/bin
PGURL=postgresql://postgres@localhost:54322/postgres
if [[ "${1:-}" == "--reset" ]]; then
  pkill -x postgrest 2>/dev/null || true
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA stop -m fast" 2>/dev/null || true
  rm -rf /home/user/.pg
fi
if [[ ! -d $PGDATA ]]; then
  mkdir -p /home/user/.pg && chown postgres:postgres /home/user/.pg
  su postgres -c "$PGBIN/initdb -D $PGDATA -A trust -U postgres --locale=C.UTF-8 -E UTF8" >/dev/null
  echo "port = 54322" >> $PGDATA/postgresql.conf
  echo "listen_addresses = 'localhost'" >> $PGDATA/postgresql.conf
  echo "timezone = 'UTC'" >> $PGDATA/postgresql.conf
fi
su postgres -c "$PGBIN/pg_ctl -D $PGDATA status" >/dev/null 2>&1 || su postgres -c "$PGBIN/pg_ctl -D $PGDATA -l /home/user/.pg/log.txt start -w" >/dev/null
psql "$PGURL" -q -v ON_ERROR_STOP=1 -f "$AQUI/stub.sql"
cat > /home/user/.pg/postgrest.conf <<CONF
db-uri = "postgres://authenticator:local@localhost:54322/postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "segredo-local-de-teste-com-mais-de-32-caracteres"
server-port = 3000
db-channel-enabled = true
CONF
curl -s -o /dev/null http://localhost:3000/ || (nohup /home/user/.tools/postgrest /home/user/.pg/postgrest.conf > /home/user/.pg/postgrest.log 2>&1 &)
curl -s -o /dev/null http://localhost:54321/ || (nohup node "$AQUI/proxy.mjs" > /home/user/.pg/proxy.log 2>&1 &)
sleep 1
echo "Postgres: $PGURL"
echo "API (supabase-js): http://localhost:54321  (chave: qualquer texto não-JWT => anon)"
echo "Login equipe: equipe@teste.local / qualquer senha"
echo "Após mudar o schema: psql $PGURL -c \"notify pgrst, 'reload schema'\""
