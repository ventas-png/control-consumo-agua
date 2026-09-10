-- ════════════════════════════════════════════════════════════════════════════
-- Las áreas se dan de alta en UN SOLO lugar, y las tareas las ELIGEN
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL PROBLEMA
-- `areas_condominio` ya es el catálogo canónico (20260424000059, endurecido en
-- 20260904000100), pero su CRUD se montó DOS VECES en la UI: dentro de "Rutas
-- Ronda" (vista Áreas) y dentro de "Limpieza" (vista Catálogo de áreas). Son el
-- mismo componente sobre la misma tabla, así que no hay divergencia de datos —
-- hay divergencia de EXPECTATIVA: quien crea "Nivel 1" desde Limpieza no sabe
-- que acaba de tocar el catálogo que usan las rondas, y quien no encuentra el
-- área donde la creó la vuelve a crear. Los duplicados históricos que
-- 20260907000000 tuvo que fusionar salieron justamente de ahí.
--
-- Y donde el catálogo NO se ofrece, el área se transcribe: `tareas_condominio.
-- area` es texto libre ("Piscina, lobby…" de placeholder), igual que lo era
-- `programacion_limpieza.area` antes de 20260904000100. Una tarea de la piscina
-- y una programación de limpieza de la piscina no se pueden cruzar porque cada
-- una escribió su propia "piscina".
--
-- LO QUE HACE ESTA MIGRACIÓN
--   1. Siembra el tab `areas_config` en el catálogo RBAC: es el único lugar
--      donde se administra el catálogo. Hereda sus grants de quien HOY lo
--      administra de facto (quien tiene `condominios.areas.manage` o
--      `condominios.tab.checklist_areas`), así que nadie estrena permiso ni
--      pierde el que ejercía desde Rondas o Limpieza.
--   2. Suma `condominios.tab.areas_config` a las policies de escritura de
--      `areas_condominio` (20260904000100 §6). Las dos claves anteriores siguen
--      valiendo: un rol custom que solo tuviera checklist_areas no se queda sin
--      escribir mientras su administrador le agrega el tab nuevo. Al re-declarar
--      las policies, los helpers se envuelven en `(SELECT …)` — el guard de
--      20260906000100: desnudos, el planificador los evalúa fila por fila.
--   3. `tareas_condominio.area_id` → `areas_condominio`, ON DELETE RESTRICT,
--      con el mismo backfill por nombre normalizado que se usó para limpieza.
--      `area` NO se elimina: queda como snapshot del texto y como render de lo
--      legado que el backfill no pudo vincular (grupos ambiguos).
--
-- LO QUE **NO** HACE: no toca la policy de DELETE de `areas_condominio` (borrar
-- un área sigue siendo de company_owner/admin y ahora, además, RESTRICT lo
-- bloquea si tiene tareas), ni el DEFAULT ni el NOT NULL de nada, ni migra
-- `checklist_areas.area` — eso lo hace 20260910000100 con este mismo patrón,
-- inmediatamente después.
--
-- IDEMPOTENTE: ON CONFLICT DO NOTHING en cada INSERT de catálogo, ADD COLUMN /
-- CREATE INDEX IF NOT EXISTS, DROP POLICY IF EXISTS antes de cada CREATE, y el
-- backfill solo toca filas con area_id IS NULL sin crear áreas que ya existan
-- por nombre normalizado.
--
-- REVERSA:
--   ALTER TABLE public.tareas_condominio DROP COLUMN area_id;
--   DELETE FROM public.role_permissions WHERE permission_key LIKE 'condominios.tab.areas\_config%';
--   DELETE FROM public.permissions      WHERE key            LIKE 'condominios.tab.areas\_config%';
--   -- y recrear areas_condominio_insert/_update tal como quedaron en 20260904000100.
--   Las áreas que el backfill haya creado NO se auto-revierten: son entradas de
--   catálogo válidas y ya pueden estar referenciadas por otras filas.
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Catálogo RBAC del tab `areas_config`
-- ────────────────────────────────────────────────────────────────────────────
-- Clave base = visibilidad ("Ver"), convención de 20260518000005. La categoría
-- es `operaciones` porque ahí vive la sección que lo hospeda (sections.ts) y
-- ahí está su vecino natural, checklist_areas.
INSERT INTO public.permissions (key, category, label, description) VALUES
  ('condominios.tab.areas_config', 'operaciones', 'Áreas',
   'Catálogo único de áreas físicas del condominio (areas_condominio). Lo consumen rondas, limpieza, plantillas y tareas.')
