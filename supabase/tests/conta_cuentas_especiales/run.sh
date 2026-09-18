#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de las cuentas especiales del sistema
# (migración 20260918121413_conta_cuentas_especiales_semanticas).
#
# POR QUÉ EXISTE
# Lo que esta migración cambia no se ve leyendo el SQL: que el cierre anual ya
# NO dependa del código '3201' sólo se demuestra renombrando ese código y
# viendo que el cierre sigue funcionando. Y lo que debe seguir siendo cierto
# —que una contabilidad nunca tome la cuenta de otra— sólo se demuestra
# intentándolo y viendo el rechazo.
#
# QUÉ COMPRUEBA
#   · RESOLUCIÓN  el ledger de EMPRESA y el de PROYECTO resuelven cada uno
#                 contra SU catálogo, y ninguno ve el mapeo del otro
#   · AISLAMIENTO un mapeo hacia una cuenta de otro ledger se rechaza al
#                 escribirlo, y una fila heredada así no resuelve
#   · CALIDAD     cuenta inactiva y cuenta agrupadora no resuelven ni se
#                 pueden mapear
#   · AUSENCIA    sin mapeo → NULL, y `exigir` levanta CONTA_CONFIG_INCOMPLETA
#   · SIN CÓDIGOS cierre anual y revaluación FX funcionan con el catálogo
#                 RENOMBRADO a códigos que no son los del seed
#   · NO BLOQUEO  una recepción con destino activo fijo se registra aunque
#                 falte el mapeo del activo
#   · ACL         anon y authenticated no pueden ejecutar los helpers internos;
#                 authenticated sí las RPCs de lectura y de cierre
#
# USO
#   supabase/tests/conta_cuentas_especiales/run.sh
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
DATA=$(mktemp -d /tmp/espedata.XXXX)
SOCK=$(mktemp -d /tmp/espesock.XXXX)
PUERTO=${PGPORT_TEST:-55437}

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
psql -q -d postgres -c "CREATE DATABASE especiales" >/dev/null
# Los tres roles de Supabase: las migraciones les otorgan y revocan por nombre,
# y las aserciones de ACL comprueban a los tres (service_role incluido: saltarse
# la RLS no lo exime del GRANT de una función).
psql -q -d especiales -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;" >/dev/null 2>&1 || true

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d especiales -f "$1" >/dev/null
}

echo "── 1/5 · stubs del esquema de la app ───────────────────────────────────"
aplicar "$RAIZ/scripts/conta-smoke/stubs.sql"
echo "  OK    stubs cargados"

echo "── 2/5 · cadena contable real (fases 1-5 + ledger) ─────────────────────"
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
)
for f in "${CONTA[@]}"; do aplicar "$MIGS/$f.sql"; done
echo "  OK    ${#CONTA[@]} migraciones contables aplicadas"

echo "── 3/5 · fixture (tablas de compras + padrón) ──────────────────────────"
aplicar "$AQUI/../compras_flujo/fixture.sql"
COMPRAS=(
  20260821000000_compras_proveedor_autorizado
  20260821000100_compras_ordenes_compra
  20260821000200_compras_recepciones
  20260821000300_compras_factura_match
  20260821000400_compras_contrasenas_pago
)
for f in "${COMPRAS[@]}"; do aplicar "$MIGS/$f.sql"; done
echo "  OK    fixture + ${#COMPRAS[@]} migraciones de compras"

echo "── 4/5 · migración bajo prueba (dos veces: idempotencia) ───────────────"
ESPECIALES=(
  20260918121413_conta_cuentas_especiales_semanticas
  20260918151430_conta_estado_especiales_sin_fuga_cross_company
)
for f in "${ESPECIALES[@]}"; do aplicar "$MIGS/$f.sql"; done
for f in "${ESPECIALES[@]}"; do aplicar "$MIGS/$f.sql"; done
echo "  OK    ${#ESPECIALES[@]} migraciones aplicadas dos veces (idempotentes)"

echo "── 5/5 · invariantes ───────────────────────────────────────────────────"
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d especiales -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

if [ "$CODIGO" -ne 0 ]; then
  echo
  echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'
  exit 1
fi

# UN warning es la prueba misma: la aserción 41 borra el mapeo `activo_fijo` y
# recibe mercadería, así que el generador OMITE el asiento GR/IR con un aviso y
# la recepción se registra igual. Ése se espera y se exige; cualquier otro sigue
# siendo un trigger que se tragó un error.
ESPERADO='falta mapeo activo_fijo'
if ! echo "$SALIDA" | grep -q "$ESPERADO"; then
  echo
  echo "❌ falta el aviso esperado del caso no bloqueante ($ESPERADO)"
  exit 1
fi

INESPERADOS=$(echo "$SALIDA" | sed -n 's/.*WARNING:  /  /p' | grep -v "$ESPERADO" || true)
if [ -n "$INESPERADOS" ]; then
  echo
  echo "❌ algún trigger falló y se tragó el error:"
  echo "$INESPERADOS"
  exit 1
fi

echo
echo "✅ las cuentas especiales se resuelven por significado, acotadas al ledger"
