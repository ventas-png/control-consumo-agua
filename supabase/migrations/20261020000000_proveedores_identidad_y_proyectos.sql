-- ════════════════════════════════════════════════════════════════════════════
-- PROVEEDORES · IDENTIDAD CANÓNICA, CÓDIGO VISIBLE, CONTACTOS Y PROYECTOS
-- (PR A, entrega 1 de 4 — ver docs/PROVEEDORES_PR_A.md)
--
-- POR QUÉ EXISTE
-- `proveedores` ya es EL catálogo (lo usan CxP, órdenes de compra y las
-- pantallas de Operaciones), pero su identidad es débil:
--   · la única unicidad es `(company_id, nombre)` exacto: "Ferretería X" y
--     "FERRETERIA X, S.A." conviven, y dos filas con el MISMO NIT también;
--   · no hay país, así que "mismo NIT" no se puede distinguir de "mismo número
--     en otro país";
--   · no hay código visible: la gente acaba usando el código de la cuenta
--     contable como si fuera el del proveedor;
--   · no se puede decir en qué PROYECTOS opera, ni distinguir la autorización
--     general (empresa) de la habilitación para un proyecto;
--   · un solo contacto en texto, y `proveedor_documentos` (RTU, DPI del
--     representante, referencia bancaria) la lee CUALQUIER usuario de la empresa.
--
-- QUÉ HACE (todo aditivo)
--   1. `pais`, `codigo`, `abastece`, `alcance` en `proveedores` y la
--      identificación fiscal NORMALIZADA (`identificacion_norm`, columna
--      generada: mayúsculas y solo letras/dígitos; "C/F" y similares no cuentan
--      como identificación).
--   2. Guarda anti-duplicado en el servidor, con candado consultivo para que
--      dos altas simultáneas no pasen las dos. NO fusiona nada ni mira
--      parecidos de nombre. Los duplicados LEGADOS se dejan como están y se
--      listan con `proveedores_duplicados_fiscales()` para que una persona
--      decida.
--   3. Código visible por empresa, asignado por correlativo si no se da. NUNCA
--      es una FK y no tiene relación con `conta_cuentas.codigo`.
--   4. `proveedor_contactos`: varios contactos reutilizables por contratos.
--   5. `proveedor_proyectos`: vínculo proveedor↔proyecto con su propio estado
--      de HABILITACIÓN (pendiente/habilitado/suspendido/retirado) y
--      `proveedor_habilitado_en(proveedor, proyecto)`.
--   6. El candado de la orden de compra consulta también la habilitación por
--      proyecto (trigger nuevo; no se toca `compras_tg_oc_estado`).
--   7. La papelería del proveedor deja de ser legible por cualquier usuario de
--      la empresa: exige poder ver Contabilidad.
--
-- COMPATIBILIDAD
--   · Todos los proveedores existentes quedan con `alcance = 'empresa'`, que es
--     exactamente lo que ya eran (sirven a todas las contabilidades de la
--     empresa). Nadie pierde acceso.
--   · `pais` y `codigo` quedan NULL en lo legado: no se inventa ni un país ni
--     un código. Un país NULL se trata como comodín en la guarda de duplicados
--     (más prudente que suponer que son distintos).
--   · No se asigna ni se revoca autorización a nadie.
--
-- CÓMO REVERTIR (en este orden)
--   DROP TRIGGER trg_compras_oc_proveedor_proyecto ON public.ordenes_compra;
--   DROP FUNCTION public.compras_tg_oc_proveedor_proyecto();
--   restaurar la policy proveedor_documentos_select de 20260821000000;
--   DROP FUNCTION public.prov_puede_ver_papeleria();
--   DROP TABLE public.proveedor_proyectos, public.proveedor_contactos,
--              public.proveedor_correlativos;
--   DROP FUNCTION public.proveedor_habilitado_en(uuid, uuid),
--     public.proveedores_duplicados_fiscales(), public.proveedor_siguiente_codigo(uuid);
--   DROP TRIGGER trg_proveedores_identidad ON public.proveedores;
--   DROP FUNCTION public.proveedores_tg_identidad();
--   ALTER TABLE public.proveedores DROP COLUMN identificacion_norm, DROP COLUMN
--     alcance, DROP COLUMN abastece, DROP COLUMN codigo, DROP COLUMN pais;
--   DROP FUNCTION public.proveedor_normalizar_identificacion(text);
--
-- IMPACTO EN DATOS PRODUCTIVOS: `ADD COLUMN … GENERATED … STORED` reescribe la
-- tabla `proveedores` (pocas filas, bloqueo breve). No modifica ninguna fila
-- existente más allá de eso y no crea datos.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Normalización de la identificación fiscal ────────────────────────────
-- IMMUTABLE porque alimenta una columna generada. Deliberadamente NO quita los
-- ceros a la izquierda: "0123" y "123" pueden ser identificaciones distintas y
-- unirlas sería exactamente la fusión silenciosa que se quiere evitar.
-- Los marcadores de "no tiene" (consumidor final, no aplica…) devuelven NULL:
-- no identifican a nadie y no deben chocar entre sí.
CREATE OR REPLACE FUNCTION public.proveedor_normalizar_identificacion(p_texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE
           WHEN s.n = '' THEN NULL
           WHEN s.n IN ('CF', 'CONSUMIDORFINAL', 'NA', 'SN', 'SINNIT', 'NOAPLICA',
                        'NINGUNO', 'NINGUNA', 'PENDIENTE') THEN NULL
           ELSE s.n
         END
    FROM (SELECT regexp_replace(upper(coalesce(p_texto, '')), '[^A-Z0-9]', '', 'g') AS n) s
$$;

REVOKE EXECUTE ON FUNCTION public.proveedor_normalizar_identificacion(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.proveedor_normalizar_identificacion(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.proveedor_normalizar_identificacion(text) IS
  'Identificación fiscal normalizada: mayúsculas, solo A-Z/0-9, sin quitar ceros. NULL para vacío y marcadores como C/F. Misma regla que src/domain/proveedores/identidad.ts.';

-- ── 2. Columnas nuevas de la identidad ──────────────────────────────────────
ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS codigo   text,
  ADD COLUMN IF NOT EXISTS pais     text,
  ADD COLUMN IF NOT EXISTS abastece text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS alcance  text   NOT NULL DEFAULT 'empresa',
  ADD COLUMN IF NOT EXISTS identificacion_norm text
    GENERATED ALWAYS AS (
      public.proveedor_normalizar_identificacion(
        COALESCE(NULLIF(btrim(nit), ''), NULLIF(btrim(rfc), '')))
    ) STORED;

ALTER TABLE public.proveedores
  ADD CONSTRAINT proveedores_pais_formato
    CHECK (pais IS NULL OR pais ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT proveedores_codigo_formato
    CHECK (codigo IS NULL OR codigo ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$'),
  ADD CONSTRAINT proveedores_abastece_valido
    CHECK (abastece <@ ARRAY['servicios', 'suministros', 'equipos']::text[]),
  ADD CONSTRAINT proveedores_alcance_valido
    CHECK (alcance IN ('empresa', 'proyectos'));

-- Único por empresa y sin distinguir mayúsculas. Parcial: lo legado (NULL) no
-- cuenta. NO es la clave foránea de nada: todas las relaciones usan `id`.
CREATE UNIQUE INDEX uq_proveedores_codigo
  ON public.proveedores (company_id, lower(codigo))
  WHERE codigo IS NOT NULL;

CREATE INDEX idx_proveedores_identificacion
  ON public.proveedores (company_id, identificacion_norm)
  WHERE identificacion_norm IS NOT NULL;

CREATE INDEX idx_proveedores_nombre_lower
  ON public.proveedores (company_id, lower(nombre));

COMMENT ON COLUMN public.proveedores.codigo IS
  'Código visible del proveedor (por empresa, único sin distinguir mayúsculas). NO es FK ni código contable: las relaciones usan `id`.';
COMMENT ON COLUMN public.proveedores.pais IS
  'País de la identificación fiscal (ISO 3166-1 alfa-2). NULL = desconocido (lo legado); la guarda de duplicados lo trata como comodín.';
COMMENT ON COLUMN public.proveedores.abastece IS
  'Qué provee: servicios, suministros y/o equipos. Un proveedor puede ser varias cosas.';
COMMENT ON COLUMN public.proveedores.alcance IS
  'empresa = sirve a todas las contabilidades de la empresa (lo legado); proyectos = solo a los proyectos donde proveedor_proyectos lo habilita.';
COMMENT ON COLUMN public.proveedores.identificacion_norm IS
  'Generada: nit/rfc normalizados (proveedor_normalizar_identificacion). Base de la guarda de duplicados.';

-- ── 3. Correlativo del código (deny-all: solo lo mueve la función) ──────────
CREATE TABLE public.proveedor_correlativos (
  company_id uuid   PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  ultimo     bigint NOT NULL DEFAULT 0
);

ALTER TABLE public.proveedor_correlativos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "proveedor_correlativos_deny_all" ON public.proveedor_correlativos;
CREATE POLICY "proveedor_correlativos_deny_all" ON public.proveedor_correlativos
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.proveedor_correlativos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proveedor_correlativos TO service_role;

CREATE OR REPLACE FUNCTION public.proveedor_siguiente_codigo(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n   bigint;
  v_cod text;
BEGIN
  -- Salta los códigos ya tomados a mano o por importación (PRV-00007 escrito
  -- por una persona no puede romper el correlativo).
  LOOP
    INSERT INTO public.proveedor_correlativos (company_id, ultimo)
    VALUES (p_company_id, 1)
    ON CONFLICT (company_id) DO UPDATE SET ultimo = public.proveedor_correlativos.ultimo + 1
    RETURNING ultimo INTO v_n;

    v_cod := 'PRV-' || lpad(v_n::text, 5, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.proveedores p
       WHERE p.company_id = p_company_id AND lower(p.codigo) = lower(v_cod));
  END LOOP;
  RETURN v_cod;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.proveedor_siguiente_codigo(uuid) FROM PUBLIC, anon, authenticated;

-- ── 4. Guarda de identidad ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.proveedores_tg_identidad()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_norm     text;
  v_norm_old text;
  v_dup      record;
BEGIN
  NEW.pais   := NULLIF(upper(btrim(NEW.pais)), '');
  NEW.codigo := NULLIF(btrim(NEW.codigo), '');

  IF TG_OP = 'INSERT' AND NEW.codigo IS NULL THEN
    NEW.codigo := public.proveedor_siguiente_codigo(NEW.company_id);
  END IF;

  -- La columna generada todavía no existe en un BEFORE: se calcula la misma
  -- expresión.
  v_norm := public.proveedor_normalizar_identificacion(
    COALESCE(NULLIF(btrim(NEW.nit), ''), NULLIF(btrim(NEW.rfc), '')));

  IF TG_OP = 'UPDATE' THEN
    v_norm_old := public.proveedor_normalizar_identificacion(
      COALESCE(NULLIF(btrim(OLD.nit), ''), NULLIF(btrim(OLD.rfc), '')));
  END IF;

  -- Solo cuando la IDENTIDAD cambia (o nace). Editar el teléfono de un
  -- proveedor que ya está duplicado de antes no puede quedar bloqueado: esos
  -- casos se resuelven con proveedores_duplicados_fiscales(), no aquí.
  IF v_norm IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR v_norm IS DISTINCT FROM v_norm_old
          OR NEW.pais IS DISTINCT FROM OLD.pais) THEN

    -- Candado consultivo: dos altas simultáneas del mismo NIT se serializan y
    -- la segunda ve a la primera.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('proveedor-identidad:' || NEW.company_id::text || ':' || v_norm, 0));

    SELECT p.id, p.nombre, p.codigo INTO v_dup
      FROM public.proveedores p
     WHERE p.company_id = NEW.company_id
       AND p.id <> NEW.id
       AND p.identificacion_norm = v_norm
       AND (p.pais IS NULL OR NEW.pais IS NULL OR p.pais = NEW.pais)
     LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'PROVEEDOR_DUPLICADO: la identificación fiscal ya pertenece a "%" (código %). Usa ese proveedor o corrige la identificación.',
        v_dup.nombre, COALESCE(v_dup.codigo, 's/código')
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.proveedores_tg_identidad() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_proveedores_identidad ON public.proveedores;
CREATE TRIGGER trg_proveedores_identidad
  BEFORE INSERT OR UPDATE ON public.proveedores
  FOR EACH ROW EXECUTE FUNCTION public.proveedores_tg_identidad();

-- ── 5. Duplicados LEGADOS: se listan, nunca se fusionan ─────────────────────
CREATE OR REPLACE FUNCTION public.proveedores_duplicados_fiscales()
RETURNS TABLE (
  identificacion_norm text,
  cantidad            int,
  paises              text[],
  proveedores         jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
BEGIN
  IF v_company IS NULL OR NOT public.conta_puede_escribir('edit') THEN
    RAISE EXCEPTION 'No autorizado para revisar duplicados de proveedores.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT p.identificacion_norm,
         count(*)::int,
         array_agg(DISTINCT p.pais) FILTER (WHERE p.pais IS NOT NULL),
         jsonb_agg(jsonb_build_object(
           'id', p.id, 'codigo', p.codigo, 'nombre', p.nombre, 'pais', p.pais,
           'estado', p.estado) ORDER BY p.created_at, p.id)
    FROM public.proveedores p
   WHERE p.company_id = v_company
     AND p.identificacion_norm IS NOT NULL
   GROUP BY p.identificacion_norm
  HAVING count(*) > 1
     -- Mismo número en dos países CONOCIDOS distintos no es duplicado.
     AND count(DISTINCT p.pais) <= 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.proveedores_duplicados_fiscales() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.proveedores_duplicados_fiscales() TO authenticated;

COMMENT ON FUNCTION public.proveedores_duplicados_fiscales() IS
  'Grupos de proveedores de LA EMPRESA con la misma identificación fiscal normalizada y el mismo país (o país desconocido). Solo informa: no fusiona ni modifica.';

-- ── 6. Contactos reutilizables ──────────────────────────────────────────────
CREATE TABLE public.proveedor_contactos (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  proveedor_id uuid        NOT NULL REFERENCES public.proveedores(id) ON DELETE CASCADE,
  nombre       text        NOT NULL CHECK (btrim(nombre) <> ''),
  cargo        text,
  email        text,
  telefono     text,
  es_principal boolean     NOT NULL DEFAULT false,
  activo       boolean     NOT NULL DEFAULT true,
  notas        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_proveedor_contactos_proveedor ON public.proveedor_contactos (proveedor_id);
-- A lo sumo UN contacto principal por proveedor.
CREATE UNIQUE INDEX uq_proveedor_contacto_principal
  ON public.proveedor_contactos (proveedor_id) WHERE es_principal;

COMMENT ON TABLE public.proveedor_contactos IS
  'Contactos del proveedor, reutilizables por contratos. El contrato además puede guardar un contacto propio (fotografía) sin tocar este.';

CREATE OR REPLACE FUNCTION public.proveedor_contactos_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.proveedores p
     WHERE p.id = NEW.proveedor_id AND p.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'PROVEEDOR_AJENO: el proveedor no pertenece a la empresa del contacto.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.proveedor_id <> OLD.proveedor_id OR NEW.company_id <> OLD.company_id) THEN
    RAISE EXCEPTION 'PROVEEDOR_CONTACTO_INMUTABLE: un contacto no cambia de proveedor.'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.proveedor_contactos_tg() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_proveedor_contactos
  BEFORE INSERT OR UPDATE ON public.proveedor_contactos
  FOR EACH ROW EXECUTE FUNCTION public.proveedor_contactos_tg();

-- ── 7. Vínculo proveedor ↔ proyecto con habilitación propia ─────────────────
-- AUTORIZACIÓN GENERAL (proveedores.estado, nivel empresa) ≠ HABILITACIÓN POR
-- PROYECTO (esta tabla): un proveedor autorizado en la empresa puede estar
-- habilitado en el proyecto A, pendiente en el B y suspendido en el C, con
-- condiciones distintas en cada uno.
CREATE TABLE public.proveedor_proyectos (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  proveedor_id     uuid        NOT NULL REFERENCES public.proveedores(id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  estado           text        NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente', 'habilitado', 'suspendido', 'retirado')),
  motivo_estado    text,
  habilitado_por   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  habilitado_at    timestamptz,
  vigente_hasta    date,
  -- Configuración propia del proyecto: lo que cambia de un proyecto a otro.
  dias_credito     int         CHECK (dias_credito IS NULL OR dias_credito >= 0),
  condiciones_pago text,
  notas            text,
  created_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_proveedor_proyecto UNIQUE (proveedor_id, project_id),
  CONSTRAINT proveedor_proyecto_motivo
    CHECK (estado NOT IN ('suspendido', 'retirado') OR btrim(COALESCE(motivo_estado, '')) <> '')
);

CREATE INDEX idx_proveedor_proyectos_proyecto ON public.proveedor_proyectos (project_id, estado);
CREATE INDEX idx_proveedor_proyectos_company  ON public.proveedor_proyectos (company_id);

COMMENT ON TABLE public.proveedor_proyectos IS
  'Habilitación del proveedor POR PROYECTO, distinta de su autorización general. Importar o vincular solo crea filas pendientes: habilitar exige el permiso de cambio de estado y un proveedor autorizado.';

CREATE OR REPLACE FUNCTION public.proveedor_proyectos_tg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sistema boolean := COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on';
  v_cambia  boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.proveedores p
     WHERE p.id = NEW.proveedor_id AND p.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'PROVEEDOR_AJENO: el proveedor no pertenece a la empresa del vínculo.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects pr
     WHERE pr.id = NEW.project_id AND pr.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'PROYECTO_AJENO: el proyecto no pertenece a la empresa del vínculo.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' AND (NEW.proveedor_id <> OLD.proveedor_id
                           OR NEW.project_id <> OLD.project_id
                           OR NEW.company_id <> OLD.company_id) THEN
    RAISE EXCEPTION 'PROVEEDOR_PROYECTO_INMUTABLE: el vínculo no cambia de proveedor ni de proyecto.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_cambia := TG_OP = 'INSERT' OR NEW.estado IS DISTINCT FROM OLD.estado;

  -- Habilitar, suspender o retirar es una decisión, no una edición: exige el
  -- permiso de cambio de estado. Quedar `pendiente` (vincular) no.
  IF v_cambia AND NEW.estado <> 'pendiente' AND NOT v_sistema
     AND auth.uid() IS NOT NULL
     AND NOT public.conta_puede_escribir('change_status') THEN
    RAISE EXCEPTION 'COMPRAS_NO_AUTORIZADO: cambiar la habilitación de un proveedor en un proyecto requiere el permiso de cambio de estado en Contabilidad.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- No se habilita en un proyecto a quien la empresa no ha autorizado.
  IF v_cambia AND NEW.estado = 'habilitado'
     AND NOT public.proveedor_habilitado(NEW.proveedor_id) THEN
    RAISE EXCEPTION 'PROVEEDOR_NO_AUTORIZADO: el proveedor no está autorizado (o su autorización venció) a nivel empresa; autorízalo antes de habilitarlo en un proyecto.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_cambia AND NEW.estado = 'habilitado' THEN
    NEW.habilitado_por := COALESCE(auth.uid(), NEW.habilitado_por);
    NEW.habilitado_at  := now();
  ELSIF v_cambia AND NEW.estado <> 'habilitado' THEN
    NEW.habilitado_por := NULL;
    NEW.habilitado_at  := NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(NEW.created_by, auth.uid());
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.proveedor_proyectos_tg() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_proveedor_proyectos
  BEFORE INSERT OR UPDATE ON public.proveedor_proyectos
  FOR EACH ROW EXECUTE FUNCTION public.proveedor_proyectos_tg();

-- ── 8. «¿Puedo comprarle a este proveedor EN ESTE proyecto, hoy?» ───────────
-- Capas, de la más general a la más específica:
--   1. autorización general vigente (proveedor_habilitado, ya existente);
--   2. un veto del proyecto (suspendido/retirado) gana aunque el alcance sea
--      de empresa;
--   3. alcance 'empresa' → habilitado en todo proyecto sin veto y en la
--      contabilidad de la empresa (p_project_id NULL);
--   4. alcance 'proyectos' → exige un vínculo HABILITADO y vigente en ese
--      proyecto; sin proyecto (contabilidad de empresa) no aplica.
CREATE OR REPLACE FUNCTION public.proveedor_habilitado_en(p_proveedor_id uuid, p_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prov record;
  v_pp   record;
BEGIN
  SELECT p.company_id, p.alcance INTO v_prov
    FROM public.proveedores p WHERE p.id = p_proveedor_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- No sirve para sondear proveedores de otra empresa.
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin()
     AND v_prov.company_id IS DISTINCT FROM public.get_my_company_id() THEN
    RETURN false;
  END IF;

  IF NOT public.proveedor_habilitado(p_proveedor_id) THEN
    RETURN false;
  END IF;

  IF p_project_id IS NOT NULL THEN
    SELECT pp.estado, pp.vigente_hasta INTO v_pp
      FROM public.proveedor_proyectos pp
     WHERE pp.proveedor_id = p_proveedor_id AND pp.project_id = p_project_id;

    IF FOUND AND v_pp.estado IN ('suspendido', 'retirado') THEN
      RETURN false;
    END IF;
  END IF;

  IF v_prov.alcance = 'empresa' THEN
    RETURN true;
  END IF;

  IF p_project_id IS NULL OR v_pp IS NULL THEN
    RETURN false;
  END IF;

  RETURN v_pp.estado = 'habilitado'
     AND (v_pp.vigente_hasta IS NULL OR v_pp.vigente_hasta >= CURRENT_DATE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.proveedor_habilitado_en(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.proveedor_habilitado_en(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.proveedor_habilitado_en(uuid, uuid) IS
  'true si el proveedor está autorizado a nivel empresa y habilitado para el proyecto (o es de alcance empresa y no está vetado en él). p_project_id NULL = contabilidad de la empresa.';

-- ── 9. La orden de compra consulta también la habilitación por proyecto ─────
-- Trigger APARTE de compras_tg_oc_estado (no se reescribe una función de 60
-- líneas por añadir una condición) y en los MISMOS momentos: aprobar o emitir.
-- Capturar el borrador no se bloquea.
CREATE OR REPLACE FUNCTION public.compras_tg_oc_proveedor_proyecto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.proveedor_id IS NOT NULL
     AND NEW.estado IN ('aprobada', 'emitida')
     AND (TG_OP = 'INSERT'
          OR OLD.estado NOT IN ('aprobada', 'emitida', 'recibida_parcial', 'recibida', 'cerrada')) THEN

    -- La autorización general ya la valida compras_tg_oc_estado; aquí solo lo
    -- que añade el proyecto, para que el mensaje diga la causa real.
    IF public.proveedor_habilitado(NEW.proveedor_id)
       AND NOT public.proveedor_habilitado_en(NEW.proveedor_id, NEW.project_id) THEN
      RAISE EXCEPTION 'COMPRAS_PROVEEDOR_PROYECTO_NO_HABILITADO: el proveedor no está habilitado para %. Habilítalo en ese proyecto (o amplía su alcance) antes de emitirle órdenes.',
        CASE WHEN NEW.project_id IS NULL THEN 'la contabilidad de la empresa' ELSE 'este proyecto' END
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_oc_proveedor_proyecto() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_oc_proveedor_proyecto ON public.ordenes_compra;
CREATE TRIGGER trg_compras_oc_proveedor_proyecto
  BEFORE INSERT OR UPDATE ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_oc_proveedor_proyecto();

-- ── 10. Papelería: ya no la lee cualquier usuario de la empresa ─────────────
-- RTU, DPI del representante y referencia bancaria son sensibles. Quien solo
-- necesita saber QUÉ proveedor es (Operaciones) no necesita sus documentos.
CREATE OR REPLACE FUNCTION public.prov_puede_ver_papeleria()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_super_admin()
      OR public.current_user_role() = ANY (ARRAY['company_owner', 'admin', 'contador'])
      OR public.user_has_permission('platform.contabilidad.view')
$$;

REVOKE EXECUTE ON FUNCTION public.prov_puede_ver_papeleria() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.prov_puede_ver_papeleria() TO authenticated;

COMMENT ON FUNCTION public.prov_puede_ver_papeleria() IS
  'Quién puede leer proveedor_documentos: super admin, owner/admin/contador o permiso platform.contabilidad.view. Los usuarios operativos ven al proveedor, no su papelería.';

DROP POLICY IF EXISTS "proveedor_documentos_select" ON public.proveedor_documentos;
CREATE POLICY "proveedor_documentos_select" ON public.proveedor_documentos
  FOR SELECT TO authenticated
  USING (is_super_admin()
         OR (company_id = get_my_company_id() AND public.prov_puede_ver_papeleria()));

-- ── 11. RLS y permisos de las tablas nuevas ─────────────────────────────────
ALTER TABLE public.proveedor_contactos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proveedor_proyectos ENABLE ROW LEVEL SECURITY;

-- Contactos: lectura operativa para la empresa (Operaciones los reutiliza en
-- contratos); escritura como el resto del catálogo de proveedores.
CREATE POLICY "proveedor_contactos_select" ON public.proveedor_contactos
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "proveedor_contactos_insert" ON public.proveedor_contactos
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin()
              OR (company_id = get_my_company_id() AND public.conta_puede_escribir('create')));
CREATE POLICY "proveedor_contactos_update" ON public.proveedor_contactos
  FOR UPDATE TO authenticated
  USING (is_super_admin()
         OR (company_id = get_my_company_id() AND public.conta_puede_escribir('edit')))
  WITH CHECK (is_super_admin()
              OR (company_id = get_my_company_id() AND public.conta_puede_escribir('edit')));
CREATE POLICY "proveedor_contactos_delete" ON public.proveedor_contactos
  FOR DELETE TO authenticated
  USING (is_super_admin()
         OR (company_id = get_my_company_id() AND public.conta_puede_escribir('delete')));

-- Vínculos: ven solo los de los proyectos a los que se tiene acceso; escribe
-- quien puede escribir proveedores Y ve ese proyecto. `can_access_project`
-- devuelve true para NULL, pero project_id es NOT NULL aquí.
CREATE POLICY "proveedor_proyectos_select" ON public.proveedor_proyectos
  FOR SELECT TO authenticated
  USING (is_super_admin()
         OR (company_id = get_my_company_id() AND public.can_access_project(project_id)));
CREATE POLICY "proveedor_proyectos_insert" ON public.proveedor_proyectos
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin()
              OR (company_id = get_my_company_id()
                  AND public.can_access_project(project_id)
                  AND public.conta_puede_escribir('create')));
CREATE POLICY "proveedor_proyectos_update" ON public.proveedor_proyectos
  FOR UPDATE TO authenticated
  USING (is_super_admin()
         OR (company_id = get_my_company_id()
             AND public.can_access_project(project_id)
             AND public.conta_puede_escribir('edit')))
  WITH CHECK (is_super_admin()
              OR (company_id = get_my_company_id()
                  AND public.can_access_project(project_id)
                  AND public.conta_puede_escribir('edit')));
CREATE POLICY "proveedor_proyectos_delete" ON public.proveedor_proyectos
  FOR DELETE TO authenticated
  USING (is_super_admin()
         OR (company_id = get_my_company_id()
             AND public.can_access_project(project_id)
             AND public.conta_puede_escribir('delete')));

-- El proyecto tiene ALTER DEFAULT PRIVILEGES que da los siete privilegios a
-- `authenticated` sobre toda tabla nueva: se parte de cero y se concede lo
-- justo (la RLS sigue siendo la que decide qué filas).
REVOKE ALL ON public.proveedor_contactos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.proveedor_proyectos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proveedor_contactos TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proveedor_proyectos TO authenticated, service_role;

-- Historial de quién habilitó/suspendió y quién cambió un contacto.
CREATE TRIGGER audit_proveedor_proyectos
  AFTER INSERT OR UPDATE OR DELETE ON public.proveedor_proyectos
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
CREATE TRIGGER audit_proveedor_contactos
  AFTER INSERT OR UPDATE OR DELETE ON public.proveedor_contactos
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
