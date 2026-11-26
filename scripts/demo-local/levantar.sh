#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# COPIA LOCAL del sistema con una EMPRESA DEMO, para probar flujos con clics reales y sacar
# capturas de manuales. Nada sale de esta máquina: base PostgreSQL local con TODAS las
# migraciones, PostgREST (la API que usa Supabase), una pasarela que imita auth/storage de
# Supabase y la aplicación (vite) apuntando a ella.
#
#   bash scripts/demo-local/levantar.sh     → http://127.0.0.1:5173
#   bash scripts/demo-local/detener.sh
#
# Usuarios (la clave, aleatoria, queda en scripts/demo-local/.credenciales, fuera de git):
#   admin@demo.local       dueño de la empresa
#   supervisor@demo.local  rol «Supervisor de limpieza» (Limpieza: ver/crear/editar/eliminar)
#   ana@demo.local         rol «Personal de limpieza» (Limpieza: ver/editar)
#
# Requiere PostgreSQL 16 (initdb/pg_ctl/psql), Node 22 y las dependencias del repo instaladas.
# Corre como root (usa el usuario del sistema `postgres` para el clúster).
# ════════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
DATA=/tmp/demo-pgdata; SOCK=/tmp/demosock; PUERTO=55700
export PGHOST=$SOCK PGPORT=$PUERTO PGUSER=postgres

# ── 1. PostgREST 12.2.3 ─────────────────────────────────────────────────────────
# Binario estático de la imagen oficial postgrest/postgrest:v12.2.3 (linux/amd64), bajado del
# espejo de Docker Hub de Google y verificado por el sha256 de su capa.
CAPA=sha256:2512fbf9bcfc754010eb4eda5ef696e6d8c2bcad6558c5bd31c9f5d73d1b8990
if [ ! -x "$AQUI/bin/postgrest" ]; then
  mkdir -p "$AQUI/bin"; TMP=$(mktemp -d)
  curl -sSL --max-time 300 "https://mirror.gcr.io/v2/postgrest/postgrest/blobs/$CAPA" -o "$TMP/capa.tgz"
  [ "sha256:$(sha256sum "$TMP/capa.tgz" | cut -c1-64)" = "$CAPA" ] || { echo "❌ la capa de PostgREST no coincide con su sha256"; exit 1; }
  tar -xzf "$TMP/capa.tgz" -C "$TMP" bin/postgrest && mv "$TMP/bin/postgrest" "$AQUI/bin/postgrest"; rm -rf "$TMP"
fi
echo "OK  $("$AQUI/bin/postgrest" --version)"

# ── 2. Base con todas las migraciones ───────────────────────────────────────────
id postgres >/dev/null 2>&1 || useradd -m postgres
correr() { su postgres -c "PATH=$PATH $*"; }
if [ ! -d "$DATA" ]; then
  mkdir -p "$DATA"; chown postgres "$DATA"
  correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
fi
mkdir -p "$SOCK"; chown postgres "$SOCK"
correr "pg_ctl -D $DATA status" >/dev/null 2>&1 || \
  correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK -c listen_addresses=127.0.0.1 -c timezone=America/Guatemala' -l $DATA/pg.log start" >/dev/null 2>&1 </dev/null
for _ in $(seq 1 200); do psql -q -d postgres -c 'SELECT 1' >/dev/null 2>&1 && break; sleep 0.1; done
if ! psql -lqt | cut -d'|' -f1 | grep -qw demo; then
  psql -q -d postgres -c "CREATE DATABASE demo" >/dev/null
  aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d demo -f "$1" >/dev/null; }
  aplicar "$RAIZ/scripts/schema-drift/bootstrap.sql" 2>/dev/null
  N=0; for f in "$RAIZ"/supabase/migrations/*.sql; do aplicar "$f"; N=$((N + 1)); done
  echo "OK  $N migraciones aplicadas"
fi
psql -q -v ON_ERROR_STOP=1 -d demo -f "$AQUI/ajustes.sql"

# ── 3. Empresa demo (una sola vez) ──────────────────────────────────────────────
if [ "$(psql -d demo -Atc "SELECT count(*) FROM public.companies WHERE nombre = 'Prestadora Demo'")" = "0" ]; then
  CLAVE="Demo-$(python3 -c 'import secrets; print(secrets.token_urlsafe(9))')"
  umask 077; printf 'admin@demo.local\nsupervisor@demo.local\nana@demo.local\nclave: %s\n' "$CLAVE" > "$AQUI/.credenciales"
  psql -X -q -d demo -v clave="$CLAVE" -f "$AQUI/semilla.sql" >/dev/null
  echo "OK  empresa demo sembrada (clave en scripts/demo-local/.credenciales)"
fi

# ── 4. Secretos locales y arranque de servicios ─────────────────────────────────
umask 077
[ -f "$AQUI/.jwt_secret" ] || python3 -c "import secrets; print(secrets.token_hex(32))" > "$AQUI/.jwt_secret"
SECRETO=$(cat "$AQUI/.jwt_secret")
ANON=$(node -e "
const {createHmac}=require('crypto');const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const h=b({alg:'HS256',typ:'JWT'}),p=b({role:'anon',iss:'supabase-demo',iat:1700000000,exp:2000000000});
console.log(h+'.'+p+'.'+createHmac('sha256','$SECRETO').update(h+'.'+p).digest('base64url'))")
cat > "$AQUI/.postgrest.conf" <<EOF
db-uri = "postgres://authenticator@/demo?host=$SOCK&port=$PUERTO"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRETO"
server-host = "127.0.0.1"
server-port = 54330
db-max-rows = 1000
log-level = "error"
EOF
"$AQUI/detener.sh" --solo-servicios >/dev/null 2>&1 || true
nohup "$AQUI/bin/postgrest" "$AQUI/.postgrest.conf" > "$AQUI/postgrest.log" 2>&1 < /dev/null & echo $! > "$AQUI/.pid-postgrest"
JWT_SECRET=$SECRETO nohup node "$AQUI/pasarela.mjs" > "$AQUI/pasarela.log" 2>&1 < /dev/null & echo $! > "$AQUI/.pid-pasarela"
( cd "$RAIZ" && VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=$ANON VITE_APP_ENV=development \
  nohup npx vite --port 5173 --host 127.0.0.1 --strictPort > "$AQUI/vite.log" 2>&1 < /dev/null & echo $! > "$AQUI/.pid-vite" )
for _ in $(seq 1 100); do curl -s -o /dev/null http://127.0.0.1:5173/ && break; sleep 0.3; done
echo "OK  app en http://127.0.0.1:5173 · API simulada en http://127.0.0.1:54321"
