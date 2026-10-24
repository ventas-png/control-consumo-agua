\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · SUMINISTROS, PROFORMAS E INSTALACIONES CON PROVEEDOR COMPARTIDO
-- (migraciones 20261021000400 y 20261107000300). Corre después de assert_factura (usa P3 y la
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

-- ── 6. Instalaciones: la empresa de servicio sale del catálogo (20261107000300) ──
-- Históricos con empresa solo en texto, como los que ya existen en producción.
INSERT INTO public.mantenimiento_cisterna (id, company_id, project_id, cisterna, empresa_servicio) VALUES
  ('60000000-0000-0000-0000-0000000000c1', :C::uuid, :C1::uuid, 'Cisterna principal', 'ferretería  BLOQUE b'),
  ('60000000-0000-0000-0000-0000000000c2', :C::uuid, :C1::uuid, 'Cisterna principal', 'Empresa Que No Existe');
INSERT INTO public.mantenimiento_jardineria (id, company_id, project_id, areas, proveedor) VALUES
  ('60000000-0000-0000-0000-0000000000b1', :C::uuid, :C1::uuid, ARRAY['Jardín principal'], 'Servicios Bloque B');
INSERT INTO public.control_generador (id, company_id, project_id, generador, empresa_servicio) VALUES
  ('60000000-0000-0000-0000-0000000000a1', :C::uuid, :C1::uuid, 'Generador principal', 'Servicios Bloque B');

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE vp6 AS SELECT * FROM public.operaciones_sin_proveedor_vista_previa();
RESET ROLE;
SELECT public.chk_txt((SELECT clasificacion FROM vp6 WHERE tabla = 'mantenimiento_cisterna' AND registro_id = '60000000-0000-0000-0000-0000000000c1'), 'inequivoca',
  '6 · una cisterna histórica con nombre equivalente al catálogo se identifica (solo sugerida)');
SELECT public.chk_txt((SELECT clasificacion FROM vp6 WHERE tabla = 'mantenimiento_cisterna' AND registro_id = '60000000-0000-0000-0000-0000000000c2'), 'sin_coincidencia',
  '6 · y una empresa que no está en el catálogo queda «sin coincidencia»');
SELECT public.chk((SELECT count(*) FROM vp6 WHERE tabla IN ('mantenimiento_jardineria', 'control_generador')), 2,
  '6 · jardinería y generador históricos también se listan, cada uno con su tabla');
SELECT public.chk((SELECT count(*) FROM public.mantenimiento_cisterna WHERE proveedor_id IS NOT NULL), 0,
  '6 · identificar NO vincula nada');

-- Vincular uno a uno: queda el id y el texto toma el nombre del catálogo.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.operaciones_vincular_proveedor('mantenimiento_cisterna', '60000000-0000-0000-0000-0000000000c1'::uuid, :P1::uuid);
SELECT public.operaciones_vincular_proveedor('mantenimiento_jardineria', '60000000-0000-0000-0000-0000000000b1'::uuid, :P2::uuid);
SELECT public.operaciones_vincular_proveedor('control_generador', '60000000-0000-0000-0000-0000000000a1'::uuid, :P2::uuid);
RESET ROLE;
SELECT public.chk_uuid((SELECT proveedor_id FROM public.mantenimiento_cisterna WHERE id = '60000000-0000-0000-0000-0000000000c1'), :P1::uuid,
  '6 · la cisterna queda ligada al proveedor elegido');
SELECT public.chk_txt((SELECT empresa_servicio FROM public.mantenimiento_cisterna WHERE id = '60000000-0000-0000-0000-0000000000c1'), 'Ferretería Bloque B',
  '6 · con el nombre del catálogo en «empresa_servicio»');
SELECT public.chk_txt((SELECT proveedor FROM public.mantenimiento_jardineria WHERE id = '60000000-0000-0000-0000-0000000000b1'), 'Servicios Bloque B',
  '6 · en jardinería la columna de texto es «proveedor»');
SELECT public.chk_uuid((SELECT proveedor_id FROM public.control_generador WHERE id = '60000000-0000-0000-0000-0000000000a1'), :P2::uuid,
  '6 · el generador histórico también se vincula');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.operaciones_vincular_proveedor('mantenimiento_cisterna','60000000-0000-0000-0000-0000000000c1'::uuid,'e3000000-0000-0000-0000-000000000002'::uuid) $$,
  'OPERACIONES_VINCULO_NO_APLICA', '6 · un registro ya vinculado no se re-vincula en silencio');
SELECT public.chk_falla($$ SELECT public.operaciones_vincular_proveedor('mantenimiento_cisterna','60000000-0000-0000-0000-0000000000c2'::uuid,'e3000000-0000-0000-0000-0000000000d1'::uuid) $$,
  'OPERACIONES_PROVEEDOR_AJENO', '6 · no se vincula a un proveedor de OTRA empresa');
