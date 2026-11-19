-- Datos propios de rentas_huespedes, sobre el padrón de rentas_modulo
-- (empresas A/B, proyectos PA1/PA2/PB1, trece cuentas, roles de Rentas):
--   14: super_admin de la plataforma (sin empresa): lee, no sube.
INSERT INTO auth.users (id, email) VALUES (hkt.uid(14), 'u14@prueba.test');
INSERT INTO public.app_users (id, full_name, role, company_id, project_id, activo) VALUES
  (hkt.uid(14), 'Plataforma', 'super_admin', NULL, NULL, true);

-- Ruta de una foto: <empresa>/<propiedad>/<archivo>.
CREATE OR REPLACE FUNCTION hkt.rf(p_company uuid, p_prop uuid, p_archivo text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT p_company::text || '/' || p_prop::text || '/' || p_archivo $$;
-- La sentencia que la API de Storage ejecuta al subir (para hkt.estado_de).
CREATE OR REPLACE FUNCTION hkt.subir_sql(p_ruta text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT format('INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', 'rentas-huespedes', p_ruta) $$;
CREATE OR REPLACE FUNCTION hkt.borrar_sql(p_ruta text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', 'rentas-huespedes', p_ruta) $$;
-- Objetos del bucket que la persona actual VE (invocador: pasa por la RLS).
CREATE OR REPLACE FUNCTION hkt.visibles() RETURNS text[] LANGUAGE sql AS
  $$ SELECT coalesce(array_agg(name ORDER BY name), '{}') FROM storage.objects WHERE bucket_id = 'rentas-huespedes' $$;
-- Mismo conteo sin RLS, para saber qué quedó de verdad.
CREATE OR REPLACE FUNCTION hkt.existe(p_ruta text) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'rentas-huespedes' AND name = p_ruta) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;
