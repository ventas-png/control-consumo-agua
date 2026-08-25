-- ════════════════════════════════════════════════════════════════════════════
-- El selector de "usuario de ingreso" solo ofrece cuentas de ESTE condominio
-- ════════════════════════════════════════════════════════════════════════════
-- PROBLEMA. `personal_usuarios_asignables` (20260826000000) devuelve TODAS las
-- cuentas de staff de la empresa y se limita a marcar con
-- `tiene_acceso_proyecto` cuáles no ven el condominio. El tab traduce esa marca
-- a un aviso DESPUÉS de elegir, así que el desplegable de un administrador de
-- condominio lista al personal de todos los demás condominios de la empresa:
-- las cuentas de las garitas de otros proyectos, las lecturas de otro
-- residencial, la cuenta corporativa. En una empresa administradora con una
-- docena de condominios eso es una lista larga en la que la cuenta correcta es
-- la excepción, y en la que basta un clic distraído para sellar el expediente
-- de un empleado con la cuenta de un compañero de OTRO condominio (el aviso
-- explica, pero no impide guardar).
--
-- Además exhibe hacia abajo la plantilla completa de la empresa: quien
-- administra un solo condominio no necesita —ni debería— enumerar el correo de
-- todo el personal de los demás.
--
-- QUÉ HACE. El catálogo pasa a devolver solo lo que el selector puede ofrecer
-- de verdad:
--
--   · las cuentas con acceso a ESTE proyecto (`tiene_acceso_proyecto`), que es
--     exactamente la condición para que la persona pueda registrar algo aquí; y
--   · las que YA están vinculadas a un empleado de este proyecto aunque hoy no
--     tengan acceso — se siguen listando a propósito: el tab resuelve con este
--     mismo catálogo el nombre que muestran las tarjetas y el «ya es Fulano»
--     que explica por qué una cuenta no se puede elegir. Filtrarlas dejaría al
--     empleado ya vinculado como si estuviera suelto e invitaría a asignar dos
--     veces la misma cuenta.
--
-- La empresa ya se filtraba (`u.company_id = v_company`) y el residente ya
-- quedaba fuera (`role <> 'cliente'`): eso no cambia. Tampoco cambia la firma,
-- ni las columnas, ni quién puede llamarla: `tiene_acceso_proyecto` se conserva
-- porque una fila de las del segundo caso llega con `false` y el tab tiene que
-- poder avisar que esa cuenta perdió el acceso al condominio.
--
-- POR QUÉ EN LA BD Y NO SOLO EN EL TAB. El filtro también se aplica en el
-- cliente (el usuario lo ve al instante y sin esperar el despliegue), pero
-- dejarlo solo ahí significaría seguir mandando por la red la plantilla
-- completa de la empresa a cada administrador de condominio: el filtro que
-- importa para no exhibirla es este.
--
-- REVERSIÓN: reaplicar el CREATE OR REPLACE de 20260826000000 (misma firma).
--
-- Idempotente: CREATE OR REPLACE de una función con la misma firma.
-- ════════════════════════════════════════════════════════════════════════════

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
  -- La empresa sale del PROYECTO, no del llamador: así el super admin (cuya
  -- get_my_company_id() es la suya) obtiene la lista correcta y el resto se
  -- valida contra ella.
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
    -- Mismo permiso que gobierna la ficha por RLS (20260518000010).
    IF NOT public.user_has_permission('condominios.tab.personal') THEN
      RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- El CTE calcula el acceso una vez y el WHERE de afuera filtra por él: sin
  -- él habría que repetir la expresión entera en el WHERE. Las columnas del CTE
  -- van con prefijo `c_` a propósito: los nombres de RETURNS TABLE son variables
  -- dentro del cuerpo y chocarían con los de la consulta.
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
      -- Espeja can_access_project() (20260815000000) pero para la cuenta
      -- LISTADA, no para el llamador: es la condición para que esa persona
      -- pueda registrar algo en este condominio, y desde esta migración también
      -- la condición para aparecer en la lista.
      --
      -- COALESCE porque `u.project_id = p_project_id` da NULL —no false— cuando
      -- la cuenta no tiene proyecto sellado, y ese NULL se propaga por todo el
      -- OR: la columna es boolean y ninguna cuenta debe salir con "no se sabe"
      -- (un NULL aquí, además, no pasaría el WHERE de abajo y la escondería).
      COALESCE(
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
        ),
        false
      ) AS c_acceso,
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
   -- Las dos únicas cuentas que el selector puede ofrecer: la que ve este
   -- condominio y la que ya está vinculada aquí (que hay que poder nombrar).
   WHERE c_acceso OR c_personal_id IS NOT NULL
   ORDER BY c_activo DESC, c_nombre ASC;
END;
$$;

COMMENT ON FUNCTION public.personal_usuarios_asignables(uuid) IS
  'Cuentas de staff de la empresa CON acceso a este proyecto (más las que ya están vinculadas a un empleado suyo, para poder nombrarlas) para el selector "usuario de ingreso" del tab Personal: nombre, correo, rol, si está activa, si tiene acceso al proyecto y a qué empleado está ya vinculada. Exige el permiso condominios.tab.personal. Existe porque app_users_select solo deja enumerar la empresa a company_owner/admin.';

-- CREATE OR REPLACE conserva los privilegios existentes (el REVOKE/GRANT de
-- 20260826000000 sigue vigente); se repiten por si esta migración corre sobre
-- una base donde la función se recreó a mano.
REVOKE EXECUTE ON FUNCTION public.personal_usuarios_asignables(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.personal_usuarios_asignables(uuid) TO authenticated;
