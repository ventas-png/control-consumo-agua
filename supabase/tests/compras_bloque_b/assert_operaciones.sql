\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · SUMINISTROS Y PROFORMAS CON PROVEEDOR COMPARTIDO
-- (migración 20261021000400). Corre después de assert_factura (usa P3 y la
-- orden OF del proveedor P1).
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set P2  '''e3000000-0000-0000-0000-000000000002'''
\set P3  '''e3000000-0000-0000-0000-000000000003'''
\set PD  '''e3000000-0000-0000-0000-0000000000d1'''

-- ── Históricos: texto libre, sin vínculo (como los que ya existen) ──────────
INSERT INTO public.suministros_condominio (id, company_id, project_id, nombre, unidad_medida, proveedor) VALUES
  ('50000000-0000-0000-0000-0000000000a1', :C::uuid, :C1::uuid, 'Guantes',  'par', 'FERRETERIA  bloque b'),
  ('50000000-0000-0000-0000-0000000000a2', :C::uuid, :C1::uuid, 'Escobas',  'unidad', 'Proveedor Desconocido S.A.');
INSERT INTO public.proformas_condominio (id, company_id, project_id, proveedor_nombre, concepto, estado) VALUES
  ('0e000000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, 'Servicios Bloque B', 'Proforma histórica', 'aprobada');

-- ── 1. Vista previa: identifica, clasifica, NO une ──────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE vp AS SELECT * FROM public.operaciones_sin_proveedor_vista_previa();
GRANT ALL ON vp TO authenticated;
RESET ROLE;
SELECT public.chk_txt((SELECT clasificacion FROM vp WHERE registro_id = '50000000-0000-0000-0000-0000000000a1'), 'inequivoca',
  '1 · nombre equivalente (mayúsculas/espacios/acentos) = coincidencia inequívoca, solo SUGERIDA');
SELECT public.chk_txt((SELECT clasificacion FROM vp WHERE registro_id = '50000000-0000-0000-0000-0000000000a2'), 'sin_coincidencia',
  '1 · un nombre que no está en el catálogo queda «sin coincidencia»');
SELECT public.chk((SELECT count(*) FROM public.suministros_condominio WHERE proveedor_id IS NOT NULL AND id IN ('50000000-0000-0000-0000-0000000000a1','50000000-0000-0000-0000-0000000000a2')), 0,
  '1 · identificar NO vincula nada: la unión la decide una persona');

-- ── 2. Vincular uno a uno, por decisión de una persona ──────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.operaciones_vincular_proveedor('suministros_condominio', '50000000-0000-0000-0000-0000000000a1'::uuid, :P1::uuid);
RESET ROLE;
SELECT public.chk_uuid((SELECT proveedor_id FROM public.suministros_condominio WHERE id = '50000000-0000-0000-0000-0000000000a1'), :P1::uuid, '2 · el registro queda ligado al proveedor elegido');
SELECT public.chk_txt((SELECT proveedor FROM public.suministros_condominio WHERE id = '50000000-0000-0000-0000-0000000000a1'), 'Ferretería Bloque B',
  '2 · con el nombre del catálogo');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.operaciones_vincular_proveedor('suministros_condominio','50000000-0000-0000-0000-0000000000a1'::uuid,'e3000000-0000-0000-0000-000000000002'::uuid) $$,
  'OPERACIONES_VINCULO_NO_APLICA', '2 · un registro ya vinculado no se re-vincula en silencio');
SELECT public.chk_falla($$ SELECT public.operaciones_vincular_proveedor('suministros_condominio','50000000-0000-0000-0000-0000000000a2'::uuid,'e3000000-0000-0000-0000-0000000000d1'::uuid) $$,
  'OPERACIONES_PROVEEDOR_AJENO', '2 · no se vincula a un proveedor de OTRA empresa');
RESET ROLE;

-- ── 3. Proveedor suspendido: no admite operaciones nuevas ───────────────────
UPDATE public.proveedores SET estado = 'suspendido', motivo_estado = 'Papelería vencida' WHERE id = :P3::uuid;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.suministros_condominio (company_id, project_id, nombre, unidad_medida, proveedor_id)
     VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','Cepillos','unidad','e3000000-0000-0000-0000-000000000003') $$,
  'OPERACIONES_PROVEEDOR_NO_DISPONIBLE', '3 · un suministro nuevo no se liga a un proveedor suspendido');
