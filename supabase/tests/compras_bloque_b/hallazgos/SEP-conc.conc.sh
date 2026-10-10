# SEP-conc · concurrencia de compras_separacion_configurar y de la bitácora del interruptor (sesiones psql REALES, no una simulación).
#
# QUÉ SE PROTEGE
#   Dos administradores que conmutan la separación a la vez: se SERIALIZAN con un candado asesor por empresa; el segundo ve el valor
#   que dejó el primero; la bitácora no pierde ni duplica cambios y el «valor anterior» de cada fila es el «valor nuevo» de la anterior.
#   Quien edita tolerancias al mismo tiempo no estorba ni es estorbado (sin interbloqueo, sin rechazos espurios). Y los lectores del
#   interruptor (la aprobación de una orden) solo ven valores CONFIRMADOS: no hay una ventana en que lean otra cosa.
#
# Se "sourcea" desde el arnés (usa sesion_u, par_u, q, BD, SALIDAS y las variables C C1 UA). Escenas DETERMINISTAS con pausas (pg_sleep):
#   S1  doble clic: el mismo administrador pide «encender» dos veces a la vez (fila PRESENTE)  → una aplica, la otra «sin cambio».
#   S2  fila AUSENTE (nada que bloquear en la tabla): dos administradores encienden a la vez → una aplica, la otra «sin cambio»
#       —no «configuración cambió mientras se aplicaba» ni violación de llave—: lo serializa el candado asesor.
#   S3  sentidos OPUESTOS: uno enciende y otro apaga a la vez → los dos aplican, EN ORDEN; el segundo parte de lo que dejó el primero.
#   S4  carga: dos sesiones alternan encender/apagar 25 veces cada una → cada éxito es UNA fila de bitácora, ningún error que no sea
#       «sin cambio», cadena sin cortes y el último valor de la bitácora es el de la fila.
#   S5  un editor cambia tolerancias 40 veces mientras un administrador conmuta → cero errores del editor, cero interbloqueos.
#   (la cadena de cada escena se mide DESDE el último id de bitácora que había al empezarla: otras pruebas SEP dejan a propósito cortes en la historia
#    —apagan o encienden la fila sin pasar por los triggers— y SEP-conc corre después de ellas en la misma base, como en run.sh §6b.)
#   S6  lectores: mientras la RPC apaga SIN confirmar, el solicitante aún no puede aprobar su orden; confirmada, sí.
UB=c0c0c0c0-0000-0000-0000-00000000000b
SE=5e900000-0000-0000-0000-0000000000e1
P1=e3000000-0000-0000-0000-000000000001
SEPDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

