-- Datos de prueba de los cobros de cuotas por tipo, sobre el padrón de
-- conta_auxiliares_tipo_cargo y el fixture de conta_contabilizacion_cargos
-- (run.sh aplica ambos antes que éste). Todo lleva prefijo SINT-AUX.
--
--   Ledger A1: además de la CxC de residentes (a101), una CxC PROPIA de la
--   mora (a111) para probar principal y mora con cuentas distintas.

INSERT INTO public.conta_cuentas
  (id, company_id, project_id, codigo, nombre, tipo, naturaleza, nivel, es_detalle, activa) VALUES
  ('11000000-0000-0000-0000-00000000a111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'CXC-MORA', 'CxC mora', 'activo', 'deudora', 3, true, true);

-- ── Ayudas de lectura (se consultan con RESET ROLE) ─────────────────────────
-- Saldo (debe − haber) de UNA cuota en una cuenta: su devengo, su mora y sus
-- cobros, sobre asientos publicados (los reversos incluidos).
CREATE OR REPLACE FUNCTION public.saldo_cuota(p_cuota uuid, p_cuenta uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(l.debe - l.haber), 0)::bigint FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
   WHERE a.estado = 'publicado' AND l.cuenta_id = p_cuenta
     AND ((a.origen_tabla = 'cuotas_condominio' AND a.origen_id = p_cuota)
          OR (a.origen_tabla = 'pagos' AND a.origen_id IN
                (SELECT p.id FROM public.pagos p WHERE p.cuota_id = p_cuota)))
$$;
-- Cuánto de un cobro se aplicó a un evento (sólo asientos vivos).
CREATE OR REPLACE FUNCTION public.aplicado(p_pago uuid, p_evento text) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(ap.monto), 0)::bigint FROM public.conta_cobro_aplicaciones ap
    JOIN public.conta_asientos a ON a.id = ap.asiento_id
   WHERE ap.pago_id = p_pago AND ap.evento = p_evento
     AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
$$;
-- Líneas de abono del asiento vivo de un cobro, como texto «cuenta:tipo:monto».
CREATE OR REPLACE FUNCTION public.abonos_cobro(p_pago uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT string_agg(c.codigo || ':' || COALESCE(l.tipo_cargo, '-') || ':' || l.haber::bigint, ',' ORDER BY l.orden)
    FROM public.conta_asientos a
    JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id AND l.haber > 0
    JOIN public.conta_cuentas c ON c.id = l.cuenta_id
   WHERE a.origen = 'automatico' AND a.origen_tabla = 'pagos' AND a.origen_id = p_pago
     AND a.origen_evento = 'pago_contabilizado' AND a.anulado_por_id IS NULL AND a.estado = 'publicado'
$$;
