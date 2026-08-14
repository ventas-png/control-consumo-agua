-- Portal propietario vs inquilino — SELF-SERVICE del propietario (P1 · condominios).
--
-- Cierra el ciclo de las fases 1-3 (20260712020000 / 20260713000000..070000): el RLS
-- dual ya concede acceso por-unidad a un inquilino asignado en `unidad_residentes`,
-- pero (a) el frontend del portal nunca resolvía unidades vía esa tabla y (b) solo el
-- staff podía asignar residentes. Esta migración agrega la capa que faltaba para que
-- el PROPIETARIO gestione el acceso de SU inquilino desde su portal:
--
--   • `portal_mis_unidades()` — resuelve las unidades del residente con la MISMA
--     unión dual que mis_unidades_ids()/mis_unidad_roles(), agregando el rol por
--     unidad y los flags de servicio de la empresa. Redacta el contacto del
--     propietario cuando el llamante NO es propietario de esa unidad.
--   • `mis_unidades_propietario_ids()` — subset "donde soy propietario", base de
--     autorización de todo el self-service.
--   • `portal_registrar_inquilino()` — el propietario registra a su inquilino
--     (find-or-create de `clientes` por DPI + vínculo empresa + membresía
--     'arrendatario'), SOLO con solicitud de renta APROBADA para arrendamiento.
--   • `portal_quitar_inquilino()` — revoca la membresía (el RLS dual deja de
--     incluir la unidad de inmediato). No toca el cliente ni su login.
--   • `portal_inquilinos_de_unidad()` — lista los arrendatarios de una unidad
--     propia (la policy SELECT de unidad_residentes solo muestra la membresía
--     PROPIA, así que el propietario necesita este camino).
--
-- Las policies de ESCRITURA de `unidad_residentes` quedan staff-only: el
-- self-service pasa entero por RPCs SECURITY DEFINER con validación server-side.
-- Todas están acotadas al llamante vía get_my_cliente_id() (auth.uid()).

-- ── 1) Unidades donde el llamante es PROPIETARIO ────────────────────────────
-- Deriva de mis_unidad_roles() (única fuente de verdad del rol por unidad:
-- unidades.cliente_id legacy → 'propietario' UNION unidad_residentes.tipo).
CREATE OR REPLACE FUNCTION public.mis_unidades_propietario_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT m.unidad FROM public.mis_unidad_roles() m WHERE m.rol = 'propietario'
$fn$;
REVOKE ALL ON FUNCTION public.mis_unidades_propietario_ids() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mis_unidades_propietario_ids() TO authenticated;

-- ── 2) Unidades del residente para el portal (con rol y flags de servicio) ──
-- Reemplaza en el portal al filtro legacy `unidades.cliente_id = mi cliente`,
-- que dejaba a los inquilinos con el portal vacío. Devuelve jsonb por fila
-- (to_jsonb(u.*)) para que el shape siga al esquema de `unidades` sin repuntar
-- esta función en cada ALTER TABLE. Si el mismo cliente tiene más de un rol en
-- una unidad, gana el más fuerte (propietario > arrendatario > familiar > otro).
-- Para llamantes sin cliente (staff), get_my_cliente_id() es NULL → 0 filas.
CREATE OR REPLACE FUNCTION public.portal_mis_unidades()
RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  WITH roles AS (
    SELECT DISTINCT ON (m.unidad) m.unidad, m.rol
    FROM public.mis_unidad_roles() m
    ORDER BY m.unidad,
      CASE m.rol WHEN 'propietario' THEN 0 WHEN 'arrendatario' THEN 1 WHEN 'familiar' THEN 2 ELSE 3 END
  )
  SELECT to_jsonb(u.*)
    || jsonb_build_object(
         'rol', r.rol,
         'servicio_agua', COALESCE(c.servicio_agua, false),
         'servicio_condominios', COALESCE(c.servicio_condominios, false))
    -- El contacto del propietario no es asunto del inquilino: se redacta
    -- server-side (la UI no tiene que acordarse de ocultarlo).
    || CASE WHEN r.rol = 'propietario' THEN '{}'::jsonb
       ELSE jsonb_build_object('propietario_telefono', NULL, 'propietario_email', NULL) END
  FROM roles r
  JOIN public.unidades u ON u.id = r.unidad
  LEFT JOIN public.projects p ON p.id = u.project_id
  LEFT JOIN public.companies c ON c.id = p.company_id
  WHERE u.activo = true
  ORDER BY u.nombre
