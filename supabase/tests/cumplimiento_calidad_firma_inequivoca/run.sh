#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260913032502 — la llamada ambigua del cálculo
# autoritativo de calidad de agua (SQLSTATE 42725).
#
# QUÉ COMPRUEBA
#   1/9  el fixture, construido con los archivos REALES de S22 (20260603140000)
#        y S23 (20260605160000), reproduce el defecto: INSERT y UPDATE de
#        parametros mueren con 42725, como postgres y como authenticated
#   2/9  tras la migración, el catálogo celda por celda: el trigger re-apuntado
#        (mismo nombre, tgtype 23, UPDATE OF con las cuatro columnas, texto de
#        pg_get_triggerdef exacto), la función nueva INVOKER con search_path '',
#        la ACL de la firma de tres argumentos, y que la sobrecarga de dos
#        argumentos y la función vieja NO cambiaron (cuerpo y ACL byte a byte)
#   3/9  comportamiento REAL como authenticated: INSERT, UPDATE de parametros y
#        de fuente_id, pisado de lo que mande el cliente, override de la empresa
#        correcta, fallback global, fuente/company_id ajenos rechazados, anon sin
#        RPC nueva, aislamiento del override ajeno por RPC
#   4/9  IDEMPOTENCIA: aplicar dos veces no falla, conserva el OID del trigger
#        (no hubo DROP/CREATE) y el de la función, y deja el mismo estado
#   5/9  ABORTO sin tocar nada ante un homónimo en otra tabla, un trigger con
#        otra definición, o una firma de tres argumentos convertida en DEFINER
#   6/9  MUTACIÓN · restaurar la llamada ambigua (re-apuntar el trigger a la
#        función vieja, o volver a la llamada de dos argumentos) → 42725 otra vez
#   7/9  MUTACIÓN · quitar el EXECUTE de authenticated → 42501 (el GRANT no es
#        gratuito: es lo que separa «corre» de «permission denied»)
#   8/9  MUTACIÓN · quitar el aislamiento (RLS de calidad_tipologias, o la
#        policy de fuentes_agua) → el arnés lo detecta
#   9/9  MUTACIÓN · mutilar la migración (sin GRANT, sin re-apuntar, sin el
#        cheque de fuente visible) → rojo
#
# USO
#   supabase/tests/cumplimiento_calidad_firma_inequivoca/run.sh
# Requiere binarios de PostgreSQL (initdb/pg_ctl/psql) ≥ 14 (CREATE OR REPLACE
# TRIGGER). No toca ningún proyecto remoto.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../../.." && pwd)"
MIG="$RAIZ/supabase/migrations"
MIGRACION="$MIG/20260913032502_corregir_llamada_ambigua_cumplimiento_calidad.sql"
S22="$MIG/20260603140000_calidad_cumplimiento_server_side.sql"
S23="$MIG/20260605160000_calidad_tipologias_catalogo.sql"

for f in "$MIGRACION" "$S22" "$S23"; do [ -f "$f" ] || { echo "❌ no existe $f"; exit 1; }; done

for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
[ -n "${PGBIN:-}" ] && PATH="$PGBIN:$PATH"
export PATH
command -v initdb >/dev/null || { echo "❌ falta initdb (instalá PostgreSQL)"; exit 1; }

DATA=$(mktemp -d /tmp/calfirmadata.XXXX)
SOCK=$(mktemp -d /tmp/calfirmasock.XXXX)
TRABAJO=$(mktemp -d /tmp/calfirmamut.XXXX)
PUERTO=${PGPORT_TEST:-55500}

COMO=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -m postgres
  chown -R postgres "$DATA" "$SOCK" "$TRABAJO"
  COMO="su postgres -c"
fi
correr() { if [ -n "$COMO" ]; then su postgres -c "PATH=$PATH $*"; else eval "$*"; fi; }

# pg_ctl se niega a correr como root: el stop va por `correr`, igual que el
# start, o un fallo a mitad del arnés dejaría el servidor vivo en el puerto.
limpiar() {
  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK" "$TRABAJO"
}
trap limpiar EXIT

correr "initdb -D $DATA -U postgres --auth=trust" >/dev/null
correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null
sleep 2

export PGHOST="$SOCK" PGPORT="$PUERTO" PGUSER=postgres

