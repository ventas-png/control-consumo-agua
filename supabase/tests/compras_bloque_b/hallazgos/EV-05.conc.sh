# [EV-05] Carrera: aprobar un borrador mientras otra sesión le cambia el renglón o el total.
#
# Se «sourcea» desde conc_harness.sh (usa sesion_u, par_u, q, aplicar y las variables C C1 UA UC UQ US BD SALIDAS).
#
# Por qué es una carrera y no solo el UPDATE directo:
#   · El candado de renglones de una orden aprobada (`compras_tg_oc_linea_total`) lee el estado con
#     una instantánea: si la aprobación de otra sesión aún no confirma, ve «borrador», deja pasar el
#     renglón, y su trigger AFTER de totales reescribe el total de la orden YA aprobada al confirmar
#     la otra sesión. La orden aprobada por X queda con X + lo que se coló.
#   · Lo mismo con un UPDATE de total: espera el bloqueo de la fila y, al confirmarse la aprobación,
#     se aplica sobre la versión APROBADA.
# Correcto: la orden aprobada conserva SUS renglones y SU total; la sesión tardía es rechazada.
# Deterministas: la sesión 1 aprueba y retiene su COMMIT 2 s; la sesión 2 arranca 0.3 s después y se
# queda esperando el bloqueo de la fila.

_ev05_c_ok=0
P1=e3000000-0000-0000-0000-000000000001

# ── preparación: dos borradores de 1 000 (10 × 100), creados por UA ──────────
psql -q -X -v ON_ERROR_STOP=1 -d "$BD" <<SQL >/dev/null
SELECT set_config('request.jwt.claim.sub', '$UA', false);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES
  ('fa405901-0000-0000-0000-000000000001', '$C', '$C1', '$P1', 'x', 'carrera: aprobar vs renglón nuevo'),
  ('fa405902-0000-0000-0000-000000000001', '$C', '$C1', '$P1', 'x', 'carrera: aprobar vs total a mano');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario) VALUES
  ('fa405911-0000-0000-0000-000000000001', '$C', 'fa405901-0000-0000-0000-000000000001', 1, 'Renglón 1', 'servicio', 'servicios', 10, 'servicio', 100),
  ('fa405912-0000-0000-0000-000000000001', '$C', 'fa405902-0000-0000-0000-000000000001', 1, 'Renglón 1', 'servicio', 'servicios', 10, 'servicio', 100);
SQL
if [ "$(q "SELECT count(*) FROM public.ordenes_compra WHERE id IN ('fa405901-0000-0000-0000-000000000001','fa405902-0000-0000-0000-000000000001')")" != "2" ]; then
  echo "❌ EV-05 · la preparación no creó los dos borradores"; return 1
fi

# ── a · UQ aprueba (retiene 2 s); UC añade un renglón de 500 al mismo borrador ──
par_u ev05a "$UQ" "UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'fa405901-0000-0000-0000-000000000001';" 2 \
            "$UC" "INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
                   VALUES ('fa405911-0000-0000-0000-000000000002', '$C', 'fa405901-0000-0000-0000-000000000001', 2, 'Renglón colado', 'servicio', 'servicios', 5, 'servicio', 100);" 0
EST_A=$(q "SELECT estado FROM public.ordenes_compra WHERE id = 'fa405901-0000-0000-0000-000000000001'")
TOT_A=$(q "SELECT total FROM public.ordenes_compra WHERE id = 'fa405901-0000-0000-0000-000000000001'")
SUM_A=$(q "SELECT COALESCE(sum(total), 0) FROM public.orden_compra_lineas WHERE orden_compra_id = 'fa405901-0000-0000-0000-000000000001'")
NL_A=$(q "SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = 'fa405901-0000-0000-0000-000000000001'")
if [ "$EST_A" = "aprobada" ] && [ "$NL_A" = "1" ] && [ "$TOT_A" = "1000.00" ] && [ "$SUM_A" = "1000.00" ] \
   && grep -q "COMPRAS_OC_IMPORTES_INMUTABLES\|COMPRAS_OC_INMUTABLE" "$SALIDAS/ev05a2.txt"; then
  echo "  ✓ EV-05 · a · aprobar vs renglón nuevo: la orden aprobada conserva su renglón y su total (1 000); el renglón tardío se rechazó"
  _ev05_c_ok=$((_ev05_c_ok + 1))
else
  echo "❌ EV-05 · a · estado=$EST_A renglones=$NL_A total=$TOT_A suma_renglones=$SUM_A (esperado aprobada / 1 / 1000.00 / 1000.00 y la sesión tardía rechazada)"
  echo "--- sesión 1 (UQ aprueba):"; cat "$SALIDAS/ev05a1.txt"
  echo "--- sesión 2 (UC añade el renglón):"; cat "$SALIDAS/ev05a2.txt"
  return 1
fi

# ── b · UQ aprueba (retiene 2 s); UC escribe total = 1 sobre el mismo borrador ───
par_u ev05b "$UQ" "UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'fa405902-0000-0000-0000-000000000001';" 2 \
            "$UC" "UPDATE public.ordenes_compra SET total = 1, subtotal = 1 WHERE id = 'fa405902-0000-0000-0000-000000000001';" 0
