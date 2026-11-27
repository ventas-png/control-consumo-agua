-- ════════════════════════════════════════════════════════════════════════════
-- CONTABILIDAD · ANTIGÜEDAD DE SALDOS POR COBRAR, DESDE LOS LIBROS
--
-- POR QUÉ
-- El único reporte de morosidad vivía en Condominios y se calculaba en el
-- navegador con el importe COMPLETO de cada cuota pendiente: no descontaba
-- abonos parciales, rebajas ni saldos a favor aplicados, no incluía cargos
-- adicionales ni mora, y no tenía por qué coincidir con la cuenta por cobrar
-- de la balanza. Contabilidad tenía antigüedad de lo que DEBE (CxP) pero no de
-- lo que le deben.
--
-- QUÉ HACE
-- public.conta_cxc_antiguedad(proyecto, corte) reparte por antigüedad el saldo
-- CONTABLE de cada auxiliar (cliente) y unidad, tomado de las mismas líneas
-- publicadas que usa el estado de cuenta (conta_ec_lineas): por construcción,
-- la suma de sus filas ES el saldo del auxiliar en libros al corte.
--
-- CÓMO REPARTE (PEPS / FIFO)
--   · «cargos» = el debe de los devengos (cuota, mora de cuota, cargo adicional),
--     fechados por su vencimiento —el de la cuota o el cargo— o, si no tiene, por
--     la fecha de la póliza;
--   · «abonos» = todo lo demás, neto: cobros, saldos a favor aplicados, notas de
--     crédito y reversos (haber − debe de lo que no es devengo);
--   · los abonos se aplican a los cargos del más antiguo al más reciente; lo que
--     queda de cada cargo cae en su tramo según los días de vencido al corte.
-- El reparto es una convención (la habitual): no dice a QUÉ documento se aplicó
-- cada cobro —eso lo dice el estado de cuenta—, dice qué tan viejo es lo que
-- sigue debiéndose. Lo que no se puede atribuir a un cargo (más abonos que
-- cargos, o un débito que no es devengo) va en `sin_asignar`, a la vista.
--
-- AUTORIZACIÓN: la del estado de cuenta (empresa de la sesión, permiso de ver
-- Contabilidad, proyecto de la empresa y al alcance de la persona).
--
-- CÓMO REVERTIR
--   DROP FUNCTION public.conta_cxc_antiguedad(uuid, date);
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.conta_cxc_antiguedad(p_project_id uuid, p_corte date DEFAULT NULL)
RETURNS TABLE (
  cliente_id uuid, cliente_nombre text, codigo_auxiliar text,
  unidad_id uuid, unidad_nombre text,
  por_vencer numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, d90_mas numeric,
  sin_asignar numeric, total numeric, vencimiento_mas_antiguo date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_corte   date := COALESCE(p_corte, CURRENT_DATE);
BEGIN
  IF v_company IS NULL OR public.sesion_api_sin_empresa() THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_company_scope(
    COALESCE((SELECT pr.company_id FROM public.projects pr WHERE pr.id = p_project_id), v_company));
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

  RETURN QUERY
  WITH lineas AS (
    SELECT l.linea_id, l.fecha, l.auxiliar_cliente_id AS cli, l.unidad_id AS uni, l.debe, l.haber,
           -- Devengo: lo que hace nacer la deuda. Un reverso NO es un devengo (es un abono).
           (l.origen = 'automatico' AND l.reversa_de_id IS NULL AND l.debe > 0
            AND l.origen_tabla IN ('cuotas_condominio', 'cargos_adicionales_unidad')
            AND l.origen_evento IN ('cuota_emitida', 'cuota_mora', 'cargo_adicional_emitido')) AS es_cargo,
           l.origen_tabla, l.origen_id
      FROM public.conta_ec_lineas(v_company, p_project_id, NULL, NULL) l
     WHERE l.fecha <= v_corte
  ),
  cargos AS (
    SELECT l.cli, l.uni, l.linea_id, l.debe AS monto,
           COALESCE(cu.fecha_vencimiento, ca.fecha_vencimiento, l.fecha) AS vence
      FROM lineas l
      LEFT JOIN public.cuotas_condominio cu
             ON l.origen_tabla = 'cuotas_condominio' AND cu.id = l.origen_id
      LEFT JOIN public.cargos_adicionales_unidad ca
             ON l.origen_tabla = 'cargos_adicionales_unidad' AND ca.id = l.origen_id
     WHERE l.es_cargo
  ),
  abonos AS (
    SELECT l.cli, l.uni, sum(l.haber - l.debe) AS neto
      FROM lineas l
     WHERE NOT l.es_cargo
     GROUP BY l.cli, l.uni
  ),
  saldos AS (
    SELECT l.cli, l.uni, sum(l.debe - l.haber) AS saldo
      FROM lineas l
     GROUP BY l.cli, l.uni
  ),
  peps AS (
    SELECT c.cli, c.uni, c.vence,
           -- Lo que queda de este cargo tras aplicar los abonos a los más antiguos primero.
           GREATEST(0, LEAST(c.monto,
             sum(c.monto) OVER (PARTITION BY c.cli, c.uni ORDER BY c.vence, c.linea_id)
               - GREATEST(COALESCE(a.neto, 0), 0))) AS pendiente
      FROM cargos c
      LEFT JOIN abonos a ON a.cli IS NOT DISTINCT FROM c.cli AND a.uni IS NOT DISTINCT FROM c.uni
  ),
  tramos AS (
    SELECT p.cli, p.uni,
           sum(p.pendiente) FILTER (WHERE v_corte - p.vence <= 0)              AS por_vencer,
           sum(p.pendiente) FILTER (WHERE v_corte - p.vence BETWEEN 1 AND 30)  AS d1_30,
           sum(p.pendiente) FILTER (WHERE v_corte - p.vence BETWEEN 31 AND 60) AS d31_60,
           sum(p.pendiente) FILTER (WHERE v_corte - p.vence BETWEEN 61 AND 90) AS d61_90,
           sum(p.pendiente) FILTER (WHERE v_corte - p.vence > 90)              AS d90_mas,
           min(p.vence) FILTER (WHERE p.pendiente > 0)                         AS mas_antiguo
      FROM peps p
     GROUP BY p.cli, p.uni
  )
  SELECT s.cli, cl.nombre, ax.codigo, s.uni, u.nombre,
         round(COALESCE(t.por_vencer, 0), 2), round(COALESCE(t.d1_30, 0), 2), round(COALESCE(t.d31_60, 0), 2),
         round(COALESCE(t.d61_90, 0), 2), round(COALESCE(t.d90_mas, 0), 2),
         round(s.saldo - COALESCE(t.por_vencer, 0) - COALESCE(t.d1_30, 0) - COALESCE(t.d31_60, 0)
                       - COALESCE(t.d61_90, 0) - COALESCE(t.d90_mas, 0), 2),
         round(s.saldo, 2), t.mas_antiguo
    FROM saldos s
    LEFT JOIN tramos t ON t.cli IS NOT DISTINCT FROM s.cli AND t.uni IS NOT DISTINCT FROM s.uni
    LEFT JOIN public.clientes cl ON cl.id = s.cli
    LEFT JOIN public.conta_auxiliares ax ON ax.company_id = v_company AND ax.cliente_id = s.cli
    LEFT JOIN public.unidades u ON u.id = s.uni
   WHERE s.saldo <> 0
   ORDER BY COALESCE(t.d90_mas, 0) DESC, COALESCE(t.d61_90, 0) DESC, s.saldo DESC, cl.nombre, u.nombre;
END;
$$;

REVOKE ALL ON FUNCTION public.conta_cxc_antiguedad(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_cxc_antiguedad(uuid, date) TO authenticated;

COMMENT ON FUNCTION public.conta_cxc_antiguedad(uuid, date) IS
  'Antigüedad de saldos por cobrar por auxiliar y unidad, desde las líneas publicadas de la CxC (PEPS). La suma de cada fila es su saldo contable al corte.';
