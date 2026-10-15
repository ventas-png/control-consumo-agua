-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261031000000_housekeeping_flujo_reserva_y_avisos, ejercidas COMO
-- cada persona (JWT emulado + rol authenticated/anon/service_role).
--   A · reserva vinculada: resumen sellado por la base, unidad heredada, rechazos (otro
--       proyecto, otra empresa, cancelada, inexistente, unidad distinta), desvincular a
--       mano borra el resumen, borrar la reserva lo conserva, mover de proyecto
--   B · fase «inconvenientes»: 20 por fase, fase inválida, cupo de Storage 89/90
--   C · transiciones: operador no salta ni reabre; dueño/admin sí; cancelado; service_role;
--       un salto inválido nunca sella
--   D · avisos al asignar: campana + correo, una vez por clave, sin correo → sólo campana,
--       autoasignación no avisa, en_proceso no avisa, outbox roto no bloquea
--   E · recordatorio previo: ventana en la zona del tenant, idempotente, sin hora → 08:00,
--       en_proceso no, ventana configurable, sólo service_role
--   F · informe: dueño/admin CON acceso al proyecto, correo extra, rechazos, sellos,
--       horas dedicadas, HTML escapado, reserva y fotos en el cuerpo
--   G · catálogo hk_reservas_vinculables: sólo vigentes, orden, sin permiso STR, rechazos
--   H · inventario: triggers y su orden, ACL, plantillas, cron, CHECK, policy de Storage
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\i ../housekeeping_evidencias/lib.sql

-- Lecturas del outbox y del log como la base (DEFINER) para poder preguntar siendo
-- `authenticated`, que no ve ninguna de las dos tablas.
CREATE OR REPLACE FUNCTION hkt.avisos(p_sv uuid, p_canal text, p_tipo text, p_dest text DEFAULT NULL) RETURNS integer
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*)::int FROM public.notifications_outbox
   WHERE channel = p_canal AND payload->>'servicio_id' = p_sv::text
     AND COALESCE(template_key, payload->>'tipo') = p_tipo
     AND (p_dest IS NULL OR recipient = p_dest) $$;
CREATE OR REPLACE FUNCTION hkt.aviso(p_sv uuid, p_canal text, p_tipo text, p_dest text DEFAULT NULL) RETURNS public.notifications_outbox
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.notifications_outbox
   WHERE channel = p_canal AND payload->>'servicio_id' = p_sv::text
     AND COALESCE(template_key, payload->>'tipo') = p_tipo
     AND (p_dest IS NULL OR recipient = p_dest)
   LIMIT 1 $$;
