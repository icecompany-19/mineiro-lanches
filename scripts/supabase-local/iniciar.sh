#!/usr/bin/env bash
# Sobe o "Supabase local" de teste: Postgres 16/17 (porta 54322) + stub + PostgREST (54323) + proxy (54321).
# Uso: bash scripts/supabase-local/iniciar.sh [--reset]   (--reset recria o banco do zero)
# Depois: aplicar o SQL com  psql postgresql://postgres@localhost:54322/postgres -f supabase/setup.sql
# Funciona no sandbox Linux (caminhos de /home/user) e no Windows pelo Git Bash (ferramentas em
# %LOCALAPPDATA%/mineiro-ferramentas: pgsql/bin e postgrest/postgrest.exe; banco em %LOCALAPPDATA%/mineiro-pg).
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
PGURL=postgresql://postgres@localhost:54322/postgres
PORTA_POSTGREST=54323
WIN=
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*)
    WIN=1
    FERR="$(cygpath -u "${MINEIRO_FERRAMENTAS:-$LOCALAPPDATA/mineiro-ferramentas}")"
    PGBIN="$FERR/pgsql/bin"
    PGHOME="$(cygpath -u "${MINEIRO_PGHOME:-$LOCALAPPDATA/mineiro-pg}")"
    POSTGREST="$FERR/postgrest/postgrest.exe"
    export PATH="$PGBIN:$PATH" # postgrest.exe precisa da libpq.dll que está em pgsql/bin
    export PGCLIENTENCODING=UTF8
    ;;
  *)
    PGBIN=/usr/lib/postgresql/16/bin
    PGHOME=/home/user/.pg
    POSTGREST=/home/user/.tools/postgrest
    ;;
esac
PGDATA="$PGHOME/data"

# No Windows o Postgres roda como o próprio usuário; no Linux, como o usuário postgres.
como_postgres() { if [[ $WIN ]]; then "$@"; else su postgres -c "$(printf '%q ' "$@")"; fi; }
# Caminho para os executáveis nativos do Windows (C:/...); no Linux, o próprio caminho.
nativo() { if [[ $WIN ]]; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
# Derruba quem escuta na porta (nunca pkill -f: derruba o shell).
matar_porta() {
  local pid
  if [[ $WIN ]]; then
    for pid in $(netstat -ano | awk -v p=":$1\$" '$1 == "TCP" && $2 ~ p && $4 == "LISTENING" { print $5 }' | sort -u); do
      taskkill //PID "$pid" //F > /dev/null 2>&1 || true
    done
  else
    for pid in $(ss -ltnpH "sport = :$1" 2> /dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do kill "$pid" 2> /dev/null || true; done
  fi
}

if [[ ${1:-} == "--reset" ]]; then
  matar_porta 54321
  matar_porta "$PORTA_POSTGREST"
  como_postgres "$PGBIN/pg_ctl" -D "$(nativo "$PGDATA")" stop -m fast > /dev/null 2>&1 || true
  rm -rf "$PGHOME"
fi
if [[ ! -d $PGDATA ]]; then
  mkdir -p "$PGHOME"
  [[ $WIN ]] || chown postgres:postgres "$PGHOME"
  if [[ $WIN ]]; then LOCALE=(--locale=C -E UTF8); else LOCALE=(--locale=C.UTF-8 -E UTF8); fi
  como_postgres "$PGBIN/initdb" -D "$(nativo "$PGDATA")" -A trust -U postgres "${LOCALE[@]}" > /dev/null
  {
    echo "port = 54322"
    echo "listen_addresses = 'localhost'"
    echo "timezone = 'UTC'"
    echo "lc_messages = 'C'"
  } >> "$PGDATA/postgresql.conf"
fi
if ! como_postgres "$PGBIN/pg_ctl" -D "$(nativo "$PGDATA")" status > /dev/null 2>&1; then
  if [[ $WIN ]]; then
    node "$AQUI/soltar.mjs" --esperar "$(nativo "$PGHOME/pg_ctl.log")" "$(nativo "$PGBIN/pg_ctl.exe")" -D "$(nativo "$PGDATA")" -l "$(nativo "$PGHOME/log.txt")" start -w
  else
    como_postgres "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGHOME/log.txt" start -w > /dev/null
  fi
fi
psql "$PGURL" -q -v ON_ERROR_STOP=1 -f "$AQUI/stub.sql"
cat > "$PGHOME/postgrest.conf" << CONF
db-uri = "postgres://authenticator:local@localhost:54322/postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "segredo-local-de-teste-com-mais-de-32-caracteres"
server-port = $PORTA_POSTGREST
db-channel-enabled = true
CONF
if ! curl -s -o /dev/null "http://localhost:$PORTA_POSTGREST/"; then
  if [[ $WIN ]]; then
    node "$AQUI/soltar.mjs" "$(nativo "$PGHOME/postgrest.log")" "$(nativo "$POSTGREST")" "$(nativo "$PGHOME/postgrest.conf")"
  else
    nohup "$POSTGREST" "$PGHOME/postgrest.conf" > "$PGHOME/postgrest.log" 2>&1 &
  fi
fi
if ! curl -s -o /dev/null http://localhost:54321/; then
  if [[ $WIN ]]; then
    node "$AQUI/soltar.mjs" "$(nativo "$PGHOME/proxy.log")" node "$(nativo "$AQUI/proxy.mjs")"
  else
    nohup node "$AQUI/proxy.mjs" > "$PGHOME/proxy.log" 2>&1 &
  fi
fi
for _ in $(seq 1 30); do
  curl -s -o /dev/null "http://localhost:$PORTA_POSTGREST/" && curl -s -o /dev/null http://localhost:54321/ && break
  sleep 0.5
done
echo "Postgres: $PGURL"
echo "API (supabase-js): http://localhost:54321  (chave: qualquer texto não-JWT => anon)"
echo "Login equipe: equipe@teste.local / qualquer senha"
echo "Após mudar o schema: psql $PGURL -c \"notify pgrst, 'reload schema'\""
