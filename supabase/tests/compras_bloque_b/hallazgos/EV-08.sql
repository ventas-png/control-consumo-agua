\set ON_ERROR_STOP on
-- ============================================================================
-- EV-08 · El número de la orden, de la recepción y de la contraseña lo asigna SOLO el servidor:
--         un usuario con «crear» no puede reservar el próximo número y bloquear las aprobaciones.
--
-- CAUSA RAÍZ
--   OC-NNNNNN / REC-NNNNNN / CP-NNNNNN los pone el servidor con un correlativo
--   (compras_siguiente_correlativo) al aprobar la orden, registrar la recepción o emitir la
--   contraseña. Pero el cliente puede elegir el número al INSERTAR el borrador (o al UPDATE que
--   aprueba / registra): los triggers de estado asignan solo `IF NEW.numero IS NULL`. Quien reserva
--   el PRÓXIMO número hace que cada documento legítimo choque con el índice único
--   (uq_ordenes_compra_numero, uq_recepciones_numero, uq_contrasenas_numero) EN CADA INTENTO: el
--   contador se revierte con la transacción y vuelve a calcular el mismo número. Con la
--   inmutabilidad de 20261027000500 el administrador no puede repararlo (el número ya no cambia, el
--   borrador numerado no se borra —0200 exige numero IS NULL— y cancelar no libera el número).
--   Además el número de una recepción registrada o de una contraseña emitida se reescribía con
--   un UPDATE de quien tuviera «editar».
--
-- COMPORTAMIENTO ESPERADO (servidor, para sesiones de usuario)
--   · INSERT con numero distinto de NULL → se rechaza (COMPRAS_NUMERO_SOLO_SISTEMA), a cualquiera;
--   · UPDATE que cambia el numero (incluido NULL → valor en el mismo UPDATE que aprueba o
--     registra) → se rechaza;
--   · la aprobación / el registro / la emisión siguen numerando con el correlativo, sin saltos;
--   · un proceso sin sesión de usuario (importación de histórico, service_role) sí puede fijarlo.
--
-- Prefijo de ids de este grupo: fa5HHKKK-… (HH = 08 para EV-08).
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UQ  '''c0c0c0c0-0000-0000-0000-00000000001a'''
\set US  '''c0c0c0c0-0000-0000-0000-00000000001b'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''

-- Ayuda del grupo: ejecuta un SQL con la sesión que llama y devuelve 'OK' o el mensaje de error.
-- Lo que alcanza a ejecutarse QUEDA (no se revierte): así el rojo muestra el daño real.
CREATE OR REPLACE FUNCTION public.fa5_intenta(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$$;

-- El «próximo» número de cada tipo (lo que el servidor le toca al siguiente documento legítimo).
SELECT 'OC-'  || lpad((COALESCE((SELECT ultimo FROM public.compras_correlativos WHERE company_id = :C::uuid AND project_id = :C1::uuid AND documento = 'orden_compra'),    0) + 1)::text, 6, '0') AS prox_oc,
       'REC-' || lpad((COALESCE((SELECT ultimo FROM public.compras_correlativos WHERE company_id = :C::uuid AND project_id = :C1::uuid AND documento = 'recepcion'),       0) + 1)::text, 6, '0') AS prox_rec,
       'CP-'  || lpad((COALESCE((SELECT ultimo FROM public.compras_correlativos WHERE company_id = :C::uuid AND project_id = :C1::uuid AND documento = 'contrasena_pago'), 0) + 1)::text, 6, '0') AS prox_cp,
       'OC-'  || lpad((COALESCE((SELECT ultimo FROM public.compras_correlativos WHERE company_id = :C::uuid AND project_id = :C1::uuid AND documento = 'orden_compra'),    0) + 2)::text, 6, '0') AS prox_oc2,
       'REC-' || lpad((COALESCE((SELECT ultimo FROM public.compras_correlativos WHERE company_id = :C::uuid AND project_id = :C1::uuid AND documento = 'recepcion'),       0) + 2)::text, 6, '0') AS prox_rec2,
       'CP-'  || lpad((COALESCE((SELECT ultimo FROM public.compras_correlativos WHERE company_id = :C::uuid AND project_id = :C1::uuid AND documento = 'contrasena_pago'), 0) + 2)::text, 6, '0') AS prox_cp2
\gset

-- ═══ A. ÓRDENES ═══════════════════════════════════════════════════════════════════
-- A1 · El ataque: UC («crear» solamente) reserva el próximo número en un borrador.
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.fa5_intenta(format($q$ INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, numero)
                                    VALUES ('fa508100-0000-0000-0000-000000000001', %L, %L, %L, 'x', 'EV-08 reserva el próximo número', %L) $q$,
                                 :C, :C1, :P1, :'prox_oc')) AS r_squat \gset
RESET ROLE;
SELECT public.chk_txt(left(:'r_squat', 27), 'COMPRAS_NUMERO_SOLO_SISTEMA',
  '[EV-08a] un usuario con «crear» no puede reservar el próximo número de orden en un borrador');

-- A2 · Una orden legítima (sin número) con su renglón.
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('fa508100-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P1::uuid, 'Proveedor EV-08', 'EV-08 legítima 1');
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES (:C::uuid, 'fa508100-0000-0000-0000-000000000002', 1, 'Servicio EV-08', 'servicio', 'servicios', 1, 'servicio', 100);
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('fa508100-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, :P1::uuid, 'Proveedor EV-08', 'EV-08 legítima 2');
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES (:C::uuid, 'fa508100-0000-0000-0000-000000000003', 1, 'Servicio EV-08', 'servicio', 'servicios', 1, 'servicio', 100);

-- A3 · …y se aprueba (UQ) y recibe EL número que le toca: no hay reserva que lo bloquee.
SELECT public.como(:UQ::uuid);
SELECT public.fa5_intenta($q$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'fa508100-0000-0000-0000-000000000002' $q$) AS r_aprueba \gset
RESET ROLE;
SELECT public.chk_txt(:'r_aprueba', 'OK', '[EV-08b] la orden legítima se aprueba (sin «duplicate key» por un número reservado)');
SELECT public.chk_txt((SELECT numero FROM public.ordenes_compra WHERE id = 'fa508100-0000-0000-0000-000000000002'), :'prox_oc',
  '[EV-08c] y recibe el próximo número del correlativo, sin saltos');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'fa508100-0000-0000-0000-000000000002'), 'aprobada', '[EV-08d] (aprobada)');

-- A4 · Elegir el número en el MISMO UPDATE que aprueba tampoco sirve.
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada', numero = 'OC-777777' WHERE id = 'fa508100-0000-0000-0000-000000000003' $$,
  'COMPRAS_NUMERO_SOLO_SISTEMA', '[EV-08e] aprobar fijando el número en el mismo UPDATE se rechaza');
-- A5 · Poner el número a un borrador existente (NULL → valor), con «editar» y siendo administrador.
SELECT public.como(:UC::uuid);
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET numero = 'OC-777777' WHERE id = 'fa508100-0000-0000-0000-000000000003' $$,
  'COMPRAS_NUMERO_SOLO_SISTEMA', '[EV-08f] un borrador no recibe un número elegido por quien lo edita');
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET numero = 'OC-777777' WHERE id = 'fa508100-0000-0000-0000-000000000003' $$,
  'COMPRAS_NUMERO_SOLO_SISTEMA', '[EV-08g] ni el administrador');
-- A6 · Un UPSERT que intenta fijarlo (INSERT … ON CONFLICT DO UPDATE).
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, numero)
                           VALUES ('fa508100-0000-0000-0000-000000000003', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'x', 'x', 'OC-777777')
                           ON CONFLICT (id) DO UPDATE SET numero = EXCLUDED.numero $$,
  'COMPRAS_NUMERO_SOLO_SISTEMA', '[EV-08h] el UPSERT tampoco fija el número');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE numero = 'OC-777777'), 0, '[EV-08i] ninguna orden quedó con un número elegido');

-- A7 · La siguiente aprobación (otra orden) sigue la secuencia.
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'fa508100-0000-0000-0000-000000000003';
RESET ROLE;
SELECT public.chk_txt((SELECT numero FROM public.ordenes_compra WHERE id = 'fa508100-0000-0000-0000-000000000003'), :'prox_oc2',
  '[EV-08j] la segunda aprobación recibe el número siguiente');

-- A8 · Lo que sigue siendo legítimo para el administrador: reenviar el mismo número es inocuo,
--      y un borrador SIN número se borra (0200) o se cancela con motivo.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET numero = numero, notas = 'reenvío del mismo número' WHERE id = 'fa508100-0000-0000-0000-000000000002';
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('fa508100-0000-0000-0000-000000000004', :C::uuid, :C1::uuid, :P1::uuid, 'Proveedor EV-08', 'EV-08 borrador a borrar');
DELETE FROM public.ordenes_compra WHERE id = 'fa508100-0000-0000-0000-000000000004';
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('fa508100-0000-0000-0000-000000000005', :C::uuid, :C1::uuid, :P1::uuid, 'Proveedor EV-08', 'EV-08 borrador a cancelar');
UPDATE public.ordenes_compra SET estado = 'cancelada', motivo_anulacion = 'EV-08' WHERE id = 'fa508100-0000-0000-0000-000000000005';
RESET ROLE;
SELECT public.chk_txt((SELECT notas FROM public.ordenes_compra WHERE id = 'fa508100-0000-0000-0000-000000000002'), 'reenvío del mismo número', '[EV-08k] reenviar el mismo número se acepta');
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id = 'fa508100-0000-0000-0000-000000000004'), 0, '[EV-08l] el borrador sin número se borra');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'fa508100-0000-0000-0000-000000000005'), 'cancelada', '[EV-08m] y se cancela con motivo');

-- A9 · Un proceso SIN sesión (importación de histórico, service_role) sí puede fijar el número.
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, numero)
VALUES ('fa508100-0000-0000-0000-000000000006', :C::uuid, :C1::uuid, :P1::uuid, 'Proveedor EV-08', 'EV-08 histórico importado', 'OC-HIST-EV08');
SELECT public.chk_txt((SELECT numero FROM public.ordenes_compra WHERE id = 'fa508100-0000-0000-0000-000000000006'), 'OC-HIST-EV08',
  '[EV-08n] sin sesión de usuario (importación) se puede fijar el número de una orden');

-- ═══ B. RECEPCIONES ═══════════════════════════════════════════════════════════════
--   Orden de 10 × 100 aprobada y emitida (UA); recepciones capturadas por UC / UA y registradas por US.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa508100-0000-0000-0000-000000000010', 'fa508110-0000-0000-0000-000000000010', :P1::uuid, 'servicio', 10, 100, 0);
RESET ROLE;
-- B1 · El ataque: reservar el próximo número de recepción en un borrador.
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.fa5_intenta(format($q$ INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, recibido_por, numero)
                                    VALUES ('fa508200-0000-0000-0000-000000000001', %L, %L, 'fa508100-0000-0000-0000-000000000010', 'servicio', %L, %L) $q$,
                                 :C, :C1, :UC, :'prox_rec')) AS r_squat_rec \gset
RESET ROLE;
SELECT public.chk_txt(left(:'r_squat_rec', 27), 'COMPRAS_NUMERO_SOLO_SISTEMA',
  '[EV-08o] un usuario con «crear» no puede reservar el próximo número de recepción');
-- B2 · La recepción legítima se registra (US) y recibe el número que le toca.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_recepcion('fa508200-0000-0000-0000-000000000002', 'fa508100-0000-0000-0000-000000000010', 'fa508110-0000-0000-0000-000000000010', 4, 'servicio');
SELECT public.ce_recepcion('fa508200-0000-0000-0000-000000000003', 'fa508100-0000-0000-0000-000000000010', 'fa508110-0000-0000-0000-000000000010', 2, 'servicio');
SELECT public.como(:US::uuid);
SELECT public.fa5_intenta($q$ UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa508200-0000-0000-0000-000000000002' $q$) AS r_reg \gset
RESET ROLE;
SELECT public.chk_txt(:'r_reg', 'OK', '[EV-08p] la recepción legítima se registra (sin «duplicate key» por un número reservado)');
SELECT public.chk_txt((SELECT numero FROM public.recepciones WHERE id = 'fa508200-0000-0000-0000-000000000002'), :'prox_rec',
  '[EV-08q] y recibe el próximo número del correlativo');
-- B3 · Fijar el número en el mismo UPDATE que registra, o en el borrador, se rechaza.
SELECT public.como(:US::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.recepciones SET estado = 'registrada', numero = 'REC-777777' WHERE id = 'fa508200-0000-0000-0000-000000000003' $$,
  'COMPRAS_NUMERO_SOLO_SISTEMA', '[EV-08r] registrar fijando el número en el mismo UPDATE se rechaza');
SELECT public.chk_falla($$ UPDATE public.recepciones SET numero = 'REC-777777' WHERE id = 'fa508200-0000-0000-0000-000000000003' $$,
  'COMPRAS_NUMERO_SOLO_SISTEMA', '[EV-08s] un borrador de recepción no recibe un número elegido');
-- B4 · El número de una recepción ya registrada no se reescribe (hoy lo cambia cualquiera con «editar»).
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ UPDATE public.recepciones SET numero = 'REC-777777' WHERE id = 'fa508200-0000-0000-0000-000000000002' $$,
  'COMPRAS_NUMERO_SOLO_SISTEMA|COMPRAS_RECEPCION_IDENTIDAD', '[EV-08t] ni el administrador reescribe el número de una recepción registrada');
RESET ROLE;
SELECT public.chk_txt((SELECT numero FROM public.recepciones WHERE id = 'fa508200-0000-0000-0000-000000000002'), :'prox_rec', '[EV-08u] el número de la recepción registrada no cambió');
-- B5 · La segunda recepción se registra con el número siguiente.
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa508200-0000-0000-0000-000000000003';
RESET ROLE;
SELECT public.chk_txt((SELECT numero FROM public.recepciones WHERE id = 'fa508200-0000-0000-0000-000000000003'), :'prox_rec2', '[EV-08v] la siguiente recepción recibe el número siguiente');
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = 'fa508110-0000-0000-0000-000000000010'), 6, '[EV-08w] y lo recibido de la orden se movió (4 + 2)');
-- B6 · Sin sesión de usuario (importación) sí se puede fijar el número de una recepción.
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, numero)
VALUES ('fa508200-0000-0000-0000-000000000004', :C::uuid, :C1::uuid, 'fa508100-0000-0000-0000-000000000010', 'servicio', 'REC-HIST-EV08');
SELECT public.chk_txt((SELECT numero FROM public.recepciones WHERE id = 'fa508200-0000-0000-0000-000000000004'), 'REC-HIST-EV08',
  '[EV-08x] sin sesión de usuario (importación) se puede fijar el número de una recepción');

-- ═══ C. CONTRASEÑAS DE PAGO (se numeran al nacer) ═════════════════════════════════
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.fa5_intenta(format($q$ INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada, numero)
                                    VALUES ('fa508500-0000-0000-0000-000000000001', %L, %L, %L, CURRENT_DATE, %L) $q$,
                                 :C, :C1, :P1, :'prox_cp')) AS r_squat_cp \gset
RESET ROLE;
SELECT public.chk_txt(left(:'r_squat_cp', 27), 'COMPRAS_NUMERO_SOLO_SISTEMA',
  '[EV-08y] un usuario con «crear» no puede reservar el próximo número de contraseña');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.fa5_intenta($q$ INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
                              VALUES ('fa508500-0000-0000-0000-000000000002', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', CURRENT_DATE) $q$) AS r_cp \gset
RESET ROLE;
SELECT public.chk_txt(:'r_cp', 'OK', '[EV-08z] la contraseña legítima se emite (sin «duplicate key» por un número reservado)');
SELECT public.chk_txt((SELECT numero FROM public.contrasenas_pago WHERE id = 'fa508500-0000-0000-0000-000000000002'), :'prox_cp',
  '[EV-08A] y recibe el próximo número del correlativo');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.contrasenas_pago SET numero = 'CP-777777' WHERE id = 'fa508500-0000-0000-0000-000000000002' $$,
  'COMPRAS_NUMERO_SOLO_SISTEMA|COMPRAS_CONTRASENA_', '[EV-08B] ni el administrador reescribe el número de una contraseña emitida');
RESET ROLE;
SELECT public.chk_txt((SELECT numero FROM public.contrasenas_pago WHERE id = 'fa508500-0000-0000-0000-000000000002'), :'prox_cp', '[EV-08C] el número de la contraseña no cambió');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada)
VALUES ('fa508500-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE);
RESET ROLE;
SELECT public.chk_txt((SELECT numero FROM public.contrasenas_pago WHERE id = 'fa508500-0000-0000-0000-000000000003'), :'prox_cp2', '[EV-08D] la siguiente contraseña recibe el número siguiente');
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO public.contrasenas_pago (id, company_id, project_id, proveedor_id, fecha_pago_programada, numero)
VALUES ('fa508500-0000-0000-0000-000000000004', :C::uuid, :C1::uuid, :P1::uuid, CURRENT_DATE, 'CP-HIST-EV08');
SELECT public.chk_txt((SELECT numero FROM public.contrasenas_pago WHERE id = 'fa508500-0000-0000-0000-000000000004'), 'CP-HIST-EV08',
  '[EV-08E] sin sesión de usuario (importación) se puede fijar el número de una contraseña');

DROP FUNCTION public.fa5_intenta(text);
