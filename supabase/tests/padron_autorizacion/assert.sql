\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261101000000: mascotas y vehículos se registran desde el
-- portal y la administración los autoriza (mismo circuito que la renta).
--
--    1-3   padrón previo intacto (aprobado/activo) y la invariante de la base:
--          nada no aprobado puede estar activo
--    4-13  propietario: no escribe la tabla directo; reservar idempotente;
--          enviar valida vacunas, fechas, foto y documentos server-side; el
--          expediente queda inmutable al enviar; aviso al staff al ENVIAR
--   14-19  inquilino y vecina: el inquilino registra lo suyo, no toca lo del
--          propietario; la vecina no opera en una unidad ajena; placa única
--   20-29  administración: permiso y empresa, rechazo con motivo, aprobación
--          con TAG único, sin doble resolución, aviso al residente, documentos
--   30-34  baja y descarte: propietario da de baja, el TAG queda libre;
--          descartar borra solo borradores; ACL
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- A · Padrón previo e invariante (como postgres)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.mascotas WHERE estado = 'aprobada' AND activo;
  IF v_n <> 1 THEN RAISE EXCEPTION '1: la mascota previa no quedó aprobada y activa'; END IF;
  SELECT count(*) INTO v_n FROM public.vehiculos_residentes WHERE estado = 'aprobada' AND activo;
  IF v_n <> 1 THEN RAISE EXCEPTION '1: el vehículo previo no quedó aprobado y activo'; END IF;
  RAISE NOTICE '1  OK    el padrón cargado antes de la migración queda aprobado y activo';

  BEGIN
    UPDATE public.mascotas SET estado = 'pendiente' WHERE id = 'aa000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '2: una mascota pendiente quedó activa';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.vehiculos_residentes SET estado = 'rechazada' WHERE id = 'bb000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '2: un vehículo rechazado quedó activo';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE '2  OK    la base impide que algo no aprobado esté activo';

  BEGIN
    UPDATE public.vehiculos_residentes SET tag_tipo = 'chip' WHERE id = 'bb000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '3: aceptó un tipo de TAG desconocido';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE '3  OK    tipo de TAG acotado por CHECK';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B · Propietario (Marco, 1D)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000c', false);
SET ROLE authenticated;
DO $$
DECLARE
  U1   uuid := '11d10000-0000-0000-0000-000000000001';
  P1   uuid := '11111111-0000-0000-0000-000000000001';
  v_id uuid;
  v_id2 uuid;
  v_m  public.mascotas%ROWTYPE;
  v_n  int;
  v_vac jsonb := '[{"tipo":"Rabia","fecha":"2026-01-10","proxima":"2027-01-10"},{"tipo":"Parvovirus","fecha":"2026-03-05"}]';
