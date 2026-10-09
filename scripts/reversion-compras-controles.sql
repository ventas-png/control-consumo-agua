-- ════════════════════════════════════════════════════════════════════════════
-- REVERSIÓN DE LAS MIGRACIONES 20261027000000…0800 (compras · controles de servidor)
-- GENERADO del catálogo de una cadena real de migraciones (no se edita a mano): cada sección deshace UNA migración
-- y supone que las posteriores ya están revertidas (por eso van de la última a la primera).
-- Cada bloque es una transacción: si algo falla, no queda nada a medias. Son solo funciones, disparadores,
-- índices y restricciones; NO hay datos que borrar ni restaurar (salvo las claves de idempotencia de 0800).
-- Revertir REABRE los defectos que cada migración cerraba. Verificado con 
-- supabase/tests/compras_bloque_b/run.sh §6c (aplica la cadena, revierte y compara el catálogo de 9 613 objetos).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 20261027000800_compras_cierre_hallazgos_adversariales ─────────────────
BEGIN;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.activos_fijos;
DROP TRIGGER IF EXISTS trg_compras_alcance_activo ON public.activos_fijos;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.contrasena_pago_facturas;
DROP TRIGGER IF EXISTS trg_compras_bloqueo_partida ON public.contrasena_pago_facturas;
DROP TRIGGER IF EXISTS trg_compras_bloqueo_partida_orden ON public.contrasena_pago_facturas;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_compras_00_numero_servidor ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_compras_00_sellos_contrasena ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_compras_contrasena_cabecera_fija ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_compras_contrasena_clave_inmutable ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_compras_contrasena_total_derivado ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_zcompras_contrasena_estados ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_zzcompras_numero_fijo ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.contratos_proveedores;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.evaluaciones_proveedor;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.factura_proveedor_lineas;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.facturas_proveedor;
DROP TRIGGER IF EXISTS trg_compras_00_sellos_factura ON public.facturas_proveedor;
DROP TRIGGER IF EXISTS trg_zcompras_factura_estados ON public.facturas_proveedor;
DROP TRIGGER IF EXISTS trg_zcompras_factura_identidad ON public.facturas_proveedor;
DROP TRIGGER IF EXISTS trg_zcompras_factura_total_cuadra ON public.facturas_proveedor;
DROP TRIGGER IF EXISTS trg_zzcompras_congelar_factura ON public.facturas_proveedor;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.gastos_condominio;
DROP TRIGGER IF EXISTS trg_compras_alcance_gasto ON public.gastos_condominio;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.orden_compra_lineas;
DROP TRIGGER IF EXISTS trg_compras_oc_linea_acumulados ON public.orden_compra_lineas;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_compras_00_numero_servidor ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_compras_00_sellos_orden ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_compras_01_importes_orden ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_compras_alcance_orden_obra ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_compras_oc_motivos ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_compras_permiso_orden_separada ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_zzcompras_numero_fijo ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_compras_00_sellos_orden_pago ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_compras_alcance_orden_pago_ref ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_compras_bloqueo_orden_pago ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_compras_orden_pago_bloqueo ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_compras_orden_pago_clave_inmutable ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_compras_orden_pago_controles_contrasena ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_compras_orden_pago_controles_partidas ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_conta_ordenes_pago_verificar ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_zzcompras_congelar_orden_pago ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.proformas_condominio;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.proveedor_contactos;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.proveedor_proyectos;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.proveedores;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.recepcion_lineas;
DROP TRIGGER IF EXISTS trg_00_compras_rls_respaldo_recepcion ON public.recepcion_respaldos;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.recepciones;
DROP TRIGGER IF EXISTS trg_compras_00_numero_servidor ON public.recepciones;
DROP TRIGGER IF EXISTS trg_compras_00_sellos_recepcion ON public.recepciones;
DROP TRIGGER IF EXISTS trg_zcompras_recepcion_estados ON public.recepciones;
DROP TRIGGER IF EXISTS trg_zcompras_recepcion_identidad ON public.recepciones;
DROP TRIGGER IF EXISTS trg_zzcompras_congelar_recepcion ON public.recepciones;
DROP TRIGGER IF EXISTS trg_zzcompras_numero_fijo ON public.recepciones;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.suministros_condominio;
DROP INDEX IF EXISTS public.uq_contrasenas_pago_clave;
DROP INDEX IF EXISTS public.uq_ordenes_pago_clave;
DROP INDEX IF EXISTS public.uq_ordenes_pago_contrasena_viva;
ALTER TABLE contrasenas_pago DROP CONSTRAINT IF EXISTS contrasenas_pago_clave_longitud;
ALTER TABLE ordenes_pago DROP CONSTRAINT IF EXISTS ordenes_pago_clave_longitud;
ALTER TABLE public.contrasenas_pago DROP COLUMN IF EXISTS clave_idempotencia;
ALTER TABLE public.ordenes_pago DROP COLUMN IF EXISTS clave_idempotencia;
-- función reescrita: se restaura su definición anterior
CREATE OR REPLACE FUNCTION public.compras_normalizar_numero(p_numero text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT NULLIF(regexp_replace(upper(coalesce(p_numero, '')), '[^A-Z0-9]', '', 'g'), '')
$function$;
-- función reescrita: se restaura su definición anterior
CREATE OR REPLACE FUNCTION public.compras_tg_alcance_documento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.company_id   IS NOT DISTINCT FROM OLD.company_id
     AND NEW.project_id   IS NOT DISTINCT FROM OLD.project_id
     AND NEW.proveedor_id IS NOT DISTINCT FROM OLD.proveedor_id THEN
    RETURN NEW;
  END IF;
  PERFORM public.compras_alcance_verificar(NEW.company_id, NEW.project_id, NEW.proveedor_id, TG_ARGV[0]);
  RETURN NEW;
END;
$function$;
-- función reescrita: se restaura su definición anterior
CREATE OR REPLACE FUNCTION public.compras_tg_factura_numero_equivalente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_norm text := public.compras_normalizar_numero(NEW.numero_factura);
  v_dup  record;
BEGIN
  IF v_norm IS NULL OR NEW.estado = 'anulada' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.numero_factura IS NOT DISTINCT FROM OLD.numero_factura
     AND NEW.proveedor_id   =  OLD.proveedor_id THEN
    RETURN NEW;
  END IF;

  -- Dos altas simultáneas del mismo número se serializan: la segunda ve a la primera.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('factura-numero:' || NEW.company_id::text || ':' || NEW.proveedor_id::text || ':' || v_norm, 0));

  SELECT f.numero_factura, f.estado, f.fecha_emision, f.monto_total INTO v_dup
    FROM public.facturas_proveedor f
   WHERE f.company_id   = NEW.company_id
     AND f.proveedor_id = NEW.proveedor_id
     AND f.id          <> NEW.id
     AND f.estado      <> 'anulada'
     -- El número IDÉNTICO lo rechaza el índice único `uq_facturas_prov_numero` con su error
     -- de siempre; aquí solo el mismo número escrito de otra forma.
     AND f.numero_factura IS DISTINCT FROM NEW.numero_factura
     AND public.compras_normalizar_numero(f.numero_factura) = v_norm
   LIMIT 1;

  IF FOUND THEN
    -- Mismo SQLSTATE y mismo nombre de restricción que el índice único exacto: la RPC
    -- `compras_factura_crear` ya traduce ese error y el cliente ya lo muestra.
    RAISE EXCEPTION 'COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente («%», % por %, %). Si es la misma, no la registres otra vez.',
      v_dup.numero_factura, to_char(v_dup.fecha_emision, 'DD/MM/YYYY'), v_dup.monto_total, v_dup.estado
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'uq_facturas_prov_numero';
  END IF;
  RETURN NEW;
