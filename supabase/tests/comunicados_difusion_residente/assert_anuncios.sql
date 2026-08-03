-- ════════════════════════════════════════════════════════════════════════════
-- 20260801000500: aviso al residente + acuse de lectura.
--   19-22 el trigger encola in_app a todos y email sólo a quien tiene correo,
--         acotado al proyecto del anuncio, con user_id en el payload
--   23    un anuncio inactivo (borrador) no avisa a nadie
--   24-25 el acuse: el residente sella el suyo y NO puede sellar el de otro
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- P1 tiene DOS residentes: C1 (con email) y C3 (sin email). P2 tiene a C2.
INSERT INTO public.anuncios_comunidad (id, company_id, project_id, titulo, contenido, publicado_por, activo)
VALUES ('a0000000-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-00000000000a',
        '11111111-0000-0000-0000-000000000001', 'Mantenimiento del ascensor',
        'El lunes de 9 a 13.', '50000000-0000-0000-0000-000000000001', true);

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE channel = 'in_app' AND payload->>'anuncio_id' = 'a0000000-0000-0000-0000-00000000000b'), 2,
  '19 in_app encolado para los DOS residentes del proyecto');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE channel = 'email' AND payload->>'anuncio_id' = 'a0000000-0000-0000-0000-00000000000b'), 1,
  '20 email sólo para el residente que tiene correo registrado');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'anuncio_id' = 'a0000000-0000-0000-0000-00000000000b'
      AND payload->>'cliente_id' = 'cccccccc-0000-0000-0000-000000000002'), 0,
  '21 el residente de OTRO proyecto no recibe nada');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'anuncio_id' = 'a0000000-0000-0000-0000-00000000000b'
      AND payload->>'user_id' IS NULL), 0,
  '22 todas las filas llevan user_id (el dispatcher lo necesita para las preferencias)');

-- ── 23 · borrador: activo = false no avisa ─────────────────────────────────
INSERT INTO public.anuncios_comunidad (id, company_id, project_id, titulo, contenido, publicado_por, activo)
VALUES ('a0000000-0000-0000-0000-00000000000c', 'aaaaaaaa-0000-0000-0000-00000000000a',
        '11111111-0000-0000-0000-000000000001', 'Borrador', 'Sin publicar',
        '50000000-0000-0000-0000-000000000001', false);
SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'anuncio_id' = 'a0000000-0000-0000-0000-00000000000c'), 0,
  '23 un anuncio inactivo (borrador) no encola ninguna notificación');

-- ── 24-25 · acuse de lectura ───────────────────────────────────────────────
SET ROLE authenticated;
SET test.user_id = '50000000-0000-0000-0000-000000000002';  -- residente R (cliente C1)

INSERT INTO public.anuncio_lecturas (anuncio_id, cliente_id, company_id)
VALUES ('a0000000-0000-0000-0000-00000000000b', 'cccccccc-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-00000000000a');
SELECT public.chk((SELECT count(*) FROM public.anuncio_lecturas), 1,
  '24 el residente sella SU acuse de lectura');

DO $$
BEGIN
  INSERT INTO public.anuncio_lecturas (anuncio_id, cliente_id, company_id)
  VALUES ('a0000000-0000-0000-0000-00000000000b', 'cccccccc-0000-0000-0000-000000000003',
          'aaaaaaaa-0000-0000-0000-00000000000a');
  RAISE EXCEPTION '❌ 25 el residente pudo sellar el acuse de OTRO residente';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK    25 no puede sellar el acuse de otro residente (RLS lo rechaza)';
END $$;

RESET ROLE;

-- ── 26 · el staff ve los acuses de su empresa (contador del tablón) ─────────
SET ROLE authenticated;
SET test.user_id = '50000000-0000-0000-0000-000000000001';
SELECT public.chk((SELECT count(*) FROM public.anuncio_lecturas), 1,
  '26 el staff ve los acuses de su empresa para el contador "X leyeron"');
RESET ROLE;
