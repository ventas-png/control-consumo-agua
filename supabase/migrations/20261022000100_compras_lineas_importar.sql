-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · BLOQUE C · CARGA MASIVA DE RENGLONES DE UNA ORDEN EN BORRADOR
--
-- QUÉ YA EXISTÍA (se reutiliza el patrón, no se duplica el motor)
--   · La carga masiva de PROVEEDORES (`proveedores_importar_*`, lotes, vista previa,
--     aplicar/descartar) y el lector de archivos del navegador (`importacion.ts`).
--   · Los triggers de renglón (cuenta resuelta/validada en servidor, insumo y destino
--     del bloque C) y las RLS de `orden_compra_lineas`.
--
-- QUÉ FALTABA
--   Cargar de un archivo los renglones de una orden en borrador. Para eso NO sirve
--   insertar renglones desde el navegador en lotes (un fallo a medias deja los
--   primeros y el reintento los duplica).
--
-- FLUJO
--   1. `compras_lineas_importar_previsualizar(orden, filas, archivo)` → crea el LOTE
--      y una fila de resultado por fila del archivo (datos normalizados, errores por
--      campo, advertencias). NO escribe renglones.
--   2. `compras_lineas_importar_aplicar(lote)` → TODO O NADA: si una sola fila tiene
--      error no se escribe ninguno; si todas pasan se insertan en UNA transacción.
--      Se RE-EVALÚA cada fila contra el estado actual antes de escribir. Reaplicar un
--      lote aplicado devuelve su resultado sin escribir nada. Cargar OTRA VEZ el mismo
--      contenido en la misma orden se rechaza mientras sus renglones sigan ahí.
--   3. `compras_lineas_importar_descartar(lote)`.
--
-- REGLAS QUE ESTE MÓDULO HACE CUMPLIR
--   · SOLO renglones, SOLO en una orden en borrador. No aprueba, no emite, no recibe, no
--     contabiliza, no cambia el proveedor ni la cabecera de la orden.
--   · NO crea nada: el insumo (por nombre, dentro del proyecto de la orden) y la cuenta
--     (por código, en la contabilidad de la orden) deben EXISTIR; si no, es un error de
--     la fila. Nombre de insumo repetido en el proyecto = ambiguo = error.
--   · Destino válido (inventario | activo fijo | servicio | gasto); el insumo solo con
--     destino inventario y es obligatorio con él; la unidad debe ser la del insumo.
--   · Cantidad > 0, precio e IVA ≥ 0, con formato numérico estricto (punto decimal).
--   · Texto plano: un valor que empiece por `=`, `+`, `-` o `@` se rechaza (posible fórmula).
--   · Columnas desconocidas (proveedor, estado, aprobar…) se rechazan: este archivo no
--     decide eso.
--   · Máximo 500 filas por carga.
--   · Quien llama necesita el mismo permiso que para capturar renglones, y las funciones
--     son SECURITY INVOKER: las RLS y los triggers de `orden_compra_lineas` rigen igual
--     que con un INSERT directo. No se amplía ningún permiso.
--   · El lote y sus filas solo los escriben estas RPC (candado por GUC de sesión).
--
-- CÓMO REVERTIR
--   DROP FUNCTION public.compras_lineas_importar_previsualizar(uuid, jsonb, text),
--     public.compras_lineas_importar_aplicar(uuid), public.compras_lineas_importar_descartar(uuid),
--     public.compras_import_evaluar(public.ordenes_compra, jsonb, int),
--     public.compras_import_cuenta(uuid, uuid, text, text, text, uuid, uuid);
--   DROP TABLE public.compras_linea_importacion_filas, public.compras_linea_importaciones;
-- IMPACTO EN DATOS PRODUCTIVOS: ninguno; las tablas nacen vacías.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.compras_linea_importaciones (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id        uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  orden_compra_id   uuid        NOT NULL REFERENCES public.ordenes_compra(id) ON DELETE CASCADE,
  archivo_nombre    text,
  contenido_sha256  text        NOT NULL,
  estado            text        NOT NULL DEFAULT 'previsualizado'
                    CHECK (estado IN ('previsualizado', 'aplicado', 'descartado')),
  resumen           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  resultado         jsonb,
  created_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  aplicado_por      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  aplicado_at       timestamptz
);
CREATE INDEX IF NOT EXISTS idx_compras_lineimp_orden
  ON public.compras_linea_importaciones (orden_compra_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.compras_linea_importacion_filas (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id       uuid        NOT NULL REFERENCES public.compras_linea_importaciones(id) ON DELETE CASCADE,
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fila          int         NOT NULL,
  origen        jsonb       NOT NULL,
  datos         jsonb,
  errores       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  advertencias  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT uq_compras_lineimp_fila UNIQUE (lote_id, fila)
);

COMMENT ON TABLE public.compras_linea_importaciones IS
  'Lote de carga masiva de renglones de una orden en borrador: quién, cuándo, qué archivo y cómo terminó. Lo escriben solo las RPC compras_lineas_importar_*.';
COMMENT ON TABLE public.compras_linea_importacion_filas IS
  'Resultado por fila de un lote: datos normalizados, errores por campo y advertencias.';

ALTER TABLE public.compras_linea_importaciones     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compras_linea_importacion_filas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.compras_linea_importaciones, public.compras_linea_importacion_filas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.compras_linea_importaciones, public.compras_linea_importacion_filas TO authenticated;

-- Misma puerta que capturar un renglón (operador, admin, dueño o permiso de crear) y el
-- mismo alcance por proyecto que la orden.
CREATE OR REPLACE FUNCTION public.compras_import_puede_capturar()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.is_super_admin() OR (
    public.get_my_company_id() IS NOT NULL
    AND (public.current_user_role() = ANY (ARRAY['company_owner', 'admin', 'operator'])
         OR public.conta_puede_escribir('create')));
$$;
REVOKE EXECUTE ON FUNCTION public.compras_import_puede_capturar() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compras_import_puede_capturar() TO authenticated;

DROP POLICY IF EXISTS compras_lineimp_select ON public.compras_linea_importaciones;
CREATE POLICY compras_lineimp_select ON public.compras_linea_importaciones FOR SELECT TO authenticated
  USING (public.is_super_admin() OR (company_id = public.get_my_company_id()
         AND (project_id IS NULL OR public.can_access_project(project_id))));
DROP POLICY IF EXISTS compras_lineimp_insert ON public.compras_linea_importaciones;
CREATE POLICY compras_lineimp_insert ON public.compras_linea_importaciones FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.compras_import_puede_capturar()
              AND (project_id IS NULL OR public.can_access_project(project_id)));
