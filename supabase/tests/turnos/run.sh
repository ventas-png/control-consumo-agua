#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE del control de asignación de turnos
# (20260820000000 · 000100 · 000200 · 000300 · 20260916171325 · 221839 ·
# 232549 · 20260917000825).
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
# QUÉ COMPRUEBA (94 invariantes)
#   A · JORNADA       que 22:00→06:00 cuenta 8 h y no -960 minutos (el bug vivo
#                     de PresenciaPersonalTab), con y sin bandera de cruce, que
#                     el descanso se descuenta y que la franja nocturna
#                     20:00–06:00 se mide bien.
#   B · PERIODICIDAD  las once frecuencias —las cuatro largas que no existían en
#                     el repo y «los días del mes que elijas»—, el día 31 en
#                     febrero, y el 28/29/30/31 con febrero bisiesto y no
#                     bisiesto, incluida la convergencia de varios en el último
#                     día del mes.
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
#   H · BORRADO       que NINGÚN rol de aplicación —ni company_owner, ni admin,
#                     ni super_admin, ni el permiso del tab— borra un bloque
#                     pasado, iniciado, cerrado, o con tareas, revisiones o
#                     marcajes; que el rechazo deja las filas hijas intactas; y
#                     que uno limpio de hoy o del futuro sí se borra.
#   I · EXCEPCIONES   que el día quitado no vuelve al re-generar (N veces),
#                     que retirarlo lo devuelve, que las FKs compuestas cierran
#                     la referencia cruzada, que creado_por no se falsifica y
#                     que las cuatro operaciones respetan empresa y proyecto,
#                     y que el ACL de la tabla es el declarado y no el que
#                     Supabase concede por defecto (TRUNCATE no pasa por RLS).
#   J · AUTORIZACIÓN  que la clave de VISIBILIDAD del tab (3 segmentos) deja
#                     leer el calendario y NO deja escribirlo: ni excepciones,
#                     ni bloques, ni generar el mes, ni las RPC del día; que con
#                     el permiso de acción las mismas operaciones pasan; y que
#                     el fallback legado platform.condominios.view + acción
#                     sigue valiendo.
#   K · ATOMICIDAD    que guardar un día retira su excepción en el mismo commit,
#                     que quitarlo borra su bloque en el mismo commit, que si el
#                     trigger rechaza el borrado NO queda excepción huérfana y
#                     sube su mensaje intacto, que repetir es idempotente, y que
#                     un UUID ajeno no abre la puerta a otro inquilino.
#   L · PROYECTO      que el alcance se concede por PROYECTO y no por empresa:
#                     con turnos.edit pero sin el condominio asignado no se da
#                     de alta, no se actualiza y no se puede MOVER un bloque al
#                     condominio de al lado; y que quien sí lo administra
#                     escribe con normalidad.
#   M · REPLANIFICAR  que cambiarle la jornada a un día exige lo mismo que
#                     borrarlo —futuro, pendiente, sin iniciar, sin cerrar, sin
#                     tareas, revisiones ni marcajes— también por UPDATE
#                     directo; que cada condición se prueba aislada, así que
#                     retirarla rompe exactamente una invariante; y que NO se
#                     rompe el ciclo de vida (iniciar, cerrar, puntuar, anotar)
#                     ni el ON DELETE SET NULL al borrar una jornada.
#   N · LECTURA      que leer la agenda también exige el PROYECTO y no sólo la
#                     empresa —lo que 20260916232549 dio por hecho sin que fuera
#                     cierto—, en las dos direcciones; que quien administra la
#                     empresa entera sigue leyendo sus condominios; y que
#                     `tareas_bloque` y `revisiones_tarea` heredan ese alcance
#                     por el EXISTS sobre el bloque padre, sin tocar sus policies.
#   O · TERNA        que `personal_id` y `asignacion_id` arrastran
#                     (id, company_id, project_id): un bloque no puede nombrar
#                     personal ni regla de otro condominio aunque su propio
#                     project_id sea el correcto; que el ON DELETE CASCADE del
#                     empleado sigue vivo; y que borrar una regla desvincula el
#                     histórico sin borrarlo ni sacarlo de su inquilino.
#   P · REGLA        que re-apuntar `asignacion_id` de X a Y es re-planificar y
#                     exige las seis condiciones, que X→NULL no lo es (si no, el
#                     ON DELETE SET NULL sería inaplicable) y que NULL→X sobre un
#                     histórico tampoco pasa.
#   Q · ZONA         que «hoy» es el de la EMPRESA y no el de UTC: la misma fecha
#                     es hoy para un inquilino en UTC−11 y pasado para uno en
#                     UTC+14, a cualquier hora del día. Es lo que ninguna prueba
#                     fijaba, y por eso la 70 se caía pasada la medianoche UTC.
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
# Va la última: dropea la firma de 8 parámetros de turnos_regla_aplica que crea
# MIG_GEN y la reemplaza por la de 9. Si se aplicara antes, MIG_GEN volvería a
# crear la vieja y toda llamada de 8 argumentos quedaría ambigua.
MIG_NUEVA="$RAIZ/supabase/migrations/20260916171325_turnos_dias_del_mes_excepciones_y_borrado_seguro.sql"
# Y la última: reemplaza las policies de escritura y la RPC de generación para
# que autoricen por ACCIÓN, y añade las tres RPC transaccionales del día.
MIG_ACCION="$RAIZ/supabase/migrations/20260916221839_turnos_autorizacion_por_accion_y_dia_atomico.sql"
# Y la última: añade can_access_project a la escritura de bloques y somete la
# re-planificación de un día a las mismas invariantes que el borrado.
MIG_ALCANCE="$RAIZ/supabase/migrations/20260916232549_turnos_alcance_proyecto_y_replanificacion_segura.sql"
# Y la última: cierra la LECTURA por proyecto —que las anteriores daban por
# cerrada y no lo estaba—, cambia las dos FKs simples por ternas de inquilino y
# somete `asignacion_id` a las invariantes de re-planificación.
MIG_TERNA="$RAIZ/supabase/migrations/20260917000825_turnos_lectura_por_proyecto_y_terna_de_referencias.sql"

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

echo "── 2/4 · aplicar las ocho migraciones ──────────────────────────────────"
for m in "$MIG_BASE" "$MIG_CAL" "$MIG_GEN" "$MIG_HRS" "$MIG_NUEVA" "$MIG_ACCION" "$MIG_ALCANCE" "$MIG_TERNA"; do
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
echo "── 4/4 · idempotencia (re-aplicar las ocho) ────────────────────────────"
for m in "$MIG_BASE" "$MIG_CAL" "$MIG_GEN" "$MIG_HRS" "$MIG_NUEVA" "$MIG_ACCION" "$MIG_ALCANCE" "$MIG_TERNA"; do
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d turnos -f "$m" >/dev/null
done
echo "  OK    las ocho migraciones se pueden volver a aplicar"

echo
echo "✅ turnos: 94 invariantes (jornada, periodicidad, backfill, generación,"
echo "   expediente, horas, RLS, borrado seguro, excepciones, autorización por"
echo "   acción, edición atómica del día, alcance por proyecto, re-planificación"
echo "   segura, lectura por proyecto, terna de referencias, re-apuntar la regla"
echo "   y zona horaria del inquilino), migraciones idempotentes."
