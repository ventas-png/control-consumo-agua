-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261122000000 (Equipos junto a Suministros; las herramientas de las
-- actividades salen de equipos_comunes), ejercidas COMO cada persona.
--   A · esquema: columnas, CHECK, FK compuesta, índice parcial, trigger propio, permiso en
--       `operaciones`, y la puente LEGADA (inventario) sigue ahí
--   B · la puente a mano: equipo_id sella el tenant; ambos ids o ninguno → CHECK; equipo de otro
--       proyecto → trigger; inexistente → FK; repetido → índice parcial; el legado y lo nuevo conviven
--   C · vista previa: herramientas/equipo por nombre contra Equipos (de baja, ambiguo, repetido,
--       inexistente con la pista de dónde registrarlo); sin ver Equipos, mensaje claro
--   D · aplicar: la actividad nace con sus equipos (equipo_id, inventario_id NULL, sello)
--   E · recursos en bloque: p_equipos agrega/quita con conteos; de baja no se agrega pero sí se
--       quita; sin permiso de Equipos → PERMISO; otro proyecto e id de Inventario → ALCANCE
--   F · ACL: la firma nueva es la única, para authenticated y nunca anon; el trigger no se llama
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\i ../housekeeping_evidencias/lib.sql

CREATE OR REPLACE FUNCTION hkt.fila(p_vista jsonb, p_n int) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT f FROM jsonb_array_elements(p_vista->'filas') f WHERE (f->>'fila')::int = p_n $$;
CREATE OR REPLACE FUNCTION hkt.err(p_vista jsonb, p_n int, p_campo text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(e->>'mensaje', ' | ') FROM jsonb_array_elements(hkt.fila(p_vista, p_n)->'errores') e WHERE e->>'campo' = p_campo $$;
CREATE OR REPLACE FUNCTION hkt.n_err(p_vista jsonb, p_n int) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_array_length(hkt.fila(p_vista, p_n)->'errores') $$;
CREATE OR REPLACE FUNCTION hkt.n_ph() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT count(*)::int FROM public.plantilla_tarea_herramientas $$;
CREATE OR REPLACE FUNCTION hkt.pl_id(p_titulo text, p_proyecto uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id FROM public.plantillas_tarea_cargo WHERE titulo = p_titulo AND project_id = p_proyecto ORDER BY created_at DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION hkt.pe(p_pl uuid, p_eq uuid) RETURNS public.plantilla_tarea_herramientas LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.plantilla_tarea_herramientas WHERE plantilla_tarea_id = p_pl AND equipo_id = p_eq $$;
CREATE OR REPLACE FUNCTION hkt.pinv(p_pl uuid, p_inv uuid) RETURNS public.plantilla_tarea_herramientas LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.plantilla_tarea_herramientas WHERE plantilla_tarea_id = p_pl AND inventario_id = p_inv $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;

-- ── A · esquema ─────────────────────────────────────────────────────────────
DO $$
DECLARE leg public.plantilla_tarea_herramientas;
BEGIN
  PERFORM hkt.ok('A1 equipos_comunes.cantidad: int NOT NULL DEFAULT 1 con CHECK ≥ 0; foto_url text',
    (SELECT data_type = 'integer' AND is_nullable = 'NO' AND column_default = '1' FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'equipos_comunes' AND column_name = 'cantidad')
    AND (SELECT data_type = 'text' FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'equipos_comunes' AND column_name = 'foto_url')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipos_comunes_cantidad_check' AND conrelid = 'public.equipos_comunes'::regclass)
    AND (SELECT bool_and(cantidad = 1) FROM public.equipos_comunes));
  PERFORM hkt.ok('A2 la puente: equipo_id, inventario_id anulable, CHECK «exactamente uno», FK compuesta RESTRICT a equipos_comunes, índice único parcial',
    (SELECT is_nullable = 'YES' FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'plantilla_tarea_herramientas' AND column_name = 'inventario_id')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'plantilla_tarea_herramientas' AND column_name = 'equipo_id')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pt_herramienta_recurso_check' AND conrelid = 'public.plantilla_tarea_herramientas'::regclass)
    AND (SELECT pg_get_constraintdef(oid) LIKE '%REFERENCES equipos_comunes(id, company_id, project_id) ON DELETE RESTRICT' FROM pg_constraint WHERE conname = 'pt_herramienta_equipo_fk')
    AND (SELECT indexdef LIKE '%UNIQUE%(plantilla_tarea_id, equipo_id) WHERE (equipo_id IS NOT NULL)' FROM pg_indexes WHERE indexname = 'pt_herramienta_equipo_unica'));
  PERFORM hkt.ok('A3 el trigger de coherencia de la puente es el propio (plantilla_herramienta_coherente) y vigila equipo_id; el de insumos sigue siendo el genérico',
    (SELECT pg_get_triggerdef(oid) LIKE '%UPDATE OF plantilla_tarea_id, inventario_id, equipo_id, company_id, project_id%EXECUTE FUNCTION plantilla_herramienta_coherente()'
       FROM pg_trigger WHERE tgname = 'trg_pt_her_coherente' AND tgrelid = 'public.plantilla_tarea_herramientas'::regclass)
    AND (SELECT pg_get_triggerdef(oid) LIKE '%plantilla_recurso_coherente(''suministros_condominio'', ''suministro_id'')'
       FROM pg_trigger WHERE tgname = 'trg_pt_sum_coherente' AND tgrelid = 'public.plantilla_tarea_suministros'::regclass));
  PERFORM hkt.ok('A4 el permiso del tab y sus acciones están en la categoría operaciones',
    (SELECT bool_and(category = 'operaciones') AND count(*) = 3 FROM public.permissions WHERE key LIKE 'condominios.tab.equipos%'));
  leg := hkt.pinv(hkt.pl(1), hkt.inv(1));
  PERFORM hkt.ok('A5 la puente LEGADA (Trapeador de Inventario) sigue ahí: inventario_id lleno, equipo_id NULL',
    leg.id IS NOT NULL AND leg.equipo_id IS NULL AND leg.inventario_id = hkt.inv(1) AND hkt.n_ph() = 1);
END $$;

-- ── B · la puente a mano ────────────────────────────────────────────────────
DO $$
DECLARE r public.plantilla_tarea_herramientas; n0 int := hkt.n_ph();
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.plantilla_tarea_herramientas (company_id, project_id, plantilla_tarea_id, equipo_id, cantidad, obligatoria)
    VALUES (hkt.cb(), hkt.pb1(), hkt.pl(1), hkt.eq(1), 2, true);
  r := hkt.pe(hkt.pl(1), hkt.eq(1));
  PERFORM hkt.ok('B1 vincular un equipo: company/project los sella la plantilla (lo que mandó el cliente se ignora) y creado_por queda sellado',
    r.company_id = hkt.ca() AND r.project_id = hkt.pa1() AND r.creado_por = hkt.uid(3) AND r.cantidad = 2 AND r.obligatoria AND r.inventario_id IS NULL);
  PERFORM hkt.ok('B2 ambos ids a la vez (sin chocar con ningún UNIQUE) → 23514 por el CHECK; ninguno → 23514',
    hkt.estado_de(format('INSERT INTO public.plantilla_tarea_herramientas (company_id, project_id, plantilla_tarea_id, inventario_id, equipo_id) VALUES (%L, %L, %L, %L, %L)', hkt.ca(), hkt.pa1(), hkt.pl(1), hkt.inv(2), hkt.eq(2))) = '23514'
    AND hkt.estado_de(format('INSERT INTO public.plantilla_tarea_herramientas (company_id, project_id, plantilla_tarea_id) VALUES (%L, %L, %L)', hkt.ca(), hkt.pa1(), hkt.pl(1))) = '23514');
  PERFORM hkt.ok('B3 un equipo de OTRO proyecto (PA2) en una actividad de PA1 → 23514 (trigger: otra empresa o proyecto)',
    hkt.estado_de(format('INSERT INTO public.plantilla_tarea_herramientas (company_id, project_id, plantilla_tarea_id, equipo_id) VALUES (%L, %L, %L, %L)', hkt.ca(), hkt.pa1(), hkt.pl(1), hkt.eq(7))) = '23514'
    AND hkt.mensaje_de(format('INSERT INTO public.plantilla_tarea_herramientas (company_id, project_id, plantilla_tarea_id, equipo_id) VALUES (%L, %L, %L, %L)', hkt.ca(), hkt.pa1(), hkt.pl(1), hkt.eq(7))) LIKE 'PLANTILLA_RECURSO:%otra empresa o a otro proyecto%');
  PERFORM hkt.ok('B4 un equipo inexistente → 23503',
    hkt.estado_de(format('INSERT INTO public.plantilla_tarea_herramientas (company_id, project_id, plantilla_tarea_id, equipo_id) VALUES (%L, %L, %L, %L)', hkt.ca(), hkt.pa1(), hkt.pl(1), gen_random_uuid())) = '23503');
  PERFORM hkt.ok('B5 el mismo equipo dos veces en la misma actividad → 23505 (índice único parcial)',
    hkt.estado_de(format('INSERT INTO public.plantilla_tarea_herramientas (company_id, project_id, plantilla_tarea_id, equipo_id) VALUES (%L, %L, %L, %L)', hkt.ca(), hkt.pa1(), hkt.pl(1), hkt.eq(1))) = '23505');
  PERFORM hkt.ok('B6 el vínculo legado (Inventario) y el nuevo (Equipos) conviven en la misma actividad',
    hkt.n_ph() = n0 + 1 AND (hkt.pinv(hkt.pl(1), hkt.inv(1))).id IS NOT NULL AND (hkt.pe(hkt.pl(1), hkt.eq(1))).id IS NOT NULL);
  PERFORM hkt.root();
END $$;

-- ── C · vista previa ────────────────────────────────────────────────────────
DO $$
DECLARE v jsonb; d jsonb;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  v := public.plantillas_importar_previsualizar(hkt.pa1(), $j$[
    {"titulo":"Lavado de fachada","cargo":"conserje","servicio":"limpieza","duracion_min":"30","herramientas":"hidrolavadora x2!","equipo":"Pulidora"},
    {"titulo":"Fila 2","cargo":"conserje","servicio":"otro","equipo":"Aspiradora"},
    {"titulo":"Fila 3","cargo":"conserje","servicio":"otro","herramientas":"Dup"},
    {"titulo":"Fila 4","cargo":"conserje","servicio":"otro","herramientas":"Trapeador","equipo":"trapeador"},
    {"titulo":"Fila 5","cargo":"conserje","servicio":"otro","equipo":"Nada"},
    {"titulo":"Fila 6","cargo":"conserje","servicio":"otro","herramientas":"Trapeador x 1.5"}
  ]$j$::jsonb, 'equipos.csv');
  d := hkt.fila(v, 1)->'datos';
  PERFORM hkt.ok('C1 herramientas y equipo se resuelven contra EQUIPOS por nombre (sin distinguir mayúsculas) y viajan en recursos.equipos con la categoría del equipo',
    hkt.n_err(v, 1) = 0 AND (d->>'n_recursos')::int = 2 AND jsonb_array_length(d->'recursos'->'equipos') = 2 AND d->'recursos' ? 'inventario' = false
    AND (SELECT count(*) FROM jsonb_array_elements(d->'recursos'->'equipos') x WHERE (x->>'id')::uuid = hkt.eq(1) AND (x->>'cantidad')::int = 2 AND (x->>'obligatoria')::boolean AND x->>'categoria' = 'herramienta') = 1
    AND (SELECT count(*) FROM jsonb_array_elements(d->'recursos'->'equipos') x WHERE (x->>'id')::uuid = hkt.eq(2) AND (x->>'cantidad')::int = 1 AND NOT (x->>'obligatoria')::boolean AND x->>'categoria' = 'limpieza') = 1);
  PERFORM hkt.ok('C2 un equipo DE BAJA → error que lo dice', hkt.err(v, 2, 'equipo') LIKE '%de baja%');
  PERFORM hkt.ok('C3 nombre ambiguo → error que pide renombrar en Equipos', hkt.err(v, 3, 'herramientas') LIKE 'Hay 2 equipos llamados%Renombra uno en Equipos.');
  PERFORM hkt.ok('C4 el mismo equipo en herramientas y en equipo → se repite', hkt.err(v, 4, 'equipo') LIKE '%se repite en la misma fila.' AND hkt.err(v, 4, 'herramientas') IS NULL);
  PERFORM hkt.ok('C5 inexistente → error con la pista de dónde registrarlo', hkt.err(v, 5, 'equipo') LIKE 'El equipo «Nada» no existe%Operaciones → Equipos.');
  PERFORM hkt.ok('C6 cantidad decimal → entero', hkt.err(v, 6, 'herramientas') LIKE '%entero%');
  PERFORM public.plantillas_importar_descartar((v->>'lote_id')::uuid);

  PERFORM hkt.como(hkt.uid(14));
  v := public.plantillas_importar_previsualizar(hkt.pa1(), '[{"titulo":"Eva eq","cargo":"conserje","servicio":"otro","insumos":"Escoba","herramientas":"Hidrolavadora","equipo":"Pulidora"}]'::jsonb, 'g.csv');
  PERFORM hkt.ok('C7 sin permiso de ver EQUIPOS: herramientas y equipo fallan con un mensaje claro (no «no existe»); el insumo sí se resuelve',
    (v->'resumen'->>'con_error')::int = 1 AND hkt.err(v, 1, 'herramientas') LIKE '%ver la pestaña Equipos%'
    AND hkt.err(v, 1, 'equipo') LIKE '%ver la pestaña Equipos%' AND hkt.err(v, 1, 'insumos') IS NULL);
  PERFORM public.plantillas_importar_descartar((v->>'lote_id')::uuid);
  PERFORM hkt.root();
END $$;

-- ── D · aplicar ─────────────────────────────────────────────────────────────
DO $$
DECLARE v jsonb; r jsonb; p uuid; x public.plantilla_tarea_herramientas;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  v := public.plantillas_importar_previsualizar(hkt.pa1(), $j$[
    {"titulo":"Lavado de fachada","cargo":"conserje","servicio":"limpieza","duracion_min":"30","insumos":"Escoba","herramientas":"Hidrolavadora x2!","equipo":"Pulidora"}
  ]$j$::jsonb, 'equipos.csv');
  r := public.plantillas_importar_aplicar((v->>'lote_id')::uuid);
  p := hkt.pl_id('Lavado de fachada', hkt.pa1());
  PERFORM hkt.ok('D1 aplicar crea la actividad con 1 insumo y 2 herramientas/equipos', (r->>'actividades_creadas')::int = 1
    AND (r->>'insumos_vinculados')::int = 1 AND (r->>'herramientas_vinculadas')::int = 2 AND p IS NOT NULL);
  x := hkt.pe(p, hkt.eq(1));
  PERFORM hkt.ok('D2 las puentes nacen con equipo_id, inventario_id NULL, cantidad, obligatoria, tenant y creado_por',
    x.id IS NOT NULL AND x.inventario_id IS NULL AND x.cantidad = 2 AND x.obligatoria AND x.company_id = hkt.ca() AND x.project_id = hkt.pa1() AND x.creado_por = hkt.uid(3)
    AND (hkt.pe(p, hkt.eq(2))).id IS NOT NULL AND NOT (hkt.pe(p, hkt.eq(2))).obligatoria);
  PERFORM hkt.root();
END $$;

-- ── E · recursos en bloque ──────────────────────────────────────────────────
DO $$
DECLARE p1 uuid := hkt.pl(1); p2 uuid := hkt.pl_id('Lavado de fachada', hkt.pa1()); r jsonb; h0 int; msg text;
        eq1 constant text := '[{"id":"b3000000-0000-0000-0000-000000000001","cantidad":3,"obligatoria":true},{"id":"b3000000-0000-0000-0000-000000000003"}]';
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  r := public.plantillas_recursos_en_bloque(hkt.pa1(), ARRAY[p1, p2], 'agregar', '[]'::jsonb, eq1::jsonb);
  PERFORM hkt.ok('E1 agregar Hidrolavadora + Trapeador a 2 actividades: 4 pares, 2 agregados (la Hidrolavadora ya estaba en ambas) con cantidad y obligatoria',
    (r->>'plantillas')::int = 2 AND (r->>'recursos')::int = 2 AND (r->>'pares')::int = 4 AND (r->>'agregados')::int = 2 AND (r->>'ya_estaban')::int = 2
    AND (hkt.pe(p1, hkt.eq(3))).cantidad = 1 AND (hkt.pe(p2, hkt.eq(3))).id IS NOT NULL AND (hkt.pe(p1, hkt.eq(1))).cantidad = 2);
  r := public.plantillas_recursos_en_bloque(hkt.pa1(), ARRAY[p1, p2], 'agregar', '[]'::jsonb, eq1::jsonb);
  PERFORM hkt.ok('E2 repetir: 0 agregados, 4 ya estaban (ON CONFLICT sobre el índice parcial)', (r->>'agregados')::int = 0 AND (r->>'ya_estaban')::int = 4);
  r := public.plantillas_recursos_en_bloque(hkt.pa1(), ARRAY[p1, p2], 'quitar', '[]'::jsonb, '[{"id":"b3000000-0000-0000-0000-000000000003"}]'::jsonb);
  PERFORM hkt.ok('E3 quitar el Trapeador de las 2: 2 quitados; la puente LEGADA (Inventario) no se toca',
    (r->>'quitados')::int = 2 AND (hkt.pe(p1, hkt.eq(3))).id IS NULL AND (hkt.pinv(p1, hkt.inv(1))).id IS NOT NULL);
  h0 := hkt.n_ph();
  PERFORM hkt.ok('E4 un equipo DE BAJA no se agrega → 23514 y nada escrito; quitarlo sí se admite (0 quitados)',
    hkt.estado_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p2, 'agregar', '[]', '[{"id":"b3000000-0000-0000-0000-000000000004"}]')) = '23514'
    AND hkt.n_ph() = h0
    AND (public.plantillas_recursos_en_bloque(hkt.pa1(), ARRAY[p2], 'quitar', '[]'::jsonb, '[{"id":"b3000000-0000-0000-0000-000000000004"}]'::jsonb)->>'quitados')::int = 0);
  PERFORM hkt.ok('E5 un equipo de OTRO proyecto → ALCANCE; un id de INVENTARIO ya no vale como equipo → ALCANCE',
    hkt.mensaje_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p2, 'agregar', '[]', '[{"id":"b3000000-0000-0000-0000-000000000007"}]')) LIKE 'PLANTILLAS_BLOQUE_ALCANCE%equipos%'
    AND hkt.mensaje_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p2, 'agregar', '[]', '[{"id":"ad000000-0000-0000-0000-000000000003"}]')) LIKE 'PLANTILLAS_BLOQUE_ALCANCE%');
  PERFORM hkt.ok('E6 cantidad decimal → RECURSO',
    hkt.mensaje_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p2, 'agregar', '[]', '[{"id":"b3000000-0000-0000-0000-000000000003","cantidad":1.5}]')) LIKE 'PLANTILLAS_BLOQUE_RECURSO%');
  PERFORM hkt.como(hkt.uid(14));
  msg := hkt.mensaje_de(format('SELECT public.plantillas_recursos_en_bloque(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, %L::jsonb)', hkt.pa1(), p2, 'agregar', '[]', '[{"id":"b3000000-0000-0000-0000-000000000003"}]'));
  PERFORM hkt.ok('E7 quien edita pero no ve EQUIPOS: herramientas → PERMISO con mensaje claro; insumos sí',
    msg LIKE 'PLANTILLAS_BLOQUE_PERMISO%Equipos%'
    AND (public.plantillas_recursos_en_bloque(hkt.pa1(), ARRAY[p2], 'agregar', '[{"id":"ac000000-0000-0000-0000-000000000002"}]'::jsonb, '[]'::jsonb)->>'agregados')::int = 1);
  PERFORM hkt.como(hkt.uid(10));
  PERFORM hkt.ok('E8 quien no ve Suministros pero sí Equipos: el equipo entra (1 agregado)',
    (public.plantillas_recursos_en_bloque(hkt.pa1(), ARRAY[p2], 'agregar', '[]'::jsonb, '[{"id":"b3000000-0000-0000-0000-000000000003"}]'::jsonb)->>'agregados')::int = 1);
  PERFORM hkt.root();
