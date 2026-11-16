-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261126000000_rentas_tercer_modulo_del_plan, como cada persona.
--   A · planes: los 4 con Rentas, escalera 10/15/20, feature_codes heredados
--   B · módulos → plan: las 8 combinaciones
--   C · alta de empresa: el trial nace en el plan de sus módulos
--   D · interruptores: la plataforma mueve el plan; con Stripe se rechaza; sin módulos no se toca
--   E · candado: la empresa no se enciende módulos; la plataforma y el servicio sí
--   F · cobro: las propiedades independientes son unidades adicionales (sólo con Rentas)
--   G · tope de unidades al registrar una propiedad independiente
--   H · panel de plataforma: vistas, listado, filtro y permisos
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\i ../housekeeping_evidencias/lib.sql

CREATE OR REPLACE FUNCTION hkt.plan_de(p_company uuid) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT bp.code FROM public.subscriptions s JOIN public.billing_plans bp ON bp.id = s.plan_id
   WHERE s.company_id = p_company AND s.status IN ('trialing', 'active', 'past_due', 'incomplete') $$;
CREATE OR REPLACE FUNCTION hkt.emp(p_company uuid) RETURNS public.companies LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT * FROM public.companies WHERE id = p_company $$;
CREATE OR REPLACE FUNCTION hkt.mv(p_company uuid) RETURNS public.mv_superadmin_empresa_counts LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT * FROM public.mv_superadmin_empresa_counts WHERE company_id = p_company $$;
CREATE OR REPLACE FUNCTION hkt.pr(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('f0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION hkt.cx(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('ac000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION hkt.unidades_de(p_company uuid) RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT id FROM public.unidades WHERE company_id = p_company $$;
CREATE OR REPLACE FUNCTION hkt.mrr() RETURNS TABLE (mrr_cents bigint) LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT m.mrr_cents FROM public.mv_superadmin_plataforma m $$;
CREATE OR REPLACE FUNCTION hkt.activas() RETURNS SETOF public.mv_superadmin_empresa_counts LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT * FROM public.mv_superadmin_empresa_counts WHERE subscription_status = 'active' $$;
-- Suscripciones de una empresa: cuántas hay, cuántas vivas y el estado de la viva (subscriptions tiene RLS).
CREATE OR REPLACE FUNCTION hkt.subs(p_company uuid) RETURNS TABLE (total int, vivas int, estado text) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*)::int, count(*) FILTER (WHERE status IN ('trialing', 'active', 'past_due', 'incomplete'))::int,
         max(status) FILTER (WHERE status IN ('trialing', 'active', 'past_due', 'incomplete'))
    FROM public.subscriptions WHERE company_id = p_company $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;

-- ── A · planes ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.ok('A1 siete planes; los cuatro nuevos incluyen Rentas y los tres de antes no',
    (SELECT count(*) = 7 AND count(*) FILTER (WHERE includes_rentas) = 4
        AND bool_and(includes_rentas = (code IN ('rentas_only', 'agua_rentas', 'condominios_rentas', 'suite')))
       FROM public.billing_plans));
  PERFORM hkt.ok('A2 escalera de activación: 1 módulo $10, 2 módulos $15, 3 módulos $20',
    (SELECT bool_and(base_activation_cents = 500 + 500 * (includes_agua::int + includes_condominios::int + includes_rentas::int)
                 AND price_monthly_cents = base_activation_cents) FROM public.billing_plans));
  PERFORM hkt.ok('A3 precios por uso y topes iguales a los de bundle',
    (SELECT count(DISTINCT (extra_project_cents, unit_primary_cents, unit_extra_cents, max_projects, max_units, currency)) = 1
       FROM public.billing_plans));
  PERFORM hkt.ok('A4 feature_codes heredados: un plan con Condominios conserva asambleas_digitales',
    (SELECT bool_and((feature_codes ? 'asambleas_digitales') = includes_condominios) FROM public.billing_plans)
    AND (SELECT feature_codes FROM public.billing_plans WHERE code = 'suite')
      = (SELECT feature_codes FROM public.billing_plans WHERE code = 'bundle')
    AND (SELECT feature_codes FROM public.billing_plans WHERE code = 'agua_rentas')
      = (SELECT feature_codes FROM public.billing_plans WHERE code = 'agua_only'));
  PERFORM hkt.ok('A5 nacen sin precios de Stripe y los planes de antes no cambian de precio',
    (SELECT bool_and(stripe_price_id_activation IS NULL) FROM public.billing_plans WHERE includes_rentas)
    AND (SELECT array_agg(base_activation_cents ORDER BY sort_order) = ARRAY[1000, 1000, 1500]
           FROM public.billing_plans WHERE NOT includes_rentas));
END $$;

-- ── B · módulos → plan ──────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.ok('B1 las ocho combinaciones',
    public.plan_code_por_modulos(true,  false, false) = 'agua_only'
    AND public.plan_code_por_modulos(false, true,  false) = 'condominios_only'
    AND public.plan_code_por_modulos(false, false, true)  = 'rentas_only'
    AND public.plan_code_por_modulos(true,  true,  false) = 'bundle'
    AND public.plan_code_por_modulos(true,  false, true)  = 'agua_rentas'
    AND public.plan_code_por_modulos(false, true,  true)  = 'condominios_rentas'
    AND public.plan_code_por_modulos(true,  true,  true)  = 'suite'
    AND public.plan_code_por_modulos(false, false, false) IS NULL
    AND public.plan_code_por_modulos(NULL, NULL, NULL) IS NULL);
  PERFORM hkt.ok('B2 cada combinación apunta a un plan que existe y que incluye exactamente esos módulos',
    (SELECT count(*) = 7 AND bool_and(bp.includes_agua = k.a AND bp.includes_condominios = k.c AND bp.includes_rentas = k.r)
       FROM (SELECT a, c, r FROM (VALUES (true), (false)) x(a), (VALUES (true), (false)) y(c), (VALUES (true), (false)) z(r)) k
       JOIN public.billing_plans bp ON bp.code = public.plan_code_por_modulos(k.a, k.c, k.r)));
END $$;

-- ── C · alta de empresa ─────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.como_servicio();
  INSERT INTO public.companies (id, nombre, servicio_agua, servicio_condominios, servicio_rentas) VALUES
    (hkt.cx(1), 'Solo Rentas',   false, false, true),
    (hkt.cx(2), 'Los tres',      true,  true,  true),
    (hkt.cx(3), 'Condos+Rentas', false, true,  true),
    (hkt.cx(5), 'Sin módulos',   false, false, false);
  INSERT INTO public.companies (id, nombre) VALUES (hkt.cx(4), 'Por defecto');
  PERFORM hkt.ok('C1 el trial nace en el plan de los módulos elegidos',
    hkt.plan_de(hkt.cx(1)) = 'rentas_only' AND hkt.plan_de(hkt.cx(2)) = 'suite' AND hkt.plan_de(hkt.cx(3)) = 'condominios_rentas');
  PERFORM hkt.ok('C2 una empresa creada sin indicar módulos (Agua + Condominios por defecto) sigue naciendo en bundle; sin ninguno, también',
    hkt.plan_de(hkt.cx(4)) = 'bundle' AND hkt.plan_de(hkt.cx(5)) = 'bundle'
    AND NOT (hkt.emp(hkt.cx(4))).servicio_rentas);
  PERFORM hkt.ok('C3 cada una con una sola suscripción, en trialing',
    (SELECT bool_and((SELECT total = 1 AND estado = 'trialing' FROM hkt.subs(hkt.cx(n)))) FROM generate_series(1, 5) n));
  PERFORM hkt.root();
END $$;

-- ── D · interruptores de la plataforma ──────────────────────────────────────
DO $$
DECLARE msg text;
BEGIN
  PERFORM hkt.como(hkt.uid(14));
  PERFORM hkt.ok('D0 partida: A es de solo Agua', hkt.plan_de(hkt.ca()) = 'agua_only');
  UPDATE public.companies SET servicio_rentas = true WHERE id = hkt.ca();
  PERFORM hkt.ok('D1 encender Rentas → agua_rentas', hkt.plan_de(hkt.ca()) = 'agua_rentas');
  UPDATE public.companies SET servicio_condominios = true WHERE id = hkt.ca();
  PERFORM hkt.ok('D2 encender Condominios → suite', hkt.plan_de(hkt.ca()) = 'suite');
  UPDATE public.companies SET servicio_rentas = false WHERE id = hkt.ca();
  PERFORM hkt.ok('D3 apagar Rentas → bundle', hkt.plan_de(hkt.ca()) = 'bundle');
  UPDATE public.companies SET servicio_agua = false, servicio_rentas = true WHERE id = hkt.ca();
  PERFORM hkt.ok('D4 dos interruptores a la vez → condominios_rentas', hkt.plan_de(hkt.ca()) = 'condominios_rentas');
  PERFORM hkt.ok('D5 el estado de la suscripción no cambia y sigue habiendo una sola viva',
    (SELECT total = 1 AND vivas = 1 AND estado = 'active' FROM hkt.subs(hkt.ca())));
  UPDATE public.companies SET servicio_condominios = false, servicio_rentas = false WHERE id = hkt.ca();
  PERFORM hkt.ok('D6 apagar todos los módulos no deja a la empresa sin plan: se queda en el último',
    hkt.plan_de(hkt.ca()) = 'condominios_rentas');
  UPDATE public.companies SET nombre = 'Empresa A' WHERE id = hkt.ca();
  PERFORM hkt.ok('D7 editar otra columna no toca el plan', hkt.plan_de(hkt.ca()) = 'condominios_rentas');
  UPDATE public.companies SET servicio_agua = true WHERE id = hkt.ca();
  PERFORM hkt.ok('D8 volver a solo Agua → agua_only', hkt.plan_de(hkt.ca()) = 'agua_only');

  -- B ya se factura por Stripe (bundle).
  PERFORM hkt.root();
  UPDATE public.subscriptions SET stripe_subscription_id = 'sub_test_b' WHERE company_id = hkt.cb();
  PERFORM hkt.como(hkt.uid(14));
  msg := hkt.mensaje_de(format('UPDATE public.companies SET servicio_rentas = true WHERE id = %L', hkt.cb()));
  PERFORM hkt.ok('D9 empresa facturada por Stripe: el interruptor se rechaza (MODULOS_PLAN_STRIPE) y nada cambia',
    msg LIKE 'MODULOS_PLAN_STRIPE%' AND hkt.plan_de(hkt.cb()) = 'bundle' AND NOT (hkt.emp(hkt.cb())).servicio_rentas);
  PERFORM hkt.ok('D10 … pero un cambio que no mueve el plan sí pasa',
    hkt.afectadas(format('UPDATE public.companies SET servicio_agua = true, servicio_condominios = true WHERE id = %L', hkt.cb())) = 1);
  PERFORM hkt.root();
  UPDATE public.subscriptions SET stripe_subscription_id = NULL WHERE company_id = hkt.cb();

  -- Empresa sin suscripción viva: el interruptor funciona y no inventa una.
  UPDATE public.subscriptions SET status = 'canceled' WHERE company_id = hkt.cx(4);
  PERFORM hkt.como(hkt.uid(14));
  UPDATE public.companies SET servicio_rentas = true WHERE id = hkt.cx(4);
  PERFORM hkt.ok('D11 sin suscripción viva: el módulo se enciende y no se crea ni se reabre ninguna',
    (hkt.emp(hkt.cx(4))).servicio_rentas AND hkt.plan_de(hkt.cx(4)) IS NULL
    AND (SELECT total = 1 AND vivas = 0 FROM hkt.subs(hkt.cx(4))));
  PERFORM hkt.root();
END $$;

-- ── E · candado de los módulos ──────────────────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.como(hkt.uid(1));
  UPDATE public.companies SET servicio_rentas = true, servicio_condominios = true, servicio_agua = false, nombre = 'Empresa A1'
   WHERE id = hkt.ca();
  PERFORM hkt.ok('E1 la dueña no se enciende ni se apaga módulos por la API (el resto de su fila sí lo edita)',
    (hkt.emp(hkt.ca())).servicio_agua AND NOT (hkt.emp(hkt.ca())).servicio_condominios AND NOT (hkt.emp(hkt.ca())).servicio_rentas
    AND (hkt.emp(hkt.ca())).nombre = 'Empresa A1' AND hkt.plan_de(hkt.ca()) = 'agua_only');
  PERFORM hkt.como(hkt.uid(12));
  UPDATE public.companies SET servicio_rentas = true WHERE id = hkt.ca();
  PERFORM hkt.ok('E2 un admin de la empresa tampoco', NOT (hkt.emp(hkt.ca())).servicio_rentas AND hkt.plan_de(hkt.ca()) = 'agua_only');
  PERFORM hkt.ok('E3 … y sigue sin ver Rentas', NOT public.rentas_servicio_activo());
  PERFORM hkt.como_servicio();
  UPDATE public.companies SET servicio_rentas = true WHERE id = hkt.cx(5);
  PERFORM hkt.ok('E4 el servicio (alta por signup) sí escribe módulos', (hkt.emp(hkt.cx(5))).servicio_rentas AND hkt.plan_de(hkt.cx(5)) = 'rentas_only');
  PERFORM hkt.root();
END $$;

-- ── F · cobro: propiedades independientes = unidades adicionales ────────────
-- A: proyectos PA1 (principal) y PA2; unidades 5 en PA1 y 1 en PA2. Plan agua_rentas ($15).
DO $$
DECLARE t record; u record;
BEGIN
  PERFORM hkt.como(hkt.uid(14));
  UPDATE public.companies SET servicio_rentas = true WHERE id = hkt.ca();
  PERFORM hkt.como(hkt.uid(1));
  SELECT * INTO t FROM public.calculate_monthly_total_cents(hkt.ca());
  PERFORM hkt.ok('F1 sin propiedades: 1500 + 1 proyecto extra (1000) + 5 principales (500) + 1 adicional (80) = 3080',
    t.base_activation_cents = 1500 AND t.extra_projects_count = 1 AND t.primary_units_count = 5
    AND t.extra_units_count = 1 AND t.total_cents = 3080 AND t.primary_project_id = hkt.pa1());

  INSERT INTO public.rentas_propiedades (id, company_id, nombre, tipo_renta) VALUES
    (hkt.pr(21), hkt.ca(), 'Casa Lago', 'corto_plazo'), (hkt.pr(22), hkt.ca(), 'Local Centro', 'local_comercial');
  INSERT INTO public.rentas_propiedades (id, company_id, project_id, unidad_id, nombre) VALUES
    (hkt.pr(23), hkt.ca(), hkt.pa1(), hkt.un(1), 'Apto 1A');
  SELECT * INTO t FROM public.calculate_monthly_total_cents(hkt.ca());
  PERFORM hkt.ok('F2 dos independientes suman 2 unidades adicionales (160); la enlazada a una unidad no se cobra dos veces',
    t.extra_units_count = 3 AND t.extra_units_subtotal = 240 AND t.primary_units_count = 5 AND t.total_cents = 3240);
  SELECT * INTO u FROM public.get_company_usage(hkt.ca());
  PERFORM hkt.ok('F3 el uso cuenta 6 unidades + 2 independientes', u.projects_count = 2 AND u.units_count = 8);

  PERFORM hkt.como(hkt.uid(14));
  UPDATE public.companies SET servicio_rentas = false WHERE id = hkt.ca();
  SELECT * INTO t FROM public.calculate_monthly_total_cents(hkt.ca());
  SELECT * INTO u FROM public.get_company_usage(hkt.ca());
  PERFORM hkt.ok('F4 con Rentas apagado no se cobran ni cuentan (la empresa no las ve): vuelve a agua_only, 2580',
    t.base_activation_cents = 1000 AND t.extra_units_count = 1 AND t.total_cents = 2580 AND u.units_count = 6);
  UPDATE public.companies SET servicio_rentas = true WHERE id = hkt.ca();

  PERFORM hkt.como(hkt.uid(7));
  PERFORM hkt.ok('F5 otra empresa no consulta el total ni el uso de A → 42501',
    hkt.estado_de(format('SELECT * FROM public.calculate_monthly_total_cents(%L)', hkt.ca())) = '42501'
    AND hkt.estado_de(format('SELECT * FROM public.get_company_usage(%L)', hkt.ca())) = '42501');
  PERFORM hkt.como('c0000000-0000-0000-0000-00000000ffff'::uuid);
  PERFORM hkt.ok('F6 sesión sin perfil → 42501',
    hkt.estado_de(format('SELECT * FROM public.calculate_monthly_total_cents(%L)', hkt.ca())) = '42501');
  PERFORM hkt.como(hkt.uid(1));
  PERFORM hkt.ok('F7 el conteo interno no se llama por la API',
    hkt.estado_de(format('SELECT public.rentas_propiedades_independientes(%L)', hkt.ca())) = '42501');
  PERFORM hkt.root();
END $$;

-- ── G · tope de unidades ────────────────────────────────────────────────────
DO $$
DECLARE msg text;
        q constant text := 'INSERT INTO public.rentas_propiedades (company_id, nombre) VALUES (%L, %L)';
BEGIN
  -- A usa 6 unidades + 2 independientes = 8.
  PERFORM hkt.root();
  UPDATE public.companies SET max_units = 9 WHERE id = hkt.ca();
  PERFORM hkt.como(hkt.uid(1));
  EXECUTE format(q, hkt.ca(), 'Bodega 1');
  PERFORM hkt.ok('G1 con 8 de 9 en uso, la novena entra', (SELECT units_count = 9 FROM public.get_company_usage(hkt.ca())));
  msg := hkt.mensaje_de(format(q, hkt.ca(), 'Bodega 2'));
  PERFORM hkt.ok('G2 con el tope alcanzado, otra independiente → plan_limit_reached (23514)',
    msg LIKE 'plan_limit_reached: max_units = 9%' AND hkt.estado_de(format(q, hkt.ca(), 'Bodega 2')) = '23514');
  INSERT INTO public.rentas_propiedades (company_id, project_id, unidad_id, nombre) VALUES (hkt.ca(), hkt.pa1(), hkt.un(2), 'Apto 2B');
  PERFORM hkt.ok('G3 enlazar una unidad que ya existe no consume tope', (SELECT units_count = 9 FROM public.get_company_usage(hkt.ca())));
  PERFORM hkt.root();
  DELETE FROM public.unidades WHERE id = hkt.un(2);
  PERFORM hkt.ok('G4 borrar una unidad enlazada con el tope alcanzado no se bloquea: la propiedad queda independiente',
    (SELECT unidad_id IS NULL FROM public.rentas_propiedades WHERE nombre = 'Apto 2B'));
  UPDATE public.companies SET max_units = NULL WHERE id = hkt.ca();
  PERFORM hkt.como(hkt.uid(1));
  EXECUTE format(q, hkt.ca(), 'Bodega 3');
  PERFORM hkt.ok('G5 sin límite (NULL) no se topa', true);
  PERFORM hkt.root();
  UPDATE public.companies SET max_units = 50 WHERE id = hkt.ca();
END $$;

-- ── H · panel de plataforma ─────────────────────────────────────────────────
DO $$
DECLARE t record; m public.mv_superadmin_empresa_counts; f record;
BEGIN
  PERFORM hkt.root();
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_superadmin_empresa_counts;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_superadmin_plataforma;
  PERFORM hkt.ok('H1 las dos vistas refrescan en caliente (conservan su índice único)', true);
  PERFORM hkt.como(hkt.uid(1));
  SELECT * INTO t FROM public.calculate_monthly_total_cents(hkt.ca());
  m := hkt.mv(hkt.ca());
  PERFORM hkt.ok('H2 el total del listado coincide con el del detalle y con el uso',
    m.monthly_total_cents = t.total_cents AND m.plan_code = 'agua_rentas'
    AND m.unit_count = (SELECT units_count FROM public.get_company_usage(hkt.ca())));
  PERFORM hkt.ok('H3 el MRR de plataforma suma ese total',
    (SELECT mrr_cents FROM hkt.mrr()) = (SELECT sum(monthly_total_cents) FROM hkt.activas()));
  -- Con Rentas apagado el listado tampoco las cuenta (la vista sigue el mismo criterio que el detalle).
  PERFORM hkt.root();
  UPDATE public.companies SET servicio_rentas = false WHERE id = hkt.ca();
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_superadmin_empresa_counts;
  PERFORM hkt.como(hkt.uid(1));
  PERFORM hkt.ok('H3b con Rentas apagado, listado y detalle vuelven a coincidir sin las propiedades',
    (hkt.mv(hkt.ca())).monthly_total_cents = (SELECT total_cents FROM public.calculate_monthly_total_cents(hkt.ca()))
    AND (hkt.mv(hkt.ca())).unit_count = (SELECT count(*) FROM hkt.unidades_de(hkt.ca())));
  PERFORM hkt.root();
  UPDATE public.companies SET servicio_rentas = true WHERE id = hkt.ca();
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_superadmin_empresa_counts;
  PERFORM hkt.como(hkt.uid(14));
  SELECT * INTO f FROM public.get_superadmin_empresas(p_search => 'Empresa A1');
  PERFORM hkt.ok('H4 el listado devuelve servicio_rentas, plan y total',
    f.servicio_rentas AND f.servicio_agua AND NOT f.servicio_condominios AND f.plan_code = 'agua_rentas'
    AND f.monthly_total_cents = t.total_cents AND f.total_count = 1);
  PERFORM hkt.ok('H5 filtro «rentas»: sólo empresas con el módulo; los filtros de antes siguen',
    (SELECT count(*) > 0 AND bool_and(servicio_rentas) FROM public.get_superadmin_empresas(p_module => 'rentas'))
    AND (SELECT bool_and(servicio_agua AND servicio_condominios) FROM public.get_superadmin_empresas(p_module => 'ambos'))
    AND (SELECT bool_and(servicio_agua AND NOT servicio_condominios) FROM public.get_superadmin_empresas(p_module => 'agua')));
  PERFORM hkt.como(hkt.uid(1));
  PERFORM hkt.ok('H6 una empresa no llama al listado ni lee las vistas',
    hkt.estado_de('SELECT * FROM public.get_superadmin_empresas()') = '42501'
    AND hkt.estado_de('SELECT 1 FROM public.mv_superadmin_empresa_counts') = '42501'
    AND hkt.estado_de('SELECT 1 FROM public.mv_superadmin_plataforma') = '42501');
  PERFORM hkt.como_anon();
  PERFORM hkt.ok('H7 anon no ejecuta nada de esto',
    hkt.estado_de('SELECT * FROM public.get_superadmin_empresas()') = '42501'
    AND hkt.estado_de(format('SELECT * FROM public.calculate_monthly_total_cents(%L)', hkt.ca())) = '42501'
    AND hkt.estado_de('SELECT public.plan_code_por_modulos(true, true, true)') = '42501');
  PERFORM hkt.root();
END $$;
