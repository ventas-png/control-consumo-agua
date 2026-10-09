-- EN CONSTRUCCIÓN (PR en borrador): ensamblado parcial, aún sin las piezas de aprobación separada, fugas/FK, borrado, índice e idempotencia.
-- NO se ha aplicado a ningún entorno; no despachar al sandbox hasta cerrar el ensamblado y reemplazar esta cabecera.
SET LOCAL lock_timeout = '10s';

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 1 · CONC-01 · orden canónico de bloqueo al pagar y al anular un pago
-- ════════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- [CONC-01] ORDEN CANÓNICO DE BLOQUEO EN PAGAR Y EN ANULAR UN PAGO
--
-- DEFECTO. Pagar una orden de pago bloquea la factura en el BEFORE
-- (compras_tg_orden_pago_controles: FOR UPDATE de la factura) y DESPUÉS toma el folio
-- contable (trg_conta_ordenes_pago → conta_generar_asiento → conta_siguiente_folio):
-- factura → folio. Anular una orden YA pagada salía del BEFORE sin bloquear nada; el
-- AFTER tomaba primero el folio (trg_conta_ordenes_pago → conta_reversar_automatico),
-- luego la fila del asiento original y, al final, la factura
-- (trg_cxp_orden_saldo: FOR UPDATE): folio → asiento → factura. Dos operaciones
-- legítimas simultáneas sobre la misma factura (o sobre contraseñas que comparten una)
-- se interbloqueaban (40P01); el detector abortaba a veces al que PAGABA y el
-- EXCEPTION WHEN OTHERS de conta_generar_asiento lo convertía en un WARNING: pago
-- «pagada» SIN asiento, en silencio.
--
-- CORRECCIÓN (aditiva). Un trigger BEFORE nuevo y pequeño que, en las dos transiciones
-- que mueven saldo y libro (aprobada → pagada, pagada → anulada), toma TODOS los
-- bloqueos del camino en UN solo orden, antes de que cualquier trigger AFTER toque el
-- folio:
--
--        contraseña de pago  →  facturas (por id ascendente)  →  asientos vivos del pago  →  folio
--
-- El nombre `trg_compras_orden_pago_bloqueo` ordena alfabéticamente ANTES de
-- `trg_compras_orden_pago_controles` (que también bloquea la factura, ahora ya bloqueada)
-- y DESPUÉS de los triggers que no bloquean nada. No cambia ninguna validación existente.
--
--   · contraseña: FOR NO KEY UPDATE (el mismo modo que el UPDATE posterior de
--     cxp_tg_orden_saldo; no choca con los FOR KEY SHARE de las llaves foráneas).
--   · facturas de la contraseña: en orden de id (igual que el bucle de controles).
--   · asientos vivos del pago (original y diferencial cambiario): es el orden que ya usan
--     conta_anular_asiento y conta_publicar_asiento (asiento → folio); sin esto, anular el
--     pago tomaba folio → asiento, al revés que ellas.
--
-- Idempotente: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- Revertir: DROP TRIGGER trg_compras_orden_pago_bloqueo ON public.ordenes_pago;
--           DROP FUNCTION public.compras_tg_orden_pago_bloqueo();
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compras_tg_orden_pago_bloqueo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_it record;
BEGIN
  -- Solo las dos transiciones que mueven el saldo de la factura y el libro. Lo demás
  -- (aprobar, anular antes de pagar, notas…) no toca el folio y conserva su camino.
  IF NOT ((OLD.estado = 'aprobada' AND NEW.estado = 'pagada')
       OR (OLD.estado = 'pagada'   AND NEW.estado = 'anulada')) THEN
    RETURN NEW;
  END IF;

  -- Se bloquea por lo que la orden ERA (la llave no cambia fuera de borrador: si alguien
  -- intenta cambiarla, compras_tg_orden_pago_controles lo rechaza justo después).
  IF OLD.contrasena_pago_id IS NOT NULL THEN
    -- 1 · la contraseña
    PERFORM 1 FROM public.contrasenas_pago c WHERE c.id = OLD.contrasena_pago_id FOR NO KEY UPDATE;
    -- 2 · sus facturas, en orden de id
    FOR v_it IN
      SELECT cf.factura_id FROM public.contrasena_pago_facturas cf
       WHERE cf.contrasena_id = OLD.contrasena_pago_id ORDER BY cf.factura_id
    LOOP
      PERFORM 1 FROM public.facturas_proveedor f WHERE f.id = v_it.factura_id FOR UPDATE;
    END LOOP;
  ELSIF OLD.factura_id IS NOT NULL THEN
    -- 2 · la factura
    PERFORM 1 FROM public.facturas_proveedor f WHERE f.id = OLD.factura_id FOR UPDATE;
  END IF;

  -- 3 · al anular un pago ya hecho: sus asientos vivos (el del pago y, si lo hay, el
  --     diferencial cambiario), antes de que el reverso pida el folio.
  IF OLD.estado = 'pagada' THEN
    PERFORM 1 FROM public.conta_asientos a
     WHERE a.company_id = OLD.company_id AND a.origen = 'automatico'
       AND a.origen_tabla = 'ordenes_pago' AND a.origen_id = OLD.id
       AND a.origen_evento IN ('orden_pago_pagada', 'diferencial_cambiario')
       AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
     ORDER BY a.id FOR UPDATE;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.compras_tg_orden_pago_bloqueo() IS
  'CONC-01: orden global de bloqueo al pagar o anular un pago hecho: contraseña → facturas (id asc) → asientos vivos del pago → folio. Evita el interbloqueo factura→folio / folio→factura.';

DROP TRIGGER IF EXISTS trg_compras_orden_pago_bloqueo ON public.ordenes_pago;
CREATE TRIGGER trg_compras_orden_pago_bloqueo
  BEFORE UPDATE OF estado ON public.ordenes_pago
  FOR EACH ROW
  WHEN (OLD.estado IS DISTINCT FROM NEW.estado)
  EXECUTE FUNCTION public.compras_tg_orden_pago_bloqueo();

REVOKE ALL ON FUNCTION public.compras_tg_orden_pago_bloqueo() FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 2 · CONC-04 · un pago no se confirma sin su asiento ni una anulación sin su reverso
-- ════════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- [CONC-04] UN PAGO NO SE CONFIRMA SIN SU ASIENTO, NI UNA ANULACIÓN SIN SU REVERSO
--
-- DEFECTO. conta_generar_asiento y conta_reversar_automatico terminan en
-- EXCEPTION WHEN OTHERS → RAISE WARNING → RETURN NULL («la contabilidad nunca rompe la
-- operación de negocio»). Para facturas, recepciones, cobros… eso se acompaña de una
-- bandeja de pendientes y de reproceso. Para las órdenes de pago NO existe ninguna:
--   · pagar: el pago queda «pagada» y la factura con su monto pagado, pero SIN asiento
--     (falta de mapeo, espera de bloqueo vencida —55P03—, interbloqueo —40P01—,
--     cualquier otra excepción): el libro mayor no refleja un egreso que sí ocurrió;
--   · anular: la orden queda «anulada» y la factura recupera su saldo, pero el asiento
--     original sigue publicado y sin reverso; o, si el pago estaba en borrador por falta de
--     tipo de cambio, el borrador sigue vivo y puede PUBLICARSE después como un egreso de
--     una orden ya anulada.
-- Es decir: un error contable queda oculto detrás de una operación «exitosa».
--
-- POLÍTICA (criterio del dueño: ningún error contable se esconde dejando el pago exitoso).
--   El pago NO se confirma si el libro OPERA y su asiento no quedó:
--     · publicado, cuadrado y sobre cuentas de detalle ACTIVAS de esa contabilidad; o
--     · en borrador marcado «pendiente de tipo de cambio» (diseño vigente, decisión #904:
--       visible en la bandeja de Contabilidad; publicarlo exige el tipo de cambio del mes).
--   «Opera» = la contabilidad (empresa + proyecto) tiene catálogo de cuentas: el mismo
--   criterio con el que conta_generar_asiento decide «esa contabilidad aún no opera; salir
--   sin ruido», y con el que la factura queda aprobada «pendiente» sin romperse.
--   La anulación NO se confirma si algún asiento vivo del pago (el del pago o su diferencial
--   cambiario) queda publicado sin reverso. Un borrador pendiente de tipo de cambio de un
--   pago que se anula se ANULA (nunca tuvo efecto en el libro, igual que conta_anular_asiento
--   con un borrador): así no puede publicarse después. Si el pago estaba «pagada» pero NO
--   tiene asiento (histórico, o libro que no operaba), anularlo sigue permitido: no hay
--   nada que revertir y no se atrapa al usuario.
--
-- CORRECCIÓN (aditiva; NO se toca conta_generar_asiento ni conta_reversar_automatico, que
-- usan facturas, recepciones, cobros y cargos). Un trigger AFTER nuevo que verifica la
-- POSTCONDICIÓN después de trg_conta_ordenes_pago y antes de trg_cxp_orden_saldo (orden
-- alfabético: trg_conta_ordenes_pago < trg_conta_ordenes_pago_verificar < trg_cxp_orden_saldo).
-- Si no se cumple, RAISE EXCEPTION: la transacción entera se revierte (orden, saldo de la
-- factura, contraseña), sin importar qué se tragó el EXCEPTION WHEN OTHERS de adentro.
-- Aplica igual a service_role y a procesos (no depende de la sesión del usuario).
--
--   COMPRAS_PAGO_SIN_ASIENTO        el pago no dejó su asiento (con el motivo diagnosticado)
--   COMPRAS_PAGO_REVERSO_FALLIDO    la anulación dejó un asiento del pago publicado sin reverso
--
-- Idempotente: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- Revertir: DROP TRIGGER trg_conta_ordenes_pago_verificar ON public.ordenes_pago;
--           DROP FUNCTION public.conta_tg_ordenes_pago_verificar();
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.conta_tg_ordenes_pago_verificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_a      public.conta_asientos;
  v_metodo text;
  v_motivo text;
  v_n      integer;
  v_lista  text;
BEGIN
  -- ── PAGAR ─────────────────────────────────────────────────────────────────
  IF NEW.estado = 'pagada' AND OLD.estado IS DISTINCT FROM 'pagada' THEN
    -- Una contabilidad sin catálogo aún no opera (mismo criterio que conta_generar_asiento).
    IF NOT EXISTS (SELECT 1 FROM public.conta_cuentas c
                    WHERE c.company_id = NEW.company_id AND c.project_id IS NOT DISTINCT FROM NEW.project_id) THEN
      RETURN NEW;
    END IF;

    SELECT * INTO v_a FROM public.conta_asientos a
     WHERE a.company_id = NEW.company_id AND a.origen = 'automatico'
       AND a.origen_tabla = 'ordenes_pago' AND a.origen_id = NEW.id
       AND a.origen_evento = 'orden_pago_pagada'
       AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL;

    IF NOT FOUND THEN
      v_metodo := CASE NEW.metodo_pago
        WHEN 'efectivo'      THEN 'metodo_efectivo'
        WHEN 'transferencia' THEN 'metodo_transferencia'
        WHEN 'deposito'      THEN 'metodo_deposito'
        WHEN 'cheque'        THEN 'metodo_cheque'
        WHEN 'tarjeta'       THEN 'metodo_tarjeta'
        ELSE 'metodo_otro'
      END;
      IF public.conta_cuenta_para(NEW.company_id, NEW.project_id, 'cxp_proveedores') IS NULL THEN
        v_motivo := 'falta la cuenta mapeada de «Cuentas por pagar a proveedores» (cxp_proveedores) en esta contabilidad; configúrala en Contabilidad › Configuración y reintenta';
      ELSIF public.conta_cuenta_para(NEW.company_id, NEW.project_id, v_metodo) IS NULL THEN
        v_motivo := format('falta la cuenta mapeada del método de pago (%s) en esta contabilidad; configúrala en Contabilidad › Configuración y reintenta', v_metodo);
      ELSE
        v_motivo := 'el generador de asientos no pudo registrarlo (espera de bloqueo vencida, interbloqueo u otro error del servidor): reintenta; si persiste, avisa a Contabilidad';
      END IF;
      RAISE EXCEPTION 'COMPRAS_PAGO_SIN_ASIENTO: la orden de pago NO se marcó pagada porque su asiento contable no quedó registrado: %. No se guardó nada (ni el pago ni el saldo de la factura).', v_motivo
        USING ERRCODE = 'check_violation';
    END IF;

    -- Hay asiento: ¿es uno que cuenta? Publicado y cuadrado, o borrador pendiente de tipo de cambio.
    IF NOT ((v_a.estado = 'publicado' AND v_a.total_debe > 0 AND v_a.total_debe = v_a.total_haber)
         OR (v_a.estado = 'borrador'  AND v_a.tipo_cambio_pendiente)) THEN
      RAISE EXCEPTION 'COMPRAS_PAGO_SIN_ASIENTO: la orden de pago NO se marcó pagada porque su asiento quedó «%» con debe % / haber %; solo cuenta un asiento publicado y cuadrado, o en borrador pendiente de tipo de cambio. No se guardó nada.',
        v_a.estado, v_a.total_debe, v_a.total_haber
        USING ERRCODE = 'check_violation';
    END IF;

    -- Las mismas reglas con las que conta_publicar_asiento acepta un asiento: cuentas de detalle,
    -- activas y de ESTA contabilidad (el generador no las comprueba en las cuentas mapeadas).
    SELECT count(*), string_agg(DISTINCT c.codigo, ', ') INTO v_n, v_lista
      FROM public.conta_asiento_lineas l
      JOIN public.conta_cuentas c ON c.id = l.cuenta_id
     WHERE l.asiento_id = v_a.id
       AND (NOT c.es_detalle OR NOT c.activa
            OR c.company_id <> v_a.company_id OR c.project_id IS DISTINCT FROM v_a.project_id);
    IF v_n > 0 THEN
      RAISE EXCEPTION 'COMPRAS_PAGO_SIN_ASIENTO: la orden de pago NO se marcó pagada porque su asiento usa cuentas no válidas (agrupadoras, inactivas o de otra contabilidad): %. Corrige el mapeo en Contabilidad › Configuración y reintenta. No se guardó nada.', v_lista
        USING ERRCODE = 'check_violation';
    END IF;

  -- ── ANULAR UN PAGO YA HECHO ───────────────────────────────────────────────
  ELSIF NEW.estado = 'anulada' AND OLD.estado = 'pagada' THEN
    -- Un borrador (pendiente de tipo de cambio) nunca tuvo efecto en el libro: se anula, como
    -- hace conta_anular_asiento con un borrador, para que no pueda publicarse después.
    UPDATE public.conta_asientos a
       SET estado = 'anulado', updated_at = now()
     WHERE a.company_id = NEW.company_id AND a.origen = 'automatico'
       AND a.origen_tabla = 'ordenes_pago' AND a.origen_id = NEW.id
       AND a.origen_evento IN ('orden_pago_pagada', 'diferencial_cambiario')
       AND a.estado = 'borrador';

    -- Ningún asiento PUBLICADO del pago puede quedar sin reverso.
    SELECT count(*), string_agg(a.origen_evento || ' #' || COALESCE(a.numero::text, '?'), ', ')
      INTO v_n, v_lista
      FROM public.conta_asientos a
     WHERE a.company_id = NEW.company_id AND a.origen = 'automatico'
       AND a.origen_tabla = 'ordenes_pago' AND a.origen_id = NEW.id
       AND a.origen_evento IN ('orden_pago_pagada', 'diferencial_cambiario')
       AND a.estado = 'publicado' AND a.anulado_por_id IS NULL;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'COMPRAS_PAGO_REVERSO_FALLIDO: la orden de pago NO se anuló porque el reverso de su asiento (%) no quedó registrado (espera de bloqueo vencida, interbloqueo u otro error del servidor): reintenta; si persiste, avisa a Contabilidad. No se guardó nada.', v_lista
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.conta_tg_ordenes_pago_verificar() IS
  'CONC-04: postcondición contable de la orden de pago. Pagar exige su asiento (publicado, o borrador pendiente de tipo de cambio) si la contabilidad opera; anular exige el reverso de todo asiento publicado del pago y anula sus borradores. Falla la transacción entera con COMPRAS_PAGO_SIN_ASIENTO / COMPRAS_PAGO_REVERSO_FALLIDO.';

