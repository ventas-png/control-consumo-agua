-- ════════════════════════════════════════════════════════════════════════════
-- Retirada de los datos de prueba `ZZ HK E2E` del SANDBOX — PREPARADA, NO EJECUTADA
-- ════════════════════════════════════════════════════════════════════════════
-- Requiere autorización explícita. Solo toca los identificadores EXACTOS de abajo (ni prefijos
-- ni LIKE: en el sandbox hay filas de OTRAS empresas cuyo id aleatorio empieza por «e2e», p. ej.
-- conta_asientos e2eace36-… y bitacora_acciones e2ee01c7-…, de la empresa e4668da9-…; no se tocan).
-- Termina en ROLLBACK: revisar los conteos y cambiar la última línea a COMMIT para aplicarlo.
-- Inventario medido el 2026-10-12 (ver docs/HOUSEKEEPING_EVIDENCIAS.md §Datos de prueba).
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TEMP TABLE e2e_ids (tipo text, id uuid) ON COMMIT DROP;
INSERT INTO e2e_ids VALUES
  ('empresa',  'e2e0000a-0000-4000-8000-00000000000a'), ('empresa',  'e2e0000b-0000-4000-8000-00000000000b'),
  ('proyecto', 'e2e000a1-0000-4000-8000-000000000001'), ('proyecto', 'e2e000a2-0000-4000-8000-000000000002'),
  ('proyecto', 'e2e000b1-0000-4000-8000-000000000001'),
  ('usuario',  'e2e00000-0000-4000-8000-000000000001'), ('usuario',  'e2e00000-0000-4000-8000-000000000003'),
  ('usuario',  'e2e00000-0000-4000-8000-000000000004'), ('usuario',  'e2e00000-0000-4000-8000-000000000007'),
  ('rol',      'e2e0001e-0000-4000-8000-0000000000a8');

-- Guarda: las dos empresas existen con su nombre exacto (en producción no existen → aborta).
DO $g$
BEGIN
  IF (SELECT count(*) FROM public.companies WHERE (id, nombre) IN
        (('e2e0000a-0000-4000-8000-00000000000a'::uuid, 'ZZ HK E2E Empresa A'), ('e2e0000b-0000-4000-8000-00000000000b'::uuid, 'ZZ HK E2E Empresa B'))) <> 2 THEN
    RAISE EXCEPTION 'ABORTA: no están las dos empresas ZZ HK E2E con su nombre exacto; no es el sandbox esperado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.servicios_housekeeping WHERE company_id IN (SELECT id FROM e2e_ids WHERE tipo = 'empresa'))
     OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'housekeeping-evidencias'
                  AND (storage.foldername(name))[1] IN (SELECT id::text FROM e2e_ids WHERE tipo = 'proyecto')) THEN
    RAISE EXCEPTION 'ABORTA: quedan servicios u objetos de housekeeping de prueba; retirarlos antes por la pantalla o las RPC.';
  END IF;
END $g$;

-- Hijos primero, por identificador exacto.
DELETE FROM public.user_project_assignments WHERE user_id IN (SELECT id FROM e2e_ids WHERE tipo = 'usuario');
DELETE FROM public.user_roles        WHERE role_id = 'e2e0001e-0000-4000-8000-0000000000a8';
DELETE FROM public.role_permissions  WHERE role_id = 'e2e0001e-0000-4000-8000-0000000000a8';
DELETE FROM public.permission_audit_log
 WHERE target_role_id = 'e2e0001e-0000-4000-8000-0000000000a8' OR target_user_id IN (SELECT id FROM e2e_ids WHERE tipo = 'usuario');
DELETE FROM public.roles             WHERE id = 'e2e0001e-0000-4000-8000-0000000000a8';
DELETE FROM public.user_presence     WHERE user_id IN (SELECT id FROM e2e_ids WHERE tipo = 'usuario');
DELETE FROM public.bitacora_acciones WHERE company_id IN (SELECT id FROM e2e_ids WHERE tipo = 'empresa');
DELETE FROM public.audit_log         WHERE company_id IN (SELECT id FROM e2e_ids WHERE tipo = 'empresa');
DELETE FROM public.subscriptions     WHERE company_id IN (SELECT id FROM e2e_ids WHERE tipo = 'empresa');
DELETE FROM public.app_users         WHERE id IN (SELECT id FROM e2e_ids WHERE tipo = 'usuario');
DELETE FROM auth.refresh_tokens      WHERE user_id IN (SELECT id::text FROM e2e_ids WHERE tipo = 'usuario');
DELETE FROM auth.sessions            WHERE user_id IN (SELECT id FROM e2e_ids WHERE tipo = 'usuario');
DELETE FROM auth.identities          WHERE user_id IN (SELECT id FROM e2e_ids WHERE tipo = 'usuario');
DELETE FROM auth.users               WHERE id IN (SELECT id FROM e2e_ids WHERE tipo = 'usuario');
DELETE FROM public.projects          WHERE id IN (SELECT id FROM e2e_ids WHERE tipo = 'proyecto');
DELETE FROM public.companies         WHERE id IN (SELECT id FROM e2e_ids WHERE tipo = 'empresa');

-- Verificación: todo en 0, y las filas ajenas con id «e2e…» siguen ahí.
SELECT (SELECT count(*) FROM public.companies WHERE id IN (SELECT id FROM e2e_ids)) AS empresas,
       (SELECT count(*) FROM public.projects  WHERE id IN (SELECT id FROM e2e_ids)) AS proyectos,
       (SELECT count(*) FROM auth.users       WHERE id IN (SELECT id FROM e2e_ids)) AS usuarios,
       (SELECT count(*) FROM public.app_users WHERE id IN (SELECT id FROM e2e_ids)) AS app_users,
       (SELECT count(*) FROM public.roles     WHERE id IN (SELECT id FROM e2e_ids)) AS roles,
       (SELECT count(*) FROM storage.objects  WHERE bucket_id = 'housekeeping-evidencias') AS objetos_hk,
       (SELECT count(*) FROM public.hk_limpieza_storage) AS cola_hk,
       (SELECT count(*) FROM public.conta_asientos WHERE id = 'e2eace36-7a00-47ed-b643-d3f61b3e0f44') AS ajeno_intacto;

ROLLBACK;   -- ← cambiar a COMMIT tras revisar la verificación