BEGIN
  BEGIN
    INSERT INTO public.mascotas (company_id, project_id, unidad_id, nombre, estado, activo)
    VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', P1, U1, 'Colado', 'aprobada', true);
    RAISE EXCEPTION '4: el residente insertó en mascotas sin pasar por la RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE '4  OK    el residente no escribe la tabla directo (no puede autoaprobarse)';

  v_id  := public.portal_reservar_mascota(U1);
  v_id2 := public.portal_reservar_mascota(U1);
  IF v_id IS NULL OR v_id <> v_id2 THEN RAISE EXCEPTION '5: reservar no es idempotente (% / %)', v_id, v_id2; END IF;
  SELECT * INTO v_m FROM public.mascotas WHERE id = v_id;
  IF v_m.estado <> 'borrador' OR v_m.activo THEN RAISE EXCEPTION '5: el borrador nace %/%', v_m.estado, v_m.activo; END IF;
  RAISE NOTICE '5  OK    reservar crea UN borrador inactivo y lo devuelve en la segunda llamada';

  BEGIN
    PERFORM public.portal_enviar_mascota(v_id, '{"nombre":"Toby","especie":"perro"}'::jsonb, '[]'::jsonb);
    RAISE EXCEPTION '6: envió un perro sin vacunas';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '6:%' THEN RAISE; END IF; END;
  RAISE NOTICE '6  OK    perros y gatos exigen al menos una vacuna';

  BEGIN
    PERFORM public.portal_enviar_mascota(v_id,
      jsonb_build_object('nombre','Toby','especie','perro','vacunas',
        '[{"tipo":"Rabia","fecha":"2999-01-01"}]'::jsonb), '[]'::jsonb);
    RAISE EXCEPTION '7: aceptó una vacuna con fecha futura';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '7:%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.portal_enviar_mascota(v_id,
      jsonb_build_object('nombre','Toby','especie','perro','vacunas','[{"fecha":"2026-01-01"}]'::jsonb), '[]'::jsonb);
    RAISE EXCEPTION '7: aceptó una vacuna sin tipo';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '7:%' THEN RAISE; END IF; END;
  RAISE NOTICE '7  OK    cada vacuna trae tipo y fecha aplicada no futura';

  BEGIN
    PERFORM public.portal_enviar_mascota(v_id,
      jsonb_build_object('nombre','Toby','especie','perro','vacunas',v_vac),
      jsonb_build_array(jsonb_build_object('path', U1::text || '/mascotas/' || gen_random_uuid() || '/x.pdf')));
    RAISE EXCEPTION '8: registró un documento de otra carpeta';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '8:%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.portal_enviar_mascota(v_id,
      jsonb_build_object('nombre','Toby','especie','perro','vacunas',v_vac,
                         'foto_url','otro-proyecto/mascotas/f.jpg'), '[]'::jsonb);
    RAISE EXCEPTION '8: aceptó una foto de otro condominio';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '8:%' THEN RAISE; END IF; END;
  RAISE NOTICE '8  OK    documentos y foto deben colgar de la carpeta de ESTA solicitud';

  -- Storage: sube dentro de {unidad}/mascotas/{id}/ mientras es borrador.
  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('padron-docs', U1::text || '/mascotas/' || v_id::text || '/carnet.pdf');
  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('padron-docs', U1::text || '/mascotas/00000000-0000-0000-0000-000000000999/suelto.pdf');
    RAISE EXCEPTION '9: subió a una carpeta sin solicitud';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE '9  OK    sube al borrador propio; sin fila detrás la carpeta no acepta archivos';

  -- ≥ 10 mantiene las vacunas: la última fecha aplicada se deriva server-side.
  PERFORM public.portal_enviar_mascota(v_id,
    jsonb_build_object('nombre',' Toby ','especie','perro','sexo','macho','tamano','mediano',
                       'peso_kg','12.5','esterilizada',true,'vacunas',v_vac,
                       'foto_url', P1::text || '/mascotas/toby.jpg'),
    jsonb_build_array(jsonb_build_object('path', U1::text || '/mascotas/' || v_id::text || '/carnet.pdf',
                                         'nombre','carnet.pdf','etiqueta','Carnet de vacunación')));
  SELECT * INTO v_m FROM public.mascotas WHERE id = v_id;
  IF v_m.estado <> 'pendiente' OR v_m.activo OR v_m.nombre <> 'Toby'
     OR v_m.fecha_ultima_vacuna <> '2026-03-05' OR jsonb_array_length(v_m.documentos) <> 1
     OR v_m.esterilizada IS NOT TRUE OR v_m.peso_kg <> 12.5 OR v_m.fecha_solicitud IS NULL THEN
    RAISE EXCEPTION '10: la ficha enviada no quedó como se mandó: %', row_to_json(v_m);
  END IF;
  RAISE NOTICE '10 OK    enviar deja la ficha pendiente, inactiva y con la última vacuna derivada';

  BEGIN
    PERFORM public.portal_enviar_mascota(v_id, jsonb_build_object('nombre','Otro','especie','gato','vacunas',v_vac), '[]'::jsonb);
    RAISE EXCEPTION '11: re-envió una solicitud ya enviada';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '11:%' THEN RAISE; END IF; END;
  RAISE NOTICE '11 OK    una solicitud enviada no se re-escribe';

  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('padron-docs', U1::text || '/mascotas/' || v_id::text || '/tarde.pdf');
    RAISE EXCEPTION '12: subió un archivo después de enviar';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  DELETE FROM storage.objects WHERE bucket_id = 'padron-docs';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN RAISE EXCEPTION '12: borró el expediente después de enviar'; END IF;
  RAISE NOTICE '12 OK    al enviar, el expediente queda inmutable';

  PERFORM set_config('test.mascota_marco', v_id::text, false);
END $$;
RESET ROLE;

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.test_notificaciones
   WHERE origen = 'mascotas' AND fila_id = current_setting('test.mascota_marco')::uuid AND estado = 'pendiente';
  IF v_n <> 1 THEN RAISE EXCEPTION '13: avisos al staff al enviar = % (esperado 1, y ninguno al reservar)', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.test_notificaciones WHERE estado = 'borrador';
  IF v_n <> 0 THEN RAISE EXCEPTION '13: se avisó al staff de un borrador'; END IF;
  RAISE NOTICE '13 OK    el staff se entera al ENVIAR, no al reservar el borrador';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C · Inquilino (Luis, 1D)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', false);
