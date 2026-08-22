#!/usr/bin/env bash
# Sandbox conductual de recepción contra un Postgres desechable.
#
# No copia SQL: monta la tabla TAL COMO ERA antes del motor único y le aplica
# LAS MIGRACIONES REALES en orden. Así el banco de pruebas hereda las
# constraints y el FK de verdad — que es donde estaba escondida la
# contradicción del ON DELETE SET NULL.
#
#   scripts/rls-evidencias-sandbox.sh                        # levanta su Postgres
#   PGURL=postgres://... scripts/rls-evidencias-sandbox.sh   # contra uno existente
#
# Requiere: initdb/pg_ctl/psql (postgresql-16) o un PGURL a una base DESECHABLE.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGR="$RAIZ/supabase/migrations"
MOTOR="$MIGR/20260829000600_recepcion_motor_unico.sql"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# De 20260829000600 solo se pueden ejecutar dos tramos: el resto migra filas
# desde `correspondencia_condominio`, que aquí no existe. Se extraen por sus
# encabezados de sección; si cambian, el archivo sale vacío y esto aborta.
awk '/^-- ── 2\) Generalizar paquetes_recibidos/{f=1} /^-- ── 3\) Migrar las filas/{f=0} f' \
  "$MOTOR" > "$TMP/motor-esquema.sql"
awk '/^-- ── 5\) Policies por clase/{f=1} /^-- ── 6\) Índices/{f=0} f' \
  "$MOTOR" > "$TMP/motor-policies.sql"

if ! grep -q 'paquetes_unidad_por_clase_chk' "$TMP/motor-esquema.sql" \
   || ! grep -q 'CREATE POLICY paquetes_recibidos_select' "$TMP/motor-policies.sql"; then
  echo "✗ No se pudieron extraer las secciones de $MOTOR (¿cambiaron los marcadores?)" >&2
  exit 1
fi
echo "→ Del motor: $(grep -c 'ADD CONSTRAINT' "$TMP/motor-esquema.sql") constraints y $(grep -c 'CREATE POLICY' "$TMP/motor-policies.sql") policies"

for m in 20260830000000_correspondencia_devolucion \
         20260831000000_recepcion_evidencias_y_acuse \
         20260901000000_recepcion_integridad_final \
         20260902000000_recepcion_claim_owner_y_mime; do
  [[ -f "$MIGR/$m.sql" ]] || { echo "✗ Falta la migración $m.sql" >&2; exit 1; }
done

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

aplicar() { "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }

echo "→ Andamiaje: la tabla como estaba ANTES del motor"
aplicar "$RAIZ/scripts/rls-evidencias-sandbox.sql"

echo "→ 20260829000600 · esquema (columnas, FK y CHECKs reales)"
aplicar "$TMP/motor-esquema.sql"
echo "→ 20260829000600 · policies por clase"
aplicar "$TMP/motor-policies.sql"
echo "→ 20260830000000 · devolución"
aplicar "$MIGR/20260830000000_correspondencia_devolucion.sql"
echo "→ 20260831000000 · evidencias y acuse"
aplicar "$MIGR/20260831000000_recepcion_evidencias_y_acuse.sql"
echo "→ 20260901000000 · integridad final"
aplicar "$MIGR/20260901000000_recepcion_integridad_final.sql"
echo "→ 20260902000000 · dueño del claim y MIME estricto"
aplicar "$MIGR/20260902000000_recepcion_claim_owner_y_mime.sql"

echo "→ Fixtures"
aplicar "$RAIZ/scripts/rls-evidencias-datos.sql"

echo "→ Escenarios"
SALIDA="$TMP/salida.txt"
"${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$RAIZ/scripts/rls-evidencias-asserts.sql" > "$SALIDA" 2>&1 || {
  grep -E 'ERROR|FALLO' "$SALIDA" >&2; exit 1
}
grep -E '^(NOTICE|──|ERROR|FALLO)|^psql:' "$SALIDA" | sed -E 's/^psql:[^ ]* //; s/^NOTICE:  //'
echo "✅ $(grep -c '  ok  ' "$SALIDA") escenarios verificados contra Postgres real"
