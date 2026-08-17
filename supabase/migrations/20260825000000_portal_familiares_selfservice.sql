-- Portal: accesos FAMILIARES por unidad, gestionados por el propietario.
--
-- Extiende el self-service de 20260822000000. Reglas de producto (confirmadas):
--   • Sin renta activa: el propietario da hasta 3 accesos a SU familia
--     (esposa/os, hijos…), tipo='familiar'.
--   • Con renta activa (hay arrendatario activo en la unidad): la familia propia
--     se inhabilita y los hasta 3 accesos corresponden al NÚCLEO FAMILIAR DEL
--     INQUILINO.
--   • Quitar al inquilino revoca EN CASCADA los accesos de su núcleo; la familia
--     del propietario no se toca.
--
-- Los familiares ya reciben el portal operativo sin más cambios: el helper dual
-- mis_unidades_ids() (fase 3) incluye toda membresía activa, y lib/portalTabs
-- recorta los tabs de cualquier no-propietario. Lo único que faltaba era saber
-- A QUÉ NÚCLEO pertenece cada familiar — para el límite por núcleo y la cascada:
--
--   • unidad_residentes.nucleo_cliente_id: "miembro del núcleo de <cliente>"
--     (el cliente del propietario o el del inquilino). Filas legacy/creadas por
--     el staff quedan NULL: fuera de límites y de la cascada.
--
-- Escrituras de unidad_residentes siguen staff-only por policy: todo pasa por
-- RPCs SECURITY DEFINER acotados al llamante (get_my_cliente_id()/auth.uid()).

-- ── 1) Columna de núcleo ─────────────────────────────────────────────────────
ALTER TABLE public.unidad_residentes
  ADD COLUMN IF NOT EXISTS nucleo_cliente_id uuid REFERENCES public.clientes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_unidad_residentes_nucleo
  ON public.unidad_residentes (unidad_id, nucleo_cliente_id)
  WHERE tipo = 'familiar';
COMMENT ON COLUMN public.unidad_residentes.nucleo_cliente_id IS
  'Para tipo=familiar: cliente cuyo núcleo integra este miembro (el propietario o el arrendatario que lo trajo). Gobierna el límite de 3 por núcleo y la revocación en cascada al quitar al inquilino (20260825000000). NULL en filas legacy/staff.';

