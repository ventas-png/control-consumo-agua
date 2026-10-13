#!/usr/bin/env bash
# SEP-reversion · revertir la 0900 y volver a aplicarla NO deja la separación en un estado inconsistente.
#   El procedimiento operativo normal (revertir la migración, trabajar un tiempo sin los triggers, desplegar otra vez) reabre el defecto mientras la
#   pieza no está: alguien con `edit` apaga —o enciende— la fila con un UPDATE directo. La bitácora se CONSERVA (es evidencia), así que al reaplicar la
#   línea base no concilia nada y la «memoria» quedaba diciendo lo contrario de la fila. La conciliación de la pieza lo alinea con UNA fila de sistema,
#   y `vigilancia.sql` lo lista (separacion_sistema). Se comprueba de extremo a extremo, con la pieza y la reversión REALES:
#     1) el administrador enciende C por la RPC · 2) se revierte (la bitácora se conserva y avisa) · 3) el editor apaga la fila con un UPDATE directo
#     4) se reaplica la pieza · 5) la memoria queda alineada (UNA fila «sistema» true>false, sin actor ni motivo) y la vigilancia la lista
#     6) la RPC ya no se contradice: pedir «apagar» es «sin cambio», pedir «encender» opera · 7) reaplicar otra vez no añade nada
#     8) con los triggers de vuelta, el editor ya no puede · 9) el otro sentido (se enciende por fuera) también se concilia, sin listarlo como apagado.
# Uso:  BD=<base recién creada> PIEZA=<pieza.sql> REVERSION=<reversion_pieza.sql> VIGILANCIA=<vigilancia.sql> bash SEP-reversion.sh
set -uo pipefail
: "${BD:?falta BD}"; : "${PIEZA:?falta PIEZA}"; : "${REVERSION:?falta REVERSION}"; : "${VIGILANCIA:?falta VIGILANCIA}"
SEPDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
C=cccccccc-cccc-cccc-cccc-cccccccccccc; UA=c0c0c0c0-0000-0000-0000-00000000000a; SE=5e900000-0000-0000-0000-0000000000e1
ERR="${TMPDIR:-/tmp}/sep_rev_err_$$.txt"
fallo() { echo "❌ SEP-reversion · $1"; exit 1; }
q() { psql -q -X -t -A -d "$BD" -c "$1"; }
aplicar() { PGOPTIONS="-c client_min_messages=warning" psql -q -X -v ON_ERROR_STOP=1 -d "$BD" -f "$PIEZA" >/dev/null 2>"$ERR" || fallo "no se pudo aplicar la pieza: $(head -3 "$ERR")"; }
como() { # como <uuid> <sql> : una sentencia como esa persona con el rol authenticated (la salida y los errores van a stdout)
  psql -q -X -t -A -v ON_ERROR_STOP=0 -d "$BD" 2>&1 <<SQL
SELECT set_config('request.jwt.claim.sub', '$1', false);
SET ROLE authenticated;
$2
SQL
}
nbit() { q "SELECT count(*) FROM public.compras_config_separacion_bitacora WHERE company_id = '$C'"; }
fila() { q "SELECT COALESCE((SELECT aprobacion_separada::text FROM public.compras_config WHERE company_id = '$C'), 'SIN FILA')"; }
ult()  { q "SELECT origen || '|' || COALESCE(valor_anterior::text, 'NULL') || '>' || valor_nuevo::text || '|' || COALESCE(actor_id::text, 'sinactor') || '|' || COALESCE(motivo, 'sinmotivo')
              FROM public.compras_config_separacion_bitacora WHERE company_id = '$C' ORDER BY id DESC LIMIT 1"; }
vig()  { psql -q -X -t -A -F '|' -d "$BD" -f "$VIGILANCIA"; }
vigc() { vig | grep -F "$C" || true; }                  # filas de la vigilancia que nombran a C (en la columna id o en el detalle)
triggers_sep() { q "SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.compras_config'::regclass AND NOT tgisinternal AND tgname IN ('trg_compras_00_config_separacion', 'trg_compras_00_config_separacion_truncate', 'trg_zz_compras_config_separacion_bitacora')"; }

aplicar
psql -q -X -v ON_ERROR_STOP=1 -d "$BD" -f "$SEPDIR/SEP-0.padron.sql" >/dev/null 2>&1 || fallo "no se pudo preparar el padrón"
q "DELETE FROM public.compras_config WHERE company_id = '$C'" >/dev/null

# 1 · el administrador enciende la separación de C por la RPC (con motivo)
S=$(como "$UA" "SELECT (public.compras_separacion_configurar('$C', true, 'Encendida para la auditoría del trimestre'))->>'aprobacion_separada';" | tail -1)
[ "$S" = true ] && [ "$(fila)" = true ] || fallo "paso 1: la RPC no encendió la separación de C (respuesta «$S», fila $(fila))"
B1=$(nbit)
[ "$(ult)" = "usuario|false>true|$UA|Encendida para la auditoría del trimestre" ] || fallo "paso 1: la última fila de la bitácora no es la de la RPC: $(ult)"

# 2 · se revierte la 0900: la bitácora tiene cambios y se CONSERVA (y avisa); los triggers y la RPC desaparecen
SAL=$(psql -q -X -v ON_ERROR_STOP=1 -d "$BD" -f "$REVERSION" 2>&1) || fallo "paso 2: la reversión falla: $(echo "$SAL" | head -3)"
echo "$SAL" | grep -q 'se CONSERVA' || fallo "paso 2: la reversión no avisó de que conserva la bitácora"
[ "$(triggers_sep)" = 0 ] || fallo "paso 2: tras revertir quedan triggers de la separación"
[ "$(q "SELECT count(*) FROM pg_proc WHERE proname = 'compras_separacion_configurar'")" = 0 ] || fallo "paso 2: tras revertir la RPC sigue existiendo"
[ "$(nbit)" = "$B1" ] || fallo "paso 2: la reversión tocó la bitácora"

# 3 · con la pieza revertida el defecto está reabierto: el editor APAGA la fila con un UPDATE directo
R=$(como "$SE" "WITH u AS (UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = '$C' RETURNING 1) SELECT count(*) FROM u;" | tail -1)
[ "$R" = 1 ] && [ "$(fila)" = false ] || fallo "paso 3: (preparación) el editor debía poder apagar la fila con la pieza revertida; recibió «$R», fila $(fila)"
[ "$(nbit)" = "$B1" ] || fallo "paso 3: (preparación) sin triggers la bitácora no debía enterarse"

# 4 · se reaplica la pieza (idempotente, sin errores)
aplicar

# 5 · la memoria queda alineada: UNA fila de sistema true>false, sin actor ni motivo; y la vigilancia la lista como un apagado de sistema
[ "$(fila)" = false ] || fallo "paso 5: la reaplicación cambió la fila (esperada false): $(fila)"
[ "$(nbit)" = "$((B1 + 1))" ] || fallo "paso 5: filas de bitácora $(nbit) (esperadas $((B1 + 1)): la conciliación debía añadir UNA)"
[ "$(ult)" = "sistema|true>false|sinactor|sinmotivo" ] || fallo "paso 5: la última fila de la bitácora es «$(ult)» (esperada sistema|true>false|sinactor|sinmotivo): la memoria sigue discordante de la fila"
V=$(vigc)
[ "$(echo "$V" | grep -c '^separacion_sistema|')" = 1 ] && echo "$V" | grep -q 'SIGUE existiendo' || fallo "paso 5: la vigilancia debía listar UN apagado de sistema de C (separacion_sistema): «$V»"
[ "$(echo "$V" | grep -c '^separacion_apagada_por_fuera|\|^separacion_sin_base|\|^separacion_sin_fila|')" = 0 ] || fallo "paso 5: la vigilancia lista una incoherencia que la conciliación debía haber resuelto: «$V»"

# 6 · la RPC ya no se contradice con la memoria: «apagar» es sin cambio (la fila ya está apagada); «encender» opera y deja su fila
E=$(como "$UA" "SELECT public.compras_separacion_configurar('$C', false, 'Se deja constancia de que está apagada');")
echo "$E" | grep -q 'COMPRAS_SEPARACION_SIN_CAMBIO' || fallo "paso 6: pedir apagar sobre la fila apagada debía ser SIN_CAMBIO: «$E»"
[ "$(nbit)" = "$((B1 + 1))" ] || fallo "paso 6: el SIN_CAMBIO escribió en la bitácora"
S=$(como "$UA" "SELECT (public.compras_separacion_configurar('$C', true, 'Se vuelve a encender tras el despliegue'))->>'aprobacion_separada';" | tail -1)
[ "$S" = true ] && [ "$(fila)" = true ] && [ "$(nbit)" = "$((B1 + 2))" ] || fallo "paso 6: encender debía operar y dejar UNA fila: respuesta «$S», fila $(fila), filas $(nbit)"
[ "$(ult)" = "usuario|false>true|$UA|Se vuelve a encender tras el despliegue" ] || fallo "paso 6: la cadena de la bitácora no encadena (false>true tras el true>false de sistema): $(ult)"
[ "$(q "SELECT public.sep_cadena_rota('$C')")" = 0 ] || fallo "paso 6: la cadena de la bitácora tiene cortes"

# 7 · reaplicar otra vez no añade nada
aplicar; aplicar
[ "$(nbit)" = "$((B1 + 2))" ] && [ "$(fila)" = true ] || fallo "paso 7: reaplicar con todo coherente cambió algo: filas $(nbit), fila $(fila)"

# 8 · con los triggers de vuelta el editor ya no puede apagarla
E=$(como "$SE" "UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = '$C';")
echo "$E" | grep -q 'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN' && [ "$(fila)" = true ] || fallo "paso 8: tras reaplicar, el editor debía quedar rechazado: «$E», fila $(fila)"

# 9 · el otro sentido: se apaga por la RPC, se revierte, el editor la ENCIENDE directamente, se reaplica
como "$UA" "SELECT public.compras_separacion_configurar('$C', false, 'Se apaga antes de la segunda reversión');" >/dev/null
B9=$(nbit)
psql -q -X -v ON_ERROR_STOP=1 -d "$BD" -f "$REVERSION" >/dev/null 2>&1 || fallo "paso 9: la segunda reversión falla"
R=$(como "$SE" "WITH u AS (UPDATE public.compras_config SET aprobacion_separada = true WHERE company_id = '$C' RETURNING 1) SELECT count(*) FROM u;" | tail -1)
[ "$R" = 1 ] && [ "$(fila)" = true ] || fallo "paso 9: (preparación) el editor debía poder encender la fila con la pieza revertida"
aplicar
[ "$(nbit)" = "$((B9 + 1))" ] && [ "$(ult)" = "sistema|false>true|sinactor|sinmotivo" ] && [ "$(fila)" = true ] \
  || fallo "paso 9: conciliar «encendida por fuera»: filas $(nbit) (esperadas $((B9 + 1))), última «$(ult)», fila $(fila)"
V=$(vigc)
[ "$(echo "$V" | grep -c '^separacion_sistema|')" = 1 ] && [ "$(echo "$V" | grep -c '^separacion_apagada_por_fuera|\|^separacion_sin_base|\|^separacion_sin_fila|')" = 0 ] \
  || fallo "paso 9: encendida por fuera no es un apagado (sigue habiendo solo el del paso 5) ni una incoherencia: «$V»"
aplicar
[ "$(nbit)" = "$((B9 + 1))" ] || fallo "paso 9: reaplicar de nuevo añadió filas"
[ "$(triggers_sep)" = 3 ] || fallo "paso 9: tras reaplicar deben estar los tres triggers"
rm -f "$ERR"
echo "  ✓ SEP-reversion · revertir y reaplicar la 0900: la bitácora se conserva, la conciliación alinea la memoria con UNA fila de sistema (apagada y encendida por fuera), la vigilancia la lista, la RPC ya no se contradice y reaplicar es idempotente"
