-- ============================================================================
-- CONTABILIDAD (6): TIPO DE CAMBIO MENSUAL
--
-- DECISIÓN CONFIRMADA POR EL NEGOCIO: se usa la tasa establecida para el MES,
-- igual en compras y en ventas.
--
-- QUÉ HABÍA. `conta_tipos_cambio` guardaba tasas por DÍA y
-- `conta_tasa_vigente` tomaba la última con fecha ≤ la del documento: si
-- faltaba la del día (o la del mes) se usaba EN SILENCIO una anterior. Sin
-- ninguna, el asiento quedaba en borrador con tasa 1 —importes sin convertir—
-- y nada impedía publicarlo así.
--
-- QUÉ HAY AHORA.
--   · CONFIGURACIÓN MENSUAL: `conta_tipos_cambio_mensual`, una tasa por
--       empresa · moneda de origen · mes (YYYY-MM).
--     DIRECCIÓN: `tasa` = unidades de la MONEDA BASE por 1 unidad de la
--     moneda de ORIGEN (1 USD = 7.750000 GTQ). La moneda base es la de la
--     EMPRESA (companies.default_currency), el pivote que ya usaba
--     conta_tasa_entre: se guarda en cada fila (`moneda_base`) para que la
--     dirección quede escrita y no dependa de la configuración de hoy.
--     ÁMBITO: la EMPRESA. Todas sus contabilidades (la de la empresa y las de
--     sus proyectos) usan esas tasas; entre dos monedas extranjeras la tasa
--     es la cruzada por el pivote, con las tasas del MISMO mes.
--     PRECISIÓN: 6 decimales en la tasa; los importes se redondean a 2
--     decimales (round, mitad lejos de cero) línea por línea, y el residuo de
--     redondeo se absorbe en la última línea del lado corto, como siempre.
--   · UNA SOLA FUENTE: `conta_tasa_vigente` pasa a ser la tasa del MES de la
--     fecha, sin buscar hacia atrás. Así la usan igual el generador de
--     asientos (ventas, cobros, compras, bancos), la revaluación, el
--     consolidado y la aplicación de saldos a favor.
--   · CADA ASIENTO GUARDA la tasa y el período usados:
--     conta_asientos.tipo_cambio_moneda / _periodo / _tasa (y cada línea
--     convertida, como antes, su monto de origen y su tasa).
--   · SIN TASA NO SE CONTABILIZA: el asiento queda en BORRADOR con
--     `tipo_cambio_pendiente` y el concepto dice qué falta; PUBLICARLO se
--     rechaza (SIN_TIPO_CAMBIO) con la instrucción de qué tasa y qué mes
--     configurar. Configurada, al publicar se convierte con la tasa de SU mes
--     (no la del mes en que se publica): el borrador no es contabilidad, así
--     que recalcularlo no toca nada publicado.
--   · CAMBIAR LA CONFIGURACIÓN no recalcula nada publicado: los asientos
--     publicados conservan sus importes, su tasa y su período.
--   · PERMISOS: leer, cualquiera de la empresa; crear, rol de empresa o
--     platform.contabilidad.create; cambiar, edit; borrar, delete (el molde de
--     20260818000000). AUDITORÍA: `conta_tipos_cambio_mensual_historial`,
--     sólo inserción, con hora del servidor, usuario de la sesión, valor
--     anterior y nuevo; la aplicación sólo la lee.
--
-- COMPATIBILIDAD. Las tasas DIARIAS existentes se conservan (historia; la
-- pantalla las muestra como referencia) pero YA NO SE USAN para convertir. No
-- se derivan tasas mensuales de ellas: elegir cuál de las diarias es «la del
-- mes» es una decisión que no se toma en silencio. Los asientos ya
-- publicados no cambian. Un borrador anterior que quedó «sin tipo de cambio»
-- no tiene la marca nueva: se publica como antes (lo revisa una persona).
--
-- CÓMO SE REVIERTE (en este orden): DROP TRIGGER trg_conta_asiento_tc_al_publicar
-- ON conta_asientos y su función; restaurar conta_generar_asiento desde
-- 20261002000000 y conta_tasa_vigente desde 20260611000100; DROP FUNCTION
-- conta_tc_faltantes; DROP TABLE conta_tipos_cambio_mensual_historial,
-- conta_tipos_cambio_mensual (con su trigger); y, sólo si ningún asiento las
-- usa, DROP COLUMN de tipo_cambio_moneda, tipo_cambio_periodo,
-- tipo_cambio_tasa y tipo_cambio_pendiente en conta_asientos.
-- ============================================================================

