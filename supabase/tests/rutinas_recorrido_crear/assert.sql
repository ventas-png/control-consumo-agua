-- ============================================================================
-- INVARIANTES de 20261225000000: con CREAR y sin EDITAR se guarda el recorrido
-- de la rutina que uno acaba de crear, y nada más.
--
-- Corre sobre la cadena REAL + los dos padrones, en dos fases (psql -v fase=…):
--
--   antes    CONTROL NEGATIVO, sin la migración: CRE crea la cabecera y el
--            recorrido muere en P0002; la rutina queda creada y vacía.
--   despues  con la migración:
--     N · NUEVA       CRE completa la rutina que el fallo dejó vacía, crea otra
--                     con su recorrido, y reintenta después de una foto
--                     rechazada sin que quede nada a medias.
--     E · EXISTENTE   con recorrido —paradas, aunque vacías, o un paso legado—
--                     cambiarlo es editar: P0002 para CRE, y EDI (editar sin
--                     crear) lo sigue reescribiendo.
--     A · AJENA       la de otra persona, la de alguien que ya no puede crear y
--                     la de otra empresa: P0002; el helper no las bloquea.
--     G · GRANTS      anon no invoca ni la RPC ni el helper.
-- La carrera entre dos sesiones va aparte (run.sh, «carrera»).
-- ============================================================================
\set ON_ERROR_STOP on
SELECT :'fase' = 'antes' AS es_antes \gset

SET ROLE authenticated;
SELECT rr.como('CRE');

-- La cabecera: con crear, la policy INSERT de rutinas_limpieza la deja pasar.
INSERT INTO public.rutinas_limpieza (id, company_id, project_id, nombre, servicio)
SELECT rr.id('R_ANTES'), rr.id('D'), rr.id('D1'), 'Creada por CRE', 'limpieza'
WHERE NOT EXISTS (SELECT 1 FROM public.rutinas_limpieza WHERE id = rr.id('R_ANTES'));
SELECT rr.chk((SELECT creado_por FROM public.rutinas_limpieza WHERE id = rr.id('R_ANTES')),
  rr.id('CRE'), 'la base sella a CRE como quien creó la rutina');

\if :es_antes

SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina(rr.id('R_ANTES'), rr.rec('A1:BARRER', 'A2:'))$$,
  'P0002', 'ANTES · con crear y sin editar, el recorrido de SU rutina nueva muere en «no existe»');
SELECT rr.chk(rr.foto(rr.id('R_ANTES')), '', 'ANTES · y la cabecera queda creada sin recorrido');

\else

-- ── N · la rutina nueva ──────────────────────────────────────────────────────
SELECT rr.chk(
  (SELECT paradas || '/' || pasos FROM public.guardar_recorrido_rutina(rr.id('R_ANTES'), rr.rec('A1:BARRER', 'A2:'))),
  '2/1', 'N1 · CRE completa la rutina que el fallo de antes dejó vacía');
SELECT rr.chk(rr.foto(rr.id('R_ANTES')), 'Apartamento 1AB: Barrido de piso | Apartamento 1C: ',
  'N1 · con el recorrido que mandó');

INSERT INTO public.rutinas_limpieza (id, company_id, project_id, nombre, servicio)
VALUES (rr.id('R_NUEVA'), rr.id('D'), rr.id('D1'), 'Nueva de CRE', 'limpieza');
SELECT rr.chk(
  (SELECT paradas || '/' || pasos FROM public.guardar_recorrido_rutina(rr.id('R_NUEVA'),
     rr.rec('A3:VIDRIOS,BARRER?', 'A1:BARRER'))),
  '2/3', 'N2 · crear una rutina completa: cabecera y recorrido');
SELECT rr.chk(rr.foto(rr.id('R_NUEVA')),
  'Gradas: Limpieza de vidrios, Barrido de piso? | Apartamento 1AB: Barrido de piso',
  'N2 · áreas en orden, actividades en orden, la obligatoriedad viaja');
SELECT rr.chk(
  (SELECT count(*)::int FROM public.rutina_areas WHERE rutina_id = rr.id('R_NUEVA') AND creado_por = rr.id('CRE')),
  2, 'N2 · las paradas las escribió CRE (bajo SU RLS: el helper no escribe)');

INSERT INTO public.rutinas_limpieza (id, company_id, project_id, nombre, servicio)
VALUES (rr.id('R_FALLA'), rr.id('D'), rr.id('D1'), 'Falla y reintenta', 'limpieza');
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina(rr.id('R_FALLA'), rr.rec('A1:BARRER', 'AX:'))$$,
  '23514', 'N3 · un área de otro proyecto rechaza la foto entera');
SELECT rr.chk(rr.foto(rr.id('R_FALLA')), '', 'N3 · y no queda nada a medias: sigue nueva');
SELECT rr.chk(
  (SELECT paradas || '/' || pasos FROM public.guardar_recorrido_rutina(rr.id('R_FALLA'), rr.rec('A1:BARRER'))),
  '1/1', 'N3 · así que reintentar el recorrido funciona («volvé a guardar»)');

