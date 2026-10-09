\set ON_ERROR_STOP on
-- ============================================================================
-- OPCIONAL · prueba de la opción O1 (DEP-1.opcion_O1_interruptor_solo_admin.sql). NO es parte de la suite de
-- regresión de DEP-1/EV-07: solo tiene sentido si el dueño del producto elige O1.
-- Requiere la pieza DEP-1 de la migración 20261027000800 aplicado (para el paso 9) y una copia de hall_tpl (usuarios UQ/UA).
-- Hoy (sin la opción) el paso 1 FALLA: quien tiene `edit` apaga el interruptor, se autoaprueba y lo vuelve a encender.
-- Aserciones: [DEP-1.O1a] … Ids propios del grupo 6: fa601 (los mismos que DEP-1, hallazgo 01; rango 5xx).
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set D   '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UB  '''c0c0c0c0-0000-0000-0000-00000000000b'''
\set UQ  '''c0c0c0c0-0000-0000-0000-00000000001a'''
\set UR  '''fa601000-0000-0000-0000-0000000000c1'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''

CREATE TEMP TABLE fa6_o1_previa AS
SELECT c.* FROM public.compras_config c WHERE c.company_id IN ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd');

INSERT INTO auth.users (id) VALUES ('fa601000-0000-0000-0000-0000000000c1');
INSERT INTO public.app_users (id, company_id, full_name, role)
VALUES ('fa601000-0000-0000-0000-0000000000c1', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'O1 Super administrador', 'super_admin');

-- Separación encendida en C (como sistema).
INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES (:C::uuid, true)
  ON CONFLICT (company_id) DO UPDATE SET aprobacion_separada = true;

-- ── 1 · El ataque completo del solicitante con `edit` ───────────────────────
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('fa601501-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'O1 borrador de UQ');
SELECT public.chk_falla($$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[DEP-1.O1a] quien solicita y tiene «Editar» NO apaga el interruptor de la separación');
-- Borrar la fila equivale a apagarla. UQ no tiene «Eliminar» (la política lo deja en 0 filas); UC (contador con «Eliminar») sí llegaría al trigger.
DELETE FROM public.compras_config WHERE company_id = :C::uuid;
SELECT public.como('c0c0c0c0-0000-0000-0000-00000000000c'::uuid);
SELECT public.chk_falla($$ DELETE FROM public.compras_config WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[DEP-1.O1b] quien tiene «Eliminar» pero no es administrador no borra la configuración que la tiene encendida (sin fila = apagada)');
SELECT public.como(:UQ::uuid);
SELECT public.chk_falla($$ INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', false)
                           ON CONFLICT (company_id) DO UPDATE SET aprobacion_separada = EXCLUDED.aprobacion_separada $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[DEP-1.O1c] ni con INSERT … ON CONFLICT DO UPDATE (el upsert)');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'fa601501-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_AUTOAPROBACION', '[DEP-1.O1d] y por lo tanto sigue sin poder aprobar su propia orden');
RESET ROLE;
SELECT public.chk_bool((SELECT aprobacion_separada FROM public.compras_config WHERE company_id = :C::uuid), true,
  '[DEP-1.O1e] el interruptor sigue encendido tras los intentos');

-- ── 2 · Lo legítimo sigue funcionando ───────────────────────────────────────
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
UPDATE public.compras_config SET tolerancia_precio_pct = 7, monto_minimo_oc = 100 WHERE company_id = :C::uuid;
RESET ROLE;
SELECT public.chk_num((SELECT tolerancia_precio_pct FROM public.compras_config WHERE company_id = :C::uuid), 7,
  '[DEP-1.O1f] quien tiene «Editar» sigue cambiando las demás columnas (tolerancias, mínimo) con el interruptor sin tocar');

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = :C::uuid;
UPDATE public.compras_config SET aprobacion_separada = true  WHERE company_id = :C::uuid;
RESET ROLE;
SELECT public.chk_bool((SELECT aprobacion_separada FROM public.compras_config WHERE company_id = :C::uuid), true,
  '[DEP-1.O1g] el administrador de la empresa apaga y vuelve a encender el interruptor');

SELECT public.como(:UR::uuid);
SET ROLE authenticated;
UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = :C::uuid;
UPDATE public.compras_config SET aprobacion_separada = true  WHERE company_id = :C::uuid;
RESET ROLE;
SELECT public.chk_bool((SELECT aprobacion_separada FROM public.compras_config WHERE company_id = :C::uuid), true,
  '[DEP-1.O1h] el super administrador también');

-- Sin sesión de usuario (mantenimiento / service_role) el interruptor se maneja como siempre.
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = :C::uuid;
UPDATE public.compras_config SET aprobacion_separada = true  WHERE company_id = :C::uuid;
SELECT public.chk_bool((SELECT aprobacion_separada FROM public.compras_config WHERE company_id = :C::uuid), true,
  '[DEP-1.O1i] un proceso sin sesión de usuario cambia la configuración sin impedimento');

-- ── 3 · Una empresa que nunca encendió la separación no se ve afectada ──────
DELETE FROM public.compras_config WHERE company_id = :D::uuid;
SELECT public.como('d0d0d0d0-0000-0000-0000-00000000000d'::uuid);   -- administrador de D
SET ROLE authenticated;
INSERT INTO public.compras_config (company_id) VALUES (:D::uuid);                                        -- apagada (por defecto)
UPDATE public.compras_config SET tolerancia_cantidad_pct = 3 WHERE company_id = :D::uuid;
RESET ROLE;
SELECT public.chk_num((SELECT tolerancia_cantidad_pct FROM public.compras_config WHERE company_id = :D::uuid), 3,
  '[DEP-1.O1j] con la separación apagada la configuración se crea y edita como siempre');

-- ── Se deja la configuración como estaba ────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', '', false);
DELETE FROM public.compras_config WHERE company_id IN (:C::uuid, :D::uuid);
INSERT INTO public.compras_config SELECT * FROM fa6_o1_previa;
DROP TABLE fa6_o1_previa;
