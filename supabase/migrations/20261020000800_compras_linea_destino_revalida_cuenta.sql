-- ════════════════════════════════════════════════════════════════════════════
-- CAMBIAR EL DESTINO DE UNA LÍNEA REVALIDA SU CUENTA ELEGIDA (PR A)
--
-- EL HUECO
-- `compras_tg_oc_linea_cuenta` (20261020000700) validaba la cuenta elegida solo
-- cuando `cuenta_id` cambiaba. Si el usuario dejaba la cuenta de un GASTO y
-- cambiaba el destino de la línea a ACTIVO FIJO o INVENTARIO, `cuenta_id` no
-- cambiaba, no se validaba nada y quedaba una línea con una cuenta de tipo
-- incompatible con su destino (la recepción la habría contabilizado mal).
--
-- LA CORRECCIÓN
-- Con una cuenta ELEGIDA (`cuenta_origen = 'linea_explicita'`, o una línea
-- anterior a esa columna con `cuenta_id` y origen NULL), cualquier cambio de
-- `destino_tipo` revalida su compatibilidad con el nuevo destino:
--   · compatible  → la cuenta se conserva EXACTAMENTE (elección manual intacta);
--   · incompatible → se RECHAZA la modificación con
--     `COMPRAS_LINEA_DESTINO_INCOMPATIBLE` y un mensaje que dice qué hacer.
--     Nunca se sustituye por una sugerencia en silencio.
-- La resolución automática no cambia: una línea automática (sin cuenta o fijada
-- por regla) sigue re-resolviéndose al cambiar su destino; gasto ↔ servicio
-- comparten destino de cuenta y no cambian nada.
--
-- Solo se reemplaza la función; el trigger existente no cambia.
-- CÓMO REVERTIR: restaurar la función de 20261020000700. IMPACTO EN DATOS: ninguno.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compras_tg_oc_linea_cuenta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_oc      record;
  v_destino text;
  v_auto    boolean := COALESCE(current_setting('compras.reresolver_cuentas', true), 'off') = 'on';
  v_resolver boolean := false;
  v_validar  boolean := false;
  v_cambio_dest boolean := false;
  r         record;
BEGIN
  -- Recepciones y facturas mueven cantidades acumuladas con el GUC del sistema:
  -- ahí no se resuelve ni se valida nada.
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_validar  := NEW.cuenta_id IS NOT NULL;
    v_resolver := NEW.cuenta_id IS NULL;
  ELSE
    IF v_auto THEN
      -- Re-resolución pedida por el cambio de proveedor de la orden: solo las
      -- líneas AUTOMÁTICAS (sin cuenta, o fijadas por una regla).
      v_resolver := OLD.cuenta_origen = 'regla_compra'
                 OR (OLD.cuenta_id IS NULL AND OLD.cuenta_origen IS NULL);
    ELSIF NEW.cuenta_id IS DISTINCT FROM OLD.cuenta_id THEN
      v_validar  := NEW.cuenta_id IS NOT NULL;
      v_resolver := NEW.cuenta_id IS NULL;
    ELSIF NEW.destino_tipo IS DISTINCT FROM OLD.destino_tipo
          AND NEW.cuenta_id IS NOT NULL
          AND (OLD.cuenta_origen = 'linea_explicita' OR OLD.cuenta_origen IS NULL) THEN
      -- Cuenta ELEGIDA (o anterior a la columna `cuenta_origen`) y el destino
      -- cambia: la aptitud de la cuenta depende del destino, así que se
      -- revalida aunque `cuenta_id` no cambie. Si sigue siendo apta se conserva
      -- tal cual; si no, se rechaza (nunca se sustituye por una sugerencia).
      v_validar    := true;
      v_cambio_dest := true;
    ELSIF (NEW.categoria IS DISTINCT FROM OLD.categoria
           OR NEW.destino_tipo IS DISTINCT FROM OLD.destino_tipo
           OR NEW.suministro_id IS DISTINCT FROM OLD.suministro_id)
          AND (OLD.cuenta_origen = 'regla_compra'
               OR (OLD.cuenta_id IS NULL AND OLD.cuenta_origen IS NULL)) THEN
      v_resolver := true;   -- línea automática cuya clasificación cambió
    END IF;
  END IF;

  IF NOT (v_validar OR v_resolver) THEN
    RETURN NEW;
  END IF;

  SELECT o.company_id, o.project_id, o.proveedor_id INTO v_oc
    FROM public.ordenes_compra o WHERE o.id = NEW.orden_compra_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_destino := CASE NEW.destino_tipo
                 WHEN 'servicio' THEN 'gasto'
                 ELSE NEW.destino_tipo END;   -- gasto | inventario | activo_fijo

  IF v_validar THEN
    SELECT * INTO r FROM public.compras_resolver_cuenta_linea_interno(
      v_oc.company_id, v_oc.project_id, v_destino, NEW.categoria, NEW.suministro_id,
      v_oc.proveedor_id, NEW.cuenta_id, CURRENT_DATE);
    IF r.cuenta_id IS NULL THEN
      IF v_cambio_dest THEN
        RAISE EXCEPTION 'COMPRAS_LINEA_DESTINO_INCOMPATIBLE: no se puede cambiar el destino de la línea de «%» a «%» manteniendo la cuenta elegida (%). Elige otra cuenta apta para el nuevo destino, o quítala para que el sistema sugiera una. La cuenta no se cambió por ti.',
          CASE OLD.destino_tipo WHEN 'servicio' THEN 'gasto' ELSE OLD.destino_tipo END, v_destino, r.motivo
          USING ERRCODE = 'check_violation';
      END IF;
      RAISE EXCEPTION 'COMPRAS_LINEA_CUENTA_INVALIDA: %', r.motivo
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.cuenta_origen   := 'linea_explicita';
    NEW.cuenta_regla_id := NULL;
    RETURN NEW;
  END IF;

  -- Resolver: SOLO una regla de compra fija la cuenta; lo demás se deja vacío
  -- para que el posteo siga como hoy. Una regla con la cuenta rota NO se
  -- esconde: se rechaza el guardado con el motivo (no se guarda una cuenta nula
  -- «por si acaso»).
  SELECT * INTO r FROM public.compras_resolver_cuenta_linea_interno(
    v_oc.company_id, v_oc.project_id, v_destino, NEW.categoria, NEW.suministro_id,
    v_oc.proveedor_id, NULL, CURRENT_DATE);

  IF r.origen = 'regla_compra' THEN
    NEW.cuenta_id       := r.cuenta_id;
    NEW.cuenta_origen   := 'regla_compra';
    NEW.cuenta_regla_id := r.regla_id;
  ELSIF r.origen = 'sin_resolver' AND r.regla_id IS NOT NULL THEN
    RAISE EXCEPTION 'COMPRAS_LINEA_REGLA_ROTA: %', r.motivo USING ERRCODE = 'check_violation';
  ELSE
    NEW.cuenta_id       := NULL;
    NEW.cuenta_origen   := NULL;
    NEW.cuenta_regla_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_oc_linea_cuenta() FROM PUBLIC, anon, authenticated;
