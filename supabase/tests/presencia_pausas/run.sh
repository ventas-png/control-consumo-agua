#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260908000300: las pausas de la jornada.
#
# POR QUÉ EXISTE
# Estos minutos SE RESTAN DE LO QUE SE PAGA, y las garantías que lo hacen
# aceptable no se ven leyendo el SQL:
#
#   · Que la hora NO sea nunca un parámetro. En el marcaje la foto sirve de
#     ancla; en una pausa no hay foto, así que lo único que separa el dato de un
#     campo de texto es que los dos instantes los ponga el servidor.
#   · Que la regla de planilla quede CONGELADA en la fila. Si cambiar el
#     catálogo reescribiera las pausas viejas, un clic cambiaría una planilla ya
#     pagada. La invariante 8 lo mide antes y después.
#   · Que la pausa huérfana no exista. Quien olvida marcar el regreso no puede
#     quedarse con una pausa abierta para siempre — ni con la salida bloqueada.
#   · Que las NOCTURNAS bajen con la parte de la pausa que cayó en la franja.
#     Si no, se arregla una asimetría creando otra: el recargo de noche pagado
#     sobre la cena que se acaba de descontar (invariante 19).
#
# QUÉ COMPRUEBA (25 invariantes)
#   1-6    pausar exige jornada abierta y un tipo del catálogo, una pausa a la
#          vez, y sella la duración desde los dos instantes
#   7-9    la regla se copia del catálogo, se congela, y el catálogo cae a los
#          defaults mientras la empresa no configure los suyos
#   10-12  el cómputo separa estadía, descanso y laborales; lo que no descuenta
#          se mide sin restar; anular devuelve las horas sin borrar la pausa
#   13-16  ajustar corrige la duración con motivo y huella, anular exige
#          `.delete`, y la pausa que nadie marcó se puede agregar sin inventarle
#          una hora
#   17-18  la pausa abierta se cierra al cerrar la jornada, por la RPC y por el
#          UPDATE llano del tab
#   19-20  el recargo nocturno baja con ella, y una pausa que cruza la
#          medianoche son 40 minutos y no 24 horas (#839)
#   21     el turno nocturno puede cerrarse y pausarse desde el día siguiente
#   22-25  el ciclo completo como `authenticated`, la tabla cerrada a la
#          escritura directa, la ACL, y la bitácora inscrita
#
# USO
#   supabase/tests/presencia_pausas/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGRACION_1="$RAIZ/supabase/migrations/20260908000000_presencia_marcaje_autoservicio.sql"
MIGRACION_2="$RAIZ/supabase/migrations/20260908000200_presencia_correccion_y_anulacion.sql"
# La nueva redeclara presencia_mi_ficha y calcular_horas_personal, que las dos
# anteriores dejan en su versión previa: van en orden, como en producción.
MIGRACION_3="$RAIZ/supabase/migrations/20260908000300_presencia_pausas.sql"

# Los binarios no siempre están en PATH (en Debian/Ubuntu viven versionados).
for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: se usa una ruta corta a propósito.
DATA=$(mktemp -d /tmp/pausdata.XXXX)
SOCK=$(mktemp -d /tmp/paussock.XXXX)
PUERTO=${PGPORT_TEST:-55447}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

limpiar() {
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK"
}
trap limpiar EXIT

if [ -n "$COMO" ]; then chown -R postgres "$DATA" "$SOCK"; fi

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE DATABASE pausas" >/dev/null
# anon/authenticated no existen en un Postgres pelado; la migración les revoca y
# otorga privilegios por nombre de rol, y las policies se ejercen como
# authenticated (que por eso necesita los grants de tabla).
psql -q -d pausas -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d pausas -f "$1" >/dev/null
}

echo "── 1/3 · fixture: esquema, cuentas y expedientes ───────────────────────"
aplicar "$AQUI/fixture.sql"
psql -q -d pausas -c "
  GRANT USAGE ON SCHEMA public, auth, storage TO authenticated, anon;
  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
  GRANT SELECT ON storage.buckets, public.app_users, public.projects,
                  public.personal_condominio, public.presencia_personal TO authenticated;
" >/dev/null
echo "  OK    stubs + 6 cuentas + 2 condominios + 5 expedientes"

echo "── 2/3 · las migraciones (la nueva, DOS veces: idempotente) ───────────"
# Las dos anteriores se aplican UNA vez, como en producción: ya están
# desplegadas, y sus `CREATE OR REPLACE` de presencia_mi_ficha declaran menos
# columnas OUT que la nueva — re-aplicarlas DESPUÉS fallaría, y ese fallo sería
# del harness, no del cambio. La que tiene que ser idempotente es la NUEVA.
aplicar "$MIGRACION_1"
aplicar "$MIGRACION_2"
for _ in 1 2; do aplicar "$MIGRACION_3"; done
# Los grants de TABLA de las dos tablas nuevas van aquí porque antes no existen.
# La invariante 23 comprueba que un cliente no pueda escribir presencia_pausas;
# para que eso pruebe la AUSENCIA DE POLICY y no la falta de un grant,
# authenticated recibe los mismos privilegios que le da Supabase por defecto.
psql -q -d pausas -c "
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.presencia_pausas,
        public.presencia_tipos_pausa TO authenticated;
" >/dev/null
echo "  OK    re-aplicar la migración nueva no falla"

echo "── 3/3 · invariantes ───────────────────────────────────────────────────"
# `|| CODIGO=$?` en vez de dejar que `set -e` mate el script: si psql falla y no
# se captura, el harness muere ANTES de imprimir nada y el fallo se ve como una
# salida vacía.
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d pausas -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

if [ "$CODIGO" -ne 0 ]; then
  echo
  echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
fi

echo
echo "✅ presencia_pausas: los dos instantes los pone el servidor, la regla de planilla queda congelada en la fila, y el cómputo separa estadía, descanso y horas laborales —nocturnas incluidas."