END;
$function$;
-- función reescrita: se restaura su definición anterior
CREATE OR REPLACE FUNCTION public.compras_tg_no_borrar_documento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
-- función reescrita: se restaura su definición anterior
CREATE OR REPLACE FUNCTION public.compras_tg_orden_pago_controles()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
-- función reescrita: se restaura su definición anterior
CREATE OR REPLACE FUNCTION public.proveedor_habilitado(p_proveedor_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.proveedores
    WHERE id = p_proveedor_id
      AND estado = 'autorizado'
      AND (autorizacion_vence IS NULL OR autorizacion_vence >= CURRENT_DATE)
  )
$function$;
DROP FUNCTION IF EXISTS compras_evidencia_documento(text,uuid);
DROP FUNCTION IF EXISTS compras_puede_ver_documento(uuid,uuid);
DROP FUNCTION IF EXISTS compras_sello_conservar(text,text,anyelement,anyelement);
DROP FUNCTION IF EXISTS compras_tg_alcance_orden_obra();
DROP FUNCTION IF EXISTS compras_tg_alcance_orden_pago_ref();
DROP FUNCTION IF EXISTS compras_tg_alcance_referencias();
DROP FUNCTION IF EXISTS compras_tg_bloqueo_orden_pago();
DROP FUNCTION IF EXISTS compras_tg_bloqueo_partida();
DROP FUNCTION IF EXISTS compras_tg_bloqueo_partida_orden();
DROP FUNCTION IF EXISTS compras_tg_congelar_factura();
DROP FUNCTION IF EXISTS compras_tg_congelar_orden_pago();
DROP FUNCTION IF EXISTS compras_tg_congelar_recepcion();
DROP FUNCTION IF EXISTS compras_tg_contrasena_cabecera_fija();
DROP FUNCTION IF EXISTS compras_tg_contrasena_maquina_estados();
DROP FUNCTION IF EXISTS compras_tg_contrasena_total_derivado();
DROP FUNCTION IF EXISTS compras_tg_factura_identidad_fija();
DROP FUNCTION IF EXISTS compras_tg_factura_maquina_estados();
DROP FUNCTION IF EXISTS compras_tg_factura_total_cuadra();
DROP FUNCTION IF EXISTS compras_tg_importes_orden();
DROP FUNCTION IF EXISTS compras_tg_motivos_orden();
DROP FUNCTION IF EXISTS compras_tg_numero_del_servidor();
DROP FUNCTION IF EXISTS compras_tg_oc_linea_acumulados();
DROP FUNCTION IF EXISTS compras_tg_orden_pago_bloqueo();
DROP FUNCTION IF EXISTS compras_tg_orden_pago_controles_contrasena();
DROP FUNCTION IF EXISTS compras_tg_orden_pago_controles_partidas();
DROP FUNCTION IF EXISTS compras_tg_pago_clave_inmutable();
DROP FUNCTION IF EXISTS compras_tg_permiso_orden_separada();
DROP FUNCTION IF EXISTS compras_tg_recepcion_identidad_fija();
DROP FUNCTION IF EXISTS compras_tg_recepcion_maquina_estados();
DROP FUNCTION IF EXISTS compras_tg_rls_empresa();
DROP FUNCTION IF EXISTS compras_tg_rls_respaldo_recepcion();
DROP FUNCTION IF EXISTS compras_tg_sellos_contrasena();
DROP FUNCTION IF EXISTS compras_tg_sellos_factura();
DROP FUNCTION IF EXISTS compras_tg_sellos_orden();
DROP FUNCTION IF EXISTS compras_tg_sellos_orden_pago();
DROP FUNCTION IF EXISTS compras_tg_sellos_recepcion();
DROP FUNCTION IF EXISTS conta_tg_ordenes_pago_verificar();
COMMIT;

