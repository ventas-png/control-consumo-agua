-- ════════════════════════════════════════════════════════════════════════════
-- POST-FIX: invariantes tras aplicar 20260801000300.
--   1-3  el residente ve lo suyo (anuncios de su proyecto, su difusión, su fila)
--   4-5  y NADA más (ni proyectos ajenos, ni acuses de otros residentes)
--   6-9  el staff conserva exactamente el acceso que tenía (CRUD incluido)
--   10   aislamiento entre empresas
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

SET ROLE authenticated;

-- ── 1-5 · Residente R (company_id NULL) ─────────────────────────────────────
SET test.user_id = '50000000-0000-0000-0000-000000000002';

SELECT public.chk((SELECT count(*) FROM public.anuncios_comunidad), 1,
  '1  el residente YA VE el anuncio de su condominio');
SELECT public.chk(
  (SELECT count(*) FROM public.anuncios_comunidad
    WHERE project_id = '22222222-0000-0000-0000-000000000002'), 0,
  '2  y NO ve el anuncio del proyecto donde no tiene unidad');
SELECT public.chk((SELECT count(*) FROM public.broadcasts), 1,
  '3  el residente YA VE el comunicado de difusión que lo tiene por destinatario');
SELECT public.chk((SELECT count(*) FROM public.broadcast_recipients), 1,
  '4  ve exactamente 1 fila de destinatario: la suya');
SELECT public.chk(
  (SELECT count(*) FROM public.broadcast_recipients
    WHERE cliente_id <> 'cccccccc-0000-0000-0000-000000000001'), 0,
  '5  no ve los acuses de lectura de los demás residentes');

-- El acuse de lectura propio (markBroadcastRead) sigue funcionando.
UPDATE public.broadcast_recipients SET read_at = now()
 WHERE cliente_id = 'cccccccc-0000-0000-0000-000000000001';
SELECT public.chk(
  (SELECT count(*) FROM public.broadcast_recipients WHERE read_at IS NOT NULL), 1,
  '6  el residente puede marcar SU comunicado como leído');

-- ── 7 · Residente LEGACY R3 (con company_id): la fuga queda cerrada ──────────
SET test.user_id = '50000000-0000-0000-0000-000000000003';
SELECT public.chk((SELECT count(*) FROM public.broadcast_recipients), 1,
  '7  el residente con company_id ya solo ve su propia fila (fuga cerrada)');

-- ── 8-11 · Staff de la empresa A: acceso intacto ────────────────────────────
SET test.user_id = '50000000-0000-0000-0000-000000000001';
SELECT public.chk((SELECT count(*) FROM public.anuncios_comunidad), 2,
  '8  el staff sigue viendo los 2 anuncios de su empresa');
SELECT public.chk((SELECT count(*) FROM public.broadcasts), 1,
  '9  el staff sigue viendo la difusión de su empresa');
SELECT public.chk((SELECT count(*) FROM public.broadcast_recipients), 3,
  '10 el staff sigue viendo los 3 destinatarios de su empresa');

INSERT INTO public.broadcasts (company_id, title, body, sent_by_id, sent_by_name)
VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', 'Nuevo', 'Cuerpo',
        '50000000-0000-0000-0000-000000000001', 'Staff A');
UPDATE public.broadcasts SET title = 'Nuevo (editado)' WHERE title = 'Nuevo';
DELETE FROM public.broadcasts WHERE title = 'Nuevo (editado)';
SELECT public.chk((SELECT count(*) FROM public.broadcasts), 1,
  '11 el staff conserva INSERT/UPDATE/DELETE sobre broadcasts (el FOR ALL partido en 4 no le quita nada)');

-- ── 12-13 · Aislamiento entre empresas ──────────────────────────────────────
SET test.user_id = '50000000-0000-0000-0000-000000000004';
SELECT public.chk((SELECT count(*) FROM public.broadcasts), 0,
  '12 el staff de otra empresa no ve la difusión ajena');
SELECT public.chk((SELECT count(*) FROM public.anuncios_comunidad), 0,
  '13 el staff de otra empresa no ve los anuncios ajenos');

RESET ROLE;
