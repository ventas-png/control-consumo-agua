-- ════════════════════════════════════════════════════════════════════════════
-- El operador de una ruta sale del proyecto de la ruta, no de la empresa
-- ════════════════════════════════════════════════════════════════════════════
-- PROBLEMA. El selector «Asignar Operador» de Rutas se llena con
-- `fetchActiveAppUsers()`, un SELECT a `app_users` filtrado solo por
-- `activo = true`. Dos consecuencias, opuestas y ambas malas:
--
--   · Para quien SÍ puede enumerar la empresa (company_owner/admin, los únicos
--     que deja pasar `app_users_select` de 20260417000012) la lista trae al
--     personal de TODOS los condominios. Asignar la ruta de un residencial al
--     lector de otro se hace de un clic, y la ruta queda con un responsable que
--     ni siquiera puede abrir el proyecto: `rutas_select` (20260815000000) le
--     enseña la ruta por ser el asignado, pero `can_access_project` le niega
--     los contadores y las unidades que tiene que leer. El recordatorio sale,
--     la persona entra, y no hay nada que registrar.
--   · Para todos los demás —un operador de agua con `agua.rutas.edit`— esa
--     misma policy devuelve CERO filas: el selector aparece vacío y parece que
--     la empresa no tiene a quién asignarle nada.
--
-- Es el mismo agujero que 20260906000300 cerró en el selector de «usuario de
-- ingreso» del tab Personal, por la otra vía: allá el catálogo era un RPC que
-- listaba de más; acá es un SELECT directo que, según quién pregunte, lista de
-- más o de menos.
--
-- QUÉ HACE
--   1. `usuario_acceso_a_proyecto(user, project)` — el espejo de
--      `can_access_project()` (20260815000000) para una cuenta CUALQUIERA y no
--      para el llamador. La regla es la misma (rol exento de empresa, o
--      `app_users.project_id` legacy, o asignación explícita) y ahora vive en un
--      solo lugar: 20260906000300 la tenía copiada dentro de
--      `personal_usuarios_asignables`, que aquí pasa a llamarla. Dos selectores
--      que responden «¿quién ve este proyecto?» no pueden divergir en la
--      respuesta.
--   2. `rutas_operadores_asignables(project)` — las cuentas activas de la
--      empresa del proyecto que SÍ ven ese proyecto. Es un RPC por lo mismo que
--      el del tab Personal: la policy de `app_users` no deja enumerar la
--      empresa a quien no es owner/admin, y el selector tiene que funcionar
--      para quien administra las rutas.
--
-- PERMISOS. Espeja `rutas_select` (20260815000000): empresa del proyecto,
-- `agua.rutas.view` y acceso del LLAMADOR a ese proyecto. Quien puede ver las
-- rutas de un condominio puede ver a quién se le pueden asignar; no se pide el
-- permiso de escritura porque la lista también sirve para leer el nombre del
-- asignado.
--
-- LO QUE NO HACE. No toca `rutas.asignado_a` ni sus policies: las rutas ya
-- asignadas siguen como están. Vaciar a mano una asignación vieja es decisión
-- de quien administra, no de una migración —y el nombre del asignado va
-- denormalizado en la fila (`asignado_nombre`), así que la ruta se sigue
-- leyendo aunque su operador ya no salga en la lista.
--
-- REVERSIÓN
--   DROP FUNCTION IF EXISTS public.rutas_operadores_asignables(uuid);
--   -- y reaplicar 20260906000300 para volver a la copia inline del acceso:
--   DROP FUNCTION IF EXISTS public.usuario_acceso_a_proyecto(uuid, uuid);
--
-- Idempotente: CREATE OR REPLACE en las tres funciones.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. ¿Esta cuenta ve este proyecto? ───────────────────────────────────────
-- SECURITY DEFINER porque lee `app_users` y `user_project_assignments`, que un
-- operador no puede leer por RLS: con SECURITY INVOKER el EXISTS daría falso y
-- escondería cuentas legítimas.
--
-- STABLE y no IMMUTABLE: la respuesta cambia cuando cambian las asignaciones.
CREATE OR REPLACE FUNCTION public.usuario_acceso_a_proyecto(
  p_user_id    uuid,
  p_project_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- COALESCE porque `u.project_id = p_project_id` da NULL —no false— cuando la
  -- cuenta no tiene proyecto sellado, y ese NULL se propaga por todo el OR:
  -- ninguna cuenta debe salir con "no se sabe" de una función boolean.
  SELECT COALESCE(
    (
      SELECT
        u.role = ANY (ARRAY['super_admin', 'superadmin', 'company_owner'])
        OR (
          u.role = 'admin'
          AND NOT EXISTS (
            SELECT 1 FROM public.user_project_assignments upa WHERE upa.user_id = u.id
          )
        )
        OR u.project_id = p_project_id
        OR EXISTS (
          SELECT 1 FROM public.user_project_assignments upa
          WHERE upa.user_id = u.id AND upa.project_id = p_project_id
        )
      FROM public.app_users u
      WHERE u.id = p_user_id
    ),
    false
  )
$$;

COMMENT ON FUNCTION public.usuario_acceso_a_proyecto(uuid, uuid) IS
  'Espejo de can_access_project() para una cuenta cualquiera (no el llamador): rol exento de empresa, project_id legacy o asignación explícita. La usan los selectores que ofrecen "quién puede hacerse cargo de esto AQUÍ".';

-- Solo la llaman otras funciones SECURITY DEFINER, que se ejecutan como su
-- dueño: revocarle `authenticated` no las rompe y evita exponer un oráculo de
-- "¿a qué proyectos entra fulano?" a cualquiera con un uuid (precedente:
-- 20260826000000 · personal_validar_usuario).
REVOKE EXECUTE ON FUNCTION public.usuario_acceso_a_proyecto(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 2. El catálogo del tab Personal usa el helper ───────────────────────────
-- Mismo comportamiento que 20260906000300; cambia solo de dónde sale el
-- acceso, para que no queden dos copias de la regla.
CREATE OR REPLACE FUNCTION public.personal_usuarios_asignables(p_project_id uuid)
RETURNS TABLE (
  usuario_id            uuid,
  nombre                text,
  email                 text,
  rol                   text,
  activo                boolean,
  tiene_acceso_proyecto boolean,
  personal_id           uuid,
  personal_nombre       text
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

  IF NOT public.is_super_admin() THEN
    IF v_company IS DISTINCT FROM public.get_my_company_id() THEN
      RAISE EXCEPTION 'Proyecto fuera de la empresa' USING ERRCODE = '42501';
    END IF;
    IF NOT public.user_has_permission('condominios.tab.personal') THEN
      RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  WITH cuentas AS (
    SELECT
      u.id AS c_id,
      COALESCE(
        NULLIF(btrim(u.full_name), ''),
        NULLIF(split_part(au.email::text, '@', 1), ''),
        'Usuario ' || left(u.id::text, 8)
      ) AS c_nombre,
      au.email::text AS c_email,
      COALESCE(u.role, '—') AS c_rol,
      u.activo AS c_activo,
      public.usuario_acceso_a_proyecto(u.id, p_project_id) AS c_acceso,
      pc.id AS c_personal_id,
      pc.nombre AS c_personal_nombre
    FROM public.app_users u
    LEFT JOIN auth.users au
      ON au.id = u.id
    LEFT JOIN public.personal_condominio pc
      ON pc.user_id = u.id AND pc.project_id = p_project_id
    WHERE u.company_id = v_company
      AND COALESCE(u.role, '') <> 'cliente'
  )
  SELECT c_id, c_nombre, c_email, c_rol, c_activo, c_acceso, c_personal_id, c_personal_nombre
    FROM cuentas
   WHERE c_acceso OR c_personal_id IS NOT NULL
   ORDER BY c_activo DESC, c_nombre ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.personal_usuarios_asignables(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.personal_usuarios_asignables(uuid) TO authenticated;

-- ── 3. Operadores asignables a una ruta ─────────────────────────────────────
-- Devuelve las columnas de `app_users` con sus nombres de tabla a propósito:
-- es el reemplazo exacto del SELECT que hacía el cliente, y así el selector no
-- cambia de forma. `full_name` se resuelve como en el catálogo del tab Personal
-- —correo, y en último caso el uuid— para que ninguna opción salga en blanco.
CREATE OR REPLACE FUNCTION public.rutas_operadores_asignables(p_project_id uuid)
RETURNS TABLE (
  id        uuid,
  full_name text,
  role      text,
  activo    boolean
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

  -- Espeja rutas_select (20260815000000): empresa, permiso de rutas y acceso
  -- del LLAMADOR al proyecto. Sin lo último, un operador acotado a un
  -- condominio enumeraría al personal de otro.
  IF NOT public.is_super_admin() THEN
    IF v_company IS DISTINCT FROM public.get_my_company_id() THEN
      RAISE EXCEPTION 'Proyecto fuera de la empresa' USING ERRCODE = '42501';
    END IF;
    IF NOT public.user_has_permission('agua.rutas.view') THEN
      RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;
    IF NOT public.can_access_project(p_project_id) THEN
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
    COALESCE(u.role, '—'),
    u.activo
  FROM public.app_users u
  LEFT JOIN auth.users au
    ON au.id = u.id
  -- `activo`: asignarle una ruta a una cuenta dada de baja es programar trabajo
  -- para quien ya no entra. `cliente`: el residente no ejecuta rutas y además no
  -- tiene company_id (20260801000400), así que el filtro de empresa ya lo saca.
  WHERE u.company_id = v_company
    AND u.activo
    AND COALESCE(u.role, '') <> 'cliente'
    AND public.usuario_acceso_a_proyecto(u.id, p_project_id)
  ORDER BY 2 ASC;
END;
$$;

COMMENT ON FUNCTION public.rutas_operadores_asignables(uuid) IS
  'Cuentas activas de la empresa CON acceso al proyecto, para el selector "Asignar Operador" de Rutas. Exige agua.rutas.view y que el llamador acceda al proyecto (espeja rutas_select). Existe porque app_users_select solo deja enumerar la empresa a company_owner/admin.';

-- CREATE FUNCTION concede EXECUTE a PUBLIC por defecto y `anon` lo hereda
-- (clase #378/#380, cerrada en 20260825010000).
REVOKE EXECUTE ON FUNCTION public.rutas_operadores_asignables(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rutas_operadores_asignables(uuid) TO authenticated;