DROP TRIGGER IF EXISTS trg_conta_ordenes_pago_verificar ON public.ordenes_pago;
CREATE TRIGGER trg_conta_ordenes_pago_verificar
  AFTER UPDATE OF estado ON public.ordenes_pago
  FOR EACH ROW
  WHEN (OLD.estado IS DISTINCT FROM NEW.estado
        AND (NEW.estado = 'pagada' OR (NEW.estado = 'anulada' AND OLD.estado = 'pagada')))
  EXECUTE FUNCTION public.conta_tg_ordenes_pago_verificar();

REVOKE ALL ON FUNCTION public.conta_tg_ordenes_pago_verificar() FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 3 · CONC-02 · una contraseña no se paga dos veces (bloqueo + índice cuando el dato lo permite)
-- ════════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- [CONC-02] UNA CONTRASEÑA TIENE A LO MÁS UNA ORDEN DE PAGO VIVA, Y SE PAGA UNA SOLA VEZ
--
-- DEFECTO  El estado de la contraseña y «¿ya tiene una orden viva?» se leían SIN bloquear
--          (compras_tg_orden_contrasena, compras_tg_orden_pago_controles). Dos sesiones
--          simultáneas ven «emitida y sin orden» y entran las dos; si ya hay dos órdenes
--          vivas, las dos se pagan (la factura queda con el doble de lo autorizado y hay dos
--          asientos). ordenes_pago no tenía unicidad por contraseña.
--
-- CORRECCIÓN (solo se AÑADE; no se relaja ni se reescribe ningún control existente)
--   1. Trigger BEFORE nuevo, que dispara ANTES que los demás de la tabla por su nombre
--      (trg_compras_bloqueo_… < trg_compras_orden_contrasena < trg_compras_orden_pago_…):
--      bloquea la fila de la CONTRASEÑA (FOR UPDATE) cuando la operación crea, aprueba, paga,
--      anula o re-apunta una orden de contraseña. Todo lo que los triggers siguientes leen
--      (estado, total, órdenes vivas) se lee ya con la contraseña bloqueada y, en READ
--      COMMITTED, con una instantánea fresca: la segunda sesión espera a que la primera
--      termine y entonces ve «pagada» (COMPRAS_CONTRASENA_CERRADA) o ve la orden viva
--      (COMPRAS_CONTRASENA_YA_TIENE_ORDEN). Orden global de bloqueo:
--         contraseña → facturas (por id ascendente, lo hace compras_tg_orden_pago_controles)
--         → folio contable (lo toma el asiento, AFTER). Anular una orden pagada también toma
--         primero la contraseña (antes: facturas → contraseña, la inversa).
--   2. El mismo trigger cubre lo que el EXISTS de INSERT no cubría: RE-APUNTAR un borrador a
--      otra contraseña (UPDATE de contrasena_pago_id) → misma exclusividad y contraseña emitida.
--   3. Índice único PARCIAL como red de seguridad (una orden no anulada por contraseña), creado
--      SOLO si no hay duplicados históricos: si los hay, NO se detiene el despliegue; avisa con
--      un WARNING que lista las contraseñas y la protección queda a cargo del trigger (que ya es
--      completa: con el bloqueo no hace falta el índice para serializar).
--
-- POR QUÉ ASÍ (frente a «solo índice único»)
--   · El índice único solo cubre «dos vivas»; NO arregla que el estado de la contraseña se lea
--     sin bloqueo (CONC-02 fase 3 y CONC-03). Y un CREATE UNIQUE INDEX falla si ya hay duplicados:
--     en producción tumbaría toda la migración. El trigger con bloqueo es seguro de desplegar y
--     completo; el índice es defensa en profundidad cuando el dato lo permite.
--   · El bloqueo se toma solo cuando la operación puede cambiar el destino del dinero (alta,
--     estado, contraseña, monto, proveedor, proyecto, empresa): actualizar `notas` o la
--     conciliación de una orden ya pagada no espera a nadie.
--
-- IMPACTO EN DATOS EXISTENTES: ninguno (solo restringe INSERT/UPDATE nuevos). Si hay contraseñas con
--   dos órdenes vivas hoy, siguen ahí: el primer pago cierra la contraseña y el segundo se rechaza.
-- IDEMPOTENTE · REVERTIR: DROP TRIGGER trg_compras_bloqueo_orden_pago ON public.ordenes_pago;
--   DROP FUNCTION public.compras_tg_bloqueo_orden_pago(); DROP INDEX IF EXISTS public.uq_ordenes_pago_contrasena_viva;
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compras_tg_bloqueo_orden_pago()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_ids uuid[];
  v_id  uuid;
  v_c   public.contrasenas_pago;
BEGIN
  -- [CONC-02] ¿Esta operación toca el destino del dinero de una orden de contraseña?
  IF TG_OP = 'INSERT' THEN
    IF NEW.contrasena_pago_id IS NULL THEN
      RETURN NEW;
    END IF;
    v_ids := ARRAY[NEW.contrasena_pago_id];
  ELSE
    IF OLD.contrasena_pago_id IS NULL AND NEW.contrasena_pago_id IS NULL THEN
      RETURN NEW;
    END IF;
    IF NEW.estado             IS NOT DISTINCT FROM OLD.estado
       AND NEW.contrasena_pago_id IS NOT DISTINCT FROM OLD.contrasena_pago_id
       AND NEW.monto          IS NOT DISTINCT FROM OLD.monto
       AND NEW.proveedor_id   IS NOT DISTINCT FROM OLD.proveedor_id
       AND NEW.project_id     IS NOT DISTINCT FROM OLD.project_id
       AND NEW.company_id     IS NOT DISTINCT FROM OLD.company_id THEN
      RETURN NEW;
    END IF;
    -- Siempre en orden de id (si se re-apunta de una contraseña a otra, dos sesiones no se cruzan).
    SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::uuid[]) INTO v_ids
      FROM (SELECT DISTINCT x FROM unnest(ARRAY[OLD.contrasena_pago_id, NEW.contrasena_pago_id]) AS x WHERE x IS NOT NULL) s;
  END IF;

  -- [CONC-02] Bloqueo de la contraseña ANTES de leer su estado / total / órdenes vivas. Si otra sesión la
  -- tiene bloqueada (crea o paga otra orden, anula, edita partidas), esta espera y luego lee lo ya confirmado.
  -- Solo se bloquea una contraseña DE LA MISMA EMPRESA de la orden: una referencia ajena la rechaza
  -- COMPRAS_PAGO_CONTRASENA_AJENA sin que quien la manda pueda retener un bloqueo sobre filas de otra empresa.
  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM 1 FROM public.contrasenas_pago c WHERE c.id = v_id AND c.company_id = NEW.company_id FOR UPDATE;
  END LOOP;

  -- [CONC-02] Re-apuntar un BORRADOR a otra contraseña: la misma exclusividad que el INSERT
  -- (compras_tg_orden_contrasena solo la comprueba al insertar). Se excluye el resto de transiciones
  -- para no cambiar el código de error de los controles existentes (inmutabilidad, transición inválida).
  IF TG_OP = 'UPDATE'
     AND OLD.estado = 'borrador'
     AND NEW.estado <> 'anulada'
     AND NEW.contrasena_pago_id IS NOT NULL
     AND NEW.contrasena_pago_id IS DISTINCT FROM OLD.contrasena_pago_id THEN
    SELECT * INTO v_c FROM public.contrasenas_pago c WHERE c.id = NEW.contrasena_pago_id AND c.company_id = NEW.company_id;
    IF FOUND THEN
      IF v_c.estado <> 'emitida' THEN
        RAISE EXCEPTION 'COMPRAS_CONTRASENA_CERRADA: la contraseña % está «%» y no admite otra orden de pago.', COALESCE(v_c.numero, v_c.id::text), v_c.estado
          USING ERRCODE = 'check_violation';
      END IF;
      IF EXISTS (SELECT 1 FROM public.ordenes_pago o
                  WHERE o.contrasena_pago_id = NEW.contrasena_pago_id AND o.estado <> 'anulada' AND o.id <> NEW.id) THEN
        RAISE EXCEPTION 'COMPRAS_CONTRASENA_YA_TIENE_ORDEN: la contraseña % ya tiene una orden de pago viva.', COALESCE(v_c.numero, v_c.id::text)
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.compras_tg_bloqueo_orden_pago() IS
  'CONC-02: bloquea la contraseña (FOR UPDATE) antes de que los demás controles de ordenes_pago lean su estado, total y órdenes vivas; orden global de bloqueo contraseña → facturas → folio. Exclusividad también al re-apuntar un borrador.';

DROP TRIGGER IF EXISTS trg_compras_bloqueo_orden_pago ON public.ordenes_pago;
CREATE TRIGGER trg_compras_bloqueo_orden_pago
  BEFORE INSERT OR UPDATE ON public.ordenes_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_bloqueo_orden_pago();

REVOKE ALL ON FUNCTION public.compras_tg_bloqueo_orden_pago() FROM PUBLIC, anon, authenticated;

-- [CONC-02] Red de seguridad: una orden no anulada por contraseña. Solo si el dato histórico lo permite.
DO $$
DECLARE
  v_dup text;
BEGIN
  SELECT string_agg(contrasena_pago_id::text || ' (' || n || ' órdenes vivas)', '; ' ORDER BY contrasena_pago_id) INTO v_dup
    FROM (SELECT contrasena_pago_id, count(*) AS n
            FROM public.ordenes_pago
           WHERE contrasena_pago_id IS NOT NULL AND estado <> 'anulada'
           GROUP BY contrasena_pago_id HAVING count(*) > 1) d;
  IF v_dup IS NOT NULL THEN
    RAISE WARNING 'CONC-02: NO se crea uq_ordenes_pago_contrasena_viva porque hay contraseñas con más de una orden de pago viva: %. La exclusividad la sigue garantizando el trigger trg_compras_bloqueo_orden_pago; resuelve esos duplicados (anula las órdenes sobrantes) y vuelve a aplicar esta sentencia.', v_dup;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_ordenes_pago_contrasena_viva
      ON public.ordenes_pago (contrasena_pago_id)
      WHERE contrasena_pago_id IS NOT NULL AND estado <> 'anulada';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 4 · CONC-03 · las partidas de una contraseña no se editan mientras se paga
-- ════════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- [CONC-03] LAS PARTIDAS DE UNA CONTRASEÑA NO CAMBIAN MIENTRAS SE PAGA SU ORDEN
--
-- DEFECTO  compras_tg_contrasena_factura lee la contraseña SIN bloquearla: mientras la orden de
--          pago espera (p. ej. el folio contable del asiento) la contraseña sigue «emitida» y
--          una edición de partida entra. cxp_tg_orden_saldo, ya en el AFTER del pago, vuelve a
--          leer las partidas sin bloqueo y aplica a las facturas las NUEVAS (900), no las que
--          validó el control (100): la factura queda con más pagado que la orden y el asiento.
--
-- CORRECCIÓN  Trigger BEFORE nuevo sobre contrasena_pago_facturas que dispara ANTES del trigger
--          existente (trg_compras_bloqueo_partida < trg_compras_contrasena_factura): bloquea la
--          fila de la CONTRASEÑA (FOR UPDATE) —el mismo bloqueo que toma el pago en
--          trg_compras_bloqueo_orden_pago (CONC-02)—, y con ella bloqueada exige que siga
--          «emitida». La edición que llega mientras se paga espera a que el pago termine y
--          entonces recibe COMPRAS_CONTRASENA_CERRADA. Se bloquean todas las contraseñas que la
--          fila toca (origen y destino) en orden de id. DELETE solo toma el bloqueo (si se
--          puede borrar lo sigue decidiendo trg_compras_no_borrar_partida, con su código).
--          Cubre también el hueco simétrico: antes solo se miraba el estado de la contraseña
--          DESTINO; una partida de una contraseña pagada o anulada ya no puede salir hacia otra.
--
-- DEPENDE DE  CONC-02.fix.sql (el lado del pago toma el mismo bloqueo). Orden global:
--          contraseña → facturas (id ascendente) → folio contable.
-- NO CAMBIA  compras_tg_contrasena_factura (ni su cálculo del total, ni sus códigos de error).
-- IMPACTO EN DATOS EXISTENTES: ninguno.
-- IDEMPOTENTE · REVERTIR: DROP TRIGGER trg_compras_bloqueo_partida ON public.contrasena_pago_facturas;
--   DROP FUNCTION public.compras_tg_bloqueo_partida();
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compras_tg_bloqueo_partida()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_ids uuid[];
  v_id  uuid;
  v_c   record;
  v_company uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.company_id ELSE NEW.company_id END;
BEGIN
  -- [CONC-03] Contraseñas que esta fila toca, siempre en orden de id.
  SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::uuid[]) INTO v_ids
    FROM (SELECT DISTINCT x
            FROM unnest(CASE TG_OP
                          WHEN 'INSERT' THEN ARRAY[NEW.contrasena_id]
                          WHEN 'DELETE' THEN ARRAY[OLD.contrasena_id]
                          ELSE ARRAY[OLD.contrasena_id, NEW.contrasena_id]
                        END) AS x
           WHERE x IS NOT NULL) s;

  -- [CONC-03] Bloqueo ANTES de leer el estado. Un pago en curso (o una anulación) de esa contraseña
  -- lo tiene tomado: esta sesión espera y después lee lo confirmado. Una contraseña que ya no existe
  -- (borrado en cascada) o que es de otra empresa (la rechaza COMPRAS_ALCANCE_PARTIDA) no devuelve fila.
  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM 1 FROM public.contrasenas_pago c WHERE c.id = v_id AND c.company_id = v_company FOR UPDATE;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- Una escritura que no cambia nada de la partida no pide nada más (solo esperó el bloqueo).
  IF TG_OP = 'UPDATE'
     AND NEW.contrasena_id IS NOT DISTINCT FROM OLD.contrasena_id
     AND NEW.factura_id    IS NOT DISTINCT FROM OLD.factura_id
     AND NEW.monto         IS NOT DISTINCT FROM OLD.monto THEN
    RETURN NEW;
  END IF;

  -- [CONC-03] Solo una contraseña EMITIDA admite cambios en sus partidas (la de origen también).
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT c.estado, c.numero, c.id INTO v_c FROM public.contrasenas_pago c WHERE c.id = v_id AND c.company_id = v_company;
    IF FOUND AND v_c.estado <> 'emitida' THEN
      RAISE EXCEPTION 'COMPRAS_CONTRASENA_CERRADA: la contraseña % está % y ya no admite cambios.', COALESCE(v_c.numero, v_c.id::text), v_c.estado
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.compras_tg_bloqueo_partida() IS
  'CONC-03: bloquea la contraseña (FOR UPDATE) antes de que se valide una partida y exige que siga emitida; un pago en curso la tiene tomada, así que la edición espera y recibe COMPRAS_CONTRASENA_CERRADA.';

DROP TRIGGER IF EXISTS trg_compras_bloqueo_partida ON public.contrasena_pago_facturas;
CREATE TRIGGER trg_compras_bloqueo_partida
  BEFORE INSERT OR UPDATE OR DELETE ON public.contrasena_pago_facturas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_bloqueo_partida();