-- ── 2) portal_registrar_familiar ─────────────────────────────────────────────
-- Calcado de portal_registrar_inquilino (20260822000000) con estas diferencias:
-- NO exige solicitud de renta (la familia del propietario no la necesita; con
-- renta, el gate ya se pasó al asignar al inquilino); el núcleo destino se
-- decide por el estado de la unidad (arrendatario activo → su núcleo; si no →
-- el del propietario); límite 3 familiares activos por núcleo.
CREATE OR REPLACE FUNCTION public.portal_registrar_familiar(
  p_unidad_id uuid,
  p_nombre text,
  p_email text,
  p_cui_dui text,
  p_fecha_nacimiento date,
  p_telefono text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_unidad     public.unidades%ROWTYPE;
  v_cliente_id uuid;
  v_existente  record;
  v_nucleo     uuid;
  v_en_renta   boolean;
  v_activos    int;
BEGIN
  IF current_user_role() <> 'cliente' THEN
    RAISE EXCEPTION 'Solo el propietario puede registrar accesos desde el portal.';
  END IF;
  IF p_unidad_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.mis_unidades_propietario_ids() x WHERE x = p_unidad_id) THEN
    RAISE EXCEPTION 'No autorizado: la unidad no le pertenece.';
  END IF;

  SELECT * INTO v_unidad FROM public.unidades WHERE id = p_unidad_id AND activo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unidad no encontrada o inactiva.';
  END IF;

  -- Núcleo destino según el estado de la unidad.
  SELECT ur.cliente_id INTO v_nucleo
    FROM public.unidad_residentes ur
   WHERE ur.unidad_id = p_unidad_id AND ur.tipo = 'arrendatario' AND ur.activo = true
   LIMIT 1;
  v_en_renta := FOUND;
  IF NOT v_en_renta THEN
    v_nucleo := public.get_my_cliente_id();
  END IF;

  -- Límite: 3 familiares ACTIVOS por núcleo en la unidad.
  SELECT count(*) INTO v_activos
    FROM public.unidad_residentes ur
   WHERE ur.unidad_id = p_unidad_id
     AND ur.tipo = 'familiar'
     AND ur.activo = true
     AND ur.nucleo_cliente_id = v_nucleo;
  IF v_activos >= 3 THEN
    IF v_en_renta THEN
      RAISE EXCEPTION 'El núcleo familiar del inquilino ya tiene el máximo de 3 accesos en esta unidad.';
    ELSE
      RAISE EXCEPTION 'Tu familia ya tiene el máximo de 3 accesos en esta unidad.';
    END IF;
  END IF;

  p_nombre  := NULLIF(btrim(p_nombre), '');
  p_email   := NULLIF(lower(btrim(p_email)), '');
  p_cui_dui := NULLIF(btrim(p_cui_dui), '');
  IF p_nombre IS NULL OR p_email IS NULL OR p_cui_dui IS NULL OR p_fecha_nacimiento IS NULL THEN
    RAISE EXCEPTION 'Nombre, email, DPI/CUI y fecha de nacimiento son requeridos.';
  END IF;

  -- Find-or-create por DPI con verificación de identidad (mismo criterio que
  -- portal_registrar_inquilino: no vincular al cliente equivocado ni filtrar
  -- datos por adivinación de DPI).
  SELECT id, fecha_nacimiento, email INTO v_existente
  FROM public.clientes WHERE cui_dui = p_cui_dui;
  IF FOUND THEN
    IF v_existente.fecha_nacimiento IS DISTINCT FROM p_fecha_nacimiento
       OR lower(COALESCE(v_existente.email, '')) IS DISTINCT FROM p_email THEN
      RAISE EXCEPTION 'Ya existe un cliente con ese DPI/CUI pero los demás datos no coinciden. Verifíquelos o contacte a la administración.';
    END IF;
    v_cliente_id := v_existente.id;
    IF v_cliente_id = public.get_my_cliente_id() THEN
      RAISE EXCEPTION 'No puede registrarse a sí mismo.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.unidad_residentes ur
      WHERE ur.unidad_id = p_unidad_id AND ur.cliente_id = v_cliente_id
        AND ur.tipo IN ('propietario', 'arrendatario')
    ) THEN
      RAISE EXCEPTION 'Ese cliente ya tiene acceso a esta unidad como propietario o inquilino.';
    END IF;
    UPDATE public.clientes
    SET puede_crear_cuenta = true, updated_at = now()
    WHERE id = v_cliente_id AND puede_crear_cuenta = false;
  ELSE
    INSERT INTO public.clientes
      (nombre, codigo, email, telefono, cui_dui, fecha_nacimiento, puede_crear_cuenta, project_id)
    VALUES
      (p_nombre,
       'FAM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
       p_email, NULLIF(btrim(p_telefono), ''), p_cui_dui, p_fecha_nacimiento, true,
       v_unidad.project_id)
    RETURNING id INTO v_cliente_id;
  END IF;

  INSERT INTO public.company_clientes (company_id, cliente_id, added_by)
  VALUES (v_unidad.company_id, v_cliente_id, auth.uid())
  ON CONFLICT (company_id, cliente_id) DO NOTHING;

  -- Membresía 'familiar' del núcleo destino (reactiva una previa si existía).
  INSERT INTO public.unidad_residentes
    (unidad_id, cliente_id, company_id, project_id, tipo, activo, nucleo_cliente_id)
  VALUES
    (p_unidad_id, v_cliente_id, v_unidad.company_id, v_unidad.project_id, 'familiar', true, v_nucleo)
  ON CONFLICT (unidad_id, cliente_id)
  DO UPDATE SET tipo = 'familiar', activo = true, nucleo_cliente_id = EXCLUDED.nucleo_cliente_id, updated_at = now();

  RETURN jsonb_build_object('cliente_id', v_cliente_id, 'en_renta', v_en_renta);
END;
$fn$;

REVOKE ALL ON FUNCTION public.portal_registrar_familiar(uuid, text, text, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_registrar_familiar(uuid, text, text, text, date, text) TO authenticated;
COMMENT ON FUNCTION public.portal_registrar_familiar(uuid, text, text, text, date, text) IS
  'El propietario registra un acceso familiar en su unidad (máx. 3 por núcleo): sin renta activa, de SU familia; con arrendatario activo, del núcleo del inquilino. Find-or-create de clientes por DPI con verificación 3-de-3; el familiar activa su login con el auto-registro existente.';

-- ── 3) portal_quitar_familiar ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_quitar_familiar(p_unidad_id uuid, p_cliente_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF current_user_role() <> 'cliente' THEN
    RAISE EXCEPTION 'Solo el propietario puede quitar accesos desde el portal.';
  END IF;
  IF p_unidad_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.mis_unidades_propietario_ids() x WHERE x = p_unidad_id) THEN
    RAISE EXCEPTION 'No autorizado: la unidad no le pertenece.';
  END IF;

  DELETE FROM public.unidad_residentes
  WHERE unidad_id = p_unidad_id AND cliente_id = p_cliente_id AND tipo = 'familiar';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró un acceso familiar con esos datos en la unidad.';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.portal_quitar_familiar(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_quitar_familiar(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.portal_quitar_familiar(uuid, uuid) IS
  'El propietario revoca un acceso familiar de su unidad (DELETE de la membresía tipo=familiar; el cliente y su login no se tocan).';

