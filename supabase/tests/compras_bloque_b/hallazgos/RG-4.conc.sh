# RG-4 · Números de factura con sesiones REALES simultáneas.
#
# QUÉ SE COMPRUEBA (con el entrelazado forzado por pg_sleep y verificado en pg_stat_activity: la 2.ª sesión está
# ESPERANDO el candado de la 1.ª, no corriendo por casualidad después):
#   A · «1-23» ∥ «12-3»        → entran LAS DOS (son facturas distintas; el candado las serializa por la clave 123 y la
#                                2.ª, al despertar, ve a la 1.ª y la deja pasar).
#   B · «FAC-001» ∥ «FAC001»   → entra UNA; la otra recibe COMPRAS_FACTURA_NUMERO_DUPLICADO (sin esperar al COMMIT no habría
#                                forma de verla: es el candado el que la hace verla).
#   C · «1-23» ∥ «123», en los dos órdenes → entra UNA. Y los TRES a la vez («1-23» ∥ «12-3» ∥ «123») en 8 rondas con
#                                órdenes y retardos distintos → el resultado es siempre {«123»} o {«1-23», «12-3»}: nunca
#                                «123» junto a otra (la no transitividad no abre ningún hueco con sesiones reales).
#   D · el MISMO número dos veces → entra UNA y la otra la rechaza el índice único exacto (uq_facturas_prov_numero, error
#                                nativo, no el del trigger). D2: lo mismo con los triggers APAGADOS (session_replication_role =
#                                replica): la 2.ª espera la transacción de la 1.ª en el propio índice (wait transactionid):
#                                la garantía del número idéntico no depende del trigger ni del candado.
#   E · por la RPC compras_factura_crear (el camino de la pantalla): «9-80» ∥ «9/80» con claves distintas → UNA; «9-80» ∥
#                                «98-0» → LAS DOS; la misma clave y contenido dos veces → UNA factura (idempotente).
#   F · UPDATE del número ∥ alta del número que deja libre: R1 = «1-23»; S1 la cambia a «12-3» y, a la vez, S2 da de alta
#                                «1-23» y S3 «123» → quedan «12-3» y «1-23»; «123» se rechaza.
#   G · cambio de PROVEEDOR ∥ alta equivalente en el proveedor destino: gana la primera; la otra se rechaza (en los dos órdenes).
#
# Se "sourcea" desde conc_harness.sh (usa sesion_u, par_u, q y las variables C C1 UA BD SALIDAS), igual que EV-09.conc.sh,
# o se ejecuta suelta:  BD=<base> bash RG-4.conc.sh   (con PGHOST/PGPORT/PGUSER; busca conc_lib.sh junto a este archivo
# o en ../hallazgos/). Cada ejecución usa proveedores propios nuevos (id y NIT al azar): se puede repetir sobre la misma base.

