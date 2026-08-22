\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de la solicitud de renta con datos, responsables y documentos.
-- Migraciones 20260828000000/100/200 y 20260829000000/100/200/300/400.
--
--    1-4   columnas y CHECK: los seis responsables, solo propietario|inquilino
--    5-9   completitud exigida por la BASE (no por React) y el caso STR
--   10-11  la notificación se dispara al ENVIAR, no al reservar el borrador
--   12-16  el portal ya no escribe la tabla: no puede autoaprobarse, y los RPC
--          validan propiedad, estado y que los documentos sean de la solicitud
--   17-21  storage: quién sube, quién no toca lo ajeno, y la inmutabilidad
--   22-28  aprobación: contrato con los seis responsables, fallo atómico, sin
--          doble resolución, histórico de contratos y ACL
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- A · Esquema, CHECK y completitud
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  CO_A  uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  P1    uuid := '11111111-0000-0000-0000-000000000001';
  U1    uuid := '11d10000-0000-0000-0000-000000000001';
  CLI   uuid := 'c11e0000-0000-0000-0000-000000000001';
  v_id  uuid;
  v_n   int;
BEGIN
  -- ── 1: los seis responsables existen en solicitud Y contrato ──────────────
  SELECT count(*) INTO v_n
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN ('solicitud_renta_unidad', 'contratos_arrendamiento')
     AND column_name IN ('resp_mantenimiento','resp_agua','resp_electricidad',
                         'resp_basura','resp_telefonia','resp_internet');
  IF v_n <> 12 THEN RAISE EXCEPTION '1: faltan columnas de responsables (encontradas %)', v_n; END IF;
  RAISE NOTICE '1  OK    los seis responsables existen en la solicitud y en el contrato';

  -- ── 2: solo 'propietario' | 'inquilino' ───────────────────────────────────
  INSERT INTO public.solicitud_renta_unidad (company_id, project_id, unidad_id, cliente_id, estado)
  VALUES (CO_A, P1, U1, CLI, 'borrador') RETURNING id INTO v_id;
  BEGIN
    UPDATE public.solicitud_renta_unidad SET resp_agua = 'municipalidad' WHERE id = v_id;
    RAISE EXCEPTION '2: aceptó un responsable desconocido';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE '2  OK    la solicitud rechaza un responsable fuera de propietario|inquilino';

  BEGIN
    INSERT INTO public.contratos_arrendamiento (
      company_id, project_id, unidad_id, arrendatario_nombre, monto_renta, fecha_inicio, resp_internet
    ) VALUES (CO_A, P1, U1, 'X', 1, '2026-09-01', 'la junta');
    RAISE EXCEPTION '3: el contrato aceptó un responsable desconocido';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE '3  OK    el contrato también lo rechaza';

  -- ── 4: un solo borrador por unidad ────────────────────────────────────────
  BEGIN
    INSERT INTO public.solicitud_renta_unidad (company_id, project_id, unidad_id, cliente_id, estado)
    VALUES (CO_A, P1, U1, CLI, 'borrador');
    RAISE EXCEPTION '4: permitió dos borradores en la misma unidad';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  RAISE NOTICE '4  OK    un borrador por unidad (reservar es idempotente)';

  -- ── 5-8: la BASE exige la completitud, no la UI ───────────────────────────
  BEGIN
    UPDATE public.solicitud_renta_unidad SET estado = 'pendiente' WHERE id = v_id;
    RAISE EXCEPTION '5: envió un arrendamiento sin ningún dato';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '5:%' THEN RAISE; END IF;
  END;
  RAISE NOTICE '5  OK    un arrendamiento sin datos no puede pasar a pendiente';

  UPDATE public.solicitud_renta_unidad
     SET arrendatario_nombre = 'Luis de la Roca', monto_renta = 5000, fecha_inicio = '2026-09-01'
   WHERE id = v_id;
  BEGIN
    UPDATE public.solicitud_renta_unidad SET estado = 'pendiente' WHERE id = v_id;
    RAISE EXCEPTION '6: envió un arrendamiento sin responsables';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '6:%' THEN RAISE; END IF;
  END;
  RAISE NOTICE '6  OK    faltando los responsables tampoco pasa';

  UPDATE public.solicitud_renta_unidad
     SET resp_mantenimiento = 'propietario', resp_agua = 'inquilino',
         resp_electricidad = 'inquilino', resp_basura = 'propietario',
         resp_telefonia = 'propietario', resp_internet = 'inquilino'
   WHERE id = v_id;
  UPDATE public.solicitud_renta_unidad SET estado = 'pendiente' WHERE id = v_id;
  RAISE NOTICE '7  OK    con datos y responsables completos, pasa';

  -- STR no necesita nada de eso.
  DELETE FROM public.solicitud_renta_unidad WHERE id = v_id;
  INSERT INTO public.solicitud_renta_unidad (company_id, project_id, unidad_id, cliente_id, tipo_renta, estado)
  VALUES (CO_A, P1, U1, CLI, 'str', 'pendiente') RETURNING id INTO v_id;
  RAISE NOTICE '8  OK    STR sigue funcionando sin datos contractuales';

  -- ── 9: el monto no puede ser negativo ─────────────────────────────────────
  BEGIN
    UPDATE public.solicitud_renta_unidad SET monto_renta = -1 WHERE id = v_id;
    RAISE EXCEPTION '9: aceptó un monto negativo';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE '9  OK    el monto de renta no admite negativos';

  DELETE FROM public.solicitud_renta_unidad WHERE unidad_id = U1;
  DELETE FROM public.test_notificaciones;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B · El portal: sin escritura directa, todo por RPC
