#!/usr/bin/env bash
# SEP-idempotencia · la pieza (o la migración que la contiene) se puede aplicar dos —y tres— veces sobre la misma base:
#   · la 2.ª y la 3.ª pasada no fallan,
#   · no cambian NADA del catálogo (funciones, triggers, políticas, índices, restricciones, privilegios), y
#   · no tocan los datos: ni duplican la línea base ni «resucitan» una separación que un administrador apagó después.
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

aplicar || { echo "❌ SEP-idempotencia · la 1.ª pasada falla: $(head -3 "${TMPDIR:-/tmp}/sep_idem_err.txt")"; exit 1; }
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
q "DELETE FROM public.companies WHERE id = '5e900000-0000-0000-0000-0000000000d1'" >/dev/null 2>&1
echo "  ✓ SEP-idempotencia · 4 pasadas sobre la misma base: sin error, catálogo idéntico (huella $H1), línea base una sola vez y sin resucitar una separación apagada"