EST_B=$(q "SELECT estado FROM public.ordenes_compra WHERE id = 'fa405902-0000-0000-0000-000000000001'")
TOT_B=$(q "SELECT total FROM public.ordenes_compra WHERE id = 'fa405902-0000-0000-0000-000000000001'")
if [ "$EST_B" = "aprobada" ] && [ "$TOT_B" = "1000.00" ]; then
  echo "  ✓ EV-05 · b · aprobar vs total escrito a mano: la orden aprobada conserva su total (1 000)"
  _ev05_c_ok=$((_ev05_c_ok + 1))
else
  echo "❌ EV-05 · b · estado=$EST_B total=$TOT_B (esperado aprobada / 1000.00: el total a mano no puede aplicarse sobre la versión ya aprobada)"
  echo "--- sesión 1 (UQ aprueba):"; cat "$SALIDAS/ev05b1.txt"
  echo "--- sesión 2 (UC reescribe el total):"; cat "$SALIDAS/ev05b2.txt"
  return 1
fi

# ── c · camino legítimo: UC añade un renglón a un borrador MIENTRAS nadie lo aprueba, y luego se aprueba ──
psql -q -X -v ON_ERROR_STOP=1 -d "$BD" <<SQL >/dev/null
SELECT set_config('request.jwt.claim.sub', '$UA', false);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('fa405903-0000-0000-0000-000000000001', '$C', '$C1', '$P1', 'x', 'carrera: dos editores del mismo borrador');
SQL
par_u ev05c "$UA" "INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
                   VALUES ('fa405913-0000-0000-0000-000000000001', '$C', 'fa405903-0000-0000-0000-000000000001', 1, 'Renglón A', 'servicio', 'servicios', 10, 'servicio', 100);" 1 \
            "$UC" "INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
                   VALUES ('fa405913-0000-0000-0000-000000000002', '$C', 'fa405903-0000-0000-0000-000000000001', 2, 'Renglón B', 'servicio', 'servicios', 5, 'servicio', 100);" 0
TOT_C=$(q "SELECT total FROM public.ordenes_compra WHERE id = 'fa405903-0000-0000-0000-000000000001'")
NL_C=$(q "SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = 'fa405903-0000-0000-0000-000000000001'")
if [ "$NL_C" = "2" ] && [ "$TOT_C" = "1500.00" ]; then
  echo "  ✓ EV-05 · c · dos editores añaden renglones al mismo borrador a la vez: ambos entran y el total es la suma (1 500)"
  _ev05_c_ok=$((_ev05_c_ok + 1))
else
  echo "❌ EV-05 · c · renglones=$NL_C total=$TOT_C (esperado 2 / 1500.00)"
  echo "--- A:"; cat "$SALIDAS/ev05c1.txt"; echo "--- B:"; cat "$SALIDAS/ev05c2.txt"
  return 1
fi

# ── d · la misma carrera con una coincidencia: la suma «vieja» de la sesión tardía es IGUAL al total que dejó la otra ──
#     Borrador con un renglón de 500. A añade otro de 500 (total 1 000, retiene el COMMIT 2 s); B añade un tercero de 500:
#     su trigger de totales suma lo que ve (500 + 500 = 1 000, sin el de A) y espera la fila; al confirmar A escribe «1 000»,
#     que es igual al total de la fila: nada «cambió» y se quedaba en 1 000 con tres renglones (1 500).
psql -q -X -v ON_ERROR_STOP=1 -d "$BD" <<SQL >/dev/null
SELECT set_config('request.jwt.claim.sub', '$UA', false);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('fa405904-0000-0000-0000-000000000001', '$C', '$C1', '$P1', 'x', 'carrera: la suma vieja coincide con el total');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES ('fa405914-0000-0000-0000-000000000001', '$C', 'fa405904-0000-0000-0000-000000000001', 1, 'Renglón base', 'servicio', 'servicios', 5, 'servicio', 100);
SQL
par_u ev05d "$UA" "INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
                   VALUES ('fa405914-0000-0000-0000-000000000002', '$C', 'fa405904-0000-0000-0000-000000000001', 2, 'Renglón A', 'servicio', 'servicios', 5, 'servicio', 100);" 2 \
            "$UC" "INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
                   VALUES ('fa405914-0000-0000-0000-000000000003', '$C', 'fa405904-0000-0000-0000-000000000001', 3, 'Renglón B', 'servicio', 'servicios', 5, 'servicio', 100);" 0
TOT_D=$(q "SELECT total FROM public.ordenes_compra WHERE id = 'fa405904-0000-0000-0000-000000000001'")
NL_D=$(q "SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = 'fa405904-0000-0000-0000-000000000001'")
if [ "$NL_D" = "3" ] && [ "$TOT_D" = "1500.00" ]; then
  echo "  ✓ EV-05 · d · la suma vieja de la sesión tardía coincide con el total de la fila y aun así el total queda en la suma real (1 500)"
  _ev05_c_ok=$((_ev05_c_ok + 1))
else
  echo "❌ EV-05 · d · renglones=$NL_D total=$TOT_D (esperado 3 / 1500.00)"
  echo "--- A:"; cat "$SALIDAS/ev05d1.txt"; echo "--- B:"; cat "$SALIDAS/ev05d2.txt"
  return 1
fi

[ "$_ev05_c_ok" = "4" ] || return 1
return 0