-- ─────────────────────────────────────────────────────────────────────────────
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000c', false);  -- propietario
SET ROLE authenticated;

DO $$
DECLARE
  CO_A uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  P1   uuid := '11111111-0000-0000-0000-000000000001';
  U1   uuid := '11d10000-0000-0000-0000-000000000001';
  CLI  uuid := 'c11e0000-0000-0000-0000-000000000001';
  v_id  uuid;
  v_id2 uuid;
  v_n   int;
BEGIN
  -- ── 10: el agujero de autoaprobación, cerrado ─────────────────────────────
  -- Antes de 20260829000100 esto insertaba una fila 'aprobada' y le abría al
  -- residente contratos_arrendamiento y reservas_str de su unidad.
  -- La fila va COMPLETA a propósito: así el trigger de completitud no la frena
  -- y lo único que puede pararla es la RLS, que es lo que se está probando.
  BEGIN
    INSERT INTO public.solicitud_renta_unidad (
      company_id, project_id, unidad_id, cliente_id, estado, tipo_aprobado,
      arrendatario_nombre, monto_renta, fecha_inicio,
      resp_mantenimiento, resp_agua, resp_electricidad, resp_basura, resp_telefonia, resp_internet
    ) VALUES (
      CO_A, P1, U1, CLI, 'aprobada', 'ambas',
      'Yo Mismo', 1, '2026-09-01',
      'propietario','propietario','propietario','propietario','propietario','propietario'
    );
    RAISE EXCEPTION '10: el propietario se autoaprobó una solicitud';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE '10 OK    el portal no puede insertar (ni autoaprobarse) en la tabla';

  -- ── 11-12: reservar es idempotente y no notifica todavía ──────────────────
  v_id := public.portal_reservar_solicitud_renta(U1);
  IF v_id IS NULL THEN RAISE EXCEPTION '11: no devolvió el borrador'; END IF;
  v_id2 := public.portal_reservar_solicitud_renta(U1);
  IF v_id2 <> v_id THEN RAISE EXCEPTION '11: reservar dos veces creó otro borrador'; END IF;
  RAISE NOTICE '11 OK    reservar devuelve siempre el mismo borrador';

  SELECT count(*) INTO v_n FROM public.test_notificaciones;
  IF v_n <> 0 THEN RAISE EXCEPTION '12: notificó al staff de un borrador'; END IF;
  RAISE NOTICE '12 OK    reservar el borrador NO avisa a la administración';

  -- ── 13: los documentos deben ser de ESTA solicitud ────────────────────────
  BEGIN
    PERFORM public.portal_enviar_solicitud_renta(
      v_id, 'arrendamiento', 'Renta anual', 'Luis de la Roca', '4545656565', NULL, NULL,
      5000, 5000, 5, '2026-09-01', '2027-09-01', NULL,
      '{"mantenimiento":"propietario","agua":"inquilino","electricidad":"inquilino","basura":"propietario","telefonia":"propietario","internet":"inquilino"}'::jsonb,
      ('[{"path":"' || U1::text || '/00000000-0000-0000-0000-000000000999/otro.pdf","nombre":"otro.pdf"}]')::jsonb
    );
    RAISE EXCEPTION '13: aceptó un documento de otra solicitud';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '13:%' THEN RAISE; END IF;
  END;
  RAISE NOTICE '13 OK    un documento fuera de la carpeta de la solicitud se rechaza';

  -- ── 14: responsable inválido, rechazado por el RPC con su nombre ──────────
  BEGIN
    PERFORM public.portal_enviar_solicitud_renta(
      v_id, 'arrendamiento', NULL, 'Luis de la Roca', NULL, NULL, NULL,
      5000, NULL, 5, '2026-09-01', NULL, NULL,
      '{"mantenimiento":"propietario","agua":"municipalidad","electricidad":"inquilino","basura":"propietario","telefonia":"propietario","internet":"inquilino"}'::jsonb,
      '[]'::jsonb
    );
    RAISE EXCEPTION '14: aceptó un responsable desconocido';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '14:%' THEN RAISE; END IF;
  END;
  RAISE NOTICE '14 OK    el RPC nombra el servicio con el responsable inválido';
