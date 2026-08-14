#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260819000000 (avisos de mensaje / difusión /
# solicitud en el centro de notificaciones).
#
# POR QUÉ EXISTE
# Los fallos de un fan-out de notificaciones son silenciosos por definición: si
# el trigger avisa a quien no toca, o no avisa a nadie, no hay error en pantalla
# —simplemente la campana se queda vacía o se llena de ruido, y eso sólo se
# nota días después. Leer el SQL no distingue "el operador de otro proyecto no
# debe recibirlo" de "no lo recibe porque la condición está mal": hay que
# ejecutarlo con un padrón real sentado en la tabla.
#
# QUÉ COMPRUEBA (24 invariantes)
#   · MENSAJES    a quién avisa cada dirección del hilo (cliente→staff,
#                 staff→cliente, nota interna, hilo asignado, discusión
#                 interna), que el autor nunca se avisa a sí mismo y que una
#                 ráfaga en el mismo hilo no repite la campanada.
#   · DIFUSIÓN    que el destinatario SIN email —el que hoy no se entera de
#                 nada— recibe el aviso in-app, y que no se duplica el correo
#                 que create-broadcast ya manda.
#   · SOLICITUDES que las CINCO tablas avisan al staff de su proyecto y que el
#                 trigger genérico aguanta las tres formas de columna de detalle.
#   · PORTAL      que una emergencia no se anuncia como una consulta.
#   · PAYLOAD     que toda fila in_app lleva lo que el dispatcher necesita
#                 (user_id/tipo/titulo/seccion) y que los `tipo` emitidos son
#                 los que el catálogo de la campana sabe clasificar.
#
# USO
#   supabase/tests/notificaciones_actividad/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGRACION="$RAIZ/supabase/migrations/20260819000000_notificaciones_actividad.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/notifdata.XXXX)
SOCK=$(mktemp -d /tmp/notifsock.XXXX)
PUERTO=${PGPORT_TEST:-55434}

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
psql -q -d postgres -c "CREATE DATABASE notifact" >/dev/null
# anon/authenticated no existen en un Postgres pelado; la migración les revoca
# permisos por nombre de rol.
psql -q -d notifact -c "CREATE ROLE anon; CREATE ROLE authenticated;" >/dev/null 2>&1 || true

echo "── 1/3 · fixture (padrón + tablas de origen + outbox) ──────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d notifact -f "$AQUI/fixture.sql" >/dev/null
echo "  OK    fixture cargado"

echo "── 2/3 · aplicar 20260819000000 ────────────────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d notifact -f "$MIGRACION" >/dev/null
echo "  OK    migración aplicada"

echo "── 3/3 · invariantes del fan-out ───────────────────────────────────────"
# Los triggers tragan sus errores con RAISE WARNING para no tumbar el INSERT de
# negocio: sin este filtro un fallo se vería como "0 avisos" y no como el bug
# que es. Se muestran y se cuentan aparte.
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d notifact -f "$AQUI/assert.sql" 2>&1)
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
if echo "$SALIDA" | grep -q 'WARNING:'; then
  echo
  echo "❌ algún trigger falló y se tragó el error:"
  echo "$SALIDA" | sed -n 's/.*WARNING:  /  ⚠ /p'
  exit 1
fi

echo
echo "── idempotencia (re-aplicar la migración) ──────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d notifact -f "$MIGRACION" >/dev/null
echo "  OK    la migración se puede volver a aplicar"

echo
echo "✅ 20260819000000: mensajes, difusiones y solicitudes avisan a quien toca"
echo "   (24 invariantes), migración idempotente."
