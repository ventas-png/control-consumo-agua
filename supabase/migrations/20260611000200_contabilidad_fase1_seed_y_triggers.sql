-- ════════════════════════════════════════════════════════════════════════════
-- CONTABILIDAD (partida doble) — FASE 1 · parte C: seed + asientos automáticos
--
--   conta_seed_catalogo      — plantilla LATAM (GT/MX) de catálogo + mapeos;
--                              trigger AFTER INSERT ON companies + backfill
--   conta_cuenta_para        — resuelve evento → cuenta (override por proyecto)
--   conta_generar_asiento    — inserta y publica un asiento automático
--                              (multimoneda, idempotente, NUNCA lanza)
--   conta_reversar_automatico— reverso de un asiento automático (anulaciones)
--   triggers de negocio      — pagos, gastos_condominio, registros,
--                              cuotas_condominio
--
-- DECISIÓN (ver plan): asientos automáticos por TRIGGERS de Postgres porque no
-- existe un choke point de servidor — el cliente actualiza estados directo vía
-- RLS y también escriben edge functions (service_role) y crons. Los triggers
-- cubren todos esos caminos y la integridad vive en el servidor.
--
-- Robustez: ningún trigger contable puede abortar la operación de negocio.
-- conta_generar_asiento / conta_reversar_automatico atrapan TODA excepción
-- (RAISE WARNING) y la idempotencia la da el índice único uq_conta_asiento_origen.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Seed del catálogo ────────────────────────────────────────────────────

