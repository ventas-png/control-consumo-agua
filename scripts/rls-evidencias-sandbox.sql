-- ════════════════════════════════════════════════════════════════════════════
-- Sandbox de RLS para las evidencias de recepción y el acuse (20260831000000)
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ ES. El banco de pruebas conductual del bucket `recepcion-evidencias` y de
-- `correspondencia_registrar_acuse()`. Monta el andamiaje mínimo —`auth.uid`,
-- el esquema `storage` (buckets, objects, foldername), `app_users`, los helpers
-- de RBAC— en un Postgres desechable, aplica LA MIGRACIÓN ENTERA tal como se va
-- a desplegar (el runner no copia SQL: ejecuta el archivo) y comprueba, con
-- SELECT/INSERT/UPDATE/DELETE reales como cada usuario, quién puede qué.
--
-- POR QUÉ. El hallazgo que corrige esa migración es que un residente podía
-- leer, sustituir y BORRAR la firma de acuse de su vecino. Eso no se demuestra
-- leyendo una policy: se demuestra intentándolo. Y el harness de Supabase
-- (src/test/rls) no puede correr sin secretos, así que quedaría verde sin haber
-- ejecutado nada.
--
-- LO QUE NO ES. No reproduce GoTrue ni el resto del esquema; el andamiaje
-- imita los helpers, no los importa. Es la prueba de que ESTAS reglas hacen lo
-- que dicen.
--
-- Uso:  scripts/rls-evidencias-sandbox.sh
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- ── storage: lo mínimo que tocan las policies ───────────────────────────────
-- `foldername` es la de Supabase: parte por '/' y DESCARTA el último segmento
-- (el nombre del archivo). Para 'proy/pieza/f.jpg' devuelve {proy, pieza}.
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  name text NOT NULL,
  owner uuid,
  UNIQUE (bucket_id, name)
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1 : array_length(_parts, 1) - 1];
END $$;

-- ── RBAC: copias fieles de los helpers de producción ────────────────────────
CREATE TABLE public.app_users (
  id uuid PRIMARY KEY, company_id uuid NOT NULL, role text NOT NULL, full_name text
);
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role_id uuid NOT NULL, expires_at timestamptz);
CREATE TABLE public.role_permissions (role_id uuid NOT NULL, permission_key text NOT NULL, effect text NOT NULL DEFAULT 'allow');
CREATE TABLE public.user_project_assignments (user_id uuid NOT NULL, project_id uuid NOT NULL);

CREATE OR REPLACE FUNCTION public.get_my_company_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.app_users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.app_users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT role FROM public.app_users WHERE id = auth.uid())
                  IN ('super_admin','superadmin'), false)
$$;

-- COPIA FIEL de 20260518000008: para company_owner/admin dice true a CUALQUIER
-- clave. Por eso el reparto de borrado va por rol y no por permiso.
CREATE OR REPLACE FUNCTION public.user_has_permission(perm_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT role FROM public.app_users WHERE id = auth.uid())
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN (SELECT role FROM me) IN ('super_admin','superadmin','company_owner','admin') THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = auth.uid() AND rp.permission_key = perm_key
        AND rp.effect = 'allow' AND (ur.expires_at IS NULL OR ur.expires_at > now())
    )
  END
$$;

CREATE TABLE public.projects (id uuid PRIMARY KEY, company_id uuid NOT NULL, nombre text);

-- can_access_project: exentos por rol (20260815000000) o asignación explícita.
CREATE OR REPLACE FUNCTION public.can_access_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_project_id IS NULL
     OR public.current_user_role() = ANY (ARRAY['super_admin','superadmin','company_owner'])
     OR (public.current_user_role() = 'admin'
         AND NOT EXISTS (SELECT 1 FROM public.user_project_assignments upa WHERE upa.user_id = auth.uid()))
     OR EXISTS (SELECT 1 FROM public.user_project_assignments upa
                 WHERE upa.user_id = auth.uid() AND upa.project_id = p_project_id)
