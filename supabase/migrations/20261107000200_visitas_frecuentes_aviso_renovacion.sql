-- ============================================================================
-- Visitas frecuentes: aviso de renovación configurable por condominio y la
-- solicitud de renovación como dato aparte (sin tumbar la autorización vigente)
-- ============================================================================
-- POR QUÉ. Con 20261107000100 la autorización vence a los 6 meses, pero el
-- residente se enteraba el día que la empleada ya no pudo entrar. Hace falta
-- avisarle ANTES —con una anticipación que decide cada condominio— y dejarle
-- pedir la renovación desde ese aviso.
--
-- Y la renovación anticipada no puede hacerse como en 20261107000100 (la fila
-- volvía a 'pendiente'): una autorización todavía vigente dejaría de servir en
-- portería en el momento de pedirla, hasta que la administración la aprobara.
-- Por eso la solicitud va en columnas propias y la autorización actual sigue
-- intacta hasta su fecha:
--
--   projects.visitas_frecuentes_dias_aviso   días antes del vencimiento en que
--                                            el portal avisa y permite pedir la
--                                            renovación (1..90, por defecto 30)
--   visitas_frecuentes.renovacion_solicitada_hasta  fecha nueva que pide el
--                                            residente (NULL = nada pendiente)
--   visitas_frecuentes.renovacion_solicitada_en     cuándo la pidió
--
-- La administración aprueba la renovación (rango nuevo desde hoy hasta la
-- fecha pedida, sello nuevo, renovaciones + 1, solicitud en NULL) o la rechaza
-- (solicitud en NULL). Si la autorización ya venció, el guardia la sigue viendo
-- vencida hasta que se apruebe: no hay atajo.
--
-- TRIGGER. `vf_residente_solo_activo` se reescribe: el residente puede tocar
-- `activo` siempre, y las dos columnas de solicitud sólo dentro de la ventana
-- de aviso del condominio (o ya vencida), con una fecha de hoy a hoy + 6 meses
-- (o NULL para retirar la solicitud). Deja de poder cambiar estado/vigencia:
-- eso es de la administración.
--
-- REVERSIÓN.
--   ALTER TABLE public.visitas_frecuentes DROP COLUMN renovacion_solicitada_hasta, DROP COLUMN renovacion_solicitada_en;
--   ALTER TABLE public.projects DROP COLUMN visitas_frecuentes_dias_aviso;
--   -- y restaurar la versión de vf_residente_solo_activo() de 20261107000100.
-- ============================================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS visitas_frecuentes_dias_aviso integer NOT NULL DEFAULT 30;
ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_visitas_frecuentes_dias_aviso_check,
  ADD  CONSTRAINT projects_visitas_frecuentes_dias_aviso_check
    CHECK (visitas_frecuentes_dias_aviso BETWEEN 1 AND 90);
COMMENT ON COLUMN public.projects.visitas_frecuentes_dias_aviso IS
  'Días antes de que venza una visita frecuente en que el portal avisa al residente y le deja pedir la renovación (1..90).';

ALTER TABLE public.visitas_frecuentes
  ADD COLUMN IF NOT EXISTS renovacion_solicitada_hasta date,
  ADD COLUMN IF NOT EXISTS renovacion_solicitada_en    timestamptz;
ALTER TABLE public.visitas_frecuentes
  DROP CONSTRAINT IF EXISTS visitas_frecuentes_renovacion_check,
  ADD  CONSTRAINT visitas_frecuentes_renovacion_check
    CHECK ((renovacion_solicitada_hasta IS NULL) = (renovacion_solicitada_en IS NULL));
COMMENT ON COLUMN public.visitas_frecuentes.renovacion_solicitada_hasta IS
  'Fecha de fin que el residente pide para la renovación; NULL = sin solicitud pendiente. La aprueba la administración.';

-- Las renovaciones que 20261107000100 dejó como 'pendiente' con renovaciones > 0
-- se convierten al modelo nuevo: la solicitud queda registrada y la fila vuelve
-- al estado que tenía (aprobada; vencida si pasó la fecha, que es lo que era).
UPDATE public.visitas_frecuentes
   SET renovacion_solicitada_hasta = vigente_hasta,
       renovacion_solicitada_en    = now(),
       estado                      = 'aprobada',
       renovaciones                = renovaciones - 1
 WHERE estado = 'pendiente' AND renovaciones > 0 AND autorizado_por IS NULL
   AND renovacion_solicitada_hasta IS NULL;

CREATE OR REPLACE FUNCTION public.vf_residente_solo_activo()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_resto_old jsonb;
  v_resto_new jsonb;
  v_dias      integer;
BEGIN
  -- Administración (acción edit) y super admin: sin restricción.
  IF public.is_super_admin() OR public.condominios_puede_actuar('vis_frecuentes', 'edit') THEN
    RETURN NEW;
  END IF;

  -- Cualquier otro actor (el residente, por la rama de unidad de la policy)
  -- siempre puede suspender/reactivar.
  v_resto_old := to_jsonb(OLD) - 'activo';
  v_resto_new := to_jsonb(NEW) - 'activo';
  IF v_resto_new IS NOT DISTINCT FROM v_resto_old THEN
    RETURN NEW;
  END IF;

  -- Y puede pedir (o retirar) la renovación dentro de la ventana de aviso del
  -- condominio, o ya vencida. La autorización vigente no se toca: la
  -- administración la renueva al aprobar.
  SELECT p.visitas_frecuentes_dias_aviso INTO v_dias FROM public.projects p WHERE p.id = OLD.project_id;
  v_resto_old := v_resto_old - 'renovacion_solicitada_hasta' - 'renovacion_solicitada_en';
  v_resto_new := v_resto_new - 'renovacion_solicitada_hasta' - 'renovacion_solicitada_en';
  IF v_resto_new IS NOT DISTINCT FROM v_resto_old THEN
    IF OLD.vigente_hasta > current_date + COALESCE(v_dias, 30) THEN
      RAISE EXCEPTION 'La autorización aún no entra en el plazo de renovación (vence el %; se puede pedir desde % días antes).', OLD.vigente_hasta, COALESCE(v_dias, 30)
        USING ERRCODE = '42501';
    END IF;
    IF NEW.renovacion_solicitada_hasta IS NOT NULL
       AND (NEW.renovacion_solicitada_hasta < current_date
            OR NEW.renovacion_solicitada_hasta > (current_date + interval '6 months')::date) THEN
      RAISE EXCEPTION 'La renovación va de hoy a como máximo 6 meses (hasta %).', (current_date + interval '6 months')::date
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Solo la administración puede modificar una visita frecuente; el residente puede suspenderla, reactivarla o pedir su renovación cuando está por vencer.'
    USING ERRCODE = '42501';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.vf_residente_solo_activo() FROM PUBLIC, anon;