_rg4_conc() {
  local ID=RG-4 n nit ok_all=1
  n=$(printf '%04x' $(( RANDOM % 65536 )))
  nit=$(( 10000 + RANDOM % 80000 ))
  prov() { printf 'fb4c%s-0000-0000-0000-0000000000%02x' "$n" "$1"; }          # proveedor propio número $1 (1…99)
  ins() {                                                                         # ins <proveedor> <número> → INSERT directo de una factura
    printf "INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total) VALUES (gen_random_uuid(), '%s', '%s', '%s', '%s', 'conc RG-4', 10);" "$C" "$C1" "$1" "$2"
  }
  rpc() {                                                                         # rpc <proveedor> <número> <clave> → compras_factura_crear
    printf "SELECT public.compras_factura_crear('%s', '%s', '{\"proveedor_id\":\"%s\",\"numero_factura\":\"%s\",\"concepto\":\"conc RG-4\",\"monto_total\":10,\"clave_idempotencia\":\"%s\"}'::jsonb, '[]'::jsonb)->'factura'->>'id';" "$C" "$C1" "$1" "$2" "$3"
  }
  esperando() {                                                                   # sesiones esperando un candado (tipo = advisory | transactionid)
    q "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active' AND wait_event_type = 'Lock' AND wait_event = '$1'"
  }
  vivas() { q "SELECT count(*) FROM public.facturas_proveedor WHERE proveedor_id = '$1' AND estado <> 'anulada'"; }
  hay() { q "SELECT count(*) FROM public.facturas_proveedor WHERE proveedor_id = '$1' AND estado <> 'anulada' AND numero_factura = '$2'"; }
  pares() {                                                                       # pares de vivas equivalentes del proveedor (invariante: 0)
    q "SELECT count(*) FROM public.facturas_proveedor a JOIN public.facturas_proveedor b ON b.proveedor_id = a.proveedor_id AND b.id > a.id
        WHERE a.proveedor_id = '$1' AND a.estado <> 'anulada' AND b.estado <> 'anulada'
          AND public.compras_normalizar_numero(a.numero_factura) = public.compras_normalizar_numero(b.numero_factura)
          AND (public.compras_numero_separadores(a.numero_factura) <@ public.compras_numero_separadores(b.numero_factura)
            OR public.compras_numero_separadores(b.numero_factura) <@ public.compras_numero_separadores(a.numero_factura))"
  }
  fallo() { echo "❌ $ID · $1"; local f; for f in "$SALIDAS"/rg4*.txt; do [ -s "$f" ] && { echo "── $(basename "$f")"; cat "$f"; }; done; ok_all=0; }
  bien() { echo "  ✓ $ID · $1"; }

  # ── Preparación: 30 proveedores propios de C, autorizados por el administrador ─────────────────────
  psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL || { echo "❌ $ID · no se pudieron crear los proveedores propios"; return 1; }
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance)
SELECT ('fb4c$n-0000-0000-0000-0000000000' || lpad(to_hex(k), 2, '0'))::uuid, '$C', 'Proveedor RG-4 conc ' || k || ' ($n)', '9$nit' || k || '-' || (k % 10), 'GT', 'empresa'
  FROM generate_series(1, 30) k;
