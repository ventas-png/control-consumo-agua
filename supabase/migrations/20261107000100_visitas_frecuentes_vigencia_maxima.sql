-- ============================================================================
-- Visitas frecuentes: vigencia OBLIGATORIA, máximo 6 meses, y renovación
-- ============================================================================
-- POR QUÉ. En 20261107000000 la vigencia (`vigente_desde` / `vigente_hasta`)
-- era opcional: NULL = para siempre. Una pre-autorización perpetua es lo que
-- la operación no quiere —la empleada que dejó de trabajar en la casa hace un
-- año seguiría entrando sin que nadie le pregunte al residente—. Regla nueva:
--
--   · Toda autorización tiene rango de fechas, y el rango dura como máximo
--     6 meses (CHECK en la tabla, no sólo en el formulario).
--   · Pasada la fecha, la autorización está VENCIDA: portería ya no la toma
--     como pre-autorizada (lib/visitasFrecuentes la reporta como incumplida) y
--     hay que RENOVARLA. El residente pide la renovación desde su portal (la
--     fila vuelve a 'pendiente' con el rango nuevo y sin sello) y la
--     administración la aprueba otra vez; la administración también puede
--     renovar directo. `renovaciones` cuenta cuántas veces se renovó.
--
-- FILAS EXISTENTES. Las que no tenían vigencia quedan vigentes 6 meses a partir
-- de hoy (la fecha de la migración): no se corta a nadie de golpe, pero todas
-- pasan por una renovación dentro del plazo máximo.
--
-- DEFAULTS. `vigente_desde` = hoy y `vigente_hasta` = hoy + 6 meses, para que
-- un cliente desplegado antes que este front (que no manda el campo) siga
-- insertando con el máximo permitido en vez de fallar.
--
-- TRIGGER. `vf_residente_solo_activo` (20261107000000) acotaba el UPDATE del
-- residente a `activo`. Ahora, SOLO si la fila está vencida, le permite además
-- pedir la renovación: rango nuevo, `estado` → 'pendiente', sello en NULL,
-- `renovaciones` + 1. Cualquier otro cambio sigue siendo de la administración.
--
-- REVERSIÓN.
--   ALTER TABLE public.visitas_frecuentes
--     DROP CONSTRAINT IF EXISTS visitas_frecuentes_vigencia_check,
--     ADD  CONSTRAINT visitas_frecuentes_vigencia_check
--       CHECK (vigente_desde IS NULL OR vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
--     ALTER COLUMN vigente_desde DROP NOT NULL, ALTER COLUMN vigente_desde DROP DEFAULT,
--     ALTER COLUMN vigente_hasta DROP NOT NULL, ALTER COLUMN vigente_hasta DROP DEFAULT,
--     DROP COLUMN renovaciones;
--   -- y restaurar la versión anterior de vf_residente_solo_activo().
-- ============================================================================

ALTER TABLE public.visitas_frecuentes
  ADD COLUMN IF NOT EXISTS renovaciones integer NOT NULL DEFAULT 0;

-- Backfill: sin vigencia → 6 meses desde hoy. Si sólo falta un extremo, se
-- completa desde el otro respetando el máximo.
UPDATE public.visitas_frecuentes
   SET vigente_desde = COALESCE(vigente_desde, LEAST(current_date, COALESCE(vigente_hasta, current_date))),
       vigente_hasta = COALESCE(vigente_hasta, LEAST((COALESCE(vigente_desde, current_date) + interval '6 months')::date, (current_date + interval '6 months')::date))
 WHERE vigente_desde IS NULL OR vigente_hasta IS NULL;

-- Rangos preexistentes más largos que el máximo se recortan al máximo.
UPDATE public.visitas_frecuentes
   SET vigente_hasta = (vigente_desde + interval '6 months')::date
 WHERE vigente_hasta > (vigente_desde + interval '6 months')::date;

ALTER TABLE public.visitas_frecuentes
  ALTER COLUMN vigente_desde SET DEFAULT current_date,
  ALTER COLUMN vigente_desde SET NOT NULL,
  ALTER COLUMN vigente_hasta SET DEFAULT (current_date + interval '6 months')::date,
  ALTER COLUMN vigente_hasta SET NOT NULL;

ALTER TABLE public.visitas_frecuentes
  DROP CONSTRAINT IF EXISTS visitas_frecuentes_vigencia_check,
  ADD  CONSTRAINT visitas_frecuentes_vigencia_check
    CHECK (vigente_hasta >= vigente_desde AND vigente_hasta <= (vigente_desde + interval '6 months')::date);

-- Portería lista lo aprobado y vigente del proyecto; la administración, lo que
-- está por vencer.
CREATE INDEX IF NOT EXISTS idx_vis_frec_project_vigencia
  ON public.visitas_frecuentes(project_id, vigente_hasta) WHERE activo = true;

CREATE OR REPLACE FUNCTION public.vf_residente_solo_activo()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_resto_old jsonb;
  v_resto_new jsonb;
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

  -- Y si la autorización está VENCIDA, puede pedir la renovación: rango nuevo,
  -- vuelve a 'pendiente', sin sello de aprobación, y cuenta la renovación.
  IF OLD.vigente_hasta < current_date THEN
    v_resto_old := v_resto_old - 'vigente_desde' - 'vigente_hasta' - 'estado' - 'autorizado_por' - 'autorizado_en' - 'motivo_rechazo' - 'renovaciones';
    v_resto_new := v_resto_new - 'vigente_desde' - 'vigente_hasta' - 'estado' - 'autorizado_por' - 'autorizado_en' - 'motivo_rechazo' - 'renovaciones';
    IF v_resto_new IS NOT DISTINCT FROM v_resto_old
       AND NEW.estado = 'pendiente'
       AND NEW.autorizado_por IS NULL
       AND NEW.autorizado_en IS NULL
       AND NEW.vigente_hasta >= current_date
       AND NEW.renovaciones = OLD.renovaciones + 1 THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'La autorización está vencida: el residente sólo puede solicitar su renovación (rango nuevo, pendiente de aprobación).'
      USING ERRCODE = '42501';
  END IF;

  RAISE EXCEPTION 'Solo la administración puede modificar una visita frecuente; el residente puede suspenderla, reactivarla o, si venció, solicitar su renovación.'
    USING ERRCODE = '42501';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.vf_residente_solo_activo() FROM PUBLIC, anon;

COMMENT ON COLUMN public.visitas_frecuentes.vigente_hasta IS
  'Último día de la autorización (obligatorio; a lo sumo 6 meses después de vigente_desde). Pasada la fecha, portería no la toma como pre-autorizada y hay que renovarla.';
COMMENT ON COLUMN public.visitas_frecuentes.renovaciones IS
  'Cuántas veces se renovó la vigencia (cada renovación vuelve a pasar por aprobación de la administración salvo que la haga la propia administración).';
