\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · IDENTIDAD DEL PROVEEDOR, CÓDIGO VISIBLE Y PROYECTOS
-- ============================================================================
\set A     '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set B     '''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'''
\set A1    '''a1a1a1a1-0000-0000-0000-000000000001'''
\set A2    '''a2a2a2a2-0000-0000-0000-000000000001'''
\set B1    '''b1b1b1b1-0000-0000-0000-000000000001'''
\set UA    '''a0a0a0a0-0000-0000-0000-00000000000a'''
\set UP1   '''a0a0a0a0-0000-0000-0000-00000000000f'''
\set UP2   '''a0a0a0a0-0000-0000-0000-000000000012'''
\set UC    '''a0a0a0a0-0000-0000-0000-00000000000c'''
\set UCS   '''a0a0a0a0-0000-0000-0000-000000000013'''
\set UO    '''a0a0a0a0-0000-0000-0000-00000000000d'''
\set UN    '''a0a0a0a0-0000-0000-0000-00000000000e'''
\set UB    '''b0b0b0b0-0000-0000-0000-00000000000b'''

SELECT public.como(:UA::uuid);
SELECT public.chk_uuid(public.get_my_company_id(), :A::uuid, '0 · la sesión de UA resuelve a la empresa A');

-- ── 1. Nada existente cambia de naturaleza ──────────────────────────────────
-- Las columnas nuevas nacen con valores que no alteran lo que ya era: alcance
-- empresa, sin país ni código inventados.
SELECT public.chk_txt(
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'proveedores' AND column_name = 'alcance'),
  '''empresa''::text', '1 · el alcance por defecto es empresa (lo legado sigue sirviendo a todo)');

-- ── 2. Alta con identificación: normalización, país y código ────────────────
SET ROLE authenticated;
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, email)
VALUES ('d1000000-0000-0000-0000-0000000000a1', :A::uuid, 'Ferretería La Unión', '1234567-8', 'gt', 'ventas@launion.test');
RESET ROLE;

SELECT public.chk_txt((SELECT pais FROM public.proveedores WHERE id = 'd1000000-0000-0000-0000-0000000000a1'),
  'GT', '2 · el país se guarda en mayúsculas');
SELECT public.chk_txt((SELECT identificacion_norm FROM public.proveedores WHERE id = 'd1000000-0000-0000-0000-0000000000a1'),
  '12345678', '2 · la identificación se normaliza (sin guion)');
SELECT public.chk_bool((SELECT codigo ~ '^PRV-[0-9]{5}$' FROM public.proveedores WHERE id = 'd1000000-0000-0000-0000-0000000000a1'),
  true, '2 · sin código dado, el servidor asigna uno por correlativo');
SELECT public.chk_txt((SELECT estado FROM public.proveedores WHERE id = 'd1000000-0000-0000-0000-0000000000a1'),
  'borrador', '2 · el alta NO autoriza: nace en borrador');
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE id = 'd1000000-0000-0000-0000-0000000000a1' AND autorizado_por IS NOT NULL), 0,
  '2 · y no queda sello de autorización');

-- ── 3. Duplicados por identificación fiscal ─────────────────────────────────
SELECT public.chk_falla($$
  INSERT INTO public.proveedores (company_id, nombre, nit, pais)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Otra razón social', '12345678', 'GT') $$,
  'PROVEEDOR_DUPLICADO', '3 · mismo NIT sin guion y mismo país: rechazado');

SELECT public.chk_falla($$
  INSERT INTO public.proveedores (company_id, nombre, nit, pais)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Otro nombre', ' 1234567 8 ', 'gt') $$,
  'PROVEEDOR_DUPLICADO', '3 · mismo NIT con espacios y minúsculas: rechazado');

SELECT public.chk_falla($$
  INSERT INTO public.proveedores (company_id, nombre, rfc, pais)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Con RFC', '1234567-8', 'GT') $$,
  'PROVEEDOR_DUPLICADO', '3 · el mismo número como RFC también cuenta como la misma identificación');

-- Mismo número en OTRO país: es otro proveedor.
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais)
VALUES ('d1000000-0000-0000-0000-0000000000a2', :A::uuid, 'Distribuidora México', '1234567-8', 'MX');
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE company_id = :A::uuid AND identificacion_norm = '12345678'), 2,
  '3 · el mismo número en otro país conocido es otro proveedor');

