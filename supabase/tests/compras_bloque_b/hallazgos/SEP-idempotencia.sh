#!/usr/bin/env bash
# SEP-idempotencia · la pieza (o la migración que la contiene) se puede aplicar dos —y tres— veces sobre la misma base:
#   · la 2.ª y la 3.ª pasada no fallan,
#   · no cambian NADA del catálogo (funciones, triggers, políticas, índices, restricciones, privilegios), y
#   · no tocan los datos: ni duplican la línea base (tampoco con la fila encendida y la bitácora YA existente) ni «resucitan» una separación que un
#     administrador apagó después, y
#   · CONCILIAN lo que cambió por fuera (fila distinta de la última fila de la bitácora, en los dos sentidos) con UNA fila de sistema, una sola vez,
#     sin inventar historia donde no hay bitácora.
# Uso:  BD=<base> PIEZA=<ruta/pieza.sql | migración.sql> bash SEP-idempotencia.sh      (PGHOST/PGPORT/PGUSER del entorno)
set -uo pipefail
: "${BD:?falta BD}"; : "${PIEZA:?falta PIEZA}"
aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -X -v ON_ERROR_STOP=1 -d "$BD" -f "$PIEZA" >/dev/null 2>"${TMPDIR:-/tmp}/sep_idem_err.txt"; }
q() { psql -q -X -t -A -d "$BD" -c "$1"; }

# Huella del catálogo de la pieza (todo lo que crea o altera).
huella() {
  q "SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
       SELECT 'fn|' || p.proname || '|' || pg_get_functiondef(p.oid) || '|' || COALESCE(p.proacl::text, '') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND (p.proname LIKE 'compras\_separacion\_%' OR p.proname LIKE 'compras\_tg\_config\_separacion%')
       UNION ALL SELECT 'tg|' || tgrelid::regclass::text || '|' || pg_get_triggerdef(oid) || '|' || tgenabled::text FROM pg_trigger
        WHERE NOT tgisinternal AND tgrelid IN ('public.compras_config'::regclass, 'public.compras_config_separacion_bitacora'::regclass)
       UNION ALL SELECT 'pol|' || tablename || '|' || policyname || '|' || cmd || '|' || COALESCE(qual, '') || '|' || COALESCE(with_check, '') FROM pg_policies
        WHERE tablename IN ('compras_config', 'compras_config_separacion_bitacora')
       UNION ALL SELECT 'ix|' || indexdef FROM pg_indexes WHERE tablename = 'compras_config_separacion_bitacora'
       UNION ALL SELECT 'ck|' || conname || '|' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.compras_config_separacion_bitacora'::regclass
       UNION ALL SELECT 'acl|' || relname || '|' || COALESCE(relacl::text, '') || '|' || relrowsecurity::text FROM pg_class
        WHERE oid IN ('public.compras_config'::regclass, 'public.compras_config_separacion_bitacora'::regclass, 'public.compras_config_separacion_bitacora_id_seq'::regclass)
       UNION ALL SELECT 'col|' || attname || '|' || format_type(atttypid, atttypmod) || '|' || attnotnull::text || '|' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '')
         FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = 'public.compras_config_separacion_bitacora'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     ) t(x)"
}
datos() { q "SELECT count(*) || '/' || COALESCE(max(id), 0) || '/' || COALESCE(md5(string_agg(company_id::text || valor_nuevo::text || origen, ',' ORDER BY id)), '') FROM public.compras_config_separacion_bitacora"; }

# Privilegios por defecto de SUPABASE: todo objeto nuevo del esquema public nace con permisos para anon, authenticated y service_role (en la base local de
# las pruebas no existen, y sin ellos un REVOKE olvidado en la pieza no se nota). Se emulan ANTES de la primera pasada.
psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL || { echo "❌ SEP-idempotencia · no se pudieron emular los privilegios por defecto de Supabase"; exit 1; }
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
SQL
aplicar || { echo "❌ SEP-idempotencia · la 1.ª pasada falla: $(head -3 "${TMPDIR:-/tmp}/sep_idem_err.txt")"; exit 1; }
# Privilegios que deja la pieza con esos valores por defecto: ninguna de las nueve funciones queda para PUBLIC, anon ni service_role; solo la RPC para authenticated.
FN="p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'compras\_separacion\_%' OR p.proname LIKE 'compras\_tg\_config\_separacion%')"
MAL=$(q "SELECT COALESCE(string_agg(p.proname, ','), '') FROM pg_proc p WHERE $FN AND (
          has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE')
          OR EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
          OR (has_function_privilege('authenticated', p.oid, 'EXECUTE') <> (p.proname = 'compras_separacion_configurar')))")
