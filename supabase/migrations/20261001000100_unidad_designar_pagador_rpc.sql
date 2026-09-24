-- ============================================================================
-- PAGADOR DESIGNADO · cambio atómico por RPC (corrige 20261001000000)
--
-- EL DEFECTO. La primera entrega cambiaba el pagador de una unidad desde el
-- cliente con DOS peticiones: una quitaba la marca al pagador actual y otra se
-- la ponía al nuevo. Eran dos transacciones:
--   · si la segunda fallaba (red, RLS, residente inactivo), la unidad quedaba
--     SIN pagador y el anterior se perdía;
--   · entre una y otra, cualquier cuota o cargo emitido quedaba
--     «sin_candidato», porque la emisión veía confirmado el estado intermedio;
--   · dos personas cambiando el pagador de la misma unidad a la vez podían
--     chocar con el índice único y dejar un error a medias.
--   Además, un UPDATE filtrado por RLS devolvía «éxito» con cero filas.
--
-- LA CORRECCIÓN. `unidad_designar_pagador(unidad, residente|NULL)`:
--   1. Valida ANTES de modificar nada: usuario autenticado, unidad visible y de
--      la empresa activa, residente de ESA unidad, de la misma empresa y
--      proyecto, y activo.
--   2. Serializa por unidad con un candado transaccional (pg_advisory_xact_lock):
--      dos cambios sobre la misma unidad se ejecutan uno detrás de otro, y el
--      segundo relee el estado ya confirmado por el primero.
--   3. Quita la marca actual y pone la nueva en UNA transacción. Si cualquier
--      paso falla, se revierte todo y el pagador anterior queda intacto.
--   4. Comprueba cuántas filas afectó cada paso: si RLS filtró alguna, aborta
--      con PAGADOR_SIN_PERMISO en lugar de dar un éxito falso.
--
-- La emisión concurrente de cargos no puede ver el estado intermedio: los dos
-- UPDATE ocurren dentro de la misma transacción y nadie más la ve hasta el
-- COMMIT. Una cuota emitida mientras tanto ve el pagador anterior; una emitida
-- después, el nuevo. Lo prueba supabase/tests/conta_pagador_designado con
-- sesiones reales simultáneas.
--
-- SEGURIDAD. SECURITY INVOKER: la función NO amplía el acceso. Quien puede
-- modificar `unidad_residentes` lo sigue decidiendo la RLS de esa tabla
-- (staff del proyecto: owner, admin u operador con asignación). La función
-- sólo añade validaciones y atomicidad. Se revoca a PUBLIC/anon.
--
-- NO SE TOCA: la migración 20261001000000 (ya aplicada), sus tablas, triggers
-- ni la resolución del responsable al emitir. El índice único
-- uq_unidad_residentes_responsable_pago sigue siendo la garantía final de
-- «un pagador por unidad».
--
-- CÓMO SE REVIERTE:
--   DROP FUNCTION public.unidad_designar_pagador(uuid, uuid);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.unidad_designar_pagador(
  p_unidad_id    uuid,
  p_residente_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company   uuid;
  v_project   uuid;
  r           record;
  v_actuales  int;
  v_n         int;
BEGIN
  -- ── 1 · validaciones, sin modificar nada ─────────────────────────────────
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'PAGADOR_NO_AUTENTICADO: se requiere una sesión de usuario.'
      USING ERRCODE = '42501';
  END IF;
  IF p_unidad_id IS NULL THEN
    RAISE EXCEPTION 'PAGADOR_UNIDAD_REQUERIDA: falta la unidad.';
  END IF;

  -- La RLS de `unidades` decide si el usuario la ve: invisible = inexistente.
  SELECT u.company_id, u.project_id INTO v_company, v_project
    FROM public.unidades u
   WHERE u.id = p_unidad_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAGADOR_UNIDAD_NO_ENCONTRADA: la unidad no existe o no tienes acceso.';
  END IF;
  IF v_company IS DISTINCT FROM (SELECT public.get_my_company_id())
     AND NOT (SELECT public.is_super_admin()) THEN
    RAISE EXCEPTION 'PAGADOR_UNIDAD_AJENA: la unidad no pertenece a la empresa activa.'
      USING ERRCODE = '42501';
  END IF;

  -- ── 2 · serializar por unidad ────────────────────────────────────────────
  -- Todo lo que sigue se lee DESPUÉS de obtener el candado: en READ COMMITTED
  -- cada sentencia toma una instantánea nueva, así que el segundo de dos
  -- cambios simultáneos ve lo que confirmó el primero.
  PERFORM pg_advisory_xact_lock(hashtext('unidad_designar_pagador'), hashtext(p_unidad_id::text));

  IF p_residente_id IS NOT NULL THEN
    SELECT ur.unidad_id, ur.company_id, ur.project_id, ur.activo, ur.responsable_pago
      INTO r
      FROM public.unidad_residentes ur
     WHERE ur.id = p_residente_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PAGADOR_RESIDENTE_NO_ENCONTRADO: el residente no existe o no tienes acceso.';
    END IF;
    IF r.unidad_id <> p_unidad_id THEN
      RAISE EXCEPTION 'PAGADOR_RESIDENTE_DE_OTRA_UNIDAD: el residente pertenece a otra unidad.';
    END IF;
    IF r.company_id <> v_company OR r.project_id <> v_project THEN
      RAISE EXCEPTION 'PAGADOR_RESIDENTE_AJENO: el residente no es de la empresa o proyecto de la unidad.';
    END IF;
    IF NOT r.activo THEN
      RAISE EXCEPTION 'PAGADOR_RESIDENTE_INACTIVO: sólo un residente activo puede ser pagador.';
    END IF;
    IF r.responsable_pago THEN
      RETURN p_residente_id;            -- ya es el pagador: nada que cambiar
    END IF;
  END IF;

  -- ── 3 · cambio atómico, contando filas ───────────────────────────────────
  SELECT count(*) INTO v_actuales
    FROM public.unidad_residentes ur
   WHERE ur.unidad_id = p_unidad_id AND ur.responsable_pago;

  UPDATE public.unidad_residentes
     SET responsable_pago = false, updated_at = now()
   WHERE unidad_id = p_unidad_id AND responsable_pago;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_actuales THEN
    RAISE EXCEPTION 'PAGADOR_SIN_PERMISO: no tienes permiso para cambiar los residentes de esta unidad.'
      USING ERRCODE = '42501';
  END IF;

  IF p_residente_id IS NOT NULL THEN
    UPDATE public.unidad_residentes
       SET responsable_pago = true, updated_at = now()
     WHERE id = p_residente_id AND unidad_id = p_unidad_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'PAGADOR_SIN_PERMISO: no tienes permiso para cambiar los residentes de esta unidad.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN p_residente_id;
END;
$$;

COMMENT ON FUNCTION public.unidad_designar_pagador(uuid, uuid) IS
  'Designa (o retira, con NULL) el pagador de una unidad en una sola transacción, '
  'serializada por unidad. SECURITY INVOKER: la RLS de unidad_residentes decide quién puede.';

REVOKE ALL ON FUNCTION public.unidad_designar_pagador(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unidad_designar_pagador(uuid, uuid) TO authenticated;
