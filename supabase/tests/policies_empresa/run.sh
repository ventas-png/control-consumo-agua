#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE del cierre de la escritura cruzada en `empresa`
# (20260923000000 · #826 §3.3)
#
# POR QUÉ EXISTE
# Esta migración no agrega ni quita datos: cambia QUIÉN PUEDE HACER QUÉ. Eso no
# se comprueba leyendo el SQL ni contando policies — se comprueba intentando las
# operaciones con un usuario real que no debería poder hacerlas.
#
# LA FORMA DE LA PRUEBA: primero el fallo, después el arreglo.
#   1. Se monta el esquema tal como lo tiene PRODUCCIÓN: las cinco policies
#      —la única del repositorio más las cuatro que sólo viven allá— y los
#      grants por defecto de Supabase.
#   2. `antes.sql` DEMUESTRA el agujero: el admin de la empresa B modifica,
#      borra e inserta en la tabla que lee la empresa A. Si no lo encontrara,
#      FALLA — una prueba de seguridad que nunca vio el fallo no sabe
#      distinguir el arreglo de la suerte. Incluye un CONTROL previo: un
#      autenticado que NO es admin tampoco puede, para que quede claro que lo
#      que falla es la comprobación de EMPRESA y no la de rol.
#   3. Se aplica la migración.
#   4. `despues.sql` comprueba las DOS direcciones: que ese admin ya no pueda
#      nada, y que `useEmpresaQuery` —el único lector real— siga leyendo.
#      Cerrar de más también es un fallo.
#
# LAS DOS CAPAS. Se cierran policies Y grants, y se miden por separado: que las
# policies queden bien no dice nada sobre los grants, y era el grant lo que
# dejaba el arma cargada para la próxima policy permisiva.
#
# USO
#   supabase/tests/policies_empresa/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG="$RAIZ/supabase/migrations/20260923000000_empresa_cerrar_drift_policies_y_grants.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/pedata.XXXX)
SOCK=$(mktemp -d /tmp/pesock.XXXX)
PUERTO=${PGPORT_TEST:-55464}

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
psql -q -d postgres -c "CREATE DATABASE pe" >/dev/null
# Los tres roles TIENEN que existir: la migración comprueba sus privilegios con
# guardas de existencia, así que sin ellos la verificación pasaría vacía.
psql -q -d pe -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null

echo "── 1/4 · fixture: el esquema CON las cinco policies de producción ─────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d pe -f "$AQUI/fixture.sql" >/dev/null
echo "  OK    fixture cargado"

echo "── 2/4 · demostrar el agujero (debe encontrarlo) ──────────────────────"
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d pe -f "$AQUI/antes.sql" 2>&1) || {
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo
  echo "❌ el agujero NO se reprodujo — la prueba no probaría nada:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo
echo "── 3/4 · aplicar la migración ─────────────────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d pe -f "$MIG" >/dev/null
echo "  OK    $(basename "$MIG")"

echo
echo "── 4/4 · el agujero cerrado, sin cerrar de más ────────────────────────"
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d pe -f "$AQUI/despues.sql" 2>&1) || {
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
echo "── idempotencia: re-aplicar no cambia el resultado ────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d pe -f "$MIG" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d pe -c "
DO \$\$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='empresa';
  IF n <> 1 THEN RAISE EXCEPTION 're-aplicar dejó % policies en vez de 1', n; END IF;
  IF NOT has_table_privilege('authenticated','public.empresa','SELECT') THEN
    RAISE EXCEPTION 're-aplicar dejó a authenticated sin SELECT'; END IF;
  IF has_table_privilege('anon','public.empresa','SELECT') THEN
    RAISE EXCEPTION 're-aplicar le devolvió SELECT a anon'; END IF;
END \$\$;" >/dev/null
echo "  OK    la segunda pasada deja la misma policy y los mismos grants"

echo
echo "✅ policies_empresa: la escritura cruzada se reprodujo, la migración la"
echo "   cierra en sus dos capas, y el único lector real sigue leyendo."
