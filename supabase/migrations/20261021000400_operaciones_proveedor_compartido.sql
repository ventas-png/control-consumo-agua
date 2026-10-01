-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · BLOQUE B · SUMINISTROS Y PROFORMAS USAN EL CATÁLOGO COMPARTIDO
--
-- QUÉ FALTABA
-- Después del #907 los contratos y las órdenes apuntan al proveedor del catálogo
-- por id, pero `suministros_condominio.proveedor` y
-- `proformas_condominio.proveedor_nombre` seguían siendo TEXTO LIBRE (alimentado
-- desde la lista de contratos): cada módulo escribía el proveedor a su manera y
-- ninguno sabía si estaba suspendido o era de otra empresa. Además una proforma
-- aprobada se «convertía» en orden solo como un estado, sin enlace.
--
-- QUÉ HACE
--   · `proveedor_id` (FK al catálogo, opcional: lo histórico no lo tiene) en
--     suministros y proformas, y `proformas_condominio.orden_compra_id`.
--   · Un trigger valida el vínculo NUEVO o cambiado: proveedor de la misma
--     empresa, no suspendido/vetado y no suspendido/retirado en ese proyecto.
--     Fotografía el nombre del catálogo en el texto existente (se conserva para
--     el historial y las pantallas viejas). Un cambio posterior en el catálogo no
--     reescribe el texto de un registro ya guardado.
--   · Los registros ANTIGUOS sin vínculo quedan IDENTIFICADOS:
--     `operaciones_sin_proveedor_vista_previa()` los clasifica (inequívoca /
--     ambigua / sin coincidencia por nombre normalizado) y
--     `operaciones_vincular_proveedor()` los vincula UNO A UNO por decisión de una
--     persona. Nada se une solo, ni por parecido de nombre.
--   · La proforma convertida apunta a su orden, y esa orden debe ser del mismo
--     proveedor, empresa y proyecto.
--
-- Las dos RPC son SECURITY INVOKER: corren con la RLS de quien llama (solo ve y
-- cambia lo que ya podía) y los triggers validan igual.
--
-- CÓMO REVERTIR
--   DROP FUNCTION public.operaciones_vincular_proveedor(text, uuid, uuid);
--   DROP FUNCTION public.operaciones_sin_proveedor_vista_previa();
--   DROP TRIGGER trg_suministros_proveedor ON public.suministros_condominio;
--   DROP TRIGGER trg_proformas_proveedor ON public.proformas_condominio;
--   DROP FUNCTION public.operaciones_tg_proveedor_catalogo();
--   ALTER TABLE public.suministros_condominio DROP COLUMN proveedor_id;
--   ALTER TABLE public.proformas_condominio DROP COLUMN proveedor_id, DROP COLUMN orden_compra_id;
-- IMPACTO EN DATOS: columnas nuevas NULL. Ninguna fila cambia.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.suministros_condominio
  ADD COLUMN IF NOT EXISTS proveedor_id uuid REFERENCES public.proveedores(id) ON DELETE SET NULL;
ALTER TABLE public.proformas_condominio
  ADD COLUMN IF NOT EXISTS proveedor_id    uuid REFERENCES public.proveedores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS orden_compra_id uuid REFERENCES public.ordenes_compra(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_suministros_proveedor ON public.suministros_condominio (proveedor_id) WHERE proveedor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proformas_proveedor   ON public.proformas_condominio  (proveedor_id) WHERE proveedor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proformas_orden       ON public.proformas_condominio  (orden_compra_id) WHERE orden_compra_id IS NOT NULL;

COMMENT ON COLUMN public.suministros_condominio.proveedor_id IS
  'Proveedor del catálogo compartido. NULL = histórico (solo texto en `proveedor`): ver operaciones_sin_proveedor_vista_previa().';
COMMENT ON COLUMN public.proformas_condominio.proveedor_id IS
  'Proveedor del catálogo compartido. NULL = histórico (solo texto en `proveedor_nombre`).';
COMMENT ON COLUMN public.proformas_condominio.orden_compra_id IS
  'Orden de compra a la que se convirtió la proforma (mismo proveedor, empresa y proyecto).';

-- ── Validación del vínculo ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.operaciones_tg_proveedor_catalogo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prov record;
  v_pp   text;
  v_oc   record;
BEGIN
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.proveedor_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.proveedor_id IS DISTINCT FROM OLD.proveedor_id) THEN
    SELECT p.company_id, p.nombre, p.estado INTO v_prov FROM public.proveedores p WHERE p.id = NEW.proveedor_id;
    IF NOT FOUND OR v_prov.company_id <> NEW.company_id THEN
      RAISE EXCEPTION 'OPERACIONES_PROVEEDOR_AJENO: el proveedor no pertenece a la empresa del registro.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_prov.estado IN ('suspendido', 'vetado') THEN
      RAISE EXCEPTION 'OPERACIONES_PROVEEDOR_NO_DISPONIBLE: "%" está %; no se le registran operaciones nuevas.', v_prov.nombre, v_prov.estado
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT pp.estado INTO v_pp FROM public.proveedor_proyectos pp
     WHERE pp.proveedor_id = NEW.proveedor_id AND pp.project_id = NEW.project_id;
    IF v_pp IN ('suspendido', 'retirado') THEN
      RAISE EXCEPTION 'OPERACIONES_PROVEEDOR_NO_DISPONIBLE: "%" está % en este proyecto; no se le registran operaciones nuevas.', v_prov.nombre, v_pp
        USING ERRCODE = 'check_violation';
    END IF;
    -- Fotografía del nombre (el texto histórico se conserva; este es el del catálogo hoy).
    IF TG_TABLE_NAME = 'suministros_condominio' THEN
      NEW.proveedor := v_prov.nombre;
    ELSE
      NEW.proveedor_nombre := v_prov.nombre;
    END IF;
  END IF;

  -- (anidado a propósito: plpgsql no hace cortocircuito y `NEW.orden_compra_id`
  -- no existe en suministros_condominio)
  IF TG_TABLE_NAME = 'proformas_condominio' THEN
    IF NEW.orden_compra_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.orden_compra_id IS DISTINCT FROM OLD.orden_compra_id) THEN
      SELECT o.company_id, o.project_id, o.proveedor_id INTO v_oc
        FROM public.ordenes_compra o WHERE o.id = NEW.orden_compra_id;
      IF NOT FOUND OR v_oc.company_id <> NEW.company_id OR v_oc.project_id IS DISTINCT FROM NEW.project_id THEN
        RAISE EXCEPTION 'OPERACIONES_PROFORMA_ORDEN: la orden no es de la misma empresa y proyecto de la proforma.'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.proveedor_id IS NULL OR v_oc.proveedor_id IS DISTINCT FROM NEW.proveedor_id THEN
        RAISE EXCEPTION 'OPERACIONES_PROFORMA_ORDEN: la orden es de otro proveedor (o la proforma no tiene proveedor del catálogo).'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.operaciones_tg_proveedor_catalogo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_suministros_proveedor ON public.suministros_condominio;
