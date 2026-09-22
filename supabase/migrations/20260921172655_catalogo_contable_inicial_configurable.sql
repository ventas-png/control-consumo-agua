-- ============================================================================
-- CATALOGO CONTABLE INICIAL CONFIGURABLE
--
-- Las contabilidades nuevas ya no reciben a la fuerza el catalogo LATAM
-- completo. Nacen vacias y un owner/admin decide desde la UI si quiere:
--   * una plantilla BASICA, corta y operativa;
--   * la plantilla LATAM heredada; o
--   * empezar en limpio, creando/importando sus propias cuentas.
--
-- Las cuentas de una plantilla son editables y borrables (cuando ninguna FK
-- las use): una plantilla es un punto de partida, no una taxonomia del sistema.
-- Los catalogos existentes no se modifican ni se vuelven a sembrar.
-- ============================================================================

-- Los triggers se conservan por compatibilidad con la cadena historica, pero
-- dejan de decidir por el usuario. Empresa/proyecto nuevos nacen sin catalogo.
CREATE OR REPLACE FUNCTION public.conta_seed_on_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.conta_seed_on_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN NEW;
END;
$$;

-- Compras agregó triggers independientes para completar el catálogo con
-- inventario, activo fijo y GR/IR. También deben dejar de sembrar por su
-- cuenta; de lo contrario una empresa nueva no nacería realmente vacía.
CREATE OR REPLACE FUNCTION public.compras_seed_on_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.compras_seed_on_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_seed_on_company() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.conta_seed_on_project() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compras_seed_on_company() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compras_seed_on_project() FROM PUBLIC, anon, authenticated;