-- ── 1. La configuración mensual ─────────────────────────────────────────────
CREATE TABLE public.conta_tipos_cambio_mensual (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- ISO 4217 de la moneda de ORIGEN (la que se convierte).
  moneda      text          NOT NULL,
  -- ISO 4217 de la moneda BASE de la empresa al guardar (la fija el trigger).
  moneda_base text          NOT NULL,
  periodo     text          NOT NULL,
  -- Unidades de moneda_base por 1 unidad de moneda.
  tasa        numeric(12,6) NOT NULL,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  updated_by  uuid,
  CONSTRAINT conta_tc_mensual_periodo_valido CHECK (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT conta_tc_mensual_tasa_positiva CHECK (tasa > 0),
  CONSTRAINT conta_tc_mensual_moneda_iso CHECK (moneda ~ '^[A-Z]{3}$' AND moneda_base ~ '^[A-Z]{3}$'),
  CONSTRAINT conta_tc_mensual_monedas_distintas CHECK (moneda <> moneda_base),
  CONSTRAINT conta_tc_mensual_unica UNIQUE (company_id, moneda, periodo)
);

COMMENT ON TABLE public.conta_tipos_cambio_mensual IS
  'Tipo de cambio MENSUAL por empresa: 1 unidad de `moneda` = `tasa` unidades de `moneda_base` (la de la empresa) durante `periodo` (YYYY-MM). Única fuente de conversión (conta_tasa_vigente). Cambiarla no recalcula asientos publicados.';

-- La moneda base y el actor los fija el servidor; los códigos se normalizan.
CREATE FUNCTION public.conta_tg_tc_mensual_normalizar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  NEW.moneda := upper(btrim(NEW.moneda));
  IF TG_OP = 'INSERT' THEN
    NEW.moneda_base := public.conta_moneda_base(NEW.company_id, NULL);
    NEW.created_at  := now();
    NEW.created_by  := auth.uid();
  ELSE
    IF NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.moneda IS DISTINCT FROM OLD.moneda
       OR NEW.periodo IS DISTINCT FROM OLD.periodo OR NEW.moneda_base IS DISTINCT FROM OLD.moneda_base THEN
      RAISE EXCEPTION 'TC_MENSUAL_INMUTABLE: la empresa, las monedas y el mes de una tasa no cambian; cambia la tasa o registra otra.'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_tc_mensual_normalizar() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_conta_tc_mensual_normalizar
  BEFORE INSERT OR UPDATE ON public.conta_tipos_cambio_mensual
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_tc_mensual_normalizar();

-- ── 2. Auditoría: sólo inserción ────────────────────────────────────────────
CREATE TABLE public.conta_tipos_cambio_mensual_historial (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tipo_cambio_id uuid          NOT NULL,
  accion         text          NOT NULL,
  moneda         text          NOT NULL,
  moneda_base    text          NOT NULL,
  periodo        text          NOT NULL,
  tasa_anterior  numeric(12,6),
  tasa_nueva     numeric(12,6),
  actor          uuid,
  ocurrido_at    timestamptz   NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT conta_tc_hist_accion CHECK (accion IN ('alta','cambio','baja'))
);

CREATE INDEX idx_conta_tc_hist_empresa ON public.conta_tipos_cambio_mensual_historial(company_id, ocurrido_at DESC);

COMMENT ON TABLE public.conta_tipos_cambio_mensual_historial IS
  'Bitácora de altas, cambios y bajas de tipos de cambio mensuales: hora del servidor, usuario de la sesión, tasa anterior y nueva. Sólo inserción; la escribe un trigger.';

CREATE FUNCTION public.conta_tg_tc_mensual_historial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tasa IS NOT DISTINCT FROM OLD.tasa THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.conta_tipos_cambio_mensual_historial
    (company_id, tipo_cambio_id, accion, moneda, moneda_base, periodo, tasa_anterior, tasa_nueva, actor)
  VALUES (
    COALESCE(NEW.company_id, OLD.company_id), COALESCE(NEW.id, OLD.id),
    CASE TG_OP WHEN 'INSERT' THEN 'alta' WHEN 'UPDATE' THEN 'cambio' ELSE 'baja' END,
    COALESCE(NEW.moneda, OLD.moneda), COALESCE(NEW.moneda_base, OLD.moneda_base), COALESCE(NEW.periodo, OLD.periodo),
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.tasa END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.tasa END,
    auth.uid());
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_tc_mensual_historial() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_conta_tc_mensual_historial
  AFTER INSERT OR UPDATE OR DELETE ON public.conta_tipos_cambio_mensual
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_tc_mensual_historial();

-- ── 3. RLS: el molde de 20260818000000 ──────────────────────────────────────
ALTER TABLE public.conta_tipos_cambio_mensual ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conta_tipos_cambio_mensual_historial ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conta_tipos_cambio_mensual_select" ON public.conta_tipos_cambio_mensual
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin()) OR company_id = (SELECT public.get_my_company_id()));
CREATE POLICY "conta_tipos_cambio_mensual_insert" ON public.conta_tipos_cambio_mensual
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_super_admin()) OR (company_id = (SELECT public.get_my_company_id())
    AND (public.current_user_role() = ANY (ARRAY['company_owner','admin'])
         OR (SELECT public.user_has_permission('platform.contabilidad.create')))));