CREATE OR REPLACE FUNCTION hkt.log_n(p_sv uuid, p_hito text) RETURNS integer
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*)::int FROM public.hk_recordatorios_log WHERE servicio_id = p_sv AND hito = p_hito $$;
CREATE OR REPLACE FUNCTION hkt.servicio(p_sv uuid) RETURNS public.servicios_housekeeping
LANGUAGE sql SECURITY DEFINER AS $$ SELECT * FROM public.servicios_housekeeping WHERE id = p_sv $$;
CREATE OR REPLACE FUNCTION hkt.mismo_conjunto(p_json jsonb, p_arr text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT (SELECT array_agg(x) FROM jsonb_array_elements_text(p_json) x) @> p_arr
     AND p_arr @> (SELECT array_agg(x) FROM jsonb_array_elements_text(p_json) x)
     AND jsonb_array_length(p_json) = cardinality(p_arr) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;

-- ── A · reserva vinculada ───────────────────────────────────────────────────
DO $$
DECLARE r public.servicios_housekeeping; msg text;
BEGIN
  PERFORM hkt.como(hkt.uid(1));
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, fecha, reserva_str_id, reserva_str_resumen)
    VALUES (hkt.sv(1), hkt.ca(), hkt.pa1(), '2026-11-10', hkt.rs(1), '{"codigo_confirmacion":"FALSO"}');
  r := hkt.servicio(hkt.sv(1));
  PERFORM hkt.ok('A1 vincular sin unidad hereda la unidad de la reserva', r.unidad_id = hkt.un(1));
  PERFORM hkt.ok('A2 el resumen lo sella la base (el del cliente se ignora): código, huésped, fechas, estado, id',
    r.reserva_str_resumen->>'codigo_confirmacion' = 'HM-001' AND r.reserva_str_resumen->>'huesped_nombre' = 'Ana Pérez'
    AND (r.reserva_str_resumen->>'reserva_id')::uuid = hkt.rs(1) AND r.reserva_str_resumen ? 'vinculado_en'
    AND r.reserva_str_resumen->>'estado' = 'en_curso' AND r.reserva_str_resumen->>'fecha_entrada' = '2026-11-08'
    AND r.reserva_str_resumen->>'hora_llegada_estimada' = '15:00:00' AND r.reserva_str_resumen->>'plataforma' = 'airbnb'
    AND (r.reserva_str_resumen->>'unidad_id')::uuid = hkt.un(1));

  msg := hkt.mensaje_de(format($f$INSERT INTO public.servicios_housekeeping (company_id, project_id, reserva_str_id, unidad_id) VALUES (%L, %L, %L, %L)$f$,
    hkt.ca(), hkt.pa1(), hkt.rs(1), hkt.un(2)));
  PERFORM hkt.ok('A3 unidad distinta de la de la reserva → HK_RESERVA_UNIDAD_DISTINTA', msg LIKE 'HK_RESERVA_UNIDAD_DISTINTA%');
  PERFORM hkt.ok('A3b … con SQLSTATE 23514', hkt.estado_de(format($f$INSERT INTO public.servicios_housekeeping (company_id, project_id, reserva_str_id, unidad_id) VALUES (%L, %L, %L, %L)$f$,
    hkt.ca(), hkt.pa1(), hkt.rs(1), hkt.un(2))) = '23514');
  msg := hkt.mensaje_de(format($f$INSERT INTO public.servicios_housekeeping (company_id, project_id, reserva_str_id) VALUES (%L, %L, %L)$f$, hkt.ca(), hkt.pa1(), hkt.rs(5)));
  PERFORM hkt.ok('A4 reserva de OTRO proyecto de la empresa → HK_RESERVA_FUERA_DE_ALCANCE', msg LIKE 'HK_RESERVA_FUERA_DE_ALCANCE%');
  msg := hkt.mensaje_de(format($f$INSERT INTO public.servicios_housekeeping (company_id, project_id, reserva_str_id) VALUES (%L, %L, %L)$f$, hkt.ca(), hkt.pa1(), hkt.rs(6)));
  PERFORM hkt.ok('A5 reserva de OTRA empresa → HK_RESERVA_FUERA_DE_ALCANCE', msg LIKE 'HK_RESERVA_FUERA_DE_ALCANCE%');
  msg := hkt.mensaje_de(format($f$INSERT INTO public.servicios_housekeeping (company_id, project_id, reserva_str_id) VALUES (%L, %L, %L)$f$, hkt.ca(), hkt.pa1(), hkt.rs(3)));
  PERFORM hkt.ok('A6 reserva cancelada → HK_RESERVA_CANCELADA', msg LIKE 'HK_RESERVA_CANCELADA%');
  msg := hkt.mensaje_de(format($f$INSERT INTO public.servicios_housekeeping (company_id, project_id, reserva_str_id) VALUES (%L, %L, %L)$f$, hkt.ca(), hkt.pa1(), gen_random_uuid()));
  PERFORM hkt.ok('A7 reserva inexistente → HK_RESERVA_FUERA_DE_ALCANCE', msg LIKE 'HK_RESERVA_FUERA_DE_ALCANCE%');

  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, reserva_str_id, unidad_id) VALUES (hkt.sv(2), hkt.ca(), hkt.pa1(), hkt.rs(7), hkt.un(2));
  r := hkt.servicio(hkt.sv(2));
  PERFORM hkt.ok('A8 reserva sin unidad: el servicio conserva la suya y el resumen va sin unidad',
    r.unidad_id = hkt.un(2) AND r.reserva_str_resumen->>'codigo_confirmacion' = 'HM-007' AND r.reserva_str_resumen->>'unidad_id' IS NULL);

  UPDATE public.servicios_housekeeping SET reserva_str_resumen = '{"codigo_confirmacion":"PIRATA"}' WHERE id = hkt.sv(1);
  PERFORM hkt.ok('A9 un UPDATE del resumen sin cambiar la reserva no lo altera', (hkt.servicio(hkt.sv(1))).reserva_str_resumen->>'codigo_confirmacion' = 'HM-001');
  PERFORM hkt.ok('A10 cambiar la unidad de un servicio vinculado a otra distinta → 23514',
    hkt.estado_de(format($f$UPDATE public.servicios_housekeeping SET unidad_id = %L WHERE id = %L$f$, hkt.un(2), hkt.sv(1))) = '23514');
  UPDATE public.servicios_housekeeping SET unidad_id = hkt.un(1), notas = 'misma unidad' WHERE id = hkt.sv(1);
  PERFORM hkt.ok('A10b … a la misma unidad sí', (hkt.servicio(hkt.sv(1))).notas = 'misma unidad');

  PERFORM hkt.ok('A11 re-vincular a una reserva de otra unidad sin cambiar la unidad → 23514',
    hkt.estado_de(format($f$UPDATE public.servicios_housekeeping SET reserva_str_id = %L WHERE id = %L$f$, hkt.rs(2), hkt.sv(1))) = '23514');
  UPDATE public.servicios_housekeeping SET reserva_str_id = hkt.rs(2), unidad_id = hkt.un(2) WHERE id = hkt.sv(1);
  PERFORM hkt.ok('A11b re-vincular cambiando también la unidad: resumen nuevo', (hkt.servicio(hkt.sv(1))).reserva_str_resumen->>'codigo_confirmacion' = 'HM-002');

  UPDATE public.servicios_housekeeping SET reserva_str_id = NULL WHERE id = hkt.sv(2);
  r := hkt.servicio(hkt.sv(2));
  PERFORM hkt.ok('A12 desvincular a mano (la reserva sigue viva) borra el resumen', r.reserva_str_id IS NULL AND r.reserva_str_resumen IS NULL);

  PERFORM hkt.root();
  INSERT INTO public.reservas_str (id, company_id, project_id, unidad_id, huesped_nombre, fecha_entrada, fecha_salida, estado, codigo_confirmacion)
    VALUES (hkt.rs(8), hkt.ca(), hkt.pa1(), hkt.un(1), 'Temporal', '2026-12-10', '2026-12-12', 'confirmada', 'HM-008');
  PERFORM hkt.como(hkt.uid(1));
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, reserva_str_id) VALUES (hkt.sv(3), hkt.ca(), hkt.pa1(), hkt.rs(8));
  PERFORM hkt.root();
  DELETE FROM public.reservas_str WHERE id = hkt.rs(8);
  r := hkt.servicio(hkt.sv(3));
  PERFORM hkt.ok('A13 borrar la reserva deja reserva_str_id NULL y CONSERVA el resumen (historial)',
    r.reserva_str_id IS NULL AND r.reserva_str_resumen->>'codigo_confirmacion' = 'HM-008' AND r.unidad_id = hkt.un(1));

  PERFORM hkt.como(hkt.uid(1));
  PERFORM hkt.ok('A14 mover un servicio vinculado a otro proyecto → 23514 (la reserva ya no es del proyecto)',
    hkt.estado_de(format($f$UPDATE public.servicios_housekeeping SET project_id = %L WHERE id = %L$f$, hkt.pa2(), hkt.sv(1))) = '23514');

  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, reserva_str_id) VALUES (hkt.sv(4), hkt.ca(), hkt.pa1(), hkt.rs(1));
  PERFORM hkt.ok('A15 un operador SIN permiso de STR puede vincular (la base lee la reserva por él) y hereda la unidad',
    (hkt.servicio(hkt.sv(4))).unidad_id = hkt.un(1) AND (hkt.servicio(hkt.sv(4))).reserva_str_resumen->>'codigo_confirmacion' = 'HM-001');
  PERFORM hkt.ok('A15b … y sigue sin poder leer reservas_str directamente', (SELECT count(*) FROM public.reservas_str) = 0);
  PERFORM hkt.root();
END $$;

-- ── B · fase «inconvenientes» y cupo de Storage ─────────────────────────────
DO $$
DECLARE i int; n int := 0;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, unidad_id) VALUES (hkt.sv(5), hkt.ca(), hkt.pa1(), hkt.un(1));
  FOR i IN 1..20 LOOP
    INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (hkt.sv(5), 'inconvenientes', hkt.ruta(hkt.pa1(), 5, 'inc' || i || '.jpg'));
  END LOOP;
  PERFORM hkt.ok('B1 la fase «inconvenientes» admite 20 fotos', (SELECT count(*) FROM public.servicio_housekeeping_fotos WHERE servicio_id = hkt.sv(5) AND fase = 'inconvenientes') = 20);
  PERFORM hkt.ok('B2 la foto 21 de la fase → 23514',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (%L, 'inconvenientes', %L)$f$, hkt.sv(5), hkt.ruta(hkt.pa1(), 5, 'inc21.jpg'))) = '23514');
  PERFORM hkt.ok('B3 las otras fases siguen con su cupo propio',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (%L, 'ingreso', %L)$f$, hkt.sv(5), hkt.ruta(hkt.pa1(), 5, 'in1.jpg'))) = 'SIN_ERROR'
    AND hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (%L, 'cierre', %L)$f$, hkt.sv(5), hkt.ruta(hkt.pa1(), 5, 'ci1.jpg'))) = 'SIN_ERROR');
  PERFORM hkt.ok('B4 una fase inventada → 23514 (CHECK)',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (%L, 'otra', %L)$f$, hkt.sv(5), hkt.ruta(hkt.pa1(), 5, 'x.jpg'))) = '23514');
  -- Storage: 90 objetos del servicio caben; el 91 no (cada INSERT ve los anteriores).
  FOR i IN 1..90 LOOP
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('housekeeping-evidencias', hkt.ruta(hkt.pa1(), 5, 'o' || i || '.jpg'), hkt.uid(3));
    n := n + 1;
  END LOOP;
  PERFORM hkt.ok('B5 el cupo de objetos por servicio admite 90 (3 fases × 20 + holgura)', n = 90 AND public.hk_objetos_del_servicio(hkt.sv(5)::text) = 90);
  PERFORM hkt.ok('B6 el objeto 91 → rechazado por la policy del bucket (42501)',
    hkt.estado_de(format($f$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('housekeeping-evidencias', %L, %L)$f$, hkt.ruta(hkt.pa1(), 5, 'o91.jpg'), hkt.uid(3))) = '42501');
  PERFORM hkt.root();
