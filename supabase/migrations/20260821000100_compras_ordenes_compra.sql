-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS — FASE 6 · parte B: ORDEN DE COMPRA CONTABLE
-- Ver ROADMAP_ERP_FINANZAS.md (Fase 6). Depende de la parte A (proveedor
-- autorizado) y de la Fase 1 (conta_cuentas, ledger).
--
-- POR QUÉ EXISTE
-- `ordenes_compra` ya existía —la creó 20260420000037 en el módulo de
-- condominios— pero como una nota adhesiva, no como un documento de compra:
--   · `proveedor_nombre` en TEXTO LIBRE, sin FK: la OC no sabe a quién le
--     compra, así que no hay forma de exigir que ese alguien esté autorizado;
--   · una sola línea (`concepto` + `monto_estimado`): no se puede decir qué se
--     pidió, cuánto de cada cosa, ni a qué cuenta contable va;
--   · `project_id NOT NULL`: la empresa no puede emitir órdenes propias, solo
--     los proyectos — justo lo contrario de "de la empresa o bien del proyecto";
--   · RLS sin control de rol en INSERT/UPDATE: cualquiera de la empresa aprueba;
--   · sin enlace hacia adelante: nada conecta la OC con la factura ni el ledger.
--
-- Se EVOLUCIONA la tabla en vez de crear una paralela: el módulo de condominios
-- ya la usa y sus filas son historia real. Es el mismo movimiento que hizo
-- 20260611010000 con gastos_condominio.proveedor_nombre → proveedor_id.
--
-- LO QUE NO HACE: la OC no genera asiento. Es un COMPROMISO, no una
-- transacción; lo que mueve la contabilidad es la recepción (parte C). Para
-- ver lo comprometido está la RPC compras_compromisos().
--
-- CÓMO REVERTIR
--   DROP FUNCTION public.compras_compromisos(uuid, uuid);
--   DROP TRIGGER trg_compras_oc_estado ON public.ordenes_compra;
--   DROP TRIGGER trg_compras_oc_alerta_presupuesto ON public.ordenes_compra;
--   DROP TABLE public.orden_compra_lineas;   -- cae con sus triggers
--   DROP TABLE public.compras_correlativos;
--   ALTER TABLE public.ordenes_compra DROP COLUMN proveedor_id, ... ;
--   ALTER TABLE public.ordenes_compra ALTER COLUMN project_id SET NOT NULL;
--
-- IMPACTO EN DATOS PRODUCTIVOS: sí — backfill de `proveedor_id` sobre
-- `ordenes_compra` (crea los proveedores que falten, en estado 'borrador') y
-- siembra `total` desde `monto_real`/`monto_estimado`. No borra filas.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Correlativos de los documentos de compra, por contabilidad ───────────
-- Uno por (ledger, documento). `conta_folios` no sirve: ese es el folio de las
-- PÓLIZAS y mezclar la numeración de un documento operativo con la del libro
-- diario rompe la correlatividad de ambos. La misma tabla la reutilizan la
-- recepción (parte C) y la contraseña de pago (parte E).
CREATE TABLE IF NOT EXISTS public.compras_correlativos (
  company_id uuid   NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid   REFERENCES public.projects(id) ON DELETE CASCADE,
  documento  text   NOT NULL CHECK (documento IN ('orden_compra','recepcion','contrasena_pago')),
  ultimo     bigint NOT NULL DEFAULT 0
);

-- project_id NULL = contabilidad de la EMPRESA. Un UNIQUE normal trata cada
-- NULL como distinto y dejaría crear dos filas para el mismo ledger; el
-- COALESCE con el uuid cero es el idioma que ya usa conta_folios.
CREATE UNIQUE INDEX IF NOT EXISTS uq_compras_correlativos
  ON public.compras_correlativos
     (company_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), documento);

