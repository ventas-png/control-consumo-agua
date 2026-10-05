-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS / CONTABILIDAD · PRIVILEGIOS MÍNIMOS EN LAS TABLAS DEL CIRCUITO
-- (cierre técnico del circuito de compras y contabilidad · 3/3)
--
-- QUÉ FALLABA
-- Las tablas del circuito compras → contabilidad se crearon con los privilegios
-- por defecto de Supabase: `anon` y `authenticated` con TODOS (SELECT, INSERT,
-- UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER). RLS impedía que `anon` leyera
-- (no hay ninguna política para ese rol), pero el privilegio estaba ahí: una sola
-- política mal escrita que dijera `TO public` —el error que ya ocurrió con
-- `payment_requests`— habría abierto el libro a visitantes sin sesión. Defensa en
-- profundidad: el privilegio que no se necesita no se concede.
--
-- QUÉ CAMBIA
--   · `anon`: sin ningún privilegio sobre estas tablas (ningún consumidor legítimo
--     las usa sin sesión: se verificó en el código y en las políticas, que son
--     todas `TO authenticated`).
--   · `authenticated`: se le retiran TRUNCATE, TRIGGER y REFERENCES. Conserva
--     SELECT, INSERT, UPDATE y DELETE, que RLS sigue gobernando fila por fila.
--     (TRUNCATE no pasa por RLS: era el único privilegio con el que un usuario con
--     la API de tablas expuesta —no es el caso hoy— podría vaciar el libro.)
--
-- NO CAMBIA: la llave de servicio (`service_role`), el propietario de las tablas y
-- las funciones SECURITY DEFINER; ni las políticas.
--
-- CÓMO REVERTIR:
--     GRANT ALL ON TABLE public.<t> TO anon;
--     GRANT TRUNCATE, TRIGGER, REFERENCES ON TABLE public.<t> TO authenticated;
-- IMPACTO EN DATOS: ninguno.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
  tablas constant text[] := ARRAY[
    -- financieras (lectura por permiso, migración 20261026000000)
    'facturas_proveedor', 'factura_proveedor_lineas', 'contrasenas_pago', 'contrasena_pago_facturas',
    'ordenes_pago', 'conta_asientos', 'conta_asiento_lineas', 'conta_cierres_anuales',
    'conta_cuentas', 'conta_mapeo_cuentas', 'conta_tipos_cambio', 'conta_duplicados_descartados',
    'conta_folios',
    -- órdenes y recepciones (lectura por proyecto, migración 20261026000100)
    'ordenes_compra', 'orden_compra_lineas', 'recepciones', 'recepcion_lineas'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.%I FROM authenticated', t);
  END LOOP;
END $$;