-- ── 20261027000700_compras_orden_nace_con_permiso ─────────────────────────
BEGIN;
-- función reescrita: se restaura su definición anterior
CREATE OR REPLACE FUNCTION public.compras_tg_permiso_orden()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
COMMIT;

-- ── 20261027000600_compras_proveedor_identidad_restaurada ─────────────────
BEGIN;
-- función reescrita: se restaura su definición anterior
CREATE OR REPLACE FUNCTION public.proveedores_tg_identidad()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_norm      text;
  v_norm_old  text;
  v_dup       record;
  v_nombre_n  text;
  v_codigo_propio boolean;
BEGIN
  NEW.pais   := NULLIF(upper(btrim(NEW.pais)), '');
  NEW.codigo := NULLIF(btrim(NEW.codigo), '');
  -- ¿La persona eligió un código? (antes de que el correlativo lo rellene)
  v_codigo_propio := NEW.codigo IS NOT NULL;

  IF TG_OP = 'INSERT' AND NEW.codigo IS NULL THEN
    NEW.codigo := public.proveedor_siguiente_codigo(NEW.company_id);
  END IF;

  -- La columna generada todavía no existe en un BEFORE: se calcula la misma
  -- expresión.
  v_norm := public.proveedor_normalizar_identificacion(
    COALESCE(NULLIF(btrim(NEW.nit), ''), NULLIF(btrim(NEW.rfc), '')));

  IF TG_OP = 'UPDATE' THEN
    v_norm_old := public.proveedor_normalizar_identificacion(
      COALESCE(NULLIF(btrim(OLD.nit), ''), NULLIF(btrim(OLD.rfc), '')));
  END IF;

  -- Solo cuando la IDENTIDAD cambia (o nace). Editar el teléfono de un
  -- proveedor que ya está duplicado de antes no puede quedar bloqueado: esos
  -- casos se resuelven con proveedores_duplicados_fiscales(), no aquí.
  IF v_norm IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR v_norm IS DISTINCT FROM v_norm_old
          OR NEW.pais IS DISTINCT FROM OLD.pais) THEN

    -- Candado consultivo: dos altas simultáneas del mismo NIT se serializan y
    -- la segunda ve a la primera.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('proveedor-identidad:' || NEW.company_id::text || ':' || v_norm, 0));

    SELECT p.id, p.nombre, p.codigo INTO v_dup
      FROM public.proveedores p
     WHERE p.company_id = NEW.company_id
       AND p.id <> NEW.id
       AND p.identificacion_norm = v_norm
       AND (p.pais IS NULL OR NEW.pais IS NULL OR p.pais = NEW.pais)
     LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'PROVEEDOR_DUPLICADO: la identificación fiscal ya pertenece a "%" (código %). Usa ese proveedor o corrige la identificación.',
        v_dup.nombre, COALESCE(v_dup.codigo, 's/código')
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  -- Sin identificación fiscal y sin código propio, el NOMBRE es lo único que hay: el mismo
  -- nombre escrito otra vez (otras mayúsculas, acentos, espacios o puntuación) no crea
  -- OTRO proveedor. La misma regla que la carga masiva. Solo al nacer, al cambiar el
  -- nombre o al quitar la identificación: un duplicado histórico no se bloquea.
  v_nombre_n := public.proveedor_normalizar_nombre(NEW.nombre);
  IF v_norm IS NULL AND v_nombre_n <> ''
     AND ((TG_OP = 'INSERT' AND NOT v_codigo_propio)
          OR (TG_OP = 'UPDATE'
              AND (NEW.nombre IS DISTINCT FROM OLD.nombre OR v_norm_old IS NOT NULL))) THEN

    PERFORM pg_advisory_xact_lock(
      hashtextextended('proveedor-nombre:' || NEW.company_id::text || ':' || v_nombre_n, 0));

    SELECT p.id, p.nombre, p.codigo INTO v_dup
      FROM public.proveedores p
     WHERE p.company_id = NEW.company_id
       AND p.id <> NEW.id
       AND public.proveedor_normalizar_nombre(p.nombre) = v_nombre_n
     LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'PROVEEDOR_DUPLICADO: ya existe un proveedor con ese nombre ("%", código %). Los nombres no unen registros: usa ese proveedor, o agrega la identificación fiscal (o un código propio) para crear otro distinto.',
        v_dup.nombre, COALESCE(v_dup.codigo, 's/código')
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
COMMIT;

