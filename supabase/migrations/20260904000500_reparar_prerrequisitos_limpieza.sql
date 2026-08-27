-- ════════════════════════════════════════════════════════════════════════════
-- Reparar los prerrequisitos que 20260904000100/000400 dieron por ciertos
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ PASÓ. El merge de #782 (c5d7e40) disparó apply-migrations-prod y la
-- serie se aplicó A MEDIAS contra producción (run 33095288091):
--
--   20260904000100 → HTTP 400  42703: column "activo" of relation
--                              "areas_condominio" does not exist
--                              LINE 132: INSERT INTO public.areas_condominio
--                              (company_id, project_id, nombre, icono, orden, activo)
--   20260904000200 → HTTP 201
--   20260904000300 → HTTP 201
--   20260904000400 → HTTP 400  42703: column pl.area_id does not exist
--
-- 000100 revirtió ENTERA (su ADD COLUMN area_id de la línea 96 va antes del
-- error de la 132, y el fallo de 000400 lo confirma), así que ni el area_id ni
-- el retiro de la policy legacy "company_rw_areas" llegaron a quedar. 000200 y
-- 000300 sí quedaron aplicadas y registradas.
--
-- POR QUÉ FALLÓ. El esquema real de producción y supabase/migrations/ divergen
-- desde antes de este PR. 20260424000059 crea `areas_condominio` CON `activo`;
-- la tabla real no lo tiene, y además ahí `icono`/`orden` son nullable y sin
-- default, y falta la FK de `company_id`. Esa tabla no la creó esa migración:
-- la cabecera de scripts/backfill-schema-migrations.sql explica el mecanismo
-- —las 257 migraciones anteriores al 2026-06-05 «se aplicaron en su día por
-- otra vía (CLI, panel, a mano)» y el historial se rellenó como papeleo, sin
-- ejecutar el SQL—. Es el mismo desfase que capturó 20260904000000, pero en
-- sentido inverso: allí eran columnas que sólo existían en producción, aquí son
-- columnas que sólo existen en el repositorio.
--
-- QUÉ HACE ESTA MIGRACIÓN. Deja el esquema en la forma que 000100 y 000400
-- necesitan para poder reintentarse tal cual están, SIN tocar ni reescribir
-- ninguna de las dos (son históricas desde el merge, y migrations-append-only
-- lo prohíbe) y SIN marcar nada a mano como aplicado.
--
-- LO QUE NO HACE, A PROPÓSITO: no agrega `programacion_limpieza.area_id`. Esa
-- columna la crea 000100 al reintentarse, con su índice parcial, su comentario
-- y —lo que importa— su backfill determinista. Adelantarla aquí dejaría la
-- columna sin backfill y volvería el reintento un no-op silencioso.
--
-- IDEMPOTENTE Y NO-OP SOBRE ESQUEMA LIMPIO: todo va con guard por catálogo. En
-- un entorno construido desde supabase/migrations (el sandbox, el Preview, un
-- restore) `activo` ya viene de 20260424000059 y esta migración no hace nada.
-- Sobre producción, cada reparación efectiva sale por RAISE NOTICE: si algo
-- faltaba de verdad tiene que quedar en el log del apply, no pasar callado.
--
-- REVERSA: no la tiene, y es deliberado. Quitar `activo` volvería a romper
-- 000100. Si hubiera que deshacerlo sería revirtiendo la serie entera.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. areas_condominio.activo — la columna que reventó el apply
-- ────────────────────────────────────────────────────────────────────────────
-- Se agrega con DEFAULT true para que sea un `fast default` (PG11+): no
-- reescribe la tabla ni toma un lock largo. Las filas existentes quedan en
-- `true`, que es exactamente lo que la UI venía asumiendo por ausencia del
-- dato. Después se completa cualquier NULL y se fija el NOT NULL, por si en
-- algún entorno la columna existiera pero nullable.
DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.areas_condominio') IS NULL THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.areas_condominio'::regclass
       AND attname = 'activo' AND attnum > 0 AND NOT attisdropped
  ) THEN
    ALTER TABLE public.areas_condominio ADD COLUMN activo boolean DEFAULT true;
    RAISE NOTICE 'DRIFT: areas_condominio.activo NO existía y se creó (default true).';
  END IF;

  UPDATE public.areas_condominio SET activo = true WHERE activo IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE 'DRIFT: % área(s) tenían activo NULL; se pusieron en true.', n;
  END IF;

  ALTER TABLE public.areas_condominio ALTER COLUMN activo SET DEFAULT true;
  ALTER TABLE public.areas_condominio ALTER COLUMN activo SET NOT NULL;

  COMMENT ON COLUMN public.areas_condominio.activo IS
    'Área vigente del catálogo. Desactivar en lugar de borrar: las programaciones y rondas que la referencian se conservan. Declarada en 20260424000059 y repuesta en producción por 20260904000500.';
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. rutas_ronda.activo — el mismo hueco, de la misma migración
-- ────────────────────────────────────────────────────────────────────────────
-- 20260424000059 declara `activo` en las dos tablas y a producción no llegó en
-- ninguna. No bloquea el reintento de 000100, pero es idéntico y ya conocido:
-- dejarlo abierto es programar el próximo 400 para el día que alguien
-- desactive una ruta. Va aquí porque es la misma causa y el mismo arreglo.
DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.rutas_ronda') IS NULL THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.rutas_ronda'::regclass
       AND attname = 'activo' AND attnum > 0 AND NOT attisdropped
  ) THEN
    ALTER TABLE public.rutas_ronda ADD COLUMN activo boolean DEFAULT true;
    RAISE NOTICE 'DRIFT: rutas_ronda.activo NO existía y se creó (default true).';
  END IF;

  UPDATE public.rutas_ronda SET activo = true WHERE activo IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE 'DRIFT: % ruta(s) tenían activo NULL; se pusieron en true.', n;
  END IF;

  ALTER TABLE public.rutas_ronda ALTER COLUMN activo SET DEFAULT true;
  ALTER TABLE public.rutas_ronda ALTER COLUMN activo SET NOT NULL;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. El resto de la forma declarada de areas_condominio