ON CONFLICT (key) DO NOTHING;

-- Las cinco acciones, con las mismas etiquetas que deriva 20260703000000 §3.
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
WHERE p.key = 'condominios.tab.areas_config'
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Grants: hereda de quien ya administra el catálogo
-- ────────────────────────────────────────────────────────────────────────────
-- Regla: un rol recibe el tab nuevo si tiene ALLOW sobre `condominios.areas.
-- manage` (el permiso dedicado que sembró 20260904000100 §5) o sobre
-- `condominios.tab.checklist_areas` (el gate canónico original). Son las dos
-- claves que hoy autorizan la escritura en la BD: quien podía crear un área
-- antes de esta migración la sigue pudiendo crear después, en el tab nuevo.
--
-- El `effect` se fuerza a 'allow' y NO se copia el del origen a ciegas: una
-- fila 'deny' sobre checklist_areas significa "no ve inspecciones de área", no
-- "no administra el catálogo", y propagarla vetaría el tab nuevo por un motivo
-- que no es. Los deny explícitos se ponen desde el editor de roles.
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT DISTINCT rp.role_id, k.key, 'allow'
FROM public.role_permissions rp
CROSS JOIN (VALUES
  ('condominios.tab.areas_config'),
  ('condominios.tab.areas_config.create'),
  ('condominios.tab.areas_config.edit'),
  ('condominios.tab.areas_config.change_status'),
  ('condominios.tab.areas_config.approve'),
  ('condominios.tab.areas_config.delete')
) AS k(key)
WHERE rp.effect = 'allow'
  AND rp.permission_key IN ('condominios.areas.manage', 'condominios.tab.checklist_areas')
ON CONFLICT DO NOTHING;

-- Administrador General (id fijo de 20260518000006): "acceso completo" por
-- descripción. Se otorga explícito porque su grant original se hizo con LIKE
-- sobre el catálogo de su momento y las claves nuevas no estaban.
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, p.key, 'allow'
FROM public.permissions p
WHERE p.key = 'condominios.tab.areas_config'
   OR p.key LIKE 'condominios.tab.areas\_config.%'
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. areas_condominio: la escritura también se autoriza con el tab nuevo
-- ────────────────────────────────────────────────────────────────────────────
-- Se re-declaran completas (no se puede "agregar un OR" a una policy existente)
-- conservando las dos condiciones de 20260904000100 §6 y sumando la tercera.
-- Único cambio de forma: los helpers van envueltos en `(SELECT …)` para que el
-- planificador los resuelva como InitPlan (guard de 20260906000100).
DROP POLICY IF EXISTS "areas_condominio_insert" ON public.areas_condominio;
CREATE POLICY "areas_condominio_insert" ON public.areas_condominio
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.checklist_areas')
             OR public.user_has_permission('condominios.areas.manage')
             OR public.user_has_permission('condominios.tab.areas_config')))
  );