-- Otra EMPRESA: jamás se comparte ni se detecta como duplicado.
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais)
VALUES ('d1000000-0000-0000-0000-0000000000b1', :B::uuid, 'Ferretería La Unión', '1234567-8', 'GT');
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE identificacion_norm = '12345678'), 3,
  '3 · la misma identificación en otra empresa convive (no se comparte entre empresas)');

-- País desconocido (lo legado) = comodín: más prudente que suponer distinto.
INSERT INTO public.proveedores (id, company_id, nombre, nit)
VALUES ('d1000000-0000-0000-0000-0000000000a3', :A::uuid, 'Proveedor legado', 'ABC-123');
SELECT public.chk_falla($$
  INSERT INTO public.proveedores (company_id, nombre, nit, pais)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Nuevo con país', 'abc123', 'GT') $$,
  'PROVEEDOR_DUPLICADO', '3 · contra un legado sin país, la guarda trata el país como comodín');

-- Dos altas simultáneas se prueban con sesiones reales en run.sh (sección 7).

-- ── 4. Sin identificación fiscal: no es lo mismo que «idéntico» ─────────────
INSERT INTO public.proveedores (id, company_id, nombre, nit) VALUES
  ('d1000000-0000-0000-0000-0000000000c1', :A::uuid, 'Consumidor final 1', 'C/F'),
  ('d1000000-0000-0000-0000-0000000000c2', :A::uuid, 'Consumidor final 2', 'CF');
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE id IN
  ('d1000000-0000-0000-0000-0000000000c1', 'd1000000-0000-0000-0000-0000000000c2') AND identificacion_norm IS NULL), 2,
  '4 · «C/F» y similares no cuentan como identificación: no chocan entre sí');

-- Nombres que se PARECEN no se unen ni se rechazan por parecerse.
INSERT INTO public.proveedores (id, company_id, nombre) VALUES
  ('d1000000-0000-0000-0000-0000000000d1', :A::uuid, 'Limpieza Total'),
  ('d1000000-0000-0000-0000-0000000000d2', :A::uuid, 'LIMPIEZA TOTAL'),
  ('d1000000-0000-0000-0000-0000000000d3', :A::uuid, 'Limpieza Total, S.A.');
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE company_id = :A::uuid
                    AND public.proveedor_normalizar_nombre(nombre) LIKE 'limpieza total%'), 3,
  '4 · nombres parecidos conviven: no se fusionan automáticamente');

-- ── 5. Código visible: único por empresa, sin distinguir mayúsculas ─────────
SELECT public.chk_falla(format($$
  INSERT INTO public.proveedores (company_id, nombre, codigo) VALUES (%L, 'Código repetido', lower(%L)) $$,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    (SELECT codigo FROM public.proveedores WHERE id = 'd1000000-0000-0000-0000-0000000000a1')),
  'uq_proveedores_codigo', '5 · un código repetido (aun en minúsculas) se rechaza');

SELECT public.chk_falla($$
  INSERT INTO public.proveedores (company_id, nombre, codigo)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Código inválido', 'cod con espacios') $$,
  'proveedores_codigo_formato', '5 · el formato del código se valida');

-- El correlativo es POR EMPRESA: la empresa B también tiene su PRV-00001 (su
-- primer proveedor), y eso es legal — la unicidad es por empresa.
SELECT public.chk(
  (SELECT count(DISTINCT company_id) FROM public.proveedores
    WHERE codigo = (SELECT codigo FROM public.proveedores WHERE id = 'd1000000-0000-0000-0000-0000000000a1')), 2,
  '5 · el mismo código existe en dos empresas distintas (la unicidad es por empresa)');

-- El código visible nunca es la clave foránea de nada.
SELECT public.chk(
  (SELECT count(*) FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = ANY (c.confkey)
    WHERE c.contype = 'f' AND c.confrelid = 'public.proveedores'::regclass AND a.attname <> 'id'), 0,
  '5 · ninguna FK apunta a otra columna de proveedores que no sea `id` (el código no es FK)');