SET ROLE authenticated;
DO $$
DECLARE
  U1   uuid := '11d10000-0000-0000-0000-000000000001';
  v_id uuid;
  v_n  int;
BEGIN
  v_id := public.portal_reservar_vehiculo(U1);
  IF v_id IS NULL THEN RAISE EXCEPTION '14: el inquilino no pudo reservar'; END IF;
  RAISE NOTICE '14 OK    el inquilino también registra lo suyo (vehículo)';

  BEGIN
    PERFORM public.portal_enviar_vehiculo(v_id, '{"placa":"p-777aaa","tipo":"auto"}'::jsonb, '[]'::jsonb);
    RAISE EXCEPTION '15: aceptó una placa ya registrada en el condominio';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '15:%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.portal_enviar_vehiculo(v_id, '{"placa":"<script>","tipo":"auto"}'::jsonb, '[]'::jsonb);
    RAISE EXCEPTION '15: aceptó una placa con caracteres inválidos';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '15:%' THEN RAISE; END IF; END;
  RAISE NOTICE '15 OK    placa normalizada, válida y única entre pendientes/aprobados del condominio';

  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('padron-docs', U1::text || '/vehiculos/' || v_id::text || '/tarjeta.pdf');
  PERFORM public.portal_enviar_vehiculo(v_id,
    '{"placa":" p 123  abc ","tipo":"auto","marca":"Toyota","modelo":"Corolla","anio":"2022"}'::jsonb,
    jsonb_build_array(jsonb_build_object('path', U1::text || '/vehiculos/' || v_id::text || '/tarjeta.pdf')));
  SELECT count(*) INTO v_n FROM public.vehiculos_residentes
   WHERE id = v_id AND estado = 'pendiente' AND placa = 'P 123 ABC' AND anio = 2022 AND NOT activo;
  IF v_n <> 1 THEN RAISE EXCEPTION '16: el vehículo no quedó pendiente con la placa normalizada'; END IF;
  RAISE NOTICE '16 OK    el inquilino envía su vehículo: queda pendiente con la placa normalizada';

  -- No lee ni toca el expediente de la mascota del propietario.
  SELECT count(*) INTO v_n FROM storage.objects
   WHERE bucket_id = 'padron-docs' AND name LIKE '%/mascotas/%';
  IF v_n > 0 THEN RAISE EXCEPTION '17: el inquilino lee los documentos de la mascota del propietario'; END IF;
  BEGIN
    PERFORM public.portal_baja_mascota(current_setting('test.mascota_marco')::uuid, NULL);
    RAISE EXCEPTION '17: el inquilino retiró la solicitud del propietario';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '17:%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.portal_descartar_mascota(current_setting('test.mascota_marco')::uuid);
    RAISE EXCEPTION '17: el inquilino descartó la solicitud del propietario';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '17:%' THEN RAISE; END IF; END;
  RAISE NOTICE '17 OK    el inquilino no lee, retira ni descarta lo que registró el propietario';

  PERFORM set_config('test.vehiculo_luis', v_id::text, false);
END $$;
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- D · Vecina (Ana, 3D): no opera en la unidad ajena
-- ─────────────────────────────────────────────────────────────────────────────
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000e', false);
SET ROLE authenticated;
DO $$
DECLARE v_n int;
BEGIN
  BEGIN
    PERFORM public.portal_reservar_mascota('11d10000-0000-0000-0000-000000000001');
    RAISE EXCEPTION '18: la vecina reservó en una unidad ajena';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '18:%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.portal_baja_vehiculo(current_setting('test.vehiculo_luis')::uuid, NULL);
    RAISE EXCEPTION '18: la vecina retiró un vehículo ajeno';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '18:%' THEN RAISE; END IF; END;
  RAISE NOTICE '18 OK    la vecina no reserva ni retira en una unidad ajena';

  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'padron-docs';
  IF v_n > 0 THEN RAISE EXCEPTION '19: la vecina lee documentos de otra unidad'; END IF;
  RAISE NOTICE '19 OK    la vecina no lee documentos de otra unidad';
END $$;
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- E · Administración
-- ─────────────────────────────────────────────────────────────────────────────
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000b', false);  -- otra empresa
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.resolver_mascota(current_setting('test.mascota_marco')::uuid, true, NULL);
    RAISE EXCEPTION '20: un admin de otra empresa aprobó';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '20:%' THEN RAISE; END IF; END;
  RAISE NOTICE '20 OK    otra empresa no resuelve';
END $$;
RESET ROLE;

SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000f', false);  -- staff sin permiso
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.resolver_vehiculo(current_setting('test.vehiculo_luis')::uuid, true, NULL, 'T-1', NULL);
    RAISE EXCEPTION '21: staff sin permiso del tab aprobó';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '21:%' THEN RAISE; END IF; END;
  RAISE NOTICE '21 OK    sin el permiso del tab no se resuelve';
END $$;
RESET ROLE;

SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000a', false);  -- admin con permiso
SET ROLE authenticated;
DO $$
DECLARE
  v_m  uuid := current_setting('test.mascota_marco')::uuid;
  v_v  uuid := current_setting('test.vehiculo_luis')::uuid;
  v_n  int;
  v_r  record;
BEGIN
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'padron-docs';
  IF v_n <> 2 THEN RAISE EXCEPTION '22: la administración ve % documentos (esperado 2)', v_n; END IF;
  RAISE NOTICE '22 OK    la administración lee el expediente de ambas solicitudes';

  BEGIN
    PERFORM public.resolver_mascota(v_m, false, '   ');
    RAISE EXCEPTION '23: rechazó sin motivo';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '23:%' THEN RAISE; END IF; END;
  RAISE NOTICE '23 OK    rechazar exige motivo';

  PERFORM public.resolver_mascota(v_m, true, NULL);
  SELECT estado, activo, resuelto_por, resuelto_por_user_id INTO v_r FROM public.mascotas WHERE id = v_m;
  IF v_r.estado <> 'aprobada' OR NOT v_r.activo OR v_r.resuelto_por <> 'Admin Uno'
     OR v_r.resuelto_por_user_id <> 'e0000000-0000-0000-0000-00000000000a' THEN
    RAISE EXCEPTION '24: la aprobación quedó %', row_to_json(v_r);
  END IF;
  RAISE NOTICE '24 OK    aprobar activa la mascota y sella la identidad desde auth.uid()';

  BEGIN
    PERFORM public.resolver_mascota(v_m, false, 'cambio de opinión');
    RAISE EXCEPTION '25: resolvió dos veces';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '25:%' THEN RAISE; END IF; END;
  RAISE NOTICE '25 OK    sin doble resolución';

  PERFORM public.resolver_vehiculo(v_v, true, NULL, ' tg-001 ', 'rfid');
  SELECT estado, activo, tag_codigo, tag_tipo, tag_asignado_at INTO v_r FROM public.vehiculos_residentes WHERE id = v_v;
  IF v_r.estado <> 'aprobada' OR NOT v_r.activo OR v_r.tag_codigo <> 'tg-001' OR v_r.tag_tipo <> 'rfid'
     OR v_r.tag_asignado_at IS NULL THEN
    RAISE EXCEPTION '26: el vehículo aprobado quedó %', row_to_json(v_r);
  END IF;
  RAISE NOTICE '26 OK    aprobar el vehículo lo activa y le asigna el TAG de ingreso';

  -- El vehículo previo (3D) no puede tomar el mismo TAG (sin importar mayúsculas).
  BEGIN
    PERFORM public.asignar_tag_vehiculo('bb000000-0000-0000-0000-000000000001', 'TG-001', NULL);
    RAISE EXCEPTION '27: asignó un TAG que ya tiene otro vehículo';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '27:%' THEN RAISE; END IF; END;
  BEGIN
    UPDATE public.vehiculos_residentes SET tag_codigo = 'TG-001' WHERE id = 'bb000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '27: el índice dejó duplicar el TAG por escritura directa';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  RAISE NOTICE '27 OK    un TAG no se repite entre vehículos autorizados del condominio';

  SELECT count(*) INTO v_n FROM public.test_avisos
   WHERE 'e0000000-0000-0000-0000-00000000000c' = ANY(user_ids) AND seccion = 'mascotas';
  IF v_n <> 1 THEN RAISE EXCEPTION '28: el propietario no recibió el aviso de su mascota (%)', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.test_avisos
   WHERE 'e0000000-0000-0000-0000-00000000000d' = ANY(user_ids) AND seccion = 'vehiculos' AND cuerpo LIKE '%tg-001%';
  IF v_n <> 1 THEN RAISE EXCEPTION '28: el inquilino no recibió el aviso con su TAG (%)', v_n; END IF;
  RAISE NOTICE '28 OK    cada residente recibe el aviso de SU resolución (con el TAG si lo hay)';

  BEGIN
    PERFORM public.asignar_tag_vehiculo(v_v, 'X', 'chip');
    RAISE EXCEPTION '29: aceptó un tipo de TAG inválido';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '29:%' THEN RAISE; END IF; END;
  RAISE NOTICE '29 OK    tipo de TAG validado en la RPC';
