-- ════════════════════════════════════════════════════════════════════════════
-- CARGA MASIVA DE PROVEEDORES, ASIGNACIONES A PROYECTOS Y CONTRATOS
-- (PR A — el servidor es la autoridad)
--
-- POR QUÉ NO SE REUTILIZA EL FLUJO DE `ImportModal`
-- El importador compartido valida en el NAVEGADOR e inserta lotes de 100 desde
-- ahí. Para estas tres cargas eso no sirve:
--   · un fallo a mitad de camino deja los primeros lotes aplicados y el reintento
--     los DUPLICA (no hay identidad ni idempotencia);
--   · no hay registro de quién cargó qué ni de qué pasó con cada fila;
--   · las reglas (duplicados contra la base, ámbito de proyecto, permisos) vivían
--     en el cliente: quien llama a la API directamente se las salta.
-- Aquí el navegador SOLO convierte el archivo en filas de texto; este módulo
-- valida, calcula qué se crearía/actualizaría y qué campos cambiarían, registra
-- el lote y las filas, y aplica de forma atómica e idempotente.
--
-- FLUJO
--   1. proveedores_importar_previsualizar(tipo, filas, opciones, …)
--        → crea el LOTE (estado `previsualizado`) y una fila de resultado por
--          fila del archivo: acción (crear/actualizar/sin_cambios/omitir/error),
--          diferencias campo a campo, errores y advertencias. NO modifica el
--          catálogo.
--   2. proveedores_importar_aplicar(lote, modo)
--        · `todo_o_nada`: si hay UNA fila con error, no aplica nada; si todas
--          pasan, las aplica en una transacción y, si algo falla, no queda nada.
--        · `filas_validas`: aplica las que pasan, cada una aislada; las demás
--          quedan marcadas con su motivo y el lote queda `aplicado_parcial`.
--          NUNCA es silencioso: el resultado cuenta cada caso y las filas
--          conservan su estado.
--        Reaplicar un lote ya aplicado devuelve su resultado sin ejecutar nada.
--        Antes de escribir se RE-EVALÚA cada fila contra el estado actual: si la
--        base cambió desde la vista previa, esa fila no se aplica a ciegas.
--   3. proveedores_importar_descartar(lote).
--
-- REGLAS QUE ESTE MÓDULO HACE CUMPLIR
--   · Importar NO autoriza: los proveedores nacen en `borrador`, las
--     asignaciones en `pendiente` y los contratos en `borrador`. Cualquier columna
--     de estado/autorización en el archivo es un error de la fila.
--   · NO sobrescribe por celdas vacías salvo opción explícita `vaciar_vacios`.
--   · NO actualiza lo existente salvo opción explícita `actualizar_existentes`.
--   · Identidad: código, o identificación fiscal normalizada + país. NUNCA el
--     parecido de nombres (un nombre parecido es una ADVERTENCIA, no una unión).
--   · Duplicados dentro del archivo y contra la base se detectan por fila.
--   · Ámbito: el proyecto debe ser de la empresa Y accesible para quien carga.
--   · Un contrato existente solo se actualiza mientras esté en borrador; si ya
--     salió de borrador, repetir el mismo archivo da `sin_cambios` y uno
--     distinto es un error (no se reescribe lo firmado).
--   · Texto plano: un valor que empiece con `=` o `@` se rechaza (posible
--     fórmula). Nada del archivo se interpreta ni se ejecuta.
--
-- CÓMO REVERTIR: DROP de las funciones prov_imp_*, proveedores_importar_* y de
-- las tablas proveedor_importacion_filas y proveedor_importaciones.
-- IMPACTO EN DATOS PRODUCTIVOS: ninguno; las tablas nacen vacías.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Lotes y filas ─────────────────────────────────────────────────────────
CREATE TABLE public.proveedor_importaciones (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tipo              text        NOT NULL CHECK (tipo IN ('proveedores', 'asignaciones', 'contratos')),
  archivo_nombre    text,
  archivo_sha256    text,
  contenido_sha256  text        NOT NULL,
  opciones          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  estado            text        NOT NULL DEFAULT 'previsualizado'
                    CHECK (estado IN ('previsualizado', 'aplicando', 'aplicado', 'aplicado_parcial',
                                      'fallido', 'descartado')),
  modo              text        CHECK (modo IS NULL OR modo IN ('todo_o_nada', 'filas_validas')),
  resumen           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  resultado         jsonb,
  created_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  aplicado_por      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  aplicado_at       timestamptz
);

CREATE INDEX idx_prov_import_lotes ON public.proveedor_importaciones (company_id, tipo, created_at DESC);
CREATE INDEX idx_prov_import_contenido
  ON public.proveedor_importaciones (company_id, tipo, contenido_sha256);

CREATE TABLE public.proveedor_importacion_filas (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id       uuid        NOT NULL REFERENCES public.proveedor_importaciones(id) ON DELETE CASCADE,
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tipo          text        NOT NULL,
  fila          int         NOT NULL,
  origen        jsonb       NOT NULL,
  accion        text        NOT NULL CHECK (accion IN ('crear', 'actualizar', 'sin_cambios', 'omitir', 'error')),
  estado        text        NOT NULL DEFAULT 'pendiente'
                CHECK (estado IN ('pendiente', 'aplicada', 'sin_cambios', 'omitida', 'error')),
  entidad_id    uuid,
  datos         jsonb,
  cambios       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  errores       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  advertencias  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  resultado     text,
  CONSTRAINT uq_prov_import_fila UNIQUE (lote_id, fila)
);

CREATE INDEX idx_prov_import_filas_lote ON public.proveedor_importacion_filas (lote_id, fila);

COMMENT ON TABLE public.proveedor_importaciones IS
  'Lote de carga masiva: quién, cuándo, qué archivo, qué opciones y cómo terminó. Lo escriben solo las RPC proveedores_importar_*.';
COMMENT ON TABLE public.proveedor_importacion_filas IS
  'Resultado por fila de un lote: acción calculada, diferencias, errores, advertencias y estado de aplicación.';

-- Quién puede ver/usar cada tipo de carga: el mismo permiso que la pantalla.
CREATE OR REPLACE FUNCTION public.prov_import_puede(p_tipo text, p_accion text DEFAULT 'create')
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_tipo
           WHEN 'proveedores'  THEN public.conta_puede_escribir(p_accion)
           WHEN 'asignaciones' THEN public.conta_puede_escribir(p_accion)
           WHEN 'contratos'    THEN public.user_has_permission('condominios.tab.proveedores')
           ELSE false
         END
$$;
REVOKE EXECUTE ON FUNCTION public.prov_import_puede(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.prov_import_puede(text, text) TO authenticated;

ALTER TABLE public.proveedor_importaciones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proveedor_importacion_filas  ENABLE ROW LEVEL SECURITY;

-- Solo lectura desde la aplicación; sin policies de escritura a propósito.
-- Un lote lo ve QUIEN LO CREÓ, o un rol con alcance total (owner / admin sin
-- asignaciones): sus filas citan proyectos y proveedores, y quien solo tiene
-- acceso a un proyecto no debe leer lo que otro cargó para otro. Las filas
-- siguen al lote (la subconsulta aplica la RLS del lote).
CREATE POLICY "proveedor_importaciones_select" ON public.proveedor_importaciones
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND public.prov_import_puede(tipo)
             AND (created_by = auth.uid() OR public.user_is_project_exempt())));
CREATE POLICY "proveedor_importacion_filas_select" ON public.proveedor_importacion_filas
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.proveedor_importaciones l WHERE l.id = lote_id));

REVOKE ALL ON public.proveedor_importaciones     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.proveedor_importacion_filas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.proveedor_importaciones     TO authenticated;
GRANT SELECT ON public.proveedor_importacion_filas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proveedor_importaciones     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proveedor_importacion_filas TO service_role;