SELECT public.chk_falla($$ INSERT INTO public.proformas_condominio (company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
     VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000003','x','Proforma','borrador') $$,
  'OPERACIONES_PROVEEDOR_NO_DISPONIBLE', '3 · ni una proforma nueva');
RESET ROLE;

-- Suspendido en UN proyecto: bloquea ahí, no en otro.
UPDATE public.proveedores SET estado = 'autorizado' WHERE id = :P3::uuid;
INSERT INTO public.proveedor_proyectos (proveedor_id, project_id, company_id, estado, motivo_estado)
VALUES (:P3::uuid, :C1::uuid, :C::uuid, 'suspendido', 'Incumplimiento en el proyecto')
ON CONFLICT (proveedor_id, project_id) DO UPDATE SET estado = 'suspendido', motivo_estado = 'Incumplimiento en el proyecto';
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.suministros_condominio (company_id, project_id, nombre, unidad_medida, proveedor_id)
     VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','Cepillos','unidad','e3000000-0000-0000-0000-000000000003') $$,
  'OPERACIONES_PROVEEDOR_NO_DISPONIBLE', '3 · suspendido en el proyecto bloquea ahí');
INSERT INTO public.suministros_condominio (id, company_id, project_id, nombre, unidad_medida, proveedor_id)
VALUES ('50000000-0000-0000-0000-0000000000a3', :C::uuid, :C2::uuid, 'Cepillos', 'unidad', :P3::uuid);
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.suministros_condominio WHERE id = '50000000-0000-0000-0000-0000000000a3'), 1,
  '3 · pero en otro proyecto donde sigue habilitado, sí');
-- Un registro YA ligado sigue editable aunque el proveedor se suspenda (no se bloquea resolver lo anterior).
UPDATE public.proveedores SET estado = 'suspendido', motivo_estado = 'x' WHERE id = :P3::uuid;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.suministros_condominio SET stock_minimo = 3 WHERE id = '50000000-0000-0000-0000-0000000000a3';
RESET ROLE;
SELECT public.chk_num((SELECT stock_minimo FROM public.suministros_condominio WHERE id = '50000000-0000-0000-0000-0000000000a3'), 3,
  '3 · lo ya ligado se sigue pudiendo atender tras la suspensión');
UPDATE public.proveedores SET estado = 'autorizado' WHERE id = :P3::uuid;

-- ── 4. Proforma → orden: coherencia de proveedor, empresa y proyecto ────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.proformas_condominio (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
VALUES ('0e000000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'Proforma ligada', 'aprobada');
SELECT public.chk_falla($$ UPDATE public.proformas_condominio SET orden_compra_id = '0f100000-0000-0000-0000-000000000002', estado = 'convertida_oc'
                           WHERE id = '0e000000-0000-0000-0000-000000000002' $$,
  'OPERACIONES_PROFORMA_ORDEN', '4 · la orden de OTRO proveedor no se liga a la proforma');
UPDATE public.proformas_condominio SET orden_compra_id = '0f100000-0000-0000-0000-000000000001', estado = 'convertida_oc'
 WHERE id = '0e000000-0000-0000-0000-000000000002';
RESET ROLE;
SELECT public.chk_uuid((SELECT orden_compra_id FROM public.proformas_condominio WHERE id = '0e000000-0000-0000-0000-000000000002'), '0f100000-0000-0000-0000-000000000001'::uuid,
  '4 · la proforma convertida queda ligada a SU orden (mismo proveedor, empresa y proyecto)');

-- ── 5. Otra empresa no ve ni vincula lo ajeno ───────────────────────────────
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE vp5 AS SELECT * FROM public.operaciones_sin_proveedor_vista_previa();
SELECT public.chk_falla($$ SELECT public.operaciones_vincular_proveedor('suministros_condominio','50000000-0000-0000-0000-0000000000a2'::uuid,'e3000000-0000-0000-0000-0000000000d1'::uuid) $$,
  'OPERACIONES_VINCULO_NO_APLICA', '5 · otra empresa no puede vincular registros ajenos (RLS)');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM vp5), 0, '5 · y su vista previa no los lista');
