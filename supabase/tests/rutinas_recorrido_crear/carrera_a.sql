-- Sesión A de la carrera: EDI (editar) guarda el recorrido de R_CAR y RETIENE
-- el bloqueo de la rutina hasta que run.sh lo suelta (borra rr.carrera_suelta).
\set ON_ERROR_STOP on
BEGIN;
SET ROLE authenticated;
SELECT rr.como('EDI');
SELECT paradas, pasos FROM public.guardar_recorrido_rutina(rr.id('R_CAR'), rr.rec('A1:BARRER'));
RESET ROLE;
-- Espera, con la rutina bloqueada, a que run.sh vea a B esperándola.
DO $$
BEGIN
  FOR i IN 1..300 LOOP
    EXIT WHEN NOT EXISTS (SELECT 1 FROM rr.carrera_suelta);
    PERFORM pg_sleep(0.05);
  END LOOP;
END $$;
COMMIT;