CREATE POLICY "conta_tipos_cambio_mensual_update" ON public.conta_tipos_cambio_mensual
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_super_admin()) OR (company_id = (SELECT public.get_my_company_id())
    AND (public.current_user_role() = ANY (ARRAY['company_owner','admin'])
         OR (SELECT public.user_has_permission('platform.contabilidad.edit')))))
  WITH CHECK ((SELECT public.is_super_admin()) OR (company_id = (SELECT public.get_my_company_id())
    AND (public.current_user_role() = ANY (ARRAY['company_owner','admin'])
         OR (SELECT public.user_has_permission('platform.contabilidad.edit')))));
CREATE POLICY "conta_tipos_cambio_mensual_delete" ON public.conta_tipos_cambio_mensual
  FOR DELETE TO authenticated
  USING ((SELECT public.is_super_admin()) OR (company_id = (SELECT public.get_my_company_id())
    AND (public.current_user_role() = ANY (ARRAY['company_owner','admin'])
         OR (SELECT public.user_has_permission('platform.contabilidad.delete')))));
CREATE POLICY "conta_tipos_cambio_mensual_historial_select" ON public.conta_tipos_cambio_mensual_historial
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin()) OR company_id = (SELECT public.get_my_company_id()));

REVOKE ALL ON public.conta_tipos_cambio_mensual, public.conta_tipos_cambio_mensual_historial FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conta_tipos_cambio_mensual TO authenticated;
GRANT SELECT ON public.conta_tipos_cambio_mensual_historial TO authenticated;
GRANT ALL ON public.conta_tipos_cambio_mensual, public.conta_tipos_cambio_mensual_historial TO service_role;

-- La tabla diaria queda como historia: se sigue leyendo, ya no convierte.
COMMENT ON TABLE public.conta_tipos_cambio IS
  'LEGADO (hasta 20261008000000): tasas por día. Se conservan como historia y referencia; la conversión usa conta_tipos_cambio_mensual.';

