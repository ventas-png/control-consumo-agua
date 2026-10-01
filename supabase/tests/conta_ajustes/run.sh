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
SALIDA=$(PGOPTIONS="-c client_min_messages=warning" psql --single-transaction -v ON_ERROR_STOP=1 \
  -d ajustes -f "$MIGS/$BAJO_PRUEBA.sql" 2>&1 || true)
echo "$SALIDA" | grep -q 'already exists' \
  || { echo "❌ la segunda pasada no falló por «already exists»:"; echo "$SALIDA" | tail -3; exit 1; }
echo "   ✓ segunda pasada rechazada por «already exists», como corresponde"
CIERRE=20261012000000_conta_anular_cuota_reembolsos_parciales_respaldos
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "$base" > "$BAJO_PRUEBA" ]] && aplicar "$f"
done
# En UNA transacción: lo que la segunda pasada alcance a ejecutar antes del
# «already exists» (los ALTER del principio de 20261012) se revierte y no pisa
# lo que redefinieron migraciones posteriores.
SALIDA=$(PGOPTIONS="-c client_min_messages=warning" psql --single-transaction -v ON_ERROR_STOP=1 \
  -d ajustes -f "$MIGS/$CIERRE.sql" 2>&1 || true)
echo "$SALIDA" | grep -q 'already exists' \
  || { echo "❌ la segunda pasada de $CIERRE no falló por «already exists»:"; echo "$SALIDA" | tail -3; exit 1; }
echo "   ✓ $CIERRE: segunda pasada rechazada por «already exists»"

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

