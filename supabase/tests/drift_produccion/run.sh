#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260904000500 contra la forma REAL de producción
#
# POR QUÉ EXISTE
# El 2026-08-27 el merge de #782 aplicó la serie de limpieza a producción y
# falló a medias: `20260904000100` reventó con
#
#   42703: column "activo" of relation "areas_condominio" does not exist
#
# El CI estaba entero en verde. No mintió: en un esquema construido desde
# supabase/migrations esa columna SÍ existe (20260424000059 la declara). Lo que
# no existe es en producción, porque esa tabla no la creó esa migración — ver la
# cabecera de scripts/backfill-schema-migrations.sql. Ningún entorno de prueba
# tenía la forma que sí importaba.
#
# Este sandbox la tiene. Monta el esquema declarado, lo DEFORMA hasta la forma
# real de producción (pre_produccion.sql) y prueba contra eso. Un guard estático
# que leyera el .sql no valdría: sobre esquema limpio la reparación es un no-op.
#
# QUÉ COMPRUEBA
#   NEGATIVA      sobre la forma de producción, 20260904000100 falla con el
#                 MISMO 42703 que dio el apply real. Si esto no falla, el
#                 escenario no reproduce nada y el resto del archivo no prueba
#                 nada.
#   REPARACIÓN    con 000500 delante, la serie ENTERA (000100…000400) aplica:
#                 10 invariantes — columnas repuestas, huecos rellenados antes
#                 de cerrar el NOT NULL, FK que faltaba, backfill ejecutado,
#                 policy legacy retirada, ancla + FK compuesta + RESTRICT, y el
#                 alta/desactivación de un área, que es el gesto que hoy da 400.
#   CONTRATO      si al esquema le falta algo que 000100/000400 dan por cierto,
#                 000500 aborta ANTES de tocar nada y nombra TODO lo que falta
#                 en un solo error (no el primero).
#   HUÉRFANOS     con áreas apuntando a una empresa inexistente, la FK de
#                 company_id NO se crea, se avisa por NOTICE y la serie aplica
#                 igual. Es la única excepción declarada al fail-closed.
#   IDEMPOTENCIA  re-aplicar 000500 y la serie no duplica constraints ni pisa
#                 datos (el modo reconciliar re-ejecuta por diseño).
#
# USO
#   supabase/tests/drift_produccion/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
FIXTURE="$RAIZ/supabase/tests/limpieza_catalogos/fixture.sql"
MIG_AREAS="$RAIZ/supabase/migrations/20260904000100_limpieza_area_catalogo_e_historial.sql"
MIG_PLANT="$RAIZ/supabase/migrations/20260904000200_plantillas_catalogo_actividades.sql"
MIG_PUENTES="$RAIZ/supabase/migrations/20260904000300_plantilla_tarea_recursos.sql"
MIG_FINAL="$RAIZ/supabase/migrations/20260904000400_limpieza_integridad_final.sql"
MIG_REPARA="$RAIZ/supabase/migrations/20260904000500_reparar_prerrequisitos_limpieza.sql"
SERIE=("$MIG_AREAS" "$MIG_PLANT" "$MIG_PUENTES" "$MIG_FINAL")

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/driftdata.XXXX)
SOCK=$(mktemp -d /tmp/driftsock.XXXX)
PUERTO=${PGPORT_TEST:-55439}

limpiar() {
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK"
}
trap limpiar EXIT

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
psql -q -d postgres -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

silencio() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 "$@"; }

# Cada escenario en su propia base: una migración que falla deja la base a
# medias y contaminaría al siguiente.
escenario() {
  psql -q -d postgres -c "CREATE DATABASE $1" >/dev/null
  silencio -d "$1" -f "$FIXTURE" >/dev/null
  silencio -d "$1" -f "$AQUI/pre_produccion.sql" >/dev/null
}

echo "── 1/6 · reproducir la forma real de producción ────────────────────────"
for db in drift driftneg driftcontrato driftfk; do escenario "$db"; done
echo "  OK    areas_condominio sin \`activo\`, icono/orden laxos, sin FK de company_id"
echo "  OK    rutas_ronda sin \`activo\`"

echo
echo "── 2/6 · NEGATIVA: 20260904000100 sobre esa forma reproduce el 42703 ───"
# --single-transaction imita a la Management API, que manda el archivo entero
# como UNA consulta: por eso el 000100 real revirtió completo en producción.
# VERBOSITY=verbose para que psql imprima el SQLSTATE: se compara contra el
# código exacto (42703) y no contra un texto que cambia entre versiones.
SALIDA=$(psql --single-transaction -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -d driftneg -f "$MIG_AREAS" 2>&1) && {
  echo "❌ 000100 aplicó sin problemas — el escenario NO reproduce producción,"
  echo "   así que el resto de este archivo no prueba nada."
  exit 1
}
if ! grep -q '42703' <<<"$SALIDA" || ! grep -q 'activo' <<<"$SALIDA"; then
  echo "❌ 000100 falló, pero por otra causa (se esperaba 42703 sobre \`activo\`):"
  sed -n 's/.*ERROR:  /  /p' <<<"$SALIDA"
  exit 1
fi
echo "  OK    $(sed -n 's/.*ERROR:  /  /p' <<<"$SALIDA" | head -1 | cut -c1-70)…"
echo "  OK    y la transacción revirtió entera, como en el apply real"

