-- ════════════════════════════════════════════════════════════════════════════
-- Minutas de reunión: guardar el avance de cada paso y convocar al equipo
-- del proyecto
-- ════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ
-- 1. El asistente de una minuta (20261110000000) sólo guardaba al terminar los
--    cuatro pasos: una reunión que se interrumpe, o que se captura en dos
--    sentadas (los puntos hoy, los acuerdos mañana), se perdía al cerrar la
--    ventana. Ahora cada paso tiene «Guardar avance», y la fila recuerda EN QUÉ
--    PASO se quedó para retomarla desde ahí.
-- 2. Los participantes salían de cuatro listas (personal del condominio,
--    propietarios/inquilinos, proveedores y «otro» a mano), pero no había cómo
--    convocar a las CUENTAS de la empresa asignadas al proyecto —la
--    administración misma, que es quien convoca y gestiona—. La policy
--    `app_users_select` (20260417000012) sólo deja enumerar la empresa a
--    company_owner/admin, así que, como en Personal y Rutas, la lista es un RPC.
--
-- LO QUE HACE
--   a) `notas_admin.borrador_paso smallint` — NULL cuando la minuta terminó el
--      asistente (el estado de todas las existentes); 1..4 cuando se guardó el
--      avance en ese paso y está «en curso». La pantalla abre el asistente en
--      ese paso; «Guardar minuta» / «Guardar cambios» lo vuelven NULL.
--   b) `minutas_equipo_proyecto(p_project_id)` — las cuentas ACTIVAS de la
--      empresa del proyecto que ven ese proyecto (`usuario_acceso_a_proyecto`,
--      20260906000400: rol exento, project_id legacy o asignación explícita),
--      sin las cuentas `cliente`. Mismo patrón y misma proyección mínima que
--      `rutas_operadores_asignables`: id, nombre resuelto (full_name, si no el
--      correo, si no el uuid) y rol.
--
-- PERMISOS del RPC. Espeja lo que hace falta para abrir la pestaña: empresa del
-- proyecto, la clave de VISIBILIDAD del tab (`condominios.tab.notas_admin`) y
-- acceso del LLAMADOR al proyecto. Quien puede ver las minutas de un condominio
-- puede ver a quién convocar; no se pide la clave de escritura porque la lista
-- también sirve para leer en el detalle quién es cada participante del equipo.
-- Una sesión de la API sin perfil cae en «fuera de la empresa» (get_my_company_id()
-- NULL ≠ v_company) y los demás predicados van en COALESCE(…, false)
-- (20261029000000): ninguna guarda pasa por NULL.
--
-- LO QUE NO HACE. No toca las policies de notas_admin ni la forma de los JSON:
-- el nuevo tipo de participante («equipo», con ref_id = app_users.id) es un
-- valor más dentro de `participantes`, que no tiene CHECK por tipo.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, el CHECK sólo si no existe y
-- CREATE OR REPLACE en la función.
--
-- REVERSIÓN
--   DROP FUNCTION IF EXISTS public.minutas_equipo_proyecto(uuid);
--   ALTER TABLE public.notas_admin DROP COLUMN IF EXISTS borrador_paso;
--   (arrastra el CHECK). Las minutas quedan como terminadas.
-- ════════════════════════════════════════════════════════════════════════════

-- ── a) En qué paso se quedó la minuta ───────────────────────────────────────
ALTER TABLE public.notas_admin
  ADD COLUMN IF NOT EXISTS borrador_paso smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notas_admin_borrador_paso_rango') THEN
    ALTER TABLE public.notas_admin
      ADD CONSTRAINT notas_admin_borrador_paso_rango
      CHECK (borrador_paso IS NULL OR borrador_paso BETWEEN 1 AND 4);
  END IF;
END;
$$;

COMMENT ON COLUMN public.notas_admin.borrador_paso IS
  'Minuta en curso: paso del asistente (1 participantes, 2 puntos, 3 acuerdos, 4 firmas) en el que se guardó el avance y desde el que se retoma. NULL = terminó el asistente.';

-- ── b) El equipo de la empresa asignado al proyecto ─────────────────────────
CREATE OR REPLACE FUNCTION public.minutas_equipo_proyecto(p_project_id uuid)
RETURNS TABLE (
  id        uuid,
  full_name text,
  role      text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company uuid;
BEGIN
  SELECT p.company_id INTO v_company
    FROM public.projects p
   WHERE p.id = p_project_id;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Proyecto inexistente' USING ERRCODE = '42501';
  END IF;

  -- Espeja lo que abre la pestaña Minutas: empresa, visibilidad del tab y
  -- acceso del LLAMADOR al proyecto. Sin lo último, un operador acotado a un
  -- condominio enumeraría al equipo de otro.
  IF NOT COALESCE(public.is_super_admin(), false) THEN
    IF v_company IS DISTINCT FROM public.get_my_company_id() THEN
      RAISE EXCEPTION 'Proyecto fuera de la empresa' USING ERRCODE = '42501';
    END IF;
    IF NOT COALESCE(public.user_has_permission('condominios.tab.notas_admin'), false) THEN
      RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;
    IF NOT COALESCE(public.can_access_project(p_project_id), false) THEN
      RAISE EXCEPTION 'Proyecto fuera de tu alcance' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    COALESCE(
      NULLIF(btrim(u.full_name), ''),
      NULLIF(split_part(au.email::text, '@', 1), ''),
      'Usuario ' || left(u.id::text, 8)
    ),
    COALESCE(u.role, '—')
  FROM public.app_users u
  LEFT JOIN auth.users au
    ON au.id = u.id
  -- `activo`: una cuenta dada de baja ya no es equipo. `cliente`: el residente
  -- entra por la lista de propietarios/inquilinos, no por la del equipo.
  WHERE u.company_id = v_company
    AND u.activo
    AND COALESCE(u.role, '') <> 'cliente'
    AND public.usuario_acceso_a_proyecto(u.id, p_project_id)
  ORDER BY 2 ASC, 1 ASC;
END;
$$;

COMMENT ON FUNCTION public.minutas_equipo_proyecto(uuid) IS
  'Cuentas activas de la empresa CON acceso al proyecto (sin clientes), para convocarlas como participantes de una minuta. Exige condominios.tab.notas_admin y que el llamador acceda al proyecto. Existe porque app_users_select sólo deja enumerar la empresa a company_owner/admin.';

-- CREATE FUNCTION concede EXECUTE a PUBLIC por defecto y `anon` lo hereda
-- (clase #378/#380, cerrada en 20260825010000).
REVOKE EXECUTE ON FUNCTION public.minutas_equipo_proyecto(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.minutas_equipo_proyecto(uuid) TO authenticated;