END $$;

-- ── C · transiciones ────────────────────────────────────────────────────────
DO $$
DECLARE r public.servicios_housekeeping; msg text;
BEGIN
  PERFORM hkt.como(hkt.uid(1));
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, fecha, responsable_user_id) VALUES
    (hkt.sv(6), hkt.ca(), hkt.pa1(), '2026-09-01', hkt.uid(3)), (hkt.sv(7), hkt.ca(), hkt.pa1(), '2026-09-01', hkt.uid(3)),
    (hkt.sv(8), hkt.ca(), hkt.pa1(), '2026-09-01', hkt.uid(3)), (hkt.sv(9), hkt.ca(), hkt.pa1(), '2026-09-01', hkt.uid(3)),
    (hkt.sv(10), hkt.ca(), hkt.pa1(), '2026-09-01', hkt.uid(3)), (hkt.sv(30), hkt.ca(), hkt.pa1(), '2026-09-01', hkt.uid(3));

  PERFORM hkt.como(hkt.uid(3));
  msg := hkt.mensaje_de(format($f$UPDATE public.servicios_housekeeping SET estado = 'completado' WHERE id = %L$f$, hkt.sv(6)));
  PERFORM hkt.ok('C1 operador: pendiente → completado directo → HK_TRANSICION_INVALIDA', msg LIKE 'HK_TRANSICION_INVALIDA%');
  PERFORM hkt.ok('C1b … SQLSTATE 23514 y nada sellado',
    hkt.estado_de(format($f$UPDATE public.servicios_housekeeping SET estado = 'completado' WHERE id = %L$f$, hkt.sv(6))) = '23514'
    AND (hkt.servicio(hkt.sv(6))).completado_en IS NULL AND (hkt.servicio(hkt.sv(6))).estado = 'pendiente');
  UPDATE public.servicios_housekeeping SET estado = 'en_proceso' WHERE id = hkt.sv(6);
  r := hkt.servicio(hkt.sv(6));
  PERFORM hkt.ok('C2 operador: pendiente → en_proceso (Iniciar servicio) sella iniciado_*', r.estado = 'en_proceso' AND r.iniciado_en IS NOT NULL AND r.iniciado_por = hkt.uid(3));
  PERFORM hkt.ok('C3 en_proceso → pendiente → 23514',
    hkt.estado_de(format($f$UPDATE public.servicios_housekeeping SET estado = 'pendiente' WHERE id = %L$f$, hkt.sv(6))) = '23514');
  UPDATE public.servicios_housekeeping SET estado = 'completado' WHERE id = hkt.sv(6);
  r := hkt.servicio(hkt.sv(6));
  PERFORM hkt.ok('C4 operador: en_proceso → completado (Finalizar) sella completado_*', r.estado = 'completado' AND r.completado_en IS NOT NULL AND r.completado_por = hkt.uid(3));
  PERFORM hkt.ok('C5 operador: completado → en_proceso (reabrir) → 23514',
    hkt.estado_de(format($f$UPDATE public.servicios_housekeeping SET estado = 'en_proceso' WHERE id = %L$f$, hkt.sv(6))) = '23514');
  UPDATE public.servicios_housekeeping SET notas = 'sin tocar el estado' WHERE id = hkt.sv(6);
  PERFORM hkt.ok('C6 un UPDATE que no cambia el estado no pasa por la validación', (hkt.servicio(hkt.sv(6))).notas = 'sin tocar el estado');
  PERFORM hkt.ok('C7 estado inventado → 23514',
    hkt.estado_de(format($f$UPDATE public.servicios_housekeeping SET estado = 'volando' WHERE id = %L$f$, hkt.sv(7))) = '23514');

  PERFORM hkt.como(hkt.uid(1));
  UPDATE public.servicios_housekeeping SET estado = 'en_proceso' WHERE id = hkt.sv(6);
  PERFORM hkt.ok('C8 la dueña reabre completado → en_proceso', (hkt.servicio(hkt.sv(6))).estado = 'en_proceso');
  UPDATE public.servicios_housekeeping SET estado = 'completado' WHERE id = hkt.sv(7);
  PERFORM hkt.ok('C9 la dueña salta pendiente → completado', (hkt.servicio(hkt.sv(7))).estado = 'completado' AND (hkt.servicio(hkt.sv(7))).completado_en IS NOT NULL);
  PERFORM hkt.como(hkt.uid(2));
  UPDATE public.servicios_housekeeping SET estado = 'completado' WHERE id = hkt.sv(8);
  PERFORM hkt.ok('C10 el admin del proyecto también salta pendiente → completado', (hkt.servicio(hkt.sv(8))).estado = 'completado');
  PERFORM hkt.como(hkt.uid(13));
  PERFORM hkt.ok('C11 otro operador con acceso tampoco salta → 23514',
    hkt.estado_de(format($f$UPDATE public.servicios_housekeeping SET estado = 'completado' WHERE id = %L$f$, hkt.sv(30))) = '23514');

  PERFORM hkt.como(hkt.uid(3));
  UPDATE public.servicios_housekeeping SET estado = 'cancelado' WHERE id = hkt.sv(9);
  PERFORM hkt.ok('C12 operador: pendiente → cancelado', (hkt.servicio(hkt.sv(9))).estado = 'cancelado');
  PERFORM hkt.ok('C13 operador: cancelado → pendiente → 23514',
    hkt.estado_de(format($f$UPDATE public.servicios_housekeeping SET estado = 'pendiente' WHERE id = %L$f$, hkt.sv(9))) = '23514');
  PERFORM hkt.como(hkt.uid(1));
  UPDATE public.servicios_housekeeping SET estado = 'pendiente' WHERE id = hkt.sv(9);
  PERFORM hkt.ok('C14 la dueña reactiva cancelado → pendiente', (hkt.servicio(hkt.sv(9))).estado = 'pendiente');
  PERFORM hkt.ok('C15 completado → cancelado no existe ni para la dueña → 23514',
    hkt.estado_de(format($f$UPDATE public.servicios_housekeeping SET estado = 'cancelado' WHERE id = %L$f$, hkt.sv(7))) = '23514');

  PERFORM hkt.como_servicio();
  UPDATE public.servicios_housekeeping SET estado = 'completado' WHERE id = hkt.sv(10);
  PERFORM hkt.ok('C16 service_role (sin JWT) no se restringe', (hkt.servicio(hkt.sv(10))).estado = 'completado');
  PERFORM hkt.root();
