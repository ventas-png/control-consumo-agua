#!/usr/bin/env bash
# RG-4 · LÍMITES CONOCIDOS del control de números de factura, REPRODUCIDOS (no son pruebas de la batería: no forman parte
# de run.sh; documentan hasta dónde llega la garantía y fallan si el comportamiento documentado CAMBIA).
#
#   L1 · Reactivar una factura anulada: cambia solo `estado`, que el trigger no vigila. Lo cierra cxp_proteger_factura
#        (CXP_INMUTABLE) para toda sesión de usuario; el camino de SISTEMA (conta.allow_system_write = on, sin usuario) no
#        pasa por ahí y puede dejar dos vivas equivalentes («FAC-001» + «fac.001»). Con el MISMO texto lo impide el índice único.
#        Ninguna función de la aplicación reactiva anuladas (grep en migraciones); heredado de 0400.
#   L2 · Una transacción en REPEATABLE READ / SERIALIZABLE cuya instantánea es ANTERIOR al alta de otra sesión no ve esa
#        factura (el candado consultivo serializa, pero la instantánea es vieja): «123» y «1-23» conviven. En READ COMMITTED
#        (el nivel de PostgREST/Supabase) se rechaza. Heredado de 0400 (se demuestra también con «FAC-001» / «FAC001»).
#
#   L3 · Caracteres INVISIBLES o de formato en el INTERIOR del número (U+200B espacio de ancho cero, U+00AD guion blando: el
#        artefacto típico de pegar desde un PDF) cuentan como separador al calcular el perfil: «F<U+200B>AC001» ({1}) deja de ser
#        equivalente a «FAC-001» ({3}) y un duplicado real escrito así se registra (0800 lo rechazaba). Al principio o al final se
#        recortan y el duplicado se sigue detectando. NO se corrige (ni con \uXXXX en un regexp —falla en SQL_ASCII— ni con chr(>127)).
#   L4 · SONDEO (EV-09): quien no ve una factura puede deducir su estructura de separadores probando números (rechazo = compatible,
#        alta = incomparable), con el aviso genérico que no dice nada de la factura. 0800 solo dejaba saber que existe la clave.
#
# Uso:  BD=<base> PGHOST=… PGPORT=… PGUSER=… bash RG-4.limites.sh        (cada ejecución usa proveedores propios nuevos)
#       Con la pieza aplicada L3/L4 reportan la regla nueva; sin ella (0800), el comportamiento anterior (el script se mantiene en verde).
set -uo pipefail
: "${BD:?define BD=<base de datos>}" "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}"
C=cccccccc-cccc-cccc-cccc-cccccccccccc; C1=c1c1c1c1-0000-0000-0000-000000000001; UA=c0c0c0c0-0000-0000-0000-00000000000a
n=$(printf '%04x' $(( RANDOM % 65536 ))); nit=$(( 10000 + RANDOM % 80000 )); ok=1
q() { psql -q -X -t -A -d "$BD" -c "$1"; }
prov() { printf 'fb3c%s-0000-0000-0000-0000000000%02x' "$n" "$1"; }
ins() { printf "INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total) VALUES ('%s','%s','%s','%s','limite RG-4',10);" "$C" "$C1" "$1" "$2"; }
psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance)
SELECT ('fb3c$n-0000-0000-0000-0000000000' || lpad(to_hex(k), 2, '0'))::uuid, '$C', 'Proveedor límites RG-4 ' || k || ' ($n)', '8$nit' || k || '-' || (k % 10), 'GT', 'empresa' FROM generate_series(1, 11) k;
SELECT public.como('$UA'::uuid); SET ROLE authenticated;
UPDATE public.proveedores SET estado = 'autorizado' WHERE id::text LIKE 'fb3c$n-%';
SQL
dice() { echo "  $1 · $2"; }