-- ── 20261027000500_compras_orden_trazabilidad_posterior ───────────────────
BEGIN;
DROP TRIGGER IF EXISTS trg_compras_oc_identidad ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_compras_oc_modificacion ON public.ordenes_compra;
-- La restricción orden_compra_eventos_tipo_check se AMPLIÓ y se conserva: las filas ya escritas con los valores nuevos violarían la anterior.
-- (solo si NO hay filas con los valores nuevos:)  ALTER TABLE orden_compra_eventos DROP CONSTRAINT orden_compra_eventos_tipo_check, ADD CONSTRAINT orden_compra_eventos_tipo_check CHECK ((tipo = ANY (ARRAY['estado'::text, 'devolucion'::text, 'excepcion_contrato'::text])));
DROP FUNCTION IF EXISTS compras_tg_oc_identidad();
DROP FUNCTION IF EXISTS compras_tg_oc_modificacion();
COMMIT;

-- ── 20261027000400_compras_duplicados_proveedor_y_factura ─────────────────
BEGIN;
DROP TRIGGER IF EXISTS trg_compras_factura_numero_equivalente ON public.facturas_proveedor;
DROP INDEX IF EXISTS public.idx_facturas_prov_numero_norm;
-- función reescrita: se restaura su definición anterior
CREATE OR REPLACE FUNCTION public.proveedores_tg_identidad()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_norm     text;
  v_norm_old text;
  v_dup      record;