-- ── E · la rutina que ya tiene recorrido ─────────────────────────────────────
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina(rr.id('R_NUEVA'), rr.rec('A2:BARRER'))$$,
  'P0002', 'E1 · volver a guardar SU rutina con recorrido es editar: «no existe»');
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina(rr.id('R_NUEVA'), '[]'::jsonb)$$,
  'P0002', 'E1 · tampoco vaciarla');
SELECT rr.chk(rr.foto(rr.id('R_NUEVA')),
  'Gradas: Limpieza de vidrios, Barrido de piso? | Apartamento 1AB: Barrido de piso',
  'E1 · el recorrido sigue intacto');

INSERT INTO public.rutinas_limpieza (id, company_id, project_id, nombre, servicio)
VALUES (rr.id('R_PAR'), rr.id('D'), rr.id('D1'), 'Sólo paradas', 'limpieza');
SELECT rr.chk(
  (SELECT paradas || '/' || pasos FROM public.guardar_recorrido_rutina(rr.id('R_PAR'), rr.rec('A1:', 'A2:'))),
  '2/0', 'E2 · el primer recorrido puede ser sólo áreas, sin actividades');
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina(rr.id('R_PAR'), rr.rec('A3:BARRER'))$$,
  'P0002', 'E2 · y con paradas, aunque vacías, ya tiene recorrido');
SELECT rr.chk(rr.foto(rr.id('R_PAR')), 'Apartamento 1AB:  | Apartamento 1C: ', 'E2 · intacto');

SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina(rr.id('R_LEG'), rr.rec('A1:VIDRIOS'))$$,
  'P0002', 'E3 · un paso legado (sin parada) también es recorrido');
SELECT rr.chk(rr.foto(rr.id('R_LEG')), '(sin área): Barrido de piso', 'E3 · intacto');

SELECT rr.como('EDI');
SELECT rr.chk(
  (SELECT paradas || '/' || pasos FROM public.guardar_recorrido_rutina(rr.id('R_NUEVA'), rr.rec('A1:BARRER,VIDRIOS'))),
  '1/2', 'E4 · con editar (y sin crear) se reescribe la rutina existente, como siempre');
SELECT rr.chk(rr.foto(rr.id('R_NUEVA')), 'Apartamento 1AB: Barrido de piso, Limpieza de vidrios',
  'E4 · gana su foto completa: lo que no vino se borró');

-- ── A · la rutina ajena ──────────────────────────────────────────────────────
SELECT rr.como('CRE');
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina(rr.id('R_CRE2'), rr.rec('A1:BARRER'))$$,
  'P0002', 'A1 · la rutina vacía que creó OTRA persona con el mismo rol: «no existe»');
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina(rr.id('R_OPL'), rr.rec('A1:BARRER'))$$,
  'P0002', 'A2 · ni la de alguien con todo el permiso');
SELECT rr.chk(rr.foto(rr.id('R_CRE2')) || rr.foto(rr.id('R_OPL')), '', 'A1-A2 · las dos siguen vacías');

SELECT rr.chk(public.rutina_bloquear_si_nueva(rr.id('R_C')), false,
  'A3 · el helper no bloquea la rutina que CRE creó en OTRA empresa');
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina(rr.id('R_C'), rr.rec('AC:'))$$,
  'P0002', 'A3 · ni la RPC la encuentra');

SELECT rr.como('VER');
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina(rr.id('R_VER'), rr.rec('A1:BARRER'))$$,
  'P0002', 'A4 · la creó, pero ya no puede crear: «no existe»');
SELECT rr.chk(public.rutina_bloquear_si_nueva(rr.id('R_VER')), false, 'A4 · el helper tampoco la bloquea');

SELECT rr.como('OPC');
SELECT rr.error($$SELECT * FROM public.guardar_recorrido_rutina(rr.id('R_CAR'), rr.rec('A1:BARRER'))$$,
  'P0002', 'A5 · la empresa vecina, con todo el permiso, tampoco');

SELECT rr.como('CRE');
SELECT rr.chk(public.rutina_bloquear_si_nueva(rr.id('R_CAR')), true,
  'A · el helper sí bloquea la rutina nueva y propia (control de que lo de arriba no es un «false» fijo)');
SELECT rr.chk(rr.foto(rr.id('R_CAR')), '', 'A · y no escribe nada');

-- ── G · grants ───────────────────────────────────────────────────────────────
RESET ROLE;
SELECT rr.chk(has_function_privilege('anon', 'public.rutina_bloquear_si_nueva(uuid)', 'EXECUTE'), false,
  'G1 · anon no invoca el helper');
SELECT rr.chk(has_function_privilege('anon', 'public.guardar_recorrido_rutina(uuid, jsonb)', 'EXECUTE'), false,
  'G1 · ni la RPC');
SELECT rr.chk(has_function_privilege('authenticated', 'public.rutina_bloquear_si_nueva(uuid)', 'EXECUTE'), true,
  'G2 · authenticated sí: la RPC es INVOKER y lo llama como quien la invoca');
SELECT rr.chk(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.guardar_recorrido_rutina(uuid, jsonb)'::regprocedure), false,
  'G3 · la RPC sigue siendo SECURITY INVOKER');

\endif
RESET ROLE;
