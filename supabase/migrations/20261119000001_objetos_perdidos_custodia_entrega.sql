-- ════════════════════════════════════════════════════════════════════════════
-- Objetos perdidos: área del catálogo, quién lo encontró, fotos, custodia y
-- entrega al propietario con firma de recibido
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL PROBLEMA
-- `objetos_perdidos` guarda una descripción, un «lugar» escrito a mano y, al
-- reclamarse, un nombre suelto. No dice quién lo encontró (un guardia o un
-- tercero), no tiene fotos del artículo, no dice quién lo tiene bajo custodia
-- ni dónde quedó guardado, y la «entrega» es un nombre sin firma, sin hora y
-- sin quién la hizo: no prueba nada si el dueño vuelve a reclamar.
--
-- LO QUE HACE ESTA MIGRACIÓN
--   1. `area_encontrado_id` y `area_almacenamiento_id` → `areas_condominio`,
--      con FK COMPUESTA (…, company_id, project_id) contra el ancla
--      `areas_id_tenant_uq` (20260904000400) y ON DELETE RESTRICT, igual que
--      inventario, incidentes y piscina: un objeto no queda en un área de otro
--      condominio, y un área con objetos no se borra, se desactiva.
--      `lugar_encontrado` pasa a ser el SNAPSHOT del nombre del área (y el
--      texto de lo legado, que no se reescribe: no hay backfill).
--      `almacenamiento_detalle`: dónde exactamente dentro del área (gaveta,
--      estante, caja).
--   2. Quién lo encontró: `encontrado_por_tipo` ('personal' | 'tercero').
--      Personal → `encontrado_por_personal_id` (FK compuesta a
--      `personal_condominio`, ancla `personal_condominio_id_tenant_uq`, ON
--      DELETE SET NULL (columna): dar de baja al empleado no borra el objeto).
--      Tercero → `encontrado_por_nombre` obligatorio y `encontrado_por_contacto`
--      opcional. En los dos casos `encontrado_por_nombre` es el snapshot que se
--      muestra; para el personal lo pone el trigger desde la ficha.
--   3. `fotos` text[] NOT NULL DEFAULT '{}' (bucket `condominios-media`, ruta
--      `<project_id>/objetos-perdidos/<archivo>.jpg`), máximo 6 por CHECK.
--      `foto_url` (legado, una sola foto) no se toca.
--   4. Custodia: `custodio_personal_id` (FK compuesta a personal_condominio,
--      ON DELETE SET NULL (columna)) y `custodio_nombre` como snapshot.
--   5. Entrega al propietario: `reclamado_por` (quien recibe) y `fecha_reclamo`
--      ya existían; se agregan `entrega_documento` (identificación, opcional),
--      `firma_entrega_path` (la firma de recibido en `condominios-media`, bajo
--      `<project_id>/objetos-perdidos/firmas/`), y el SELLO de servidor
--      `entregado_en`, `entregado_por`, `entregado_por_nombre`.
--   6. Trigger `objetos_perdidos_coherente` (BEFORE INSERT OR UPDATE):
--      - snapshots de nombres desde las fichas, y la ficha tiene que ser de
--        ESTE condominio (la FK lo exige también, pero después del trigger);
--      - `registrado_por` lo sella el servidor al crear y no se reescribe;
--      - pasar a 'reclamado' exige quien recibe y la firma, que tiene que estar
--        subida en la carpeta del condominio; la hora, quién entregó y su
--        nombre los pone el servidor, diga lo que diga el cliente;
--      - una entrega registrada no se deshace ni se reescribe (estado y datos
--        de la entrega quedan fijos). Lo legado ya reclamado queda igual.
--      SECURITY DEFINER: lee personal_condominio, app_users y storage.objects,
--      que la RLS de quien registra puede no dejarle ver.
--
-- LO QUE **NO** HACE: no toca las policies de `objetos_perdidos`
-- (20261104000000) ni las de `areas_condominio`, `personal_condominio` o el
-- bucket. La autorización no cambia: registrar sigue siendo `objetos.create`,
-- y custodia, entrega, donar o descartar son `objetos.edit`.
--
-- IDEMPOTENTE: ADD COLUMN / CREATE INDEX IF NOT EXISTS; FKs y CHECK se crean
-- solo si no existen; la función es CREATE OR REPLACE y el trigger se recrea.
--
-- REVERSA:
--   DROP TRIGGER IF EXISTS trg_objetos_perdidos_coherente ON public.objetos_perdidos;
--   DROP FUNCTION IF EXISTS public.objetos_perdidos_coherente();
--   ALTER TABLE public.objetos_perdidos
--     DROP COLUMN area_encontrado_id, DROP COLUMN area_almacenamiento_id,
--     DROP COLUMN almacenamiento_detalle, DROP COLUMN encontrado_por_tipo,
--     DROP COLUMN encontrado_por_personal_id, DROP COLUMN encontrado_por_nombre,
--     DROP COLUMN encontrado_por_contacto, DROP COLUMN fotos,
--     DROP COLUMN custodio_personal_id, DROP COLUMN custodio_nombre,
--     DROP COLUMN entrega_documento, DROP COLUMN firma_entrega_path,
--     DROP COLUMN entregado_en, DROP COLUMN entregado_por, DROP COLUMN entregado_por_nombre;
--   (arrastra las FK, los índices y los CHECK). Los archivos del bucket no se
--   borran solos.
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Columnas
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.objetos_perdidos
  ADD COLUMN IF NOT EXISTS area_encontrado_id         uuid,
  ADD COLUMN IF NOT EXISTS encontrado_por_tipo        text,
  ADD COLUMN IF NOT EXISTS encontrado_por_personal_id uuid,
  ADD COLUMN IF NOT EXISTS encontrado_por_nombre      text,
  ADD COLUMN IF NOT EXISTS encontrado_por_contacto    text,
  ADD COLUMN IF NOT EXISTS fotos                      text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS custodio_personal_id       uuid,
  ADD COLUMN IF NOT EXISTS custodio_nombre            text,
  ADD COLUMN IF NOT EXISTS area_almacenamiento_id     uuid,
  ADD COLUMN IF NOT EXISTS almacenamiento_detalle     text,
  ADD COLUMN IF NOT EXISTS entrega_documento          text,
  ADD COLUMN IF NOT EXISTS firma_entrega_path         text,
  ADD COLUMN IF NOT EXISTS entregado_en               timestamptz,
  ADD COLUMN IF NOT EXISTS entregado_por              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entregado_por_nombre       text;

