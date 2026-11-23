-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261212000000_lecturas_rls_una_vez_por_consulta, ejercidas
-- COMO cada persona (SET ROLE authenticated + app.uid + app.aal).
--
--   A · forma: ninguna función de la policy se llama por fila
--   B · equivalencia: cada persona ve EXACTAMENTE lo que veía con las policies
--       anteriores (la foto `ht.antes`, tomada antes de migrar)
--   C · quién ve qué, dicho en claro (lecturas R1…R7, bitácora B1/B2)
--   D · escritura: la puerta de MFA sigue cerrando el INSERT
--
-- Lecturas: R1 Uno/M-1/Pérez · R2 Dos · R3 de la vecina · R4 sin proyecto/Pérez
--   · R5 sin proyecto/López (cliente de la vecina) · R6 Uno/M-2 (Casa de los
--   López) · R7 Uno/M-0 (contador dado de baja, Casa de los Pérez)
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
  SELECT ht.visibles(p_tabla, p.uid, p.aal) FROM ht.personas p WHERE p.nombre = p_nombre
$$;

-- ── A · forma ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_fn text := '(is_super_admin|current_user_role|get_my_company_id|get_my_cliente_id|user_has_permission|mfa_requirement_met)\(';
BEGIN
  PERFORM ht.ok('A1 registros_select no llama por fila a ninguna función sin argumentos de fila',
    ht.por_fila('registros', 'registros_select') !~ v_fn);
  PERFORM ht.ok('A2 registros_select no llama a can_access_project con el proyecto de la fila',
    ht.por_fila('registros', 'registros_select') !~ 'can_access_project\((registros\.)?project_id\)'
    AND ht.por_fila('registros', 'registros_select') ~ 'can_access_project\(p\.id\)');
  PERFORM ht.ok('A3 la puerta de MFA de registros se evalúa una vez (USING y WITH CHECK)',
    ht.por_fila('registros', 'mfa_gate_aal2') !~ v_fn
    AND (SELECT permissive = 'RESTRICTIVE' AND cmd = 'ALL' AND qual IS NOT NULL AND with_check IS NOT NULL
           FROM pg_policies WHERE tablename = 'registros' AND policyname = 'mfa_gate_aal2'));
  PERFORM ht.ok('A4 bitacora_acciones_select no llama por fila a ninguna función',
    ht.por_fila('bitacora_acciones', 'bitacora_acciones_select') !~ v_fn);
  PERFORM ht.ok('A5 siguen siendo las mismas policies: ni una más ni una menos',
    (SELECT count(*) FROM pg_policies WHERE tablename = 'registros') = 3
    AND (SELECT count(*) FROM pg_policies WHERE tablename = 'bitacora_acciones') = 1);
END $$;

-- ── B · equivalencia con las policies anteriores ────────────────────────────
DO $$
DECLARE p record; v_r text; v_b text;
BEGIN
  FOR p IN SELECT a.* FROM ht.antes a ORDER BY a.nombre LOOP
    v_r := ht.ve('registros', p.nombre);
    v_b := ht.ve('bitacora_acciones', p.nombre);
    PERFORM ht.ok(format('B  %s ve lo mismo que antes (lecturas %s · bitácora %s)', p.nombre, p.registros, p.bitacora),
      v_r = p.registros AND v_b = p.bitacora);
  END LOOP;
  PERFORM ht.ok('B  la foto de antes cubre a las diez personas', (SELECT count(*) FROM ht.antes) = 10);
END $$;

-- ── C · quién ve qué ────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM ht.ok('C1 la dueña ve todos los proyectos de su empresa y lo sin proyecto de SUS clientes, nada ajeno',
    ht.ve('registros', 'Ada') = '12467');
  PERFORM ht.ok('C2 quien tiene un proyecto asignado ve ése (y lo sin proyecto), no el otro proyecto',
    ht.ve('registros', 'Lucía') = '1467');
  PERFORM ht.ok('C3 con permiso pero sin proyecto asignado: sólo lo que no tiene proyecto',
    ht.ve('registros', 'Vera') = '4');
  PERFORM ht.ok('C4 sin permiso de lectura no ve nada, aunque capture',
    ht.ve('registros', 'Beto') = '-');
  PERFORM ht.ok('C5 personal sin permisos no ve nada, aunque su perfil tenga un cliente',
    ht.ve('registros', 'Curro') = '-');
  PERFORM ht.ok('C6 la empresa vecina ve lo suyo y sólo lo suyo',
    ht.ve('registros', 'Nadia aal2') = '35');
  PERFORM ht.ok('C7 si su empresa exige MFA y no lo pasó, no ve nada',
    ht.ve('registros', 'Nadia aal1') = '-');
  PERFORM ht.ok('C8 el super admin ve todo',
    ht.ve('registros', 'Sol') = '1234567');
  PERFORM ht.ok('C9 la residente ve sus cobros y los de sus contadores ACTIVOS, no el dado de baja ni la casa vecina',
    ht.ve('registros', 'Pepa') = '14');
  PERFORM ht.ok('C10 la otra residente ve los suyos',
    ht.ve('registros', 'Lola') = '56');
  PERFORM ht.ok('C11 bitácora: la ve su empresa con el permiso, no la vecina ni quien no lo tiene',
    ht.ve('bitacora_acciones', 'Ada') = '1' AND ht.ve('bitacora_acciones', 'Vera') = '1'
    AND ht.ve('bitacora_acciones', 'Lucía') = '-' AND ht.ve('bitacora_acciones', 'Pepa') = '-'
    AND ht.ve('bitacora_acciones', 'Nadia aal2') = '2' AND ht.ve('bitacora_acciones', 'Sol') = '12');
END $$;

-- ── D · escritura: MFA ──────────────────────────────────────────────────────
CREATE FUNCTION ht.inserta(p_uid uuid, p_aal text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text := 'sin error';
BEGIN
  PERFORM set_config('app.uid', p_uid::text, true), set_config('app.aal', p_aal, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.registros (contador_id, project_id, fecha, lectura_actual, consumo)
    VALUES ('c0000000-0000-0000-0000-000000000009', '22222222-0000-0000-0000-000000000001', now(), 99, 1);
  EXCEPTION WHEN OTHERS THEN v := SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('app.uid', '', true), set_config('app.aal', '', true);
  RETURN v;
END $$;

DO $$
BEGIN
  PERFORM ht.ok('D1 sin MFA la dueña de la empresa que lo exige no puede insertar una lectura',
    ht.inserta('e0000000-0000-0000-0000-000000000003', 'aal1') = '42501');
  PERFORM ht.ok('D2 con MFA sí',
    ht.inserta('e0000000-0000-0000-0000-000000000003', 'aal2') = 'sin error');
END $$;
