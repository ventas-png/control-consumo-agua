-- ════════════════════════════════════════════════════════════════════════════
-- INSTALACIONES · LA «EMPRESA DE SERVICIO» SALE DEL CATÁLOGO DE PROVEEDORES
--
-- QUÉ FALTABA
-- Las pestañas de Instalaciones (cisternas, elevadores, jardinería, generador y
-- sistema contra incendios) capturaban la empresa de servicio como TEXTO LIBRE
-- (`empresa_servicio`, `proveedor`): cada persona la escribía a su manera y el
-- registro no sabía si esa empresa estaba suspendida, vetada o era de otra
-- empresa. Suministros y proformas ya resolvieron esto con el catálogo
-- compartido (20261021000400); aquí se extiende EL MISMO mecanismo, sin
-- duplicarlo.
--
-- QUÉ HACE
--   · `proveedor_id` (FK al catálogo, opcional: lo histórico no lo tiene) en
--     mantenimiento_cisterna, incidencias_elevador, mantenimiento_jardineria,
--     control_generador y control_sistema_incendio.
--   · El trigger `operaciones_tg_proveedor_catalogo()` ahora conoce la columna
--     de texto de cada tabla y valida igual que en suministros/proformas:
--     misma empresa, no suspendido/vetado, no suspendido/retirado en el
--     proyecto; y fotografía el nombre del catálogo en el texto. Un cambio
--     posterior del catálogo no reescribe lo ya guardado.
--   · `operaciones_sin_proveedor_vista_previa()` lista también los registros
--     históricos de estas tablas (identifica; NO une) y
--     `operaciones_vincular_proveedor()` acepta sus nombres de tabla: la
--     persona vincula uno a uno desde el panel de la pestaña.
--
-- CÓMO REVERTIR
--   Restaurar las tres funciones con la versión de 20261021000400.
--   DROP TRIGGER trg_cisterna_proveedor   ON public.mantenimiento_cisterna;
--   DROP TRIGGER trg_elevador_proveedor   ON public.incidencias_elevador;
--   DROP TRIGGER trg_jardineria_proveedor ON public.mantenimiento_jardineria;
--   DROP TRIGGER trg_generador_proveedor  ON public.control_generador;
--   DROP TRIGGER trg_incendio_proveedor   ON public.control_sistema_incendio;
--   ALTER TABLE public.mantenimiento_cisterna    DROP COLUMN proveedor_id;
--   ALTER TABLE public.incidencias_elevador      DROP COLUMN proveedor_id;
--   ALTER TABLE public.mantenimiento_jardineria  DROP COLUMN proveedor_id;
--   ALTER TABLE public.control_generador         DROP COLUMN proveedor_id;
--   ALTER TABLE public.control_sistema_incendio  DROP COLUMN proveedor_id;
-- IMPACTO EN DATOS: columnas nuevas NULL. Ninguna fila cambia. Quitar las
-- columnas BORRA los vínculos capturados después del despliegue (el texto se
-- conserva).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.mantenimiento_cisterna
  ADD COLUMN IF NOT EXISTS proveedor_id uuid REFERENCES public.proveedores(id) ON DELETE SET NULL;
ALTER TABLE public.incidencias_elevador
  ADD COLUMN IF NOT EXISTS proveedor_id uuid REFERENCES public.proveedores(id) ON DELETE SET NULL;
ALTER TABLE public.mantenimiento_jardineria
  ADD COLUMN IF NOT EXISTS proveedor_id uuid REFERENCES public.proveedores(id) ON DELETE SET NULL;
ALTER TABLE public.control_generador
  ADD COLUMN IF NOT EXISTS proveedor_id uuid REFERENCES public.proveedores(id) ON DELETE SET NULL;
ALTER TABLE public.control_sistema_incendio
  ADD COLUMN IF NOT EXISTS proveedor_id uuid REFERENCES public.proveedores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cisterna_proveedor   ON public.mantenimiento_cisterna   (proveedor_id) WHERE proveedor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_elevador_proveedor   ON public.incidencias_elevador     (proveedor_id) WHERE proveedor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jardineria_proveedor ON public.mantenimiento_jardineria (proveedor_id) WHERE proveedor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_generador_proveedor  ON public.control_generador        (proveedor_id) WHERE proveedor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_incendio_proveedor   ON public.control_sistema_incendio (proveedor_id) WHERE proveedor_id IS NOT NULL;

COMMENT ON COLUMN public.mantenimiento_cisterna.proveedor_id IS
  'Empresa de servicio del catálogo compartido. NULL = histórico (solo texto en `empresa_servicio`): ver operaciones_sin_proveedor_vista_previa().';
COMMENT ON COLUMN public.incidencias_elevador.proveedor_id IS
  'Empresa de servicio del catálogo compartido. NULL = histórico (solo texto en `empresa_servicio`).';
COMMENT ON COLUMN public.mantenimiento_jardineria.proveedor_id IS
  'Proveedor del catálogo compartido. NULL = histórico (solo texto en `proveedor`).';
COMMENT ON COLUMN public.control_generador.proveedor_id IS
  'Empresa de servicio del catálogo compartido. NULL = histórico (solo texto en `empresa_servicio`).';
COMMENT ON COLUMN public.control_sistema_incendio.proveedor_id IS
  'Empresa de servicio del catálogo compartido. NULL = histórico (solo texto en `empresa_servicio`).';