-- No se crean cuentas contables por crear proveedores.
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuentas WHERE company_id = :A::uuid), 15,
  '5 · crear proveedores no crea subcuentas contables (el catálogo de A sigue con sus 15 cuentas)');

-- ── 6. Duplicados LEGADOS: se listan, no se fusionan ────────────────────────
ALTER TABLE public.proveedores DISABLE TRIGGER trg_proveedores_identidad;
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais) VALUES
  ('d1000000-0000-0000-0000-0000000000e1', :A::uuid, 'Legado duplicado 1', 'LEG-001', 'GT'),
  ('d1000000-0000-0000-0000-0000000000e2', :A::uuid, 'Legado duplicado 2', 'leg001',  'GT');
ALTER TABLE public.proveedores ENABLE TRIGGER trg_proveedores_identidad;

SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.proveedores_duplicados_fiscales()
                    WHERE identificacion_norm = 'LEG001' AND cantidad = 2), 1,
  '6 · los duplicados legados se listan (un grupo de 2)');
SELECT public.chk((SELECT count(*) FROM public.proveedores_duplicados_fiscales()
                    WHERE identificacion_norm = '12345678'), 0,
  '6 · el mismo número en dos países conocidos NO figura como duplicado');
-- Editar un duplicado legado (algo que no es su identidad) no se bloquea.
UPDATE public.proveedores SET telefono = '5555-0000' WHERE id = 'd1000000-0000-0000-0000-0000000000e1';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE id IN
  ('d1000000-0000-0000-0000-0000000000e1', 'd1000000-0000-0000-0000-0000000000e2')), 2,
  '6 · editar un legado duplicado funciona y ninguno se fusionó ni se borró');

SELECT public.como(:UN::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT * FROM public.proveedores_duplicados_fiscales() $$, '42501|No autorizado',
  '6 · un operador sin permiso contable no consulta duplicados');
RESET ROLE;
SELECT public.como(:UA::uuid);

-- ── 7. Autorización general vs. habilitación por proyecto ───────────────────
-- Un proveedor, dos proyectos, configuración distinta.
SET ROLE authenticated;
INSERT INTO public.proveedor_proyectos (company_id, proveedor_id, project_id, dias_credito, condiciones_pago) VALUES
  (:A::uuid, 'd1000000-0000-0000-0000-0000000000a1', :A1::uuid, 30, 'Neto 30 contra entrega'),
  (:A::uuid, 'd1000000-0000-0000-0000-0000000000a1', :A2::uuid, 60, 'Neto 60, factura mensual');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.proveedor_proyectos WHERE proveedor_id = 'd1000000-0000-0000-0000-0000000000a1'), 2,
  '7 · el proveedor se vincula a varios proyectos de la misma empresa');
SELECT public.chk_txt((SELECT estado FROM public.proveedor_proyectos
                        WHERE proveedor_id = 'd1000000-0000-0000-0000-0000000000a1' AND project_id = :A1::uuid),
  'pendiente', '7 · vincular NO habilita: nace pendiente');
SELECT public.chk((SELECT dias_credito FROM public.proveedor_proyectos
                    WHERE proveedor_id = 'd1000000-0000-0000-0000-0000000000a1' AND project_id = :A1::uuid), 30,
  '7 · cada proyecto conserva su propia configuración (A1: 30 días)');
SELECT public.chk((SELECT dias_credito FROM public.proveedor_proyectos
                    WHERE proveedor_id = 'd1000000-0000-0000-0000-0000000000a1' AND project_id = :A2::uuid), 60,
  '7 · …y A2 la suya (60 días)');

-- No se habilita a quien la empresa no ha autorizado.
SET ROLE authenticated;
SELECT public.chk_falla($$
  UPDATE public.proveedor_proyectos SET estado = 'habilitado'
   WHERE proveedor_id = 'd1000000-0000-0000-0000-0000000000a1'
     AND project_id = 'a1a1a1a1-0000-0000-0000-000000000001' $$,
  'PROVEEDOR_NO_AUTORIZADO', '7 · no se habilita en un proyecto a un proveedor sin autorización general');
RESET ROLE;

