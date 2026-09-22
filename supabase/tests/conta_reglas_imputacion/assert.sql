\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES
--
-- Cada bloque prueba UNA cosa y dice cuál. Los que esperan un rechazo usan
-- `chk_falla`, que exige que falle POR LA RAZÓN ESPERADA: un rechazo por el
-- motivo equivocado es un falso verde.
-- ============================================================================

\set A     '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set B     '''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'''
\set PROY  '''a1a1a1a1-0000-0000-0000-000000000001'''
\set UID_A '''a0a0a0a0-0000-0000-0000-00000000000a'''
\set UID_B '''b0b0b0b0-0000-0000-0000-00000000000b'''

-- ── 0. La sesión es la del admin de la empresa A ────────────────────────────
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000a', false);
SELECT public.chk_uuid(public.get_my_company_id(), :A::uuid,
  '0 · la sesión resuelve a la empresa A');

-- ── 1. Las reglas nacen VACÍAS ──────────────────────────────────────────────
-- Sin esto, cualquier afirmación posterior sobre precedencia podría estar
-- midiendo datos sembrados por la migración.
SELECT public.chk((SELECT count(*) FROM public.conta_reglas_proveedor), 0,
  '1 · conta_reglas_proveedor nace vacía (sin backfill)');
SELECT public.chk((SELECT count(*) FROM public.conta_reglas_cargo), 0,
  '1 · conta_reglas_cargo nace vacía (sin backfill)');
SELECT public.chk((SELECT count(*) FROM public.conta_resoluciones), 0,
  '1 · conta_resoluciones nace vacía');

-- ── 2. Escalón 4: sin ninguna regla, cae al mapeo del evento ────────────────
-- Es el comportamiento de HOY, y tiene que sobrevivir intacto a la migración.
SELECT public.chk_txt(
  (SELECT origen_resolucion FROM public.conta_resolver_imputacion(NULL, 'gasto',
     'd0000000-0000-0000-0000-00000000a001'::uuid)),
  'mapeo_evento',
  '2 · sin reglas, el destino gasto cae al mapeo del evento');

SELECT public.chk_uuid(
  (SELECT cuenta_id FROM public.conta_resolver_imputacion(NULL, 'gasto',
     'd0000000-0000-0000-0000-00000000a001'::uuid)),
  'c0000000-0000-0000-0000-00000000a002'::uuid,
  '2 · y la cuenta es la que el evento gasto_otros tiene mapeada');

-- ── 3. Escalón 5: sin regla NI mapeo, estado explícito ──────────────────────
-- No inventa una cuenta. Devuelve sin_resolver CON motivo, que es lo que hace
-- visible la configuración incompleta.
SELECT public.chk_txt(
  (SELECT origen_resolucion FROM public.conta_resolver_imputacion(NULL, 'activo_fijo',
     'd0000000-0000-0000-0000-00000000a001'::uuid)),
  'sin_resolver',
  '3 · destino sin regla ni mapeo devuelve sin_resolver');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_resolver_imputacion(NULL, 'activo_fijo',
     'd0000000-0000-0000-0000-00000000a001'::uuid) WHERE motivo IS NOT NULL AND cuenta_id IS NULL), 1,
  '3 · y trae motivo y NO trae cuenta');

-- ── 4. Escalón 2: la regla del proveedor gana al mapeo del evento ───────────
INSERT INTO public.conta_reglas_proveedor
  (company_id, project_id, proveedor_id, destino, cuenta_id) VALUES
  (:A::uuid, NULL, 'd0000000-0000-0000-0000-00000000a001'::uuid, 'gasto',
   'c0000000-0000-0000-0000-00000000a003'::uuid);

SELECT public.chk_txt(
  (SELECT origen_resolucion FROM public.conta_resolver_imputacion(NULL, 'gasto',
     'd0000000-0000-0000-0000-00000000a001'::uuid)),
  'regla_proveedor',
  '4 · la regla del proveedor gana al mapeo del evento');

SELECT public.chk_uuid(
  (SELECT cuenta_id FROM public.conta_resolver_imputacion(NULL, 'gasto',
     'd0000000-0000-0000-0000-00000000a001'::uuid)),
  'c0000000-0000-0000-0000-00000000a003'::uuid,
  '4 · y resuelve a la cuenta de la regla');

-- ── 5. Escalón 1: la cuenta explícita gana a TODO ───────────────────────────
SELECT public.chk_txt(
  (SELECT origen_resolucion FROM public.conta_resolver_imputacion(NULL, 'gasto',
     'd0000000-0000-0000-0000-00000000a001'::uuid, NULL, NULL, NULL, NULL,
     'c0000000-0000-0000-0000-00000000a002'::uuid)),
  'linea_explicita',
  '5 · la cuenta elegida en el documento gana a la regla del proveedor');

-- ── 6. Una cuenta explícita que NO sirve no gana: se rechaza con motivo ─────
-- Peor que no elegir nada sería aceptar una cuenta agrupadora porque alguien
-- la escribió a mano.
SELECT public.chk_txt(
  (SELECT origen_resolucion FROM public.conta_resolver_imputacion(NULL, 'gasto',
     NULL, NULL, NULL, NULL, NULL, 'c0000000-0000-0000-0000-00000000a001'::uuid)),
  'sin_resolver',
  '6 · cuenta explícita AGRUPADORA se rechaza, no se usa');

SELECT public.chk_txt(
  (SELECT origen_resolucion FROM public.conta_resolver_imputacion(NULL, 'gasto',
     NULL, NULL, NULL, NULL, NULL, 'c0000000-0000-0000-0000-00000000a004'::uuid)),
  'sin_resolver',
  '6 · cuenta explícita INACTIVA se rechaza');

SELECT public.chk_txt(
  (SELECT origen_resolucion FROM public.conta_resolver_imputacion(NULL, 'gasto',
     NULL, NULL, NULL, NULL, NULL, 'c0000000-0000-0000-0000-00000000b001'::uuid)),
  'sin_resolver',
  '6 · cuenta explícita de OTRA EMPRESA se rechaza');

SELECT public.chk_txt(
  (SELECT origen_resolucion FROM public.conta_resolver_imputacion(NULL, 'gasto',
     NULL, NULL, NULL, NULL, NULL, 'c0000000-0000-0000-0000-00000000a101'::uuid)),
  'sin_resolver',
  '6 · cuenta explícita de OTRO LEDGER (proyecto) se rechaza en el de empresa');

-- ── 7. Escalón 3, y su orden interno por especificidad ──────────────────────
INSERT INTO public.conta_reglas_cargo
  (company_id, project_id, cliente_id, unidad_id, categoria, cuenta_id) VALUES
  (:A::uuid, NULL, NULL, NULL, 'reparacion', 'c0000000-0000-0000-0000-00000000a007'::uuid),
  (:A::uuid, NULL, 'e0000000-0000-0000-0000-00000000a001'::uuid, NULL, NULL, 'c0000000-0000-0000-0000-00000000a006'::uuid);

SELECT public.chk(
  (SELECT especificidad FROM public.conta_reglas_cargo WHERE categoria = 'reparacion' AND cliente_id IS NULL), 0,
  '7 · sólo categoría ⇒ especificidad 0');
SELECT public.chk(
  (SELECT especificidad FROM public.conta_reglas_cargo WHERE cliente_id IS NOT NULL), 1,
  '7 · sólo cliente ⇒ especificidad 1');

-- Con cliente Y categoría aplicables, gana la de MAYOR especificidad: cliente.
SELECT public.chk_uuid(
  (SELECT cuenta_id FROM public.conta_resolver_imputacion(NULL, NULL, NULL,
     'e0000000-0000-0000-0000-00000000a001'::uuid, NULL, 'reparacion')),
  'c0000000-0000-0000-0000-00000000a006'::uuid,
  '7 · cliente (esp. 1) gana a sólo-categoría (esp. 0)');

-- Y una regla cliente+categoría (esp. 2) gana a las dos.
INSERT INTO public.conta_reglas_cargo
  (company_id, project_id, cliente_id, categoria, cuenta_id) VALUES
  (:A::uuid, NULL, 'e0000000-0000-0000-0000-00000000a001'::uuid, 'reparacion',
   'c0000000-0000-0000-0000-00000000a005'::uuid);

SELECT public.chk_uuid(
  (SELECT cuenta_id FROM public.conta_resolver_imputacion(NULL, NULL, NULL,
     'e0000000-0000-0000-0000-00000000a001'::uuid, NULL, 'reparacion')),
  'c0000000-0000-0000-0000-00000000a005'::uuid,
  '7 · cliente+categoría (esp. 2) gana a cliente solo');

-- ── 8. La regla del proveedor gana a la de cargo ────────────────────────────
-- Es el orden que documenta la migración: proveedor antes que cliente/unidad.
SELECT public.chk_txt(
  (SELECT origen_resolucion FROM public.conta_resolver_imputacion(NULL, 'gasto',
     'd0000000-0000-0000-0000-00000000a001'::uuid,
     'e0000000-0000-0000-0000-00000000a001'::uuid, NULL, 'reparacion')),
  'regla_proveedor',
  '8 · con ambas aplicables, la del proveedor va primero');

-- ── 9. Rechazos al CREAR una regla ──────────────────────────────────────────
SELECT public.chk_falla($$
  INSERT INTO public.conta_reglas_proveedor (company_id, project_id, proveedor_id, destino, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
          'd0000000-0000-0000-0000-00000000a001', 'costo',
          'c0000000-0000-0000-0000-00000000a001') $$,
  'REGLA_CUENTA_AGRUPADORA', '9 · regla con cuenta AGRUPADORA rechazada');

SELECT public.chk_falla($$
  INSERT INTO public.conta_reglas_proveedor (company_id, project_id, proveedor_id, destino, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
          'd0000000-0000-0000-0000-00000000a001', 'costo',
          'c0000000-0000-0000-0000-00000000a004') $$,
  'REGLA_CUENTA_INACTIVA', '9 · regla con cuenta INACTIVA rechazada');

SELECT public.chk_falla($$
  INSERT INTO public.conta_reglas_proveedor (company_id, project_id, proveedor_id, destino, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
          'd0000000-0000-0000-0000-00000000a001', 'costo',
          'c0000000-0000-0000-0000-00000000a101') $$,
  'REGLA_LEDGER', '9 · regla de empresa con cuenta del ledger de PROYECTO rechazada');

SELECT public.chk_falla($$
  INSERT INTO public.conta_reglas_proveedor (company_id, project_id, proveedor_id, destino, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
          'd0000000-0000-0000-0000-00000000a001', 'costo',
          'c0000000-0000-0000-0000-00000000b001') $$,
  'REGLA_LEDGER', '9 · regla con cuenta de OTRA EMPRESA rechazada');

SELECT public.chk_falla($$
  INSERT INTO public.conta_reglas_proveedor (company_id, project_id, proveedor_id, destino, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
          'd0000000-0000-0000-0000-00000000b001', 'gasto',
          'c0000000-0000-0000-0000-00000000a002') $$,
  'REGLA_PROVEEDOR_AJENO', '9 · regla con proveedor de OTRA EMPRESA rechazada');

SELECT public.chk_falla($$
  INSERT INTO public.conta_reglas_proveedor (company_id, project_id, proveedor_id, destino, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
          'd0000000-0000-0000-0000-00000000a001', 'invento',
          'c0000000-0000-0000-0000-00000000a002') $$,
  'conta_reglas_proveedor_destino_valido', '9 · destino fuera del catálogo rechazado');

-- Una regla de cargo sin ninguna dimensión sería un «todo va acá» encubierto.
SELECT public.chk_falla($$
  INSERT INTO public.conta_reglas_cargo (company_id, project_id, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
          'c0000000-0000-0000-0000-00000000a002') $$,
  'conta_reglas_cargo_alguna_dimension', '9 · regla de cargo sin ninguna dimensión rechazada');

-- Cliente Y unidad a la vez abriría un empate que la especificidad no rompe.
SELECT public.chk_falla($$
  INSERT INTO public.conta_reglas_cargo (company_id, project_id, cliente_id, unidad_id, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
          'e0000000-0000-0000-0000-00000000a001',
          'f0000000-0000-0000-0000-00000000a001',
          'c0000000-0000-0000-0000-00000000a002') $$,
  'conta_reglas_cargo_no_cliente_y_unidad', '9 · regla con cliente Y unidad rechazada');

-- ── 10. Unicidad: no puede haber dos candidatas empatadas ───────────────────
SELECT public.chk_falla($$
  INSERT INTO public.conta_reglas_proveedor (company_id, project_id, proveedor_id, destino, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
          'd0000000-0000-0000-0000-00000000a001', 'gasto',
          'c0000000-0000-0000-0000-00000000a002') $$,
  'uq_conta_reglas_proveedor_ledger', '10 · dos reglas para el mismo proveedor y destino: rechazado');

SELECT public.chk_falla($$
  INSERT INTO public.conta_reglas_cargo (company_id, project_id, cliente_id, categoria, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
          'e0000000-0000-0000-0000-00000000a001', 'reparacion',
          'c0000000-0000-0000-0000-00000000a002') $$,
  'uq_conta_reglas_cargo_ledger', '10 · dos reglas de cargo con las mismas dimensiones: rechazado');

-- ── 11. Separación entre ledger de empresa y ledger de proyecto ─────────────
-- La regla de arriba es del ledger de EMPRESA. Resolver EN EL PROYECTO no la
-- ve: si la viera, el asiento del proyecto se imputaría a una cuenta que no es
-- suya.
SELECT public.chk_txt(
  (SELECT origen_resolucion FROM public.conta_resolver_imputacion(:PROY::uuid, 'gasto',
     'd0000000-0000-0000-0000-00000000a001'::uuid)),
  'sin_resolver',
  '11 · la regla del ledger de EMPRESA no aplica en el ledger del PROYECTO');

-- Y con su propia regla, el proyecto resuelve a SU cuenta.
INSERT INTO public.conta_reglas_proveedor
  (company_id, project_id, proveedor_id, destino, cuenta_id) VALUES
  (:A::uuid, :PROY::uuid, 'd0000000-0000-0000-0000-00000000a001'::uuid, 'gasto',
   'c0000000-0000-0000-0000-00000000a101'::uuid);

SELECT public.chk_uuid(
  (SELECT cuenta_id FROM public.conta_resolver_imputacion(:PROY::uuid, 'gasto',
     'd0000000-0000-0000-0000-00000000a001'::uuid)),
  'c0000000-0000-0000-0000-00000000a101'::uuid,
  '11 · el ledger del proyecto resuelve a SU propia cuenta');

-- Y la de empresa sigue resolviendo a la suya: no se pisaron.
SELECT public.chk_uuid(
  (SELECT cuenta_id FROM public.conta_resolver_imputacion(NULL, 'gasto',
     'd0000000-0000-0000-0000-00000000a001'::uuid)),
  'c0000000-0000-0000-0000-00000000a003'::uuid,
  '11 · y el ledger de empresa sigue resolviendo a la suya');

-- ── 12. Aislamiento entre empresas ──────────────────────────────────────────
-- La empresa B no ve las reglas de A ni puede resolver con ellas. Se cambia la
-- sesión al admin de B: es la prueba que importa, porque el resolutor toma la
-- empresa de la SESIÓN y no de un parámetro.
SELECT set_config('request.jwt.claim.sub', 'b0b0b0b0-0000-0000-0000-00000000000b', false);
SELECT public.chk_uuid(public.get_my_company_id(), :B::uuid, '12 · la sesión ahora es la empresa B');

SELECT public.chk_txt(
  (SELECT origen_resolucion FROM public.conta_resolver_imputacion(NULL, 'gasto',
     'd0000000-0000-0000-0000-00000000a001'::uuid)),
  'sin_resolver',
  '12 · B no resuelve con la regla de A aunque nombre su proveedor');

-- Y un proyecto de A es rechazado de plano.
SELECT public.chk_falla($$
  SELECT * FROM public.conta_resolver_imputacion(
    'a1a1a1a1-0000-0000-0000-000000000001'::uuid, 'gasto') $$,
  'no pertenece a la empresa activa', '12 · B no puede resolver contra un proyecto de A');

-- La RLS: B no LEE ninguna regla de A.
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.conta_reglas_proveedor), 0,
  '12 · con RLS activa, B no lee NINGUNA regla de proveedor de A');
SELECT public.chk((SELECT count(*) FROM public.conta_reglas_cargo), 0,
  '12 · con RLS activa, B no lee NINGUNA regla de cargo de A');
RESET ROLE;

-- ── 13. Trazabilidad ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000a', false);

SELECT public.chk(
  (SELECT count(*) FROM public.conta_registrar_resolucion(
     'facturas_proveedor', 'aaaa0000-0000-0000-0000-000000000001'::uuid, NULL,
     'gasto', 'd0000000-0000-0000-0000-00000000a001'::uuid)), 1,
  '13 · registrar una resolución devuelve una fila');

SELECT public.chk_txt(
  (SELECT origen_resolucion FROM public.conta_resoluciones
    WHERE origen_id = 'aaaa0000-0000-0000-0000-000000000001'::uuid),
  'regla_proveedor', '13 · la bitácora guarda el escalón que resolvió');

SELECT public.chk_txt(
  (SELECT regla_tabla FROM public.conta_resoluciones
    WHERE origen_id = 'aaaa0000-0000-0000-0000-000000000001'::uuid),
  'conta_reglas_proveedor', '13 · y la tabla de la regla usada');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_resoluciones
    WHERE origen_id = 'aaaa0000-0000-0000-0000-000000000001'::uuid
      AND regla_id IS NOT NULL AND resuelto_por IS NOT NULL AND cuenta_id IS NOT NULL), 1,
  '13 · con regla, cuenta y usuario');

-- El FALLO también se registra, y con motivo. Es la mitad que hace visible la
-- configuración incompleta.
SELECT public.conta_registrar_resolucion(
  'facturas_proveedor', 'aaaa0000-0000-0000-0000-000000000002'::uuid, NULL,
  'activo_fijo', 'd0000000-0000-0000-0000-00000000a001'::uuid);

SELECT public.chk(
  (SELECT count(*) FROM public.conta_resoluciones
    WHERE origen_id = 'aaaa0000-0000-0000-0000-000000000002'::uuid
      AND origen_resolucion = 'sin_resolver'
      AND cuenta_id IS NULL AND motivo IS NOT NULL), 1,
  '13 · el NO resuelto también se registra, sin cuenta y con motivo');

-- El CHECK de coherencia: no se puede afirmar que se resolvió sin decir con qué.
SELECT public.chk_falla($$
  INSERT INTO public.conta_resoluciones
    (company_id, origen_tabla, origen_id, origen_resolucion, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', gen_random_uuid(), 'regla_proveedor', NULL) $$,
  'conta_resoluciones_coherente', '13 · una resolución sin cuenta no puede decir que resolvió');

-- ── 14. La bitácora no se edita desde la aplicación ─────────────────────────
-- Un registro reescribible no prueba nada, así que se cierra por DOS capas y
-- la que muerde primero es la de GRANTS: `authenticated` no tiene UPDATE ni
-- DELETE sobre la tabla, así que ni siquiera llega a la RLS. La segunda capa
-- —la ausencia de policy de escritura— queda debajo por si alguien concediera
-- el grant algún día.
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.conta_resoluciones WHERE company_id = :A::uuid), 2,
  '14 · A lee sus dos filas de bitácora');

SELECT public.chk_falla($$ UPDATE public.conta_resoluciones SET motivo = 'reescrito' $$,
  'permission denied', '14 · authenticated NO puede hacer UPDATE sobre la bitácora');

SELECT public.chk_falla($$ DELETE FROM public.conta_resoluciones $$,
  'permission denied', '14 · authenticated NO puede hacer DELETE sobre la bitácora');

SELECT public.chk_falla($$
  INSERT INTO public.conta_resoluciones (company_id, origen_tabla, origen_id, origen_resolucion, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', gen_random_uuid(), 'mapeo_evento',
          'c0000000-0000-0000-0000-00000000a002') $$,
  'permission denied', '14 · ni INSERT directo: la bitácora sólo se escribe por la RPC');
RESET ROLE;

SELECT public.chk((SELECT count(*) FROM public.conta_resoluciones), 2,
  '14 · las dos filas siguen intactas');

-- La segunda capa, medida aparte: no hay NINGUNA policy de escritura.
SELECT public.chk(
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'conta_resoluciones'
      AND cmd <> 'SELECT'), 0,
  '14 · y no existe ninguna policy de escritura sobre la bitácora');

-- ── 15. Idempotencia y rollback ─────────────────────────────────────────────
-- Resolver dos veces con el mismo estado da lo mismo: el resolutor es STABLE y
-- no depende de nada que cambie entre llamadas.
SELECT public.chk_uuid(
  (SELECT cuenta_id FROM public.conta_resolver_imputacion(NULL, 'gasto',
     'd0000000-0000-0000-0000-00000000a001'::uuid)),
  (SELECT cuenta_id FROM public.conta_resolver_imputacion(NULL, 'gasto',
     'd0000000-0000-0000-0000-00000000a001'::uuid)),
  '15 · dos resoluciones seguidas dan la misma cuenta');

-- Y el registro participa de la transacción del llamador: si el documento se
-- cae, la bitácora se cae con él. Nada de asientos ni rastros parciales.
BEGIN;
  SELECT public.conta_registrar_resolucion(
    'facturas_proveedor', 'aaaa0000-0000-0000-0000-000000000003'::uuid, NULL,
    'gasto', 'd0000000-0000-0000-0000-00000000a001'::uuid);
ROLLBACK;

SELECT public.chk(
  (SELECT count(*) FROM public.conta_resoluciones
    WHERE origen_id = 'aaaa0000-0000-0000-0000-000000000003'::uuid), 0,
  '15 · el rollback del llamador se lleva la fila de bitácora');

-- ── 16. ACL: anon no toca nada ──────────────────────────────────────────────
SELECT public.chk(
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE grantee = 'anon'
      AND table_name IN ('conta_reglas_proveedor','conta_reglas_cargo','conta_resoluciones')), 0,
  '16 · anon no tiene NINGÚN privilegio sobre las tres tablas');

SELECT public.chk(
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE grantee = 'authenticated' AND table_name = 'conta_resoluciones'
      AND privilege_type <> 'SELECT'), 0,
  '16 · authenticated sólo puede SELECT sobre la bitácora');

-- Las RPC SECURITY DEFINER no son ejecutables por anon ni por PUBLIC.
SELECT public.chk(
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('conta_resolver_imputacion','conta_registrar_resolucion',
                        'conta_destinos_imputacion','conta_tg_regla_cuenta_valida',
                        'conta_tg_regla_cargo_tenant','conta_tg_regla_proveedor_tenant')
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
           OR has_function_privilege('public', p.oid, 'EXECUTE'))), 0,
  '16 · ninguna función nueva es ejecutable por anon ni por PUBLIC');

-- Los triggers no los ejecuta nadie a mano, tampoco authenticated.
SELECT public.chk(
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('conta_tg_regla_cuenta_valida','conta_tg_regla_cargo_tenant',
                        'conta_tg_regla_proveedor_tenant')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')), 0,
  '16 · las funciones de trigger no son invocables por authenticated');

-- ── 17. El catálogo de destinos es declarado, no cableado ───────────────────
SELECT public.chk((SELECT count(*) FROM public.conta_destinos_imputacion()), 5,
  '17 · hay cinco destinos declarados');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_destinos_imputacion() WHERE evento_fallback IS NULL), 0,
  '17 · todos nombran su evento de respaldo (sin códigos contables fijos)');



-- ════════════════════════════════════════════════════════════════════════════
-- HALLAZGOS DE REVISIÓN
--
-- Todo lo de abajo FALLA contra 20260926000000 sola. Son las pruebas que
-- reproducen los cuatro problemas antes de arreglarlos:
--   18 · una regla cuya cuenta se desactivó DESPUÉS sigue resolviendo;
--   19 · la bitácora acepta cualquier tabla, cualquier UUID y documentos
--        ajenos, y `authenticated` puede escribirla a mano;
--   20 · el resolutor existe pero NO está cableado: aprobar una factura sigue
--        imputando por el mapeo del evento aunque haya una regla.
-- ════════════════════════════════════════════════════════════════════════════

SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000a', false);

-- ── 18. La cuenta de una regla se revalida AL RESOLVER ──────────────────────
-- El trigger valida al ESCRIBIR la regla. Eso no alcanza: la cuenta puede
-- desactivarse después, y entonces la regla queda apuntando a algo que ya no
-- recibe movimientos. Devolverla igual sería imputar a una cuenta inactiva.
INSERT INTO public.conta_reglas_proveedor
  (company_id, project_id, proveedor_id, destino, cuenta_id) VALUES
  (:A::uuid, NULL, 'd0000000-0000-0000-0000-00000000a001'::uuid, 'inventario',
   'c0000000-0000-0000-0000-00000000a007'::uuid);

UPDATE public.conta_cuentas SET activa = false
 WHERE id = 'c0000000-0000-0000-0000-00000000a007'::uuid;

SELECT public.chk_txt(
  (SELECT origen_resolucion FROM public.conta_resolver_imputacion(NULL, 'inventario',
     'd0000000-0000-0000-0000-00000000a001'::uuid)),
  'sin_resolver',
  '18 · regla cuya cuenta se DESACTIVÓ después no resuelve');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_resolver_imputacion(NULL, 'inventario',
     'd0000000-0000-0000-0000-00000000a001'::uuid)
    WHERE motivo LIKE '%inactiva%' OR motivo LIKE '%ya no%'), 1,
  '18 · y el motivo dice que la cuenta de la regla dejó de servir');

-- Y NO cae en silencio al mapeo del evento: sería imputar a otra cuenta sin
-- que nadie se entere de que la regla configurada está rota.
SELECT public.chk(
  (SELECT count(*) FROM public.conta_resolver_imputacion(NULL, 'inventario',
     'd0000000-0000-0000-0000-00000000a001'::uuid) WHERE cuenta_id IS NOT NULL), 0,
  '18 · y NO cae en silencio a la cuenta del evento');

UPDATE public.conta_cuentas SET activa = true
 WHERE id = 'c0000000-0000-0000-0000-00000000a007'::uuid;
DELETE FROM public.conta_reglas_proveedor WHERE destino = 'inventario';

-- ── 19. La bitácora no acepta cualquier cosa ────────────────────────────────
SELECT public.chk_falla($$
  SELECT * FROM public.conta_registrar_resolucion(
    'tabla_que_no_existe', gen_random_uuid(), NULL, 'gasto') $$,
  'ORIGEN_NO_PERMITIDO', '19 · tabla de origen arbitraria rechazada');

SELECT public.chk_falla($$
  SELECT * FROM public.conta_registrar_resolucion(
    'facturas_proveedor', '00000000-0000-0000-0000-0000deadbeef', NULL, 'gasto') $$,
  'ORIGEN_INEXISTENTE', '19 · documento inexistente rechazado');

-- Documento de la empresa B, sesión de la empresa A.
INSERT INTO public.facturas_proveedor
  (id, company_id, project_id, proveedor_id, concepto, categoria, monto_total, moneda, estado)
VALUES ('bbbb0000-0000-0000-0000-0000000000b1', :B::uuid, NULL,
        'd0000000-0000-0000-0000-00000000b001', 'Factura de B', 'otros', 100, 'USD', 'registrada');

SELECT public.chk_falla($$
  SELECT * FROM public.conta_registrar_resolucion(
    'facturas_proveedor', 'bbbb0000-0000-0000-0000-0000000000b1', NULL, 'gasto') $$,
  'ORIGEN_AJENO', '19 · documento de OTRA EMPRESA rechazado');

SELECT public.chk(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'conta_registrar_resolucion'
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')), 0,
  '19 · authenticated NO puede invocar conta_registrar_resolucion a mano');

-- ── 20. El recorrido real: documento → resolución → asiento → bitácora ──────
-- Cinco facturas, cinco escalones distintos del motor, y en cada una se mira
-- LA CUENTA QUE QUEDÓ EN EL ASIENTO. Es la única medición que prueba que el
-- resolutor está cableado: una resolución correcta que el asiento ignora no
-- sirve de nada, y es exactamente el hallazgo que motiva esta migración.

-- Las secciones anteriores dejaron reglas puestas. El escalón que se mide acá
-- depende de cuáles existan, así que se parte de un estado declarado.
DELETE FROM public.conta_reglas_proveedor;
DELETE FROM public.conta_reglas_cargo;

-- Ayuda: la cuenta DEUDORA del asiento de una factura. Es la de gasto —la
-- contrapartida (CxP) es acreedora— y por eso alcanza con filtrar por `debe`.
CREATE OR REPLACE FUNCTION public.cuenta_gasto_de(p_factura uuid)
RETURNS uuid LANGUAGE sql STABLE AS $fn$
  SELECT l.cuenta_id FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
   WHERE a.origen_id = p_factura AND l.debe > 0;
$fn$;

CREATE OR REPLACE FUNCTION public.aprobar(p_factura uuid, p_concepto text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO public.facturas_proveedor
    (id, company_id, project_id, proveedor_id, concepto, categoria, monto_total, moneda, estado)
  VALUES (p_factura, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
          'd0000000-0000-0000-0000-00000000a001', p_concepto, 'otros', 500, 'USD', 'registrada');
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = p_factura;
END;
$fn$;

-- (a) SIN NINGUNA REGLA. Es el comportamiento de HOY, y el cableado tiene que
--     dejarlo intacto: la cuenta sale del mapeo del evento `gasto_otros`.
SELECT public.aprobar('aaaa1111-0000-0000-0000-000000000001', 'Servicio sin regla');

SELECT public.chk_uuid(
  public.cuenta_gasto_de('aaaa1111-0000-0000-0000-000000000001'),
  'c0000000-0000-0000-0000-00000000a002'::uuid,
  '20a · SIN regla, la factura se imputa por el mapeo del evento (como hoy)');

SELECT public.chk_txt(
  (SELECT origen_resolucion FROM public.conta_resoluciones
    WHERE origen_id = 'aaaa1111-0000-0000-0000-000000000001'::uuid),
  'mapeo_evento', '20a · y la bitácora lo dice: resolvió el mapeo del evento');

-- (b) CON REGLA DE PROVEEDOR. Es el hallazgo principal: antes de esta
--     migración la regla existía, resolvía bien al consultarla, y el asiento
--     la ignoraba igual.
INSERT INTO public.conta_reglas_proveedor
  (company_id, project_id, proveedor_id, destino, cuenta_id) VALUES
  (:A::uuid, NULL, 'd0000000-0000-0000-0000-00000000a001'::uuid, 'gasto',
   'c0000000-0000-0000-0000-00000000a003'::uuid);

SELECT public.aprobar('aaaa1111-0000-0000-0000-000000000002', 'Servicio con regla');

SELECT public.chk_uuid(
  public.cuenta_gasto_de('aaaa1111-0000-0000-0000-000000000002'),
  'c0000000-0000-0000-0000-00000000a003'::uuid,
  '20b · CON regla de proveedor, el ASIENTO usa la cuenta de la regla');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_resoluciones
    WHERE origen_tabla = 'facturas_proveedor'
      AND origen_id = 'aaaa1111-0000-0000-0000-000000000002'::uuid
      AND origen_resolucion = 'regla_proveedor'
      AND regla_tabla = 'conta_reglas_proveedor'
      AND regla_id IS NOT NULL
      AND cuenta_id = 'c0000000-0000-0000-0000-00000000a003'::uuid), 1,
  '20b · y la resolución queda en la bitácora, en la misma transacción');

-- (c) CUENTA EXPLÍCITA EN LA LÍNEA. Escalón 1: gana a la regla del proveedor,
--     que sigue existiendo. Es la selección manual que la PR promete conservar.
INSERT INTO public.facturas_proveedor
  (id, company_id, project_id, proveedor_id, concepto, categoria, monto_total, moneda, estado)
VALUES ('aaaa1111-0000-0000-0000-000000000003', :A::uuid, NULL,
        'd0000000-0000-0000-0000-00000000a001', 'Servicio con cuenta elegida a mano',
        'otros', 500, 'USD', 'registrada');

INSERT INTO public.factura_proveedor_lineas
  (company_id, factura_id, linea, descripcion, cuenta_id, cantidad, precio_unitario, total)
VALUES (:A::uuid, 'aaaa1111-0000-0000-0000-000000000003', 1, 'Línea con cuenta elegida',
        'c0000000-0000-0000-0000-00000000a005', 1, 500, 500);

UPDATE public.facturas_proveedor SET estado = 'aprobada'
 WHERE id = 'aaaa1111-0000-0000-0000-000000000003';

SELECT public.chk_uuid(
  public.cuenta_gasto_de('aaaa1111-0000-0000-0000-000000000003'),
  'c0000000-0000-0000-0000-00000000a005'::uuid,
  '20c · la cuenta elegida en la línea gana a la regla del proveedor');

SELECT public.chk_txt(
  (SELECT origen_resolucion FROM public.conta_resoluciones
    WHERE origen_id = 'aaaa1111-0000-0000-0000-000000000003'::uuid),
  'linea_explicita', '20c · y la bitácora atribuye la decisión al documento');

-- (d) REGLA INVÁLIDA (su cuenta se desactivó después). No se asienta con otra
--     cuenta: no se asienta. Caer al mapeo del evento sería imputar a una
--     cuenta que nadie configuró, en silencio.
UPDATE public.conta_cuentas SET activa = false
 WHERE id = 'c0000000-0000-0000-0000-00000000a003'::uuid;

SELECT public.aprobar('aaaa1111-0000-0000-0000-000000000004', 'Servicio con regla rota');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos
    WHERE origen_id = 'aaaa1111-0000-0000-0000-000000000004'::uuid), 0,
  '20d · con la regla rota NO se genera asiento (nada parcial, nada inventado)');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_resoluciones
    WHERE origen_id = 'aaaa1111-0000-0000-0000-000000000004'::uuid
      AND origen_resolucion = 'sin_resolver'
      AND cuenta_id IS NULL
      AND regla_tabla = 'conta_reglas_proveedor'
      AND motivo IS NOT NULL), 1,
  '20d · y la bitácora señala LA REGLA culpable, con motivo y sin cuenta');

SELECT public.chk_txt(
  (SELECT estado FROM public.facturas_proveedor
    WHERE id = 'aaaa1111-0000-0000-0000-000000000004'::uuid),
  'aprobada',
  '20d · la factura se aprueba igual: la contabilidad no bloquea la operación');

UPDATE public.conta_cuentas SET activa = true
 WHERE id = 'c0000000-0000-0000-0000-00000000a003'::uuid;

-- (e) SIN RESOLUCIÓN POSIBLE: ni regla ni mapeo. Mismo desenlace, otro motivo,
--     y la factura queda pendiente de configuración en vez de imputada a algo.
DELETE FROM public.conta_reglas_proveedor;
DELETE FROM public.conta_mapeo_cuentas WHERE evento = 'gasto_otros' AND company_id = :A::uuid;

SELECT public.aprobar('aaaa1111-0000-0000-0000-000000000005', 'Servicio sin nada configurado');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos
    WHERE origen_id = 'aaaa1111-0000-0000-0000-000000000005'::uuid), 0,
  '20e · sin regla NI mapeo no se asienta');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_resoluciones
    WHERE origen_id = 'aaaa1111-0000-0000-0000-000000000005'::uuid
      AND origen_resolucion = 'sin_resolver'
      AND regla_id IS NULL AND cuenta_id IS NULL AND motivo IS NOT NULL), 1,
  '20e · y queda registrado como pendiente de configuración, con motivo');

-- ════════════════════════════════════════════════════════════════════════════
-- SEGUNDA RONDA DE REVISIÓN
--
-- Tres hallazgos sobre el cableado de 20260927000000. Los tres fallan contra
-- esa migración y se arreglan en 20260928000000:
--   21 · al reescribir el trigger se perdió la rama TG_OP = 'DELETE'. El
--        trigger sigue declarado AFTER UPDATE OF estado OR DELETE, así que
--        borrar una factura toca NEW —que en un DELETE no está asignado— y
--        revienta, además de no reversar el asiento.
--   22 · el gasto se resuelve ANTES de saber qué ruta toma el asiento, y se
--        abandona si no resuelve. Una factura GR/IR íntegramente recibida no
--        necesita cuenta de gasto: hoy se queda sin asiento por una cuenta
--        que no iba a aparecer en él.
--   23 · todas las cuentas explícitas de la factura se reducen a una sola.
--        Dos cuentas distintas se descartan; una sola se estira sobre líneas
--        que no la eligieron.
-- ════════════════════════════════════════════════════════════════════════════

-- 20e dejó a la empresa A sin mapeo de `gasto_otros`. Se repone: lo de abajo
-- mide otra cosa y necesita una base configurada.
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
VALUES (:A::uuid, NULL, 'gasto_otros', 'c0000000-0000-0000-0000-00000000a002');

-- Una factura con importe e IVA a medida, y sus líneas si se piden.
CREATE OR REPLACE FUNCTION public.factura(
  p_id uuid, p_concepto text, p_total numeric, p_iva numeric DEFAULT 0,
  p_oc uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO public.facturas_proveedor
    (id, company_id, project_id, proveedor_id, concepto, categoria,
     monto_total, iva_monto, moneda, estado, orden_compra_id)
  VALUES (p_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
          'd0000000-0000-0000-0000-00000000a001', p_concepto, 'otros',
          p_total, p_iva, 'USD', 'registrada', p_oc);
END;
$fn$;

-- OJO: con líneas cargadas, `monto_total` e `iva_monto` de la CABECERA los
-- recalcula 20260821000300 a partir de los renglones. El IVA de una factura
-- con líneas se pone acá, no en la cabecera.
CREATE OR REPLACE FUNCTION public.linea(
  p_factura uuid, p_linea int, p_cant numeric, p_precio numeric,
  p_cuenta uuid DEFAULT NULL, p_ocl uuid DEFAULT NULL, p_iva numeric DEFAULT 0)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO public.factura_proveedor_lineas
    (company_id, factura_id, linea, descripcion, cuenta_id, cantidad,
     precio_unitario, iva_monto, total, orden_compra_linea_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', p_factura, p_linea,
          'Línea ' || p_linea, p_cuenta, p_cant, p_precio, p_iva,
          round(p_cant * p_precio, 2) + p_iva, p_ocl);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.aprobar_id(p_id uuid)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = p_id;
END;
$fn$;

-- El importe cargado a una cuenta concreta en el asiento de una factura.
CREATE OR REPLACE FUNCTION public.debe_en(p_factura uuid, p_cuenta uuid)
RETURNS numeric LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(SUM(l.debe), 0) FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
   WHERE a.origen_id = p_factura AND a.origen_evento = 'factura_prov_aprobada'
     AND l.cuenta_id = p_cuenta;
$fn$;

CREATE OR REPLACE FUNCTION public.chk_num(actual numeric, esperado numeric, msg text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '% — esperado %, recibido %', msg, esperado, actual;
  END IF;
  RAISE NOTICE '✓ %', msg;
END;
$fn$;

-- ── 21. Borrar una factura contabilizada reversa su asiento ─────────────────
DELETE FROM public.conta_reglas_proveedor;

SELECT public.factura('aaaa2222-0000-0000-0000-000000000001', 'Factura que se borra', 400);
SELECT public.aprobar_id('aaaa2222-0000-0000-0000-000000000001');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos
    WHERE origen_id = 'aaaa2222-0000-0000-0000-000000000001'::uuid
      AND origen_evento = 'factura_prov_aprobada'), 1,
  '21 · la factura aprobada generó su asiento');

-- Esto es lo que rompe: el trigger está declarado AFTER UPDATE OF estado OR
-- DELETE, así que el DELETE lo dispara y la función toca NEW.
DELETE FROM public.facturas_proveedor WHERE id = 'aaaa2222-0000-0000-0000-000000000001';

SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos
    WHERE origen_id = 'aaaa2222-0000-0000-0000-000000000001'::uuid
      AND origen_evento = 'factura_prov_aprobada_revertido'), 1,
  '21 · el borrado generó el asiento de reverso');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos
    WHERE origen_id = 'aaaa2222-0000-0000-0000-000000000001'::uuid
      AND origen_evento = 'factura_prov_aprobada'
      AND anulado_por_id IS NOT NULL), 1,
  '21 · y el asiento original quedó anulado por el reverso');

-- ── 22. El gasto se resuelve sólo si el asiento lo necesita ─────────────────
-- Una factura GR/IR íntegramente recibida, sin variación de precio y sin
-- resto, NO lleva ninguna línea de gasto: liquida el puente contra CxP, con
-- el IVA aparte. Exigirle una cuenta de gasto configurada es exigir algo que
-- no va a aparecer en el asiento.
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id) VALUES
  (:A::uuid, NULL, 'compras_por_facturar', 'c0000000-0000-0000-0000-00000000a009'),
  (:A::uuid, NULL, 'iva_credito',          'c0000000-0000-0000-0000-00000000a010');

-- Sin mapeo de gasto y sin regla: la única cuenta que falta es justo la que
-- no hace falta.
DELETE FROM public.conta_mapeo_cuentas
 WHERE company_id = :A::uuid AND evento = 'gasto_otros';

-- Sólo un proveedor autorizado recibe órdenes (20260821000100).
UPDATE public.proveedores SET estado = 'autorizado'
 WHERE id = 'd0000000-0000-0000-0000-00000000a001';

INSERT INTO public.ordenes_compra
  (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
VALUES ('0c000000-0000-0000-0000-000000000001', :A::uuid, NULL,
        'd0000000-0000-0000-0000-00000000a001', 'Proveedor A', 'Compra recibida', 'borrador');

INSERT INTO public.orden_compra_lineas
  (id, company_id, orden_compra_id, linea, descripcion, categoria,
   cantidad, precio_unitario, cantidad_recibida)
VALUES ('0c100000-0000-0000-0000-000000000001', :A::uuid,
        '0c000000-0000-0000-0000-000000000001', 1, 'Material', 'otros', 10, 50, 10);

-- Las líneas sólo se cargan con la orden en borrador (20260821000100); ya
-- cargada, la orden pasa a recibida como en el riel real.
UPDATE public.ordenes_compra SET estado = 'recibida'
 WHERE id = '0c000000-0000-0000-0000-000000000001';

-- Neto 500 = 10 × 50, exactamente lo recibido al precio de la orden: sin
-- variación y sin resto. IVA 80 aparte.
SELECT public.factura('aaaa2222-0000-0000-0000-000000000002', 'GR/IR íntegra', 580, 0,
                      '0c000000-0000-0000-0000-000000000001');
SELECT public.linea('aaaa2222-0000-0000-0000-000000000002', 1, 10, 50, NULL,
                    '0c100000-0000-0000-0000-000000000001', 80);
SELECT public.aprobar_id('aaaa2222-0000-0000-0000-000000000002');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos
    WHERE origen_id = 'aaaa2222-0000-0000-0000-000000000002'::uuid
      AND origen_evento = 'factura_prov_aprobada'), 1,
  '22 · la factura GR/IR íntegra SÍ genera asiento aunque no haya cuenta de gasto');

SELECT public.chk_num(
  public.debe_en('aaaa2222-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000a009'),
  500, '22 · liquida compras por facturar por lo recibido al precio de la orden');

SELECT public.chk_num(
  public.debe_en('aaaa2222-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000a010'),
  80, '22 · y el IVA va a su cuenta de crédito fiscal');

SELECT public.chk_num(
  (SELECT COALESCE(SUM(l.haber), 0) FROM public.conta_asiento_lineas l
     JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.origen_id = 'aaaa2222-0000-0000-0000-000000000002'::uuid
      AND l.cuenta_id = 'c0000000-0000-0000-0000-00000000a008'::uuid),
  580, '22 · contra CxP por el total de la factura');

-- Y no se registra como usada una cuenta que no está en el asiento.
SELECT public.chk(
  (SELECT count(*) FROM public.conta_resoluciones
    WHERE origen_id = 'aaaa2222-0000-0000-0000-000000000002'::uuid
      AND cuenta_id IS NOT NULL), 0,
  '22 · y NO se anota en la bitácora una cuenta de gasto que el asiento no usa');

-- ── 23. Las cuentas explícitas se respetan POR LÍNEA ────────────────────────
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
VALUES (:A::uuid, NULL, 'gasto_otros', 'c0000000-0000-0000-0000-00000000a002');

-- (a) DOS líneas con cuentas DISTINTAS. Ninguna se descarta.
SELECT public.factura('aaaa3333-0000-0000-0000-000000000001', 'Dos cuentas elegidas', 300);
SELECT public.linea('aaaa3333-0000-0000-0000-000000000001', 1, 1, 100, 'c0000000-0000-0000-0000-00000000a005');
SELECT public.linea('aaaa3333-0000-0000-0000-000000000001', 2, 1, 200, 'c0000000-0000-0000-0000-00000000a006');
SELECT public.aprobar_id('aaaa3333-0000-0000-0000-000000000001');

SELECT public.chk_num(
  public.debe_en('aaaa3333-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000a005'),
  100, '23a · la primera línea va a SU cuenta, por SU importe');
SELECT public.chk_num(
  public.debe_en('aaaa3333-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000a006'),
  200, '23a · y la segunda a la suya, por el suyo');
SELECT public.chk_num(
  public.debe_en('aaaa3333-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000a002'),
  0, '23a · sin que nada caiga al mapeo del evento');

-- (b) Una línea con cuenta y otra SIN. La elegida no se estira sobre la otra.
SELECT public.factura('aaaa3333-0000-0000-0000-000000000002', 'Una elegida y una no', 300);
SELECT public.linea('aaaa3333-0000-0000-0000-000000000002', 1, 1, 100, 'c0000000-0000-0000-0000-00000000a005');
SELECT public.linea('aaaa3333-0000-0000-0000-000000000002', 2, 1, 200, NULL);
SELECT public.aprobar_id('aaaa3333-0000-0000-0000-000000000002');

SELECT public.chk_num(
  public.debe_en('aaaa3333-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000a005'),
  100, '23b · la línea con cuenta elegida recibe SÓLO su importe');
SELECT public.chk_num(
  public.debe_en('aaaa3333-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000a002'),
  200, '23b · y la línea sin cuenta resuelve por su cuenta, con el resto');

-- (c) Cuenta explícita INVÁLIDA: agrupadora. No se contabiliza en otra: queda
--     pendiente de configuración, que es lo único honesto cuando alguien
--     eligió una cuenta y esa cuenta no sirve.
SELECT public.factura('aaaa3333-0000-0000-0000-000000000003', 'Cuenta elegida inválida', 300);
SELECT public.linea('aaaa3333-0000-0000-0000-000000000003', 1, 1, 300, 'c0000000-0000-0000-0000-00000000a001');
SELECT public.aprobar_id('aaaa3333-0000-0000-0000-000000000003');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos
    WHERE origen_id = 'aaaa3333-0000-0000-0000-000000000003'::uuid
      AND origen_evento = 'factura_prov_aprobada'), 0,
  '23c · con una cuenta elegida inválida NO se genera asiento');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_resoluciones
    WHERE origen_id = 'aaaa3333-0000-0000-0000-000000000003'::uuid
      AND origen_resolucion = 'sin_resolver' AND motivo IS NOT NULL), 1,
  '23c · y queda pendiente de configuración, con motivo');

SELECT public.chk_num(
  public.debe_en('aaaa3333-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-00000000a002'),
  0, '23c · y NO se contabiliza en silencio contra el mapeo del evento');

-- (d) Convivencia con la regla del proveedor: la línea elegida manda sobre la
--     regla, y la línea sin cuenta usa la regla, no el mapeo.
INSERT INTO public.conta_reglas_proveedor
  (company_id, project_id, proveedor_id, destino, cuenta_id) VALUES
  (:A::uuid, NULL, 'd0000000-0000-0000-0000-00000000a001'::uuid, 'gasto',
   'c0000000-0000-0000-0000-00000000a003'::uuid);

SELECT public.factura('aaaa3333-0000-0000-0000-000000000004', 'Elegida y regla', 300);
SELECT public.linea('aaaa3333-0000-0000-0000-000000000004', 1, 1, 100, 'c0000000-0000-0000-0000-00000000a005');
SELECT public.linea('aaaa3333-0000-0000-0000-000000000004', 2, 1, 200, NULL);
SELECT public.aprobar_id('aaaa3333-0000-0000-0000-000000000004');

SELECT public.chk_num(
  public.debe_en('aaaa3333-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-00000000a005'),
  100, '23d · la cuenta elegida en la línea gana a la regla del proveedor');
SELECT public.chk_num(
  public.debe_en('aaaa3333-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-00000000a003'),
  200, '23d · y la línea sin cuenta usa la regla, no el mapeo del evento');

-- La bitácora distingue las dos líneas, que es lo que hace auditable un
-- asiento con más de una imputación.
SELECT public.chk(
  (SELECT count(DISTINCT origen_resolucion) FROM public.conta_resoluciones
    WHERE origen_id = 'aaaa3333-0000-0000-0000-000000000004'::uuid), 2,
  '23d · y la bitácora registra los DOS escalones que decidieron la factura');

SELECT 'INVARIANTES OK' AS resultado;