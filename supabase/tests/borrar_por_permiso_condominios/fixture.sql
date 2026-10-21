\set ON_ERROR_STOP on

-- ============================================================================
-- EL PADRÓN para 20261104000100 (borrar en cinco pestañas exige `.delete`).
--
-- Se carga sobre la cadena ENTERA de migraciones: `user_has_permission`,
-- `condominios_puede_actuar`, las policies, los triggers de bitácora y auditoría
-- son los reales, no una copia. `auth.uid()` sale del GUC
-- `request.jwt.claim.sub`, como en scripts/schema-drift/bootstrap.sql.
--
-- Usuarios de APLICACIÓN (empresa A salvo que se diga). Cada uno es UNA de las
-- formas en que `canActInCondominiosTab` (src/lib/permissions.ts) dice sí o no:
--
--   admin    rol legado admin: exento, borra todo en su empresa
--   borra    operator + VER el tab + `condominios.tab.<tab>.delete`
--   legado   operator + VER el tab + platform.condominios.view + .delete
--   edita    operator + VER el tab + `.edit` (sin `.delete`)
--   visor    operator + VER el tab, nada más
--   sintab   operator + `.delete` y el par legado, pero SIN ver el tab: la UI
--            no le muestra la pestaña, y la base tampoco puede dejarle borrar
--   ajeno    operator de la empresa B con VER + `.delete`: no cruza la empresa
--   super    super_admin (de B): cruza empresas, como en todas las policies
--
-- Filas (todas de la empresa A): una por tabla de borrado físico, y dos tickets
-- de mantenimiento — uno vivo y uno ya borrado lógicamente.
-- ============================================================================

INSERT INTO public.companies (id, nombre) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-BPC Empresa A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'SINT-BPC Empresa B');

