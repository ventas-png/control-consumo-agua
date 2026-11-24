-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261215000000_agua_primera_lectura_fecha_del_historial.
-- Corre como Ada (dueña de ACME); la vecina, como Nadia.
--
--   1-3  la base de la primera lectura toma la FECHA de la última lectura del
--        historial cuando su valor es el de esa lectura
--   4-6  y no la toma cuando no corresponde
--   7-9  lo que se guarda en la lectura, y lo que NO cambia
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
SET client_min_messages = notice;

CREATE SCHEMA t;
CREATE FUNCTION t.ok(p_nombre text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS DISTINCT FROM true THEN RAISE EXCEPTION 'FALLO %', p_nombre; END IF;
  RAISE NOTICE 'OK    %', p_nombre;
END $$;
-- El día de la base, en la zona de la empresa.
CREATE FUNCTION t.dia_base(p_contador uuid) RETURNS date LANGUAGE sql AS $$
  SELECT (c.base_fecha AT TIME ZONE c.zona_horaria)::date FROM public.agua_lectura_contexto(p_contador) c
$$;

DO $$
DECLARE
  ADA   constant uuid := 'e0000000-0000-0000-0000-00000000000d';
  NADIA constant uuid := 'e0000000-0000-0000-0000-000000000003';
  M1 constant uuid := 'c0000000-0000-0000-0000-000000000001';
  M2 constant uuid := 'c0000000-0000-0000-0000-000000000002';
  M4 constant uuid := 'c0000000-0000-0000-0000-000000000004';
  M5 constant uuid := 'c0000000-0000-0000-0000-000000000005';
  M9 constant uuid := 'c0000000-0000-0000-0000-000000000009';
  ctx record; reg public.registros;
BEGIN
  PERFORM set_config('app.uid', ADA::text, false);

  SELECT * INTO ctx FROM public.agua_lectura_contexto(M2);
  PERFORM t.ok('1 contador que heredó su lectura inicial del historial: la fecha de la base es la de ESA lectura',
    ctx.base_es_primera AND ctx.base_lectura = 330 AND t.dia_base(M2) = current_date - 60);
  PERFORM t.ok('2 es el mediodía de la zona de la empresa, como toda fecha de lectura',
    (ctx.base_fecha AT TIME ZONE ctx.zona_horaria)::time = time '12:00');
  PERFORM t.ok('3 una fila más reciente del historial SIN lectura (sólo consumo) no mueve la fecha',
    t.dia_base(M2) <> current_date - 45);

  -- La fecha de instalación entra como antes: `fecha_instalacion::timestamptz`.
  PERFORM t.ok('4 si la lectura inicial NO es la del historial, sigue la fecha de instalación',
    (SELECT base_fecha FROM public.agua_lectura_contexto(M4)) = DATE '2026-01-01'::timestamptz);
  PERFORM t.ok('5 si esa lectura del historial es ANTERIOR a la instalación, sigue la fecha de instalación',
    (SELECT base_fecha FROM public.agua_lectura_contexto(M1)) = DATE '2026-01-15'::timestamptz);
  PERFORM set_config('app.uid', NADIA::text, false);
  PERFORM t.ok('6 cada contador mira SU historial (el de la vecina sí tiene una lectura 0 reciente, y hereda)',
    t.dia_base(M9) = current_date - 10);
  PERFORM set_config('app.uid', ADA::text, false);

  SELECT * INTO reg FROM public.registrar_lectura(M2, 350, current_date - 30, 'plh-m2-1');
  PERFORM t.ok('7 la primera lectura guarda como anterior la del historial: fecha, días de servicio y consumo',
    (reg.fecha_lectura_anterior AT TIME ZONE 'America/Guatemala')::date = current_date - 60
    AND reg.dias_servicio = 30 AND reg.lectura_anterior = 330 AND reg.consumo = 20);
  PERFORM t.ok('8 con una lectura del sistema, manda esa lectura y ya no el historial',
    t.dia_base(M2) = current_date - 30 AND NOT (SELECT base_es_primera FROM public.agua_lectura_contexto(M2)));

  SELECT * INTO reg FROM public.registrar_lectura(M5, 47, current_date - 5, 'plh-m5-1',
                                                  p_fecha_inicio_servicio => current_date - 20);
  PERFORM t.ok('9 el inicio de servicio puesto a mano sigue mandando sobre el historial',
    (reg.fecha_lectura_anterior AT TIME ZONE 'America/Guatemala')::date = current_date - 20
    AND reg.dias_servicio = 15 AND reg.consumo = 7);
END $$;