END $$;

-- ── D · avisos al asignar ───────────────────────────────────────────────────
DO $$
DECLARE a public.notifications_outbox; e public.notifications_outbox;
BEGIN
  PERFORM hkt.como(hkt.uid(1));
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, unidad_id, tipo, fecha, hora_inicio, responsable_user_id, reserva_str_id, notas)
    VALUES (hkt.sv(11), hkt.ca(), hkt.pa1(), hkt.un(1), 'limpieza_profunda', '2026-11-20', '09:00', hkt.uid(3), hkt.rs(1), '<b>ojo</b> con la terraza');
  a := hkt.aviso(hkt.sv(11), 'in_app', 'housekeeping_asignado');
  e := hkt.aviso(hkt.sv(11), 'email', 'housekeeping_asignado');
  PERFORM hkt.ok('D1 asignar a otra persona encola UNA campana y UN correo', hkt.avisos(hkt.sv(11), 'in_app', 'housekeeping_asignado') = 1 AND hkt.avisos(hkt.sv(11), 'email', 'housekeeping_asignado') = 1);
  PERFORM hkt.ok('D1b campana: destinatario, tipo, sección, título y cuerpo (tipo, unidad, fecha y hora, quién asigna, reserva)',
    a.recipient = hkt.uid(3)::text AND a.payload->>'user_id' = hkt.uid(3)::text AND a.payload->>'seccion' = 'condominios'
    AND a.payload->>'titulo' = 'Servicio de housekeeping asignado' AND a.payload->>'hito' = 'asignacion'
    AND a.payload->>'cuerpo' = 'Limpieza profunda · Unidad Apto 1A · 20/11/2026 09:00 · asignado por Owner A · Reserva HM-001 · Ana Pérez (2026-11-08 → 2026-11-12)');
  PERFORM hkt.ok('D1c correo: al correo de la cuenta, con template_key, user_id (opt-out), asunto, variables y HTML escapado',
    e.recipient = 'u3@prueba.test' AND e.template_key = 'housekeeping_asignado' AND e.payload->>'user_id' = hkt.uid(3)::text
    AND e.payload->>'to_email' = 'u3@prueba.test' AND e.payload->>'subject' = 'Servicio de housekeeping asignado'
    AND e.payload->>'servicio_tipo' = 'Limpieza profunda' AND e.payload->>'unidad' = 'Apto 1A' AND e.payload->>'fecha' = '20/11/2026'
    AND e.payload->>'hora' = '09:00' AND e.payload->>'asignado_por' = 'Owner A' AND e.payload->>'notas' = '&lt;b&gt;ojo&lt;/b&gt; con la terraza'
    AND e.payload->>'body' NOT LIKE '%{{%' AND e.payload->>'body' NOT LIKE '%<b>ojo%'
    AND e.company_id = hkt.ca() AND e.status = 'queued');
  PERFORM hkt.ok('D1d el log registra la clave fecha|hora', hkt.log_n(hkt.sv(11), 'asignacion') = 1);

  UPDATE public.servicios_housekeeping SET notas = 'otra nota', responsable_user_id = hkt.uid(3) WHERE id = hkt.sv(11);
  PERFORM hkt.ok('D2 guardar sin cambiar responsable/fecha/hora no repite el aviso', hkt.avisos(hkt.sv(11), 'in_app', 'housekeeping_asignado') = 1 AND hkt.avisos(hkt.sv(11), 'email', 'housekeeping_asignado') = 1);
  UPDATE public.servicios_housekeeping SET hora_inicio = '10:00' WHERE id = hkt.sv(11);
  PERFORM hkt.ok('D3 reprogramar la hora avisa de nuevo', hkt.avisos(hkt.sv(11), 'in_app', 'housekeeping_asignado') = 2 AND hkt.avisos(hkt.sv(11), 'email', 'housekeeping_asignado') = 2);
  UPDATE public.servicios_housekeeping SET hora_inicio = '09:00' WHERE id = hkt.sv(11);
  PERFORM hkt.ok('D3b volver a una fecha|hora ya avisada no repite (clave)', hkt.avisos(hkt.sv(11), 'in_app', 'housekeeping_asignado') = 2);
  UPDATE public.servicios_housekeeping SET fecha = '2026-11-21' WHERE id = hkt.sv(11);
  PERFORM hkt.ok('D4 cambiar la fecha avisa de nuevo', hkt.avisos(hkt.sv(11), 'in_app', 'housekeeping_asignado') = 3);
  UPDATE public.servicios_housekeeping SET responsable_user_id = hkt.uid(6) WHERE id = hkt.sv(11);
  PERFORM hkt.ok('D5 reasignar a una cuenta SIN correo: campana sí, correo no',
    hkt.avisos(hkt.sv(11), 'in_app', 'housekeeping_asignado', hkt.uid(6)::text) = 1 AND hkt.avisos(hkt.sv(11), 'in_app', 'housekeeping_asignado') = 4
    AND hkt.avisos(hkt.sv(11), 'email', 'housekeeping_asignado') = 3);

  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, fecha, hora_inicio, responsable_user_id) VALUES (hkt.sv(12), hkt.ca(), hkt.pa1(), '2026-11-20', '09:00', hkt.uid(3));
  PERFORM hkt.ok('D6 asignarse a uno mismo no avisa', hkt.avisos(hkt.sv(12), 'in_app', 'housekeeping_asignado') = 0 AND hkt.avisos(hkt.sv(12), 'email', 'housekeeping_asignado') = 0 AND hkt.log_n(hkt.sv(12), 'asignacion') = 0);
  UPDATE public.servicios_housekeeping SET responsable_user_id = hkt.uid(13) WHERE id = hkt.sv(12);
  a := hkt.aviso(hkt.sv(12), 'in_app', 'housekeeping_asignado', hkt.uid(13)::text);
  PERFORM hkt.ok('D6b … pero reasignar a otra persona sí (asignado por el operador)', a.id IS NOT NULL AND a.payload->>'cuerpo' LIKE '%asignado por Operador PA1%' AND a.payload->>'cuerpo' NOT LIKE '%Unidad%');

  PERFORM hkt.como(hkt.uid(6));
  UPDATE public.servicios_housekeeping SET estado = 'en_proceso' WHERE id = hkt.sv(11);
  UPDATE public.servicios_housekeeping SET hora_inicio = '11:00' WHERE id = hkt.sv(11);
  PERFORM hkt.ok('D7 un servicio en_proceso ya no avisa al reprogramar', hkt.avisos(hkt.sv(11), 'in_app', 'housekeeping_asignado') = 4);

  PERFORM hkt.como(hkt.uid(1));
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, fecha, hora_inicio, responsable_user_id) VALUES (hkt.sv(13), hkt.ca(), hkt.pa1(), '2026-11-20', '09:00', hkt.uid(3));
  PERFORM hkt.como(hkt.uid(3));
  UPDATE public.servicios_housekeeping SET estado = 'cancelado' WHERE id = hkt.sv(13);
  PERFORM hkt.como(hkt.uid(1));
  UPDATE public.servicios_housekeeping SET estado = 'pendiente' WHERE id = hkt.sv(13);
  PERFORM hkt.ok('D8 reactivar un cancelado con la misma fecha|hora no duplica el aviso', hkt.avisos(hkt.sv(13), 'in_app', 'housekeeping_asignado') = 1);

  PERFORM hkt.root();
  ALTER TABLE public.notifications_outbox ADD CONSTRAINT zz_roto CHECK (false) NOT VALID;
  PERFORM hkt.como(hkt.uid(1));
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, fecha, hora_inicio, responsable_user_id) VALUES (hkt.sv(14), hkt.ca(), hkt.pa1(), '2026-11-20', '09:00', hkt.uid(3));
  PERFORM hkt.ok('D9 con el outbox roto el servicio se guarda igual (y el log no queda marcado)',
    (hkt.servicio(hkt.sv(14))).id IS NOT NULL AND hkt.avisos(hkt.sv(14), 'in_app', 'housekeeping_asignado') = 0 AND hkt.log_n(hkt.sv(14), 'asignacion') = 0);
  PERFORM hkt.root();
  ALTER TABLE public.notifications_outbox DROP CONSTRAINT zz_roto;
  PERFORM hkt.como(hkt.uid(1));
  UPDATE public.servicios_housekeeping SET hora_inicio = '09:30' WHERE id = hkt.sv(14);
  PERFORM hkt.ok('D9b reparado el outbox, la siguiente reprogramación sí avisa', hkt.avisos(hkt.sv(14), 'in_app', 'housekeeping_asignado') = 1);

  PERFORM hkt.ok('D10 authenticated no llama al encolado interno ni lee el log',
    hkt.estado_de(format($f$SELECT public.hk_encolar_aviso_responsable(s, 'asignacion', 'x') FROM public.servicios_housekeeping s WHERE s.id = %L$f$, hkt.sv(11))) = '42501'
    AND hkt.estado_de('SELECT * FROM public.hk_recordatorios_log') = '42501'
    AND hkt.estado_de('SELECT * FROM public.notifications_outbox') = '42501');
  PERFORM hkt.como_anon();
  PERFORM hkt.ok('D10b anon tampoco', hkt.estado_de('SELECT * FROM public.hk_recordatorios_log') = '42501');
  PERFORM hkt.root();
