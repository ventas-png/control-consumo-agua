#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260910235732: el `UPDATE` de `registros` deja de
# ser una puerta abierta al importe.
#
# POR QUÉ EXISTE
# 20260910000200 movió al servidor la CREACIÓN de la lectura, pero su trigger es
# BEFORE **INSERT**. La policy `registros_update` autoriza por FILA, no mira ni
# una columna y no tiene `WITH CHECK`, así que lo que no se podía escribir al
# crear se podía escribir un milisegundo después con un PATCH. Esto NO se ve
# leyendo el SQL: hay que ejercerlo.
#
# Por eso la prueba empieza DEMOSTRANDO el agujero: desactiva el trigger nuevo,
# hace el PATCH COMO `authenticated` con la RLS puesta, y comprueba que la fila
# queda en consumo 0, monto 0, "pagado" con 999999 abonados y en otro proyecto.
# Después lo reactiva y comprueba que el mismo PATCH se rechaza. Si algún día el
# agujero dejara de reproducirse, la invariante 1 falla y avisa de que la
# demostración —y con ella el motivo de esta migración— ya no aplica.
#
# QUÉ COMPRUEBA (43 invariantes)
#    1-2   el agujero ejercido, y cerrado
#    3-6   el guard por grupos: 18 columnas de la lectura y 16 del cobro son
#          inmutables por UPDATE; notas, foto, gps y el borrado lógico no
#    7-12  el camino autorizado: emitir (IVA y vencimiento calculados en el
#          servidor), la máquina de estados, pagar (parcial y liquidación),
#          anular, mora, el "pagado" a mano rechazado, y la auditoría
#   13-15  sin permiso de cobro, otro tenant, y la ACL (incluido que la
#          auditoría no se fabrica desde fuera de una RPC)
#    16    la excepción de `service_role`, enumerada
#   17-21  el reporte: la cuenta de campo y el residente NO lo ven aunque pasen
#          el predicado viejo; con permiso se ven sólo los proyectos permitidos
#    22    emitir y cobrar ejercido COMO `authenticated`
#   23-25  la exención de `postgres` cerrada: una función SECURITY DEFINER
#          invocable por `authenticated` NO puede fabricar el cobro, y la
#          capacidad por función (ALTER FUNCTION … SET) sí deja pasar a los dos
#          caminos de sistema enumerados — y sólo a ellos
#   26-27  CONCURRENCIA REAL con dos conexiones: dos abonos sobre la misma
#          factura se serializan, se contabilizan los dos y no se pasan del
#          saldo; y dos emisiones simultáneas no emiten dos veces
#   28-30  las carreras pagar/anular, pagar/mora y el estado a mano sobre una
#          factura ya pagada
#   31-33  la ÚNICA excepción de rol que queda —`service_role`, para acreditar
#          lo que el payfac ya cobró—: revocada de `authenticated`, cerrada
#          también a una SECURITY DEFINER suya, y sumando bien cuando es quien
#          debe quien la llama
#   34-39  la conciliación del payfac en UNA transacción: dos confirmaciones
#          CONCURRENTES de la misma solicitud dejan un pago y una acreditación;
#          un fallo provocado entre el INSERT y la acreditación revierte TODO y
#          el reintento cuadra; dos solicitudes distintas del mismo recibo suman
#          los dos abonos; repetir una ya conciliada es no-op; y ni
#          `authenticated` ni una DEFINER suya la alcanzan
#   40-43  `agua_cobro_auditar` como helper INTERNO: ningún rol de API lo
#          ejecuta; con la llave de capacidad ENCENDIDA la llamada directa
#          sigue negada (lo que para es la ACL, no el GUC); las seis
#          transiciones siguen escribiendo su auditoría por el camino
#          autorizado; y la capacidad no sobrevive a la RPC ni en éxito ni
#          en error
#
# USO
#   supabase/tests/proteger_update_registros/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG_DIR="$RAIZ/supabase/migrations"
MIG_RPC="$MIG_DIR/20260910000200_registrar_lectura_autoritativa.sql"
MIG_REP="$MIG_DIR/20260910000300_reporte_inconsistencias_lecturas.sql"
MIG_UPD="$MIG_DIR/20260910235732_proteger_update_registros_y_cobro_autoritativo.sql"
MIG_SER="$MIG_DIR/20260911031701_cerrar_exencion_definer_y_serializar_cobro.sql"
MIG_CON="$MIG_DIR/20260911042839_conciliar_pago_externo_transaccional.sql"
MIG_AUD="$MIG_DIR/20260911181200_revocar_execute_agua_cobro_auditar.sql"
# El padrón de agua es el del otro harness: una sola fuente de verdad.
FIXTURE="$RAIZ/supabase/tests/registrar_lectura/fixture.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/updata.XXXX)
SOCK=$(mktemp -d /tmp/upsock.XXXX)
PUERTO=${PGPORT_TEST:-55496}

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
psql -q -d postgres -c "CREATE DATABASE registros" >/dev/null
# Los tres roles de la Data API. `service_role` con BYPASSRLS, como en Supabase:
# es lo que hace significativa la invariante 16.
psql -q -d registros -c "
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE ROLE service_role BYPASSRLS;
" >/dev/null
# La invariante de concurrencia necesita una SEGUNDA conexión de verdad: dos
# abonos que se pisan no se reproducen dentro de una sola sesión.
psql -q -d registros -c "CREATE EXTENSION IF NOT EXISTS dblink SCHEMA public" >/dev/null || {
  echo "❌ falta el módulo dblink: la invariante de concurrencia no se puede ejercer"; exit 1; }

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d registros -f "$1" >/dev/null
}

echo "── 1/3 · fixture: padrón de agua compartido + policy real de UPDATE ────"
aplicar "$FIXTURE"
aplicar "$AQUI/fixture-extra.sql"
psql -q -d registros -c "
  GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.registros TO authenticated, service_role;
  GRANT SELECT, INSERT, UPDATE ON public.payment_requests, public.pagos,
                                  public.cuotas_condominio TO authenticated, service_role;
  GRANT SELECT ON public.contadores, public.tarifas, public.unidades, public.clientes,
                  public.projects, public.companies, public.app_users,
                  public.user_project_assignments, public.test_permisos,
                  public.reglas_mora_config TO authenticated, service_role;
" >/dev/null
echo "  OK    2 empresas · 3 proyectos · 7 cuentas · 7 contadores · IVA 12% · mora a 15 días"

echo "── 2/3 · las cinco migraciones, aplicadas DOS veces (idempotentes) ─────"
for _ in 1 2; do aplicar "$MIG_RPC"; aplicar "$MIG_REP"; aplicar "$MIG_UPD"; aplicar "$MIG_SER"; aplicar "$MIG_CON"; aplicar "$MIG_AUD"; done
echo "  OK    re-aplicar no falla"

echo "── 3/3 · invariantes ───────────────────────────────────────────────────"
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d registros \
  -v conn="dbname=registros host=$SOCK port=$PUERTO user=postgres" \
  -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

if [ "$CODIGO" -ne 0 ]; then
  echo
  echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
fi

echo
echo "✅ el UPDATE ya no fabrica un cobro: ninguna SECURITY DEFINER lo elude, las transiciones financieras se serializan por registro, y el reporte exige permiso de lectura."
