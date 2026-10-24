-- ============================================================================
-- Visitas frecuentes como PRE-AUTORIZACIÓN: el residente solicita, la
-- administración aprueba y el guardia valida día/horario al registrar
-- ============================================================================
-- PROBLEMA. `visitas_frecuentes` nació (fase 22) como una libreta que solo la
-- administración llenaba y que el guardia no consultaba: el registro de
-- ingreso en `visitantes` no sabía si la persona estaba pre-autorizada ni si
-- se presentaba en el día y la franja permitidos. La "autorización" era un
-- dato decorativo.
--
-- DISEÑO. Tres cambios, cada uno con su columna:
--
--   1. Quién pide y quién aprueba. El residente registra desde su portal a la
--      persona de confianza (empleada, familiar, proveedor) y la fila nace en
--      `estado = 'pendiente'`. La administración la aprueba o la rechaza
--      (`autorizado_por`, `autorizado_en`, `motivo_rechazo`). Lo que crea la
--      propia administración nace aprobado. `creado_por` (trigger
--      20260731000000) ya dice quién la tecleó, así que no hace falta una
--      columna "solicitado_por" aparte.
--
--   2. Vigencia. `vigente_desde` / `vigente_hasta` acotan la autorización en el
--      calendario (un contratista por tres meses) además de los días de la
--      semana y la franja horaria que ya existían.
--
--   3. Trazabilidad del ingreso. `visitantes.visita_frecuente_id` liga cada
--      entrada con la autorización que la amparó, y `autorizacion_ingreso`
--      deja escrito CÓMO entró: 'pre_autorizado' (cumplía día, horario y
--      vigencia) o 'residente' (no cumplía, o no tenía autorización, y el
--      residente dio el visto bueno en el momento). `autorizacion_detalle`
--      guarda el porqué en palabras (qué regla incumplía, quién autorizó y por
--      qué medio). Un ingreso DENEGADO no crea fila en `visitantes` (nunca
--      entró): queda en `novedades_seguridad` con tipo 'acceso'.
--
-- RLS. El residente ya veía las visitas frecuentes de su unidad
-- (20260602000050). Ahora además puede INSERTAR para su unidad, pero solo en
-- 'pendiente' y sin sello de aprobación: la aprobación es de la
-- administración (acción `vis_frecuentes.edit`, 20261104000000). Puede
-- también UPDATE sobre sus filas, pero el trigger `vf_residente_solo_activo`
-- limita ese UPDATE a `activo` (suspender/reactivar a su empleada): no puede
-- aprobarse a sí mismo ni cambiar horario sin pasar otra vez por la
-- administración.
--
-- REVERSIÓN.
--   DROP TRIGGER IF EXISTS trg_vf_residente_solo_activo ON public.visitas_frecuentes;
--   DROP FUNCTION IF EXISTS public.vf_residente_solo_activo();
--   -- Restaurar las policies de 20261104000000 (insert/update sin la rama de residente).
--   ALTER TABLE public.visitantes DROP COLUMN visita_frecuente_id, DROP COLUMN autorizacion_ingreso, DROP COLUMN autorizacion_detalle;
--   ALTER TABLE public.visitas_frecuentes DROP COLUMN estado, DROP COLUMN autorizado_por, DROP COLUMN autorizado_en,
--     DROP COLUMN motivo_rechazo, DROP COLUMN vigente_desde, DROP COLUMN vigente_hasta;
-- ============================================================================

-- ── 1. visitas_frecuentes: estado, aprobación y vigencia ─────────────────────
ALTER TABLE public.visitas_frecuentes
  ADD COLUMN IF NOT EXISTS estado         text        NOT NULL DEFAULT 'aprobada',
  ADD COLUMN IF NOT EXISTS autorizado_por uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS autorizado_en  timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_rechazo text,
  ADD COLUMN IF NOT EXISTS vigente_desde  date,
  ADD COLUMN IF NOT EXISTS vigente_hasta  date;

ALTER TABLE public.visitas_frecuentes
  DROP CONSTRAINT IF EXISTS visitas_frecuentes_estado_check,
  ADD  CONSTRAINT visitas_frecuentes_estado_check
    CHECK (estado IN ('pendiente', 'aprobada', 'rechazada'));

ALTER TABLE public.visitas_frecuentes
  DROP CONSTRAINT IF EXISTS visitas_frecuentes_vigencia_check,
  ADD  CONSTRAINT visitas_frecuentes_vigencia_check
    CHECK (vigente_desde IS NULL OR vigente_hasta IS NULL OR vigente_hasta >= vigente_desde);

