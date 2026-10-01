\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · CONTRATOS HISTÓRICOS SIN PROVEEDOR VINCULADO
-- ============================================================================
\set A     '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set A1    '''a1a1a1a1-0000-0000-0000-000000000001'''
\set A2    '''a2a2a2a2-0000-0000-0000-000000000001'''
\set UA    '''a0a0a0a0-0000-0000-0000-00000000000a'''
\set UP1   '''a0a0a0a0-0000-0000-0000-00000000000f'''
\set UP2   '''a0a0a0a0-0000-0000-0000-000000000012'''
\set UN    '''a0a0a0a0-0000-0000-0000-00000000000e'''
\set UB    '''b0b0b0b0-0000-0000-0000-00000000000b'''
\set P1    '''d1000000-0000-0000-0000-0000000000a1'''

SELECT public.como(:UA::uuid);

-- Padrón histórico (insertado como sistema: así llegó de antes del catálogo).
SET conta.allow_system_write = on;
INSERT INTO public.contratos_proveedores
  (id, company_id, project_id, proveedor_nombre, proveedor_email, servicio, fecha_inicio, estado, monto_mensual) VALUES
  ('cc000000-0000-0000-0000-0000000000e1', :A::uuid, :A1::uuid, 'FERRETERÍA LA UNIÓN',          NULL, 'mantenimiento', '2024-01-01', 'activo', 500),
  ('cc000000-0000-0000-0000-0000000000e2', :A::uuid, :A1::uuid, 'Ferretería La Unión, S.A.',    NULL, 'mantenimiento', '2024-01-01', 'activo', 500),
  ('cc000000-0000-0000-0000-0000000000e3', :A::uuid, :A1::uuid, 'Limpieza Total',               NULL, 'limpieza',      '2024-01-01', 'activo', 900),
  ('cc000000-0000-0000-0000-0000000000e4', :A::uuid, :A1::uuid, 'Empresa Inexistente S.A.',     NULL, 'otro',          '2024-01-01', 'activo', 100),
  ('cc000000-0000-0000-0000-0000000000e5', :A::uuid, :A2::uuid, 'Eléctricos del Norte, S.A.',   NULL, 'otro',          '2024-01-01', 'activo', 700),
  ('cc000000-0000-0000-0000-0000000000e6', :A::uuid, :A1::uuid, 'Don Pedro Ferretero',  'ventas@launion.test', 'otro',   '2024-01-01', 'activo', 200);
RESET conta.allow_system_write;

CREATE TEMP TABLE h_antes AS
SELECT (SELECT count(*) FROM public.proveedores WHERE company_id = :A::uuid)                     AS proveedores,
       (SELECT count(*) FROM public.contratos_proveedores WHERE company_id = :A::uuid)           AS contratos,
       (SELECT count(*) FROM public.contratos_proveedores WHERE company_id = :A::uuid
                                                         AND proveedor_id IS NOT NULL)            AS vinculados,
       (SELECT count(*) FROM public.proveedores WHERE company_id = :A::uuid AND estado = 'autorizado') AS autorizados,
       (SELECT string_agg(id::text || ':' || proveedor_nombre, '|' ORDER BY id)
          FROM public.contratos_proveedores WHERE proveedor_id IS NULL AND company_id = :A::uuid)  AS textos;
GRANT SELECT ON h_antes TO authenticated;

-- ── 1. Vista previa: clasificación ──────────────────────────────────────────
SET ROLE authenticated;
CREATE TEMP TABLE h_prev AS SELECT * FROM public.contratos_sin_proveedor_vista_previa();
GRANT SELECT ON h_prev TO authenticated;
RESET ROLE;

SELECT public.chk_txt((SELECT clasificacion FROM h_prev WHERE contrato_id = 'cc000000-0000-0000-0000-0000000000e1'),
  'inequivoca', '1 · mismo nombre normalizado (mayúsculas y acentos aparte) con UN solo proveedor: inequívoca');
SELECT public.chk_txt((SELECT clasificacion FROM h_prev WHERE contrato_id = 'cc000000-0000-0000-0000-0000000000e2'),
  'ambigua', '1 · solo difiere en la forma societaria (S.A.): AMBIGUA, requiere elección manual');
SELECT public.chk_txt((SELECT clasificacion FROM h_prev WHERE contrato_id = 'cc000000-0000-0000-0000-0000000000e3'),
  'ambigua', '1 · varios proveedores con el mismo nombre normalizado: AMBIGUA');
SELECT public.chk((SELECT jsonb_array_length(candidatos) FROM h_prev WHERE contrato_id = 'cc000000-0000-0000-0000-0000000000e3'), 3,
  '1 · y se listan TODOS los candidatos para elegir (2 por nombre + 1 por forma societaria)');
SELECT public.chk_txt((SELECT clasificacion FROM h_prev WHERE contrato_id = 'cc000000-0000-0000-0000-0000000000e4'),
  'sin_coincidencia', '1 · sin proveedor parecido: sin_coincidencia');
SELECT public.chk_txt((SELECT clasificacion FROM h_prev WHERE contrato_id = 'cc000000-0000-0000-0000-0000000000e5'),
  'inequivoca', '1 · coincidencia inequívoca también en el proyecto A2');
SELECT public.chk_txt((SELECT clasificacion FROM h_prev WHERE contrato_id = 'cc000000-0000-0000-0000-0000000000e6'),
  'ambigua', '1 · solo coincide el CORREO (no el nombre): ambigua, no se propone vínculo');
SELECT public.chk_txt((SELECT candidatos -> 0 ->> 'criterio' FROM h_prev WHERE contrato_id = 'cc000000-0000-0000-0000-0000000000e6'),
  'mismo_correo', '1 · y el criterio queda explícito');

-- La vista previa NO modifica nada.
SELECT public.chk((SELECT count(*) FROM public.contratos_proveedores
                    WHERE company_id = :A::uuid AND proveedor_id IS NOT NULL), (SELECT vinculados FROM h_antes),
  '1 · la vista previa no vinculó ningún contrato');
SELECT public.chk((SELECT count(*) FROM public.contrato_proveedor_eventos WHERE tipo = 'vinculo_proveedor'), 0,
  '1 · ni dejó eventos de vínculo');

-- ── 2. Conteos antes / después ──────────────────────────────────────────────
SET ROLE authenticated;
CREATE TEMP TABLE h_res AS SELECT public.contratos_vinculacion_resumen() AS r;
GRANT SELECT ON h_res TO authenticated;
RESET ROLE;
SELECT public.chk((SELECT (r -> 'antes' ->> 'total_contratos')::bigint FROM h_res), (SELECT contratos FROM h_antes),
  '2 · el resumen cuenta todos los contratos visibles');
SELECT public.chk((SELECT (r -> 'propuesta' ->> 'inequivocos')::bigint FROM h_res), 3,
  '2 · propone 3 inequívocos (F1, E1 y E5)');
SELECT public.chk((SELECT (r -> 'propuesta' ->> 'ambiguos')::bigint FROM h_res), 3,
  '2 · 3 ambiguos (E2, E3, E6) que requieren elección manual');
SELECT public.chk((SELECT (r -> 'propuesta' ->> 'sin_coincidencia')::bigint FROM h_res), 1,
  '2 · 1 sin coincidencia (E4)');
SELECT public.chk((SELECT (r -> 'despues_de_aplicar_inequivocos' ->> 'vinculados')::bigint FROM h_res),
  (SELECT vinculados FROM h_antes) + 3, '2 · «después» = vinculados de hoy + los 3 inequívocos');

-- ── 3. Permisos y alcance ───────────────────────────────────────────────────
SELECT public.como(:UN::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT * FROM public.contratos_sin_proveedor_vista_previa() $$, '42501|No autorizado',
  '3 · sin el permiso de la pestaña no se consulta la vista previa');
SELECT public.chk_falla($$ SELECT public.contratos_vincular_inequivocos(false) $$, '42501|No autorizado',
  '3 · ni se vincula');
RESET ROLE;
SELECT public.como(:UB::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.contratos_sin_proveedor_vista_previa()), 0,
  '3 · UB (otra empresa) no ve contratos sin vincular de A');
RESET ROLE;
SELECT public.como(:UP1::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.contratos_sin_proveedor_vista_previa() WHERE project_id = :A2::uuid), 0,
  '3 · UP1 (solo A1) no ve los contratos de A2 en la vista previa');
RESET ROLE;

-- ── 4. Simulación y aplicación solo de lo inequívoco ────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk((public.contratos_vincular_inequivocos(true) ->> 'propuestos')::bigint, 3,
  '4 · la simulación propone los 3 inequívocos');
SELECT public.chk((public.contratos_vincular_inequivocos() ->> 'vinculados')::bigint, 0,
  '4 · y por defecto (dry_run) no vincula nada');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.contratos_proveedores
                    WHERE company_id = :A::uuid AND proveedor_id IS NOT NULL), (SELECT vinculados FROM h_antes),
  '4 · tras simular, nada cambió');

-- UP1 (solo A1) aplica: solo toca lo que ve (F1 y E1; E5 es de A2).
SELECT public.como(:UP1::uuid);
SET ROLE authenticated;
SELECT (public.contratos_vincular_inequivocos(false) ->> 'lote') AS lote_up1 \gset
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.contratos_proveedores
                    WHERE company_id = :A::uuid AND proveedor_id IS NOT NULL), (SELECT vinculados FROM h_antes) + 2,
  '4 · UP1 vinculó solo los 2 inequívocos de SU proyecto');
SELECT public.chk_bool((SELECT proveedor_id IS NULL FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000e5'),
  true, '4 · el de A2 (que UP1 no ve) quedó sin tocar');
SELECT public.chk_uuid((SELECT proveedor_id FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000e1'),
  :P1::uuid, '4 · E1 quedó vinculado a «Ferretería La Unión»');
SELECT public.chk((SELECT count(*) FROM public.contratos_proveedores
                    WHERE id IN ('cc000000-0000-0000-0000-0000000000e2', 'cc000000-0000-0000-0000-0000000000e3',
                                 'cc000000-0000-0000-0000-0000000000e4', 'cc000000-0000-0000-0000-0000000000e6')
                      AND proveedor_id IS NOT NULL), 0,
  '4 · los ambiguos y los sin coincidencia NO se vincularon solos');

-- El texto histórico y los ids se conservan; no se inventa fotografía.
SELECT public.chk_txt((SELECT proveedor_nombre FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000e1'),
  'FERRETERÍA LA UNIÓN', '4 · el texto histórico del contrato se conserva tal cual');
SELECT public.chk_bool((SELECT proveedor_snapshot IS NULL FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000e1'),
  true, '4 · y NO se inventa una «fotografía» que nadie firmó');
-- Sin fusiones, sin borrados, sin autorizaciones nuevas.
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE company_id = :A::uuid), (SELECT proveedores FROM h_antes),
  '4 · no se fusionó ni se borró ningún proveedor');
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE company_id = :A::uuid AND estado = 'autorizado'),
  (SELECT autorizados FROM h_antes), '4 · no se autorizó a ningún proveedor');
SELECT public.chk((SELECT count(*) FROM public.contratos_proveedores WHERE company_id = :A::uuid), (SELECT contratos FROM h_antes),
  '4 · no se borró ningún contrato');
SELECT public.chk((SELECT count(*) FROM public.contrato_proveedor_eventos
                    WHERE tipo = 'vinculo_proveedor' AND lote_vinculacion = :'lote_up1'::uuid), 2,
  '4 · cada vínculo dejó su evento con el lote (base de la reversión)');

-- UA aplica el resto de inequívocos (E5, en A2).
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT (public.contratos_vincular_inequivocos(false) ->> 'lote') AS lote_ua \gset
RESET ROLE;
SELECT public.chk_uuid((SELECT proveedor_id FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000e5'),
  'd2000000-0000-0000-0000-0000000000a6'::uuid, '4 · UA vinculó el inequívoco restante (E5 → Eléctricos del Norte)');

-- ── 5. Los ambiguos: selección MANUAL ───────────────────────────────────────
SET ROLE authenticated;
SELECT public.contrato_vincular_proveedor('cc000000-0000-0000-0000-0000000000e2', :P1::uuid, 'Misma empresa con razón social S.A.') AS lote_manual \gset
RESET ROLE;
SELECT public.chk_uuid((SELECT proveedor_id FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000e2'),
  :P1::uuid, '5 · el ambiguo E2 se vincula eligiendo al proveedor a mano');
SELECT public.chk_txt((SELECT proveedor_nombre FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000e2'),
  'Ferretería La Unión, S.A.', '5 · y conserva su texto original («, S.A.»)');

SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.contrato_vincular_proveedor('cc000000-0000-0000-0000-0000000000e3', 'd1000000-0000-0000-0000-0000000000b1') $$,
  'PROVEEDOR_AJENO', '5 · no se vincula a un proveedor de OTRA empresa');
SELECT public.chk_falla($$ SELECT public.contrato_vincular_proveedor('cc000000-0000-0000-0000-0000000000e2', 'd2000000-0000-0000-0000-0000000000a6') $$,
  'CONTRATO_YA_VINCULADO', '5 · ni se re-vincula un contrato que ya tiene proveedor');
SELECT public.chk_falla($$ UPDATE public.contratos_proveedores SET proveedor_id = 'd1000000-0000-0000-0000-0000000000a1'
                           WHERE id = 'cc000000-0000-0000-0000-0000000000e3' $$,
  'CONTRATO_VINCULO_POR_RPC', '5 · el vínculo no se hace por UPDATE directo: solo por la RPC, que deja constancia');
RESET ROLE;
SELECT public.como(:UP2::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.contrato_vincular_proveedor('cc000000-0000-0000-0000-0000000000e3', 'd1000000-0000-0000-0000-0000000000a1') $$,
  'CONTRATO_INEXISTENTE', '5 · UP2 (solo A2) no puede vincular un contrato de A1');
RESET ROLE;
SELECT public.como(:UA::uuid);

-- ── 6. Reversión por lote ───────────────────────────────────────────────────
-- Se enlaza una OC al contrato E1 (activo, mismo proveedor y proyecto): su
-- vínculo ya no se puede deshacer sin romper esa relación.
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado, contrato_id)
VALUES ('0c000000-0000-0000-0000-0000000000e1', :A::uuid, :A1::uuid, :P1::uuid, 'Ferretería La Unión',
        'Orden al amparo de un contrato vinculado', 'borrador', 'cc000000-0000-0000-0000-0000000000e1');
SELECT public.chk_falla(format($$ SELECT public.contratos_vinculos_revertir(%L, '   ') $$, :'lote_up1'),
  'MOTIVO_REQUERIDO', '6 · revertir exige motivo');
SELECT public.contratos_vinculos_revertir(:'lote_up1'::uuid, 'Revisión: se vuelve a validar') AS res_rev \gset
RESET ROLE;
SELECT public.chk(((:'res_rev'::jsonb) ->> 'revertidos')::bigint, 1,
  '6 · se revierte el contrato sin relaciones (F1)');
SELECT public.chk(jsonb_array_length((:'res_rev'::jsonb) -> 'omitidos'), 1,
  '6 · …y se informa el omitido (E1, que ya tiene una orden de compra vinculada)');
SELECT public.chk_txt(((:'res_rev'::jsonb) -> 'omitidos' -> 0 ->> 'motivo'),
  'ya tiene órdenes de compra vinculadas', '6 · con su motivo');
SELECT public.chk_bool((SELECT proveedor_id IS NULL FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000f1'),
  true, '6 · F1 vuelve a quedar sin proveedor (estado previo restaurado)');
SELECT public.chk_txt((SELECT proveedor_nombre FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000f1'),
  'Ferretería La Unión', '6 · y su texto histórico jamás se tocó');
SELECT public.chk((SELECT count(*) FROM public.contrato_proveedor_eventos
                    WHERE contrato_id = 'cc000000-0000-0000-0000-0000000000f1' AND tipo = 'vinculo_revertido'), 1,
  '6 · la reversión también deja su evento');
SELECT public.chk_uuid((SELECT proveedor_id FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000e1'),
  :P1::uuid, '6 · E1 conserva su vínculo (no se deshace a ciegas)');

-- Revertir un lote de otra empresa no hace nada.
SELECT public.como(:UB::uuid);
SET ROLE authenticated;
SELECT public.chk(((public.contratos_vinculos_revertir(:'lote_ua'::uuid, 'intento cruzado')) ->> 'revertidos')::bigint, 0,
  '6 · UB no puede revertir el lote de otra empresa');
RESET ROLE;
SELECT public.como(:UA::uuid);

-- Cierre: ningún proveedor ni contrato se perdió en todo el bloque.
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE company_id = :A::uuid), (SELECT proveedores FROM h_antes),
  '7 · al final no se fusionó ni borró ningún proveedor');
SELECT public.chk((SELECT count(*) FROM public.contratos_proveedores WHERE company_id = :A::uuid), (SELECT contratos FROM h_antes),
  '7 · ni se borró ningún contrato');
SELECT public.chk_txt('ok', 'ok', 'HISTÓRICOS · bloque completo');