-- ────────────────────────────────────────────────────────────────────────────
-- `icono` y `orden` están declaradas NOT NULL con default en 20260424000059 y
-- en producción son nullable y sin default. No es lo que reventó el apply —el
-- INSERT de 000100 las manda explícitas— pero es el mismo desfase de la misma
-- tabla, y una fila con `icono` NULL rompe el render del catálogo (AreasCatalog
-- espera un string). Se rellena con el default declarado y se cierra.
DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.areas_condominio') IS NULL THEN RETURN; END IF;

  UPDATE public.areas_condominio SET icono = '📍' WHERE icono IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'DRIFT: % área(s) con icono NULL → 📍.', n; END IF;

  UPDATE public.areas_condominio SET orden = 0 WHERE orden IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'DRIFT: % área(s) con orden NULL → 0.', n; END IF;

  ALTER TABLE public.areas_condominio ALTER COLUMN icono SET DEFAULT '📍';
  ALTER TABLE public.areas_condominio ALTER COLUMN icono SET NOT NULL;
  ALTER TABLE public.areas_condominio ALTER COLUMN orden SET DEFAULT 0;
  ALTER TABLE public.areas_condominio ALTER COLUMN orden SET NOT NULL;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. FK areas_condominio.company_id → companies(id)
-- ────────────────────────────────────────────────────────────────────────────
-- Declarada en 20260424000059 y ausente en producción (el snapshot de tipos
-- sólo lista areas_condominio_project_id_fkey).
--
-- ESTE ES EL ÚNICO PUNTO QUE NO ES FAIL-CLOSED, y la decisión se deja a la
-- vista: si hubiera áreas con un company_id que no existe, la FK no se puede
-- crear. Abortar ahí tumbaría un hotfix de producción por una deuda que NO
-- bloquea el reintento de 000100 ni de 000400 —ninguna de las dos depende de
-- esta FK—. Así que se avisa con el conteo y se sigue. Lo que sí es
-- fail-closed es el bloque 5, que cubre lo que las dos sí necesitan.
DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.areas_condominio') IS NULL
     OR to_regclass('public.companies') IS NULL THEN RETURN; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.areas_condominio'::regclass
       AND contype = 'f'
       AND confrelid = 'public.companies'::regclass
       AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                            WHERE attrelid = 'public.areas_condominio'::regclass
                              AND attname = 'company_id' AND NOT attisdropped)]
  ) THEN
    RETURN;  -- ya está
  END IF;

  SELECT count(*) INTO n
    FROM public.areas_condominio a
   WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = a.company_id);

  IF n > 0 THEN
    RAISE NOTICE 'DRIFT: % área(s) apuntan a una empresa inexistente; NO se creó areas_condominio_company_id_fkey. Queda como deuda declarada (no bloquea 000100 ni 000400).', n;
    RETURN;
  END IF;

  ALTER TABLE public.areas_condominio
    ADD CONSTRAINT areas_condominio_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id);
  RAISE NOTICE 'DRIFT: se creó la FK areas_condominio_company_id_fkey que faltaba.';
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Contrato: TODO lo que 000100 y 000400 dan por cierto — fail-closed
-- ────────────────────────────────────────────────────────────────────────────
-- Si el esquema no cumple algo de esto, el reintento de 000100/000400 vuelve a
-- fallar contra producción. Es preferible que falle AQUÍ, en una migración que
-- no ha cambiado nada irreversible, y con la lista COMPLETA de lo que falta:
-- un solo run tiene que contar toda la historia, no el primer tropiezo. Eso es
-- precisamente lo que no pasó el 2026-08-27, donde cada corrida sólo mostraba
-- el siguiente error.
DO $$
DECLARE
  faltan text[] := ARRAY[]::text[];
  r      record;
  oid_t  oid;
