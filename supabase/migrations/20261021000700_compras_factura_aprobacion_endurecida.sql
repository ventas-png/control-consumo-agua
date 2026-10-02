-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · BLOQUE B · APROBACIÓN DE FACTURAS: SIN CUADRE NO HAY APROBACIÓN, Y
-- LA EXCEPCIÓN LA FIRMA EL SERVIDOR Y SOLO CUBRE LO QUE NO ROMPE LA CONTABILIDAD
--
-- QUÉ FALTABA (tres hallazgos de la validación de interfaz del Bloque B)
--
-- 1. Una factura LIGADA A UNA ORDEN pero SIN RENGLONES se aprobaba sin cuadrar
--    nada: `compras_validar_match` es por renglón y devolvía cero filas, es decir,
--    «cero diferencias». Además se contabilizaba como gasto directo: la cuenta
--    puente «por facturar» (2105) que la recepción ya había acreditado no se
--    liquidaba nunca y el gasto se reconocía dos veces.
--
-- 2. El AUTORIZADOR lo declaraba el cliente. `match_forzado_por` (y
--    `aprobada_por`) viajaban en el UPDATE y el servidor no comprobaba que fueran
--    quien ejecuta: cualquiera con permiso de aprobar podía dejar firmada la
--    excepción a nombre de otra persona.
--
-- 3. La justificación escrita admitía CUALQUIER diferencia. Medido en una base
--    real: una factura forzada ANTES de recibir se aprueba y, al registrarse
--    después la conformidad, 2105 queda con 300.00 acreedores PARA SIEMPRE aunque
--    el renglón figure recibido 1/1 y facturado 1/1 (la factura se contabilizó
--    como gasto directo porque aún no había nada recibido que liquidar, y la
--    recepción lo volvió a reconocer).
--
-- QUÉ HACE `compras_tg_factura_match` (solo en la transición registrada → aprobada)
--   · SELLA al actor: `aprobada_por` y `aprobada_at` salen de `auth.uid()` y
--     `now()`, no del cliente. Lo que el cliente mande en esos campos se ignora.
--   · Factura SIN orden (gasto directo): no hay cuadre; se limpian los campos de
--     excepción (no puede haber diferencias que justificar).
--   · Factura CON orden y SIN renglones: COMPRAS_FACTURA_SIN_RENGLONES. Nunca se
--     aprueba, ni con justificación: no hay contra qué cuadrarla ni cómo liquidar
--     lo recibido.
--   · Diferencias NO AUTORIZABLES (COMPRAS_MATCH_NO_FORZABLE), ni con
--     justificación: renglón sin renglón de orden, moneda distinta a la de la
--     orden, facturar más de lo recibido y aún no facturado (se factura antes de
--     recibir) o más de lo ordenado. Dejarían la cuenta puente, las cantidades o
--     el seguimiento descuadrados sin remedio. La factura queda registrada (el
--     documento no se pierde) y se aprueba cuando la recepción exista.
--   · Diferencias AUTORIZABLES (precio o IVA fuera de tolerancia): se aprueban con
--     justificación escrita (mínimo 5 caracteres) y SOLO si quien ejecuta tiene
--     sesión. `match_forzado_por` lo escribe el servidor con `auth.uid()`.
--   · Si la factura cuadra, se limpian `match_forzado_por` y `match_justificacion`
--     aunque el cliente los haya mandado: el registro dice la verdad.
--
-- NO CAMBIA: quién puede aprobar (policy de UPDATE), el cuadre por renglón, las
-- tolerancias, el devengo ni las facturas ya aprobadas (el trigger solo actúa en
-- registrada → aprobada). Los gastos directos aprueban igual que siempre.
--
-- CÓMO REVERTIR
--   Restaurar compras_tg_factura_match() de 20261021000200. Idempotente:
--   CREATE OR REPLACE.
-- IMPACTO EN DATOS: ninguno.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compras_tg_factura_match()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_prov   record;
  v_tol_c  numeric;
  v_nf     int;
  v_nf_det text;
  v_malas  int;
  v_det    text;
  v_just   text;
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

  -- El actor lo pone el servidor: lo que mande el cliente en estos campos no cuenta.
  IF v_uid IS NOT NULL THEN
    NEW.aprobada_por := v_uid;
    NEW.aprobada_at  := now();
  END IF;
  v_just := NULLIF(btrim(COALESCE(NEW.match_justificacion, '')), '');

  -- Sin orden de compra no hay cuadre que exigir (gasto directo, caja chica) ni
  -- diferencia que justificar.
  IF NEW.orden_compra_id IS NULL THEN
    NEW.match_forzado_por   := NULL;
    NEW.match_justificacion := NULL;
    RETURN NEW;
  END IF;

  -- SERIALIZA las aprobaciones contra la misma orden: dos facturas que cubren
  -- el mismo saldo por facturar leían `cantidad_facturada` sin bloqueo y las
  -- dos cuadraban. El orden por id evita interbloqueos entre ellas.
  PERFORM 1 FROM public.orden_compra_lineas
   WHERE orden_compra_id = NEW.orden_compra_id
   ORDER BY id
   FOR UPDATE;

  -- Una factura con orden SIN renglones no tiene contra qué cuadrarse: el cuadre
  -- es por renglón y devolvería cero filas («todo cuadra»). Nunca se aprueba.
  IF NOT EXISTS (SELECT 1 FROM public.factura_proveedor_lineas WHERE factura_id = NEW.id) THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_SIN_RENGLONES: la factura está ligada a la orden pero no tiene renglones, así que no hay contra qué cuadrarla ni qué liquidar de lo recibido. Captura qué se factura de cada renglón de la orden. No se autoriza con justificación.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Diferencias que NO se autorizan: dejarían la cuenta puente, las cantidades o
  -- el seguimiento descuadrados sin remedio.
  v_tol_c := public.compras_tolerancia(NEW.company_id, 'cantidad');
  SELECT COUNT(*), string_agg(format('· %s: %s', m.descripcion, m.motivo), E'\n')
    INTO v_nf, v_nf_det
  FROM public.compras_validar_match(NEW.id) m
  WHERE NOT m.dentro_tolerancia
    AND (   m.cantidad_ordenada IS NULL
         OR m.moneda_orden IS DISTINCT FROM m.moneda_factura
         OR m.cantidad_factura > m.cantidad_recibida - m.cantidad_facturada + 1e-6
         OR m.cantidad_facturada + m.cantidad_factura > m.cantidad_ordenada * (1 + v_tol_c / 100) + 1e-6);
  IF v_nf > 0 THEN
    RAISE EXCEPTION E'COMPRAS_MATCH_NO_FORZABLE: % renglón(es) no se pueden aprobar, ni con justificación:\n%\nSe factura más de lo recibido y aún no facturado (registra primero la recepción o la conformidad), más de lo ordenado, en otra moneda o un renglón que no es de la orden. La factura queda registrada.',
      v_nf, v_nf_det USING ERRCODE = 'check_violation';
  END IF;

  -- Lo que queda fuera de tolerancia es precio o IVA: se aprueba solo con
  -- justificación escrita y firmada por quien ejecuta.
  SELECT COUNT(*), string_agg(format('· %s: %s', m.descripcion, m.motivo), E'\n')
    INTO v_malas, v_det
  FROM public.compras_validar_match(NEW.id) m
  WHERE NOT m.dentro_tolerancia;

  IF v_malas > 0 THEN
    IF v_uid IS NULL OR v_just IS NULL OR length(v_just) < 5 THEN
      RAISE EXCEPTION E'COMPRAS_MATCH_FUERA_DE_TOLERANCIA: % renglón(es) no cuadran con la orden:\n%\nCorrige la factura o autorízala dejando la justificación.',
        v_malas, v_det USING ERRCODE = 'check_violation';
    END IF;
    NEW.match_forzado_por   := v_uid;   -- el autorizador es quien ejecuta, no lo que diga el cliente
    NEW.match_justificacion := v_just;
  ELSE
    NEW.match_forzado_por   := NULL;
    NEW.match_justificacion := NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.compras_tg_factura_match() IS
  'Al aprobar una factura: proveedor no suspendido/vetado; actor sellado con auth.uid(); con orden, cuadre de 3 vías por renglón. Sin renglones o con diferencias de cantidad/moneda no se aprueba ni con justificación; precio e IVA fuera de tolerancia solo con justificación firmada por el servidor.';

REVOKE EXECUTE ON FUNCTION public.compras_tg_factura_match() FROM PUBLIC, anon, authenticated;
