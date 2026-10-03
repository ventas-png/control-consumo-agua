-- ════════════════════════════════════════════════════════════════════════════
-- EVALUACIÓN DE PROVEEDORES LIGADA AL PROVEEDOR COMPARTIDO, AL CONTRATO Y A LA ORDEN
--
-- QUÉ HABÍA
--   `evaluaciones_proveedor.proveedor_id` apunta a un CONTRATO (el nombre engaña), el nombre
--   del proveedor es texto libre y el evaluador es un texto que el cliente escribe: se podía
--   evaluar a «alguien» sin vínculo con el catálogo, firmar la evaluación a nombre de otro, y
--   leerlas todas con solo compartir empresa (sin alcance por proyecto).
--
-- QUÉ HACE
--   1. Columnas: `proveedor_catalogo_id` (FK al catálogo compartido), `contrato_id` (el contrato
--      real; `proveedor_id` queda como espejo legado para quien aún lo lea), `orden_compra_id`,
--      criterios `cumplimiento` y `comunicacion` (además de puntualidad, calidad y precio) y
--      `evaluado_por_id` (quien evalúa, sellado por el servidor con auth.uid()).
--   2. Trigger de coherencia: la evaluación nueva exige un proveedor del catálogo (directo, o
--      por el contrato o la orden) de la MISMA empresa; contrato y orden deben ser de ese
--      proveedor, de la misma empresa y proyecto (y la orden, del contrato si ambos se indican).
--      El evaluador y el vínculo no se reescriben después.
--   3. RLS con alcance por proyecto (antes solo por empresa y permiso de la pestaña).
--   4. La vista `evaluaciones_por_proveedor` resuelve el proveedor del catálogo directo (o por el
--      contrato, para las evaluaciones antiguas) y marca las evaluaciones bajas (`negativa`).
--
-- UNA EVALUACIÓN NEGATIVA NO SUSPENDE A NADIE: no hay ningún efecto automático sobre
-- `proveedores.estado`. Suspender o retirar a un proveedor sigue siendo una decisión de quien
-- tiene el permiso de cambio de estado de Contabilidad, por la vía de siempre.
--
-- COMPATIBILIDAD: las evaluaciones antiguas no se tocan (columnas nuevas NULL; la vista las
-- resuelve por su contrato). Editar una evaluación antigua que aún no tiene proveedor del
-- catálogo permite vincularla.
-- CÓMO REVERTIR
--   restaurar la vista desde 20261020000100; DROP TRIGGER trg_evaluaciones_proveedor ON
--   public.evaluaciones_proveedor; DROP FUNCTION public.evaluaciones_proveedor_tg(); restaurar las
--   4 policies de 20260518000010; ALTER TABLE ... DROP COLUMN (las de la sección 1).
-- IMPACTO EN DATOS: ninguno sobre filas existentes. Las policies nuevas restringen la LECTURA por
-- proyecto: quien hoy lee evaluaciones de proyectos que no tiene asignados dejará de verlas.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Columnas ──────────────────────────────────────────────────────────────
ALTER TABLE public.evaluaciones_proveedor
  ADD COLUMN IF NOT EXISTS proveedor_catalogo_id uuid REFERENCES public.proveedores(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS contrato_id           uuid REFERENCES public.contratos_proveedores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS orden_compra_id       uuid REFERENCES public.ordenes_compra(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cumplimiento          integer CHECK (cumplimiento BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS comunicacion          integer CHECK (comunicacion BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS evaluado_por_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_eval_prov_catalogo ON public.evaluaciones_proveedor (proveedor_catalogo_id) WHERE proveedor_catalogo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_eval_prov_contrato ON public.evaluaciones_proveedor (contrato_id) WHERE contrato_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_eval_prov_orden    ON public.evaluaciones_proveedor (orden_compra_id) WHERE orden_compra_id IS NOT NULL;

COMMENT ON COLUMN public.evaluaciones_proveedor.proveedor_catalogo_id IS
  'Proveedor del catálogo compartido que se evalúa. Obligatorio en evaluaciones nuevas (directo, o por su contrato u orden).';
COMMENT ON COLUMN public.evaluaciones_proveedor.contrato_id IS
  'Contrato evaluado, si corresponde. proveedor_id queda como espejo legado del mismo valor.';
COMMENT ON COLUMN public.evaluaciones_proveedor.evaluado_por_id IS
  'Quien evalúa, sellado por el servidor con auth.uid(): no se firma a nombre de otro.';

-- ── 2. Coherencia y sellado ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.evaluaciones_proveedor_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sistema  boolean := COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on';
  v_contrato uuid;
  v_c        record;
  v_o        record;
  v_p        record;
  v_nombre   text;
BEGIN
  IF v_sistema THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.fecha IS DISTINCT FROM OLD.fecha
       OR NEW.evaluado_por_id IS DISTINCT FROM OLD.evaluado_por_id
       OR NEW.orden_compra_id IS DISTINCT FROM OLD.orden_compra_id
       OR (OLD.proveedor_catalogo_id IS NOT NULL AND NEW.proveedor_catalogo_id IS DISTINCT FROM OLD.proveedor_catalogo_id)
       OR (OLD.contrato_id IS NOT NULL AND NEW.contrato_id IS DISTINCT FROM OLD.contrato_id) THEN
      RAISE EXCEPTION 'EVALUACION_INMUTABLE: el proveedor, el contrato, la orden, el evaluador y la fecha de una evaluación no se cambian; corrige criterios y comentarios, o registra otra evaluación.'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Una evaluación antigua sin proveedor del catálogo solo puede VINCULARSE (se valida abajo).
    IF OLD.proveedor_catalogo_id IS NOT NULL AND OLD.contrato_id IS NOT DISTINCT FROM NEW.contrato_id THEN
      NEW.proveedor_id := COALESCE(NEW.contrato_id, OLD.proveedor_id);
      RETURN NEW;
    END IF;
  END IF;

  -- Contrato: el real es contrato_id; proveedor_id (legado) es su espejo.
  IF NEW.contrato_id IS NOT NULL AND NEW.proveedor_id IS NOT NULL AND NEW.contrato_id <> NEW.proveedor_id THEN
    RAISE EXCEPTION 'EVALUACION_CONTRATO_AMBIGUO: contrato_id y proveedor_id (legado) apuntan a contratos distintos.'
      USING ERRCODE = 'check_violation';
  END IF;
  v_contrato := COALESCE(NEW.contrato_id, NEW.proveedor_id);
  NEW.contrato_id := v_contrato;
  NEW.proveedor_id := v_contrato;

  IF v_contrato IS NOT NULL THEN
    SELECT c.company_id, c.project_id, c.proveedor_id INTO v_c
      FROM public.contratos_proveedores c WHERE c.id = v_contrato;
    IF NOT FOUND OR v_c.company_id <> NEW.company_id OR v_c.project_id <> NEW.project_id THEN
      RAISE EXCEPTION 'EVALUACION_CONTRATO_AJENO: el contrato no es de esta empresa y proyecto.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.proveedor_catalogo_id IS NULL THEN
      NEW.proveedor_catalogo_id := v_c.proveedor_id;
    ELSIF v_c.proveedor_id IS NOT NULL AND v_c.proveedor_id <> NEW.proveedor_catalogo_id THEN
      RAISE EXCEPTION 'EVALUACION_PROVEEDOR_CONTRATO: el contrato es de otro proveedor que el evaluado.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.orden_compra_id IS NOT NULL THEN
    SELECT o.company_id, o.project_id, o.proveedor_id, o.contrato_id INTO v_o
      FROM public.ordenes_compra o WHERE o.id = NEW.orden_compra_id;
    IF NOT FOUND OR v_o.company_id <> NEW.company_id OR v_o.project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'EVALUACION_ORDEN_AJENA: la orden no es de esta empresa y proyecto.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.proveedor_catalogo_id IS NULL THEN
      NEW.proveedor_catalogo_id := v_o.proveedor_id;
    ELSIF v_o.proveedor_id IS DISTINCT FROM NEW.proveedor_catalogo_id THEN
      RAISE EXCEPTION 'EVALUACION_PROVEEDOR_ORDEN: la orden es de otro proveedor que el evaluado.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_contrato IS NOT NULL AND v_o.contrato_id IS DISTINCT FROM v_contrato THEN
      RAISE EXCEPTION 'EVALUACION_ORDEN_CONTRATO: la orden no está amparada en ese contrato.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.proveedor_catalogo_id IS NULL THEN
    RAISE EXCEPTION 'EVALUACION_PROVEEDOR_REQUERIDO: la evaluación se hace sobre un proveedor del catálogo (elígelo, o evalúa a través de un contrato u orden vinculados a uno).'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT p.company_id, p.nombre INTO v_p FROM public.proveedores p WHERE p.id = NEW.proveedor_catalogo_id;
  IF NOT FOUND OR v_p.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'EVALUACION_PROVEEDOR_AJENO: el proveedor no pertenece a la empresa de la evaluación.'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.nombre_proveedor := COALESCE(NULLIF(btrim(COALESCE(NEW.nombre_proveedor, '')), ''), v_p.nombre);

  IF TG_OP = 'INSERT' THEN
    -- El evaluador lo pone el servidor: no se firma a nombre de otra persona.
    IF auth.uid() IS NOT NULL THEN
      NEW.evaluado_por_id := auth.uid();
    END IF;
    IF NEW.evaluado_por_id IS NOT NULL THEN
      SELECT u.full_name INTO v_nombre FROM public.app_users u WHERE u.id = NEW.evaluado_por_id;
      NEW.evaluado_por := COALESCE(NULLIF(btrim(v_nombre), ''), NULLIF(btrim(COALESCE(NEW.evaluado_por, '')), ''));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.evaluaciones_proveedor_tg() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_evaluaciones_proveedor ON public.evaluaciones_proveedor;
CREATE TRIGGER trg_evaluaciones_proveedor
  BEFORE INSERT OR UPDATE ON public.evaluaciones_proveedor
  FOR EACH ROW EXECUTE FUNCTION public.evaluaciones_proveedor_tg();

-- ── 3. RLS con alcance por proyecto ──────────────────────────────────────────
DROP POLICY IF EXISTS "evaluaciones_proveedor_select" ON public.evaluaciones_proveedor;
DROP POLICY IF EXISTS "evaluaciones_proveedor_insert" ON public.evaluaciones_proveedor;
DROP POLICY IF EXISTS "evaluaciones_proveedor_update" ON public.evaluaciones_proveedor;

CREATE POLICY "evaluaciones_proveedor_select" ON public.evaluaciones_proveedor
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND public.can_access_project(project_id)
             AND (SELECT public.user_has_permission('condominios.tab.eval_proveedor'))));
CREATE POLICY "evaluaciones_proveedor_insert" ON public.evaluaciones_proveedor
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_super_admin())
              OR (company_id = (SELECT public.get_my_company_id())
                  AND public.can_access_project(project_id)
                  AND (SELECT public.user_has_permission('condominios.tab.eval_proveedor'))));