END $$;

-- ── E · recordatorio previo ─────────────────────────────────────────────────
DO $$
DECLARE a public.notifications_outbox; e public.notifications_outbox; n int;
BEGIN
  PERFORM hkt.como(hkt.uid(1));
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, unidad_id, fecha, hora_inicio, responsable_user_id, notas) VALUES
    (hkt.sv(15), hkt.ca(), hkt.pa1(), hkt.un(1), '2026-11-10', '09:00', hkt.uid(3), 'Llevar llaves'),
    (hkt.sv(16), hkt.ca(), hkt.pa1(), hkt.un(2), '2026-11-10', '09:00', hkt.uid(13), NULL),
    (hkt.sv(18), hkt.ca(), hkt.pa1(), NULL,      '2026-11-11', NULL,    hkt.uid(3), NULL),
    (hkt.sv(19), hkt.ca(), hkt.pa1(), NULL,      '2026-11-12', '09:00', hkt.uid(3), NULL),
    (hkt.sv(20), hkt.ca(), hkt.pa1(), NULL,      '2026-11-13', '09:00', hkt.uid(3), NULL);
  PERFORM hkt.como(hkt.uid(3));
  UPDATE public.servicios_housekeeping SET estado = 'en_proceso' WHERE id = hkt.sv(19);
  PERFORM hkt.como(hkt.uid(7));
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, unidad_id, fecha, hora_inicio, responsable_user_id) VALUES
    (hkt.sv(17), hkt.cb(), hkt.pb1(), hkt.un(9), '2026-11-10', '09:00', hkt.uid(7));

  PERFORM hkt.como(hkt.uid(3));
  PERFORM hkt.ok('E0 authenticated no ejecuta el recordatorio (42501)', hkt.estado_de('SELECT public.hk_recordatorios_previos()') = '42501');

  PERFORM hkt.como_servicio();
  -- Empresa A = America/Guatemala (UTC−6): 09:00 local = 15:00 UTC.
  n := public.hk_recordatorios_previos(interval '60 minutes', '2026-11-10 13:59:59+00');
  PERFORM hkt.ok('E1 61 min antes: nada', n = 0 AND hkt.avisos(hkt.sv(15), 'in_app', 'housekeeping_recordatorio') = 0);
  n := public.hk_recordatorios_previos(interval '60 minutes', '2026-11-10 06:30:00+00');
  PERFORM hkt.ok('E2 la empresa B (Europe/Madrid, 09:00 = 08:00 UTC) tampoco a las 06:30 UTC', n = 0);
  n := public.hk_recordatorios_previos(interval '60 minutes', '2026-11-10 07:30:00+00');
  PERFORM hkt.ok('E3 … sí a las 07:30 UTC, y sólo ella (zona del tenant)',
    n = 2 AND hkt.avisos(hkt.sv(17), 'in_app', 'housekeeping_recordatorio') = 1 AND hkt.avisos(hkt.sv(17), 'email', 'housekeeping_recordatorio') = 1
    AND hkt.avisos(hkt.sv(15), 'in_app', 'housekeeping_recordatorio') = 0);
  n := public.hk_recordatorios_previos(interval '60 minutes', '2026-11-10 14:00:00+00');
  a := hkt.aviso(hkt.sv(15), 'in_app', 'housekeeping_recordatorio');
  e := hkt.aviso(hkt.sv(15), 'email', 'housekeeping_recordatorio');
  PERFORM hkt.ok('E4 60 min antes (14:00 UTC): campana + correo a los DOS pendientes de la empresa A de esa hora',
    n = 4 AND hkt.avisos(hkt.sv(15), 'in_app', 'housekeeping_recordatorio') = 1 AND hkt.avisos(hkt.sv(16), 'in_app', 'housekeeping_recordatorio') = 1);
  PERFORM hkt.ok('E4b campana: título con la hora local y la unidad; cuerpo con la nota',
    a.recipient = hkt.uid(3)::text AND a.payload->>'titulo' = 'Hoy a las 09:00: Limpieza estándar en Apto 1A'
    AND a.payload->>'cuerpo' = 'Ingreso tentativo a las 09:00 · Llevar llaves' AND a.payload->>'hito' = 'previo');
  PERFORM hkt.ok('E4c correo con su plantilla y el user_id para el opt-out', e.template_key = 'housekeeping_recordatorio' AND e.payload->>'user_id' = hkt.uid(3)::text AND e.recipient = 'u3@prueba.test');
  n := public.hk_recordatorios_previos(interval '60 minutes', '2026-11-10 14:30:00+00');
  PERFORM hkt.ok('E5 un cuarto de hora después (otra pasada del cron): nada se repite', n = 0 AND hkt.log_n(hkt.sv(15), 'previo') = 1);
  n := public.hk_recordatorios_previos(interval '60 minutes', '2026-11-10 15:00:00+00');
  PERFORM hkt.ok('E6 ya empezado: nada', n = 0);
  n := public.hk_recordatorios_previos(interval '60 minutes', '2026-11-11 13:15:00+00');
  a := hkt.aviso(hkt.sv(18), 'in_app', 'housekeeping_recordatorio');
  PERFORM hkt.ok('E7 sin hora tentativa se asume 08:00 local (14:00 UTC): avisa a las 13:15 UTC', n = 2 AND a.payload->>'titulo' = 'Hoy a las 08:00: Limpieza estándar');
  n := public.hk_recordatorios_previos(interval '60 minutes', '2026-11-12 14:30:00+00');
  PERFORM hkt.ok('E8 un servicio en_proceso no recibe recordatorio', n = 0 AND hkt.avisos(hkt.sv(19), 'in_app', 'housekeeping_recordatorio') = 0);
  n := public.hk_recordatorios_previos(interval '3 hours', '2026-11-13 12:30:00+00');
  PERFORM hkt.ok('E9 la ventana es configurable (3 h antes)', n = 2 AND hkt.avisos(hkt.sv(20), 'in_app', 'housekeeping_recordatorio') = 1);
  PERFORM hkt.root();
  PERFORM hkt.ok('E10 el cron queda programado una sola vez cada 15 min',
    (SELECT count(*) FROM cron.job WHERE jobname = 'hk_recordatorios_previos') = 1
    AND (SELECT schedule FROM cron.job WHERE jobname = 'hk_recordatorios_previos') = '*/15 * * * *'
    AND (SELECT command FROM cron.job WHERE jobname = 'hk_recordatorios_previos') LIKE '%run_hk_recordatorios_previos%');
