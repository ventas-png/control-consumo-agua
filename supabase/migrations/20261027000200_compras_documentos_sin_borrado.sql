-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · LOS DOCUMENTOS CON EFECTO SE ANULAN, NO SE BORRAN
-- (anulación por reversión trazable, sin borrar evidencia histórica)
--
-- QUÉ FALLABA (reproducido con `DELETE` directo, el camino de PostgREST, como
-- administrador de la empresa o con el permiso «Eliminar — Contabilidad»)
--   Las políticas de DELETE de estas tablas solo piden rol administrador o el permiso
--   de eliminar. Ningún trigger miraba el ESTADO del documento:
--     · Una RECEPCIÓN REGISTRADA se borraba: desaparecían la recepción y sus líneas,
--       pero lo recibido seguía sumado en el renglón de la orden, las existencias
--       seguían en el kardex y el asiento seguía publicado. Evidencia perdida y
--       estado derivado descuadrado.
--     · Una ORDEN EMITIDA sin recepciones se borraba con su historial de estados
--       (`orden_compra_eventos` es ON DELETE CASCADE): el compromiso con el proveedor
--       dejaba de existir sin rastro.
--     · Una FACTURA APROBADA se borraba: el trigger revertía el asiento, pero lo
--       facturado seguía acumulado en la orden (la orden quedaba «cerrada» y el renglón
--       ya no se podía volver a facturar) y el documento desaparecía.
--     · Una ORDEN DE PAGO PAGADA se borraba: se revertía el asiento, pero la factura
--       seguía «pagada» con su monto pagado.
--   La pantalla solo ofrece «Eliminar» sobre un borrador de orden; el servidor
--   aceptaba todo lo demás.
--
-- QUÉ HACE (BEFORE DELETE)
--   Solo se puede borrar lo que NUNCA tuvo efecto:
--     · orden de compra: borrador, jamás aprobado (sin revisión, sellos ni número);
--     · recepción: borrador, jamás registrada;
--     · factura: registrada, jamás aprobada y sin pagos;
--     · orden de pago: borrador;
--     · contraseña de pago: nunca (es un acuse entregado al proveedor: se anula);
--     · partida de contraseña: solo de una contraseña emitida sin orden de pago viva.
--   Todo lo demás se ANULA o se CANCELA con su motivo y su reversión, que quedan en el
--   historial. El mensaje dice cuál es el camino.
--   La eliminación en CASCADA de una empresa o de un proyecto (purga definitiva de una
--   empresa) no es un borrado de usuario y no se bloquea: la empresa o el proyecto ya
--   no existen cuando el trigger de la fila hija corre.
--
-- IMPACTO EN DATOS EXISTENTES: ninguno (solo restringe DELETE nuevos).
--
-- CÓMO REVERTIR (sin pérdida de datos: solo funciones y triggers)
--   DROP TRIGGER trg_compras_no_borrar ON public.ordenes_compra;  (y los demás de abajo)
--   DROP FUNCTION public.compras_tg_no_borrar_documento();
--   DROP FUNCTION public.compras_tg_no_borrar_partida();
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compras_tg_no_borrar_documento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_puede boolean;
  v_que   text;
  v_como  text;
