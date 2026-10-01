-- ════════════════════════════════════════════════════════════════════════════
-- LA ORDEN DE COMPRA REVALIDA AL PASAR DE APROBADA A EMITIDA (PR A)
--
-- EL HUECO
-- Los candados de `compras_tg_oc_estado` y `compras_tg_oc_proveedor_proyecto`
-- solo actuaban al ENTRAR en aprobada/emitida desde un estado que no fuera
-- ninguno de los dos. Una orden aprobada y luego emitida (aprobada → emitida)
-- pasaba sin consultar nada: si entre ambos momentos el proveedor se suspendió,
-- su autorización venció o se le retiró la habilitación del proyecto, la orden
-- se emitía igual. Es la misma obligación nueva con un tercero que ya no cumple
-- las condiciones.
--
-- LA CORRECCIÓN
-- Emitir es el acto que compromete dinero: se revalida SIEMPRE ahí —autorización
-- general, vencimiento de la autorización y habilitación en el proyecto— venga
-- de borrador o de aprobada. (Aprobar sigue validándose como hasta ahora.)
--
-- LO QUE NO SE BLOQUEA (resolver lo anterior)
--   · cancelar una orden aprobada o emitida;
--   · cerrarla, y las recepciones/facturas que mueven su estado (llegan con
--     `conta.allow_system_write`);
--   · cualquier cambio que no sea ENTRAR a aprobada/emitida.
-- Suspender o retirar a un proveedor nunca borra ni reescribe una orden.
--
-- Solo se reemplaza la función; el trigger existente
-- (`trg_compras_oc_proveedor_proyecto`, BEFORE INSERT OR UPDATE) sigue igual.
--
-- CÓMO REVERTIR
--   restaurar la definición de compras_tg_oc_proveedor_proyecto() de
--   20261020000000_proveedores_identidad_y_proyectos.sql.
--
-- IMPACTO EN DATOS: ninguno (solo lógica). No toca filas.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compras_tg_oc_proveedor_proyecto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entra_aprobada boolean;
  v_entra_emitida  boolean;
  v_prov           record;
BEGIN
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NEW;  -- recepciones/facturas moviendo el estado de lo ya comprometido
  END IF;

  IF NEW.proveedor_id IS NULL OR NEW.estado NOT IN ('aprobada', 'emitida') THEN
    RETURN NEW;
  END IF;

  v_entra_aprobada := NEW.estado = 'aprobada'
    AND (TG_OP = 'INSERT'
         OR OLD.estado NOT IN ('aprobada', 'emitida', 'recibida_parcial', 'recibida', 'cerrada'));

  -- Emitir se revalida aunque ya estuviera aprobada: es el compromiso real.
  v_entra_emitida := NEW.estado = 'emitida'
    AND (TG_OP = 'INSERT'
         OR OLD.estado NOT IN ('emitida', 'recibida_parcial', 'recibida', 'cerrada'));

  IF NOT (v_entra_aprobada OR v_entra_emitida) THEN
    RETURN NEW;
  END IF;

  -- 1. Autorización general y su vencimiento (antes solo se miraba al aprobar).
  IF NOT public.proveedor_habilitado(NEW.proveedor_id) THEN
    SELECT nombre, estado, autorizacion_vence INTO v_prov
      FROM public.proveedores WHERE id = NEW.proveedor_id;
    IF v_prov.estado = 'autorizado' THEN
      RAISE EXCEPTION 'COMPRAS_PROVEEDOR_NO_AUTORIZADO: la autorización de "%" venció el %. Actualiza su papelería antes de %.',
        v_prov.nombre, to_char(v_prov.autorizacion_vence, 'DD/MM/YYYY'),
        CASE WHEN NEW.estado = 'emitida' THEN 'emitir la orden' ELSE 'aprobarla' END
        USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'COMPRAS_PROVEEDOR_NO_AUTORIZADO: "%" está en estado "%"; solo un proveedor autorizado recibe órdenes de compra (revisado al %).',
      v_prov.nombre, v_prov.estado,
      CASE WHEN NEW.estado = 'emitida' THEN 'emitir' ELSE 'aprobar' END
      USING ERRCODE = 'check_violation';
  END IF;

  -- 2. Habilitación en el proyecto (suspendida o retirada después de aprobar).
  IF NOT public.proveedor_habilitado_en(NEW.proveedor_id, NEW.project_id) THEN
    RAISE EXCEPTION 'COMPRAS_PROVEEDOR_PROYECTO_NO_HABILITADO: el proveedor no está habilitado para % (suspendido, retirado o vencido). Habilítalo de nuevo o cancela la orden; la orden y su historial se conservan.',
      CASE WHEN NEW.project_id IS NULL THEN 'la contabilidad de la empresa' ELSE 'este proyecto' END
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_oc_proveedor_proyecto() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.compras_tg_oc_proveedor_proyecto() IS
  'Al aprobar o EMITIR una orden (también aprobada → emitida) exige proveedor autorizado y vigente y habilitado en el proyecto. Cancelar, cerrar y las operaciones de recepción/factura no se bloquean.';
