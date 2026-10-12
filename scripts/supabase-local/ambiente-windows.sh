# Ambiente para rodar a bateria no Windows (Git Bash). Uso: source scripts/supabase-local/ambiente-windows.sh
# Ferramentas em %LOCALAPPDATA%/mineiro-ferramentas: pgsql (zip de binários do PostgreSQL 17 da EDB) e
# postgrest (postgrest-v16.4-windows-x86-64.zip). O postgrest.exe precisa da libpq.dll de pgsql/bin no PATH.
FERR_ML="$(cygpath -u "${MINEIRO_FERRAMENTAS:-$LOCALAPPDATA/mineiro-ferramentas}")"
export PATH="$FERR_ML/pgsql/bin:$FERR_ML/postgrest:$PATH"
export PGCLIENTENCODING=UTF8
export PORTA_TESTE="${PORTA_TESTE:-4180}"
export PG_URL="${PG_URL:-postgresql://postgres@localhost:54322/postgres}"
export API_URL="${API_URL:-http://localhost:54321}"
# o e2e chama "bash scripts/supabase-local/iniciar.sh": fixa o bash do Git (no PATH do Windows há um stub do WSL)
BASH="$(command -v bash)"
export BASH
unset FERR_ML