BEGIN
  NEW.pais   := NULLIF(upper(btrim(NEW.pais)), '');
  NEW.codigo := NULLIF(btrim(NEW.codigo), '');

  IF TG_OP = 'INSERT' AND NEW.codigo IS NULL THEN
    NEW.codigo := public.proveedor_siguiente_codigo(NEW.company_id);
  END IF;

  -- La columna generada todavía no existe en un BEFORE: se calcula la misma
  -- expresión.
  v_norm := public.proveedor_normalizar_identificacion(
    COALESCE(NULLIF(btrim(NEW.nit), ''), NULLIF(btrim(NEW.rfc), '')));

  IF TG_OP = 'UPDATE' THEN
    v_norm_old := public.proveedor_normalizar_identificacion(
      COALESCE(NULLIF(btrim(OLD.nit), ''), NULLIF(btrim(OLD.rfc), '')));
  END IF;

  -- Solo cuando la IDENTIDAD cambia (o nace). Editar el teléfono de un
  -- proveedor que ya está duplicado de antes no puede quedar bloqueado: esos
  -- casos se resuelven con proveedores_duplicados_fiscales(), no aquí.
  IF v_norm IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR v_norm IS DISTINCT FROM v_norm_old
          OR NEW.pais IS DISTINCT FROM OLD.pais) THEN

    -- Candado consultivo: dos altas simultáneas del mismo NIT se serializan y
    -- la segunda ve a la primera.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('proveedor-identidad:' || NEW.company_id::text || ':' || v_norm, 0));

    SELECT p.id, p.nombre, p.codigo INTO v_dup
      FROM public.proveedores p
     WHERE p.company_id = NEW.company_id
       AND p.id <> NEW.id
       AND p.identificacion_norm = v_norm
       AND (p.pais IS NULL OR NEW.pais IS NULL OR p.pais = NEW.pais)
     LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'PROVEEDOR_DUPLICADO: la identificación fiscal ya pertenece a "%" (código %). Usa ese proveedor o corrige la identificación.',
        v_dup.nombre, COALESCE(v_dup.codigo, 's/código')
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
DROP FUNCTION IF EXISTS compras_normalizar_numero(text);
DROP FUNCTION IF EXISTS compras_tg_factura_numero_equivalente();
COMMIT;

-- ── 20261027000300_compras_permisos_y_estados_por_accion ──────────────────
BEGIN;
DROP TRIGGER IF EXISTS trg_compras_permiso_contrasena ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_compras_permiso_factura ON public.facturas_proveedor;
DROP TRIGGER IF EXISTS trg_compras_permiso_orden ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_compras_permiso_orden_pago ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_compras_permiso_recepcion ON public.recepciones;
DROP FUNCTION IF EXISTS compras_exigir_accion(text,text);
DROP FUNCTION IF EXISTS compras_sesion_usuario();
DROP FUNCTION IF EXISTS compras_tg_permiso_contrasena();
DROP FUNCTION IF EXISTS compras_tg_permiso_factura();
DROP FUNCTION IF EXISTS compras_tg_permiso_orden();
DROP FUNCTION IF EXISTS compras_tg_permiso_orden_pago();
DROP FUNCTION IF EXISTS compras_tg_permiso_recepcion();
COMMIT;

-- ── 20261027000200_compras_documentos_sin_borrado ─────────────────────────
BEGIN;
DROP TRIGGER IF EXISTS trg_compras_no_borrar_partida ON public.contrasena_pago_facturas;
DROP TRIGGER IF EXISTS trg_compras_no_borrar ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_compras_no_borrar ON public.facturas_proveedor;
DROP TRIGGER IF EXISTS trg_compras_no_borrar ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_compras_no_borrar ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_compras_no_borrar ON public.recepciones;
DROP FUNCTION IF EXISTS compras_tg_no_borrar_documento();
DROP FUNCTION IF EXISTS compras_tg_no_borrar_partida();
COMMIT;

-- ── 20261027000100_compras_pagos_controles ────────────────────────────────
BEGIN;
DROP TRIGGER IF EXISTS trg_compras_orden_pago_controles ON public.ordenes_pago;
DROP FUNCTION IF EXISTS compras_tg_orden_pago_controles();
COMMIT;

-- ── 20261027000000_compras_aislamiento_referencias ────────────────────────
BEGIN;
DROP TRIGGER IF EXISTS trg_compras_alcance_contrasena_factura ON public.contrasena_pago_facturas;
DROP TRIGGER IF EXISTS trg_compras_alcance_contrasena ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_compras_alcance_factura_linea ON public.factura_proveedor_lineas;
DROP TRIGGER IF EXISTS trg_compras_alcance_factura ON public.facturas_proveedor;
DROP TRIGGER IF EXISTS trg_compras_alcance_oc_linea ON public.orden_compra_lineas;
DROP TRIGGER IF EXISTS trg_compras_alcance_orden ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_compras_alcance_orden_pago ON public.ordenes_pago;
DROP FUNCTION IF EXISTS compras_alcance_verificar(uuid,uuid,uuid,text);
DROP FUNCTION IF EXISTS compras_tg_alcance_contrasena_factura();
DROP FUNCTION IF EXISTS compras_tg_alcance_documento();
DROP FUNCTION IF EXISTS compras_tg_alcance_factura_linea();
DROP FUNCTION IF EXISTS compras_tg_alcance_oc_linea();
COMMIT;