-- ── 4) portal_quitar_inquilino: revocación EN CASCADA del núcleo ─────────────
-- Cuerpo idéntico al de 20260822000000 más el DELETE previo de los familiares
-- del núcleo del inquilino. Cambia el tipo de retorno (void → jsonb con el
-- conteo), por lo que hay que DROP antes de recrear; el frontend desplegado
-- ignoraba el retorno, así que el cambio es compatible.
DROP FUNCTION IF EXISTS public.portal_quitar_inquilino(uuid, uuid);
CREATE FUNCTION public.portal_quitar_inquilino(p_unidad_id uuid, p_cliente_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_familiares int := 0;
BEGIN
  IF current_user_role() <> 'cliente' THEN
    RAISE EXCEPTION 'Solo el propietario puede quitar a su inquilino desde el portal.';
  END IF;
  IF p_unidad_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.mis_unidades_propietario_ids() x WHERE x = p_unidad_id) THEN
    RAISE EXCEPTION 'No autorizado: la unidad no le pertenece.';
  END IF;

  -- Cascada: el núcleo familiar que trajo el inquilino sale con él. La familia
  -- del propietario (nucleo = su cliente) y las filas legacy (NULL) no se tocan.
  DELETE FROM public.unidad_residentes
  WHERE unidad_id = p_unidad_id AND tipo = 'familiar' AND nucleo_cliente_id = p_cliente_id;
  GET DIAGNOSTICS v_familiares = ROW_COUNT;

  DELETE FROM public.unidad_residentes
  WHERE unidad_id = p_unidad_id AND cliente_id = p_cliente_id AND tipo = 'arrendatario';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró un inquilino con esos datos en la unidad.';
  END IF;

  RETURN jsonb_build_object('familiares_revocados', v_familiares);
END;
$fn$;

REVOKE ALL ON FUNCTION public.portal_quitar_inquilino(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_quitar_inquilino(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.portal_quitar_inquilino(uuid, uuid) IS
  'El propietario quita a su inquilino: revoca su membresía Y, en cascada, los accesos familiares de su núcleo (nucleo_cliente_id). Devuelve familiares_revocados. El cliente y su login no se tocan.';

-- ── 5) portal_accesos_de_unidad ──────────────────────────────────────────────
-- Todos los accesos no-propietario de una unidad PROPIA (inquilino + familiares
-- con su núcleo). Generaliza portal_inquilinos_de_unidad, que se conserva para
-- la sección del tab Rentas.
CREATE OR REPLACE FUNCTION public.portal_accesos_de_unidad(p_unidad_id uuid)
RETURNS TABLE (
  id uuid,
  cliente_id uuid,
  tipo text,
  nucleo_cliente_id uuid,
  activo boolean,
  created_at timestamptz,
  cliente_nombre text,
  cliente_email text,
  cliente_telefono text,
  tiene_cuenta boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT ur.id, ur.cliente_id, ur.tipo, ur.nucleo_cliente_id, ur.activo, ur.created_at,
         cl.nombre, cl.email, cl.telefono,
         EXISTS (SELECT 1 FROM public.app_users au WHERE au.cliente_id = ur.cliente_id)
  FROM public.unidad_residentes ur
  JOIN public.clientes cl ON cl.id = ur.cliente_id
  WHERE ur.unidad_id = p_unidad_id
    AND ur.tipo <> 'propietario'
    AND p_unidad_id IN (SELECT public.mis_unidades_propietario_ids())
  ORDER BY CASE ur.tipo WHEN 'arrendatario' THEN 0 ELSE 1 END, ur.created_at
$fn$;

REVOKE ALL ON FUNCTION public.portal_accesos_de_unidad(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_accesos_de_unidad(uuid) TO authenticated;
COMMENT ON FUNCTION public.portal_accesos_de_unidad(uuid) IS
  'Accesos no-propietario de una unidad propia (inquilino + familiares con su núcleo y si ya tienen cuenta), para la sección "Accesos de mi unidad" del portal del propietario. 0 filas si la unidad no es del llamante.';
