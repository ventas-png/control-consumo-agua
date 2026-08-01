-- ════════════════════════════════════════════════════════════════════════════
-- PRE-FIX: reproduce el bug con las policies tal como están hoy en prod.
-- Si alguna de estas aserciones falla, el bug NO es el que describe la
-- migración 20260801000300 (o prod ya no está en ese estado).
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

SET ROLE authenticated;

-- ── Residente R (app_users.company_id NULL, como lo crea create-cliente-account)
SET test.user_id = '50000000-0000-0000-0000-000000000002';

SELECT public.chk((SELECT count(*) FROM public.anuncios_comunidad), 0,
  'BUG 1 reproducido: el residente NO ve ningún anuncio de su condominio');
SELECT public.chk((SELECT count(*) FROM public.broadcasts), 0,
  'BUG 2 reproducido: el residente NO ve el comunicado de difusión que lo tiene por destinatario');
SELECT public.chk((SELECT count(*) FROM public.broadcast_recipients), 0,
  'BUG 2 reproducido: el residente NO ve ni su propia fila de destinatario');

-- ── Residente LEGACY R3 (con company_id): ve los acuses de TODA la empresa ───
SET test.user_id = '50000000-0000-0000-0000-000000000003';
SELECT public.chk((SELECT count(*) FROM public.broadcast_recipients), 3,
  'FUGA reproducida: un residente con company_id ve los 3 destinatarios de la empresa, no solo el suyo');

-- ── Staff: la ruta que sí funciona (por eso el admin "ve" lo que publica) ────
SET test.user_id = '50000000-0000-0000-0000-000000000001';
SELECT public.chk((SELECT count(*) FROM public.anuncios_comunidad), 2,
  'Staff ve los 2 anuncios de su empresa (el admin no percibe el bug)');
SELECT public.chk((SELECT count(*) FROM public.broadcasts), 1,
  'Staff ve el comunicado de difusión de su empresa');

RESET ROLE;
