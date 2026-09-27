#!/usr/bin/env bash
# ============================================================================
# BLOQUE 3 · SOLICITUDES DE AJUSTE, PORTAL Y PASARELA · arnés contra un
# PostgreSQL REAL
#
# Prueba 20261011000000 sobre la cadena ENTERA de migraciones y los fixtures
# de conta_auxiliares_tipo_cargo, conta_contabilizacion_cargos y
# conta_saldos_favor: escrituras directas rechazadas, solicitud idempotente,
# cuatro ojos y autoaprobación sólo del company_owner con confirmación (sin
# excepción de único aprobador), revalidación de documento, período y saldo
# al aprobar, fallo sin escrituras parciales y reintento, rechazo y
# cancelación, evidencia de anulación de cargos sin asiento y su lugar en el
# estado de cuenta, portal (consulta y solicitud del residente, aislamiento),
# pasarela (cargos en línea, duplicados, avisos fuera de orden, aprobación
# tardía, reembolsos con y sin bloqueo e incidencias); y, con SESIONES REALES
# simultáneas, dos aprobaciones de la misma solicitud, aprobación contra cobro
# (en los dos órdenes), dos avisos «aprobado» a la vez y dos solicitudes del
# portal por el mismo documento.
# ============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
BAJO_PRUEBA=20261011000000_conta_ajustes_solicitudes_portal_pasarela
PADRON="$RAIZ/supabase/tests/conta_auxiliares_tipo_cargo/fixture.sql"
CARGOS="$RAIZ/supabase/tests/conta_contabilizacion_cargos/fixture.sql"
SALDOS="$RAIZ/supabase/tests/conta_saldos_favor/fixture.sql"
for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# Shims de pg_net/pg_cron: fuera de Supabase no existen y varias migraciones
# hacen CREATE EXTENSION. Mismo mecanismo que conta_pendientes_reproceso y
# scripts/schema-drift/reconstruir.mjs: un control file vacío; los objetos que
# las migraciones usan los define bootstrap.sql.
EXT="$(pg_config --sharedir 2>/dev/null || echo /usr/share/postgresql/$(basename "$(dirname "$(command -v initdb)")"))/extension"
for ext in pg_net pg_cron; do
  [ -f "$EXT/$ext.control" ] && continue
  CTL="comment = 'shim vacío del arnés'"$'\n'"default_version = '1.0'"$'\n'"relocatable = true"
  if [ -w "$EXT" ]; then
    printf '%s\n' "$CTL" > "$EXT/$ext.control"; echo 'SELECT 1;' > "$EXT/$ext--1.0.sql"
  else
    printf '%s\n' "$CTL" | sudo -n tee "$EXT/$ext.control" >/dev/null
    echo 'SELECT 1;' | sudo -n tee "$EXT/$ext--1.0.sql" >/dev/null
  fi
done

DATA=$(mktemp -d /tmp/ajdata.XXXX)
SOCK=$(mktemp -d /tmp/ajsock.XXXX)
PUERTO=${PGPORT_TEST:-55491}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

limpiar() {
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK" "${SALIDAS:-}"
}
trap limpiar EXIT

if [ -n "$COMO" ]; then chown -R postgres "$DATA" "$SOCK"; fi

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE DATABASE ajustes" >/dev/null

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" \
    psql -q -v ON_ERROR_STOP=1 -d ajustes -f "$1" >/dev/null
}

SALIDAS=$(mktemp -d /tmp/ajout.XXXX)
chmod 777 "$SALIDAS"

echo "── 1/5 · andamiaje de plataforma (roles, auth, extensiones)"
aplicar "$RAIZ/scripts/schema-drift/bootstrap.sql"

echo "── 2/5 · cadena de migraciones ANTERIORES a la que se prueba, en orden"
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "$base" < "$BAJO_PRUEBA" ]] || continue
  aplicar "$f"
  N=$((N + 1))
done
echo "   $N migraciones aplicadas sobre una base vacía"

echo "── 3/5 · migración bajo prueba (dos veces: la segunda sólo puede fallar por «already exists») y posteriores"
aplicar "$MIGS/$BAJO_PRUEBA.sql"
SALIDA=$(PGOPTIONS="-c client_min_messages=warning" psql -v ON_ERROR_STOP=1 \
  -d ajustes -f "$MIGS/$BAJO_PRUEBA.sql" 2>&1 || true)
echo "$SALIDA" | grep -q 'already exists' \
  || { echo "❌ la segunda pasada no falló por «already exists»:"; echo "$SALIDA" | tail -3; exit 1; }
