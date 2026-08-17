#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260824000000 (reservas que avisan + entrega
# in_app dentro de la base).
#
# POR QUÉ EXISTE
# Las dos mitades de esa migración fallan en silencio si están mal. Un fan-out
# que avisa a quien no toca no da error: deja la campana vacía o llena de ruido,
# y eso se nota días después. Un despachador que reclama mal es peor: puede
# duplicar avisos, dejar filas clavadas en 'sending' para siempre o tragarse las
# que fallan. Nada de eso se ve leyendo el SQL; hay que ejecutarlo con filas
# reales, incluidas las torcidas.
#
# QUÉ COMPRUEBA (22 invariantes)
#   · RESERVAS  a quién avisa (staff del proyecto, nunca el de otro proyecto, ni
#               el inactivo, ni el residente, ni quien la creó), que el título
#               distinga "pendiente de aprobación" de "nueva", que una cancelada
#               no avise, y que el cuerpo diga amenidad + unidad + horario.
#   · ENTREGA   que respete el retraso (cederle el turno al edge), que drene lo
#               represado, que selle sent + provider_message_id para que el
#               "leído" siga correlacionando, que NO toque los email ni las
#               in_app con plantilla, que una fila con destinatario inexistente
#               vuelva a la cola con su error en vez de quedarse en 'sending', y
#               que una segunda pasada no duplique nada.
#
# USO
#   supabase/tests/notificaciones_reservas_entrega/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
BASE_FIXTURE="$RAIZ/supabase/tests/notificaciones_actividad/fixture.sql"
MIGRACION_PREVIA="$RAIZ/supabase/migrations/20260819000000_notificaciones_actividad.sql"
MIGRACION="$RAIZ/supabase/migrations/20260824000000_notificaciones_reservas_y_entrega_in_app.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/resvdata.XXXX)
SOCK=$(mktemp -d /tmp/resvsock.XXXX)
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
psql -q -d postgres -c "CREATE DATABASE notifresv" >/dev/null
# anon/authenticated no existen en un Postgres pelado; las migraciones les
# revocan permisos por nombre de rol.
psql -q -d notifresv -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

cargar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d notifresv -f "$1" >/dev/null; }

echo "── 1/4 · fixture ───────────────────────────────────────────────────────"
# El padrón (empresa, proyectos, unidades, outbox, chk) es el mismo del test de
# 20260819000000: reusarlo evita que las dos copias se desincronicen.
cargar "$BASE_FIXTURE"
cargar "$AQUI/fixture.sql"
echo "  OK    padrón + amenidades/reservas/campana"

echo "── 2/4 · migraciones ───────────────────────────────────────────────────"
# 20260819000000 aporta notif_staff_de_proyecto y notif_encolar_in_app, sobre
# los que se apoya el trigger de reservas.
cargar "$MIGRACION_PREVIA"
cargar "$MIGRACION"
echo "  OK    20260819000000 + 20260824000000 aplicadas"

echo "── 3/4 · invariantes ───────────────────────────────────────────────────"
# Los triggers tragan sus errores con RAISE WARNING para no tumbar el INSERT de
# negocio: sin este filtro un fallo se vería como "0 avisos" y no como el bug
# que es. Se muestran y se cuentan aparte.
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d notifresv -f "$AQUI/assert.sql" 2>&1)
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
if echo "$SALIDA" | grep -q 'WARNING:'; then
  echo
  echo "❌ algún trigger falló y se tragó el error:"
  echo "$SALIDA" | sed -n 's/.*WARNING:  /  ⚠ /p'
  exit 1
fi

echo
echo "── 4/4 · idempotencia (re-aplicar la migración) ────────────────────────"
cargar "$MIGRACION"
echo "  OK    la migración se puede volver a aplicar"

echo
echo "✅ 20260824000000: las reservas avisan a quien toca y el in_app llega a la"
echo "   campana sin depender del edge (22 invariantes), migración idempotente."
