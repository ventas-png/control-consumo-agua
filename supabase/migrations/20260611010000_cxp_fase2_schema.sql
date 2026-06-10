-- ════════════════════════════════════════════════════════════════════════════
-- CUENTAS POR PAGAR / PROVEEDORES — FASE 2 ERP · parte A: esquema
-- Ver ROADMAP_ERP_FINANZAS.md (Fase 2). Depende de la Fase 1 (conta_*).
--
-- Tablas:
--   proveedores        — catálogo estructurado (antes solo texto libre en
--                        gastos_condominio.proveedor_nombre)
--   facturas_proveedor — CxP: registrada → aprobada (devengo contable) →
--                        pagada_parcial/pagada (vía órdenes) → anulada
--   ordenes_pago       — solicitud (borrador, puede crearla un operador) →
--                        aprobada (admin/owner) → pagada (asiento) → anulada
--
-- Además: gastos_condominio.proveedor_id (FK nueva) con backfill por nombre.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Proveedores ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proveedores (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nombre          text        NOT NULL,
  nit             text,       -- Guatemala
  rfc             text,       -- México
  email           text,
  telefono        text,
  direccion       text,
  contacto_nombre text,
  dias_credito    int         NOT NULL DEFAULT 0 CHECK (dias_credito >= 0),
  -- defaults para prellenar facturas de este proveedor
  categoria_default text,     -- CategoriaGasto ('mantenimiento'…'otros')
  activo          boolean     NOT NULL DEFAULT true,
  notas           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, nombre)
);

CREATE INDEX IF NOT EXISTS idx_proveedores_company ON public.proveedores(company_id, nombre);

-- ── 2. gastos_condominio → FK a proveedores + backfill por nombre ───────────
ALTER TABLE public.gastos_condominio
  ADD COLUMN IF NOT EXISTS proveedor_id uuid REFERENCES public.proveedores(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_gastos_proveedor ON public.gastos_condominio(proveedor_id);

DO $$
BEGIN
  -- Crea proveedores desde los nombres libres existentes (idempotente).
  INSERT INTO public.proveedores (company_id, nombre)
  SELECT DISTINCT g.company_id, trim(g.proveedor_nombre)
  FROM public.gastos_condominio g
  WHERE g.proveedor_nombre IS NOT NULL AND trim(g.proveedor_nombre) <> ''
  ON CONFLICT (company_id, nombre) DO NOTHING;

  -- Linkea los gastos a su proveedor.
  UPDATE public.gastos_condominio g
  SET proveedor_id = p.id
  FROM public.proveedores p
  WHERE g.proveedor_id IS NULL
    AND g.proveedor_nombre IS NOT NULL
    AND p.company_id = g.company_id
    AND p.nombre = trim(g.proveedor_nombre);
END $$;

-- ── 3. Facturas de proveedor (CxP) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.facturas_proveedor (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id        uuid          REFERENCES public.projects(id) ON DELETE SET NULL,
  proveedor_id      uuid          NOT NULL REFERENCES public.proveedores(id) ON DELETE RESTRICT,
  numero_factura    text,
  fecha_emision     date          NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento date,
  concepto          text          NOT NULL,
  categoria         text          NOT NULL DEFAULT 'otros',
  -- montos en la MONEDA del documento; la conversión a moneda base la hace
  -- el asiento (conta_generar_asiento) con la tasa vigente
  moneda            text,         -- NULL = moneda del proyecto/empresa
  monto_total       numeric(14,2) NOT NULL CHECK (monto_total > 0),
  iva_monto         numeric(14,2) NOT NULL DEFAULT 0 CHECK (iva_monto >= 0),
  monto_pagado      numeric(14,2) NOT NULL DEFAULT 0 CHECK (monto_pagado >= 0),
  estado            text          NOT NULL DEFAULT 'registrada'
                    CHECK (estado IN ('registrada','aprobada','pagada_parcial','pagada','anulada')),
  aprobada_por      uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  aprobada_at       timestamptz,
  notas             text,
  created_by        uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now()
);

-- No repetir el mismo número de factura del mismo proveedor (cuando se captura).
CREATE UNIQUE INDEX IF NOT EXISTS uq_facturas_prov_numero
  ON public.facturas_proveedor(company_id, proveedor_id, numero_factura)
  WHERE numero_factura IS NOT NULL AND estado <> 'anulada';

CREATE INDEX IF NOT EXISTS idx_facturas_prov_lista
  ON public.facturas_proveedor(company_id, estado, fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_facturas_prov_proveedor ON public.facturas_proveedor(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_facturas_prov_project ON public.facturas_proveedor(project_id);

-- ── 4. Órdenes de pago ──────────────────────────────────────────────────────
-- Una orden liquida (total o parcialmente) UNA factura; una factura puede
-- tener varias órdenes (pagos parciales).
CREATE TABLE IF NOT EXISTS public.ordenes_pago (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid          REFERENCES public.projects(id) ON DELETE SET NULL,
  proveedor_id  uuid          NOT NULL REFERENCES public.proveedores(id) ON DELETE RESTRICT,
  factura_id    uuid          NOT NULL REFERENCES public.facturas_proveedor(id) ON DELETE RESTRICT,
  monto         numeric(14,2) NOT NULL CHECK (monto > 0),
  fecha_pago    date,
  metodo_pago   text          NOT NULL DEFAULT 'transferencia'
                CHECK (metodo_pago IN ('efectivo','transferencia','deposito','cheque','tarjeta','otro')),
  referencia    text,
  estado        text          NOT NULL DEFAULT 'borrador'
                CHECK (estado IN ('borrador','aprobada','pagada','anulada')),
  solicitada_por uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  aprobada_por  uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  aprobada_at   timestamptz,
  pagada_at     timestamptz,
  notas         text,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ordenes_pago_lista ON public.ordenes_pago(company_id, estado);
CREATE INDEX IF NOT EXISTS idx_ordenes_pago_factura ON public.ordenes_pago(factura_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_pago_proveedor ON public.ordenes_pago(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_pago_project ON public.ordenes_pago(project_id);

-- ── 5. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.proveedores        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facturas_proveedor ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordenes_pago       ENABLE ROW LEVEL SECURITY;

-- proveedores: lectura company, escritura admin/owner.
DROP POLICY IF EXISTS "proveedores_select" ON public.proveedores;
CREATE POLICY "proveedores_select" ON public.proveedores
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
DROP POLICY IF EXISTS "proveedores_insert" ON public.proveedores;
CREATE POLICY "proveedores_insert" ON public.proveedores
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
              AND company_id = get_my_company_id()));
DROP POLICY IF EXISTS "proveedores_update" ON public.proveedores;
CREATE POLICY "proveedores_update" ON public.proveedores
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
         AND company_id = get_my_company_id()))
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
              AND company_id = get_my_company_id()));
