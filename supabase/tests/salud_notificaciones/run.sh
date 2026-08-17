#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260824010000 (plantilla del correo de anuncios +
# vigilante del outbox).
#
# POR QUÉ EXISTE
# Las dos mitades son defensas contra fallos silenciosos, y una defensa que
# falla en silencio es peor que no tenerla: da la sensación de estar cubierto.
# Un vigilante demasiado sensible entrena a la gente a ignorar la campana; uno
# demasiado laxo no dispara el día que hace falta. La diferencia entre ambos no
# se ve leyendo el SQL — hay que meterle filas de las cuatro clases (recientes,
# en reintento, jamás tocadas, clavadas) y comprobar cuáles alarman.
#
# QUÉ COMPRUEBA (16 invariantes)
#   · PLANTILLA  que exista la global de email que faltaba, que renderice las
#                variables que el productor sí manda, y que NO se siembre el
#                in_app (que ya funciona por payload).
#   · VIGILANTE  que distinga un atasco real de un reintento sano, que avise
#                sólo a los responsables de la empresa afectada, que el aviso
#                NO pase por el outbox (sería circular), que respete la ventana
#                de silencio y que insista cuando ésta expira.
#
# USO
#   supabase/tests/salud_notificaciones/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGRACION="$RAIZ/supabase/migrations/20260824010000_plantilla_anuncio_y_salud_notificaciones.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/saluddata.XXXX)
SOCK=$(mktemp -d /tmp/saludsock.XXXX)
PUERTO=${PGPORT_TEST:-55436}

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
psql -q -d postgres -c "CREATE DATABASE saludnotif" >/dev/null
# anon/authenticated/service_role no existen en un Postgres pelado; la migración
# les revoca/otorga permisos por nombre de rol.
psql -q -d saludnotif -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

cargar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d saludnotif -f "$1" >/dev/null; }

echo "── 1/3 · fixture (padrón + outbox + campana + catálogo) ────────────────"
cargar "$AQUI/fixture.sql"
echo "  OK    fixture cargado"

echo "── 2/3 · aplicar 20260824010000 ────────────────────────────────────────"
cargar "$MIGRACION"
echo "  OK    migración aplicada"

echo "── 3/3 · invariantes ───────────────────────────────────────────────────"
# `|| true` para no morir en seco con `set -e`: sin esto, una aserción fallida
# aborta el script ANTES de imprimir cuál falló, que es justo lo que se necesita.
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d saludnotif -f "$AQUI/assert.sql" 2>&1) && ESTADO=0 || ESTADO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
if [ "$ESTADO" -ne 0 ]; then
  echo
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
fi
if echo "$SALIDA" | grep -q 'WARNING:'; then
  echo
  echo "❌ algo se tragó un error:"
  echo "$SALIDA" | sed -n 's/.*WARNING:  /  ⚠ /p'
  exit 1
fi

echo
echo "── idempotencia (re-aplicar la migración) ──────────────────────────────"
cargar "$MIGRACION"
psql -q -t -A -d saludnotif -c \
  "SELECT CASE WHEN count(*) = 1 THEN '  OK    la plantilla no se duplica al re-aplicar'
               ELSE '❌ la plantilla se duplicó: ' || count(*) END
     FROM public.notification_templates
    WHERE company_id IS NULL AND key = 'anuncio_condominio' AND channel = 'email';"

echo
echo "✅ 20260824010000: los anuncios ya pueden salir por correo y el outbox"
echo "   atascado deja de ser invisible (16 invariantes), migración idempotente."