REVOKE ALL ON FUNCTION public.compras_tg_bloqueo_partida() FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 5 · EV-01 · la orden de pago por contraseña es del mismo proveedor y proyecto que la contraseña y sus facturas
-- ════════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- [EV-01] LA ORDEN DE PAGO DE UNA CONTRASEÑA ES DEL MISMO PROVEEDOR Y DE LA MISMA CONTABILIDAD
--         QUE LA CONTRASEÑA Y QUE TODAS SUS FACTURAS
--
-- DEFECTO  La rama de contraseña de compras_tg_orden_pago_controles solo compara la EMPRESA.
--          compras_tg_orden_contrasena fuerza proveedor/proyecto solo en INSERT, así que un
--          UPDATE del borrador (o un UPDATE de la propia contraseña, que ya tiene partidas)
--          los cambia; el asiento del pago se publica con el project_id de la ORDEN: la CxP
--          del proyecto de la factura nunca se descarga y la otra contabilidad queda con un
--          cargo sin devengo. La rama de factura directa sí lo rechaza (COMPRAS_PAGO_FACTURA_AJENA).
--          Mismo vector con la MONEDA de la contraseña: el asiento la toma de la cabecera
--          (cambiarla a USD publica 1 000 USD = 7 750 GTQ por una factura de 1 000 GTQ).
--
-- CORRECCIÓN (se AÑADEN dos triggers; no se toca ningún control existente)
--   A. compras_tg_orden_pago_controles_contrasena · BEFORE INSERT OR UPDATE sobre ordenes_pago.
--      Dispara DESPUÉS de trg_compras_orden_contrasena (que en INSERT hereda proveedor/proyecto
--      de la contraseña, comportamiento vigente que se conserva) y de
--      trg_compras_orden_pago_controles (así el orden de los errores existentes no cambia).
--      Al CREAR, al CAMBIAR el destino/monto/proveedor/proyecto de un borrador, al APROBAR y al
--      PAGAR exige: proveedor y proyecto de la orden = los de la contraseña, y los de CADA
--      factura de sus partidas (misma empresa, proveedor y contabilidad). Los factores se leen con
--      la contraseña ya bloqueada (CONC-02) y, al pagar, con las facturas ya bloqueadas por el
--      control de pago.
--   B. compras_tg_contrasena_cabecera_fija · BEFORE UPDATE OF company_id, project_id, proveedor_id,
--      moneda sobre contrasenas_pago: con partidas o con una orden de pago no anulada, la cabecera
--      de alcance de la contraseña no cambia. Una contraseña VACÍA sí puede corregirse. La
--      cascada ON DELETE SET NULL de la purga de un proyecto no se bloquea (el proyecto ya no existe).
--
-- NO HACE  No decide qué moneda debe llevar una contraseña al emitirla ni exige que coincida con la
--          de sus facturas (regla de negocio multimoneda: ver notas). Solo impide cambiarla después.
-- IMPACTO EN DATOS EXISTENTES: ninguno (restringe INSERT/UPDATE nuevos).
-- IDEMPOTENTE · REVERTIR: DROP TRIGGER trg_compras_orden_pago_controles_contrasena ON public.ordenes_pago;
--   DROP TRIGGER trg_compras_contrasena_cabecera_fija ON public.contrasenas_pago;
--   DROP FUNCTION public.compras_tg_orden_pago_controles_contrasena(), public.compras_tg_contrasena_cabecera_fija();
-- ════════════════════════════════════════════════════════════════════════════

-- ── A. Coherencia orden ↔ contraseña ↔ facturas ─────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_orden_pago_controles_contrasena()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_c      public.contrasenas_pago;
  v_it     record;
  v_valida boolean;
BEGIN
  IF NEW.contrasena_pago_id IS NULL OR NEW.estado = 'anulada' THEN
    RETURN NEW;
  END IF;

  -- [EV-01] Cuándo se vuelve a comprobar: al crear, al aprobar, al pagar y cuando un borrador cambia de
  -- contraseña, monto, proveedor, proyecto o empresa.
  v_valida := TG_OP = 'INSERT'
           OR (NEW.estado = 'aprobada' AND OLD.estado <> 'aprobada')
           OR (NEW.estado = 'pagada'   AND OLD.estado <> 'pagada')
           OR (OLD.estado = 'borrador'
               AND (NEW.contrasena_pago_id IS DISTINCT FROM OLD.contrasena_pago_id
                 OR NEW.monto              IS DISTINCT FROM OLD.monto
                 OR NEW.proveedor_id       IS DISTINCT FROM OLD.proveedor_id
                 OR NEW.project_id         IS DISTINCT FROM OLD.project_id
                 OR NEW.company_id         IS DISTINCT FROM OLD.company_id));
  IF NOT v_valida THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_c FROM public.contrasenas_pago c WHERE c.id = NEW.contrasena_pago_id;
  IF NOT FOUND THEN
    RETURN NEW;   -- la FK rechaza la fila
  END IF;

  IF v_c.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'COMPRAS_PAGO_CONTRASENA_AJENA: la contraseña no pertenece a la empresa de la orden de pago.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_c.proveedor_id <> NEW.proveedor_id THEN
    RAISE EXCEPTION 'COMPRAS_PAGO_CONTRASENA_AJENA: la orden de pago es de otro proveedor que la contraseña %.', COALESCE(v_c.numero, v_c.id::text)
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_c.project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'COMPRAS_PAGO_CONTRASENA_AJENA: la orden de pago es de otra contabilidad (proyecto o empresa) que la contraseña %.', COALESCE(v_c.numero, v_c.id::text)
      USING ERRCODE = 'check_violation';
  END IF;

  -- [EV-01] Todas las facturas que la contraseña cubre: mismo proveedor y misma contabilidad que la orden
  -- (el asiento del pago sale con los de la orden; si divergen, la CxP de la factura no se descarga).
  FOR v_it IN
    SELECT cf.factura_id, f.numero_factura, f.company_id, f.proveedor_id, f.project_id
      FROM public.contrasena_pago_facturas cf
      JOIN public.facturas_proveedor f ON f.id = cf.factura_id
     WHERE cf.contrasena_id = NEW.contrasena_pago_id
     ORDER BY cf.factura_id
  LOOP
    IF v_it.company_id <> NEW.company_id
       OR v_it.proveedor_id <> NEW.proveedor_id
       OR v_it.project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'COMPRAS_PAGO_CONTRASENA_AJENA: la factura % de la contraseña es de otro proveedor o de otra contabilidad (proyecto o empresa) que la orden de pago.',
        COALESCE(v_it.numero_factura, v_it.factura_id::text)
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.compras_tg_orden_pago_controles_contrasena() IS
  'EV-01: la orden de pago de una contraseña tiene el proveedor y la contabilidad de la contraseña y de TODAS sus facturas (alta, cambio de un borrador, aprobación y pago). La rama de factura directa ya lo exigía.';

DROP TRIGGER IF EXISTS trg_compras_orden_pago_controles_contrasena ON public.ordenes_pago;
CREATE TRIGGER trg_compras_orden_pago_controles_contrasena
  BEFORE INSERT OR UPDATE ON public.ordenes_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_orden_pago_controles_contrasena();

REVOKE ALL ON FUNCTION public.compras_tg_orden_pago_controles_contrasena() FROM PUBLIC, anon, authenticated;

-- ── B. La cabecera de alcance de una contraseña con partidas u orden viva no cambia ─────────
CREATE OR REPLACE FUNCTION public.compras_tg_contrasena_cabecera_fija()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.company_id   IS NOT DISTINCT FROM OLD.company_id
     AND NEW.project_id   IS NOT DISTINCT FROM OLD.project_id
     AND NEW.proveedor_id IS NOT DISTINCT FROM OLD.proveedor_id
     AND NEW.moneda       IS NOT DISTINCT FROM OLD.moneda THEN
    RETURN NEW;
  END IF;

  -- Cascada de la purga de un proyecto (ON DELETE SET NULL): el proyecto ya no existe, no es una edición.
  IF OLD.project_id IS NOT NULL AND NEW.project_id IS NULL
     AND NEW.company_id   IS NOT DISTINCT FROM OLD.company_id
     AND NEW.proveedor_id IS NOT DISTINCT FROM OLD.proveedor_id
     AND NEW.moneda       IS NOT DISTINCT FROM OLD.moneda
     AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id) THEN
    RETURN NEW;
  END IF;

  -- La fila ya está bloqueada por este UPDATE; una orden o una partida nuevas esperan a que termine.
  IF EXISTS (SELECT 1 FROM public.contrasena_pago_facturas cf WHERE cf.contrasena_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.ordenes_pago o WHERE o.contrasena_pago_id = OLD.id AND o.estado <> 'anulada') THEN
    RAISE EXCEPTION 'COMPRAS_CONTRASENA_CABECERA_FIJA: la contraseña % ya tiene partidas u orden de pago: su empresa, proveedor, contabilidad y moneda no cambian. Anula la contraseña y emite otra.',
      COALESCE(OLD.numero, OLD.id::text)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.compras_tg_contrasena_cabecera_fija() IS
  'EV-01: con partidas o con una orden de pago no anulada, la empresa, el proveedor, la contabilidad y la moneda de la contraseña no cambian (el asiento del pago las toma de la cabecera).';

DROP TRIGGER IF EXISTS trg_compras_contrasena_cabecera_fija ON public.contrasenas_pago;
CREATE TRIGGER trg_compras_contrasena_cabecera_fija
  BEFORE UPDATE OF company_id, project_id, proveedor_id, moneda ON public.contrasenas_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_contrasena_cabecera_fija();

REVOKE ALL ON FUNCTION public.compras_tg_contrasena_cabecera_fija() FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 6 · EV-02 · el total de la contraseña lo deriva el servidor y la orden paga lo que suman las partidas
-- ════════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- [EV-02] EL TOTAL DE LA CONTRASEÑA LO CALCULA EL SERVIDOR · LA ORDEN SE ATA A LAS PARTIDAS
--
-- DEFECTO  contrasenas_pago.total es editable a mano (UPDATE directo, o INSERT con total).
--          compras_tg_orden_contrasena ata la orden a ESE total, no a la suma de las partidas;
--          cxp_tg_orden_saldo aplica a las facturas las PARTIDAS (1 000) y el asiento sale por el
--          monto de la orden (1,00). Además las partidas se pueden insertar / actualizar / mover
--          con una orden viva, y mover una partida deja el total del ORIGEN viejo y calcula mal el
--          del destino (compras_tg_contrasena_factura resta OLD.monto de un destino que no lo tiene).
--
-- CORRECCIÓN (solo se AÑADE; el trigger de partidas que recalcula el total no se toca)
--   A. compras_tg_contrasena_total_derivado · BEFORE INSERT OR UPDATE OF total sobre contrasenas_pago.
--      Una sesión de usuario no cambia el total (UPDATE → COMPRAS_CONTRASENA_TOTAL_DERIVADO) y el que
--      capture al insertar se IGNORA (queda en 0 hasta que haya partidas): el único que lo escribe es el
--      trigger de partidas (se reconoce porque corre anidado: pg_trigger_depth() > 1). Reescribir el
--      MISMO valor no es un cambio. Sin sesión de usuario (service_role, procesos) no se aplica: ahí lo
--      protege B (la orden se ata a las partidas, no al total).
--   B. compras_tg_orden_pago_controles_partidas · BEFORE INSERT OR UPDATE sobre ordenes_pago, después
--      del control de pago: al CREAR, APROBAR o PAGAR una orden de contraseña, SUM(partidas) = monto =
--      total (COMPRAS_PAGO_PARTIDAS_DISTINTAS). Cubre el dato alterado por cualquier camino y la
--      contraseña sin partidas con un total inventado (pago sin factura). Al pagar se lee con la
--      contraseña bloqueada (CONC-02) y las partidas no se mueven (C).
--   C. compras_tg_bloqueo_partida_orden · BEFORE INSERT OR UPDATE sobre contrasena_pago_facturas,
--      justo después del bloqueo de CONC-03 y antes del trigger de partidas existente: con una orden de
--      pago NO anulada sobre la contraseña (borrador, aprobada o pagada) no se insertan ni se
--      actualizan partidas (COMPRAS_CONTRASENA_CON_ORDEN; DELETE ya lo cubría
--      trg_compras_no_borrar_partida). Una partida no cambia de contraseña (COMPRAS_CONTRASENA_PARTIDA_FIJA):
--      se borra y se agrega en la otra, que recalcula bien los dos totales. Anulada la orden, las
--      partidas vuelven a ser editables.
--
-- DEPENDE DE  CONC-03.fix.sql (bloqueo de la contraseña antes de leer sus órdenes) y CONC-02.fix.sql.
-- NO HACE  No impone topes de monto ni reglas de autoaprobación.
-- IMPACTO EN DATOS EXISTENTES: ninguno. Contraseñas con total ≠ suma de partidas ya existentes (si las
--   hay) quedan sin poder pagarse hasta que se corrijan; ver el diagnóstico sugerido en las notas.
-- IDEMPOTENTE · REVERTIR: DROP TRIGGER … y DROP FUNCTION de las tres funciones.
-- ════════════════════════════════════════════════════════════════════════════

-- ── A. El total no se escribe a mano ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_contrasena_total_derivado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  -- [EV-02] Al insertar, el total de una contraseña nueva (sin partidas) es 0: lo que el cliente mande se
  -- ignora y el trigger de partidas lo calcula al agregar cada una. No rechaza (ningún flujo legítimo manda
  -- total) para no romper cargas que lo traen en el INSERT; lo que importa es que NO quede un total
  -- capturado sin partidas que lo respalden.
  IF TG_OP = 'INSERT' THEN
    NEW.total := 0;
    RETURN NEW;
  END IF;

  IF NEW.total IS NOT DISTINCT FROM OLD.total THEN
    RETURN NEW;
  END IF;
  -- [EV-02] El recálculo legítimo lo hace compras_tg_contrasena_factura (trigger de partidas): corre
  -- anidado. Una escritura directa de la sesión corre al nivel 1.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'COMPRAS_CONTRASENA_TOTAL_DERIVADO: el total de la contraseña % lo calcula el servidor con sus partidas; no se edita a mano.',
    COALESCE(OLD.numero, OLD.id::text)
    USING ERRCODE = 'check_violation';
END;
$$;

COMMENT ON FUNCTION public.compras_tg_contrasena_total_derivado() IS
  'EV-02: el total de la contraseña lo escribe solo el recálculo de partidas; una sesión de usuario no lo cambia (UPDATE) y el que capture al insertar se ignora (queda en 0 hasta que haya partidas).';

DROP TRIGGER IF EXISTS trg_compras_contrasena_total_derivado ON public.contrasenas_pago;
CREATE TRIGGER trg_compras_contrasena_total_derivado
  BEFORE INSERT OR UPDATE OF total ON public.contrasenas_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_contrasena_total_derivado();

REVOKE ALL ON FUNCTION public.compras_tg_contrasena_total_derivado() FROM PUBLIC, anon, authenticated;

-- ── B. La orden de la contraseña = suma de sus partidas = total ─────────────
CREATE OR REPLACE FUNCTION public.compras_tg_orden_pago_controles_partidas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_c     public.contrasenas_pago;
  v_suma  numeric(14,2);
BEGIN
  IF NEW.contrasena_pago_id IS NULL OR NEW.estado = 'anulada' THEN
    RETURN NEW;
  END IF;
  IF NOT (TG_OP = 'INSERT'
          OR (NEW.estado = 'aprobada' AND OLD.estado <> 'aprobada')
          OR (NEW.estado = 'pagada'   AND OLD.estado <> 'pagada')
          OR (OLD.estado = 'borrador'
              AND (NEW.contrasena_pago_id IS DISTINCT FROM OLD.contrasena_pago_id
                OR NEW.monto              IS DISTINCT FROM OLD.monto))) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_c FROM public.contrasenas_pago c WHERE c.id = NEW.contrasena_pago_id AND c.company_id = NEW.company_id;
  IF NOT FOUND THEN
    RETURN NEW;   -- la FK rechaza la fila, o la contraseña es de otra empresa (lo rechaza EV-01)
  END IF;

  SELECT COALESCE(SUM(cf.monto), 0) INTO v_suma
    FROM public.contrasena_pago_facturas cf WHERE cf.contrasena_id = NEW.contrasena_pago_id;

  IF round(v_suma, 2) <> round(NEW.monto, 2) OR round(v_suma, 2) <> round(v_c.total, 2) THEN
    RAISE EXCEPTION 'COMPRAS_PAGO_PARTIDAS_DISTINTAS: la contraseña % suma % en sus partidas y tiene un total de %, y la orden de pago es por %. La orden paga exactamente lo que las partidas aplican a las facturas.',
      COALESCE(v_c.numero, v_c.id::text), v_suma, v_c.total, NEW.monto
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.compras_tg_orden_pago_controles_partidas() IS
  'EV-02: la orden de pago de una contraseña es por la suma de sus partidas (= total); lo que se contabiliza es lo que se aplica a las facturas.';