COMMENT ON COLUMN public.objetos_perdidos.lugar_encontrado IS
  'Snapshot del nombre del área donde se encontró (area_encontrado_id). En lo legado, el texto escrito a mano.';
COMMENT ON COLUMN public.objetos_perdidos.area_encontrado_id IS
  'Área del catálogo (areas_condominio) donde se encontró. NULL = legado o sin área.';
COMMENT ON COLUMN public.objetos_perdidos.encontrado_por_tipo IS
  'personal | tercero. NULL = registro legado, anterior a 20261119000000.';
COMMENT ON COLUMN public.objetos_perdidos.encontrado_por_personal_id IS
  'Empleado (personal_condominio) que lo encontró. NULL si fue un tercero o si el empleado se dio de baja.';
COMMENT ON COLUMN public.objetos_perdidos.encontrado_por_nombre IS
  'Snapshot del nombre de quien lo encontró: el del empleado (lo pone el trigger) o el del tercero.';
COMMENT ON COLUMN public.objetos_perdidos.encontrado_por_contacto IS
  'Teléfono, unidad u otro dato de contacto del tercero que lo encontró. Opcional.';
COMMENT ON COLUMN public.objetos_perdidos.fotos IS
  'Rutas de las fotos del objeto en condominios-media (<project_id>/objetos-perdidos/...). Máximo 6.';