END $$;

-- ── F · informe al cerrar ───────────────────────────────────────────────────
DO $$
DECLARE res jsonb; e public.notifications_outbox; r public.servicios_housekeeping; msg text;
BEGIN
  PERFORM hkt.como(hkt.uid(1));
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, unidad_id, fecha, hora_inicio, responsable_user_id, reserva_str_id) VALUES
    (hkt.sv(22), hkt.ca(), hkt.pa1(), hkt.un(1), '2026-11-10', '09:00', hkt.uid(3), hkt.rs(1)),
    (hkt.sv(23), hkt.ca(), hkt.pa1(), hkt.un(1), '2026-11-10', '09:00', hkt.uid(3), NULL),
    (hkt.sv(24), hkt.ca(), hkt.pa2(), hkt.un(3), '2026-11-10', '09:00', hkt.uid(4), NULL);
  UPDATE public.servicios_housekeeping SET estado = 'completado' WHERE id = hkt.sv(24);

  PERFORM hkt.como(hkt.uid(3));
  UPDATE public.servicios_housekeeping SET estado = 'en_proceso', hallazgos_ingreso = '<script>alert(1)</script> polvo en repisas', inconvenientes = 'Grifo roto' WHERE id = hkt.sv(22);
  INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES
    (hkt.sv(22), 'ingreso', hkt.ruta(hkt.pa1(), 22, 'a.jpg')), (hkt.sv(22), 'ingreso', hkt.ruta(hkt.pa1(), 22, 'b.jpg')),
    (hkt.sv(22), 'inconvenientes', hkt.ruta(hkt.pa1(), 22, 'c.jpg')),
    (hkt.sv(22), 'cierre', hkt.ruta(hkt.pa1(), 22, 'd.jpg')), (hkt.sv(22), 'cierre', hkt.ruta(hkt.pa1(), 22, 'e.jpg')), (hkt.sv(22), 'cierre', hkt.ruta(hkt.pa1(), 22, 'f.jpg'));
  UPDATE public.servicios_housekeeping SET estado = 'completado', observaciones_cierre = 'Todo limpio' WHERE id = hkt.sv(22);
  -- Para que las horas dedicadas sean comprobables: la base sella iniciado_en = now();
  -- aquí se mueve 2 h 30 min atrás saltando el sello (sólo en la prueba).
  PERFORM hkt.root();
  ALTER TABLE public.servicios_housekeeping DISABLE TRIGGER trg_hk_sellar_ejecucion;
  UPDATE public.servicios_housekeeping SET iniciado_en = completado_en - interval '2 hours 30 minutes' WHERE id = hkt.sv(22);
  ALTER TABLE public.servicios_housekeeping ENABLE TRIGGER trg_hk_sellar_ejecucion;

  PERFORM hkt.como(hkt.uid(3));
  res := public.hk_notificar_informe(hkt.sv(22));
  r := hkt.servicio(hkt.sv(22));
  PERFORM hkt.ok('F1 el operador envía el informe a dueña + admins CON acceso al proyecto y con correo (1, 2 y 12; no 7 ni operadores)',
    (res->>'encolados')::int = 3 AND hkt.mismo_conjunto(res->'destinatarios', ARRAY['u1@prueba.test','u12@prueba.test','u2@prueba.test']) AND (res->>'extra')::boolean = false
    AND hkt.avisos(hkt.sv(22), 'email', 'housekeeping_informe') = 3);
  e := hkt.aviso(hkt.sv(22), 'email', 'housekeeping_informe');
  PERFORM hkt.ok('F1b correo: plantilla, asunto, user_id, informe_html',
    e.template_key = 'housekeeping_informe' AND e.payload->>'subject' = 'Informe de housekeeping: Limpieza estándar · Apto 1A · 10/11/2026'
    AND e.payload ? 'user_id' AND e.payload->>'informe_html' = e.payload->>'body' AND e.payload->>'tipo' = 'housekeeping_informe');
  PERFORM hkt.ok('F1c cuerpo: horas dedicadas 02:30 h, inicio/fin reales, responsable, reserva, fotos por fase, textos ESCAPADOS',
    e.payload->>'body' LIKE '%<b>Horas dedicadas</b></td><td>02:30 h</td>%'
    AND e.payload->>'body' LIKE '%<b>Responsable</b></td><td>Operador PA1</td>%'
    AND e.payload->>'body' LIKE '%<b>Reserva</b></td><td>HM-001 · Ana Pérez · 2026-11-08 → 2026-11-12 (airbnb)</td>%'
    AND e.payload->>'body' LIKE '%ingreso 2 · inconvenientes 1 · resultado 3%'
    AND e.payload->>'body' LIKE '%&lt;script&gt;alert(1)&lt;/script&gt; polvo en repisas%' AND e.payload->>'body' NOT LIKE '%<script>%'
    AND e.payload->>'body' LIKE '%Grifo roto%' AND e.payload->>'body' LIKE '%Todo limpio%'
    AND e.payload->>'body' LIKE '%ingreso tentativo 09:00%' AND e.payload->>'body' NOT LIKE '%{{%'
    AND e.payload->>'body' LIKE '%<b>Inicio real</b></td><td>__/__/____ __:__</td>%');
  PERFORM hkt.ok('F1d sellos: informe_enviado_en/por', r.informe_enviado_en IS NOT NULL AND r.informe_enviado_por = hkt.uid(3));

  res := public.hk_notificar_informe(hkt.sv(22), true, '  Externo@Correo.test ');
  e := hkt.aviso(hkt.sv(22), 'email', 'housekeeping_informe', 'Externo@Correo.test');
  PERFORM hkt.ok('F2 administradores + correo extra: 4, el extra recortado y SIN user_id (sin opt-out)',
    (res->>'encolados')::int = 4 AND (res->>'extra')::boolean = true AND res->'destinatarios' ? 'Externo@Correo.test'
    AND e.id IS NOT NULL AND NOT (e.payload ? 'user_id') AND e.payload->>'to_email' = 'Externo@Correo.test'
    AND hkt.avisos(hkt.sv(22), 'email', 'housekeeping_informe') = 7);
  res := public.hk_notificar_informe(hkt.sv(22), false, 'externo@correo.test');
  PERFORM hkt.ok('F3 sólo el correo tecleado: 1', (res->>'encolados')::int = 1 AND res->'destinatarios' = '["externo@correo.test"]'::jsonb);
  res := public.hk_notificar_informe(hkt.sv(22), true, 'u1@prueba.test');
  PERFORM hkt.ok('F4 el extra igual al de una administradora no se duplica', (res->>'encolados')::int = 3);

  msg := hkt.mensaje_de(format('SELECT public.hk_notificar_informe(%L)', hkt.sv(23)));
  PERFORM hkt.ok('F5 un servicio pendiente no tiene informe → HK_INFORME_NO_COMPLETADO (23514)', msg LIKE 'HK_INFORME_NO_COMPLETADO%'
    AND hkt.estado_de(format('SELECT public.hk_notificar_informe(%L)', hkt.sv(23))) = '23514');
  msg := hkt.mensaje_de(format('SELECT public.hk_notificar_informe(%L, true, %L)', hkt.sv(22), 'no-es-correo'));
  PERFORM hkt.ok('F6 correo inválido → HK_EMAIL_INVALIDO', msg LIKE 'HK_EMAIL_INVALIDO%');
  msg := hkt.mensaje_de(format('SELECT public.hk_notificar_informe(%L, false, NULL)', hkt.sv(22)));
  PERFORM hkt.ok('F7 sin administradores y sin correo → HK_SIN_DESTINATARIOS', msg LIKE 'HK_SIN_DESTINATARIOS%'
    AND hkt.mensaje_de(format('SELECT public.hk_notificar_informe(%L, false, %L)', hkt.sv(22), '   ')) LIKE 'HK_SIN_DESTINATARIOS%');

  PERFORM hkt.como(hkt.uid(4));
  PERFORM hkt.ok('F8 operador de otro proyecto → P0002 (inexistente para él)', hkt.estado_de(format('SELECT public.hk_notificar_informe(%L)', hkt.sv(22))) = 'P0002');
  PERFORM hkt.como(hkt.uid(7));
  PERFORM hkt.ok('F8b admin de otra empresa → P0002', hkt.estado_de(format('SELECT public.hk_notificar_informe(%L)', hkt.sv(22))) = 'P0002');
  PERFORM hkt.como(hkt.uid(5));
  PERFORM hkt.ok('F8c operador sin el permiso del módulo → P0002', hkt.estado_de(format('SELECT public.hk_notificar_informe(%L)', hkt.sv(22))) = 'P0002');
  PERFORM hkt.como(gen_random_uuid());
  PERFORM hkt.ok('F9 sesión sin perfil → P0002 (nunca pasa por NULL)', hkt.estado_de(format('SELECT public.hk_notificar_informe(%L)', hkt.sv(22))) = 'P0002'
    AND hkt.avisos(hkt.sv(22), 'email', 'housekeeping_informe') = 11);
  PERFORM hkt.como_anon();
  PERFORM hkt.ok('F9b anon → 42501', hkt.estado_de(format('SELECT public.hk_notificar_informe(%L)', hkt.sv(22))) = '42501');

  PERFORM hkt.como(hkt.uid(1));
  res := public.hk_notificar_informe(hkt.sv(24));
  PERFORM hkt.ok('F10 servicio de PA2: el admin acotado a PA1 (2) NO recibe; la dueña y el admin exento sí',
    (res->>'encolados')::int = 2 AND hkt.mismo_conjunto(res->'destinatarios', ARRAY['u1@prueba.test','u12@prueba.test']));
  e := hkt.aviso(hkt.sv(24), 'email', 'housekeeping_informe');
  PERFORM hkt.ok('F10b sin reserva ni fotos: sin fila de reserva, fotos 0 y horas no calculables (salto directo sin iniciar)',
    e.payload->>'body' NOT LIKE '%<b>Reserva</b>%' AND e.payload->>'body' LIKE '%ingreso 0 · inconvenientes 0 · resultado 0%'
    AND e.payload->>'body' LIKE '%<b>Horas dedicadas</b></td><td>no calculable</td>%');

  PERFORM hkt.como(hkt.uid(3));
  PERFORM hkt.ok('F11 authenticated no encola correos directamente (enqueue_notification es de service_role)',
    hkt.estado_de($f$SELECT public.enqueue_notification('email', 'x@y.z')$f$) = '42501');
  PERFORM hkt.root();
