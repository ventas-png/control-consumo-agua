-- ════════════════════════════════════════════════════════════════════════════
-- Libro de novedades: el responsable del turno es un EMPLEADO del expediente
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL PROBLEMA
-- `libro_novedades.responsable` es texto libre («Nombre del encargado»). Quien
-- reporta el turno ya está en `personal_condominio`, pero la entrada no lo
-- nombra: «Carlos», «Carlos Pérez» y «C. Pérez» son tres responsables que no
-- se pueden cruzar con el expediente, sus turnos ni su desempeño. Es el mismo
-- hueco que `capacitacion_personal_cond.personal_id` cubre desde 20260420000032.
--
-- LO QUE HACE ESTA MIGRACIÓN
--   1. `libro_novedades.personal_id` (nullable) → `personal_condominio`, con FK
--      COMPUESTA (personal_id, company_id, project_id) contra el ancla
--      `personal_condominio_id_tenant_uq` (20260916171325): el responsable no
--      puede ser personal de otra empresa ni de otro condominio.
--      ON DELETE SET NULL (personal_id): dar de baja a un empleado no borra la
--      bitácora que firmó; la entrada queda con su nombre y sin vínculo. Sin la
--      lista de columnas Postgres pondría NULL también en company_id y
--      project_id, que son NOT NULL, y el borrado del empleado fallaría siempre.
--   2. `responsable` NO se toca — sigue NOT NULL y pasa a ser el SNAPSHOT del
--      nombre del empleado al registrar. Es también el render de lo legado,
--      que se queda con personal_id NULL.
--   3. Sin backfill: el nombre escrito a mano no identifica a nadie con
--      certeza y atar una bitácora de seguridad al empleado equivocado es peor
--      que no atarla. Las entradas nuevas nacen vinculadas desde la UI.
--
-- LO QUE **NO** HACE: no toca las policies de `libro_novedades`
-- (20261104000400) ni las de `personal_condominio`: la autorización no cambia
-- con esta columna, y la UI solo LEE el expediente.
--
-- IDEMPOTENTE: ADD COLUMN / CREATE INDEX IF NOT EXISTS y la FK se crea solo si
-- no existe. Re-aplicarla es un no-op.
--
-- REVERSA: ALTER TABLE public.libro_novedades DROP COLUMN personal_id;
-- (arrastra la FK y el índice).
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. libro_novedades.personal_id → personal_condominio (por tenant)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.libro_novedades
  ADD COLUMN IF NOT EXISTS personal_id uuid;

-- Con MATCH SIMPLE (el default) la FK compuesta no se evalúa cuando
-- personal_id es NULL —company_id y project_id son NOT NULL—: se salta en las
-- entradas legadas y muerde en todas las nuevas. La columna nace vacía, así
-- que validarla al crearla no escanea nada que pueda fallar.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_condominio_id_tenant_uq') THEN
    RAISE EXCEPTION 'libro_novedades_personal: falta el ancla personal_condominio_id_tenant_uq (¿se aplicó 20260916171325?)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname  = 'libro_novedades_personal_fk'
                    AND conrelid = 'public.libro_novedades'::regclass) THEN
    ALTER TABLE public.libro_novedades
      ADD CONSTRAINT libro_novedades_personal_fk
      FOREIGN KEY (personal_id, company_id, project_id)
      REFERENCES public.personal_condominio (id, company_id, project_id)
      ON DELETE SET NULL (personal_id);
  END IF;
END;
$$;

COMMENT ON COLUMN public.libro_novedades.personal_id IS
  'Empleado (personal_condominio) responsable del turno. NULL = entrada legada de texto libre, o empleado dado de baja. `responsable` se conserva como snapshot del nombre.';
COMMENT ON COLUMN public.libro_novedades.responsable IS
  'Snapshot del nombre del responsable al registrar (NOT NULL). Las entradas sin personal_id se siguen mostrando con este texto.';

CREATE INDEX IF NOT EXISTS idx_libro_novedades_personal
  ON public.libro_novedades(personal_id)
  WHERE personal_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Guarda de postcondición
-- ────────────────────────────────────────────────────────────────────────────
-- Que la columna exista no prueba que la FK sea la correcta: con una FK simple
-- el responsable podría ser personal de otro condominio; con CASCADE, dar de
-- baja a un guardia se llevaría su bitácora; con SET NULL sin lista de
-- columnas, no se podría dar de baja a nadie con entradas. La guarda convierte
-- cualquiera de esas derivas en un fallo de despliegue ruidoso.
DO $$
DECLARE
  v_del     char;
  v_cols    int;
  v_setcols int;
BEGIN
  SELECT confdeltype, array_length(conkey, 1), array_length(confdelsetcols, 1)
    INTO v_del, v_cols, v_setcols
  FROM pg_constraint
  WHERE conrelid  = 'public.libro_novedades'::regclass
    AND contype   = 'f'
    AND confrelid = 'public.personal_condominio'::regclass;
  IF v_del IS DISTINCT FROM 'n' OR v_cols IS DISTINCT FROM 3 OR v_setcols IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'libro_novedades.personal_id: se esperaba FK compuesta (3 columnas) a personal_condominio con ON DELETE SET NULL (personal_id), hay confdeltype=%, columnas=%, set null sobre=%',
      coalesce(v_del, 'sin FK'), coalesce(v_cols, 0), coalesce(v_setcols, 0);
  END IF;
END;
$$;
