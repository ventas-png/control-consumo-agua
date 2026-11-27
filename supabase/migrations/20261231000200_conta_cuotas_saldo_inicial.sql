-- ════════════════════════════════════════════════════════════════════════════
-- CONTABILIDAD · SALDOS INICIALES POR RESIDENTE (cuotas pendientes históricas)
--
-- POR QUÉ
-- Al arrancar la contabilidad a media operación, lo que cada residente debía
-- del sistema anterior sólo podía entrar de dos maneras, las dos malas:
--   · como un total en el asiento de apertura: la cuenta por cobrar cuadra,
--     pero nadie debe nada en particular (sin auxiliar, sin estado de cuenta,
--     sin antigüedad, y el cobro no tiene contra qué aplicarse);
--   · creando las cuotas viejas en Condominios: cada una se contabiliza HOY
--     contra INGRESO, y el ingreso de ejercicios anteriores aparece inflando el
--     resultado del mes de arranque.
--
-- QUÉ HACE
-- public.conta_cuotas_saldo_inicial(proyecto, fecha, filas, aplicar, contrapartida)
-- carga CADA cuota pendiente con su periodo y su vencimiento:
--   · crea la cuota en cuotas_condominio (misma tabla, mismo cobro, mismo
--     estado de cuenta y misma antigüedad que cualquier otra cuota);
--   · su póliza de devengo es  Dr Cuenta por cobrar (auxiliar del residente)
--     / Cr CONTRAPARTIDA, con la fecha de saldos iniciales — NO contra ingreso;
--   · la mora que ya traía (opcional) entra igual, contra la contrapartida.
-- La contrapartida es la cuenta especial «Resultados acumulados», o la cuenta
-- de detalle que se indique (p. ej. la propia cuenta por cobrar, si el asiento
-- de apertura ya traía el total y lo que se quiere es repartirlo por residente).
--
-- CÓMO
-- La póliza se genera ANTES que la cuota, con la clave de devengo de siempre
-- (cuotas_condominio / id / cuota_emitida). Al insertar la cuota, el trigger
-- intenta contabilizarla y encuentra la clave ocupada: no asienta contra
-- ingreso. No se redefine ninguna función existente, y todo lo que lee el
-- devengo de una cuota (saldo por cobrar, cobros, reversos al eliminar) sigue
-- funcionando igual porque la clave y el importe son los de siempre.
--
-- La mora automática NO se recalcula sobre lo que ya entró vencido (se sella
-- mora_aplicada_at): la mora histórica es la que se carga, no la que el sistema
-- calcularía hoy sobre deuda de hace años. Una cuota cargada aún por vencer
-- sigue el ciclo normal.
--
-- Primero se PREVISUALIZA (p_aplicar = false: valida cada fila y no escribe).
-- Al aplicar, cada fila es independiente: una rechazada no detiene a las demás.
--
-- AUTORIZACIÓN: previsualizar pide ver Contabilidad; aplicar pide crear Y
-- cambiar estado en Contabilidad (genera y publica pólizas) y crear cuotas en
-- Condominios (crea las cuotas).
--
-- CÓMO REVERTIR
--   DROP FUNCTION public.conta_cuotas_saldo_inicial(uuid, date, jsonb, boolean, uuid);
-- Las cuotas ya cargadas se eliminan como cualquier otra (su póliza se reversa).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.conta_cuotas_saldo_inicial(
  p_project_id              uuid,
  p_fecha                   date,
  p_filas                   jsonb,
  p_aplicar                 boolean DEFAULT false,
  p_contrapartida_cuenta_id uuid DEFAULT NULL
) RETURNS TABLE (
  fila integer, unidad_id uuid, unidad_nombre text,
  responsable_cliente_id uuid, responsable_nombre text,
  periodo text, tipo_cargo text, monto numeric, mora numeric, fecha_vencimiento date,
  resultado text, motivo text, cuota_id uuid, asiento_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
-- Las columnas de salida (unidad_id, periodo, tipo_cargo…) se llaman como columnas de las tablas que se leen:
-- un nombre sin calificar es SIEMPRE la variable; las columnas van calificadas.
#variable_conflict use_variable
DECLARE
  v_company  uuid := public.get_my_company_id();
  v_contra   uuid;
  v_moneda   text;
  v_f        jsonb;
  v_i        int := 0;
  v_vistas   text[] := '{}';
  v_llave    text;
  v_concepto text;
  v_cfg      record;
  v_cfg_mora record;
  v_resp     record;
  v_id       uuid;
  v_asiento  uuid;
  v_as_mora  uuid;
  v_vencida  boolean;
BEGIN
  -- ── Quién ────────────────────────────────────────────────────────────────
  IF v_company IS NULL OR public.sesion_api_sin_empresa() THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_company_scope(
    COALESCE((SELECT pr.company_id FROM public.projects pr WHERE pr.id = p_project_id), v_company));
  IF NOT public.mfa_requirement_met() THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_super_admin()
          OR public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])
          OR public.user_has_permission('platform.contabilidad.view')) THEN
    RAISE EXCEPTION 'No autorizado para ver la contabilidad.' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.company_id = v_company
  ) THEN
    RAISE EXCEPTION 'Los saldos iniciales por residente se cargan en la contabilidad de un proyecto de la empresa activa.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access_project(p_project_id) THEN
    RAISE EXCEPTION 'No autorizado para este proyecto.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_aplicar, false) AND NOT (
       public.conta_puede_escribir('create') AND public.conta_puede_escribir('change_status')
       AND (public.is_super_admin() OR public.condominios_puede_actuar('cuotas', 'create'))) THEN
    RAISE EXCEPTION 'No autorizado para cargar saldos iniciales: requiere crear y cambiar estado en Contabilidad y crear cuotas en Condominios.'
      USING ERRCODE = '42501';
  END IF;

  -- ── Con qué fecha y contra qué cuenta ────────────────────────────────────
  IF p_fecha IS NULL OR p_fecha > CURRENT_DATE THEN
    RAISE EXCEPTION 'La fecha de saldos iniciales es obligatoria y no puede ser futura.' USING ERRCODE = 'check_violation';
  END IF;
  IF public.conta_anio_cerrado(v_company, p_project_id, EXTRACT(YEAR FROM p_fecha)::int) THEN
    RAISE EXCEPTION 'El ejercicio % de esta contabilidad está cerrado; elige una fecha de un ejercicio abierto.',
      EXTRACT(YEAR FROM p_fecha)::int USING ERRCODE = 'check_violation';
  END IF;
  IF public.conta_periodo_cerrado(p_project_id, to_char(p_fecha, 'YYYY-MM')) THEN
    RAISE EXCEPTION 'El periodo % de este proyecto está cerrado; reábrelo o elige otra fecha.', to_char(p_fecha, 'YYYY-MM')
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_filas IS NULL OR jsonb_typeof(p_filas) <> 'array' OR jsonb_array_length(p_filas) = 0 THEN
    RAISE EXCEPTION 'No hay cuotas que cargar.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_filas) > 2000 THEN
    RAISE EXCEPTION 'Demasiadas filas en una sola carga (máximo 2000): divídela.' USING ERRCODE = '22023';
  END IF;

  IF p_contrapartida_cuenta_id IS NOT NULL THEN
    SELECT c.id INTO v_contra FROM public.conta_cuentas c
     WHERE c.id = p_contrapartida_cuenta_id AND c.company_id = v_company
       AND c.project_id IS NOT DISTINCT FROM p_project_id AND c.es_detalle AND c.activa;
    IF v_contra IS NULL THEN
      RAISE EXCEPTION 'La cuenta de contrapartida tiene que ser de esta contabilidad, de detalle y activa.'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    v_contra := public.conta_cuenta_especial(v_company, p_project_id, 'resultados_acumulados');
    IF v_contra IS NULL THEN
      RAISE EXCEPTION 'Esta contabilidad no tiene asignada la cuenta «Resultados acumulados». Asígnala en Configuración › Cuentas especiales o elige la cuenta de contrapartida.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT COALESCE(pr.moneda_condominios, pr.moneda) INTO v_moneda
    FROM public.projects pr WHERE pr.id = p_project_id;

  -- ── Fila por fila ────────────────────────────────────────────────────────
  FOR v_f IN SELECT * FROM jsonb_array_elements(p_filas) LOOP
    v_i := v_i + 1;
    fila := v_i; resultado := NULL; motivo := NULL; cuota_id := NULL; asiento_id := NULL;
    unidad_id := NULL; unidad_nombre := NULL; responsable_cliente_id := NULL; responsable_nombre := NULL;
    periodo := NULLIF(btrim(v_f ->> 'periodo'), '');
    tipo_cargo := COALESCE(NULLIF(btrim(v_f ->> 'tipo_cargo'), ''), 'mantenimiento');
    monto := NULL; mora := 0; fecha_vencimiento := NULL;

    BEGIN
      -- Lo que viene mal escrito se rechaza con su motivo; no tumba la carga.
      BEGIN
        unidad_id := NULLIF(v_f ->> 'unidad_id', '')::uuid;
        monto := round(NULLIF(v_f ->> 'monto', '')::numeric, 2);
        mora := round(COALESCE(NULLIF(v_f ->> 'mora', '')::numeric, 0), 2);
        fecha_vencimiento := NULLIF(v_f ->> 'fecha_vencimiento', '')::date;
      EXCEPTION WHEN OTHERS THEN
        resultado := 'rechazada';
        motivo := 'La unidad, el monto, la mora o el vencimiento no se pueden leer.';
      END;

      IF resultado IS NULL THEN
        SELECT u.nombre INTO unidad_nombre FROM public.unidades u
         WHERE u.id = unidad_id AND u.company_id = v_company AND u.project_id = p_project_id;
        v_concepto := CASE tipo_cargo WHEN 'mantenimiento' THEN 'mantenimiento'
                                      WHEN 'cuota_extraordinaria' THEN 'extraordinaria' END;
        v_llave := unidad_id::text || '|' || COALESCE(periodo, '') || '|' || COALESCE(v_concepto, '');

        IF unidad_nombre IS NULL THEN
          resultado := 'rechazada'; motivo := 'La unidad no existe en este proyecto.';
        ELSIF v_concepto IS NULL THEN
          resultado := 'rechazada'; motivo := 'El tipo de cargo debe ser «mantenimiento» o «cuota_extraordinaria».';
        ELSIF periodo IS NULL OR periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
          resultado := 'rechazada'; motivo := 'El periodo va con formato AAAA-MM.';
        ELSIF periodo > to_char(p_fecha, 'YYYY-MM') THEN
          resultado := 'rechazada';
          motivo := 'El periodo es posterior a la fecha de saldos iniciales: esa cuota se emite por el proceso normal.';
        ELSIF monto IS NULL OR monto <= 0 THEN
          resultado := 'rechazada'; motivo := 'El monto pendiente debe ser mayor que cero.';
        ELSIF mora < 0 THEN
          resultado := 'rechazada'; motivo := 'La mora no puede ser negativa.';
        ELSIF v_llave = ANY (v_vistas) THEN
          resultado := 'rechazada'; motivo := 'Repetida en esta carga: misma unidad, periodo y tipo.';
        ELSIF EXISTS (SELECT 1 FROM public.cuotas_condominio c
                       WHERE c.unidad_id = unidad_id AND c.periodo = periodo AND c.concepto = v_concepto
                         AND c.deleted_at IS NULL) THEN
          resultado := 'ya_existe';
          motivo := 'Esa unidad ya tiene una cuota de ese tipo en ese periodo.';
          SELECT c.id INTO cuota_id FROM public.cuotas_condominio c
           WHERE c.unidad_id = unidad_id AND c.periodo = periodo AND c.concepto = v_concepto
             AND c.deleted_at IS NULL LIMIT 1;
        END IF;
      END IF;

      IF resultado IS NULL THEN
        v_vistas := v_vistas || v_llave;
        fecha_vencimiento := COALESCE(
          fecha_vencimiento,
          (to_date(periodo || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date);

        -- Cuenta por cobrar: la del tipo de cargo, con las mismas exigencias del devengo normal.
        SELECT cfg.cuenta_cxc_id INTO v_cfg
          FROM public.conta_config_tipo_cargo cfg
          JOIN public.conta_cuentas c ON c.id = cfg.cuenta_cxc_id
         WHERE cfg.company_id = v_company AND cfg.project_id = p_project_id AND cfg.tipo_cargo = tipo_cargo
           AND cfg.activa AND c.company_id = v_company AND c.project_id = p_project_id
           AND c.es_detalle AND c.activa AND c.tipo = 'activo'
           AND EXISTS (SELECT 1 FROM public.conta_cuentas i
                        WHERE i.id = cfg.cuenta_ingreso_id AND i.company_id = v_company
                          AND i.project_id = p_project_id AND i.es_detalle AND i.activa AND i.tipo = 'ingreso');
        IF NOT FOUND THEN
          resultado := 'rechazada';
          motivo := 'Falta o no sirve la configuración contable de ese tipo de cargo. Revísala en Contabilidad › Tipos de cargo.';
        END IF;
      END IF;

      IF resultado IS NULL AND mora > 0 THEN
        SELECT cfg.cuenta_cxc_id INTO v_cfg_mora
          FROM public.conta_config_tipo_cargo cfg
          JOIN public.conta_cuentas c ON c.id = cfg.cuenta_cxc_id
         WHERE cfg.company_id = v_company AND cfg.project_id = p_project_id AND cfg.tipo_cargo = 'recargo_mora'
           AND cfg.activa AND c.company_id = v_company AND c.project_id = p_project_id
           AND c.es_detalle AND c.activa AND c.tipo = 'activo'
           AND EXISTS (SELECT 1 FROM public.conta_cuentas i
                        WHERE i.id = cfg.cuenta_ingreso_id AND i.company_id = v_company
                          AND i.project_id = p_project_id AND i.es_detalle AND i.activa AND i.tipo = 'ingreso');
        IF NOT FOUND THEN
          resultado := 'rechazada';
          motivo := 'La fila trae mora y falta la configuración contable de «Recargo por mora» en Contabilidad › Tipos de cargo.';
        END IF;
      END IF;

      IF resultado IS NULL THEN
        SELECT r.cliente_id, r.origen INTO v_resp FROM public.responsable_resolver_de_unidad(unidad_id, NULL) r;
        responsable_cliente_id := v_resp.cliente_id;
        IF responsable_cliente_id IS NULL THEN
          resultado := 'rechazada';
          motivo := 'La unidad no tiene un responsable de pago único. Asígnalo en Condominios y vuelve a cargar.';
        ELSE
          SELECT cl.nombre INTO responsable_nombre FROM public.clientes cl WHERE cl.id = responsable_cliente_id;
        END IF;
      END IF;

      IF resultado IS NULL AND NOT COALESCE(p_aplicar, false) THEN
        resultado := 'previsualizacion';
      ELSIF resultado IS NULL THEN
        v_id := gen_random_uuid();
        v_vencida := fecha_vencimiento < CURRENT_DATE;

        -- 1) La póliza de devengo, ANTES que la cuota y con su clave: contra la contrapartida, no contra ingreso.
        v_asiento := public.conta_generar_asiento(
          v_company, p_project_id, 'cuotas_condominio', v_id, 'cuota_emitida', p_fecha,
          'Saldo inicial — cuota ' || v_concepto || ' ' || periodo || ' · ' || unidad_nombre, 'diario', v_moneda,
          jsonb_build_array(
            jsonb_build_object('cuenta_id', v_cfg.cuenta_cxc_id, 'debe', monto, 'descripcion', 'Saldo inicial por cobrar',
                               'auxiliar_cliente_id', responsable_cliente_id, 'unidad_id', unidad_id, 'tipo_cargo', tipo_cargo),
            jsonb_build_object('cuenta_id', v_contra, 'haber', monto, 'descripcion', 'Saldo inicial por cobrar')));
        IF v_asiento IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.conta_asientos a WHERE a.id = v_asiento AND a.estado = 'publicado') THEN
          RAISE EXCEPTION 'No se pudo publicar la póliza del saldo inicial (revisa el tipo de cambio del mes y las cuentas).';
        END IF;

        IF mora > 0 THEN
          v_as_mora := public.conta_generar_asiento(
            v_company, p_project_id, 'cuotas_condominio', v_id, 'cuota_mora', p_fecha,
            'Saldo inicial — mora de la cuota ' || v_concepto || ' ' || periodo || ' · ' || unidad_nombre, 'diario', v_moneda,
            jsonb_build_array(
              jsonb_build_object('cuenta_id', v_cfg_mora.cuenta_cxc_id, 'debe', mora, 'descripcion', 'Saldo inicial de mora',
                                 'auxiliar_cliente_id', responsable_cliente_id, 'unidad_id', unidad_id, 'tipo_cargo', 'recargo_mora'),
              jsonb_build_object('cuenta_id', v_contra, 'haber', mora, 'descripcion', 'Saldo inicial de mora')));
          IF v_as_mora IS NULL OR NOT EXISTS (
               SELECT 1 FROM public.conta_asientos a WHERE a.id = v_as_mora AND a.estado = 'publicado') THEN
            RAISE EXCEPTION 'No se pudo publicar la póliza de la mora inicial (revisa el tipo de cambio del mes y las cuentas).';
          END IF;
        END IF;

        -- 2) La cuota. Su trigger de devengo encuentra la clave ocupada y no asienta contra ingreso.
        INSERT INTO public.cuotas_condominio (
          id, company_id, project_id, unidad_id, concepto, monto, periodo, fecha_vencimiento,
          estado, cuota_estado, emitida_at, vencida_at, tipo_cargo, responsable_cliente_id,
          mora_monto, mora_aplicada_at, total_a_pagar, notas, created_by
        ) VALUES (
          v_id, v_company, p_project_id, unidad_id, v_concepto, monto, periodo, fecha_vencimiento,
          'pendiente', CASE WHEN v_vencida THEN 'vencida' ELSE 'emitida' END, now(),
          CASE WHEN v_vencida THEN now() END, tipo_cargo, responsable_cliente_id,
          CASE WHEN mora > 0 THEN mora END,
          -- Lo que entra vencido no recibe mora automática: la mora histórica es la que se carga.
          CASE WHEN v_vencida OR mora > 0 THEN now() END,
          monto + mora,
          COALESCE(NULLIF(btrim(v_f ->> 'notas'), ''),
                   'Saldo inicial al ' || to_char(p_fecha, 'DD/MM/YYYY') || ' (pendiente del sistema anterior).'),
          auth.uid()
        );

        resultado := 'cargada'; cuota_id := v_id; asiento_id := v_asiento;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- La fila se deshace entera (póliza y cuota) y se reporta; las demás siguen.
      resultado := 'error'; motivo := SQLERRM; cuota_id := NULL; asiento_id := NULL;
    END;

    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.conta_cuotas_saldo_inicial(uuid, date, jsonb, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_cuotas_saldo_inicial(uuid, date, jsonb, boolean, uuid) TO authenticated;

COMMENT ON FUNCTION public.conta_cuotas_saldo_inicial(uuid, date, jsonb, boolean, uuid) IS
  'Saldos iniciales por residente: carga cada cuota pendiente histórica (periodo, vencimiento, mora) con su póliza contra la contrapartida de apertura, no contra ingreso. Previsualiza (p_aplicar=false) o aplica fila por fila.';