END $$;

RESET ROLE;

-- ── 15: el inquilino no reserva solicitudes en la unidad que habita ─────────
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', false);  -- inquilino
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.portal_reservar_solicitud_renta('11d10000-0000-0000-0000-000000000001');
    RAISE EXCEPTION '15: el inquilino reservó una solicitud de renta';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '15:%' THEN RAISE; END IF;
  END;
  RAISE NOTICE '15 OK    el inquilino no puede iniciar la solicitud (no es propietario)';
END $$;
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- C · Storage: quién escribe el expediente y hasta cuándo
-- ─────────────────────────────────────────────────────────────────────────────
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000c', false);  -- propietario
SET ROLE authenticated;
DO $$
DECLARE
  U1   uuid := '11d10000-0000-0000-0000-000000000001';
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.solicitud_renta_unidad WHERE unidad_id = U1 AND estado = 'borrador';

  -- ── 16: sube en la carpeta de SU borrador ─────────────────────────────────
  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('renta-docs', U1::text || '/' || v_id::text || '/contrato.pdf');
  RAISE NOTICE '16 OK    el propietario sube dentro de {unidad}/{solicitud}/';

  -- ── 17: no puede colgar archivos de una solicitud inexistente ─────────────
  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('renta-docs', U1::text || '/00000000-0000-0000-0000-000000000999/suelto.pdf');
    RAISE EXCEPTION '17: subió a una carpeta sin solicitud';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE '17 OK    sin solicitud detrás, la carpeta no acepta archivos';
END $$;
RESET ROLE;

-- ── 18: el inquilino no toca los documentos del propietario ─────────────────
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', false);
SET ROLE authenticated;
DO $$
DECLARE v_n int;
BEGIN
  DELETE FROM storage.objects WHERE bucket_id = 'renta-docs';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN RAISE EXCEPTION '18: el inquilino borró % documento(s) del propietario', v_n; END IF;

  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'renta-docs';
  IF v_n > 0 THEN RAISE EXCEPTION '18: el inquilino puede LEER el expediente del propietario'; END IF;
  RAISE NOTICE '18 OK    el inquilino no borra ni lee los documentos del propietario';
END $$;
RESET ROLE;

-- ── 19: otra empresa tampoco los ve ────────────────────────────────────────
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000b', false);
SET ROLE authenticated;
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'renta-docs';
  IF v_n > 0 THEN RAISE EXCEPTION '19: un admin de otra empresa lee el expediente'; END IF;
  RAISE NOTICE '19 OK    los documentos no cruzan empresas';
END $$;
RESET ROLE;

-- ── 20: la administración de la empresa SÍ los lee ─────────────────────────
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000a', false);
SET ROLE authenticated;
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'renta-docs';
  IF v_n <> 1 THEN RAISE EXCEPTION '20: la administración no ve el documento (vio %)', v_n; END IF;
  RAISE NOTICE '20 OK    la administración autorizada sí los lee';
END $$;
RESET ROLE;