$fn$;
REVOKE ALL ON FUNCTION public.portal_mis_unidades() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.portal_mis_unidades() TO authenticated;

-- ── 3) Arrendatarios de una unidad PROPIA (para la sección "Mi inquilino") ──
-- `tiene_cuenta` le dice al propietario si el inquilino ya activó su login
-- (auto-registro con DPI + fecha de nacimiento + email).
CREATE OR REPLACE FUNCTION public.portal_inquilinos_de_unidad(p_unidad_id uuid)
RETURNS TABLE (
  id uuid,
  cliente_id uuid,
  activo boolean,
  created_at timestamptz,
  cliente_nombre text,
  cliente_email text,
  cliente_telefono text,
  tiene_cuenta boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT ur.id, ur.cliente_id, ur.activo, ur.created_at,
         cl.nombre, cl.email, cl.telefono,
         EXISTS (SELECT 1 FROM public.app_users au WHERE au.cliente_id = ur.cliente_id)
  FROM public.unidad_residentes ur
  JOIN public.clientes cl ON cl.id = ur.cliente_id
  WHERE ur.unidad_id = p_unidad_id
    AND ur.tipo = 'arrendatario'
    AND p_unidad_id IN (SELECT public.mis_unidades_propietario_ids())
  ORDER BY ur.created_at
$fn$;
REVOKE ALL ON FUNCTION public.portal_inquilinos_de_unidad(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.portal_inquilinos_de_unidad(uuid) TO authenticated;

-- ── 4) Registrar inquilino (find-or-create + membresía) ─────────────────────
-- Requisitos, en orden: llamante es cliente del portal Y propietario de la
-- unidad; la unidad tiene solicitud de renta APROBADA cubriendo arrendamiento
-- (misma condición que la RLS de rentas, 20260514000006); un solo arrendatario
-- ACTIVO por unidad. El cliente del inquilino se resuelve por DPI exacto: si ya
-- existe, los otros dos datos de identidad deben coincidir (no vincular al
-- cliente equivocado ni filtrar datos por adivinación de DPI); si no existe, se
-- crea con puede_crear_cuenta=true para habilitar el auto-registro existente
-- (create-cliente-account valida DPI + fecha nacimiento + email 3-de-3).
CREATE OR REPLACE FUNCTION public.portal_registrar_inquilino(
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
BEGIN
  IF current_user_role() <> 'cliente' THEN
    RAISE EXCEPTION 'Solo el propietario puede registrar a su inquilino desde el portal.';
  END IF;
  IF p_unidad_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.mis_unidades_propietario_ids() x WHERE x = p_unidad_id) THEN
    RAISE EXCEPTION 'No autorizado: la unidad no le pertenece.';
  END IF;

  SELECT * INTO v_unidad FROM public.unidades WHERE id = p_unidad_id AND activo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unidad no encontrada o inactiva.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.solicitud_renta_unidad s
    WHERE s.unidad_id = p_unidad_id
      AND s.cliente_id = public.get_my_cliente_id()
      AND s.estado = 'aprobada'
      AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('arrendamiento', 'ambas')
  ) THEN
    RAISE EXCEPTION 'La unidad no tiene autorización de renta aprobada para arrendamiento.';
  END IF;

  p_nombre  := NULLIF(btrim(p_nombre), '');
  p_email   := NULLIF(lower(btrim(p_email)), '');
  p_cui_dui := NULLIF(btrim(p_cui_dui), '');
  IF p_nombre IS NULL OR p_email IS NULL OR p_cui_dui IS NULL OR p_fecha_nacimiento IS NULL THEN
    RAISE EXCEPTION 'Nombre, email, DPI/CUI y fecha de nacimiento son requeridos.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.unidad_residentes ur
    WHERE ur.unidad_id = p_unidad_id AND ur.tipo = 'arrendatario' AND ur.activo = true
  ) THEN
    RAISE EXCEPTION 'La unidad ya tiene un inquilino activo. Quite el acceso actual antes de registrar otro.';
  END IF;

  SELECT id, fecha_nacimiento, email INTO v_existente
  FROM public.clientes WHERE cui_dui = p_cui_dui;
  IF FOUND THEN
    IF v_existente.fecha_nacimiento IS DISTINCT FROM p_fecha_nacimiento
       OR lower(COALESCE(v_existente.email, '')) IS DISTINCT FROM p_email THEN
      RAISE EXCEPTION 'Ya existe un cliente con ese DPI/CUI pero los demás datos no coinciden. Verifíquelos con su inquilino o contacte a la administración.';
    END IF;
    v_cliente_id := v_existente.id;
    IF v_cliente_id = public.get_my_cliente_id() THEN
      RAISE EXCEPTION 'No puede registrarse a sí mismo como inquilino.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.unidad_residentes ur
      WHERE ur.unidad_id = p_unidad_id AND ur.cliente_id = v_cliente_id AND ur.tipo = 'propietario'
    ) THEN
      RAISE EXCEPTION 'Ese cliente ya es propietario de esta unidad.';
    END IF;
    UPDATE public.clientes
    SET puede_crear_cuenta = true, updated_at = now()
    WHERE id = v_cliente_id AND puede_crear_cuenta = false;
  ELSE
    INSERT INTO public.clientes
      (nombre, codigo, email, telefono, cui_dui, fecha_nacimiento, puede_crear_cuenta, project_id)
    VALUES
      (p_nombre,
       -- clientes.codigo es NOT NULL UNIQUE y en el flujo staff lo teclea el
       -- operador; aquí se genera (colisión ~imposible sobre 16^8).
       'INQ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
       p_email, NULLIF(btrim(p_telefono), ''), p_cui_dui, p_fecha_nacimiento, true,
       v_unidad.project_id)
    RETURNING id INTO v_cliente_id;
  END IF;

  -- Vínculo empresa↔cliente: así el staff del tenant ve y administra al
  -- inquilino como a cualquier otro cliente.
  INSERT INTO public.company_clientes (company_id, cliente_id, added_by)
  VALUES (v_unidad.company_id, v_cliente_id, auth.uid())
  ON CONFLICT (company_id, cliente_id) DO NOTHING;

  -- Membresía 'arrendatario' (reactiva una previa del mismo cliente si existía).
  -- company/project derivados de la UNIDAD, nunca del payload.
  INSERT INTO public.unidad_residentes (unidad_id, cliente_id, company_id, project_id, tipo, activo)
  VALUES (p_unidad_id, v_cliente_id, v_unidad.company_id, v_unidad.project_id, 'arrendatario', true)
  ON CONFLICT (unidad_id, cliente_id)
  DO UPDATE SET tipo = 'arrendatario', activo = true, updated_at = now();

  RETURN jsonb_build_object('cliente_id', v_cliente_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.portal_registrar_inquilino(uuid, text, text, text, date, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.portal_registrar_inquilino(uuid, text, text, text, date, text) TO authenticated;

-- ── 5) Quitar inquilino (revoca el acceso de inmediato) ─────────────────────
-- DELETE (no soft-off): el UNIQUE(unidad_id, cliente_id) permite re-registrar
-- después sin conflicto, igual que hace el modal staff. La historia del
-- arrendamiento vive en contratos_arrendamiento, no en la membresía.
CREATE OR REPLACE FUNCTION public.portal_quitar_inquilino(p_unidad_id uuid, p_cliente_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF current_user_role() <> 'cliente' THEN
    RAISE EXCEPTION 'Solo el propietario puede quitar a su inquilino desde el portal.';
  END IF;
  IF p_unidad_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.mis_unidades_propietario_ids() x WHERE x = p_unidad_id) THEN
    RAISE EXCEPTION 'No autorizado: la unidad no le pertenece.';
  END IF;

  DELETE FROM public.unidad_residentes
  WHERE unidad_id = p_unidad_id AND cliente_id = p_cliente_id AND tipo = 'arrendatario';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró un inquilino con esos datos en la unidad.';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.portal_quitar_inquilino(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.portal_quitar_inquilino(uuid, uuid) TO authenticated;