DROP TRIGGER IF EXISTS trg_compras_orden_pago_controles_partidas ON public.ordenes_pago;
CREATE TRIGGER trg_compras_orden_pago_controles_partidas
  BEFORE INSERT OR UPDATE ON public.ordenes_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_orden_pago_controles_partidas();

REVOKE ALL ON FUNCTION public.compras_tg_orden_pago_controles_partidas() FROM PUBLIC, anon, authenticated;

-- ── C. Las partidas no se tocan con una orden de pago viva; no cambian de contraseña ───────
CREATE OR REPLACE FUNCTION public.compras_tg_bloqueo_partida_orden()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_numero text;
BEGIN
  -- Una escritura que no cambia nada de la partida no pide nada.
  IF TG_OP = 'UPDATE'
     AND NEW.contrasena_id IS NOT DISTINCT FROM OLD.contrasena_id
     AND NEW.factura_id    IS NOT DISTINCT FROM OLD.factura_id
     AND NEW.monto         IS NOT DISTINCT FROM OLD.monto THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.contrasena_id IS DISTINCT FROM OLD.contrasena_id THEN
    RAISE EXCEPTION 'COMPRAS_CONTRASENA_PARTIDA_FIJA: una partida no cambia de contraseña; bórrala de la contraseña y agrégala en la otra para que los dos totales se recalculen.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- La contraseña ya está bloqueada por trg_compras_bloqueo_partida (CONC-03): lo que se lee aquí está confirmado.
  IF EXISTS (SELECT 1 FROM public.ordenes_pago o
              WHERE o.contrasena_pago_id = NEW.contrasena_id AND o.estado <> 'anulada') THEN
    SELECT COALESCE(c.numero, c.id::text) INTO v_numero FROM public.contrasenas_pago c WHERE c.id = NEW.contrasena_id;
    RAISE EXCEPTION 'COMPRAS_CONTRASENA_CON_ORDEN: la contraseña % tiene una orden de pago viva y sus partidas no se tocan; anula primero la orden de pago.', v_numero
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.compras_tg_bloqueo_partida_orden() IS
  'EV-02: con una orden de pago no anulada sobre la contraseña no se insertan ni actualizan partidas, y una partida no cambia de contraseña.';

DROP TRIGGER IF EXISTS trg_compras_bloqueo_partida_orden ON public.contrasena_pago_facturas;
CREATE TRIGGER trg_compras_bloqueo_partida_orden
  BEFORE INSERT OR UPDATE ON public.contrasena_pago_facturas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_bloqueo_partida_orden();

REVOKE ALL ON FUNCTION public.compras_tg_bloqueo_partida_orden() FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 7 · EV-03 · los estados no retroceden
-- ════════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- [EV-03] LOS ESTADOS DE FACTURA, RECEPCIÓN Y CONTRASEÑA NO RETROCEDEN
--         (lo que tuvo efecto contable solo avanza o se ANULA, con permiso y reversión)
--
-- DEFECTO  20261027000300 controla los DESTINOS (aprobada, anulada, registrada, pagada*) pero ningún
--          ORIGEN. Con solo `edit` —o siendo administrador— una factura aprobada vuelve a «registrada»,
--          una recepción registrada vuelve a «borrador» (y otra vez a «registrada»: lo recibido se
--          suma dos veces con un solo asiento), una contraseña pagada vuelve a «emitida» y una factura
--          pagada o con pagos vuelve a «aprobada». El retroceso no revierte nada: ni el devengo, ni lo
--          facturado/recibido acumulado en la orden, ni el pago. Por ahí se evade el no-borrado de
--          20261027000200 (decide por columnas anulables) y la inmutabilidad de la factura aprobada.
--
-- CORRECCIÓN  Se AÑADEN tres triggers pequeños; no se toca ningún control existente.
--   Máquina de estados DE PERSONAS, en el servidor (se aplica solo a una sesión de usuario: la que
--   decide `compras_sesion_usuario()`; los triggers de sistema —conta.allow_system_write = 'on'— y los
--   procesos sin sesión, como el servicio, pasan igual que hoy):
--     factura     registrada → aprobada | anulada ;  aprobada → anulada.   Todo lo demás se rechaza:
--                 «pagada_parcial» / «pagada» y su regreso a «aprobada» los escribe el trigger de pago
--                 (cxp_tg_orden_saldo, con el permiso de sistema) al pagar o al anular un pago.
--     recepción   borrador → registrada | anulada ;  registrada → anulada ;  anulada terminal.
--     contraseña  emitida → anulada.   «pagada» y su regreso a «emitida» los escribe el trigger de pago.
--   Dispara DESPUÉS de los controles específicos (nombres con prefijo `trg_z…`, orden alfabético): los
--   mensajes que ya conoce la pantalla y las suites (COMPRAS_PERMISO_ACCION, COMPRAS_ESTADO_SOLO_SISTEMA,
--   CXP_BLOQUEADO, CXP_INMUTABLE, COMPRAS_RECEPCION_INMUTABLE, COMPRAS_CONTRASENA_INMUTABLE…) siguen
--   mandando; esta máquina es la red que cierra lo que ninguno cubría (el ORIGEN del cambio).
--
-- NO HACE  No decide quién puede anular (sigue siendo `change_status`, de 0300). No toca el camino de
--          sistema. Las órdenes de compra y las órdenes de pago ya tenían su máquina de estados
--          (compras_tg_oc_ciclo, compras_tg_orden_pago_controles): no se tocan.
-- IMPACTO EN DATOS EXISTENTES: ninguno (restringe UPDATE nuevos). Las facturas/recepciones ya
--          retrocedidas por esta vía no se corrigen aquí: ver el diagnóstico de solo lectura aparte.
-- IDEMPOTENTE · REVERTIR:
--   DROP TRIGGER trg_zcompras_factura_estados     ON public.facturas_proveedor;
--   DROP TRIGGER trg_zcompras_recepcion_estados   ON public.recepciones;
--   DROP TRIGGER trg_zcompras_contrasena_estados  ON public.contrasenas_pago;
--   DROP FUNCTION public.compras_tg_factura_maquina_estados(), public.compras_tg_recepcion_maquina_estados(),
--                 public.compras_tg_contrasena_maquina_estados();
-- ════════════════════════════════════════════════════════════════════════════

-- ── Factura de proveedor ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_factura_maquina_estados()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  -- Triggers de sistema (pago / anulación de pago) y procesos sin sesión: no es una decisión de una persona.
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF (OLD.estado = 'registrada' AND NEW.estado IN ('aprobada', 'anulada'))
     OR (OLD.estado = 'aprobada' AND NEW.estado = 'anulada') THEN
    RETURN NEW;
  END IF;

  IF OLD.estado = 'anulada' THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_TRANSICION: una factura anulada es terminal; no vuelve a «%». Captura una factura nueva.', NEW.estado
      USING ERRCODE = 'check_violation';
  ELSIF OLD.estado IN ('pagada_parcial', 'pagada') THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_TRANSICION: una factura «%» no cambia de estado a mano (a «%»): su estado lo mueven las órdenes de pago. Si el pago fue un error, anula la orden de pago: la factura vuelve sola a «aprobada».', OLD.estado, NEW.estado
      USING ERRCODE = 'check_violation';
  ELSIF OLD.estado = 'aprobada' THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_TRANSICION: una factura aprobada ya se contabilizó y se acumuló en la orden; no vuelve a «%». Solo se anula (con el permiso «Cambiar estado»), lo que revierte el devengo y lo facturado; después se captura otra.', NEW.estado
      USING ERRCODE = 'check_violation';
  END IF;
  RAISE EXCEPTION 'COMPRAS_FACTURA_TRANSICION: de «%» a «%» no es un cambio de estado permitido (registrada → aprobada | anulada; aprobada → anulada).', OLD.estado, NEW.estado
    USING ERRCODE = 'check_violation';
END;
$$;

COMMENT ON FUNCTION public.compras_tg_factura_maquina_estados() IS
  '[EV-03] Máquina de estados de la factura para sesiones de usuario: registrada → aprobada|anulada; aprobada → anulada. pagada*/vuelta a aprobada: solo el sistema. Anulada terminal. Dispara después de los controles específicos.';

DROP TRIGGER IF EXISTS trg_zcompras_factura_estados ON public.facturas_proveedor;
CREATE TRIGGER trg_zcompras_factura_estados
  BEFORE UPDATE ON public.facturas_proveedor
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_factura_maquina_estados();

-- ── Recepción ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_recepcion_maquina_estados()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF (OLD.estado = 'borrador' AND NEW.estado IN ('registrada', 'anulada'))
     OR (OLD.estado = 'registrada' AND NEW.estado = 'anulada') THEN
    RETURN NEW;
  END IF;

  IF OLD.estado = 'registrada' THEN
    RAISE EXCEPTION 'COMPRAS_RECEPCION_TRANSICION: una recepción registrada ya movió lo recibido de la orden, las existencias y el asiento; no vuelve a «%». Solo se anula (con el permiso «Cambiar estado»), lo que lo revierte; después se captura otra.', NEW.estado
      USING ERRCODE = 'check_violation';
  END IF;
  RAISE EXCEPTION 'COMPRAS_RECEPCION_TRANSICION: de «%» a «%» no es un cambio de estado permitido (borrador → registrada | anulada; registrada → anulada; anulada es terminal).', OLD.estado, NEW.estado
    USING ERRCODE = 'check_violation';
END;
$$;

COMMENT ON FUNCTION public.compras_tg_recepcion_maquina_estados() IS
  '[EV-03] Máquina de estados de la recepción para sesiones de usuario: borrador → registrada|anulada; registrada → anulada; anulada terminal. Dispara después de los controles específicos.';

DROP TRIGGER IF EXISTS trg_zcompras_recepcion_estados ON public.recepciones;
CREATE TRIGGER trg_zcompras_recepcion_estados
  BEFORE UPDATE ON public.recepciones
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_recepcion_maquina_estados();

-- ── Contraseña de pago ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_contrasena_maquina_estados()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF OLD.estado = 'emitida' AND NEW.estado = 'anulada' THEN
    RETURN NEW;
  END IF;

  IF OLD.estado = 'pagada' THEN
    RAISE EXCEPTION 'COMPRAS_CONTRASENA_TRANSICION: una contraseña «pagada» no cambia de estado a mano (a «%»): el pago sigue vivo. Anula la orden de pago que la liquidó: la contraseña vuelve sola a «emitida».', NEW.estado
      USING ERRCODE = 'check_violation';
  END IF;
  RAISE EXCEPTION 'COMPRAS_CONTRASENA_TRANSICION: de «%» a «%» no es un cambio de estado permitido (emitida → anulada; «pagada» solo la deja el pago de su orden).', OLD.estado, NEW.estado
    USING ERRCODE = 'check_violation';
END;
$$;

COMMENT ON FUNCTION public.compras_tg_contrasena_maquina_estados() IS
  '[EV-03] Máquina de estados de la contraseña para sesiones de usuario: emitida → anulada. pagada y su regreso a emitida: solo el sistema. Dispara después de los controles específicos.';

DROP TRIGGER IF EXISTS trg_zcompras_contrasena_estados ON public.contrasenas_pago;
CREATE TRIGGER trg_zcompras_contrasena_estados
  BEFORE UPDATE ON public.contrasenas_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_contrasena_maquina_estados();

-- ── Permisos de ejecución: solo los invocan los triggers ────────────────────
REVOKE ALL ON FUNCTION public.compras_tg_factura_maquina_estados()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_recepcion_maquina_estados()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_contrasena_maquina_estados() FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 8 · VER-02 · el no-borrado decide por evidencia no editable
-- ════════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- [VER-02] EL NO-BORRADO DE 20261027000200 NO SE EVADE: los sellos no se reescriben y el borrado
--          decide por EVIDENCIA que el usuario no puede editar
--
-- DEFECTO  La guarda de borrado (compras_tg_no_borrar_documento) decide por columnas que la propia
--          sesión de usuario puede reescribir: estado, aprobada_at, registrada_at. Con `edit` +
--          `delete` (sin approve ni change_status) bastaba volver el estado atrás y limpiar el sello
--          para borrar una factura aprobada o una recepción registrada:
--            UPDATE facturas_proveedor SET estado='registrada', aprobada_at=NULL, aprobada_por=NULL;
--            UPDATE recepciones        SET estado='borrador',   registrada_at=NULL;
--            DELETE …  → lo facturado y lo recibido de la orden siguen acumulados, el asiento de la
--            recepción sigue publicado sin documento, la evidencia desaparece.
--          El retroceso de estado lo cierra [EV-03]; este archivo cierra las otras dos mitades:
--
-- CORRECCIÓN  Dos triggers nuevos y UN ajuste de la guarda de 0200 que solo AÑADE una condición (nunca relaja).
--   A. Sellos que NO se reescriben una vez fijados (solo sesiones de usuario):
--        factura    (ya no «registrada»): aprobada_at, aprobada_por, match_forzado_por, match_justificacion
--        recepción  (ya no «borrador»)  : registrada_at, recibido_por
--      Mientras la factura está «registrada» o la recepción en «borrador» siguen siendo capturables: el
--      trigger de aprobación/registro los sella al pasar. La excepción es la referencia a un usuario que se
--      ELIMINA (ON DELETE SET NULL de la FK): esa limpieza la hace el motor, no una persona, y no se
--      bloquea (igual que la cascada de una empresa en 0200).
--   B. Guarda de borrado por EVIDENCIA, además de las marcas actuales (compras_tg_no_borrar_documento conserva
--      su definición y su trigger `trg_compras_no_borrar`; se le añade, en las ramas de recepción y factura, la
--      consulta a una ayuda nueva compras_evidencia_documento): no se borra
--        factura    con asiento contable (cualquier estado: devengo o reverso) o con un intento de
--                   contabilización contabilizado / pendiente;
--        recepción  con asiento, con movimiento de inventario de sus renglones o con activos fijos de ellos.
--      Esas filas no las edita un usuario. La cascada de una empresa o proyecto que se elimina no se bloquea.
--
-- NO HACE  No cambia quién puede anular ni la política de DELETE. No toca órdenes de compra: su guarda
--          (revision / aprobada_at / numero) ya es robusta porque `numero` es inmutable (compras_tg_oc_identidad).
-- IMPACTO EN DATOS EXISTENTES: ninguno (restringe UPDATE y DELETE nuevos).
-- IDEMPOTENTE · REVERTIR:
--   DROP TRIGGER trg_zcompras_factura_sellos ON public.facturas_proveedor;
--   DROP TRIGGER trg_zcompras_recepcion_sellos ON public.recepciones;
--                 public.compras_evidencia_documento(text, uuid);
--   y restaurar compras_tg_no_borrar_documento() a su definición de 20261027000200 (quitar los bloques «[VER-02]»).
-- ════════════════════════════════════════════════════════════════════════════