-- Autorizar (acto de la empresa), con permiso de cambio de estado.
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$
  UPDATE public.proveedores SET estado = 'autorizado' WHERE id = 'd1000000-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_NO_AUTORIZADO', '7 · un contador SIN cambio de estado no autoriza al proveedor');
RESET ROLE;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.proveedores SET estado = 'autorizado' WHERE id = 'd1000000-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.proveedores WHERE id = 'd1000000-0000-0000-0000-0000000000a1'),
  'autorizado', '7 · el admin autoriza (autorización GENERAL, nivel empresa)');

-- Habilitar por proyecto también exige permiso de cambio de estado.
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$
  UPDATE public.proveedor_proyectos SET estado = 'habilitado'
   WHERE proveedor_id = 'd1000000-0000-0000-0000-0000000000a1'
     AND project_id = 'a1a1a1a1-0000-0000-0000-000000000001' $$,
  'COMPRAS_NO_AUTORIZADO', '7 · habilitar en un proyecto exige el permiso de cambio de estado');
RESET ROLE;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.proveedor_proyectos SET estado = 'habilitado'
 WHERE proveedor_id = 'd1000000-0000-0000-0000-0000000000a1' AND project_id = :A1::uuid;
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.proveedor_proyectos
                        WHERE proveedor_id = 'd1000000-0000-0000-0000-0000000000a1' AND project_id = :A1::uuid),
  'habilitado', '7 · habilitado en A1');
SELECT public.chk_bool((SELECT habilitado_por IS NOT NULL AND habilitado_at IS NOT NULL
                         FROM public.proveedor_proyectos
                        WHERE proveedor_id = 'd1000000-0000-0000-0000-0000000000a1' AND project_id = :A1::uuid),
  true, '7 · y la habilitación queda sellada con autor y fecha');
SELECT public.chk_txt((SELECT estado FROM public.proveedor_proyectos
                        WHERE proveedor_id = 'd1000000-0000-0000-0000-0000000000a1' AND project_id = :A2::uuid),
  'pendiente', '7 · en A2 sigue pendiente: la habilitación es por proyecto');

-- proveedor_habilitado_en: alcance empresa (el de lo legado).
SELECT public.chk_bool(public.proveedor_habilitado_en('d1000000-0000-0000-0000-0000000000a1', :A2::uuid), true,
  '7 · alcance «empresa»: habilitado también en A2 (sin veto) y en la contabilidad de empresa');
SELECT public.chk_bool(public.proveedor_habilitado_en('d1000000-0000-0000-0000-0000000000a1', NULL), true,
  '7 · alcance «empresa»: habilitado en la contabilidad de empresa');

-- Alcance «proyectos»: solo donde está habilitado.
UPDATE public.proveedores SET alcance = 'proyectos' WHERE id = 'd1000000-0000-0000-0000-0000000000a1';
SELECT public.chk_bool(public.proveedor_habilitado_en('d1000000-0000-0000-0000-0000000000a1', :A1::uuid), true,
  '7 · alcance «proyectos»: habilitado en A1');
SELECT public.chk_bool(public.proveedor_habilitado_en('d1000000-0000-0000-0000-0000000000a1', :A2::uuid), false,
  '7 · alcance «proyectos»: NO habilitado en A2 (solo pendiente)');
SELECT public.chk_bool(public.proveedor_habilitado_en('d1000000-0000-0000-0000-0000000000a1', NULL), false,
  '7 · alcance «proyectos»: NO sirve a la contabilidad de la empresa (sin proyecto)');
SELECT public.chk_bool(public.proveedor_habilitado_en('d1000000-0000-0000-0000-0000000000a1', :B1::uuid), false,
  '7 · y un proyecto ajeno nunca lo habilita');

-- ── 8. El candado de la orden de compra consulta el proyecto ────────────────
-- (el trigger de proveedor autorizado ya existía; este añade el proyecto)
SET ROLE authenticated;
SELECT public.chk_falla($$
  INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2a2a2a2-0000-0000-0000-000000000001',
          'd1000000-0000-0000-0000-0000000000a1', 'Ferretería La Unión', 'Compra en A2', 'aprobada') $$,
  'COMPRAS_PROVEEDOR_PROYECTO_NO_HABILITADO', '8 · aprobar una orden en un proyecto donde NO está habilitado: rechazado');
