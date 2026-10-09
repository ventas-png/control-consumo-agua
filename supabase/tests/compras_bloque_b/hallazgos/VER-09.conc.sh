# VER-09 · Idempotencia de la orden de pago con sesiones REALES simultáneas.
#
# CAUSA RAÍZ: ordenes_pago (y contrasenas_pago) no tienen clave_idempotencia ni índice único: dos INSERT idénticos
# que llegan a la vez (doble clic, reintento tras perder la respuesta) crean DOS órdenes y, mientras quepan en el
# saldo (400 + 400 sobre 1 000), las dos se aprueban y se pagan.
#
# ESPERADO (con la migración 20261027000800 (pieza VER-09)): el índice único parcial uq_ordenes_pago_clave (company_id, clave_idempotencia)
# decide la carrera. Se comprueba, con el entrelazado forzado por pg_sleep y verificado en pg_stat_activity:
#   A · misma clave, MISMA factura, a la vez, cabe en el saldo → entra UNA; la otra recibe uq_ordenes_pago_clave.
#   B · misma clave, DISTINTAS facturas, a la vez (sin el bloqueo de la factura de por medio) → entra UNA: la
#       decide el propio índice (la segunda espera la transacción de la primera y luego se rechaza).
#   C · LO LEGÍTIMO: claves DISTINTAS a la vez sobre la misma factura (dos pagos parciales) → entran las DOS.
#   D · el primer intento FALLA (transacción abortada): no quema la clave; el reintento que esperaba entra.
#   E · carga acotada: 3 rondas × 6 sesiones con la misma clave → exactamente UNA orden por ronda.
#   F · contraseña de pago: la misma clave a la vez → UNA cabecera; el rechazo no gasta un correlativo (CP-n).
#
# Sin la corrección la columna no existe: el fragmento lo dice, demuestra el defecto (dos sesiones simultáneas
# con el MISMO insert crean DOS órdenes) y falla.
#
# Se "sourcea" desde conc_harness.sh (usa sesion_u, par_u, q, aplicar y las variables C C1 C2 UA UC UQ US BD SALIDAS).

