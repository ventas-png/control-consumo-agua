-- Residentes de prueba sobre el padrón de conta_auxiliares_tipo_cargo
-- (run.sh aplica aquél antes que éste). Todo lleva prefijo SINT-AUX.
--
--   U1 (Apto 101, A1): R1 Uno propietario PAGADOR · R2 Dos arrendatario ·
--                      R3 Tres familiar INACTIVO
--   U2 (Apto 102, A1): R4 Uno propietario
--
-- Un lector (rol viewer con asignación a A1) VE los residentes pero la RLS no
-- le deja modificarlos: es el caso «escritura filtrada», no «sin acceso».

INSERT INTO auth.users (id) VALUES ('a0a0a0a0-0000-0000-0000-00000000000f');
INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
  ('a0a0a0a0-0000-0000-0000-00000000000f', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SINT-AUX Lector A', 'viewer');
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
  ('a0a0a0a0-0000-0000-0000-00000000000f', 'a1a1a1a1-0000-0000-0000-000000000001', 'lectura');

INSERT INTO public.unidad_residentes
  (id, unidad_id, cliente_id, company_id, project_id, tipo, activo, responsable_pago) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001', 'e0000000-0000-0000-0000-00000000a001',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'propietario',  true,  true),
  ('d0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000a001', 'e0000000-0000-0000-0000-00000000a002',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'arrendatario', true,  false),
  ('d0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-00000000a001', 'e0000000-0000-0000-0000-00000000a003',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'familiar',     false, false),
  ('d0000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-00000000a002', 'e0000000-0000-0000-0000-00000000a001',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'propietario',  true,  false);

-- Pagador actual de una unidad, como texto estable para las aserciones.
CREATE OR REPLACE FUNCTION public.pagador_de(p_unidad uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(string_agg(id::text, ',' ORDER BY id), 'NINGUNO')
    FROM public.unidad_residentes WHERE unidad_id = p_unidad AND responsable_pago
$$;
GRANT EXECUTE ON FUNCTION public.pagador_de(uuid) TO authenticated;
