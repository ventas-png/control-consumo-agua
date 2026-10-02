-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · BLOQUE B · CUADRE DE LA FACTURA: IMPUESTOS, MONEDA Y CONCURRENCIA
--
-- QUÉ FALTABA
-- `compras_validar_match` compara cantidad y PRECIO. No decía nada del IVA ni de
-- la moneda: una factura en dólares contra una orden en quetzales, o con un IVA
-- distinto al pedido, «cuadraba» si el precio unitario numérico coincidía. Y dos
-- facturas aprobadas a la vez sobre el mismo saldo por facturar leían
-- `cantidad_facturada` sin bloqueo: las dos pasaban el cuadre.
--
-- QUÉ HACE
--   · `compras_validar_match` suma por renglón IVA de la orden (prorrateado por
--     la cantidad facturada) vs IVA de la factura, y moneda de la orden vs de la
--     factura. Una diferencia de MONEDA no cuadra nunca; una de IVA cuadra solo
--     dentro de la tolerancia de PRECIO ya configurada (`compras_config`, con
--     piso de 0.01 por redondeo). Fuera de tolerancia rige el mecanismo
--     existente: no se aprueba salvo autorización con justificación por escrito.
--     Nada se corrige ni se aprueba en silencio.
--   · La aprobación bloquea las líneas de la orden (FOR UPDATE, por id) antes de
--     cuadrar: dos aprobaciones simultáneas se serializan y la segunda ve lo que
--     la primera facturó.
--
-- NO CAMBIA: el devengo, la ruta GR/IR, las tolerancias ni las facturas sin
-- orden. Duplicados: ya los impide `uq_facturas_prov_numero` (empresa +
-- proveedor + número, sin contar anuladas).
--
-- CÓMO REVERTIR
--   Restaurar compras_validar_match() y compras_tg_factura_match() de
--   20260821000300 (el tipo de retorno de la primera vuelve a tener 12 columnas).
-- IMPACTO EN DATOS: ninguno.
-- ════════════════════════════════════════════════════════════════════════════

-- El tipo de retorno cambia (columnas nuevas): CREATE OR REPLACE no basta.
DROP FUNCTION IF EXISTS public.compras_validar_match(uuid);

