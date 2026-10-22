-- Paquetería: el aviso "tu paquete fue retirado" llega a quien vive en la unidad.
--
-- Reportado desde el portal: un residente deja un paquete en portería para que
-- lo recoja otra persona (direccion = 'saliente_tercero') y, cuando esa persona
-- lo retira, no se entera.
--
-- POR QUÉ. El trigger `paquete_salida_notificar_retiro` (20260523000005) busca a
-- quién avisar con `unidades.cliente_id`, que es el PROPIETARIO de la unidad.
-- Desde el modelo dual (20260713050000) y las escrituras dual del portal
-- (20260822010000), quien autoriza el retiro puede ser un inquilino o un
-- familiar de `unidad_residentes`: justo quien dejó el paquete era el único que
-- nunca recibía el aviso.
--
-- A QUIÉN SE AVISA AHORA. A los mismos residentes que ven la fila en su portal
-- (el conjunto de `mis_unidades_ids()`): el propietario por `unidades.cliente_id`
-- y los residentes activos de `unidad_residentes`. La fila no guarda quién
-- autorizó el retiro, así que no se puede acotar a esa persona; avisar a quien
-- ya la ve no le muestra a nadie algo que no pudiera ver.
--
-- DE PASO:
--   · Quién retiró: si portería no tecleó un nombre se usa el autorizado, que es
--     quien tuvo que presentar el código.
--   · El aviso ya no puede tumbar el retiro: antes un error al insertar la
--     notificación abortaba el UPDATE de portería. Ahora se registra un WARNING
--     y el retiro queda guardado, igual que en fn_notificar_reserva_nueva.
--   · `SET search_path = ''` (convención 6 del README de migraciones).
--
-- El trigger trg_paquete_salida_retiro no cambia: sigue apuntando a esta
-- función, que solo se reemplaza.
--
-- REVERTIR: reaplicar el cuerpo de paquete_salida_notificar_retiro() de
-- 20260523000005_paqueteria_salida.sql (CREATE OR REPLACE con el mismo nombre).

CREATE OR REPLACE FUNCTION public.paquete_salida_notificar_retiro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.direccion = 'saliente_tercero'
     AND NEW.estado = 'entregado'
     AND OLD.estado IS DISTINCT FROM 'entregado'
     AND NEW.unidad_id IS NOT NULL THEN
    INSERT INTO public.user_notifications (user_id, company_id, tipo, titulo, cuerpo, seccion, paquete_id)
    SELECT DISTINCT au.id, NEW.company_id, 'paquete_retirado',
           '📦 Tu paquete fue retirado',
           coalesce(nullif(btrim(NEW.entregado_a_nombre), ''), nullif(btrim(NEW.autorizado_nombre), ''), 'La persona autorizada')
             || ' retiró: ' || NEW.descripcion,
           'paquetes', NEW.id
      FROM public.app_users au
     WHERE au.activo = true
       AND au.cliente_id IN (
             SELECT u.cliente_id
               FROM public.unidades u
              WHERE u.id = NEW.unidad_id
                AND u.activo = true
                AND u.cliente_id IS NOT NULL
             UNION
             SELECT ur.cliente_id
               FROM public.unidad_residentes ur
               JOIN public.unidades u2 ON u2.id = ur.unidad_id
              WHERE ur.unidad_id = NEW.unidad_id
                AND ur.activo = true
                AND u2.activo = true
           );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- El aviso jamás puede tumbar el retiro: el paquete ya salió de portería.
  RAISE WARNING 'paquete_salida_notificar_retiro(%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- Función de trigger: no debe ser invocable como RPC.
REVOKE ALL ON FUNCTION public.paquete_salida_notificar_retiro() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.paquete_salida_notificar_retiro() FROM anon;
REVOKE ALL ON FUNCTION public.paquete_salida_notificar_retiro() FROM authenticated;
