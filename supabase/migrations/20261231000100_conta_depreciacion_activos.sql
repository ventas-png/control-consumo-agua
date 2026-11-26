-- ════════════════════════════════════════════════════════════════════════════
-- CONTABILIDAD · DEPRECIACIÓN MENSUAL DE ACTIVOS FIJOS
--
-- POR QUÉ
-- Desde la Fase 6 cada recepción con destino «Activo fijo» da de alta el activo
-- con su costo, su vida útil, su valor residual y sus tres cuentas (activo,
-- depreciación acumulada, gasto por depreciación). Pero nadie los depreciaba:
-- el balance mostraba bombas, equipos y vehículos a su costo de compra para
-- siempre, y la depreciación se registraba —si acaso— con pólizas manuales.
--
-- QUÉ HACE
-- public.conta_depreciar_activos(periodo, aplicar, proyecto), con el mismo
-- patrón que la revaluación cambiaria: primero se PREVISUALIZA el cálculo por
-- activo y después, si alguien lo decide, se APLICA. Nada se asienta solo.
--
-- LA REGLA
--   · línea recta: (costo − valor residual) / vida útil en meses, a centavos;
--   · empieza el mes SIGUIENTE al del alta;
--   · el último mes de la vida útil (o cualquiera posterior) lleva el resto,
--     para que la depreciación acumulada sea EXACTAMENTE lo depreciable;
--   · un activo dado de baja no se deprecia;
--   · una póliza por activo y mes (clave: activos_fijos / id / depreciacion_AAAA-MM):
--     repetir el mes no duplica, y la acumulada se LEE de esas pólizas vivas;
--   · si la póliza de un mes se reversa, la acumulada baja y ese mes queda como
--     `reversado`: no se vuelve a asentar (un asiento reversado sigue ocupando
--     su clave) y su importe lo absorbe el último mes de la vida útil;
--   · fecha de la póliza: el último día del mes depreciado.
--
-- CUENTAS: las del activo si siguen siendo de detalle, activas y de su
-- contabilidad; si no, las cuentas especiales «Gasto por depreciación» y
-- «Depreciación acumulada» de esa contabilidad. Sin cuentas el activo sale como
-- `sin_cuentas` y no se asienta (no se elige una cuenta «parecida»).
--
-- NO SE APLICA sobre un mes cerrado ni sobre un ejercicio cerrado: se avisa.
-- (El generador, por su cuenta, fecharía hoy un asiento de mes cerrado; para la
-- depreciación eso movería el gasto de mes sin que nadie lo pidiera.)
--
-- AUTORIZACIÓN: previsualizar pide ver Contabilidad; aplicar pide crear Y
-- cambiar estado (genera y publica pólizas), como los reprocesos.
--
-- CÓMO REVERTIR
--   DROP FUNCTION public.conta_depreciar_activos(text, boolean, uuid);
-- Las pólizas ya generadas se anulan como cualquier otra (reverso).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.conta_depreciar_activos(
  p_periodo    text,
  p_aplicar    boolean DEFAULT false,
  p_project_id uuid DEFAULT NULL
) RETURNS TABLE (
  activo_id uuid, codigo text, nombre text, fecha_alta date,
  costo numeric, valor_residual numeric, vida_util_meses integer,
  acumulada_antes numeric, depreciacion numeric, valor_en_libros numeric,
  meses_previos_sin_depreciar integer, resultado text, motivo text, asiento_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company  uuid := public.get_my_company_id();
  v_ini      date;   -- primer día del mes a depreciar
  v_fin      date;   -- último día del mes a depreciar
  v_evento   text;
  a          record;
  v_inicio   date;   -- primer mes depreciable del activo
  v_n        int;    -- meses transcurridos desde v_inicio (0 = primer mes)
  v_dep      numeric(14,2);
  v_mensual  numeric(14,2);
  v_total    numeric(14,2);
  v_antes    numeric(14,2);
  v_este     numeric(14,2);
  v_previos  int;
  v_monto    numeric(14,2);
  v_gasto    uuid;
  v_acum     uuid;
  v_asiento  uuid;
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
  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.company_id = v_company
  ) THEN
    RAISE EXCEPTION 'El proyecto no pertenece a la empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access_project(p_project_id) THEN
    RAISE EXCEPTION 'No autorizado para este proyecto.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_aplicar, false)
     AND NOT (public.conta_puede_escribir('create') AND public.conta_puede_escribir('change_status')) THEN
    RAISE EXCEPTION 'No autorizado para depreciar: requiere crear y cambiar estado en Contabilidad.' USING ERRCODE = '42501';
  END IF;

  -- ── Qué mes ──────────────────────────────────────────────────────────────
  IF p_periodo IS NULL OR p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'El mes a depreciar va con formato AAAA-MM.' USING ERRCODE = '22023';
  END IF;
  v_ini := to_date(p_periodo || '-01', 'YYYY-MM-DD');
  v_fin := (v_ini + interval '1 month' - interval '1 day')::date;
  IF v_ini > date_trunc('month', CURRENT_DATE)::date THEN
    RAISE EXCEPTION 'No se deprecia un mes futuro.' USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(p_aplicar, false) THEN
    IF public.conta_anio_cerrado(v_company, p_project_id, EXTRACT(YEAR FROM v_ini)::int) THEN
      RAISE EXCEPTION 'El ejercicio % de esta contabilidad está cerrado; no se deprecia sobre un ejercicio cerrado.',
        EXTRACT(YEAR FROM v_ini)::int USING ERRCODE = 'check_violation';
    END IF;
    IF p_project_id IS NOT NULL AND public.conta_periodo_cerrado(p_project_id, p_periodo) THEN
      RAISE EXCEPTION 'El periodo % de este proyecto está cerrado; reábrelo para depreciarlo.', p_periodo
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  v_evento := 'depreciacion_' || p_periodo;

  FOR a IN
    SELECT f.* FROM public.activos_fijos f
     WHERE f.company_id = v_company AND f.project_id IS NOT DISTINCT FROM p_project_id
       AND f.estado <> 'dado_de_baja'
     ORDER BY f.codigo, f.id
  LOOP
    v_inicio := (date_trunc('month', a.fecha_alta) + interval '1 month')::date;
    v_n := (EXTRACT(YEAR FROM v_ini)::int - EXTRACT(YEAR FROM v_inicio)::int) * 12
         + (EXTRACT(MONTH FROM v_ini)::int - EXTRACT(MONTH FROM v_inicio)::int);
    v_dep := a.costo - a.valor_residual;
    v_mensual := round(v_dep / a.vida_util_meses, 2);

    -- Lo ya depreciado se lee de las pólizas VIVAS del activo (no de un contador aparte).
    SELECT COALESCE(sum(x.total_debe), 0),
           COALESCE(sum(x.total_debe) FILTER (WHERE x.origen_evento < v_evento), 0),
           COALESCE(sum(x.total_debe) FILTER (WHERE x.origen_evento = v_evento), 0),
           count(*) FILTER (WHERE x.origen_evento < v_evento)
      INTO v_total, v_antes, v_este, v_previos
      FROM public.conta_asientos x
     WHERE x.company_id = v_company AND x.origen = 'automatico' AND x.origen_tabla = 'activos_fijos'
       AND x.origen_id = a.id AND x.origen_evento ~ '^depreciacion_\d{4}-\d{2}$'
       AND x.estado = 'publicado' AND x.anulado_por_id IS NULL AND x.reversa_de_id IS NULL;

    activo_id := a.id; codigo := a.codigo; nombre := a.nombre; fecha_alta := a.fecha_alta;
    costo := a.costo; valor_residual := a.valor_residual; vida_util_meses := a.vida_util_meses;
    acumulada_antes := v_antes; asiento_id := NULL; motivo := NULL;
    meses_previos_sin_depreciar := GREATEST(0, LEAST(GREATEST(v_n, 0), a.vida_util_meses - 1) - v_previos);

    IF v_n < 0 THEN
      depreciacion := 0; resultado := 'no_iniciado';
      motivo := 'Empieza a depreciarse en ' || to_char(v_inicio, 'YYYY-MM') || ' (el mes siguiente al alta).';
    ELSIF v_este > 0 THEN
      depreciacion := v_este; resultado := 'ya_depreciado';
      SELECT x.id INTO asiento_id FROM public.conta_asientos x
       WHERE x.company_id = v_company AND x.origen_tabla = 'activos_fijos' AND x.origen_id = a.id
         AND x.origen_evento = v_evento AND x.estado = 'publicado' AND x.anulado_por_id IS NULL LIMIT 1;
    ELSIF EXISTS (SELECT 1 FROM public.conta_asientos x
                   WHERE x.company_id = v_company AND x.origen = 'automatico' AND x.origen_tabla = 'activos_fijos'
                     AND x.origen_id = a.id AND x.origen_evento = v_evento AND x.estado <> 'anulado') THEN
      -- La póliza de este mes existió y se reversó. Un asiento reversado sigue ocupando su clave, así que el
      -- mes no se vuelve a asentar: su importe queda sin depreciar y lo absorbe el último mes de la vida útil.
      depreciacion := 0; resultado := 'reversado';
      motivo := 'La póliza de este mes se reversó. Su importe se recupera en el último mes de la vida útil, o antes con una póliza manual.';
    ELSIF v_dep - v_total <= 0 THEN
      depreciacion := 0;
      resultado := CASE WHEN v_dep = 0 THEN 'sin_cambio' ELSE 'totalmente_depreciado' END;
      motivo := CASE WHEN v_dep = 0 THEN 'El costo es igual al valor residual: no hay nada que depreciar.' END;
    ELSE
      -- Último mes de la vida útil (o posterior): lleva el resto, para cerrar exacto.
      v_monto := CASE WHEN v_n >= a.vida_util_meses - 1 THEN v_dep - v_total
                      ELSE LEAST(v_mensual, v_dep - v_total) END;
      depreciacion := v_monto;

      SELECT c.id INTO v_gasto FROM public.conta_cuentas c
       WHERE c.id = a.cuenta_gasto_dep_id AND c.company_id = v_company
         AND c.project_id IS NOT DISTINCT FROM p_project_id AND c.es_detalle AND c.activa;
      IF v_gasto IS NULL THEN
        v_gasto := public.conta_cuenta_especial(v_company, p_project_id, 'gasto_depreciacion');
      END IF;
      SELECT c.id INTO v_acum FROM public.conta_cuentas c
       WHERE c.id = a.cuenta_dep_acum_id AND c.company_id = v_company
         AND c.project_id IS NOT DISTINCT FROM p_project_id AND c.es_detalle AND c.activa;
      IF v_acum IS NULL THEN
        v_acum := public.conta_cuenta_especial(v_company, p_project_id, 'depreciacion_acumulada');
      END IF;

      IF v_monto <= 0 THEN
        resultado := 'sin_cambio';
      ELSIF v_gasto IS NULL OR v_acum IS NULL THEN
        resultado := 'sin_cuentas';
        motivo := 'Falta la cuenta de ' ||
          concat_ws(' y la de ', CASE WHEN v_gasto IS NULL THEN 'Gasto por depreciación' END,
                                 CASE WHEN v_acum IS NULL THEN 'Depreciación acumulada' END) ||
          '. Asígnala en Contabilidad › Configuración › Cuentas especiales.';
      ELSIF NOT COALESCE(p_aplicar, false) THEN
        resultado := 'previsualizacion';
      ELSE
        v_asiento := public.conta_generar_asiento(
          v_company, p_project_id, 'activos_fijos', a.id, v_evento, v_fin,
          'Depreciación ' || p_periodo || ' · ' || a.codigo || ' ' || a.nombre, 'diario', NULL,
          jsonb_build_array(
            jsonb_build_object('cuenta_id', v_gasto, 'debe', v_monto, 'descripcion', 'Gasto por depreciación'),
            jsonb_build_object('cuenta_id', v_acum, 'haber', v_monto, 'descripcion', 'Depreciación acumulada')));
        IF v_asiento IS NULL THEN
          resultado := 'error';
          motivo := 'No se pudo generar la póliza. Revisa las cuentas del activo y vuelve a aplicar.';
        ELSE
          resultado := 'aplicado'; asiento_id := v_asiento;
        END IF;
      END IF;
    END IF;

    valor_en_libros := a.costo - v_antes
      - CASE WHEN resultado IN ('previsualizacion', 'aplicado', 'ya_depreciado') THEN depreciacion ELSE 0 END;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.conta_depreciar_activos(text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_depreciar_activos(text, boolean, uuid) TO authenticated;

COMMENT ON FUNCTION public.conta_depreciar_activos(text, boolean, uuid) IS
  'Depreciación en línea recta de los activos fijos de una contabilidad para un mes: previsualiza (p_aplicar=false) o genera una póliza por activo. Idempotente por activo y mes.';
