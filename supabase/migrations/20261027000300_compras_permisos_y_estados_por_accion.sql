-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · CADA PASO DEL CIRCUITO EXIGE SU PERMISO Y NADIE ESCRIBE UN ESTADO QUE
-- LE CORRESPONDE AL SISTEMA — EN EL SERVIDOR, NO SOLO EN LA PANTALLA
-- (solicitar · aprobar · recibir · contabilizar · pagar)
--
-- EL MODELO EXISTENTE
--   Contabilidad ya distingue acciones por permiso (`platform.contabilidad.*`):
--   `create`, `edit`, `delete`, `change_status` («Cambiar estado») y `approve`
--   («Autorizar / Denegar»). La pantalla de Compras y la de Cuentas por pagar ya las usan
--   para decidir qué botón ofrecer: crear → solicitar y capturar la recepción, y la orden
--   de pago; autorizar → aprobar la orden y aprobar (contabilizar) la factura y la orden
--   de pago; cambiar estado → emitir, cancelar, registrar la recepción, anular, pagar.
--
-- QUÉ FALLABA (reproducido con DML directo como `authenticated`)
--   El servidor NO usaba `approve` ni `change_status` en ninguno de esos pasos: todas
--   las transiciones pasaban con la política UPDATE (`edit`). Un usuario con solo
--   ver/crear/editar/eliminar (sin autorizar ni cambiar estado) podía, SOLO y por la
--   API, solicitar una orden, aprobarla, emitirla, registrar su recepción (con asiento
--   y existencias), aprobar y contabilizar la factura y pagarla.
--   Además, el servidor aceptaba que el cliente ESCRIBIERA estados que solo deben dejar
--   los triggers de sistema, saltándose pasos enteros:
--     · una FACTURA insertada ya «aprobada» (sin cuadre contra la orden, sin devengo,
--       sin acumulado; luego se podía pagar) o puesta «pagada» a mano, con su monto
--       pagado, sin pago ni asiento;
--     · una ORDEN insertada ya «emitida» (con su número) y una RECEPCIÓN insertada ya
--       «registrada» (sin existencias ni asiento);
--     · una CONTRASEÑA puesta «pagada» a mano.
--   Y la OC aceptaba que el navegador dijera quién la aprobó (`aprobada_por`).
--
-- QUÉ HACE (para sesiones de usuario; ver «Quién queda fuera»)
--   Cada transición exige el permiso de Contabilidad que la pantalla ya exige, MÁS el
--   `edit` que ya exigía la política. Los roles administrador y propietario pasan por
--   `conta_puede_escribir`, como siempre.
--
--     Orden de compra     borrador → aprobada, aprobada → borrador (devolver)   approve
--                         → emitida, → cancelada, → cerrada                      change_status
--     Recepción           borrador → registrada, → anulada                      change_status
--                         (capturarla y sus líneas sigue siendo `create`)
--     Factura             registrada → aprobada (contabiliza)                   approve
--                         → anulada                                              change_status
--     Orden de pago       borrador → aprobada                                    approve
--                         → pagada, → anulada                                    change_status
--     Contraseña          emitida → anulada                                      change_status
--
--   Nace en su estado inicial: orden «borrador», recepción «borrador», factura
--   «registrada» sin pagos, contraseña «emitida». Los estados derivados —factura
--   «pagada»/«pagada parcial» y su monto pagado, contraseña «pagada»— solo los deja el
--   trigger de pago (permiso de sistema).
--   Al aprobar una orden, quién aprueba y cuándo lo sella el servidor.
--
-- QUÉ NO HACE (decisiones de negocio que NO se tomaron aquí)
--   · NO impide que la MISMA persona haga varios pasos si tiene todos los permisos:
--     esa regla (autoaprobación) no se inventa; ya existe `compras_config.aprobacion_
--     separada` para la orden y sigue APAGADA por defecto. Ver docs/COMPRAS_CONTROLES_
--     SERVIDOR.md, «Preguntas».
--   · NO fija montos ni umbrales. NO crea permisos nuevos.
--
-- QUIÉN QUEDA FUERA
--   Las operaciones sin usuario (service_role, mantenimiento, `auth.uid()` nulo) y los
--   triggers que mueven estados con el permiso de sistema (recepciones, facturas y pagos
--   moviendo lo comprometido, facturado y pagado) no pasan por estos controles.
--
-- IMPACTO ANTES DE DESPLEGAR
--   Un usuario no administrador con `edit` pero sin `approve`/`change_status` DEJA de
--   poder hacer por API lo que la pantalla ya no le ofrecía. Quien lo hacía desde la
--   pestaña de Operaciones (que no distinguía) verá un mensaje claro. Antes de fusionar:
--   scripts/diagnostico-compras-controles.sql, apartado «Perfiles afectados» (solo
--   lectura), lista a quién alcanza.
--
-- CÓMO REVERTIR (sin pérdida de datos: solo funciones y triggers)
--   DROP TRIGGER trg_compras_permiso_orden ON public.ordenes_compra;  (y los de abajo)
--   DROP FUNCTION public.compras_tg_permiso_*(), public.compras_exigir_accion(text, text);
-- ════════════════════════════════════════════════════════════════════════════