_sepc() {
  local ok=1 det="" n
  psql -q -X -v ON_ERROR_STOP=1 -d "$BD" -f "$SEPDIR/SEP-0.padron.sql" >/dev/null 2>&1 || { echo "❌ SEP-conc · no se pudo preparar el padrón"; return 1; }
  local R="SELECT public.compras_separacion_configurar"
  sepc_nbit() { q "SELECT count(*) FROM public.compras_config_separacion_bitacora WHERE company_id = '$1'"; }
  sepc_rota() { q "SELECT public.sep_cadena_rota('$1', ${2:-0})"; }       # cortes de la cadena POSTERIORES al id $2 (la historia anterior no es de esta prueba)
  sepc_ult()  { q "SELECT public.sep_ultimo_id('$1')"; }
  sepc_val()  { q "SELECT public.sep_valor('$1')"; }
  sepc_prep() { q "SELECT public.sep_preparar('$C', $1)" >/dev/null; }     # true/false/NULL: carga de SISTEMA (queda anotada)
  sepc_raro() { cat "$@" | grep -E 'ERROR|deadlock|40P01' | grep -vE 'COMPRAS_SEPARACION_SIN_CAMBIO' | head -3; }

  # ── S1 · doble clic del MISMO administrador, fila presente ─────────────────────────────────────────────
  sepc_prep false; local b0; b0=$(sepc_nbit "$C")
  par_u SEPC1 "$UA" "$R('$C', true, 'Primer clic del administrador sobre encender');" 1.5 \
                "$UA" "$R('$C', true, 'Segundo clic del administrador sobre encender');" 0
  local ap rech
  ap=$(cat "$SALIDAS/SEPC11.txt" "$SALIDAS/SEPC12.txt" | grep -c '"aprobacion_separada": true')
  rech=$(cat "$SALIDAS/SEPC11.txt" "$SALIDAS/SEPC12.txt" | grep -c 'COMPRAS_SEPARACION_SIN_CAMBIO')
  [ "$ap" = 1 ] && [ "$rech" = 1 ] || { ok=0; det="$det S1: aplicaron=$ap (esperado 1), «sin cambio»=$rech (esperado 1);"; }
  [ "$(( $(sepc_nbit "$C") - b0 ))" = 1 ] || { ok=0; det="$det S1: filas de bitácora nuevas=$(( $(sepc_nbit "$C") - b0 )) (esperado 1);"; }
  [ "$(sepc_val "$C")" = true ] || { ok=0; det="$det S1: el interruptor quedó en $(sepc_val "$C");"; }

  # ── S2 · fila AUSENTE y sin nada establecido: nada que bloquear en la tabla; el candado asesor serializa ───
  sepc_prep NULL; b0=$(sepc_nbit "$C")
  par_u SEPC2 "$UA" "$R('$C', true, 'Administrador A enciende sin fila previa');" 1.5 \
                "$UB" "$R('$C', true, 'Administrador B enciende sin fila previa');" 0
  ap=$(cat "$SALIDAS/SEPC21.txt" "$SALIDAS/SEPC22.txt" | grep -c '"aprobacion_separada": true')
  rech=$(cat "$SALIDAS/SEPC21.txt" "$SALIDAS/SEPC22.txt" | grep -c 'COMPRAS_SEPARACION_SIN_CAMBIO')
  [ "$ap" = 1 ] && [ "$rech" = 1 ] || { ok=0; det="$det S2: aplicaron=$ap (esperado 1), «sin cambio»=$rech (esperado 1);"; }
  [ -z "$(sepc_raro "$SALIDAS/SEPC21.txt" "$SALIDAS/SEPC22.txt")" ] || { ok=0; det="$det S2: error distinto de «sin cambio»: $(sepc_raro "$SALIDAS/SEPC21.txt" "$SALIDAS/SEPC22.txt");"; }
  [ "$(( $(sepc_nbit "$C") - b0 ))" = 1 ] || { ok=0; det="$det S2: filas de bitácora nuevas=$(( $(sepc_nbit "$C") - b0 )) (esperado 1);"; }
  [ "$(q "SELECT count(*) FROM public.compras_config WHERE company_id = '$C'")" = 1 ] || { ok=0; det="$det S2: la empresa no quedó con UNA fila de configuración;"; }

  # ── S3 · sentidos OPUESTOS: enciende (retiene) y apaga ─────────────────────────────────────────────────
  sepc_prep false; b0=$(sepc_nbit "$C"); local r3; r3=$(sepc_ult "$C")
  par_u SEPC3 "$UA" "$R('$C', true, 'Administrador A enciende la separación');" 1.5 \
                "$UB" "$R('$C', false, 'Administrador B apaga la separación');" 0
  [ "$(cat "$SALIDAS/SEPC31.txt" "$SALIDAS/SEPC32.txt" | grep -c '"aprobacion_separada"')" = 2 ] || { ok=0; det="$det S3: no aplicaron los dos (el segundo debía ver lo que dejó el primero y apagarlo);"; }
  [ "$(( $(sepc_nbit "$C") - b0 ))" = 2 ] || { ok=0; det="$det S3: filas nuevas=$(( $(sepc_nbit "$C") - b0 )) (esperado 2);"; }
  [ "$(sepc_rota "$C" "$r3")" = 0 ] || { ok=0; det="$det S3: la cadena de la bitácora tiene $(sepc_rota "$C" "$r3") corte(s);"; }
  [ "$(q "SELECT string_agg(valor_anterior::text || '>' || valor_nuevo::text, ' ' ORDER BY id) FROM (SELECT * FROM public.compras_config_separacion_bitacora
        WHERE company_id = '$C' ORDER BY id DESC LIMIT 2) t")" = "false>true true>false" ] || { ok=0; det="$det S3: las dos últimas filas no son false>true y true>false;"; }
  [ "$(sepc_val "$C")" = false ] || { ok=0; det="$det S3: el interruptor quedó en $(sepc_val "$C") (esperado false: el último en confirmar fue el que apaga);"; }

  # ── S4 · carga: dos sesiones alternan 25 veces cada una ────────────────────────────────────────────────
  sepc_prep false; b0=$(sepc_nbit "$C"); local N=25 i t0 seg r4; r4=$(sepc_ult "$C")
  { echo "SELECT set_config('request.jwt.claim.sub', '$UA', false); SET ROLE authenticated;"
    for i in $(seq 1 $N); do echo "$R('$C', $([ $((i % 2)) = 1 ] && echo true || echo false), 'Carga del administrador A, vuelta $i de $N');"; done; } > "$SALIDAS/sepc4_A.sql"
  { echo "SELECT set_config('request.jwt.claim.sub', '$UB', false); SET ROLE authenticated;"
    for i in $(seq 1 $N); do echo "$R('$C', $([ $((i % 2)) = 1 ] && echo true || echo false), 'Carga del administrador B, vuelta $i de $N');"; done; } > "$SALIDAS/sepc4_B.sql"
  t0=$(date +%s)
  psql -q -X -t -A -v ON_ERROR_STOP=0 -d "$BD" -f "$SALIDAS/sepc4_A.sql" > "$SALIDAS/sepc4_A.txt" 2>&1 & local pA=$!
  psql -q -X -t -A -v ON_ERROR_STOP=0 -d "$BD" -f "$SALIDAS/sepc4_B.sql" > "$SALIDAS/sepc4_B.txt" 2>&1 & local pB=$!
  wait $pA $pB; seg=$(( $(date +%s) - t0 ))
  local exA exB nuevas
  exA=$(grep -c '"aprobacion_separada"' "$SALIDAS/sepc4_A.txt"); exB=$(grep -c '"aprobacion_separada"' "$SALIDAS/sepc4_B.txt")
  nuevas=$(( $(sepc_nbit "$C") - b0 ))
  [ "$(( exA + exB ))" = "$nuevas" ] || { ok=0; det="$det S4: éxitos=$(( exA + exB )) pero filas de bitácora nuevas=$nuevas (se perdió o se duplicó algún cambio);"; }
  [ -z "$(sepc_raro "$SALIDAS/sepc4_A.txt" "$SALIDAS/sepc4_B.txt")" ] || { ok=0; det="$det S4: errores que no son «sin cambio»: $(sepc_raro "$SALIDAS/sepc4_A.txt" "$SALIDAS/sepc4_B.txt");"; }
  [ "$(sepc_rota "$C" "$r4")" = 0 ] || { ok=0; det="$det S4: cadena con $(sepc_rota "$C" "$r4") corte(s);"; }
  [ "$(q "SELECT (SELECT valor_nuevo FROM public.compras_config_separacion_bitacora WHERE company_id = '$C' ORDER BY id DESC LIMIT 1)::text")" = "$(sepc_val "$C")" ] \
    || { ok=0; det="$det S4: el último valor de la bitácora no es el de la fila;"; }
  [ "$(q "SELECT count(*) FROM public.compras_config_separacion_bitacora WHERE company_id = '$C' AND id > (SELECT max(id) - $nuevas FROM public.compras_config_separacion_bitacora WHERE company_id = '$C') AND origen = 'usuario' AND actor_id IN ('$UA', '$UB')")" = "$nuevas" ] \
    || { ok=0; det="$det S4: alguna fila nueva no es de origen usuario con actor A o B;"; }
  [ "$nuevas" -ge 2 ] || { ok=0; det="$det S4: la carga no produjo cambios ($nuevas);"; }

  # ── S5 · un editor edita tolerancias mientras el administrador conmuta ────────────────────────────────
  sepc_prep true
  { echo "SELECT set_config('request.jwt.claim.sub', '$SE', false); SET ROLE authenticated;"
    for i in $(seq 1 40); do echo "UPDATE public.compras_config SET tolerancia_precio_pct = $((i % 50)), monto_minimo_oc = $i WHERE company_id = '$C';"; done; } > "$SALIDAS/sepc5_E.sql"
  { echo "SELECT set_config('request.jwt.claim.sub', '$UA', false); SET ROLE authenticated;"
    for i in $(seq 1 14); do echo "$R('$C', $([ $((i % 2)) = 1 ] && echo false || echo true), 'Conmutación $i del administrador durante la edición');"; done; } > "$SALIDAS/sepc5_A.sql"
  b0=$(sepc_nbit "$C"); local r5; r5=$(sepc_ult "$C")
  psql -q -X -t -A -v ON_ERROR_STOP=0 -d "$BD" -f "$SALIDAS/sepc5_E.sql" > "$SALIDAS/sepc5_E.txt" 2>&1 & pA=$!
  psql -q -X -t -A -v ON_ERROR_STOP=0 -d "$BD" -f "$SALIDAS/sepc5_A.sql" > "$SALIDAS/sepc5_A.txt" 2>&1 & pB=$!
  wait $pA $pB
  [ -z "$(grep -E 'ERROR|deadlock|40P01|WARNING' "$SALIDAS/sepc5_E.txt" | head -2)" ] || { ok=0; det="$det S5: el editor tuvo errores: $(grep -E 'ERROR|deadlock|40P01|WARNING' "$SALIDAS/sepc5_E.txt" | head -2);"; }
  [ -z "$(grep -E 'ERROR|deadlock|40P01' "$SALIDAS/sepc5_A.txt" | head -2)" ] || { ok=0; det="$det S5: el administrador tuvo errores: $(grep -E 'ERROR|deadlock|40P01' "$SALIDAS/sepc5_A.txt" | head -2);"; }
  [ "$(q "SELECT monto_minimo_oc FROM public.compras_config WHERE company_id = '$C'")" = "40.00" ] || { ok=0; det="$det S5: la última edición del editor no quedó (monto_minimo_oc=$(q "SELECT monto_minimo_oc FROM public.compras_config WHERE company_id = '$C'"));"; }
  [ "$(grep -c '"aprobacion_separada"' "$SALIDAS/sepc5_A.txt")" = "$(( $(sepc_nbit "$C") - b0 ))" ] || { ok=0; det="$det S5: éxitos del administrador distintos de las filas de bitácora nuevas;"; }
  [ "$(sepc_rota "$C" "$r5")" = 0 ] || { ok=0; det="$det S5: cadena con cortes;"; }

  # ── S6 · los lectores solo ven valores CONFIRMADOS ────────────────────────────────────────────────────
  sepc_prep true
  local rnd; rnd=$(printf '%05d' $(( (RANDOM % 40000) + 50000 )))      # ids distintos en cada corrida (la prueba se puede repetir sobre la misma base)
  local O1="5e9${rnd}-0000-0000-0000-0000000c0601" O2="5e9${rnd}-0000-0000-0000-0000000c0602"
  psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL || { echo "❌ SEP-conc · S6 no se pudo preparar"; return 1; }
SELECT set_config('request.jwt.claim.sub', '$SE', false);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES
  ('$O1', '$C', '$C1', '$P1', 'x', 'SEP-conc S6 antes de confirmar'), ('$O2', '$C', '$C1', '$P1', 'x', 'SEP-conc S6 después de confirmar');
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto) VALUES
  ('$C', '$O1', 1, 'Servicio', 'servicio', 'servicios', 1, 'servicio', 100, 0), ('$C', '$O2', 1, 'Servicio', 'servicio', 'servicios', 1, 'servicio', 100, 0);