SELECT public.como('$UA'::uuid);
SET ROLE authenticated;
UPDATE public.proveedores SET estado = 'autorizado' WHERE id::text LIKE 'fb4c$n-%';
SQL
  [ "$(q "SELECT count(*) FROM public.proveedores WHERE id::text LIKE 'fb4c$n-%' AND estado = 'autorizado'")" = "30" ] \
    || { echo "❌ $ID · los proveedores propios no quedaron autorizados"; return 1; }

  local P b nb v esp

  # ── A · «1-23» ∥ «12-3»: LAS DOS ──────────────────────────────────────────────────────────────────────
  P=$(prov 1)
  par_u rg4a "$UA" "$(ins "$P" '1-23')" 2.5 "$UA" "$(ins "$P" '12-3')" 0 &
  sleep 1.3; b=$(esperando advisory); wait
  v=$(vivas "$P")
  if [ "$b" -ge 1 ] && [ "$v" = "2" ] && [ "$(hay "$P" '1-23')" = "1" ] && [ "$(hay "$P" '12-3')" = "1" ] \
     && ! grep -q ERROR "$SALIDAS/rg4a1.txt" "$SALIDAS/rg4a2.txt"; then
    bien "A · «1-23» ∥ «12-3»: la 2.ª esperó el candado de la clave 123 (sesiones esperando: $b) y las DOS facturas quedaron registradas"
  else
    fallo "A · «1-23» ∥ «12-3»: esperando=$b vivas=$v (esperado ≥1 sesión esperando y 2 facturas, sin errores)"
  fi

  # ── B · «FAC-001» ∥ «FAC001»: UNA ─────────────────────────────────────────────────────────────────────
  P=$(prov 2)
  par_u rg4b "$UA" "$(ins "$P" 'FAC-001')" 2.5 "$UA" "$(ins "$P" 'FAC001')" 0 &
  sleep 1.3; b=$(esperando advisory); wait
  v=$(vivas "$P")
  if [ "$b" -ge 1 ] && [ "$v" = "1" ] && ! grep -q ERROR "$SALIDAS/rg4b1.txt" && grep -q "COMPRAS_FACTURA_NUMERO_DUPLICADO" "$SALIDAS/rg4b2.txt"; then
    bien "B · «FAC-001» ∥ «FAC001»: la 2.ª esperó (sesiones esperando: $b), vio a la 1.ª y se rechazó con COMPRAS_FACTURA_NUMERO_DUPLICADO; hay UNA factura"
  else
    fallo "B · «FAC-001» ∥ «FAC001»: esperando=$b vivas=$v (esperado ≥1, 1 y COMPRAS_FACTURA_NUMERO_DUPLICADO en la 2.ª)"
  fi

  # ── C · «1-23» ∥ «123» en los dos órdenes: UNA ────────────────────────────────────────────────────────
  P=$(prov 3)
  par_u rg4c1 "$UA" "$(ins "$P" '1-23')" 2.5 "$UA" "$(ins "$P" '123')" 0 &
  sleep 1.3; b=$(esperando advisory); wait
  if [ "$b" -ge 1 ] && [ "$(vivas "$P")" = "1" ] && [ "$(hay "$P" '1-23')" = "1" ] && grep -q "COMPRAS_FACTURA_NUMERO_DUPLICADO" "$SALIDAS/rg4c12.txt"; then
    bien "C1 · «1-23» ∥ «123»: entra «1-23» (la primera) y «123» se rechaza (sesiones esperando: $b)"
  else
    fallo "C1 · «1-23» ∥ «123»: esperando=$b vivas=$(vivas "$P") (esperado ≥1 y solo «1-23»)"
  fi
  P=$(prov 4)
  par_u rg4c2 "$UA" "$(ins "$P" '123')" 2.5 "$UA" "$(ins "$P" '1-23')" 0 &
  sleep 1.3; b=$(esperando advisory); wait
  if [ "$b" -ge 1 ] && [ "$(vivas "$P")" = "1" ] && [ "$(hay "$P" '123')" = "1" ] && grep -q "COMPRAS_FACTURA_NUMERO_DUPLICADO" "$SALIDAS/rg4c22.txt"; then
    bien "C2 · «123» ∥ «1-23»: entra «123» (la primera) y «1-23» se rechaza (sesiones esperando: $b)"
  else
    fallo "C2 · «123» ∥ «1-23»: esperando=$b vivas=$(vivas "$P") (esperado ≥1 y solo «123»)"
  fi
  # los TRES a la vez, 8 rondas con órdenes y retardos distintos
  local r orden a1 a2 a3 d2 d3 solo_123 dos bad=0 det="" PR
  local -a perm=("1-23 12-3 123" "1-23 123 12-3" "12-3 1-23 123" "12-3 123 1-23" "123 1-23 12-3" "123 12-3 1-23")
  for r in 1 2 3 4 5 6 7 8; do
    PR=$(prov $(( 10 + r )))
    orden=${perm[$(( (r - 1 + RANDOM) % 6 ))]}; set -- $orden; a1=$1; a2=$2; a3=$3
    d2=0.$(( 1 + RANDOM % 3 )); d3=0.$(( 4 + RANDOM % 4 ))
    sesion_u "$UA" 0    "$(ins "$PR" "$a1")" 1.4 > "$SALIDAS/rg4c3_${r}_1.txt" 2>&1 & local p1=$!
    sesion_u "$UA" "$d2" "$(ins "$PR" "$a2")" 0.2 > "$SALIDAS/rg4c3_${r}_2.txt" 2>&1 & local p2=$!
    sesion_u "$UA" "$d3" "$(ins "$PR" "$a3")" 0   > "$SALIDAS/rg4c3_${r}_3.txt" 2>&1 & local p3=$!
    wait $p1 $p2 $p3 || true
    solo_123=$(q "SELECT count(*) FROM public.facturas_proveedor WHERE proveedor_id = '$PR' AND numero_factura = '123' AND estado <> 'anulada'")
    dos=$(q "SELECT count(*) FROM public.facturas_proveedor WHERE proveedor_id = '$PR' AND numero_factura IN ('1-23', '12-3') AND estado <> 'anulada'")
    if ! { { [ "$solo_123" = "1" ] && [ "$dos" = "0" ]; } || { [ "$solo_123" = "0" ] && [ "$dos" = "2" ]; }; } || [ "$(pares "$PR")" != "0" ] \
       || cat "$SALIDAS"/rg4c3_${r}_?.txt | grep ERROR | grep -qv "COMPRAS_FACTURA_NUMERO_DUPLICADO"; then
      bad=$(( bad + 1 )); det="$det ronda $r (orden: $orden): «123»=$solo_123 otras=$dos pares=$(pares "$PR");"
    fi
  done
  if [ "$bad" = "0" ]; then
    bien "C3 · «1-23» ∥ «12-3» ∥ «123» a la vez, 8 rondas con órdenes y retardos distintos: siempre {«123»} o {«1-23», «12-3»}; nunca «123» con otra; 0 pares equivalentes; el único error es COMPRAS_FACTURA_NUMERO_DUPLICADO"
  else
    fallo "C3 · los tres a la vez:$det"
  fi

  # ── D · el MISMO número dos veces: UNA, por el índice exacto ──────────────────────────────────────────
  P=$(prov 5)
  par_u rg4d "$UA" "$(ins "$P" 'FAC-777')" 2.5 "$UA" "$(ins "$P" 'FAC-777')" 0 &
  sleep 1.3; b=$(esperando advisory); wait
  if [ "$b" -ge 1 ] && [ "$(vivas "$P")" = "1" ] && ! grep -q ERROR "$SALIDAS/rg4d1.txt" \
     && grep -q 'duplicate key value violates unique constraint "uq_facturas_prov_numero"' "$SALIDAS/rg4d2.txt" \
     && ! grep -q "COMPRAS_FACTURA_NUMERO_DUPLICADO" "$SALIDAS/rg4d2.txt"; then
    bien "D · el mismo «FAC-777» dos veces: UNA factura y la otra la rechazó el índice único exacto con su error nativo (no el del trigger)"
  else
    fallo "D · «FAC-777» dos veces: esperando=$b vivas=$(vivas "$P") (esperado 1 y 'duplicate key … uq_facturas_prov_numero' en la 2.ª)"
  fi
  # D2 · con los triggers APAGADOS: el índice solo decide la carrera (la 2.ª espera la transacción de la 1.ª)
  P=$(prov 6)
  par_u rg4d2 - "SET LOCAL session_replication_role = replica; $(ins "$P" 'FAC-888')" 2.5 - "SET LOCAL session_replication_role = replica; $(ins "$P" 'FAC-888')" 0 &
  sleep 1.3; b=$(esperando transactionid); nb=$(esperando advisory); wait
  if [ "$b" -ge 1 ] && [ "$nb" = "0" ] && [ "$(vivas "$P")" = "1" ] && grep -q 'uq_facturas_prov_numero' "$SALIDAS/rg4d22.txt"; then
    bien "D2 · «FAC-888» dos veces SIN triggers (replica): la 2.ª esperó la transacción de la 1.ª en el índice (transactionid, sin candado consultivo) y se rechazó; hay UNA factura"
  else
    fallo "D2 · «FAC-888» sin triggers: esperando transactionid=$b advisory=$nb vivas=$(vivas "$P") (esperado ≥1, 0, 1 y uq_facturas_prov_numero en la 2.ª)"
  fi

  # ── E · por la RPC (el camino de la pantalla) ─────────────────────────────────────────────────────────
  P=$(prov 7)
  par_u rg4e1 "$UA" "$(rpc "$P" '9-80' "rg4-$n-e1a")" 2.5 "$UA" "$(rpc "$P" '9/80' "rg4-$n-e1b")" 0 &
  sleep 1.3; b=$(esperando advisory); wait
  if [ "$b" -ge 1 ] && [ "$(vivas "$P")" = "1" ] && ! grep -q ERROR "$SALIDAS/rg4e11.txt" && grep -q "COMPRAS_FACTURA_NUMERO_DUPLICADO" "$SALIDAS/rg4e12.txt" \
     && [ "$(q "SELECT count(*) FROM public.facturas_proveedor WHERE clave_idempotencia = 'rg4-$n-e1b'")" = "0" ]; then
    bien "E1 · RPC «9-80» ∥ «9/80» con claves distintas: UNA factura; la otra (COMPRAS_FACTURA_NUMERO_DUPLICADO) no deja rastro ni quema su clave"
  else
    fallo "E1 · RPC «9-80» ∥ «9/80»: esperando=$b vivas=$(vivas "$P") (esperado ≥1, 1, error en la 2.ª y sin factura con su clave)"
  fi
  P=$(prov 8)
  par_u rg4e2 "$UA" "$(rpc "$P" '9-80' "rg4-$n-e2a")" 2.5 "$UA" "$(rpc "$P" '98-0' "rg4-$n-e2b")" 0 &
  sleep 1.3; b=$(esperando advisory); wait
  if [ "$b" -ge 1 ] && [ "$(vivas "$P")" = "2" ] && ! grep -q ERROR "$SALIDAS/rg4e21.txt" "$SALIDAS/rg4e22.txt"; then
    bien "E2 · RPC «9-80» ∥ «98-0» (distintas): las DOS facturas, la 2.ª tras esperar el candado (sesiones esperando: $b)"
  else
    fallo "E2 · RPC «9-80» ∥ «98-0»: esperando=$b vivas=$(vivas "$P") (esperado ≥1 y 2, sin errores)"
  fi
  P=$(prov 9)
  par_u rg4e3 "$UA" "$(rpc "$P" '5-55' "rg4-$n-e3")" 2.5 "$UA" "$(rpc "$P" '5-55' "rg4-$n-e3")" 0 &
  sleep 1.3; wait
  local id1 id2
  id1=$(grep -Eo '[0-9a-f]{8}-[0-9a-f-]{27}' "$SALIDAS/rg4e31.txt" | head -1); id2=$(grep -Eo '[0-9a-f]{8}-[0-9a-f-]{27}' "$SALIDAS/rg4e32.txt" | head -1)
  if [ "$(vivas "$P")" = "1" ] && [ -n "$id1" ] && [ "$id1" = "$id2" ] && ! grep -q ERROR "$SALIDAS/rg4e31.txt" "$SALIDAS/rg4e32.txt"; then
    bien "E3 · RPC con la MISMA clave y contenido a la vez: UNA factura y las dos sesiones recibieron la misma (el reintento no choca con su propio número)"
  else
    fallo "E3 · RPC misma clave a la vez: vivas=$(vivas "$P") id1=$id1 id2=$id2 (esperado 1 y el mismo id)"
  fi

  # ── F · UPDATE del número ∥ altas del número que deja libre y de uno compatible ──────────────────────────
  P=$(prov 20)
  psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL
SELECT public.como('$UA'::uuid); SET ROLE authenticated;
$(ins "$P" '1-23')
SQL
  local R1; R1=$(q "SELECT id FROM public.facturas_proveedor WHERE proveedor_id = '$P' AND numero_factura = '1-23'")
  sesion_u "$UA" 0   "UPDATE public.facturas_proveedor SET numero_factura = '12-3' WHERE id = '$R1';" 2.5 > "$SALIDAS/rg4f1.txt" 2>&1 & local pf1=$!
  sesion_u "$UA" 0.4 "$(ins "$P" '1-23')" 0 > "$SALIDAS/rg4f2.txt" 2>&1 & local pf2=$!
  sesion_u "$UA" 0.7 "$(ins "$P" '123')" 0 > "$SALIDAS/rg4f3.txt" 2>&1 & local pf3=$!
  sleep 1.5; b=$(esperando advisory)
  wait $pf1 $pf2 $pf3 || true
  if [ "$b" -ge 2 ] && [ "$(vivas "$P")" = "2" ] && [ "$(hay "$P" '12-3')" = "1" ] && [ "$(hay "$P" '1-23')" = "1" ] && [ "$(hay "$P" '123')" = "0" ] \
     && [ "$(q "SELECT numero_factura FROM public.facturas_proveedor WHERE id = '$R1'")" = "12-3" ] \
     && ! grep -q ERROR "$SALIDAS/rg4f1.txt" "$SALIDAS/rg4f2.txt" && grep -q "COMPRAS_FACTURA_NUMERO_DUPLICADO" "$SALIDAS/rg4f3.txt"; then
    bien "F · UPDATE «1-23»→«12-3» ∥ alta de «1-23» ∥ alta de «123»: las altas esperaron el candado ($b sesiones); quedan «12-3» y «1-23», «123» se rechazó"
  else
    fallo "F · UPDATE del número ∥ altas: esperando=$b vivas=$(vivas "$P") (esperado ≥2 esperando, 2 vivas {12-3, 1-23} y «123» rechazada)"
  fi

  # ── G · cambio de PROVEEDOR ∥ alta equivalente en el destino (los dos órdenes) ─────────────────────────────
  local PO PD
  PO=$(prov 21); PD=$(prov 22)
  psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL
SELECT public.como('$UA'::uuid); SET ROLE authenticated;
$(ins "$PO" 'M-45')
SQL
  R1=$(q "SELECT id FROM public.facturas_proveedor WHERE proveedor_id = '$PO' AND numero_factura = 'M-45'")
  # G1: el cambio de proveedor va primero → el alta equivalente del destino se rechaza
  sesion_u "$UA" 0   "UPDATE public.facturas_proveedor SET proveedor_id = '$PD' WHERE id = '$R1';" 2.5 > "$SALIDAS/rg4g11.txt" 2>&1 & pf1=$!
  sesion_u "$UA" 0.4 "$(ins "$PD" 'm 45')" 0 > "$SALIDAS/rg4g12.txt" 2>&1 & pf2=$!
  sleep 1.3; b=$(esperando advisory); wait $pf1 $pf2 || true
  if [ "$b" -ge 1 ] && [ "$(vivas "$PD")" = "1" ] && [ "$(hay "$PD" 'M-45')" = "1" ] && ! grep -q ERROR "$SALIDAS/rg4g11.txt" && grep -q "COMPRAS_FACTURA_NUMERO_DUPLICADO" "$SALIDAS/rg4g12.txt"; then
    bien "G1 · mover «M-45» al proveedor B ∥ alta de «m 45» en B: gana el cambio (primero) y el alta se rechaza (esperando: $b)"
  else
    fallo "G1 · cambio de proveedor primero: esperando=$b vivas en el destino=$(vivas "$PD") (esperado ≥1, 1 con «M-45» y el alta rechazada)"
  fi
  # G2: el alta va primero → el cambio de proveedor se rechaza y la factura se queda donde estaba
  PO=$(prov 23); PD=$(prov 24)
  psql -q -X -v ON_ERROR_STOP=1 -d "$BD" >/dev/null <<SQL
