-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · PAGOS A PROVEEDOR: EL SERVIDOR EXIGE LO QUE LA PANTALLA SOLO OFRECÍA
-- (auditoría del circuito proveedor → orden → recepción → factura → pago)
--
-- QUÉ FALLABA (reproducido con DML directo como `authenticated`, el mismo camino
-- que PostgREST, en un PostgreSQL local con la cadena completa de migraciones)
--   La vía «orden de pago contra UNA factura» (`ordenes_pago.factura_id`) no tenía
--   ningún control; solo la vía de la contraseña de pago los tenía. Aceptaba:
--     1. Pagar una factura SIN APROBAR (estado «registrada»): la orden pasaba a
--        «pagada», la factura saltaba de «registrada» a «pagada» y se SALTABA el
--        cuadre contra la orden de compra y la recepción, el devengo y lo facturado
--        acumulado en la orden (el trigger de saldo escribe con el permiso de sistema).
--     2. Pagar DOS veces la misma factura: dos órdenes de 1 000 sobre una factura de
--        1 000, las dos «pagadas». El saldo de la factura se recortaba con LEAST(),
--        así que la factura mostraba 1 000 pagados mientras la contabilidad tenía DOS
--        asientos de 1 000 (CxP deudora por 1 000 de más).
--     3. Una orden por un monto MAYOR al saldo (5 000 sobre una factura de 1 000).
--     4. Una orden con el proveedor o el proyecto de OTRA cosa que la factura, y —peor—
--        una orden de la empresa C contra la factura de la empresa D: al pagarla se
--        reescribía la factura AJENA (estado y monto pagado) y el asiento quedaba en C.
--     5. Saltarse la aprobación: no había máquina de estados (borrador → pagada).
--     6. Quién APROBÓ y quién SOLICITÓ los ponía el navegador (`aprobada_por`,
--        `solicitada_por`): se podía firmar a nombre de otra persona.
--   La vía por contraseña no verificaba al pagar que el saldo de cada factura siguiera
--   alcanzando (un pago directo posterior lo dejaba corto y el excedente se escondía en
--   el LEAST()).
--
-- QUÉ HACE (BEFORE INSERT/UPDATE sobre `ordenes_pago`, también para service_role)
--   · Una orden NACE en borrador. Transiciones: borrador → aprobada | anulada;
--     aprobada → pagada | anulada; pagada → anulada. Nada más.
--   · Con factura: debe ser de la misma empresa, proveedor y contabilidad, estar
--     APROBADA o PAGADA PARCIAL, y el monto no puede rebasar el saldo (descontando lo
--     que ya reservan otras órdenes vivas de esa factura y las contraseñas emitidas). Al
--     PAGAR se vuelve a comprobar contra el saldo real, con la fila de la factura
--     bloqueada: dos pagos simultáneos se serializan y el segundo se rechaza.
--   · Con contraseña: misma empresa; al pagar, la contraseña sigue emitida y cada
--     partida cabe en el saldo de su factura.
--   · Fuera de borrador, ni la factura/contraseña, ni el proveedor, ni el proyecto, ni el
--     monto cambian.
--   · El servidor sella `solicitada_por` (al crear), `aprobada_por`/`aprobada_at` (al
--     aprobar) y `pagada_at` (al pagar) cuando hay sesión de usuario; lo que mande el
--     navegador en esos campos no cuenta. `fecha_pago` (fecha contable del pago) sigue
--     siendo del usuario.
--
-- QUÉ NO HACE
--   No toca la contraseña ni sus triggers, ni los asientos, ni el trigger de saldo. No
--   decide quién puede aprobar o pagar (eso es 20261027000300) ni inventa topes.
--
-- IMPACTO EN DATOS EXISTENTES
--   Ninguno: solo restringe INSERT/UPDATE nuevos. Los pagos ya hechos no se tocan.
--   `scripts/diagnostico-compras-controles.sql` (solo lectura) lista facturas pagadas
--   por encima de su monto, pagos de facturas no aprobadas y referencias cruzadas ya
--   existentes, para que quien administra decida su corrección.
--
-- CÓMO REVERTIR (sin pérdida de datos: solo una función y un trigger)
--   DROP TRIGGER trg_compras_orden_pago_controles ON public.ordenes_pago;
--   DROP FUNCTION public.compras_tg_orden_pago_controles();
--   Revertir reabre los defectos de arriba.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compras_tg_orden_pago_controles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_f         public.facturas_proveedor;
  v_c         public.contrasenas_pago;
  v_it        record;
  v_reservado numeric(14,2);
  v_saldo     numeric(14,2);
  v_pasa      boolean;     -- ¿hay que validar la factura/contraseña en esta operación?
  v_paga      boolean;     -- ¿esta operación la deja «pagada»?