BEGIN
  -- Cascada de la purga de una empresa o de un proyecto: no es un borrado de usuario.
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = OLD.company_id) THEN
    RETURN OLD;
  END IF;
  IF OLD.project_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id) THEN
    RETURN OLD;
  END IF;

  CASE TG_TABLE_NAME
    WHEN 'ordenes_compra' THEN
      v_puede := OLD.estado = 'borrador' AND OLD.revision = 0 AND OLD.aprobada_at IS NULL AND OLD.numero IS NULL;
      v_que := format('la orden de compra %s (%s)', COALESCE(OLD.numero, OLD.id::text), OLD.estado);
      v_como := 'Cancélala indicando el motivo: queda en su historial.';
    WHEN 'recepciones' THEN
      v_puede := OLD.estado = 'borrador' AND OLD.registrada_at IS NULL;
      v_que := format('la recepción %s (%s)', COALESCE(OLD.numero, OLD.id::text), OLD.estado);
      v_como := 'Anúlala indicando el motivo: se revierten el asiento, las existencias y los activos, y queda en el historial.';
    WHEN 'facturas_proveedor' THEN
      v_puede := OLD.estado = 'registrada' AND OLD.aprobada_at IS NULL AND OLD.monto_pagado = 0;
      v_que := format('la factura %s (%s)', COALESCE(OLD.numero_factura, OLD.id::text), OLD.estado);
      v_como := 'Anúlala: se revierten el devengo y lo facturado de la orden, y queda en el historial.';
    WHEN 'ordenes_pago' THEN
      v_puede := OLD.estado = 'borrador';
      v_que := format('la orden de pago (%s)', OLD.estado);
      v_como := 'Anúlala: se revierten el asiento y el saldo de la factura, y queda en el historial.';
    WHEN 'contrasenas_pago' THEN
      v_puede := false;
      v_que := format('la contraseña de pago %s (%s)', COALESCE(OLD.numero, OLD.id::text), OLD.estado);
      v_como := 'Anúlala indicando el motivo: es un acuse entregado al proveedor y queda en el historial.';
    ELSE
      RETURN OLD;
  END CASE;

  IF NOT v_puede THEN
    RAISE EXCEPTION 'COMPRAS_DOCUMENTO_NO_SE_BORRA: no se borra %. %', v_que, v_como
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.compras_tg_no_borrar_documento() IS
  'Solo se borra lo que nunca tuvo efecto (borradores sin aprobar/registrar, factura sin aprobar). Lo demás se anula o cancela con motivo y reversión. La cascada de una empresa o proyecto que se elimina no se bloquea.';

DROP TRIGGER IF EXISTS trg_compras_no_borrar ON public.ordenes_compra;
CREATE TRIGGER trg_compras_no_borrar
  BEFORE DELETE ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_no_borrar_documento();

DROP TRIGGER IF EXISTS trg_compras_no_borrar ON public.recepciones;
CREATE TRIGGER trg_compras_no_borrar
  BEFORE DELETE ON public.recepciones
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_no_borrar_documento();

DROP TRIGGER IF EXISTS trg_compras_no_borrar ON public.facturas_proveedor;
CREATE TRIGGER trg_compras_no_borrar
  BEFORE DELETE ON public.facturas_proveedor
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_no_borrar_documento();

DROP TRIGGER IF EXISTS trg_compras_no_borrar ON public.ordenes_pago;
CREATE TRIGGER trg_compras_no_borrar
  BEFORE DELETE ON public.ordenes_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_no_borrar_documento();

DROP TRIGGER IF EXISTS trg_compras_no_borrar ON public.contrasenas_pago;
CREATE TRIGGER trg_compras_no_borrar
  BEFORE DELETE ON public.contrasenas_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_no_borrar_documento();

-- Partidas de una contraseña: solo se quitan mientras la contraseña está emitida y
-- ninguna orden de pago viva la liquida (el total de la contraseña debe seguir siendo
-- el de la orden).
CREATE OR REPLACE FUNCTION public.compras_tg_no_borrar_partida()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_c public.contrasenas_pago;
BEGIN
  SELECT * INTO v_c FROM public.contrasenas_pago c WHERE c.id = OLD.contrasena_id;
  IF NOT FOUND THEN
    RETURN OLD;   -- la contraseña ya no existe: cascada
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = OLD.company_id) THEN
    RETURN OLD;
  END IF;
  IF v_c.estado <> 'emitida' THEN
    RAISE EXCEPTION 'COMPRAS_DOCUMENTO_NO_SE_BORRA: la contraseña % está «%»; sus partidas ya no se quitan. Anula la contraseña si hubo un error.',
      COALESCE(v_c.numero, v_c.id::text), v_c.estado
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ordenes_pago o
              WHERE o.contrasena_pago_id = OLD.contrasena_id AND o.estado <> 'anulada') THEN
    RAISE EXCEPTION 'COMPRAS_DOCUMENTO_NO_SE_BORRA: la contraseña % tiene una orden de pago viva; anula primero la orden de pago.',
      COALESCE(v_c.numero, v_c.id::text)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_compras_no_borrar_partida ON public.contrasena_pago_facturas;
CREATE TRIGGER trg_compras_no_borrar_partida
  BEFORE DELETE ON public.contrasena_pago_facturas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_no_borrar_partida();

REVOKE ALL ON FUNCTION public.compras_tg_no_borrar_documento() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_no_borrar_partida()   FROM PUBLIC, anon, authenticated;
