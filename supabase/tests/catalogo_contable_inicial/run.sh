#!/usr/bin/env bash
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/contacatdata.XXXX)
SOCK=$(mktemp -d /tmp/contacatsock.XXXX)
PUERTO=${PGPORT_TEST:-55448}

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
psql -q -d postgres -c "CREATE DATABASE catalogo_inicial" >/dev/null
psql -q -d catalogo_inicial -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d catalogo_inicial -f "$1" >/dev/null
}

echo "── 1/5 · esquema contable histórico"
aplicar "$RAIZ/scripts/conta-smoke/stubs.sql"
CONTA=(
  20260611000000_contabilidad_fase1_schema
  20260611000100_contabilidad_fase1_rpcs
  20260611000200_contabilidad_fase1_seed_y_triggers
  20260611010000_cxp_fase2_schema
  20260611010100_cxp_fase2_triggers_y_rpcs
  20260611020000_presupuesto_fase3
  20260611030000_bancos_fase4_schema
  20260611030100_bancos_fase4_rpcs
  20260611040000_eeff_fase5
  20260611050000_conta_revaluacion_fx
  20260611060000_presupuesto_control
  20260611070000_cxp_mejoras
  20260611080000_bancos_matching_difuso
  20260612000000_ledger_catalogo_por_proyecto
  20260612000100_ledger_moneda_y_folios
  20260612000200_ledger_asientos_reportes_y_migracion
  20260612010000_ledger_cierre_anual
  20260612010100_ledger_revaluacion_fx
  20260612010200_ledger_bancos
  20260612010300_ledger_presupuesto_cxp
  20260612020000_conta_consolidado
  20260813223000_conta_catalogo_ocho_niveles
  20260822000001_conta_cuentas_borrado
)
for f in "${CONTA[@]}"; do aplicar "$MIGS/$f.sql"; done

echo "── 2/6 · riel de compras y catálogo existente antes del cambio"
aplicar "$RAIZ/supabase/tests/compras_flujo/fixture.sql"
COMPRAS=(
  20260821000000_compras_proveedor_autorizado
  20260821000100_compras_ordenes_compra
  20260821000200_compras_recepciones
)
for f in "${COMPRAS[@]}"; do aplicar "$MIGS/$f.sql"; done
aplicar "$AQUI/fixture.sql"

echo "── 3/6 · contrato semántico de cuentas especiales"
aplicar "$MIGS/20260918121413_conta_cuentas_especiales_semanticas.sql"
aplicar "$MIGS/20260918151430_conta_estado_especiales_sin_fuga_cross_company.sql"

echo "── 4/6 · migración bajo prueba (dos veces)"
aplicar "$MIGS/20260924000200_catalogo_contable_inicial_configurable.sql"
aplicar "$MIGS/20260924000200_catalogo_contable_inicial_configurable.sql"

echo "── 5/6 · invariantes"
# El `|| {…}` es para poder IMPRIMIR el fallo: con `set -e`, un psql fallido
# dentro de `$(…)` abortaba el script con la salida todavía en la variable y
# la suite terminaba en silencio (exit 3), sin decir qué invariante ni por qué.
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d catalogo_inicial -f "$AQUI/assert.sql" 2>&1) || {
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
echo "── 6/6 · fin"
echo "✅ catálogo inicial configurable verificado"
