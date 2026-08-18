-- ════════════════════════════════════════════════════════════════════════════
-- El empleado y su usuario de ingreso: un vínculo explícito
-- ════════════════════════════════════════════════════════════════════════════
-- PROBLEMA. `personal_condominio` es el expediente de la persona (nombre, DPI,
-- IGSS, salario, turno, equipo asignado) y `app_users` es la cuenta con la que
-- alguien entra al sistema. Hoy no hay NADA que los una. La consecuencia se ve
-- en las dos puntas de la operación:
--
--   · Hacia adelante — `bloques_turno.personal_id` asigna trabajo a un EMPLEADO,
--     pero cuando ese empleado abre la app entra como un `app_users` que el
--     sistema no sabe relacionar con ninguna ficha. No hay forma de contestar
--     «muéstrame MIS tareas» sin adivinar por nombre.
--   · Hacia atrás — `creado_por` (20260731000000) sella qué CUENTA tecleó cada
--     fila, y `actividad_equipo` (20260731000300) la agrega. Ambas hablan de
--     `app_users`. Para leerlas como «qué hizo el conserje Villatoro» hay que
--     cruzar a mano un nombre de pila con un correo, y en la práctica nadie lo
--     hace: la trazabilidad existe pero es ilegible.
--
-- El único puente que hoy existe es el nombre escrito a mano, y es exactamente
-- la clase de vínculo que esta base ya se cansó de pagar (`presencia_personal`
-- guardaba `nombre` de texto libre hasta 20260820000000, y el cómputo de horas
-- por persona era imposible).
--
-- QUÉ HACE
--   1. `personal_condominio.user_id` → FK a `app_users`. Opcional a propósito:
--      la mayoría del personal operativo NO tiene cuenta, y su ficha debe poder
--      existir igual. ON DELETE SET NULL porque dar de baja una cuenta no borra
--      el expediente laboral de la persona.
--   2. Índice único parcial por (project_id, user_id): una cuenta, a lo sumo un
--      expediente POR CONDOMINIO. Se elige el proyecto y no la empresa porque un
--      supervisor puede tener ficha en dos condominios de la misma empresa, y
--      porque la pregunta que se va a hacer siempre es «¿qué empleado es este
--      usuario AQUÍ?» — que con este índice se resuelve por índice único.
--   3. Trigger que rechaza vincular una cuenta de OTRA empresa. La policy de la
--      tabla solo comprueba `company_id = get_my_company_id()` de la FILA; sin
--      este trigger, un cliente malicioso que conociera un uuid ajeno podría
--      escribirlo en `user_id` y dejar sembrado un vínculo cross-tenant para
--      cuando algo lo lea. La FK sola no lo impide: apunta a `app_users` sin
--      mirar de qué empresa es.
--   4. `personal_usuarios_asignables(project)` → el catálogo que necesita el
--      selector: quién puede vincularse, con qué correo entra, si su cuenta está
--      activa, si tiene acceso a ESTE condominio y si ya está tomado por otro
--      empleado. Es un RPC y no un SELECT desde el navegador porque la policy
--      `app_users_select` solo deja enumerar la empresa a `company_owner`/`admin`
--      (20260417000012): un administrador de condominio con rol de plataforma
--      `operator` —el caso normal desde el RBAC de 20260518000008— vería la
--      lista vacía y creería que no hay usuarios que asignar.
--
-- PERMISOS. Vincular se gobierna con el permiso del propio tab
-- (`condominios.tab.personal`), que es el que ya gobierna leer y editar la ficha
-- por RLS. No se pide uno mayor porque el vínculo NO otorga nada: es metadato: lo
-- que cada quien puede hacer lo siguen decidiendo su rol y sus permisos, no esta
-- columna. Quien puede ver la ficha ya ve datos más sensibles (salario, cuenta
-- bancaria, DPI) que el correo de un compañero de trabajo.
--
-- SIN BACKFILL. Casar por nombre o por `personal_condominio.email` sería adivinar
-- —y un vínculo de identidad adivinado es peor que ninguno: firma actos de una
-- persona con el expediente de otra. Se asigna a mano, una vez, desde el tab.
--
-- REVERSIÓN
--   DROP TRIGGER IF EXISTS trg_personal_valida_usuario ON public.personal_condominio;
--   DROP FUNCTION IF EXISTS public.personal_validar_usuario();
--   DROP FUNCTION IF EXISTS public.personal_usuarios_asignables(uuid);
--   DROP INDEX  IF EXISTS public.personal_condominio_user_unico_por_proyecto;
--   ALTER TABLE public.personal_condominio DROP COLUMN IF EXISTS user_id;
--
-- Idempotente: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
-- CREATE OR REPLACE / DROP TRIGGER IF EXISTS antes del CREATE TRIGGER.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. La columna ───────────────────────────────────────────────────────────
-- ADD COLUMN con default NULL no reescribe la tabla (PG ≥ 11): sin lock largo.
ALTER TABLE public.personal_condominio
  ADD COLUMN IF NOT EXISTS user_id uuid
    REFERENCES public.app_users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.personal_condominio.user_id IS
  'Cuenta de ingreso (app_users) que usa este empleado. NULL = sin cuenta (el caso normal del personal operativo). Une el expediente con lo que la cuenta ejecuta: creado_por, actividad_equipo y la asignación de tareas. No otorga permisos por sí solo.';

