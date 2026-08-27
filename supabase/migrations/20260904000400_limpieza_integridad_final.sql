-- ════════════════════════════════════════════════════════════════════════════
-- Limpieza: los dos huecos de integridad que la serie declaraba cerrar
-- ════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ UNA MIGRACIÓN NUEVA Y NO UN PARCHE A LAS ANTERIORES
-- 20260904000100/000200/000300 ya se aplicaron contra el preview de este PR.
-- Editarlas no las re-ejecutaría allí (y `migrations-append-only` lo prohíbe
-- justamente por eso). Esto va hacia adelante y es idempotente: corre igual
-- sobre un esquema limpio que sobre uno donde la serie ya está puesta.
--
-- ── HUECO 1 · `programacion_limpieza.area_id` no respetaba el tenant ────────
-- La FK que dejó 20260904000100 es SIMPLE: `REFERENCES areas_condominio(id)`.
-- Comprueba que el área exista, y nada más. Una programación de la empresa A
-- —o de su proyecto 1— podía apuntar a un área de la empresa B o del proyecto
-- 3, y quedar así para siempre.
--
-- Es EL MISMO agujero que la corrección de revisión cerró en las tablas puente
-- de 20260904000300 con FKs compuestas contra un ancla UNIQUE; el `area_id` se
-- quedó afuera del barrido. Aquí se le aplica el mismo molde.
--
-- El `area_id` es NULLABLE a propósito (fila legada «pendiente de vincular», o
-- backfill ambiguo). Con MATCH SIMPLE —el que rige por defecto— una FK
-- compuesta NO se evalúa si CUALQUIER columna es NULL, y `company_id` y
-- `project_id` son NOT NULL en las dos tablas: o sea que la validación se
-- salta exactamente en las filas sin área, que es lo que se quiere, y muerde
-- en todas las demás.
--
-- ── HUECO 2 · el catálogo de cargos se saltaba por UPDATE ───────────────────
-- `trg_plantillas_cargo_controlado` quedó como BEFORE INSERT a secas, así que
-- validaba el alta y NADA más: un `UPDATE ... SET cargo = 'lo que sea'` pasaba
-- sin mirar y el catálogo era una formalidad.
--
-- El motivo de haberlo dejado en INSERT era correcto —no romper el toggle de
-- `activo` de las filas legadas con cargo libre, que a propósito no se
-- reescriben— pero la conclusión se pasó de largo: se puede validar el UPDATE
-- DE LA COLUMNA `cargo` sin tocar los demás UPDATE. Van dos defensas, y las
-- dos hacen falta:
--
--   · `UPDATE OF cargo` — el trigger ni se dispara cuando el UPDATE no
--     menciona la columna. Ahí está el toggle de `activo` de la fila legada.
--   · `NEW.cargo IS DISTINCT FROM OLD.cargo` — cubre el UPDATE que SÍ la
--     menciona sin cambiarla (`SET cargo = cargo`, que cualquier ORM que
--     reescriba la fila entera genera solo). Sin este guard, una fila legada
--     con cargo libre se volvería ineditable.
--
-- Con una sola de las dos, editar una fila histórica se rompe. El sandbox lo
-- prueba con las dos formas.
--
-- El catálogo de valores no cambia: es el mismo de `personal_condominio`
-- (prog_limpieza_cargo_check, 20260807130000).
--
-- IDEMPOTENTE: sí — guards por catálogo en todo, CREATE OR REPLACE y
-- DROP TRIGGER IF EXISTS. supabase/tests/limpieza_catalogos re-aplica la serie
-- completa para demostrarlo.
--
-- REVERSA:
-- ALTER TABLE public.programacion_limpieza DROP CONSTRAINT prog_limpieza_area_tenant_fk;
-- ALTER TABLE public.programacion_limpieza
--   ADD CONSTRAINT programacion_limpieza_area_id_fkey
--   FOREIGN KEY (area_id) REFERENCES public.areas_condominio(id) ON DELETE RESTRICT;
-- ALTER TABLE public.areas_condominio DROP CONSTRAINT areas_id_tenant_uq;
-- Y recrear el trigger como BEFORE INSERT (ver 20260904000200).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Ancla UNIQUE en areas_condominio
-- ────────────────────────────────────────────────────────────────────────────
-- Mismo patrón y misma convención de nombre que las anclas de 20260904000300
-- (`suministros_id_tenant_uq`, `inventario_id_tenant_uq`). Es lo que hace
-- referenciable el trío completo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'areas_id_tenant_uq') THEN
    ALTER TABLE public.areas_condominio
      ADD CONSTRAINT areas_id_tenant_uq UNIQUE (id, company_id, project_id);
  END IF;
END;
$$;

COMMENT ON CONSTRAINT areas_id_tenant_uq ON public.areas_condominio IS
  'Ancla para las FKs compuestas (id, company_id, project_id): permite que quien referencie un área congele su tenant durante toda la vida del vínculo.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Reparación previa de los vínculos que ya cruzan el tenant
