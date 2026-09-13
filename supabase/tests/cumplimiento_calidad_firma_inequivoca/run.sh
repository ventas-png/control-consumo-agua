#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Verificación EJECUTABLE de 20260913032502 — la llamada ambigua del cálculo
# autoritativo de calidad de agua (SQLSTATE 42725) y el contrato de RBAC.
#
# QUÉ COMPRUEBA
#   1/12  el fixture, construido con los archivos REALES de S22 (20260603140000)
#         y S23 (20260605160000) y con las policies REALES de producción,
#         reproduce el defecto: INSERT y UPDATE de parametros mueren con 42725
#   2/12  tras la migración, el catálogo celda por celda: el trigger re-apuntado
#         (mismo nombre y OID, tgtype 23, tgenabled O, UPDATE OF con las cuatro
#         columnas, pg_get_triggerdef exacto), la función nueva INVOKER con
#         search_path '', la acotada DEFINER con su ACL, la ACL de la firma de
#         tres argumentos, y que la sobrecarga vieja y la función de S22 no
#         cambiaron (cuerpo, ACL, volatilidad, dueño)
#   3/12  comportamiento REAL como administrativo: INSERT, UPDATE, pisado de lo
#         que manda el cliente, override de empresa, fallback global, fuente y
#         company_id ajenos rechazados, anon sin RPC nueva
#   4/12  EL HALLAZGO, reproducido: con un SELECT AMPLIO sobre fuentes_agua, un
#         `operator` SIN agua.calidad.view al que la policy de INSERT SÍ
#         autoriza recibe 42501 desde dentro del trigger
#   5/12  EL CONTRATO, con lo que se entrega: ese mismo operador guarda y edita
#         su análisis, con el cálculo real; la fuente de otra empresa se sigue
#         rechazando; no gana ni una lectura nueva
#   6/12  IDEMPOTENCIA: aplicar dos veces no falla, conserva OIDs y estado
#   7/12  ABORTO ante un mundo ajeno: homónimo en otra tabla, trigger con otra
#         definición, y la firma de tres argumentos convertida en DEFINER
#   8/12  FAIL-CLOSED · el trigger DESHABILITADO o con otro UPDATE OF aborta la
#         migración sin crear nada
#   9/12  FAIL-CLOSED · una función homónima ya existente con otro cuerpo, otra
#         ACL o otro dueño aborta la reaplicación sin tocar nada
#  10/12  MUTACIÓN · restaurar la llamada ambigua → 42725 otra vez
#  11/12  MUTACIÓN · quitar el EXECUTE de authenticated → 42501; abrir la
#         acotada o la RLS de calidad_tipologias → el arnés lo detecta
#  12/12  MUTACIÓN · mutilar la migración (sin GRANT, sin re-apuntar, sin el
#         cheque de tenant, con el SELECT amplio) → rojo
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

psql -q -d postgres -c "CREATE ROLE anon NOINHERIT; CREATE ROLE authenticated NOINHERIT; CREATE ROLE service_role NOINHERIT BYPASSRLS; CREATE ROLE otro_dueno NOINHERIT;" >/dev/null

aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
notas()   { psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" 2>&1 | sed -n 's/.*NOTICE:  /  /p'; }
migrar()  { PGOPTIONS="-c client_min_messages=notice" psql -q -v ON_ERROR_STOP=1 -d "$1" -f "${2:-$MIGRACION}" 2>&1 | sed -n 's/.*NOTICE:  /  /p'; }
oid_trg() { psql -tAq -d "$1" -c "SELECT oid FROM pg_trigger WHERE tgname = 'registros_calidad_cumplimiento' AND NOT tgisinternal"; }
oid_fn()  { psql -tAq -d "$1" -c "SELECT coalesce(to_regprocedure('public.trg_registros_calidad_cumplimiento_catalogo()')::oid::text, 'AUSENTE')"; }
oid_ac()  { psql -tAq -d "$1" -c "SELECT coalesce(to_regprocedure('public.agua_fuente_de_mi_empresa(uuid)')::oid::text, 'AUSENTE')"; }
fn_trg()  { psql -tAq -d "$1" -c "SELECT tgfoid::regprocedure::text || ' ' || tgenabled::text || ' ' || coalesce((SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM unnest(tgattr::int2[]) k JOIN pg_attribute a ON a.attrelid = tgrelid AND a.attnum = k), '(todas)') FROM pg_trigger WHERE tgname = 'registros_calidad_cumplimiento' AND NOT tgisinternal"; }
# Cuerpo + ACL + volatilidad + dueño de TODO lo que la migración no debe tocar.
intactos() { psql -tAq -d "$1" -c "SET search_path = public; SELECT proname || '(' || pg_get_function_identity_arguments(oid) || ') ' || md5(prosrc) || ' ' || coalesce(proacl::text,'<default>') || ' ' || provolatile::text || ' ' || prosecdef::text || ' ' || pg_get_userbyid(proowner) FROM pg_proc WHERE oid IN (to_regprocedure('public.calcular_cumplimiento_calidad(text, jsonb)'), to_regprocedure('public.trg_registros_calidad_cumplimiento()')) ORDER BY 1"; }
# Estado EXACTO de las dos funciones que la migración crea (para los mutantes).
nuevas() { psql -tAq -d "$1" -c "SET search_path = public; SELECT proname || ' ' || md5(prosrc) || ' ' || coalesce(proacl::text,'<default>') || ' ' || pg_get_userbyid(proowner) || ' ' || prosecdef::text FROM pg_proc WHERE proname IN ('trg_registros_calidad_cumplimiento_catalogo','agua_fuente_de_mi_empresa') ORDER BY 1"; }

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

echo "── 1/12 · el fixture (S22 + S23 reales, policies reales) reproduce el 42725 ─"
notas cal "$AQUI/assert_pre.sql"

echo "── 2/12 · la migración y el catálogo, celda por celda ──────────────────────"
ANTES_INTACTOS=$(intactos cal); OID_TRG_ANTES=$(oid_trg cal)
migrar cal
notas cal "$AQUI/assert.sql"
[ "$(intactos cal)" = "$ANTES_INTACTOS" ] && ok "la sobrecarga (text, jsonb) y trg_registros_calidad_cumplimiento() quedaron byte a byte igual (cuerpo, ACL, volatilidad, INVOKER, dueño)" \
  || mal "algo cambió en los objetos que no debían tocarse:\n$ANTES_INTACTOS\n→\n$(intactos cal)"
[ "$(oid_trg cal)" = "$OID_TRG_ANTES" ] && ok "el trigger conserva su OID ($OID_TRG_ANTES): CREATE OR REPLACE TRIGGER no hizo DROP/CREATE" \
  || mal "el OID del trigger cambió ($OID_TRG_ANTES → $(oid_trg cal)): hubo DROP/CREATE"

echo "── 3/12 · comportamiento real como administrativo (y anon) ─────────────────"
notas cal "$AQUI/inserts.sql"

echo "── 4/12 · EL HALLAZGO · operator sin agua.calidad.view + SELECT amplio ─────"
notas cal "$AQUI/demo_select_amplio.sql"

echo "── 5/12 · EL CONTRATO · ese operador escribe, y sigue sin leer de más ──────"
notas cal "$AQUI/rbac_operador.sql"

echo "── 6/12 · idempotencia: re-aplicar conserva OIDs y estado ──────────────────"
T1=$(oid_trg cal); F1=$(oid_fn cal); A1=$(oid_ac cal)
migrar cal
T2=$(oid_trg cal); F2=$(oid_fn cal); A2=$(oid_ac cal)
[ "$T1" = "$T2" ] && [ -n "$T1" ] && ok "mismo OID del trigger tras re-aplicar ($T1)" || mal "el OID del trigger cambió al re-aplicar ($T1 → $T2)"
[ "$F1" = "$F2" ] && [ "$F1" != "AUSENTE" ] && ok "mismo OID de la función de trigger ($F1)" || mal "el OID de la función cambió al re-aplicar ($F1 → $F2)"
[ "$A1" = "$A2" ] && [ "$A1" != "AUSENTE" ] && ok "mismo OID de la función acotada ($A1)" || mal "el OID de la acotada cambió al re-aplicar ($A1 → $A2)"
psql -q -v ON_ERROR_STOP=1 -d cal -f "$AQUI/assert.sql"         >/dev/null 2>&1 && ok "re-aplicar deja exactamente el mismo catálogo" || mal "el assert falla tras re-aplicar"
psql -q -v ON_ERROR_STOP=1 -d cal -f "$AQUI/inserts.sql"        >/dev/null 2>&1 && ok "re-aplicar deja el mismo comportamiento"       || mal "inserts.sql falla tras re-aplicar"
psql -q -v ON_ERROR_STOP=1 -d cal -f "$AQUI/rbac_operador.sql"  >/dev/null 2>&1 && ok "re-aplicar deja el mismo contrato de RBAC"      || mal "rbac_operador.sql falla tras re-aplicar"
[ "$(intactos cal)" = "$ANTES_INTACTOS" ] && ok "los objetos intactos siguen intactos" || mal "re-aplicar tocó los objetos intactos"

echo "── 7/12 · aborto sin tocar nada ante un mundo distinto ─────────────────────"
abortar() { # nombre sql_previo texto_error descripcion [ya_migrada]
  preparar "$1"
  [ "${5:-no}" = "migrada" ] && migrar "$1" >/dev/null
  psql -q -v ON_ERROR_STOP=1 -d "$1" -c "$2" >/dev/null
  local antes_fn antes_intactos antes_nuevas
  antes_fn=$(fn_trg "$1"); antes_intactos=$(intactos "$1"); antes_nuevas=$(nuevas "$1")
  debe_fallar_con "$1" "$MIGRACION" "$3" "$4"
  if [ "${5:-no}" = "migrada" ]; then
    [ "$(nuevas "$1")" = "$antes_nuevas" ] && ok "      … y no tocó las funciones nuevas (cuerpo, ACL, dueño)" || mal "      … pero cambió alguna función nueva"
  else
    [ "$(oid_fn "$1")" = "AUSENTE" ] && [ "$(oid_ac "$1")" = "AUSENTE" ] && ok "      … y no creó ninguna función nueva" || mal "      … pero creó alguna función nueva"
  fi
  [ "$(fn_trg "$1")" = "$antes_fn" ] && [ "$(intactos "$1")" = "$antes_intactos" ] && ok "      … y no tocó el trigger ni los objetos intactos" || mal "      … pero tocó el trigger o los objetos intactos"
}
abortar ab1 "CREATE TABLE public.otra (id int PRIMARY KEY, parametros jsonb, fuente_id uuid, cumplimiento jsonb, cumple_total boolean);
             CREATE TRIGGER registros_calidad_cumplimiento BEFORE INSERT ON public.otra FOR EACH ROW EXECUTE FUNCTION public.trg_registros_calidad_cumplimiento();" \
  "no sobre registros_calidad" "homónimo en OTRA tabla"
abortar ab2 "DROP TRIGGER registros_calidad_cumplimiento ON public.registros_calidad;
             CREATE TRIGGER registros_calidad_cumplimiento AFTER INSERT ON public.registros_calidad FOR EACH ROW EXECUTE FUNCTION public.trg_registros_calidad_cumplimiento();" \
  "no está en un estado conocido" "trigger con otra definición (AFTER)"
abortar ab3 "DROP TRIGGER registros_calidad_cumplimiento ON public.registros_calidad;
             CREATE TRIGGER registros_calidad_cumplimiento BEFORE INSERT OR UPDATE OF parametros, fuente_id ON public.registros_calidad FOR EACH ROW EXECUTE FUNCTION public.fill_company_id_from_user();" \
  "no está en un estado conocido" "trigger ejecutando otra función"
abortar ab4 "ALTER FUNCTION public.calcular_cumplimiento_calidad(text, jsonb, uuid) SECURITY DEFINER;" \
  "SECURITY DEFINER" "la firma de tres argumentos convertida en DEFINER (el GRANT sería una escalada)"
abortar ab5 "DROP TRIGGER registros_calidad_cumplimiento ON public.registros_calidad;" \
  "no existe el trigger" "el trigger de S22 borrado (no se crea a ciegas)"

echo "── 8/12 · fail-closed · tgenabled y UPDATE OF, en los dos estados ──────────"
abortar fc1 "ALTER TABLE public.registros_calidad DISABLE TRIGGER registros_calidad_cumplimiento;" \
  "enabled=D" "trigger DESHABILITADO (estado viejo)"
abortar fc2 "DROP TRIGGER registros_calidad_cumplimiento ON public.registros_calidad;
             CREATE TRIGGER registros_calidad_cumplimiento BEFORE INSERT OR UPDATE OF parametros ON public.registros_calidad FOR EACH ROW EXECUTE FUNCTION public.trg_registros_calidad_cumplimiento();" \
  "UPDATE OF=parametros" "UPDATE OF alterado (estado viejo)"
abortar fc3 "ALTER TABLE public.registros_calidad DISABLE TRIGGER registros_calidad_cumplimiento;" \
  "enabled=D" "trigger DESHABILITADO (estado nuevo, ya migrado)" migrada
abortar fc4 "DROP TRIGGER registros_calidad_cumplimiento ON public.registros_calidad;
             CREATE TRIGGER registros_calidad_cumplimiento BEFORE INSERT OR UPDATE OF parametros, fuente_id, cumplimiento ON public.registros_calidad FOR EACH ROW EXECUTE FUNCTION public.trg_registros_calidad_cumplimiento_catalogo();" \
  "UPDATE OF=cumplimiento,fuente_id,parametros" "UPDATE OF alterado (estado nuevo, ya migrado)" migrada

echo "── 9/12 · fail-closed · función homónima con otro cuerpo, ACL o dueño ──────"
abortar fn1 "CREATE OR REPLACE FUNCTION public.trg_registros_calidad_cumplimiento_catalogo() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS \$mut\$ BEGIN RETURN NEW; END \$mut\$;" \
  "OTRA definición" "función de trigger homónima con OTRO cuerpo" migrada
abortar fn2 "GRANT EXECUTE ON FUNCTION public.trg_registros_calidad_cumplimiento_catalogo() TO authenticated;" \
  "OTRA definición" "función de trigger homónima con OTRA ACL (authenticated)" migrada
abortar fn3 "ALTER FUNCTION public.trg_registros_calidad_cumplimiento_catalogo() OWNER TO otro_dueno;" \
  "OTRA definición" "función de trigger homónima con OTRO dueño" migrada
abortar fn4 "CREATE OR REPLACE FUNCTION public.agua_fuente_de_mi_empresa(p_fuente_id uuid) RETURNS TABLE(tipo_agua text, company_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS \$mut\$ SELECT fa.tipo_agua, fa.company_id FROM public.fuentes_agua fa WHERE fa.id = p_fuente_id \$mut\$;" \
  "OTRA definición" "acotada homónima SIN el filtro de tenant (el agujero que la migración no bendice)" migrada
abortar fn5 "REVOKE EXECUTE ON FUNCTION public.agua_fuente_de_mi_empresa(uuid) FROM authenticated;" \
  "OTRA definición" "acotada homónima con OTRA ACL (sin authenticated)" migrada
abortar fn6 "ALTER FUNCTION public.agua_fuente_de_mi_empresa(uuid) SECURITY INVOKER;" \
  "OTRA definición" "acotada homónima convertida en INVOKER" migrada

echo "── 10/12 · mutación: restaurar la llamada ambigua → vuelve el 42725 ────────"
preparar m1; migrar m1 >/dev/null
psql -q -v ON_ERROR_STOP=1 -d m1 -c "CREATE OR REPLACE TRIGGER registros_calidad_cumplimiento BEFORE INSERT OR UPDATE OF parametros, fuente_id ON public.registros_calidad FOR EACH ROW EXECUTE FUNCTION public.trg_registros_calidad_cumplimiento();" >/dev/null
debe_fallar_con m1 "$AQUI/inserts.sql" "42725" "re-apuntar el trigger a la función vieja de S22"
preparar m2; migrar m2 >/dev/null
psql -q -v ON_ERROR_STOP=1 -d m2 -c "CREATE OR REPLACE FUNCTION public.trg_registros_calidad_cumplimiento_catalogo() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS \$mut\$
  DECLARE v_tipo text; v_result jsonb;
  BEGIN
    SELECT f.tipo_agua INTO v_tipo FROM public.agua_fuente_de_mi_empresa(NEW.fuente_id) f;
    v_result := public.calcular_cumplimiento_calidad(COALESCE(v_tipo, ''), COALESCE(NEW.parametros, '{}'::jsonb));
    NEW.cumplimiento := v_result -> 'cumplimiento'; NEW.cumple_total := (v_result ->> 'cumple_total')::boolean; RETURN NEW;
  END \$mut\$;" >/dev/null
debe_fallar_con m2 "$AQUI/inserts.sql" "42725" "volver a la llamada de DOS argumentos dentro de la función nueva"

echo "── 11/12 · mutación: sin EXECUTE, sin acotada o sin aislamiento → rojo ─────"
preparar m3; migrar m3 >/dev/null
psql -q -v ON_ERROR_STOP=1 -d m3 -c "REVOKE EXECUTE ON FUNCTION public.calcular_cumplimiento_calidad(text, jsonb, uuid) FROM authenticated;" >/dev/null
debe_fallar_con m3 "$AQUI/inserts.sql" "42501" "revocar el EXECUTE de authenticated sobre la firma de tres argumentos"
debe_fallar_con m3 "$AQUI/assert.sql"  "authenticated SÍ ejecuta" "… y el assert de catálogo también lo ve"
preparar m4; migrar m4 >/dev/null
psql -q -v ON_ERROR_STOP=1 -d m4 -c "REVOKE EXECUTE ON FUNCTION public.agua_fuente_de_mi_empresa(uuid) FROM authenticated;" >/dev/null
debe_fallar_con m4 "$AQUI/rbac_operador.sql" "42501" "revocar el EXECUTE de authenticated sobre la acotada (el operador vuelve a no poder guardar)"
preparar m5; migrar m5 >/dev/null
psql -q -v ON_ERROR_STOP=1 -d m5 -c "CREATE OR REPLACE FUNCTION public.agua_fuente_de_mi_empresa(p_fuente_id uuid) RETURNS TABLE(tipo_agua text, company_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS \$mut\$ SELECT fa.tipo_agua, fa.company_id FROM public.fuentes_agua fa WHERE fa.id = p_fuente_id \$mut\$;" >/dev/null
debe_fallar_con m5 "$AQUI/rbac_operador.sql" "NO devuelve nada para la fuente de la empresa B" "quitar el filtro de tenant de la acotada (fuente ajena alcanzable)"
debe_fallar_con m5 "$AQUI/assert.sql" "filtra por get_my_company_id" "… y el assert de catálogo también lo ve"
preparar m6; migrar m6 >/dev/null
psql -q -v ON_ERROR_STOP=1 -d m6 -c "ALTER TABLE public.calidad_tipologias DISABLE ROW LEVEL SECURITY;" >/dev/null
debe_fallar_con m6 "$AQUI/inserts.sql" "override de B" "apagar la RLS de calidad_tipologias (A usaría el override de B)"
preparar m7; migrar m7 >/dev/null
psql -q -v ON_ERROR_STOP=1 -d m7 -c "DROP POLICY fuentes_agua_select ON public.fuentes_agua; CREATE POLICY fuentes_agua_select ON public.fuentes_agua FOR SELECT TO authenticated USING (true);" >/dev/null
debe_fallar_con m7 "$AQUI/assert.sql" "no se abrió la tabla" "abrir la policy de SELECT de fuentes_agua con USING (true)"

echo "── 12/12 · mutación: mutilar la migración → rojo ───────────────────────────"
# (a) sin el GRANT a authenticated sobre la firma de tres argumentos.
grep -v "^GRANT  EXECUTE ON FUNCTION public.calcular_cumplimiento_calidad(text, jsonb, uuid) TO authenticated, service_role;" "$MIGRACION" > "$TRABAJO/sin_grant.sql"
preparar m8
debe_fallar_con m8 "$TRABAJO/sin_grant.sql" "NO puede ejecutar" "sin el GRANT a authenticated: la postcondición de la migración aborta"
# (b) sin re-apuntar el trigger: la postcondición aborta (sigue la función vieja).
sed '/^CREATE OR REPLACE TRIGGER registros_calidad_cumplimiento$/,/EXECUTE FUNCTION public.trg_registros_calidad_cumplimiento_catalogo();$/d' "$MIGRACION" > "$TRABAJO/sin_trigger.sql"
grep -q "^CREATE OR REPLACE TRIGGER" "$TRABAJO/sin_trigger.sql" && mal "la mutación (b) no quitó el CREATE OR REPLACE TRIGGER" || true
preparar m9
debe_fallar_con m9 "$TRABAJO/sin_trigger.sql" "no quedó como se declaró" "sin re-apuntar el trigger: la postcondición de la migración aborta"
debe_fallar_con m9 "$AQUI/inserts.sql" "42725" "… y el 42725 sigue ahí"
# (c) sin el cheque de tenant dentro del trigger: la fuente ajena entra.
sed '/^    IF NOT FOUND THEN$/,/^    END IF;$/d' "$MIGRACION" > "$TRABAJO/sin_cheque.sql"
grep -q "no pertenece a la empresa" "$TRABAJO/sin_cheque.sql" && mal "la mutación (c) no quitó el cheque de tenant" || true
preparar m10; migrar m10 "$TRABAJO/sin_cheque.sql" >/dev/null
debe_fallar_con m10 "$AQUI/inserts.sql" "fuente de otra empresa" "sin el cheque de tenant: la fuente ajena entra y el arnés lo detecta"
# (d) con el SELECT amplio en vez de la acotada: el operador vuelve a romperse.
sed 's|FROM public.agua_fuente_de_mi_empresa(NEW.fuente_id) f;|FROM public.fuentes_agua f WHERE f.id = NEW.fuente_id;|' "$MIGRACION" > "$TRABAJO/select_amplio.sql"
grep -q "FROM public.fuentes_agua f WHERE" "$TRABAJO/select_amplio.sql" || mal "la mutación (d) no sustituyó la acotada por el SELECT amplio"
preparar m11; migrar m11 "$TRABAJO/select_amplio.sql" >/dev/null
debe_fallar_con m11 "$AQUI/rbac_operador.sql" "42501" "con el SELECT amplio: el operador SIN view vuelve a recibir 42501 al guardar"
debe_fallar_con m11 "$AQUI/assert.sql" "resuelve la fuente con la función acotada" "… y el assert de catálogo también lo ve"

echo
if [ "$FALLOS" -eq 0 ]; then
  echo "✅ cumplimiento_calidad_firma_inequivoca: todo verde"
else
  echo "❌ cumplimiento_calidad_firma_inequivoca: $FALLOS fallo(s)"
  exit 1
fi
