\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

\set CO_EXISTENTE '11111111-1111-1111-1111-111111111111'
\set CO_NUEVA      '22222222-2222-2222-2222-222222222222'
\set PR_NUEVO      '22222222-3333-3333-3333-333333333333'
\set CO_AJENA      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set PR_AJENO      'aaaaaaaa-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
\set PR_PROPIO     '22222222-4444-4444-4444-444444444444'

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

-- Inicio vacío: sin cuentas tampoco hay mapeos, y el resolutor no inventa una
-- cuenta. La configuración incompleta se ve como «sin cuenta», no se rellena.
SELECT public.chk(
  (SELECT count(*) FROM public.conta_mapeo_cuentas WHERE company_id = :'CO_NUEVA'),
  0,
  'una empresa nueva no tiene mapeos inventados');

SELECT public.chk(
  (SELECT count(*) FROM (VALUES
     (public.conta_cuenta_para(:'CO_NUEVA', NULL, 'metodo_efectivo')),
     (public.conta_cuenta_para(:'CO_NUEVA', NULL, 'ingreso_cuota')),
     (public.conta_cuenta_para(:'CO_NUEVA', :'PR_NUEVO', 'cxc_cuotas'))) r(c)
    WHERE c IS NOT NULL),
  0,
  'sin catálogo, ningún evento resuelve a una cuenta');

-- La sesión queda anclada a la empresa nueva para probar la RPC expuesta.
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT '22222222-2222-2222-2222-222222222222'::uuid $$;

-- Rechazo en servidor: la RPC exige owner/admin (o superadmin). Los stubs
-- conceden superadmin a todo; aquí se simula un rol sin permiso y se restauran.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'viewer'::text $$;

SELECT public.chk_falla(
  $$SELECT public.conta_inicializar_catalogo('basico', NULL)$$,
  'No autorizado',
  'un usuario sin rol owner/admin no inicializa el catálogo');

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'contador'::text $$;
SELECT public.chk_falla(
  $$SELECT public.conta_inicializar_catalogo('latam', '22222222-3333-3333-3333-333333333333')$$,
  'No autorizado',
  'tampoco otro rol operativo, ni sobre un proyecto propio');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuentas WHERE company_id = :'CO_NUEVA'),
  0,
  'los intentos rechazados no dejan cuentas');

-- Un owner/admin sin superadmin sí puede (el permiso no depende del bypass).
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'admin'::text $$;

SELECT * FROM public.conta_inicializar_catalogo('basico', NULL);

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'company_owner'::text $$;

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

-- Jerarquía explícita por padre_id: cada cuenta cuelga de otra del MISMO
-- ledger con un nivel menos; las cinco clases son raíz.
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuentas c
    LEFT JOIN public.conta_cuentas p ON p.id = c.padre_id
    WHERE c.company_id = :'CO_NUEVA' AND c.project_id IS NULL
      AND (  (c.nivel = 1 AND c.padre_id IS NOT NULL)
          OR (c.nivel > 1 AND (p.id IS NULL
                               OR p.company_id <> c.company_id
                               OR p.project_id IS NOT NULL
                               OR p.nivel <> c.nivel - 1)))),
  0,
  'la plantilla básica encadena cada cuenta a su padre del mismo ledger');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuentas
    WHERE company_id = :'CO_NUEVA' AND project_id IS NULL AND nivel = 1 AND padre_id IS NULL),
  5,
  'la plantilla básica tiene cinco clases raíz');

SELECT public.chk_txt(
  (SELECT p.codigo FROM public.conta_cuentas c JOIN public.conta_cuentas p ON p.id = c.padre_id
    WHERE c.company_id = :'CO_NUEVA' AND c.project_id IS NULL AND c.codigo = '1101'),
  '11',
  'Caja y bancos (1101) cuelga de Efectivo y equivalentes (11)');

-- Cada mapeo de la plantilla apunta a una cuenta de detalle del mismo ledger.
SELECT public.chk(
  (SELECT count(*) FROM public.conta_mapeo_cuentas m
     JOIN public.conta_cuentas c ON c.id = m.cuenta_id
    WHERE m.company_id = :'CO_NUEVA' AND m.project_id IS NULL
      AND (c.project_id IS NOT NULL OR c.company_id <> m.company_id)),
  0,
  'los mapeos de la plantilla básica apuntan a su propio ledger');