# ── L1 ────────────────────────────────────────────────────────────────────────────────────────────
P=$(prov 1)
psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL
SELECT public.como('$UA'::uuid); SET ROLE authenticated;
$(ins "$P" 'FAC-001')
UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE proveedor_id = '$P' AND numero_factura = 'FAC-001';
$(ins "$P" 'fac.001')
SQL
A=$(q "SELECT id FROM public.facturas_proveedor WHERE proveedor_id = '$P' AND numero_factura = 'FAC-001'")
USU=$(psql -q -X -t -A -d "$BD" 2>&1 <<SQL
SELECT public.como('$UA'::uuid); SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'registrada' WHERE id = '$A';
SQL
)
if echo "$USU" | grep -q 'CXP_INMUTABLE'; then dice L1a "sesión de USUARIO: reactivar «FAC-001» (anulada) frente a «fac.001» viva → rechazado por CXP_INMUTABLE (cerrado)"; else dice L1a "❌ la reactivación por usuario NO se rechazó: $USU"; ok=0; fi
psql -q -X -d "$BD" >/dev/null 2>&1 <<SQL
SELECT set_config('request.jwt.claim.sub', '', false);
BEGIN; SELECT set_config('conta.allow_system_write', 'on', true);
UPDATE public.facturas_proveedor SET estado = 'registrada' WHERE id = '$A';
COMMIT;
SQL
V=$(q "SELECT count(*) FROM public.facturas_proveedor WHERE proveedor_id = '$P' AND estado <> 'anulada'")
if [ "$V" = "2" ]; then dice L1b "camino de SISTEMA (conta.allow_system_write = on): la reactivación pasó y hay DOS vivas equivalentes («FAC-001», «fac.001») → LÍMITE vigente (ninguna función de la aplicación lo usa)"; else dice L1b "CAMBIÓ: ahora el camino de sistema también lo rechaza (vivas=$V) — actualiza el INFORME"; ok=0; fi
P=$(prov 2)
psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL
SELECT public.como('$UA'::uuid); SET ROLE authenticated;
$(ins "$P" 'X-7')
UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE proveedor_id = '$P' AND numero_factura = 'X-7';
$(ins "$P" 'X-7')
SQL
A=$(q "SELECT id FROM public.facturas_proveedor WHERE proveedor_id = '$P' AND numero_factura = 'X-7' AND estado = 'anulada'")
SAL=$(psql -q -X -d "$BD" 2>&1 <<SQL
SELECT set_config('request.jwt.claim.sub', '', false);
BEGIN; SELECT set_config('conta.allow_system_write', 'on', true);
UPDATE public.facturas_proveedor SET estado = 'registrada' WHERE id = '$A';
COMMIT;
SQL
)
if echo "$SAL" | grep -q 'uq_facturas_prov_numero'; then dice L1c "con el MISMO texto («X-7»), hasta el camino de sistema choca con el índice único exacto (cerrado)"; else dice L1c "❌ el índice único no frenó la reactivación del mismo texto: $SAL"; ok=0; fi

# ── L2 ────────────────────────────────────────────────────────────────────────────────────────────
for caso in "REPEATABLE READ:3:1-23:123" "SERIALIZABLE:4:1-23:123" "READ COMMITTED:5:1-23:123"; do
  IFS=: read -r nivel k a b <<<"$caso"; P=$(prov "$k")
  ( psql -q -X -t -A -d "$BD" <<SQL >"$(mktemp)" 2>&1
BEGIN ISOLATION LEVEL $nivel;
SELECT count(*) FROM public.facturas_proveedor;
SELECT pg_sleep(2);
$(ins "$P" "$a")
COMMIT;
SQL
  ) &
  sleep 0.8
  psql -q -X -d "$BD" -c "$(ins "$P" "$b")" >/dev/null 2>&1
  wait
  V=$(q "SELECT count(*) FROM public.facturas_proveedor WHERE proveedor_id = '$P' AND estado <> 'anulada'")
  if [ "$nivel" = "READ COMMITTED" ]; then
    if [ "$V" = "1" ]; then dice L2 "$nivel: «$b» entró primero y «$a» se rechazó (hay UNA viva) → cerrado en el nivel que usa PostgREST"; else dice L2 "❌ $nivel: vivas=$V (esperado 1)"; ok=0; fi
  else
    if [ "$V" = "2" ]; then dice L2 "$nivel: la sesión con instantánea vieja registró «$a» junto a «$b» (DOS vivas equivalentes) → LÍMITE vigente (heredado de 0400)"; else dice L2 "CAMBIÓ: $nivel ahora lo rechaza (vivas=$V) — actualiza el INFORME"; ok=0; fi
  fi
done
# ── L3 · invisibles en el interior ─────────────────────────────────────────────────────────────────────────────────
HAY=$(q "SELECT to_regprocedure('public.compras_numeros_equivalentes(text,text)') IS NOT NULL")
intenta() {                                                    # intenta <proveedor> <literal SQL del número> → PASA | BLOQUEA | ERROR
  local out; out=$(psql -q -X -t -A -d "$BD" 2>&1 <<SQL
SELECT public.como('$UA'::uuid); SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total) VALUES ('$C','$C1','$1', $2, 'limite RG-4', 10);
SQL
)
  if echo "$out" | grep -q 'COMPRAS_FACTURA_NUMERO_DUPLICADO'; then echo BLOQUEA; elif echo "$out" | grep -q 'ERROR'; then echo "ERROR $out"; else echo PASA; fi
}
ZW="E'F\xe2\x80\x8bAC001'"; SH="E'F\xc2\xadAC001'"; ZF="E'FAC001\xe2\x80\x8b'"; ZI="E'\xe2\x80\x8bFAC001'"
k=7; for caso in "L3a:interior U+200B:$ZW:PASA" "L3b:interior U+00AD (guion blando):$SH:PASA" "L3c:al FINAL U+200B (se recorta):$ZF:BLOQUEA" "L3d:al INICIO U+200B (se recorta):$ZI:BLOQUEA"; do
  IFS=: read -r id txt lit esp <<<"$caso"; P=$(prov "$k"); k=$((k+1))
  psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL
SELECT public.como('$UA'::uuid); SET ROLE authenticated;
$(ins "$P" 'FAC-001')
SQL
  R=$(intenta "$P" "$lit")
  [ "$HAY" = f ] && esp=BLOQUEA                               # sin la pieza (0800): la clave sola, todos se rechazan
  if [ "$R" = "$esp" ]; then
    case "$id:$HAY" in L3a:t|L3b:t) dice "$id" "«FAC-001» viva y la misma clave escrita con $txt → $R: un duplicado real escrito así NO se detecta → LÍMITE vigente (0800 lo rechazaba)";;
                       *) dice "$id" "«FAC-001» viva y la misma clave escrita con $txt → $R (se sigue detectando)";; esac
  else dice "$id" "CAMBIÓ: con $txt se esperaba $esp y salió «$R» — actualiza el INFORME"; ok=0; fi
done

# ── L4 · sondeo de la estructura de una factura que la persona no ve ────────────────────────────────────────────────
PS=$(prov 11); UX="fb3c$n-0000-0000-0000-0000000000e1"; RL="fb3c$n-0000-0000-0000-0000000000f3"; C2=c2c2c2c2-0000-0000-0000-000000000001
SOND=$(psql -q -X -t -A -d "$BD" 2>&1 <<SQL
BEGIN;
INSERT INTO auth.users (id) VALUES ('$UX');
INSERT INTO public.app_users (id, company_id, full_name, role) VALUES ('$UX', '$C', 'RG-4 límites operador solo C1', 'operator');
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES ('$UX', '$C1', 'total');
INSERT INTO public.roles (id, company_id, name) VALUES ('$RL', '$C', 'RG-4 límites ver y crear');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES ('$RL', 'platform.contabilidad.view', 'allow'), ('$RL', 'platform.contabilidad.create', 'allow'), ('$RL', 'platform.contabilidad.edit', 'allow');
INSERT INTO public.user_roles (user_id, role_id) VALUES ('$UX', '$RL');
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, estado)
VALUES (gen_random_uuid(), '$C', '$C2', '$PS', 'FAC-001', 'oculta (C2)', 123456.78, 'aprobada');
SELECT public.como('$UX'::uuid); SET ROLE authenticated;
SELECT 'VEO_LA_OCULTA|' || count(*) FROM public.facturas_proveedor WHERE proveedor_id = '$PS';
DO \$\$
DECLARE p text; r text;
BEGIN
  FOREACH p IN ARRAY ARRAY['FAC001', 'F-AC001', 'FA-C001', 'FAC.001'] LOOP
    BEGIN
      INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total) VALUES ('$C', '$C1', '$PS', p, 'sondeo', 1);
      r := 'PASA';
    EXCEPTION WHEN OTHERS THEN r := 'BLOQUEA ' || SQLERRM; END;
    RAISE NOTICE 'SONDEO|%|%', p, r;
  END LOOP;
END \$\$;
ROLLBACK;
SQL
)
veo=$(echo "$SOND" | sed -n 's/^VEO_LA_OCULTA|//p')
res() { echo "$SOND" | grep "NOTICE:  SONDEO|$1|" | head -1 | cut -d'|' -f3-; }
if [ "$veo" != "0" ]; then dice L4 "❌ el operador limitado VE la factura oculta (veo=$veo): el montaje no sirve"; ok=0
else
  r1=$(res FAC001); r2=$(res F-AC001); r3=$(res FA-C001); r4=$(res FAC.001)
  if [ "$HAY" = t ]; then
    if [ "${r1%% *}" = BLOQUEA ] && [ "$r2" = PASA ] && [ "$r3" = PASA ] && [ "${r4%% *}" = BLOQUEA ]; then
      dice L4 "sin ver la «FAC-001» de otro proyecto: «FAC001» y «FAC.001» se rechazan (compatibles) y «F-AC001» / «FA-C001» se registran (incomparables) → se DEDUCE que la oculta tiene su separador en la posición 3 → LÍMITE vigente (0800 solo delataba la clave)"
      if echo "$r1 $r4" | grep -qE '(FAC-001|123456|aprobada)'; then dice L4 "❌ el aviso genérico delata la factura oculta: $r1"; ok=0
      else dice L4 "…y el aviso es el genérico: no nombra el número, el importe ni el estado de la oculta ($(echo "$r1" | cut -c1-120)…)"; fi
    else dice L4 "CAMBIÓ: FAC001=${r1%% *} F-AC001=$r2 FA-C001=$r3 FAC.001=${r4%% *} — actualiza el INFORME"; ok=0; fi
  else
    if [ "${r1%% *}" = BLOQUEA ] && [ "${r2%% *}" = BLOQUEA ] && [ "${r3%% *}" = BLOQUEA ] && [ "${r4%% *}" = BLOQUEA ]; then
      dice L4 "(0800, sin la pieza) las cuatro variantes con la misma clave se rechazan: solo se deduce que existe la clave, no su estructura"
    else dice L4 "CAMBIÓ (0800): FAC001=${r1%% *} F-AC001=${r2%% *} FA-C001=${r3%% *} FAC.001=${r4%% *}"; ok=0; fi
  fi
fi
[ "$ok" = 1 ] && { echo "RG-4 · límites: el comportamiento documentado se mantiene"; exit 0; } || { echo "RG-4 · límites: ALGO CAMBIÓ"; exit 1; }