COMMENT ON COLUMN public.objetos_perdidos.custodio_personal_id IS
  'Empleado (personal_condominio) que tiene el objeto bajo custodia.';
COMMENT ON COLUMN public.objetos_perdidos.custodio_nombre IS
  'Snapshot del nombre del custodio (lo pone el trigger desde la ficha).';
COMMENT ON COLUMN public.objetos_perdidos.area_almacenamiento_id IS
  'Área del catálogo (areas_condominio) donde se guarda mientras está en custodia.';
COMMENT ON COLUMN public.objetos_perdidos.almacenamiento_detalle IS
  'Dónde exactamente dentro del área de almacenamiento (gaveta, estante, caja). Opcional.';
COMMENT ON COLUMN public.objetos_perdidos.reclamado_por IS
  'Nombre de la persona que recibe el objeto en la entrega (firma de recibido).';
COMMENT ON COLUMN public.objetos_perdidos.entrega_documento IS
  'Documento de identificación de quien recibe. Opcional.';
COMMENT ON COLUMN public.objetos_perdidos.firma_entrega_path IS
  'Firma de recibido en condominios-media (<project_id>/objetos-perdidos/firmas/...). Obligatoria para pasar a reclamado.';
COMMENT ON COLUMN public.objetos_perdidos.entregado_en IS
  'Hora de servidor de la entrega. La sella el trigger.';
COMMENT ON COLUMN public.objetos_perdidos.entregado_por IS
  'Usuario que registró la entrega. Lo sella el trigger con auth.uid().';
COMMENT ON COLUMN public.objetos_perdidos.entregado_por_nombre IS
  'Snapshot del nombre del usuario que registró la entrega.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. FKs por tenant
