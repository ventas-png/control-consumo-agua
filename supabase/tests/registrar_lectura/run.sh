#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260910000001 + 20260910000101: la lectura de
# agua deja de ser un dato que el navegador declara.
#
# POR QUÉ EXISTE
# Casi nada de lo que importa aquí se ve leyendo el SQL:
#
#   · Que el IMPORTE no sea un parámetro. La prueba manda un INSERT con
#     `consumo 0`, `monto 0`, `estado 'pagado'` y el proyecto de otro
#     condominio, y comprueba que la fila que queda escrita dice otra cosa.
#   · Que el ENCADENADO sea determinista. Tres lecturas del mismo contador el
#     mismo día tienen la misma `fecha`: es el empate que el cliente resolvía
#     al azar. Se exige que la segunda encadene contra la primera y la tercera
#     contra la segunda, siempre.
#   · Que el BLOQUEO exista de verdad. Se ejerce con DOS conexiones (dblink)
#     sobre un contador SIN lecturas, que es donde un lock de fila no tendría
#     nada que bloquear y dos "primeras lecturas" simultáneas se colarían.
#   · Que quien CAPTURA SIN PODER LEER la tabla obtenga igual la lectura
#     anterior correcta. Es el motivo entero de que agua_lectura_contexto sea
#     SECURITY DEFINER: con los privilegios del invocante vería cero filas,
#     concluiría "primera lectura" y facturaría de menos, en silencio.
#   · Que el CÁLCULO dé lo mismo que el de TypeScript. Los 17 casos de
#     paridad-casos.json los ejercen las dos implementaciones, y los números
#     esperados están escritos a mano en el fichero: si ambas se equivocaran
#     igual, seguiría fallando.
#
# QUÉ COMPRUEBA (38 invariantes)
#   1-3    el servidor resuelve consumo, tarifa, canon, importe, proyecto,
#          cliente, estado inicial y fecha
#   4-6    varias lecturas el mismo día se encadenan con orden total
#   7-9    replay del outbox: idempotente; el duplicado real, 23505
#   10-13  el reset de medidor: consumo real, motivo obligatorio y sus límites
#   14-15  la retroactiva y la del futuro se rechazan
#   16-17  la lectura borrada no encadena, y su llave no se resucita
#   18-21  cruce de empresa, de proyecto, cuenta sin acceso, contador inactivo
#   22-24  la tarifa sale de la base, tiene que estar vigente, y la escalonada
#   25-27  el payload que falsifica el importe: por la RPC no cabe, y por el
#          INSERT directo se recalcula
#   28     quien captura sin poder leer la tabla
#   29-30  la foto ajena y el GPS imposible
#   31     concurrencia real con dos conexiones
#   32     paridad TypeScript ↔ SQL sobre el mismo fichero de casos
#   33-35  el reporte de inconsistencias ve, no toca, y está acotado
#   36-38  la ACL y el camino ejercido COMO `authenticated`
#
# USO
#   supabase/tests/registrar_lectura/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql) y el módulo `dblink`
# (viene en el paquete del servidor). No toca ningún proyecto remoto: levanta
# un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG_RPC="$RAIZ/supabase/migrations/20260910000001_registrar_lectura_autoritativa.sql"
MIG_REP="$RAIZ/supabase/migrations/20260910000101_reporte_inconsistencias_lecturas.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: se usa una ruta corta a propósito.
DATA=$(mktemp -d /tmp/lectdata.XXXX)
SOCK=$(mktemp -d /tmp/lectsock.XXXX)
PUERTO=${PGPORT_TEST:-55443}

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
psql -q -d postgres -c "CREATE DATABASE lecturas" >/dev/null
# anon/authenticated no existen en un Postgres pelado; las migraciones les
# revocan y otorgan privilegios por nombre de rol, y la policy se ejerce COMO
# authenticated (que por eso necesita los grants de tabla).
psql -q -d lecturas -c "CREATE ROLE anon; CREATE ROLE authenticated;" >/dev/null 2>&1 || true
psql -q -d lecturas -c "CREATE EXTENSION IF NOT EXISTS dblink SCHEMA public" >/dev/null || {
  echo "❌ falta el módulo dblink: la invariante de concurrencia no se puede ejercer"; exit 1; }

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d lecturas -f "$1" >/dev/null
}

echo "── 1/3 · fixture: tenancy, padrón de agua, RLS real de registros ───────"
aplicar "$AQUI/fixture.sql"
psql -q -d lecturas -c "
  GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
  GRANT SELECT, INSERT, UPDATE ON public.registros TO authenticated;
  GRANT SELECT ON public.contadores, public.tarifas, public.unidades, public.clientes,
                  public.projects, public.companies, public.app_users,
                  public.user_project_assignments, public.test_permisos TO authenticated;
" >/dev/null
echo "  OK    2 empresas · 3 proyectos · 5 cuentas · 7 contadores · 4 tarifas"

echo "── 2/3 · las dos migraciones, aplicadas DOS veces (idempotentes) ───────"
for _ in 1 2; do aplicar "$MIG_RPC"; aplicar "$MIG_REP"; done
echo "  OK    re-aplicar no falla"

echo "── 3/3 · invariantes ───────────────────────────────────────────────────"
# `|| CODIGO=$?` en vez de dejar que `set -e` mate el script: si psql falla y no
# se captura, el harness muere ANTES de imprimir nada y el fallo se ve como una
# salida vacía.
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d lecturas \
  -v conn="dbname=lecturas host=$SOCK port=$PUERTO user=postgres" \
  -v casos="$(cat "$AQUI/paridad-casos.json")" \
  -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

if [ "$CODIGO" -ne 0 ]; then
  echo
  echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
fi

echo
echo "✅ registrar_lectura: el importe no es un parámetro, el encadenado es determinista, el bloqueo existe y el INSERT directo pasa por el mismo motor."