DROP POLICY IF EXISTS compras_lineimp_update ON public.compras_linea_importaciones;
CREATE POLICY compras_lineimp_update ON public.compras_linea_importaciones FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.compras_import_puede_capturar()
         AND (project_id IS NULL OR public.can_access_project(project_id)))
  WITH CHECK (company_id = public.get_my_company_id());

DROP POLICY IF EXISTS compras_lineimpf_select ON public.compras_linea_importacion_filas;
CREATE POLICY compras_lineimpf_select ON public.compras_linea_importacion_filas FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.compras_linea_importaciones l WHERE l.id = lote_id));
DROP POLICY IF EXISTS compras_lineimpf_insert ON public.compras_linea_importacion_filas;
CREATE POLICY compras_lineimpf_insert ON public.compras_linea_importacion_filas FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.compras_import_puede_capturar()
              AND EXISTS (SELECT 1 FROM public.compras_linea_importaciones l WHERE l.id = lote_id));

DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'mfa_requirement_met') THEN
    FOREACH t IN ARRAY ARRAY['compras_linea_importaciones', 'compras_linea_importacion_filas'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS mfa_gate_aal2 ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY mfa_gate_aal2 ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        || 'USING (public.mfa_requirement_met()) WITH CHECK (public.mfa_requirement_met())', t);
    END LOOP;
  END IF;
END $$;