-- ── Comprobación común ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_exigir_accion(p_accion text, p_paso text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- Sin usuario (servicio, mantenimiento) o con el permiso de sistema (un trigger que
  -- mueve un estado derivado): no es una decisión de una persona.
  IF auth.uid() IS NULL
     OR COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN;
  END IF;
  IF public.conta_puede_escribir(p_accion) THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'COMPRAS_PERMISO_ACCION: para % tu perfil necesita el permiso «% — Contabilidad».',
    p_paso,
    CASE p_accion WHEN 'approve' THEN 'Autorizar / Denegar' WHEN 'change_status' THEN 'Cambiar estado' ELSE p_accion END
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

COMMENT ON FUNCTION public.compras_exigir_accion(text, text) IS
  'Interna de los triggers de compras: exige el permiso de Contabilidad de la acción (approve / change_status) a una sesión de usuario. Sin usuario o con el permiso de sistema no se aplica.';

-- ¿Es una sesión de usuario escribiendo directamente (no un trigger de sistema)?
CREATE OR REPLACE FUNCTION public.compras_sesion_usuario()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT auth.uid() IS NOT NULL
     AND COALESCE(current_setting('conta.allow_system_write', true), 'off') <> 'on'
$$;

-- ── Orden de compra ─────────────────────────────────────────────────────────
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
    IF NEW.estado <> 'borrador' THEN
      RAISE EXCEPTION 'COMPRAS_ESTADO_INICIAL: una orden de compra nace en borrador y se aprueba y emite después; no se crea ya «%».', NEW.estado
        USING ERRCODE = 'check_violation';
    END IF;
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

DROP TRIGGER IF EXISTS trg_compras_permiso_orden ON public.ordenes_compra;
CREATE TRIGGER trg_compras_permiso_orden
  BEFORE INSERT OR UPDATE OF estado ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_permiso_orden();

-- ── Recepción ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_permiso_recepcion()
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
    IF NEW.estado <> 'borrador' THEN
      RAISE EXCEPTION 'COMPRAS_ESTADO_INICIAL: una recepción nace en borrador y se registra después (eso mueve existencias y contabiliza); no se crea ya «%».', NEW.estado
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  IF NEW.estado = 'registrada' THEN
    PERFORM public.compras_exigir_accion('change_status', 'registrar una recepción (mueve existencias y contabiliza)');
  ELSIF NEW.estado = 'anulada' THEN
    PERFORM public.compras_exigir_accion('change_status', 'anular una recepción');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compras_permiso_recepcion ON public.recepciones;
CREATE TRIGGER trg_compras_permiso_recepcion
  BEFORE INSERT OR UPDATE OF estado ON public.recepciones
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_permiso_recepcion();

-- ── Factura de proveedor ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_permiso_factura()
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
    IF NEW.estado <> 'registrada' OR NEW.monto_pagado <> 0 THEN
      RAISE EXCEPTION 'COMPRAS_ESTADO_INICIAL: una factura nace «registrada» y sin pagos; se aprueba (se cuadra y se contabiliza) y se paga después. No se crea ya «%» con % pagado.', NEW.estado, NEW.monto_pagado
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Pagada / pagada parcial y el monto pagado los deja el trigger de pago.
  IF (NEW.estado IS DISTINCT FROM OLD.estado AND NEW.estado IN ('pagada', 'pagada_parcial'))
     OR NEW.monto_pagado IS DISTINCT FROM OLD.monto_pagado THEN
    RAISE EXCEPTION 'COMPRAS_ESTADO_SOLO_SISTEMA: lo pagado de una factura y su estado «pagada» los deja una orden de pago al pagarse; no se escriben a mano.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  IF NEW.estado = 'aprobada' THEN
    PERFORM public.compras_exigir_accion('approve', 'aprobar (contabilizar) una factura de proveedor');
  ELSIF NEW.estado = 'anulada' THEN
    PERFORM public.compras_exigir_accion('change_status', 'anular una factura de proveedor');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compras_permiso_factura ON public.facturas_proveedor;
CREATE TRIGGER trg_compras_permiso_factura
  BEFORE INSERT OR UPDATE OF estado, monto_pagado ON public.facturas_proveedor
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_permiso_factura();

-- ── Orden de pago ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_permiso_orden_pago()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.compras_sesion_usuario() OR TG_OP = 'INSERT'
     OR NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  IF NEW.estado = 'aprobada' THEN
    PERFORM public.compras_exigir_accion('approve', 'aprobar una orden de pago');
  ELSIF NEW.estado = 'pagada' THEN
    PERFORM public.compras_exigir_accion('change_status', 'marcar pagada una orden de pago (contabiliza el pago)');
  ELSIF NEW.estado = 'anulada' THEN
    PERFORM public.compras_exigir_accion('change_status', 'anular una orden de pago');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compras_permiso_orden_pago ON public.ordenes_pago;
CREATE TRIGGER trg_compras_permiso_orden_pago
  BEFORE UPDATE OF estado ON public.ordenes_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_permiso_orden_pago();

-- ── Contraseña de pago ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_permiso_contrasena()
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
    IF NEW.estado <> 'emitida' THEN
      RAISE EXCEPTION 'COMPRAS_ESTADO_INICIAL: una contraseña de pago nace «emitida»; se paga con su orden de pago y se anula con motivo. No se crea ya «%».', NEW.estado
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  IF NEW.estado = 'pagada' THEN
    RAISE EXCEPTION 'COMPRAS_ESTADO_SOLO_SISTEMA: una contraseña queda «pagada» cuando se paga la orden de pago que la liquida; no se marca a mano.'
      USING ERRCODE = 'check_violation';
  ELSIF NEW.estado = 'anulada' THEN
    PERFORM public.compras_exigir_accion('change_status', 'anular una contraseña de pago');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compras_permiso_contrasena ON public.contrasenas_pago;
CREATE TRIGGER trg_compras_permiso_contrasena
  BEFORE INSERT OR UPDATE OF estado ON public.contrasenas_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_permiso_contrasena();

-- ── Permisos de ejecución: solo los invocan los triggers ────────────────────
REVOKE ALL ON FUNCTION public.compras_exigir_accion(text, text)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_sesion_usuario()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_permiso_orden()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_permiso_recepcion()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_permiso_factura()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_permiso_orden_pago()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_permiso_contrasena()     FROM PUBLIC, anon, authenticated;