-- ── 21: al enviarse la solicitud, los documentos quedan inmutables ──────────
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000c', false);
SET ROLE authenticated;
DO $$
DECLARE
  U1   uuid := '11d10000-0000-0000-0000-000000000001';
  v_id uuid;
  v_n  int;
BEGIN
  SELECT id INTO v_id FROM public.solicitud_renta_unidad WHERE unidad_id = U1 AND estado = 'borrador';

  PERFORM public.portal_enviar_solicitud_renta(
    v_id, 'arrendamiento', 'Renta anual', 'Luis de la Roca', '4545656565', '+502 5555-5555', 'luis@ejemplo.com',
    5000, 5000, 5, '2026-09-01', '2027-09-01', 'Sin mascotas',
    '{"mantenimiento":"propietario","agua":"inquilino","electricidad":"inquilino","basura":"propietario","telefonia":"propietario","internet":"inquilino"}'::jsonb,
    ('[{"path":"' || U1::text || '/' || v_id::text || '/contrato.pdf","nombre":"contrato.pdf","etiqueta":"Contrato firmado"}]')::jsonb
  );

  DELETE FROM storage.objects WHERE bucket_id = 'renta-docs';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN RAISE EXCEPTION '21: los documentos siguen borrables tras enviar'; END IF;
  RAISE NOTICE '21 OK    enviada la solicitud, ni el propietario puede alterar sus documentos';

  SELECT count(*) INTO v_n FROM public.test_notificaciones;
  IF v_n <> 1 THEN RAISE EXCEPTION '22: la notificación no salió al enviar (salieron %)', v_n; END IF;
  RAISE NOTICE '22 OK    la administración se entera al ENVIAR, no antes';
END $$;
RESET ROLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- D · Aprobación, contrato e histórico
-- ─────────────────────────────────────────────────────────────────────────────
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000a', false);  -- admin de la empresa

DO $$
DECLARE
  CO_A  uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  P1    uuid := '11111111-0000-0000-0000-000000000001';
  U1    uuid := '11d10000-0000-0000-0000-000000000001';
  U2    uuid := '11d10000-0000-0000-0000-000000000002';
  CLI   uuid := 'c11e0000-0000-0000-0000-000000000001';
  ADMIN uuid := 'e0000000-0000-0000-0000-00000000000a';
  AJENO uuid := 'e0000000-0000-0000-0000-00000000000b';
  v_sol uuid;
  v_ant_id uuid;
  v_res jsonb;
  v_con public.contratos_arrendamiento%ROWTYPE;
  v_vie public.contratos_arrendamiento%ROWTYPE;
  v_n   int;
