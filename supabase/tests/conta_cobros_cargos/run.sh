#!/usr/bin/env bash
# ============================================================================
# COBROS DE CARGOS ADICIONALES · arnés contra un PostgreSQL REAL
#
# Prueba 20261004000000 sobre la cadena ENTERA de migraciones, el padrón de
# conta_auxiliares_tipo_cargo y el fixture de conta_contabilizacion_cargos:
# vínculo explícito cobro → cargo validado en servidor, cobros parciales y
# varios por cargo, saldo completo con estado derivado, excedente y cobro
# anterior pendientes (sin reparto ni anticipo), devengo pendiente, cuenta del
# método faltante, repetición idempotente, anulación con reverso y evidencia,
# guards contra escrituras directas, aislamiento entre empresas y proyectos,
# estado de cuenta y conciliación con cortes antes y después de reversos; y,
# con SESIONES REALES simultáneas, dos cobros, dos reprocesos, reproceso
# contra anulación del cobro y anulación del cargo contra alta de cobro.
# ============================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGS="$RAIZ/supabase/migrations"
BAJO_PRUEBA=20261004000000_conta_cobros_cargos_adicionales
PADRON="$RAIZ/supabase/tests/conta_auxiliares_tipo_cargo/fixture.sql"
CARGOS="$RAIZ/supabase/tests/conta_contabilizacion_cargos/fixture.sql"

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

DATA=$(mktemp -d /tmp/cobrosdata.XXXX)
SOCK=$(mktemp -d /tmp/cobrossock.XXXX)
PUERTO=${PGPORT_TEST:-55478}

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
psql -q -d postgres -c "CREATE DATABASE cobros_cargos" >/dev/null

aplicar() {
  PGOPTIONS="-c client_min_messages=warning" \
    psql -q -v ON_ERROR_STOP=1 -d cobros_cargos -f "$1" >/dev/null
}

SALIDAS=$(mktemp -d /tmp/cobrosout.XXXX)
chmod 777 "$SALIDAS"

echo "── 1/6 · andamiaje de plataforma (roles, auth, extensiones)"
aplicar "$RAIZ/scripts/schema-drift/bootstrap.sql"

echo "── 2/6 · cadena de migraciones ANTERIORES a la que se prueba, en orden"
N=0
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "$base" < "$BAJO_PRUEBA" ]] || continue
  aplicar "$f"
  N=$((N + 1))
done
echo "   $N migraciones aplicadas sobre una base vacía"

echo "── 3/6 · migración bajo prueba (dos veces: la segunda sólo puede fallar por «already exists»)"
aplicar "$MIGS/$BAJO_PRUEBA.sql"
if aplicar "$MIGS/$BAJO_PRUEBA.sql" 2>/dev/null; then
  echo "   ✓ segunda pasada limpia"
else
  # ADD COLUMN y CREATE TRIGGER sin IF NOT EXISTS son DELIBERADOS (convención
  # del repo: correrla dos veces tiene que fallar de forma explícita). Se exige
  # que falle por eso y NO por otra cosa.
  SALIDA=$(PGOPTIONS="-c client_min_messages=warning" psql -v ON_ERROR_STOP=1 \
    -d cobros_cargos -f "$MIGS/$BAJO_PRUEBA.sql" 2>&1 || true)
  echo "$SALIDA" | grep -q 'already exists' \
    || { echo "❌ la segunda pasada falló por algo distinto de «already exists»:"; echo "$SALIDA"; exit 1; }
  echo "   ✓ segunda pasada rechazada por «already exists», como corresponde"