-- ── B. Guarda de borrado por evidencia no editable ──────────────────────────
-- B1. Ayuda NUEVA: ¿qué evidencia que ningún usuario edita tiene este documento? (NULL = ninguna)
CREATE OR REPLACE FUNCTION public.compras_evidencia_documento(p_tabla text, p_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_tabla = 'facturas_proveedor' THEN
    IF EXISTS (SELECT 1 FROM public.conta_asientos a
                WHERE a.origen_tabla = 'facturas_proveedor' AND a.origen_id = p_id) THEN
      RETURN 'asiento contable (devengo o reverso)';
    ELSIF EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                   WHERE i.origen_tabla = 'facturas_proveedor' AND i.origen_id = p_id
                     AND i.resultado IN ('contabilizada', 'ya_contabilizada', 'pendiente')) THEN
      RETURN 'intento de contabilización en el historial';
    END IF;
  ELSIF p_tabla = 'recepciones' THEN
    IF EXISTS (SELECT 1 FROM public.conta_asientos a
                WHERE a.origen_tabla = 'recepciones' AND a.origen_id = p_id) THEN
      RETURN 'asiento contable';
    ELSIF EXISTS (SELECT 1 FROM public.movimientos_suministro m
                   WHERE m.origen_tabla IN ('recepcion_lineas', 'recepcion_lineas_anulada')
                     AND m.origen_id IN (SELECT rl.id FROM public.recepcion_lineas rl WHERE rl.recepcion_id = p_id)) THEN
      RETURN 'movimiento de inventario';
    ELSIF EXISTS (SELECT 1 FROM public.activos_fijos af
                   WHERE af.recepcion_linea_id IN (SELECT rl.id FROM public.recepcion_lineas rl WHERE rl.recepcion_id = p_id)) THEN
      RETURN 'activos fijos dados de alta';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.compras_evidencia_documento(text, uuid) IS
  '[VER-02] Evidencia NO editable de una factura o recepción (asiento, intento de contabilización, movimiento de inventario, activos fijos). NULL si no hay. Interna de la guarda de borrado.';

-- B2. La guarda de borrado de 0200, con la MISMA definición vigente y UN bloque añadido por rama (marcado
--     «-- [VER-02]»): además de las marcas actuales, la evidencia impide el borrado. Se reescribe esta función
--     (no se añade un trigger aparte) porque dos suites existentes apagan `trg_compras_no_borrar` por su nombre
--     para probar la rama DELETE de conta_tg_facturas_prov: así siguen funcionando sin tocarlas.
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
  v_ev    text;   -- [VER-02]
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
      -- [VER-02] estado y sellos los puede dejar limpios otro camino: la evidencia que ningún usuario edita manda.
      IF v_puede THEN
        v_ev := public.compras_evidencia_documento(TG_TABLE_NAME::text, OLD.id);
      END IF;
    WHEN 'facturas_proveedor' THEN
      v_puede := OLD.estado = 'registrada' AND OLD.aprobada_at IS NULL AND OLD.monto_pagado = 0;
      v_que := format('la factura %s (%s)', COALESCE(OLD.numero_factura, OLD.id::text), OLD.estado);
      v_como := 'Anúlala: se revierten el devengo y lo facturado de la orden, y queda en el historial.';
      -- [VER-02] ídem.
      IF v_puede THEN
        v_ev := public.compras_evidencia_documento(TG_TABLE_NAME::text, OLD.id);
      END IF;
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

  -- [VER-02] Con evidencia no se borra, diga lo que diga el estado o el sello.
  IF v_ev IS NOT NULL THEN
    v_puede := false;
    v_como := format('Tiene %s: es evidencia que ningún usuario edita, aunque su estado o sus sellos digan otra cosa. %s', v_ev, v_como);
  END IF;

  IF NOT v_puede THEN
    RAISE EXCEPTION 'COMPRAS_DOCUMENTO_NO_SE_BORRA: no se borra %. %', v_que, v_como
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

-- ── Permisos de ejecución: solo los invocan los triggers ────────────────────
REVOKE ALL ON FUNCTION public.compras_evidencia_documento(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_no_borrar_documento()    FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 9 · VER-04 · identidad de la factura y de la recepción inmutable tras su efecto
-- ════════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- [VER-04] UNA FACTURA APROBADA Y CONTABILIZADA NO SE DESVINCULA DE SU ORDEN NI CAMBIA DE
--          PROYECTO / MONEDA / NÚMERO CON SOLO `edit`  (y lo mismo para la recepción registrada)
--
-- DEFECTO  trg_cxp_proteger_factura (CXP_INMUTABLE) solo protege monto_total, iva_monto y proveedor_id
--          una vez la factura sale de «registrada». Con `edit`, sin approve ni change_status:
--            UPDATE facturas_proveedor SET orden_compra_id = NULL, project_id = <otro>, moneda = 'usd',
--                                          numero_factura = 'REESCRITA' WHERE id = <aprobada>;   → UPDATE 1
--          La factura queda aprobada sin orden (el seguimiento baja a 0 facturas / facturado 0 mientras
--          orden_compra_lineas.cantidad_facturada sigue en 10), en otro proyecto y moneda que su asiento
--          publicado (desfase de libro) y con otro número (la duplicidad por número deja de verla).
--          Mismo vector en la recepción registrada: reasignarla a otra orden, cambiar su fecha, su
--          número o su tipo deja lo recibido sumado en la orden equivocada.
--
-- CORRECCIÓN  Se AÑADEN tres triggers; no se toca ningún control existente.
--   A. factura: una vez fuera de «registrada», para sesiones de usuario (incluido el administrador) no
--      cambian: empresa, proyecto (contabilidad), orden de compra, proveedor, número, fecha de emisión,
--      fecha de vencimiento, moneda, monto_total ni iva_monto (y, [VER-04-X2], la categoría de gasto una
--      vez que existe el asiento que se publicó con ella: decide su cuenta de gasto). Mientras es
--      «registrada» todo sigue capturable. NO se bloquea la limpieza que hace el motor: ON DELETE SET NULL de project_id /
--      orden_compra_id cuando el proyecto o la orden YA no existen.
--   B. recepción: una vez fuera de «borrador», para sesiones de usuario no cambian: empresa, proyecto,
--      orden de compra, tipo, fecha y número (si ya lo tiene). Notas, guía de remisión y respaldos siguen.
--   C. (HALLAZGO ADICIONAL VER-04-X1) factura con renglones: al APROBAR, el total de la cabecera debe ser la
--      suma de sus renglones (como ya lo mantiene compras_tg_factura_linea). Con `edit` se podía dejar
--      monto_total = 1 en una factura de 1 000 (también en la misma sentencia que la aprueba): la cuenta por
--      pagar de la factura (1) y el asiento (1 000) quedaban desalineados sin remedio (CXP_INMUTABLE la
--      protege DESPUÉS de aprobar, no antes). Una factura sin renglones (gasto directo) no se toca.
--      Se instala como trigger propio para poder retirarlo sin tocar A ni B.
--   Los tres disparan DESPUÉS de los controles específicos (prefijo `trg_z…`): CXP_INMUTABLE y los demás
--   mensajes vigentes siguen mandando.
--
-- NO HACE  No decide si el negocio quiere poder PRORROGAR un vencimiento ya aprobado (ver notas del informe):
--          fecha_vencimiento se congela porque así lo pide el criterio de identidad; abrirla es una decisión de
--          negocio que se tomaría con una acción propia y su rastro, no con un UPDATE libre.
-- IMPACTO EN DATOS EXISTENTES: ninguno (restringe UPDATE nuevos). Para C, antes de desplegar, diagnóstico de
--          solo lectura de facturas «registrada» con renglones cuyo total difiere (ver notas).
-- IDEMPOTENTE · REVERTIR:
--   DROP TRIGGER trg_zcompras_factura_identidad    ON public.facturas_proveedor;
--   DROP TRIGGER trg_zcompras_factura_total_cuadra ON public.facturas_proveedor;
--   DROP TRIGGER trg_zcompras_recepcion_identidad  ON public.recepciones;
--   DROP FUNCTION public.compras_tg_factura_identidad_fija(), public.compras_tg_factura_total_cuadra(),
--                 public.compras_tg_recepcion_identidad_fija();
-- ════════════════════════════════════════════════════════════════════════════

-- ── A. Factura: identidad fija una vez fuera de «registrada» ────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_factura_identidad_fija()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cols text[] := ARRAY[]::text[];
BEGIN
  -- «registrada» aún se captura y corrige; sin sesión de usuario (sistema) no es una persona.
  IF OLD.estado = 'registrada' OR NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    v_cols := array_append(v_cols, 'la empresa');
  END IF;
  -- ON DELETE SET NULL: si el proyecto / la orden YA no existen, el motor deja la referencia en NULL; no es una persona.
  IF NEW.project_id IS DISTINCT FROM OLD.project_id
     AND NOT (NEW.project_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id)) THEN
    v_cols := array_append(v_cols, 'la contabilidad (proyecto)');
  END IF;
  IF NEW.orden_compra_id IS DISTINCT FROM OLD.orden_compra_id
     AND NOT (NEW.orden_compra_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.ordenes_compra o WHERE o.id = OLD.orden_compra_id)) THEN
    v_cols := array_append(v_cols, 'la orden de compra');
  END IF;
  IF NEW.proveedor_id IS DISTINCT FROM OLD.proveedor_id THEN
    v_cols := array_append(v_cols, 'el proveedor');
  END IF;
  IF NEW.numero_factura IS DISTINCT FROM OLD.numero_factura THEN
    v_cols := array_append(v_cols, 'el número');
  END IF;
  IF NEW.fecha_emision IS DISTINCT FROM OLD.fecha_emision THEN
    v_cols := array_append(v_cols, 'la fecha de emisión');
  END IF;
  IF NEW.fecha_vencimiento IS DISTINCT FROM OLD.fecha_vencimiento THEN
    v_cols := array_append(v_cols, 'la fecha de vencimiento');
  END IF;
  IF NEW.moneda IS DISTINCT FROM OLD.moneda THEN
    v_cols := array_append(v_cols, 'la moneda');
  END IF;
  IF NEW.monto_total IS DISTINCT FROM OLD.monto_total OR NEW.iva_monto IS DISTINCT FROM OLD.iva_monto THEN
    v_cols := array_append(v_cols, 'el monto');
  END IF;
  -- [VER-04-X2] La categoría decide la cuenta de gasto del devengo: una vez publicado el asiento, reclasificarla
  --             en la factura dejaría el libro en otra cuenta. Mientras NO haya asiento (contabilización pendiente
  --             de una aprobada) sigue editable: el reproceso la relee.
  IF NEW.categoria IS DISTINCT FROM OLD.categoria
     AND EXISTS (SELECT 1 FROM public.conta_asientos a
                  WHERE a.origen_tabla = 'facturas_proveedor' AND a.origen_id = OLD.id) THEN
    v_cols := array_append(v_cols, 'la categoría de gasto (el asiento ya se publicó con ella)');
  END IF;

  IF cardinality(v_cols) > 0 THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_IDENTIDAD: la factura % ya está «%» y su identidad —%— no cambia: el devengo, lo facturado de la orden y el asiento se calcularon con ello. Si estaba mal, anúlala (se revierte todo y queda en el historial) y captura otra.',
      COALESCE(OLD.numero_factura, OLD.id::text), OLD.estado, array_to_string(v_cols, ', ')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.compras_tg_factura_identidad_fija() IS
  '[VER-04] Fuera de «registrada», la factura no cambia de empresa, proyecto, orden, proveedor, número, fechas, moneda ni monto, ni de categoría si ya hay asiento (sesiones de usuario). El SET NULL del motor cuando el proyecto o la orden ya no existen pasa.';

DROP TRIGGER IF EXISTS trg_zcompras_factura_identidad ON public.facturas_proveedor;
CREATE TRIGGER trg_zcompras_factura_identidad
  BEFORE UPDATE ON public.facturas_proveedor
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_factura_identidad_fija();

-- ── B. Recepción: identidad fija una vez fuera de «borrador» ────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_recepcion_identidad_fija()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cols text[] := ARRAY[]::text[];
BEGIN
  IF OLD.estado = 'borrador' OR NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    v_cols := array_append(v_cols, 'la empresa');
  END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id
     AND NOT (NEW.project_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id)) THEN
    v_cols := array_append(v_cols, 'la contabilidad (proyecto)');
  END IF;
  IF NEW.orden_compra_id IS DISTINCT FROM OLD.orden_compra_id THEN
    v_cols := array_append(v_cols, 'la orden de compra');
  END IF;
  IF NEW.tipo IS DISTINCT FROM OLD.tipo THEN
    v_cols := array_append(v_cols, 'el tipo (bienes / servicio)');
  END IF;
  IF NEW.fecha IS DISTINCT FROM OLD.fecha THEN
    v_cols := array_append(v_cols, 'la fecha');
  END IF;
  IF OLD.numero IS NOT NULL AND NEW.numero IS DISTINCT FROM OLD.numero THEN
    v_cols := array_append(v_cols, 'el número');
  END IF;

  IF cardinality(v_cols) > 0 THEN
    RAISE EXCEPTION 'COMPRAS_RECEPCION_IDENTIDAD: la recepción % ya está «%» y su identidad —%— no cambia: lo recibido de la orden, las existencias y el asiento se calcularon con ello. Si estaba mal, anúlala (se revierte todo y queda en el historial) y captura otra.',
      COALESCE(OLD.numero, OLD.id::text), OLD.estado, array_to_string(v_cols, ', ')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.compras_tg_recepcion_identidad_fija() IS
  '[VER-04] Fuera de «borrador», la recepción no cambia de empresa, proyecto, orden, tipo, fecha ni número (sesiones de usuario). Notas, guía y respaldos siguen editables.';

DROP TRIGGER IF EXISTS trg_zcompras_recepcion_identidad ON public.recepciones;
CREATE TRIGGER trg_zcompras_recepcion_identidad
  BEFORE UPDATE ON public.recepciones
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_recepcion_identidad_fija();

-- ── C. (adicional VER-04-X1) Al aprobar, el total de la cabecera es la suma de los renglones ──
CREATE OR REPLACE FUNCTION public.compras_tg_factura_total_cuadra()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_n     int;
  v_neto  numeric(14,2);
  v_iva   numeric(14,2);
BEGIN
  IF NOT (OLD.estado = 'registrada' AND NEW.estado = 'aprobada') OR NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  -- Misma fórmula que compras_tg_factura_linea (neto de cada renglón redondeado + IVA de los renglones).
  SELECT COUNT(*), COALESCE(SUM(round(l.cantidad * l.precio_unitario, 2)), 0), COALESCE(SUM(l.iva_monto), 0)
    INTO v_n, v_neto, v_iva
    FROM public.factura_proveedor_lineas l
   WHERE l.factura_id = NEW.id;

  IF v_n > 0 AND (NEW.monto_total IS DISTINCT FROM v_neto + v_iva OR NEW.iva_monto IS DISTINCT FROM v_iva) THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_TOTAL_DESCUADRADO: la cabecera de la factura % dice % (IVA %) pero sus renglones suman % (IVA %). No se aprueba una factura cuyo total no es el de sus renglones: la cuenta por pagar y el asiento quedarían desalineados. Corrige el total (la factura sigue registrada) y vuelve a aprobar.',
      COALESCE(NEW.numero_factura, NEW.id::text), NEW.monto_total, NEW.iva_monto, v_neto + v_iva, v_iva
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.compras_tg_factura_total_cuadra() IS
  '[VER-04-X1] Al aprobar una factura con renglones, monto_total e iva_monto de la cabecera = suma de los renglones (sesiones de usuario). Sin renglones (gasto directo) no se aplica.';

DROP TRIGGER IF EXISTS trg_zcompras_factura_total_cuadra ON public.facturas_proveedor;
CREATE TRIGGER trg_zcompras_factura_total_cuadra
  BEFORE UPDATE ON public.facturas_proveedor
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_factura_total_cuadra();