-- ── Validación del vínculo (misma función; ahora conoce cada tabla) ────────
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
    -- Fotografía del nombre (el texto histórico se conserva; este es el del
    -- catálogo hoy). plpgsql resuelve `NEW.<columna>` al ejecutar la rama, así
    -- que cada tabla solo toca la columna que sí tiene.
    IF TG_TABLE_NAME IN ('suministros_condominio', 'mantenimiento_jardineria') THEN
      NEW.proveedor := v_prov.nombre;
    ELSIF TG_TABLE_NAME = 'proformas_condominio' THEN
      NEW.proveedor_nombre := v_prov.nombre;
    ELSIF TG_TABLE_NAME IN ('mantenimiento_cisterna', 'incidencias_elevador', 'control_generador', 'control_sistema_incendio') THEN
      NEW.empresa_servicio := v_prov.nombre;
    ELSE
      RAISE EXCEPTION 'OPERACIONES_TABLA_INVALIDA: % no tiene columna de texto conocida para el proveedor.', TG_TABLE_NAME
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- (anidado a propósito: plpgsql no hace cortocircuito y `NEW.orden_compra_id`
  -- solo existe en proformas_condominio)
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

DROP TRIGGER IF EXISTS trg_cisterna_proveedor ON public.mantenimiento_cisterna;
CREATE TRIGGER trg_cisterna_proveedor
  BEFORE INSERT OR UPDATE ON public.mantenimiento_cisterna
  FOR EACH ROW EXECUTE FUNCTION public.operaciones_tg_proveedor_catalogo();

DROP TRIGGER IF EXISTS trg_elevador_proveedor ON public.incidencias_elevador;
CREATE TRIGGER trg_elevador_proveedor
  BEFORE INSERT OR UPDATE ON public.incidencias_elevador
  FOR EACH ROW EXECUTE FUNCTION public.operaciones_tg_proveedor_catalogo();

DROP TRIGGER IF EXISTS trg_jardineria_proveedor ON public.mantenimiento_jardineria;
CREATE TRIGGER trg_jardineria_proveedor
  BEFORE INSERT OR UPDATE ON public.mantenimiento_jardineria
  FOR EACH ROW EXECUTE FUNCTION public.operaciones_tg_proveedor_catalogo();

DROP TRIGGER IF EXISTS trg_generador_proveedor ON public.control_generador;
CREATE TRIGGER trg_generador_proveedor
  BEFORE INSERT OR UPDATE ON public.control_generador
  FOR EACH ROW EXECUTE FUNCTION public.operaciones_tg_proveedor_catalogo();

DROP TRIGGER IF EXISTS trg_incendio_proveedor ON public.control_sistema_incendio;
CREATE TRIGGER trg_incendio_proveedor
  BEFORE INSERT OR UPDATE ON public.control_sistema_incendio
  FOR EACH ROW EXECUTE FUNCTION public.operaciones_tg_proveedor_catalogo();

-- ── Históricos sin vínculo: identificar, no unir (ahora también Instalaciones) ──
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
    UNION ALL
    SELECT 'mantenimiento_cisterna', c.id, c.company_id, c.project_id, btrim(c.empresa_servicio)
      FROM public.mantenimiento_cisterna c
     WHERE c.proveedor_id IS NULL AND btrim(COALESCE(c.empresa_servicio, '')) <> ''
    UNION ALL
    SELECT 'incidencias_elevador', e.id, e.company_id, e.project_id, btrim(e.empresa_servicio)
      FROM public.incidencias_elevador e
     WHERE e.proveedor_id IS NULL AND btrim(COALESCE(e.empresa_servicio, '')) <> ''
    UNION ALL
    SELECT 'mantenimiento_jardineria', j.id, j.company_id, j.project_id, btrim(j.proveedor)
      FROM public.mantenimiento_jardineria j
     WHERE j.proveedor_id IS NULL AND btrim(COALESCE(j.proveedor, '')) <> ''
    UNION ALL
    SELECT 'control_generador', g.id, g.company_id, g.project_id, btrim(g.empresa_servicio)
      FROM public.control_generador g
     WHERE g.proveedor_id IS NULL AND btrim(COALESCE(g.empresa_servicio, '')) <> ''
    UNION ALL
    SELECT 'control_sistema_incendio', i.id, i.company_id, i.project_id, btrim(i.empresa_servicio)
      FROM public.control_sistema_incendio i
     WHERE i.proveedor_id IS NULL AND btrim(COALESCE(i.empresa_servicio, '')) <> ''
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
  ELSIF p_tabla = 'mantenimiento_cisterna' THEN
    UPDATE public.mantenimiento_cisterna SET proveedor_id = p_proveedor_id
     WHERE id = p_registro_id AND proveedor_id IS NULL;
  ELSIF p_tabla = 'incidencias_elevador' THEN
    UPDATE public.incidencias_elevador SET proveedor_id = p_proveedor_id
     WHERE id = p_registro_id AND proveedor_id IS NULL;
  ELSIF p_tabla = 'mantenimiento_jardineria' THEN
    UPDATE public.mantenimiento_jardineria SET proveedor_id = p_proveedor_id
     WHERE id = p_registro_id AND proveedor_id IS NULL;
  ELSIF p_tabla = 'control_generador' THEN
    UPDATE public.control_generador SET proveedor_id = p_proveedor_id
     WHERE id = p_registro_id AND proveedor_id IS NULL;
  ELSIF p_tabla = 'control_sistema_incendio' THEN
    UPDATE public.control_sistema_incendio SET proveedor_id = p_proveedor_id
     WHERE id = p_registro_id AND proveedor_id IS NULL;
  ELSE
    RAISE EXCEPTION 'OPERACIONES_TABLA_INVALIDA: tabla % no admite vínculo con el catálogo de proveedores.', p_tabla USING ERRCODE = '22023';
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
  'Vincula UN registro histórico (suministros, proformas o Instalaciones) al proveedor del catálogo por decisión de una persona. No sustituye un vínculo existente y respeta la RLS de quien llama.';