$$;

CREATE TABLE public.unidades (
  id uuid PRIMARY KEY, company_id uuid NOT NULL, project_id uuid NOT NULL,
  nombre text, cliente_id uuid, activo boolean NOT NULL DEFAULT true
);
CREATE OR REPLACE FUNCTION public.mis_unidades_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id FROM public.unidades u
   WHERE u.activo AND u.cliente_id IS NOT NULL AND u.cliente_id = auth.uid()
$$;

-- ── La tabla del motor, con las columnas del acuse ──────────────────────────
CREATE TABLE public.paquetes_recibidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  unidad_id uuid,
  clase text NOT NULL DEFAULT 'paquete',
  destinatario_tipo text NOT NULL DEFAULT 'unidad',
  tipo text NOT NULL DEFAULT 'paquete',
  estado text NOT NULL DEFAULT 'pendiente',
  descripcion text NOT NULL,
  direccion text NOT NULL DEFAULT 'entrante',
  destinatario text,
  fotos text[],
  firma_path text,
  entregado_a_nombre text,
  entregado_por uuid,
  entregado_via text,
  hora_recepcion timestamptz NOT NULL DEFAULT now(),
  hora_entrega timestamptz
);
ALTER TABLE public.paquetes_recibidos ENABLE ROW LEVEL SECURITY;

CREATE ROLE anon;
CREATE ROLE authenticated;
GRANT USAGE ON SCHEMA public, auth, storage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paquetes_recibidos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT SELECT ON storage.buckets, public.app_users, public.unidades, public.projects TO authenticated;