BEGIN
  -- 5a. Columnas que las dos migraciones nombran.
  FOR r IN
    SELECT * FROM (VALUES
      -- 000100: el INSERT del backfill y las policies re-declaradas.
      ('areas_condominio',     'id'),
      ('areas_condominio',     'company_id'),
      ('areas_condominio',     'project_id'),
      ('areas_condominio',     'nombre'),
      ('areas_condominio',     'descripcion'),
      ('areas_condominio',     'icono'),
      ('areas_condominio',     'orden'),
      ('areas_condominio',     'activo'),
      ('areas_condominio',     'created_at'),
      -- 000100: el backfill lee `area` y escribe `area_id` (que crea él mismo).
      ('programacion_limpieza','id'),
      ('programacion_limpieza','area'),
      ('programacion_limpieza','company_id'),
      ('programacion_limpieza','project_id'),
      -- 000100: CASCADE → RESTRICT y las columnas de anulación.
      ('ejecuciones_limpieza', 'programacion_id'),
      -- 000400: el trigger del catálogo de cargos.
      ('plantillas_tarea_cargo','cargo'),
      -- 000100: siembra el permiso y lo concede.
      ('permissions',          'key'),
      ('permissions',          'category'),
      ('permissions',          'label'),
      ('permissions',          'description'),
      ('role_permissions',     'role_id'),
      ('role_permissions',     'permission_key'),
      ('role_permissions',     'effect')
    ) AS t(tabla, col)
  LOOP
    oid_t := to_regclass('public.' || r.tabla);
    IF oid_t IS NULL THEN
      faltan := faltan || format('tabla public.%s', r.tabla);
    ELSIF NOT EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = oid_t AND attname = r.col
         AND attnum > 0 AND NOT attisdropped
    ) THEN
      faltan := faltan || format('columna public.%s.%s', r.tabla, r.col);
    END IF;
  END LOOP;

  -- 5b. NOT NULL en el tenant de las dos tablas del vínculo. De esto depende
  --     el ancla UNIQUE de 000400 y su razonamiento MATCH SIMPLE: la FK
  --     compuesta se salta cuando area_id es NULL PORQUE company_id y
  --     project_id nunca lo son. Si alguno fuese nullable, una fila con
  --     company_id NULL evadiría la validación entera sin que se note.
  FOR r IN
    SELECT * FROM (VALUES
      ('areas_condominio',     'company_id'),
      ('areas_condominio',     'project_id'),
      ('programacion_limpieza','company_id'),
      ('programacion_limpieza','project_id')
    ) AS t(tabla, col)
  LOOP
    oid_t := to_regclass('public.' || r.tabla);
    IF oid_t IS NOT NULL AND EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = oid_t AND attname = r.col
         AND attnum > 0 AND NOT attisdropped AND NOT attnotnull
    ) THEN
      faltan := faltan || format('NOT NULL en public.%s.%s', r.tabla, r.col);
    END IF;
  END LOOP;

  -- 5c. Funciones que 000100 invoca en las policies y en el trigger, y que NO
  --     crea (sólo crea areas_normalizar_nombre).
  FOR r IN
    SELECT * FROM (VALUES
      ('public.is_super_admin()'),
      ('public.get_my_company_id()'),
      ('public.current_user_role()'),
      ('public.user_has_permission(text)'),
      ('public.sellar_cierre()')
    ) AS t(firma)
  LOOP
    IF to_regprocedure(r.firma) IS NULL THEN
      faltan := faltan || format('función %s', r.firma);
    END IF;
  END LOOP;

  -- 5d. La FK que 000100 busca por catálogo para pasarla de CASCADE a
  --     RESTRICT. Si no existe ninguna, su DO no encuentra nada y el historial
  --     se queda sin proteger EN SILENCIO — verde y sin efecto.
  IF to_regclass('public.ejecuciones_limpieza') IS NOT NULL
     AND to_regclass('public.programacion_limpieza') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conrelid  = 'public.ejecuciones_limpieza'::regclass
          AND contype   = 'f'
          AND confrelid = 'public.programacion_limpieza'::regclass
     ) THEN
    faltan := faltan || 'FK ejecuciones_limpieza.programacion_id → programacion_limpieza'::text;
  END IF;

  -- 5e. Los dos roles de sistema a los que 000100 concede el permiso nuevo.
  --     Sólo se exige donde `roles` existe con la FK real (20260518000004):
  --     el sandbox monta role_permissions sin ella y no tiene por qué fallar.
  IF to_regclass('public.roles') IS NOT NULL THEN
    FOR r IN
      SELECT * FROM (VALUES
        ('00000000-0000-0000-0000-000000000004'),
        ('00000000-0000-0000-0000-000000000005')
      ) AS t(rid)
    LOOP
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE id = r.rid::uuid) THEN
        faltan := faltan || format('rol de sistema %s (role_permissions.role_id tiene FK a roles)', r.rid);
      END IF;
    END LOOP;
  END IF;

  IF array_length(faltan, 1) > 0 THEN
    RAISE EXCEPTION E'PRERREQUISITOS_LIMPIEZA: el esquema no cumple lo que 20260904000100/000400 dan por cierto.\nFalta:\n  · %\nCorregir esto ANTES de reintentar la serie: si no, el apply vuelve a fallar a medias.',
      array_to_string(faltan, E'\n  · ')
      USING ERRCODE = 'undefined_column';
  END IF;

  RAISE NOTICE 'PRERREQUISITOS_LIMPIEZA: contrato completo. 20260904000100 y 000400 se pueden reintentar.';
END;
$$;
