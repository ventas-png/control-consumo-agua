\set ON_ERROR_STOP on
-- Invariantes de 20261230000000 (conta_poliza_manual_guardar).
-- Padrón: el de fail_open_sin_perfil. Empresa D: OWN_D propietario, OPE_D operador
-- con el rol «Finanzas / Contador» (asignado a D1, no a D2), VIS_D sin rol.
-- OP_C es operador de OTRA empresa.

-- Ejecuta p_sql como p_actor y devuelve su resultado (texto) o '!' || SQLSTATE || ' ' || mensaje.
CREATE OR REPLACE FUNCTION fos.como(p_actor text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM fos.poner_actor(p_actor);
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION WHEN OTHERS THEN
    v := '!' || SQLSTATE || ' ' || SQLERRM;
  END;
  PERFORM fos.poner_actor('SISTEMA');
  RETURN v;
END $$;

-- Llamada a la RPC: devuelve el id de la póliza.
CREATE OR REPLACE FUNCTION fos.guardar(
  p_actor text, p_id uuid, p_proyecto uuid, p_concepto text, p_lineas jsonb, p_publicar boolean,
  p_tipo text DEFAULT 'diario'
) RETURNS text LANGUAGE sql AS $$
  SELECT fos.como(p_actor, format(
    'SELECT (public.conta_poliza_manual_guardar(%L, %L, CURRENT_DATE, %L, %L, NULL, %L::jsonb, %L)).id::text',
    p_id, p_proyecto, p_tipo, p_concepto, p_lineas, p_publicar))
$$;

DO $$
DECLARE
  d       uuid := fos.id('D');
  caja    uuid; ingreso uuid; gasto uuid; caja_d1 uuid;
  cuadra  jsonb; descuadra jsonb; tres jsonb;
  r       text; borr uuid; pub uuid; auto uuid;
  n0 int; l0 int; n int; l int;
  v_estado text; v_numero bigint; v_concepto text;
BEGIN
  -- Catálogo: la empresa y sus proyectos pueden traerlo ya sembrado (según la cadena); si alguno está vacío lo
  -- inicializa su propietario. Las cuentas se eligen por TIPO, no por código: no depende de qué plantilla haya.
  IF NOT EXISTS (SELECT 1 FROM public.conta_cuentas WHERE company_id = d AND project_id IS NULL) THEN
    r := fos.como('OWN_D', $q$SELECT count(*)::text FROM public.conta_inicializar_catalogo('basico', NULL)$q$);
    IF r LIKE '!%' THEN RAISE EXCEPTION 'no se pudo sembrar el catálogo de la empresa: %', r; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conta_cuentas WHERE company_id = d AND project_id = fos.id('D1')) THEN
    r := fos.como('OWN_D', format($q$SELECT count(*)::text FROM public.conta_inicializar_catalogo('basico', %L)$q$, fos.id('D1')));
    IF r LIKE '!%' THEN RAISE EXCEPTION 'no se pudo sembrar el catálogo de D1: %', r; END IF;
  END IF;
  SELECT id INTO caja    FROM public.conta_cuentas WHERE company_id = d AND project_id IS NULL AND tipo = 'activo'  AND es_detalle AND activa AND moneda IS NULL ORDER BY codigo LIMIT 1;
  SELECT id INTO ingreso FROM public.conta_cuentas WHERE company_id = d AND project_id IS NULL AND tipo = 'ingreso' AND es_detalle AND activa AND moneda IS NULL ORDER BY codigo LIMIT 1;
  SELECT id INTO gasto   FROM public.conta_cuentas WHERE company_id = d AND project_id IS NULL AND tipo = 'gasto'   AND es_detalle AND activa AND moneda IS NULL ORDER BY codigo LIMIT 1;
  SELECT id INTO caja_d1 FROM public.conta_cuentas WHERE company_id = d AND project_id = fos.id('D1') AND tipo = 'activo' AND es_detalle AND activa AND moneda IS NULL ORDER BY codigo LIMIT 1;
  IF caja IS NULL OR ingreso IS NULL OR gasto IS NULL OR caja_d1 IS NULL THEN RAISE EXCEPTION 'faltan cuentas de detalle en el catálogo de D o de D1'; END IF;

  cuadra    := jsonb_build_array(jsonb_build_object('cuenta_id', caja, 'debe', 100, 'haber', 0, 'descripcion', ' entra '),
                                 jsonb_build_object('cuenta_id', ingreso, 'debe', 0, 'haber', 100));
  descuadra := jsonb_build_array(jsonb_build_object('cuenta_id', caja, 'debe', 100, 'haber', 0),
                                 jsonb_build_object('cuenta_id', ingreso, 'debe', 0, 'haber', 90));
  tres      := jsonb_build_array(jsonb_build_object('cuenta_id', caja, 'debe', 0, 'haber', 50),
                                 jsonb_build_object('cuenta_id', gasto, 'debe', 30, 'haber', 0),
                                 jsonb_build_object('cuenta_id', gasto, 'debe', 20, 'haber', 0));

  -- ── 1 · crear borrador ────────────────────────────────────────────────────
  r := fos.guardar('OPE_D', NULL, NULL, '  Venta de contado  ', cuadra, false);
  IF r LIKE '!%' THEN RAISE EXCEPTION 'crear borrador: %', r; END IF;
  borr := r::uuid;
  SELECT estado, numero, concepto INTO v_estado, v_numero, v_concepto FROM public.conta_asientos WHERE id = borr;
  IF v_estado <> 'borrador' OR v_numero IS NOT NULL OR v_concepto <> 'Venta de contado' THEN
    RAISE EXCEPTION 'el borrador nace sin folio y con el concepto recortado (%, %, %)', v_estado, v_numero, v_concepto; END IF;
  IF (SELECT count(*) FROM public.conta_asiento_lineas WHERE asiento_id = borr) <> 2
     OR (SELECT created_by FROM public.conta_asientos WHERE id = borr) IS DISTINCT FROM fos.id('OPE_D')
     OR (SELECT origen FROM public.conta_asientos WHERE id = borr) <> 'manual'
     OR (SELECT descripcion FROM public.conta_asiento_lineas WHERE asiento_id = borr AND orden = 1) <> 'entra' THEN
    RAISE EXCEPTION 'el borrador debe quedar manual, a nombre de quien lo creó y con sus 2 líneas en orden'; END IF;
  RAISE NOTICE '✓ 1 · crea el borrador con sus líneas, sin folio, a nombre de quien lo capturó';

  -- ── 2 · guardar y publicar ────────────────────────────────────────────────
  r := fos.guardar('OPE_D', NULL, NULL, 'Venta publicada', cuadra, true);
  IF r LIKE '!%' THEN RAISE EXCEPTION 'guardar y publicar: %', r; END IF;
  pub := r::uuid;
  SELECT estado, numero INTO v_estado, v_numero FROM public.conta_asientos WHERE id = pub;
  IF v_estado <> 'publicado' OR v_numero IS NULL THEN RAISE EXCEPTION 'debía quedar publicada con folio (%, %)', v_estado, v_numero; END IF;
  RAISE NOTICE '✓ 2 · guarda y publica en una llamada: publicada, folio %', v_numero;

  -- ── 3 · ATOMICIDAD: si la publicación se rechaza no queda nada ────────────
  SELECT count(*) INTO n0 FROM public.conta_asientos WHERE company_id = d;
  SELECT count(*) INTO l0 FROM public.conta_asiento_lineas WHERE company_id = d;
  r := fos.guardar('OPE_D', NULL, NULL, 'Descuadrada', descuadra, true);
  IF r NOT LIKE '!23514 Asiento descuadrado%' THEN RAISE EXCEPTION 'descuadrada + publicar debía rechazarse por descuadre: %', r; END IF;
  -- sin «Cambiar estado»: guarda borradores, no publica — y el intento de publicar no deja borrador
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
    VALUES ('f0520000-0000-0000-0000-000000000001', 'platform.contabilidad.change_status', 'deny');
  r := fos.guardar('OPE_D', NULL, NULL, 'Sin permiso de publicar', cuadra, true);
  IF r NOT LIKE '!42501%' THEN RAISE EXCEPTION 'sin «Cambiar estado», publicar debía dar 42501: %', r; END IF;
  DELETE FROM public.role_permissions WHERE role_id = 'f0520000-0000-0000-0000-000000000001';
  -- cuenta de OTRA contabilidad (la del proyecto D1) en una póliza de la empresa
  r := fos.guardar('OPE_D', NULL, NULL, 'Cuenta de otro ledger',
         jsonb_build_array(jsonb_build_object('cuenta_id', caja_d1, 'debe', 10, 'haber', 0),
                           jsonb_build_object('cuenta_id', ingreso, 'debe', 0, 'haber', 10)), false);
  IF r NOT LIKE '!%' THEN RAISE EXCEPTION 'una cuenta de otra contabilidad debía rechazarse'; END IF;
  -- una sola línea / sin concepto / tipo no manual
  IF fos.guardar('OPE_D', NULL, NULL, 'Una línea', jsonb_build_array(cuadra -> 0), false) NOT LIKE '!23514 Una póliza lleva al menos 2 líneas%'
     OR fos.guardar('OPE_D', NULL, NULL, '   ', cuadra, false) NOT LIKE '!23514 El concepto es obligatorio%'
     OR fos.guardar('OPE_D', NULL, NULL, 'Cierre a mano', cuadra, false, 'cierre') NOT LIKE '!23514 Tipo de póliza manual no válido%' THEN
    RAISE EXCEPTION 'las validaciones de entrada (2 líneas, concepto, tipo) no rechazaron'; END IF;
  SELECT count(*) INTO n FROM public.conta_asientos WHERE company_id = d;
  SELECT count(*) INTO l FROM public.conta_asiento_lineas WHERE company_id = d;
  IF n <> n0 OR l <> l0 THEN RAISE EXCEPTION 'ATOMICIDAD: tras 6 rechazos quedaron % cabeceras y % líneas de más', n - n0, l - l0; END IF;
  RAISE NOTICE '✓ 3 · ATOMICIDAD: 6 rechazos (descuadre, sin permiso de publicar, cuenta ajena, entrada inválida) no dejan cabecera ni línea';

  -- ── 4 · editar un borrador ────────────────────────────────────────────────
  -- sin «Eliminar»: reemplazar las líneas de un borrador es EDITAR
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
    VALUES ('f0520000-0000-0000-0000-000000000001', 'platform.contabilidad.delete', 'deny');
  r := fos.guardar('OPE_D', borr, NULL, 'Pago de servicios', tres, false, 'egreso');
  IF r IS DISTINCT FROM borr::text THEN RAISE EXCEPTION 'editar debía devolver el MISMO borrador: %', r; END IF;
  DELETE FROM public.role_permissions WHERE role_id = 'f0520000-0000-0000-0000-000000000001';
  IF (SELECT count(*) FROM public.conta_asiento_lineas WHERE asiento_id = borr) <> 3
     OR (SELECT concepto || '|' || tipo || '|' || estado FROM public.conta_asientos WHERE id = borr) <> 'Pago de servicios|egreso|borrador'
     OR (SELECT count(*) FROM public.conta_asientos WHERE company_id = d) <> n0 THEN
    RAISE EXCEPTION 'la edición debía reemplazar cabecera y líneas sin crear otra póliza'; END IF;
  RAISE NOTICE '✓ 4 · edita el borrador (mismo id, 3 líneas nuevas, cabecera cambiada) sin pedir «Eliminar» y sin duplicar';

  -- editar y publicar; una edición rechazada al publicar deja el borrador COMO ESTABA
  r := fos.guardar('OPE_D', borr, NULL, 'Roto', descuadra, true);
  IF r NOT LIKE '!23514 Asiento descuadrado%' THEN RAISE EXCEPTION 'editar + publicar descuadrado debía rechazarse: %', r; END IF;
  IF (SELECT count(*) FROM public.conta_asiento_lineas WHERE asiento_id = borr) <> 3
     OR (SELECT concepto FROM public.conta_asientos WHERE id = borr) <> 'Pago de servicios' THEN
    RAISE EXCEPTION 'una edición rechazada debía dejar el borrador intacto'; END IF;
  r := fos.guardar('OPE_D', borr, NULL, 'Pago de servicios', tres, true, 'egreso');
  IF r IS DISTINCT FROM borr::text OR (SELECT estado FROM public.conta_asientos WHERE id = borr) <> 'publicado' THEN
    RAISE EXCEPTION 'editar y publicar: %', r; END IF;
  RAISE NOTICE '✓ 5 · edición rechazada deja el borrador intacto; editar y publicar lo publica';

  -- ── 6 · lo que NO se edita ────────────────────────────────────────────────
  IF fos.guardar('OPE_D', borr, NULL, 'Otra vez', cuadra, false) NOT LIKE '!23514 POLIZA_NO_EDITABLE: sólo un borrador%' THEN
    RAISE EXCEPTION 'una póliza publicada no se edita'; END IF;
  -- automática en borrador (p. ej. sin tipo de cambio): no se edita por aquí
  PERFORM set_config('conta.allow_system_write', 'on', true);
  INSERT INTO public.conta_asientos (company_id, fecha, tipo, concepto, estado, origen, origen_tabla, origen_id, origen_evento, moneda_base)
    VALUES (d, CURRENT_DATE, 'diario', 'Automática', 'borrador', 'automatico', 'pagos', gen_random_uuid(), 'pago_contabilizado', 'GTQ')
    RETURNING id INTO auto;
  PERFORM set_config('conta.allow_system_write', 'off', true);
  IF fos.guardar('OPE_D', auto, NULL, 'Tocar la automática', cuadra, false) NOT LIKE '!23514 POLIZA_NO_EDITABLE: una póliza automática%' THEN
    RAISE EXCEPTION 'una póliza automática no se edita'; END IF;
  -- nuevo borrador para las pruebas de alcance
  borr := fos.guardar('OPE_D', NULL, NULL, 'Borrador de D', cuadra, false)::uuid;
  IF fos.guardar('OPE_D', borr, fos.id('D1'), 'Mudar de ledger', cuadra, false) NOT LIKE '!23514 POLIZA_OTRO_LEDGER%' THEN
    RAISE EXCEPTION 'un borrador no cambia de contabilidad'; END IF;
  -- El propietario de OTRA empresa tiene todos los permisos en la suya: llega hasta la búsqueda y no lo encuentra.
  -- Su operador, sin permiso contable, ni siquiera llega.
  IF fos.guardar('OWN_C', borr, NULL, 'Ajeno', cuadra, false) NOT LIKE '!P0002 Asiento no encontrado%'
     OR fos.guardar('OP_C', borr, NULL, 'Ajeno', cuadra, false) NOT LIKE '!42501%' THEN
    RAISE EXCEPTION 'otra empresa no ve ni edita el borrador (mismo mensaje que «no existe»)'; END IF;
  IF (SELECT concepto FROM public.conta_asientos WHERE id = borr) <> 'Borrador de D' THEN RAISE EXCEPTION 'el borrador cambió'; END IF;
  RAISE NOTICE '✓ 6 · no edita lo publicado, lo automático, lo de otra contabilidad ni lo de otra empresa';

  -- ── 7 · cada acción con SU permiso ────────────────────────────────────────
  IF fos.guardar('VIS_D', NULL, NULL, 'Sin rol', cuadra, false) NOT LIKE '!42501%'
     OR fos.guardar('VIS_D', borr, NULL, 'Sin rol', cuadra, false) NOT LIKE '!42501%'
     OR fos.guardar('SINAPP', NULL, NULL, 'Sin perfil', cuadra, false) NOT LIKE '!42501%'
     OR fos.guardar('CLI', NULL, NULL, 'Cliente', cuadra, false) NOT LIKE '!42501%' THEN
    RAISE EXCEPTION 'sin permiso, sin perfil o cliente: debía ser 42501'; END IF;
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
    VALUES ('f0520000-0000-0000-0000-000000000001', 'platform.contabilidad.edit', 'deny');
  IF fos.guardar('OPE_D', borr, NULL, 'Sin editar', cuadra, false) NOT LIKE '!42501%' THEN RAISE EXCEPTION 'sin «Editar» no se edita un borrador'; END IF;
  IF fos.guardar('OPE_D', NULL, NULL, 'Crear sin editar', cuadra, false) LIKE '!%' THEN RAISE EXCEPTION 'sin «Editar» sí se crea (create)'; END IF;
  UPDATE public.role_permissions SET permission_key = 'platform.contabilidad.create' WHERE role_id = 'f0520000-0000-0000-0000-000000000001';
  IF fos.guardar('OPE_D', NULL, NULL, 'Sin crear', cuadra, false) NOT LIKE '!42501%' THEN RAISE EXCEPTION 'sin «Crear» no se crea'; END IF;
  IF fos.guardar('OPE_D', borr, NULL, 'Editar sin crear', cuadra, false) LIKE '!%' THEN RAISE EXCEPTION 'sin «Crear» sí se edita (edit)'; END IF;
  DELETE FROM public.role_permissions WHERE role_id = 'f0520000-0000-0000-0000-000000000001';
  RAISE NOTICE '✓ 7 · crear pide «Crear», editar pide «Editar»; sin rol, sin perfil o cliente: «no autorizado»';

  -- ── 8 · proyectos ─────────────────────────────────────────────────────────
  r := fos.guardar('OPE_D', NULL, fos.id('D1'), 'En D1',
         jsonb_build_array(jsonb_build_object('cuenta_id', caja_d1, 'debe', 5, 'haber', 0),
                           jsonb_build_object('cuenta_id', caja_d1, 'debe', 0, 'haber', 5)), true);
  IF r LIKE '!%' THEN RAISE EXCEPTION 'póliza en su proyecto D1: %', r; END IF;
  IF (SELECT project_id FROM public.conta_asientos WHERE id = r::uuid) IS DISTINCT FROM fos.id('D1') THEN RAISE EXCEPTION 'debía quedar en D1'; END IF;
  IF fos.guardar('OPE_D', NULL, fos.id('D2'), 'En D2', cuadra, false) NOT LIKE '!42501%' THEN
    RAISE EXCEPTION 'un proyecto al que la persona no está asignada: 42501'; END IF;
  IF fos.guardar('OPE_D', NULL, fos.id('C1'), 'En C1', cuadra, false) NOT LIKE '!42501%'
     OR fos.guardar('OP_C', NULL, fos.id('D1'), 'En D1 desde C', cuadra, false) NOT LIKE '!42501%' THEN
    RAISE EXCEPTION 'un proyecto de otra empresa: 42501'; END IF;
  RAISE NOTICE '✓ 8 · publica en su proyecto; proyecto sin alcance o de otra empresa: «no autorizado»';

  -- ── 9 · ACL ───────────────────────────────────────────────────────────────
  IF has_function_privilege('anon', 'public.conta_poliza_manual_guardar(uuid,uuid,date,text,text,text,jsonb,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.conta_poliza_manual_guardar(uuid,uuid,date,text,text,text,jsonb,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL: anon sin EXECUTE, authenticated con EXECUTE'; END IF;
  RAISE NOTICE '✓ 9 · ACL: anon sin EXECUTE, authenticated con EXECUTE';
END $$;
