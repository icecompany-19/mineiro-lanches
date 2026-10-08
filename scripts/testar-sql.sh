#!/usr/bin/env bash
# Roda os testes SQL de supabase/tests contra o Postgres local (ou PG_URL). Sai com código ≠ 0 se algo falhar.
# Uso: bash scripts/testar-sql.sh            (banco já com o setup.sql aplicado)
#      bash scripts/testar-sql.sh --do-zero  (recria o banco, aplica o setup.sql DUAS vezes e roda os testes)
# Cada arquivo roda numa transação com rollback: o banco fica como estava.
set -uo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
PG_URL="${PG_URL:-postgresql://postgres@localhost:54322/postgres}"
PSQL=(psql "$PG_URL" -X -q -v ON_ERROR_STOP=1)

if [[ "${1:-}" == "--do-zero" ]]; then
  bash "$RAIZ/scripts/supabase-local/iniciar.sh" --reset >/dev/null || { echo "não subiu o Supabase local"; exit 1; }
  # duas vezes seguidas: prova que o setup.sql é idempotente
  for vez in 1 2; do
    if ! log=$("${PSQL[@]}" -f "$RAIZ/supabase/setup.sql" 2>&1 >/dev/null); then
      echo "FALHOU: setup.sql na aplicação $vez"; echo "$log" | grep -v NOTICE | tail -15; exit 1
    fi
    echo "ok   setup.sql aplicado ($vez.ª vez)"
  done
  "${PSQL[@]}" -c "notify pgrst, 'reload schema'"
fi

falhas=0
total=0
for arq in "$RAIZ"/supabase/tests/[0-9]*.sql; do
  nome="supabase/tests/$(basename "$arq")"
  if saida=$("${PSQL[@]}" -o /dev/null -f "$arq" 2>&1); then
    n=$(grep -c 'NOTICE:  ok - ' <<<"$saida")
    total=$((total + n))
    echo "ok   $nome ($n verificações)"
  else
    falhas=$((falhas + 1))
    echo "FALHOU $nome"
    grep -v 'NOTICE:  ok - ' <<<"$saida" | tail -15
  fi
done

if ((falhas)); then
  echo "$falhas arquivo(s) com falha"
  exit 1
fi
echo "todos os testes SQL passaram ($total verificações)"