BEGIN
  SELECT id INTO v_sol FROM public.solicitud_renta_unidad WHERE unidad_id = U1 AND estado = 'pendiente';

  -- ── 23: aprobar crea el contrato con TODO copiado ─────────────────────────
  v_res := public.aprobar_solicitud_renta(v_sol, 'arrendamiento', 'Todo en orden', true, NULL);
  IF NOT (v_res->>'contrato_creado')::boolean THEN RAISE EXCEPTION '23: no creó el contrato'; END IF;

  SELECT * INTO v_con FROM public.contratos_arrendamiento WHERE id = (v_res->>'contrato_id')::uuid;
  IF v_con.arrendatario_nombre <> 'Luis de la Roca' OR v_con.monto_renta <> 5000
     OR v_con.dia_pago <> 5 OR v_con.deposito <> 5000
     OR v_con.fecha_inicio <> DATE '2026-09-01' OR v_con.fecha_fin <> DATE '2027-09-01'
     OR v_con.estado <> 'activo' OR v_con.notas <> 'Sin mascotas' THEN
    RAISE EXCEPTION '23: el contrato no copió los datos (%)', to_jsonb(v_con);
  END IF;
  RAISE NOTICE '23 OK    el contrato copia arrendatario, montos, plazo y notas';

  -- ── 24: los seis responsables, exactos ────────────────────────────────────
  IF v_con.resp_mantenimiento <> 'propietario' OR v_con.resp_agua <> 'inquilino'
     OR v_con.resp_electricidad <> 'inquilino' OR v_con.resp_basura <> 'propietario'
     OR v_con.resp_telefonia <> 'propietario' OR v_con.resp_internet <> 'inquilino' THEN
    RAISE EXCEPTION '24: los responsables no llegaron exactos (%)', to_jsonb(v_con);
  END IF;
  RAISE NOTICE '24 OK    los seis responsables viajan exactos de la solicitud al contrato';

  PERFORM 1 FROM public.solicitud_renta_unidad
   WHERE id = v_sol AND estado = 'aprobada' AND contrato_id = v_con.id
     AND aprobado_por_user_id = ADMIN AND aprobado_por = 'Admin Uno';
  IF NOT FOUND THEN RAISE EXCEPTION '25: la solicitud no quedó enlazada ni auditada'; END IF;
  RAISE NOTICE '25 OK    queda enlazada y firmada con la identidad del servidor';

  -- ── 26: no se resuelve dos veces ──────────────────────────────────────────
  BEGIN
    v_res := public.aprobar_solicitud_renta(v_sol, 'arrendamiento', NULL, true, NULL);
    RAISE EXCEPTION '26: aprobó una solicitud ya resuelta';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '26:%' THEN RAISE; END IF;
  END;
  RAISE NOTICE '26 OK    una solicitud ya resuelta no se re-aprueba';

  -- ── 27: datos incompletos ⇒ falla ENTERA, no aprueba a medias ─────────────
  -- Una solicitud HEREDADA: pendiente, de arrendamiento y sin datos, como las
  -- que ya existían antes de esta feature. Se crea con el trigger de
  -- completitud apagado porque esas filas nacieron cuando no existía.
  ALTER TABLE public.solicitud_renta_unidad DISABLE TRIGGER trg_validar_solicitud_renta;
  INSERT INTO public.solicitud_renta_unidad (company_id, project_id, unidad_id, cliente_id, tipo_renta, estado)
  VALUES (CO_A, P1, U2, CLI, 'arrendamiento', 'pendiente') RETURNING id INTO v_sol;
  ALTER TABLE public.solicitud_renta_unidad ENABLE TRIGGER trg_validar_solicitud_renta;

  BEGIN
    v_res := public.aprobar_solicitud_renta(v_sol, 'arrendamiento', NULL, true, NULL);
    RAISE EXCEPTION '27: aprobó pidiendo contrato sin tener los datos';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '27:%' THEN RAISE; END IF;
  END;
  PERFORM 1 FROM public.solicitud_renta_unidad WHERE id = v_sol AND estado = 'pendiente';
  IF NOT FOUND THEN RAISE EXCEPTION '27: la solicitud quedó tocada pese al fallo'; END IF;
  RAISE NOTICE '27 OK    si el contrato no se puede crear, la solicitud NO queda aprobada';

  -- ── 28: aprobar sin contrato exige justificación ──────────────────────────
  BEGIN
    v_res := public.aprobar_solicitud_renta(v_sol, 'arrendamiento', NULL, false, NULL);
    RAISE EXCEPTION '28: aprobó sin contrato y sin justificar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '28:%' THEN RAISE; END IF;
  END;
  v_res := public.aprobar_solicitud_renta(v_sol, 'arrendamiento', NULL, false, 'Solicitud heredada');
  IF (v_res->>'contrato_creado')::boolean THEN RAISE EXCEPTION '28: creó contrato pese al false'; END IF;
  PERFORM 1 FROM public.solicitud_renta_unidad
   WHERE id = v_sol AND estado = 'aprobada' AND motivo_sin_contrato = 'Solicitud heredada';
  IF NOT FOUND THEN RAISE EXCEPTION '28: no guardó la justificación'; END IF;
  RAISE NOTICE '28 OK    aprobar sin contrato exige justificación y la guarda';

  -- ── 29: cambio de inquilino — el histórico se conserva ────────────────────
  UPDATE public.solicitud_renta_unidad SET estado = 'baja' WHERE unidad_id = U1;
  INSERT INTO public.solicitud_renta_unidad (
    company_id, project_id, unidad_id, cliente_id, tipo_renta, estado,
    arrendatario_nombre, monto_renta, deposito, dia_pago, fecha_inicio, fecha_fin,
    resp_mantenimiento, resp_agua, resp_electricidad, resp_basura, resp_telefonia, resp_internet
  ) VALUES (
    CO_A, P1, U1, CLI, 'arrendamiento', 'pendiente',
    'Ana Pérez', 7000, 7000, 1, '2027-10-01', '2028-10-01',
    'inquilino', 'propietario', 'propietario', 'inquilino', 'inquilino', 'propietario'
  ) RETURNING id INTO v_sol;

  v_res := public.aprobar_solicitud_renta(v_sol, 'arrendamiento', NULL, true, NULL);
  IF (v_res->>'contrato_anterior_terminado') IS NULL THEN
    RAISE EXCEPTION '29: no cerró el contrato anterior';
  END IF;

  SELECT * INTO v_vie FROM public.contratos_arrendamiento WHERE id = v_con.id;
  SELECT * INTO v_con FROM public.contratos_arrendamiento WHERE id = (v_res->>'contrato_id')::uuid;

  -- El viejo conserva SUS fechas, montos y responsables; solo cambió de estado.
  IF v_vie.estado <> 'terminado' OR v_vie.monto_renta <> 5000
     OR v_vie.fecha_inicio <> DATE '2026-09-01' OR v_vie.fecha_fin <> DATE '2027-09-01'
     OR v_vie.resp_agua <> 'inquilino' OR v_vie.resp_mantenimiento <> 'propietario' THEN
    RAISE EXCEPTION '29: el contrato anterior se alteró (%)', to_jsonb(v_vie);
  END IF;
  IF v_con.estado <> 'activo' OR v_con.monto_renta <> 7000
     OR v_con.fecha_inicio <> DATE '2027-10-01'
     OR v_con.resp_agua <> 'propietario' OR v_con.resp_mantenimiento <> 'inquilino' THEN
    RAISE EXCEPTION '29: el contrato nuevo no es independiente (%)', to_jsonb(v_con);
  END IF;
  RAISE NOTICE '29 OK    dos contratos sucesivos, cada uno con sus fechas y responsables';

  SELECT count(*) INTO v_n FROM public.contratos_arrendamiento
   WHERE unidad_id = U1 AND estado = 'activo';
  IF v_n <> 1 THEN RAISE EXCEPTION '30: la unidad quedó con % contratos activos', v_n; END IF;
  RAISE NOTICE '30 OK    la unidad conserva exactamente un contrato activo';

  -- ── 31: ACL de la aprobación ──────────────────────────────────────────────
  INSERT INTO public.solicitud_renta_unidad (company_id, project_id, unidad_id, cliente_id, tipo_renta, estado)
  VALUES (CO_A, P1, '11d10000-0000-0000-0000-000000000003', CLI, 'str', 'pendiente') RETURNING id INTO v_sol;

  PERFORM set_config('app.uid', AJENO::text, true);
  BEGIN
    v_res := public.aprobar_solicitud_renta(v_sol, 'str', NULL, false, NULL);
    RAISE EXCEPTION '31: un admin de otra empresa resolvió la solicitud';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '31:%' THEN RAISE; END IF;
  END;
  RAISE NOTICE '31 OK    la resolución no cruza empresas';

  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000c', true);
  BEGIN
    v_res := public.aprobar_solicitud_renta(v_sol, 'str', NULL, false, NULL);
    RAISE EXCEPTION '32: el propietario aprobó su propia solicitud';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '32:%' THEN RAISE; END IF;
  END;
  RAISE NOTICE '32 OK    el propietario tampoco se aprueba vía RPC';

  -- ── 33: salida anticipada — el plazo viejo se RECORTA, no se conserva ─────
  -- El contrato vigente termina en 2030 y el inquilino nuevo entra en 2028. Con
  -- COALESCE (20260829000300) la fecha_fin de 2030 sobrevivía y la unidad
  -- quedaba con dos plazos solapados; con LEAST (20260829000500) se recorta.
  PERFORM set_config('app.uid', ADMIN::text, true);
  UPDATE public.solicitud_renta_unidad SET estado = 'baja' WHERE unidad_id = U2;
  INSERT INTO public.contratos_arrendamiento (
    company_id, project_id, unidad_id, arrendatario_nombre, monto_renta,
    fecha_inicio, fecha_fin, estado
  ) VALUES (
    CO_A, P1, U2, 'Inquilino Saliente', 3000, '2026-01-01', '2030-01-01', 'activo'
  ) RETURNING id INTO v_ant_id;

  INSERT INTO public.solicitud_renta_unidad (
    company_id, project_id, unidad_id, cliente_id, tipo_renta, estado,
    arrendatario_nombre, monto_renta, dia_pago, fecha_inicio,
    resp_mantenimiento, resp_agua, resp_electricidad, resp_basura, resp_telefonia, resp_internet
  ) VALUES (
    CO_A, P1, U2, CLI, 'arrendamiento', 'pendiente',
    'Inquilino Entrante', 4000, 1, '2028-01-01',
    'propietario','propietario','propietario','propietario','propietario','propietario'
  ) RETURNING id INTO v_sol;

  v_res := public.aprobar_solicitud_renta(v_sol, 'arrendamiento', NULL, true, NULL);

  SELECT * INTO v_vie FROM public.contratos_arrendamiento WHERE id = v_ant_id;
  SELECT * INTO v_con FROM public.contratos_arrendamiento WHERE id = (v_res->>'contrato_id')::uuid;

  IF v_vie.fecha_fin <> DATE '2027-12-31' THEN
    RAISE EXCEPTION '33: el plazo viejo no se recortó (fecha_fin = %)', v_vie.fecha_fin;
  END IF;
  IF v_vie.fecha_fin >= v_con.fecha_inicio THEN
    RAISE EXCEPTION '33: los plazos se solapan (viejo hasta %, nuevo desde %)',
      v_vie.fecha_fin, v_con.fecha_inicio;
  END IF;
  -- Y no al revés: el recorte no puede adelantar la fecha por debajo del inicio
  -- del propio contrato viejo.
  IF v_vie.fecha_fin < v_vie.fecha_inicio THEN
    RAISE EXCEPTION '33: el recorte dejó un plazo invertido (% → %)', v_vie.fecha_inicio, v_vie.fecha_fin;
  END IF;
  RAISE NOTICE '33 OK    con salida anticipada el plazo viejo se recorta y no hay traslape';

  -- Un contrato que YA terminaba antes conserva su fecha: el recorte es un
  -- techo, no una reescritura.
  UPDATE public.solicitud_renta_unidad SET estado = 'baja' WHERE unidad_id = U2;
  UPDATE public.contratos_arrendamiento
     SET estado = 'activo', fecha_fin = '2028-06-30'
   WHERE id = v_con.id;
  INSERT INTO public.solicitud_renta_unidad (
    company_id, project_id, unidad_id, cliente_id, tipo_renta, estado,
    arrendatario_nombre, monto_renta, dia_pago, fecha_inicio,
    resp_mantenimiento, resp_agua, resp_electricidad, resp_basura, resp_telefonia, resp_internet
  ) VALUES (
    CO_A, P1, U2, CLI, 'arrendamiento', 'pendiente',
    'Tercer Inquilino', 4500, 1, '2029-01-01',
    'propietario','propietario','propietario','propietario','propietario','propietario'
  ) RETURNING id INTO v_sol;

  v_res := public.aprobar_solicitud_renta(v_sol, 'arrendamiento', NULL, true, NULL);
  SELECT * INTO v_vie FROM public.contratos_arrendamiento WHERE id = v_con.id;
  IF v_vie.fecha_fin <> DATE '2028-06-30' THEN
    RAISE EXCEPTION '34: pisó la fecha_fin de un contrato que ya terminaba antes (%)', v_vie.fecha_fin;
  END IF;
  RAISE NOTICE '34 OK    si ya terminaba antes, su fecha se respeta';

  SELECT count(*) INTO v_n FROM public.contratos_arrendamiento
   WHERE unidad_id = U2 AND estado = 'activo';
  IF v_n <> 1 THEN RAISE EXCEPTION '35: la unidad quedó con % contratos activos', v_n; END IF;
  RAISE NOTICE '35 OK    tras tres contratos sucesivos sigue habiendo uno solo activo';
END $$;

-- ── 33: la ACL de las funciones ────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.aprobar_solicitud_renta(uuid,text,text,boolean,text)',
    'public.portal_reservar_solicitud_renta(uuid)',
    'public.portal_descartar_solicitud_renta(uuid)'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') THEN
      RAISE EXCEPTION '36: anon puede ejecutar %', f;
    END IF;
    IF NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '36: authenticated no puede ejecutar %', f;
    END IF;
  END LOOP;
  RAISE NOTICE '36 OK    anon revocado y authenticated habilitado en los RPC';
END $$;
