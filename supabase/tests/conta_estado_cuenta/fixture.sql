-- Datos del estado de cuenta, sobre el padrón de conta_auxiliares_tipo_cargo,
-- el fixture de conta_contabilizacion_cargos y el de conta_cobros_cuotas (la
-- CxC propia de la mora, a111). run.sh los aplica antes que éste. Todo lleva
-- prefijo SINT-AUX.
--
--   U1 (Apto 101): pagador Uno. Dos es arrendatario, todavía sin designar:
--                  el cambio de pagador se hace a mitad de la prueba.
--   U2 (Apto 102): pagador Uno.
--   Local 1 (A2):  pagador Uno, en OTRA contabilidad (proyecto A2).

INSERT INTO public.unidad_residentes
  (id, unidad_id, cliente_id, company_id, project_id, tipo, activo, responsable_pago) VALUES
  ('ec0e0000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'e0000000-0000-0000-0000-00000000a002',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'arrendatario', true, false),
  ('ec0e0000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000a201', 'e0000000-0000-0000-0000-00000000a001',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2a2a2a2-0000-0000-0000-000000000001', 'propietario', true, true);

-- ── Ayudas de lectura ────────────────────────────────────────────────────────
-- Las llamadas al estado de cuenta corren con el rol y el usuario de la sesión
-- (SET ROLE authenticated): estas ayudas sólo recortan el JSON.
CREATE OR REPLACE FUNCTION public.ec(
  p_project uuid, p_cliente uuid, p_unidad uuid,
  p_desde date DEFAULT NULL, p_hasta date DEFAULT NULL,
  p_limite integer DEFAULT 500, p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.conta_estado_cuenta(p_project, p_cliente, p_unidad, p_desde, p_hasta, p_limite, p_offset)
$$;
-- «saldo_inicial|cargos|abonos|saldo_final|movimientos»
CREATE OR REPLACE FUNCTION public.ec_resumen(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|', j->'resumen'->>'saldo_inicial', j->'resumen'->>'cargos', j->'resumen'->>'abonos',
                   j->'resumen'->>'saldo_final', j->'resumen'->>'movimientos')
$$;
-- Movimientos como «componente:cargo:abono» en orden, para comparar a la vista.
CREATE OR REPLACE FUNCTION public.ec_movs(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(COALESCE(m->>'componente', '-') || ':' || (m->>'cargo') || ':' || (m->>'abono'), ','
                    ORDER BY (m->>'n')::int)
    FROM jsonb_array_elements(j->'movimientos') m
$$;
-- Documentos fuera del saldo como «clase:origen:monto», ordenados.
CREATE OR REPLACE FUNCTION public.ec_fuera(p_project uuid, p_cliente uuid, p_unidad uuid, p_hasta date DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(clase || ':' || origen_tabla || ':' || monto, ',' ORDER BY clase, origen_tabla, monto), '')
    FROM public.conta_estado_cuenta_pendientes(p_project, p_cliente, p_unidad, p_hasta, 500, 0)
$$;
GRANT EXECUTE ON FUNCTION public.ec(uuid, uuid, uuid, date, date, integer, integer),
  public.ec_resumen(jsonb), public.ec_movs(jsonb),
  public.ec_fuera(uuid, uuid, uuid, date) TO authenticated;
