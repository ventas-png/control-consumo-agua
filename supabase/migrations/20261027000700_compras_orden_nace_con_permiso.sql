-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · UNA ORDEN PUEDE NACER YA APROBADA O EMITIDA, PERO SOLO CON EL PERMISO
-- (corrige 20261027000300 solo en el caso de la ORDEN DE COMPRA)
--
-- POR QUÉ
--   20261027000300 exigía que toda orden nazca en «borrador». Al correr la batería existente,
--   `proveedores_pr_a/assert_identidad.sql §8` (PR A) usa a propósito el INSERT con estado
--   «aprobada» como camino que debe VALIDAR la autorización vigente y la habilitación del
--   proveedor en el proyecto (`compras_tg_oc_estado` ya contempla `TG_OP = 'INSERT'`). Ese
--   camino está probado y no es dañino por sí mismo: una orden insertada ya aprobada no puede
--   llevar renglones (los renglones de una orden que no es borrador son inmutables), así que
--   compromete 0 y no mueve nada. Lo que sí era un hueco es que se saltaba el permiso
--   «Autorizar / Denegar»: quien solo podía crear aprobaba su propia orden con un INSERT.
--
-- QUÉ HACE
--   Reemplaza solo `compras_tg_permiso_orden()` (la de la orden de compra):
--     · INSERT «aprobada»      → exige `approve` (el mismo permiso que borrador → aprobada);
--     · INSERT «emitida»       → exige `approve` Y `change_status`;
--     · INSERT en cualquier otro estado que no sea «borrador» (recibida, cerrada, cancelada…)
--       → COMPRAS_ESTADO_INICIAL: no tiene sentido nacer así.
--     · en todos los casos el aprobador y la hora los sella el servidor.
--   Las transiciones por UPDATE no cambian. La recepción, la factura y la contraseña SIGUEN
--   naciendo solo en su estado inicial (nacer «registrada», «aprobada» o «pagada» sí se salta
--   efectos: existencias, devengo, pago).
--
-- CÓMO REVERTIR
--   Volver a la función de 20261027000300 (toda orden nace en borrador). Sin datos que tocar.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compras_tg_permiso_orden()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.estado = 'borrador' THEN
      RETURN NEW;
    ELSIF NEW.estado = 'aprobada' THEN
      PERFORM public.compras_exigir_accion('approve', 'crear una orden de compra ya aprobada');
    ELSIF NEW.estado = 'emitida' THEN
      PERFORM public.compras_exigir_accion('approve', 'crear una orden de compra ya aprobada');
      PERFORM public.compras_exigir_accion('change_status', 'crear una orden de compra ya emitida');
    ELSE
      RAISE EXCEPTION 'COMPRAS_ESTADO_INICIAL: una orden de compra nace en borrador (o, con permiso, aprobada o emitida); no se crea ya «%».', NEW.estado
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.aprobada_por := auth.uid();     -- quién aprueba lo dice el servidor
    NEW.aprobada_at  := now();
    RETURN NEW;
  END IF;

  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;

  IF OLD.estado = 'borrador' AND NEW.estado = 'aprobada' THEN
    PERFORM public.compras_exigir_accion('approve', 'aprobar una orden de compra');
    NEW.aprobada_por := auth.uid();     -- quién aprueba lo dice el servidor
    NEW.aprobada_at  := now();
  ELSIF OLD.estado = 'aprobada' AND NEW.estado = 'borrador' THEN
    PERFORM public.compras_exigir_accion('approve', 'devolver a borrador una orden aprobada');
  ELSIF NEW.estado = 'emitida' THEN
    PERFORM public.compras_exigir_accion('change_status', 'emitir una orden de compra al proveedor');
  ELSIF NEW.estado = 'cancelada' THEN
    PERFORM public.compras_exigir_accion('change_status', 'cancelar una orden de compra');
  ELSIF NEW.estado = 'cerrada' THEN
    PERFORM public.compras_exigir_accion('change_status', 'cerrar una orden de compra');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.compras_tg_permiso_orden() FROM PUBLIC, anon, authenticated;