INSERT INTO public.projects (id, company_id, nombre) VALUES
  ('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-BPC Condominio A1'),
  ('b1b1b1b1-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'SINT-BPC Condominio B1');

INSERT INTO auth.users (id) VALUES
  ('a0a0a0a0-0000-0000-0000-00000000000a'),
  ('a0a0a0a0-0000-0000-0000-00000000000b'),
  ('a0a0a0a0-0000-0000-0000-00000000000c'),
  ('a0a0a0a0-0000-0000-0000-00000000000d'),
  ('a0a0a0a0-0000-0000-0000-00000000000e'),
  ('a0a0a0a0-0000-0000-0000-00000000000f'),
  ('b0b0b0b0-0000-0000-0000-00000000000b'),
  ('b0b0b0b0-0000-0000-0000-000000000005');

INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
  ('a0a0a0a0-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-BPC Admin',  'admin'),
  ('a0a0a0a0-0000-0000-0000-00000000000b', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-BPC Borra',  'operator'),
  ('a0a0a0a0-0000-0000-0000-00000000000c', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-BPC Legado', 'operator'),
  ('a0a0a0a0-0000-0000-0000-00000000000d', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-BPC Edita',  'operator'),
  ('a0a0a0a0-0000-0000-0000-00000000000e', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-BPC Visor',  'operator'),
  ('a0a0a0a0-0000-0000-0000-00000000000f', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-BPC Sintab', 'operator'),
  ('b0b0b0b0-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'SINT-BPC Ajeno',  'operator'),
  ('b0b0b0b0-0000-0000-0000-000000000005', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'SINT-BPC Super',  'super_admin');

-- ── RBAC: un rol por forma de permiso ───────────────────────────────────────
INSERT INTO public.roles (id, company_id, name) VALUES
  ('9b000000-0000-0000-0000-00000000000b', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-BPC Borra'),
  ('9b000000-0000-0000-0000-00000000000c', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-BPC Legado'),
  ('9b000000-0000-0000-0000-00000000000d', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-BPC Edita'),
  ('9b000000-0000-0000-0000-00000000000e', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-BPC Visor'),
  ('9b000000-0000-0000-0000-00000000000f', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-BPC Sintab'),
  ('9b000000-0000-0000-0000-0000000000bb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'SINT-BPC Ajeno');

-- Los cinco tabs de la migración, con su id de tab (no el de la tabla).
CREATE TEMP TABLE bpc_tabs (tab text);
INSERT INTO bpc_tabs VALUES ('mantenimiento'), ('incidentes'), ('asambleas'), ('checklist_areas'), ('permisos_obra');

INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT r.role_id, r.clave, 'allow'
FROM bpc_tabs t
CROSS JOIN LATERAL (VALUES
  -- borra: ver + borrar en el tab
  ('9b000000-0000-0000-0000-00000000000b'::uuid, 'condominios.tab.' || t.tab),
  ('9b000000-0000-0000-0000-00000000000b'::uuid, 'condominios.tab.' || t.tab || '.delete'),
  -- legado: ver el tab; la acción viene del par de módulo (abajo)
  ('9b000000-0000-0000-0000-00000000000c'::uuid, 'condominios.tab.' || t.tab),
  -- edita: ver + editar
  ('9b000000-0000-0000-0000-00000000000d'::uuid, 'condominios.tab.' || t.tab),
  ('9b000000-0000-0000-0000-00000000000d'::uuid, 'condominios.tab.' || t.tab || '.edit'),
  -- visor: ver
  ('9b000000-0000-0000-0000-00000000000e'::uuid, 'condominios.tab.' || t.tab),
  -- sintab: borrar sin ver
  ('9b000000-0000-0000-0000-00000000000f'::uuid, 'condominios.tab.' || t.tab || '.delete'),
  -- ajeno (empresa B): ver + borrar
  ('9b000000-0000-0000-0000-0000000000bb'::uuid, 'condominios.tab.' || t.tab),
  ('9b000000-0000-0000-0000-0000000000bb'::uuid, 'condominios.tab.' || t.tab || '.delete')
) AS r(role_id, clave);

INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('9b000000-0000-0000-0000-00000000000c', 'platform.condominios.view',   'allow'),
  ('9b000000-0000-0000-0000-00000000000c', 'platform.condominios.delete', 'allow'),
  ('9b000000-0000-0000-0000-00000000000f', 'platform.condominios.view',   'allow'),
  ('9b000000-0000-0000-0000-00000000000f', 'platform.condominios.delete', 'allow');

INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('a0a0a0a0-0000-0000-0000-00000000000b', '9b000000-0000-0000-0000-00000000000b'),
  ('a0a0a0a0-0000-0000-0000-00000000000c', '9b000000-0000-0000-0000-00000000000c'),
  ('a0a0a0a0-0000-0000-0000-00000000000d', '9b000000-0000-0000-0000-00000000000d'),
  ('a0a0a0a0-0000-0000-0000-00000000000e', '9b000000-0000-0000-0000-00000000000e'),
  ('a0a0a0a0-0000-0000-0000-00000000000f', '9b000000-0000-0000-0000-00000000000f'),
  ('b0b0b0b0-0000-0000-0000-00000000000b', '9b000000-0000-0000-0000-0000000000bb');

-- ── Las filas (empresa A) ───────────────────────────────────────────────────
INSERT INTO public.incidentes_seguridad (id, company_id, project_id, descripcion) VALUES
  ('1c000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a1a1a1a1-0000-0000-0000-000000000001', 'SINT-BPC Portón forzado');

INSERT INTO public.asambleas (id, company_id, project_id, titulo, fecha, hora_inicio) VALUES
  ('1a000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a1a1a1a1-0000-0000-0000-000000000001', 'SINT-BPC Asamblea ordinaria', DATE '2026-11-15', TIME '18:00');

INSERT INTO public.checklist_areas (id, company_id, project_id, area) VALUES
  ('1d000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a1a1a1a1-0000-0000-0000-000000000001', 'SINT-BPC Piscina');

INSERT INTO public.permisos_obra_unidad (id, company_id, project_id, descripcion) VALUES
  ('1e000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a1a1a1a1-0000-0000-0000-000000000001', 'SINT-BPC Remodelación de cocina');

INSERT INTO public.tickets_mantenimiento (id, company_id, project_id, titulo, estado, deleted_at, deleted_by) VALUES
  ('1f000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a1a1a1a1-0000-0000-0000-000000000001', 'SINT-BPC Fuga en lobby (vivo)', 'abierto', NULL, NULL),
  ('1f000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a1a1a1a1-0000-0000-0000-000000000001', 'SINT-BPC Foco quemado (ya borrado)', 'abierto',
   TIMESTAMPTZ '2026-10-01 12:00+00', 'a0a0a0a0-0000-0000-0000-00000000000a');

-- ── La medición ─────────────────────────────────────────────────────────────
-- Ejecuta `p_sql` como `authenticated` con la identidad `p_uid` y devuelve las
-- filas afectadas, o 'rechazado' si la RLS lo rechaza con 42501 (el WITH CHECK
-- de un UPDATE no da 0 filas: da error). Cualquier otro error SALE: un fixture
-- roto no puede hacerse pasar por una denegación.
--
-- Todo lo que hace se deshace: el BEGIN/EXCEPTION interno es una
-- subtransacción, y el RAISE propio la revierte —la escritura, el rol y el
-- GUC de identidad—. Así cada caso mide sobre el MISMO estado y el orden de los
-- casos no importa.
CREATE TABLE public.bpc_medicion (
  etapa     text NOT NULL,
  caso      text NOT NULL,
  resultado text NOT NULL,
  PRIMARY KEY (etapa, caso)
);

CREATE OR REPLACE FUNCTION public.bpc_intento(p_uid uuid, p_sql text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_n   bigint;
  v_res text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE p_sql;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_res := v_n::text;
    RAISE EXCEPTION 'deshacer' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN SQLSTATE 'ZZ001'       THEN NULL;
    WHEN insufficient_privilege THEN v_res := 'rechazado';
  END;
  RETURN v_res;
END;
$$;