-- ── Aserciones ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assert_eq(actual bigint, esperado bigint, mensaje text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION 'FALLO: % (esperado %, obtenido %)', mensaje, esperado, actual;
  END IF;
  RAISE NOTICE '  ok  %', mensaje;
END $$;

CREATE OR REPLACE FUNCTION public.assert_true(cond boolean, mensaje text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FALLO: %', mensaje; END IF;
  RAISE NOTICE '  ok  %', mensaje;
END $$;

/**
 * Ejecuta `sql` esperando que REVIENTE. Si pasa, es un fallo del test.
 * Devuelve el SQLERRM para poder afirmar sobre el motivo.
 */
CREATE OR REPLACE FUNCTION public.assert_falla(sql text, mensaje text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  ok  % [%]', mensaje, left(SQLERRM, 60);
    RETURN;
  END;
  RAISE EXCEPTION 'FALLO: % (la operación NO falló, y debía)', mensaje;
END $$;

GRANT EXECUTE ON FUNCTION public.assert_eq(bigint, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_true(boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_falla(text, text) TO authenticated;

-- ── Datos ───────────────────────────────────────────────────────────────────
-- UNA empresa, UN proyecto, DOS unidades con residentes distintos: la prueba
-- negativa que importa es entre vecinos, no entre empresas. La empresa ajena
-- está solo para el control de tenant.
\set emp   '''11111111-1111-1111-1111-111111111111'''
\set otra  '''22222222-2222-2222-2222-222222222222'''
\set proy  '''33333333-3333-3333-3333-333333333333'''
\set proyb '''33333333-3333-3333-3333-3333333333bb'''
\set proyc '''33333333-3333-3333-3333-3333333333cc'''

\set owner '''a0000000-0000-0000-0000-000000000001'''
\set admin '''a0000000-0000-0000-0000-000000000002'''
\set gcorr '''a0000000-0000-0000-0000-000000000003'''
\set gpaq  '''a0000000-0000-0000-0000-000000000004'''
\set gotro '''a0000000-0000-0000-0000-000000000005'''
\set resa  '''a0000000-0000-0000-0000-00000000000a'''
\set resb  '''a0000000-0000-0000-0000-00000000000b'''
\set super '''a0000000-0000-0000-0000-000000000009'''
\set ajeno '''a0000000-0000-0000-0000-000000000008'''

INSERT INTO public.app_users (id, company_id, role, full_name) VALUES
  (:owner, :emp,  'company_owner', 'Dueña'),
  (:admin, :emp,  'admin',         'Administrador'),
  (:gcorr, :emp,  'operator',      'Recepción (correspondencia)'),
  (:gpaq,  :emp,  'operator',      'Guardia (paquetería)'),
  (:gotro, :emp,  'operator',      'Recepción de la otra torre'),
  (:resa,  :emp,  'cliente',       'Residente A-1'),
  (:resb,  :emp,  'cliente',       'Residente A-2'),
  (:super, :otra, 'super_admin',   'Soporte'),
  (:ajeno, :otra, 'admin',         'Admin de otra empresa');

\set rolcorr '''b0000000-0000-0000-0000-000000000001'''
\set rolpaq  '''b0000000-0000-0000-0000-000000000002'''
INSERT INTO public.user_roles (user_id, role_id) VALUES
  (:gcorr, :rolcorr), (:gpaq, :rolpaq), (:gotro, :rolcorr);
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  (:rolcorr, 'condominios.tab.correspondencia', 'allow'),
  (:rolpaq,  'condominios.tab.paqueteria',      'allow');

INSERT INTO public.projects (id, company_id, nombre) VALUES
  (:proy, :emp, 'Torre Norte'), (:proyc, :emp, 'Torre Sur'), (:proyb, :otra, 'Proyecto ajeno');

-- El alcance por proyecto es parte del gate: un operador solo ve lo de los
-- proyectos que tiene asignados. `gotro` tiene el MISMO permiso que `gcorr`
-- pero otra torre — es el control de que el proyecto también filtra.
INSERT INTO public.user_project_assignments (user_id, project_id) VALUES
  (:gcorr, :proy), (:gpaq, :proy), (:gotro, :proyc);

\set unia '''d0000000-0000-0000-0000-00000000000a'''
\set unib '''d0000000-0000-0000-0000-00000000000b'''
INSERT INTO public.unidades (id, company_id, project_id, nombre, cliente_id) VALUES
  (:unia, :emp, :proy, 'A-1', :resa),
  (:unib, :emp, :proy, 'A-2', :resb);

-- Tres piezas: una carta para A-1, una para A-2 y una citación para la
-- administración (sin unidad). Más un paquete, para el reparto por clase.
\set corr_a   '''c0000000-0000-0000-0000-00000000000a'''
\set corr_b   '''c0000000-0000-0000-0000-00000000000b'''
\set corr_adm '''c0000000-0000-0000-0000-00000000000c'''
\set paq_a    '''c0000000-0000-0000-0000-00000000000d'''

INSERT INTO public.paquetes_recibidos
  (id, company_id, project_id, unidad_id, clase, destinatario_tipo, tipo, descripcion, destinatario)
VALUES
  (:corr_a,   :emp, :proy, :unia, 'correspondencia', 'unidad',         'notificacion_legal', 'Citación para A-1', 'Ana Pérez'),
  (:corr_b,   :emp, :proy, :unib, 'correspondencia', 'unidad',         'carta',              'Carta para A-2',    'Bruno Díaz'),
  (:corr_adm, :emp, :proy, NULL,  'correspondencia', 'administracion', 'notificacion_legal', 'Citación municipal', NULL),
  (:paq_a,    :emp, :proy, :unia, 'paquete',         'unidad',         'paquete',            'Caja para A-1',     NULL);

-- Una pieza de la OTRA empresa: sirve para probar que no se puede colgar una
-- evidencia del id de una pieza ajena.
\set corr_ajena '''c0000000-0000-0000-0000-0000000000ff'''
INSERT INTO public.paquetes_recibidos
  (id, company_id, project_id, unidad_id, clase, destinatario_tipo, tipo, descripcion)
VALUES
  (:corr_ajena, :otra, :proyb, NULL, 'correspondencia', 'administracion', 'carta', 'Carta de otra empresa');
