#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE del control de asignación de turnos
# (20260820000000 · 000100 · 000200 · 000300).
#
# POR QUÉ EXISTE
# Nada de lo que hacen estas migraciones se puede validar leyéndolas. Un
# calendario de turnos falla en silencio y de tres maneras que se parecen entre
# sí en pantalla: la regla no cae donde debería (el empleado ve el mes vacío y
# cree que libra), cae de más (se le duplican los días), o el cómputo de horas
# devuelve un número plausible pero equivocado —que es el peor caso, porque se
# convierte en un pago. La aritmética de "cada bimestre, el día 31, saltando
# festivos" no se revisa a ojo.
#
# QUÉ COMPRUEBA (36 invariantes)
#   A · JORNADA       que 22:00→06:00 cuenta 8 h y no -960 minutos (el bug vivo
#                     de PresenciaPersonalTab), con y sin bandera de cruce, que
#                     el descanso se descuenta y que la franja nocturna
#                     20:00–06:00 se mide bien.
#   B · PERIODICIDAD  las diez frecuencias, incluidas las cuatro largas que no
#                     existían en el repo, y el día 31 en febrero.
#   C · BACKFILL      que el marcaje histórico se ata al empleado por nombre
#                     normalizado y que quien no está en plantilla no se ata a
#                     nadie por error.
#   D · GENERACIÓN    que materializa los días correctos, que re-generar no
#                     duplica, que no pisa un bloque puesto a mano, y que se
#                     salta ausencias aprobadas y festivos (salvo la regla que
#                     declara cubrirlos).
#   E · EXPEDIENTE    que aprobar vacaciones marca al empleado —y por tanto la
#                     ruta de limpieza deja de asignarle áreas—, que cancelarlas
#                     lo devuelve, y que 'inactivo' nunca se resucita.
#   F · HORAS         ordinarias vs extra contra lo planificado, cobertura no
#                     programada, asueto ponderado por su factor, y que un
#                     marcaje sin empleado no se le imputa a nadie.
#   G · RLS           que el permiso del tab abre la lectura, que leer turnos no
#                     habilita a aprobar ausencias, y que la empresa vecina no
#                     lee, no genera y no computa.
#
# USO
#   supabase/tests/turnos/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG_BASE="$RAIZ/supabase/migrations/20260820000000_turnos_plantillas_y_asignaciones.sql"
MIG_CAL="$RAIZ/supabase/migrations/20260820000100_calendario_laboral_y_ausencias.sql"
MIG_GEN="$RAIZ/supabase/migrations/20260820000200_generar_bloques_turno_rpc.sql"
MIG_HRS="$RAIZ/supabase/migrations/20260820000300_horas_personal_calculo.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/turnosdata.XXXX)
SOCK=$(mktemp -d /tmp/turnossock.XXXX)
PUERTO=${PGPORT_TEST:-55435}

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
psql -q -d postgres -c "CREATE DATABASE turnos" >/dev/null
# anon/authenticated no existen en un Postgres pelado; las migraciones les
# revocan permisos por nombre de rol.
psql -q -d turnos -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

echo "── 1/4 · fixture (padrón + helpers + personal tal como está en prod) ────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d turnos -f "$AQUI/fixture.sql" >/dev/null
echo "  OK    fixture cargado"

echo "── 2/4 · aplicar las cuatro migraciones ────────────────────────────────"
for m in "$MIG_BASE" "$MIG_CAL" "$MIG_GEN" "$MIG_HRS"; do
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d turnos -f "$m" >/dev/null
  echo "  OK    $(basename "$m")"
done

echo "── 3/4 · invariantes ───────────────────────────────────────────────────"
# Sin este `|| { … }`, `set -e` aborta el script con la salida de psql dentro de
# la sustitución y la consola no muestra NADA: un assert roto se veía como un
# corte en seco. La invariante que falló tiene que ser lo primero que se lea.
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d turnos -f "$AQUI/assert.sql" 2>&1) || {
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo
  echo "❌ invariante incumplida:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
if echo "$SALIDA" | grep -q 'WARNING:'; then
  echo
  echo "❌ algo se tragó un error:"
  echo "$SALIDA" | sed -n 's/.*WARNING:  /  ⚠ /p'
  exit 1
fi

echo
echo "── 4/4 · idempotencia (re-aplicar las cuatro) ──────────────────────────"
for m in "$MIG_BASE" "$MIG_CAL" "$MIG_GEN" "$MIG_HRS"; do
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d turnos -f "$m" >/dev/null
done
echo "  OK    las cuatro migraciones se pueden volver a aplicar"

echo
echo "✅ turnos: 36 invariantes (jornada, periodicidad, backfill, generación,"
echo "   expediente, horas y RLS), migraciones idempotentes."
