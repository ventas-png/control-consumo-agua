-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261213000000_padron_rls_una_vez_por_consulta, ejercidas COMO
-- cada persona (SET ROLE authenticated + app.uid).
--
--   A · forma: ninguna función de la policy se llama por fila; la función nueva
--       no es de anon y sólo devuelve lo de quien llama
--   B · equivalencia: cada persona ve EXACTAMENTE lo que veía con las policies
--       anteriores (la foto `ht.antes`, tomada antes de migrar)
--   C · quién ve qué, dicho en claro
--
-- Contadores: M-1…M-4 y M-0 (de baja) en Uno · M-5 en Dos · M-9 de la vecina ·
--   M-N sin proyecto (de ACME) · M-X de ACME pero en el proyecto de la vecina.
-- Unidades: Casa 1 (Pérez; inquilina: López) y Casa 2 (López) en Uno · Casa Dos
--   · Casa ajena (de la vecina) · Sin proyecto · Cruzada (como M-X).
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
SET client_min_messages = notice;

CREATE FUNCTION ht.ok(p_nombre text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS DISTINCT FROM true THEN RAISE EXCEPTION 'FALLO %', p_nombre; END IF;
  RAISE NOTICE 'OK    %', p_nombre;
END $$;

-- El texto de una policy sin sus `( SELECT f(...) AS f)`: lo que queda se
-- evalúa por fila.
CREATE FUNCTION ht.por_fila(p_tabla text, p_policy text) RETURNS text LANGUAGE sql AS $$
  SELECT regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                        '\( SELECT (public\.)?[a-z_]+\([^()]*\) AS [a-z_]+\)', '', 'g')
    FROM pg_policies WHERE schemaname = 'public' AND tablename = p_tabla AND policyname = p_policy
$$;

CREATE FUNCTION ht.ve(p_tabla text, p_nombre text) RETURNS text LANGUAGE sql AS $$
  SELECT ht.visibles(p_tabla, p.uid) FROM ht.personas p WHERE p.nombre = p_nombre
$$;