-- Inserta (si falta) una cuenta del seed y devuelve su id.
CREATE OR REPLACE FUNCTION public.conta_seed_cuenta(
  p_company uuid, p_codigo text, p_nombre text, p_tipo text,
  p_naturaleza text, p_padre_codigo text, p_nivel int, p_detalle boolean
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_padre uuid;
BEGIN
  IF p_padre_codigo IS NOT NULL THEN
    SELECT id INTO v_padre FROM public.conta_cuentas
    WHERE company_id = p_company AND codigo = p_padre_codigo;
  END IF;
  INSERT INTO public.conta_cuentas
    (company_id, codigo, nombre, tipo, naturaleza, padre_id, nivel, es_detalle, es_sistema)
  VALUES (p_company, p_codigo, p_nombre, p_tipo, p_naturaleza, v_padre, p_nivel, p_detalle, true)
  ON CONFLICT (company_id, codigo) DO NOTHING;
  RETURN (SELECT id FROM public.conta_cuentas WHERE company_id = p_company AND codigo = p_codigo);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_seed_cuenta(uuid, text, text, text, text, text, int, boolean)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.conta_seed_catalogo(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m record;
  v_cuenta uuid;
BEGIN
  -- 1 ACTIVO ────────────────────────────────────────────────────────────────
  PERFORM public.conta_seed_cuenta(p_company_id, '1',  'Activo',            'activo', 'deudora', NULL, 1, false);
  PERFORM public.conta_seed_cuenta(p_company_id, '11', 'Activo circulante', 'activo', 'deudora', '1',  2, false);
  PERFORM public.conta_seed_cuenta(p_company_id, '1101', 'Caja',                            'activo', 'deudora', '11', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '1102', 'Bancos',                          'activo', 'deudora', '11', 3, false);
  PERFORM public.conta_seed_cuenta(p_company_id, '1102-01', 'Banco principal',              'activo', 'deudora', '1102', 4, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '1103', 'Caja chica',                      'activo', 'deudora', '11', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '1104', 'Pasarelas de pago por liquidar',  'activo', 'deudora', '11', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '12', 'Cuentas por cobrar', 'activo', 'deudora', '1', 2, false);
  PERFORM public.conta_seed_cuenta(p_company_id, '1201', 'CxC cuotas de condominio',        'activo', 'deudora', '12', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '1202', 'CxC servicio de agua',            'activo', 'deudora', '12', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '13', 'Otros activos', 'activo', 'deudora', '1', 2, false);
  PERFORM public.conta_seed_cuenta(p_company_id, '1301', 'Fondo de reserva',                'activo', 'deudora', '13', 3, true);

  -- 2 PASIVO ────────────────────────────────────────────────────────────────
  PERFORM public.conta_seed_cuenta(p_company_id, '2',  'Pasivo',            'pasivo', 'acreedora', NULL, 1, false);
  PERFORM public.conta_seed_cuenta(p_company_id, '21', 'Pasivo circulante', 'pasivo', 'acreedora', '2',  2, false);
  PERFORM public.conta_seed_cuenta(p_company_id, '2101', 'IVA por pagar',           'pasivo', 'acreedora', '21', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '2102', 'Cobros anticipados',      'pasivo', 'acreedora', '21', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '2103', 'Depósitos en garantía',   'pasivo', 'acreedora', '21', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '2104', 'Proveedores por pagar',   'pasivo', 'acreedora', '21', 3, true);

  -- 3 CAPITAL ───────────────────────────────────────────────────────────────
  PERFORM public.conta_seed_cuenta(p_company_id, '3',  'Capital',          'capital', 'acreedora', NULL, 1, false);
  PERFORM public.conta_seed_cuenta(p_company_id, '31', 'Capital contable', 'capital', 'acreedora', '3',  2, false);
  PERFORM public.conta_seed_cuenta(p_company_id, '3101', 'Resultados acumulados',    'capital', 'acreedora', '31', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '3201', 'Resultado del ejercicio',  'capital', 'acreedora', '31', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '3301', 'Diferencial cambiario',    'capital', 'acreedora', '31', 3, true);

  -- 4 INGRESOS ──────────────────────────────────────────────────────────────
  PERFORM public.conta_seed_cuenta(p_company_id, '4',  'Ingresos',            'ingreso', 'acreedora', NULL, 1, false);
  PERFORM public.conta_seed_cuenta(p_company_id, '41', 'Ingresos operativos', 'ingreso', 'acreedora', '4',  2, false);
  PERFORM public.conta_seed_cuenta(p_company_id, '4101', 'Cuotas de mantenimiento', 'ingreso', 'acreedora', '41', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '4102', 'Servicio de agua',        'ingreso', 'acreedora', '41', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '4103', 'Mora y recargos',         'ingreso', 'acreedora', '41', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '4104', 'Cargos adicionales',      'ingreso', 'acreedora', '41', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '4199', 'Otros ingresos',          'ingreso', 'acreedora', '41', 3, true);

  -- 5 GASTOS (espeja CategoriaGasto de gastos_condominio) ───────────────────
  PERFORM public.conta_seed_cuenta(p_company_id, '5',  'Gastos',            'gasto', 'deudora', NULL, 1, false);
  PERFORM public.conta_seed_cuenta(p_company_id, '51', 'Gastos operativos', 'gasto', 'deudora', '5',  2, false);
  PERFORM public.conta_seed_cuenta(p_company_id, '5101', 'Mantenimiento',  'gasto', 'deudora', '51', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '5102', 'Servicios',      'gasto', 'deudora', '51', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '5103', 'Administrativo', 'gasto', 'deudora', '51', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '5104', 'Seguridad',      'gasto', 'deudora', '51', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '5105', 'Limpieza',       'gasto', 'deudora', '51', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '5106', 'Obras y mejoras','gasto', 'deudora', '51', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, '5199', 'Otros gastos',   'gasto', 'deudora', '51', 3, true);

  -- Mapeos default (a nivel empresa; el admin puede sobreescribir por proyecto)
  FOR m IN
    SELECT * FROM (VALUES
      ('metodo_efectivo',      '1101'),
      ('metodo_transferencia', '1102-01'),
      ('metodo_deposito',      '1102-01'),
      ('metodo_cheque',        '1102-01'),
      ('metodo_tarjeta',       '1104'),
      ('metodo_pasarela',      '1104'),
      ('metodo_otro',          '1101'),
      ('ingreso_agua',         '4102'),
      ('ingreso_cuota',        '4101'),
      ('ingreso_mora',         '4103'),
      ('ingreso_otros',        '4199'),
      ('cxc_agua',             '1202'),
      ('cxc_cuotas',           '1201'),
      ('iva_por_pagar',        '2101'),
      ('gasto_mantenimiento',  '5101'),
      ('gasto_servicios',      '5102'),
      ('gasto_administrativo', '5103'),
      ('gasto_seguridad',      '5104'),
      ('gasto_limpieza',       '5105'),
      ('gasto_obras',          '5106'),
      ('gasto_otros',          '5199')
    ) AS t(evento, codigo)
  LOOP
    SELECT id INTO v_cuenta FROM public.conta_cuentas
    WHERE company_id = p_company_id AND codigo = m.codigo;
    IF v_cuenta IS NOT NULL THEN
      INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
      VALUES (p_company_id, NULL, m.evento, v_cuenta)
      ON CONFLICT (company_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), evento)
      DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_seed_catalogo(uuid) FROM PUBLIC, anon, authenticated;

-- Companies nuevas: seed automático (patrón del trigger de billing trial).
-- NUNCA aborta el alta de la empresa.
CREATE OR REPLACE FUNCTION public.conta_seed_on_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    PERFORM public.conta_seed_catalogo(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'conta_seed_on_company(%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conta_seed_on_company ON public.companies;
CREATE TRIGGER trg_conta_seed_on_company
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.conta_seed_on_company();

-- ── 2. Resolución evento → cuenta ───────────────────────────────────────────
-- Override del proyecto si existe; si no, default de la empresa. NULL si falta.
CREATE OR REPLACE FUNCTION public.conta_cuenta_para(
  p_company_id uuid, p_project_id uuid, p_evento text
)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT cuenta_id FROM public.conta_mapeo_cuentas
  WHERE company_id = p_company_id AND evento = p_evento
    AND (project_id = p_project_id OR project_id IS NULL)
  ORDER BY project_id NULLS LAST
  LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cuenta_para(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_cuenta_para(uuid, uuid, text) TO authenticated;

-- ── 3. Generador central de asientos automáticos ────────────────────────────
-- p_lineas: jsonb array [{ "evento": "metodo_efectivo", "debe": 100, "haber": 0,
-- "descripcion": "..." }] con montos en la MONEDA DEL DOCUMENTO (p_moneda_doc).
-- Convierte a moneda base con la tasa vigente; sin tasa → asiento en BORRADOR
-- (marcado en el concepto) para que el admin lo corrija y publique.
-- Devuelve el id del asiento o NULL (duplicado/sin catálogo/sin mapeo/error).
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
BEGIN
  -- Sin catálogo seedeado → la empresa aún no usa contabilidad; salir sin ruido.
  IF NOT EXISTS (SELECT 1 FROM public.conta_cuentas WHERE company_id = p_company_id) THEN
    RETURN NULL;
  END IF;

  -- Resolución de cuentas ANTES de insertar: si falta un mapeo, no se asienta.
  FOR v_linea IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    IF public.conta_cuenta_para(p_company_id, p_project_id, v_linea->>'evento') IS NULL THEN
      RAISE WARNING 'conta_generar_asiento: falta mapeo % para company % — asiento % omitido',
        v_linea->>'evento', p_company_id, p_evento;
      RETURN NULL;
    END IF;
  END LOOP;

  v_base := public.conta_moneda_base(p_company_id);
  v_doc  := COALESCE(public.conta_normalizar_moneda(p_moneda_doc), v_base);

  IF v_doc <> v_base THEN
    v_tasa := public.conta_tasa_vigente(p_company_id, v_doc, v_fecha);
    IF v_tasa IS NULL THEN
      -- Nunca inventar tasa: queda en borrador para revisión manual.
      v_tasa := 1;
      v_publicar := false;
      v_concepto := v_concepto || ' [SIN TIPO DE CAMBIO ' || v_doc || '→' || v_base || ']';
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
    origen, origen_tabla, origen_id, origen_evento, moneda_base
  )
  VALUES (
    p_company_id, p_project_id, v_fecha, p_tipo, v_concepto, 'borrador',
    'automatico', p_origen_tabla, p_origen_id, p_evento, v_base
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
    v_cuenta := public.conta_cuenta_para(p_company_id, p_project_id, v_linea->>'evento');
    v_debe  := round(COALESCE((v_linea->>'debe')::numeric, 0)  * v_tasa, 2);
    v_haber := round(COALESCE((v_linea->>'haber')::numeric, 0) * v_tasa, 2);
    IF v_debe = 0 AND v_haber = 0 THEN CONTINUE; END IF;

    INSERT INTO public.conta_asiento_lineas (
      asiento_id, company_id, cuenta_id, orden, descripcion, debe, haber,
      moneda_origen, monto_origen, tipo_cambio
    )
    VALUES (
      v_asiento_id, p_company_id, v_cuenta, v_orden, v_linea->>'descripcion',
      v_debe, v_haber,
      CASE WHEN v_doc <> v_base THEN v_doc END,
      CASE WHEN v_doc <> v_base THEN COALESCE((v_linea->>'debe')::numeric, 0)
                                      + COALESCE((v_linea->>'haber')::numeric, 0) END,
      CASE WHEN v_doc <> v_base THEN v_tasa END
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
      numero      = CASE WHEN v_publicar THEN public.conta_siguiente_folio(p_company_id) END,
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

REVOKE EXECUTE ON FUNCTION public.conta_generar_asiento(uuid, uuid, text, uuid, text, date, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ── 4. Reverso de un asiento automático ─────────────────────────────────────
-- Busca el asiento publicado del evento original y crea su espejo publicado
-- (evento '<original>_revertido', idempotente por el índice único).
CREATE OR REPLACE FUNCTION public.conta_reversar_automatico(
  p_company_id      uuid,
  p_origen_tabla    text,
  p_origen_id       uuid,
  p_evento_original text,
  p_concepto        text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_original public.conta_asientos;
  v_reverso  public.conta_asientos;
  v_fecha    date;
BEGIN
  SELECT * INTO v_original FROM public.conta_asientos
  WHERE company_id = p_company_id AND origen = 'automatico'
    AND origen_tabla = p_origen_tabla AND origen_id = p_origen_id
    AND origen_evento = p_evento_original
    AND estado = 'publicado' AND anulado_por_id IS NULL
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL; -- nada que reversar (no se contabilizó o ya fue reversado)
  END IF;

  v_fecha := CASE
    WHEN v_original.project_id IS NOT NULL
         AND public.conta_periodo_cerrado(v_original.project_id, v_original.periodo)
    THEN CURRENT_DATE
    ELSE v_original.fecha
  END;

  PERFORM set_config('conta.allow_system_write', 'on', true);

  INSERT INTO public.conta_asientos (
    company_id, project_id, numero, fecha, tipo, concepto, estado,
    origen, origen_tabla, origen_id, origen_evento,
    moneda_base, total_debe, total_haber, reversa_de_id, publicado_at
  )
  VALUES (
    v_original.company_id, v_original.project_id,
    public.conta_siguiente_folio(p_company_id), v_fecha, v_original.tipo,
    p_concepto || ' (reverso de póliza #' || COALESCE(v_original.numero::text, '?') || ')',
    'publicado', 'automatico', p_origen_tabla, p_origen_id,
    p_evento_original || '_revertido',
    v_original.moneda_base, v_original.total_haber, v_original.total_debe,
    v_original.id, now()
  )
  ON CONFLICT (company_id, origen_tabla, origen_id, origen_evento)
    WHERE origen = 'automatico' AND estado <> 'anulado'
  DO NOTHING
  RETURNING * INTO v_reverso;

  IF v_reverso.id IS NULL THEN
    PERFORM set_config('conta.allow_system_write', 'off', true);
    RETURN NULL; -- reverso ya existía
  END IF;

  INSERT INTO public.conta_asiento_lineas (
    asiento_id, company_id, cuenta_id, orden, descripcion,
    debe, haber, moneda_origen, monto_origen, tipo_cambio
  )
  SELECT v_reverso.id, l.company_id, l.cuenta_id, l.orden, l.descripcion,
         l.haber, l.debe, l.moneda_origen, l.monto_origen, l.tipo_cambio
  FROM public.conta_asiento_lineas l
  WHERE l.asiento_id = v_original.id;

  UPDATE public.conta_asientos
  SET anulado_por_id = v_reverso.id, updated_at = now()
  WHERE id = v_original.id;

  PERFORM set_config('conta.allow_system_write', 'off', true);
  RETURN v_reverso.id;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'conta_reversar_automatico(%/%/%): %', p_origen_tabla, p_origen_id, p_evento_original, SQLERRM;
  PERFORM set_config('conta.allow_system_write', 'off', true);
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_reversar_automatico(uuid, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

-- ── 5. Trigger de PAGOS ─────────────────────────────────────────────────────
-- Contabiliza al pasar a verificado/aplicado (cargo cuenta del método, abono
-- CxC si el documento devengó o ingreso directo). Reversa al rechazar o al
-- soft-borrar un pago ya contabilizado.
CREATE OR REPLACE FUNCTION public.conta_tg_pagos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_project    uuid;
  v_company    uuid;
  v_moneda     text;
  v_metodo     text;
  v_contra     text;
  v_es_cuota   boolean;
  v_reg_estado text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Hard delete de un pago contabilizado → reverso (company vía proyecto).
    v_project := COALESCE(OLD.project_id, (SELECT project_id FROM public.clientes WHERE id = OLD.cliente_id));
    SELECT company_id INTO v_company FROM public.projects WHERE id = v_project;
    IF v_company IS NOT NULL THEN
      PERFORM public.conta_reversar_automatico(v_company, 'pagos', OLD.id,
        'pago_contabilizado', 'Pago eliminado');
    END IF;
    RETURN OLD;
  END IF;

  v_project := COALESCE(NEW.project_id, (SELECT project_id FROM public.clientes WHERE id = NEW.cliente_id));
  SELECT company_id INTO v_company FROM public.projects WHERE id = v_project;
  IF v_company IS NULL THEN
    RETURN NEW;
  END IF;

  -- Reverso: rechazado o soft-delete después de contabilizado.
  IF TG_OP = 'UPDATE'
     AND OLD.estado IN ('verificado','aplicado')
     AND (NEW.estado = 'rechazado'
          OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)) THEN
    PERFORM public.conta_reversar_automatico(v_company, 'pagos', NEW.id,
      'pago_contabilizado',
      CASE WHEN NEW.estado = 'rechazado' THEN 'Pago rechazado' ELSE 'Pago eliminado' END);
    RETURN NEW;
  END IF;

  -- Contabilizar: primera transición a verificado/aplicado (pago vivo).
  IF NEW.estado IN ('verificado','aplicado')
     AND NEW.deleted_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.estado NOT IN ('verificado','aplicado'))
     AND COALESCE(NEW.monto, 0) > 0 THEN

    v_metodo := CASE NEW.metodo
      WHEN 'efectivo'        THEN 'metodo_efectivo'
      WHEN 'transferencia'   THEN 'metodo_transferencia'
      WHEN 'deposito'        THEN 'metodo_deposito'
      WHEN 'cheque'          THEN 'metodo_cheque'
      WHEN 'tarjeta_credito' THEN 'metodo_tarjeta'
      WHEN 'tarjeta_debito'  THEN 'metodo_tarjeta'
      WHEN 'paypal'          THEN 'metodo_pasarela'
      ELSE 'metodo_otro'
    END;

    -- Contrapartida: CxC si el documento origen ya devengó; ingreso directo si no.
    v_es_cuota := EXISTS (SELECT 1 FROM public.cuotas_condominio WHERE pago_id = NEW.id);
    IF NEW.registro_id IS NOT NULL THEN
      SELECT factura_estado INTO v_reg_estado FROM public.registros WHERE id = NEW.registro_id;
      v_contra := CASE WHEN v_reg_estado IN ('emitida','vencida','pagada')
                       THEN 'cxc_agua' ELSE 'ingreso_agua' END;
      SELECT moneda INTO v_moneda FROM public.projects WHERE id = v_project;
    ELSIF v_es_cuota THEN
      v_contra := 'cxc_cuotas';
      SELECT COALESCE(moneda_condominios, moneda) INTO v_moneda
      FROM public.projects WHERE id = v_project;
    ELSE
      v_contra := 'ingreso_otros';
      SELECT moneda INTO v_moneda FROM public.projects WHERE id = v_project;
    END IF;

    PERFORM public.conta_generar_asiento(
      v_company, v_project, 'pagos', NEW.id, 'pago_contabilizado',
      COALESCE(NEW.verified_at::date, CURRENT_DATE),
      'Pago ' || NEW.metodo || COALESCE(' ref. ' || NULLIF(NEW.referencia, ''), ''),
      'ingreso', v_moneda,
      jsonb_build_array(
        jsonb_build_object('evento', v_metodo, 'debe', NEW.monto),
        jsonb_build_object('evento', v_contra, 'haber', NEW.monto)
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conta_pagos ON public.pagos;
CREATE TRIGGER trg_conta_pagos
  AFTER INSERT OR UPDATE OR DELETE ON public.pagos
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_pagos();

-- ── 6. Trigger de GASTOS ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.conta_tg_gastos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_moneda text;
  v_metodo text;
  v_gasto  text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.conta_reversar_automatico(OLD.company_id, 'gastos_condominio', OLD.id,
      'gasto_pagado', 'Gasto eliminado');
    RETURN OLD;
  END IF;

  -- Reverso: anulado después de pagado.
  IF TG_OP = 'UPDATE' AND OLD.estado = 'pagado' AND NEW.estado = 'anulado' THEN
    PERFORM public.conta_reversar_automatico(NEW.company_id, 'gastos_condominio', NEW.id,
      'gasto_pagado', 'Gasto anulado');
    RETURN NEW;
  END IF;

  -- Contabilizar: gasto pagado (alta directa en pagado o transición).
  IF NEW.estado = 'pagado'
     AND (TG_OP = 'INSERT' OR OLD.estado <> 'pagado')
     AND COALESCE(NEW.monto, 0) > 0 THEN

    v_gasto := CASE WHEN NEW.categoria IN ('mantenimiento','servicios','administrativo',
                                           'seguridad','limpieza','obras')
                    THEN 'gasto_' || NEW.categoria ELSE 'gasto_otros' END;
    v_metodo := CASE NEW.metodo_pago
      WHEN 'efectivo'      THEN 'metodo_efectivo'
      WHEN 'transferencia' THEN 'metodo_transferencia'
      WHEN 'cheque'        THEN 'metodo_cheque'
      WHEN 'tarjeta'       THEN 'metodo_tarjeta'
      ELSE 'metodo_otro'
    END;
    SELECT COALESCE(moneda_condominios, moneda) INTO v_moneda
    FROM public.projects WHERE id = NEW.project_id;

    PERFORM public.conta_generar_asiento(
      NEW.company_id, NEW.project_id, 'gastos_condominio', NEW.id, 'gasto_pagado',
      NEW.fecha,
      'Gasto: ' || NEW.concepto || COALESCE(' — ' || NULLIF(NEW.proveedor_nombre, ''), ''),
      'egreso', v_moneda,
      jsonb_build_array(
        jsonb_build_object('evento', v_gasto, 'debe', NEW.monto),
        jsonb_build_object('evento', v_metodo, 'haber', NEW.monto)
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conta_gastos ON public.gastos_condominio;
CREATE TRIGGER trg_conta_gastos
  AFTER INSERT OR UPDATE OR DELETE ON public.gastos_condominio
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_gastos();

-- ── 7. Trigger de REGISTROS (facturas de agua) ──────────────────────────────
-- Devengo al emitir (CxC contra ingreso + IVA); mora al aplicarse (CxC contra
-- ingreso por mora); reverso del devengo al anular.
CREATE OR REPLACE FUNCTION public.conta_tg_registros()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid;
  v_moneda  text;
  v_total   numeric(14,2);
  v_iva     numeric(14,2);
  v_mora    numeric(14,2);
  v_ingreso numeric(14,2);
  v_lineas  jsonb;
BEGIN
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT company_id, moneda INTO v_company, v_moneda
  FROM public.projects WHERE id = NEW.project_id;
  IF v_company IS NULL THEN
    RETURN NEW;
  END IF;

  -- Devengo al emitir.
  IF NEW.factura_estado = 'emitida'
     AND OLD.factura_estado IS DISTINCT FROM NEW.factura_estado
     AND COALESCE(OLD.factura_estado, 'pendiente') IN ('pendiente') THEN
    v_iva     := COALESCE(NEW.iva_monto, 0);
    v_mora    := COALESCE(NEW.mora_monto, 0);
    v_total   := COALESCE(NEW.total_a_pagar, COALESCE(NEW.monto_calculado, 0) + v_iva + v_mora);
    -- El ingreso absorbe el residuo de redondeo para que debe = haber exacto.
    v_ingreso := v_total - v_iva - v_mora;
    IF v_total > 0 THEN
      v_lineas := jsonb_build_array(
        jsonb_build_object('evento', 'cxc_agua', 'debe', v_total),
        jsonb_build_object('evento', 'ingreso_agua', 'haber', v_ingreso)
      );
      IF v_iva > 0 THEN
        v_lineas := v_lineas || jsonb_build_array(
          jsonb_build_object('evento', 'iva_por_pagar', 'haber', v_iva));
      END IF;
      IF v_mora > 0 THEN
        v_lineas := v_lineas || jsonb_build_array(
          jsonb_build_object('evento', 'ingreso_mora', 'haber', v_mora));
      END IF;
      PERFORM public.conta_generar_asiento(
        v_company, NEW.project_id, 'registros', NEW.id, 'factura_emitida',
        CURRENT_DATE,
        'Factura de agua emitida — ' || COALESCE(NEW.cliente_nombre, 'cliente'),
        'diario', v_moneda, v_lineas
      );
    END IF;
    RETURN NEW;
  END IF;

  -- Mora aplicada por el cron (después de la emisión).
  IF COALESCE(NEW.mora_monto, 0) > 0 AND COALESCE(OLD.mora_monto, 0) = 0
     AND NEW.factura_estado IN ('emitida','vencida') THEN
    PERFORM public.conta_generar_asiento(
      v_company, NEW.project_id, 'registros', NEW.id, 'factura_mora',
      CURRENT_DATE,
      'Mora aplicada — factura de agua de ' || COALESCE(NEW.cliente_nombre, 'cliente'),
      'diario', v_moneda,
      jsonb_build_array(
        jsonb_build_object('evento', 'cxc_agua', 'debe', NEW.mora_monto),
        jsonb_build_object('evento', 'ingreso_mora', 'haber', NEW.mora_monto)
      )
    );
    RETURN NEW;
  END IF;

  -- Anulación: reverso del devengo (y de la mora si la hubo).
  IF NEW.factura_estado = 'anulada'
     AND OLD.factura_estado IS DISTINCT FROM 'anulada' THEN
    PERFORM public.conta_reversar_automatico(v_company, 'registros', NEW.id,
      'factura_emitida', 'Factura de agua anulada');
    PERFORM public.conta_reversar_automatico(v_company, 'registros', NEW.id,
      'factura_mora', 'Factura de agua anulada');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conta_registros ON public.registros;
CREATE TRIGGER trg_conta_registros
  AFTER UPDATE OF factura_estado, mora_monto ON public.registros
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_registros();

-- ── 8. Trigger de CUOTAS de condominio ──────────────────────────────────────
-- Devengo al emitir la cuota; mora al aplicarse; reverso al soft/hard borrar.
CREATE OR REPLACE FUNCTION public.conta_tg_cuotas()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_moneda text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.conta_reversar_automatico(OLD.company_id, 'cuotas_condominio', OLD.id,
      'cuota_emitida', 'Cuota eliminada');
    PERFORM public.conta_reversar_automatico(OLD.company_id, 'cuotas_condominio', OLD.id,
      'cuota_mora', 'Cuota eliminada');
    RETURN OLD;
  END IF;

  -- Soft delete → reverso.
  IF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    PERFORM public.conta_reversar_automatico(NEW.company_id, 'cuotas_condominio', NEW.id,
      'cuota_emitida', 'Cuota eliminada');
    PERFORM public.conta_reversar_automatico(NEW.company_id, 'cuotas_condominio', NEW.id,
      'cuota_mora', 'Cuota eliminada');
    RETURN NEW;
  END IF;

  SELECT COALESCE(moneda_condominios, moneda) INTO v_moneda
  FROM public.projects WHERE id = NEW.project_id;

  -- Devengo al emitir (INSERT).
  IF TG_OP = 'INSERT' AND COALESCE(NEW.monto, 0) > 0 AND NEW.deleted_at IS NULL THEN
    PERFORM public.conta_generar_asiento(
      NEW.company_id, NEW.project_id, 'cuotas_condominio', NEW.id, 'cuota_emitida',
      CURRENT_DATE,
      'Cuota ' || NEW.concepto || ' ' || NEW.periodo,
      'diario', v_moneda,
      jsonb_build_array(
        jsonb_build_object('evento', 'cxc_cuotas', 'debe', NEW.monto),
        jsonb_build_object('evento', 'ingreso_cuota', 'haber', NEW.monto)
      )
    );
    RETURN NEW;
  END IF;

  -- Mora aplicada por el cron.
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.mora_monto, 0) > 0 AND COALESCE(OLD.mora_monto, 0) = 0
     AND NEW.deleted_at IS NULL THEN
    PERFORM public.conta_generar_asiento(
      NEW.company_id, NEW.project_id, 'cuotas_condominio', NEW.id, 'cuota_mora',
      CURRENT_DATE,
      'Mora aplicada — cuota ' || NEW.concepto || ' ' || NEW.periodo,
      'diario', v_moneda,
      jsonb_build_array(
        jsonb_build_object('evento', 'cxc_cuotas', 'debe', NEW.mora_monto),
        jsonb_build_object('evento', 'ingreso_mora', 'haber', NEW.mora_monto)
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conta_cuotas ON public.cuotas_condominio;
CREATE TRIGGER trg_conta_cuotas
  AFTER INSERT OR UPDATE OR DELETE ON public.cuotas_condominio
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_cuotas();

-- ── 9. Backfill: seed para companies existentes ─────────────────────────────
-- Idempotente; habilita la contabilidad a todos los tenants actuales. Los
-- triggers solo contabilizan documentos NUEVOS (sin backfill histórico: el
-- punto de partida es el asiento de apertura — ver AperturaSaldosModal).
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT id FROM public.companies LOOP
    BEGIN
      PERFORM public.conta_seed_catalogo(c.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'conta seed backfill company %: %', c.id, SQLERRM;
    END;
  END LOOP;
END $$;