-- Las filas existentes las creó la administración: quedan aprobadas por quien
-- las tecleó, con la fecha en que las creó. (`DEFAULT 'aprobada'` ya cubre el
-- estado; aquí solo se completa el sello.)
UPDATE public.visitas_frecuentes
   SET autorizado_por = COALESCE(autorizado_por, creado_por),
       autorizado_en  = COALESCE(autorizado_en, created_at)
 WHERE estado = 'aprobada';

-- La pestaña de administración lista primero lo pendiente; el guardia filtra
-- lo aprobado y activo por proyecto.
CREATE INDEX IF NOT EXISTS idx_vis_frec_project_estado
  ON public.visitas_frecuentes(project_id, estado) WHERE activo = true;

-- ── 2. visitantes: con qué autorización entró ────────────────────────────────
ALTER TABLE public.visitantes
  ADD COLUMN IF NOT EXISTS visita_frecuente_id  uuid REFERENCES public.visitas_frecuentes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS autorizacion_ingreso text,
  ADD COLUMN IF NOT EXISTS autorizacion_detalle text;

ALTER TABLE public.visitantes
  DROP CONSTRAINT IF EXISTS visitantes_autorizacion_ingreso_check,
  ADD  CONSTRAINT visitantes_autorizacion_ingreso_check
    CHECK (autorizacion_ingreso IS NULL OR autorizacion_ingreso IN ('pre_autorizado', 'residente'));

CREATE INDEX IF NOT EXISTS idx_visitantes_visita_frecuente
  ON public.visitantes(visita_frecuente_id) WHERE visita_frecuente_id IS NOT NULL;

-- ── 3. El residente solicita (pendiente) y solo puede suspender/reactivar ────
CREATE OR REPLACE FUNCTION public.vf_residente_solo_activo()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Administración (acción edit) y super admin: sin restricción.
  IF public.is_super_admin() OR public.condominios_puede_actuar('vis_frecuentes', 'edit') THEN
    RETURN NEW;
  END IF;
  -- Cualquier otro actor (el residente, por la rama de unidad de la policy)
  -- solo puede tocar `activo`. Comparar el resto de la fila como JSON evita
  -- enumerar columnas y se mantiene si se agregan más.
  IF (to_jsonb(NEW) - 'activo') IS DISTINCT FROM (to_jsonb(OLD) - 'activo') THEN
    RAISE EXCEPTION 'Solo la administración puede modificar una visita frecuente; el residente puede suspenderla o reactivarla.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.vf_residente_solo_activo() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_vf_residente_solo_activo ON public.visitas_frecuentes;
CREATE TRIGGER trg_vf_residente_solo_activo
  BEFORE UPDATE ON public.visitas_frecuentes
  FOR EACH ROW EXECUTE FUNCTION public.vf_residente_solo_activo();

-- INSERT: administración (acción create) o residente para su unidad, solo en
-- 'pendiente' y sin sello de aprobación.
DROP POLICY IF EXISTS visitas_frecuentes_insert ON public.visitas_frecuentes;
CREATE POLICY visitas_frecuentes_insert ON public.visitas_frecuentes
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('vis_frecuentes', 'create')) ))
    OR (
      unidad_id IN ( SELECT mis_unidades_ids() AS mis_unidades_ids )
      AND estado = 'pendiente'
      AND autorizado_por IS NULL
      AND autorizado_en IS NULL
    )
  );

-- UPDATE: administración (acción edit) o residente sobre su unidad (el
-- trigger de arriba lo acota a `activo`).
DROP POLICY IF EXISTS visitas_frecuentes_update ON public.visitas_frecuentes;
CREATE POLICY visitas_frecuentes_update ON public.visitas_frecuentes
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('vis_frecuentes', 'edit')) ))
    OR (unidad_id IN ( SELECT mis_unidades_ids() AS mis_unidades_ids ))
  )
  WITH CHECK (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND ( SELECT (public.condominios_puede_actuar('vis_frecuentes', 'edit')) ))
    OR (unidad_id IN ( SELECT mis_unidades_ids() AS mis_unidades_ids ))
  );

COMMENT ON COLUMN public.visitas_frecuentes.estado IS
  'pendiente = la solicitó el residente y la administración no la ha revisado · aprobada = el guardia puede dar ingreso pre-autorizado si cumple día/horario/vigencia · rechazada';
COMMENT ON COLUMN public.visitantes.autorizacion_ingreso IS
  'pre_autorizado = entró amparado por una visita frecuente aprobada y vigente · residente = el residente autorizó en el momento (sin autorización previa o fuera de lo autorizado) · NULL = registro común';