-- ────────────────────────────────────────────────────────────────────────────
-- La FK nueva no se puede crear si alguna fila ya la viola. Un `area_id` que
-- apunta a otro tenant NO es un dato que preservar: es exactamente la
-- corrupción que esta migración viene a impedir. Se desvincula.
--
-- No se pierde información: `area` conserva el texto capturado (es su snapshot
-- declarado) y la fila vuelve al estado que la UI ya sabe mostrar, «⚠
-- Pendiente de vincular» — el mismo destino que el backfill de 20260904000100
-- le da a los nombres ambiguos.
--
-- Se avisa por NOTICE con el conteo: si esto llegara a tocar filas en
-- producción tiene que quedar en el log de la migración, no pasar callado. En
-- el sandbox el conteo es 0 (el backfill sólo vincula dentro del tenant).
DO $$
DECLARE n bigint;
BEGIN
  UPDATE public.programacion_limpieza pl
     SET area_id = NULL
   WHERE pl.area_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.areas_condominio a
        WHERE a.id         = pl.area_id
          AND a.company_id = pl.company_id
          AND a.project_id = pl.project_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE 'LIMPIEZA_INTEGRIDAD: % programación(es) apuntaban a un área de otro tenant; se desvincularon (conservan su texto `area` y vuelven a «pendiente de vincular»).', n;
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. FK simple → FK compuesta
-- ────────────────────────────────────────────────────────────────────────────
-- La FK vieja es ANÓNIMA: 20260904000100 la declaró inline en el ADD COLUMN,
-- así que su nombre lo puso PostgreSQL. Se descubre por catálogo —cualquier FK
-- de esta tabla cuyo conjunto de columnas sea EXACTAMENTE {area_id}— en vez de
-- asumir `programacion_limpieza_area_id_fkey`. Eso hace que corra igual sobre
-- el preview (que pudo registrar otra variante) y sobre un esquema limpio.
--
-- El bucle no puede tocar la compuesta: su `conkey` tiene tres columnas.
DO $$
DECLARE
  v_attnum smallint;
  v_con    text;
BEGIN
  SELECT attnum INTO v_attnum
    FROM pg_attribute
   WHERE attrelid = 'public.programacion_limpieza'::regclass
     AND attname  = 'area_id'
     AND NOT attisdropped;

  IF v_attnum IS NULL THEN
    RAISE EXCEPTION 'LIMPIEZA_INTEGRIDAD: falta programacion_limpieza.area_id (¿se aplicó 20260904000100?)';
  END IF;

  FOR v_con IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.programacion_limpieza'::regclass
       AND contype  = 'f'
       AND conkey   = ARRAY[v_attnum]
  LOOP
    EXECUTE format('ALTER TABLE public.programacion_limpieza DROP CONSTRAINT %I', v_con);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prog_limpieza_area_tenant_fk') THEN
    ALTER TABLE public.programacion_limpieza
      ADD CONSTRAINT prog_limpieza_area_tenant_fk
      FOREIGN KEY (area_id, company_id, project_id)
      REFERENCES public.areas_condominio (id, company_id, project_id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

COMMENT ON CONSTRAINT prog_limpieza_area_tenant_fk ON public.programacion_limpieza IS
  'El área tiene que ser del MISMO (company_id, project_id) que la programación, y sigue sin poder borrarse si está en uso (RESTRICT). Con area_id NULL (fila legada pendiente de vincular) la FK no se evalúa: MATCH SIMPLE.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. El catálogo de cargos deja de saltarse por UPDATE
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.plantillas_cargo_valida_cargo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- En UPDATE sólo se valida si el cargo CAMBIA. Una fila legada con cargo
  -- libre se sigue pudiendo editar (incluso reescribiéndose entera) mientras
  -- nadie toque ese valor; lo que ya no se puede es moverlo a otro texto libre.
  IF TG_OP = 'INSERT' OR NEW.cargo IS DISTINCT FROM OLD.cargo THEN
    IF lower(btrim(NEW.cargo)) NOT IN
       ('conserje', 'guardia', 'jardinero', 'mantenimiento', 'administrador', 'otro') THEN
      RAISE EXCEPTION 'PLANTILLAS_CARGO: cargo "%" fuera del catálogo (conserje|guardia|jardinero|mantenimiento|administrador|otro)', NEW.cargo
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.plantillas_cargo_valida_cargo() IS
  'Valida `cargo` contra el catálogo al insertar y al CAMBIARLO. No se dispara en UPDATE de otras columnas (UPDATE OF cargo) ni cuando el valor no cambia (IS DISTINCT FROM): las filas legadas con cargo de texto libre siguen siendo editables.';

DROP TRIGGER IF EXISTS trg_plantillas_cargo_controlado ON public.plantillas_tarea_cargo;
CREATE TRIGGER trg_plantillas_cargo_controlado
  BEFORE INSERT OR UPDATE OF cargo ON public.plantillas_tarea_cargo
  FOR EACH ROW EXECUTE FUNCTION public.plantillas_cargo_valida_cargo();
