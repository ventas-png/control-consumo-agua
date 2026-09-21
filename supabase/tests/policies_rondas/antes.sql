\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- EL AGUJERO, DEMOSTRADO. Corre ANTES de 20260922000000, sobre el esquema que
-- el repositorio describía: las cuatro policies de RBAC más las dos legadas.
--
-- Si esta parte pasara en verde con la migración ya aplicada, la prueba no
-- estaría probando nada — por eso el runner la corre primero y exige que el
-- agujero ESTÉ ahí. Una prueba de seguridad que nunca vio el fallo no sabe
-- distinguir el arreglo de la suerte.

SET ROLE authenticated;
SELECT set_config('app.uid', '11111111-0000-0000-0000-000000000001', false);  -- operativo, SIN permiso

DO $$
DECLARE n int;
BEGIN
  -- 1 · LEE paradas sin tener `condominios.tab.rutas_ronda`.
  SELECT count(*) INTO n FROM public.puntos_control_ruta;
  IF n = 0 THEN
    RAISE EXCEPTION 'A1: se esperaba el agujero (lectura sin permiso) y no está'; END IF;
  RAISE NOTICE 'BUG 1  lee % parada(s) SIN el permiso del tab', n;

  -- 2 · LEE visitas de control igual.
  SELECT count(*) INTO n FROM public.visitas_control;
  IF n = 0 THEN
    RAISE EXCEPTION 'A2: se esperaba el agujero (lectura de visitas) y no está'; END IF;
  RAISE NOTICE 'BUG 2  lee % visita(s) SIN el permiso del tab', n;

  -- 3 · ESCRIBE: cambia las instrucciones de un punto de la ronda.
  UPDATE public.puntos_control_ruta SET instrucciones = 'alterado sin permiso'
   WHERE id = 'f0000000-0000-0000-0000-000000000021';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'A3: se esperaba el agujero (UPDATE sin permiso) y no está'; END IF;
  RAISE NOTICE 'BUG 3  MODIFICA una parada SIN el permiso del tab';

  -- 4 · BORRA una visita. El gate de RBAC reserva el DELETE a company_owner o
  -- admin, y este usuario es un operador cualquiera.
  DELETE FROM public.visitas_control WHERE id = 'a0000000-0000-0000-0000-000000000042';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'A4: se esperaba el agujero (DELETE sin ser dueño) y no está'; END IF;
  RAISE NOTICE 'BUG 4  BORRA una visita SIN ser company_owner ni admin';

  -- 5 · Y da de alta una parada nueva en la ruta.
  INSERT INTO public.puntos_control_ruta (ruta_id, area_id, orden, instrucciones)
  VALUES ('e0000000-0000-0000-0000-000000000011',
          'c0000000-0000-0000-0000-0000000000a1', 9, 'insertada sin permiso');
  RAISE NOTICE 'BUG 5  INSERTA una parada SIN el permiso del tab';
END;
$$;

RESET ROLE;