CREATE TRIGGER trg_suministros_proveedor
  BEFORE INSERT OR UPDATE ON public.suministros_condominio
  FOR EACH ROW EXECUTE FUNCTION public.operaciones_tg_proveedor_catalogo();

DROP TRIGGER IF EXISTS trg_proformas_proveedor ON public.proformas_condominio;
CREATE TRIGGER trg_proformas_proveedor
  BEFORE INSERT OR UPDATE ON public.proformas_condominio
  FOR EACH ROW EXECUTE FUNCTION public.operaciones_tg_proveedor_catalogo();

-- ── Históricos sin vínculo: identificar, no unir ────────────────────────────
CREATE OR REPLACE FUNCTION public.operaciones_sin_proveedor_vista_previa()
RETURNS TABLE (
  tabla          text,
  registro_id    uuid,
  project_id     uuid,
  texto          text,
  clasificacion  text,
  candidatos     jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH fuentes AS (
    SELECT 'suministros_condominio'::text AS tabla, s.id AS registro_id, s.company_id, s.project_id, btrim(s.proveedor) AS texto
      FROM public.suministros_condominio s
     WHERE s.proveedor_id IS NULL AND btrim(COALESCE(s.proveedor, '')) <> ''
    UNION ALL
    SELECT 'proformas_condominio', f.id, f.company_id, f.project_id, btrim(f.proveedor_nombre)
      FROM public.proformas_condominio f
     WHERE f.proveedor_id IS NULL AND btrim(COALESCE(f.proveedor_nombre, '')) <> ''
  ), cand AS (
    SELECT fu.tabla, fu.registro_id,
           jsonb_agg(jsonb_build_object('id', p.id, 'codigo', p.codigo, 'nombre', p.nombre, 'estado', p.estado)
                     ORDER BY p.nombre) AS candidatos,
           count(*) AS n
      FROM fuentes fu
      JOIN public.proveedores p
        ON p.company_id = fu.company_id
       AND public.proveedor_normalizar_nombre(p.nombre) = public.proveedor_normalizar_nombre(fu.texto)
     GROUP BY fu.tabla, fu.registro_id
  )
  SELECT fu.tabla, fu.registro_id, fu.project_id, fu.texto,
         CASE WHEN c.n = 1 THEN 'inequivoca' WHEN c.n > 1 THEN 'ambigua' ELSE 'sin_coincidencia' END,
         COALESCE(c.candidatos, '[]'::jsonb)
    FROM fuentes fu
    LEFT JOIN cand c ON c.tabla = fu.tabla AND c.registro_id = fu.registro_id
   ORDER BY fu.tabla, fu.texto, fu.registro_id
$$;
REVOKE EXECUTE ON FUNCTION public.operaciones_sin_proveedor_vista_previa() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.operaciones_sin_proveedor_vista_previa() TO authenticated;

CREATE OR REPLACE FUNCTION public.operaciones_vincular_proveedor(
  p_tabla text, p_registro_id uuid, p_proveedor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n int;
BEGIN
  IF p_tabla = 'suministros_condominio' THEN
    UPDATE public.suministros_condominio SET proveedor_id = p_proveedor_id
     WHERE id = p_registro_id AND proveedor_id IS NULL;
  ELSIF p_tabla = 'proformas_condominio' THEN
    UPDATE public.proformas_condominio SET proveedor_id = p_proveedor_id
     WHERE id = p_registro_id AND proveedor_id IS NULL;
  ELSE
    RAISE EXCEPTION 'OPERACIONES_TABLA_INVALIDA: solo suministros_condominio o proformas_condominio.' USING ERRCODE = '22023';
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'OPERACIONES_VINCULO_NO_APLICA: el registro no existe, no es visible para ti o ya tiene proveedor del catálogo.'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.operaciones_vincular_proveedor(text, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.operaciones_vincular_proveedor(text, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.operaciones_vincular_proveedor(text, uuid, uuid) IS
  'Vincula UN registro histórico al proveedor del catálogo por decisión de una persona. No sustituye un vínculo existente y respeta la RLS de quien llama.';