-- ────────────────────────────────────────────────────────────────────────────
-- Con MATCH SIMPLE (el default) una FK compuesta no se evalúa cuando su
-- primera columna es NULL —company_id y project_id son NOT NULL—: se salta en
-- las filas legadas y muerde en todas las nuevas. Las columnas nacen vacías,
-- así que validarlas al crearlas no escanea nada que pueda fallar.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'areas_id_tenant_uq') THEN
    RAISE EXCEPTION 'objetos_perdidos: falta el ancla areas_id_tenant_uq en areas_condominio (¿se aplicó 20260904000400?)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_condominio_id_tenant_uq') THEN
    RAISE EXCEPTION 'objetos_perdidos: falta el ancla personal_condominio_id_tenant_uq (¿se aplicó 20260916171325?)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'objetos_area_encontrado_tenant_fk') THEN
    ALTER TABLE public.objetos_perdidos
      ADD CONSTRAINT objetos_area_encontrado_tenant_fk
      FOREIGN KEY (area_encontrado_id, company_id, project_id)
      REFERENCES public.areas_condominio (id, company_id, project_id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'objetos_area_almacenamiento_tenant_fk') THEN
    ALTER TABLE public.objetos_perdidos
      ADD CONSTRAINT objetos_area_almacenamiento_tenant_fk
      FOREIGN KEY (area_almacenamiento_id, company_id, project_id)
      REFERENCES public.areas_condominio (id, company_id, project_id)
      ON DELETE RESTRICT;
  END IF;
  -- SET NULL con lista de columnas: sin ella Postgres pondría NULL también en
  -- company_id y project_id (NOT NULL) y no se podría dar de baja a nadie que
  -- haya encontrado o custodiado un objeto.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'objetos_encontrado_por_personal_fk') THEN
    ALTER TABLE public.objetos_perdidos
      ADD CONSTRAINT objetos_encontrado_por_personal_fk
      FOREIGN KEY (encontrado_por_personal_id, company_id, project_id)
      REFERENCES public.personal_condominio (id, company_id, project_id)
      ON DELETE SET NULL (encontrado_por_personal_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'objetos_custodio_personal_fk') THEN
    ALTER TABLE public.objetos_perdidos
      ADD CONSTRAINT objetos_custodio_personal_fk
      FOREIGN KEY (custodio_personal_id, company_id, project_id)
      REFERENCES public.personal_condominio (id, company_id, project_id)
      ON DELETE SET NULL (custodio_personal_id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_objetos_area_encontrado
  ON public.objetos_perdidos(area_encontrado_id) WHERE area_encontrado_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_objetos_area_almacenamiento
  ON public.objetos_perdidos(area_almacenamiento_id) WHERE area_almacenamiento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_objetos_encontrado_por_personal
  ON public.objetos_perdidos(encontrado_por_personal_id) WHERE encontrado_por_personal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_objetos_custodio_personal
  ON public.objetos_perdidos(custodio_personal_id) WHERE custodio_personal_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. CHECKs
-- ────────────────────────────────────────────────────────────────────────────
-- Las filas existentes tienen las columnas nuevas en NULL / '{}', así que los
-- tres se cumplen sin tocar nada.
DO $$
BEGIN
  -- Un tercero no es un empleado y tiene nombre. Personal con el id en NULL es
  -- válido: es lo que deja el ON DELETE SET NULL al dar de baja a la ficha.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'objetos_encontrado_por_check') THEN
    ALTER TABLE public.objetos_perdidos
      ADD CONSTRAINT objetos_encontrado_por_check CHECK (
        encontrado_por_tipo IS NULL
        OR encontrado_por_tipo = 'personal'
        OR (encontrado_por_tipo = 'tercero'
            AND encontrado_por_personal_id IS NULL
            AND btrim(COALESCE(encontrado_por_nombre, '')) <> ''));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'objetos_fotos_max') THEN
    ALTER TABLE public.objetos_perdidos
      ADD CONSTRAINT objetos_fotos_max CHECK (cardinality(fotos) <= 6);
  END IF;
  -- Una entrega sellada está completa y sólo existe en un objeto reclamado.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'objetos_entrega_completa') THEN
    ALTER TABLE public.objetos_perdidos
      ADD CONSTRAINT objetos_entrega_completa CHECK (
        entregado_en IS NULL
        OR (estado = 'reclamado'
            AND btrim(COALESCE(reclamado_por, '')) <> ''
            AND btrim(COALESCE(firma_entrega_path, '')) <> ''));
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Trigger de coherencia
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.objetos_perdidos_coherente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ficha   public.personal_condominio;
  v_nombre  text;
  v_firma   text;