SELECT public.chk_falla(
  $$SELECT public.conta_inicializar_catalogo('basico', NULL)$$,
  'CATALOGO_NO_VACIO',
  'una plantilla no se superpone sobre un catálogo ya iniciado');

SELECT public.chk_falla(
  $$SELECT public.conta_inicializar_catalogo('latam', NULL)$$,
  'CATALOGO_NO_VACIO',
  'ni siquiera con otra plantilla');

SELECT public.chk_txt(
  (SELECT count(*)::text || '/' ||
          (SELECT count(*) FROM public.conta_mapeo_cuentas WHERE company_id = :'CO_NUEVA' AND project_id IS NULL)::text
     FROM public.conta_cuentas WHERE company_id = :'CO_NUEVA' AND project_id IS NULL),
  '22/26',
  'la segunda inicialización no duplica cuentas ni mapeos');

-- El proyecto no hereda el catálogo de su empresa: resuelve en su propio
-- ledger, que todavía está vacío.
SELECT public.chk(
  (SELECT count(*) FROM (VALUES (public.conta_cuenta_para(:'CO_NUEVA', :'PR_NUEVO', 'metodo_efectivo'))) r(c)
    WHERE c IS NOT NULL),
  0,
  'un proyecto vacío no cae al catálogo de la empresa');

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

-- Sin guion, la jerarquía no se pierde: 110201 sigue colgando de 1102 por
-- padre_id, no por un prefijo del código.
SELECT public.chk_txt(
  (SELECT p.codigo FROM public.conta_cuentas c JOIN public.conta_cuentas p ON p.id = c.padre_id
    WHERE c.company_id = :'CO_NUEVA' AND c.project_id = :'PR_NUEVO' AND c.codigo = '110201'),
  '1102',
  '110201 cuelga de Bancos (1102) por padre_id');

-- Aislamiento: inicializar el proyecto no tocó el ledger de la empresa.
SELECT public.chk_txt(
  (SELECT count(*)::text || '/' ||
          (SELECT count(*) FROM public.conta_mapeo_cuentas WHERE company_id = :'CO_NUEVA' AND project_id IS NULL)::text
     FROM public.conta_cuentas WHERE company_id = :'CO_NUEVA' AND project_id IS NULL),
  '22/26',
  'el ledger de la empresa sigue igual tras inicializar el proyecto');

-- Un catálogo personalizado (una sola cuenta propia) no se completa ni se
-- sobrescribe con una plantilla.
INSERT INTO public.projects (id, company_id, nombre, moneda)
VALUES (:'PR_PROPIO', :'CO_NUEVA', 'Proyecto con catálogo propio', 'Q');
INSERT INTO public.conta_cuentas (company_id, project_id, codigo, nombre, tipo, naturaleza, nivel, es_detalle)
VALUES (:'CO_NUEVA', :'PR_PROPIO', '9', 'Mi cuenta propia', 'activo', 'deudora', 1, true);

SELECT public.chk_falla(
  format($$SELECT public.conta_inicializar_catalogo('basico', '%s')$$, :'PR_PROPIO'),
  'CATALOGO_NO_VACIO',
  'la plantilla no se aplica sobre un catálogo personalizado');

SELECT public.chk_txt(
  (SELECT count(*)::text || '/' || string_agg(codigo || ':' || nombre, ',') || '/' ||
          (SELECT count(*) FROM public.conta_mapeo_cuentas WHERE company_id = :'CO_NUEVA' AND project_id = :'PR_PROPIO')::text
     FROM public.conta_cuentas WHERE company_id = :'CO_NUEVA' AND project_id = :'PR_PROPIO'),
  '1/9:Mi cuenta propia/0',
  'el catálogo personalizado queda intacto y sin mapeos añadidos');

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

-- Al final, el catálogo que ya existía sigue exactamente como al principio.
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuentas
    WHERE company_id = :'CO_EXISTENTE' AND project_id IS NULL),
  49,
  'el catálogo existente no se tocó en toda la suite');
