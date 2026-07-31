#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de la trazabilidad de usuario
#   20260731000000_trazabilidad_creado_por.sql
#   20260731000100_bitacora_acciones_trigger.sql
#
# POR QUÉ EXISTE
# Ninguna de las dos migraciones es SQL trivial: son DO blocks con DDL dinámico
# sobre ~88 tablas, triggers parametrizados por TG_ARGV, `jsonb_populate_record`
# reescribiendo NEW y un trigger AFTER con EXCEPTION que nunca debe abortar la
# operación del usuario. Mergear eso sin haberlo ejecutado NUNCA contra un
# Postgres es exactamente el riesgo que documenta supabase/tests/pr27_project_id.
# Este script las corre de verdad contra un cluster desechable.
#
# QUÉ COMPRUEBA (14 invariantes, ver assert.sql)
#   1-4   el sello: se pone solo, NO es falsificable desde el cliente, es
#         inmutable ante UPDATE, y una escritura de sistema queda NULL sin fallar
#   5-6   el sello de CIERRE: quien crea y quien completa se registran aparte,
#         y editar la fila después no reescribe quién la completó
#   7     visitantes.registrado_por en modo si_nulo: rellena si falta, respeta
#         lo que ya mandaba la UI
#   8     donde ya existía created_by se sella ESA columna, sin duplicarla
#   9     cobertura: cada tabla del catálogo terminó con columna Y trigger
#   10-14 la bitácora: se llena sola, desnormaliza el nombre, ignora las
#         escrituras de sistema, hereda el scope del padre en tablas hijas,
#         guarda solo el delta y traduce el cambio de estado a acción
#
# Además comprueba IDEMPOTENCIA (re-aplicar no rompe) y —lo más importante del
# trigger de bitácora— que un fallo suyo NO tumbe la escritura original.
#
# USO
#   supabase/tests/trazabilidad/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG_SELLO="$RAIZ/supabase/migrations/20260731000000_trazabilidad_creado_por.sql"
MIG_BITACORA="$RAIZ/supabase/migrations/20260731000100_bitacora_acciones_trigger.sql"

# Los binarios no siempre están en PATH (en Debian/Ubuntu viven versionados).
for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: se usa una ruta corta a propósito.
DATA=$(mktemp -d /tmp/trazdata.XXXX)
SOCK=$(mktemp -d /tmp/trazsock.XXXX)
PUERTO=${PGPORT_TEST:-55433}

limpiar() {
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK"
}
trap limpiar EXIT

# Postgres se niega a correr como root; si lo somos, se delega en `postgres`.
COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  chown -R postgres "$DATA" "$SOCK"
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE DATABASE traz" >/dev/null
# anon/authenticated no existen en un Postgres pelado; se crean para poder
# comprobar los REVOKE igual que en Supabase.
psql -q -d traz -c "CREATE ROLE anon; CREATE ROLE authenticated;" >/dev/null 2>&1 || true

echo "── 1/4 · fixture + migraciones + 14 invariantes ────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d traz -f "$AQUI/fixture.sql"     >/dev/null
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d traz -f "$MIG_SELLO"           >/dev/null
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d traz -f "$MIG_BITACORA"        >/dev/null
psql -q -v ON_ERROR_STOP=1 -d traz -f "$AQUI/assert.sql" 2>&1 | sed -n 's/.*NOTICE:  /  /p'

echo "── 2/4 · idempotencia (re-aplicar ambas migraciones) ───────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d traz -f "$MIG_SELLO"    >/dev/null
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d traz -f "$MIG_BITACORA" >/dev/null
echo "  OK    re-aplicar no falla (ADD COLUMN IF NOT EXISTS + DROP/CREATE TRIGGER)"

echo "── 3/4 · un fallo de la bitácora NO tumba la escritura del usuario ─────"
# La invariante que justifica el EXCEPTION WHEN OTHERS del trigger AFTER: si la
# bitácora revienta, la lectura/limpieza que la persona estaba guardando se
# guarda igual. Se fuerza el fallo rompiendo la tabla de destino.
psql -q -v ON_ERROR_STOP=1 -d traz >/dev/null <<'SQL'
-- Se vacía primero: el CHECK se valida contra las filas existentes y las que
-- dejaron los asserts anteriores lo violarían al crearlo.
DELETE FROM public.bitacora_acciones;
ALTER TABLE public.bitacora_acciones ADD CONSTRAINT revienta CHECK (accion = 'jamas');
SQL
SALIDA=$(psql -tAq -d traz <<'SQL' 2>&1
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000a', false);
INSERT INTO public.checklist_areas (company_id, project_id, area)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','Con bitácora rota');
SELECT count(*) FROM public.checklist_areas WHERE area = 'Con bitácora rota';
SQL
)
if grep -qx "1" <<<"$SALIDA"; then
  echo "  OK    la fila se guardó pese a que la bitácora falló"
else
  echo "  ❌    la bitácora tumbó la escritura del usuario"; echo "$SALIDA"; exit 1
fi
psql -q -d traz -c "ALTER TABLE public.bitacora_acciones DROP CONSTRAINT revienta" >/dev/null

echo "── 4/4 · las funciones de sellado no quedan anon-ejecutables ───────────"
# Regresa-guarda de #378/#380: CREATE FUNCTION concede EXECUTE a PUBLIC por
# defecto, y security-guard.yml falla el build si eso llega a producción.
for fn in "public.sellar_actor()" "public.sellar_cierre()" "public.registrar_bitacora()"; do
  v=$(psql -tAq -d traz -c "SELECT has_function_privilege('anon','$fn','EXECUTE')")
  if [ "$v" = "f" ]; then
    echo "  OK    anon NO puede ejecutar $fn"
  else
    echo "  ❌    anon puede ejecutar $fn"; exit 1
  fi
done

echo
echo "✅ trazabilidad: todas las invariantes pasan"