echo
echo "── 3/6 · reparar y aplicar la serie completa ───────────────────────────"
silencio -d drift -f "$MIG_REPARA" >/dev/null
echo "  OK    20260904000500 (reparación)"
for m in "${SERIE[@]}"; do
  silencio -d drift -f "$m" >/dev/null
  echo "  OK    $(basename "$m")"
done

echo
echo "── 4/6 · invariantes ───────────────────────────────────────────────────"
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d drift -f "$AQUI/assert.sql" 2>&1) || {
  sed -n 's/.*NOTICE:  /  /p' <<<"$SALIDA"
  echo
  echo "❌ invariante incumplida:"
  sed -n 's/.*ERROR:  /  /p' <<<"$SALIDA"
  exit 1
}
sed -n 's/.*NOTICE:  /  /p' <<<"$SALIDA"
if grep -q 'WARNING:' <<<"$SALIDA"; then
  echo; echo "❌ algo se tragó un error:"
  sed -n 's/.*WARNING:  /  ⚠ /p' <<<"$SALIDA"
  exit 1
fi

echo
echo "── 5/6 · contrato fail-closed ──────────────────────────────────────────"
# Se le quitan DOS prerrequisitos a la vez: el error tiene que nombrar los dos.
# Un contrato que sólo cuente el primero obliga a una corrida por hueco, que es
# exactamente lo que hizo caro el diagnóstico del 2026-08-27.
silencio -d driftcontrato -c "ALTER TABLE public.programacion_limpieza DROP COLUMN area" >/dev/null
silencio -d driftcontrato -c "DO \$\$ DECLARE c text; BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'public.ejecuciones_limpieza'::regclass AND contype = 'f'
     AND confrelid = 'public.programacion_limpieza'::regclass;
  EXECUTE format('ALTER TABLE public.ejecuciones_limpieza DROP CONSTRAINT %I', c);
END \$\$;" >/dev/null
SALIDA=$(psql --single-transaction -v ON_ERROR_STOP=1 -d driftcontrato -f "$MIG_REPARA" 2>&1) && {
  echo "❌ 000500 aplicó pese a faltar prerrequisitos: el contrato no muerde."
  exit 1
}
if ! grep -q 'PRERREQUISITOS_LIMPIEZA' <<<"$SALIDA"; then
  echo "❌ falló por otra causa:"; sed -n 's/.*ERROR:  /  /p' <<<"$SALIDA"; exit 1
fi
for esperado in 'programacion_limpieza.area' 'ejecuciones_limpieza.programacion_id'; do
  grep -q "$esperado" <<<"$SALIDA" || {
    echo "❌ el error no menciona «$esperado» — el contrato no acumula:"
    sed -n 's/.*ERROR:  /  /p' <<<"$SALIDA"
    exit 1
  }
done
echo "  OK    aborta nombrando LOS DOS huecos en un solo error"
if silencio -d driftcontrato -c "SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.areas_condominio'::regclass AND attname = 'activo'" \
     -t 2>/dev/null | grep -q 1; then
  echo "❌ el contrato abortó pero la reparación ya había tocado el esquema"
  exit 1
fi
echo "  OK    y no dejó nada a medias (transacción revertida)"

echo
echo "── 6/6 · huérfanos + idempotencia ──────────────────────────────────────"
silencio -d driftfk -c "INSERT INTO public.areas_condominio (company_id, project_id, nombre)
  VALUES ('dddddddd-0000-0000-0000-0000000000ff', '11111111-0000-0000-0000-000000000001', 'Área huérfana')" >/dev/null 2>&1 \
  || { echo "❌ no se pudo sembrar el área huérfana"; exit 1; }
SALIDA=$(psql -v ON_ERROR_STOP=1 -d driftfk -f "$MIG_REPARA" 2>&1) || {
  echo "❌ 000500 abortó con huérfanos; debía avisar y seguir:"
  sed -n 's/.*ERROR:  /  /p' <<<"$SALIDA"; exit 1
}
grep -q 'NO se creó areas_condominio_company_id_fkey' <<<"$SALIDA" || {
  echo "❌ no avisó por NOTICE del huérfano"; exit 1; }
if psql -tAq -d driftfk -c "SELECT count(*) FROM pg_constraint
     WHERE conrelid = 'public.areas_condominio'::regclass AND contype = 'f'
       AND confrelid = 'public.companies'::regclass" | grep -qv '^0$'; then
  echo "❌ creó la FK pese a los huérfanos"; exit 1
fi
for m in "${SERIE[@]}"; do silencio -d driftfk -f "$m" >/dev/null; done
echo "  OK    con huérfanos: avisa, NO crea la FK, y la serie aplica igual"

silencio -d drift -f "$MIG_REPARA" >/dev/null
for m in "${SERIE[@]}"; do silencio -d drift -f "$m" >/dev/null; done
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d drift -f "$AQUI/reassert.sql" 2>&1) || {
  echo "❌ la re-aplicación cambió algo:"
  sed -n 's/.*ERROR:  /  /p' <<<"$SALIDA"; exit 1
}
sed -n 's/.*NOTICE:  /  /p' <<<"$SALIDA"

echo
echo "✅ drift_produccion: el 42703 de producción reproducido y cerrado —"
echo "   10 invariantes sobre la forma real, contrato fail-closed que nombra"
echo "   todos los huecos, huérfanos declarados, y serie idempotente."