CREATE TRIGGER audit_proveedor_importaciones
  AFTER INSERT OR UPDATE OR DELETE ON public.proveedor_importaciones
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- ── 2. Helpers de lectura de celdas ──────────────────────────────────────────
-- Texto limpio: sin controles, espacios colapsados; vacío = NULL. Todo valor se
-- trata como TEXTO (los códigos y las identificaciones no son números).
CREATE OR REPLACE FUNCTION public.prov_imp_txt(p_fila jsonb, p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(btrim(regexp_replace(
           regexp_replace(
             CASE jsonb_typeof(p_fila -> p_key)
               WHEN 'string'  THEN p_fila ->> p_key
               WHEN 'number'  THEN p_fila ->> p_key
               WHEN 'boolean' THEN p_fila ->> p_key
             END,
             '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'),
           '\s+', ' ', 'g')), '')
$$;

CREATE OR REPLACE FUNCTION public.prov_imp_fecha(p_texto text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_texto IS NULL OR p_texto !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN NULL; END IF;
  RETURN p_texto::date;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.prov_imp_err(p_lista jsonb, p_campo text, p_mensaje text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT p_lista || jsonb_build_array(jsonb_build_object('campo', p_campo, 'mensaje', p_mensaje))
$$;

-- Un valor que empieza con = o @ puede ser una fórmula de hoja de cálculo.
CREATE OR REPLACE FUNCTION public.prov_imp_sospechoso(p_texto text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT p_texto IS NOT NULL AND p_texto ~ '^[=@]'
$$;

REVOKE EXECUTE ON FUNCTION public.prov_imp_txt(jsonb, text)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prov_imp_fecha(text)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prov_imp_err(jsonb, text, text)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prov_imp_sospechoso(text)        FROM PUBLIC, anon, authenticated;

-- Resuelve el proveedor de una fila de asignación/contrato por código o por
-- identificación+país. Devuelve id (o NULL) y un error si es ambiguo.
CREATE OR REPLACE FUNCTION public.prov_imp_resolver_proveedor(
  p_company uuid, p_codigo text, p_identificacion text, p_pais text,
  OUT o_id uuid, OUT o_error text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_norm text := public.proveedor_normalizar_identificacion(p_identificacion);
  v_n    int;
BEGIN
  IF p_codigo IS NOT NULL THEN
    SELECT p.id INTO o_id FROM public.proveedores p
     WHERE p.company_id = p_company AND lower(p.codigo) = lower(p_codigo);
    IF o_id IS NULL THEN
      o_error := format('No existe un proveedor con código «%s». Impórtalo o créalo primero.', p_codigo);
    END IF;
    RETURN;
  END IF;

  IF v_norm IS NOT NULL THEN
    SELECT count(*), min(p.id::text)::uuid INTO v_n, o_id
      FROM public.proveedores p
     WHERE p.company_id = p_company AND p.identificacion_norm = v_norm
       AND (p.pais IS NULL OR p_pais IS NULL OR p.pais = p_pais);
    IF v_n = 0 THEN
      o_id := NULL;
      o_error := 'No existe un proveedor con esa identificación fiscal. Impórtalo o créalo primero.';
    ELSIF v_n > 1 THEN
      o_id := NULL;
      o_error := 'Varios proveedores comparten esa identificación fiscal (duplicados legados): usa el código del proveedor.';
    END IF;
    RETURN;
  END IF;

  o_error := 'Indica el código del proveedor o su identificación fiscal con país.';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.prov_imp_resolver_proveedor(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;

-- Resuelve un proyecto de la empresa por id o por nombre exacto normalizado y
-- comprueba que quien carga lo puede ver.
CREATE OR REPLACE FUNCTION public.prov_imp_resolver_proyecto(
  p_company uuid, p_proyecto text, p_proyecto_id text,
  OUT o_id uuid, OUT o_error text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n int;
BEGIN
  IF p_proyecto_id IS NOT NULL THEN
    IF p_proyecto_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      o_error := 'proyecto_id no es un identificador válido.';
      RETURN;
    END IF;
    SELECT pr.id INTO o_id FROM public.projects pr
     WHERE pr.id = p_proyecto_id::uuid AND pr.company_id = p_company;
  ELSIF p_proyecto IS NOT NULL THEN
    SELECT count(*), min(pr.id::text)::uuid INTO v_n, o_id
      FROM public.projects pr
     WHERE pr.company_id = p_company
       AND public.proveedor_normalizar_nombre(pr.nombre) = public.proveedor_normalizar_nombre(p_proyecto);
    IF v_n > 1 THEN
      o_id := NULL;
      o_error := format('Hay %s proyectos llamados «%s»: usa la columna proyecto_id.', v_n, p_proyecto);
      RETURN;
    END IF;
  ELSE
    o_error := 'Indica el proyecto.';
    RETURN;
  END IF;

  IF o_id IS NULL THEN
    o_error := 'El proyecto no existe en tu empresa.';
  ELSIF NOT public.can_access_project(o_id) THEN
    o_id := NULL;
    o_error := 'No tienes acceso a ese proyecto.';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.prov_imp_resolver_proyecto(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

-- ── 3. Evaluación de UNA fila de proveedor ───────────────────────────────────
-- Devuelve la ACCIÓN y las diferencias sin escribir nada. La usan la vista
-- previa y, de nuevo, la aplicación (para no aplicar a ciegas).
CREATE OR REPLACE FUNCTION public.prov_imp_eval_proveedor(
  p_company uuid, p_fila jsonb, p_op jsonb)
RETURNS TABLE (accion text, entidad_id uuid, datos jsonb, cambios jsonb,
               errores jsonb, advertencias jsonb, claves text[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_err   jsonb := '[]'::jsonb;
  v_adv   jsonb := '[]'::jsonb;
  v_cambios jsonb := '{}'::jsonb;
  v_claves  text[] := '{}';
  v_actualizar boolean := COALESCE((p_op ->> 'actualizar_existentes')::boolean, false);
  v_vaciar     boolean := COALESCE((p_op ->> 'vaciar_vacios')::boolean, false);
  v_codigo text; v_nombre text; v_pais text; v_nit text; v_rfc text; v_email text;
  v_tel text; v_dir text; v_cont text; v_dias_t text; v_dias int; v_cat text;
  v_abast_t text; v_abast text[]; v_alcance text; v_notas text;
  v_norm text;
  v_ex   public.proveedores%ROWTYPE;
  v_ex_id uuid;
  v_ids  uuid[];
  v_otros uuid[];
  v_otro record;
  v_dato jsonb;
  k text;
  v_nuevo text; v_antes text;
  v_campos text[] := ARRAY['nombre','pais','nit','rfc','email','telefono','direccion',
                           'contacto_nombre','dias_credito','categoria_default','abastece',
                           'alcance','notas'];
  v_validos text[] := ARRAY['codigo','nombre','pais','nit','rfc','email','telefono','direccion',
                            'contacto_nombre','dias_credito','categoria_default','abastece',
                            'alcance','notas'];
BEGIN
  -- Columnas de estado/autorización: no se aceptan por importación.
  FOR k IN SELECT jsonb_object_keys(p_fila) LOOP
    IF k ~* '(estado|autoriz|vigencia|activo|habilit)' AND public.prov_imp_txt(p_fila, k) IS NOT NULL THEN
      v_err := public.prov_imp_err(v_err, k,
        'Importar no autoriza ni cambia el estado de un proveedor: quita esta columna. La autorización se hace en pantalla, con su permiso.');
    ELSIF NOT (k = ANY (v_validos)) AND k !~* '(estado|autoriz|vigencia|activo|habilit)'
          AND public.prov_imp_txt(p_fila, k) IS NOT NULL THEN
      v_adv := public.prov_imp_err(v_adv, k, 'Columna desconocida: se ignora.');
    END IF;
  END LOOP;

  v_codigo := public.prov_imp_txt(p_fila, 'codigo');
  v_nombre := public.prov_imp_txt(p_fila, 'nombre');
  v_pais   := upper(public.prov_imp_txt(p_fila, 'pais'));
  v_nit    := public.prov_imp_txt(p_fila, 'nit');
  v_rfc    := public.prov_imp_txt(p_fila, 'rfc');
  v_email  := public.prov_imp_txt(p_fila, 'email');
  v_tel    := public.prov_imp_txt(p_fila, 'telefono');
  v_dir    := public.prov_imp_txt(p_fila, 'direccion');
  v_cont   := public.prov_imp_txt(p_fila, 'contacto_nombre');
  v_dias_t := public.prov_imp_txt(p_fila, 'dias_credito');
  v_cat    := lower(public.prov_imp_txt(p_fila, 'categoria_default'));
  v_abast_t:= lower(public.prov_imp_txt(p_fila, 'abastece'));
  v_alcance:= lower(public.prov_imp_txt(p_fila, 'alcance'));
  v_notas  := public.prov_imp_txt(p_fila, 'notas');

  -- Texto plano: nada que parezca fórmula.
  FOREACH k IN ARRAY ARRAY['codigo','nombre','nit','rfc','email','telefono','direccion',
                           'contacto_nombre','notas'] LOOP
    IF public.prov_imp_sospechoso(public.prov_imp_txt(p_fila, k)) THEN
      v_err := public.prov_imp_err(v_err, k, 'El valor empieza con = o @ (posible fórmula): no se acepta.');
    END IF;
  END LOOP;

  -- Formatos.
  IF v_codigo IS NOT NULL AND v_codigo !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$' THEN
    v_err := public.prov_imp_err(v_err, 'codigo', 'Código inválido: letras, dígitos y . _ / - (máx. 40).');
  END IF;
  IF v_nombre IS NOT NULL AND (length(v_nombre) < 2 OR length(v_nombre) > 150) THEN
    v_err := public.prov_imp_err(v_err, 'nombre', 'El nombre debe tener entre 2 y 150 caracteres.');
  END IF;
  IF v_pais IS NOT NULL AND v_pais !~ '^[A-Z]{2}$' THEN
    v_err := public.prov_imp_err(v_err, 'pais', 'El país es un código de 2 letras (ej. GT, MX).');
  END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    v_err := public.prov_imp_err(v_err, 'email', 'Correo inválido.');
  END IF;
  IF v_tel IS NOT NULL AND length(v_tel) > 30 THEN
    v_err := public.prov_imp_err(v_err, 'telefono', 'Teléfono demasiado largo (máx. 30).');
  END IF;
  IF v_nit IS NOT NULL AND length(v_nit) > 20 THEN
    v_err := public.prov_imp_err(v_err, 'nit', 'NIT demasiado largo (máx. 20).');
  END IF;
  IF v_rfc IS NOT NULL AND length(v_rfc) > 20 THEN
    v_err := public.prov_imp_err(v_err, 'rfc', 'RFC demasiado largo (máx. 20).');
  END IF;
  IF v_dias_t IS NOT NULL THEN
    IF v_dias_t ~ '^\d{1,3}$' AND v_dias_t::int <= 365 THEN
      v_dias := v_dias_t::int;
    ELSE
      v_err := public.prov_imp_err(v_err, 'dias_credito', 'Días de crédito: entero entre 0 y 365.');
    END IF;
  END IF;
  IF v_cat IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.compras_categorias() c WHERE c.categoria = v_cat) THEN
    v_err := public.prov_imp_err(v_err, 'categoria_default',
      'Categoría desconocida (mantenimiento, servicios, administrativo, seguridad, limpieza, obras, otros).');
  END IF;
  IF v_alcance IS NOT NULL AND v_alcance NOT IN ('empresa', 'proyectos') THEN
    v_err := public.prov_imp_err(v_err, 'alcance', 'Alcance: empresa o proyectos.');
  END IF;
  IF v_abast_t IS NOT NULL THEN
    SELECT array_agg(DISTINCT btrim(x) ORDER BY btrim(x)) INTO v_abast
      FROM unnest(regexp_split_to_array(v_abast_t, '[;,|/]+')) AS x WHERE btrim(x) <> '';
    IF v_abast IS NULL OR NOT (v_abast <@ ARRAY['servicios','suministros','equipos']) THEN
      v_err := public.prov_imp_err(v_err, 'abastece',
        'Qué abastece: servicios, suministros y/o equipos, separados por ;');
      v_abast := NULL;
    END IF;
  END IF;

  v_norm := public.proveedor_normalizar_identificacion(COALESCE(v_nit, v_rfc));
  IF v_norm IS NOT NULL AND v_pais IS NULL THEN
    v_err := public.prov_imp_err(v_err, 'pais',
      'Si hay identificación fiscal, indica su país: sin él no se puede distinguir de un número igual en otro país.');
  END IF;

  -- Claves de duplicado DENTRO del archivo (las compara el llamador).
  IF v_codigo IS NOT NULL THEN v_claves := v_claves || ('codigo:' || lower(v_codigo)); END IF;
  -- La clave lleva el PAÍS: el mismo número en dos países es otro proveedor.
  IF v_norm   IS NOT NULL THEN v_claves := v_claves || ('id:' || COALESCE(v_pais, '?') || ':' || v_norm); END IF;
  IF v_codigo IS NULL AND v_norm IS NULL AND v_nombre IS NOT NULL THEN
    v_claves := v_claves || ('nombre:' || public.proveedor_normalizar_nombre(v_nombre));
  END IF;

  -- ── Identidad: ¿a quién se refiere la fila? ────────────────────────────────
  IF v_codigo IS NOT NULL THEN
    SELECT * INTO v_ex FROM public.proveedores p
     WHERE p.company_id = p_company AND lower(p.codigo) = lower(v_codigo);
    IF FOUND THEN v_ex_id := v_ex.id; END IF;
  END IF;

  IF v_norm IS NOT NULL THEN
    SELECT array_agg(p.id) INTO v_ids FROM public.proveedores p
     WHERE p.company_id = p_company AND p.identificacion_norm = v_norm
       AND (p.pais IS NULL OR v_pais IS NULL OR p.pais = v_pais);
  END IF;
  v_otros := ARRAY(SELECT x FROM unnest(COALESCE(v_ids, '{}'::uuid[])) x WHERE x IS DISTINCT FROM v_ex_id);

  IF v_ex_id IS NOT NULL AND cardinality(v_otros) > 0 THEN
    SELECT p.codigo, p.nombre INTO v_otro FROM public.proveedores p WHERE p.id = v_otros[1];
    v_err := public.prov_imp_err(v_err, 'nit',
      format('La identificación fiscal pertenece a otro proveedor («%s», código %s). Revisa el código o la identificación.',
             v_otro.nombre, COALESCE(v_otro.codigo, 's/código')));
  ELSIF v_ex_id IS NULL AND cardinality(v_otros) > 1 THEN
    v_err := public.prov_imp_err(v_err, 'nit',
      'Varios proveedores legados comparten esa identificación (duplicados): resuélvelos antes de importar.');
  ELSIF v_ex_id IS NULL AND cardinality(v_otros) = 1 THEN
    SELECT * INTO v_ex FROM public.proveedores p WHERE p.id = v_otros[1];
    IF v_codigo IS NOT NULL THEN
      v_err := public.prov_imp_err(v_err, 'codigo',
        format('Esa identificación ya pertenece a «%s» (código %s): usa ese código para actualizarlo; no se crea otro.',
               v_ex.nombre, COALESCE(v_ex.codigo, 's/código')));
    ELSE
      v_ex_id := v_ex.id;
    END IF;
  END IF;

  IF v_ex_id IS NULL AND v_codigo IS NULL AND v_norm IS NULL AND v_nombre IS NOT NULL THEN
    -- Sin código ni identificación: el nombre NO une registros.
    SELECT p.codigo, p.nombre INTO v_otro FROM public.proveedores p
     WHERE p.company_id = p_company
       AND public.proveedor_normalizar_nombre(p.nombre) = public.proveedor_normalizar_nombre(v_nombre)
     LIMIT 1;
    IF FOUND THEN
      v_err := public.prov_imp_err(v_err, 'nombre',
        format('Ya existe un proveedor con ese nombre («%s», código %s). Los nombres no unen registros: para actualizarlo indica su código; para crear otro agrega su identificación fiscal.',
               v_otro.nombre, COALESCE(v_otro.codigo, 's/código')));
    ELSE
      v_adv := public.prov_imp_err(v_adv, 'nit',
        'Sin código ni identificación fiscal: no se pueden detectar duplicados futuros de este proveedor.');
    END IF;
  END IF;

  -- Nombre ya usado por OTRO proveedor (UNIQUE exacto) o muy parecido (aviso).
  IF v_nombre IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.proveedores p
                WHERE p.company_id = p_company AND p.nombre = v_nombre
                  AND p.id IS DISTINCT FROM v_ex_id) THEN
      v_err := public.prov_imp_err(v_err, 'nombre', 'Ya existe OTRO proveedor con exactamente ese nombre.');
    ELSIF EXISTS (SELECT 1 FROM public.proveedores p
                   WHERE p.company_id = p_company
                     AND public.proveedor_normalizar_nombre(p.nombre) = public.proveedor_normalizar_nombre(v_nombre)
                     AND p.id IS DISTINCT FROM v_ex_id) THEN
      v_adv := public.prov_imp_err(v_adv, 'nombre',
        'Hay otro proveedor con un nombre casi idéntico: verifica que no sea el mismo. No se unen por nombre.');
    END IF;
  END IF;

  -- ── Crear ──────────────────────────────────────────────────────────────────
  IF v_ex_id IS NULL THEN
    IF v_nombre IS NULL THEN
      v_err := public.prov_imp_err(v_err, 'nombre', 'El nombre es obligatorio para crear un proveedor.');
    END IF;
    v_dato := jsonb_strip_nulls(jsonb_build_object(
      'codigo', v_codigo, 'nombre', v_nombre, 'pais', v_pais, 'nit', v_nit, 'rfc', v_rfc,
      'email', v_email, 'telefono', v_tel, 'direccion', v_dir, 'contacto_nombre', v_cont,
      'dias_credito', COALESCE(v_dias, 0), 'categoria_default', v_cat,
      'abastece', to_jsonb(COALESCE(v_abast, '{}'::text[])),
      'alcance', COALESCE(v_alcance, 'empresa'), 'notas', v_notas));
    RETURN QUERY SELECT
      CASE WHEN jsonb_array_length(v_err) > 0 THEN 'error' ELSE 'crear' END,
      NULL::uuid, v_dato, '{}'::jsonb, v_err, v_adv, v_claves;
    RETURN;
  END IF;

  -- ── Actualizar: solo lo que CAMBIA ─────────────────────────────────────────
  FOREACH k IN ARRAY v_campos LOOP
    v_nuevo := CASE k
      WHEN 'nombre' THEN v_nombre WHEN 'pais' THEN v_pais WHEN 'nit' THEN v_nit WHEN 'rfc' THEN v_rfc
      WHEN 'email' THEN v_email WHEN 'telefono' THEN v_tel WHEN 'direccion' THEN v_dir
      WHEN 'contacto_nombre' THEN v_cont WHEN 'dias_credito' THEN v_dias::text
      WHEN 'categoria_default' THEN v_cat
      WHEN 'abastece' THEN array_to_string(v_abast, ';')
      WHEN 'alcance' THEN v_alcance WHEN 'notas' THEN v_notas END;
    v_antes := CASE k
      WHEN 'nombre' THEN v_ex.nombre WHEN 'pais' THEN v_ex.pais WHEN 'nit' THEN v_ex.nit
      WHEN 'rfc' THEN v_ex.rfc WHEN 'email' THEN v_ex.email WHEN 'telefono' THEN v_ex.telefono
      WHEN 'direccion' THEN v_ex.direccion WHEN 'contacto_nombre' THEN v_ex.contacto_nombre
      WHEN 'dias_credito' THEN v_ex.dias_credito::text
      WHEN 'categoria_default' THEN v_ex.categoria_default
      WHEN 'abastece' THEN array_to_string(ARRAY(SELECT unnest(v_ex.abastece) ORDER BY 1), ';')
      WHEN 'alcance' THEN v_ex.alcance WHEN 'notas' THEN v_ex.notas END;

    IF v_nuevo IS NULL THEN
      -- Celda vacía: NO borra, salvo opción explícita y solo si la columna vino
      -- en el archivo (clave presente). `nombre` nunca se vacía.
      IF v_vaciar AND p_fila ? k AND k <> 'nombre' AND v_antes IS NOT NULL
         AND NOT (k = 'dias_credito') AND NOT (k = 'abastece' AND v_antes = '')
         AND NOT (k = 'alcance') THEN
        v_cambios := v_cambios || jsonb_build_object(k, jsonb_build_object('antes', v_antes, 'despues', NULL));
      END IF;
    ELSIF v_nuevo IS DISTINCT FROM v_antes THEN
      v_cambios := v_cambios || jsonb_build_object(k, jsonb_build_object('antes', v_antes, 'despues', v_nuevo));
    END IF;
  END LOOP;

  IF v_cambios ? 'nit' OR v_cambios ? 'rfc' OR v_cambios ? 'pais' THEN
    v_adv := public.prov_imp_err(v_adv, 'nit', 'Esta fila CAMBIA la identificación fiscal o el país del proveedor.');
  END IF;

  RETURN QUERY SELECT
    CASE
      WHEN jsonb_array_length(v_err) > 0 THEN 'error'
      WHEN v_cambios = '{}'::jsonb       THEN 'sin_cambios'
      WHEN NOT v_actualizar              THEN 'omitir'
      ELSE 'actualizar'
    END,
    v_ex_id,
    jsonb_strip_nulls(jsonb_build_object(
      'codigo', v_ex.codigo, 'nombre', COALESCE(v_nombre, v_ex.nombre))),
    v_cambios, v_err,
    CASE WHEN v_cambios <> '{}'::jsonb AND NOT v_actualizar
         THEN public.prov_imp_err(v_adv, '(fila)',
              'El proveedor ya existe y esta fila lo cambiaría; no se aplica porque «actualizar existentes» está desactivado.')
         ELSE v_adv END,
    v_claves;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.prov_imp_eval_proveedor(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- ── 4. Evaluación de UNA fila de asignación proveedor ↔ proyecto ────────────
CREATE OR REPLACE FUNCTION public.prov_imp_eval_asignacion(
  p_company uuid, p_fila jsonb, p_op jsonb)
RETURNS TABLE (accion text, entidad_id uuid, datos jsonb, cambios jsonb,
               errores jsonb, advertencias jsonb, claves text[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_err jsonb := '[]'::jsonb;
  v_adv jsonb := '[]'::jsonb;
  v_cambios jsonb := '{}'::jsonb;
  v_actualizar boolean := COALESCE((p_op ->> 'actualizar_existentes')::boolean, false);
  v_vaciar     boolean := COALESCE((p_op ->> 'vaciar_vacios')::boolean, false);
  v_codigo text; v_ident text; v_pais text; v_pn text; v_pid text;
  v_dias_t text; v_dias int; v_cond text; v_hasta_t text; v_hasta date; v_notas text;
  v_prov uuid; v_proy uuid; v_msg text;
  v_ex public.proveedor_proyectos%ROWTYPE;
  v_claves text[] := '{}';
  v_dato jsonb;
  k text;
BEGIN
  FOR k IN SELECT jsonb_object_keys(p_fila) LOOP
    IF k ~* '(estado|autoriz|habilit)' AND public.prov_imp_txt(p_fila, k) IS NOT NULL THEN
      v_err := public.prov_imp_err(v_err, k,
        'Importar no habilita proveedores en proyectos: las filas quedan pendientes y se habilitan en pantalla, con permiso.');
    END IF;
  END LOOP;

  v_codigo := public.prov_imp_txt(p_fila, 'proveedor_codigo');
  v_ident  := public.prov_imp_txt(p_fila, 'proveedor_identificacion');
  v_pais   := upper(public.prov_imp_txt(p_fila, 'pais'));
  v_pn     := public.prov_imp_txt(p_fila, 'proyecto');
  v_pid    := public.prov_imp_txt(p_fila, 'proyecto_id');
  v_dias_t := public.prov_imp_txt(p_fila, 'dias_credito');
  v_cond   := public.prov_imp_txt(p_fila, 'condiciones_pago');
  v_hasta_t:= public.prov_imp_txt(p_fila, 'vigente_hasta');
  v_notas  := public.prov_imp_txt(p_fila, 'notas');

  FOREACH k IN ARRAY ARRAY['proveedor_codigo','proveedor_identificacion','proyecto','condiciones_pago','notas'] LOOP
    IF public.prov_imp_sospechoso(public.prov_imp_txt(p_fila, k)) THEN
      v_err := public.prov_imp_err(v_err, k, 'El valor empieza con = o @ (posible fórmula): no se acepta.');
    END IF;
  END LOOP;

  IF v_pais IS NOT NULL AND v_pais !~ '^[A-Z]{2}$' THEN
    v_err := public.prov_imp_err(v_err, 'pais', 'El país es un código de 2 letras.');
  END IF;
  IF v_ident IS NOT NULL AND v_codigo IS NULL AND v_pais IS NULL THEN
    v_err := public.prov_imp_err(v_err, 'pais', 'Con identificación fiscal indica el país.');
  END IF;
  IF v_dias_t IS NOT NULL THEN
    IF v_dias_t ~ '^\d{1,3}$' AND v_dias_t::int <= 365 THEN v_dias := v_dias_t::int;
    ELSE v_err := public.prov_imp_err(v_err, 'dias_credito', 'Días de crédito: entero entre 0 y 365.'); END IF;
  END IF;
  IF v_hasta_t IS NOT NULL THEN
    v_hasta := public.prov_imp_fecha(v_hasta_t);
    IF v_hasta IS NULL THEN
      v_err := public.prov_imp_err(v_err, 'vigente_hasta', 'Fecha inválida: usa AAAA-MM-DD.');
    END IF;
  END IF;

  SELECT o_id, o_error INTO v_prov, v_msg
    FROM public.prov_imp_resolver_proveedor(p_company, v_codigo, v_ident, v_pais);
  IF v_msg IS NOT NULL THEN
    v_err := public.prov_imp_err(v_err, 'proveedor', v_msg);
  END IF;

  SELECT o_id, o_error INTO v_proy, v_msg
    FROM public.prov_imp_resolver_proyecto(p_company, v_pn, v_pid);
  IF v_msg IS NOT NULL THEN
    v_err := public.prov_imp_err(v_err, 'proyecto', v_msg);
  END IF;

  IF v_prov IS NOT NULL AND v_proy IS NOT NULL THEN
    v_claves := ARRAY['asig:' || v_prov::text || ':' || v_proy::text];
    SELECT * INTO v_ex FROM public.proveedor_proyectos pp
     WHERE pp.proveedor_id = v_prov AND pp.project_id = v_proy;
  END IF;

  v_dato := jsonb_strip_nulls(jsonb_build_object(
    'proveedor_id', v_prov, 'project_id', v_proy, 'dias_credito', v_dias,
    'condiciones_pago', v_cond, 'vigente_hasta', v_hasta, 'notas', v_notas));

  IF jsonb_array_length(v_err) > 0 THEN
    RETURN QUERY SELECT 'error'::text, v_ex.id, v_dato, '{}'::jsonb, v_err, v_adv, v_claves;
    RETURN;
  END IF;

  IF v_ex.id IS NULL THEN
    RETURN QUERY SELECT 'crear'::text, NULL::uuid, v_dato, '{}'::jsonb, v_err,
      public.prov_imp_err(v_adv, '(fila)', 'Se crea PENDIENTE: habilitar al proveedor en el proyecto es una acción aparte, con su permiso.'),
      v_claves;
    RETURN;
  END IF;

  -- Existente: solo cambian las condiciones propias del proyecto, nunca el estado.
  IF v_dias IS NOT NULL AND v_dias IS DISTINCT FROM v_ex.dias_credito THEN
    v_cambios := v_cambios || jsonb_build_object('dias_credito',
      jsonb_build_object('antes', v_ex.dias_credito, 'despues', v_dias));
  ELSIF v_dias IS NULL AND v_vaciar AND p_fila ? 'dias_credito' AND v_ex.dias_credito IS NOT NULL THEN
    v_cambios := v_cambios || jsonb_build_object('dias_credito',
      jsonb_build_object('antes', v_ex.dias_credito, 'despues', NULL));
  END IF;
  IF v_cond IS NOT NULL AND v_cond IS DISTINCT FROM v_ex.condiciones_pago THEN
    v_cambios := v_cambios || jsonb_build_object('condiciones_pago',
      jsonb_build_object('antes', v_ex.condiciones_pago, 'despues', v_cond));
  ELSIF v_cond IS NULL AND v_vaciar AND p_fila ? 'condiciones_pago' AND v_ex.condiciones_pago IS NOT NULL THEN
    v_cambios := v_cambios || jsonb_build_object('condiciones_pago',
      jsonb_build_object('antes', v_ex.condiciones_pago, 'despues', NULL));
  END IF;
  IF v_hasta IS NOT NULL AND v_hasta IS DISTINCT FROM v_ex.vigente_hasta THEN
    v_cambios := v_cambios || jsonb_build_object('vigente_hasta',
      jsonb_build_object('antes', v_ex.vigente_hasta, 'despues', v_hasta));
  ELSIF v_hasta IS NULL AND v_vaciar AND p_fila ? 'vigente_hasta' AND v_ex.vigente_hasta IS NOT NULL THEN
    v_cambios := v_cambios || jsonb_build_object('vigente_hasta',
      jsonb_build_object('antes', v_ex.vigente_hasta, 'despues', NULL));
  END IF;
  IF v_notas IS NOT NULL AND v_notas IS DISTINCT FROM v_ex.notas THEN
    v_cambios := v_cambios || jsonb_build_object('notas',
      jsonb_build_object('antes', v_ex.notas, 'despues', v_notas));
  ELSIF v_notas IS NULL AND v_vaciar AND p_fila ? 'notas' AND v_ex.notas IS NOT NULL THEN
    v_cambios := v_cambios || jsonb_build_object('notas',
      jsonb_build_object('antes', v_ex.notas, 'despues', NULL));
  END IF;

  RETURN QUERY SELECT
    CASE WHEN v_cambios = '{}'::jsonb THEN 'sin_cambios'
         WHEN NOT v_actualizar        THEN 'omitir'
         ELSE 'actualizar' END,
    v_ex.id, v_dato, v_cambios, v_err,
    CASE WHEN v_cambios <> '{}'::jsonb AND NOT v_actualizar
         THEN public.prov_imp_err(v_adv, '(fila)',
              'La asignación ya existe y esta fila la cambiaría; no se aplica porque «actualizar existentes» está desactivado.')
         ELSE v_adv END,
    v_claves;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.prov_imp_eval_asignacion(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- ── 5. Evaluación de UNA fila de contrato ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prov_imp_eval_contrato(
  p_company uuid, p_fila jsonb, p_op jsonb)
RETURNS TABLE (accion text, entidad_id uuid, datos jsonb, cambios jsonb,
               errores jsonb, advertencias jsonb, claves text[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_err jsonb := '[]'::jsonb;
  v_adv jsonb := '[]'::jsonb;
  v_cambios jsonb := '{}'::jsonb;
  v_actualizar boolean := COALESCE((p_op ->> 'actualizar_existentes')::boolean, false);
  v_ref text; v_codigo text; v_ident text; v_pais text; v_pn text; v_pid text;
  v_serv text; v_mod text; v_per text; v_mon text;
  v_imp_t text; v_imp numeric; v_max_t text; v_max numeric;
  v_ini_t text; v_ini date; v_fin_t text; v_fin date;
  v_alc text; v_desc text;
  v_prov uuid; v_proy uuid; v_msg text; v_pst text;
  v_ex public.contratos_proveedores%ROWTYPE;
  v_claves text[] := '{}';
  v_dato jsonb;
  k text;
  v_nuevo text; v_antes text;
  v_campos text[] := ARRAY['servicio','modalidad','periodicidad','moneda','importe_periodico',
                           'monto_maximo','fecha_inicio','fecha_fin','alcance','descripcion'];
BEGIN
  FOR k IN SELECT jsonb_object_keys(p_fila) LOOP
    IF k ~* '(estado|activ|autoriz|firmad)' AND public.prov_imp_txt(p_fila, k) IS NOT NULL THEN
      v_err := public.prov_imp_err(v_err, k,
        'Importar no activa contratos: nacen en borrador y se activan en pantalla.');
    END IF;
  END LOOP;

  v_ref   := public.prov_imp_txt(p_fila, 'referencia');
  v_codigo:= public.prov_imp_txt(p_fila, 'proveedor_codigo');
  v_ident := public.prov_imp_txt(p_fila, 'proveedor_identificacion');
  v_pais  := upper(public.prov_imp_txt(p_fila, 'pais'));
  v_pn    := public.prov_imp_txt(p_fila, 'proyecto');
  v_pid   := public.prov_imp_txt(p_fila, 'proyecto_id');
  v_serv  := lower(COALESCE(public.prov_imp_txt(p_fila, 'servicio'), 'otro'));
  v_mod   := lower(public.prov_imp_txt(p_fila, 'modalidad'));
  v_per   := lower(public.prov_imp_txt(p_fila, 'periodicidad'));
  v_mon   := upper(public.prov_imp_txt(p_fila, 'moneda'));
  v_imp_t := public.prov_imp_txt(p_fila, 'importe_periodico');
  v_max_t := public.prov_imp_txt(p_fila, 'monto_maximo');
  v_ini_t := public.prov_imp_txt(p_fila, 'fecha_inicio');
  v_fin_t := public.prov_imp_txt(p_fila, 'fecha_fin');
  v_alc   := public.prov_imp_txt(p_fila, 'alcance');
  v_desc  := public.prov_imp_txt(p_fila, 'descripcion');

  FOREACH k IN ARRAY ARRAY['referencia','proveedor_codigo','proveedor_identificacion','proyecto',
                           'alcance','descripcion'] LOOP
    IF public.prov_imp_sospechoso(public.prov_imp_txt(p_fila, k)) THEN
      v_err := public.prov_imp_err(v_err, k, 'El valor empieza con = o @ (posible fórmula): no se acepta.');
    END IF;
  END LOOP;

  IF v_ref IS NULL THEN
    v_err := public.prov_imp_err(v_err, 'referencia',
      'La referencia es obligatoria: es la clave que permite reintentar la carga sin duplicar contratos.');
  ELSIF length(v_ref) > 60 THEN
    v_err := public.prov_imp_err(v_err, 'referencia', 'Referencia demasiado larga (máx. 60).');
  END IF;

  IF v_serv NOT IN ('limpieza','jardineria','seguridad','mantenimiento','elevadores','piscina','otro') THEN
    v_err := public.prov_imp_err(v_err, 'servicio',
      'Servicio: limpieza, jardineria, seguridad, mantenimiento, elevadores, piscina u otro.');
  END IF;
  IF v_mod IS NULL OR v_mod NOT IN ('recurrente', 'por_demanda') THEN
    v_err := public.prov_imp_err(v_err, 'modalidad', 'Modalidad: recurrente o por_demanda.');
  END IF;
  IF v_per IS NOT NULL AND v_per NOT IN ('semanal','quincenal','mensual','bimestral','trimestral','semestral','anual','unica') THEN
    v_err := public.prov_imp_err(v_err, 'periodicidad',
      'Periodicidad: semanal, quincenal, mensual, bimestral, trimestral, semestral, anual o unica.');
  END IF;
  IF v_mod = 'recurrente' AND v_per IS NULL THEN
    v_err := public.prov_imp_err(v_err, 'periodicidad', 'Un servicio recurrente necesita periodicidad.');
  END IF;
  IF v_mon IS NOT NULL AND v_mon !~ '^[A-Z]{3}$' THEN
    v_err := public.prov_imp_err(v_err, 'moneda', 'Moneda: código de 3 letras (ej. GTQ, USD).');
  END IF;

  -- Importes: punto decimal, sin separador de miles ambiguo.
  IF v_imp_t IS NOT NULL THEN
    IF v_imp_t ~ '^\d{1,12}(\.\d{1,2})?$' THEN v_imp := v_imp_t::numeric;
    ELSE v_err := public.prov_imp_err(v_err, 'importe_periodico', 'Importe inválido: número con punto decimal, sin separador de miles.'); END IF;
  END IF;
  IF v_max_t IS NOT NULL THEN
    IF v_max_t ~ '^\d{1,12}(\.\d{1,2})?$' THEN v_max := v_max_t::numeric;
    ELSE v_err := public.prov_imp_err(v_err, 'monto_maximo', 'Monto máximo inválido: número con punto decimal, sin separador de miles.'); END IF;
  END IF;
  IF v_mod = 'por_demanda' AND v_imp IS NOT NULL THEN
    v_err := public.prov_imp_err(v_err, 'importe_periodico',
      'Una compra por demanda no lleva importe periódico; usa monto_maximo si hay tope.');
  END IF;
  IF (v_imp IS NOT NULL OR v_max IS NOT NULL) AND v_mon IS NULL THEN
    v_err := public.prov_imp_err(v_err, 'moneda', 'Con importes indica la moneda.');
  END IF;

  v_ini := public.prov_imp_fecha(v_ini_t);
  IF v_ini_t IS NULL THEN
    v_err := public.prov_imp_err(v_err, 'fecha_inicio', 'La fecha de inicio es obligatoria.');
  ELSIF v_ini IS NULL THEN
    v_err := public.prov_imp_err(v_err, 'fecha_inicio', 'Fecha inválida: usa AAAA-MM-DD.');
  END IF;
  IF v_fin_t IS NOT NULL THEN
    v_fin := public.prov_imp_fecha(v_fin_t);
    IF v_fin IS NULL THEN
      v_err := public.prov_imp_err(v_err, 'fecha_fin', 'Fecha inválida: usa AAAA-MM-DD.');
    ELSIF v_ini IS NOT NULL AND v_fin < v_ini THEN
      v_err := public.prov_imp_err(v_err, 'fecha_fin', 'La fecha de fin es anterior a la de inicio.');
    END IF;
  END IF;

  IF v_pais IS NOT NULL AND v_pais !~ '^[A-Z]{2}$' THEN
    v_err := public.prov_imp_err(v_err, 'pais', 'El país es un código de 2 letras.');
  END IF;
  IF v_ident IS NOT NULL AND v_codigo IS NULL AND v_pais IS NULL THEN
    v_err := public.prov_imp_err(v_err, 'pais', 'Con identificación fiscal indica el país.');
  END IF;

  SELECT o_id, o_error INTO v_prov, v_msg
    FROM public.prov_imp_resolver_proveedor(p_company, v_codigo, v_ident, v_pais);
  IF v_msg IS NOT NULL THEN
    v_err := public.prov_imp_err(v_err, 'proveedor', v_msg);
  ELSE
    SELECT p.estado INTO v_pst FROM public.proveedores p WHERE p.id = v_prov;
    IF v_pst IN ('suspendido', 'vetado') THEN
      v_err := public.prov_imp_err(v_err, 'proveedor',
        format('El proveedor está %s: no se le crean contratos nuevos.', v_pst));
    END IF;
  END IF;

  SELECT o_id, o_error INTO v_proy, v_msg
    FROM public.prov_imp_resolver_proyecto(p_company, v_pn, v_pid);
  IF v_msg IS NOT NULL THEN
    v_err := public.prov_imp_err(v_err, 'proyecto', v_msg);
  END IF;

  IF v_ref IS NOT NULL AND v_proy IS NOT NULL THEN
    v_claves := ARRAY['ref:' || v_proy::text || ':' || lower(v_ref)];
    SELECT * INTO v_ex FROM public.contratos_proveedores c
     WHERE c.company_id = p_company AND c.project_id = v_proy AND lower(c.referencia) = lower(v_ref);
    IF v_ex.id IS NOT NULL AND v_prov IS NOT NULL AND v_ex.proveedor_id IS DISTINCT FROM v_prov THEN
      v_err := public.prov_imp_err(v_err, 'proveedor',
        'Esa referencia ya existe con OTRO proveedor: un contrato no cambia de proveedor.');
    END IF;
  END IF;

  v_dato := jsonb_strip_nulls(jsonb_build_object(
    'referencia', v_ref, 'proveedor_id', v_prov, 'project_id', v_proy, 'servicio', v_serv,
    'modalidad', v_mod, 'periodicidad', v_per, 'moneda', v_mon, 'importe_periodico', v_imp,
    'monto_maximo', v_max, 'fecha_inicio', v_ini, 'fecha_fin', v_fin, 'alcance', v_alc,
    'descripcion', v_desc));

  IF jsonb_array_length(v_err) > 0 THEN
    RETURN QUERY SELECT 'error'::text, v_ex.id, v_dato, '{}'::jsonb, v_err, v_adv, v_claves;
    RETURN;
  END IF;

  IF v_ex.id IS NULL THEN
    RETURN QUERY SELECT 'crear'::text, NULL::uuid, v_dato, '{}'::jsonb, v_err,
      public.prov_imp_err(v_adv, '(fila)', 'Se crea en BORRADOR: activarlo es una acción aparte; no genera facturas, pagos ni asientos.'),
      v_claves;
    RETURN;
  END IF;

  -- Existente: diferencias campo a campo.
  FOREACH k IN ARRAY v_campos LOOP
    v_nuevo := CASE k
      WHEN 'servicio' THEN v_serv WHEN 'modalidad' THEN v_mod WHEN 'periodicidad' THEN v_per
      WHEN 'moneda' THEN v_mon WHEN 'importe_periodico' THEN v_imp::text
      WHEN 'monto_maximo' THEN v_max::text WHEN 'fecha_inicio' THEN v_ini::text
      WHEN 'fecha_fin' THEN v_fin::text WHEN 'alcance' THEN v_alc WHEN 'descripcion' THEN v_desc END;
    v_antes := CASE k
      WHEN 'servicio' THEN v_ex.servicio WHEN 'modalidad' THEN v_ex.modalidad
      WHEN 'periodicidad' THEN v_ex.periodicidad WHEN 'moneda' THEN v_ex.moneda
      WHEN 'importe_periodico' THEN v_ex.importe_periodico::text
      WHEN 'monto_maximo' THEN v_ex.monto_maximo::text
      WHEN 'fecha_inicio' THEN v_ex.fecha_inicio::text
      WHEN 'fecha_fin' THEN v_ex.fecha_fin::text
      WHEN 'alcance' THEN v_ex.alcance WHEN 'descripcion' THEN v_ex.descripcion END;
    -- numeric(14,2): 100 y 100.00 son lo mismo.
    IF k IN ('importe_periodico', 'monto_maximo') THEN
      v_nuevo := CASE WHEN v_nuevo IS NULL THEN NULL ELSE to_char(v_nuevo::numeric, 'FM999999999990.00') END;
      v_antes := CASE WHEN v_antes IS NULL THEN NULL ELSE to_char(v_antes::numeric, 'FM999999999990.00') END;
    END IF;
    IF v_nuevo IS NOT NULL AND v_nuevo IS DISTINCT FROM v_antes THEN
      v_cambios := v_cambios || jsonb_build_object(k, jsonb_build_object('antes', v_antes, 'despues', v_nuevo));
    END IF;
  END LOOP;

  IF v_cambios <> '{}'::jsonb AND v_ex.estado <> 'borrador' THEN
    RETURN QUERY SELECT 'error'::text, v_ex.id, v_dato, v_cambios,
      public.prov_imp_err(v_err, 'referencia',
        format('El contrato ya está «%s» y esta fila lo modificaría: no se reescribe lo firmado. Termínalo y crea uno nuevo.', v_ex.estado)),
      v_adv, v_claves;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    CASE WHEN v_cambios = '{}'::jsonb THEN 'sin_cambios'
         WHEN NOT v_actualizar        THEN 'omitir'
         ELSE 'actualizar' END,
    v_ex.id, v_dato, v_cambios, v_err,
    CASE WHEN v_cambios <> '{}'::jsonb AND NOT v_actualizar
         THEN public.prov_imp_err(v_adv, '(fila)',
              'El contrato (borrador) ya existe y esta fila lo cambiaría; no se aplica porque «actualizar existentes» está desactivado.')
         ELSE v_adv END,
    v_claves;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.prov_imp_eval_contrato(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- Despacho por tipo.
CREATE OR REPLACE FUNCTION public.prov_imp_evaluar(
  p_tipo text, p_company uuid, p_fila jsonb, p_op jsonb)
RETURNS TABLE (accion text, entidad_id uuid, datos jsonb, cambios jsonb,
               errores jsonb, advertencias jsonb, claves text[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_tipo = 'proveedores' THEN
    RETURN QUERY SELECT * FROM public.prov_imp_eval_proveedor(p_company, p_fila, p_op);
  ELSIF p_tipo = 'asignaciones' THEN
    RETURN QUERY SELECT * FROM public.prov_imp_eval_asignacion(p_company, p_fila, p_op);
  ELSIF p_tipo = 'contratos' THEN
    RETURN QUERY SELECT * FROM public.prov_imp_eval_contrato(p_company, p_fila, p_op);
  ELSE
    RAISE EXCEPTION 'TIPO_INVALIDO: «%» no es un tipo de carga.', p_tipo USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.prov_imp_evaluar(text, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- ── 6. Vista previa ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.proveedores_importar_previsualizar(
  p_tipo           text,
  p_filas          jsonb,
  p_opciones       jsonb DEFAULT '{}'::jsonb,
  p_archivo_nombre text  DEFAULT NULL,
  p_archivo_sha256 text  DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_lote    uuid := gen_random_uuid();
  v_hash    text;
  v_op      jsonb;
  v_vistas  text[] := '{}';
  v_prev    record;
  v_item    record;
  e         record;
  v_acc     text;
  v_err     jsonb;
  v_adv     jsonb;
  v_dup     text;
  v_cnt     jsonb;
  v_repetido jsonb;
  v_max constant int := 2000;
BEGIN
  IF v_company IS NULL OR NOT public.prov_import_puede(p_tipo, 'create') THEN
    RAISE EXCEPTION 'No autorizado para cargar % de proveedores.', COALESCE(p_tipo, '?')
      USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_filas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_filas) = 0 THEN
    RAISE EXCEPTION 'ARCHIVO_VACIO: no hay filas que cargar.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_filas) > v_max THEN
    RAISE EXCEPTION 'ARCHIVO_GRANDE: máximo % filas por carga; divide el archivo.', v_max USING ERRCODE = '22023';
  END IF;
  IF length(p_filas::text) > 5000000 THEN
    RAISE EXCEPTION 'ARCHIVO_GRANDE: el contenido supera el tamaño permitido.' USING ERRCODE = '22023';
  END IF;

  -- Solo las dos opciones conocidas, como booleanos.
  v_op := jsonb_build_object(
    'actualizar_existentes', COALESCE((p_opciones ->> 'actualizar_existentes')::boolean, false),
    'vaciar_vacios',         COALESCE((p_opciones ->> 'vaciar_vacios')::boolean, false));

  v_hash := encode(sha256(convert_to(p_filas::text, 'UTF8')), 'hex');

  INSERT INTO public.proveedor_importaciones
    (id, company_id, tipo, archivo_nombre, archivo_sha256, contenido_sha256, opciones, created_by)
  VALUES (v_lote, v_company, p_tipo, left(p_archivo_nombre, 200), left(p_archivo_sha256, 80),
          v_hash, v_op, auth.uid());

  FOR v_item IN
    -- fila = número de fila en la hoja (la 1 es el encabezado)
    SELECT t.ord::int + 1 AS fila, t.valor
      FROM jsonb_array_elements(p_filas) WITH ORDINALITY AS t(valor, ord)
  LOOP
    IF jsonb_typeof(v_item.valor) IS DISTINCT FROM 'object' OR length(v_item.valor::text) > 20000 THEN
      INSERT INTO public.proveedor_importacion_filas
        (lote_id, company_id, tipo, fila, origen, accion, errores)
      VALUES (v_lote, v_company, p_tipo, v_item.fila, '{}'::jsonb, 'error',
              public.prov_imp_err('[]'::jsonb, '(fila)', 'Fila inválida o demasiado grande.'));
      CONTINUE;
    END IF;

    SELECT * INTO e FROM public.prov_imp_evaluar(p_tipo, v_company, v_item.valor, v_op);
    v_acc := e.accion; v_err := e.errores; v_adv := e.advertencias;

    -- Duplicados DENTRO del archivo: gana la primera aparición.
    v_dup := NULL;
    SELECT k INTO v_dup FROM unnest(e.claves) k WHERE k = ANY (v_vistas) LIMIT 1;
    IF v_dup IS NOT NULL THEN
      v_acc := 'error';
      v_err := public.prov_imp_err(v_err, '(fila)',
        'Duplicada dentro del archivo: otra fila anterior se refiere al mismo registro. Se conserva la primera.');
    ELSE
      v_vistas := v_vistas || e.claves;
    END IF;

    INSERT INTO public.proveedor_importacion_filas
      (lote_id, company_id, tipo, fila, origen, accion, entidad_id, datos, cambios, errores, advertencias)
    VALUES (v_lote, v_company, p_tipo, v_item.fila, v_item.valor, v_acc, e.entidad_id,
            e.datos, e.cambios, v_err, v_adv);
  END LOOP;

  SELECT jsonb_build_object(
           'filas',        count(*),
           'crear',        count(*) FILTER (WHERE accion = 'crear'),
           'actualizar',   count(*) FILTER (WHERE accion = 'actualizar'),
           'sin_cambios',  count(*) FILTER (WHERE accion = 'sin_cambios'),
           'omitir',       count(*) FILTER (WHERE accion = 'omitir'),
           'con_error',    count(*) FILTER (WHERE accion = 'error'),
           'con_advertencia', count(*) FILTER (WHERE jsonb_array_length(advertencias) > 0))
    INTO v_cnt
    FROM public.proveedor_importacion_filas WHERE lote_id = v_lote;

  -- ¿Este mismo contenido ya se aplicó antes?
  SELECT jsonb_build_object('lote_id', l.id, 'aplicado_at', l.aplicado_at, 'estado', l.estado)
    INTO v_repetido
    FROM public.proveedor_importaciones l
   WHERE l.company_id = v_company AND l.tipo = p_tipo AND l.contenido_sha256 = v_hash
     AND l.id <> v_lote AND l.estado IN ('aplicado', 'aplicado_parcial')
   ORDER BY l.aplicado_at DESC LIMIT 1;

  IF v_repetido IS NOT NULL THEN
    v_cnt := v_cnt || jsonb_build_object('contenido_ya_aplicado', v_repetido);
  END IF;

  UPDATE public.proveedor_importaciones SET resumen = v_cnt WHERE id = v_lote;

  RETURN jsonb_build_object('lote_id', v_lote, 'resumen', v_cnt);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.proveedores_importar_previsualizar(text, jsonb, jsonb, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.proveedores_importar_previsualizar(text, jsonb, jsonb, text, text) TO authenticated;

COMMENT ON FUNCTION public.proveedores_importar_previsualizar(text, jsonb, jsonb, text, text) IS
  'Valida y simula una carga (proveedores, asignaciones o contratos): crea el lote y el resultado por fila SIN modificar el catálogo. Importar nunca autoriza proveedores ni activa contratos.';

-- ── 7. Aplicación ────────────────────────────────────────────────────────────
-- Aplica UNA fila ya evaluada. Se llama dentro de un bloque con manejo de
-- excepciones, así un fallo deshace solo esa fila.
CREATE OR REPLACE FUNCTION public.prov_imp_aplicar_fila(
  p_tipo text, p_company uuid, p_accion text, p_entidad uuid, p_datos jsonb, p_cambios jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid := p_entidad;
  v_c  jsonb := p_cambios;
BEGIN
  IF p_tipo = 'proveedores' THEN
    IF p_accion = 'crear' THEN
      INSERT INTO public.proveedores
        (company_id, codigo, nombre, pais, nit, rfc, email, telefono, direccion, contacto_nombre,
         dias_credito, categoria_default, abastece, alcance, notas)
      VALUES
        (p_company, p_datos ->> 'codigo', p_datos ->> 'nombre', p_datos ->> 'pais', p_datos ->> 'nit',
         p_datos ->> 'rfc', p_datos ->> 'email', p_datos ->> 'telefono', p_datos ->> 'direccion',
         p_datos ->> 'contacto_nombre', COALESCE((p_datos ->> 'dias_credito')::int, 0),
         p_datos ->> 'categoria_default',
         COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_datos -> 'abastece')), '{}'::text[]),
         COALESCE(p_datos ->> 'alcance', 'empresa'), p_datos ->> 'notas')
      RETURNING id INTO v_id;
      -- `estado` NO se escribe: el DEFAULT es 'borrador'. Importar no autoriza.
    ELSE
      UPDATE public.proveedores p SET
        nombre            = CASE WHEN v_c ? 'nombre'            THEN v_c -> 'nombre'            ->> 'despues' ELSE p.nombre END,
        pais              = CASE WHEN v_c ? 'pais'              THEN v_c -> 'pais'              ->> 'despues' ELSE p.pais END,
        nit               = CASE WHEN v_c ? 'nit'               THEN v_c -> 'nit'               ->> 'despues' ELSE p.nit END,
        rfc               = CASE WHEN v_c ? 'rfc'               THEN v_c -> 'rfc'               ->> 'despues' ELSE p.rfc END,
        email             = CASE WHEN v_c ? 'email'             THEN v_c -> 'email'             ->> 'despues' ELSE p.email END,
        telefono          = CASE WHEN v_c ? 'telefono'          THEN v_c -> 'telefono'          ->> 'despues' ELSE p.telefono END,
        direccion         = CASE WHEN v_c ? 'direccion'         THEN v_c -> 'direccion'         ->> 'despues' ELSE p.direccion END,
        contacto_nombre   = CASE WHEN v_c ? 'contacto_nombre'   THEN v_c -> 'contacto_nombre'   ->> 'despues' ELSE p.contacto_nombre END,
        dias_credito      = CASE WHEN v_c ? 'dias_credito'      THEN COALESCE((v_c -> 'dias_credito' ->> 'despues')::int, p.dias_credito) ELSE p.dias_credito END,
        categoria_default = CASE WHEN v_c ? 'categoria_default' THEN v_c -> 'categoria_default' ->> 'despues' ELSE p.categoria_default END,
        abastece          = CASE WHEN v_c ? 'abastece'          THEN COALESCE(string_to_array(v_c -> 'abastece' ->> 'despues', ';'), '{}'::text[]) ELSE p.abastece END,
        alcance           = CASE WHEN v_c ? 'alcance'           THEN COALESCE(v_c -> 'alcance' ->> 'despues', p.alcance) ELSE p.alcance END,
        notas             = CASE WHEN v_c ? 'notas'             THEN v_c -> 'notas'             ->> 'despues' ELSE p.notas END
      WHERE p.id = p_entidad AND p.company_id = p_company;
    END IF;

  ELSIF p_tipo = 'asignaciones' THEN
    IF p_accion = 'crear' THEN
      -- Siempre PENDIENTE (DEFAULT): habilitar es una acción con permiso propio.
      INSERT INTO public.proveedor_proyectos
        (company_id, proveedor_id, project_id, dias_credito, condiciones_pago, vigente_hasta, notas)
      VALUES
        (p_company, (p_datos ->> 'proveedor_id')::uuid, (p_datos ->> 'project_id')::uuid,
         (p_datos ->> 'dias_credito')::int, p_datos ->> 'condiciones_pago',
         (p_datos ->> 'vigente_hasta')::date, p_datos ->> 'notas')
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.proveedor_proyectos pp SET
        dias_credito     = CASE WHEN v_c ? 'dias_credito'     THEN (v_c -> 'dias_credito' ->> 'despues')::int ELSE pp.dias_credito END,
        condiciones_pago = CASE WHEN v_c ? 'condiciones_pago' THEN v_c -> 'condiciones_pago' ->> 'despues' ELSE pp.condiciones_pago END,
        vigente_hasta    = CASE WHEN v_c ? 'vigente_hasta'    THEN (v_c -> 'vigente_hasta' ->> 'despues')::date ELSE pp.vigente_hasta END,
        notas            = CASE WHEN v_c ? 'notas'            THEN v_c -> 'notas' ->> 'despues' ELSE pp.notas END
      WHERE pp.id = p_entidad AND pp.company_id = p_company;
    END IF;

  ELSIF p_tipo = 'contratos' THEN
    IF p_accion = 'crear' THEN
      -- Siempre BORRADOR: el trigger del contrato lo exige y activa es otra acción.
      INSERT INTO public.contratos_proveedores
        (company_id, project_id, proveedor_id, proveedor_nombre, referencia, servicio, modalidad,
         periodicidad, moneda, importe_periodico, monto_maximo, fecha_inicio, fecha_fin,
         alcance, descripcion, estado)
      VALUES
        (p_company, (p_datos ->> 'project_id')::uuid, (p_datos ->> 'proveedor_id')::uuid,
         '(se completa desde el proveedor)', p_datos ->> 'referencia', p_datos ->> 'servicio',
         p_datos ->> 'modalidad', p_datos ->> 'periodicidad', p_datos ->> 'moneda',
         (p_datos ->> 'importe_periodico')::numeric, (p_datos ->> 'monto_maximo')::numeric,
         (p_datos ->> 'fecha_inicio')::date, (p_datos ->> 'fecha_fin')::date,
         p_datos ->> 'alcance', p_datos ->> 'descripcion', 'borrador')
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.contratos_proveedores c SET
        servicio          = CASE WHEN v_c ? 'servicio'          THEN v_c -> 'servicio' ->> 'despues' ELSE c.servicio END,
        modalidad         = CASE WHEN v_c ? 'modalidad'         THEN v_c -> 'modalidad' ->> 'despues' ELSE c.modalidad END,
        periodicidad      = CASE WHEN v_c ? 'periodicidad'      THEN v_c -> 'periodicidad' ->> 'despues' ELSE c.periodicidad END,
        moneda            = CASE WHEN v_c ? 'moneda'            THEN v_c -> 'moneda' ->> 'despues' ELSE c.moneda END,
        importe_periodico = CASE WHEN v_c ? 'importe_periodico' THEN (v_c -> 'importe_periodico' ->> 'despues')::numeric ELSE c.importe_periodico END,
        monto_maximo      = CASE WHEN v_c ? 'monto_maximo'      THEN (v_c -> 'monto_maximo' ->> 'despues')::numeric ELSE c.monto_maximo END,
        fecha_inicio      = CASE WHEN v_c ? 'fecha_inicio'      THEN (v_c -> 'fecha_inicio' ->> 'despues')::date ELSE c.fecha_inicio END,
        fecha_fin         = CASE WHEN v_c ? 'fecha_fin'         THEN (v_c -> 'fecha_fin' ->> 'despues')::date ELSE c.fecha_fin END,
        alcance           = CASE WHEN v_c ? 'alcance'           THEN v_c -> 'alcance' ->> 'despues' ELSE c.alcance END,
        descripcion       = CASE WHEN v_c ? 'descripcion'       THEN v_c -> 'descripcion' ->> 'despues' ELSE c.descripcion END
      WHERE c.id = p_entidad AND c.company_id = p_company AND c.estado = 'borrador';
    END IF;
  END IF;

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.prov_imp_aplicar_fila(text, uuid, text, uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.proveedores_importar_aplicar(
  p_lote_id uuid, p_modo text DEFAULT 'todo_o_nada')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_lote    public.proveedor_importaciones%ROWTYPE;
  v_fila    record;
  e         record;
  v_vistas  text[] := '{}';
  v_dup     text;
  v_aplicadas int := 0; v_sin int := 0; v_omitidas int := 0; v_errores int := 0; v_cambiaron int := 0;
  v_id      uuid;
  v_res     jsonb;
  v_estado  text;
  v_cambio  boolean;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF p_modo NOT IN ('todo_o_nada', 'filas_validas') THEN
    RAISE EXCEPTION 'MODO_INVALIDO: usa todo_o_nada o filas_validas.' USING ERRCODE = '22023';
  END IF;

  -- Serializa: dos aplicaciones del mismo lote no corren a la vez.
  SELECT * INTO v_lote FROM public.proveedor_importaciones
   WHERE id = p_lote_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LOTE_INEXISTENTE: el lote no existe o no es de tu empresa.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.prov_import_puede(v_lote.tipo, 'create')
     OR (v_lote.created_by IS DISTINCT FROM auth.uid() AND NOT public.is_super_admin()) THEN
    RAISE EXCEPTION 'No autorizado para aplicar este lote: solo quien lo previsualizó, con su permiso.'
      USING ERRCODE = '42501';
  END IF;

  -- Idempotencia: un lote ya aplicado devuelve su resultado, sin ejecutar nada.
  IF v_lote.estado IN ('aplicado', 'aplicado_parcial', 'fallido') THEN
    RETURN COALESCE(v_lote.resultado, '{}'::jsonb) || jsonb_build_object('repetido', true, 'lote_id', v_lote.id);
  END IF;
  IF v_lote.estado = 'descartado' THEN
    RAISE EXCEPTION 'LOTE_DESCARTADO: el lote fue descartado; vuelve a previsualizar el archivo.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_lote.estado <> 'previsualizado' THEN
    RAISE EXCEPTION 'LOTE_EN_CURSO: el lote se está aplicando.' USING ERRCODE = 'check_violation';
  END IF;

  -- Todo o nada: una sola fila con error impide aplicar cualquiera.
  IF p_modo = 'todo_o_nada' AND EXISTS (
       SELECT 1 FROM public.proveedor_importacion_filas f WHERE f.lote_id = v_lote.id AND f.accion = 'error') THEN
    RAISE EXCEPTION 'LOTE_CON_ERRORES: hay filas con error y el modo es todo_o_nada; no se aplicó nada. Corrige el archivo o elige «solo filas válidas».'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.proveedor_importaciones SET estado = 'aplicando', modo = p_modo WHERE id = v_lote.id;

  BEGIN  -- bloque atómico del lote
    FOR v_fila IN
      SELECT * FROM public.proveedor_importacion_filas f WHERE f.lote_id = v_lote.id ORDER BY f.fila
    LOOP
      IF v_fila.accion = 'error' THEN
        UPDATE public.proveedor_importacion_filas SET estado = 'omitida',
               resultado = 'Fila con error en la vista previa: no se aplicó.' WHERE id = v_fila.id;
        v_omitidas := v_omitidas + 1;
        CONTINUE;
      END IF;

      -- Re-evaluación contra el estado ACTUAL (la base pudo cambiar desde la
      -- vista previa) y detección de duplicados dentro del archivo.
      SELECT * INTO e FROM public.prov_imp_evaluar(v_lote.tipo, v_company, v_fila.origen, v_lote.opciones);
      v_dup := NULL;
      SELECT k INTO v_dup FROM unnest(e.claves) k WHERE k = ANY (v_vistas) LIMIT 1;
      v_vistas := v_vistas || e.claves;

      v_cambio := v_dup IS NOT NULL OR e.accion IS DISTINCT FROM v_fila.accion
                  OR e.cambios IS DISTINCT FROM v_fila.cambios;

      IF v_cambio THEN
        IF p_modo = 'todo_o_nada' THEN
          RAISE EXCEPTION 'LOTE_DESACTUALIZADO: la fila % cambió desde la vista previa (otro usuario modificó los datos). No se aplicó nada: vuelve a previsualizar.', v_fila.fila
            USING ERRCODE = 'check_violation';
        END IF;
        UPDATE public.proveedor_importacion_filas SET estado = 'omitida',
               resultado = 'Cambió desde la vista previa: no se aplicó. Vuelve a cargar el archivo.' WHERE id = v_fila.id;
        v_cambiaron := v_cambiaron + 1;
        v_omitidas := v_omitidas + 1;
        CONTINUE;
      END IF;

      IF v_fila.accion = 'sin_cambios' THEN
        UPDATE public.proveedor_importacion_filas SET estado = 'sin_cambios', resultado = 'Sin cambios.' WHERE id = v_fila.id;
        v_sin := v_sin + 1;
        CONTINUE;
      ELSIF v_fila.accion = 'omitir' THEN
        UPDATE public.proveedor_importacion_filas SET estado = 'omitida',
               resultado = 'Ya existe y «actualizar existentes» estaba desactivado.' WHERE id = v_fila.id;
        v_omitidas := v_omitidas + 1;
        CONTINUE;
      END IF;

      IF p_modo = 'todo_o_nada' THEN
        v_id := public.prov_imp_aplicar_fila(v_lote.tipo, v_company, v_fila.accion,
                                             v_fila.entidad_id, v_fila.datos, v_fila.cambios);
        UPDATE public.proveedor_importacion_filas SET estado = 'aplicada', entidad_id = v_id,
               resultado = CASE v_fila.accion WHEN 'crear' THEN 'Creado.' ELSE 'Actualizado.' END
         WHERE id = v_fila.id;
        v_aplicadas := v_aplicadas + 1;
      ELSE
        BEGIN  -- aislamiento por fila
          v_id := public.prov_imp_aplicar_fila(v_lote.tipo, v_company, v_fila.accion,
                                               v_fila.entidad_id, v_fila.datos, v_fila.cambios);
          UPDATE public.proveedor_importacion_filas SET estado = 'aplicada', entidad_id = v_id,
                 resultado = CASE v_fila.accion WHEN 'crear' THEN 'Creado.' ELSE 'Actualizado.' END
           WHERE id = v_fila.id;
          v_aplicadas := v_aplicadas + 1;
        EXCEPTION WHEN OTHERS THEN
          UPDATE public.proveedor_importacion_filas SET estado = 'error',
                 resultado = left(SQLERRM, 300) WHERE id = v_fila.id;
          v_errores := v_errores + 1;
        END;
      END IF;
    END LOOP;

    v_estado := CASE
      WHEN v_aplicadas + v_sin = 0 AND (v_errores > 0 OR v_omitidas > 0) THEN 'fallido'
      WHEN v_errores > 0 OR v_omitidas > 0                                THEN 'aplicado_parcial'
      ELSE 'aplicado'
    END;

  EXCEPTION WHEN OTHERS THEN
    -- Todo o nada: se deshizo TODO lo del bloque (incluido el marcado de filas).
    IF SQLERRM LIKE 'LOTE_DESACTUALIZADO%' THEN
      -- La base cambió desde la vista previa: el lote sigue siendo
      -- `previsualizado` y no se aplicó nada.
      v_res := jsonb_build_object('estado', 'previsualizado', 'modo', p_modo, 'lote_id', v_lote.id,
                                  'aplicadas', 0, 'desactualizado', true, 'error', left(SQLERRM, 400),
                                  'nota', 'No se aplicó nada. Vuelve a previsualizar el archivo.');
      UPDATE public.proveedor_importaciones SET estado = 'previsualizado', modo = NULL WHERE id = v_lote.id;
      RETURN v_res;
    END IF;

    v_res := jsonb_build_object('estado', 'fallido', 'modo', p_modo, 'lote_id', v_lote.id,
                                'aplicadas', 0, 'error', left(SQLERRM, 400),
                                'nota', 'No se aplicó nada.');
    UPDATE public.proveedor_importaciones
       SET estado = 'fallido', resultado = v_res, aplicado_por = auth.uid(), aplicado_at = now()
     WHERE id = v_lote.id;
    RETURN v_res;
  END;

  v_res := jsonb_build_object(
    'estado', v_estado, 'modo', p_modo, 'lote_id', v_lote.id,
    'aplicadas', v_aplicadas, 'sin_cambios', v_sin, 'omitidas', v_omitidas,
    'con_error', v_errores, 'cambiaron_desde_vista_previa', v_cambiaron,
    'parcial', v_estado = 'aplicado_parcial');

  UPDATE public.proveedor_importaciones
     SET estado = v_estado, resultado = v_res, aplicado_por = auth.uid(), aplicado_at = now()
   WHERE id = v_lote.id;

  RETURN v_res;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.proveedores_importar_aplicar(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.proveedores_importar_aplicar(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.proveedores_importar_aplicar(uuid, text) IS
  'Aplica un lote previsualizado. todo_o_nada = atómico y exige cero errores; filas_validas = cada fila aislada y el lote queda aplicado_parcial con el detalle por fila. Reaplicar un lote aplicado devuelve su resultado sin ejecutar nada. Nunca autoriza proveedores ni activa contratos.';

-- ── 8. Descartar ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.proveedores_importar_descartar(p_lote_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_lote    public.proveedor_importaciones%ROWTYPE;
BEGIN
  SELECT * INTO v_lote FROM public.proveedor_importaciones
   WHERE id = p_lote_id AND company_id = v_company FOR UPDATE;
  IF NOT FOUND OR NOT public.prov_import_puede(v_lote.tipo, 'create')
     OR (v_lote.created_by IS DISTINCT FROM auth.uid() AND NOT public.is_super_admin()) THEN
    RAISE EXCEPTION 'No autorizado o lote inexistente.' USING ERRCODE = '42501';
  END IF;
  IF v_lote.estado <> 'previsualizado' THEN
    RAISE EXCEPTION 'LOTE_NO_DESCARTABLE: solo se descarta un lote previsualizado (estado actual: %).', v_lote.estado
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.proveedor_importaciones SET estado = 'descartado' WHERE id = p_lote_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.proveedores_importar_descartar(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.proveedores_importar_descartar(uuid) TO authenticated;