aplicar "$AQUI/fixture_b.sql"
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d ajustes -f "$AQUI/assert_b.sql" 2>&1) || {
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante incumplida (cierre del bloque 3):"
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
QX=c9a00000-0000-0000-0000-000000000021
QY=c9a00000-0000-0000-0000-000000000022
TX=5e0b0000-0000-0000-0000-000000000021
TY=5e0b0000-0000-0000-0000-000000000022
PP3=ad900000-0000-0000-0000-000000000043
CONT=a0a0a0a0-0000-0000-0000-00000000000c
QM=c9a00000-0000-0000-0000-000000000018
QN=c9a00000-0000-0000-0000-000000000019
TM=5e0b0000-0000-0000-0000-000000000018
TN=5e0b0000-0000-0000-0000-000000000019
PQ2=ad900000-0000-0000-0000-0000000000a2
PQ3=ad900000-0000-0000-0000-0000000000a3
PQ4=ad900000-0000-0000-0000-0000000000a4
PR8=ad900000-0000-0000-0000-0000000000a8
QW3=c9a00000-0000-0000-0000-000000000033
QW6=c9a00000-0000-0000-0000-000000000036
QW7=c9a00000-0000-0000-0000-000000000037
TW3=5e0b0000-0000-0000-0000-000000000033
TW6=5e0b0000-0000-0000-0000-000000000036
TW7=5e0b0000-0000-0000-0000-000000000037
PC8=ad900000-0000-0000-0000-0000000000c8
PB8=ad900000-0000-0000-0000-0000000000b8
PB9=ad900000-0000-0000-0000-0000000000b9
TS=5e0b0000-0000-0000-0000-000000000058
TT=5e0b0000-0000-0000-0000-000000000059
UNO=e0000000-0000-0000-0000-00000000a001
A1=a1a1a1a1-0000-0000-0000-000000000001

# Preparación (como el admin): tres solicitudes de anulación y un anticipo
# nuevo de Uno para las solicitudes simultáneas del portal.
psql -q -X -v ON_ERROR_STOP=1 -d ajustes >/dev/null <<SQL
SELECT set_config('request.jwt.claim.sub', '$ADM', false);
SET ROLE authenticated;
SELECT * FROM public.conta_ajuste_solicitar('$SC1', 'anular_cargo', 'cargos_adicionales_unidad', '$C1', 'SINT doble aprobación');
SELECT * FROM public.conta_ajuste_solicitar('$SC2', 'anular_cargo', 'cargos_adicionales_unidad', '$C2', 'SINT aprobación contra cobro');
SELECT * FROM public.conta_ajuste_solicitar('$SC4', 'anular_cargo', 'cargos_adicionales_unidad', '$C4', 'SINT cobro contra aprobación');
SELECT public.sf_anticipo('f0000000-0000-0000-0000-00000000a001', 'e0000000-0000-0000-0000-00000000a001', 25, '$ANT2');
SELECT set_config('request.jwt.claim.sub', '$CONT', false);
SELECT * FROM public.conta_ajuste_solicitar('$TX', 'anular_cuota', 'cuotas_condominio', '$QX', 'SINT aprobación contra cobro de cuota');
SELECT * FROM public.conta_ajuste_solicitar('$TY', 'anular_cuota', 'cuotas_condominio', '$QY', 'SINT cobro de cuota contra aprobación');
SELECT * FROM public.conta_ajuste_solicitar('$TM', 'anular_cuota', 'cuotas_condominio', '$QM', 'SINT anulación contra aviso tardío');
SELECT * FROM public.conta_ajuste_solicitar('$TN', 'anular_cuota', 'cuotas_condominio', '$QN', 'SINT aviso tardío contra anulación');
SELECT public.aj_aviso('$PP3', 'aprobado', 'webhook', 'evt-pp3-ok');
SELECT * FROM public.conta_ajuste_solicitar_rebaja('$TW3', 'cuotas_condominio', '$QW3', 'principal', 50, 'SINT rebaja contra cobro');
SELECT * FROM public.conta_ajuste_solicitar_rebaja('$TW6', 'cuotas_condominio', '$QW6', 'principal', 50, 'SINT cobro contra rebaja');
SELECT * FROM public.conta_ajuste_solicitar_rebaja('$TW7', 'cuotas_condominio', '$QW7', 'principal', 20, 'SINT doble aprobación de rebaja');
SELECT * FROM public.conta_ajuste_solicitar_resolucion_cobro('$TS', '$PB8', 'cobrado', 'SINT resolución contra aviso');
SELECT * FROM public.conta_ajuste_solicitar_resolucion_cobro('$TT', '$PB9', 'cobrado', 'SINT doble aprobación de resolución');
SELECT public.aj_subir('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/$TS/e.pdf');
SELECT public.aj_subir('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/$TT/e.pdf');
SELECT public.conta_ajuste_adjuntar_respaldo('4e0b0000-0000-0000-0000-000000000058', '$TS', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/$TS/e.pdf', 'Estado', repeat('aa', 32));
SELECT public.conta_ajuste_adjuntar_respaldo('4e0b0000-0000-0000-0000-000000000059', '$TT', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/$TT/e.pdf', 'Estado', repeat('bb', 32));
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

# F · la aprobación (anular QX) retiene la cuota; mientras, un cobro de QX.
par f "$APR" "SELECT 'F1:' || estado FROM public.conta_ajuste_aprobar('$TX');" \
      "$ADM" "SELECT 'F2:' || public.aj_cobro_cuota('$QX', 5, 'cc0b0000-0000-0000-0000-0000000000f2');"
# F' · al revés: el cobro de QY primero; mientras, la aprobación de anularla.
par g "$ADM" "SELECT 'G1:' || public.aj_cobro_cuota('$QY', 5, 'cc0b0000-0000-0000-0000-0000000000f3');" \
      "$APR" "SELECT 'G2:' || estado || '/' || split_part(COALESCE(error_ejecucion, '-'), ':', 1) FROM public.conta_ajuste_aprobar('$TY');"
# G · dos reembolsos parciales distintos del mismo cobro a la vez (acumulados 20 y 30).
par h "$ADM" "SELECT 'H1:' || (public.aj_reembolso('$PP3', 'evt-pp3-r30', 30) ->> 'accion');" \
      "$ADM" "SELECT 'H2:' || (public.aj_reembolso('$PP3', 'evt-pp3-r20', 20) ->> 'accion');"

# I · la aprobación (anular QM) retiene la cuota; mientras, el proveedor
#     confirma su cobro en línea que había quedado 'failed'.
par i "$APR" "SELECT 'I1:' || estado FROM public.conta_ajuste_aprobar('$TM');" \
      "$ADM" "SELECT 'I2:' || (public.aj_aviso('$PQ3', 'aprobado', 'webhook', 'evt-qm') ->> 'accion');"
# J · al revés: la confirmación de QN primero; mientras, la aprobación de anularla.
par j "$ADM" "SELECT 'J1:' || (public.aj_aviso('$PQ4', 'aprobado', 'webhook', 'evt-qn') ->> 'accion');" \
      "$APR" "SELECT 'J2:' || estado || '/' || split_part(COALESCE(error_ejecucion, '-'), ':', 1) FROM public.conta_ajuste_aprobar('$TN');"
# K · dos confirmaciones distintas (webhook y consulta) a la vez del cobro
#     retenido de QL (anulada en assert_b §20).
par k "$ADM" "SELECT 'K1:' || (public.aj_aviso('$PQ2', 'aprobado', 'webhook', 'evt-ql2') ->> 'accion');" \
      "$ADM" "SELECT 'K2:' || (public.aj_aviso('$PQ2', 'aprobado', 'consulta', NULL) ->> 'accion');"
# M · reembolso TOTAL y aprobación del mismo cobro pendiente a la vez: el
#     reembolso retiene la solicitud; la aprobación llega mientras.
par m "$ADM" "SELECT 'M1:' || (public.aj_aviso('$PR8', 'reembolsado', 'webhook', 'evt-qt-ref') ->> 'accion');" \
      "$ADM" "SELECT 'M2:' || (public.aj_aviso('$PR8', 'aprobado', 'webhook', 'evt-qt-ok') ->> 'accion');"
# N · después, dos aprobaciones atrasadas distintas a la vez.
par n "$ADM" "SELECT 'N1:' || (public.aj_aviso('$PR8', 'aprobado', 'webhook', 'evt-qt-ok-2') ->> 'conciliado');" \
      "$ADM" "SELECT 'N2:' || (public.aj_aviso('$PR8', 'aprobado', 'consulta', NULL) ->> 'conciliado');"
# P · la aprobación de una rebaja de 50 retiene QW3 (60); mientras, un cobro de 60.
par p "$APR" "SELECT 'P1:' || estado FROM public.conta_ajuste_aprobar('$TW3');" \
      "$ADM" "INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES ('cc0b0000-0000-0000-0000-000000000033', '$UNO', '$A1', '$QW3', 60, 'efectivo', 'verificado', now()) RETURNING 'P2:' || monto;"
# R · al revés: el cobro de 60 de QW6 primero; mientras, la aprobación de la rebaja.
par r "$ADM" "INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES ('cc0b0000-0000-0000-0000-000000000036', '$UNO', '$A1', '$QW6', 60, 'efectivo', 'verificado', now()) RETURNING 'R1:' || monto;" \
      "$APR" "SELECT 'R2:' || estado || '/' || split_part(COALESCE(error_ejecucion, '-'), ':', 1) FROM public.conta_ajuste_aprobar('$TW6');"
# Q · dos aprobaciones de la MISMA rebaja a la vez.
par q "$APR" "SELECT 'Q1:' || estado || '/' || repetida FROM public.conta_ajuste_aprobar('$TW7');" \
      "$APR" "SELECT 'Q2:' || estado || '/' || repetida FROM public.conta_ajuste_aprobar('$TW7');"
# S · la resolución manual «cobrado» (retiene la solicitud) contra el aviso del proveedor.
par s "$APR" "SELECT 'S1:' || estado || '/' || split_part(COALESCE(error_ejecucion, '-'), ':', 1) FROM public.conta_ajuste_aprobar('$TS', 'SINT visto', false, '{4e0b0000-0000-0000-0000-000000000058}');" \
      "$ADM" "SELECT 'S2:' || (public.aj_aviso('$PB8', 'aprobado', 'webhook', 'evt-pb8') ->> 'accion');"
# T · dos aprobaciones de la MISMA resolución a la vez.
par t "$APR" "SELECT 'T1:' || estado || '/' || repetida FROM public.conta_ajuste_aprobar('$TT', 'SINT visto', false, '{4e0b0000-0000-0000-0000-000000000059}');" \
      "$APR" "SELECT 'T2:' || estado || '/' || repetida FROM public.conta_ajuste_aprobar('$TT', 'SINT visto', false, '{4e0b0000-0000-0000-0000-000000000059}');"
# U · dos avisos «aprobado» (claves distintas) sobre un cobro con la incidencia abierta.
par u "$ADM" "SELECT 'U1:' || (public.aj_aviso('$PC8', 'aprobado', 'webhook', 'evt-pc8-a') ->> 'accion');" \
      "$ADM" "SELECT 'U2:' || (public.aj_aviso('$PC8', 'aprobado', 'consulta', NULL) ->> 'accion');"
cat "$SALIDAS"/[a-u][12].txt | grep -E '^[A-U][12]:' | sort | sed 's/^/   /'

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
grep -q '^F1:ejecutada$' "$SALIDAS/f1.txt" \
  || { echo "❌ F1 debía anular QX:"; cat "$SALIDAS/f1.txt"; exit 1; }
grep -q 'COBRO_CUOTA_ANULADA' "$SALIDAS/f2.txt" \
  || { echo "❌ F2 debía fallar por COBRO_CUOTA_ANULADA:"; cat "$SALIDAS/f2.txt"; exit 1; }
echo "   F2: $(grep -o 'COBRO_CUOTA_ANULADA[^.]*' "$SALIDAS/f2.txt" | head -1)"
grep -q '^G1:cc0b0000-0000-0000-0000-0000000000f3$' "$SALIDAS/g1.txt" \
  || { echo "❌ G1 debía registrar el cobro:"; cat "$SALIDAS/g1.txt"; exit 1; }
grep -q '^G2:fallida/AJUSTE_DEPENDENCIAS$' "$SALIDAS/g2.txt" \
  || { echo "❌ G2 debía quedar fallida por AJUSTE_DEPENDENCIAS:"; cat "$SALIDAS/g2.txt"; exit 1; }
grep -q '^H1:reembolso_parcial_registrado$' "$SALIDAS/h1.txt" \
  || { echo "❌ H1 debía registrar el reembolso de 30:"; cat "$SALIDAS/h1.txt"; exit 1; }
grep -q '^H2:reembolso_ya_contado$' "$SALIDAS/h2.txt" \
  || { echo "❌ H2 (acumulado 20, llega mientras se registra el 30) debía quedar ya contado:"; cat "$SALIDAS/h2.txt"; exit 1; }

grep -q '^I1:ejecutada$' "$SALIDAS/i1.txt" \
  || { echo "❌ I1 debía anular QM:"; cat "$SALIDAS/i1.txt"; exit 1; }
grep -q '^I2:cobro_sobre_documento_anulado$' "$SALIDAS/i2.txt" \
  || { echo "❌ I2 debía conservar la confirmación sin acreditar:"; cat "$SALIDAS/i2.txt"; exit 1; }
grep -q '^J1:conciliado$' "$SALIDAS/j1.txt" \
  || { echo "❌ J1 debía conciliar el cobro de QN:"; cat "$SALIDAS/j1.txt"; exit 1; }
grep -q '^J2:fallida/AJUSTE_DEPENDENCIAS$' "$SALIDAS/j2.txt" \
  || { echo "❌ J2 debía quedar fallida por AJUSTE_DEPENDENCIAS:"; cat "$SALIDAS/j2.txt"; exit 1; }
grep -q '^K1:cobro_sobre_documento_anulado$' "$SALIDAS/k1.txt" \
  || { echo "❌ K1 debía abrir la incidencia:"; cat "$SALIDAS/k1.txt"; exit 1; }
grep -q '^K2:cobro_retenido_ya_registrado$' "$SALIDAS/k2.txt" \
  || { echo "❌ K2 debía ver el cobro ya retenido, sin otra incidencia:"; cat "$SALIDAS/k2.txt"; exit 1; }
grep -q '^M1:reembolso_antes_de_aprobar$' "$SALIDAS/m1.txt" \
  || { echo "❌ M1 debía dejar la solicitud reembolsada:"; cat "$SALIDAS/m1.txt"; exit 1; }
grep -q '^M2:ignorado_reembolsado$' "$SALIDAS/m2.txt" \
  || { echo "❌ M2 (aprobación que esperó al reembolso) no debía conciliar:"; cat "$SALIDAS/m2.txt"; exit 1; }
grep -q '^N1:false$' "$SALIDAS/n1.txt" && grep -q '^N2:false$' "$SALIDAS/n2.txt" \
  || { echo "❌ N: ninguna aprobación atrasada debía conciliar:"; cat "$SALIDAS/n1.txt" "$SALIDAS/n2.txt"; exit 1; }
grep -q '^P1:ejecutada$' "$SALIDAS/p1.txt" \
  || { echo "❌ P1 debía ejecutar la rebaja:"; cat "$SALIDAS/p1.txt"; exit 1; }
grep -q '^P2:60.00$' "$SALIDAS/p2.txt" \
  || { echo "❌ P2 debía registrar el cobro:"; cat "$SALIDAS/p2.txt"; exit 1; }
grep -q '^R1:60.00$' "$SALIDAS/r1.txt" \
  || { echo "❌ R1 debía registrar el cobro:"; cat "$SALIDAS/r1.txt"; exit 1; }
grep -q '^R2:fallida/AJUSTE_REBAJA_EXCEDE_SALDO$' "$SALIDAS/r2.txt" \
  || { echo "❌ R2 debía fallar por AJUSTE_REBAJA_EXCEDE_SALDO:"; cat "$SALIDAS/r2.txt"; exit 1; }
grep -q '^Q1:ejecutada/false$' "$SALIDAS/q1.txt" \
  || { echo "❌ Q1 debía ejecutar:"; cat "$SALIDAS/q1.txt"; exit 1; }
grep -q '^Q2:ejecutada/true$' "$SALIDAS/q2.txt" \
  || { echo "❌ Q2 debía ver la ejecución de Q1, sin ejecutar otra vez:"; cat "$SALIDAS/q2.txt"; exit 1; }
grep -q '^S1:ejecutada/-$' "$SALIDAS/s1.txt" \
  || { echo "❌ S1 debía ejecutar la resolución:"; cat "$SALIDAS/s1.txt"; exit 1; }
grep -q '^T1:ejecutada/false$' "$SALIDAS/t1.txt" && grep -q '^T2:ejecutada/true$' "$SALIDAS/t2.txt" \
  || { echo "❌ T: una ejecuta y la otra ve la ejecución:"; cat "$SALIDAS/t1.txt" "$SALIDAS/t2.txt"; exit 1; }
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d ajustes -f "$AQUI/concurrencia.sql" 2>&1) || {
  cat "$SALIDAS"/*.txt
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante de concurrencia incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "✅ bloque 3: ajustes sólo por solicitud aprobada por otra persona, ejecución única y atómica, portal que solicita, pasarela idempotente y reembolsos que no se pierden"
