-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · BLOQUE B · UNA FACTURA CON ORDEN NO SE APRUEBA SIN RENGLONES
--
-- QUÉ FALTABA
-- El cuadre de 3 vías (`compras_validar_match`) es POR RENGLÓN de factura. Una
-- factura ligada a una orden pero sin renglones devolvía cero filas, es decir,
-- «cero diferencias»: se aprobaba y se devengaba sin comparar nada contra lo
-- ordenado ni lo recibido. Comprobado con una sonda local reversible
-- (factura con orden y 0 renglones → aprobada sin error, con su asiento).
--
-- QUÉ HACE
-- `compras_tg_factura_match` rechaza la aprobación de una factura con orden y
-- sin renglones (COMPRAS_FACTURA_SIN_RENGLONES), salvo la autorización con
-- justificación escrita que ya existe para las diferencias. Es lo mismo que el
-- resto del cuadre: nada se aprueba en silencio.
--
-- NO CAMBIA: facturas sin orden (gasto directo), el cuadre por renglón, las
-- tolerancias ni el devengo. Las facturas ya aprobadas no se tocan (el trigger
-- solo actúa en registrada → aprobada).
--
-- CÓMO REVERTIR
--   Restaurar compras_tg_factura_match() de 20261021000200 (sin el bloque de
--   «sin renglones»). Idempotente: CREATE OR REPLACE.
-- IMPACTO EN DATOS: ninguno.
-- ════════════════════════════════════════════════════════════════════════════

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

  -- Una factura ligada a una orden SIN renglones no tiene nada que cuadrar:
  -- `compras_validar_match` es por renglón y devolvería cero filas, o sea «todo
  -- cuadra». Se exige al menos un renglón (o la autorización escrita de siempre).
  IF NOT EXISTS (SELECT 1 FROM public.factura_proveedor_lineas WHERE factura_id = NEW.id) THEN
    IF NEW.match_forzado_por IS NOT NULL
       AND COALESCE(btrim(NEW.match_justificacion), '') <> '' THEN
      RETURN NEW;  -- se aprueba a conciencia y queda escrito quién y por qué
    END IF;
    RAISE EXCEPTION 'COMPRAS_FACTURA_SIN_RENGLONES: la factura está ligada a la orden pero no tiene renglones, así que no hay contra qué cuadrarla. Captura qué se factura de cada renglón de la orden, o autorízala dejando la justificación.'
      USING ERRCODE = 'check_violation';
  END IF;

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

COMMENT ON FUNCTION public.compras_tg_factura_match() IS
  'Al aprobar una factura: proveedor no suspendido/vetado y cuadre de 3 vías contra la orden, por renglón. Con orden y sin renglones no se aprueba salvo autorización con justificación.';

REVOKE EXECUTE ON FUNCTION public.compras_tg_factura_match() FROM PUBLIC, anon, authenticated;