END $$;
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- F · Baja, descarte y ACL
-- ─────────────────────────────────────────────────────────────────────────────
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000c', false);  -- propietario
SET ROLE authenticated;
DO $$
DECLARE
  v_v  uuid := current_setting('test.vehiculo_luis')::uuid;
  v_id uuid;
  v_ant text;
  v_n  int;
BEGIN
  -- El propietario puede dar de baja el vehículo que registró su inquilino.
  v_ant := public.portal_baja_vehiculo(v_v, 'Se fue el inquilino');
  SELECT count(*) INTO v_n FROM public.vehiculos_residentes
   WHERE id = v_v AND estado = 'baja' AND NOT activo AND notas LIKE '%Se fue el inquilino%';
  IF v_ant <> 'aprobada' OR v_n <> 1 THEN RAISE EXCEPTION '30: la baja quedó mal (%/%)', v_ant, v_n; END IF;
  BEGIN
    PERFORM public.portal_baja_vehiculo(v_v, NULL);
    RAISE EXCEPTION '30: dio de baja dos veces';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '30:%' THEN RAISE; END IF; END;
  RAISE NOTICE '30 OK    el propietario da de baja; deja la fila inactiva con el motivo';

  v_id := public.portal_reservar_vehiculo('11d10000-0000-0000-0000-000000000002');
  PERFORM public.portal_descartar_vehiculo(v_id);
  SELECT count(*) INTO v_n FROM public.vehiculos_residentes WHERE id = v_id;
  IF v_n <> 0 THEN RAISE EXCEPTION '31: descartar no borró el borrador'; END IF;
  BEGIN
    PERFORM public.portal_descartar_mascota(current_setting('test.mascota_marco')::uuid);
    RAISE EXCEPTION '31: descartó una mascota ya aprobada';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '31:%' THEN RAISE; END IF; END;
  RAISE NOTICE '31 OK    descartar borra solo borradores';
END $$;
RESET ROLE;

SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000a', false);
SET ROLE authenticated;
DO $$
DECLARE v_tag text;
BEGIN
  -- Con el vehículo dado de baja, su TAG queda libre para otro.
  PERFORM public.asignar_tag_vehiculo('bb000000-0000-0000-0000-000000000001', 'TG-001', 'sticker');
  SELECT tag_codigo INTO v_tag FROM public.vehiculos_residentes WHERE id = 'bb000000-0000-0000-0000-000000000001';
  IF v_tag <> 'TG-001' THEN RAISE EXCEPTION '32: el TAG liberado no se pudo reasignar'; END IF;
  BEGIN
    PERFORM public.asignar_tag_vehiculo(current_setting('test.vehiculo_luis')::uuid, 'OTRO', NULL);
    RAISE EXCEPTION '32: asignó TAG a un vehículo dado de baja';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE '32:%' THEN RAISE; END IF; END;
  RAISE NOTICE '32 OK    la baja libera el TAG y un vehículo no autorizado no recibe TAG';
END $$;
RESET ROLE;

DO $$
DECLARE v_f text;
BEGIN
  FOREACH v_f IN ARRAY ARRAY[
    'public.portal_reservar_mascota(uuid)', 'public.portal_enviar_mascota(uuid, jsonb, jsonb)',
    'public.portal_descartar_mascota(uuid)', 'public.portal_baja_mascota(uuid, text)',
    'public.portal_reservar_vehiculo(uuid)', 'public.portal_enviar_vehiculo(uuid, jsonb, jsonb)',
    'public.portal_descartar_vehiculo(uuid)', 'public.portal_baja_vehiculo(uuid, text)',
    'public.resolver_mascota(uuid, boolean, text)', 'public.resolver_vehiculo(uuid, boolean, text, text, text)',
    'public.asignar_tag_vehiculo(uuid, text, text)'
  ] LOOP
    IF has_function_privilege('anon', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '33: anon puede ejecutar %', v_f;
    END IF;
    IF NOT has_function_privilege('authenticated', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '33: authenticated no puede ejecutar %', v_f;
    END IF;
  END LOOP;
  RAISE NOTICE '33 OK    ACL: anon fuera, authenticated dentro (el gate está en cada RPC)';

  FOREACH v_f IN ARRAY ARRAY[
    'public.padron_validar_documentos(jsonb, text)', 'public.padron_puede_retirar(uuid, uuid)',
    'public.padron_avisar_residente(uuid, uuid, text, text, text, jsonb)'
  ] LOOP
    IF has_function_privilege('authenticated', v_f, 'EXECUTE') OR has_function_privilege('anon', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '34: el helper interno % quedó expuesto', v_f;
    END IF;
  END LOOP;
  RAISE NOTICE '34 OK    los helpers internos no son invocables desde la API';
END $$;
