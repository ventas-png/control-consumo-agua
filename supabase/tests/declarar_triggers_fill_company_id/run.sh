#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260912015504 — los dos triggers de
# fill_company_id_from_user() que sólo existían en producción.
#
# QUÉ COMPRUEBA
#   1/8  el fixture reproduce el hueco de la reconstrucción: sin los triggers,
#        `authenticated` no puede insertar sin company_id (RLS, 42501)
#   2/8  tras la migración, los dos triggers celda por celda en pg_catalog y
#        el texto de pg_get_triggerdef igual al de producción
#   3/8  INSERCIONES reales y transaccionales como `authenticated`, que NO
#        tiene EXECUTE sobre la función: company_id se rellena igual
#   4/8  IDEMPOTENCIA: aplicarla dos veces no falla, deja el mismo estado y
#        conserva los OIDs (no hubo DROP/CREATE)
#   5/8  NO-OP sobre triggers PREEXISTENTES con la definición exacta (el caso
#        de producción): mismos OIDs antes y después
#   6/8  ABORTO ante un homónimo con OTRA definición (otra función, AFTER,
#        STATEMENT, UPDATE, WHEN, deshabilitado, otra tabla): excepción 42710,
#        el trigger ajeno queda intacto y el otro NO se crea
#   7/8  MUTACIÓN · quitar CUALQUIERA de los dos triggers rompe el arnés
#        (assert e inserciones)
#   8/8  MUTACIÓN · quitar cualquiera de las dos filas de la migración rompe
#        el arnés
#
# USO
#   supabase/tests/declarar_triggers_fill_company_id/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql). No toca ningún proyecto
# remoto: levanta un clúster temporal, corre todo y lo destruye.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIGRACION="$RAIZ/supabase/migrations/20260912015504_declarar_triggers_fill_company_id.sql"

[ -f "$MIGRACION" ] || { echo "❌ no existe $MIGRACION"; exit 1; }

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

# El socket unix tiene un tope de 107 bytes: se usa una ruta corta a propósito.
DATA=$(mktemp -d /tmp/trgfilldata.XXXX)
SOCK=$(mktemp -d /tmp/trgfillsock.XXXX)
TRABAJO=$(mktemp -d /tmp/trgfillmut.XXXX)
PUERTO=${PGPORT_TEST:-55499}

limpiar() {
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK" "$TRABAJO"
}
trap limpiar EXIT

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

