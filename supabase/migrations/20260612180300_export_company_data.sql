-- ============================================================================
-- Export de datos por EMPRESA (superadmin) — respaldo previo a la purga.
-- ============================================================================
-- Complemento de export_my_data() (20260604270000, scope por usuario): el
-- superadmin descarga un JSON con los datos operativos de un tenant antes de
-- eliminarlo definitivamente (edge delete-company). Una sola RPC SECURITY
-- DEFINER acotada a super_admin; el cliente la descarga como archivo .json.
--
-- Filas completas con to_jsonb(t) (sin listas de columnas que mantener). Las
-- tablas voluminosas se acotan (lecturas 100k, pagos/cuotas 50k, las más
-- recientes primero) y `counts` reporta los totales reales para que un export
-- truncado sea evidente. Follow-up: export asíncrono a storage para tenants
-- que excedan los caps.
--
-- Seguridad: SECURITY DEFINER + search_path fijo; user-facing → REVOKE
-- PUBLIC/anon + GRANT authenticated con chequeo is_super_admin() interno.
-- Idempotente (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.export_company_data(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'export_version', 1,
    'generated_at', now(),
    'company_id', p_company_id,

    'empresa', (
      SELECT to_jsonb(c) FROM public.companies c WHERE c.id = p_company_id
    ),

    'usuarios', COALESCE((
      SELECT jsonb_agg(to_jsonb(au) ORDER BY au.created_at)
      FROM public.app_users au
      WHERE au.company_id = p_company_id
    ), '[]'::jsonb),

    'proyectos', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at)
      FROM public.projects p
      WHERE p.company_id = p_company_id
    ), '[]'::jsonb),

    'unidades', COALESCE((
      SELECT jsonb_agg(to_jsonb(u))
      FROM public.unidades u
      WHERE u.company_id = p_company_id
    ), '[]'::jsonb),

    'clientes', COALESCE((
      SELECT jsonb_agg(to_jsonb(cl))
      FROM public.clientes cl
      WHERE EXISTS (
        SELECT 1 FROM public.company_clientes cc
        WHERE cc.cliente_id = cl.id AND cc.company_id = p_company_id
      )
    ), '[]'::jsonb),

    'lecturas', COALESCE((
      SELECT jsonb_agg(r.row)
      FROM (
        SELECT to_jsonb(reg) AS row
        FROM public.registros reg
        JOIN public.projects pr ON pr.id = reg.project_id
        WHERE pr.company_id = p_company_id
        ORDER BY reg.fecha DESC
        LIMIT 100000
      ) r
    ), '[]'::jsonb),

    'pagos', COALESCE((
      SELECT jsonb_agg(pg.row)
      FROM (
        SELECT to_jsonb(pa) AS row
        FROM public.pagos pa
        JOIN public.projects pr ON pr.id = pa.project_id
        WHERE pr.company_id = p_company_id
        ORDER BY pa.created_at DESC
        LIMIT 50000
      ) pg
    ), '[]'::jsonb),

    'cuotas_condominio', COALESCE((
      SELECT jsonb_agg(cu.row)
      FROM (
        SELECT to_jsonb(cc) AS row
        FROM public.cuotas_condominio cc
        WHERE cc.company_id = p_company_id
        ORDER BY cc.created_at DESC
        LIMIT 50000
      ) cu
    ), '[]'::jsonb),

    'suscripciones', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.created_at)
      FROM public.subscriptions s
      WHERE s.company_id = p_company_id
    ), '[]'::jsonb),

    'facturas_saas', COALESCE((
      SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at)
      FROM public.invoices i
      WHERE i.company_id = p_company_id
    ), '[]'::jsonb),

    'counts', jsonb_build_object(
      'usuarios',  (SELECT count(*) FROM public.app_users au WHERE au.company_id = p_company_id),
      'proyectos', (SELECT count(*) FROM public.projects p WHERE p.company_id = p_company_id),
      'unidades',  (SELECT count(*) FROM public.unidades u WHERE u.company_id = p_company_id),
      'lecturas',  (SELECT count(*) FROM public.registros reg
                     JOIN public.projects pr ON pr.id = reg.project_id
                     WHERE pr.company_id = p_company_id),
      'pagos',     (SELECT count(*) FROM public.pagos pa
                     JOIN public.projects pr ON pr.id = pa.project_id
                     WHERE pr.company_id = p_company_id),
      'cuotas_condominio', (SELECT count(*) FROM public.cuotas_condominio cc WHERE cc.company_id = p_company_id)
    ),
    'caps', jsonb_build_object('lecturas', 100000, 'pagos', 50000, 'cuotas_condominio', 50000)
  )
  INTO v_result;

  RETURN v_result;
END
$$;

COMMENT ON FUNCTION public.export_company_data(uuid) IS
  'Export JSON de los datos operativos de una empresa (superadmin) — respaldo previo a la purga vía delete-company. Tablas voluminosas acotadas; counts reporta totales reales.';

REVOKE EXECUTE ON FUNCTION public.export_company_data(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.export_company_data(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.export_company_data(uuid) TO authenticated;