SELECT public.chk_falla($$
  INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
          'd1000000-0000-0000-0000-0000000000a1', 'Ferretería La Unión', 'Compra de empresa', 'aprobada') $$,
  'COMPRAS_PROVEEDOR_PROYECTO_NO_HABILITADO', '8 · y en la contabilidad de la empresa tampoco (alcance proyectos)');
-- Capturar el borrador NO se bloquea (se prepara mientras se habilita).
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
VALUES ('0c000000-0000-0000-0000-0000000000a2', :A::uuid, :A2::uuid,
        'd1000000-0000-0000-0000-0000000000a1', 'Ferretería La Unión', 'Borrador en A2', 'borrador');
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
VALUES ('0c000000-0000-0000-0000-0000000000a1', :A::uuid, :A1::uuid,
        'd1000000-0000-0000-0000-0000000000a1', 'Ferretería La Unión', 'Compra en A1', 'aprobada');
RESET ROLE;
SELECT public.chk_bool((SELECT numero IS NOT NULL FROM public.ordenes_compra WHERE id = '0c000000-0000-0000-0000-0000000000a1'),
  true, '8 · en el proyecto donde SÍ está habilitado la orden se aprueba y numera');

-- ── 9. Suspensión en un proyecto: veto, aunque el alcance sea de empresa ────
UPDATE public.proveedores SET alcance = 'empresa' WHERE id = 'd1000000-0000-0000-0000-0000000000a1';
SET ROLE authenticated;
SELECT public.chk_falla($$
  UPDATE public.proveedor_proyectos SET estado = 'suspendido'
   WHERE proveedor_id = 'd1000000-0000-0000-0000-0000000000a1'
     AND project_id = 'a1a1a1a1-0000-0000-0000-000000000001' $$,
  'proveedor_proyecto_motivo', '9 · suspender en un proyecto exige motivo');
UPDATE public.proveedor_proyectos SET estado = 'suspendido', motivo_estado = 'Incumplió dos entregas'
 WHERE proveedor_id = 'd1000000-0000-0000-0000-0000000000a1' AND project_id = :A1::uuid;
RESET ROLE;
SELECT public.chk_bool(public.proveedor_habilitado_en('d1000000-0000-0000-0000-0000000000a1', :A1::uuid), false,
  '9 · el veto del proyecto gana aunque el alcance sea «empresa»');
SELECT public.chk_bool(public.proveedor_habilitado_en('d1000000-0000-0000-0000-0000000000a1', :A2::uuid), true,
  '9 · …y no afecta a los demás proyectos');
-- La obligación existente NO se borra: la OC ya aprobada sigue ahí.
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id = '0c000000-0000-0000-0000-0000000000a1'), 1,
  '9 · suspender no borra obligaciones existentes (la orden aprobada sigue)');
-- Reanudar: se vuelve a habilitar (con permiso).
SET ROLE authenticated;
UPDATE public.proveedor_proyectos SET estado = 'habilitado', motivo_estado = NULL
 WHERE proveedor_id = 'd1000000-0000-0000-0000-0000000000a1' AND project_id = :A1::uuid;
RESET ROLE;
SELECT public.chk_bool(public.proveedor_habilitado_en('d1000000-0000-0000-0000-0000000000a1', :A1::uuid), true,
  '9 · reanudar restablece la habilitación');

-- ── 10. Aislamiento: tablas nuevas, empresa y proyecto ──────────────────────
-- Otra empresa no ve ni toca nada.
SELECT public.como(:UB::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.proveedor_proyectos), 0,
  '10 · UB (otra empresa) no ve vínculos proveedor↔proyecto de A');
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE company_id = :A::uuid), 0,
  '10 · UB no ve proveedores de A');
SELECT public.chk_falla($$
  INSERT INTO public.proveedor_proyectos (company_id, proveedor_id, project_id)
  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'd1000000-0000-0000-0000-0000000000a1',
          'b1b1b1b1-0000-0000-0000-000000000001') $$,
  'PROVEEDOR_AJENO|row-level security', '10 · UB no vincula un proveedor de A a su proyecto');
