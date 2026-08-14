-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS — FASE 6 · parte A: PROVEEDOR AUTORIZADO (el candado del riel)
-- Ver ROADMAP_ERP_FINANZAS.md (Fase 6). Depende de la Fase 2 (proveedores).
--
-- POR QUÉ EXISTE
-- El riel que pide la operación es: proveedor AUTORIZADO → orden de compra →
-- recepción → factura → contraseña de pago → cancelación. Hoy el primer
-- eslabón no existe: `proveedores` solo tiene `activo boolean`, así que
-- cualquiera con permiso de escritura en Contabilidad da de alta un proveedor
-- y le emite documentos en el mismo minuto. No hay constancia de QUIÉN lo
-- autorizó, CUÁNDO, ni con qué papelería — y la papelería vence (el RTU y la
-- patente de comercio son los casos típicos en GT), cosa que un booleano no
-- sabe expresar.
--
-- QUÉ HACE
--   1. `proveedores.estado` con el ciclo real de autorización, más quién/cuándo
--      autorizó y hasta cuándo vale esa autorización.
--   2. `proveedor_documentos`: la papelería de respaldo con su vencimiento.
--   3. `proveedor_habilitado(uuid)`: la pregunta que hará la orden de compra
--      en la parte B ("¿le puedo comprar a este proveedor HOY?").
--
-- COMPATIBILIDAD
-- Aditiva. El backfill mapea activo=true → 'autorizado' y activo=false →
-- 'suspendido', así que NADIE que hoy opere deja de operar. `activo` se
-- conserva (lo leen ProveedoresTab y los selectores existentes) y un trigger
-- lo mantiene en sincronía con `estado` en ambos sentidos.
-- El DEFAULT de los proveedores NUEVOS sí pasa a 'borrador': el alta ya no
-- autoriza por sí sola, que es justamente lo que se pidió. Esto NO bloquea la
-- captura de facturas sueltas (gasto directo, caja chica), que sigue igual;
-- el candado se aplica en la orden de compra (parte B) y al aprobar facturas
-- de proveedores suspendidos/vetados (parte D).
--
-- CÓMO REVERTIR
--   DROP TRIGGER trg_cxp_proveedor_estado ON public.proveedores;
--   DROP FUNCTION public.cxp_tg_proveedor_estado();
--   DROP FUNCTION public.proveedor_habilitado(uuid);
--   DROP TABLE public.proveedor_documentos;
--   ALTER TABLE public.proveedores
--     DROP COLUMN estado, DROP COLUMN autorizado_por, DROP COLUMN autorizado_at,
--     DROP COLUMN autorizacion_vence, DROP COLUMN motivo_estado;
--
-- IMPACTO EN DATOS PRODUCTIVOS: sí — un UPDATE de una sola pasada sobre
-- `proveedores` para sembrar `estado`. No borra ni reescribe nada más.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Estado de autorización en proveedores ────────────────────────────────
-- borrador     recién dado de alta, sin revisar
-- en_revision  se está juntando/verificando la papelería
-- autorizado   se le puede comprar
-- suspendido   temporal (papelería vencida, incumplimiento en revisión)
-- vetado       permanente; no vuelve a autorizarse sin decisión explícita
ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS estado             text NOT NULL DEFAULT 'autorizado',
  ADD COLUMN IF NOT EXISTS autorizado_por     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS autorizado_at      timestamptz,
  ADD COLUMN IF NOT EXISTS autorizacion_vence date,
  ADD COLUMN IF NOT EXISTS motivo_estado      text;

-- Backfill ANTES del CHECK y del trigger: las filas existentes heredan su
-- realidad operativa actual, no un estado inventado.
UPDATE public.proveedores SET estado = 'suspendido' WHERE NOT activo AND estado = 'autorizado';
UPDATE public.proveedores SET autorizado_at = COALESCE(autorizado_at, created_at)
  WHERE estado = 'autorizado' AND autorizado_at IS NULL;