-- Lo que devuelve la función nueva a una persona, como authenticated.
CREATE FUNCTION ht.mis_proyectos(p_nombre text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('app.uid', (SELECT uid::text FROM ht.personas WHERE nombre = p_nombre), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT COALESCE(string_agg(p.nombre, ', ' ORDER BY p.nombre COLLATE "C"), '-') INTO v
    FROM public.mis_proyectos_asignados() AS m(x) JOIN public.projects p ON p.id = m.x;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('app.uid', '', true);
  RETURN v;
END $$;

-- ── A · forma ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  -- Ni las funciones sin argumentos de fila, ni las que reciben el proyecto o
  -- la empresa DE LA FILA. `has_*_project_access(m.x)` sí puede quedar: corre
  -- una vez por proyecto del usuario, dentro de la subconsulta.
  v_sin  text := '(has_super_admin_access|current_user_role|get_my_company_id|get_my_cliente_id|user_has_permission|user_is_project_exempt)\(';
  v_fila text := '(has_company_owner_company_access|has_admin_project_access|has_operator_project_access|has_viewer_project_access|can_access_project)\(((contadores|unidades)\.)?(project_id|company_id)\)';
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contadores', 'unidades'] LOOP
    PERFORM ht.ok(format('A1 %s_select no llama por fila a ninguna función sin argumentos de fila', t),
      ht.por_fila(t, t || '_select') !~ v_sin);
    PERFORM ht.ok(format('A2 %s_select no llama a ninguna función con el proyecto o la empresa de la fila', t),
      ht.por_fila(t, t || '_select') !~ v_fila
      AND ht.por_fila(t, t || '_select') !~ 'can_access_project'
      AND ht.por_fila(t, t || '_select') ~ 'has_operator_project_access\(m\.x\)');
    PERFORM ht.ok(format('A3 %s sigue con una sola policy de lectura, para authenticated', t),
      (SELECT count(*) = 1 AND bool_and(roles = '{authenticated}' AND permissive = 'PERMISSIVE')
         FROM pg_policies WHERE tablename = t AND cmd = 'SELECT'));
  END LOOP;
  PERFORM ht.ok('A4 mis_proyectos_asignados: la ejecuta authenticated, no anon ni PUBLIC',
    has_function_privilege('authenticated', 'public.mis_proyectos_asignados()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.mis_proyectos_asignados()', 'EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                     WHERE p.oid = 'public.mis_proyectos_asignados()'::regprocedure AND a.grantee = 0));
  PERFORM ht.ok('A5 mis_proyectos_asignados devuelve los proyectos de quien llama: perfil y asignaciones, nada más',
    ht.mis_proyectos('Alma') = 'Condominio Dos' AND ht.mis_proyectos('Aldo') = 'Condominio Uno'
    AND ht.mis_proyectos('Vico') = 'Ajeno' AND ht.mis_proyectos('Ada') = '-' AND ht.mis_proyectos('Vera') = '-');
END $$;

-- ── B · equivalencia con las policies anteriores ────────────────────────────
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT a.* FROM ht.antes a ORDER BY a.nombre LOOP
    PERFORM ht.ok(format('B  %s ve lo mismo que antes (contadores: %s · unidades: %s)', p.nombre, p.contadores, p.unidades),
      ht.ve('contadores', p.nombre) = p.contadores AND ht.ve('unidades', p.nombre) = p.unidades);
  END LOOP;
  PERFORM ht.ok('B  la foto de antes cubre a las dieciséis personas', (SELECT count(*) FROM ht.antes) = 16);
END $$;

-- ── C · quién ve qué ────────────────────────────────────────────────────────
DO $$
DECLARE
  acme_c text := 'M-0, M-1, M-2, M-3, M-4, M-5, M-N, M-X';
  acme_u text := 'Casa 1, Casa 2, Casa Dos, Cruzada, Sin proyecto';
BEGIN
  PERFORM ht.ok('C1 la dueña ve todo lo de SU empresa (también lo sin proyecto) y nada de la vecina',
    ht.ve('contadores', 'Ada') = acme_c AND ht.ve('unidades', 'Ada') = acme_u
    AND ht.ve('contadores', 'Nadia') = 'M-9' AND ht.ve('unidades', 'Nadia') = 'Casa ajena');
  PERFORM ht.ok('C2 el super admin ve todo',
    ht.ve('contadores', 'Sol') = 'M-0, M-1, M-2, M-3, M-4, M-5, M-9, M-N, M-X'
    AND ht.ve('unidades', 'Sol') = 'Casa 1, Casa 2, Casa Dos, Casa ajena, Cruzada, Sin proyecto');
  PERFORM ht.ok('C3 el admin sin asignaciones (o con el proyecto sólo en su perfil) ve toda su empresa',
    ht.ve('contadores', 'Abel') = acme_c AND ht.ve('unidades', 'Abel') = acme_u
    AND ht.ve('contadores', 'Alma') = acme_c AND ht.ve('unidades', 'Alma') = acme_u);
  PERFORM ht.ok('C4 el admin con un proyecto asignado ve ése y lo sin proyecto, no el otro',
    ht.ve('contadores', 'Aldo') = 'M-0, M-1, M-2, M-3, M-4, M-N'
    AND ht.ve('unidades', 'Aldo') = 'Casa 1, Casa 2, Sin proyecto');
  PERFORM ht.ok('C5 la operadora ve su proyecto asignado y nada más (ni lo sin proyecto)',
    ht.ve('contadores', 'Olga') = 'M-5' AND ht.ve('unidades', 'Olga') = 'Casa Dos');
  PERFORM ht.ok('C6 un operador con el proyecto sólo en su perfil, sin asignación, no ve nada',
    ht.ve('contadores', 'Otto') = '-' AND ht.ve('unidades', 'Otto') = '-');
  PERFORM ht.ok('C7 el viewer asignado ve su proyecto',
    ht.ve('contadores', 'Lucía') = 'M-0, M-1, M-2, M-3, M-4' AND ht.ve('unidades', 'Lucía') = 'Casa 1, Casa 2'
    AND ht.ve('contadores', 'Beto') = 'M-0, M-1, M-2, M-3, M-4');
  PERFORM ht.ok('C8 con permiso y sin proyecto: sólo lo que no tiene proyecto',
    ht.ve('contadores', 'Vera') = 'M-N' AND ht.ve('unidades', 'Vera') = 'Sin proyecto');
  PERFORM ht.ok('C9 el permiso es por tabla: quien sólo puede ver unidades no ve contadores, aunque su perfil tenga un cliente',
    ht.ve('contadores', 'Omar') = '-' AND ht.ve('unidades', 'Omar') = 'Casa 1, Casa 2, Sin proyecto');
  PERFORM ht.ok('C10 sin permisos ni asignación no ve nada, aunque su perfil tenga un cliente',
    ht.ve('contadores', 'Curro') = '-' AND ht.ve('unidades', 'Curro') = '-');
  PERFORM ht.ok('C11 una asignación a un proyecto de otra empresa sigue valiendo lo mismo que antes',
    ht.ve('contadores', 'Vico') = 'M-9, M-X' AND ht.ve('unidades', 'Vico') = 'Casa ajena, Cruzada');
  PERFORM ht.ok('C12 la residente ve su unidad y sus contadores ACTIVOS',
    ht.ve('contadores', 'Pepa') = 'M-1, M-3, M-4' AND ht.ve('unidades', 'Pepa') = 'Casa 1');
  PERFORM ht.ok('C13 la inquilina ve la unidad que alquila, pero sólo los contadores de la unidad que es suya',
    ht.ve('contadores', 'Lola') = 'M-2' AND ht.ve('unidades', 'Lola') = 'Casa 1, Casa 2');
END $$;