ID=VER-09
P1=e3000000-0000-0000-0000-000000000001
fid() { printf 'faa5%04d-0000-0000-0000-0000000000f1' "$1"; }   # factura n (ids propios: prefijo faa = grupo idempotencia_pagos)
ins() {   # ins <n-factura> <monto> [clave]  → INSERT de una orden de pago de la factura n
  local cl="NULL"; [ -n "${3:-}" ] && cl="'$3'"
  printf "INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, metodo_pago, referencia, clave_idempotencia) VALUES ('%s','%s','%s','%s',%s,'transferencia','SPEI-123',%s);" \
    "$C" "$C1" "$P1" "$(fid "$1")" "$2" "$cl"
}
bloqueadas() { q "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active' AND wait_event_type = 'Lock'"; }
verfallo() { echo "❌ $ID · $1"; for f in "$SALIDAS"/*.txt; do [ -s "$f" ] && { echo "── $(basename "$f")"; cat "$f"; }; done; }

# ── Preparación: 40 facturas aprobadas de 1 000 (gasto directo) de la empresa C ──────────────────────────────
psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL || { echo "❌ $ID · no se pudo preparar"; return 1; }
SELECT public.como('$UA'::uuid);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
SELECT ('faa5' || lpad(g::text, 4, '0') || '-0000-0000-0000-0000000000f1')::uuid, '$C', '$C1', '$P1', 'VER09C-' || g, 'conc VER-09', 1000
  FROM generate_series(1, 40) g;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE numero_factura LIKE 'VER09C-%';
SQL
[ "$(q "SELECT count(*) FROM public.facturas_proveedor WHERE numero_factura LIKE 'VER09C-%' AND estado = 'aprobada'")" = "40" ] \
  || { echo "❌ $ID · la preparación no dejó 40 facturas aprobadas"; return 1; }

# ── Sin la corrección: la columna no existe → se demuestra el defecto con DOS sesiones simultáneas ──────────
if [ "$(q "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='ordenes_pago' AND column_name='clave_idempotencia'")" = "0" ]; then
  sinclave="INSERT INTO public.ordenes_pago (company_id, project_id, proveedor_id, factura_id, monto, metodo_pago, referencia) VALUES ('$C','$C1','$P1','$(fid 1)',400,'transferencia','SPEI-123');"
  par_u R "$UA" "$sinclave" 2 "$UA" "$sinclave" 0
  q "UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE factura_id = '$(fid 1)'" >/dev/null
  q "UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE factura_id = '$(fid 1)'" >/dev/null
  n=$(q "SELECT count(*) || ' órdenes de 400, todas «' || string_agg(DISTINCT estado, ',') || '», pagado ' || (SELECT monto_pagado FROM public.facturas_proveedor WHERE id = '$(fid 1)') FROM public.ordenes_pago WHERE factura_id = '$(fid 1)'")
  verfallo "ordenes_pago NO tiene clave_idempotencia: dos sesiones SIMULTÁNEAS con el MISMO insert (reintento) quedaron como [$n] sobre una factura de 1 000 (debía pagarse 400, una vez)"
  return 1
fi

# ── A · misma clave, misma factura, a la vez, cabe en el saldo (400 + 400 sobre 1 000) ───────────────────────
KA=ver09-conc-A-0001
par_u A "$UA" "$(ins 1 400 $KA)" 2.5 "$UA" "$(ins 1 400 $KA)" 0 &
sleep 1.3; bA=$(bloqueadas); wait
nA=$(q "SELECT count(*) FROM public.ordenes_pago WHERE company_id = '$C' AND clave_idempotencia = '$KA'")
if [ "$bA" -ge 1 ] && [ "$nA" = "1" ] && ! grep -q ERROR "$SALIDAS/A1.txt" && grep -q "uq_ordenes_pago_clave" "$SALIDAS/A2.txt"; then
  echo "  ✓ $ID · A · misma clave a la vez sobre la misma factura: la 2.ª esperó a la 1.ª (sesiones bloqueadas: $bA) y la rechazó el índice uq_ordenes_pago_clave; hay UNA orden"
else
  verfallo "A · misma clave a la vez, misma factura: bloqueadas=$bA órdenes=$nA (esperado ≥1 bloqueada, 1 orden, error de la 2.ª con uq_ordenes_pago_clave)"; return 1
fi

# ── B · misma clave, DISTINTAS facturas, a la vez: sin el bloqueo de la factura, lo decide el propio índice ────
KB=ver09-conc-B-0001
par_u B "$UA" "$(ins 2 400 $KB)" 2.5 "$UA" "$(ins 3 400 $KB)" 0 &
sleep 1.3; bB=$(bloqueadas); wait
nB=$(q "SELECT count(*) FROM public.ordenes_pago WHERE company_id = '$C' AND clave_idempotencia = '$KB'")
nB3=$(q "SELECT count(*) FROM public.ordenes_pago WHERE factura_id = '$(fid 3)'")
if [ "$bB" -ge 1 ] && [ "$nB" = "1" ] && [ "$nB3" = "0" ] && ! grep -q ERROR "$SALIDAS/B1.txt" && grep -q "uq_ordenes_pago_clave" "$SALIDAS/B2.txt"; then
  echo "  ✓ $ID · B · misma clave sobre facturas DISTINTAS a la vez: el índice serializa (bloqueadas: $bB) y la 2.ª se rechaza con uq_ordenes_pago_clave; la otra factura queda sin orden"
else
  verfallo "B · misma clave, distintas facturas: bloqueadas=$bB órdenes con la clave=$nB órdenes en la factura 3=$nB3 (esperado ≥1, 1, 0 y error de la 2.ª con uq_ordenes_pago_clave)"; return 1
fi

# ── C · LO LEGÍTIMO: claves distintas a la vez sobre la misma factura (dos parciales de 400) → entran las dos ──
par_u C "$UA" "$(ins 4 400 ver09-conc-C-0001)" 2 "$UA" "$(ins 4 400 ver09-conc-C-0002)" 0 &
sleep 1.2; bC=$(bloqueadas); wait
nC=$(q "SELECT count(*) || '/' || COALESCE(sum(monto), 0) FROM public.ordenes_pago WHERE factura_id = '$(fid 4)'")
if [ "$bC" -ge 1 ] && [ "$nC" = "2/800.00" ] && ! grep -q ERROR "$SALIDAS/C1.txt" "$SALIDAS/C2.txt"; then
  echo "  ✓ $ID · C · dos pagos parciales LEGÍTIMOS (claves distintas) a la vez sobre la misma factura: entran los dos (2/800.00; la 2.ª esperó $bC bloqueada)"
else
  verfallo "C · claves distintas a la vez: bloqueadas=$bC resultado=$nC (esperado ≥1 bloqueada y 2/800.00 sin errores)"; return 1
fi

# ── D · el primer intento FALLA: la transacción se aborta y la clave NO queda quemada ──────────────────────
KD=ver09-conc-D-0001
par_u D "$UA" "$(ins 5 400 $KD) SELECT pg_sleep(2); SELECT 1/0;" 0 "$UA" "$(ins 5 400 $KD)" 0 &
sleep 1.2; bD=$(bloqueadas); wait
nD=$(q "SELECT count(*) FROM public.ordenes_pago WHERE company_id = '$C' AND clave_idempotencia = '$KD'")
if [ "$bD" -ge 1 ] && [ "$nD" = "1" ] && grep -q "division by zero" "$SALIDAS/D1.txt" && ! grep -q ERROR "$SALIDAS/D2.txt"; then
  echo "  ✓ $ID · D · el primer intento abortó (división entre cero) y no quemó la clave: el reintento que esperaba entró (1 orden)"
else
  verfallo "D · intento fallido: bloqueadas=$bD órdenes=$nD (esperado ≥1, 1, error de la 1.ª y la 2.ª sin error)"; return 1
fi

# ── E · carga acotada: 3 rondas × 6 sesiones con la MISMA clave, cada una sobre su propia factura ──────────
t0=$(date +%s)
for r in 1 2 3; do
  KE="ver09-conc-E-000$r"
  for j in 1 2 3 4 5 6; do
    sesion_u "$UA" 0.2 "$(ins $((10 + (r - 1) * 6 + j)) 100 $KE)" 0.8 > "$SALIDAS/E${r}_$j.txt" 2>&1 &
  done
  wait
  nE=$(q "SELECT count(*) FROM public.ordenes_pago WHERE company_id = '$C' AND clave_idempotencia = '$KE'")
  perdedoras=$(cat "$SALIDAS"/E${r}_*.txt | grep -c "uq_ordenes_pago_clave")
  otros=$(cat "$SALIDAS"/E${r}_*.txt | grep ERROR | grep -vc "uq_ordenes_pago_clave")
  if [ "$nE" != "1" ] || [ "$perdedoras" != "5" ] || [ "$otros" != "0" ]; then
    verfallo "E · ronda $r: órdenes con la clave=$nE (esperado 1), rechazadas por el índice=$perdedoras (esperado 5), otros errores=$otros (esperado 0)"; return 1
  fi
done
echo "  ✓ $ID · E · 3 rondas × 6 sesiones con la misma clave: exactamente UNA orden por ronda y 5 rechazos con uq_ordenes_pago_clave en cada una ($(( $(date +%s) - t0 )) s)"

# ── F · contraseña de pago: la misma clave a la vez → UNA cabecera, y el rechazo no gasta un correlativo ────
cabecera() { printf "INSERT INTO public.contrasenas_pago (company_id, project_id, proveedor_id, fecha_pago_programada, clave_idempotencia) VALUES ('%s','%s','%s',CURRENT_DATE,%s);" "$C" "$C1" "$P1" "$1"; }
KF=ver09-conc-F-0001
par_u F "$UA" "$(cabecera "'$KF'")" 2 "$UA" "$(cabecera "'$KF'")" 0 &
sleep 1.2; bF=$(bloqueadas); wait
nF=$(q "SELECT count(*) FROM public.contrasenas_pago WHERE company_id = '$C' AND clave_idempotencia = '$KF'")
sesion_u "$UA" 0 "$(cabecera "'ver09-conc-F-0002'")" 0 > "$SALIDAS/F3.txt" 2>&1
n1=$(q "SELECT substring(numero from 4)::int FROM public.contrasenas_pago WHERE company_id = '$C' AND clave_idempotencia = '$KF'")
n3=$(q "SELECT substring(numero from 4)::int FROM public.contrasenas_pago WHERE company_id = '$C' AND clave_idempotencia = 'ver09-conc-F-0002'")
if [ "$bF" -ge 1 ] && [ "$nF" = "1" ] && ! grep -q ERROR "$SALIDAS/F1.txt" && grep -q "uq_contrasenas_pago_clave" "$SALIDAS/F2.txt" && [ -n "$n1" ] && [ "$n3" = "$((n1 + 1))" ]; then
  echo "  ✓ $ID · F · contraseña de pago con la misma clave a la vez: UNA cabecera (bloqueadas: $bF), la 2.ª rechazada por uq_contrasenas_pago_clave y sin hueco en el correlativo (CP-$n1 → CP-$n3)"
else
  verfallo "F · contraseña: bloqueadas=$bF cabeceras=$nF correlativos=$n1/$n3 (esperado ≥1, 1, error de la 2.ª con uq_contrasenas_pago_clave y n3 = n1 + 1)"; return 1
fi
return 0