DO $$ BEGIN
  ALTER TABLE public.proveedores
    ADD CONSTRAINT proveedores_estado_check
    CHECK (estado IN ('borrador','en_revision','autorizado','suspendido','vetado'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Recién ahora el alta deja de autorizar sola.
ALTER TABLE public.proveedores ALTER COLUMN estado SET DEFAULT 'borrador';

CREATE INDEX IF NOT EXISTS idx_proveedores_estado
  ON public.proveedores(company_id, estado);
-- Parcial: la consulta que importa es "¿cuáles vencen pronto?", y los que no
-- tienen fecha de vencimiento son la mayoría.
CREATE INDEX IF NOT EXISTS idx_proveedores_vencimiento
  ON public.proveedores(company_id, autorizacion_vence)
  WHERE autorizacion_vence IS NOT NULL;

COMMENT ON COLUMN public.proveedores.estado IS
  'Ciclo de autorización: borrador → en_revision → autorizado → suspendido/vetado. Solo un proveedor autorizado y vigente recibe órdenes de compra.';
COMMENT ON COLUMN public.proveedores.autorizacion_vence IS
  'Fecha en que caduca la autorización (RTU/patente). NULL = no caduca. Vencida cuenta como NO habilitado sin necesidad de tocar el estado.';

-- ── 2. Papelería de respaldo ────────────────────────────────────────────────
-- Por EMPRESA, igual que `proveedores`: un proveedor sirve a todas las
-- contabilidades de la empresa (la suya y la de cada proyecto), así que su
-- papelería no puede colgar de un ledger.
CREATE TABLE IF NOT EXISTS public.proveedor_documentos (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  proveedor_id   uuid        NOT NULL REFERENCES public.proveedores(id) ON DELETE CASCADE,
  tipo           text        NOT NULL DEFAULT 'otro'
                   CHECK (tipo IN ('rtu','patente_comercio','patente_sociedad',
                                   'dpi_representante','constancia_iva',
                                   'referencia_bancaria','contrato','otro')),
  numero         text,
  archivo_url    text,
  emitido_el     date,
  vence_el       date,
  verificado_por uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  verificado_at  timestamptz,
  notas          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT proveedor_doc_vigencia CHECK (vence_el IS NULL OR emitido_el IS NULL OR vence_el >= emitido_el)
);

CREATE INDEX IF NOT EXISTS idx_proveedor_doc_proveedor
  ON public.proveedor_documentos(proveedor_id, tipo);
CREATE INDEX IF NOT EXISTS idx_proveedor_doc_vencimiento
  ON public.proveedor_documentos(company_id, vence_el)
  WHERE vence_el IS NOT NULL;

COMMENT ON TABLE public.proveedor_documentos IS
  'Papelería de respaldo del proveedor (RTU, patentes, constancias) con su vencimiento. Sostiene la autorización: sin documentos vigentes no debería autorizarse.';

-- ── 3. RLS ──────────────────────────────────────────────────────────────────
-- Mismo patrón que el resto del módulo contable desde 20260818000000: rol
-- legacy con acceso total O permiso RBAC platform.contabilidad.<accion>, vía
-- el helper conta_puede_escribir(). Sin esto el rol "Finanzas / Contador"
-- vería la tabla en solo-lectura, que es exactamente el bug que aquella
-- migración vino a arreglar.
ALTER TABLE public.proveedor_documentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proveedor_documentos_select" ON public.proveedor_documentos;
CREATE POLICY "proveedor_documentos_select" ON public.proveedor_documentos
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

DROP POLICY IF EXISTS "proveedor_documentos_insert" ON public.proveedor_documentos;
CREATE POLICY "proveedor_documentos_insert" ON public.proveedor_documentos
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin()
              OR (company_id = get_my_company_id() AND public.conta_puede_escribir('create')));

DROP POLICY IF EXISTS "proveedor_documentos_update" ON public.proveedor_documentos;
CREATE POLICY "proveedor_documentos_update" ON public.proveedor_documentos
  FOR UPDATE TO authenticated
  USING (is_super_admin()
         OR (company_id = get_my_company_id() AND public.conta_puede_escribir('edit')))
  WITH CHECK (is_super_admin()
              OR (company_id = get_my_company_id() AND public.conta_puede_escribir('edit')));

DROP POLICY IF EXISTS "proveedor_documentos_delete" ON public.proveedor_documentos;
CREATE POLICY "proveedor_documentos_delete" ON public.proveedor_documentos
  FOR DELETE TO authenticated
  USING (is_super_admin()
         OR (company_id = get_my_company_id() AND public.conta_puede_escribir('delete')));

-- ── 4. "¿Le puedo comprar HOY a este proveedor?" ────────────────────────────
-- Una sola definición de la regla, consultable desde la BD (triggers de la
-- orden de compra y de la factura) y desde la UI. Vencida la autorización, el
-- proveedor deja de estar habilitado SIN que nadie tenga que cambiarle el
-- estado a mano: es la diferencia entre un candado que se cierra solo y uno
-- que depende de que alguien se acuerde.
CREATE OR REPLACE FUNCTION public.proveedor_habilitado(p_proveedor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.proveedores
    WHERE id = p_proveedor_id
      AND estado = 'autorizado'
      AND (autorizacion_vence IS NULL OR autorizacion_vence >= CURRENT_DATE)
  )
$$;

COMMENT ON FUNCTION public.proveedor_habilitado(uuid) IS
  'true si el proveedor está autorizado y su autorización no ha caducado. Es la condición que exige la orden de compra para aprobarse/emitirse.';

GRANT EXECUTE ON FUNCTION public.proveedor_habilitado(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.proveedor_habilitado(uuid) FROM PUBLIC, anon;

-- ── 5. Sincronía estado ↔ activo y sello de la autorización ─────────────────
-- `activo` no se puede dejar a la deriva: lo leen ProveedoresTab, los
-- selectores de proveedor de CxP y el filtro de la lista. Se mantiene como
-- proyección de `estado` en AMBOS sentidos, porque la UI vieja todavía manda
-- `activo` (useToggleProveedorActivoMutation) y la nueva manda `estado`.
CREATE OR REPLACE FUNCTION public.cxp_tg_proveedor_estado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_estado_previo text := CASE WHEN TG_OP = 'UPDATE' THEN OLD.estado ELSE NULL END;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Quién manda cuando cambian los dos a la vez: `estado` es la fuente de
    -- verdad; `activo` solo se interpreta si `estado` no se tocó.
    IF NEW.estado IS DISTINCT FROM OLD.estado THEN
      NEW.activo := (NEW.estado = 'autorizado');
    ELSIF NEW.activo IS DISTINCT FROM OLD.activo THEN
      -- La UI vieja apagando/encendiendo el switch. Encender NO resucita a un
      -- vetado: eso exige pasar por el estado explícitamente.
      IF NEW.activo AND OLD.estado IN ('suspendido','borrador','en_revision') THEN
        NEW.estado := 'autorizado';
      ELSIF NOT NEW.activo AND OLD.estado = 'autorizado' THEN
        NEW.estado := 'suspendido';
      ELSE
        NEW.activo := OLD.activo;   -- vetado: el switch no lo mueve
      END IF;
    END IF;
  ELSE
    NEW.activo := (NEW.estado = 'autorizado');
  END IF;

  -- Autorizar es un acto de aprobación, no una edición cualquiera: exige el
  -- permiso de cambio de estado y queda sellado con autor y fecha.
  IF NEW.estado = 'autorizado' AND v_estado_previo IS DISTINCT FROM 'autorizado' THEN
    -- Escape del sistema (backfills y triggers internos), igual que
    -- cxp_proteger_factura / conta_proteger_asiento.
    IF COALESCE(current_setting('conta.allow_system_write', true), 'off') <> 'on'
       AND auth.uid() IS NOT NULL
       AND NOT public.conta_puede_escribir('change_status') THEN
      RAISE EXCEPTION 'COMPRAS_NO_AUTORIZADO: autorizar un proveedor requiere el permiso de cambio de estado en Contabilidad.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.autorizado_por := COALESCE(NEW.autorizado_por, auth.uid());
    NEW.autorizado_at  := COALESCE(NEW.autorizado_at, now());
  END IF;

  -- Salir de autorizado limpia el sello: si vuelve, se autoriza de nuevo y se
  -- vuelve a firmar. Un sello viejo sobre un proveedor suspendido miente.
  IF NEW.estado <> 'autorizado' AND v_estado_previo = 'autorizado' THEN
    NEW.autorizado_por := NULL;
    NEW.autorizado_at  := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cxp_tg_proveedor_estado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cxp_proveedor_estado ON public.proveedores;
CREATE TRIGGER trg_cxp_proveedor_estado
  BEFORE INSERT OR UPDATE ON public.proveedores
  FOR EACH ROW EXECUTE FUNCTION public.cxp_tg_proveedor_estado();

-- updated_at de la papelería, sin lógica extra.
CREATE OR REPLACE FUNCTION public.compras_tg_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_tg_touch_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_proveedor_documentos_touch ON public.proveedor_documentos;
CREATE TRIGGER trg_proveedor_documentos_touch
  BEFORE UPDATE ON public.proveedor_documentos
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_touch_updated_at();