-- ── Permisos de ejecución: solo los invocan los triggers ────────────────────
REVOKE ALL ON FUNCTION public.compras_tg_factura_identidad_fija()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_recepcion_identidad_fija() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_factura_total_cuadra()     FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 10 · EV-05 · importes de la orden derivados de sus renglones, inmutables fuera de borrador
-- ════════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- [EV-05] LOS IMPORTES DE UNA ORDEN (SUBTOTAL, IVA, TOTAL), SU REVISIÓN Y SUS MOTIVOS
-- NO LOS ESCRIBE EL CLIENTE
--
-- CAUSA RAÍZ
--   `subtotal`, `iva_monto` y `total` son DERIVADOS de los renglones
--   (`compras_tg_oc_totales`), pero la tabla los dejaba escribir a mano:
--     · UPDATE directo sobre una orden aprobada/emitida/cerrada (sin evento): el total que
--       usan el límite del contrato, los compromisos y el seguimiento pasaba de 1 000 a 1.
--     · UPDATE directo sobre un BORRADOR (total = 1 con renglones por 1 000) y luego
--       aprobar: el límite del contrato (`compras_tg_oc_contrato_vigencia`) y lo
--       comprometido se calculan con el total forjado.
--     · INSERT con total = 5 555 y sin renglones, o borrar el último renglón (el trigger de
--       totales no recalcula con cero renglones): una orden APROBADA sin renglones que
--       «compromete» un importe.
--   Igual con `revision` (cuenta las devoluciones; el borrado la lee) y con
--   `motivo_anulacion` / `motivo_devolucion` (el evento guarda el motivo en su momento; la
--   columna se podía reescribir después).
--   Una carrera cae en lo mismo: un renglón insertado en un borrador mientras otra sesión lo
--   aprueba pasaba el candado de renglones (leía «borrador») y su AFTER-trigger de totales
--   reescribía el total de la orden ya aprobada.
--
-- QUÉ HACE (solo SESIONES DE USUARIO: `compras_sesion_usuario()`)
--   BEFORE INSERT OR UPDATE, `trg_compras_01_importes_orden` (dispara antes que el candado
--   de contrato, que lee el total):
--     · INSERT: importes 0, revisión 0 y sin motivos (los renglones llegan después y el
--       trigger de totales los calcula).
--     · Orden fuera de borrador: subtotal, iva_monto y total NO cambian (COMPRAS_OC_IMPORTES_
--       INMUTABLES). Los renglones ya son inmutables; si el acuerdo cambió, se devuelve a
--       borrador con motivo (revisión + 1, con evento) o se cancela y se emite otra.
--     · Borrador: el cliente no escribe los importes; en cada escritura de usuario se re-derivan
--       de los renglones confirmados (con renglones, su suma; sin renglones, se conserva lo que
--       había). Al SALIR de borrador (aprobar, emitir…) sin renglones quedan en cero (0700: una
--       orden sin renglones compromete 0). Eso cura de paso la carrera de dos editores del mismo
--       borrador, donde cada trigger de totales calculaba su suma sin ver la de la otra sesión.
--     · `trg_compras_oc_motivos` (dispara DESPUÉS del ciclo, para no tapar el código de error
--       de una transición inválida): `revision` solo la mueve la devolución a borrador (la
--       incrementa el ciclo); cualquier otro cambio se rechaza (COMPRAS_OC_REVISION_SISTEMA).
--       `motivo_anulacion` solo cambia al CANCELAR y `motivo_devolucion` solo al DEVOLVER a
--       borrador (COMPRAS_OC_MOTIVO_INMUTABLE): es el texto que el evento ya guardó.
--   Los triggers de sistema (recepción y factura moviendo lo recibido/facturado, que
--   recalculan con el GUC de sistema) y el mantenimiento sin sesión no pasan por aquí.
--
-- QUÉ NO HACE
--   No fija topes ni exige nada nuevo para aprobar. No toca los renglones, `monto_estimado`
--   ni `monto_real` (los cubre 0500 con su evento). No repara filas históricas: solo actúa
--   cuando el cambio lo intenta una sesión de usuario.
--
-- CÓMO REVERTIR
--   DROP TRIGGER trg_compras_01_importes_orden ON public.ordenes_compra;
--   DROP TRIGGER trg_compras_oc_motivos ON public.ordenes_compra;
--   DROP FUNCTION public.compras_tg_importes_orden(), public.compras_tg_motivos_orden();
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compras_tg_importes_orden()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cambian boolean;
  v_sale    boolean;
  v_n       integer;
  v_sub     numeric(14,2);
  v_iva     numeric(14,2);
BEGIN
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.subtotal         := 0;
    NEW.iva_monto        := 0;
    NEW.total            := 0;
    NEW.revision         := 0;
    NEW.motivo_anulacion := NULL;
    NEW.motivo_devolucion := NULL;
    RETURN NEW;
  END IF;

  -- ── Importes: derivados de los renglones ───────────────────────────────────
  v_cambian := NEW.subtotal  IS DISTINCT FROM OLD.subtotal
            OR NEW.iva_monto IS DISTINCT FROM OLD.iva_monto
            OR NEW.total     IS DISTINCT FROM OLD.total;

  IF OLD.estado <> 'borrador' THEN
    IF v_cambian THEN
      RAISE EXCEPTION 'COMPRAS_OC_IMPORTES_INMUTABLES: la orden está «%» y su subtotal, IVA y total (los que comprometen dinero con el proveedor y el contrato) no se reescriben. Si el acuerdo cambió, devuélvela a borrador indicando el motivo o cancélala y emite otra.', OLD.estado
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Borrador: los importes son DERIVADOS, así que en cada escritura de usuario se re-derivan
  -- de los renglones confirmados (no solo cuando el cliente intenta cambiarlos): dos sesiones
  -- que añaden renglones a la vez calculan cada una su suma sin ver la de la otra, y la que
  -- escribe segunda dejaba el total de UN solo renglón (o, por coincidencia, el de la otra).
  v_sale := NEW.estado NOT IN ('borrador', 'cancelada');

  SELECT COUNT(*), COALESCE(SUM(round(l.cantidad * l.precio_unitario, 2)), 0), COALESCE(SUM(l.iva_monto), 0)
    INTO v_n, v_sub, v_iva
    FROM public.orden_compra_lineas l
   WHERE l.orden_compra_id = OLD.id;

  IF v_n > 0 THEN
    NEW.subtotal  := v_sub;
    NEW.iva_monto := v_iva;
    NEW.total     := v_sub + v_iva;
  ELSIF v_sale THEN
    NEW.subtotal  := 0;
    NEW.iva_monto := 0;
    NEW.total     := 0;
  ELSE
    NEW.subtotal  := OLD.subtotal;
    NEW.iva_monto := OLD.iva_monto;
    NEW.total     := OLD.total;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.compras_tg_importes_orden() IS
  'Subtotal, IVA y total de una orden son derivados de sus renglones: una sesión de usuario no los escribe (fuera de borrador se rechaza; en borrador se sustituyen por la suma de los renglones). La revisión y los motivos solo cambian en el paso que los produce.';

DROP TRIGGER IF EXISTS trg_compras_01_importes_orden ON public.ordenes_compra;
CREATE TRIGGER trg_compras_01_importes_orden
  BEFORE INSERT OR UPDATE ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_importes_orden();

-- ── Revisión y motivos: solo en el paso que los produce ─────────────────────
-- Dispara DESPUÉS del ciclo (`trg_compras_oc_ciclo_a`): la máquina de estados valida primero
-- la transición (y su código de error), y es el ciclo quien incrementa la revisión al devolver.
CREATE OR REPLACE FUNCTION public.compras_tg_motivos_orden()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF NEW.revision IS DISTINCT FROM OLD.revision
     AND NOT (OLD.estado = 'aprobada' AND NEW.estado = 'borrador' AND NEW.revision = OLD.revision + 1) THEN
    RAISE EXCEPTION 'COMPRAS_OC_REVISION_SISTEMA: la revisión de la orden la suma el sistema al devolverla a borrador; no se escribe a mano.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.motivo_anulacion IS DISTINCT FROM OLD.motivo_anulacion
     AND NOT (NEW.estado = 'cancelada' AND OLD.estado <> 'cancelada') THEN
    RAISE EXCEPTION 'COMPRAS_OC_MOTIVO_INMUTABLE: el motivo de anulación solo se escribe al cancelar la orden; el historial ya guardó el que se dio.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.motivo_devolucion IS DISTINCT FROM OLD.motivo_devolucion
     AND NOT (OLD.estado = 'aprobada' AND NEW.estado = 'borrador') THEN
    RAISE EXCEPTION 'COMPRAS_OC_MOTIVO_INMUTABLE: el motivo de devolución solo se escribe al devolver la orden a borrador; el historial ya guardó el que se dio.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compras_oc_motivos ON public.ordenes_compra;
CREATE TRIGGER trg_compras_oc_motivos
  BEFORE UPDATE ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_motivos_orden();

REVOKE ALL ON FUNCTION public.compras_tg_importes_orden() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_motivos_orden() FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 11 · EV-06 · sellos de actor y de fecha
-- ════════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- [EV-06] SELLOS DE ACTOR Y DE FECHA: LOS PONE EL SERVIDOR, EN LA TRANSICIÓN, Y NADIE
-- MÁS (ni antes —INSERT, UPDATE previo— ni después)
--
-- CAUSA RAÍZ
--   Los sellos solo se escribían en el trigger de la transición. Antes (INSERT, o UPDATE
--   previo al paso) y después (UPDATE directo) los reescribía cualquiera con `edit`:
--     · ordenes_compra:   aprobada_por, aprobada_at, emitida_at, cerrada_at
--     · recepciones:      registrada_at, anulada_at
--     · facturas_proveedor: aprobada_por, aprobada_at, match_forzado_por
--     · ordenes_pago:     aprobada_por, aprobada_at, pagada_at (el INSERT no los anulaba)
--     · contrasenas_pago: pagada_at (se sellaba con COALESCE(valor del cliente, now())),
--       created_by (COALESCE(valor del cliente, auth.uid()) y sin protección posterior) y
--       motivo_anulacion
--     · y `created_at` de las cinco (la fecha de captura).
--   Además, en la TRANSICIÓN, `emitida_at`, `cerrada_at` (OC) y `registrada_at`,
--   `anulada_at` (recepción) se sellaban con COALESCE(valor del cliente, now()): lo que
--   mandaba el navegador en el mismo UPDATE de estado ganaba. Y `emitida_at` no es solo
--   cosmética: al anular la última recepción, `compras_tg_recepcion_registrar` decide si
--   la orden vuelve a «emitida» o a «aprobada» según `emitida_at IS NOT NULL`.
--   También son la llave de `compras_tg_no_borrar_documento` (aprobada_at, registrada_at):
--   limpiar el sello reabre el borrado de un documento con efecto.
--
-- QUÉ HACE (solo para SESIONES DE USUARIO: `compras_sesion_usuario()`)
--   Triggers BEFORE INSERT OR UPDATE, nombrados `trg_compras_00_…` para que disparen
--   ANTES que cualquier otro (los triggers de la transición, que sí sellan, corren después
--   y encuentran el campo vacío):
--     · INSERT: los sellos nacen vacíos y `created_at` = now(). Lo que mande el cliente no
--       cuenta (los triggers de la transición, o el INSERT «ya aprobada/emitida» de 0700,
--       los sellan después). No se rechaza: así se comportaba ya la orden de pago con
--       `solicitada_por` y los guiones existentes mandan `aprobada_por` en el INSERT.
--     · UPDATE: un sello VACÍO no se adelanta (el valor del cliente se ignora; lo pondrá el
--       servidor en la transición). Un sello YA PUESTO no se reescribe NI SE BORRA: se rechaza
--       con COMPRAS_SELLO_FIJO (es auditoría; el silencio escondería el intento). El código es
--       el mismo que usa el grupo de estados (VER-02) para que las dos correcciones convivan
--       sea cual sea el trigger que dispare primero. En la transición el cliente puede seguir
--       mandando el campo (la pantalla de pagos lo manda): se ignora y queda el del servidor.
--       La limpieza del motor por ON DELETE SET NULL al eliminar a un usuario pasa.
--   Sin sesión de usuario (service_role, mantenimiento) o con el permiso de sistema (los
--   triggers que mueven estados derivados) no se aplica. `ordenes_pago`: el UPDATE ya lo
--   cubre 0100 (revierte en silencio); aquí solo se cierra el INSERT.
--
-- QUÉ NO HACE
--   No toca `recibido_por`/`fecha`/`match_justificacion`/`fecha_pago`… (VER-03), ni los
--   importes (EV-05), ni la identidad ni el estado. No inventa reglas de negocio.
--
-- CÓMO REVERTIR
--   DROP TRIGGER trg_compras_00_sellos_{orden,recepcion,factura,orden_pago,contrasena} ON …;
--   DROP FUNCTION public.compras_tg_sellos_{orden,recepcion,factura,orden_pago,contrasena}(),
--                 public.compras_sello_conservar(text, text, anyelement, anyelement);
-- ════════════════════════════════════════════════════════════════════════════

-- Un sello vacío no se adelanta; uno puesto no se reescribe ni se borra.
-- Excepción: la limpieza que hace el MOTOR (ON DELETE SET NULL) cuando se elimina al usuario
-- referenciado no la hace una persona y no se bloquea (igual que la cascada de una empresa en 0200).
CREATE OR REPLACE FUNCTION public.compras_sello_conservar(
  p_documento text, p_campo text, p_anterior anyelement, p_nuevo anyelement)
RETURNS anyelement
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_nuevo IS NOT DISTINCT FROM p_anterior THEN
    RETURN p_nuevo;
  END IF;
  IF p_anterior IS NOT NULL THEN
    IF p_nuevo IS NULL AND pg_typeof(p_anterior) = 'uuid'::regtype THEN
      IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_anterior::text::uuid) THEN
        RETURN p_nuevo;
      END IF;
    END IF;
    RAISE EXCEPTION 'COMPRAS_SELLO_FIJO: «%» de % ya lo selló el servidor y no se reescribe ni se borra; es el rastro de quién y cuándo. Si el dato está mal, anula el documento y captura otro.',
      p_campo, p_documento
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN p_anterior;   -- vacío: el sello lo pondrá el servidor al hacer la transición
END;
$$;

