\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

\set CO_EXISTENTE '11111111-1111-1111-1111-111111111111'
\set CO_NUEVA      '22222222-2222-2222-2222-222222222222'
\set PR_NUEVO      '22222222-3333-3333-3333-333333333333'
\set CO_AJENA      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set PR_AJENO      'aaaaaaaa-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

-- Lo que ya existía no se reescribe ni se renumera.
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuentas
    WHERE company_id = :'CO_EXISTENTE' AND project_id IS NULL),
  49,
  'el catálogo existente conserva sus 49 cuentas');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuentas
    WHERE company_id = :'CO_EXISTENTE' AND project_id IS NULL AND codigo = '1102-01'),
  1,
  'el código heredado de un catálogo existente no se modifica');

-- Empresas/proyectos nuevos nacen vacíos.
INSERT INTO public.companies (id, nombre, default_currency)
VALUES (:'CO_NUEVA', 'Empresa nueva', 'GTQ');

INSERT INTO public.projects (id, company_id, nombre, moneda)
VALUES (:'PR_NUEVO', :'CO_NUEVA', 'Proyecto nuevo', 'Q');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuentas WHERE company_id = :'CO_NUEVA'),
  0,
  'una empresa y su proyecto nuevos nacen sin catálogo impuesto');

-- La sesión queda anclada a la empresa nueva para probar la RPC expuesta.
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT '22222222-2222-2222-2222-222222222222'::uuid $$;

SELECT * FROM public.conta_inicializar_catalogo('basico', NULL);

SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuentas
    WHERE company_id = :'CO_NUEVA' AND project_id IS NULL),
  22,
  'la plantilla básica crea exactamente 22 cuentas');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_mapeo_cuentas
    WHERE company_id = :'CO_NUEVA' AND project_id IS NULL),
  26,
  'la plantilla básica deja 23 eventos operativos y 3 especiales mapeados');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuentas
    WHERE company_id = :'CO_NUEVA' AND project_id IS NULL
      AND codigo ~ '[^0-9]'),
  0,
  'todos los códigos de la plantilla básica son numéricos');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuentas
    WHERE company_id = :'CO_NUEVA' AND project_id IS NULL AND es_sistema),
  0,
  'las cuentas elegidas como plantilla no quedan bloqueadas como sistema');

SELECT public.chk_falla(
  $$SELECT public.conta_inicializar_catalogo('basico', NULL)$$,
  'CATALOGO_NO_VACIO',
  'una plantilla no se superpone sobre un catálogo ya iniciado');

-- El proyecto de la misma empresa puede elegir otra plantilla, por separado.
SELECT * FROM public.conta_inicializar_catalogo('latam', :'PR_NUEVO');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuentas
    WHERE company_id = :'CO_NUEVA' AND project_id = :'PR_NUEVO'),
  49,
  'la plantilla LATAM crea el catálogo completo sólo en el ledger elegido');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuentas
    WHERE company_id = :'CO_NUEVA' AND project_id = :'PR_NUEVO'
      AND codigo = '110201'),
  1,
  'la plantilla LATAM nueva usa 110201 sin guion');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuentas
    WHERE company_id = :'CO_NUEVA' AND project_id = :'PR_NUEVO'
      AND codigo LIKE '%-%'),
  0,
  'ningún código de la plantilla LATAM nueva usa guiones');

-- Un project_id de otro tenant nunca puede usarse para sembrar fuera del scope.
INSERT INTO public.companies (id, nombre, default_currency)
VALUES (:'CO_AJENA', 'Empresa ajena', 'GTQ');
INSERT INTO public.projects (id, company_id, nombre, moneda)
VALUES (:'PR_AJENO', :'CO_AJENA', 'Proyecto ajeno', 'Q');

SELECT public.chk_falla(
  format($$SELECT public.conta_inicializar_catalogo('basico', '%s')$$, :'PR_AJENO'),
  'no pertenece',
  'la RPC rechaza proyectos de otra empresa');

SELECT public.chk(
  has_function_privilege('authenticated', 'public.conta_inicializar_catalogo(text,uuid)', 'EXECUTE')::int,
  1,
  'authenticated puede ejecutar la RPC pública');

SELECT public.chk(
  has_function_privilege('anon', 'public.conta_inicializar_catalogo(text,uuid)', 'EXECUTE')::int,
  0,
  'anon no puede ejecutar la RPC');