SELECT public.chk_falla($$ SELECT public.operaciones_vincular_proveedor('camaras_seguridad','60000000-0000-0000-0000-0000000000c2'::uuid,'e3000000-0000-0000-0000-000000000001'::uuid) $$,
  'OPERACIONES_TABLA_INVALIDA', '6 · una tabla que no está en la lista se rechaza por nombre');
RESET ROLE;

-- Registros NUEVOS desde la pantalla: el servidor valida al proveedor elegido.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.incidencias_elevador (id, company_id, project_id, descripcion, proveedor_id, empresa_servicio)
VALUES ('60000000-0000-0000-0000-0000000000e1', :C::uuid, :C1::uuid, 'Puerta no cierra', :P1::uuid, 'texto que escribió la pantalla');
INSERT INTO public.control_sistema_incendio (id, company_id, project_id, identificador, ubicacion, proveedor_id)
VALUES ('60000000-0000-0000-0000-0000000000f1', :C::uuid, :C1::uuid, 'EXT-001', 'Lobby', :P2::uuid);
SELECT public.chk_falla($$ INSERT INTO public.control_generador (company_id, project_id, proveedor_id)
     VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-0000000000d1') $$,
  'OPERACIONES_PROVEEDOR_AJENO', '6 · un registro nuevo no se liga a un proveedor de otra empresa');
RESET ROLE;
SELECT public.chk_txt((SELECT empresa_servicio FROM public.incidencias_elevador WHERE id = '60000000-0000-0000-0000-0000000000e1'), 'Ferretería Bloque B',
  '6 · al guardar con proveedor del catálogo, el texto es el nombre del catálogo (no lo que mandó la pantalla)');
SELECT public.chk_txt((SELECT empresa_servicio FROM public.control_sistema_incendio WHERE id = '60000000-0000-0000-0000-0000000000f1'), 'Servicios Bloque B',
  '6 · también en contra incendios');

-- Proveedor suspendido (en general o en el proyecto): no admite registros nuevos; lo ya ligado se sigue editando.
UPDATE public.proveedores SET estado = 'suspendido', motivo_estado = 'Papelería vencida' WHERE id = :P3::uuid;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.mantenimiento_cisterna (company_id, project_id, proveedor_id)
     VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000003') $$,
  'OPERACIONES_PROVEEDOR_NO_DISPONIBLE', '6 · una cisterna nueva no se liga a un proveedor suspendido');
SELECT public.chk_falla($$ INSERT INTO public.mantenimiento_jardineria (company_id, project_id, areas, proveedor_id)
     VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001',ARRAY['Perímetro'],'e3000000-0000-0000-0000-000000000003') $$,
  'OPERACIONES_PROVEEDOR_NO_DISPONIBLE', '6 · ni un servicio de jardinería');
RESET ROLE;
UPDATE public.proveedores SET estado = 'autorizado' WHERE id = :P3::uuid;
-- (P3 sigue suspendido en el proyecto C1 desde la sección 3)
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.incidencias_elevador (company_id, project_id, descripcion, proveedor_id)
     VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','Ruido','e3000000-0000-0000-0000-000000000003') $$,
  'OPERACIONES_PROVEEDOR_NO_DISPONIBLE', '6 · suspendido en el proyecto bloquea ahí');
INSERT INTO public.incidencias_elevador (id, company_id, project_id, descripcion, proveedor_id)
VALUES ('60000000-0000-0000-0000-0000000000e2', :C::uuid, :C2::uuid, 'Ruido', :P3::uuid);
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.incidencias_elevador WHERE id = '60000000-0000-0000-0000-0000000000e2'), 1,
  '6 · pero en otro proyecto donde sigue habilitado, sí');
UPDATE public.proveedores SET estado = 'suspendido', motivo_estado = 'x' WHERE id = :P3::uuid;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.incidencias_elevador SET estado = 'resuelto' WHERE id = '60000000-0000-0000-0000-0000000000e2';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.incidencias_elevador WHERE id = '60000000-0000-0000-0000-0000000000e2'), 'resuelto',
  '6 · lo ya ligado se sigue pudiendo atender tras la suspensión');
UPDATE public.proveedores SET estado = 'autorizado' WHERE id = :P3::uuid;

-- Otra empresa no ve ni vincula lo ajeno.
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE vp6d AS SELECT * FROM public.operaciones_sin_proveedor_vista_previa();
SELECT public.chk_falla($$ SELECT public.operaciones_vincular_proveedor('mantenimiento_cisterna','60000000-0000-0000-0000-0000000000c2'::uuid,'e3000000-0000-0000-0000-0000000000d1'::uuid) $$,
  'OPERACIONES_VINCULO_NO_APLICA', '6 · otra empresa no puede vincular registros ajenos (RLS)');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM vp6d WHERE tabla NOT IN ('suministros_condominio', 'proformas_condominio')), 0,
  '6 · y su vista previa no los lista');