-- ── 4. La tasa vigente es la del MES, sin buscar hacia atrás ────────────────
CREATE OR REPLACE FUNCTION public.conta_tasa_vigente(p_company_id uuid, p_moneda text, p_fecha date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.tasa FROM public.conta_tipos_cambio_mensual m
   WHERE m.company_id = p_company_id AND m.moneda = p_moneda
     AND m.periodo = to_char(p_fecha, 'YYYY-MM')
$$;

COMMENT ON FUNCTION public.conta_tasa_vigente(uuid, text, date) IS
  'Tasa MENSUAL de una moneda hacia la moneda de la empresa para el mes de la fecha (conta_tipos_cambio_mensual). NULL si ese mes no tiene tasa: nunca usa la de otro mes.';

-- Qué tasas mensuales faltan para convertir de p_de a p_a en un mes: la
-- instrucción que se muestra al usuario. INTERNA.
CREATE FUNCTION public.conta_tc_faltantes(p_company_id uuid, p_de text, p_a text, p_periodo text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT string_agg(x.m || '→' || x.piv || ' de ' || p_periodo, ' y ')
    FROM (SELECT DISTINCT m, public.conta_moneda_base(p_company_id, NULL) AS piv
            FROM unnest(ARRAY[p_de, p_a]) AS m
           WHERE m IS DISTINCT FROM public.conta_moneda_base(p_company_id, NULL)) x
   WHERE NOT EXISTS (SELECT 1 FROM public.conta_tipos_cambio_mensual t
                      WHERE t.company_id = p_company_id AND t.moneda = x.m AND t.periodo = p_periodo)
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tc_faltantes(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- ── 5. Cada asiento guarda la tasa y el período usados ──────────────────────
ALTER TABLE public.conta_asientos
  ADD COLUMN tipo_cambio_moneda    text,
  ADD COLUMN tipo_cambio_periodo   text,
  ADD COLUMN tipo_cambio_tasa      numeric(12,6),
  ADD COLUMN tipo_cambio_pendiente boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.conta_asientos.tipo_cambio_moneda IS
  'Moneda del documento convertida a la base del ledger (NULL si no hubo conversión).';
COMMENT ON COLUMN public.conta_asientos.tipo_cambio_periodo IS
  'Mes (YYYY-MM) cuya tasa se usó —o se necesita— para convertir: el de la fecha del documento.';
COMMENT ON COLUMN public.conta_asientos.tipo_cambio_tasa IS
  'Tasa usada (unidades de la base del ledger por 1 de tipo_cambio_moneda). NULL mientras falte.';
COMMENT ON COLUMN public.conta_asientos.tipo_cambio_pendiente IS
  'Borrador generado sin la tasa de su mes: no se publica hasta configurarla; al publicarse se convierte con ella.';

-- ── 6. El generador: tasa del mes o borrador pendiente ──────────────────────
-- Cuerpo idéntico a 20261002000000 salvo el bloque de conversión y las
-- columnas nuevas del asiento.
CREATE OR REPLACE FUNCTION public.conta_generar_asiento(
  p_company_id   uuid,
  p_project_id   uuid,
  p_origen_tabla text,
  p_origen_id    uuid,
  p_evento       text,
  p_fecha        date,
  p_concepto     text,
  p_tipo         text,
  p_moneda_doc   text,
  p_lineas       jsonb
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_base       text;
  v_doc        text;
  v_tasa       numeric(12,6) := 1;
  v_publicar   boolean := true;
  v_concepto   text := p_concepto;
  v_fecha      date := COALESCE(p_fecha, CURRENT_DATE);
  v_asiento_id uuid;
  v_linea      jsonb;
  v_cuenta     uuid;
  v_orden      int := 0;
  v_debe       numeric(14,2);
  v_haber      numeric(14,2);
  v_tot_debe   numeric(14,2) := 0;
  v_tot_haber  numeric(14,2) := 0;
  v_diff       numeric(14,2);
  -- Tipo de cambio MENSUAL (20261008000000): el período del documento, la
  -- moneda convertida y si la tasa falta.
  v_tc_periodo text;
  v_tc_moneda  text;
  v_tc_tasa    numeric(12,6);
  v_tc_falta   boolean := false;
BEGIN
  -- Ledger sin catálogo → esa contabilidad aún no opera; salir sin ruido.
  IF NOT EXISTS (
    SELECT 1 FROM public.conta_cuentas
    WHERE company_id = p_company_id AND project_id IS NOT DISTINCT FROM p_project_id
  ) THEN
    RETURN NULL;
  END IF;

  -- Resolución de cuentas ANTES de insertar: cuenta_id directo (cuenta de
  -- detalle DEL LEDGER) o evento→mapeo del ledger; si falta, no se asienta.
  FOR v_linea IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    IF v_linea ? 'cuenta_id' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.conta_cuentas
        WHERE id = (v_linea->>'cuenta_id')::uuid
          AND company_id = p_company_id
          AND project_id IS NOT DISTINCT FROM p_project_id
          AND es_detalle
      ) THEN
        RAISE WARNING 'conta_generar_asiento: cuenta_id % no pertenece al ledger (%/%) — asiento % omitido',
          v_linea->>'cuenta_id', p_company_id, p_project_id, p_evento;
        RETURN NULL;
      END IF;
    ELSIF public.conta_cuenta_para(p_company_id, p_project_id, v_linea->>'evento') IS NULL THEN
      RAISE WARNING 'conta_generar_asiento: falta mapeo % en el ledger (%/%) — asiento % omitido',
        v_linea->>'evento', p_company_id, p_project_id, p_evento;
      RETURN NULL;
    END IF;
  END LOOP;

  -- Moneda base DEL LEDGER y conversión cruzada doc→base (pivote = empresa).
  v_base := public.conta_moneda_base(p_company_id, p_project_id);
  v_doc  := COALESCE(public.conta_normalizar_moneda(p_moneda_doc), v_base);

  IF v_doc <> v_base THEN
    -- La tasa del MES del documento (conta_tasa_vigente es mensual desde
    -- 20261008000000). Sin ella no se contabiliza: el asiento queda en
    -- borrador marcado como pendiente de tipo de cambio, y publicarlo exige
    -- configurar la tasa de ESE mes (trg_conta_asiento_tc_al_publicar). No
    -- se usa la tasa de otro mes ni un valor por defecto.
    v_tc_periodo := to_char(v_fecha, 'YYYY-MM');
    v_tc_moneda  := v_doc;
    v_tasa := public.conta_tasa_entre(p_company_id, v_doc, v_base, v_fecha);
    IF v_tasa IS NULL THEN
      v_tasa := 1;
      v_publicar := false;
      v_tc_falta := true;
      v_concepto := v_concepto || ' [SIN TIPO DE CAMBIO ' || v_doc || '→' || v_base || ' ' || v_tc_periodo || ']';
    ELSE
      v_tc_tasa := v_tasa;
    END IF;
  END IF;

  -- Si el periodo del documento ya está cerrado, el asiento se fecha hoy.
  IF p_project_id IS NOT NULL
     AND public.conta_periodo_cerrado(p_project_id, to_char(v_fecha, 'YYYY-MM')) THEN
    v_fecha := CURRENT_DATE;
  END IF;

  PERFORM set_config('conta.allow_system_write', 'on', true);

  INSERT INTO public.conta_asientos (
    company_id, project_id, fecha, tipo, concepto, estado,
    origen, origen_tabla, origen_id, origen_evento, moneda_base,
    tipo_cambio_moneda, tipo_cambio_periodo, tipo_cambio_tasa, tipo_cambio_pendiente
  )
  VALUES (
    p_company_id, p_project_id, v_fecha, p_tipo, v_concepto, 'borrador',
    'automatico', p_origen_tabla, p_origen_id, p_evento, v_base,
    v_tc_moneda, v_tc_periodo, v_tc_tasa, v_tc_falta
  )
  ON CONFLICT (company_id, origen_tabla, origen_id, origen_evento)
    WHERE origen = 'automatico' AND estado <> 'anulado'
  DO NOTHING
  RETURNING id INTO v_asiento_id;

  IF v_asiento_id IS NULL THEN
    -- Ya contabilizado (idempotencia).
    PERFORM set_config('conta.allow_system_write', 'off', true);
    RETURN NULL;
  END IF;

  FOR v_linea IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    v_orden := v_orden + 1;
    v_cuenta := CASE WHEN v_linea ? 'cuenta_id' THEN (v_linea->>'cuenta_id')::uuid
                     ELSE public.conta_cuenta_para(p_company_id, p_project_id, v_linea->>'evento')
                END;
    v_debe  := round(COALESCE((v_linea->>'debe')::numeric, 0)  * v_tasa, 2);
    v_haber := round(COALESCE((v_linea->>'haber')::numeric, 0) * v_tasa, 2);
    IF v_debe = 0 AND v_haber = 0 THEN CONTINUE; END IF;

    INSERT INTO public.conta_asiento_lineas (
      asiento_id, company_id, cuenta_id, orden, descripcion, debe, haber,
      moneda_origen, monto_origen, tipo_cambio,
      auxiliar_cliente_id, unidad_id, tipo_cargo
    )
    VALUES (
      v_asiento_id, p_company_id, v_cuenta, v_orden, v_linea->>'descripcion',
      v_debe, v_haber,
      CASE WHEN v_doc <> v_base THEN v_doc END,
      CASE WHEN v_doc <> v_base THEN COALESCE((v_linea->>'debe')::numeric, 0)
                                      + COALESCE((v_linea->>'haber')::numeric, 0) END,
      CASE WHEN v_doc <> v_base THEN v_tasa END,
      -- Dimensiones opcionales (20261002000000): quien no las manda, no las
      -- recibe. Las valida trg_conta_linea_dimensiones.
      NULLIF(v_linea->>'auxiliar_cliente_id', '')::uuid,
      NULLIF(v_linea->>'unidad_id', '')::uuid,
      NULLIF(v_linea->>'tipo_cargo', '')
    );

    v_tot_debe  := v_tot_debe + v_debe;
    v_tot_haber := v_tot_haber + v_haber;
  END LOOP;

  -- Residuo de redondeo por conversión: se absorbe en la última línea del lado
  -- corto para garantizar debe = haber exacto.
  v_diff := v_tot_debe - v_tot_haber;
  IF v_diff <> 0 THEN
    IF v_diff > 0 THEN
      UPDATE public.conta_asiento_lineas SET haber = haber + v_diff
      WHERE id = (SELECT id FROM public.conta_asiento_lineas
                  WHERE asiento_id = v_asiento_id AND haber > 0
                  ORDER BY orden DESC LIMIT 1);
      v_tot_haber := v_tot_haber + v_diff;
    ELSE
      UPDATE public.conta_asiento_lineas SET debe = debe - v_diff
      WHERE id = (SELECT id FROM public.conta_asiento_lineas
                  WHERE asiento_id = v_asiento_id AND debe > 0
                  ORDER BY orden DESC LIMIT 1);
      v_tot_debe := v_tot_debe - v_diff;
    END IF;
  END IF;

  UPDATE public.conta_asientos
  SET total_debe  = v_tot_debe,
      total_haber = v_tot_haber,
      estado      = CASE WHEN v_publicar THEN 'publicado' ELSE 'borrador' END,
      numero      = CASE WHEN v_publicar THEN public.conta_siguiente_folio(p_company_id, p_project_id) END,
      publicado_at = CASE WHEN v_publicar THEN now() END,
      updated_at  = now()
  WHERE id = v_asiento_id;

  PERFORM set_config('conta.allow_system_write', 'off', true);
  RETURN v_asiento_id;
EXCEPTION WHEN OTHERS THEN
  -- La contabilidad nunca rompe la operación de negocio.
  RAISE WARNING 'conta_generar_asiento(%/%/%): %', p_origen_tabla, p_origen_id, p_evento, SQLERRM;
  PERFORM set_config('conta.allow_system_write', 'off', true);
  RETURN NULL;
END;
$$;


-- ── 7. Publicar un borrador pendiente de tipo de cambio ─────────────────────
-- Se hace en un trigger (y no reescribiendo conta_publicar_asiento, cuyo guard
-- de permisos se reescribe en 20260818000000): al pasar de borrador a
-- publicado, si el asiento quedó sin tasa, se busca la de SU mes; sin ella, no
-- se publica; con ella, cada línea convertida se recalcula desde su monto de
-- origen y el residuo de redondeo se absorbe como en el generador.
CREATE FUNCTION public.conta_tg_asiento_tc_al_publicar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tasa  numeric(12,6);
  v_debe  numeric(14,2);
  v_haber numeric(14,2);
  v_diff  numeric(14,2);
BEGIN
  IF NOT (OLD.estado = 'borrador' AND NEW.estado = 'publicado' AND OLD.tipo_cambio_pendiente) THEN
    RETURN NEW;
  END IF;

  v_tasa := public.conta_tasa_entre(NEW.company_id, NEW.tipo_cambio_moneda, NEW.moneda_base,
                                    to_date(NEW.tipo_cambio_periodo || '-01', 'YYYY-MM-DD'));
  IF v_tasa IS NULL THEN
    RAISE EXCEPTION 'SIN_TIPO_CAMBIO: falta el tipo de cambio mensual %. Configúralo en Contabilidad › Configuración › Tipos de cambio (mensual) y vuelve a publicar. No se usa la tasa de otro mes.',
      COALESCE(public.conta_tc_faltantes(NEW.company_id, NEW.tipo_cambio_moneda, NEW.moneda_base, NEW.tipo_cambio_periodo),
               NEW.tipo_cambio_moneda || '→' || NEW.moneda_base || ' de ' || NEW.tipo_cambio_periodo)
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.conta_asiento_lineas l
     SET debe  = CASE WHEN l.debe  > 0 THEN round(l.monto_origen * v_tasa, 2) ELSE 0 END,
         haber = CASE WHEN l.haber > 0 THEN round(l.monto_origen * v_tasa, 2) ELSE 0 END,
         tipo_cambio = v_tasa
   WHERE l.asiento_id = NEW.id AND l.monto_origen IS NOT NULL;

  SELECT COALESCE(sum(l.debe), 0), COALESCE(sum(l.haber), 0) INTO v_debe, v_haber
    FROM public.conta_asiento_lineas l WHERE l.asiento_id = NEW.id;
  v_diff := v_debe - v_haber;
  IF v_diff > 0 THEN
    UPDATE public.conta_asiento_lineas SET haber = haber + v_diff
     WHERE id = (SELECT id FROM public.conta_asiento_lineas
                  WHERE asiento_id = NEW.id AND haber > 0 ORDER BY orden DESC LIMIT 1);
    v_haber := v_haber + v_diff;
  ELSIF v_diff < 0 THEN
    UPDATE public.conta_asiento_lineas SET debe = debe - v_diff
     WHERE id = (SELECT id FROM public.conta_asiento_lineas
                  WHERE asiento_id = NEW.id AND debe > 0 ORDER BY orden DESC LIMIT 1);
    v_debe := v_debe - v_diff;
  END IF;

  NEW.total_debe            := v_debe;
  NEW.total_haber           := v_haber;
  NEW.tipo_cambio_tasa      := v_tasa;
  NEW.tipo_cambio_pendiente := false;
  NEW.concepto              := btrim(regexp_replace(NEW.concepto, '\s*\[SIN TIPO DE CAMBIO [^]]*\]', '', 'g'));
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_asiento_tc_al_publicar() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_conta_asiento_tc_al_publicar
  BEFORE UPDATE OF estado ON public.conta_asientos
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_asiento_tc_al_publicar();