BEGIN
  -- Quién lo registró: el servidor, al crear. Después no se reescribe (editar
  -- ya no lo cambia por el editor), salvo el NULL del ON DELETE SET NULL.
  IF TG_OP = 'INSERT' THEN
    NEW.registrado_por := COALESCE(auth.uid(), NEW.registrado_por);
  ELSIF NEW.registrado_por IS DISTINCT FROM OLD.registrado_por AND NEW.registrado_por IS NOT NULL THEN
    NEW.registrado_por := OLD.registrado_por;
  END IF;

  -- ── Quién lo encontró ────────────────────────────────────────────────────
  -- Los nombres del personal son snapshots: se toman de la ficha cuando se
  -- elige al empleado y no se reescriben mientras siga siendo el mismo. Sin
  -- ficha (ON DELETE SET NULL) el nombre que quedó es el último conocido.
  IF NEW.encontrado_por_tipo = 'tercero' THEN
    NEW.encontrado_por_personal_id := NULL;
    NEW.encontrado_por_nombre      := NULLIF(btrim(NEW.encontrado_por_nombre), '');
    NEW.encontrado_por_contacto    := NULLIF(btrim(NEW.encontrado_por_contacto), '');
  ELSIF NEW.encontrado_por_tipo = 'personal' THEN
    NEW.encontrado_por_contacto := NULL;
    IF NEW.encontrado_por_personal_id IS NULL THEN
      IF TG_OP = 'INSERT' OR OLD.encontrado_por_tipo IS DISTINCT FROM 'personal' THEN
        RAISE EXCEPTION 'OBJETO_ENCONTRADO_SIN_EMPLEADO: elige al empleado que lo encontró'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.encontrado_por_nombre := OLD.encontrado_por_nombre;
    ELSIF TG_OP = 'UPDATE' AND NEW.encontrado_por_personal_id IS NOT DISTINCT FROM OLD.encontrado_por_personal_id THEN
      NEW.encontrado_por_nombre := OLD.encontrado_por_nombre;
    ELSE
      SELECT * INTO v_ficha FROM public.personal_condominio WHERE id = NEW.encontrado_por_personal_id;
      IF NOT FOUND OR v_ficha.project_id IS DISTINCT FROM NEW.project_id THEN
        RAISE EXCEPTION 'OBJETO_PERSONAL_AJENO: quien lo encontró no es personal de este condominio'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.encontrado_por_nombre := btrim(v_ficha.nombre);
    END IF;
  END IF;

  -- ── Custodia ─────────────────────────────────────────────────────────────
  IF NEW.custodio_personal_id IS NULL THEN
    -- Sin custodio elegido no hay nombre libre. En un UPDATE el nombre que
    -- quedó se conserva si no lo tocan (es lo que hace el ON DELETE SET NULL).
    IF TG_OP = 'INSERT' THEN NEW.custodio_nombre := NULL; END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.custodio_personal_id IS NOT DISTINCT FROM OLD.custodio_personal_id THEN
    NEW.custodio_nombre := OLD.custodio_nombre;
  ELSE
    SELECT * INTO v_ficha FROM public.personal_condominio WHERE id = NEW.custodio_personal_id;
    IF NOT FOUND OR v_ficha.project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'OBJETO_PERSONAL_AJENO: el custodio no es personal de este condominio'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.custodio_nombre := btrim(v_ficha.nombre);
  END IF;
  NEW.almacenamiento_detalle := NULLIF(btrim(NEW.almacenamiento_detalle), '');

  -- ── Entrega ──────────────────────────────────────────────────────────────
  IF TG_OP = 'UPDATE' AND OLD.estado = 'reclamado' THEN
    -- Una entrega registrada no se deshace ni se reescribe. Lo legado (sin
    -- firma) también queda como está: no se le agrega una firma después.
    IF NEW.estado IS DISTINCT FROM OLD.estado
       OR NEW.reclamado_por        IS DISTINCT FROM OLD.reclamado_por
       OR NEW.fecha_reclamo        IS DISTINCT FROM OLD.fecha_reclamo
       OR NEW.entrega_documento    IS DISTINCT FROM OLD.entrega_documento
       OR NEW.firma_entrega_path   IS DISTINCT FROM OLD.firma_entrega_path
       OR NEW.entregado_en         IS DISTINCT FROM OLD.entregado_en
       OR NEW.entregado_por_nombre IS DISTINCT FROM OLD.entregado_por_nombre
       OR (NEW.entregado_por IS DISTINCT FROM OLD.entregado_por AND NEW.entregado_por IS NOT NULL) THEN
      RAISE EXCEPTION 'OBJETO_ENTREGA_INMUTABLE: la entrega firmada de este objeto no se modifica'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.estado = 'reclamado' THEN
    NEW.reclamado_por     := NULLIF(btrim(NEW.reclamado_por), '');
    NEW.entrega_documento := NULLIF(btrim(NEW.entrega_documento), '');
    v_firma               := btrim(COALESCE(NEW.firma_entrega_path, ''));
    IF NEW.reclamado_por IS NULL THEN
      RAISE EXCEPTION 'OBJETO_ENTREGA_SIN_RECEPTOR: falta el nombre de quien recibe el objeto'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_firma = '' THEN
      RAISE EXCEPTION 'OBJETO_ENTREGA_SIN_FIRMA: la firma de recibido es obligatoria'
        USING ERRCODE = 'check_violation';
    END IF;
    -- La firma es de ESTE condominio y ya está subida.
    IF NOT starts_with(v_firma, NEW.project_id::text || '/objetos-perdidos/firmas/') OR v_firma LIKE '%..%' THEN
      RAISE EXCEPTION 'OBJETO_ENTREGA_FIRMA_AJENA: la firma no corresponde a este condominio'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o
                    WHERE o.bucket_id = 'condominios-media' AND o.name = v_firma) THEN
      RAISE EXCEPTION 'OBJETO_ENTREGA_FIRMA_NO_SUBIDA: la firma no llegó a subirse, intenta de nuevo'
        USING ERRCODE = '22023';
    END IF;
    SELECT a.full_name INTO v_nombre FROM public.app_users a WHERE a.id = auth.uid();
    NEW.firma_entrega_path   := v_firma;
    NEW.fecha_reclamo        := COALESCE(NEW.fecha_reclamo, CURRENT_DATE);
    NEW.entregado_en         := now();
    NEW.entregado_por        := auth.uid();
    NEW.entregado_por_nombre := NULLIF(btrim(v_nombre), '');
  ELSE
    -- Sin entrega no hay sello de entrega.
    NEW.entrega_documento    := NULL;
    NEW.firma_entrega_path   := NULL;
    NEW.entregado_en         := NULL;
    NEW.entregado_por        := NULL;
    NEW.entregado_por_nombre := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.objetos_perdidos_coherente() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.objetos_perdidos_coherente() IS
  'BEFORE INSERT OR UPDATE de objetos_perdidos: snapshots de quien encontró y del custodio desde sus fichas (de este condominio), registrado_por sellado, y la entrega al propietario exige receptor y firma subida, se sella con hora y usuario de servidor y no se modifica después.';

