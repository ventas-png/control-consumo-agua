-- ════════════════════════════════════════════════════════════════════════════
-- LEDGER (entidad contable) · parte A: catálogo de cuentas POR LEDGER
--
-- La contabilidad pasa de "una por empresa (project_id como filtro)" a una
-- ENTIDAD CONTABLE por (company_id, project_id), donde project_id NULL es el
-- ledger de la EMPRESA y cada proyecto lleva el suyo:
--   · conta_cuentas gana project_id; unicidad de código POR LEDGER.
--   · conta_seed_catalogo/conta_seed_cuenta v2 con p_project_id; el seed
--     incluye 1105 IVA crédito fiscal y TODOS los mapeos del ledger
--     (absorbe cxp_seed_defaults y cxp_seed_iva, cuyos triggers se eliminan).
--   · Trigger AFTER INSERT ON projects + backfill: cada proyecto existente
--     recibe su catálogo y mapeos propios.
--   · conta_cuenta_para se vuelve ESTRICTA al ledger (sin fallback al mapeo
--     de empresa: cada ledger resuelve contra su propio catálogo).
--   · Los mapeos validan que su cuenta pertenezca al mismo ledger.
--
-- Idempotente. RLS intacta (sigue filtrando por company_id).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Columna + unicidad por ledger (constraint swap) ──────────────────────
-- Con los datos actuales (todo project_id NULL) el índice nuevo equivale al
-- viejo, así que el swap no puede fallar por duplicados.
ALTER TABLE public.conta_cuentas
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_conta_cuentas_ledger_codigo
  ON public.conta_cuentas(company_id,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), codigo);

ALTER TABLE public.conta_cuentas DROP CONSTRAINT IF EXISTS conta_cuentas_company_id_codigo_key;

CREATE INDEX IF NOT EXISTS idx_conta_cuentas_ledger
  ON public.conta_cuentas(company_id, project_id);

-- ── 2. Seed v2 (por ledger) ─────────────────────────────────────────────────
-- Las versiones por-company se eliminan: su ON CONFLICT (company_id, codigo)
-- quedó huérfano tras el swap. Son internas (REVOKE total) — drop seguro.
DROP FUNCTION IF EXISTS public.conta_seed_cuenta(uuid, text, text, text, text, text, int, boolean);
DROP FUNCTION IF EXISTS public.conta_seed_catalogo(uuid);

