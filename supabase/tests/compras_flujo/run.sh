#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE del riel de compras (Fase 6, migraciones 20260821*).
#
# POR QUÉ EXISTE
# Este riel se apoya casi entero en triggers de Postgres: el candado del
# proveedor autorizado, el asiento GR/IR de la recepción, el movimiento de
# existencias, el alta de activos, el cuadre de 3 vías y el reparto de un pago
# entre varias facturas. Ninguno de esos se ve en la pantalla hasta que ya pasó,
# y sus fallos son del tipo que no da error: un asiento descuadrado, un stock
# que miente, una cuenta puente que nunca cierra, un pago aplicado dos veces.
# Leer el SQL no distingue "la regla está bien escrita" de "la regla nunca se
# dispara"; hay que ejecutarlo con documentos reales encima.
#
# QUÉ COMPRUEBA (59 invariantes)
#   · BACKFILL     que la orden vieja de texto libre engancha con el catálogo y
#                  que el proveedor así creado NO nace autorizado
#   · CANDADO      que sin proveedor autorizado —o con la autorización vencida—
#                  no se aprueba una orden
#   · ORDEN        totales desde las líneas, correlativo POR contabilidad,
#                  inmutabilidad tras aprobar, y que NO genera asiento
#   · RECEPCIÓN    asiento GR/IR cuadrado contra 2105, inventario con costo
#                  promedio, alta de activos, corte por sobre-recepción, y que
#                  un UPDATE directo al stock se ignora
#   · FACTURA      cuadre de 3 vías, rechazo fuera de tolerancia, aprobación con
#                  justificación, 2105 cerrando en cero, la variación de precio
#                  al gasto (no capitalizada) y el gasto sin contarse dos veces
#   · CONTRASEÑA   agrupa N facturas y UNA orden las cancela todas
#   · REVERSOS     anular deshace exactamente lo que hizo, ni más ni menos
#   · LEDGER       una empresa nueva nace sembrada y su correlativo arranca en 1
#
# USO
#   supabase/tests/compras_flujo/run.sh
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
DATA=$(mktemp -d /tmp/compradata.XXXX)
SOCK=$(mktemp -d /tmp/comprasock.XXXX)
PUERTO=${PGPORT_TEST:-55436}

# Postgres se niega a correr como root; si lo somos, se delega en `postgres`.
COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

# El apagado tiene que delegarse IGUAL que el arranque. Con `pg_ctl` a secas,
# como root falla en silencio (`|| true`) y el cluster queda vivo ocupando el
# puerto: la siguiente corrida muere con "could not start server" y parece un
# fallo del harness cuando es basura de la anterior.
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
psql -q -d postgres -c "CREATE DATABASE compras" >/dev/null
# anon/authenticated no existen en un Postgres pelado; las migraciones les
# otorgan y revocan permisos por nombre de rol.
psql -q -d compras -c "CREATE ROLE anon; CREATE ROLE authenticated;" >/dev/null 2>&1 || true

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d compras -f "$1" >/dev/null
}

echo "── 1/5 · stubs del esquema de la app ───────────────────────────────────"
aplicar "$RAIZ/scripts/conta-smoke/stubs.sql"
echo "  OK    stubs cargados"

echo "── 2/5 · cadena contable real (fases 1-5 + ledger) ─────────────────────"
# Lista explícita y ordenada: el rango 20260611*–20260612020000 es la
# contabilidad. Lo que viene después en esa fecha (roles, ciclo de vida de
# empresas) es de otros módulos y no hace falta para este riel — meterlo por un
# glob perezoso rompería el harness cada vez que se agregue una migración ahí.
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

echo "── 3/5 · fixture (tablas de condominios + padrón) ──────────────────────"
aplicar "$AQUI/fixture.sql"
echo "  OK    fixture cargado"

echo "── 4/5 · migraciones de compras ────────────────────────────────────────"
# Lista explícita, NO un glob por fecha: `20260820*` llegó a arrastrar las
# migraciones de turnos que main mergeó el mismo día. Un harness que aplica de
# más falla por algo que no está probando, y uno que aplica de menos pasa sin
# probar nada.
COMPRAS=(
  20260821000000_compras_proveedor_autorizado
  20260821000100_compras_ordenes_compra
  20260821000200_compras_recepciones
  20260821000300_compras_factura_match
  20260821000400_compras_contrasenas_pago
)
for f in "${COMPRAS[@]}"; do aplicar "$MIGS/$f.sql"; done
# Segunda pasada: si alguna no fuera idempotente, aquí revienta. Las migraciones
# se re-aplican de verdad en reconciliaciones y en preview branches.
for f in "${COMPRAS[@]}"; do aplicar "$MIGS/$f.sql"; done
echo "  OK    ${#COMPRAS[@]} migraciones aplicadas dos veces (idempotentes)"

echo "── 5/5 · invariantes del riel ──────────────────────────────────────────"
# Los triggers contables se tragan sus errores con RAISE WARNING para no tumbar
# la operación de negocio: sin este filtro, un asiento que nunca se generó se
# vería como "saldo 0" —que es justo lo que la aserción espera en algunos
# casos— y no como el fallo que es. Se muestran y se cuentan aparte.
#
# `|| CODIGO=$?` en vez de dejar que `set -e` mate el script: si psql falla y no
# se captura, el harness muere ANTES de imprimir nada y el fallo se ve como una
# salida vacía — que es exactamente lo inútil que un test no debe ser.
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d compras -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
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
echo "✅ el riel completo (proveedor → orden → recepción → factura → contraseña → pago) se comporta"