-- ── 2. Una cuenta, un expediente por condominio ─────────────────────────────
-- Parcial (WHERE user_id IS NOT NULL) porque el NULL es el caso mayoritario y
-- varios NULL deben poder convivir: en un índice único normal Postgres los
-- toleraría (NULL nunca es igual a NULL), pero el parcial además los deja fuera
-- del índice, que en una tabla donde casi nadie tiene cuenta es todo el índice.
CREATE UNIQUE INDEX IF NOT EXISTS personal_condominio_user_unico_por_proyecto
  ON public.personal_condominio (project_id, user_id)
  WHERE user_id IS NOT NULL;

-- ── 3. El vínculo no cruza empresas ─────────────────────────────────────────
-- SECURITY DEFINER porque tiene que LEER `app_users` para saber de qué empresa
-- es la cuenta, y quien edita la ficha no siempre puede leer esa fila
-- (`app_users_select` solo abre la empresa a company_owner/admin): con SECURITY
-- INVOKER el EXISTS daría falso para un operador y rechazaría vínculos legítimos.
CREATE OR REPLACE FUNCTION public.personal_validar_usuario()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = NEW.user_id
      AND u.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'La cuenta indicada no pertenece a la empresa de este empleado'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.personal_validar_usuario() IS
  'Rechaza vincular un empleado con una cuenta de app_users de otra empresa. La FK sola no lo impide y la policy de la tabla solo mira el company_id de la fila.';

DROP TRIGGER IF EXISTS trg_personal_valida_usuario ON public.personal_condominio;
-- WHEN: solo se valida cuando hay algo que validar. Desvincular (user_id → NULL)
-- y editar el teléfono de alguien sin cuenta no pagan la consulta.
CREATE TRIGGER trg_personal_valida_usuario
  BEFORE INSERT OR UPDATE ON public.personal_condominio
  FOR EACH ROW
  WHEN (NEW.user_id IS NOT NULL)
  EXECUTE FUNCTION public.personal_validar_usuario();

-- Función de trigger: nadie la invoca vía PostgREST. Postgres verifica el
-- EXECUTE al hacer CREATE TRIGGER, no en cada disparo, así que revocarle
-- authenticated no rompe la escritura (precedente y verificación:
-- 20260825010000 · supabase/tests/security_definer_anon).
REVOKE EXECUTE ON FUNCTION public.personal_validar_usuario() FROM PUBLIC, anon, authenticated;

-- ── 4. Catálogo de cuentas asignables ───────────────────────────────────────
-- Devuelve TODAS las cuentas de staff de la empresa del proyecto, no solo las
-- libres: el selector tiene que poder mostrar «ya es Juan Pérez» para explicar
-- por qué no se puede elegir, y tiene que resolver el nombre de la cuenta que la
-- ficha YA tiene vinculada. Las cuentas de residente (`role = 'cliente'`) quedan
-- fuera por definición — no son personal, y además no tienen company_id
-- (20260801000400), así que el filtro de empresa ya las excluiría.
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

  RETURN QUERY
  SELECT
    u.id,
    COALESCE(
      NULLIF(btrim(u.full_name), ''),
      NULLIF(split_part(au.email::text, '@', 1), ''),
      'Usuario ' || left(u.id::text, 8)
    ),
    au.email::text,
    COALESCE(u.role, '—'),
    u.activo,
    -- Espeja can_access_project() (20260815000000) pero para la cuenta LISTADA,
    -- no para el llamador: el selector avisa cuando la cuenta que se va a
    -- vincular todavía no ve este condominio, que es justo lo que impediría que
    -- la persona registre nada aquí.
    --
    -- COALESCE porque `u.project_id = p_project_id` da NULL —no false— cuando la
    -- cuenta no tiene proyecto sellado, y ese NULL se propaga por todo el OR:
    -- la columna es boolean y ninguna cuenta debe salir con "no se sabe".
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
    ),
    pc.id,
    pc.nombre
  FROM public.app_users u
  LEFT JOIN auth.users au
    ON au.id = u.id
  LEFT JOIN public.personal_condominio pc
    ON pc.user_id = u.id AND pc.project_id = p_project_id
  WHERE u.company_id = v_company
    AND COALESCE(u.role, '') <> 'cliente'
  ORDER BY u.activo DESC, 2 ASC;
END;
$$;

COMMENT ON FUNCTION public.personal_usuarios_asignables(uuid) IS
  'Cuentas de staff de la empresa del proyecto para el selector "usuario de ingreso" del tab Personal: nombre, correo, rol, si está activa, si tiene acceso al proyecto y a qué empleado está ya vinculada. Exige el permiso condominios.tab.personal. Existe porque app_users_select solo deja enumerar la empresa a company_owner/admin.';

-- CREATE FUNCTION concede EXECUTE a PUBLIC por defecto y `anon` lo hereda
-- (clase #378/#380, cerrada en 20260825010000): se revoca en la misma migración
-- que la crea y se otorga explícitamente a `authenticated`, que es quien la
-- llama desde el tab.
REVOKE EXECUTE ON FUNCTION public.personal_usuarios_asignables(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.personal_usuarios_asignables(uuid) TO authenticated;