SELECT public.como('$UA'::uuid); SET ROLE authenticated;
$(ins "$PO" 'N-45')
SQL
  R1=$(q "SELECT id FROM public.facturas_proveedor WHERE proveedor_id = '$PO' AND numero_factura = 'N-45'")
  sesion_u "$UA" 0   "$(ins "$PD" 'n 45')" 2.5 > "$SALIDAS/rg4g21.txt" 2>&1 & pf1=$!
  sesion_u "$UA" 0.4 "UPDATE public.facturas_proveedor SET proveedor_id = '$PD' WHERE id = '$R1';" 0 > "$SALIDAS/rg4g22.txt" 2>&1 & pf2=$!
  sleep 1.3; b=$(esperando advisory); wait $pf1 $pf2 || true
  if [ "$b" -ge 1 ] && [ "$(vivas "$PD")" = "1" ] && [ "$(hay "$PD" 'n 45')" = "1" ] && [ "$(hay "$PO" 'N-45')" = "1" ] \
     && ! grep -q ERROR "$SALIDAS/rg4g21.txt" && grep -q "COMPRAS_FACTURA_NUMERO_DUPLICADO" "$SALIDAS/rg4g22.txt"; then
    bien "G2 · alta de «n 45» en B ∥ mover «N-45» a B: gana el alta (primero), el cambio se rechaza y «N-45» se queda en su proveedor (esperando: $b)"
  else
    fallo "G2 · alta primero: esperando=$b vivas en el destino=$(vivas "$PD") en el origen=$(vivas "$PO") (esperado ≥1, 1 con «n 45», 1 con «N-45» y el cambio rechazado)"
  fi

  # ── Invariante global de la prueba: ningún proveedor propio quedó con un par equivalente ──────────────────
  local malos
  malos=$(q "SELECT count(*) FROM (SELECT proveedor_id FROM public.facturas_proveedor WHERE proveedor_id::text LIKE 'fb4c$n-%' GROUP BY proveedor_id) g
              WHERE (SELECT count(*) FROM public.facturas_proveedor a JOIN public.facturas_proveedor b ON b.proveedor_id = a.proveedor_id AND b.id > a.id
                      WHERE a.proveedor_id = g.proveedor_id AND a.estado <> 'anulada' AND b.estado <> 'anulada'
                        AND public.compras_numeros_equivalentes(a.numero_factura, b.numero_factura)) > 0")
  if [ "$malos" = "0" ]; then
    bien "invariante · tras todo lo anterior, ningún proveedor de la prueba tiene dos facturas vivas equivalentes"
  else
    fallo "invariante · $malos proveedor(es) de la prueba con facturas equivalentes vivas"
  fi
  [ "$ok_all" = 1 ]
}

# Ejecución suelta: prepara lo que el arnés (conc_harness.sh) ya trae.
if ! declare -F sesion_u >/dev/null 2>&1; then
  AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  : "${BD:?define BD=<base de datos>}" "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}"
  SALIDAS="${SALIDAS:-$(mktemp -d)}"; chmod 777 "$SALIDAS" 2>/dev/null || true
  for lib in "$AQUI/conc_lib.sh" "$AQUI/../hallazgos/conc_lib.sh" "${RAIZ_REPO:-/home/user/control-consumo-agua}/supabase/tests/compras_bloque_b/hallazgos/conc_lib.sh"; do [ -f "$lib" ] && . "$lib" && break; done
  declare -F sesion_u >/dev/null || { echo "❌ no se encontró conc_lib.sh"; exit 1; }
  C=${C:-cccccccc-cccc-cccc-cccc-cccccccccccc}; C1=${C1:-c1c1c1c1-0000-0000-0000-000000000001}; UA=${UA:-c0c0c0c0-0000-0000-0000-00000000000a}
  export C C1 UA BD SALIDAS
  _rg4_conc; rc=$?
  echo "salidas: $SALIDAS"
  exit $rc
fi
_rg4_conc
