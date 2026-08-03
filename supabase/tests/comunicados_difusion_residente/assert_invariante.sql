-- ════════════════════════════════════════════════════════════════════════════
-- Invariante de 20260801000400: una cuenta de cliente nunca lleva company_id.
--   14    normaliza el drift existente (R3 venía con company_id)
--   15-16 el trigger lo mantiene en INSERT y en UPDATE
--   17    el staff NO se ve afectado
--   18    con el company_id fuera, R3 deja de pasar por las ramas de staff que
--         sólo miran company_id (las que este PR no reescribe)
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- ── 14 · el drift quedó normalizado ────────────────────────────────────────
SELECT public.chk(
  (SELECT count(*) FROM public.app_users WHERE role = 'cliente' AND company_id IS NOT NULL), 0,
  '14 ninguna cuenta de cliente conserva company_id tras la migración');

-- ── 15 · INSERT: el trigger lo descarta ────────────────────────────────────
INSERT INTO public.app_users (id, full_name, role, company_id, cliente_id)
VALUES ('50000000-0000-0000-0000-000000000009', 'Residente nuevo', 'cliente',
        'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000009');
SELECT public.chk(
  (SELECT count(*) FROM public.app_users
    WHERE id = '50000000-0000-0000-0000-000000000009' AND company_id IS NULL), 1,
  '15 un INSERT de cliente CON company_id se guarda con NULL');

-- ── 16 · UPDATE: tampoco se lo puede volver a poner ────────────────────────
UPDATE public.app_users SET company_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
 WHERE id = '50000000-0000-0000-0000-000000000009';
SELECT public.chk(
  (SELECT count(*) FROM public.app_users
    WHERE id = '50000000-0000-0000-0000-000000000009' AND company_id IS NULL), 1,
  '16 un UPDATE que intenta re-ponerlo queda igualmente en NULL');

-- ── 17 · el staff conserva el suyo (el trigger sólo mira role = cliente) ────
UPDATE public.app_users SET full_name = 'Staff A (tocado)'
 WHERE id = '50000000-0000-0000-0000-000000000001';
SELECT public.chk(
  (SELECT count(*) FROM public.app_users
    WHERE id = '50000000-0000-0000-0000-000000000001'
      AND company_id = 'aaaaaaaa-0000-0000-0000-00000000000a'), 1,
  '17 el usuario de staff conserva su company_id intacto');

-- ── 18 · consecuencia: R3 ya no entra por una rama de staff "solo company_id"
-- Se modela con la MISMA forma que usan las policies que este PR no reescribe
-- (p. ej. comentarios_mensaje_portal_select): sin guard de rol, sólo company_id.
SET ROLE authenticated;
SET test.user_id = '50000000-0000-0000-0000-000000000003';
SELECT public.chk(
  (SELECT count(*) FROM public.broadcast_recipients
    WHERE company_id = public.get_my_company_id()), 0,
  '18 el residente legacy ya no casa una rama de staff basada sólo en company_id');
RESET ROLE;