DROP POLICY IF EXISTS "proveedores_delete" ON public.proveedores;
CREATE POLICY "proveedores_delete" ON public.proveedores
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
         AND company_id = get_my_company_id()));

-- facturas_proveedor y ordenes_pago: el OPERADOR puede registrar (INSERT)
-- — "solicita el operador, aprueba el admin" — pero solo admin/owner
-- actualiza (aprobar/pagar/anular) o borra.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facturas_proveedor','ordenes_pago'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_select" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "%s_select" ON public.%I
        FOR SELECT TO authenticated
        USING (company_id = get_my_company_id() OR is_super_admin())
    $p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS "%s_insert" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "%s_insert" ON public.%I
        FOR INSERT TO authenticated
        WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin','operator'])
                    AND company_id = get_my_company_id()))
    $p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS "%s_update" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "%s_update" ON public.%I
        FOR UPDATE TO authenticated
        USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
               AND company_id = get_my_company_id()))
        WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
                    AND company_id = get_my_company_id()))
    $p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS "%s_delete" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "%s_delete" ON public.%I
        FOR DELETE TO authenticated
        USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
               AND company_id = get_my_company_id()))
    $p$, t, t);
  END LOOP;
END $$;

-- ── 6. Guardas de transición (BEFORE UPDATE) ────────────────────────────────
-- Sin máquina de estados completa, pero sí lo que protege el dinero:
--   - nada "resucita" desde anulada
--   - una factura aprobada no cambia de monto (el devengo ya se contabilizó)
--   - una orden pagada no cambia de monto ni vuelve a borrador
CREATE OR REPLACE FUNCTION public.cxp_proteger_factura()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  -- El trigger de saldo (cxp_tg_orden_saldo) actualiza monto_pagado/estado con
  -- el GUC del sistema (mismo patrón que conta_proteger_asiento).
  IF current_setting('conta.allow_system_write', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF OLD.estado = 'anulada' THEN
    RAISE EXCEPTION 'CXP_INMUTABLE: una factura anulada no se modifica.'
      USING ERRCODE = 'check_violation';
  END IF;
  -- El usuario no anula una factura con pagos vivos: primero sus órdenes.
  IF NEW.estado = 'anulada' AND OLD.monto_pagado > 0 THEN
    RAISE EXCEPTION 'CXP_BLOQUEADO: la factura tiene pagos aplicados; anula primero sus órdenes de pago.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.estado <> 'registrada'
     AND (NEW.monto_total <> OLD.monto_total OR NEW.iva_monto <> OLD.iva_monto
          OR NEW.proveedor_id <> OLD.proveedor_id) THEN
    RAISE EXCEPTION 'CXP_INMUTABLE: una factura aprobada no cambia de monto/proveedor; anúlala y captura otra.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cxp_proteger_factura ON public.facturas_proveedor;
CREATE TRIGGER trg_cxp_proteger_factura
  BEFORE UPDATE ON public.facturas_proveedor
  FOR EACH ROW EXECUTE FUNCTION public.cxp_proteger_factura();

CREATE OR REPLACE FUNCTION public.cxp_proteger_orden()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.estado = 'anulada' THEN
    RAISE EXCEPTION 'CXP_INMUTABLE: una orden anulada no se modifica.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.estado = 'pagada' AND NEW.estado NOT IN ('pagada','anulada') THEN
    RAISE EXCEPTION 'CXP_INMUTABLE: una orden pagada solo puede anularse.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.estado = 'pagada' AND NEW.monto <> OLD.monto THEN
    RAISE EXCEPTION 'CXP_INMUTABLE: una orden pagada no cambia de monto.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cxp_proteger_orden ON public.ordenes_pago;
CREATE TRIGGER trg_cxp_proteger_orden
  BEFORE UPDATE ON public.ordenes_pago
  FOR EACH ROW EXECUTE FUNCTION public.cxp_proteger_orden();

-- ── 7. Comentarios ──────────────────────────────────────────────────────────
COMMENT ON TABLE public.proveedores IS
  'Catálogo de proveedores (Fase 2 ERP). Reemplaza el texto libre gastos_condominio.proveedor_nombre (FK backfilleada).';
COMMENT ON TABLE public.facturas_proveedor IS
  'CxP: registrada → aprobada (devengo: gasto contra 2104) → pagada_parcial/pagada (vía ordenes_pago) → anulada (reverso).';
COMMENT ON TABLE public.ordenes_pago IS
  'Flujo de pago a proveedor: borrador (operador) → aprobada (admin) → pagada (asiento CxP contra banco/caja) → anulada.';
