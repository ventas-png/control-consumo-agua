-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS — FASE 6 · parte D: LA FACTURA CONTRA LA ORDEN (CUADRE 3 VÍAS)
-- Ver ROADMAP_ERP_FINANZAS.md (Fase 6). Depende de las partes B y C.
--
-- POR QUÉ EXISTE
-- Hoy aprobar una factura de proveedor devenga el gasto sin que NADA compare
-- lo facturado con lo que se pidió y lo que llegó. Es el punto exacto donde se
-- paga de más: un precio distinto al cotizado, una cantidad que nunca entró, o
-- la misma factura capturada dos veces. La factura tampoco tiene líneas, así
-- que aunque se quisiera comparar, no habría contra qué.
--
-- QUÉ HACE
--   1. `facturas_proveedor.orden_compra_id` + `factura_proveedor_lineas`
--      ligadas a la línea de la ORDEN: así la comparación es por renglón.
--   2. `compras_validar_match()`: pedido vs recibido vs facturado, en cantidad
--      y en precio, con la tolerancia de `compras_config`.
--   3. Un trigger que BLOQUEA la aprobación fuera de tolerancia, salvo que
--      alguien con permiso de aprobación la fuerce dejando por escrito por qué.
--   4. El devengo aprende la ruta GR/IR: con orden y recepción previa, el debe
--      va contra 2105 (que la recepción ya acreditó) y NO contra el gasto —
--      porque el gasto/activo/inventario ya se registró cuando el bien entró.
--      La diferencia de precio dentro de tolerancia se manda a la cuenta de
--      destino, para que la 2105 cierre en cero y no quede sucia.
--
-- COMPATIBILIDAD
-- Una factura SIN orden de compra —gasto directo, caja chica, servicios
-- recurrentes— se comporta EXACTAMENTE como antes: mismo asiento, mismas
-- cuentas, sin cuadre que la estorbe. Toda la lógica nueva cuelga de que haya
-- `orden_compra_id` y líneas.
--
-- CÓMO REVERTIR
--   Restaurar conta_tg_facturas_prov() a la versión de 20260611070000;
--   DROP TRIGGER trg_compras_factura_match ON public.facturas_proveedor;
--   DROP FUNCTION public.compras_validar_match(uuid);
--   DROP TABLE public.factura_proveedor_lineas;
--   ALTER TABLE public.facturas_proveedor
--     DROP COLUMN orden_compra_id, DROP COLUMN match_forzado_por,
--     DROP COLUMN match_justificacion;
--
-- IMPACTO EN DATOS PRODUCTIVOS: ninguno sobre filas existentes. Las facturas ya
-- capturadas quedan sin orden ni líneas y siguen la ruta de siempre.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. La factura sabe de qué orden viene ───────────────────────────────────
ALTER TABLE public.facturas_proveedor
  ADD COLUMN IF NOT EXISTS orden_compra_id     uuid REFERENCES public.ordenes_compra(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_forzado_por   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_justificacion text;

CREATE INDEX IF NOT EXISTS idx_facturas_prov_orden
  ON public.facturas_proveedor(orden_compra_id) WHERE orden_compra_id IS NOT NULL;

COMMENT ON COLUMN public.facturas_proveedor.orden_compra_id IS
  'Orden de compra que origina la factura. Con orden + recepción previa, el devengo va contra 2105 en vez de contra el gasto.';
COMMENT ON COLUMN public.facturas_proveedor.match_justificacion IS
  'Por qué se aprobó una factura fuera de tolerancia. Obligatoria junto con match_forzado_por; sin ella el trigger no deja aprobar.';

CREATE TABLE IF NOT EXISTS public.factura_proveedor_lineas (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  factura_id            uuid          NOT NULL REFERENCES public.facturas_proveedor(id) ON DELETE CASCADE,
  orden_compra_linea_id uuid          REFERENCES public.orden_compra_lineas(id) ON DELETE SET NULL,
  linea                 int           NOT NULL DEFAULT 1,
  descripcion           text          NOT NULL,
  cuenta_id             uuid          REFERENCES public.conta_cuentas(id) ON DELETE RESTRICT,
  cantidad              numeric(14,4) NOT NULL CHECK (cantidad > 0),
  precio_unitario       numeric(14,4) NOT NULL CHECK (precio_unitario >= 0),
  iva_monto             numeric(14,2) NOT NULL DEFAULT 0 CHECK (iva_monto >= 0),
  total                 numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT factura_proveedor_lineas_unica UNIQUE (factura_id, linea)
);

CREATE INDEX IF NOT EXISTS idx_factura_lineas_factura ON public.factura_proveedor_lineas(factura_id);
CREATE INDEX IF NOT EXISTS idx_factura_lineas_oc      ON public.factura_proveedor_lineas(orden_compra_linea_id)
  WHERE orden_compra_linea_id IS NOT NULL;

-- ── 2. RLS ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  ins_expr text := $e$is_super_admin() OR (company_id = get_my_company_id() AND (
      current_user_role() = ANY(ARRAY['company_owner','admin','operator'])
      OR public.conta_puede_escribir('create')))$e$;
  upd_expr text := $e$is_super_admin() OR (company_id = get_my_company_id() AND (
      current_user_role() = ANY(ARRAY['company_owner','admin'])
      OR public.conta_puede_escribir('edit')))$e$;
  del_expr text := $e$is_super_admin() OR (company_id = get_my_company_id() AND (
      current_user_role() = ANY(ARRAY['company_owner','admin'])
      OR public.conta_puede_escribir('delete')))$e$;
BEGIN
  EXECUTE 'ALTER TABLE public.factura_proveedor_lineas ENABLE ROW LEVEL SECURITY';

  EXECUTE 'DROP POLICY IF EXISTS factura_proveedor_lineas_select ON public.factura_proveedor_lineas';
  EXECUTE $p$CREATE POLICY factura_proveedor_lineas_select ON public.factura_proveedor_lineas
              FOR SELECT TO authenticated
              USING (company_id = get_my_company_id() OR is_super_admin())$p$;

  EXECUTE 'DROP POLICY IF EXISTS factura_proveedor_lineas_insert ON public.factura_proveedor_lineas';
  EXECUTE format('CREATE POLICY factura_proveedor_lineas_insert ON public.factura_proveedor_lineas
                  FOR INSERT TO authenticated WITH CHECK (%s)', ins_expr);

  EXECUTE 'DROP POLICY IF EXISTS factura_proveedor_lineas_update ON public.factura_proveedor_lineas';
  EXECUTE format('CREATE POLICY factura_proveedor_lineas_update ON public.factura_proveedor_lineas
                  FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', upd_expr, upd_expr);

  EXECUTE 'DROP POLICY IF EXISTS factura_proveedor_lineas_delete ON public.factura_proveedor_lineas';
  EXECUTE format('CREATE POLICY factura_proveedor_lineas_delete ON public.factura_proveedor_lineas
                  FOR DELETE TO authenticated USING (%s)', del_expr);

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'mfa_requirement_met') THEN
    EXECUTE 'DROP POLICY IF EXISTS mfa_gate_aal2 ON public.factura_proveedor_lineas';
    EXECUTE 'CREATE POLICY mfa_gate_aal2 ON public.factura_proveedor_lineas AS RESTRICTIVE FOR ALL TO authenticated '
         || 'USING (public.mfa_requirement_met()) WITH CHECK (public.mfa_requirement_met())';
  END IF;
END $$;

-- ── 3. Totales de la factura desde sus líneas ───────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_factura_linea()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_fac    uuid := COALESCE(NEW.factura_id, OLD.factura_id);
  v_estado text;
  v_n      int;
  v_neto   numeric(14,2);
  v_iva    numeric(14,2);
  v_prev   text := COALESCE(current_setting('conta.allow_system_write', true), 'off');
BEGIN
  SELECT estado INTO v_estado FROM public.facturas_proveedor WHERE id = v_fac;
  IF v_estado IS NOT NULL AND v_estado <> 'registrada' AND v_prev <> 'on' THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_INMUTABLE: la factura está % y sus líneas ya no se editan.', v_estado
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP <> 'DELETE' THEN
    NEW.total      := round(NEW.cantidad * NEW.precio_unitario, 2) + COALESCE(NEW.iva_monto, 0);
    NEW.updated_at := now();
  END IF;

  -- La cabecera se recalcula al final para que monto_total y iva_monto no
  -- puedan discrepar de los renglones que el cuadre va a comparar.
  SELECT COUNT(*), COALESCE(SUM(round(cantidad * precio_unitario, 2)), 0), COALESCE(SUM(iva_monto), 0)
    INTO v_n, v_neto, v_iva
  FROM public.factura_proveedor_lineas
  WHERE factura_id = v_fac AND (TG_OP <> 'DELETE' OR id <> OLD.id);

  IF TG_OP <> 'DELETE' THEN
    -- La fila de NEW aún no está en la tabla en un BEFORE INSERT.
    IF TG_OP = 'INSERT' THEN
      v_n    := v_n + 1;
      v_neto := v_neto + round(NEW.cantidad * NEW.precio_unitario, 2);
      v_iva  := v_iva + COALESCE(NEW.iva_monto, 0);
    ELSE
      v_neto := v_neto - round(OLD.cantidad * OLD.precio_unitario, 2) + round(NEW.cantidad * NEW.precio_unitario, 2);
      v_iva  := v_iva - COALESCE(OLD.iva_monto, 0) + COALESCE(NEW.iva_monto, 0);
    END IF;
  END IF;

  IF v_n > 0 THEN
    PERFORM set_config('conta.allow_system_write', 'on', true);
    UPDATE public.facturas_proveedor
       SET monto_total = v_neto + v_iva, iva_monto = v_iva, updated_at = now()
     WHERE id = v_fac;
    PERFORM set_config('conta.allow_system_write', v_prev, true);
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_tg_factura_linea() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_factura_linea ON public.factura_proveedor_lineas;
CREATE TRIGGER trg_compras_factura_linea
  BEFORE INSERT OR UPDATE OR DELETE ON public.factura_proveedor_lineas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_factura_linea();

-- ── 4. El cuadre de 3 vías ──────────────────────────────────────────────────
-- Devuelve UNA FILA POR RENGLÓN de la factura con las tres cantidades y los dos
-- precios. La UI lo pinta antes de aprobar; el trigger lo usa para decidir.
CREATE OR REPLACE FUNCTION public.compras_validar_match(p_factura_id uuid)
RETURNS TABLE (
  linea               int,
  descripcion         text,
  cantidad_ordenada   numeric,
  cantidad_recibida   numeric,
  cantidad_facturada  numeric,
  cantidad_factura    numeric,
  precio_orden        numeric,
  precio_factura      numeric,
  diferencia_precio   numeric,
  diferencia_pct      numeric,
  dentro_tolerancia   boolean,
  motivo              text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
  v_tol_p   numeric;
  v_tol_c   numeric;
  v_estado  text;
  -- ¿Esta factura YA sumó lo suyo a orden_compra_lineas.cantidad_facturada?
  -- Lo hace compras_tg_factura_acumular al aprobarla. Sin descontarlo, releer
  -- el cuadre de una factura aprobada se compara contra sí misma y la reporta
  -- fuera de tolerancia para siempre — con la factura correctamente aprobada
  -- y el pedido intacto.
  v_ya_sumada boolean;
BEGIN
  SELECT f.company_id, f.estado INTO v_company, v_estado
  FROM public.facturas_proveedor f WHERE f.id = p_factura_id;
  IF v_company IS NULL THEN RETURN; END IF;
  v_ya_sumada := v_estado IN ('aprobada','pagada_parcial','pagada');

  -- Guard de tenant: se FILTRA (sin filas) en vez de reventar, igual que las
  -- demás RPCs de consulta del módulo.
  IF NOT (public.is_super_admin() OR v_company = public.get_my_company_id()) THEN
    RETURN;
  END IF;

  v_tol_p := public.compras_tolerancia(v_company, 'precio');
  v_tol_c := public.compras_tolerancia(v_company, 'cantidad');

  RETURN QUERY
  WITH base AS (
    SELECT
      fl.linea       AS f_linea,
      fl.descripcion AS f_desc,
      fl.cantidad    AS f_cant,
      fl.precio_unitario AS f_precio,
      ocl.id         AS ocl_id,
      ocl.cantidad   AS o_cant,
      ocl.cantidad_recibida AS o_recib,
      ocl.precio_unitario   AS o_precio,
      -- Lo facturado por las DEMÁS facturas.
      GREATEST(0, ocl.cantidad_facturada
                  - CASE WHEN v_ya_sumada THEN fl.cantidad ELSE 0 END) AS o_fact_otras
    FROM public.factura_proveedor_lineas fl
    LEFT JOIN public.orden_compra_lineas ocl ON ocl.id = fl.orden_compra_linea_id
    WHERE fl.factura_id = p_factura_id
  )
  SELECT
    b.f_linea, b.f_desc, b.o_cant, b.o_recib, b.o_fact_otras, b.f_cant,
    b.o_precio, b.f_precio,
    round(b.f_precio - b.o_precio, 4),
    CASE WHEN b.o_precio > 0
         THEN round((b.f_precio - b.o_precio) / b.o_precio * 100, 2) ELSE NULL END,
    -- Tres condiciones, todas necesarias: precio dentro de tolerancia, no
    -- facturar más de lo recibido, y no facturar más de lo ordenado.
    (   b.ocl_id IS NOT NULL
     AND b.o_precio > 0
     AND abs(b.f_precio - b.o_precio) <= b.o_precio * v_tol_p / 100
     AND b.f_cant <= b.o_recib - b.o_fact_otras + 1e-6
     AND b.o_fact_otras + b.f_cant <= b.o_cant * (1 + v_tol_c / 100) + 1e-6),
    CASE
      WHEN b.ocl_id IS NULL THEN 'Renglón sin línea de orden: no hay contra qué cuadrar.'
      WHEN b.o_precio > 0
       AND abs(b.f_precio - b.o_precio) > b.o_precio * v_tol_p / 100
        THEN 'Precio fuera de tolerancia.'
      WHEN b.f_cant > b.o_recib - b.o_fact_otras + 1e-6
        THEN 'Se factura más de lo recibido y aún no facturado.'
      WHEN b.o_fact_otras + b.f_cant > b.o_cant * (1 + v_tol_c / 100) + 1e-6
        THEN 'Se factura más de lo ordenado.'
      ELSE 'Cuadra.'
    END
  FROM base b
  ORDER BY b.f_linea;
END;
$$;

COMMENT ON FUNCTION public.compras_validar_match(uuid) IS
  'Cuadre de 3 vías por renglón: ordenado vs recibido vs facturado, y precio de orden vs precio de factura contra la tolerancia de compras_config.';

GRANT EXECUTE ON FUNCTION public.compras_validar_match(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.compras_validar_match(uuid) FROM PUBLIC, anon;

-- ── 5. Aprobar exige cuadrar (o justificar por escrito) ─────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_factura_match()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prov  record;
  v_malas int;
  v_det   text;
BEGIN
  IF NOT (NEW.estado = 'aprobada' AND OLD.estado = 'registrada') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  -- Un proveedor suspendido o vetado no recibe aprobaciones nuevas, tenga o no
  -- orden de compra: es la misma decisión de negocio que apagó su autorización.
  -- Un proveedor en 'borrador'/'en_revision' SÍ pasa: son los gastos directos
  -- de siempre, que esta fase no viene a bloquear.
  SELECT nombre, estado INTO v_prov FROM public.proveedores WHERE id = NEW.proveedor_id;
  IF v_prov.estado IN ('suspendido','vetado') THEN
    RAISE EXCEPTION 'COMPRAS_PROVEEDOR_NO_AUTORIZADO: "%" está %; no se aprueban facturas suyas.',
      v_prov.nombre, v_prov.estado USING ERRCODE = 'check_violation';
  END IF;

  -- Sin orden de compra no hay cuadre que exigir (gasto directo, caja chica).
  IF NEW.orden_compra_id IS NULL THEN RETURN NEW; END IF;

  SELECT COUNT(*), string_agg(format('· %s: %s', descripcion, motivo), E'\n')
    INTO v_malas, v_det
  FROM public.compras_validar_match(NEW.id)
  WHERE NOT dentro_tolerancia;

  IF v_malas > 0 THEN
    IF NEW.match_forzado_por IS NOT NULL
       AND COALESCE(btrim(NEW.match_justificacion), '') <> '' THEN
      RETURN NEW;  -- se aprueba a conciencia y queda escrito quién y por qué
    END IF;
    RAISE EXCEPTION E'COMPRAS_MATCH_FUERA_DE_TOLERANCIA: % renglón(es) no cuadran con la orden:\n%\nCorrige la factura o autorízala dejando la justificación.',
      v_malas, v_det USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_tg_factura_match() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_factura_match ON public.facturas_proveedor;
CREATE TRIGGER trg_compras_factura_match
  BEFORE UPDATE OF estado ON public.facturas_proveedor
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_factura_match();

-- ── 6. Acumular lo facturado en la línea de la orden ────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_factura_acumular()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_l     record;
  v_signo int;
  v_pend  int;
  v_prev  text := COALESCE(current_setting('conta.allow_system_write', true), 'off');
BEGIN
  IF NEW.estado = 'aprobada' AND OLD.estado = 'registrada' THEN
    v_signo := 1;
  ELSIF NEW.estado = 'anulada' AND OLD.estado IN ('aprobada','pagada_parcial','pagada') THEN
    v_signo := -1;
  ELSE
    RETURN NEW;
  END IF;

  PERFORM set_config('conta.allow_system_write', 'on', true);

  FOR v_l IN
    SELECT orden_compra_linea_id AS ocl, SUM(cantidad) AS cant
    FROM public.factura_proveedor_lineas
    WHERE factura_id = NEW.id AND orden_compra_linea_id IS NOT NULL
    GROUP BY orden_compra_linea_id
  LOOP
    UPDATE public.orden_compra_lineas
       SET cantidad_facturada = GREATEST(0, cantidad_facturada + v_signo * v_l.cant),
           updated_at = now()
     WHERE id = v_l.ocl;
  END LOOP;

  -- Recibida y facturada del todo → la orden se cierra sola. Es el fin natural
  -- del riel: nadie tiene que acordarse de cerrarla a mano.
  IF NEW.orden_compra_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_pend FROM public.orden_compra_lineas
     WHERE orden_compra_id = NEW.orden_compra_id
       AND (cantidad_recibida < cantidad OR cantidad_facturada < cantidad);
    UPDATE public.ordenes_compra
       SET estado = CASE WHEN v_pend = 0 AND v_signo = 1 THEN 'cerrada'
                         WHEN estado = 'cerrada' AND v_signo = -1 THEN 'recibida'
                         ELSE estado END,
           updated_at = now()
     WHERE id = NEW.orden_compra_id;
  END IF;

  PERFORM set_config('conta.allow_system_write', v_prev, true);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('conta.allow_system_write', v_prev, true);
  RAISE WARNING 'compras_tg_factura_acumular(%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_tg_factura_acumular() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_factura_acumular ON public.facturas_proveedor;
CREATE TRIGGER trg_compras_factura_acumular
  AFTER UPDATE OF estado ON public.facturas_proveedor
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_factura_acumular();

-- ── 7. El devengo aprende la ruta GR/IR ─────────────────────────────────────
-- Se REESCRIBE conta_tg_facturas_prov() conservando íntegra la ruta anterior
-- (que es la que siguen todas las facturas sin orden de compra) y añadiéndole
-- una rama. Ver 20260611070000 para la versión que esto extiende.
--
-- Con orden + recepción, el gasto/activo/inventario YA se registró al recibir
-- contra 2105. Volver a debitar el gasto lo contaría dos veces. Lo que hace la
-- factura es cambiar de acreedor: sale la 2105 (deuda difusa "algo me van a
-- facturar") y entra la 2104 (deuda formal con ESTE proveedor), más el IVA
-- crédito, que solo nace con el documento fiscal.
--
-- La diferencia de precio dentro de tolerancia (facturado − ordenado) va a la
-- cuenta de destino de la línea. Sin eso la 2105 quedaría con un residuo
-- permanente por cada centavo de variación, y una cuenta puente que nunca
-- cierra en cero deja de servir para lo único que sirve: ver qué me falta que
-- me facturen.
CREATE OR REPLACE FUNCTION public.conta_tg_facturas_prov()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_moneda    text;
  v_gasto     text;
  v_proveedor text;
  v_iva       numeric(14,2);
  v_lineas    jsonb;
  v_grni      numeric(14,2);
  v_var       jsonb;
  v_neto      numeric(14,2);
  v_resto     numeric(14,2);
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.conta_reversar_automatico(OLD.company_id, 'facturas_proveedor', OLD.id,
      'factura_prov_aprobada', 'Factura de proveedor eliminada');
    RETURN OLD;
  END IF;

  -- Reverso del devengo al anular una factura ya aprobada.
  IF NEW.estado = 'anulada' AND OLD.estado IN ('aprobada','pagada_parcial','pagada') THEN
    PERFORM public.conta_reversar_automatico(NEW.company_id, 'facturas_proveedor', NEW.id,
      'factura_prov_aprobada', 'Factura de proveedor anulada');
    RETURN NEW;
  END IF;

  IF NOT (NEW.estado = 'aprobada' AND OLD.estado = 'registrada') THEN
    RETURN NEW;
  END IF;

  v_gasto := CASE WHEN NEW.categoria IN ('mantenimiento','servicios','administrativo',
                                         'seguridad','limpieza','obras')
                  THEN 'gasto_' || NEW.categoria ELSE 'gasto_otros' END;
  SELECT nombre INTO v_proveedor FROM public.proveedores WHERE id = NEW.proveedor_id;
  v_moneda := COALESCE(NEW.moneda,
    (SELECT COALESCE(moneda_condominios, moneda) FROM public.projects WHERE id = NEW.project_id));
  v_iva  := COALESCE(NEW.iva_monto, 0);
  v_neto := NEW.monto_total - v_iva;

  -- ── Ruta GR/IR: hay orden, hay líneas ligadas y esas líneas ya se recibieron
  IF NEW.orden_compra_id IS NOT NULL
     AND public.conta_cuenta_para(NEW.company_id, NEW.project_id, 'compras_por_facturar') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.factura_proveedor_lineas fl
       JOIN public.orden_compra_lineas ocl ON ocl.id = fl.orden_compra_linea_id
       WHERE fl.factura_id = NEW.id AND ocl.cantidad_recibida > 0
     ) THEN

    -- Lo que la recepción acreditó en 2105 por estos renglones, al precio de
    -- la ORDEN (que es el precio con el que se acreditó).
    SELECT COALESCE(SUM(round(fl.cantidad * ocl.precio_unitario, 2)), 0)
      INTO v_grni
    FROM public.factura_proveedor_lineas fl
    JOIN public.orden_compra_lineas ocl ON ocl.id = fl.orden_compra_linea_id
    WHERE fl.factura_id = NEW.id AND ocl.cantidad_recibida > 0;

    -- Variación de precio, SIEMPRE contra una cuenta de GASTO del periodo —
    -- nunca contra inventario ni activo fijo, aunque ese sea el destino de la
    -- línea. Razón: el kardex (`suministros_condominio.costo_unitario`) y el
    -- registro de activos (`activos_fijos.costo`) se valúan al precio de la
    -- ORDEN, que es cuando entró el bien. Capitalizar aquí la diferencia
    -- dejaría el mayor contable por encima del auxiliar de forma permanente y
    -- sin nada que lo explique. Mandarla a gasto mantiene mayor y auxiliar
    -- cuadrados, y deja la variación a la vista en el estado de resultados,
    -- que es donde a alguien le sirve verla.
    SELECT jsonb_agg(CASE WHEN monto >= 0
                          THEN jsonb_build_object('evento', evento, 'debe', monto,
                                                  'descripcion', 'Variación de precio de compra')
                          ELSE jsonb_build_object('evento', evento, 'haber', -monto,
                                                  'descripcion', 'Variación de precio de compra') END)
      INTO v_var
    FROM (
      SELECT CASE WHEN COALESCE(ocl.categoria, 'otros') IN
                       ('mantenimiento','servicios','administrativo','seguridad','limpieza','obras')
                  THEN 'gasto_' || ocl.categoria ELSE 'gasto_otros' END AS evento,
             SUM(round(fl.cantidad * (fl.precio_unitario - ocl.precio_unitario), 2)) AS monto
      FROM public.factura_proveedor_lineas fl
      JOIN public.orden_compra_lineas ocl ON ocl.id = fl.orden_compra_linea_id
      WHERE fl.factura_id = NEW.id AND ocl.cantidad_recibida > 0
      GROUP BY 1
      HAVING SUM(round(fl.cantidad * (fl.precio_unitario - ocl.precio_unitario), 2)) <> 0
    ) v;

    v_lineas := jsonb_build_array(
      jsonb_build_object('evento', 'compras_por_facturar', 'debe', v_grni,
                         'descripcion', 'Liquidación de bienes/servicios recibidos'))
      || COALESCE(v_var, '[]'::jsonb);

    -- Renglones facturados que NO venían de una línea recibida (fletes,
    -- cargos varios): van al gasto como siempre, para que el asiento cuadre.
    v_resto := round(v_neto - v_grni - COALESCE((
      SELECT SUM(round(fl.cantidad * (fl.precio_unitario - ocl.precio_unitario), 2))
      FROM public.factura_proveedor_lineas fl
      JOIN public.orden_compra_lineas ocl ON ocl.id = fl.orden_compra_linea_id
      WHERE fl.factura_id = NEW.id AND ocl.cantidad_recibida > 0), 0), 2);
    IF v_resto <> 0 THEN
      v_lineas := v_lineas || jsonb_build_array(
        jsonb_build_object('evento', v_gasto,
                           CASE WHEN v_resto > 0 THEN 'debe' ELSE 'haber' END, abs(v_resto),
                           'descripcion', 'Cargos adicionales de la factura'));
    END IF;

    IF v_iva > 0 AND public.conta_cuenta_para(NEW.company_id, NEW.project_id, 'iva_credito') IS NOT NULL THEN
      v_lineas := v_lineas || jsonb_build_array(
        jsonb_build_object('evento', 'iva_credito', 'debe', v_iva, 'descripcion', 'IVA crédito fiscal'));
    ELSIF v_iva > 0 THEN
      -- Sin mapeo de IVA crédito el impuesto se queda en el gasto, igual que
      -- en la ruta legacy.
      v_lineas := v_lineas || jsonb_build_array(
        jsonb_build_object('evento', v_gasto, 'debe', v_iva));
    END IF;

    v_lineas := v_lineas || jsonb_build_array(
      jsonb_build_object('evento', 'cxp_proveedores', 'haber', NEW.monto_total));

  -- ── Ruta de siempre: factura sin orden de compra ──────────────────────────
  ELSIF v_iva > 0 AND v_iva < NEW.monto_total
        AND public.conta_cuenta_para(NEW.company_id, NEW.project_id, 'iva_credito') IS NOT NULL THEN
    v_lineas := jsonb_build_array(
      jsonb_build_object('evento', v_gasto, 'debe', v_neto),
      jsonb_build_object('evento', 'iva_credito', 'debe', v_iva, 'descripcion', 'IVA crédito fiscal'),
      jsonb_build_object('evento', 'cxp_proveedores', 'haber', NEW.monto_total)
    );
  ELSE
    v_lineas := jsonb_build_array(
      jsonb_build_object('evento', v_gasto, 'debe', NEW.monto_total),
      jsonb_build_object('evento', 'cxp_proveedores', 'haber', NEW.monto_total)
    );
  END IF;

  PERFORM public.conta_generar_asiento(
    NEW.company_id, NEW.project_id, 'facturas_proveedor', NEW.id, 'factura_prov_aprobada',
    NEW.fecha_emision,
    'Factura proveedor ' || COALESCE(v_proveedor, '') ||
      COALESCE(' #' || NULLIF(NEW.numero_factura, ''), '') || ' — ' || NEW.concepto,
    'diario', v_moneda,
    v_lineas
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.conta_tg_facturas_prov() IS
  'Devengo de la factura de proveedor. Con orden de compra y recepción previa liquida 2105 (GR/IR) contra 2104 + IVA, mandando la variación de precio a la cuenta de destino; sin orden, ruta clásica gasto contra 2104.';