END $$;

-- ── F · ACL ─────────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM hkt.ok('F1 plantillas_recursos_en_bloque: una sola firma, con p_equipos (sin p_inventario), para authenticated y nunca anon',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'plantillas_recursos_en_bloque') = 1
    AND (SELECT pg_get_function_arguments(p.oid) LIKE '%p_equipos jsonb%' AND pg_get_function_arguments(p.oid) NOT LIKE '%p_inventario%'
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'plantillas_recursos_en_bloque')
    AND has_function_privilege('authenticated', 'public.plantillas_recursos_en_bloque(uuid,uuid[],text,jsonb,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.plantillas_recursos_en_bloque(uuid,uuid[],text,jsonb,jsonb)', 'EXECUTE'));
  PERFORM hkt.ok('F2 las RPC siguen SECURITY INVOKER; el trigger de coherencia es DEFINER y nadie lo ejecuta directo',
    (SELECT bool_and(NOT prosecdef) FROM pg_proc WHERE proname IN ('plantillas_import_evaluar', 'plantillas_importar_aplicar', 'plantillas_recursos_en_bloque'))
    AND (SELECT prosecdef FROM pg_proc WHERE proname = 'plantilla_herramienta_coherente')
    AND NOT has_function_privilege('authenticated', 'public.plantilla_herramienta_coherente()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.plantilla_herramienta_coherente()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.plantillas_import_evaluar(uuid,uuid,jsonb,int)', 'EXECUTE'));
END $$;
