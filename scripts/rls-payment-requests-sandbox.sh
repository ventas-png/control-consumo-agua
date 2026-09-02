#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# payment_requests: que la exposición sin autenticar quede cerrada de verdad
# ════════════════════════════════════════════════════════════════════════════
#
# La migración NO se copia: se aplica el archivo REAL que se va a desplegar, así
# que lo que se prueba es exactamente lo que se despliega. Si alguien lo edita y
# quita el DROP o un REVOKE, esto lo dice.
#
# Y el fixture parte del estado INSEGURO de producción, no del que declara el
# repositorio. Eso es lo que hace que la prueba signifique algo: primero se
# comprueba que anon SÍ puede leer (si no, el fixture no reproduce el problema
# y todo lo demás es teatro), después se aplica la migración, y recién entonces
# se exige el cierre.
#
#   scripts/rls-payment-requests-sandbox.sh            # levanta su propio Postgres
#   PGURL=postgres://... scripts/rls-payment-requests-sandbox.sh
#
# Requiere: initdb/pg_ctl/psql (postgresql-16) o un PGURL a una base DESECHABLE.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRACION="$RAIZ/supabase/migrations/20260907001300_cerrar_lectura_publica_payment_requests.sql"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

[[ -f "$MIGRACION" ]] || { echo "✗ No existe $MIGRACION" >&2; exit 1; }

# ── Control de que la migración trae lo que tiene que traer ─────────────────
# Si el archivo pierde una de estas cuatro sentencias, el sandbox aborta acá en
# vez de dar un verde que no significa nada.
falta=0
for patron in \
  'DROP POLICY IF EXISTS payment_requests_select ON public.payment_requests' \
  'REVOKE SELECT ON public.payment_requests FROM PUBLIC' \
  'REVOKE SELECT ON public.payment_requests FROM anon' \
  'REVOKE SELECT ON public.payment_requests FROM authenticated'
do
  grep -qF "$patron" "$MIGRACION" || { echo "✗ La migración no contiene: $patron" >&2; falta=1; }
done
[[ "$falta" == "0" ]] || exit 1

# ── Base desechable ─────────────────────────────────────────────────────────
if [[ -n "${PGURL:-}" ]]; then
  PSQL=(psql "$PGURL")
else
  PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
  DATA="$TMP/data"; SOCK="$TMP/sock"; mkdir -p "$SOCK"
  # initdb se niega a correr como root; si lo somos, usamos un usuario sin
  # privilegios (patrón habitual en contenedores de CI).
  COMO=""
  if [[ "$(id -u)" == "0" ]]; then
    COMO="$(id -nu 1000 2>/dev/null || echo postgres)"; chown -R "$COMO" "$TMP"
  fi
  correr() { if [[ -n "$COMO" ]]; then su "$COMO" -c "$1"; else bash -c "$1"; fi }

  correr "$PGBIN/initdb -D $DATA -U postgres --auth=trust" >/dev/null
  correr "$PGBIN/pg_ctl -D $DATA -o '-p 55433 -k $SOCK -c listen_addresses=' -l $TMP/pg.log start" >/dev/null
  trap 'correr "$PGBIN/pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
  PSQL=(psql -h "$SOCK" -p 55433 -U postgres -d postgres)
fi

filtrar() { grep -E '^(NOTICE|──|✅|ERROR|FALLO)|^psql:' | sed 's/^NOTICE:  //'; }

echo "→ Montando el estado INSEGURO de producción"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -f "$RAIZ/scripts/rls-payment-requests-sandbox.sql" >/dev/null

echo "→ Control: el fixture reproduce la vulnerabilidad"
"${PSQL[@]}" -v ON_ERROR_STOP=1 -v antes=1 \
  -f "$RAIZ/scripts/rls-payment-requests-asserts.sql" 2>&1 | filtrar

echo "→ Aplicando la migración REAL: $(basename "$MIGRACION")"
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 -f "$MIGRACION" >/dev/null

echo "→ Escenarios de cierre"
"${PSQL[@]}" -v ON_ERROR_STOP=1 -v despues=1 \
  -f "$RAIZ/scripts/rls-payment-requests-asserts.sql" 2>&1 | filtrar

echo "✅ payment_requests: anon y authenticated no pueden leerla."
