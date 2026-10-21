-- ============================================================================
-- PADRÓN DE LA SUITE «borrado_por_permiso» (20261103000200)
--
-- Se carga sobre la cadena REAL de migraciones: lo que se prueba son las
-- policies que de verdad tiene el repositorio, con los helpers de RBAC reales.
--
-- Dos empresas: A (la de las filas) y B (la vecina, con el MISMO permiso).
-- Personas de A (todas «operator» salvo ADM):
--   VER   ve los cinco tabs, nada más
--   EDI   ve y EDITA los cinco tabs (sin «Eliminar»)
--   BOR   ve los cinco tabs y tiene «Eliminar» en cada uno
--   LEG   ve los cinco tabs + el par legado platform.condominios.view/.delete
--   OCU   tiene «Eliminar» en los cinco tabs pero NO los ve (tab oculto)
--   ADM   company_owner/admin de A: exento, sin roles granulares
-- Y BORB, de la empresa B, con visibilidad y «Eliminar» en los cinco tabs.
--
-- Filas de A, una por tabla: INC, ASA, CHK, POB y el ticket vivo TKT. Además
-- TKB, un ticket ya dado de baja (para restaurar).
--
-- Todo lo de la prueba vive en el esquema «bp»: no toca el catálogo de public.
-- `auth.uid()` sale del GUC `request.jwt.claim.sub` (bootstrap.sql).
-- ============================================================================
\set ON_ERROR_STOP on

CREATE SCHEMA bp;
GRANT USAGE ON SCHEMA bp TO PUBLIC;

CREATE TABLE bp.ids (alias text PRIMARY KEY, id uuid NOT NULL UNIQUE);
GRANT SELECT ON bp.ids TO PUBLIC;