-- El lote y sus filas SOLO se escriben desde las RPC (candado por GUC de sesión, como
-- `conta.allow_system_write`): un INSERT/UPDATE directo no los fabrica ni los marca «aplicado».
CREATE OR REPLACE FUNCTION public.compras_tg_lineimp_solo_rpc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF COALESCE(current_setting('compras.import_rpc', true), 'off') <> 'on'
     AND COALESCE(current_setting('conta.allow_system_write', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'COMPRAS_IMPORT_SOLO_RPC: los lotes de carga masiva los escriben solo las funciones compras_lineas_importar_*.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_lineimp_solo_rpc() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_compras_lineimp_solo_rpc ON public.compras_linea_importaciones;
CREATE TRIGGER trg_compras_lineimp_solo_rpc BEFORE INSERT OR UPDATE ON public.compras_linea_importaciones
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_lineimp_solo_rpc();
DROP TRIGGER IF EXISTS trg_compras_lineimpf_solo_rpc ON public.compras_linea_importacion_filas;
CREATE TRIGGER trg_compras_lineimpf_solo_rpc BEFORE INSERT OR UPDATE ON public.compras_linea_importacion_filas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_lineimp_solo_rpc();

-- ── Cuenta por código: SOLO existe o no; nunca se crea ──────────────────────
-- DEFINER porque las cuentas contables pueden no ser visibles para Operaciones; acotada a
-- la empresa y al proyecto accesibles de quien llama, y devuelve solo id o motivo.
CREATE OR REPLACE FUNCTION public.compras_import_cuenta(
  p_company uuid, p_project uuid, p_codigo text, p_destino text, p_categoria text,
  p_suministro uuid, p_proveedor uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
  r    record;
BEGIN
  IF p_company IS DISTINCT FROM public.get_my_company_id()
     OR (p_project IS NOT NULL AND NOT public.can_access_project(p_project)) THEN
    RETURN jsonb_build_object('error', 'La cuenta no existe en esta contabilidad.');
  END IF;
  SELECT c.id INTO v_id FROM public.conta_cuentas c
   WHERE c.company_id = p_company AND c.project_id IS NOT DISTINCT FROM p_project
     AND c.codigo = btrim(p_codigo)
   LIMIT 1;
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('error', format('La cuenta «%s» no existe en la contabilidad de la orden (la importación no crea cuentas).', btrim(p_codigo)));
  END IF;
  SELECT * INTO r FROM public.compras_resolver_cuenta_linea_interno(
    p_company, p_project, CASE p_destino WHEN 'servicio' THEN 'gasto' ELSE p_destino END,
    p_categoria, p_suministro, p_proveedor, v_id, CURRENT_DATE);
  IF r.cuenta_id IS NULL THEN
    RETURN jsonb_build_object('error', format('La cuenta «%s» no es apta para este renglón: %s', btrim(p_codigo), r.motivo));
  END IF;
  RETURN jsonb_build_object('cuenta_id', v_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_import_cuenta(uuid, uuid, text, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compras_import_cuenta(uuid, uuid, text, text, text, uuid, uuid) TO authenticated;

-- ── Evaluación de UNA fila (la misma en la vista previa y al aplicar) ───────
CREATE OR REPLACE FUNCTION public.compras_import_evaluar(p_orden public.ordenes_compra, p_fila jsonb, p_n int)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_ok_cols constant text[] := ARRAY['descripcion', 'destino', 'insumo', 'categoria', 'cantidad', 'unidad',
                                     'precio_unitario', 'iva', 'cuenta'];
  v_cats    constant text[] := ARRAY['mantenimiento', 'servicios', 'administrativo', 'seguridad', 'limpieza', 'obras', 'otros'];
  v_err     jsonb := '[]'::jsonb;
  v_adv     jsonb := '[]'::jsonb;
  k         text;
  v_desc    text;
  v_dest    text;
  v_ins     text;
  v_cat     text;
  v_cant    text;
  v_uni     text;
  v_prec    text;
  v_iva     text;
  v_cta     text;
  v_sum     record;
  v_n_sum   int;
  v_cuenta  jsonb;
  v_cuenta_id uuid;
  v_sum_id  uuid;
BEGIN
  IF jsonb_typeof(p_fila) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('datos', NULL,
      'errores', jsonb_build_array(jsonb_build_object('campo', 'fila', 'mensaje', 'La fila no es un registro de columnas.')),
      'advertencias', '[]'::jsonb);
  END IF;

  FOR k IN SELECT jsonb_object_keys(p_fila) LOOP
    IF NOT (k = ANY (v_ok_cols)) THEN
      v_err := v_err || jsonb_build_object('campo', k,
        'mensaje', format('La columna «%s» no se admite: este archivo solo trae renglones (no decide proveedor, estado ni aprobación).', k));
    END IF;
  END LOOP;

  v_desc := NULLIF(btrim(COALESCE(p_fila->>'descripcion', '')), '');
  v_dest := lower(btrim(COALESCE(p_fila->>'destino', '')));
  v_ins  := NULLIF(btrim(COALESCE(p_fila->>'insumo', '')), '');
  v_cat  := lower(COALESCE(NULLIF(btrim(COALESCE(p_fila->>'categoria', '')), ''), 'otros'));
  v_cant := btrim(COALESCE(p_fila->>'cantidad', ''));
  v_uni  := NULLIF(btrim(COALESCE(p_fila->>'unidad', '')), '');
  v_prec := btrim(COALESCE(p_fila->>'precio_unitario', ''));
  v_iva  := COALESCE(NULLIF(btrim(COALESCE(p_fila->>'iva', '')), ''), '0');
  v_cta  := NULLIF(btrim(COALESCE(p_fila->>'cuenta', '')), '');

  -- Texto plano: nada que parezca fórmula.
  FOR k IN SELECT unnest(ARRAY['descripcion', 'insumo', 'unidad', 'cuenta', 'categoria', 'destino']) LOOP
    IF COALESCE(p_fila->>k, '') ~ '^\s*[=+@-]' THEN
      v_err := v_err || jsonb_build_object('campo', k, 'mensaje', 'Un valor que empieza con =, +, - o @ se rechaza (posible fórmula): pega valores de texto.');
    END IF;
  END LOOP;

  IF v_desc IS NULL OR length(v_desc) < 3 THEN
    v_err := v_err || jsonb_build_object('campo', 'descripcion', 'mensaje', 'La descripción es obligatoria (mínimo 3 caracteres).');
  ELSIF length(v_desc) > 300 THEN
    v_err := v_err || jsonb_build_object('campo', 'descripcion', 'mensaje', 'La descripción excede 300 caracteres.');
  END IF;

  v_dest := replace(replace(v_dest, ' ', '_'), 'á', 'a');
  IF v_dest NOT IN ('inventario', 'activo_fijo', 'servicio', 'gasto') THEN
    v_err := v_err || jsonb_build_object('campo', 'destino', 'mensaje', 'Destino inválido: usa inventario, activo fijo, servicio o gasto.');
    v_dest := NULL;
  END IF;

  IF NOT (v_cat = ANY (v_cats)) THEN
    v_err := v_err || jsonb_build_object('campo', 'categoria', 'mensaje', format('Categoría inválida «%s»: usa %s.', v_cat, array_to_string(v_cats, ', ')));
  END IF;

  IF v_cant !~ '^[0-9]{1,10}(\.[0-9]{1,4})?$' THEN
    v_err := v_err || jsonb_build_object('campo', 'cantidad', 'mensaje', 'La cantidad debe ser un número mayor que 0 con punto decimal (hasta 4 decimales).');
  ELSIF v_cant::numeric <= 0 THEN
    v_err := v_err || jsonb_build_object('campo', 'cantidad', 'mensaje', 'La cantidad debe ser mayor que 0.');
  END IF;
  IF v_prec !~ '^[0-9]{1,10}(\.[0-9]{1,4})?$' THEN
    v_err := v_err || jsonb_build_object('campo', 'precio_unitario', 'mensaje', 'El precio debe ser un número mayor o igual a 0 con punto decimal (hasta 4 decimales).');
  END IF;
  IF v_iva !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' THEN
    v_err := v_err || jsonb_build_object('campo', 'iva', 'mensaje', 'El IVA es un MONTO mayor o igual a 0 con punto decimal (hasta 2 decimales).');
  END IF;

  -- Insumo: por nombre, dentro del proyecto de la orden; nunca se crea.
  IF v_dest = 'inventario' THEN
    IF v_ins IS NULL THEN
      v_err := v_err || jsonb_build_object('campo', 'insumo', 'mensaje', 'Un renglón de inventario necesita el insumo del almacén (nombre exacto).');
    ELSIF p_orden.project_id IS NULL THEN
      v_err := v_err || jsonb_build_object('campo', 'insumo', 'mensaje', 'La orden es de la contabilidad de la empresa y no tiene bodega: no admite insumos.');
    ELSE
      SELECT count(*) INTO v_n_sum FROM public.suministros_condominio s
       WHERE s.company_id = p_orden.company_id AND s.project_id = p_orden.project_id AND s.activo
         AND lower(btrim(s.nombre)) = lower(v_ins);
      IF v_n_sum = 0 THEN
        v_err := v_err || jsonb_build_object('campo', 'insumo', 'mensaje', format('El insumo «%s» no existe (o está inactivo) en el proyecto de la orden. La importación no crea insumos: créalo en Suministros.', v_ins));
      ELSIF v_n_sum > 1 THEN
        v_err := v_err || jsonb_build_object('campo', 'insumo', 'mensaje', format('Hay %s insumos llamados «%s» en el proyecto: el nombre es ambiguo. Renombra uno en Suministros.', v_n_sum, v_ins));
      ELSE
        SELECT s.id, s.unidad_medida, s.nombre INTO v_sum FROM public.suministros_condominio s
         WHERE s.company_id = p_orden.company_id AND s.project_id = p_orden.project_id AND s.activo
           AND lower(btrim(s.nombre)) = lower(v_ins);
        v_sum_id := v_sum.id;
        IF v_uni IS NULL THEN
          v_uni := v_sum.unidad_medida;
        ELSIF lower(v_uni) <> lower(btrim(v_sum.unidad_medida)) THEN
          v_err := v_err || jsonb_build_object('campo', 'unidad', 'mensaje', format('El insumo «%s» se lleva en «%s», no en «%s».', v_sum.nombre, v_sum.unidad_medida, v_uni));
        END IF;
      END IF;
    END IF;
  ELSIF v_ins IS NOT NULL THEN
    v_err := v_err || jsonb_build_object('campo', 'insumo', 'mensaje', 'El insumo solo aplica a renglones de inventario.');
  END IF;
  v_uni := COALESCE(v_uni, 'unidad');
  IF length(v_uni) > 30 THEN
    v_err := v_err || jsonb_build_object('campo', 'unidad', 'mensaje', 'La unidad excede 30 caracteres.');
  END IF;

  -- Cuenta: por código, debe existir y ser apta; si no viene, la resuelve el servidor al guardar.
  IF v_cta IS NOT NULL AND v_dest IS NOT NULL AND (v_cat = ANY (v_cats)) THEN
    v_cuenta := public.compras_import_cuenta(p_orden.company_id, p_orden.project_id, v_cta, v_dest, v_cat, v_sum_id, p_orden.proveedor_id);
    IF v_cuenta ? 'error' THEN
      v_err := v_err || jsonb_build_object('campo', 'cuenta', 'mensaje', v_cuenta->>'error');
    ELSE
      v_cuenta_id := (v_cuenta->>'cuenta_id')::uuid;
    END IF;
  END IF;

  IF jsonb_array_length(v_err) > 0 THEN
    RETURN jsonb_build_object('datos', NULL, 'errores', v_err, 'advertencias', v_adv);
  END IF;

  RETURN jsonb_build_object(
    'datos', jsonb_build_object(
      'descripcion', v_desc, 'destino_tipo', v_dest, 'suministro_id', v_sum_id, 'categoria', v_cat,
      'cantidad', v_cant::numeric, 'unidad', v_uni, 'precio_unitario', v_prec::numeric,
      'iva_monto', v_iva::numeric, 'cuenta_id', v_cuenta_id),
    'errores', v_err, 'advertencias', v_adv);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_import_evaluar(public.ordenes_compra, jsonb, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compras_import_evaluar(public.ordenes_compra, jsonb, int) TO authenticated;

-- ── Vista previa ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_lineas_importar_previsualizar(
  p_orden_id uuid, p_filas jsonb, p_archivo text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_o        public.ordenes_compra%ROWTYPE;
  v_lote     public.compras_linea_importaciones%ROWTYPE;
  v_n        int;
  v_i        int := 0;
  r          jsonb;
  v_ev       jsonb;
  v_vistos   text[] := ARRAY[]::text[];
  v_clave    text;
  v_adv      jsonb;
  v_datos    jsonb := '[]'::jsonb;
  v_hash     text;
  v_validas  int := 0;
  v_conerr   int := 0;
  v_resultado jsonb := '[]'::jsonb;
  v_ya       boolean := false;
BEGIN
  IF NOT public.compras_import_puede_capturar() THEN
    RAISE EXCEPTION 'COMPRAS_IMPORT_PERMISO: no tienes permiso para capturar renglones de órdenes.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_o FROM public.ordenes_compra o WHERE o.id = p_orden_id;
  IF NOT FOUND OR v_o.company_id IS DISTINCT FROM public.get_my_company_id()
     OR (v_o.project_id IS NOT NULL AND NOT public.can_access_project(v_o.project_id)) THEN
    RAISE EXCEPTION 'COMPRAS_IMPORT_ORDEN: la orden no existe en tu empresa o proyecto.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_o.estado <> 'borrador' THEN
    RAISE EXCEPTION 'COMPRAS_IMPORT_ORDEN_NO_BORRADOR: la orden está "%" y solo se importan renglones a una orden en borrador.', v_o.estado
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_filas IS NULL OR jsonb_typeof(p_filas) <> 'array' OR jsonb_array_length(p_filas) = 0 THEN
    RAISE EXCEPTION 'COMPRAS_IMPORT_VACIA: el archivo no trae filas.' USING ERRCODE = 'check_violation';
  END IF;
  v_n := jsonb_array_length(p_filas);
  IF v_n > 500 THEN
    RAISE EXCEPTION 'COMPRAS_IMPORT_LIMITE: % filas; el máximo es 500 por carga. Divide el archivo.', v_n USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('compras.import_rpc', 'on', true);

  -- La huella del contenido la calcula el SERVIDOR sobre las filas tal cual llegaron.
  v_hash := encode(sha256(convert_to(p_filas::text, 'UTF8')), 'hex');
  SELECT EXISTS (
    SELECT 1 FROM public.compras_linea_importaciones l
     WHERE l.orden_compra_id = p_orden_id AND l.contenido_sha256 = v_hash AND l.estado = 'aplicado'
       AND EXISTS (SELECT 1 FROM public.orden_compra_lineas ol
                    WHERE ol.id::text IN (SELECT jsonb_array_elements_text(l.resultado->'linea_ids')))
  ) INTO v_ya;

  INSERT INTO public.compras_linea_importaciones
    (company_id, project_id, orden_compra_id, archivo_nombre, contenido_sha256, created_by)
  VALUES (v_o.company_id, v_o.project_id, p_orden_id, left(p_archivo, 200), v_hash, auth.uid())
  RETURNING * INTO v_lote;

  FOR r IN SELECT value FROM jsonb_array_elements(p_filas) LOOP
    v_i := v_i + 1;
    v_ev := public.compras_import_evaluar(v_o, r, v_i);
    v_adv := v_ev->'advertencias';
    IF jsonb_array_length(v_ev->'errores') = 0 THEN
      v_clave := lower(concat_ws('|', v_ev->'datos'->>'descripcion', v_ev->'datos'->>'destino_tipo',
                                 v_ev->'datos'->>'suministro_id', v_ev->'datos'->>'cantidad', v_ev->'datos'->>'precio_unitario'));
      IF v_clave = ANY (v_vistos) THEN
        v_adv := v_adv || jsonb_build_object('campo', 'fila', 'mensaje', 'Esta fila repite otra del mismo archivo (misma descripción, destino, insumo, cantidad y precio).');
      END IF;
      v_vistos := v_vistos || v_clave;
      IF EXISTS (SELECT 1 FROM public.orden_compra_lineas ol
                  WHERE ol.orden_compra_id = p_orden_id AND lower(btrim(ol.descripcion)) = lower(v_ev->'datos'->>'descripcion')) THEN
        v_adv := v_adv || jsonb_build_object('campo', 'descripcion', 'mensaje', 'La orden ya tiene un renglón con esta descripción.');
      END IF;
      v_validas := v_validas + 1;
      v_datos := v_datos || (v_ev->'datos');
    ELSE
      v_conerr := v_conerr + 1;
    END IF;
    INSERT INTO public.compras_linea_importacion_filas (lote_id, company_id, fila, origen, datos, errores, advertencias)
    VALUES (v_lote.id, v_o.company_id, v_i, r, NULLIF(v_ev->'datos', 'null'::jsonb), v_ev->'errores', v_adv);
    v_resultado := v_resultado || jsonb_build_object('fila', v_i, 'origen', r, 'datos', v_ev->'datos',
                                                     'errores', v_ev->'errores', 'advertencias', v_adv);
  END LOOP;

  UPDATE public.compras_linea_importaciones
     SET resumen = jsonb_build_object('total', v_n, 'validas', v_validas, 'con_error', v_conerr, 'duplicado_de_lote_aplicado', v_ya)
   WHERE id = v_lote.id;

  RETURN jsonb_build_object('lote_id', v_lote.id, 'orden_compra_id', p_orden_id,
    'resumen', jsonb_build_object('total', v_n, 'validas', v_validas, 'con_error', v_conerr, 'duplicado_de_lote_aplicado', v_ya),
    'filas', v_resultado);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_lineas_importar_previsualizar(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compras_lineas_importar_previsualizar(uuid, jsonb, text) TO authenticated;

-- ── Aplicar: todo o nada, idempotente ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_lineas_importar_aplicar(p_lote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_lote   public.compras_linea_importaciones%ROWTYPE;
  v_o      public.ordenes_compra%ROWTYPE;
  f        record;
  v_ev     jsonb;
  d        jsonb;
  v_base   int;
  v_ids    uuid[] := ARRAY[]::uuid[];
  v_id     uuid;
  v_k      int := 0;
  v_errs   int := 0;
  v_res    jsonb;
BEGIN
  IF NOT public.compras_import_puede_capturar() THEN
    RAISE EXCEPTION 'COMPRAS_IMPORT_PERMISO: no tienes permiso para capturar renglones de órdenes.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_lote FROM public.compras_linea_importaciones WHERE id = p_lote_id;
  IF NOT FOUND OR v_lote.company_id IS DISTINCT FROM public.get_my_company_id() THEN
    RAISE EXCEPTION 'COMPRAS_IMPORT_LOTE: el lote no existe.' USING ERRCODE = 'check_violation';
  END IF;

  -- Todo lo que toque esta orden se serializa: dos aplicaciones simultáneas del mismo
  -- lote (o del mismo contenido) se ejecutan de una en una.
  PERFORM pg_advisory_xact_lock(hashtextextended('compras_lineas_import:' || v_lote.orden_compra_id::text, 0));
  SELECT * INTO v_lote FROM public.compras_linea_importaciones WHERE id = p_lote_id;

  IF v_lote.estado = 'aplicado' THEN
    RETURN COALESCE(v_lote.resultado, '{}'::jsonb) || jsonb_build_object('reutilizada', true);
  END IF;
  IF v_lote.estado <> 'previsualizado' THEN
    RAISE EXCEPTION 'COMPRAS_IMPORT_LOTE: el lote está "%" y ya no se puede aplicar.', v_lote.estado USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_o FROM public.ordenes_compra WHERE id = v_lote.orden_compra_id;
  IF NOT FOUND OR (v_o.project_id IS NOT NULL AND NOT public.can_access_project(v_o.project_id)) THEN
    RAISE EXCEPTION 'COMPRAS_IMPORT_ORDEN: la orden no existe en tu empresa o proyecto.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_o.estado <> 'borrador' THEN
    RAISE EXCEPTION 'COMPRAS_IMPORT_ORDEN_NO_BORRADOR: la orden está "%" y solo se importan renglones a una orden en borrador.', v_o.estado
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.compras_linea_importaciones l
     WHERE l.orden_compra_id = v_lote.orden_compra_id AND l.contenido_sha256 = v_lote.contenido_sha256
       AND l.estado = 'aplicado' AND l.id <> v_lote.id
       AND EXISTS (SELECT 1 FROM public.orden_compra_lineas ol
                    WHERE ol.id::text IN (SELECT jsonb_array_elements_text(l.resultado->'linea_ids')))) THEN
    RAISE EXCEPTION 'COMPRAS_IMPORT_DUPLICADO: este mismo contenido ya se importó a esta orden y sus renglones siguen ahí. No se importa dos veces.'
      USING ERRCODE = 'unique_violation';
  END IF;

  PERFORM set_config('compras.import_rpc', 'on', true);

  -- Se RE-EVALÚA cada fila contra el estado de HOY: si el insumo, la cuenta o la unidad
  -- cambiaron desde la vista previa, esa fila no se aplica a ciegas. Una con error frena todo.
  FOR f IN SELECT fila, origen FROM public.compras_linea_importacion_filas WHERE lote_id = p_lote_id ORDER BY fila LOOP
    v_ev := public.compras_import_evaluar(v_o, f.origen, f.fila);
    IF jsonb_array_length(v_ev->'errores') > 0 THEN
      v_errs := v_errs + 1;
    END IF;
  END LOOP;
  IF v_errs > 0 THEN
    RAISE EXCEPTION 'COMPRAS_IMPORT_CON_ERRORES: % fila(s) con error; la carga es todo o nada y no se escribió ningún renglón. Corrige el archivo y vuelve a cargarlo.', v_errs
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(max(linea), 0) INTO v_base FROM public.orden_compra_lineas WHERE orden_compra_id = v_o.id;
  FOR f IN SELECT fila, origen FROM public.compras_linea_importacion_filas WHERE lote_id = p_lote_id ORDER BY fila LOOP
    d := (public.compras_import_evaluar(v_o, f.origen, f.fila))->'datos';
    v_k := v_k + 1;
    INSERT INTO public.orden_compra_lineas
      (company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, categoria,
       cantidad, unidad, precio_unitario, iva_monto, cuenta_id)
    VALUES
      (v_o.company_id, v_o.id, v_base + v_k, d->>'descripcion', d->>'destino_tipo',
       NULLIF(d->>'suministro_id', '')::uuid, d->>'categoria', (d->>'cantidad')::numeric, d->>'unidad',
       (d->>'precio_unitario')::numeric, (d->>'iva_monto')::numeric, NULLIF(d->>'cuenta_id', '')::uuid)
    RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
  END LOOP;

  v_res := jsonb_build_object('lote_id', v_lote.id, 'orden_compra_id', v_o.id, 'renglones_creados', v_k,
                              'linea_ids', to_jsonb(v_ids), 'reutilizada', false);
  UPDATE public.compras_linea_importaciones
     SET estado = 'aplicado', resultado = v_res, aplicado_por = auth.uid(), aplicado_at = now()
   WHERE id = v_lote.id;
  RETURN v_res;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_lineas_importar_aplicar(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compras_lineas_importar_aplicar(uuid) TO authenticated;

-- ── Descartar ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_lineas_importar_descartar(p_lote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_estado text;
BEGIN
  IF NOT public.compras_import_puede_capturar() THEN
    RAISE EXCEPTION 'COMPRAS_IMPORT_PERMISO: no tienes permiso para capturar renglones de órdenes.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT estado INTO v_estado FROM public.compras_linea_importaciones
   WHERE id = p_lote_id AND company_id = public.get_my_company_id() FOR UPDATE;
  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'COMPRAS_IMPORT_LOTE: el lote no existe.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_estado = 'aplicado' THEN
    RAISE EXCEPTION 'COMPRAS_IMPORT_LOTE: un lote aplicado no se descarta; los renglones se quitan de la orden.' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('compras.import_rpc', 'on', true);
  UPDATE public.compras_linea_importaciones SET estado = 'descartado' WHERE id = p_lote_id AND estado = 'previsualizado';
  RETURN jsonb_build_object('lote_id', p_lote_id, 'estado', 'descartado');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_lineas_importar_descartar(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compras_lineas_importar_descartar(uuid) TO authenticated;
