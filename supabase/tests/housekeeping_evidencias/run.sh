#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20261028000000_housekeeping_evidencias.
#
# POR QUÉ EXISTE
# El valor de esta migración es lo que RECHAZA (otro proyecto, otra empresa, una ruta
# fabricada, borrar con el cliente) y lo que NO pierde (los textos tras la purga, un
# archivo que quedó sin fila). Nada de eso se comprueba leyendo el SQL: se intenta, como
# cada persona, contra un PostgreSQL de verdad.
#
# QUÉ HACE
#   1 · fixture   esquema mínimo de Supabase + las policies VIGENTES de servicios_housekeeping
#   2 · antes     aplica la versión ANTERIOR (la del preview de #927) y carga datos con ella
#   3 · migra     aplica la migración DOS veces sobre ese estado → converge, no pierde datos,
#                 y la huella del catálogo no cambia al re-aplicar (idempotente)
#   4 · invariantes  assert.sql (A–J, ~100 comprobaciones)
#   5 · concurrencia DOS sesiones reales insertan 12 + 12 fotos del mismo servicio/fase:
#                 deben quedar exactamente 20 y 4 rechazos
#   6 · mutación  la MISMA prueba contra una copia SIN el candado: debe dar 24. Si diera 20
#                 la prueba de concurrencia no estaría probando nada.
#   7 · guion del sandbox  sandbox_housekeeping_parte1..6.sql (GENERADOS desde assert.sql, sin sentencias
#                 destructivas escritas a mano) se ejecutan aquí con el contrato del sandbox (RBAC real,
#                 JWT por GUC): cada parte debe terminar en GUION_OK_REVERTIDO, sin dejar residuo, y
#                 abortar si la migración no está aplicada.
#
# USO:  supabase/tests/housekeeping_evidencias/run.sh
# Requiere initdb/pg_ctl/psql. No toca ningún proyecto remoto: cluster temporal.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGRACION="$RAIZ/supabase/migrations/20261028000000_housekeeping_evidencias.sql"
ANTERIOR="$AQUI/migracion_anterior.sql"

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/hkdata.XXXX)
SOCK=$(mktemp -d /tmp/hksock.XXXX)
MUT=$(mktemp /tmp/hkmut.XXXX.sql)
PUERTO=${PGPORT_TEST:-55461}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
  chmod 755 "$AQUI" 2>/dev/null || true
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

limpiar() {
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK" "$MUT"
}
trap limpiar EXIT
if [ -n "$COMO" ]; then chown -R postgres "$DATA" "$SOCK"; chmod 644 "$MUT"; fi

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;" >/dev/null
psql -q -d postgres -c "CREATE DATABASE hk" >/dev/null
psql -q -d postgres -c "CREATE DATABASE hkmut" >/dev/null
psql -q -d postgres -c "CREATE DATABASE hksb" >/dev/null
psql -q -d postgres -c "CREATE DATABASE hksb0" >/dev/null

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
huella() { psql -q -At -d "$1" -f "$AQUI/huella.sql"; }
cd "$AQUI"

echo "── 1/7 · fixture ────────────────────────────────────────────────────────"
aplicar hk "$AQUI/fixture.sql"
echo "  OK    esquema mínimo + policies vigentes de servicios_housekeeping"

echo "── 2/7 · estado ANTERIOR (la versión del preview de #927) ──────────────"
aplicar hk "$ANTERIOR"
aplicar hk "$AQUI/estado_antiguo.sql"
echo "  OK    versión anterior aplicada y con datos cargados"

echo "── 3/7 · la migración nueva, DOS veces, sobre ese estado ───────────────"
aplicar hk "$MIGRACION"
H1=$(huella hk)
aplicar hk "$MIGRACION"
H2=$(huella hk)
[ "$H1" = "$H2" ] || { echo "❌ re-aplicar la migración cambió el catálogo ($H1 ≠ $H2)"; exit 1; }
echo "  OK    idempotente: la huella del catálogo no cambia al re-aplicar"
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d hk -f "$AQUI/despues_de_actualizar.sql" 2>&1) || { echo "$SALIDA" | sed -n 's/.*ERROR:  /  /p'; echo "❌ la actualización desde la versión anterior no converge"; exit 1; }
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "── 4/7 · invariantes ───────────────────────────────────────────────────"
CODIGO=0
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d hk -f "$AQUI/assert.sql" 2>&1) || CODIGO=$?
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
if [ "$CODIGO" -ne 0 ]; then
  echo; echo "❌ una invariante no se cumple:"
  echo "$SALIDA" | grep -E "ERROR|DETAIL|CONTEXT|LINE" | head -12
  exit 1
fi

concurrente() {   # $1 = base de datos. Lanza dos sesiones a la vez y devuelve «filas_totales|rechazos»
  local db="$1" a b
  a=$(mktemp /tmp/hkA.XXXX); b=$(mktemp /tmp/hkB.XXXX)
  [ -n "$COMO" ] && chmod 666 "$a" "$b"
  psql -q -d "$db" -v sesion=A -f "$AQUI/concurrencia.sql" >"$a" 2>&1 &
  local pa=$!
  sleep 0.3
  psql -q -d "$db" -v sesion=B -f "$AQUI/concurrencia.sql" >"$b" 2>&1 &
  local pb=$!
  wait $pa; wait $pb
  local ko_a ko_b filas
  ko_a=$(sed -n 's/.*SESION A ok=[0-9]* ko=\([0-9]*\).*/\1/p' "$a"); ko_b=$(sed -n 's/.*SESION B ok=[0-9]* ko=\([0-9]*\).*/\1/p' "$b")
  [ -n "$ko_a" ] && [ -n "$ko_b" ] || { echo "sesión sin resultado: $(cat "$a" "$b" | head -5)" >&2; rm -f "$a" "$b"; return 1; }
  filas=$(psql -q -At -d "$db" -c "SELECT count(*) FROM public.servicio_housekeeping_fotos WHERE servicio_id = '5e000000-0000-0000-0000-000000000005'")
  rm -f "$a" "$b"
  echo "$filas|$((ko_a + ko_b))"
}