CREATE POLICY "evaluaciones_proveedor_update" ON public.evaluaciones_proveedor
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND public.can_access_project(project_id)
             AND (SELECT public.user_has_permission('condominios.tab.eval_proveedor'))))
  WITH CHECK ((SELECT public.is_super_admin())
              OR (company_id = (SELECT public.get_my_company_id())
                  AND public.can_access_project(project_id)
                  AND (SELECT public.user_has_permission('condominios.tab.eval_proveedor'))));

-- ── 4. Vista: el proveedor del catálogo resuelto, directo o por el contrato ──
CREATE OR REPLACE VIEW public.evaluaciones_por_proveedor
WITH (security_invoker = true) AS
SELECT e.id,
       e.company_id,
       e.project_id,
       COALESCE(e.contrato_id, e.proveedor_id)                 AS contrato_id,
       COALESCE(e.proveedor_catalogo_id, c.proveedor_id)       AS proveedor_catalogo_id,
       e.nombre_proveedor,
       e.calificacion,
       e.puntualidad,
       e.calidad,
       e.precio,
       e.comentarios,
       e.evaluado_por,
       e.fecha,
       e.created_at,
       e.orden_compra_id,
       e.evaluado_por_id,
       e.cumplimiento,
       e.comunicacion,
       (e.calificacion <= 2)                                   AS negativa
  FROM public.evaluaciones_proveedor e
  LEFT JOIN public.contratos_proveedores c ON c.id = COALESCE(e.contrato_id, e.proveedor_id);

REVOKE ALL ON public.evaluaciones_por_proveedor FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.evaluaciones_por_proveedor TO authenticated, service_role;

COMMENT ON VIEW public.evaluaciones_por_proveedor IS
  'Evaluaciones con el proveedor del catálogo resuelto (directo o por el contrato) y su contrato/orden. negativa = calificación ≤ 2: solo señala; NO suspende a nadie (eso lo decide quien autoriza proveedores). security_invoker: aplica la RLS de quien consulta.';