CREATE FUNCTION bp.id(p_alias text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM bp.ids WHERE alias = p_alias $$;

INSERT INTO bp.ids (alias, id) VALUES
  ('A',    'b0000000-0000-0000-0000-00000000000a'),
  ('B',    'b0000000-0000-0000-0000-00000000000b'),
  ('A1',   'b1000000-0000-0000-0000-0000000000a1'),
  ('B1',   'b1000000-0000-0000-0000-0000000000b1'),
  ('VER',  'b2000000-0000-0000-0000-000000000001'),
  ('EDI',  'b2000000-0000-0000-0000-000000000002'),
  ('BOR',  'b2000000-0000-0000-0000-000000000003'),
  ('LEG',  'b2000000-0000-0000-0000-000000000004'),
  ('OCU',  'b2000000-0000-0000-0000-000000000005'),
  ('ADM',  'b2000000-0000-0000-0000-000000000006'),
  ('BORB', 'b2000000-0000-0000-0000-000000000007'),
  ('R_VER',  'b3000000-0000-0000-0000-000000000001'),
  ('R_EDI',  'b3000000-0000-0000-0000-000000000002'),
  ('R_BOR',  'b3000000-0000-0000-0000-000000000003'),
  ('R_LEG',  'b3000000-0000-0000-0000-000000000004'),
  ('R_OCU',  'b3000000-0000-0000-0000-000000000005'),
  ('R_BORB', 'b3000000-0000-0000-0000-000000000007'),
  ('INC',  'b4000000-0000-0000-0000-000000000001'),
  ('ASA',  'b4000000-0000-0000-0000-000000000002'),
  ('CHK',  'b4000000-0000-0000-0000-000000000003'),
  ('POB',  'b4000000-0000-0000-0000-000000000004'),
  ('TKT',  'b4000000-0000-0000-0000-000000000005'),
  ('TKB',  'b4000000-0000-0000-0000-000000000006');

-- ── Comprobaciones ──────────────────────────────────────────────────────────
CREATE FUNCTION bp.chk(actual boolean, esperado boolean, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '% — esperado %, recibido %', msg, esperado, actual;
  END IF;
  RAISE NOTICE '✓ %', msg;
END;
$$;

CREATE FUNCTION bp.como(p_alias text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', bp.id(p_alias)::text, false);
END;
$$;

-- ¿La sentencia afecta a la fila `p_id`? Se ejecuta con el rol y la identidad
-- de la sesión (SECURITY INVOKER: la RLS aplica) y se DESHACE siempre, así que
-- cada persona prueba sobre las mismas filas. Un 42501 es el rechazo de un
-- WITH CHECK de RLS: cuenta como «no». Cualquier otro error SUBE —un rechazo
-- por otra causa sería un falso verde—.
CREATE FUNCTION bp.afecta(p_sql text, p_id uuid) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  n int := 0;
BEGIN
  BEGIN
    EXECUTE p_sql USING p_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'BP000', MESSAGE = 'deshacer';
  EXCEPTION
    WHEN SQLSTATE 'BP000' THEN RETURN n = 1;
    WHEN insufficient_privilege THEN RETURN false;
  END;
END;
$$;

CREATE FUNCTION bp.borra(p_tabla text, p_alias text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT bp.afecta(format('DELETE FROM public.%I WHERE id = $1', p_tabla), bp.id(p_alias))
$$;

-- ¿Cuántas filas se lleva un DELETE SIN WHERE? Sin filtro no hay lectura, así
-- que la policy de SELECT (que ya acota a la empresa) no interviene: sólo la
-- de DELETE separa a una empresa de otra. Se deshace siempre.
CREATE FUNCTION bp.borra_sin_filtro(p_tabla text) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  n int := 0;
BEGIN
  BEGIN
    EXECUTE format('DELETE FROM public.%I', p_tabla);
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'BP000', MESSAGE = 'deshacer';
  EXCEPTION
    WHEN SQLSTATE 'BP000' THEN RETURN n;
  END;
END;
$$;

-- Lo que hace softDelete() en src/lib/softDelete.ts.
CREATE FUNCTION bp.da_de_baja(p_alias text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT bp.afecta('UPDATE public.tickets_mantenimiento SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', bp.id(p_alias))
$$;

CREATE FUNCTION bp.restaura(p_alias text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT bp.afecta('UPDATE public.tickets_mantenimiento SET deleted_at = NULL, deleted_by = NULL WHERE id = $1', bp.id(p_alias))
$$;

CREATE FUNCTION bp.edita_ticket(p_alias text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT bp.afecta('UPDATE public.tickets_mantenimiento SET estado = ''en_proceso'' WHERE id = $1', bp.id(p_alias))
$$;

-- Las cinco bajas de golpe, para quien puede todas o ninguna.
CREATE FUNCTION bp.cinco(p_quien text, p_espera boolean) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_verbo text := CASE WHEN p_espera THEN 'SÍ' ELSE 'NO' END;
BEGIN
  PERFORM bp.chk(bp.borra('incidentes_seguridad', 'INC'), p_espera, format('%s %s borra un incidente', p_quien, v_verbo));
  PERFORM bp.chk(bp.borra('asambleas', 'ASA'),            p_espera, format('%s %s borra una asamblea', p_quien, v_verbo));
  PERFORM bp.chk(bp.borra('checklist_areas', 'CHK'),      p_espera, format('%s %s borra un checklist', p_quien, v_verbo));
  PERFORM bp.chk(bp.borra('permisos_obra_unidad', 'POB'), p_espera, format('%s %s borra un permiso de obra', p_quien, v_verbo));
  PERFORM bp.chk(bp.da_de_baja('TKT'),                    p_espera, format('%s %s da de baja un ticket', p_quien, v_verbo));
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA bp TO PUBLIC;

-- ── Empresas, proyectos, usuarios ───────────────────────────────────────────
INSERT INTO public.companies (id, nombre) VALUES
  (bp.id('A'), 'Empresa A (borrado)'),
  (bp.id('B'), 'Empresa B (borrado)');

INSERT INTO public.projects (id, company_id, nombre, tipo) VALUES
  (bp.id('A1'), bp.id('A'), 'Condominio A1', 'condominios'),
  (bp.id('B1'), bp.id('B'), 'Condominio B1', 'condominios');

INSERT INTO auth.users (id)
SELECT bp.id(a) FROM unnest(ARRAY['VER','EDI','BOR','LEG','OCU','ADM','BORB']) AS a;

INSERT INTO public.app_users (id, company_id, full_name, role)
SELECT bp.id(a), bp.id(CASE a WHEN 'BORB' THEN 'B' ELSE 'A' END), 'Borrado ' || a,
       CASE a WHEN 'ADM' THEN 'admin' ELSE 'operator' END
FROM unnest(ARRAY['VER','EDI','BOR','LEG','OCU','ADM','BORB']) AS a;

-- ── RBAC ────────────────────────────────────────────────────────────────────
INSERT INTO public.roles (id, company_id, name)
SELECT bp.id('R_' || a), bp.id(CASE a WHEN 'BORB' THEN 'B' ELSE 'A' END), 'Borrado ' || a
FROM unnest(ARRAY['VER','EDI','BOR','LEG','OCU','BORB']) AS a;

-- Visibilidad (clave de 3 segmentos) y acción (4) de los cinco tabs.
WITH tabs(tab) AS (VALUES ('mantenimiento'), ('incidentes'), ('asambleas'), ('checklist_areas'), ('permisos_obra')),
grants(rol, clave) AS (
  SELECT r, 'condominios.tab.' || tab FROM tabs, unnest(ARRAY['VER','EDI','BOR','LEG','BORB']) AS r
  UNION ALL SELECT 'EDI',  'condominios.tab.' || tab || '.edit'   FROM tabs
  UNION ALL SELECT 'BOR',  'condominios.tab.' || tab || '.delete' FROM tabs
  UNION ALL SELECT 'BORB', 'condominios.tab.' || tab || '.delete' FROM tabs
  UNION ALL SELECT 'OCU',  'condominios.tab.' || tab || '.delete' FROM tabs
  UNION ALL SELECT 'LEG',  'platform.condominios.view'
  UNION ALL SELECT 'LEG',  'platform.condominios.delete'
)
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT DISTINCT bp.id('R_' || rol), clave, 'allow' FROM grants;

INSERT INTO public.user_roles (user_id, role_id)
SELECT bp.id(a), bp.id('R_' || a) FROM unnest(ARRAY['VER','EDI','BOR','LEG','OCU','BORB']) AS a;

-- ── Filas de A ──────────────────────────────────────────────────────────────
INSERT INTO public.incidentes_seguridad (id, company_id, project_id, descripcion)
VALUES (bp.id('INC'), bp.id('A'), bp.id('A1'), 'Incidente de prueba');
INSERT INTO public.asambleas (id, company_id, project_id, titulo, fecha, hora_inicio)
VALUES (bp.id('ASA'), bp.id('A'), bp.id('A1'), 'Asamblea de prueba', CURRENT_DATE, '18:00');
INSERT INTO public.checklist_areas (id, company_id, project_id, area)
VALUES (bp.id('CHK'), bp.id('A'), bp.id('A1'), 'Lobby');
INSERT INTO public.permisos_obra_unidad (id, company_id, project_id, descripcion)
VALUES (bp.id('POB'), bp.id('A'), bp.id('A1'), 'Permiso de prueba');
INSERT INTO public.tickets_mantenimiento (id, company_id, project_id, titulo)
VALUES (bp.id('TKT'), bp.id('A'), bp.id('A1'), 'Ticket vivo');
INSERT INTO public.tickets_mantenimiento (id, company_id, project_id, titulo, deleted_at)
VALUES (bp.id('TKB'), bp.id('A'), bp.id('A1'), 'Ticket dado de baja', now());
