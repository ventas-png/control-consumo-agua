#!/usr/bin/env bash
# Corre el sandbox de evidencias de recepción y acuse contra un Postgres desechable.
#
# A diferencia del sandbox del motor (rls-recepcion-sandbox.sh, que EXTRAE una
# sección del archivo), aquí se aplica LA MIGRACIÓN ENTERA: 20260831000000 solo
# toca cosas que el andamiaje ya provee (storage.buckets/objects, los helpers de
# RBAC y paquetes_recibidos), así que se puede ejecutar tal cual. Lo que se
# prueba es, literalmente, el archivo que se va a desplegar.
#
#   scripts/rls-evidencias-sandbox.sh            # levanta su propio Postgres
#   PGURL=postgres://... scripts/rls-evidencias-sandbox.sh   # contra uno existente
#
# Requiere: initdb/pg_ctl/psql (postgresql-16) o un PGURL a una base DESECHABLE.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOTOR="$RAIZ/supabase/migrations/20260829000000_recepcion_motor_unico.sql"
MIGRACION="$RAIZ/supabase/migrations/20260831000000_recepcion_evidencias_y_acuse.sql"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Las policies de `paquetes_recibidos` hacen falta porque la de SELECT de
# storage se apoya en ellas (el EXISTS corre con la RLS de esa tabla). Se
# extraen igual que en el otro sandbox: de la migración, no de una copia.
awk '/^-- ── 5\) Policies por clase/{f=1} /^-- ── 6\) Índices/{f=0} f' \
  "$MOTOR" > "$TMP/policies-motor.sql"
if ! grep -q 'CREATE POLICY paquetes_recibidos_select' "$TMP/policies-motor.sql"; then
  echo "✗ No se pudieron extraer las policies de $MOTOR (¿cambiaron los marcadores?)" >&2
  exit 1
fi
echo "→ Policies del motor extraídas: $(grep -c 'CREATE POLICY' "$TMP/policies-motor.sql")"

if [[ ! -f "$MIGRACION" ]]; then
  echo "✗ Falta la migración $MIGRACION" >&2
  exit 1
fi

# ── Base desechable ─────────────────────────────────────────────────────────
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
  correr "$PGBIN/pg_ctl -D $DATA -o '-p 55433 -k $SOCK -c listen_addresses=' -l $TMP/pg.log start" >/dev/null
  trap 'correr "$PGBIN/pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
  PSQL=(psql -h "$SOCK" -p 55433 -U postgres -d postgres)
fi

echo "→ Montando andamiaje y datos"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -f "$RAIZ/scripts/rls-evidencias-sandbox.sql" >/dev/null

echo "→ Policies de paquetes_recibidos (20260829000000)"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -f "$TMP/policies-motor.sql" >/dev/null

echo "→ Aplicando la migración completa 20260831000000"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -f "$MIGRACION" >/dev/null

echo "→ Escenarios"
SALIDA="$TMP/salida.txt"
"${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$RAIZ/scripts/rls-evidencias-asserts.sql" > "$SALIDA" 2>&1 || {
  grep -E 'ERROR|FALLO' "$SALIDA" >&2; exit 1
}
grep -E '^(NOTICE|──|ERROR|FALLO)|^psql:' "$SALIDA" | sed -E 's/^psql:[^ ]* //; s/^NOTICE:  //'
echo "✅ $(grep -c '  ok  ' "$SALIDA") escenarios verificados contra Postgres real"
