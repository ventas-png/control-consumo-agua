#!/usr/bin/env bash
# Corre el sandbox de RLS del motor de recepción contra un Postgres desechable.
#
# Las policies NO se copian: se EXTRAEN del archivo de migración que se va a
# desplegar, para que lo que se prueba sea exactamente lo que se aplica. Si
# alguien cambia la migración y rompe la separación por clase, esto lo dice.
#
#   scripts/rls-recepcion-sandbox.sh            # levanta su propio Postgres
#   PGURL=postgres://... scripts/rls-recepcion-sandbox.sh   # contra uno existente
#
# Requiere: initdb/pg_ctl/psql (postgresql-16) o un PGURL a una base DESECHABLE.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRACION="$RAIZ/supabase/migrations/20260829000600_recepcion_motor_unico.sql"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── Extracción de las policies reales ───────────────────────────────────────
# Del encabezado de la sección 5 hasta el de la 6. Si los marcadores cambian,
# el archivo sale vacío y el script aborta: mejor eso que probar de más.
awk '/^-- ── 5\) Policies por clase/{f=1} /^-- ── 6\) Índices/{f=0} f' \
  "$MIGRACION" > "$TMP/policies.sql"

if ! grep -q 'CREATE POLICY paquetes_recibidos_delete' "$TMP/policies.sql"; then
  echo "✗ No se pudieron extraer las policies de $MIGRACION (¿cambiaron los marcadores de sección?)" >&2
  exit 1
fi
echo "→ Policies extraídas de la migración: $(grep -c 'CREATE POLICY' "$TMP/policies.sql")"

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
  correr "$PGBIN/pg_ctl -D $DATA -o '-p 55432 -k $SOCK -c listen_addresses=' -l $TMP/pg.log start" >/dev/null
  trap 'correr "$PGBIN/pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
  PSQL=(psql -h "$SOCK" -p 55432 -U postgres -d postgres)
fi

echo "→ Montando andamiaje y datos"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -f "$RAIZ/scripts/rls-recepcion-sandbox.sql" >/dev/null

echo "→ Aplicando las policies de la migración"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -f "$TMP/policies.sql" >/dev/null

echo "→ Escenarios"
"${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$RAIZ/scripts/rls-recepcion-asserts.sql" 2>&1 |
  grep -E '^(NOTICE|──|✅|ERROR|FALLO)|^psql:' | sed 's/^NOTICE:  //'