psql -q -d postgres -c "CREATE ROLE anon NOINHERIT; CREATE ROLE authenticated NOINHERIT; CREATE ROLE service_role NOINHERIT BYPASSRLS;" >/dev/null

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
notas()   { psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" 2>&1 | sed -n 's/.*NOTICE:  /  /p'; }
oids()    { psql -tAq -d "$1" -c "SELECT tgname || '=' || oid FROM pg_trigger WHERE tgname IN ('fuentes_agua_fill_company_id','registros_calidad_fill_company_id') AND NOT tgisinternal ORDER BY tgname"; }
defs()    { psql -tAq -d "$1" -c "SET search_path = public; SELECT tgname || ' → ' || pg_get_triggerdef(oid) || ' [' || tgenabled::text || ']' FROM pg_trigger WHERE tgname IN ('fuentes_agua_fill_company_id','registros_calidad_fill_company_id') AND NOT tgisinternal ORDER BY tgname"; }

preparar() {
  psql -q -d postgres -c "CREATE DATABASE $1" >/dev/null
  aplicar "$1" "$AQUI/fixture.sql"
}

FALLOS=0
ok()  { echo "  OK    $1"; }
mal() { echo "  ✗     $1"; FALLOS=$((FALLOS + 1)); }

preparar trg

echo "── 1/8 · el fixture reproduce el hueco de la reconstrucción ────────────"
notas trg "$AQUI/assert_pre.sql"

echo "── 2/8 · la migración y los dos triggers, celda por celda ──────────────"
PGOPTIONS="-c client_min_messages=notice" psql -q -v ON_ERROR_STOP=1 -d trg -f "$MIGRACION" 2>&1 | sed -n 's/.*NOTICE:  /  /p'
notas trg "$AQUI/assert.sql"

echo "── 3/8 · inserciones reales y transaccionales como authenticated ───────"
notas trg "$AQUI/inserts.sql"

echo "── 4/8 · idempotencia: re-aplicar conserva estado y OIDs ───────────────"
ANTES=$(oids trg)
PGOPTIONS="-c client_min_messages=notice" psql -q -v ON_ERROR_STOP=1 -d trg -f "$MIGRACION" 2>&1 | sed -n 's/.*NOTICE:  /  /p'
DESPUES=$(oids trg)
if [ "$ANTES" = "$DESPUES" ] && [ -n "$ANTES" ]; then
  ok "mismos OIDs tras re-aplicar: ${ANTES//$'\n'/ · }"
else
  mal "los OIDs cambiaron al re-aplicar (hubo DROP/CREATE): «$ANTES» → «$DESPUES»"
fi
psql -q -v ON_ERROR_STOP=1 -d trg -f "$AQUI/assert.sql" >/dev/null 2>&1 && ok "re-aplicar no falla y deja exactamente el mismo estado" || mal "el assert falla tras re-aplicar"

echo "── 5/8 · no-op sobre triggers preexistentes con la definición exacta ───"
# El caso de producción: los dos ya están, creados a mano, con la misma forma.
preparar pre
psql -q -v ON_ERROR_STOP=1 -d pre -c "
  CREATE TRIGGER fuentes_agua_fill_company_id BEFORE INSERT ON public.fuentes_agua
    FOR EACH ROW EXECUTE FUNCTION public.fill_company_id_from_user();
  CREATE TRIGGER registros_calidad_fill_company_id BEFORE INSERT ON public.registros_calidad
    FOR EACH ROW EXECUTE FUNCTION public.fill_company_id_from_user();" >/dev/null
ANTES=$(oids pre); DEFS_ANTES=$(defs pre)
SALIDA=$(PGOPTIONS="-c client_min_messages=notice" psql -q -v ON_ERROR_STOP=1 -d pre -f "$MIGRACION" 2>&1 | sed -n 's/.*NOTICE:  //p')
DESPUES=$(oids pre); DEFS_DESPUES=$(defs pre)
echo "$SALIDA" | sed 's/^/  /'
[ "$(echo "$SALIDA" | grep -c 'no-op')" -eq 2 ] && ok "la migración anunció no-op para los dos" || mal "la migración no anunció dos no-op"
[ "$ANTES" = "$DESPUES" ] && ok "mismos OIDs: no hubo DROP/CREATE sobre lo que ya estaba" || mal "OIDs distintos sobre triggers preexistentes: «$ANTES» → «$DESPUES»"
[ "$DEFS_ANTES" = "$DEFS_DESPUES" ] && ok "misma definición antes y después" || mal "la definición cambió"
psql -q -v ON_ERROR_STOP=1 -d pre -f "$AQUI/assert.sql" >/dev/null 2>&1 && ok "y el estado es el de producción" || mal "el assert falla sobre los preexistentes"

echo "── 6/8 · aborto ante un homónimo con OTRA definición ───────────────────"
# Cada variante en una base recién preparada: la migración TIENE que fallar
# con 42710, dejar el trigger ajeno byte a byte igual, y NO crear el otro.
N=0
debe_abortar() {
  local etiqueta="$1" sql="$2"
  N=$((N + 1)); local db="conf$N"
  preparar "$db"
  psql -q -v ON_ERROR_STOP=1 -d "$db" -c "$sql" >/dev/null
  local antes; antes=$(psql -tAq -d "$db" -c "SELECT tgname||'='||oid||' '||pg_get_triggerdef(oid)||' ['||tgenabled::text||']' FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname")
  local err rc=0
  err=$(PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$MIGRACION" 2>&1) || rc=$?
  local despues; despues=$(psql -tAq -d "$db" -c "SELECT tgname||'='||oid||' '||pg_get_triggerdef(oid)||' ['||tgenabled::text||']' FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname")
  if [ "$rc" -eq 0 ]; then mal "$etiqueta — la migración PASÓ y debía abortar"; return; fi
  if ! grep -q '42710\|OTRA definición\|sobre otra tabla' <<<"$err"; then mal "$etiqueta — abortó, pero con otro error: $(tail -1 <<<"$err")"; return; fi
  if [ "$antes" != "$despues" ]; then mal "$etiqueta — abortó, pero el catálogo de triggers cambió"; return; fi
  local n; n=$(psql -tAq -d "$db" -c "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal")
  [ "$n" -eq 1 ] || { mal "$etiqueta — quedaron $n triggers; el otro no debía crearse"; return; }
  ok "$etiqueta → 42710, trigger ajeno intacto, nada más creado"
}
debe_abortar "mismo nombre, AFTER INSERT" \
  "CREATE TRIGGER fuentes_agua_fill_company_id AFTER INSERT ON public.fuentes_agua FOR EACH ROW EXECUTE FUNCTION public.fill_company_id_from_user();"
debe_abortar "mismo nombre, FOR EACH STATEMENT" \
  "CREATE TRIGGER registros_calidad_fill_company_id BEFORE INSERT ON public.registros_calidad FOR EACH STATEMENT EXECUTE FUNCTION public.fill_company_id_from_user();"
debe_abortar "mismo nombre, otra función" \
  "CREATE TRIGGER fuentes_agua_fill_company_id BEFORE INSERT ON public.fuentes_agua FOR EACH ROW EXECUTE FUNCTION public.otra_fn();"
debe_abortar "mismo nombre, BEFORE UPDATE" \
  "CREATE TRIGGER registros_calidad_fill_company_id BEFORE UPDATE ON public.registros_calidad FOR EACH ROW EXECUTE FUNCTION public.fill_company_id_from_user();"
debe_abortar "mismo nombre, BEFORE INSERT OR UPDATE" \
  "CREATE TRIGGER fuentes_agua_fill_company_id BEFORE INSERT OR UPDATE ON public.fuentes_agua FOR EACH ROW EXECUTE FUNCTION public.fill_company_id_from_user();"
debe_abortar "mismo nombre, con WHEN" \
  "CREATE TRIGGER registros_calidad_fill_company_id BEFORE INSERT ON public.registros_calidad FOR EACH ROW WHEN (NEW.company_id IS NULL) EXECUTE FUNCTION public.fill_company_id_from_user();"
debe_abortar "mismo nombre, deshabilitado" \
  "CREATE TRIGGER fuentes_agua_fill_company_id BEFORE INSERT ON public.fuentes_agua FOR EACH ROW EXECUTE FUNCTION public.fill_company_id_from_user(); ALTER TABLE public.fuentes_agua DISABLE TRIGGER fuentes_agua_fill_company_id;"
debe_abortar "mismo nombre, sobre otra tabla" \
  "CREATE TRIGGER fuentes_agua_fill_company_id BEFORE INSERT ON public.otra_tabla FOR EACH ROW EXECUTE FUNCTION public.fill_company_id_from_user();"

echo "── 7/8 · mutación: quitar cualquiera de los dos triggers rompe el arnés ─"
for par in "fuentes_agua_fill_company_id public.fuentes_agua" "registros_calidad_fill_company_id public.registros_calidad"; do
  set -- $par
  N=$((N + 1)); db="drop$N"
  preparar "$db"
  aplicar "$db" "$MIGRACION"
  psql -q -v ON_ERROR_STOP=1 -d "$db" -c "DROP TRIGGER $1 ON $2" >/dev/null
  if psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$AQUI/assert.sql" >/dev/null 2>&1; then
    mal "sin $1, assert.sql PASÓ y debía fallar"
  else
    ok "sin $1 → assert.sql en rojo"
  fi
  if psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$AQUI/inserts.sql" >/dev/null 2>&1; then
    mal "sin $1, inserts.sql PASÓ y debía fallar"
  else
    ok "sin $1 → inserts.sql en rojo (la inserción sin company_id vuelve a morir en RLS)"
  fi
done

echo "── 8/8 · mutación: quitar una fila de la migración rompe el arnés ──────"
# Quita la fila de una tabla de los DOS bloques (declaración y postcondición):
# si sólo se quitara del primero, la propia postcondición de la migración la
# cazaría y la prueba no estaría midiendo el arnés. Cuando la fila quitada es
# la última del VALUES, la anterior pierde su coma final.
sin_fila() {
  local tabla="$1"
  awk -v t="('public.$tabla'," '
    index($0, t) { next }
    { lineas[++n] = $0 }
    END {
      for (i = 1; i <= n; i++) {
        if (lineas[i] ~ /^ *\(.public\./ && lineas[i+1] ~ /^ *\) AS t\(/) sub(/,[ ]*$/, "", lineas[i])
        print lineas[i]
      }
    }' "$MIGRACION"
}
for tabla in fuentes_agua registros_calidad; do
  N=$((N + 1)); db="mut$N"
  mutante="$TRABAJO/sin_$tabla.sql"
  sin_fila "$tabla" > "$mutante"
  if [ "$(wc -l < "$mutante")" -ne "$(( $(wc -l < "$MIGRACION") - 2 ))" ]; then
    mal "no se pudo quitar la fila de $tabla — ¿cambió el formato de la migración?"; continue
  fi
  [ -n "$COMO" ] && chmod 644 "$mutante"
  preparar "$db"
  if ! PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$mutante" >/dev/null 2>&1; then
    mal "el mutante sin $tabla no aplicó (debía aplicar y ser el arnés quien lo cace)"; continue
  fi
  if psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$AQUI/assert.sql" >/dev/null 2>&1; then
    mal "migración sin la fila de $tabla: assert.sql PASÓ y debía fallar"
  else
    ok "migración sin la fila de $tabla → assert.sql en rojo"
  fi
done

echo
if [ "$FALLOS" -gt 0 ]; then
  echo "❌ declarar_triggers_fill_company_id: $FALLOS comprobación(es) fallaron."
  exit 1
fi
echo "✅ declarar_triggers_fill_company_id: los dos triggers de producción, creados desde cero, no-op donde ya están, abortando ante homónimos, con inserciones reales y decisivos por mutación."