SELECT public.chk_bool(public.proveedor_habilitado_en('d1000000-0000-0000-0000-0000000000a1', :A1::uuid), false,
  '10 · proveedor_habilitado_en no sirve para sondear proveedores de otra empresa');
RESET ROLE;

-- Un admin asignado solo a A1 ve solo A1.
SELECT public.como(:UP1::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.proveedor_proyectos), 1,
  '10 · UP1 (solo A1) ve únicamente el vínculo de A1');
SELECT public.chk_falla($$
  INSERT INTO public.proveedor_proyectos (company_id, proveedor_id, project_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd1000000-0000-0000-0000-0000000000a3',
          'a2a2a2a2-0000-0000-0000-000000000001') $$,
  'row-level security', '10 · UP1 no crea vínculos en un proyecto que no tiene asignado (A2)');
RESET ROLE;

-- Operativo sin permiso contable: lee, no escribe.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.proveedor_proyectos), 1,
  '10 · UO ve los vínculos de SU proyecto (consulta operativa)');
SELECT public.chk_falla($$
  INSERT INTO public.proveedor_proyectos (company_id, proveedor_id, project_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd1000000-0000-0000-0000-0000000000a3',
          'a1a1a1a1-0000-0000-0000-000000000001') $$,
  'row-level security', '10 · UO no crea vínculos (sin permiso contable)');
SELECT public.chk_falla($$
  INSERT INTO public.proveedor_contactos (company_id, proveedor_id, nombre)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd1000000-0000-0000-0000-0000000000a1', 'Intruso') $$,
  'row-level security', '10 · UO no crea contactos del proveedor');
RESET ROLE;

-- ── 11. Contactos reutilizables ─────────────────────────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.proveedor_contactos (id, company_id, proveedor_id, nombre, cargo, email, telefono, es_principal) VALUES
  ('c0000000-0000-0000-0000-0000000000a1', :A::uuid, 'd1000000-0000-0000-0000-0000000000a1', 'Marta Ruiz', 'Ventas', 'marta@launion.test', '5555-1111', true),
  ('c0000000-0000-0000-0000-0000000000a2', :A::uuid, 'd1000000-0000-0000-0000-0000000000a1', 'Pedro Díaz', 'Cobros', 'pedro@launion.test', '5555-2222', false);
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.proveedor_contactos WHERE proveedor_id = 'd1000000-0000-0000-0000-0000000000a1'), 2,
  '11 · un proveedor tiene varios contactos');
SELECT public.chk_falla($$
  INSERT INTO public.proveedor_contactos (company_id, proveedor_id, nombre, es_principal)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd1000000-0000-0000-0000-0000000000a1', 'Otro principal', true) $$,
  'uq_proveedor_contacto_principal', '11 · solo un contacto principal por proveedor');
SELECT public.chk_falla($$
  INSERT INTO public.proveedor_contactos (company_id, proveedor_id, nombre)
  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'd1000000-0000-0000-0000-0000000000a1', 'Cruzado') $$,
  'PROVEEDOR_AJENO', '11 · un contacto no cuelga de un proveedor de otra empresa');

-- ── 12. Papelería sensible: no la lee cualquier usuario de la empresa ───────
INSERT INTO public.proveedor_documentos (company_id, proveedor_id, tipo, numero, archivo_url)
VALUES (:A::uuid, 'd1000000-0000-0000-0000-0000000000a1', 'referencia_bancaria', 'BAN-123', 'https://ejemplo.test/ref.pdf');

SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.proveedor_documentos), 0,
  '12 · UO (consulta operativa) NO lee la papelería del proveedor (referencia bancaria, DPI, RTU)');
RESET ROLE;
SELECT public.como(:UN::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.proveedor_documentos), 0,
  '12 · UN (sin permisos) tampoco');
RESET ROLE;
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.proveedor_documentos), 1,
  '12 · UC (puede ver Contabilidad) sí la lee');
RESET ROLE;
SELECT public.como(:UB::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.proveedor_documentos), 0,
  '12 · UB (otra empresa) no la lee');
RESET ROLE;
SELECT public.como(:UA::uuid);
SELECT public.chk_txt('ok', 'ok', 'IDENTIDAD · bloque completo');