END $$;

-- ── G · catálogo de reservas vinculables ────────────────────────────────────
DO $$
DECLARE ids uuid[]; msg text;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  SELECT array_agg(id ORDER BY ordinality) INTO ids FROM public.hk_reservas_vinculables(hkt.pa1()) WITH ORDINALITY;
  PERFORM hkt.ok('G1 el operador (sin permiso de STR) ve las reservas en curso y confirmadas de PA1, en curso primero y luego por entrada',
    ids = ARRAY[hkt.rs(1), hkt.rs(2), hkt.rs(7)]);
  SELECT array_agg(id ORDER BY ordinality) INTO ids FROM public.hk_reservas_vinculables(hkt.pa1(), hkt.un(2)) WITH ORDINALITY;
  PERFORM hkt.ok('G2 con unidad pedida, la de esa unidad va primero', ids = ARRAY[hkt.rs(2), hkt.rs(1), hkt.rs(7)]);
  PERFORM hkt.ok('G3 trae el nombre de la unidad (NULL si la reserva no tiene)',
    (SELECT unidad_nombre FROM public.hk_reservas_vinculables(hkt.pa1()) WHERE id = hkt.rs(1)) = 'Apto 1A'
    AND (SELECT unidad_nombre FROM public.hk_reservas_vinculables(hkt.pa1()) WHERE id = hkt.rs(7)) IS NULL
    AND (SELECT huesped_nombre FROM public.hk_reservas_vinculables(hkt.pa1()) WHERE id = hkt.rs(1)) = 'Ana Pérez');
  PERFORM hkt.como(hkt.uid(4));
  PERFORM hkt.ok('G4 el operador de PA2 no pide el catálogo de PA1 → 42501', hkt.estado_de(format('SELECT * FROM public.hk_reservas_vinculables(%L)', hkt.pa1())) = '42501');
  PERFORM hkt.como(hkt.uid(5));
  PERFORM hkt.ok('G5 sin el permiso del módulo → 42501', hkt.estado_de(format('SELECT * FROM public.hk_reservas_vinculables(%L)', hkt.pa1())) = '42501');
  PERFORM hkt.como(hkt.uid(7));
  msg := hkt.mensaje_de(format('SELECT * FROM public.hk_reservas_vinculables(%L)', hkt.pa1()));
  PERFORM hkt.ok('G6 otra empresa → 42501 «fuera de la empresa»', msg = 'Proyecto fuera de la empresa');
  PERFORM hkt.como(hkt.uid(1));
  PERFORM hkt.ok('G7 la dueña ve PA2 = {5} y no puede con PB1',
    (SELECT array_agg(id) FROM public.hk_reservas_vinculables(hkt.pa2())) = ARRAY[hkt.rs(5)]
    AND hkt.estado_de(format('SELECT * FROM public.hk_reservas_vinculables(%L)', hkt.pb1())) = '42501');
  PERFORM hkt.ok('G8 proyecto inexistente → 42501', hkt.estado_de(format('SELECT * FROM public.hk_reservas_vinculables(%L)', gen_random_uuid())) = '42501');
  PERFORM hkt.como(gen_random_uuid());
  PERFORM hkt.ok('G9 sesión sin perfil → 42501', hkt.estado_de(format('SELECT * FROM public.hk_reservas_vinculables(%L)', hkt.pa1())) = '42501');
  PERFORM hkt.como_anon();
  PERFORM hkt.ok('G10 anon → 42501', hkt.estado_de(format('SELECT * FROM public.hk_reservas_vinculables(%L)', hkt.pa1())) = '42501');
  PERFORM hkt.root();
