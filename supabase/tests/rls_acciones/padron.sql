-- ============================================================================
-- PADRÓN FIJO del arnés «rls_acciones»: dos empresas con un condominio y una
-- unidad cada una, un cliente con su usuario residente (RES), y el admin de
-- cada empresa. Las personas con UNA acción de UNA pestaña las crea el
-- orquestador a partir del mapa de la sección (usuarios.sql).
--
-- `auth.uid()` sale del GUC `request.jwt.claim.sub` (bootstrap.sql).
-- ============================================================================
\set ON_ERROR_STOP on

INSERT INTO ra.ids (alias, id) VALUES
  ('A',    'c0000000-0000-0000-0000-00000000000a'),
  ('B',    'c0000000-0000-0000-0000-00000000000b'),
  ('A1',   'c1000000-0000-0000-0000-0000000000a1'),
  ('B1',   'c1000000-0000-0000-0000-0000000000b1'),
  ('UA',   'c6000000-0000-0000-0000-0000000000a1'),
  ('UB',   'c6000000-0000-0000-0000-0000000000b1'),
  ('CLI',  'c5000000-0000-0000-0000-000000000001'),
  ('ADM',  'c2000000-0000-0000-0000-00000000000a'),
  ('ADMB', 'c2000000-0000-0000-0000-00000000000b');

INSERT INTO public.companies (id, nombre, max_units) VALUES
  (ra.id('A'), 'Empresa A (rls_acciones)', 1000),
  (ra.id('B'), 'Empresa B (rls_acciones)', 1000);

INSERT INTO public.projects (id, company_id, nombre, tipo) VALUES
  (ra.id('A1'), ra.id('A'), 'Condominio A1', 'condominios'),
  (ra.id('B1'), ra.id('B'), 'Condominio B1', 'condominios');

INSERT INTO public.clientes (id, nombre, codigo) VALUES (ra.id('CLI'), 'Residente (rls_acciones)', 'RLA-1');

INSERT INTO public.unidades (id, project_id, company_id, nombre, cliente_id) VALUES
  (ra.id('UA'), ra.id('A1'), ra.id('A'), 'Unidad A1-1', ra.id('CLI')),
  (ra.id('UB'), ra.id('B1'), ra.id('B'), 'Unidad B1-1', NULL);

INSERT INTO ra.ids (alias, id) VALUES ('RES', 'c2000000-0000-0000-0000-0000000000c1');
INSERT INTO auth.users (id) VALUES (ra.id('ADM')), (ra.id('ADMB')), (ra.id('RES'));
INSERT INTO public.app_users (id, company_id, full_name, role, cliente_id) VALUES
  (ra.id('ADM'),  ra.id('A'), 'Admin A (rls_acciones)', 'admin', NULL),
  (ra.id('ADMB'), ra.id('B'), 'Admin B (rls_acciones)', 'admin', NULL),
  -- El residente: «cliente» dueño de la unidad UA. Sus ramas en las policies no
  -- dependen de ningún permiso de tab; la migración no debe cambiarlas.
  (ra.id('RES'),  ra.id('A'), 'Residente (rls_acciones)', 'cliente', ra.id('CLI'));

INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
  (ra.id('ADM'),  ra.id('A1'), 'total'),
  (ra.id('ADMB'), ra.id('B1'), 'total');

-- Lo que cada persona intentó, y con qué resultado. Lo escribe la sesión de la
-- persona (por eso es de todos) DESPUÉS de deshacer el intento.
CREATE TABLE ra.resultados (usuario text, tabla text, cmd text, resultado text);
GRANT SELECT, INSERT ON ra.resultados TO PUBLIC;

CREATE FUNCTION ra.como(p_alias text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', ra.id(p_alias)::text, false);
END;
$$;
GRANT EXECUTE ON FUNCTION ra.como(text) TO PUBLIC;