CREATE FUNCTION public.compras_validar_match(p_factura_id uuid)
RETURNS TABLE (
  linea               int,
  descripcion         text,
  cantidad_ordenada   numeric,
  cantidad_recibida   numeric,
  cantidad_facturada  numeric,
  cantidad_factura    numeric,
  precio_orden        numeric,
  precio_factura      numeric,
  diferencia_precio   numeric,
  diferencia_pct      numeric,
  iva_orden           numeric,
  iva_factura         numeric,
  diferencia_iva      numeric,
  moneda_orden        text,
  moneda_factura      text,
  dentro_tolerancia   boolean,
  motivo              text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
  v_project uuid;
  v_orden   uuid;
  v_tol_p   numeric;
  v_tol_c   numeric;
  v_estado  text;
  v_mon_f   text;
  v_mon_o   text;
  v_ya_sumada boolean;
BEGIN
  SELECT f.company_id, f.project_id, f.estado, f.orden_compra_id, f.moneda
    INTO v_company, v_project, v_estado, v_orden, v_mon_f
  FROM public.facturas_proveedor f WHERE f.id = p_factura_id;
  IF v_company IS NULL THEN RETURN; END IF;
  v_ya_sumada := v_estado IN ('aprobada','pagada_parcial','pagada');

  IF NOT (public.is_super_admin() OR v_company = public.get_my_company_id()) THEN
    RETURN;
  END IF;

  v_tol_p := public.compras_tolerancia(v_company, 'precio');
  v_tol_c := public.compras_tolerancia(v_company, 'cantidad');
  v_mon_f := COALESCE(v_mon_f, public.conta_moneda_base(v_company, v_project));
  SELECT COALESCE(o.moneda, public.conta_moneda_base(o.company_id, o.project_id)) INTO v_mon_o
    FROM public.ordenes_compra o WHERE o.id = v_orden;

  RETURN QUERY
  WITH base AS (
    SELECT
      fl.linea       AS f_linea,
      fl.descripcion AS f_desc,
      fl.cantidad    AS f_cant,
      fl.precio_unitario AS f_precio,
      fl.iva_monto   AS f_iva,
      ocl.id         AS ocl_id,
      ocl.cantidad   AS o_cant,
      ocl.cantidad_recibida AS o_recib,
      ocl.precio_unitario   AS o_precio,
      CASE WHEN ocl.cantidad > 0 THEN round(ocl.iva_monto * fl.cantidad / ocl.cantidad, 2) END AS o_iva,
      GREATEST(0, ocl.cantidad_facturada
                  - CASE WHEN v_ya_sumada THEN fl.cantidad ELSE 0 END) AS o_fact_otras
    FROM public.factura_proveedor_lineas fl
    LEFT JOIN public.orden_compra_lineas ocl ON ocl.id = fl.orden_compra_linea_id
    WHERE fl.factura_id = p_factura_id
  ), ev AS (
    SELECT b.*,
           (v_mon_f IS NOT DISTINCT FROM v_mon_o)                                   AS misma_moneda,
           (b.o_iva IS NOT NULL
            AND abs(b.f_iva - b.o_iva) <= GREATEST(0.01, b.o_iva * v_tol_p / 100))  AS iva_ok
    FROM base b
  )
  SELECT
    e.f_linea, e.f_desc, e.o_cant, e.o_recib, e.o_fact_otras, e.f_cant,
    e.o_precio, e.f_precio,
    round(e.f_precio - e.o_precio, 4),
    CASE WHEN e.o_precio > 0
         THEN round((e.f_precio - e.o_precio) / e.o_precio * 100, 2) ELSE NULL END,
    e.o_iva, e.f_iva,
    CASE WHEN e.o_iva IS NOT NULL THEN round(e.f_iva - e.o_iva, 2) END,
    v_mon_o, v_mon_f,
    (   e.ocl_id IS NOT NULL
     AND e.misma_moneda
     AND e.iva_ok
     AND e.o_precio > 0
     AND abs(e.f_precio - e.o_precio) <= e.o_precio * v_tol_p / 100
     AND e.f_cant <= e.o_recib - e.o_fact_otras + 1e-6
     AND e.o_fact_otras + e.f_cant <= e.o_cant * (1 + v_tol_c / 100) + 1e-6),
    CASE
      WHEN e.ocl_id IS NULL THEN 'Renglón sin línea de orden: no hay contra qué cuadrar.'
      WHEN NOT e.misma_moneda
        THEN format('Moneda distinta: la orden es en %s y la factura en %s.', v_mon_o, v_mon_f)
      WHEN e.o_precio > 0
       AND abs(e.f_precio - e.o_precio) > e.o_precio * v_tol_p / 100
        THEN 'Precio fuera de tolerancia.'
      WHEN NOT e.iva_ok
        THEN format('IVA distinto al pedido: orden %s, factura %s.', e.o_iva, e.f_iva)
      WHEN e.f_cant > e.o_recib - e.o_fact_otras + 1e-6
        THEN 'Se factura más de lo recibido y aún no facturado.'
      WHEN e.o_fact_otras + e.f_cant > e.o_cant * (1 + v_tol_c / 100) + 1e-6
        THEN 'Se factura más de lo ordenado.'
      ELSE 'Cuadra.'
    END
  FROM ev e
  ORDER BY e.f_linea;
END;
$$;

COMMENT ON FUNCTION public.compras_validar_match(uuid) IS
  'Cuadre de 3 vías por renglón: ordenado vs recibido vs facturado; precio, IVA (prorrateado) y moneda de la orden vs la factura, con la tolerancia de compras_config. La moneda distinta nunca cuadra.';

GRANT EXECUTE ON FUNCTION public.compras_validar_match(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.compras_validar_match(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.compras_tg_factura_match()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prov  record;
  v_malas int;
  v_det   text;
BEGIN
  IF NOT (NEW.estado = 'aprobada' AND OLD.estado = 'registrada') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  -- Un proveedor suspendido o vetado no recibe aprobaciones nuevas, tenga o no
  -- orden de compra: es la misma decisión de negocio que apagó su autorización.
  -- Un proveedor en 'borrador'/'en_revision' SÍ pasa: son los gastos directos
  -- de siempre, que esta fase no viene a bloquear.
  SELECT nombre, estado INTO v_prov FROM public.proveedores WHERE id = NEW.proveedor_id;
  IF v_prov.estado IN ('suspendido','vetado') THEN
    RAISE EXCEPTION 'COMPRAS_PROVEEDOR_NO_AUTORIZADO: "%" está %; no se aprueban facturas suyas.',
      v_prov.nombre, v_prov.estado USING ERRCODE = 'check_violation';
  END IF;

  -- Sin orden de compra no hay cuadre que exigir (gasto directo, caja chica).
  IF NEW.orden_compra_id IS NULL THEN RETURN NEW; END IF;

  -- SERIALIZA las aprobaciones contra la misma orden: dos facturas que cubren
  -- el mismo saldo por facturar leían `cantidad_facturada` sin bloqueo y las
  -- dos cuadraban. El orden por id evita interbloqueos entre ellas.
  PERFORM 1 FROM public.orden_compra_lineas
   WHERE orden_compra_id = NEW.orden_compra_id
   ORDER BY id
   FOR UPDATE;

  SELECT COUNT(*), string_agg(format('· %s: %s', descripcion, motivo), E'\n')
    INTO v_malas, v_det
  FROM public.compras_validar_match(NEW.id)
  WHERE NOT dentro_tolerancia;

  IF v_malas > 0 THEN
    IF NEW.match_forzado_por IS NOT NULL
       AND COALESCE(btrim(NEW.match_justificacion), '') <> '' THEN
      RETURN NEW;  -- se aprueba a conciencia y queda escrito quién y por qué
    END IF;
    RAISE EXCEPTION E'COMPRAS_MATCH_FUERA_DE_TOLERANCIA: % renglón(es) no cuadran con la orden:\n%\nCorrige la factura o autorízala dejando la justificación.',
      v_malas, v_det USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_tg_factura_match() FROM PUBLIC, anon, authenticated;
