\set ON_ERROR_STOP on

-- ============================================================================
-- CADA FUGA, POR NOMBRE — roja sin la migración, cerrada con ella.
--
-- Requiere fos.resultados (matriz.sql corrida en esta base).
--
-- Las filas de abajo son las fugas REALES medidas con la matriz sobre la cadena
-- de migraciones anterior a 20261029000000: funciones en las que una sesión sin
-- perfil (SINAPP) o un cliente sin empresa (CLI) obtenían algo distinto —y más—
-- que un operador de OTRA empresa (OP_C) con los mismos argumentos (los de la
-- empresa D). El criterio de cierre es estricto: después de la migración el
-- resultado de esa sesión es IGUAL al del forastero, letra por letra (la misma
-- denegación, el mismo vacío, el mismo NULL) — no «alguna» denegación.
--
-- En modo continuar (fos.continuar = on) cada fuga abierta se anota en fos.fallos
-- en vez de abortar: así run.sh cuenta que, SIN la migración, están abiertas TODAS.
-- ============================================================================

DROP TABLE IF EXISTS fos.fugas;
CREATE TABLE fos.fugas (firma text NOT NULL, actor text NOT NULL, que text NOT NULL, PRIMARY KEY (firma, actor));
INSERT INTO fos.fugas (firma, actor, que) VALUES
  -- Guardas `IF NOT (public.is_super_admin() …)`: con NULL no lanzaban.
  ('get_superadmin_empresas(text,integer,integer,text,text,text)', 'SINAPP', 'listado de empresas de la plataforma (sólo superadmin)'),
  ('get_superadmin_mrr_trend(integer)',                            'SINAPP', 'MRR de la plataforma'),
  ('get_superadmin_plataforma_kpis()',                             'SINAPP', 'KPIs de la plataforma'),
  ('get_superadmin_trends(integer)',                               'SINAPP', 'tendencias de la plataforma'),
  ('get_superadmin_trial_cohortes(integer)',                       'SINAPP', 'cohortes de prueba de la plataforma'),
  ('superadmin_comisiones_resumen(uuid)',                          'SINAPP', 'comisiones (sólo superadmin)'),
  ('superadmin_timbres_resumen(uuid)',                             'SINAPP', 'timbres (sólo superadmin)'),
  ('export_company_data(uuid)',                                    'SINAPP', 'exporta TODA la empresa D'),
  ('conta_cuentas_en_uso(uuid[])',                                 'SINAPP', 'uso de las cuentas contables de D'),
  ('personal_usuarios_asignables(uuid)',                           'SINAPP', 'personas de D'),
  ('rutas_operadores_asignables(uuid)',                            'SINAPP', 'operadores de D'),
  ('presencia_mi_ficha(uuid)',                                     'SINAPP', 'pasa la guarda de alcance del proyecto de D'),
  ('actividad_equipo(uuid,date,date)',                             'SINAPP', 'actividad del equipo de D'),
  ('conta_cierre_anual(integer)',                                  'SINAPP', 'ESCRITURA: pasa la guarda del cierre anual'),
  ('conta_cierre_anual(integer,uuid)',                             'SINAPP', 'ESCRITURA: pasa la guarda del cierre anual'),
  ('conta_revaluar_fx(date,boolean)',                              'SINAPP', 'ESCRITURA: revaluación cambiaria'),
  ('conta_revaluar_fx(date,boolean,uuid)',                         'SINAPP', 'ESCRITURA: revaluación cambiaria'),
  ('portal_reservar_amenidad(uuid,uuid,date,time without time zone,time without time zone,integer,text,text,boolean)',
                                                                   'SINAPP', 'pasa la guarda de reserva de amenidades de D'),
  ('proveedor_habilitado_en(uuid,uuid)',                           'SINAPP', 'sondea si un proveedor de D está habilitado'),
  -- assert_company_scope(p): `p = get_my_company_id()` es NULL sin empresa.
  ('assert_company_scope(uuid)',                                   'SINAPP', 'el guard de alcance no lanza'),
  ('assert_company_scope(uuid)',                                   'CLI',    'el guard de alcance no lanza'),
  ('get_company_effective_limits(uuid)',                           'SINAPP', 'límites de plan de D'),
  ('get_company_effective_limits(uuid)',                           'CLI',    'límites de plan de D'),
  ('materializar_rutinas_turno(uuid,date,date)',                   'SINAPP', 'ESCRITURA: materializa rutinas en D'),
  ('calcular_horas_personal(uuid,date,date,numeric)',              'SINAPP', 'horas del personal de D'),
  ('presencia_balance_dia(uuid,date,date)',                        'SINAPP', 'balance de asistencia de D'),
  -- Guardas propias `x = get_my_company_id()`: siguen en NULL con los helpers ya
  -- arreglados; se cierran con `public.sesion_api_sin_empresa() OR`.
  ('get_company_usage(uuid)',                                      'SINAPP', 'proyectos y unidades de D'),
  ('get_company_usage(uuid)',                                      'CLI',    'proyectos y unidades de D'),
  ('calculate_monthly_total_cents(uuid)',                          'SINAPP', 'facturación mensual de D'),
  ('calculate_monthly_total_cents(uuid)',                          'CLI',    'facturación mensual de D'),
  ('compras_validar_match(uuid)',                                  'SINAPP', 'renglones de una factura de D'),
  ('compras_validar_match(uuid)',                                  'CLI',    'renglones de una factura de D'),
  ('compras_seguimiento_orden(uuid)',                              'SINAPP', 'seguimiento de una orden de compra de D'),
  ('compras_seguimiento_orden(uuid)',                              'CLI',    'seguimiento de una orden de compra de D'),
  ('conta_publicar_asiento(uuid)',                                 'SINAPP', 'ESCRITURA: pasa la guarda para publicar un asiento de D'),
  ('conta_anular_asiento(uuid,text)',                              'SINAPP', 'ESCRITURA: anula un asiento de D'),
  ('banco_conciliar_movimiento(uuid,text,uuid)',                   'SINAPP', 'ESCRITURA: pasa la guarda para conciliar un movimiento de D'),
  ('banco_desconciliar_movimiento(uuid)',                          'SINAPP', 'ESCRITURA: pasa la guarda para desconciliar un movimiento de D'),
  ('banco_ajuste_conciliacion(uuid,text)',                         'SINAPP', 'ESCRITURA: ajusta un movimiento bancario de D');

DO $$
DECLARE f record; v_fuera text; v_actor text; v_n int := 0;
BEGIN
  FOR f IN SELECT * FROM fos.fugas ORDER BY firma, actor LOOP
    SELECT resultado INTO v_fuera FROM fos.resultados WHERE firma = f.firma AND actor = 'OP_C';
    SELECT resultado INTO v_actor FROM fos.resultados WHERE firma = f.firma AND actor = f.actor;
    IF v_fuera IS NULL OR v_actor IS NULL THEN
      RAISE EXCEPTION 'la matriz no tiene % para % (¿cambió la firma?)', f.firma, f.actor;
    END IF;
    IF v_actor IS DISTINCT FROM v_fuera THEN
      PERFORM fos.falla(format('FUGA %s · %s — %s: recibe «%s» y el forastero «%s»', f.actor, f.firma, f.que, left(v_actor, 70), left(v_fuera, 70)));
    ELSE
      RAISE NOTICE '✓ % · % — misma respuesta que el forastero (%)', f.actor, f.firma, left(v_fuera, 50);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  IF v_n < 39 THEN RAISE EXCEPTION 'la lista de fugas quedó incompleta (% filas)', v_n; END IF;
END $$;