-- ── Orden de compra ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_sellos_orden()
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
    NEW.aprobada_por := NULL;
    NEW.aprobada_at  := NULL;
    NEW.emitida_at   := NULL;
    NEW.cerrada_at   := NULL;
    NEW.created_at   := now();
    RETURN NEW;
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'COMPRAS_SELLO_FIJO: la fecha de captura de la orden de compra no se reescribe.'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.aprobada_por := public.compras_sello_conservar('la orden de compra', 'aprobada_por', OLD.aprobada_por, NEW.aprobada_por);
  NEW.aprobada_at  := public.compras_sello_conservar('la orden de compra', 'aprobada_at',  OLD.aprobada_at,  NEW.aprobada_at);
  NEW.emitida_at   := public.compras_sello_conservar('la orden de compra', 'emitida_at',   OLD.emitida_at,   NEW.emitida_at);
  NEW.cerrada_at   := public.compras_sello_conservar('la orden de compra', 'cerrada_at',   OLD.cerrada_at,   NEW.cerrada_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compras_00_sellos_orden ON public.ordenes_compra;
CREATE TRIGGER trg_compras_00_sellos_orden
  BEFORE INSERT OR UPDATE ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_sellos_orden();

-- ── Recepción ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_sellos_recepcion()
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
    NEW.registrada_at   := NULL;
    NEW.anulada_at      := NULL;
    NEW.motivo_anulacion := NULL;     -- una recepción nace en borrador: aún no se anula
    NEW.created_at      := now();
    RETURN NEW;
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'COMPRAS_SELLO_FIJO: la fecha de captura de la recepción no se reescribe.'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.registrada_at := public.compras_sello_conservar('la recepción', 'registrada_at', OLD.registrada_at, NEW.registrada_at);
  NEW.anulada_at    := public.compras_sello_conservar('la recepción', 'anulada_at',    OLD.anulada_at,    NEW.anulada_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compras_00_sellos_recepcion ON public.recepciones;
CREATE TRIGGER trg_compras_00_sellos_recepcion
  BEFORE INSERT OR UPDATE ON public.recepciones
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_sellos_recepcion();

-- ── Factura de proveedor ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_sellos_factura()
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
    NEW.aprobada_por      := NULL;
    NEW.aprobada_at       := NULL;
    NEW.match_forzado_por := NULL;
    NEW.created_at        := now();
    RETURN NEW;
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'COMPRAS_SELLO_FIJO: la fecha de captura de la factura no se reescribe.'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.aprobada_por      := public.compras_sello_conservar('la factura', 'aprobada_por',      OLD.aprobada_por,      NEW.aprobada_por);
  NEW.aprobada_at       := public.compras_sello_conservar('la factura', 'aprobada_at',       OLD.aprobada_at,       NEW.aprobada_at);
  NEW.match_forzado_por := public.compras_sello_conservar('la factura', 'match_forzado_por', OLD.match_forzado_por, NEW.match_forzado_por);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compras_00_sellos_factura ON public.facturas_proveedor;
CREATE TRIGGER trg_compras_00_sellos_factura
  BEFORE INSERT OR UPDATE ON public.facturas_proveedor
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_sellos_factura();

-- ── Orden de pago (el UPDATE de los sellos ya lo revierte 0100; aquí, el INSERT) ──
CREATE OR REPLACE FUNCTION public.compras_tg_sellos_orden_pago()
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
    NEW.aprobada_por := NULL;
    NEW.aprobada_at  := NULL;
    NEW.pagada_at    := NULL;
    NEW.created_at   := now();
    RETURN NEW;
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'COMPRAS_SELLO_FIJO: la fecha de captura de la orden de pago no se reescribe.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compras_00_sellos_orden_pago ON public.ordenes_pago;
CREATE TRIGGER trg_compras_00_sellos_orden_pago
  BEFORE INSERT OR UPDATE ON public.ordenes_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_sellos_orden_pago();

-- ── Contraseña de pago ──────────────────────────────────────────────────────
-- `pagada_at` lo deja el trigger de pago (con el permiso de sistema); `created_by` (quién
-- emitió el acuse: el trigger de estado hacía COALESCE(valor del cliente, auth.uid()) y
-- ningún trigger lo protegía después, a diferencia de las otras cuatro tablas, que usan
-- `sellar_actor`); `motivo_anulacion` solo se escribe al anular, y entonces el historial ya
-- lo guardó. (`entregada_por` / `recibida_por`
-- son datos que declara quien entrega el acuse: no son sellos del servidor.)
CREATE OR REPLACE FUNCTION public.compras_tg_sellos_contrasena()
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
    NEW.pagada_at        := NULL;
    NEW.motivo_anulacion := NULL;
    NEW.created_by       := NULL;      -- lo sella `compras_tg_contrasena_estado` con auth.uid() (COALESCE)
    NEW.created_at       := now();
    RETURN NEW;
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'COMPRAS_SELLO_FIJO: la fecha de captura de la contraseña de pago no se reescribe.'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.created_by := public.compras_sello_conservar('la contraseña de pago', 'created_by', OLD.created_by, NEW.created_by);
  NEW.pagada_at  := public.compras_sello_conservar('la contraseña de pago', 'pagada_at', OLD.pagada_at, NEW.pagada_at);
  IF NEW.motivo_anulacion IS DISTINCT FROM OLD.motivo_anulacion
     AND NOT (NEW.estado = 'anulada' AND OLD.estado <> 'anulada') THEN
    RAISE EXCEPTION 'COMPRAS_SELLO_FIJO: el motivo de anulación de la contraseña solo se escribe al anularla; el que se dio ya no se reescribe.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compras_00_sellos_contrasena ON public.contrasenas_pago;
CREATE TRIGGER trg_compras_00_sellos_contrasena
  BEFORE INSERT OR UPDATE ON public.contrasenas_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_sellos_contrasena();

REVOKE ALL ON FUNCTION public.compras_sello_conservar(text, text, anyelement, anyelement) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_sellos_orden()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_sellos_recepcion()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_sellos_factura()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_sellos_orden_pago()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_sellos_contrasena()   FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 12 · VER-03 · lo que alimenta el asiento no se reescribe
-- ════════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- [VER-03] LO QUE YA TIENE ASIENTO O YA SE FIRMÓ NO SE REESCRIBE DESPUÉS
-- (responsable y fecha de una recepción registrada, justificación de una factura
-- aprobada, fecha/referencia/método de una orden de pago pagada)
--
-- CAUSA RAÍZ
--   Los sellos (EV-06) no eran lo único que quedaba abierto «después»: los datos que el
--   asiento ya consumió seguían siendo editables con solo `edit`, y el documento y el
--   asiento dejaban de coincidir sin rastro:
--     · recepciones.fecha  → fecha del asiento GR/IR, del kardex y del alta de activos;
--       recibido_por       → quién firmó la conformidad de un servicio.
--     · ordenes_pago.fecha_pago → fecha del asiento del pago; metodo_pago → la cuenta de
--       banco/caja del asiento; referencia → la glosa del asiento.
--     · facturas_proveedor.match_justificacion → la excepción firmada al aprobar un cuadre
--       fuera de tolerancia (el seguimiento la muestra como «aprobada con diferencias»).
--     · recepciones.motivo_anulacion → el motivo que el usuario dio al anular.
--
-- QUÉ HACE (solo SESIONES DE USUARIO: `compras_sesion_usuario()`)
--   BEFORE UPDATE `trg_zzcompras_congelar_…` (disparan al FINAL, después de los validadores
--   específicos —estado, identidad, CXP_INMUTABLE—, para no tapar su código de error): fuera
--   del estado de captura, el campo no cambia y el intento se RECHAZA con un error explícito
--   (es dinero o auditoría; el silencio dejaría la pantalla creyendo que se guardó):
--     · recepción registrada o anulada: recibido_por (COMPRAS_SELLO_FIJO, el código de los
--       sellos) y fecha (COMPRAS_RECEPCION_REGISTRADA_INMUTABLE); motivo_anulacion solo al
--       anular, en cualquier estado.
--     · factura aprobada (o más): match_justificacion (COMPRAS_SELLO_FIJO). En «registrada» se
--       sigue pudiendo escribir antes de aprobar.
--     · orden de pago pagada: fecha_pago, referencia y metodo_pago (COMPRAS_PAGO_PAGADA_
--       INMUTABLE). Antes de pagar siguen siendo editables, y el UPDATE que la marca
--       pagada los fija. Reenviar el mismo valor (doble clic) no es un cambio.
--   Para corregir algo de esto: anular y capturar otro (el asiento se revierte solo).
--
-- QUÉ NO HACE
--   No cubre los sellos de actor/fecha (EV-06) ni los importes (EV-05). No toca la identidad
--   del documento (`numero`, `numero_factura`, `fecha_emision`), que es del grupo de
--   estados/identidad.
--
-- CÓMO REVERTIR
--   DROP TRIGGER trg_zzcompras_congelar_{recepcion,factura,orden_pago} ON …;
--   DROP FUNCTION public.compras_tg_congelar_{recepcion,factura,orden_pago}();
-- ════════════════════════════════════════════════════════════════════════════

-- ── Recepción ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_congelar_recepcion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF NEW.motivo_anulacion IS DISTINCT FROM OLD.motivo_anulacion
     AND NOT (NEW.estado = 'anulada' AND OLD.estado <> 'anulada') THEN
    RAISE EXCEPTION 'COMPRAS_RECEPCION_REGISTRADA_INMUTABLE: el motivo de anulación solo se escribe al anular la recepción.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.estado = 'borrador' THEN
    RETURN NEW;
  END IF;
  -- quien recibió ya quedó firmado (COMPRAS_SELLO_FIJO; un usuario eliminado por el motor pasa)
  NEW.recibido_por := public.compras_sello_conservar('la recepción', 'recibido_por', OLD.recibido_por, NEW.recibido_por);
  IF NEW.fecha IS DISTINCT FROM OLD.fecha THEN
    RAISE EXCEPTION 'COMPRAS_RECEPCION_REGISTRADA_INMUTABLE: la recepción está «%» y su fecha es la del asiento, las existencias y los activos; no se cambia. Anúlala y captura otra.', OLD.estado
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zzcompras_congelar_recepcion ON public.recepciones;
CREATE TRIGGER trg_zzcompras_congelar_recepcion
  BEFORE UPDATE ON public.recepciones
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_congelar_recepcion();

-- ── Factura de proveedor ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_congelar_factura()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.compras_sesion_usuario() OR OLD.estado = 'registrada' THEN
    RETURN NEW;
  END IF;
  -- la justificación con que se aprobó el cuadre ya quedó firmada (COMPRAS_SELLO_FIJO)
  NEW.match_justificacion := public.compras_sello_conservar('la factura', 'match_justificacion', OLD.match_justificacion, NEW.match_justificacion);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zzcompras_congelar_factura ON public.facturas_proveedor;
CREATE TRIGGER trg_zzcompras_congelar_factura
  BEFORE UPDATE ON public.facturas_proveedor
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_congelar_factura();

-- ── Orden de pago ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_congelar_orden_pago()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT public.compras_sesion_usuario() OR OLD.estado <> 'pagada' THEN
    RETURN NEW;
  END IF;
  IF NEW.fecha_pago   IS DISTINCT FROM OLD.fecha_pago
     OR NEW.referencia  IS DISTINCT FROM OLD.referencia
     OR NEW.metodo_pago IS DISTINCT FROM OLD.metodo_pago THEN
    RAISE EXCEPTION 'COMPRAS_PAGO_PAGADA_INMUTABLE: la orden de pago ya está pagada y su fecha, referencia y método son los del asiento contable; no se reescriben. Anula el pago (el asiento se revierte) y captura otro.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zzcompras_congelar_orden_pago ON public.ordenes_pago;
CREATE TRIGGER trg_zzcompras_congelar_orden_pago
  BEFORE UPDATE ON public.ordenes_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_congelar_orden_pago();

REVOKE ALL ON FUNCTION public.compras_tg_congelar_recepcion()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_congelar_factura()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_congelar_orden_pago()  FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 13 · EV-04 / VER-01 · lo recibido y lo facturado de un renglón solo lo mueve el sistema
-- ════════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- [EV-04][VER-01] LO RECIBIDO Y LO FACTURADO DE UN RENGLÓN LO MUEVE SOLO EL SISTEMA
--
-- DEFECTO  `orden_compra_lineas.cantidad_recibida` y `cantidad_facturada` son los acumulados que
--          sostienen el cuadre de tres vías, el devengo y el cierre de la orden. Los mueven
--          únicamente los triggers de recepción (compras_tg_recepcion_registrar) y de factura
--          (compras_tg_factura_acumular), que abren el permiso de sistema (conta.allow_system_write
--          = 'on') mientras escriben. Pero NINGÚN trigger impedía que la sesión de un usuario los
--          fijara por su cuenta: mientras la orden es borrador, compras_tg_oc_linea_total deja pasar
--          cualquier UPDATE/INSERT del renglón.
--            · INSERT del renglón con cantidad_recibida = cantidad  → se aprueba y se emite la orden,
--              se registra la factura contra ese renglón y se APRUEBA y CONTABILIZA sin que exista
--              recepción alguna (se salta «recibir» y el cuadre de tres vías).
--            · INSERT/UPDATE con cantidad_facturada sembrada → el renglón queda «ya facturado» y no
--              se puede facturar lo realmente recibido.
--
-- CORRECCIÓN  Un trigger NUEVO y pequeño (BEFORE INSERT OR UPDATE), solo para sesiones de usuario
--          (compras_sesion_usuario(): auth.uid() no nulo y sin el permiso de sistema):
--            · INSERT: el renglón nace con 0 recibido y 0 facturado (un valor distinto se rechaza);
--            · UPDATE: ninguno de los dos cambia (reescribir el mismo valor es inocuo).
--          Mismo patrón que `monto_pagado` en compras_tg_permiso_factura (0300): se RECHAZA con un
--          mensaje claro en lugar de «corregir en silencio». Los triggers de recepción/factura,
--          los procesos sin sesión (service_role, migraciones, importaciones) y las cascadas del
--          motor no pasan por aquí.
--
-- NO HACE  No toca compras_tg_oc_linea_total ni compras_tg_linea_inventario (siguen igual). No
--          cambia quién puede crear o editar renglones, ni el resto de columnas del renglón.
-- IMPACTO EN DATOS EXISTENTES: ninguno (restringe INSERT y UPDATE nuevos). Para ver si algún renglón
--          ya trae acumulados que no respalda ninguna recepción/factura, ver el diagnóstico al pie.
-- IDEMPOTENTE · REVERTIR:
--   DROP TRIGGER trg_compras_oc_linea_acumulados ON public.orden_compra_lineas;
--   DROP FUNCTION public.compras_tg_oc_linea_acumulados();
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compras_tg_oc_linea_acumulados()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- Recepción/factura (permiso de sistema), procesos sin sesión y cascadas: no son una sesión de usuario.
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.cantidad_recibida IS DISTINCT FROM 0 OR NEW.cantidad_facturada IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'COMPRAS_ACUMULADO_SOLO_SISTEMA: un renglón de orden nace con 0 recibido y 0 facturado (se pidió % recibido y % facturado). Lo recibido lo mueven las recepciones registradas y lo facturado las facturas aprobadas; no se capturan a mano.',
        COALESCE(NEW.cantidad_recibida::text, 'NULL'), COALESCE(NEW.cantidad_facturada::text, 'NULL')
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.cantidad_recibida IS DISTINCT FROM OLD.cantidad_recibida
     OR NEW.cantidad_facturada IS DISTINCT FROM OLD.cantidad_facturada THEN
    RAISE EXCEPTION 'COMPRAS_ACUMULADO_SOLO_SISTEMA: lo recibido (% → %) y lo facturado (% → %) de un renglón de orden los mueven las recepciones registradas y las facturas aprobadas; no se escriben a mano. Si una recepción o una factura está mal, anúlala: se revierte y queda en el historial.',
      OLD.cantidad_recibida, NEW.cantidad_recibida, OLD.cantidad_facturada, NEW.cantidad_facturada
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.compras_tg_oc_linea_acumulados() IS
  '[EV-04][VER-01] cantidad_recibida y cantidad_facturada de un renglón de orden nacen en 0 y no las cambia una sesión de usuario; solo los triggers de recepción y de factura (permiso de sistema). Procesos sin sesión pasan.';

REVOKE ALL ON FUNCTION public.compras_tg_oc_linea_acumulados() FROM PUBLIC, anon, authenticated;

-- Orden alfabético: corre antes de trg_compras_oc_linea_total, así el rechazo por acumulado trae su
-- propio código (COMPRAS_ACUMULADO_SOLO_SISTEMA) y no el genérico de orden inmutable.
DROP TRIGGER IF EXISTS trg_compras_oc_linea_acumulados ON public.orden_compra_lineas;
CREATE TRIGGER trg_compras_oc_linea_acumulados
  BEFORE INSERT OR UPDATE ON public.orden_compra_lineas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_oc_linea_acumulados();

-- ── Diagnóstico (solo lectura, para correr antes de desplegar en producción) ────────────────────
--   Renglones con lo recibido que ninguna recepción registrada respalda (o con lo facturado que
--   ninguna factura aprobada respalda). Debe devolver CERO filas.
--
--   SELECT l.id, l.orden_compra_id, l.cantidad_recibida,
--          COALESCE((SELECT sum(rl.cantidad) FROM public.recepcion_lineas rl
--                      JOIN public.recepciones r ON r.id = rl.recepcion_id AND r.estado = 'registrada'
--                     WHERE rl.orden_compra_linea_id = l.id), 0) AS respaldo_recibido,
--          l.cantidad_facturada,
--          COALESCE((SELECT sum(fl.cantidad) FROM public.factura_proveedor_lineas fl
--                      JOIN public.facturas_proveedor f ON f.id = fl.factura_id
--                       AND f.estado IN ('aprobada','pagada_parcial','pagada')
--                     WHERE fl.orden_compra_linea_id = l.id), 0) AS respaldo_facturado
--     FROM public.orden_compra_lineas l
--    WHERE l.cantidad_recibida  IS DISTINCT FROM COALESCE((SELECT sum(rl.cantidad) FROM public.recepcion_lineas rl
--                      JOIN public.recepciones r ON r.id = rl.recepcion_id AND r.estado = 'registrada'
--                     WHERE rl.orden_compra_linea_id = l.id), 0)
--       OR l.cantidad_facturada IS DISTINCT FROM COALESCE((SELECT sum(fl.cantidad) FROM public.factura_proveedor_lineas fl
--                      JOIN public.facturas_proveedor f ON f.id = fl.factura_id
--                       AND f.estado IN ('aprobada','pagada_parcial','pagada')
--                     WHERE fl.orden_compra_linea_id = l.id), 0);

-- ════════════════════════════════════════════════════════════════════════════
-- PIEZA 14 · EV-08 · el número lo asigna el servidor
-- ════════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- [EV-08] EL NÚMERO DE LA ORDEN, DE LA RECEPCIÓN Y DE LA CONTRASEÑA LO ASIGNA SOLO EL SERVIDOR
--
-- DEFECTO  Los números (OC-NNNNNN, REC-NNNNNN, CP-NNNNNN) los pone el servidor con un correlativo
--          (compras_siguiente_correlativo) cuando el documento se aprueba / registra / emite, pero
--          NADA impedía que el cliente los eligiera:
--            · INSERT de una orden en borrador con numero = 'OC-000014' (el próximo correlativo);
--            · INSERT de una recepción en borrador con numero = 'REC-000006';
--            · INSERT de una contraseña con numero = 'CP-000004' (esta se numera al nacer);
--            · o fijar el número en el mismo UPDATE que aprueba / registra.
--          El trigger de estado solo asigna `IF NEW.numero IS NULL`, así que respeta el número
--          reservado y el siguiente documento legítimo choca con el índice único
--          (uq_ordenes_compra_numero / uq_recepciones_numero / uq_contrasenas_numero) EN CADA
--          INTENTO: el contador se revierte con la transacción y vuelve a calcular el mismo
--          número. Con la inmutabilidad de 20261027000500 el administrador tampoco puede repararlo
--          (el número ya es inmutable, el borrador con número no se borra —0200 exige numero IS NULL—
--          y cancelar no libera el número): bastaba el permiso de «crear» para bloquear PARA SIEMPRE
--          las aprobaciones de un proyecto, y solo un superusuario podía deshacerlo.
--          Además, el número de una recepción o de una contraseña ya emitida se reescribía con
--          UPDATE (solo la orden tenía el número inmutable).
--          Mismo patrón, que este archivo NO previene con un trigger: `activos_fijos.codigo` (AF-NNNNNN)
--          es un dato que el usuario captura (no hay otro modo de dar de alta un activo a mano) y un
--          alta manual con el próximo código bloquea la recepción de bienes de activo fijo. Reservar el
--          prefijo «AF-» al servidor sería una regla de nombres nueva: queda como decisión (ver notas);
--          aquí solo se repara el desfase (sección B).
--
-- CORRECCIÓN
--   A. Una función NUEVA (compras_tg_numero_del_servidor) y dos triggers por tabla en ordenes_compra,
--      recepciones y contrasenas_pago, solo para sesiones de usuario (compras_sesion_usuario()):
--        · INSERT con numero distinto de NULL → se rechaza (COMPRAS_NUMERO_SOLO_SISTEMA);
--        · UPDATE que pone número a un documento que no lo tiene (NULL → valor, incluso en el mismo
--          UPDATE que aprueba o registra) → se rechaza;
--        · UPDATE que reescribe un número ya asignado → se rechaza (respaldo, corre al final: en la
--          orden ya lo rechaza compras_tg_oc_identidad con su propio código).
--      Se RECHAZA en lugar de ignorar: ninguna pantalla ni RPC legítima manda el número (la RPC
--      compras_orden_crear, la recepción transaccional, la contraseña y la importación de renglones
--      no lo incluyen; los esquemas del formulario tampoco), y callar el valor ocultaría el intento
--      y los errores de un cliente. Los procesos sin sesión (service_role, migraciones,
--      importaciones de histórico) siguen pudiendo fijar el número. El primer trigger lleva el nombre
--      «trg_compras_00_…» para correr ANTES de los de estado, que son los que asignan el número.
--   B. Reparación única de lo que ya pudo haberse reservado (solo SUBE los correlativos, nunca los
--      baja, y no toca ningún documento): cada contador pasa a ser, como mínimo, el mayor número
--      con formato OC-/REC-/CP- (y código AF-) que ya exista en su empresa y contabilidad. Así, un número ya
--      reservado antes de esta corrección deja de bloquear al siguiente documento legítimo.
--      Es lo que haría un DBA al importar histórico; con la corrección A, desde ahora, el servidor
--      es el único que numera.
--
-- NO HACE  No cambia compras_tg_oc_estado ni los triggers de estado, ni la inmutabilidad de
--          20261027000500, ni el borrado de 20261027000200. No obliga a numeración sin saltos: el
--          salto por un número reservado antes de esta corrección es una decisión de negocio
--          (ver notas del hallazgo).
-- IMPACTO EN DATOS EXISTENTES: B puede subir contadores (ningún documento cambia). A restringe
--          INSERT y UPDATE nuevos.
-- IDEMPOTENTE · REVERTIR:
--   DROP TRIGGER trg_compras_00_numero_servidor ON public.ordenes_compra;  (y ON public.recepciones, public.contrasenas_pago)
--   DROP TRIGGER trg_zzcompras_numero_fijo      ON public.ordenes_compra;  (y ON public.recepciones, public.contrasenas_pago)
--   DROP FUNCTION public.compras_tg_numero_del_servidor();
--   (B no se revierte: bajar un correlativo reabriría el choque con números ya emitidos.)
-- ════════════════════════════════════════════════════════════════════════════

-- ── A. El número lo asigna el servidor ──────────────────────────────────────
-- Una sola función, dos triggers por tabla (el argumento dice cuál):
--   'asignar' (trg_compras_00_numero_servidor, BEFORE INSERT OR UPDATE, corre PRIMERO): el cliente no
--             elige el número al crear ni lo pone en un documento que aún no lo tiene (NULL → valor),
--             que es lo que hace el servidor al aprobar, registrar o emitir. Corre antes de los
--             triggers de estado, que son quienes numeran.
--   'fijo'    (trg_zzcompras_numero_fijo, BEFORE UPDATE OF numero, corre ÚLTIMO): un número ya asignado
--             no se reescribe. Es un respaldo: en la orden ya lo rechaza compras_tg_oc_identidad
--             (COMPRAS_OC_NUMERO_INMUTABLE) y, donde exista, el control de identidad de la recepción;
--             corriendo al final, esos conservan su código y mensaje.
CREATE OR REPLACE FUNCTION public.compras_tg_numero_del_servidor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_que text := CASE TG_TABLE_NAME
                  WHEN 'ordenes_compra'   THEN 'la orden de compra'
                  WHEN 'recepciones'      THEN 'la recepción'
                  WHEN 'contrasenas_pago' THEN 'la contraseña de pago'
                  ELSE 'el documento'
                END;
BEGIN
  -- Los procesos sin sesión (service_role, migraciones, importaciones) y los triggers de sistema
  -- no son una sesión de usuario: pueden fijar el número (histórico importado).
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF TG_ARGV[0] = 'asignar' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.numero IS NOT NULL THEN
        RAISE EXCEPTION 'COMPRAS_NUMERO_SOLO_SISTEMA: el número de % lo asigna el servidor (al aprobar, registrar o emitir); no se elige al capturar (se pidió «%»). Déjalo vacío.',
          v_que, NEW.numero
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF OLD.numero IS NULL AND NEW.numero IS NOT NULL THEN
      RAISE EXCEPTION 'COMPRAS_NUMERO_SOLO_SISTEMA: el número de % lo asigna el servidor (al aprobar, registrar o emitir); no se escribe a mano (se pidió «%»).',
        v_que, NEW.numero
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- 'fijo'
  IF OLD.numero IS NOT NULL AND NEW.numero IS DISTINCT FROM OLD.numero THEN
    RAISE EXCEPTION 'COMPRAS_NUMERO_SOLO_SISTEMA: el número de % (%) es su identidad, lo asignó el servidor y no se reescribe.',
      v_que, OLD.numero
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.compras_tg_numero_del_servidor() IS
  '[EV-08] El número de la orden, la recepción y la contraseña lo asigna solo el servidor: una sesión de usuario no lo elige al crear, no lo pone al aprobar/registrar y no reescribe el ya asignado. Procesos sin sesión (importaciones) pasan.';

REVOKE ALL ON FUNCTION public.compras_tg_numero_del_servidor() FROM PUBLIC, anon, authenticated;

-- ordenes_compra
DROP TRIGGER IF EXISTS trg_compras_00_numero_servidor ON public.ordenes_compra;
CREATE TRIGGER trg_compras_00_numero_servidor
  BEFORE INSERT OR UPDATE ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_numero_del_servidor('asignar');
DROP TRIGGER IF EXISTS trg_zzcompras_numero_fijo ON public.ordenes_compra;
CREATE TRIGGER trg_zzcompras_numero_fijo
  BEFORE UPDATE OF numero ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_numero_del_servidor('fijo');

-- recepciones
DROP TRIGGER IF EXISTS trg_compras_00_numero_servidor ON public.recepciones;
CREATE TRIGGER trg_compras_00_numero_servidor
  BEFORE INSERT OR UPDATE ON public.recepciones
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_numero_del_servidor('asignar');
DROP TRIGGER IF EXISTS trg_zzcompras_numero_fijo ON public.recepciones;
CREATE TRIGGER trg_zzcompras_numero_fijo
  BEFORE UPDATE OF numero ON public.recepciones
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_numero_del_servidor('fijo');

-- contrasenas_pago (se numera al nacer)
DROP TRIGGER IF EXISTS trg_compras_00_numero_servidor ON public.contrasenas_pago;
CREATE TRIGGER trg_compras_00_numero_servidor
  BEFORE INSERT OR UPDATE ON public.contrasenas_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_numero_del_servidor('asignar');
DROP TRIGGER IF EXISTS trg_zzcompras_numero_fijo ON public.contrasenas_pago;
CREATE TRIGGER trg_zzcompras_numero_fijo
  BEFORE UPDATE OF numero ON public.contrasenas_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_numero_del_servidor('fijo');

-- ── B. Reparación única: ningún contador queda por debajo de un número que ya existe ────────────
-- Solo sube (UPDATE … WHERE ultimo < máximo; crea el contador si falta); no modifica documentos y, si
-- nada está desfasado, no toca ni bloquea ninguna fila. Idempotente. Incluye el código de los activos
-- fijos (AF-NNNNNN, que asigna el servidor al recibir bienes): si ya existe un código por encima del
-- contador (alta manual previa), el siguiente que asigne el servidor ya no choca con él. El orden de
-- los tipos (recepción antes que activo fijo) es el mismo en que los toma la recepción.
DO $$
DECLARE
  v_doc record;
BEGIN
  FOR v_doc IN
    SELECT * FROM (VALUES
      (1, 'orden_compra',    'ordenes_compra',   'numero', 'OC'),
      (2, 'recepcion',       'recepciones',      'numero', 'REC'),
      (3, 'contrasena_pago', 'contrasenas_pago', 'numero', 'CP'),
      (4, 'activo_fijo',     'activos_fijos',    'codigo', 'AF')
    ) AS t(orden, documento, tabla, columna, prefijo)
    ORDER BY orden
  LOOP
    EXECUTE format($q$
      WITH m AS (
        SELECT d.company_id, d.project_id, max(substring(d.%1$I FROM %2$L)::bigint) AS maximo
          FROM public.%3$I d
         WHERE d.%1$I ~ %4$L
         GROUP BY d.company_id, d.project_id
      ), subir AS (
        UPDATE public.compras_correlativos c
           SET ultimo = m.maximo
          FROM m
         WHERE c.documento = %5$L AND c.company_id = m.company_id
           AND c.project_id IS NOT DISTINCT FROM m.project_id
           AND c.ultimo < m.maximo
        RETURNING c.company_id
      )
      INSERT INTO public.compras_correlativos (company_id, project_id, documento, ultimo)
      SELECT m.company_id, m.project_id, %5$L, m.maximo
        FROM m
       WHERE NOT EXISTS (SELECT 1 FROM public.compras_correlativos c
                          WHERE c.documento = %5$L AND c.company_id = m.company_id
                            AND c.project_id IS NOT DISTINCT FROM m.project_id)
      ON CONFLICT DO NOTHING
    $q$, v_doc.columna, '^' || v_doc.prefijo || '-([0-9]{1,15})$', v_doc.tabla,
         '^' || v_doc.prefijo || '-[0-9]{1,15}$', v_doc.documento);
  END LOOP;
END;
$$;

-- ── Diagnóstico (solo lectura, para correr antes de desplegar en producción) ────────────────────
--   Documentos cuyo número está POR ENCIMA del correlativo (nadie más que un cliente pudo ponerlo)
--   y borradores / recepciones sin registrar que ya traen número (el servidor numera al aprobar o
--   registrar). Cada consulta debe devolver CERO filas.
--
--   SELECT 'orden' AS doc, o.id, o.numero, o.estado, c.ultimo
--     FROM public.ordenes_compra o
--     LEFT JOIN public.compras_correlativos c ON c.company_id = o.company_id AND c.project_id IS NOT DISTINCT FROM o.project_id AND c.documento = 'orden_compra'
--    WHERE o.numero ~ '^OC-[0-9]{1,15}$' AND substring(o.numero FROM 4)::bigint > COALESCE(c.ultimo, 0)
--   UNION ALL
--   SELECT 'recepcion', r.id, r.numero, r.estado, c.ultimo
--     FROM public.recepciones r
--     LEFT JOIN public.compras_correlativos c ON c.company_id = r.company_id AND c.project_id IS NOT DISTINCT FROM r.project_id AND c.documento = 'recepcion'
--    WHERE r.numero ~ '^REC-[0-9]{1,15}$' AND substring(r.numero FROM 5)::bigint > COALESCE(c.ultimo, 0)
--   UNION ALL
--   SELECT 'contrasena', p.id, p.numero, p.estado, c.ultimo
--     FROM public.contrasenas_pago p
--     LEFT JOIN public.compras_correlativos c ON c.company_id = p.company_id AND c.project_id IS NOT DISTINCT FROM p.project_id AND c.documento = 'contrasena_pago'
--    WHERE p.numero ~ '^CP-[0-9]{1,15}$' AND substring(p.numero FROM 4)::bigint > COALESCE(c.ultimo, 0);
--
--   SELECT id, numero, estado FROM public.ordenes_compra WHERE estado = 'borrador' AND revision = 0 AND aprobada_at IS NULL AND numero IS NOT NULL;
--   SELECT id, numero, estado FROM public.recepciones    WHERE estado = 'borrador' AND registrada_at IS NULL AND numero IS NOT NULL;
--
--   Activos fijos con código del servidor (AF-NNNNNN) por encima del correlativo (alta manual previa):
--   SELECT a.id, a.codigo, c.ultimo FROM public.activos_fijos a
--     LEFT JOIN public.compras_correlativos c ON c.company_id = a.company_id AND c.project_id IS NOT DISTINCT FROM a.project_id AND c.documento = 'activo_fijo'
--    WHERE a.codigo ~ '^AF-[0-9]{1,15}$' AND substring(a.codigo FROM 4)::bigint > COALESCE(c.ultimo, 0);