BEGIN
  -- ── Máquina de estados ────────────────────────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'borrador' THEN
      RAISE EXCEPTION 'COMPRAS_PAGO_ESTADO_INICIAL: una orden de pago nace en borrador y luego se aprueba y se paga; no se crea ya «%».', NEW.estado
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_uid IS NOT NULL THEN
      NEW.solicitada_por := v_uid;
    END IF;
  ELSE
    IF NEW.estado IS DISTINCT FROM OLD.estado
       AND NOT ((OLD.estado = 'borrador' AND NEW.estado IN ('aprobada', 'anulada'))
             OR (OLD.estado = 'aprobada' AND NEW.estado IN ('pagada', 'anulada'))
             OR (OLD.estado = 'pagada'   AND NEW.estado = 'anulada')) THEN
      RAISE EXCEPTION 'COMPRAS_PAGO_TRANSICION_INVALIDA: una orden de pago no pasa de «%» a «%»; el camino es borrador → aprobada → pagada, y anular.', OLD.estado, NEW.estado
        USING ERRCODE = 'check_violation';
    END IF;

    IF OLD.estado <> 'borrador'
       AND (NEW.company_id          IS DISTINCT FROM OLD.company_id
         OR NEW.project_id          IS DISTINCT FROM OLD.project_id
         OR NEW.proveedor_id        IS DISTINCT FROM OLD.proveedor_id
         OR NEW.factura_id          IS DISTINCT FROM OLD.factura_id
         OR NEW.contrasena_pago_id  IS DISTINCT FROM OLD.contrasena_pago_id
         OR NEW.monto               IS DISTINCT FROM OLD.monto) THEN
      RAISE EXCEPTION 'COMPRAS_PAGO_INMUTABLE: la orden de pago ya no está en borrador y no cambia de factura, contraseña, proveedor, proyecto ni monto. Anúlala y captura otra.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Sellos del servidor: quién aprueba y cuándo se paga no lo dice el navegador.
    IF v_uid IS NOT NULL THEN
      IF NEW.estado = 'aprobada' AND OLD.estado <> 'aprobada' THEN
        NEW.aprobada_por := v_uid;
        NEW.aprobada_at  := now();
      ELSIF NEW.aprobada_por IS DISTINCT FROM OLD.aprobada_por OR NEW.aprobada_at IS DISTINCT FROM OLD.aprobada_at THEN
        NEW.aprobada_por := OLD.aprobada_por;
        NEW.aprobada_at  := OLD.aprobada_at;
      END IF;
      IF NEW.estado = 'pagada' AND OLD.estado <> 'pagada' THEN
        NEW.pagada_at := now();
      ELSIF NEW.pagada_at IS DISTINCT FROM OLD.pagada_at THEN
        NEW.pagada_at := OLD.pagada_at;
      END IF;
      IF NEW.solicitada_por IS DISTINCT FROM OLD.solicitada_por THEN
        NEW.solicitada_por := OLD.solicitada_por;
      END IF;
    END IF;
  END IF;

  -- ── ¿Qué hay que comprobar contra la factura o la contraseña? ─────────────
  v_paga := NEW.estado = 'pagada' AND (TG_OP = 'INSERT' OR OLD.estado <> 'pagada');
  v_pasa := TG_OP = 'INSERT'
         OR (NEW.estado = 'aprobada' AND OLD.estado <> 'aprobada')
         OR v_paga
         OR (OLD.estado = 'borrador'
             AND (NEW.factura_id IS DISTINCT FROM OLD.factura_id
               OR NEW.contrasena_pago_id IS DISTINCT FROM OLD.contrasena_pago_id
               OR NEW.monto IS DISTINCT FROM OLD.monto
               OR NEW.proveedor_id IS DISTINCT FROM OLD.proveedor_id
               OR NEW.project_id IS DISTINCT FROM OLD.project_id));
  IF NOT v_pasa OR NEW.estado = 'anulada' THEN
    RETURN NEW;
  END IF;

  -- ── Orden contra UNA factura ──────────────────────────────────────────────
  IF NEW.factura_id IS NOT NULL THEN
    -- La fila de la factura se bloquea: dos órdenes que se aprueban o se pagan a la
    -- vez sobre la misma factura se serializan y la segunda lee el saldo ya movido.
    SELECT * INTO v_f FROM public.facturas_proveedor f WHERE f.id = NEW.factura_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN NEW;   -- la FK rechaza la fila
    END IF;

    IF v_f.company_id <> NEW.company_id THEN
      RAISE EXCEPTION 'COMPRAS_PAGO_FACTURA_AJENA: la factura no pertenece a la empresa de la orden de pago.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_f.proveedor_id <> NEW.proveedor_id THEN
      RAISE EXCEPTION 'COMPRAS_PAGO_FACTURA_AJENA: la orden de pago es de otro proveedor que la factura.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_f.project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'COMPRAS_PAGO_FACTURA_AJENA: la orden de pago es de otra contabilidad (proyecto o empresa) que la factura.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_f.estado NOT IN ('aprobada', 'pagada_parcial') THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_NO_PAGABLE: la factura % está «%»; solo se paga una factura aprobada (o pagada parcial). Una factura sin aprobar no se ha cuadrado contra la orden ni contabilizado.',
        COALESCE(v_f.numero_factura, v_f.id::text), v_f.estado
        USING ERRCODE = 'check_violation';
    END IF;

    v_saldo := v_f.monto_total - v_f.monto_pagado;
    IF NEW.monto > v_saldo THEN
      RAISE EXCEPTION 'COMPRAS_PAGO_EXCEDE_SALDO: la factura % tiene un saldo de % y la orden de pago es por %. No se paga más de lo que se debe.',
        COALESCE(v_f.numero_factura, v_f.id::text), v_saldo, NEW.monto
        USING ERRCODE = 'check_violation';
    END IF;

    IF NOT v_paga THEN
      -- Al crear o aprobar: tampoco puede rebasar lo que ya reservan OTRAS órdenes
      -- vivas de la misma factura ni las contraseñas emitidas que la incluyen.
      SELECT COALESCE(SUM(o.monto), 0) INTO v_reservado
        FROM public.ordenes_pago o
       WHERE o.factura_id = NEW.factura_id AND o.id <> NEW.id AND o.estado IN ('borrador', 'aprobada');
      v_reservado := v_reservado + COALESCE((
        SELECT SUM(cf.monto)
          FROM public.contrasena_pago_facturas cf
          JOIN public.contrasenas_pago c ON c.id = cf.contrasena_id
         WHERE cf.factura_id = NEW.factura_id AND c.estado = 'emitida'), 0);
      IF NEW.monto > v_saldo - v_reservado THEN
        RAISE EXCEPTION 'COMPRAS_PAGO_EXCEDE_SALDO: la factura % tiene un saldo de % y ya hay % reservado en otras órdenes de pago o contraseñas vivas; esta orden es por %.',
          COALESCE(v_f.numero_factura, v_f.id::text), v_saldo, v_reservado, NEW.monto
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- ── Orden que liquida una CONTRASEÑA ──────────────────────────────────────
  IF NEW.contrasena_pago_id IS NOT NULL THEN
    SELECT * INTO v_c FROM public.contrasenas_pago c WHERE c.id = NEW.contrasena_pago_id;
    IF NOT FOUND THEN
      RETURN NEW;   -- la FK rechaza la fila
    END IF;
    IF v_c.company_id <> NEW.company_id THEN
      RAISE EXCEPTION 'COMPRAS_PAGO_CONTRASENA_AJENA: la contraseña no pertenece a la empresa de la orden de pago.'
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_paga THEN
      IF v_c.estado <> 'emitida' THEN
        RAISE EXCEPTION 'COMPRAS_CONTRASENA_CERRADA: la contraseña % está «%» y no se puede pagar.', COALESCE(v_c.numero, v_c.id::text), v_c.estado
          USING ERRCODE = 'check_violation';
      END IF;
      -- Cada partida debe caber en el saldo ACTUAL de su factura (un pago directo
      -- posterior pudo dejarlo corto). Se bloquean en orden de id: sin interbloqueos.
      FOR v_it IN
        SELECT cf.factura_id, cf.monto FROM public.contrasena_pago_facturas cf
         WHERE cf.contrasena_id = NEW.contrasena_pago_id ORDER BY cf.factura_id
      LOOP
        SELECT * INTO v_f FROM public.facturas_proveedor f WHERE f.id = v_it.factura_id FOR UPDATE;
        IF v_f.estado NOT IN ('aprobada', 'pagada_parcial') THEN
          RAISE EXCEPTION 'COMPRAS_FACTURA_NO_PAGABLE: la factura % de la contraseña está «%» y no se puede pagar.',
            COALESCE(v_f.numero_factura, v_f.id::text), v_f.estado
            USING ERRCODE = 'check_violation';
        END IF;
        IF v_it.monto > v_f.monto_total - v_f.monto_pagado THEN
          RAISE EXCEPTION 'COMPRAS_PAGO_EXCEDE_SALDO: la factura % de la contraseña tiene un saldo de % y la partida es por %.',
            COALESCE(v_f.numero_factura, v_f.id::text), v_f.monto_total - v_f.monto_pagado, v_it.monto
            USING ERRCODE = 'check_violation';
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.compras_tg_orden_pago_controles() IS
  'Controles de servidor de la orden de pago: máquina de estados, factura aprobada y del mismo proveedor/proyecto/empresa, sin pagar más del saldo (con la factura bloqueada), contraseña vigente y sellos de actor. Antes solo la contraseña los tenía.';

DROP TRIGGER IF EXISTS trg_compras_orden_pago_controles ON public.ordenes_pago;
CREATE TRIGGER trg_compras_orden_pago_controles
  BEFORE INSERT OR UPDATE ON public.ordenes_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_orden_pago_controles();

REVOKE ALL ON FUNCTION public.compras_tg_orden_pago_controles() FROM PUBLIC, anon, authenticated;