echo "   ✓ segunda pasada rechazada por «already exists», como corresponde"
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "$base" > "$BAJO_PRUEBA" ]] && aplicar "$f"
done

echo "── 4/5 · padrón + fixtures de cargos, saldos a favor y del bloque 3, e invariantes de una sesión"
aplicar "$PADRON"
aplicar "$AQUI/helper.sql"
aplicar "$CARGOS"
aplicar "$SALDOS"
aplicar "$AQUI/fixture.sql"
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d ajustes -f "$AQUI/assert.sql" 2>&1) || {
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "── 5/5 · concurrencia: sesiones REALES simultáneas, no una simulación"
ADM=a0a0a0a0-0000-0000-0000-00000000000a
APR=a0a0a0a0-0000-0000-0000-0000000000f1
RUNO=a0a0a0a0-0000-0000-0000-0000000000e1
C1=ad000000-0000-0000-0000-000000000031
C2=ad000000-0000-0000-0000-000000000032
C4=ad000000-0000-0000-0000-000000000034
PRC3=ad900000-0000-0000-0000-000000000013
SC1=5e000000-0000-0000-0000-0000000000c1
SC2=5e000000-0000-0000-0000-0000000000c2
SC4=5e000000-0000-0000-0000-0000000000c4
ANT2=9f5f0000-0000-0000-0000-0000000000e2
Q4=c5f00000-0000-0000-0000-000000000004

# Preparación (como el admin): tres solicitudes de anulación y un anticipo
# nuevo de Uno para las solicitudes simultáneas del portal.
psql -q -X -v ON_ERROR_STOP=1 -d ajustes >/dev/null <<SQL
SELECT set_config('request.jwt.claim.sub', '$ADM', false);
SET ROLE authenticated;
SELECT * FROM public.conta_ajuste_solicitar('$SC1', 'anular_cargo', 'cargos_adicionales_unidad', '$C1', 'SINT doble aprobación');
SELECT * FROM public.conta_ajuste_solicitar('$SC2', 'anular_cargo', 'cargos_adicionales_unidad', '$C2', 'SINT aprobación contra cobro');
SELECT * FROM public.conta_ajuste_solicitar('$SC4', 'anular_cargo', 'cargos_adicionales_unidad', '$C4', 'SINT cobro contra aprobación');
SELECT public.sf_anticipo('f0000000-0000-0000-0000-00000000a001', 'e0000000-0000-0000-0000-00000000a001', 25, '$ANT2');
SQL
OANT2=$(psql -q -X -t -A -d ajustes -c "SELECT public.sf_origen_id('$ANT2')")

sesion() {
  # $1 = espera antes de empezar, $2 = usuario, $3 = sentencia, $4 = espera antes del COMMIT
  psql -q -X -t -A -v ON_ERROR_STOP=1 -d ajustes <<SQL
SELECT pg_sleep($1);
SELECT set_config('request.jwt.claim.sub', '$2', false);
SET ROLE authenticated;
BEGIN;
$3
SELECT pg_sleep($4);
COMMIT;
SQL
}
# La primera sesión de cada par retiene su transacción 1,5 s; la segunda llega
# 0,3 s después, mientras la primera todavía no confirmó.
par() {
  sesion 0   "$2" "$3" 1.5 > "$SALIDAS/${1}1.txt" 2>&1 &
  local p1=$!
  sesion 0.3 "$4" "$5" 0   > "$SALIDAS/${1}2.txt" 2>&1 &
  local p2=$!
  wait $p1 $p2 || true
}

# A · dos aprobaciones de la MISMA solicitud (doble clic en dos pestañas).
par a "$APR" "SELECT 'A1:' || estado || '/' || repetida FROM public.conta_ajuste_aprobar('$SC1');" \
      "$APR" "SELECT 'A2:' || estado || '/' || repetida FROM public.conta_ajuste_aprobar('$SC1');"
# B · la aprobación (anular C2) retiene el cargo; mientras, un cobro de C2.
par b "$APR" "SELECT 'B1:' || estado FROM public.conta_ajuste_aprobar('$SC2');" \
      "$ADM" "SELECT 'B2:' || count(*) FROM public.conta_registrar_cobro_cargo('$C2', 5, 'efectivo', CURRENT_DATE, 'SINT', NULL, 'cb000000-0000-0000-0000-0000000000b2');"
# B' · al revés: el cobro de C4 primero; mientras, la aprobación de anularlo.
par c "$ADM" "SELECT 'C1:' || count(*) FROM public.conta_registrar_cobro_cargo('$C4', 5, 'efectivo', CURRENT_DATE, 'SINT', NULL, 'cb000000-0000-0000-0000-0000000000c4');" \
      "$APR" "SELECT 'C2:' || estado || '/' || split_part(COALESCE(error_ejecucion, '-'), ':', 1) FROM public.conta_ajuste_aprobar('$SC4');"
# D · dos avisos «aprobado» distintos (webhook y consulta) del mismo cobro.
par d "$ADM" "SELECT 'D1:' || (public.aj_aviso('$PRC3', 'aprobado', 'webhook', 'evt-c3') ->> 'accion');" \
      "$ADM" "SELECT 'D2:' || (public.aj_aviso('$PRC3', 'aprobado', 'consulta', NULL) ->> 'accion');"
# E · el residente envía dos solicitudes (dos claves) por el mismo documento.
par e "$RUNO" "SELECT 'E1:' || estado FROM public.portal_solicitar_aplicacion_saldo_favor('5e000000-0000-0000-0000-0000000000d1', '$OANT2', 'cuotas_condominio', '$Q4', 5);" \
      "$RUNO" "SELECT 'E2:' || estado FROM public.portal_solicitar_aplicacion_saldo_favor('5e000000-0000-0000-0000-0000000000d2', '$OANT2', 'cuotas_condominio', '$Q4', 5);"

cat "$SALIDAS"/[a-e][12].txt | grep -E '^[A-E][12]:' | sort | sed 's/^/   /'

grep -q '^A1:ejecutada/false$' "$SALIDAS/a1.txt" \
  || { echo "❌ A1 debía ejecutar:"; cat "$SALIDAS/a1.txt"; exit 1; }
grep -q '^A2:ejecutada/true$' "$SALIDAS/a2.txt" \
  || { echo "❌ A2 debía ver la ejecución de A1 (repetida), sin ejecutar otra vez:"; cat "$SALIDAS/a2.txt"; exit 1; }
grep -q '^B1:ejecutada$' "$SALIDAS/b1.txt" \
  || { echo "❌ B1 debía anular C2:"; cat "$SALIDAS/b1.txt"; exit 1; }
grep -q 'COBRO_CARGO_ANULADO' "$SALIDAS/b2.txt" \
  || { echo "❌ B2 debía fallar por COBRO_CARGO_ANULADO:"; cat "$SALIDAS/b2.txt"; exit 1; }
echo "   B2: $(grep -o 'COBRO_CARGO_ANULADO[^.]*' "$SALIDAS/b2.txt" | head -1)"
grep -q '^C1:1$' "$SALIDAS/c1.txt" \
  || { echo "❌ C1 debía registrar el cobro:"; cat "$SALIDAS/c1.txt"; exit 1; }
grep -q '^C2:fallida/CARGO_CON_COBROS$' "$SALIDAS/c2.txt" \
  || { echo "❌ C2 debía quedar fallida por CARGO_CON_COBROS:"; cat "$SALIDAS/c2.txt"; exit 1; }
grep -q '^D1:conciliado$' "$SALIDAS/d1.txt" \
  || { echo "❌ D1 debía conciliar:"; cat "$SALIDAS/d1.txt"; exit 1; }
grep -q '^D2:ya_conciliado$' "$SALIDAS/d2.txt" \
  || { echo "❌ D2 debía ver el cobro ya conciliado:"; cat "$SALIDAS/d2.txt"; exit 1; }
grep -q '^E1:pendiente$' "$SALIDAS/e1.txt" \
  || { echo "❌ E1 debía crear la solicitud:"; cat "$SALIDAS/e1.txt"; exit 1; }
grep -q 'AJUSTE_YA_SOLICITADO' "$SALIDAS/e2.txt" \
  || { echo "❌ E2 debía fallar por AJUSTE_YA_SOLICITADO:"; cat "$SALIDAS/e2.txt"; exit 1; }
echo "   E2: $(grep -o 'AJUSTE_YA_SOLICITADO[^.]*' "$SALIDAS/e2.txt" | head -1)"

SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d ajustes -f "$AQUI/concurrencia.sql" 2>&1) || {
  cat "$SALIDAS"/*.txt
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante de concurrencia incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "✅ bloque 3: ajustes sólo por solicitud aprobada por otra persona, ejecución única y atómica, portal que solicita, pasarela idempotente y reembolsos que no se pierden"
