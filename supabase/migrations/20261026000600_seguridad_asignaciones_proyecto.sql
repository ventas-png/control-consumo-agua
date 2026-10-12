-- ════════════════════════════════════════════════════════════════════════════
-- SEGURIDAD · NADIE SE ASIGNA NI SE QUITA PROYECTOS A SÍ MISMO
-- user_project_assignments: escritura sólo por el PRINCIPAL de la empresa (su propietario,
-- dentro de SU empresa, o el superadministrador). Un administrador —acotado o sin filas— no
-- escribe esta tabla, y nadie toca su propio alcance salvo el propietario y el superadministrador.
--
-- QUÉ FALLABA (preexistente; producción = repositorio, verificado en solo lectura el 2026-10-10)
-- Las políticas INSERT / UPDATE / DELETE de public.user_project_assignments
-- (20260417000013_consolidate_rls_policies_part2.sql) terminaban en
-- `OR user_id = (SELECT auth.uid())`. Cualquier usuario autenticado, de cualquier
-- rol, podía:
--   · insertarse una asignación a CUALQUIER proyecto, también de otra empresa
--     (el project_id de la fila propia no se acotaba): un operador asignado a A se
--     asignaba B con un POST /rest/v1/user_project_assignments y desde ese momento
--     veía y actuaba en B;
--   · borrar sus propias asignaciones: un administrador con asignaciones borraba
--     las suyas y pasaba a ser «exento de proyecto» (administrador sin filas = ve
--     TODA la empresa, user_is_project_exempt());
--   · y, además, asignar a una persona de OTRA empresa a un proyecto propio: las
--     políticas comprobaban el proyecto pero nunca a la persona.
-- Como can_access_project(), user_is_project_exempt() y user_has_project_access()
-- leen esta tabla, el alcance por proyecto no era un límite real contra un usuario
-- hostil.
--
-- QUÉ CAMBIA
--   1. public.asignacion_puede_administrar(p_user_id, p_project_id): UNA sola regla
--      (SECURITY DEFINER, STABLE, search_path vacío) que usan las tres políticas de
--      escritura. Decisión del dueño del negocio (2026-10-11): quién ve qué proyecto lo decide
--      «el que tiene los permisos de la empresa y todos los proyectos», es decir, el PRINCIPAL:
--        · super_admin / superadmin  → cualquiera (cualquier empresa);
--        · company_owner             → persona Y proyecto de SU empresa (también a sí
--                                      mismo: es exento, su alcance no cambia);
--        · cualquier otro rol        → nada: ni el administrador (acotado o sin filas), ni
--                                      el operador, el visor, el cliente, una sesión sin fila en
--                                      app_users, ni quien sólo tenga un rol RBAC de «administrador».
--      PRINCIPAL = app_users.role, nunca «no tener filas». Un administrador sin filas es exento
--      de proyecto (user_is_project_exempt()) sólo por omisión, y ese estado se fabrica sin ser
--      principal: create-user, invite-user o un INSERT directo en user_invitations crean
--      administradores que nacen sin filas; otro administrador deja exento a uno borrando sus filas
--      o su último proyecto; y un administrador acotado con dos sesiones REPEATABLE READ se deja a
--      sí mismo sin filas (D-16). Si «sin filas» contara como principal, cada una de esas rutas
--      fabricaría un principal. Se usan las funciones que ya existen (is_super_admin(),
--      is_company_owner(), get_my_company_id()); no se crea ninguna.
--      Desaparecen la rama de administrador, su exclusión «nunca a sí mismo» (la cubren el trigger
--      de autoasignación y la política) y la condición «sólo proyectos que él ve» (D-1): sin
--      administradores que escriban no hay una vista parcial que reconciliar.
--      «Persona de su empresa» = existe en app_users con su misma company_id. Las
--      filas HUÉRFANAS (user_id sin app_users) no son administrables por el
--      propietario: sólo por el superadministrador o el rol de servicio. No se tocan ni se
--      «arreglan» aquí. Una empresa sin propietario sólo la administra el superadministrador.
--      El resto del cierre de D-2 (invitaciones, proyectos, roles y permisos de la empresa, funciones
--      de borde) va en la migración 20261026000700_autoridad_principal_empresa.sql.
--   2. Se reescriben SÓLO las políticas INSERT, UPDATE (USING y WITH CHECK) y DELETE,
--      con los mismos nombres, usando esa función. La política SELECT NO se toca
--      (cada persona sigue leyendo las suyas). Un UPSERT (INSERT … ON CONFLICT DO
--      UPDATE) queda cubierto por las políticas INSERT y UPDATE.
--   3. Trigger de INTEGRIDAD (trg_asignacion_empresa, BEFORE INSERT OR UPDATE OF
--      user_id, project_id): para CUALQUIER actor, también service_role y
--      superusuario, la empresa de la persona debe existir y ser IGUAL a la del
--      proyecto (ASIGNACION_EMPRESA_DISTINTA, check_violation). Valida sólo lo que se
--      escribe; no mira ni toca las filas existentes.
--   4. Trigger de AUTOASIGNACIÓN (trg_asignacion_propia, BEFORE INSERT OR UPDATE OR
--      DELETE): defensa en profundidad. Con una sesión de la API (auth.uid() no
--      nulo), tocar una fila propia exige ser propietario o superadministrador
--      (ASIGNACION_PROPIA_NO_PERMITIDA, insufficient_privilege). Si una política
--      permisiva futura reabriera el hueco, esto lo sigue cerrando. service_role y
--      superusuario (auth.uid() nulo) pasan.
--      Baja en cascada: un administrador que borra por la API un proyecto al que él mismo está asignado
--      SÍ puede (su alcance sólo se reduce y es un flujo legítimo del servidor) mientras conserve otra
--      asignación; si fuera su ÚLTIMA fila quedaría sin asignaciones y pasaría a ser exento, y eso se rechaza
--      (ASIGNACION_PROPIA_NO_PERMITIDA). Lo borra entonces el propietario o el superadministrador.
--      Esa comprobación («¿le queda otra fila?») se SERIALIZA con un candado de aviso POR EMPRESA (pg_advisory_xact_lock sobre
--      'asg-cascada:' || la empresa de la PERSONA cuya fila se borra, leída de app_users) tomado ANTES de mirar: sin él, dos sesiones que
--      borraran cada una uno de los dos únicos proyectos de un administrador veían cada una la fila de la otra como viva y lo dejaban con CERO
--      filas (carrera reproducida con dos sesiones reales). Por qué esa clave y no otra:
--        · NO por persona: la baja en cascada de un proyecto borra TAMBIÉN las filas de las demás personas asignadas a él, y esas filas ajenas no se
--          comprueban; con dos administradores que comparten {P1, P2}, cada uno borraba un proyecto, la cascada de cada sesión vaciaba la fila del
--          OTRO sin esperar y ambos quedaban con CERO filas y exentos (un candado por persona sólo ordena a las sesiones de la MISMA persona; tomar
--          además el de cada persona afectada exigiría varias claves en el orden en que la cascada recorra las filas, que no controlamos: con un retardo inyectado
--          tras cada candado, dos cascadas que recorren a dos administradores en orden inverso se interbloquean);
--        · NO global (la ronda anterior): una sola clave para toda la base dejaba a un propietario de CUALQUIER empresa —signup-company es público—
--          retener con una baja pesada las bajas de proyecto de TODAS las demás (medido con pgbench: la víctima de otra empresa pasaba de 212 a 0,5 transacciones/s; con la clave por empresa, de 209 a 193);
--        · SÍ por empresa de la persona: la integridad de empresa (trg_asignacion_empresa) garantiza que persona y proyecto son de la misma
--          empresa, y dos bajas que quitan filas de la MISMA persona comparten siempre esa clave. La clave sale de la PERSONA, no del actor ni del
--          proyecto. «Un propietario sólo puede retener el candado de SU empresa» vale con datos SANOS (medido); con datos heredados NO vale:
--          (a) con una fila cruzada anterior a este trigger (persona de C asignada a un proyecto de D) el propietario de D que borra ese proyecto retiene la clave
--          de C y las bajas del propietario de C esperan y fallan a los 2 s con 55P03 (denegación de servicio entre empresas, medida); (b) las personas SIN
--          empresa (company_id NULL) comparten UNA clave, 'asg-cascada:sin-empresa', entre TODAS las empresas, y el propietario de D bloquea al de C si
--          ambos borran proyectos con filas heredadas de personas sin empresa (medido); (c) con filas cruzadas una baja puede tomar DOS claves, en el orden en que
--          la cascada recorre las filas, y dos bajas con el orden inverso se interbloquean candado contra candado (40P01: PostgreSQL aborta una, no queda nada a
--          medias; medido con UNA sentencia por transacción). Los inquilinos no pueden fabricar esas filas (la RLS de app_users y projects y el trigger de
--          integridad lo rechazan): hace falta un dato heredado o al superadministrador. Producción, medido: 0 cruces; se ignora si las 9 personas sin empresa tienen filas.
--      Una fila HUÉRFANA (la persona no existe en app_users) no toma candado: sin rol no puede quedar exenta. Si una baja espera el candado más de
--      2 s (lock_timeout de la propia función, no del resto de la sesión) falla limpio con lock_not_available (55P03) en vez de ocupar una conexión hasta
--      el statement_timeout. Quien borra con service_role o como superusuario no pasa por el trigger ni toma el candado (D-6, V3-06): puede tomarlo a mano
--      con pg_advisory_xact_lock(hashtextextended('asg-cascada:' || <empresa>, 0)) si quiere ordenarse con las bajas hechas por la API.
--      Cuesta: dos bajas de proyecto de la MISMA empresa a la vez por la API se ejecutan una tras otra (es una operación rara).
--      LÍMITES MEDIDOS del candado (cuarta verificación independiente; docs/SEGURIDAD_ASIGNACIONES_PROYECTO.md, «Quinta ronda»). No son defectos que esta migración cierre:
--        · INTERBLOQUEO también con UNA sentencia por transacción. «0 interbloqueos» fue lo medido en las cargas probadas, NO una garantía. Con TRES peticiones de una sola
--          sentencia hay un ciclo determinista: una transacción ajena retiene la fila de app_users de la persona; (1) un UPDATE que mueve la asignación (persona, P1) a P2 bloquea esa
--          fila de la asignación y espera el FOR SHARE de app_users; (2) el DELETE de P1 toma el candado de la empresa y espera la fila de la asignación; (3) el DELETE de P2 espera
--          el candado; al confirmar la ajena, (1) pide FOR SHARE sobre projects(P2), que (3) tiene en borrado, y el ciclo se cierra. Desenlace limpio: 40P01 y ASIGNACION_EMPRESA_DISTINTA,
--          nada a medias (queda uno de P1/P2). Sin el candado ese entrelazado no se interbloquea. Alcanzable con peticiones legítimas simultáneas; exige una transacción ajena que retenga la fila de app_users.
--        · AISLAMIENTO REPEATABLE READ / SERIALIZABLE: el candado se toma, pero «¿le queda otra fila?» lee con la instantánea tomada ANTES de esperar. Un administrador, él solo con dos
--          sesiones, queda con 0 filas y exento (en SERIALIZABLE tampoco hay error 40001). Con READ COMMITTED (el valor por omisión) se rechaza bien. No es alcanzable por PostgREST (que no fija el
--          aislamiento por petición: por su documentación, no medido) pero sí con una conexión directa que lo elija. DECISIÓN ABIERTA, NO implementada: rechazar si
--          current_setting('transaction_isolation') <> 'read committed', o bloquear con FOR UPDATE las filas de la persona.
--        · El lock_timeout de 2 s es fijo en la función: ignora un lock_timeout MÁS ESTRICTO del llamador (con 200 ms en la sesión la espera falló a los 2 011 ms). Informativo.
--        · Sólo la baja EN CASCADA toma el candado: un UPDATE de user_id/project_id o un DELETE directo de una asignación no lo toman, y la carrera de uno de ellos con la baja en cascada
--          de otro administrador deja a la persona con 0 filas y exenta (medido). Es la clase ya documentada (D-2: otro administrador puede hacerlo él solo en serie).
--      Una sesión sin fila en app_users (rol NULL) tampoco pasa el trigger: la lógica trivaluada ya no
--      lo deja «abierto».
--   5. Privilegios: anon pierde TODOS (la RLS no le daba nada, pero el privilegio
--      estaba) y authenticated pierde TRUNCATE, TRIGGER y REFERENCES (TRUNCATE no
--      pasa por RLS). SELECT, INSERT, UPDATE y DELETE de authenticated NO SE TOCAN: la
--      migración ni los concede ni los quita (la RLS los gobierna fila por fila donde
--      existen). La misma higiene de 20261026000200 (compras y contabilidad).
--      Por qué no se «exigen» como un absoluto: una base construida SÓLO con migraciones
--      (Supabase Preview) deja a authenticated sin DML sobre esta tabla
--      ({postgres=arwdDxtm, anon=Dxtm, authenticated=Dxtm, service_role=Dxtm}), mientras
--      que producción tiene arwdDxtm; la primera versión de esta migración exigía el DML
--      y abortó ahí. Ahora el pre-vuelo anota cuáles tenía y el post-vuelo exige que
--      sigan IGUAL. (Que la cadena de migraciones no concede ese DML es una deuda previa,
--      ajena a esta migración: docs/SEGURIDAD_ASIGNACIONES_PROYECTO.md, «Lección de ACL».)
--
-- QUÉ SUPONE DEL ENTORNO (y lo comprueba el pre-vuelo, con un mensaje claro)
--   · existen los roles anon, authenticated y service_role, y auth.uid();
--   · quien corre la migración es el propietario de la tabla (o miembro de su rol): sin eso
--     DROP POLICY / REVOKE fallarían o no harían nada;
--   · nada del search_path de la sesión: el texto de pg_get_expr cambia con él («auth.uid()»
--     calificado, o «uid()» si auth está en el search_path) y el post-vuelo acepta las dos formas;
--   · nada más: ni la ACL por defecto de las funciones (cada REVOKE/GRANT de función es
--     explícito y converge al mismo estado; con la ACL por defecto de producción las dos funciones
--     de trigger conservan EXECUTE para service_role, inofensivo: una función de trigger no se puede
--     invocar directamente), ni privilegios de esquema, ni que el propietario sea o no superusuario.
--
-- QUÉ NO CAMBIA
--   · NINGUNA fila (la migración comprueba que el conteo y la huella md5 de
--     (id, user_id, project_id, permission_type) sean idénticos antes y después y
--     aborta si no lo son). Las asignaciones actuales se conservan tal cual,
--     incluidas las 10 huérfanas.
--   · La política SELECT, la columna permission_type (hoy todas «total»; nada la lee
--     para decidir acceso), user_has_project_access / can_access_project /
--     user_is_project_exempt, ni ninguna otra tabla.
--
-- DESPLIEGUE: va en SU PROPIO push a main —junto con 20261026000700_autoridad_principal_empresa.sql (2 archivos)—, ANTES de la serie 20261027… (PR #926) y
-- de 20261028… (PR #927): apply-migrations-prod.yml aplica sólo los .sql añadidos en
-- cada push y con tope MAX_APPLY = 10. Tabla pequeña; lo PRIMERO que hace es
-- LOCK TABLE … ACCESS EXCLUSIVE (lock_timeout de 5 s: si hay una transacción larga
-- sobre la tabla, falla limpia, sin dejar nada, y se reintenta) y sólo DESPUÉS mide
-- el conteo y la huella: una escritura legítima ya no puede colarse entre la medición
-- y el bloqueo (daba un falso «las filas CAMBIARON»). Antes de lanzarla conviene mirar
-- pg_stat_activity (transacciones largas) y elegir un horario tranquilo. Verificación posterior:
-- scripts/diagnostico-asignaciones-proyecto.sql. Tras el despliegue hay que
-- RECAPTURAR scripts/schema-drift/huella-produccion.json (cambian los grants, las
-- políticas y los triggers de esta tabla y hay tres funciones nuevas).
--
-- CÓMO REVERTIR: scripts/reversion-asignaciones-proyecto.sql (devuelve las cuatro
-- políticas a su texto original, quita triggers y funciones y restaura los
-- privilegios de PRODUCCIÓN: exacto con la ACL de producción; idempotente).
-- IMPACTO EN DATOS: ninguno.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── Pre-vuelo ────────────────────────────────────────────────────────────────
-- Exige lo que esta migración da por existente, BLOQUEA la tabla, guarda el conteo y
-- la huella de la tabla y los privilegios DML de authenticated (set_config local a
-- la transacción) e INFORMA —sin fallar— de lo que ya hay en los datos y que esta
-- migración no corrige.
DO $pre$
DECLARE
  v_faltan    text[] := ARRAY[]::text[];
  v_rol       text;
  v_n         bigint;
  v_huella    text;
  v_dml       text;
  v_huerfanas bigint;
  v_cruces    bigint;
  v_sin_filas bigint;
  v_admins    bigint;
  v_propiet   bigint;
  v_superad   bigint;
  v_emp_prop  bigint;
  v_sin_prop  bigint;
  v_filas_sin_prop bigint;
BEGIN
  IF to_regprocedure('public.is_super_admin()')           IS NULL THEN v_faltan := array_append(v_faltan, 'is_super_admin()'); END IF;
  IF to_regprocedure('public.is_company_owner()')         IS NULL THEN v_faltan := array_append(v_faltan, 'is_company_owner()'); END IF;
  IF to_regprocedure('public.current_user_role()')        IS NULL THEN v_faltan := array_append(v_faltan, 'current_user_role()'); END IF;
  IF to_regprocedure('public.get_my_company_id()')        IS NULL THEN v_faltan := array_append(v_faltan, 'get_my_company_id()'); END IF;
  IF to_regprocedure('public.can_access_project(uuid)')   IS NULL THEN v_faltan := array_append(v_faltan, 'can_access_project(uuid)'); END IF;
  IF to_regprocedure('public.user_is_project_exempt()')   IS NULL THEN v_faltan := array_append(v_faltan, 'user_is_project_exempt()'); END IF;
  IF to_regprocedure('public.user_has_project_access(uuid)') IS NULL THEN v_faltan := array_append(v_faltan, 'user_has_project_access(uuid)'); END IF;
  IF to_regclass('public.user_project_assignments') IS NULL THEN v_faltan := array_append(v_faltan, 'tabla user_project_assignments'); END IF;
  IF to_regclass('public.app_users')                IS NULL THEN v_faltan := array_append(v_faltan, 'tabla app_users'); END IF;
  IF to_regclass('public.projects')                 IS NULL THEN v_faltan := array_append(v_faltan, 'tabla projects'); END IF;
  IF to_regprocedure('auth.uid()')                  IS NULL THEN v_faltan := array_append(v_faltan, 'auth.uid()'); END IF;
  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = v_rol) THEN v_faltan := array_append(v_faltan, 'rol ' || v_rol); END IF;
  END LOOP;
  IF array_length(v_faltan, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (pre-vuelo): faltan % — la cadena de migraciones anterior está incompleta',
      array_to_string(v_faltan, ', ');
  END IF;
  -- quien corre la migración debe poder administrar la tabla (propietario o miembro de su rol); si no, DROP POLICY / REVOKE fallarían o no harían nada
  IF NOT pg_has_role(current_user, (SELECT c.relowner FROM pg_class c WHERE c.oid = 'public.user_project_assignments'::regclass), 'USAGE') THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (pre-vuelo): % no es el propietario de user_project_assignments (% lo es) ni miembro de su rol; corre la migración con el rol propietario',
      current_user, (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = 'public.user_project_assignments'::regclass);
  END IF;

  -- BLOQUEO ANTES DE MEDIR: con la tabla ya bloqueada (ACCESS EXCLUSIVE, bajo el lock_timeout) ninguna escritura legítima puede confirmarse entre la
  -- medición de abajo y el post-vuelo; antes se medía con ACCESS SHARE y el bloqueo llegaba después, con el primer DROP POLICY (falso «las filas CAMBIARON»).
  LOCK TABLE public.user_project_assignments IN ACCESS EXCLUSIVE MODE;

  SELECT count(*),
         md5(COALESCE(string_agg(upa.id::text || '|' || upa.user_id::text || '|' || upa.project_id::text || '|' || upa.permission_type,
                                 E'\n' ORDER BY upa.id), ''))
    INTO v_n, v_huella
    FROM public.user_project_assignments upa;
  PERFORM set_config('app.asg_pre_n', v_n::text, true);
  PERFORM set_config('app.asg_pre_huella', v_huella, true);

  -- Qué DML tiene authenticated HOY (esta migración no lo toca, así que el post-vuelo exige que siga igual). En producción son los cuatro; en una
  -- base construida sólo con migraciones (Supabase Preview) pueden ser ninguno: eso es del entorno, no un defecto de esta migración.
  v_dml := concat_ws(',',
             CASE WHEN has_table_privilege('authenticated', 'public.user_project_assignments', 'SELECT') THEN 'SELECT' END,
             CASE WHEN has_table_privilege('authenticated', 'public.user_project_assignments', 'INSERT') THEN 'INSERT' END,
             CASE WHEN has_table_privilege('authenticated', 'public.user_project_assignments', 'UPDATE') THEN 'UPDATE' END,
             CASE WHEN has_table_privilege('authenticated', 'public.user_project_assignments', 'DELETE') THEN 'DELETE' END);
  PERFORM set_config('app.asg_pre_dml', v_dml, true);

  SELECT count(*) INTO v_huerfanas
    FROM public.user_project_assignments upa
   WHERE NOT EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = upa.user_id);
  SELECT count(*) INTO v_cruces
    FROM public.user_project_assignments upa
    JOIN public.app_users u ON u.id = upa.user_id
    JOIN public.projects  p ON p.id = upa.project_id
   WHERE u.company_id IS DISTINCT FROM p.company_id;
  SELECT count(*) INTO v_sin_filas
    FROM public.app_users u
   WHERE u.role = 'admin'
     AND NOT EXISTS (SELECT 1 FROM public.user_project_assignments upa WHERE upa.user_id = u.id);
  SELECT count(*) INTO v_admins FROM public.app_users u WHERE u.role = 'admin';
  SELECT count(*) INTO v_propiet FROM public.app_users u WHERE u.role = 'company_owner';
  SELECT count(*) INTO v_superad FROM public.app_users u WHERE u.role IN ('super_admin', 'superadmin');
  SELECT count(DISTINCT u.company_id) INTO v_emp_prop FROM public.app_users u WHERE u.role = 'company_owner' AND u.company_id IS NOT NULL;
  -- empresas con filas de asignación (por la empresa del PROYECTO) y SIN propietario: tras esta migración sólo las administra el superadministrador
  SELECT count(DISTINCT p.company_id), count(*) INTO v_sin_prop, v_filas_sin_prop
    FROM public.user_project_assignments upa
    JOIN public.projects p ON p.id = upa.project_id
   WHERE NOT EXISTS (SELECT 1 FROM public.app_users o WHERE o.company_id = p.company_id AND o.role = 'company_owner');

  RAISE NOTICE 'asignaciones_proyecto (pre-vuelo): % filas, huella %', v_n, v_huella;
  RAISE NOTICE 'asignaciones_proyecto (pre-vuelo): authenticated tiene hoy [%] de SELECT/INSERT/UPDATE/DELETE; la migración no los toca', COALESCE(NULLIF(v_dml, ''), 'ninguno');
  RAISE NOTICE 'asignaciones_proyecto (pre-vuelo): % filas HUÉRFANAS (user_id sin app_users): no se tocan', v_huerfanas;
  RAISE NOTICE 'asignaciones_proyecto (pre-vuelo): % filas con empresa de la persona distinta de la del proyecto: no se tocan', v_cruces;
  RAISE NOTICE 'asignaciones_proyecto (pre-vuelo): PRINCIPALES (los únicos que escribirán la tabla): % propietarios en % empresas y % superadministradores', v_propiet, v_emp_prop, v_superad;
  RAISE NOTICE 'asignaciones_proyecto (pre-vuelo): % empresas con filas de asignación y SIN propietario (% filas): sólo las alcanzaría el superadministrador', v_sin_prop, v_filas_sin_prop;
  RAISE NOTICE 'asignaciones_proyecto (pre-vuelo): % administradores (% acotados con filas y % sin filas, exentos): ninguno escribirá la tabla; no son principales', v_admins, v_admins - v_sin_filas, v_sin_filas;
END
$pre$;

-- ── 1. Regla única: quién puede administrar una asignación ──────────────────
-- Sólo el principal de la empresa: el superadministrador, o el propietario sobre personas y proyectos de SU empresa. COALESCE: una sesión sin fila en app_users
-- (rol NULL) o sin sesión da false, nunca NULL.
CREATE OR REPLACE FUNCTION public.asignacion_puede_administrar(p_user_id uuid, p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    public.is_super_admin()
    OR (
      public.is_company_owner()
      -- la persona es de SU empresa (una huérfana o sin empresa no lo es)
      AND EXISTS (
        SELECT 1 FROM public.app_users u
         WHERE u.id = p_user_id AND u.company_id = public.get_my_company_id()
      )
      -- … y el proyecto también
      AND EXISTS (
        SELECT 1 FROM public.projects pr
         WHERE pr.id = p_project_id AND pr.company_id = public.get_my_company_id()
      )
    ),
    false
  )
$$;

COMMENT ON FUNCTION public.asignacion_puede_administrar(uuid, uuid) IS
  'Regla de las políticas de escritura de user_project_assignments: sólo el PRINCIPAL de la empresa. Superadministrador: cualquiera. Propietario (company_owner): personas y proyectos de SU empresa, también a sí mismo. Nadie más: ni el administrador (acotado o sin filas), ni operadores, visores, clientes ni una sesión sin app_users. La persona y el proyecto deben ser de la empresa de quien administra.';

REVOKE ALL ON FUNCTION public.asignacion_puede_administrar(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asignacion_puede_administrar(uuid, uuid) TO authenticated, service_role;

-- ── 2. Políticas de escritura (mismos nombres; la SELECT no se toca) ─────────
DROP POLICY IF EXISTS "user_project_assignments_insert" ON public.user_project_assignments;
CREATE POLICY "user_project_assignments_insert" ON public.user_project_assignments
  FOR INSERT TO authenticated
  WITH CHECK (public.asignacion_puede_administrar(user_id, project_id));

DROP POLICY IF EXISTS "user_project_assignments_update" ON public.user_project_assignments;
CREATE POLICY "user_project_assignments_update" ON public.user_project_assignments
  FOR UPDATE TO authenticated
  USING (public.asignacion_puede_administrar(user_id, project_id))
  WITH CHECK (public.asignacion_puede_administrar(user_id, project_id));

DROP POLICY IF EXISTS "user_project_assignments_delete" ON public.user_project_assignments;
CREATE POLICY "user_project_assignments_delete" ON public.user_project_assignments
  FOR DELETE TO authenticated
  USING (public.asignacion_puede_administrar(user_id, project_id));

-- ── 3. Trigger de integridad: la persona y el proyecto son de la MISMA empresa ──
CREATE OR REPLACE FUNCTION public.asignacion_validar_empresa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_emp_persona  uuid;
  v_emp_proyecto uuid;
  v_hay_persona  boolean;
  v_hay_proyecto boolean;
BEGIN
  -- FOR SHARE: si otra transacción está cambiando la empresa de la persona o del proyecto, esta escritura ESPERA a que termine y ve
  -- la empresa nueva (sin el candado se comparaba contra la empresa vieja y quedaba una fila cruzada: carrera reproducida y cerrada).
  SELECT true, u.company_id INTO v_hay_persona, v_emp_persona
    FROM public.app_users u WHERE u.id = NEW.user_id FOR SHARE OF u;
  SELECT true, p.company_id INTO v_hay_proyecto, v_emp_proyecto
    FROM public.projects p WHERE p.id = NEW.project_id FOR SHARE OF p;

  IF v_hay_persona IS NOT TRUE OR v_emp_persona IS NULL
     OR v_hay_proyecto IS NOT TRUE OR v_emp_proyecto IS NULL
     OR v_emp_persona <> v_emp_proyecto THEN
    RAISE EXCEPTION 'ASIGNACION_EMPRESA_DISTINTA: la persona y el proyecto deben pertenecer a la misma empresa'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- ── 4. Trigger de autoasignación (defensa en profundidad) ───────────────────
CREATE OR REPLACE FUNCTION public.asignacion_bloquear_propia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
  v_uid     uuid := (SELECT auth.uid());
  v_toca    boolean;
  v_hay     boolean;
  v_empresa uuid;
BEGIN
  -- service_role, superusuario y migraciones: sin sesión de la API
  IF v_uid IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- SERIALIZACIÓN POR EMPRESA DE LAS BAJAS EN CASCADA (R2-1, V3-01). La baja en cascada de un proyecto borra las filas de TODAS las personas asignadas a él,
  -- y sólo la de quien borra se comprueba (más abajo): dos administradores con los mismos dos proyectos, cada uno borrando uno distinto, vaciaban la fila
  -- del otro sin esperar y ambos quedaban sin filas (exentos). Por eso toda baja en cascada hecha con una sesión de la API —también la del propietario o la
  -- del superadministrador, cuya baja le quita la fila a un tercero— toma el candado de la EMPRESA de la persona cuya fila se borra, antes de mirar nada
  -- más: dos bajas que quitan filas de la misma persona comparten siempre la clave, y la segunda espera a la primera y, al entrar, la comprobación de
  -- abajo ve lo que ésta confirmó. La clave NO es global (la versión anterior lo era y un propietario de cualquier empresa podía retener las bajas de
  -- todas las demás) ni por persona (no ordena la fila ajena). Una fila huérfana (sin app_users) no toma candado: sin rol no puede quedar exenta.
  -- Va en sentencias PROPIAS y ANTES de la lectura que decide (la de «¿le queda otra fila?»): dentro de un AND no sirve, porque la instantánea ya está
  -- tomada cuando el candado se concede. Se libera solo al terminar la transacción; si no se concede en 2 s (lock_timeout de la función) falla con 55P03.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id) THEN
    SELECT true, u.company_id INTO v_hay, v_empresa FROM public.app_users u WHERE u.id = OLD.user_id;
    IF v_hay THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('asg-cascada:' || COALESCE(v_empresa::text, 'sin-empresa'), 0));
    END IF;
  END IF;

  v_toca := (TG_OP IN ('UPDATE', 'DELETE') AND OLD.user_id = v_uid)
         OR (TG_OP IN ('INSERT', 'UPDATE') AND NEW.user_id = v_uid);

  -- COALESCE en AMBOS lados: para una sesión sin fila en app_users current_user_role() es NULL y, sin COALESCE, `NOT (false OR NULL)` es NULL y el IF
  -- no se cumplía: el trigger «fallaba abierto» justo para quien no es nadie. Con NULL = false, esa sesión no es propietaria ni superadministradora.
  IF v_toca AND NOT (COALESCE(public.is_super_admin(), false) OR COALESCE(public.current_user_role() = 'company_owner', false)) THEN
    -- Baja EN CASCADA por borrar el proyecto (la fila padre ya no existe): se permite mientras la persona CONSERVE otra asignación, porque
    -- entonces su alcance sólo se reduce (borrar un proyecto al que se está asignado es un flujo legítimo del servidor). Si fuera su última
    -- fila quedaría sin asignaciones y, siendo administrador, pasaría a ser exento de proyecto: eso es justo lo que se impide. Esta lectura ya corre
    -- tras el candado de arriba, con una instantánea nueva.
    IF TG_OP = 'DELETE'
       AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id)
       AND EXISTS (SELECT 1 FROM public.user_project_assignments u WHERE u.user_id = OLD.user_id AND u.id <> OLD.id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'ASIGNACION_PROPIA_NO_PERMITIDA: nadie cambia sus propias asignaciones de proyecto; lo hace otro administrador, el propietario o el superadministrador'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

-- Funciones de trigger: nadie las invoca directamente.
REVOKE ALL ON FUNCTION public.asignacion_validar_empresa() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.asignacion_bloquear_propia() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_asignacion_empresa ON public.user_project_assignments;
CREATE TRIGGER trg_asignacion_empresa
  BEFORE INSERT OR UPDATE OF user_id, project_id ON public.user_project_assignments
  FOR EACH ROW EXECUTE FUNCTION public.asignacion_validar_empresa();

DROP TRIGGER IF EXISTS trg_asignacion_propia ON public.user_project_assignments;
CREATE TRIGGER trg_asignacion_propia
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_project_assignments
  FOR EACH ROW EXECUTE FUNCTION public.asignacion_bloquear_propia();

-- ── 5. Privilegios mínimos ──────────────────────────────────────────────────
REVOKE ALL ON TABLE public.user_project_assignments FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.user_project_assignments FROM authenticated;

-- ── Post-vuelo: las filas son IDÉNTICAS y todo lo esperado existe ────────────
DO $post$
DECLARE
  v_n         bigint;
  v_huella    text;
  v_cat       text;
  v_def       text;
  v_acl       text;
  v_dml       text;
  -- «auth.uid()» tal como lo imprime pg_get_expr: CALIFICADO («auth.uid()») salvo que el esquema auth esté en el search_path de la sesión (p. ej. un rol como
  -- supabase_admin, o PGOPTIONS='-c search_path=auth,public'), y entonces sale SIN calificar («uid()»). El texto del catálogo depende del search_path de
  -- quien corre la migración, así que la comprobación acepta las dos formas (antes sólo «auth.uid» y abortaba con un mensaje engañoso en el segundo caso).
  v_re_uid    constant text := E'\\m(auth\\.)?uid\\(\\)';
BEGIN
  SELECT count(*),
         md5(COALESCE(string_agg(upa.id::text || '|' || upa.user_id::text || '|' || upa.project_id::text || '|' || upa.permission_type,
                                 E'\n' ORDER BY upa.id), ''))
    INTO v_n, v_huella
    FROM public.user_project_assignments upa;
  IF v_n::text IS DISTINCT FROM current_setting('app.asg_pre_n', true)
     OR v_huella IS DISTINCT FROM current_setting('app.asg_pre_huella', true) THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (post-vuelo): las filas de user_project_assignments CAMBIARON (antes % / %, ahora % / %)',
      current_setting('app.asg_pre_n', true), current_setting('app.asg_pre_huella', true), v_n, v_huella;
  END IF;

  -- cuatro políticas con los nombres de siempre; las de escritura usan la función; la SELECT conserva la rama propia
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.user_project_assignments'::regclass) <> 4 THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (post-vuelo): user_project_assignments debe tener exactamente 4 políticas';
  END IF;
  FOREACH v_cat IN ARRAY ARRAY['insert', 'update', 'delete'] LOOP
    SELECT COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
      INTO v_def
      FROM pg_policy p
     WHERE p.polrelid = 'public.user_project_assignments'::regclass AND p.polname = 'user_project_assignments_' || v_cat;
    IF v_def IS NULL OR v_def !~ 'asignacion_puede_administrar' OR v_def ~ v_re_uid THEN
      RAISE EXCEPTION 'seguridad_asignaciones_proyecto (post-vuelo): la política % no usa la regla única o conserva la rama propia', v_cat;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p
     WHERE p.polrelid = 'public.user_project_assignments'::regclass AND p.polname = 'user_project_assignments_select'
       AND pg_get_expr(p.polqual, p.polrelid) ~ v_re_uid
  ) THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (post-vuelo): la política SELECT no existe o perdió la lectura de las propias';
  END IF;

  -- triggers y funciones
  IF (SELECT count(*) FROM pg_trigger t
       WHERE t.tgrelid = 'public.user_project_assignments'::regclass AND NOT t.tgisinternal
         AND t.tgname IN ('trg_asignacion_empresa', 'trg_asignacion_propia') AND t.tgenabled = 'O') <> 2 THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (post-vuelo): faltan los triggers trg_asignacion_empresa / trg_asignacion_propia';
  END IF;
  IF to_regprocedure('public.asignacion_puede_administrar(uuid,uuid)') IS NULL
     OR to_regprocedure('public.asignacion_validar_empresa()') IS NULL
     OR to_regprocedure('public.asignacion_bloquear_propia()') IS NULL THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (post-vuelo): faltan funciones';
  END IF;
  -- la regla es la del principal: usa is_company_owner() y ya no nombra al administrador (un cuerpo viejo, o uno que lo readmitiera, aborta aquí)
  IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.asignacion_puede_administrar(uuid,uuid)'::regprocedure) !~ 'is_company_owner'
     OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.asignacion_puede_administrar(uuid,uuid)'::regprocedure) ~ '''admin''' THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (post-vuelo): asignacion_puede_administrar no es la regla del principal (debe usar is_company_owner() y no nombrar al administrador)';
  END IF;
  IF has_function_privilege('anon', 'public.asignacion_puede_administrar(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.asignacion_puede_administrar(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (post-vuelo): EXECUTE de asignacion_puede_administrar mal repartido';
  END IF;

  -- funciones de trigger: nadie las invoca (el REVOKE de arriba las deja sin EXECUTE para PUBLIC, anon y authenticated, sea cual sea la ACL por defecto)
  IF has_function_privilege('anon', 'public.asignacion_validar_empresa()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.asignacion_validar_empresa()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.asignacion_bloquear_propia()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.asignacion_bloquear_propia()', 'EXECUTE') THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (post-vuelo): EXECUTE de las funciones de trigger mal repartido';
  END IF;

  -- privilegios de la tabla, RELATIVOS a lo que había: la migración sólo QUITA (anon todo; authenticated TRUNCATE, TRIGGER, REFERENCES) y no concede ni
  -- retira el DML de authenticated; exigirlo como absoluto abortó en Supabase Preview (ahí authenticated no lo tenía).
  SELECT c.relacl::text INTO v_acl FROM pg_class c WHERE c.oid = 'public.user_project_assignments'::regclass;
  IF has_table_privilege('anon', 'public.user_project_assignments', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
                 WHERE c.oid = 'public.user_project_assignments'::regclass AND a.grantee = 'anon'::regrole) THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (post-vuelo): anon conserva privilegios sobre user_project_assignments (ACL %)', v_acl;
  END IF;
  IF has_table_privilege('authenticated', 'public.user_project_assignments', 'TRUNCATE, REFERENCES, TRIGGER') THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (post-vuelo): authenticated conserva TRUNCATE, REFERENCES o TRIGGER sobre user_project_assignments (ACL %)', v_acl;
  END IF;
  v_dml := concat_ws(',',
             CASE WHEN has_table_privilege('authenticated', 'public.user_project_assignments', 'SELECT') THEN 'SELECT' END,
             CASE WHEN has_table_privilege('authenticated', 'public.user_project_assignments', 'INSERT') THEN 'INSERT' END,
             CASE WHEN has_table_privilege('authenticated', 'public.user_project_assignments', 'UPDATE') THEN 'UPDATE' END,
             CASE WHEN has_table_privilege('authenticated', 'public.user_project_assignments', 'DELETE') THEN 'DELETE' END);
  IF v_dml IS DISTINCT FROM current_setting('app.asg_pre_dml', true) THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (post-vuelo): el DML de authenticated CAMBIÓ (antes [%], ahora [%]) y esta migración no lo toca (ACL %)',
      current_setting('app.asg_pre_dml', true), v_dml, v_acl;
  END IF;

  RAISE NOTICE 'asignaciones_proyecto (post-vuelo): % filas, huella % — idénticas a las de antes; 4 políticas, 2 triggers, 3 funciones; anon sin privilegios, authenticated sin TRUNCATE/TRIGGER/REFERENCES y con el mismo DML que tenía [%]',
    v_n, v_huella, COALESCE(NULLIF(v_dml, ''), 'ninguno');
END
$post$;

COMMIT;
