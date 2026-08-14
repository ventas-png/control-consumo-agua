#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de la Fase 7 (migraciones 20260823*): un hecho
# económico, un solo asiento.
#
# POR QUÉ EXISTE
# El bug que esta fase cierra es INVISIBLE: dos asientos correctos, cuadrados,
# cada uno idempotente por su lado, que juntos cuentan el mismo desembolso dos
# veces. Ningún estado financiero se descuadra; simplemente el gasto sale más
# alto de lo que fue. Leer el SQL no basta para saber si el corte funciona,
# porque el corte depende de condiciones sobre OLD/NEW que solo existen mientras
# el trigger corre, y de una clave única cuyo comportamiento al reversar es
# justo lo que hace difícil el caso.
#
# Y hay un riesgo de vuelta: `conta_tg_gastos` llevaba intacta desde junio y por
# ella pasan TODOS los gastos del sistema. Romperla en silencio costaría más que
# el duplicado que se viene a arreglar. Por eso la última sección no prueba nada
# nuevo: prueba que lo viejo sigue igual.
#
# QUÉ COMPRUEBA (33 invariantes)
#   · HISTÓRICO    que el backfill de proveedor_id no deja huérfanos, y que el
#                  escenario REPRODUCE el doble conteo antes de corregirlo
#   · ENLACE       que enlazar corta el duplicado, que un gasto ya contabilizado
#                  exige anularse, y que DESENLAZAR vuelve a contabilizar
#   · COHERENCIA   otro ledger, otro proveedor, factura anulada o inexistente
#   · DETECCIÓN    que encuentra el par real y que NO marca los dos falsos
#                  positivos que matan estos reportes
#   · DESCARTE     que lo revisado no reaparece
#   · AVISO        que la captura advierte con el nombre de la factura
#   · NO-REGRESIÓN que el gasto sin factura asienta, reversa al anular y reversa
#                  al borrar, exactamente como antes
#
# USO
#   supabase/tests/gastos_duplicados/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/dupdata.XXXX)
SOCK=$(mktemp -d /tmp/dupsock.XXXX)
PUERTO=${PGPORT_TEST:-55437}

# Postgres se niega a correr como root; si lo somos, se delega en `postgres`.
COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

# El apagado se delega IGUAL que el arranque: con `pg_ctl` a secas, como root
# falla en silencio y el cluster queda vivo ocupando el puerto, de modo que la
# corrida siguiente muere con "could not start server" y parece un fallo del
# harness cuando es basura de la anterior.
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
psql -q -d postgres -c "CREATE DATABASE duplicados" >/dev/null
# anon/authenticated no existen en un Postgres pelado; las migraciones les
# otorgan y revocan permisos por nombre de rol.
psql -q -d duplicados -c "CREATE ROLE anon; CREATE ROLE authenticated;" >/dev/null 2>&1 || true

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d duplicados -f "$1" >/dev/null
}

echo "── 1/6 · stubs del esquema de la app ───────────────────────────────────"
aplicar "$RAIZ/scripts/conta-smoke/stubs.sql"
echo "  OK    stubs cargados"

echo "── 2/6 · cadena contable real (fases 1-5 + ledger) ─────────────────────"
# Misma lista explícita y ordenada que el harness de compras: el rango
# 20260611*–20260612020000 es la contabilidad, y lo que viene después en esa
# fecha es de otros módulos.
for f in \
  20260611000000_contabilidad_fase1_schema \
  20260611000100_contabilidad_fase1_rpcs \
  20260611000200_contabilidad_fase1_seed_y_triggers \
  20260611010000_cxp_fase2_schema \
  20260611010100_cxp_fase2_triggers_y_rpcs \
  20260611020000_presupuesto_fase3 \
  20260611030000_bancos_fase4_schema \
  20260611030100_bancos_fase4_rpcs \
  20260611040000_eeff_fase5 \
  20260611050000_conta_revaluacion_fx \
  20260611060000_presupuesto_control \
  20260611070000_cxp_mejoras \
  20260611080000_bancos_matching_difuso \
  20260612000000_ledger_catalogo_por_proyecto \
  20260612000100_ledger_moneda_y_folios \
  20260612000200_ledger_asientos_reportes_y_migracion \
  20260612010000_ledger_cierre_anual \
  20260612010100_ledger_revaluacion_fx \
  20260612010200_ledger_bancos \
  20260612010300_ledger_presupuesto_cxp \
  20260612020000_conta_consolidado
do
  aplicar "$MIGS/$f.sql"
done
echo "  OK    21 migraciones contables aplicadas"

echo "── 3/6 · fixture ──────────────────────────────────────────────────────"
# El de compras se REUTILIZA en vez de copiarse: la Fase 7 se apoya sobre el
# riel de la Fase 6 (usa `compras_tolerancia`, y las migraciones de compras
# evolucionan las mismas tablas de condominios), así que necesita exactamente el
# mismo mundo de partida. Duplicarlo sería garantizar que las dos copias se
# separen en el primer cambio.
aplicar "$AQUI/../compras_flujo/fixture.sql"
aplicar "$AQUI/fixture.sql"
echo "  OK    fixture de compras + gastos duplicados históricos"

echo "── 4/6 · migraciones de compras (Fase 6) ───────────────────────────────"
COMPRAS=(
  20260821000000_compras_proveedor_autorizado
  20260821000100_compras_ordenes_compra
  20260821000200_compras_recepciones
  20260821000300_compras_factura_match
  20260821000400_compras_contrasenas_pago
)
for f in "${COMPRAS[@]}"; do aplicar "$MIGS/$f.sql"; done
echo "  OK    ${#COMPRAS[@]} migraciones de compras aplicadas"

echo "── 5/6 · migraciones de la Fase 7 ──────────────────────────────────────"
FASE7=(
  20260823000000_gastos_enlace_factura
  20260823000100_gastos_duplicados_deteccion
)
for f in "${FASE7[@]}"; do aplicar "$MIGS/$f.sql"; done
# Segunda pasada: si alguna no fuera idempotente, aquí revienta. Las migraciones
# se re-aplican de verdad en reconciliaciones y en preview branches.
for f in "${FASE7[@]}"; do aplicar "$MIGS/$f.sql"; done
echo "  OK    ${#FASE7[@]} migraciones aplicadas dos veces (idempotentes)"

echo "── 6/6 · invariantes ───────────────────────────────────────────────────"
# Los triggers contables se tragan sus errores con RAISE WARNING para no tumbar
# la operación de negocio: sin este filtro, un asiento que nunca se generó se
# vería como "saldo 0" —que es justo lo que alguna aserción espera— y no como el
# fallo que es. Se muestran y se cuentan aparte.
#
# `|| CODIGO=$?` en vez de dejar que `set -e` mate el script: si psql falla y no
# se captura, el harness muere ANTES de imprimir nada y el fallo se ve como una
# salida vacía.
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d duplicados -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

if [ "$CODIGO" -ne 0 ]; then
  echo
  echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
fi

if echo "$SALIDA" | grep -q 'WARNING:'; then
  echo
  echo "❌ algún trigger falló y se tragó el error:"
  echo "$SALIDA" | sed -n 's/.*WARNING:  /  /p'
  exit 1
fi

echo
echo "✅ un hecho económico deja un solo asiento, y el gasto sin factura sigue igual"
