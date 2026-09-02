#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de la sección Recursos Humanos (20260907001200).
#
# POR QUÉ EXISTE
# La migración no crea tablas ni policies: mueve una columna de texto
# (`permissions.category`) y siembra grants derivados de otros grants. Eso la
# hace fácil de revisar en diagonal y difícil de verificar leyendo, porque los
# dos modos de fallar son silenciosos:
#
#   · Un patrón laxo que arrastra de más. En `LIKE` el guion bajo es COMODÍN, y
#     cuatro de los cinco tabs lo llevan en el nombre. Una clave vecina que se
#     cuele en la sección no rompe nada visible: aparece en el bloque
#     equivocado del editor de roles, y alguien otorga lo que no quería.
#   · Una herencia que reparte de más o de menos. `actividad_equipo` nace
#     copiando los grants de `personal`; copiar sólo los `allow` abriría un
#     permiso que un administrador había NEGADO, y copiar de más le daría las
#     acciones a quien sólo tenía lectura. Ninguna de las dos cosas la ve un
#     test de UI.
#
# QUÉ COMPRUEBA (16 invariantes + negativa + idempotencia)
#   A · CATÁLOGO   30 claves exactas en `recursos_humanos` (5 tabs × base + 5
#                  acciones); las cinco claves base conservan su NOMBRE —las
#                  policies gatean sobre ellas—; `actividad_equipo` estrena sus
#                  6; y los vecinos que no se mudan (documentos, inventario,
#                  tareas_personal) conservan su categoría.
#   B · HERENCIA   personal completo → actividad_equipo completo; sólo lectura →
#                  sólo lectura; el `deny` viaja como `deny` y no se vuelve
#                  `allow`; Administrador General cubre el tab nuevo; y quien no
#                  administra personal no estrena nada.
#   C · ACCESO     el rol de operaciones conserva tareas y limpieza: agrupar es
#                  presentación, autorizar es otra cosa. Ningún grant huérfano.
#   D · JORNADA    la segunda tanda (20260907001400): las 84 claves de la
#                  sección tras absorber turnos, plantillas, ausencias, horas,
#                  presencia, panel de turno, tareas por turno, rutas de ronda y
#                  desempeño; que `revision_tareas` y `bitacora_guardia` se
#                  QUEDEN en Seguridad; y que un rol de seguridad con jornada a
#                  cargo no pierda un solo grant ni vea su deny abrirse.
#   NEGATIVA       con un tab renombrado, la guarda de postcondición ABORTA. Sin
#                  esta prueba no se sabría si el paso 6 es real o decorativo.
#   IDEMPOTENCIA   re-aplicar no duplica grants, no ensancha la categoría, no
#                  convierte un deny en allow y limpia su tabla temporal.
#
# USO
#   supabase/tests/rbac_recursos_humanos/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG_RRHH="$RAIZ/supabase/migrations/20260907001200_rbac_seccion_recursos_humanos.sql"
# La segunda tanda: la jornada que venía de Seguridad. Se aplica en orden, como
# en producción — reclasificar sobre lo ya reclasificado tiene que ser inocuo.
MIG_JORNADA="$RAIZ/supabase/migrations/20260907001400_rbac_rrhh_absorbe_la_jornada.sql"

for d in ${PGBIN:-} /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/rrhhdata.XXXX)
SOCK=$(mktemp -d /tmp/rrhhsock.XXXX)
PUERTO=${PGPORT_TEST:-55493}

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
psql -q -d postgres -c "CREATE DATABASE rrhh" >/dev/null

echo "── 1/5 · fixture (catálogo previo a la mudanza) ────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d rrhh -f "$AQUI/fixture.sql" >/dev/null
echo "  OK    fixture cargado"

echo "── 2/5 · aplicar las migraciones, en orden ─────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d rrhh -f "$MIG_RRHH" >/dev/null
echo "  OK    $(basename "$MIG_RRHH")"

# El estado INTERMEDIO se mira antes de seguir: es la única ventana en la que se
# ve si la primera tanda arrastró a un vecino que la segunda muda después.
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d rrhh -f "$AQUI/entre_tandas.sql" 2>&1) || {
  echo "❌ la primera migración dejó un estado intermedio incorrecto:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d rrhh -f "$MIG_JORNADA" >/dev/null
echo "  OK    $(basename "$MIG_JORNADA")"

echo "── 3/5 · invariantes ───────────────────────────────────────────────────"
# Sin este `|| { … }`, `set -e` aborta con la salida de psql dentro de la
# sustitución y la consola no muestra NADA (ver supabase/tests/turnos/run.sh).
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d rrhh -f "$AQUI/assert.sql" 2>&1) || {
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
echo "── 4/5 · negativa (la guarda tiene que abortar) ────────────────────────"
# Base NUEVA: el escenario roto no debe contaminar el de arriba.
psql -q -d postgres -c "CREATE DATABASE rrhh_roto" >/dev/null
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d rrhh_roto -f "$AQUI/fixture.sql" >/dev/null
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d rrhh_roto -f "$AQUI/negativa.sql" >/dev/null
if SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d rrhh_roto -f "$MIG_RRHH" 2>&1); then
  echo "❌ la migración pasó en verde con un tab renombrado:"
  echo "   la guarda de postcondición del paso 6 no se disparó, así que es decorativa."
  exit 1
fi
if ! echo "$SALIDA" | grep -q 'no existen en el catálogo'; then
  echo "❌ la migración falló, pero NO por la guarda esperada:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
fi
echo "  OK    con tareas_cond renombrado, la migración aborta:"
echo "$SALIDA" | sed -n 's/.*ERROR:  /        /p' | head -2

echo
echo "── 5/5 · idempotencia (re-aplicar y re-verificar) ──────────────────────"
for m in "$MIG_RRHH" "$MIG_JORNADA"; do
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d rrhh -f "$m" >/dev/null
done
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d rrhh -f "$AQUI/reassert.sql" 2>&1) || {
  echo "❌ la re-aplicación cambió el estado:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo
echo "✅ rbac_recursos_humanos: 16 invariantes (catálogo exacto sin arrastres,"
echo "   herencia fiel al effect, acceso por rol intacto), la guarda de"
echo "   postcondición aborta de verdad, y la migración es idempotente."