echo "── 5/7 · concurrencia con DOS sesiones reales ──────────────────────────"
R=$(concurrente hk)
[ "$R" = "20|4" ] || { echo "❌ esperado 20 fotos y 4 rechazos; obtenido «$R»"; exit 1; }
echo "  OK    24 intentos simultáneos sobre un mismo servicio/fase → 20 fotos y 4 rechazos"

echo "── 6/7 · mutación: la misma prueba SIN el candado debe fallar ──────────"
grep -v "pg_advisory_xact_lock" "$MIGRACION" > "$MUT"
grep -q "pg_advisory_xact_lock" "$MIGRACION" || { echo "❌ el candado ya no está en la migración"; exit 1; }
aplicar hkmut "$AQUI/fixture.sql"
aplicar hkmut "$MUT"
psql -q -v ON_ERROR_STOP=1 -d hkmut -f "$AQUI/lib.sql" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d hkmut -f "$AQUI/datos.sql" >/dev/null
R=$(concurrente hkmut)
if [ "$R" = "24|0" ]; then
  echo "  OK    sin el candado se cuelan 24 fotos (24|0): la prueba de concurrencia SÍ detecta la regresión"
else
  echo "❌ la mutación no se detectó («$R» en vez de 24|0): la prueba de concurrencia no prueba el candado"; exit 1
fi

echo "── 7/7 · guion del sandbox (6 partes), ejecutado aquí con el contrato del sandbox ─"
# Los archivos están generados: si alguien edita assert.sql y no regenera, el sandbox probaría otra cosa.
PARTES=6
for n in $(seq 1 $PARTES); do
  python3 -I "$AQUI/generar_guion_sandbox.py" --parte "$n" | cmp -s - "$AQUI/sandbox_housekeeping_parte$n.sql" \
    || { echo "❌ sandbox_housekeeping_parte$n.sql no coincide con generar_guion_sandbox.py (regenerar: python3 generar_guion_sandbox.py --escribir)"; exit 1; }
done
echo "  OK    las $PARTES partes coinciden con su generador"
for f in "$AQUI/fixture.sql" "$AQUI/fixture_compat_sandbox.sql" "$MIGRACION"; do aplicar hksb "$f"; done
TOTAL=0
for n in $(seq 1 $PARTES); do
  SALIDA=$(psql -q -d hksb -f "$AQUI/sandbox_housekeeping_parte$n.sql" 2>&1 || true)
  echo "$SALIDA" | grep -q "GUION_OK_REVERTIDO" || { echo "$SALIDA" | head -25; echo "❌ la parte $n del guion no terminó en GUION_OK_REVERTIDO"; exit 1; }
  N=$(echo "$SALIDA" | sed -n 's/.*GUION_OK_REVERTIDO · \([0-9]*\) comprobaciones.*/\1/p')
  TOTAL=$((TOTAL + N))
  echo "  OK    parte $n · GUION_OK_REVERTIDO · $N comprobaciones, 0 con FALLO"
done
echo "  OK    total: $TOTAL comprobaciones en $PARTES transacciones independientes"
RES=$(psql -q -At -d hksb -c "SELECT (SELECT count(*) FROM public.companies) || '|' || (SELECT count(*) FROM public.servicio_housekeeping_fotos) || '|' || (SELECT count(*) FROM storage.objects) || '|' || coalesce(to_regclass('hkt.res')::text, 'sin_hkt') || '|' || (SELECT count(*) FROM public.hk_limpieza_storage)")
[ "$RES" = "0|0|0|sin_hkt|0" ] || { echo "❌ el guion dejó residuo («$RES»)"; exit 1; }
echo "  OK    sin residuo: 0 empresas, 0 fotos, 0 objetos, 0 en la cola y el esquema de pruebas revertido"
for f in "$AQUI/fixture.sql" "$AQUI/fixture_compat_sandbox.sql"; do aplicar hksb0 "$f"; done
SALIDA=$(psql -q -d hksb0 -f "$AQUI/sandbox_housekeeping_parte1.sql" 2>&1 || true)
echo "$SALIDA" | grep -q "GUION_ABORTA: la migración 20261028000000_housekeeping_evidencias NO está aplicada" \
  || { echo "$SALIDA" | head -5; echo "❌ sin la migración el guion debía abortar"; exit 1; }
echo "  OK    sin la migración aplicada el guion ABORTA sin escribir nada (lo que verá el sandbox antes de aplicarla)"

echo
echo "✅ housekeeping_evidencias: aislamiento por proyecto/empresa/permiso, rutas fabricadas rechazadas, clientes sin UPDATE/DELETE, borrado coordinado con cola y reintentos, tope de 20 sin carreras, purga que conserva textos, y la actualización desde la versión anterior converge."