DROP POLICY IF EXISTS "areas_condominio_update" ON public.areas_condominio;
CREATE POLICY "areas_condominio_update" ON public.areas_condominio
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.checklist_areas')
             OR public.user_has_permission('condominios.areas.manage')
             OR public.user_has_permission('condominios.tab.areas_config')))
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.checklist_areas')
             OR public.user_has_permission('condominios.areas.manage')
             OR public.user_has_permission('condominios.tab.areas_config')))
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 4. tareas_condominio.area_id → areas_condominio
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tareas_condominio
  ADD COLUMN IF NOT EXISTS area_id uuid
    REFERENCES public.areas_condominio(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.tareas_condominio.area_id IS
  'Área del catálogo (areas_condominio). NULL = tarea sin área, o registro legado que el backfill no pudo vincular (nombre ambiguo). `area` se conserva como snapshot del texto.';
COMMENT ON COLUMN public.tareas_condominio.area IS
  'Snapshot del nombre del área al capturar/vincular. Los registros sin area_id se siguen mostrando con este texto.';

CREATE INDEX IF NOT EXISTS idx_tareas_cond_area
  ON public.tareas_condominio(area_id)
  WHERE area_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Backfill (mismo procedimiento que 20260904000100 §2)
-- ────────────────────────────────────────────────────────────────────────────
-- 5a. Coincidencia ÚNICA por nombre normalizado dentro del proyecto → vincular.
--     El NOT EXISTS descarta los grupos ambiguos: atar al área equivocada es
--     peor que no atar.
UPDATE public.tareas_condominio t
SET area_id = a.id
FROM public.areas_condominio a
WHERE t.area_id IS NULL
  AND public.areas_normalizar_nombre(t.area) IS NOT NULL
  AND a.company_id = t.company_id
  AND a.project_id = t.project_id
  AND public.areas_normalizar_nombre(a.nombre) = public.areas_normalizar_nombre(t.area)
  AND NOT EXISTS (
    SELECT 1 FROM public.areas_condominio otra
    WHERE otra.company_id = t.company_id
      AND otra.project_id = t.project_id
      AND otra.id <> a.id
      AND public.areas_normalizar_nombre(otra.nombre) = public.areas_normalizar_nombre(t.area)
  );

-- 5b. CERO coincidencias → crear el área que falta: UNA por grupo normalizado,
--     con min(btrim(...)) para elegir un nombre determinista. El ícono 📋 las
--     distingue de las capturadas a mano y de las que creó el backfill de
--     limpieza (🧹).
INSERT INTO public.areas_condominio (company_id, project_id, nombre, icono, orden, activo)
SELECT p.company_id, p.project_id, p.nombre_original, '📋', 0, true
FROM (
  SELECT t.company_id, t.project_id,
         public.areas_normalizar_nombre(t.area) AS norm,
         min(btrim(t.area))                     AS nombre_original
  FROM public.tareas_condominio t
  WHERE t.area_id IS NULL
    AND public.areas_normalizar_nombre(t.area) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.areas_condominio a
      WHERE a.company_id = t.company_id
        AND a.project_id = t.project_id
        AND public.areas_normalizar_nombre(a.nombre) = public.areas_normalizar_nombre(t.area)
    )
  GROUP BY t.company_id, t.project_id, public.areas_normalizar_nombre(t.area)
) p;

-- 5c. Vincular contra las recién creadas: mismo UPDATE que 5a. Los grupos
--     ambiguos siguen ambiguos y se quedan NULL — es la señal de "pendiente de
--     resolución manual" que la UI muestra como tal.
UPDATE public.tareas_condominio t
SET area_id = a.id
FROM public.areas_condominio a
WHERE t.area_id IS NULL
  AND public.areas_normalizar_nombre(t.area) IS NOT NULL
  AND a.company_id = t.company_id
  AND a.project_id = t.project_id
  AND public.areas_normalizar_nombre(a.nombre) = public.areas_normalizar_nombre(t.area)
  AND NOT EXISTS (
    SELECT 1 FROM public.areas_condominio otra
    WHERE otra.company_id = t.company_id
      AND otra.project_id = t.project_id
      AND otra.id <> a.id
      AND public.areas_normalizar_nombre(otra.nombre) = public.areas_normalizar_nombre(t.area)
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Guarda de postcondición
-- ────────────────────────────────────────────────────────────────────────────
-- Un INSERT que no inserta nada no es error para Postgres. Si mañana alguien
-- renombra la clave del tab aguas arriba, esta migración pasaría en verde, el
-- tab quedaría invisible para todo rol no exento (hasPermission es fail-closed)
-- y nadie se enteraría hasta que un administrador no encuentre el permiso.
DO $$
DECLARE
  v_claves int;
BEGIN
  SELECT count(*) INTO v_claves
  FROM public.permissions
  WHERE key = 'condominios.tab.areas_config'
     OR key LIKE 'condominios.tab.areas\_config.%';
  IF v_claves <> 6 THEN
    RAISE EXCEPTION 'areas_config: se esperaban 6 claves en el catálogo RBAC (base + 5 acciones), hay %', v_claves;
  END IF;
END;
$$;
