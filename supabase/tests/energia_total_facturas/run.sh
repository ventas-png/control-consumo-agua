#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261104090000_facturas_energia_total_del_desglose.
#
# POR QUÉ EXISTE
# La migración reescribe montos de facturas en producción. Que el SQL "se vea
# bien" no alcanza: hay que ver QUÉ facturas toca, con qué valores, que deja
# constancia de cada una y que su reversión documentada realmente revierte.
#
# QUÉ COMPRUEBA
#   1 · cada caso queda con el total de su desglose: capturada a mano (0),
#       crédito escrito en positivo, «otros» que el cálculo no sumaba, ajustada
#       tras calcular, crédito mayor que los cargos y centavos.
#   2 · no cambia nada más: ni el desglose, ni los kWh, ni updated_at; las ya
#       correctas, la de todo en cero y la de «solo total» (desglose en cero
#       con total) quedan intactas.
#   3 · una constancia en audit_log por factura corregida, y solo por ellas,
#       con el antes, el después, la empresa y el proyecto.
#   4 · idempotente: la segunda pasada no cambia ni registra nada.
#   5 · el bloque REVERSIÓN del encabezado de la migración —extraído del
#       archivo real, no copiado— devuelve los montos anteriores.
#   + los NOTICE informan cuántas corrigió y cuántas dejó por tener solo total.
#
# La migración no se copia: se aplica el archivo real del repo.
#
# USO
#   supabase/tests/energia_total_facturas/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un cluster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG="$RAIZ/supabase/migrations/20261104090000_facturas_energia_total_del_desglose.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }
[ -f "$MIG" ] || { echo "❌ no existe $MIG"; exit 1; }

# El socket unix tiene un tope de 107 bytes: ruta corta a propósito.
DATA=$(mktemp -d /tmp/energiadata.XXXX)
SOCK=$(mktemp -d /tmp/energiasock.XXXX)
REVERSA=$(mktemp /tmp/energiarev.XXXX.sql)
PUERTO=${PGPORT_TEST:-55583}

# El apagado se delega IGUAL que el arranque (`correr` se define más abajo; el
# trap la resuelve al salir): con `pg_ctl` a secas, como root falla en silencio
# y el cluster queda vivo ocupando el puerto.
limpiar() {
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK" "$REVERSA"
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
psql -q -d postgres -c "CREATE DATABASE energia" >/dev/null

# verifica <archivo> → corre un archivo de invariantes y muestra sus OK.
# Sin este `|| { … }`, `set -e` aborta con la salida de psql dentro de la
# sustitución y la consola no muestra NADA.
verifica() {
  local salida
  salida=$(psql -q -v ON_ERROR_STOP=1 -d energia -f "$1" 2>&1) || {
    echo "$salida" | sed -n 's/.*NOTICE:  /  /p'
    echo
    echo "❌ invariante incumplida:"
    echo "$salida" | sed -n 's/.*ERROR:  /  /p'
    exit 1
  }
  echo "$salida" | sed -n 's/.*NOTICE:  /  /p'
}

# aplica → corre la migración real y deja sus NOTICE en $AVISOS.
aplica() {
  AVISOS=$(psql -q -v ON_ERROR_STOP=1 -d energia -f "$MIG" 2>&1) || {
    echo "❌ la migración falló:"
    echo "$AVISOS"
    exit 1
  }
}

# avisa <descripción> <texto esperado en los NOTICE>
avisa() {
  if echo "$AVISOS" | grep -qF -- "$2"; then
    echo "  OK    $1"
  else
    echo "❌ $1 — no apareció «$2» en:"
    echo "$AVISOS" | sed -n 's/.*NOTICE:  /  /p'
    exit 1
  fi
}

echo "── 1/5 · fixture (una factura por caso, más una constancia de otra tabla) ─"
psql -q -v ON_ERROR_STOP=1 -d energia -f "$AQUI/fixture.sql" >/dev/null
echo "  OK    fixture cargado"

echo "── 2/5 · aplicar la migración ───────────────────────────────────────────"
aplica
avisa "informa las 6 corregidas" "facturas_energia: 6 factura(s) corregida(s)"
avisa "informa la que solo tiene total" "facturas_energia: 1 factura(s) tienen total pero ningún monto"

echo "── 3/5 · invariantes ────────────────────────────────────────────────────"
verifica "$AQUI/assert.sql"

echo "── 4/5 · idempotencia (segunda pasada) ──────────────────────────────────"
aplica
avisa "la segunda pasada no corrige nada" "facturas_energia: 0 factura(s) corregida(s)"
verifica "$AQUI/assert.sql"
echo "  OK 4  la segunda pasada no cambió montos ni dejó constancias nuevas"

echo "── 5/5 · reversión documentada ──────────────────────────────────────────"
# Lo que está entre los marcadores del encabezado, sin el prefijo de comentario.
sed -n '/^-- >>> REVERSIÓN$/,/^-- <<< REVERSIÓN$/p' "$MIG" | sed '1d;$d' | sed 's/^-- \{0,1\}//' >"$REVERSA"
grep -q 'UPDATE public.facturas_energia' "$REVERSA" || { echo "❌ no se encontró el bloque REVERSIÓN en la migración"; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d energia -f "$REVERSA" >/dev/null
verifica "$AQUI/revertido.sql"

echo
echo "✅ energia_total_facturas: el total pasa a ser el de su desglose (seis casos"
echo "   corregidos, cuatro intactos), con constancia en audit_log, idempotente y"
echo "   con una reversión que revierte."