DROP TRIGGER IF EXISTS trg_objetos_perdidos_coherente ON public.objetos_perdidos;
CREATE TRIGGER trg_objetos_perdidos_coherente
  BEFORE INSERT OR UPDATE ON public.objetos_perdidos
  FOR EACH ROW EXECUTE FUNCTION public.objetos_perdidos_coherente();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Guarda de postcondición
-- ────────────────────────────────────────────────────────────────────────────
-- Que las columnas existan no prueba que las FK sean las correctas: sin
-- RESTRICT, borrar un área se llevaría los objetos; con una FK simple, un
-- objeto podría quedar en un área o con un empleado de otro condominio; con
-- SET NULL sin lista de columnas, no se podría dar de baja a nadie.
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n
  FROM pg_constraint
  WHERE conrelid  = 'public.objetos_perdidos'::regclass
    AND contype   = 'f'
    AND confrelid = 'public.areas_condominio'::regclass
    AND confdeltype = 'r'
    AND array_length(conkey, 1) = 3;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'objetos_perdidos: se esperaban 2 FK compuestas a areas_condominio con ON DELETE RESTRICT, hay %', v_n;
  END IF;

  SELECT count(*) INTO v_n
  FROM pg_constraint
  WHERE conrelid  = 'public.objetos_perdidos'::regclass
    AND contype   = 'f'
    AND confrelid = 'public.personal_condominio'::regclass
    AND confdeltype = 'n'
    AND array_length(conkey, 1) = 3
    AND array_length(confdelsetcols, 1) = 1;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'objetos_perdidos: se esperaban 2 FK compuestas a personal_condominio con ON DELETE SET NULL (columna), hay %', v_n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.objetos_perdidos'::regclass
                    AND tgname = 'trg_objetos_perdidos_coherente' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'objetos_perdidos: falta el trigger trg_objetos_perdidos_coherente';
  END IF;
END;
$$;
