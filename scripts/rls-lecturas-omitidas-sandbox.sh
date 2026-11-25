#!/usr/bin/env bash
# Corre la migración de lecturas omitidas contra un Postgres desechable y
# verifica quién puede omitir, ver, descartar y subir evidencias.
#
# La migración NO se copia: se aplica el archivo que se va a desplegar.
#
#   scripts/rls-lecturas-omitidas-sandbox.sh            # levanta su propio Postgres
#   PGURL=postgres://... scripts/rls-lecturas-omitidas-sandbox.sh   # contra uno DESECHABLE
#
# Requiere: initdb/pg_ctl/psql (postgresql-16) o un PGURL a una base desechable.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRACION="$RAIZ/supabase/migrations/20261222000000_agua_lecturas_omitidas.sql"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
[[ -f "$MIGRACION" ]] || { echo "✗ Falta la migración $MIGRACION" >&2; exit 1; }

if [[ -n "${PGURL:-}" ]]; then
  PSQL=(psql "$PGURL")
else
  PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
  DATA="$TMP/data"; SOCK="$TMP/sock"; mkdir -p "$SOCK"
  # initdb se niega a correr como root; si lo somos, usamos un usuario sin
  # privilegios (patrón habitual en contenedores de CI).
  COMO=""
  if [[ "$(id -u)" == "0" ]]; then
    COMO="ubuntu"; chown -R "$COMO" "$TMP"
  fi
  correr() { if [[ -n "$COMO" ]]; then su "$COMO" -c "$1"; else bash -c "$1"; fi }

  correr "$PGBIN/initdb -D $DATA -U postgres --auth=trust" >/dev/null
  correr "$PGBIN/pg_ctl -D $DATA -o '-p 55436 -k $SOCK -c listen_addresses=' -l $TMP/pg.log start" >/dev/null
  trap 'correr "$PGBIN/pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
  PSQL=(psql -h "$SOCK" -p 55436 -U postgres -d postgres)
fi

aplicar() { "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }

echo "→ Andamiaje"
aplicar "$RAIZ/scripts/rls-lecturas-omitidas-sandbox.sql"
echo "→ 20261222000000 · lecturas omitidas"
aplicar "$MIGRACION"
echo "→ Fixtures"
aplicar "$RAIZ/scripts/rls-lecturas-omitidas-datos.sql"

echo "→ Escenarios"
SALIDA="$TMP/salida.txt"
"${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$RAIZ/scripts/rls-lecturas-omitidas-asserts.sql" > "$SALIDA" 2>&1 || {
  grep -E 'ERROR|FALLO' "$SALIDA" >&2; exit 1
}
grep -E '^(NOTICE|──|ERROR|FALLO)|^psql:' "$SALIDA" | sed -E 's/^psql:[^ ]* //; s/^NOTICE:  //'
echo "✅ $(grep -c '  ok  ' "$SALIDA") escenarios verificados contra Postgres real"
