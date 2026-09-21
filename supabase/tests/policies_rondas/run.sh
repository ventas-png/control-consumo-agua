#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE del cierre del bypass de RLS en rondas (20260922000000)
#
# POR QUÉ EXISTE
# Esta migración no agrega ni quita datos: cambia QUIÉN PUEDE HACER QUÉ. Eso no
# se comprueba leyendo el SQL ni contando policies — se comprueba intentando las
# operaciones con un usuario real que no debería poder hacerlas.
#
# LA FORMA DE LA PRUEBA: primero el fallo, después el arreglo.
#   1. Se monta el esquema tal como lo describía el repositorio —las 4 policies
#      de RBAC conviviendo con las 2 legadas de 20260424000059.
#   2. `antes.sql` DEMUESTRA el agujero: un operador SIN
#      `condominios.tab.rutas_ronda` lee, edita, inserta y borra. Si esa parte
#      no encontrara el agujero, FALLA — una prueba de seguridad que nunca vio
#      el fallo no sabe distinguir el arreglo de la suerte.
#   3. Se aplica la migración.
#   4. `despues.sql` comprueba las DOS direcciones: que ese mismo usuario ya no
#      pueda nada, y que quien sí tiene permiso siga trabajando. Cerrar de más
#      también es un fallo.
#
# LA MATRIZ (3 usuarios de la misma empresa)
#   operativo  sin permiso                → nada, en ninguna de las dos tablas
#   encargado  con permiso, no dueño      → lee, edita e inserta; NO borra
#   dueña      con permiso, company_owner → además borra
#
# USO
#   supabase/tests/policies_rondas/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG="$RAIZ/supabase/migrations/20260922000000_retirar_policies_legadas_rondas.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/prdata.XXXX)
SOCK=$(mktemp -d /tmp/prsock.XXXX)
PUERTO=${PGPORT_TEST:-55463}

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
psql -q -d postgres -c "CREATE DATABASE pr" >/dev/null
psql -q -d pr -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

echo "── 1/4 · fixture: el esquema CON las policies legadas ─────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d pr -f "$AQUI/fixture.sql" >/dev/null
echo "  OK    fixture cargado"

echo "── 2/4 · demostrar el agujero (debe encontrarlo) ──────────────────────"
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d pr -f "$AQUI/antes.sql" 2>&1) || {
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo
  echo "❌ el agujero NO se reprodujo — la prueba no probaría nada:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo
echo "── 3/4 · aplicar la migración ─────────────────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d pr -f "$MIG" >/dev/null
echo "  OK    $(basename "$MIG")"

echo
echo "── 4/4 · el agujero cerrado, sin cerrar de más ────────────────────────"
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d pr -f "$AQUI/despues.sql" 2>&1) || {
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
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d pr -f "$MIG" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d pr -c "
DO \$\$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename IN ('puntos_control_ruta','visitas_control');
  IF n <> 8 THEN RAISE EXCEPTION 're-aplicar dejó % policies en vez de 8', n; END IF;
END \$\$;" >/dev/null
echo "  OK    la segunda pasada deja las mismas 8 policies (4 por tabla)"

echo
echo "✅ policies_rondas: el bypass se reprodujo, la migración lo cierra, y"
echo "   quien tiene permiso sigue trabajando. Migración idempotente."
