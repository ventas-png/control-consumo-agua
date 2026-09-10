#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# La reversa de 20260910000400 es DDL ejecutable, y repone lo que había.
#
# POR QUÉ EXISTE
# 20260910000400 retira tres funciones que sólo viven en producción. Una
# migración que borra algo no es reversible por sí sola, y la primera versión de
# ese PR afirmaba que la definición «no se pierde» porque su HUELLA está en
# `drift-conocido.json`. Era falso: una huella es un sha256 y de un sha256 no
# sale un cuerpo. La reversa de verdad vive en `supabase/reversas/`.
#
# Este test es lo que impide que ese archivo se vuelva decorativo. No comprueba
# que exista —eso lo haría un grep— sino que:
#
#   1. las tres funciones NO están antes (la premisa del PR: no están en el repo);
#   2. el archivo se EJECUTA sin error contra un Postgres real, con sólo sus
#      dependencias declaradas presentes;
#   3. lo repuesto produce las SEIS huellas que la baseline declara para
#      producción —las tres definiciones y sus tres grants—, byte por byte;
#   4. PUBLIC no queda con EXECUTE. `CREATE OR REPLACE` sobre una función que no
#      existe la crea con la ACL por defecto, que incluye a PUBLIC y por tanto a
#      `anon`: una reversa sin el REVOKE repondría tres SECURITY DEFINER
#      abiertas a cualquiera con la clave anon.
#
# El punto 3 es el que importa: es la diferencia entre «hay un archivo» y «ese
# archivo repone exactamente lo que se borró».
#
# USO
#   supabase/tests/reversa_helpers_rbac/run.sh
# Requiere binarios de PostgreSQL. No toca ningún proyecto remoto.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
REVERSA="$RAIZ/supabase/reversas/20260910000400_reponer_helpers_rbac_huerfanos.sql"
FINGERPRINT="$RAIZ/scripts/schema-drift/fingerprint.sql"
BASELINE="$RAIZ/scripts/schema-drift/drift-conocido.json"

for d in ${PGBIN:-} /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/revdata.XXXX)
SOCK=$(mktemp -d /tmp/revsock.XXXX)
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

correr "initdb -D $DATA -U postgres --auth=trust --encoding=UTF8 --locale=C" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2
export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres
psql -q -d postgres -c "CREATE DATABASE reversa" >/dev/null

echo "── 1/4 · dependencias y roles ──────────────────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d reversa -f "$AQUI/fixture.sql" >/dev/null
echo "  OK    current_user_role(), get_my_company_id() y los tres roles"

echo "── 2/4 · la premisa: las tres NO están ─────────────────────────────────"
ANTES=$(psql -tAd reversa -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('has_role_any','has_super_or_owner_access','is_user_in_company_with_role')")
if [ "$ANTES" != "0" ]; then echo "❌ la premisa falla: ya existen ($ANTES)"; exit 1; fi
echo "  OK    0 de 3 presentes antes de la reversa"

echo "── 3/4 · la reversa se ejecuta ─────────────────────────────────────────"
PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d reversa -f "$REVERSA" >/dev/null
echo "  OK    aplicada, y su propia postcondición pasó"

echo "── 4/4 · ¿repuso lo que había? ─────────────────────────────────────────"
HUELLA=$(psql -tAF $'\t' -v ON_ERROR_STOP=1 -d reversa -f "$FINGERPRINT")
echo "$HUELLA" | node -e '
const fs = require("node:fs")
const baseline = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).grupos
const medido = new Map(fs.readFileSync(0, "utf8").split("\n").filter(Boolean)
  .map(l => { const [c, h, n] = l.split("\t"); return [c, `${h}:${n}`] }))
const claves = [
  "funcion:has_role_any(p_roles text[])",
  "funcion:has_super_or_owner_access(p_company_id uuid)",
  "funcion:is_user_in_company_with_role(p_company_id uuid, p_roles text[])",
]
let malas = 0
for (const base of claves) for (const clave of [base, base + "/grants"]) {
  const esperado = baseline[clave]?.produccion
  const obtenido = medido.get(clave)
  if (!esperado) { console.log(`  ✗ ${clave}: no está declarada en la baseline`); malas++; continue }
  if (esperado !== obtenido) {
    console.log(`  ✗ ${clave}\n      producción declarada : ${esperado}\n      repuesto por reversa : ${obtenido ?? "(no se creó)"}`)
    malas++
  } else {
    console.log(`  OK    ${clave}`)
  }
}
process.exit(malas === 0 ? 0 : 1)
' "$BASELINE"

PUB=$(psql -tAd reversa -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
  LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  WHERE n.nspname='public' AND p.proname IN ('has_role_any','has_super_or_owner_access','is_user_in_company_with_role')
    AND a.privilege_type='EXECUTE' AND a.grantee = 0")
if [ "$PUB" != "0" ]; then echo "❌ PUBLIC conserva EXECUTE en $PUB: la reversa abriría tres SECURITY DEFINER a anon"; exit 1; fi
echo "  OK    PUBLIC sin EXECUTE en las tres"

echo
echo "✅ reversa_helpers_rbac: el archivo de reversa se ejecuta y repone las tres funciones con las SEIS huellas exactas de producción."
