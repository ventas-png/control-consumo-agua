-- ════════════════════════════════════════════════════════════════════════════
-- OPCIONAL · NO forma parte de la migración 20261027000800 (piezas DEP-1 / EV-07) · REQUIERE DECISIÓN DE NEGOCIO
-- (opción O1 de "¿quién gobierna el interruptor de la separación?")
--
-- DEFECTO ADYACENTE (comprobado, no es el de DEP-1/EV-07 pero lo anula)
--   La política UPDATE/INSERT/DELETE de `compras_config` solo exige el permiso `edit` (`delete` para borrar).
--   Con la separación encendida, quien solicita una orden y tiene `edit` (p. ej. UQ: ver/crear/editar/autorizar)
--   puede: (1) apagar `aprobacion_separada`, (2) aprobar su propia orden, (3) volver a encenderla. Cierra el
--   hueco del INSERT y sigue habiendo una puerta trivial. Lo mismo vale para borrar la fila de la empresa
--   (sin fila = apagada).
--
-- QUÉ HARÍA ESTA OPCIÓN (si el dueño del producto la elige)
--   Solo el propietario/administrador de la empresa o el super administrador pueden ENCENDER, APAGAR o BORRAR
--   la configuración mientras la separación está encendida. Quien tiene `edit` sigue cambiando las tolerancias,
--   el mínimo y `requiere_recepcion` (no se toca ninguna otra columna), y los procesos sin sesión de usuario o con
--   conta.allow_system_write no pasan por este control.
--
-- LO QUE NO RESUELVE (decisiones aparte)
--   · Las demás columnas de compras_config siguen en manos de `edit`: las TOLERANCIAS de cantidad/precio
--     alimentan el cuadre de factura (compras_tolerancia → compras_tg_factura_match / recepcion_registrar) y un
--     editor puede subirlas a 100 %.
--   · Un administrador que además solicita sigue pudiendo apagar el interruptor: la figura de administrador es
--     de confianza plena en todo el circuito (ver matriz).
--
-- OTRAS OPCIONES (no se prototipan): O2 solo super administrador/soporte (fuera de la app); O3 permiso propio
--   nuevo (hay que crearlo en el catálogo de permisos y en la pantalla de roles); O4 sin restricción pero con
--   bitácora append-only de quién cambia la configuración (control detectivo, no preventivo); O5 aceptar el riesgo.
--
-- CÓMO REVERTIR
--   DROP TRIGGER IF EXISTS trg_compras_config_separacion ON public.compras_config;
--   DROP FUNCTION IF EXISTS public.compras_tg_config_separacion();
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compras_tg_config_separacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_toca boolean;
BEGIN
  IF NOT public.compras_sesion_usuario() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_toca := CASE TG_OP
              WHEN 'INSERT' THEN COALESCE(NEW.aprobacion_separada, false)            -- nace encendida
              WHEN 'UPDATE' THEN NEW.aprobacion_separada IS DISTINCT FROM OLD.aprobacion_separada
              ELSE                COALESCE(OLD.aprobacion_separada, false)           -- borrar la fila la apaga
            END;

  IF v_toca AND NOT (public.is_super_admin() OR public.current_user_role() IN ('company_owner', 'admin')) THEN
    RAISE EXCEPTION 'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN: encender o apagar la separación solicitante/aprobador (o borrar la configuración que la tiene encendida) lo hace el administrador de la empresa.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.compras_tg_config_separacion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_config_separacion ON public.compras_config;
CREATE TRIGGER trg_compras_config_separacion
  BEFORE INSERT OR UPDATE OR DELETE ON public.compras_config
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_config_separacion();