[ -z "$MAL" ] || { echo "❌ SEP-idempotencia · con los privilegios por defecto de Supabase quedan EXECUTE de más (o falta el de la RPC) en: $MAL"; exit 1; }
[ "$(q "SELECT count(*) FROM pg_proc p WHERE $FN")" = 9 ] || { echo "❌ SEP-idempotencia · se esperaban 9 funciones de la pieza"; exit 1; }
MAL=$(q "SELECT COALESCE(string_agg(r || ':' || pr, ','), '') FROM (VALUES ('anon'), ('authenticated'), ('service_role')) v(r),
          (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('SELECT')) t(pr)
         WHERE has_table_privilege(r, 'public.compras_config_separacion_bitacora', pr) <> (pr = 'SELECT' AND r IN ('authenticated', 'service_role'))")
[ -z "$MAL" ] || { echo "❌ SEP-idempotencia · privilegios de la bitácora distintos de «solo SELECT para authenticated y service_role»: $MAL"; exit 1; }
MAL=$(q "SELECT COALESCE(string_agg(r || ':' || pr, ','), '') FROM (VALUES ('anon'), ('authenticated'), ('service_role')) v(r), (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) t(pr)
         WHERE has_sequence_privilege(r, 'public.compras_config_separacion_bitacora_id_seq', pr)")
[ -z "$MAL" ] || { echo "❌ SEP-idempotencia · la secuencia de la bitácora tiene privilegios: $MAL"; exit 1; }
MAL=$(q "SELECT COALESCE(string_agg(r || ':' || pr, ','), '') FROM (VALUES ('anon'), ('authenticated')) v(r), (VALUES ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) t(pr)
         WHERE has_table_privilege(r, 'public.compras_config', pr)")
MAL="$MAL$(q "SELECT COALESCE(string_agg('anon:' || pr, ','), '') FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) t(pr) WHERE has_table_privilege('anon', 'public.compras_config', pr)")"
[ -z "$MAL" ] || { echo "❌ SEP-idempotencia · compras_config conserva privilegios que la pieza quita (TRUNCATE/TRIGGER/REFERENCES a authenticated y anon, todo a anon): $MAL"; exit 1; }
H1=$(huella); D1=$(datos)
[ -n "$H1" ] && [ -n "$D1" ] || { echo "❌ SEP-idempotencia · no se pudo calcular la huella del catálogo"; exit 1; }
aplicar || { echo "❌ SEP-idempotencia · la 2.ª pasada falla: $(head -3 "${TMPDIR:-/tmp}/sep_idem_err.txt")"; exit 1; }
H2=$(huella); D2=$(datos)
[ "$H1" = "$H2" ] || { echo "❌ SEP-idempotencia · la 2.ª pasada CAMBIÓ el catálogo ($H1 → $H2)"; exit 1; }
[ "$D1" = "$D2" ] || { echo "❌ SEP-idempotencia · la 2.ª pasada cambió los datos de la bitácora ($D1 → $D2)"; exit 1; }

# Una empresa con la separación encendida desde antes (sin bitácora) recibe su línea base UNA vez; apagada por un administrador, la 3.ª pasada no la resucita.
q "INSERT INTO public.companies (id, nombre, default_currency) VALUES ('5e900000-0000-0000-0000-0000000000d1', 'SEP idempotencia', 'gtq') ON CONFLICT DO NOTHING" >/dev/null
q "INSERT INTO public.app_users (id, company_id, full_name, role) VALUES ('5e900000-0000-0000-0000-0000000000d2', '5e900000-0000-0000-0000-0000000000d1', 'SEP idempotencia admin', 'admin') ON CONFLICT DO NOTHING" >/dev/null 2>&1 \
  || { q "INSERT INTO auth.users (id) VALUES ('5e900000-0000-0000-0000-0000000000d2') ON CONFLICT DO NOTHING" >/dev/null; q "INSERT INTO public.app_users (id, company_id, full_name, role) VALUES ('5e900000-0000-0000-0000-0000000000d2', '5e900000-0000-0000-0000-0000000000d1', 'SEP idempotencia admin', 'admin') ON CONFLICT DO NOTHING" >/dev/null; }
psql -q -X -d "$BD" >/dev/null <<SQL
SET session_replication_role = replica;
INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES ('5e900000-0000-0000-0000-0000000000d1', true) ON CONFLICT (company_id) DO UPDATE SET aprobacion_separada = true;
SQL
aplicar || { echo "❌ SEP-idempotencia · la 3.ª pasada falla"; exit 1; }
LB=$(q "SELECT count(*) FROM public.compras_config_separacion_bitacora WHERE company_id = '5e900000-0000-0000-0000-0000000000d1' AND origen = 'linea_base'")
[ "$LB" = 1 ] || { echo "❌ SEP-idempotencia · la línea base quedó $LB veces (esperado 1)"; exit 1; }
# 3b · reaplicar con la fila TODAVÍA encendida y la bitácora ya existente (la línea base ya está): no se siembra otra (NOT EXISTS por empresa)
aplicar || { echo "❌ SEP-idempotencia · la pasada 3b (fila encendida con bitácora) falla"; exit 1; }
aplicar || { echo "❌ SEP-idempotencia · la pasada 3c falla"; exit 1; }
LB=$(q "SELECT count(*) FROM public.compras_config_separacion_bitacora WHERE company_id = '5e900000-0000-0000-0000-0000000000d1' AND origen = 'linea_base'")
NB=$(q "SELECT count(*) FROM public.compras_config_separacion_bitacora WHERE company_id = '5e900000-0000-0000-0000-0000000000d1'")
[ "$LB" = 1 ] && [ "$NB" = 1 ] || { echo "❌ SEP-idempotencia · reaplicar con la fila encendida y la bitácora existente dejó $LB líneas base y $NB filas (esperado 1 y 1)"; exit 1; }
psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL || { echo "❌ SEP-idempotencia · no se pudo apagar por la RPC"; exit 1; }
SELECT set_config('request.jwt.claim.sub', '5e900000-0000-0000-0000-0000000000d2', false);
SET ROLE authenticated;
SELECT public.compras_separacion_configurar('5e900000-0000-0000-0000-0000000000d1', false, 'Apagada por el administrador tras la migración');
SQL
aplicar || { echo "❌ SEP-idempotencia · la 4.ª pasada falla"; exit 1; }
N=$(q "SELECT count(*) FROM public.compras_config_separacion_bitacora WHERE company_id = '5e900000-0000-0000-0000-0000000000d1'")
V=$(q "SELECT aprobacion_separada FROM public.compras_config WHERE company_id = '5e900000-0000-0000-0000-0000000000d1'")
[ "$N" = 2 ] && [ "$V" = f ] || { echo "❌ SEP-idempotencia · tras apagarla y reaplicar: filas de bitácora=$N (esperado 2), valor=$V (esperado f)"; exit 1; }
[ "$(huella)" = "$H1" ] || { echo "❌ SEP-idempotencia · la 4.ª pasada cambió el catálogo"; exit 1; }

# 5 · CONCILIACIÓN «apagada por fuera»: la bitácora dice «activa» y la fila se apagó sin pasar por los triggers (reversión de la 0900, replica)
D1=5e900000-0000-0000-0000-0000000000d1
ult() { q "SELECT origen || '|' || COALESCE(valor_anterior::text, 'NULL') || '>' || valor_nuevo::text || '|' || COALESCE(actor_id::text, 'sinactor') || '|' || COALESCE(motivo, 'sinmotivo')
             FROM public.compras_config_separacion_bitacora WHERE company_id = '$D1' ORDER BY id DESC LIMIT 1"; }
nbit() { q "SELECT count(*) FROM public.compras_config_separacion_bitacora WHERE company_id = '$D1'"; }
fila() { q "SELECT aprobacion_separada FROM public.compras_config WHERE company_id = '$D1'"; }
sin_triggers() { psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL
SET session_replication_role = replica;
UPDATE public.compras_config SET aprobacion_separada = $1 WHERE company_id = '$D1';
SQL
}
psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL || { echo "❌ SEP-idempotencia · no se pudo encender por la RPC"; exit 1; }
SELECT set_config('request.jwt.claim.sub', '5e900000-0000-0000-0000-0000000000d2', false);
SET ROLE authenticated;
SELECT public.compras_separacion_configurar('$D1', true, 'Se enciende de nuevo para la prueba de conciliación');
SQL
[ "$(nbit)" = 3 ] && [ "$(fila)" = t ] || { echo "❌ SEP-idempotencia · preparación de la conciliación: filas=$(nbit) fila=$(fila) (esperado 3 y t)"; exit 1; }
sin_triggers false
[ "$(fila)" = f ] && [ "$(nbit)" = 3 ] || { echo "❌ SEP-idempotencia · preparación: la fila debía quedar apagada sin tocar la bitácora"; exit 1; }
aplicar || { echo "❌ SEP-idempotencia · la 5.ª pasada (conciliar «apagada por fuera») falla"; exit 1; }
[ "$(nbit)" = 4 ] && [ "$(ult)" = "sistema|true>false|sinactor|sinmotivo" ] && [ "$(fila)" = f ] \
  || { echo "❌ SEP-idempotencia · conciliar «apagada por fuera»: filas=$(nbit) (esperado 4), última=$(ult) (esperada sistema|true>false|sinactor|sinmotivo), fila=$(fila) (esperada f)"; exit 1; }
aplicar || { echo "❌ SEP-idempotencia · la 6.ª pasada falla"; exit 1; }
[ "$(nbit)" = 4 ] || { echo "❌ SEP-idempotencia · la conciliación no es idempotente: filas=$(nbit) (esperado 4 tras la 2.ª pasada)"; exit 1; }

# 6 · CONCILIACIÓN «encendida por fuera»: la bitácora dice «apagada» y la fila se encendió sin pasar por los triggers (el otro sentido)
sin_triggers true
[ "$(fila)" = t ] && [ "$(nbit)" = 4 ] || { echo "❌ SEP-idempotencia · preparación: la fila debía quedar encendida sin tocar la bitácora"; exit 1; }
aplicar || { echo "❌ SEP-idempotencia · la 7.ª pasada (conciliar «encendida por fuera») falla"; exit 1; }
[ "$(nbit)" = 5 ] && [ "$(ult)" = "sistema|false>true|sinactor|sinmotivo" ] && [ "$(fila)" = t ] \
  || { echo "❌ SEP-idempotencia · conciliar «encendida por fuera»: filas=$(nbit) (esperado 5), última=$(ult) (esperada sistema|false>true|sinactor|sinmotivo), fila=$(fila) (esperada t)"; exit 1; }
aplicar || { echo "❌ SEP-idempotencia · la 8.ª pasada falla"; exit 1; }
[ "$(nbit)" = 5 ] || { echo "❌ SEP-idempotencia · la conciliación del otro sentido no es idempotente: filas=$(nbit)"; exit 1; }

# 7 · NO inventa historia: una fila APAGADA sin ninguna fila de bitácora, y una fila coherente, no reciben nada
D3=5e900000-0000-0000-0000-0000000000d3
q "INSERT INTO public.companies (id, nombre, default_currency) VALUES ('$D3', 'SEP idempotencia sin historia', 'gtq') ON CONFLICT DO NOTHING" >/dev/null
q "INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES ('$D3', false) ON CONFLICT (company_id) DO UPDATE SET aprobacion_separada = false" >/dev/null
aplicar || { echo "❌ SEP-idempotencia · la 9.ª pasada falla"; exit 1; }
[ "$(q "SELECT count(*) FROM public.compras_config_separacion_bitacora WHERE company_id = '$D3'")" = 0 ] \
  || { echo "❌ SEP-idempotencia · una fila apagada SIN bitácora recibió filas de bitácora: la conciliación inventó historia"; exit 1; }
[ "$(nbit)" = 5 ] || { echo "❌ SEP-idempotencia · la pasada 9 tocó la bitácora de una empresa coherente: filas=$(nbit)"; exit 1; }
[ "$(huella)" = "$H1" ] || { echo "❌ SEP-idempotencia · las pasadas de conciliación cambiaron el catálogo"; exit 1; }
q "DELETE FROM public.companies WHERE id IN ('$D1', '$D3')" >/dev/null 2>&1
echo "  ✓ SEP-idempotencia · 9 pasadas sobre la misma base (con los privilegios por defecto de Supabase emulados: nada de EXECUTE ni de tabla de más): sin error, catálogo idéntico (huella $H1), línea base una sola vez (también con la fila encendida y bitácora existente), sin resucitar una separación apagada, conciliación de los dos sentidos con UNA fila de sistema y sin inventar historia"