ALTER TABLE public.compras_correlativos ENABLE ROW LEVEL SECURITY;
-- Deny-all EXPLÍCITA: solo la escriben funciones SECURITY DEFINER. Se declara
-- en vez de dejar la tabla sin policy para que la intención sea auditable
-- (regla (c) de scripts/migrations-guard.mjs).
DROP POLICY IF EXISTS "compras_correlativos_deny_all" ON public.compras_correlativos;
CREATE POLICY "compras_correlativos_deny_all" ON public.compras_correlativos
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.compras_siguiente_correlativo(
  p_company_id uuid,
  p_project_id uuid,
  p_documento  text
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_num bigint;
BEGIN
  INSERT INTO public.compras_correlativos (company_id, project_id, documento, ultimo)
  VALUES (p_company_id, p_project_id, p_documento, 0)
  ON CONFLICT (company_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), documento)
  DO NOTHING;

  SELECT ultimo + 1 INTO v_num FROM public.compras_correlativos
  WHERE company_id = p_company_id
    AND project_id IS NOT DISTINCT FROM p_project_id
    AND documento = p_documento
  FOR UPDATE;

  UPDATE public.compras_correlativos SET ultimo = v_num
  WHERE company_id = p_company_id
    AND project_id IS NOT DISTINCT FROM p_project_id
    AND documento = p_documento;

  RETURN v_num;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_siguiente_correlativo(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.compras_correlativos IS
  'Correlativo por (contabilidad, tipo de documento) de órdenes de compra, recepciones y contraseñas de pago. Deny-all: solo lo mueve compras_siguiente_correlativo().';

-- ── 2. La orden de compra deja de ser una nota adhesiva ─────────────────────
ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS proveedor_id      uuid REFERENCES public.proveedores(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS numero            text,
  ADD COLUMN IF NOT EXISTS moneda            text,
  ADD COLUMN IF NOT EXISTS subtotal          numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iva_monto         numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total             numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS condiciones_pago  text,
  ADD COLUMN IF NOT EXISTS dias_credito      int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fecha_requerida   date,
  ADD COLUMN IF NOT EXISTS obra_id           uuid REFERENCES public.obras_mejoras(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS aprobada_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS aprobada_at       timestamptz,
  ADD COLUMN IF NOT EXISTS emitida_at        timestamptz,
  ADD COLUMN IF NOT EXISTS cerrada_at        timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_anulacion  text,
  ADD COLUMN IF NOT EXISTS updated_at        timestamptz NOT NULL DEFAULT now();

-- La empresa también compra: sin esto la contabilidad de empresa no puede
-- emitir órdenes y "de la empresa o bien del proyecto" queda a medias.
ALTER TABLE public.ordenes_compra ALTER COLUMN project_id DROP NOT NULL;

-- El ciclo real necesita la recepción parcial (llegó la mitad del pedido) y el
-- cierre (recibido y facturado del todo). El CHECK viejo se localiza por
-- catálogo: su nombre lo puso Postgres y no conviene adivinarlo.
DO $$
DECLARE v_con text;
BEGIN
  SELECT con.conname INTO v_con
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'ordenes_compra'
    AND con.contype = 'c' AND pg_get_constraintdef(con.oid) ILIKE '%estado%';
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.ordenes_compra DROP CONSTRAINT %I', v_con);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE public.ordenes_compra
    ADD CONSTRAINT ordenes_compra_estado_check
    CHECK (estado IN ('borrador','aprobada','emitida','recibida_parcial','recibida','cerrada','cancelada'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill de totales: las OC viejas solo tienen monto_estimado/monto_real.
UPDATE public.ordenes_compra
   SET total    = COALESCE(monto_real, monto_estimado, 0),
       subtotal = COALESCE(monto_real, monto_estimado, 0)
 WHERE total = 0;

-- ── 3. Backfill del proveedor: de texto libre a catálogo ────────────────────
-- Mismo procedimiento que 20260611010000 hizo con gastos_condominio. Los
-- proveedores que nazcan de aquí entran en 'borrador' (el DEFAULT de la parte
-- A): son nombres sueltos que nadie ha revisado, y tratarlos como autorizados
-- sería fabricar la autorización que esta fase viene a exigir.
INSERT INTO public.proveedores (company_id, nombre)
SELECT DISTINCT oc.company_id, trim(oc.proveedor_nombre)
FROM public.ordenes_compra oc
WHERE oc.proveedor_id IS NULL
  AND COALESCE(trim(oc.proveedor_nombre), '') <> ''
ON CONFLICT (company_id, nombre) DO NOTHING;

UPDATE public.ordenes_compra oc
   SET proveedor_id = p.id
  FROM public.proveedores p
 WHERE oc.proveedor_id IS NULL
   AND p.company_id = oc.company_id
   AND p.nombre = trim(oc.proveedor_nombre);

CREATE INDEX IF NOT EXISTS idx_ordenes_compra_proveedor ON public.ordenes_compra(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_ledger    ON public.ordenes_compra(company_id, project_id, estado);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ordenes_compra_numero
  ON public.ordenes_compra (company_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), numero)
  WHERE numero IS NOT NULL;

COMMENT ON COLUMN public.ordenes_compra.proveedor_id IS
  'Proveedor del catálogo. Debe estar AUTORIZADO y vigente para aprobar/emitir la orden (trigger compras_tg_oc_estado).';
COMMENT ON COLUMN public.ordenes_compra.numero IS
  'Correlativo por contabilidad (OC-000001), asignado al aprobar. Distinto de `correlativo`, que es global y legacy.';

-- ── 4. Líneas: qué se pide, cuánto y CONTRA QUÉ CUENTA ──────────────────────
-- `destino_tipo` es la bisagra de toda la fase: decide qué hace la recepción
-- (mover existencias, dar de alta un activo, o solo devengar) y contra qué
-- cuenta se debita en el asiento GR/IR de la parte C.
CREATE TABLE IF NOT EXISTS public.orden_compra_lineas (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  orden_compra_id    uuid          NOT NULL REFERENCES public.ordenes_compra(id) ON DELETE CASCADE,
  linea              int           NOT NULL DEFAULT 1,
  descripcion        text          NOT NULL,
  destino_tipo       text          NOT NULL DEFAULT 'gasto'
                       CHECK (destino_tipo IN ('inventario','activo_fijo','servicio','gasto')),
  -- Destino concreto según el tipo; los tres son opcionales porque un gasto o
  -- un servicio se resuelven solo con la cuenta contable.
  suministro_id      uuid          REFERENCES public.suministros_condominio(id) ON DELETE SET NULL,
  cuenta_id          uuid          REFERENCES public.conta_cuentas(id) ON DELETE RESTRICT,
  categoria          text          NOT NULL DEFAULT 'otros',
  cantidad           numeric(14,4) NOT NULL CHECK (cantidad > 0),
  unidad             text          NOT NULL DEFAULT 'unidad',
  precio_unitario    numeric(14,4) NOT NULL CHECK (precio_unitario >= 0),
  iva_monto          numeric(14,2) NOT NULL DEFAULT 0 CHECK (iva_monto >= 0),
  total              numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  cantidad_recibida  numeric(14,4) NOT NULL DEFAULT 0 CHECK (cantidad_recibida >= 0),
  cantidad_facturada numeric(14,4) NOT NULL DEFAULT 0 CHECK (cantidad_facturada >= 0),
  notas              text,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT orden_compra_lineas_unica UNIQUE (orden_compra_id, linea)
);

CREATE INDEX IF NOT EXISTS idx_oc_lineas_orden      ON public.orden_compra_lineas(orden_compra_id, linea);
CREATE INDEX IF NOT EXISTS idx_oc_lineas_suministro ON public.orden_compra_lineas(suministro_id) WHERE suministro_id IS NOT NULL;

COMMENT ON TABLE public.orden_compra_lineas IS
  'Detalle de la orden de compra. destino_tipo (inventario|activo_fijo|servicio|gasto) determina qué hace la recepción y contra qué cuenta se debita el asiento GR/IR.';
COMMENT ON COLUMN public.orden_compra_lineas.cantidad_recibida IS
  'Acumulado por las recepciones (parte C). Lo mantiene un trigger, no la UI.';
COMMENT ON COLUMN public.orden_compra_lineas.cantidad_facturada IS
  'Acumulado por las líneas de factura (parte D). Lo mantiene un trigger, no la UI.';

-- ── 5. RLS ──────────────────────────────────────────────────────────────────
-- `ordenes_compra` traía policies de 2026-04: `company_id = get_my_company_id()`
-- a secas, sin `is_super_admin()` y —lo grave— SIN control de rol en INSERT ni
-- UPDATE. Cualquier usuario de la empresa aprobaba órdenes. Se alinean con el
-- resto del módulo contable vía conta_puede_escribir() (20260818000000), que
-- respeta tanto el rol legacy como el permiso RBAC.
ALTER TABLE public.orden_compra_lineas ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t          text;
  -- El operador REGISTRA (mismo criterio que facturas_proveedor/ordenes_pago:
  -- "solicita el operador, aprueba el admin"); aprobar es un UPDATE y ese sí
  -- queda en admin/owner o permiso de edición.
  ins_expr text := $e$is_super_admin() OR (company_id = get_my_company_id() AND (
      current_user_role() = ANY(ARRAY['company_owner','admin','operator'])
      OR public.conta_puede_escribir('create')))$e$;
  upd_expr text := $e$is_super_admin() OR (company_id = get_my_company_id() AND (
      current_user_role() = ANY(ARRAY['company_owner','admin'])
      OR public.conta_puede_escribir('edit')))$e$;
  del_expr text := $e$is_super_admin() OR (company_id = get_my_company_id() AND (
      current_user_role() = ANY(ARRAY['company_owner','admin'])
      OR public.conta_puede_escribir('delete')))$e$;
BEGIN
  FOREACH t IN ARRAY ARRAY['ordenes_compra','orden_compra_lineas'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
                      USING (company_id = get_my_company_id() OR is_super_admin())$p$,
                   t || '_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)',
                   t || '_insert', t, ins_expr);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
                   t || '_update', t, upd_expr, upd_expr);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)',
                   t || '_delete', t, del_expr);
  END LOOP;
END $$;

-- Puerta MFA, igual que las demás tablas que mueven dinero (20260717020000).
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'mfa_requirement_met') THEN
    FOREACH t IN ARRAY ARRAY['ordenes_compra','orden_compra_lineas'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS mfa_gate_aal2 ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY mfa_gate_aal2 ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        || 'USING (public.mfa_requirement_met()) WITH CHECK (public.mfa_requirement_met())', t);
    END LOOP;
  END IF;
END $$;

-- ── 6. Totales de la cabecera desde las líneas ──────────────────────────────
-- Solo cuando HAY líneas: las OC heredadas no tienen y su monto_estimado no se
-- puede pisar con un cero.
CREATE OR REPLACE FUNCTION public.compras_tg_oc_totales()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_oc  uuid := COALESCE(NEW.orden_compra_id, OLD.orden_compra_id);
  v_sub numeric(14,2);
  v_iva numeric(14,2);
  v_n   int;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(round(cantidad * precio_unitario, 2)), 0), COALESCE(SUM(iva_monto), 0)
    INTO v_n, v_sub, v_iva
  FROM public.orden_compra_lineas WHERE orden_compra_id = v_oc;

  IF v_n > 0 THEN
    UPDATE public.ordenes_compra
       SET subtotal = v_sub, iva_monto = v_iva, total = v_sub + v_iva, updated_at = now()
     WHERE id = v_oc;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_tg_oc_totales() FROM PUBLIC, anon, authenticated;