SQL
  sesion_u "$UA" 0   "$R('$C', false, 'Se apaga la separación; el cambio aún no se confirma');" 2.5 > "$SALIDAS/sepc6_A.txt" 2>&1 & pA=$!
  sesion_u "$SE" 1.0 "UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '$O1';" 0 > "$SALIDAS/sepc6_E.txt" 2>&1 & pB=$!
  wait $pA $pB
  grep -q 'COMPRAS_OC_AUTOAPROBACION' "$SALIDAS/sepc6_E.txt" || { ok=0; det="$det S6: con el apagado SIN confirmar el solicitante pudo aprobar lo suyo (o falló por otra cosa): $(head -c 200 "$SALIDAS/sepc6_E.txt");"; }
  [ "$(sepc_val "$C")" = false ] || { ok=0; det="$det S6: el apagado no quedó confirmado;"; }
  sesion_u "$SE" 0 "UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '$O2';" 0 > "$SALIDAS/sepc6_E2.txt" 2>&1
  [ "$(q "SELECT estado FROM public.ordenes_compra WHERE id = '$O2'")" = aprobada ] || { ok=0; det="$det S6: confirmado el apagado, el solicitante no pudo aprobar su orden: $(head -c 200 "$SALIDAS/sepc6_E2.txt");"; }

  sepc_prep NULL
  if [ "$ok" = 1 ]; then
    echo "  ✓ SEP-conc · doble clic, fila ausente, sentidos opuestos, carga ($N+$N cambios en ${seg}s: $nuevas efectivos), edición simultánea y lectores: serializado, sin pérdidas ni duplicados, cadena coherente"
    return 0
  fi
  echo "❌ SEP-conc ·$det"
  return 1
}
_rsepc=0
_sepc || _rsepc=1
unset -f _sepc sepc_nbit sepc_rota sepc_ult sepc_val sepc_prep sepc_raro
return $_rsepc
