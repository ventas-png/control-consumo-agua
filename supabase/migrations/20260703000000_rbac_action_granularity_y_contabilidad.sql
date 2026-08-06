-- ─── Granularidad por acción en el catálogo RBAC ─────────────────────────────
-- (a) Siembra el módulo platform.contabilidad: el módulo Contabilidad se agregó
--     a CONFIGURABLE_MODULES después de la unificación RBAC (migraciones
--     20260518000011/13) y nunca se sembraron sus permisos, por eso no aparecía
--     en el editor de roles ni podía otorgarse a usuarios no exentos.
-- (b) Agrega las acciones approve (autorizar/denegar) y delete (eliminar) a los
--     módulos agua.* y platform.* existentes (antes solo view/create/edit/
--     change_status).
-- (c) Agrega acciones por tab de condominios: la clave base
--     condominios.tab.<tab> conserva su semántica de visibilidad (Ver) para no
--     romper roles existentes; se agregan condominios.tab.<tab>.<action> para
--     create / edit / change_status / approve / delete. La UI resuelve estas
--     claves con fallback al permiso legado platform.condominios.<action>.
-- (d) Grants para los roles admin del sistema, que por descripción tienen
--     "acceso completo" y deben cubrir también las claves nuevas.
-- Idempotente vía ON CONFLICT.

-- 1. Módulo platform.contabilidad (6 acciones)
DO $$
DECLARE
  actions text[][] := ARRAY[
    ['view',          'Ver'],
    ['create',        'Crear'],
    ['edit',          'Editar'],
    ['change_status', 'Cambiar estado'],
    ['approve',       'Autorizar / Denegar'],
    ['delete',        'Eliminar']
  ];
  j int;
BEGIN
  FOR j IN 1..array_length(actions, 1) LOOP
    INSERT INTO public.permissions (key, category, label, description) VALUES (
      'platform.contabilidad.' || actions[j][1],
      'platform_contabilidad',
      actions[j][2] || ' — Contabilidad',
      actions[j][2] || ' en el módulo Contabilidad'
    )
    ON CONFLICT (key) DO NOTHING;
  END LOOP;
END $$;

-- 2. Acciones approve/delete para módulos agua y platform existentes
DO $$
DECLARE
  agua_modules text[][] := ARRAY[
    ['dashboard',         'Dashboard agua'],
    ['lecturas',          'Lecturas'],
    ['cobros',            'Cobros'],
    ['rutas',             'Rutas'],
    ['calidad',           'Calidad de agua'],
    ['mapa',              'Mapa'],
    ['tabla',             'Tabla de consumos'],
    ['contadores',        'Contadores'],
    ['tarifas',           'Tarifas agua'],
    ['servicios_energia', 'Servicios energía']
  ];
  platform_modules text[][] := ARRAY[
    ['clientes',      'Clientes'],
    ['unidades',      'Unidades'],
    ['configuracion', 'Configuración'],
    ['comunicacion',  'Comunicación'],
    ['condominios',   'Condominios (acceso general)']
  ];
  actions text[][] := ARRAY[
    ['approve', 'Autorizar / Denegar'],
    ['delete',  'Eliminar']
  ];
  i int; j int;
BEGIN
  FOR i IN 1..array_length(agua_modules, 1) LOOP
    FOR j IN 1..array_length(actions, 1) LOOP
      INSERT INTO public.permissions (key, category, label, description) VALUES (
        'agua.' || agua_modules[i][1] || '.' || actions[j][1],
        'agua_' || agua_modules[i][1],
        actions[j][2] || ' — ' || agua_modules[i][2],
        actions[j][2] || ' en el módulo ' || agua_modules[i][2]
      )
      ON CONFLICT (key) DO NOTHING;
    END LOOP;
  END LOOP;

  FOR i IN 1..array_length(platform_modules, 1) LOOP
    FOR j IN 1..array_length(actions, 1) LOOP
      INSERT INTO public.permissions (key, category, label, description) VALUES (
        'platform.' || platform_modules[i][1] || '.' || actions[j][1],
        'platform_' || platform_modules[i][1],
        actions[j][2] || ' — ' || platform_modules[i][2],
        actions[j][2] || ' en el módulo ' || platform_modules[i][2]
      )
      ON CONFLICT (key) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- 3. Acciones por tab de condominios, derivadas de las claves base existentes.
--    Las claves base tienen 3 segmentos (condominios.tab.<tab>); las de acción
--    tienen 4, así que el filtro por longitud evita re-derivar sobre derivadas.
INSERT INTO public.permissions (key, category, label, description)
SELECT
  p.key || '.' || a.akey,
  p.category,
  a.alabel || ' — ' || p.label,
  a.alabel || ' en ' || p.label