fi
for f in "$MIGS"/*.sql; do
  base="$(basename "$f" .sql)"
  [[ "$base" > "$BAJO_PRUEBA" ]] && aplicar "$f"
done

echo "── 4/6 · padrón de dos empresas + fixture de cargos + el de cobros"
aplicar "$PADRON"
aplicar "$CARGOS"
aplicar "$AQUI/fixture.sql"


echo "── 5/6 · invariantes de una sesión"
# El `|| true` es para poder IMPRIMIR el fallo: sin él, `set -e` aborta con la
# salida todavía dentro de la variable y el error se pierde.
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d cobros_cargos -f "$AQUI/assert.sql" 2>&1) || {
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "── 5b/6 · coherencia cargo ↔ devengo e idempotencia del contenido (20261004000200)"
SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d cobros_cargos -f "$AQUI/assert_coherencia.sql" 2>&1) || {
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "── 6/6 · concurrencia: sesiones REALES simultáneas, no una simulación"
ADM=a0a0a0a0-0000-0000-0000-00000000000a
CA2=ca000000-0000-0000-0000-000000000002
CA10=ca000000-0000-0000-0000-000000000010
CA12=ca000000-0000-0000-0000-000000000012
CA13=ca000000-0000-0000-0000-000000000013
CA14=ca000000-0000-0000-0000-000000000014
PC12=cc000000-0000-0000-0000-000000000012
CA19=ca000000-0000-0000-0000-000000000019
CA20=ca000000-0000-0000-0000-000000000020
KF=cd000000-0000-0000-0000-0000000000a1
KG=cd000000-0000-0000-0000-0000000000a2

# Preparación: CA10 y CA12 tienen un cobro esperando su devengo (tipo sin
# configurar); se configura el tipo y quedan listos para reprocesar.
psql -q -X -v ON_ERROR_STOP=1 -d cobros_cargos >/dev/null <<SQL
SELECT set_config('request.jwt.claim.sub', '$ADM', false);
SET ROLE authenticated;
SELECT public.cc_cobrar('$CA10', 30, 'efectivo', '2026-07-05', 'cc000000-0000-0000-0000-000000000010');
SELECT public.cc_cobrar('$CA12', 35, 'efectivo', '2026-07-05', '$PC12');
RESET ROLE;
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'adicional_servicio',
   '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a103'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'adicional_dano',
   '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a103');
SQL

sesion() {
  # $1 = espera antes de empezar, $2 = sentencia, $3 = espera antes del COMMIT
  psql -q -X -t -A -v ON_ERROR_STOP=1 -d cobros_cargos <<SQL
SELECT pg_sleep($1);
SELECT set_config('request.jwt.claim.sub', '$ADM', false);
SET ROLE authenticated;
BEGIN;
$2
SELECT pg_sleep($3);
COMMIT;
SQL
}
# La primera sesión de cada par retiene su transacción 1,5 s; la segunda llega
# 0,3 s después, mientras la primera todavía no confirmó.
par() {
  sesion 0   "$2" 1.5 > "$SALIDAS/${1}1.txt" 2>&1 &
  local p1=$!
  sesion 0.3 "$3" 0   > "$SALIDAS/${1}2.txt" 2>&1 &
  local p2=$!
  wait $p1 $p2 || true
}

# A · dos cobros de 30 del mismo cargo de 50, a la vez.
par a "SELECT 'A1:' || public.cc_cobrar('$CA2', 30, 'efectivo', '2026-06-05', 'cc000000-0000-0000-0000-0000000000a1');" \
      "SELECT 'A2:' || public.cc_cobrar('$CA2', 30, 'efectivo', '2026-06-05', 'cc000000-0000-0000-0000-0000000000a2');"
# B · dos reprocesos del mismo cargo con un cobro esperando.
par b "SELECT 'B1:' || string_agg(COALESCE(evento,'-') || '=' || resultado, '+' ORDER BY evento) FROM public.conta_reprocesar_cargo('cargos_adicionales_unidad', '$CA10');" \
      "SELECT 'B2:' || string_agg(COALESCE(evento,'-') || '=' || resultado, '+' ORDER BY evento) FROM public.conta_reprocesar_cargo('cargos_adicionales_unidad', '$CA10');"
# C · reproceso del cargo contra anulación de SU cobro.
par c "SELECT 'C1:' || string_agg(COALESCE(evento,'-') || '=' || resultado, '+' ORDER BY evento) FROM public.conta_reprocesar_cargo('cargos_adicionales_unidad', '$CA12');" \
      "SELECT 'C2:' || resultado || '/' || (reverso_id IS NOT NULL) FROM public.conta_anular_cobro_cargo('$PC12', 'SINT-AUX anulación concurrente');"
# D · alta de cobro contra anulación del cargo (el cobro llega primero).
par d "SELECT 'D1:' || public.cc_cobrar('$CA13', 20, 'efectivo', '2026-06-05', 'cc000000-0000-0000-0000-0000000000d1');" \
      "UPDATE public.cargos_adicionales_unidad SET estado = 'anulado' WHERE id = '$CA13';"
# E · anulación del cargo contra alta de cobro (la anulación llega primero).
par e "UPDATE public.cargos_adicionales_unidad SET estado = 'anulado' WHERE id = '$CA14'; SELECT 'E1:anulado';" \
      "SELECT 'E2:' || public.cc_cobrar('$CA14', 20, 'efectivo', '2026-06-05', 'cc000000-0000-0000-0000-0000000000e2');"

# F · la MISMA clave en dos cargos distintos, a la vez (respuesta perdida y
#     reintento contra otro documento): una se registra, la otra es clave reusada.
par f "SELECT 'F1:' || public.cc_cobrar('$CA19', 30, 'efectivo', '2026-07-05', '$KF');" \
      "SELECT 'F2:' || public.cc_cobrar('$CA20', 30, 'efectivo', '2026-07-05', '$KF');"
# G · la MISMA clave y los MISMOS datos, a la vez (doble envío): un cobro, el
#     otro lo devuelve como repetido.
par g "SELECT 'G1:' || public.cc_cobrar('$CA19', 10, 'efectivo', '2026-07-06', '$KG');" \
      "SELECT 'G2:' || public.cc_cobrar('$CA19', 10, 'efectivo', '2026-07-06', '$KG');"

cat "$SALIDAS"/[a-g][12].txt | grep -E '^[A-G][12]:' | sort | sed 's/^/   /'

# Las que DEBEN fallar, por lo que se espera; el resto, sin errores.
grep -q 'CARGO_CON_COBROS' "$SALIDAS/d2.txt" \
  || { echo "❌ D2 debía fallar por CARGO_CON_COBROS:"; cat "$SALIDAS/d2.txt"; exit 1; }
echo "   D2: $(grep -o 'CARGO_CON_COBROS[^.]*' "$SALIDAS/d2.txt" | head -1)"
grep -q 'COBRO_CARGO_ANULADO' "$SALIDAS/e2.txt" \
  || { echo "❌ E2 debía fallar por COBRO_CARGO_ANULADO:"; cat "$SALIDAS/e2.txt"; exit 1; }
echo "   E2: $(grep -o 'COBRO_CARGO_ANULADO[^.]*' "$SALIDAS/e2.txt" | head -1)"
grep -q 'COBRO_CARGO_CLAVE_REUSADA' "$SALIDAS/f2.txt" \
  || { echo "❌ F2 debía fallar por COBRO_CARGO_CLAVE_REUSADA:"; cat "$SALIDAS/f2.txt"; exit 1; }
echo "   F2: $(grep -o 'COBRO_CARGO_CLAVE_REUSADA[^.]*' "$SALIDAS/f2.txt" | head -1)"
grep -q '^G2:contabilizada/-/pendiente/repetido$' "$SALIDAS/g2.txt" \
  || { echo "❌ G2 debía devolver el mismo cobro como repetido:"; cat "$SALIDAS/g2.txt"; exit 1; }
for f in a1 a2 b1 b2 c1 c2 d1 e1 f1 g1 g2; do
  if grep -qE 'ERROR|FATAL' "$SALIDAS/$f.txt"; then
    echo "❌ la sesión $f falló:"; cat "$SALIDAS/$f.txt"; exit 1
  fi
done

SALIDA=$(psql -q -v ON_ERROR_STOP=1 -d cobros_cargos -f "$AQUI/concurrencia.sql" 2>&1) || {
  cat "$SALIDAS"/*.txt
  echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'
  echo "❌ invariante de concurrencia incumplida:"
  echo "$SALIDA" | grep -E 'ERROR|FATAL' | head -5
  exit 1
}
echo "$SALIDA" | sed -n 's/.*NOTICE:  /  /p'

echo "✅ cobros de cargos adicionales: vinculados, contra su devengo, sin excedentes aplicados, idempotentes y serializados"