-- El total de la línea se calcula, no se confía al cliente.
CREATE OR REPLACE FUNCTION public.compras_tg_oc_linea_total()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_estado text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT estado INTO v_estado FROM public.ordenes_compra WHERE id = OLD.orden_compra_id;
    IF v_estado IS NOT NULL AND v_estado <> 'borrador' THEN
      RAISE EXCEPTION 'COMPRAS_OC_INMUTABLE: no se borran líneas de una orden en estado %.', v_estado
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  SELECT estado INTO v_estado FROM public.ordenes_compra WHERE id = NEW.orden_compra_id;
  -- Las cantidades acumuladas las mueven los triggers de recepción y factura
  -- con el GUC del sistema; esos sí escriben sobre una OC ya aprobada.
  IF v_estado IS NOT NULL AND v_estado <> 'borrador'
     AND COALESCE(current_setting('conta.allow_system_write', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'COMPRAS_OC_INMUTABLE: la orden está en estado % y sus líneas ya no se editan.', v_estado
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.total      := round(NEW.cantidad * NEW.precio_unitario, 2) + COALESCE(NEW.iva_monto, 0);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_tg_oc_linea_total() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_oc_linea_total ON public.orden_compra_lineas;
CREATE TRIGGER trg_compras_oc_linea_total
  BEFORE INSERT OR UPDATE OR DELETE ON public.orden_compra_lineas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_oc_linea_total();

DROP TRIGGER IF EXISTS trg_compras_oc_totales ON public.orden_compra_lineas;
CREATE TRIGGER trg_compras_oc_totales
  AFTER INSERT OR UPDATE OR DELETE ON public.orden_compra_lineas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_oc_totales();

-- ── 7. EL CANDADO: sin proveedor autorizado no hay orden ────────────────────
-- Es la regla que pidió la operación, y vive en la BD —no en la UI— porque
-- una regla que solo existe en el formulario se la salta cualquier cliente
-- que hable con PostgREST.
CREATE OR REPLACE FUNCTION public.compras_tg_oc_estado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_prov record;
BEGIN
  NEW.updated_at := now();

  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NEW;  -- triggers de recepción/factura moviendo el estado
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.estado = 'cancelada' AND NEW.estado <> 'cancelada' THEN
    RAISE EXCEPTION 'COMPRAS_OC_INMUTABLE: una orden cancelada no se reabre.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Aprobar o emitir es comprometer dinero con un tercero: ahí se exige la
  -- autorización vigente. Capturar el borrador NO se bloquea, para poder
  -- preparar la orden mientras la papelería del proveedor se completa.
  IF NEW.estado IN ('aprobada','emitida')
     AND (TG_OP = 'INSERT' OR OLD.estado NOT IN ('aprobada','emitida','recibida_parcial','recibida','cerrada')) THEN

    IF NEW.proveedor_id IS NULL THEN
      RAISE EXCEPTION 'COMPRAS_PROVEEDOR_REQUERIDO: la orden necesita un proveedor del catálogo antes de aprobarse.'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT nombre, estado, autorizacion_vence INTO v_prov
    FROM public.proveedores WHERE id = NEW.proveedor_id;

    IF NOT public.proveedor_habilitado(NEW.proveedor_id) THEN
      IF v_prov.estado = 'autorizado' THEN
        RAISE EXCEPTION 'COMPRAS_PROVEEDOR_NO_AUTORIZADO: la autorización de "%" venció el %. Actualiza su papelería antes de emitirle órdenes.',
          v_prov.nombre, to_char(v_prov.autorizacion_vence, 'DD/MM/YYYY')
          USING ERRCODE = 'check_violation';
      ELSE
        RAISE EXCEPTION 'COMPRAS_PROVEEDOR_NO_AUTORIZADO: "%" está en estado "%"; solo un proveedor autorizado recibe órdenes de compra.',
          v_prov.nombre, v_prov.estado
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    -- Sellos y correlativo, una sola vez.
    IF NEW.aprobada_at IS NULL THEN
      NEW.aprobada_por := COALESCE(NEW.aprobada_por, auth.uid());
      NEW.aprobada_at  := now();
    END IF;
    IF NEW.numero IS NULL THEN
      NEW.numero := 'OC-' || lpad(
        public.compras_siguiente_correlativo(NEW.company_id, NEW.project_id, 'orden_compra')::text, 6, '0');
    END IF;
    IF NEW.moneda IS NULL THEN
      NEW.moneda := public.conta_moneda_base(NEW.company_id, NEW.project_id);
    END IF;
  END IF;

  IF NEW.estado = 'emitida' AND NEW.emitida_at IS NULL THEN
    NEW.emitida_at := now();
  END IF;
  IF NEW.estado = 'cerrada' AND NEW.cerrada_at IS NULL THEN
    NEW.cerrada_at := now();
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_tg_oc_estado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_oc_estado ON public.ordenes_compra;
CREATE TRIGGER trg_compras_oc_estado
  BEFORE INSERT OR UPDATE ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_oc_estado();

-- ── 8. Aviso presupuestario al aprobar ──────────────────────────────────────
-- ADVIERTE, NO BLOQUEA: misma política que la Fase 3 tomó para los gastos. Que
-- una partida se exceda es una decisión de negocio del admin, no un error de
-- captura; lo que sí es inaceptable es que se entere después del cierre.
CREATE OR REPLACE FUNCTION public.compras_tg_oc_alerta_presupuesto()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_periodo text;
  v_linea   record;
  v_estado  record;
  v_cta     record;
  v_admin   record;
  v_payload jsonb;
BEGIN
  IF NOT (NEW.estado = 'aprobada' AND (TG_OP = 'INSERT' OR OLD.estado <> 'aprobada')) THEN
    RETURN NEW;
  END IF;

  v_periodo := to_char(COALESCE(NEW.fecha_requerida, CURRENT_DATE), 'YYYY-MM');

  FOR v_linea IN
    SELECT cuenta_id, SUM(round(cantidad * precio_unitario, 2)) AS monto
    FROM public.orden_compra_lineas
    WHERE orden_compra_id = NEW.id AND cuenta_id IS NOT NULL
    GROUP BY cuenta_id
  LOOP
    SELECT * INTO v_estado
    FROM public.presupuesto_partida_estado(NEW.company_id, NEW.project_id, v_linea.cuenta_id, v_periodo);

    -- El compromiso se SUMA a lo ya ejecutado: la pregunta no es "¿me pasé?"
    -- sino "¿me voy a pasar si emito esta orden?".
    CONTINUE WHEN v_estado.presupuesto_id IS NULL
                  OR v_estado.presupuestado <= 0
                  OR v_estado.ejecutado + v_linea.monto <= v_estado.presupuestado;

    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.notifications_outbox n
      WHERE n.company_id = NEW.company_id
        AND n.template_key = 'presupuesto_partida_comprometida'
        AND n.payload->>'cuenta_id' = v_linea.cuenta_id::text
        AND n.payload->>'periodo' = v_periodo
    );

    SELECT c.codigo, c.nombre INTO v_cta FROM public.conta_cuentas c WHERE c.id = v_linea.cuenta_id;

    v_payload := jsonb_build_object(
      'cuenta_id', v_linea.cuenta_id,
      'cuenta', v_cta.codigo || ' ' || v_cta.nombre,
      'periodo', v_periodo,
      'presupuestado', v_estado.presupuestado,
      'ejecutado', v_estado.ejecutado,
      'comprometido', v_linea.monto,
      'orden', COALESCE(NEW.numero, NEW.concepto),
      'seccion', 'contabilidad'
    );

    FOR v_admin IN
      SELECT au.id FROM public.app_users au
      WHERE au.company_id = NEW.company_id
        AND au.role IN ('admin','company_owner')
        AND COALESCE(au.activo, true)
    LOOP
      INSERT INTO public.notifications_outbox (company_id, channel, template_key, payload, recipient)
      VALUES (NEW.company_id, 'in_app', 'presupuesto_partida_comprometida', v_payload, v_admin.id::text);
    END LOOP;
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- El aviso jamás tumba la aprobación de la orden.
  RAISE WARNING 'compras_tg_oc_alerta_presupuesto(%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_tg_oc_alerta_presupuesto() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_oc_alerta_presupuesto ON public.ordenes_compra;
CREATE TRIGGER trg_compras_oc_alerta_presupuesto
  AFTER INSERT OR UPDATE OF estado ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_oc_alerta_presupuesto();

INSERT INTO public.notification_templates (company_id, key, channel, subject, body, locale, is_active)
VALUES
  (NULL, 'presupuesto_partida_comprometida', 'in_app', 'Orden de compra sobre el presupuesto',
   'La orden {{orden}} compromete {{comprometido}} en la partida {{cuenta}} del periodo {{periodo}}, que quedaría sobre lo presupuestado ({{presupuestado}}, ejecutado {{ejecutado}}). Revisa el comparativo en Contabilidad → Presupuesto.',
   'es', true)
ON CONFLICT DO NOTHING;

-- ── 9. Lo comprometido y aún no recibido ────────────────────────────────────
-- El equivalente de compras a la antigüedad de saldos: qué se pidió, qué llegó
-- y cuánto sigue comprometido con cada proveedor en ESTA contabilidad.
CREATE OR REPLACE FUNCTION public.compras_compromisos(
  p_company_id uuid,
  p_project_id uuid
)
RETURNS TABLE (
  proveedor_id  uuid,
  proveedor     text,
  ordenes       bigint,
  comprometido  numeric,
  recibido      numeric,
  pendiente     numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Guard de tenant: el id que manda el cliente solo vale si es SU empresa.
  -- Se FILTRA (devuelve vacío) en vez de reventar, como el resto de RPCs de
  -- reporte del repo.
  SELECT
    p.id,
    p.nombre,
    COUNT(DISTINCT oc.id),
    COALESCE(SUM(round(l.cantidad * l.precio_unitario, 2)), 0),
    COALESCE(SUM(round(l.cantidad_recibida * l.precio_unitario, 2)), 0),
    COALESCE(SUM(round((l.cantidad - l.cantidad_recibida) * l.precio_unitario, 2)), 0)
  FROM public.ordenes_compra oc
  JOIN public.orden_compra_lineas l ON l.orden_compra_id = oc.id
  JOIN public.proveedores p ON p.id = oc.proveedor_id
  WHERE oc.company_id = p_company_id
    AND oc.project_id IS NOT DISTINCT FROM p_project_id
    AND oc.estado IN ('aprobada','emitida','recibida_parcial')
    AND (public.is_super_admin() OR oc.company_id = public.get_my_company_id())
  GROUP BY p.id, p.nombre
  HAVING COALESCE(SUM(round((l.cantidad - l.cantidad_recibida) * l.precio_unitario, 2)), 0) <> 0
  ORDER BY 6 DESC
$$;

COMMENT ON FUNCTION public.compras_compromisos(uuid, uuid) IS
  'Comprometido vs recibido por proveedor en una contabilidad (empresa o proyecto). Solo órdenes vivas: aprobada/emitida/recibida_parcial.';

GRANT EXECUTE ON FUNCTION public.compras_compromisos(uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.compras_compromisos(uuid, uuid) FROM PUBLIC, anon;
