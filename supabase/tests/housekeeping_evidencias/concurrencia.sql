-- Una SESIÓN de la prueba de concurrencia: 12 fotos «ingreso» sobre el servicio 5 de la
-- persona 3, todas en la MISMA transacción, y DESPUÉS espera 1,5 s con la transacción
-- abierta (sin confirmar) para que la otra sesión, lanzada 0,3 s más tarde, se cruce con
-- ella. (La espera va tras el bucle, no dentro: si fuera tras la primera foto, el resto de
-- las inserciones de la segunda sesión ocurrirían ya con la primera confirmada y la prueba
-- daría 20 con o sin candado.)
-- Con el candado por (servicio, fase) la segunda espera en su primera inserción y al entrar
-- ve 12 filas confirmadas: solo caben 8. Sin el candado cada sesión solo ve sus propias
-- filas, ninguna llega a 20 y se insertan 24 (eso es lo que detecta la mutación).
\set ON_ERROR_STOP on
SELECT set_config('hk.sesion', :'sesion', false);
SELECT set_config('app.uid', 'c0000000-0000-0000-0000-000000000003', false);
SET ROLE authenticated;
DO $$
DECLARE i int; ok int := 0; ko int := 0; s text := current_setting('hk.sesion');
BEGIN
  FOR i IN 1..12 LOOP
    BEGIN
      INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path)
      VALUES ('5e000000-0000-0000-0000-000000000005', 'ingreso',
              'a1000000-0000-0000-0000-000000000001/5e000000-0000-0000-0000-000000000005/s' || s || '-' || i || '.jpg');
      ok := ok + 1;
    EXCEPTION WHEN check_violation THEN ko := ko + 1;
    END;
  END LOOP;
  PERFORM pg_sleep(1.5);
  RAISE NOTICE 'SESION % ok=% ko=%', s, ok, ko;
END $$;