-- Inicializa UN ledger vacio. La empresa no se recibe del cliente: se toma de
-- get_my_company_id(), y el proyecto (si existe) debe pertenecer a esa empresa.
-- El lock de la entidad serializa dos clics simultaneos y evita semillas dobles.
CREATE OR REPLACE FUNCTION public.conta_inicializar_catalogo(
  p_plantilla text,
  p_project_id uuid
)
RETURNS TABLE (cuentas_creadas integer, mapeos_creados integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
  v_antes_cuentas integer;
  v_antes_mapeos integer;
  m record;
  v_cuenta uuid;
BEGIN
  v_company := public.get_my_company_id();

  IF v_company IS NULL OR NOT (
    public.is_super_admin()
    OR public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])
  ) THEN
    RAISE EXCEPTION 'No autorizado para inicializar el catalogo contable.'
      USING ERRCODE = '42501';
  END IF;

  p_plantilla := lower(trim(COALESCE(p_plantilla, '')));
  IF p_plantilla NOT IN ('basico', 'latam') THEN
    RAISE EXCEPTION 'Plantilla invalida: %. Use basico o latam.', p_plantilla
      USING ERRCODE = '22023';
  END IF;

  IF p_project_id IS NULL THEN
    PERFORM 1
      FROM public.companies
     WHERE id = v_company
     FOR UPDATE;
  ELSE
    PERFORM 1
      FROM public.projects
     WHERE id = p_project_id
       AND company_id = v_company
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'El proyecto no pertenece a la empresa activa.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.conta_cuentas
     WHERE company_id = v_company
       AND project_id IS NOT DISTINCT FROM p_project_id
  ) THEN
    RAISE EXCEPTION 'CATALOGO_NO_VACIO: esta contabilidad ya tiene cuentas; la plantilla solo se aplica al iniciar.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*)::integer
    INTO v_antes_mapeos
    FROM public.conta_mapeo_cuentas
   WHERE company_id = v_company
     AND project_id IS NOT DISTINCT FROM p_project_id;
  v_antes_cuentas := 0;

  IF p_plantilla = 'latam' THEN
    -- Reutiliza el catalogo heredado ya probado. En ledgers nuevos la unica
    -- cuenta con separador pasa a codigo numerico; sus mapeos apuntan por UUID
    -- y permanecen validos.
    PERFORM public.conta_seed_catalogo(v_company, p_project_id);
    PERFORM public.compras_seed_cuentas(v_company, p_project_id);

    UPDATE public.conta_cuentas
       SET codigo = '110201',
           updated_at = now()
     WHERE company_id = v_company
       AND project_id IS NOT DISTINCT FROM p_project_id
       AND codigo = '1102-01';
  ELSE
    -- Plantilla basica: 22 cuentas. Los eventos del sistema comparten cuentas
    -- genericas al inicio; el usuario puede dividirlas y remapearlas despues.
    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '1',    'Activo',                         'activo',  'deudora',   NULL,   1, false);
    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '11',   'Efectivo y equivalentes',         'activo',  'deudora',   '1',    2, false);
    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '1101', 'Caja y bancos',                   'activo',  'deudora',   '11',   3, true);
    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '12',   'Cuentas por cobrar',              'activo',  'deudora',   '1',    2, false);
    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '1201', 'Clientes y otras cuentas por cobrar','activo','deudora', '12',   3, true);
    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '13',   'Impuestos a favor',               'activo',  'deudora',   '1',    2, false);
    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '1301', 'IVA crédito fiscal',              'activo',  'deudora',   '13',   3, true);

    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '2',    'Pasivo',                          'pasivo',  'acreedora', NULL,   1, false);
    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '21',   'Cuentas por pagar',                'pasivo',  'acreedora', '2',    2, false);
    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '2101', 'Proveedores',                      'pasivo',  'acreedora', '21',   3, true);
    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '2102', 'IVA por pagar',                   'pasivo',  'acreedora', '21',   3, true);

    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '3',    'Patrimonio',                       'capital', 'acreedora', NULL,   1, false);
    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '31',   'Patrimonio y resultados',          'capital', 'acreedora', '3',    2, false);
    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '3101', 'Resultados acumulados',            'capital', 'acreedora', '31',   3, true);
    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '3201', 'Resultado del ejercicio',          'capital', 'acreedora', '31',   3, true);
    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '3301', 'Diferencial cambiario',            'capital', 'acreedora', '31',   3, true);

    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '4',    'Ingresos',                         'ingreso', 'acreedora', NULL,   1, false);
    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '41',   'Ingresos operativos',              'ingreso', 'acreedora', '4',    2, false);
    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '4101', 'Ingresos operativos',              'ingreso', 'acreedora', '41',   3, true);

    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '5',    'Costos y gastos',                  'gasto',   'deudora',   NULL,   1, false);
    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '51',   'Costos y gastos operativos',       'gasto',   'deudora',   '5',    2, false);
    PERFORM public.conta_seed_cuenta(v_company, p_project_id, '5101', 'Costos y gastos operativos',       'gasto',   'deudora',   '51',   3, true);

    FOR m IN
      SELECT * FROM (VALUES
        ('metodo_efectivo',      '1101'),
        ('metodo_transferencia', '1101'),
        ('metodo_deposito',      '1101'),
        ('metodo_cheque',        '1101'),
        ('metodo_tarjeta',       '1101'),
        ('metodo_pasarela',      '1101'),
        ('metodo_otro',          '1101'),
        ('ingreso_agua',         '4101'),
        ('ingreso_cuota',        '4101'),
        ('ingreso_mora',         '4101'),
        ('ingreso_otros',        '4101'),
        ('cxc_agua',             '1201'),
        ('cxc_cuotas',           '1201'),
        ('iva_por_pagar',        '2102'),
        ('iva_credito',          '1301'),
        ('cxp_proveedores',      '2101'),
        ('gasto_mantenimiento',  '5101'),
        ('gasto_servicios',      '5101'),
        ('gasto_administrativo', '5101'),
        ('gasto_seguridad',      '5101'),
        ('gasto_limpieza',       '5101'),
        ('gasto_obras',          '5101'),
        ('gasto_otros',          '5101')
      ) AS t(evento, codigo)
    LOOP
      SELECT id
        INTO v_cuenta
        FROM public.conta_cuentas
       WHERE company_id = v_company
         AND project_id IS NOT DISTINCT FROM p_project_id
         AND codigo = m.codigo;

      INSERT INTO public.conta_mapeo_cuentas
        (company_id, project_id, evento, cuenta_id)
      VALUES
        (v_company, p_project_id, m.evento, v_cuenta)
      ON CONFLICT (
        company_id,
        COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
        evento
      ) DO NOTHING;
    END LOOP;
  END IF;

  -- Las tres cuentas usadas por cierre/revaluacion comparten los mismos
  -- codigos en ambas plantillas. El helper respeta cualquier mapeo existente.
  PERFORM public.conta_seed_mapeos_especiales(v_company, p_project_id);

  -- El origen es una plantilla elegida por el usuario, no una cuenta rigida del
  -- sistema. Se puede renombrar, desactivar y, si no esta referenciada, borrar.
  UPDATE public.conta_cuentas
     SET es_sistema = false
   WHERE company_id = v_company
     AND project_id IS NOT DISTINCT FROM p_project_id;

  RETURN QUERY
  SELECT
    (SELECT count(*)::integer
       FROM public.conta_cuentas
      WHERE company_id = v_company
        AND project_id IS NOT DISTINCT FROM p_project_id) - v_antes_cuentas,
    (SELECT count(*)::integer
       FROM public.conta_mapeo_cuentas
      WHERE company_id = v_company
        AND project_id IS NOT DISTINCT FROM p_project_id) - v_antes_mapeos;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_inicializar_catalogo(text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_inicializar_catalogo(text, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.conta_inicializar_catalogo(text, uuid) IS
  'Inicializa un ledger vacio del tenant activo con la plantilla basico o latam. Es atomica, solo owner/admin y nunca modifica catalogos existentes.';
