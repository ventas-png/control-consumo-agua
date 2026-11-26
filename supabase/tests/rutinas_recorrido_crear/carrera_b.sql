-- Sesión B de la carrera: CRE (crear, sin editar) intenta el PRIMER recorrido
-- de la misma rutina mientras A la tiene bloqueada. Tiene que esperar a A y,
-- al ver lo que A dejó, responder «no existe»: ya no es nueva.
\set ON_ERROR_STOP on
SET ROLE authenticated;
SELECT rr.como('CRE');
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina(rr.id('R_CAR'), rr.rec('A2:VIDRIOS'))$$,
  'P0002', 'C1 · quien sólo crea espera al que edita y ya no la encuentra nueva');
RESET ROLE;
SELECT rr.chk(rr.foto(rr.id('R_CAR')), 'Apartamento 1AB: Barrido de piso',
  'C1 · el recorrido es el de A, sin mezclar el de B');