FROM public.permissions p
CROSS JOIN (VALUES
  ('create',        'Crear'),
  ('edit',          'Editar'),
  ('change_status', 'Cambiar estado'),
  ('approve',       'Autorizar / Denegar'),
  ('delete',        'Eliminar')
) AS a(akey, alabel)
WHERE p.key LIKE 'condominios.tab.%'
  AND array_length(string_to_array(p.key, '.'), 1) = 3
ON CONFLICT (key) DO NOTHING;

-- 4. Grants a roles del sistema con "acceso completo" (las migraciones
--    originales otorgaron con LIKE sobre el catálogo de su momento; las claves
--    nuevas requieren re-otorgar).
DO $$
DECLARE
  rid_cond_admin     uuid := '00000000-0000-0000-0000-000000000001'; -- Administrador General (condominios)
  rid_agua_admin     uuid := '00000000-0000-0000-0000-000000000101'; -- Admin Agua
  rid_platform_admin uuid := '00000000-0000-0000-0000-000000000201'; -- Admin Plataforma
BEGIN
  -- Administrador General: todas las acciones de todas las tabs de condominios
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
  SELECT rid_cond_admin, p.key, 'allow'
  FROM public.permissions p
  WHERE p.key LIKE 'condominios.tab.%'
  ON CONFLICT DO NOTHING;

  -- Admin Agua: acceso completo a agua.* (incluye approve/delete nuevos)
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
  SELECT rid_agua_admin, p.key, 'allow'
  FROM public.permissions p
  WHERE p.key LIKE 'agua.%'
  ON CONFLICT DO NOTHING;

  -- Admin Plataforma: acceso completo a platform.* (incluye contabilidad y
  -- approve/delete) y a agua.* (paridad con la migración 20260518000013)
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
  SELECT rid_platform_admin, p.key, 'allow'
  FROM public.permissions p
  WHERE p.key LIKE 'platform.%'
  ON CONFLICT DO NOTHING;

  INSERT INTO public.role_permissions (role_id, permission_key, effect)
  SELECT rid_platform_admin, p.key, 'allow'
  FROM public.permissions p
  WHERE p.key LIKE 'agua.%'
  ON CONFLICT DO NOTHING;
END $$;

-- 5. Compatibilidad de roles existentes: hasta ahora los botones de eliminar se
--    condicionaban con la acción edit, y autorizar/denegar con change_status.
--    Al separarlas, un rol que hoy edita perdería el botón de eliminar. Se
--    derivan grants equivalentes (edit → delete, change_status → approve) para
--    conservar el comportamiento efectivo; después cada empresa puede revocar
--    la clave nueva por rol desde el editor. El JOIN limita a claves que
--    existen en el catálogo. Solo aplica a roles ya creados: los roles nuevos
--    eligen cada acción explícitamente.
--    Se copia el effect tal cual (allow y deny): un rol que niega editar debe
--    seguir negando eliminar tras la separación.
--    edit → delete. Excepción: agua.tabla (Historial), donde el botón de
--    eliminar exigía edit Y change_status; ahí el allow solo se deriva si el
--    rol tenía ambas (los deny sí se copian sin condición: negar editar seguía
--    negando eliminar).
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT rp.role_id, p.key, rp.effect
FROM public.role_permissions rp
JOIN public.permissions p ON p.key = regexp_replace(rp.permission_key, '\.edit$', '.delete')
WHERE rp.permission_key LIKE '%.edit'
  AND NOT (rp.permission_key = 'agua.tabla.edit' AND rp.effect = 'allow')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT rp.role_id, 'agua.tabla.delete', 'allow'
FROM public.role_permissions rp
WHERE rp.permission_key = 'agua.tabla.edit'
  AND rp.effect = 'allow'
  AND EXISTS (
    SELECT 1 FROM public.role_permissions rp2
    WHERE rp2.role_id = rp.role_id
      AND rp2.permission_key = 'agua.tabla.change_status'
      AND rp2.effect = 'allow'
  )
ON CONFLICT DO NOTHING;

--    change_status → approve, y TAMBIÉN edit → approve (allow): los flujos de
--    aprobar/denegar (solicitudes, flujo de aprobación, verificación de pagos)
--    estaban condicionados por edit antes de existir la acción approve.
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT rp.role_id, p.key, rp.effect
FROM public.role_permissions rp
JOIN public.permissions p ON p.key = regexp_replace(rp.permission_key, '\.change_status$', '.approve')
WHERE rp.permission_key LIKE '%.change_status'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT rp.role_id, p.key, rp.effect
FROM public.role_permissions rp
JOIN public.permissions p ON p.key = regexp_replace(rp.permission_key, '\.edit$', '.approve')
WHERE rp.permission_key LIKE '%.edit'
  AND rp.effect = 'allow'
ON CONFLICT DO NOTHING;
