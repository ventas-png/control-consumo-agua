#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260911223000 — las siete SECURITY DEFINER que
# una reconstrucción nueva dejaba ejecutables por `anon`.
#
# QUÉ COMPRUEBA
#   1/7  el fixture reproduce el hallazgo de la Preview limpia de #856: las
#        siete ejecutables por anon, authenticated y service_role
#   2/7  tras la migración, la matriz de producción celda por celda, y los dos
#        lints de los asesores POR NOMBRE (anon deja sólo sso_lookup_domain;
#        authenticated deja sólo esa y buscar_cliente_para_onboarding)
#   3/7  IDEMPOTENCIA: aplicarla dos veces no falla y deja el mismo estado
#   4/7  INVOCACIÓN EFECTIVA con SET LOCAL ROLE, no lectura de ACL
#   5/7  los triggers siguen disparando para el rol que perdió EXECUTE
#   6/7  MUTACIÓN · quitar CUALQUIERA de los siete REVOKE rompe la prueba
#   7/7  MUTACIÓN · mover una celda de la matriz rompe la prueba (quitarle anon
#        a sso_lookup_domain; devolvérselo a buscar_cliente_para_onboarding)
#
# Los dos bloques de mutación son lo que convierte esto en una prueba y no en
# una descripción: sin ellos, un arnés que no mirara nada también pasaría.
#
# USO
#   supabase/tests/acl_definer_expuestas_anon/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un clúster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGRACION="$RAIZ/supabase/migrations/20260911223000_declarar_acl_definer_expuestas_anon.sql"

[ -f "$MIGRACION" ] || { echo "❌ no existe $MIGRACION"; exit 1; }

# Los binarios no siempre están en PATH (en Debian/Ubuntu viven versionados).
for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: se usa una ruta corta a propósito.
DATA=$(mktemp -d /tmp/acldefdata.XXXX)
SOCK=$(mktemp -d /tmp/acldefsock.XXXX)
TRABAJO=$(mktemp -d /tmp/acldefmut.XXXX)
PUERTO=${PGPORT_TEST:-55441}

limpiar() {
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK" "$TRABAJO"
}
trap limpiar EXIT

# Postgres se niega a correr como root; si lo somos, se delega en el usuario
# `postgres` del sistema.
COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  chown -R postgres "$DATA" "$SOCK" "$TRABAJO"
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres

# Los tres roles de la Data API. Son globales al clúster: se crean una vez y
# valen para la base principal y para las de cada mutación.
psql -q -d postgres -c "CREATE ROLE anon NOINHERIT; CREATE ROLE authenticated NOINHERIT; CREATE ROLE service_role NOINHERIT BYPASSRLS;" >/dev/null

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
notas()   { psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" 2>&1 | sed -n 's/.*NOTICE:  /  /p'; }

# Una base nueva con el fixture puesto: el punto de partida de la Preview limpia.
preparar() {
  psql -q -d postgres -c "CREATE DATABASE $1" >/dev/null
  aplicar "$1" "$AQUI/fixture.sql"
}

preparar acl

echo "── 1/7 · el fixture reproduce el hallazgo de la Preview de #856 ────────"
notas acl "$AQUI/assert_pre.sql"

echo "── 2/7 · la migración y la matriz de producción, celda por celda ───────"
aplicar acl "$MIGRACION"
notas acl "$AQUI/assert.sql"

echo "── 3/7 · idempotencia (re-aplicar la misma migración) ──────────────────"
aplicar acl "$MIGRACION"
psql -q -v ON_ERROR_STOP=1 -d acl -f "$AQUI/assert.sql" >/dev/null 2>&1
echo "  OK    re-aplicar no falla y deja exactamente el mismo estado"

echo "── 4/7 · invocación efectiva (SET LOCAL ROLE), no lectura de ACL ───────"
notas acl "$AQUI/invocacion.sql"

echo "── 5/7 · los triggers siguen disparando tras la revocación ─────────────"
notas acl "$AQUI/triggers.sql"

# ── Mutación ────────────────────────────────────────────────────────────────
# `debe_fallar` corre la migración (o su mutante) sobre una base RECIÉN
# preparada y luego el assert: la pareja TIENE que terminar en rojo. Si termina
# en verde, el arnés no está midiendo lo que dice y esto falla aquí.
MUTANTE=0
debe_fallar() {
  local etiqueta="$1" migracion="$2" extra="${3:-}"
  MUTANTE=$((MUTANTE + 1))
  local db="mut$MUTANTE"
  preparar "$db"
  local rc=0
  {
    PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$migracion" &&
    { [ -z "$extra" ] || psql -q -v ON_ERROR_STOP=1 -d "$db" -c "$extra"; } &&
    psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$AQUI/assert.sql"
  } >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "  ✗     $etiqueta — el arnés PASÓ y debía fallar"
    return 1
  fi
  echo "  OK    $etiqueta → rojo"
}

# Quita del archivo el REVOKE de una firma (dos líneas: la sentencia y su FROM).
sin_revoke() {
  awk -v lit="REVOKE EXECUTE ON FUNCTION $1" '
    index($0, lit) == 1 { saltar = 2 }
    saltar > 0 { saltar--; next }
    { print }
  ' "$MIGRACION"
}

echo "── 6/7 · mutación: omitir cualquiera de los siete REVOKE ───────────────"
FALLOS=0
for fn in \
  'public.sso_lookup_domain(text)' \
  'public.buscar_cliente_para_onboarding(text, date, text)' \
  'public.migrate_custom_auth_to_supabase_unconfirmed()' \
  'public.create_default_conversation_access_rules(uuid)' \
  'public.fill_company_id_from_user()' \
  'public.fn_set_recipient_company_id()' \
  'public.set_updated_at()'
do
  mutante="$TRABAJO/sin_revoke_$MUTANTE.sql"
  sin_revoke "$fn" > "$mutante"
  # Que la mutación de verdad quitó algo: si el awk no encontrara la sentencia
  # el «mutante» sería el original y la prueba se volvería un pase gratis.
  if [ "$(wc -l < "$mutante")" -ne "$(( $(wc -l < "$MIGRACION") - 2 ))" ]; then
    echo "  ✗     no se pudo quitar el REVOKE de $fn — ¿cambió el formato de la migración?"
    FALLOS=$((FALLOS + 1)); continue
  fi
  [ -n "$COMO" ] && chmod 644 "$mutante"
  debe_fallar "sin REVOKE de $fn" "$mutante" || FALLOS=$((FALLOS + 1))
done

echo "── 7/7 · mutación: mover una celda de la matriz ────────────────────────"
debe_fallar "quitarle anon a sso_lookup_domain" "$MIGRACION" \
  "REVOKE EXECUTE ON FUNCTION public.sso_lookup_domain(text) FROM anon;" || FALLOS=$((FALLOS + 1))
debe_fallar "devolverle anon a buscar_cliente_para_onboarding" "$MIGRACION" \
  "GRANT EXECUTE ON FUNCTION public.buscar_cliente_para_onboarding(text, date, text) TO anon;" || FALLOS=$((FALLOS + 1))

echo
if [ "$FALLOS" -gt 0 ]; then
  echo "❌ acl_definer_expuestas_anon: $FALLOS comprobación(es) de mutación fallaron."
  exit 1
fi
echo "✅ acl_definer_expuestas_anon: la matriz de producción, invocable, con los triggers vivos y decisiva por mutación."