END $$;

-- ── H · inventario ──────────────────────────────────────────────────────────
DO $$
DECLARE trgs text[];
BEGIN
  SELECT array_agg(tgname ORDER BY tgname) INTO trgs FROM pg_trigger WHERE tgrelid = 'public.servicios_housekeeping'::regclass AND NOT tgisinternal;
  PERFORM hkt.ok('H1 triggers nuevos presentes y la transición dispara ANTES del sello de ejecución',
    trgs @> ARRAY['trg_hk_estado_transicion', 'trg_hk_reserva', 'trg_hk_notificar_asignacion', 'trg_hk_responsable', 'trg_hk_sellar_ejecucion']
    AND array_position(trgs, 'trg_hk_estado_transicion') < array_position(trgs, 'trg_hk_sellar_ejecucion')
    AND array_position(trgs, 'trg_hk_reserva') < array_position(trgs, 'trg_hk_sellar_ejecucion'));
  PERFORM hkt.ok('H2 ACL: las RPC de pantalla para authenticated, nunca anon; las internas y el recordatorio, no',
    has_function_privilege('authenticated', 'public.hk_reservas_vinculables(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.hk_reservas_vinculables(uuid,uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.hk_notificar_informe(uuid,boolean,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.hk_notificar_informe(uuid,boolean,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.hk_recordatorios_previos(interval,timestamptz)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.hk_recordatorios_previos(interval,timestamptz)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.run_hk_recordatorios_previos()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.hk_encolar_aviso_responsable(public.servicios_housekeeping,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.hk_reserva_validar()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.hk_transicion_estado()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.hk_notificar_asignacion()', 'EXECUTE'));
  PERFORM hkt.ok('H3 tres plantillas globales de correo, activas',
    (SELECT count(*) FROM public.notification_templates WHERE company_id IS NULL AND channel = 'email' AND is_active
       AND key IN ('housekeeping_asignado', 'housekeeping_recordatorio', 'housekeeping_informe')) = 3);
  PERFORM hkt.ok('H4 un solo CHECK de fase, con las tres fases',
    (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.servicio_housekeeping_fotos'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%fase%') = 1
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.servicio_housekeeping_fotos'::regclass AND contype = 'c'
                  AND pg_get_constraintdef(oid) LIKE '%inconvenientes%' AND pg_get_constraintdef(oid) LIKE '%ingreso%' AND pg_get_constraintdef(oid) LIKE '%cierre%'));
  PERFORM hkt.ok('H5 la policy de INSERT del bucket exige hk_acceso y cupo < 90',
    (SELECT with_check FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'hk_evidencias_insert') LIKE '%hk_acceso%'
    AND (SELECT with_check FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'hk_evidencias_insert') LIKE '%< 90%');
  PERFORM hkt.ok('H6 hk_recordatorios_log: RLS activa, sin privilegios para la API, policy que niega',
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.hk_recordatorios_log'::regclass)
    AND NOT has_table_privilege('authenticated', 'public.hk_recordatorios_log', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.hk_recordatorios_log', 'SELECT')
    AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hk_recordatorios_log'));
  PERFORM hkt.ok('H7 columnas nuevas con sus FK (reserva SET NULL, informe_enviado_por SET NULL)',
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.servicios_housekeeping'::regclass AND contype = 'f'
              AND pg_get_constraintdef(oid) LIKE '%(reserva_str_id) REFERENCES reservas_str(id) ON DELETE SET NULL%')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.servicios_housekeeping'::regclass AND contype = 'f'
              AND pg_get_constraintdef(oid) LIKE '%(informe_enviado_por) REFERENCES auth.users(id) ON DELETE SET NULL%'));
END $$;