psql -q -d postgres -c "CREATE ROLE anon NOINHERIT; CREATE ROLE authenticated NOINHERIT; CREATE ROLE service_role NOINHERIT BYPASSRLS;" >/dev/null

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
notas()   { psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" 2>&1 | sed -n 's/.*NOTICE:  /  /p'; }
migrar()  { PGOPTIONS="-c client_min_messages=notice" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "${2:-$MIGRACION}" 2>&1 | sed -n 's/.*NOTICE:  /  /p'; }
oid_trg() { psql -tAq -d "$1" -c "SELECT oid FROM pg_trigger WHERE tgname = 'registros_calidad_cumplimiento' AND NOT tgisinternal"; }
oid_fn()  { psql -tAq -d "$1" -c "SELECT coalesce(to_regprocedure('public.trg_registros_calidad_cumplimiento_catalogo()')::oid::text, 'AUSENTE')"; }
fn_trg()  { psql -tAq -d "$1" -c "SELECT tgfoid::regprocedure::text FROM pg_trigger WHERE tgname = 'registros_calidad_cumplimiento' AND NOT tgisinternal"; }
# Cuerpo + ACL + volatilidad de los dos objetos que NO se tocan.
intactos() { psql -tAq -d "$1" -c "SET search_path = public; SELECT proname || '(' || pg_get_function_identity_arguments(oid) || ') ' || md5(prosrc) || ' ' || coalesce(proacl::text,'<default>') || ' ' || provolatile::text || ' ' || prosecdef::text FROM pg_proc WHERE oid IN (to_regprocedure('public.calcular_cumplimiento_calidad(text, jsonb)'), to_regprocedure('public.trg_registros_calidad_cumplimiento()')) ORDER BY 1"; }

preparar() {
  psql -q -d postgres -c "CREATE DATABASE $1" >/dev/null
  aplicar "$1" "$AQUI/fixture.sql"
  aplicar "$1" "$S22"
  aplicar "$1" "$S23"
  aplicar "$1" "$AQUI/semilla.sql"
}

FALLOS=0
ok()  { echo "  OK    $1"; }
mal() { echo "  ✗     $1"; FALLOS=$((FALLOS + 1)); }

# Corre un .sql y exige que FALLE con un texto dado en el error.
debe_fallar_con() { # db archivo texto descripcion
  local salida
  # VERBOSITY=verbose para que la línea ERROR traiga el SQLSTATE (42725, 42501…).
  if salida=$(psql -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -d "$1" -f "$2" 2>&1); then
    mal "$4 — NO falló y debía"
  elif echo "$salida" | grep -q -- "$3"; then
    ok "$4 — falla con «$3»"
  else
    mal "$4 — falló, pero no con «$3»: $(echo "$salida" | grep -m1 'ERROR' || echo "$salida" | tail -1)"
  fi
}

preparar cal

echo "── 1/9 · el fixture (S22 + S23 reales) reproduce el 42725 ─────────────────"
notas cal "$AQUI/assert_pre.sql"

echo "── 2/9 · la migración y el catálogo, celda por celda ──────────────────────"
ANTES_INTACTOS=$(intactos cal); OID_TRG_ANTES=$(oid_trg cal)
migrar cal
notas cal "$AQUI/assert.sql"
[ "$(intactos cal)" = "$ANTES_INTACTOS" ] && ok "la sobrecarga (text, jsonb) y trg_registros_calidad_cumplimiento() quedaron byte a byte igual (cuerpo, ACL, volatilidad, INVOKER)" \
  || mal "algo cambió en los objetos que no debían tocarse:\n$ANTES_INTACTOS\n→\n$(intactos cal)"
[ "$(oid_trg cal)" = "$OID_TRG_ANTES" ] && ok "el trigger conserva su OID ($OID_TRG_ANTES): CREATE OR REPLACE TRIGGER no hizo DROP/CREATE" \
  || mal "el OID del trigger cambió ($OID_TRG_ANTES → $(oid_trg cal)): hubo DROP/CREATE"

echo "── 3/9 · comportamiento real como authenticated (y anon) ──────────────────"
notas cal "$AQUI/inserts.sql"

echo "── 4/9 · idempotencia: re-aplicar conserva OIDs y estado ──────────────────"
T1=$(oid_trg cal); F1=$(oid_fn cal)
migrar cal
T2=$(oid_trg cal); F2=$(oid_fn cal)
[ "$T1" = "$T2" ] && [ -n "$T1" ] && ok "mismo OID del trigger tras re-aplicar ($T1)" || mal "el OID del trigger cambió al re-aplicar ($T1 → $T2)"
[ "$F1" = "$F2" ] && [ "$F1" != "AUSENTE" ] && ok "mismo OID de la función tras re-aplicar ($F1)" || mal "el OID de la función cambió al re-aplicar ($F1 → $F2)"
psql -q -v ON_ERROR_STOP=1 -d cal -f "$AQUI/assert.sql"  >/dev/null 2>&1 && ok "re-aplicar deja exactamente el mismo catálogo" || mal "el assert falla tras re-aplicar"
psql -q -v ON_ERROR_STOP=1 -d cal -f "$AQUI/inserts.sql" >/dev/null 2>&1 && ok "re-aplicar deja el mismo comportamiento"       || mal "inserts.sql falla tras re-aplicar"
[ "$(intactos cal)" = "$ANTES_INTACTOS" ] && ok "los objetos intactos siguen intactos" || mal "re-aplicar tocó los objetos intactos"

echo "── 5/9 · aborto sin tocar nada ante un mundo distinto ─────────────────────"
abortar() { # nombre sql_previo texto_error descripcion
  preparar "$1"
  psql -q -v ON_ERROR_STOP=1 -d "$1" -c "$2" >/dev/null
  local antes_fn antes_intactos; antes_fn=$(fn_trg "$1"); antes_intactos=$(intactos "$1")
  debe_fallar_con "$1" "$MIGRACION" "$3" "$4"
  [ "$(oid_fn "$1")" = "AUSENTE" ] && ok "      … y no creó la función nueva" || mal "      … pero creó la función nueva"
  [ "$(fn_trg "$1")" = "$antes_fn" ] && [ "$(intactos "$1")" = "$antes_intactos" ] && ok "      … y no tocó el trigger ni los objetos intactos" || mal "      … pero tocó el trigger o los objetos intactos"
}
abortar ab1 "CREATE TABLE public.otra (id int PRIMARY KEY, parametros jsonb, fuente_id uuid, cumplimiento jsonb, cumple_total boolean);
             CREATE TRIGGER registros_calidad_cumplimiento BEFORE INSERT ON public.otra FOR EACH ROW EXECUTE FUNCTION public.trg_registros_calidad_cumplimiento();" \
  "no sobre registros_calidad" "homónimo en OTRA tabla"
abortar ab2 "DROP TRIGGER registros_calidad_cumplimiento ON public.registros_calidad;
             CREATE TRIGGER registros_calidad_cumplimiento AFTER INSERT ON public.registros_calidad FOR EACH ROW EXECUTE FUNCTION public.trg_registros_calidad_cumplimiento();" \
  "OTRA definición" "trigger homónimo con otra definición (AFTER)"
abortar ab3 "DROP TRIGGER registros_calidad_cumplimiento ON public.registros_calidad;
             CREATE TRIGGER registros_calidad_cumplimiento BEFORE INSERT ON public.registros_calidad FOR EACH ROW EXECUTE FUNCTION public.fill_company_id_from_user();" \
  "OTRA definición" "trigger homónimo ejecutando otra función"
abortar ab4 "ALTER FUNCTION public.calcular_cumplimiento_calidad(text, jsonb, uuid) SECURITY DEFINER;" \
  "SECURITY DEFINER" "la firma de tres argumentos convertida en DEFINER (el GRANT sería una escalada)"

echo "── 6/9 · mutación: restaurar la llamada ambigua → vuelve el 42725 ─────────"
preparar m1; migrar m1 >/dev/null
psql -q -v ON_ERROR_STOP=1 -d m1 -c "CREATE OR REPLACE TRIGGER registros_calidad_cumplimiento BEFORE INSERT OR UPDATE OF parametros, fuente_id ON public.registros_calidad FOR EACH ROW EXECUTE FUNCTION public.trg_registros_calidad_cumplimiento();" >/dev/null
debe_fallar_con m1 "$AQUI/inserts.sql" "42725" "re-apuntar el trigger a la función vieja de S22"
preparar m2; migrar m2 >/dev/null
psql -q -v ON_ERROR_STOP=1 -d m2 -c "CREATE OR REPLACE FUNCTION public.trg_registros_calidad_cumplimiento_catalogo() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS \$\$
  DECLARE v_tipo text; v_result jsonb;
  BEGIN
    SELECT fa.tipo_agua INTO v_tipo FROM public.fuentes_agua fa WHERE fa.id = NEW.fuente_id;
    v_result := public.calcular_cumplimiento_calidad(COALESCE(v_tipo, ''), COALESCE(NEW.parametros, '{}'::jsonb));
    NEW.cumplimiento := v_result -> 'cumplimiento'; NEW.cumple_total := (v_result ->> 'cumple_total')::boolean; RETURN NEW;
  END \$\$;" >/dev/null
debe_fallar_con m2 "$AQUI/inserts.sql" "42725" "volver a la llamada de DOS argumentos dentro de la función nueva"

echo "── 7/9 · mutación: sin EXECUTE para authenticated → 42501 ─────────────────"
preparar m3; migrar m3 >/dev/null
psql -q -v ON_ERROR_STOP=1 -d m3 -c "REVOKE EXECUTE ON FUNCTION public.calcular_cumplimiento_calidad(text, jsonb, uuid) FROM authenticated;" >/dev/null
debe_fallar_con m3 "$AQUI/inserts.sql" "42501" "revocar el EXECUTE de authenticated sobre la firma de tres argumentos"
debe_fallar_con m3 "$AQUI/assert.sql"  "authenticated SÍ ejecuta" "… y el assert de catálogo también lo ve"

echo "── 8/9 · mutación: sin aislamiento → el arnés lo detecta ──────────────────"
preparar m4; migrar m4 >/dev/null
psql -q -v ON_ERROR_STOP=1 -d m4 -c "ALTER TABLE public.calidad_tipologias DISABLE ROW LEVEL SECURITY;" >/dev/null
debe_fallar_con m4 "$AQUI/inserts.sql" "override de B" "apagar la RLS de calidad_tipologias (A usaría el override de B)"
preparar m5; migrar m5 >/dev/null
psql -q -v ON_ERROR_STOP=1 -d m5 -c "DROP POLICY fuentes_agua_select ON public.fuentes_agua; CREATE POLICY fuentes_agua_select ON public.fuentes_agua FOR SELECT TO authenticated USING (true);" >/dev/null
debe_fallar_con m5 "$AQUI/inserts.sql" "fuente de otra empresa" "abrir la policy de SELECT de fuentes_agua (A colgaría un análisis de la fuente de B)"

echo "── 9/9 · mutación: mutilar la migración → rojo ────────────────────────────"
# (a) sin el GRANT a authenticated: la propia postcondición aborta.
grep -v "TO authenticated, service_role;" "$MIGRACION" > "$TRABAJO/sin_grant.sql"
preparar m6
debe_fallar_con m6 "$TRABAJO/sin_grant.sql" "NO puede ejecutar" "sin el GRANT a authenticated: la postcondición de la migración aborta"
# (b) sin re-apuntar el trigger: la postcondición aborta (sigue la función vieja).
sed '/^CREATE OR REPLACE TRIGGER registros_calidad_cumplimiento$/,/EXECUTE FUNCTION public.trg_registros_calidad_cumplimiento_catalogo();$/d' "$MIGRACION" > "$TRABAJO/sin_trigger.sql"
grep -q "^CREATE OR REPLACE TRIGGER" "$TRABAJO/sin_trigger.sql" && mal "la mutación (b) no quitó el CREATE OR REPLACE TRIGGER" || true
preparar m7
debe_fallar_con m7 "$TRABAJO/sin_trigger.sql" "no quedó como se declaró" "sin re-apuntar el trigger: la postcondición de la migración aborta"
debe_fallar_con m7 "$AQUI/inserts.sql" "42725" "… y el 42725 sigue ahí"
# (c) sin el cheque de fuente visible: la fuente ajena entra y el arnés lo ve.
sed '/^    IF NOT FOUND THEN$/,/^    END IF;$/d' "$MIGRACION" > "$TRABAJO/sin_cheque.sql"
grep -q "no es visible" "$TRABAJO/sin_cheque.sql" && mal "la mutación (c) no quitó el cheque" || true
preparar m8; migrar m8 "$TRABAJO/sin_cheque.sql" >/dev/null
debe_fallar_con m8 "$AQUI/inserts.sql" "fuente de otra empresa" "sin el cheque de fuente visible: la fuente ajena entra con cumplimiento {} y el arnés lo detecta"

echo
if [ "$FALLOS" -eq 0 ]; then
  echo "✅ cumplimiento_calidad_firma_inequivoca: todo verde"
else
  echo "❌ cumplimiento_calidad_firma_inequivoca: $FALLOS fallo(s)"
  exit 1
fi