CREATE OR REPLACE FUNCTION public.conta_seed_cuenta(
  p_company uuid, p_project uuid, p_codigo text, p_nombre text, p_tipo text,
  p_naturaleza text, p_padre_codigo text, p_nivel int, p_detalle boolean
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_padre uuid;
BEGIN
  IF p_padre_codigo IS NOT NULL THEN
    SELECT id INTO v_padre FROM public.conta_cuentas
    WHERE company_id = p_company AND project_id IS NOT DISTINCT FROM p_project
      AND codigo = p_padre_codigo;
  END IF;
  INSERT INTO public.conta_cuentas
    (company_id, project_id, codigo, nombre, tipo, naturaleza, padre_id, nivel, es_detalle, es_sistema)
  VALUES (p_company, p_project, p_codigo, p_nombre, p_tipo, p_naturaleza, v_padre, p_nivel, p_detalle, true)
  ON CONFLICT (company_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), codigo)
  DO NOTHING;
  RETURN (SELECT id FROM public.conta_cuentas
          WHERE company_id = p_company AND project_id IS NOT DISTINCT FROM p_project
            AND codigo = p_codigo);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_seed_cuenta(uuid, uuid, text, text, text, text, text, int, boolean)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.conta_seed_catalogo(p_company_id uuid, p_project_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m record;
  v_cuenta uuid;
BEGIN
  -- 1 ACTIVO ────────────────────────────────────────────────────────────────
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '1',  'Activo',            'activo', 'deudora', NULL, 1, false);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '11', 'Activo circulante', 'activo', 'deudora', '1',  2, false);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '1101', 'Caja',                            'activo', 'deudora', '11', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '1102', 'Bancos',                          'activo', 'deudora', '11', 3, false);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '1102-01', 'Banco principal',              'activo', 'deudora', '1102', 4, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '1103', 'Caja chica',                      'activo', 'deudora', '11', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '1104', 'Pasarelas de pago por liquidar',  'activo', 'deudora', '11', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '1105', 'IVA crédito fiscal',              'activo', 'deudora', '11', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '12', 'Cuentas por cobrar', 'activo', 'deudora', '1', 2, false);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '1201', 'CxC cuotas de condominio',        'activo', 'deudora', '12', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '1202', 'CxC servicio de agua',            'activo', 'deudora', '12', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '13', 'Otros activos', 'activo', 'deudora', '1', 2, false);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '1301', 'Fondo de reserva',                'activo', 'deudora', '13', 3, true);

  -- 2 PASIVO ────────────────────────────────────────────────────────────────
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '2',  'Pasivo',            'pasivo', 'acreedora', NULL, 1, false);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '21', 'Pasivo circulante', 'pasivo', 'acreedora', '2',  2, false);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '2101', 'IVA por pagar',           'pasivo', 'acreedora', '21', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '2102', 'Cobros anticipados',      'pasivo', 'acreedora', '21', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '2103', 'Depósitos en garantía',   'pasivo', 'acreedora', '21', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '2104', 'Proveedores por pagar',   'pasivo', 'acreedora', '21', 3, true);

  -- 3 CAPITAL ───────────────────────────────────────────────────────────────
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '3',  'Capital',          'capital', 'acreedora', NULL, 1, false);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '31', 'Capital contable', 'capital', 'acreedora', '3',  2, false);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '3101', 'Resultados acumulados',    'capital', 'acreedora', '31', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '3201', 'Resultado del ejercicio',  'capital', 'acreedora', '31', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '3301', 'Diferencial cambiario',    'capital', 'acreedora', '31', 3, true);

  -- 4 INGRESOS ──────────────────────────────────────────────────────────────
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '4',  'Ingresos',            'ingreso', 'acreedora', NULL, 1, false);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '41', 'Ingresos operativos', 'ingreso', 'acreedora', '4',  2, false);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '4101', 'Cuotas de mantenimiento', 'ingreso', 'acreedora', '41', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '4102', 'Servicio de agua',        'ingreso', 'acreedora', '41', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '4103', 'Mora y recargos',         'ingreso', 'acreedora', '41', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '4104', 'Cargos adicionales',      'ingreso', 'acreedora', '41', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '4199', 'Otros ingresos',          'ingreso', 'acreedora', '41', 3, true);

  -- 5 GASTOS (espeja CategoriaGasto de gastos_condominio) ───────────────────
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '5',  'Gastos',            'gasto', 'deudora', NULL, 1, false);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '51', 'Gastos operativos', 'gasto', 'deudora', '5',  2, false);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '5101', 'Mantenimiento',  'gasto', 'deudora', '51', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '5102', 'Servicios',      'gasto', 'deudora', '51', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '5103', 'Administrativo', 'gasto', 'deudora', '51', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '5104', 'Seguridad',      'gasto', 'deudora', '51', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '5105', 'Limpieza',       'gasto', 'deudora', '51', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '5106', 'Obras y mejoras','gasto', 'deudora', '51', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '5199', 'Otros gastos',   'gasto', 'deudora', '51', 3, true);

  -- Mapeos del LEDGER (cada ledger resuelve contra su propio catálogo).
  -- Incluye los eventos de CxP (2104/1105) — absorbe cxp_seed_defaults/iva.
  FOR m IN
    SELECT * FROM (VALUES
      ('metodo_efectivo',      '1101'),
      ('metodo_transferencia', '1102-01'),
      ('metodo_deposito',      '1102-01'),
      ('metodo_cheque',        '1102-01'),
      ('metodo_tarjeta',       '1104'),
      ('metodo_pasarela',      '1104'),
      ('metodo_otro',          '1101'),
      ('ingreso_agua',         '4102'),
      ('ingreso_cuota',        '4101'),
      ('ingreso_mora',         '4103'),
      ('ingreso_otros',        '4199'),
      ('cxc_agua',             '1202'),
      ('cxc_cuotas',           '1201'),
      ('iva_por_pagar',        '2101'),
      ('iva_credito',          '1105'),
      ('cxp_proveedores',      '2104'),
      ('gasto_mantenimiento',  '5101'),
      ('gasto_servicios',      '5102'),
      ('gasto_administrativo', '5103'),
      ('gasto_seguridad',      '5104'),
      ('gasto_limpieza',       '5105'),
      ('gasto_obras',          '5106'),
      ('gasto_otros',          '5199')
    ) AS t(evento, codigo)
  LOOP
    SELECT id INTO v_cuenta FROM public.conta_cuentas
    WHERE company_id = p_company_id AND project_id IS NOT DISTINCT FROM p_project_id
      AND codigo = m.codigo;
    IF v_cuenta IS NOT NULL THEN
      INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
      VALUES (p_company_id, p_project_id, m.evento, v_cuenta)
      ON CONFLICT (company_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), evento)
      DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_seed_catalogo(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Triggers de seed ─────────────────────────────────────────────────────
-- Empresa nueva → ledger empresa. (Re-define la función existente para la
-- firma v2 del seed.)
CREATE OR REPLACE FUNCTION public.conta_seed_on_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    PERFORM public.conta_seed_catalogo(NEW.id, NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'conta_seed_on_company(%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- Proyecto nuevo → su ledger (catálogo + mapeos propios). NUNCA aborta el alta.
CREATE OR REPLACE FUNCTION public.conta_seed_on_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    PERFORM public.conta_seed_catalogo(NEW.company_id, NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'conta_seed_on_project(%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conta_seed_on_project ON public.projects;
CREATE TRIGGER trg_conta_seed_on_project
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.conta_seed_on_project();

-- Los seeds parciales de CxP quedan absorbidos por conta_seed_catalogo v2.
DROP TRIGGER IF EXISTS trg_zcxp_seed_on_company ON public.companies;
DROP TRIGGER IF EXISTS trg_cxp_seed_iva_company ON public.companies;
DROP FUNCTION IF EXISTS public.cxp_seed_on_company();
DROP FUNCTION IF EXISTS public.cxp_seed_iva_on_company();
DROP FUNCTION IF EXISTS public.cxp_seed_defaults(uuid);
DROP FUNCTION IF EXISTS public.cxp_seed_iva(uuid);

-- ── 4. Resolución evento → cuenta ESTRICTA al ledger ────────────────────────
-- Sin fallback cross-ledger: el mapeo del ledger del documento o nada (el
-- generador omite el asiento con WARNING, como siempre).
CREATE OR REPLACE FUNCTION public.conta_cuenta_para(
  p_company_id uuid, p_project_id uuid, p_evento text
)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT cuenta_id FROM public.conta_mapeo_cuentas
  WHERE company_id = p_company_id AND evento = p_evento
    AND project_id IS NOT DISTINCT FROM p_project_id
  LIMIT 1
$$;

-- ── 5. Limpieza de overrides pre-ledger + validación de mapeos ──────────────
-- Overrides por proyecto creados ANTES del modelo ledger apuntan a cuentas del
-- catálogo de empresa: con la resolución estricta mezclarían ledgers. Fuera.
DELETE FROM public.conta_mapeo_cuentas m
USING public.conta_cuentas c
WHERE m.cuenta_id = c.id
  AND m.project_id IS NOT NULL
  AND c.project_id IS DISTINCT FROM m.project_id;

-- A futuro: un mapeo solo puede apuntar a una cuenta de SU ledger.
CREATE OR REPLACE FUNCTION public.conta_tg_mapeo_mismo_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.conta_cuentas c
    WHERE c.id = NEW.cuenta_id
      AND c.company_id = NEW.company_id
      AND c.project_id IS NOT DISTINCT FROM NEW.project_id
  ) THEN
    RAISE EXCEPTION 'MAPEO_LEDGER: la cuenta no pertenece a la contabilidad (empresa/proyecto) del mapeo.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conta_mapeo_mismo_ledger ON public.conta_mapeo_cuentas;
CREATE TRIGGER trg_conta_mapeo_mismo_ledger
  BEFORE INSERT OR UPDATE ON public.conta_mapeo_cuentas
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_mapeo_mismo_ledger();

-- ── 6. Backfill: ledger para cada proyecto existente ────────────────────────
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT id, company_id FROM public.projects LOOP
    BEGIN
      PERFORM public.conta_seed_catalogo(p.company_id, p.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'backfill ledger proyecto %: %', p.id, SQLERRM;
    END;
  END LOOP;
END $$;

-- Y asegurar el evento nuevo (iva_credito/cxp) en ledgers de EMPRESA ya
-- sembrados (conta_seed_catalogo es idempotente).
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT id FROM public.companies LOOP
    BEGIN
      PERFORM public.conta_seed_catalogo(c.id, NULL);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'backfill ledger empresa %: %', c.id, SQLERRM;
    END;
  END LOOP;
END $$;

COMMENT ON COLUMN public.conta_cuentas.project_id IS
  'Ledger dueño de la cuenta: NULL = contabilidad de la empresa; uuid = contabilidad propia del proyecto.';
