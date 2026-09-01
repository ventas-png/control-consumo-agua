#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Prueba NEGATIVA: los escenarios tienen que fallar si la migración se mutila
# ════════════════════════════════════════════════════════════════════════════
#
# Una batería de asserts que pasa siempre no prueba nada. Esto lo comprueba de
# la única manera que vale: quitando de la migración, una por una, cada
# sentencia que cierra la exposición, y exigiendo que los escenarios ROMPAN.
#
#   1. sin el DROP POLICY           → la policy USING (true) sigue viva
#   2. sin el REVOKE de PUBLIC      → (hoy no cambia nada: PUBLIC no figura en
#                                      el ACL; se prueba igual para que si
#                                      alguien concede a PUBLIC, el guard exista)
#   3. sin el REVOKE de anon        → anon conserva el privilegio
#   4. sin el REVOKE de authenticated → authenticated conserva el privilegio
#
# El caso 2 es el interesante: hoy pasa aunque se quite, porque PUBLIC no tiene
# el GRANT. En vez de fingir que falla, se declara como tal y se comprueba lo
# que sí se puede comprobar: que la sentencia esté en el archivo.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRACION="$RAIZ/supabase/migrations/20260907001300_cerrar_lectura_publica_payment_requests.sql"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
COMO=""
if [[ "$(id -u)" == "0" ]]; then
  COMO="$(id -nu 1000 2>/dev/null || echo postgres)"
  # `mktemp -d` deja el padre en 0700 de root: sin esto el usuario sin
  # privilegios no puede ni entrar al directorio, e initdb falla en silencio.
  chmod 755 "$TMP"; chown "$COMO" "$TMP"
fi
correr() { if [[ -n "$COMO" ]]; then su "$COMO" -c "$1"; else bash -c "$1"; fi }

# Una base limpia por caso: el estado no se puede arrastrar entre ellos.
prueba() {
  local etiqueta="$1" patron="$2" debe_romper="$3"
  local dir="$TMP/caso$RANDOM"; mkdir -p "$dir/sock"
  if [[ -n "$COMO" ]]; then chown -R "$COMO" "$dir"; fi
  local puerto=$((55500 + RANDOM % 400))

  correr "$PGBIN/initdb -D $dir/data -U postgres --auth=trust" >/dev/null 2>&1 \
    || { echo "  ✗ $etiqueta → initdb falló" >&2; return 1; }
  correr "$PGBIN/pg_ctl -D $dir/data -o '-p $puerto -k $dir/sock -c listen_addresses=' -l $dir/pg.log start" >/dev/null 2>&1 \
    || { echo "  ✗ $etiqueta → el servidor no arrancó" >&2; return 1; }
  # pg_ctl vuelve antes de aceptar conexiones.
  local i=0
  until psql -h "$dir/sock" -p "$puerto" -U postgres -d postgres -tAc 'select 1' >/dev/null 2>&1; do
    i=$((i+1)); [[ $i -gt 30 ]] && { echo "  ✗ $etiqueta → sin conexión" >&2; return 1; }; sleep 1
  done
  local PSQL=(psql -h "$dir/sock" -p "$puerto" -U postgres -d postgres)

  grep -vF "$patron" "$MIGRACION" > "$dir/mutilada.sql"

  local ok=1
  "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -f "$RAIZ/scripts/rls-payment-requests-sandbox.sql" >/dev/null 2>&1
  "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -f "$dir/mutilada.sql" >/dev/null 2>&1 || true
  "${PSQL[@]}" -q -v ON_ERROR_STOP=1 -v despues=1 \
    -f "$RAIZ/scripts/rls-payment-requests-asserts.sql" >/dev/null 2>&1 || ok=0

  correr "$PGBIN/pg_ctl -D $dir/data stop -m immediate" >/dev/null 2>&1 || true

  if [[ "$debe_romper" == "si" ]]; then
    if [[ "$ok" == "0" ]]; then echo "  ✅ $etiqueta → los escenarios FALLAN, como debe ser"
    else echo "  ✗ $etiqueta → los escenarios pasaron igual: NO detectan la omisión" >&2; return 1; fi
  else
    if [[ "$ok" == "1" ]]; then echo "  ⏭️  $etiqueta → pasa igual (documentado: PUBLIC no tiene el GRANT hoy)"
    else echo "  ✅ $etiqueta → los escenarios FALLAN"; fi
  fi
}

echo "→ Mutilando la migración, una sentencia por vez"
prueba "sin DROP POLICY payment_requests_select" \
       "DROP POLICY IF EXISTS payment_requests_select" si
prueba "sin REVOKE SELECT ... FROM anon" \
       "REVOKE SELECT ON public.payment_requests FROM anon" si
prueba "sin REVOKE SELECT ... FROM authenticated" \
       "REVOKE SELECT ON public.payment_requests FROM authenticated" si
prueba "sin REVOKE SELECT ... FROM PUBLIC" \
       "REVOKE SELECT ON public.payment_requests FROM PUBLIC" no

echo "→ La sentencia de PUBLIC tiene que estar en el archivo aunque hoy sea no-op"
grep -qF "REVOKE SELECT ON public.payment_requests FROM PUBLIC;" "$MIGRACION" \
  && echo "  ✅ presente" \
  || { echo "  ✗ ausente" >&2; exit 1; }

echo "✅ Los escenarios dependen de verdad del contenido de la migración."
