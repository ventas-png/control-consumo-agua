-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS — FASE 6 · parte C: RECEPCIÓN, GR/IR, INVENTARIO Y ACTIVOS FIJOS
-- Ver ROADMAP_ERP_FINANZAS.md (Fase 6). Depende de las partes A y B.
--
-- POR QUÉ EXISTE
-- Entre "pedí" y "me facturaron" faltaba el hecho que de verdad ocurre: LLEGÓ.
-- Hoy `ordenes_compra.estado='recibida'` es una casilla que alguien marca a
-- mano; no dice qué llegó, ni cuánto, ni dónde quedó, y la contabilidad no se
-- entera hasta que aparece la factura. Eso tiene dos consecuencias feas: el
-- inventario y los activos del condominio no existen en el balance mientras la
-- factura no llegue (pueden ser semanas), y no hay contra qué cuadrar la
-- factura cuando llega.
--
-- QUÉ HACE
--   1. `recepciones` + `recepcion_lineas`: el acta de lo que entró, ligada a
--      las líneas de la orden.
--   2. ASIENTO GR/IR al registrar: Dr Inventario/Activo/Gasto contra
--      Cr 2105 «Bienes y servicios por facturar». La factura (parte D) traslada
--      2105 → 2104 Proveedores + IVA crédito. Así el bien entra al balance el
--      día que entra a la bodega, y la 2105 es exactamente "lo recibido que
--      todavía no me facturan".
--   3. INVENTARIO: la línea con destino `inventario` mueve
--      `suministros_condominio` mediante `movimientos_suministro`. De paso se
--      corrige un bug real: hasta hoy el stock lo recalculaba el NAVEGADOR con
--      dos escrituras separadas (insertar movimiento; luego UPDATE del stock).
--      Si la segunda fallaba —o dos personas movían el mismo insumo a la vez—
--      el stock quedaba mintiendo, sin que nada lo detectara. Ahora lo calcula
--      un trigger, en la misma transacción.
--   4. ACTIVOS FIJOS: `activos_fijos`, que no existía en ninguna forma, y el
--      alta automática desde la recepción.
--   5. Las CUENTAS que faltaban en el catálogo sembrado (14 Activo fijo y sus
--      hijas, 1106 Inventario, 2105 y 5107 Depreciación), retro-sembradas en
--      todas las contabilidades existentes.
--
-- COMPATIBILIDAD
-- Aditiva y degradable: si un ledger no tiene el mapeo `compras_por_facturar`,
-- `conta_generar_asiento` ya emite RAISE WARNING y NO asienta — la recepción
-- se registra igual y la contabilidad se comporta como antes de esta fase.
--
-- ⚠ ACOPLAMIENTO CON EL FRONTEND: al pasar el stock a un trigger, el cálculo
-- del cliente en SuministrosTab.tsx debe desaparecer o contaría doble. Para que
-- eso no dependa de que el navegador esté actualizado, un guard ignora los
-- cambios directos a `stock_actual` que no vengan de un movimiento. Los ajustes
-- se hacen con un movimiento `ajuste`, que es como ya funcionaba la pantalla.
--
-- CÓMO REVERTIR
--   DROP TRIGGER trg_suministros_stock ON public.movimientos_suministro;
--   DROP TRIGGER trg_suministros_guard_stock ON public.suministros_condominio;
--   DROP TRIGGER trg_compras_recepcion_registrar ON public.recepciones;
--   DROP TABLE public.recepcion_lineas, public.recepciones, public.activos_fijos;
--   DROP TABLE public.compras_config;
--   ALTER TABLE public.movimientos_suministro
--     DROP COLUMN costo_unitario, DROP COLUMN origen_tabla, DROP COLUMN origen_id;
--   (las cuentas sembradas pueden quedarse: son es_sistema y no estorban)
--
-- IMPACTO EN DATOS PRODUCTIVOS: siembra cuentas y mapeos nuevos en todas las
-- contabilidades existentes (INSERT … ON CONFLICT DO NOTHING). No modifica
-- asientos, saldos ni existencias ya registradas.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 0. El correlativo de compras aprende un documento más ───────────────────
-- Los activos fijos que nacen de una recepción necesitan código propio, y debe
-- ser correlativo POR CONTABILIDAD como el resto de los documentos.
DO $$
DECLARE v_con text;
BEGIN
  SELECT con.conname INTO v_con
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'compras_correlativos'
    AND con.contype = 'c' AND pg_get_constraintdef(con.oid) ILIKE '%documento%';
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.compras_correlativos DROP CONSTRAINT %I', v_con);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE public.compras_correlativos
    ADD CONSTRAINT compras_correlativos_documento_check
    CHECK (documento IN ('orden_compra','recepcion','contrasena_pago','activo_fijo'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 1. Configuración de compras por empresa (tolerancias del cuadre) ────────
-- Vive aquí porque la recepción ya necesita la tolerancia de CANTIDAD; la
-- parte D usa la de PRECIO sobre la misma fila.
CREATE TABLE IF NOT EXISTS public.compras_config (
  company_id             uuid          PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  tolerancia_cantidad_pct numeric(5,2) NOT NULL DEFAULT 0   CHECK (tolerancia_cantidad_pct >= 0 AND tolerancia_cantidad_pct <= 100),
  tolerancia_precio_pct   numeric(5,2) NOT NULL DEFAULT 5   CHECK (tolerancia_precio_pct   >= 0 AND tolerancia_precio_pct   <= 100),
  monto_minimo_oc         numeric(14,2) NOT NULL DEFAULT 0  CHECK (monto_minimo_oc >= 0),
  requiere_recepcion      boolean       NOT NULL DEFAULT true,
  created_at             timestamptz    NOT NULL DEFAULT now(),
  updated_at             timestamptz    NOT NULL DEFAULT now()
);

ALTER TABLE public.compras_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "compras_config_select" ON public.compras_config;
CREATE POLICY "compras_config_select" ON public.compras_config
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

DROP POLICY IF EXISTS "compras_config_insert" ON public.compras_config;
CREATE POLICY "compras_config_insert" ON public.compras_config
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR (company_id = get_my_company_id() AND public.conta_puede_escribir('edit')));

DROP POLICY IF EXISTS "compras_config_update" ON public.compras_config;
CREATE POLICY "compras_config_update" ON public.compras_config
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR (company_id = get_my_company_id() AND public.conta_puede_escribir('edit')))
  WITH CHECK (is_super_admin() OR (company_id = get_my_company_id() AND public.conta_puede_escribir('edit')));

DROP POLICY IF EXISTS "compras_config_delete" ON public.compras_config;
CREATE POLICY "compras_config_delete" ON public.compras_config
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (company_id = get_my_company_id() AND public.conta_puede_escribir('delete')));

CREATE OR REPLACE FUNCTION public.compras_tolerancia(p_company_id uuid, p_cual text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    (SELECT CASE p_cual WHEN 'cantidad' THEN tolerancia_cantidad_pct
                        WHEN 'precio'   THEN tolerancia_precio_pct END
     FROM public.compras_config WHERE company_id = p_company_id),
    CASE p_cual WHEN 'cantidad' THEN 0 WHEN 'precio' THEN 5 ELSE 0 END)
$$;

-- SIN grant a `authenticated`: es un helper INTERNO de los triggers, que ya
-- corren con el company_id del documento que están procesando. Dárselo al
-- cliente sería un SECURITY DEFINER que acepta un `p_company_id` cualquiera y
-- responde sin mirar quién pregunta — justo lo que caza la regla (b) de
-- scripts/migrations-guard.mjs. La UI lee `compras_config` por la tabla, donde
-- la RLS hace su trabajo (ver useComprasConfigQuery).
REVOKE EXECUTE ON FUNCTION public.compras_tolerancia(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 2. Cuentas que el catálogo sembrado no traía ────────────────────────────
-- Se seedean aparte, en su propia función, en vez de reescribir
-- conta_seed_catalogo: un CREATE OR REPLACE de aquella arrastra el riesgo —
-- documentado en scripts/migrations-guard.mjs— de perder en silencio arreglos
-- posteriores al copiar un cuerpo viejo.
--
-- 1409 va CONTRA-NATURA a propósito: es tipo 'activo' con naturaleza
-- 'acreedora' (depreciación acumulada). La columna `naturaleza` existe
-- justamente para esto.
CREATE OR REPLACE FUNCTION public.compras_seed_cuentas(p_company_id uuid, p_project_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m        record;
  v_cuenta uuid;
BEGIN
  -- Padres: conta_seed_cuenta es idempotente y resuelve el padre por código,
  -- así que sembrarlos aquí hace a esta función independiente del orden en que
  -- corran los triggers de seed.
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '1',  'Activo',            'activo', 'deudora',   NULL, 1, false);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '11', 'Activo circulante', 'activo', 'deudora',   '1',  2, false);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '2',  'Pasivo',            'pasivo', 'acreedora', NULL, 1, false);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '21', 'Pasivo circulante', 'pasivo', 'acreedora', '2',  2, false);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '5',  'Gastos',            'gasto',  'deudora',   NULL, 1, false);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '51', 'Gastos operativos', 'gasto',  'deudora',   '5',  2, false);

  -- Inventario de insumos (lo que la recepción manda a bodega).
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '1106', 'Inventario de insumos', 'activo', 'deudora', '11', 3, true);

  -- Activo fijo y su depreciación acumulada.
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '14',   'Activo fijo',               'activo', 'deudora',   '1',  2, false);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '1401', 'Mobiliario y equipo',       'activo', 'deudora',   '14', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '1402', 'Equipo de cómputo',         'activo', 'deudora',   '14', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '1403', 'Maquinaria y herramienta',  'activo', 'deudora',   '14', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '1404', 'Vehículos',                 'activo', 'deudora',   '14', 3, true);
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '1409', 'Depreciación acumulada',    'activo', 'acreedora', '14', 3, true);

  -- El puente GR/IR: recibido y todavía sin factura.
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '2105', 'Bienes y servicios por facturar', 'pasivo', 'acreedora', '21', 3, true);

  -- Gasto por depreciación: se siembra ya para que la corrida mensual (fase
  -- siguiente) sea un RPC y no un rediseño del catálogo.
  PERFORM public.conta_seed_cuenta(p_company_id, p_project_id, '5107', 'Depreciación', 'gasto', 'deudora', '51', 3, true);

  FOR m IN
    SELECT * FROM (VALUES
      ('inventario',             '1106'),
      ('compras_por_facturar',   '2105'),
      ('activo_fijo',            '1401'),
      ('depreciacion_acumulada', '1409'),
      ('gasto_depreciacion',     '5107')
    ) AS t(evento, codigo)
  LOOP
    SELECT id INTO v_cuenta FROM public.conta_cuentas
    WHERE company_id = p_company_id AND project_id IS NOT DISTINCT FROM p_project_id
      AND codigo = m.codigo;
    IF v_cuenta IS NOT NULL THEN
      INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
      VALUES (p_company_id, p_project_id, m.evento, v_cuenta)
      ON CONFLICT (company_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), evento)
      DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_seed_cuentas(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Retro-siembra en TODA contabilidad que ya opere (una fila por ledger vivo).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT company_id, project_id FROM public.conta_cuentas LOOP
    BEGIN
      PERFORM public.compras_seed_cuentas(r.company_id, r.project_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'compras_seed_cuentas(%/%): %', r.company_id, r.project_id, SQLERRM;
    END;
  END LOOP;
END $$;

-- Ledgers nuevos. Triggers PROPIOS en vez de reescribir conta_seed_on_*: así
-- esta fase no puede pisar aquellas funciones, y compras_seed_cuentas siembra
-- sus propios padres, con lo que el orden entre triggers da igual.
CREATE OR REPLACE FUNCTION public.compras_seed_on_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    PERFORM public.compras_seed_cuentas(NEW.id, NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'compras_seed_on_company(%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.compras_seed_on_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    PERFORM public.compras_seed_cuentas(NEW.company_id, NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'compras_seed_on_project(%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_seed_on_company() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compras_seed_on_project() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_seed_on_company ON public.companies;
CREATE TRIGGER trg_compras_seed_on_company
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.compras_seed_on_company();

DROP TRIGGER IF EXISTS trg_compras_seed_on_project ON public.projects;
CREATE TRIGGER trg_compras_seed_on_project
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.compras_seed_on_project();

-- ── 3. Registro de activos fijos ────────────────────────────────────────────
-- No existía nada: ni tabla, ni cuentas. Los campos de depreciación se guardan
-- desde ya (vida útil, valor residual, las tres cuentas) para que la corrida
-- mensual sea después un RPC y no una migración de datos.
CREATE TABLE IF NOT EXISTS public.activos_fijos (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id            uuid          REFERENCES public.projects(id) ON DELETE SET NULL,
  codigo                text          NOT NULL,
  nombre                text          NOT NULL,
  categoria             text          NOT NULL DEFAULT 'mobiliario'
                          CHECK (categoria IN ('mobiliario','computo','maquinaria','vehiculo','otro')),
  numero_serie          text,
  ubicacion             text,
  fecha_alta            date          NOT NULL DEFAULT CURRENT_DATE,
  costo                 numeric(14,2) NOT NULL DEFAULT 0 CHECK (costo >= 0),
  valor_residual        numeric(14,2) NOT NULL DEFAULT 0 CHECK (valor_residual >= 0),
  vida_util_meses       int           NOT NULL DEFAULT 60 CHECK (vida_util_meses > 0),
  cuenta_activo_id      uuid          REFERENCES public.conta_cuentas(id) ON DELETE SET NULL,
  cuenta_dep_acum_id    uuid          REFERENCES public.conta_cuentas(id) ON DELETE SET NULL,
  cuenta_gasto_dep_id   uuid          REFERENCES public.conta_cuentas(id) ON DELETE SET NULL,
  estado                text          NOT NULL DEFAULT 'activo'
                          CHECK (estado IN ('activo','en_reparacion','dado_de_baja')),
  proveedor_id          uuid          REFERENCES public.proveedores(id) ON DELETE SET NULL,
  recepcion_linea_id    uuid,
  motivo_baja           text,
  notas                 text,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT activos_fijos_residual_check CHECK (valor_residual <= costo)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_activos_fijos_codigo
  ON public.activos_fijos (company_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), codigo);
CREATE INDEX IF NOT EXISTS idx_activos_fijos_ledger ON public.activos_fijos(company_id, project_id, estado);

COMMENT ON TABLE public.activos_fijos IS
  'Registro de activos fijos por contabilidad. Se da de alta solo o desde una recepción con destino activo_fijo. La corrida de depreciación es una fase posterior; los campos ya están.';

-- ── 4. Recepción ────────────────────────────────────────────────────────────
-- borrador → registrada (contabiliza, mueve existencias, da de alta activos)
--          → anulada    (reversa todo, sin borrar nada)
CREATE TABLE IF NOT EXISTS public.recepciones (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id            uuid        REFERENCES public.projects(id) ON DELETE SET NULL,
  orden_compra_id       uuid        NOT NULL REFERENCES public.ordenes_compra(id) ON DELETE RESTRICT,
  numero                text,
  fecha                 date        NOT NULL DEFAULT CURRENT_DATE,
  documento_referencia  text,       -- envío/remisión del proveedor
  recibido_por          uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  estado                text        NOT NULL DEFAULT 'borrador'
                          CHECK (estado IN ('borrador','registrada','anulada')),
  registrada_at         timestamptz,
  anulada_at            timestamptz,
  motivo_anulacion      text,
  notas                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recepciones_orden  ON public.recepciones(orden_compra_id);
CREATE INDEX IF NOT EXISTS idx_recepciones_ledger ON public.recepciones(company_id, project_id, estado);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recepciones_numero
  ON public.recepciones (company_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), numero)
  WHERE numero IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.recepcion_lineas (
  id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  recepcion_id           uuid          NOT NULL REFERENCES public.recepciones(id) ON DELETE CASCADE,
  orden_compra_linea_id  uuid          NOT NULL REFERENCES public.orden_compra_lineas(id) ON DELETE RESTRICT,
  cantidad               numeric(14,4) NOT NULL CHECK (cantidad > 0),
  costo_unitario         numeric(14,4) NOT NULL DEFAULT 0 CHECK (costo_unitario >= 0),
  total                  numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  observacion            text,
  created_at             timestamptz   NOT NULL DEFAULT now(),
  updated_at             timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recepcion_lineas_recepcion ON public.recepcion_lineas(recepcion_id);
CREATE INDEX IF NOT EXISTS idx_recepcion_lineas_oc_linea  ON public.recepcion_lineas(orden_compra_linea_id);

COMMENT ON TABLE public.recepciones IS
  'Acta de lo que entró contra una orden de compra. Al pasar a `registrada` genera el asiento GR/IR (Dr destino / Cr 2105), mueve existencias y da de alta activos.';
COMMENT ON COLUMN public.recepcion_lineas.costo_unitario IS
  'Costo NETO (sin IVA). El IVA crédito fiscal nace con la factura, que es el documento fiscal — no con la entrada a bodega.';

-- ── 5. RLS de recepciones y activos ─────────────────────────────────────────
-- El ENABLE va LITERAL, fuera del bucle: `scripts/migrations-guard.mjs` analiza
-- el repo de forma estática y no ejecuta `format()`, así que una tabla que
-- habilita RLS dentro de un DO le aparece como tabla sin RLS. Las policies sí
-- pueden ir en el bucle (el guard sabe leer los ARRAY[...] de un DO), y así no
-- se repiten cuatro veces por tabla.
ALTER TABLE public.recepciones     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recepcion_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activos_fijos   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
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
  FOREACH t IN ARRAY ARRAY['recepciones','recepcion_lineas','activos_fijos'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
                      USING (company_id = get_my_company_id() OR is_super_admin())$p$,
                   t || '_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)',
                   t || '_insert', t, ins_expr);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
                   t || '_update', t, upd_expr, upd_expr);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)',
                   t || '_delete', t, del_expr);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'mfa_requirement_met') THEN
    FOREACH t IN ARRAY ARRAY['recepciones','recepcion_lineas','activos_fijos'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS mfa_gate_aal2 ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY mfa_gate_aal2 ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        || 'USING (public.mfa_requirement_met()) WITH CHECK (public.mfa_requirement_met())', t);
    END LOOP;
  END IF;
END $$;

-- ── 6. Existencias atómicas (arregla el stock calculado en el navegador) ────
ALTER TABLE public.movimientos_suministro
  ADD COLUMN IF NOT EXISTS costo_unitario numeric(14,4),
  ADD COLUMN IF NOT EXISTS origen_tabla   text,
  ADD COLUMN IF NOT EXISTS origen_id      uuid;

CREATE INDEX IF NOT EXISTS idx_mov_suministro_origen
  ON public.movimientos_suministro(origen_tabla, origen_id)
  WHERE origen_id IS NOT NULL;

-- Semántica IDÉNTICA a la que tenía el cliente, para no cambiar lo que la
-- pantalla ya hacía: entrada suma, salida resta con piso en 0, y `ajuste` FIJA
-- el stock (no es un delta). Lo único que cambia es dónde se calcula.
CREATE OR REPLACE FUNCTION public.suministros_tg_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_stock  numeric(14,4);
  v_costo  numeric(14,4);
  v_nuevo  numeric(14,4);
  v_ncosto numeric(14,4);
  -- Se GUARDA el valor previo del GUC en vez de forzar 'off' al salir: este
  -- trigger corre anidado dentro de compras_tg_recepcion_registrar, que ya lo
  -- tiene en 'on' para toda su pasada. Apagarlo aquí se lo apagaba al de
  -- afuera, y la segunda línea de la recepción moría con COMPRAS_OC_INMUTABLE.
  v_prev   text := COALESCE(current_setting('conta.allow_system_write', true), 'off');
BEGIN
  SELECT stock_actual, costo_unitario INTO v_stock, v_costo
  FROM public.suministros_condominio WHERE id = NEW.suministro_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_nuevo := CASE NEW.tipo
               WHEN 'entrada' THEN v_stock + NEW.cantidad
               WHEN 'salida'  THEN GREATEST(0, v_stock - NEW.cantidad)
               ELSE NEW.cantidad
             END;

  -- Costo promedio ponderado, solo en entradas con costo conocido. Una salida
  -- no cambia el costo promedio, y un ajuste no trae precio.
  v_ncosto := v_costo;
  IF NEW.tipo = 'entrada' AND COALESCE(NEW.costo_unitario, 0) > 0
     AND (GREATEST(v_stock, 0) + NEW.cantidad) > 0 THEN
    v_ncosto := round(
      (GREATEST(v_stock, 0) * COALESCE(v_costo, 0) + NEW.cantidad * NEW.costo_unitario)
      / (GREATEST(v_stock, 0) + NEW.cantidad), 4);
  END IF;

  PERFORM set_config('conta.allow_system_write', 'on', true);
  UPDATE public.suministros_condominio
     SET stock_actual = v_nuevo, costo_unitario = v_ncosto
   WHERE id = NEW.suministro_id;
  PERFORM set_config('conta.allow_system_write', v_prev, true);

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.suministros_tg_stock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_suministros_stock ON public.movimientos_suministro;
CREATE TRIGGER trg_suministros_stock
  AFTER INSERT ON public.movimientos_suministro
  FOR EACH ROW EXECUTE FUNCTION public.suministros_tg_stock();

-- El historial de movimientos pasa a ser la ÚNICA fuente del stock: un UPDATE
-- directo a `stock_actual` se ignora en silencio (no se rechaza, para que un
-- navegador con el bundle viejo siga funcionando sin errores en pantalla — solo
-- deja de contar doble). Para corregir existencias se registra un `ajuste`.
CREATE OR REPLACE FUNCTION public.suministros_tg_guard_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') <> 'on'
     AND NEW.stock_actual IS DISTINCT FROM OLD.stock_actual THEN
    NEW.stock_actual := OLD.stock_actual;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.suministros_tg_guard_stock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_suministros_guard_stock ON public.suministros_condominio;
CREATE TRIGGER trg_suministros_guard_stock
  BEFORE UPDATE ON public.suministros_condominio
  FOR EACH ROW EXECUTE FUNCTION public.suministros_tg_guard_stock();

-- ── 7. Total de la línea de recepción ───────────────────────────────────────
-- El costo por defecto sale de la orden: recibir no es renegociar el precio.
CREATE OR REPLACE FUNCTION public.compras_tg_recepcion_linea()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_estado text; v_precio numeric(14,4);
BEGIN
  SELECT estado INTO v_estado FROM public.recepciones WHERE id = COALESCE(NEW.recepcion_id, OLD.recepcion_id);
  IF v_estado IS NOT NULL AND v_estado <> 'borrador'
     AND COALESCE(current_setting('conta.allow_system_write', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'COMPRAS_RECEPCION_INMUTABLE: la recepción está % y sus líneas ya no se editan.', v_estado
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF COALESCE(NEW.costo_unitario, 0) = 0 THEN
    SELECT precio_unitario INTO v_precio FROM public.orden_compra_lineas WHERE id = NEW.orden_compra_linea_id;
    NEW.costo_unitario := COALESCE(v_precio, 0);
  END IF;
  NEW.total      := round(NEW.cantidad * NEW.costo_unitario, 2);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_tg_recepcion_linea() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_recepcion_linea ON public.recepcion_lineas;
CREATE TRIGGER trg_compras_recepcion_linea
  BEFORE INSERT OR UPDATE OR DELETE ON public.recepcion_lineas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_recepcion_linea();

-- ── 8. Registrar la recepción: el corazón de la fase ────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_recepcion_registrar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_oc       record;
  v_l        record;
  v_tol      numeric;
  v_moneda   text;
  v_lineas   jsonb;
  v_total    numeric(14,2);
  v_prov     text;
  v_pend     int;
  v_recib    int;
  v_codigo   text;
  v_cta_af   uuid;
  v_cta_dep  uuid;
  v_cta_gdep uuid;
  -- Mismo cuidado que en suministros_tg_stock: se restaura el valor previo del
  -- GUC en vez de forzar 'off', para no apagárselo a un trigger de afuera.
  v_prev     text := COALESCE(current_setting('conta.allow_system_write', true), 'off');
BEGIN
  -- ─ Registrar ─────────────────────────────────────────────────────────────
  IF NEW.estado = 'registrada' AND OLD.estado = 'borrador' THEN
    SELECT * INTO v_oc FROM public.ordenes_compra WHERE id = NEW.orden_compra_id;
    IF v_oc.estado NOT IN ('aprobada','emitida','recibida_parcial') THEN
      RAISE EXCEPTION 'COMPRAS_OC_NO_RECIBIBLE: la orden % está en estado "%" y no admite recepciones.',
        COALESCE(v_oc.numero, v_oc.concepto), v_oc.estado USING ERRCODE = 'check_violation';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.recepcion_lineas WHERE recepcion_id = NEW.id) THEN
      RAISE EXCEPTION 'COMPRAS_RECEPCION_VACIA: no se registra una recepción sin líneas.'
        USING ERRCODE = 'check_violation';
    END IF;

    v_tol := public.compras_tolerancia(NEW.company_id, 'cantidad');

    PERFORM set_config('conta.allow_system_write', 'on', true);

    FOR v_l IN
      SELECT rl.id AS rl_id, rl.cantidad, rl.costo_unitario, rl.total,
             ocl.id AS ocl_id, ocl.descripcion, ocl.destino_tipo, ocl.suministro_id,
             ocl.cuenta_id, ocl.categoria, ocl.cantidad AS pedida, ocl.cantidad_recibida,
             ocl.unidad
      FROM public.recepcion_lineas rl
      JOIN public.orden_compra_lineas ocl ON ocl.id = rl.orden_compra_linea_id
      WHERE rl.recepcion_id = NEW.id
      ORDER BY ocl.linea
    LOOP
      -- Recibir de más es un error de captura o una entrega fuera de contrato:
      -- se corta aquí, no en la factura, que es donde ya sería tarde.
      IF v_l.cantidad_recibida + v_l.cantidad > v_l.pedida * (1 + v_tol / 100) THEN
        RAISE EXCEPTION 'COMPRAS_SOBRE_RECEPCION: "%" — pedido %, ya recibido %, ahora %. Tolerancia: % por ciento.',
          v_l.descripcion, v_l.pedida, v_l.cantidad_recibida, v_l.cantidad, v_tol
          USING ERRCODE = 'check_violation';
      END IF;

      UPDATE public.orden_compra_lineas
         SET cantidad_recibida = cantidad_recibida + v_l.cantidad, updated_at = now()
       WHERE id = v_l.ocl_id;

      -- Inventario: una entrada al kardex; el trigger de stock hace el resto.
      IF v_l.destino_tipo = 'inventario' AND v_l.suministro_id IS NOT NULL THEN
        INSERT INTO public.movimientos_suministro
          (company_id, suministro_id, tipo, cantidad, motivo, fecha, costo_unitario, origen_tabla, origen_id)
        VALUES (NEW.company_id, v_l.suministro_id, 'entrada', v_l.cantidad,
                'Recepción ' || COALESCE(NEW.numero, '') || ' — OC ' || COALESCE(v_oc.numero, ''),
                NEW.fecha, v_l.costo_unitario, 'recepcion_lineas', v_l.rl_id);
      END IF;

      -- Activo fijo: una fila por unidad recibida, porque un activo se
      -- etiqueta, se ubica y se depreciará de a uno.
      IF v_l.destino_tipo = 'activo_fijo' THEN
        SELECT id INTO v_cta_af   FROM public.conta_cuentas
          WHERE company_id = NEW.company_id AND project_id IS NOT DISTINCT FROM NEW.project_id AND codigo = '1401';
        SELECT id INTO v_cta_dep  FROM public.conta_cuentas
          WHERE company_id = NEW.company_id AND project_id IS NOT DISTINCT FROM NEW.project_id AND codigo = '1409';
        SELECT id INTO v_cta_gdep FROM public.conta_cuentas
          WHERE company_id = NEW.company_id AND project_id IS NOT DISTINCT FROM NEW.project_id AND codigo = '5107';

        FOR v_recib IN 1..GREATEST(1, floor(v_l.cantidad)::int) LOOP
          v_codigo := 'AF-' || lpad(
            public.compras_siguiente_correlativo(NEW.company_id, NEW.project_id, 'activo_fijo')::text, 6, '0');
          INSERT INTO public.activos_fijos
            (company_id, project_id, codigo, nombre, fecha_alta, costo,
             cuenta_activo_id, cuenta_dep_acum_id, cuenta_gasto_dep_id,
             proveedor_id, recepcion_linea_id, notas)
          VALUES (NEW.company_id, NEW.project_id, v_codigo, v_l.descripcion, NEW.fecha,
                  v_l.costo_unitario, COALESCE(v_l.cuenta_id, v_cta_af), v_cta_dep, v_cta_gdep,
                  v_oc.proveedor_id, v_l.rl_id,
                  'Alta automática por recepción ' || COALESCE(NEW.numero, NEW.id::text));
        END LOOP;
      END IF;
    END LOOP;

    -- ─ Estado de la orden ──────────────────────────────────────────────────
    SELECT COUNT(*) INTO v_pend FROM public.orden_compra_lineas
     WHERE orden_compra_id = NEW.orden_compra_id AND cantidad_recibida < cantidad;
    UPDATE public.ordenes_compra
       SET estado = CASE WHEN v_pend = 0 THEN 'recibida' ELSE 'recibida_parcial' END,
           updated_at = now()
     WHERE id = NEW.orden_compra_id;

    -- ─ Asiento GR/IR ───────────────────────────────────────────────────────
    -- Dr por destino (cuenta de la línea si la trae; si no, el mapeo del
    -- evento) contra Cr `compras_por_facturar`. Agrupado por cuenta para no
    -- escribir diez líneas de la misma cuenta.
    WITH destinos AS (
      SELECT ocl.cuenta_id,
             CASE ocl.destino_tipo
               WHEN 'inventario'  THEN 'inventario'
               WHEN 'activo_fijo' THEN 'activo_fijo'
               ELSE CASE WHEN COALESCE(ocl.categoria, 'otros') IN
                          ('mantenimiento','servicios','administrativo','seguridad','limpieza','obras')
                         THEN 'gasto_' || ocl.categoria ELSE 'gasto_otros' END
             END AS evento,
             rl.total
      FROM public.recepcion_lineas rl
      JOIN public.orden_compra_lineas ocl ON ocl.id = rl.orden_compra_linea_id
      WHERE rl.recepcion_id = NEW.id
    ), agrupado AS (
      SELECT cuenta_id, evento, SUM(total) AS monto FROM destinos GROUP BY cuenta_id, evento
    )
    SELECT jsonb_agg(CASE WHEN cuenta_id IS NOT NULL
                          THEN jsonb_build_object('cuenta_id', cuenta_id, 'debe', monto)
                          ELSE jsonb_build_object('evento', evento, 'debe', monto) END),
           SUM(monto)
      INTO v_lineas, v_total
      FROM agrupado;

    IF COALESCE(v_total, 0) > 0 THEN
      SELECT nombre INTO v_prov FROM public.proveedores WHERE id = v_oc.proveedor_id;
      v_moneda := COALESCE(v_oc.moneda, public.conta_moneda_base(NEW.company_id, NEW.project_id));

      PERFORM public.conta_generar_asiento(
        NEW.company_id, NEW.project_id, 'recepciones', NEW.id, 'recepcion_registrada',
        NEW.fecha,
        'Recepción ' || COALESCE(NEW.numero, '') || ' — OC ' || COALESCE(v_oc.numero, v_oc.concepto)
          || COALESCE(' — ' || v_prov, ''),
        'diario', v_moneda,
        v_lineas || jsonb_build_array(
          jsonb_build_object('evento', 'compras_por_facturar', 'haber', v_total,
                             'descripcion', 'Pendiente de facturación'))
      );
    END IF;

    PERFORM set_config('conta.allow_system_write', v_prev, true);
    RETURN NEW;
  END IF;

  -- ─ Anular ────────────────────────────────────────────────────────────────
  IF NEW.estado = 'anulada' AND OLD.estado = 'registrada' THEN
    PERFORM set_config('conta.allow_system_write', 'on', true);

    FOR v_l IN
      SELECT rl.id AS rl_id, rl.cantidad, rl.costo_unitario,
             ocl.id AS ocl_id, ocl.destino_tipo, ocl.suministro_id, ocl.cantidad_facturada
      FROM public.recepcion_lineas rl
      JOIN public.orden_compra_lineas ocl ON ocl.id = rl.orden_compra_linea_id
      WHERE rl.recepcion_id = NEW.id
    LOOP
      -- Lo ya facturado no se puede "des-recibir": primero se anula la factura.
      IF v_l.cantidad_facturada > 0 THEN
        RAISE EXCEPTION 'COMPRAS_RECEPCION_FACTURADA: la línea ya tiene % facturada; anula primero la factura.',
          v_l.cantidad_facturada USING ERRCODE = 'check_violation';
      END IF;

      UPDATE public.orden_compra_lineas
         SET cantidad_recibida = GREATEST(0, cantidad_recibida - v_l.cantidad), updated_at = now()
       WHERE id = v_l.ocl_id;

      -- El kardex no se reescribe: se compensa con una salida, que es lo que
      -- de verdad pasó (entró y volvió a salir).
      IF v_l.destino_tipo = 'inventario' AND v_l.suministro_id IS NOT NULL THEN
        INSERT INTO public.movimientos_suministro
          (company_id, suministro_id, tipo, cantidad, motivo, fecha, costo_unitario, origen_tabla, origen_id)
        VALUES (NEW.company_id, v_l.suministro_id, 'salida', v_l.cantidad,
                'Anulación de recepción ' || COALESCE(NEW.numero, ''), CURRENT_DATE,
                v_l.costo_unitario, 'recepcion_lineas_anulada', v_l.rl_id);
      END IF;

      -- Los activos no se borran: se dan de baja con su motivo.
      UPDATE public.activos_fijos
         SET estado = 'dado_de_baja',
             motivo_baja = 'Recepción anulada',
             updated_at = now()
       WHERE recepcion_linea_id = v_l.rl_id AND estado <> 'dado_de_baja';
    END LOOP;

    SELECT COUNT(*) INTO v_recib FROM public.orden_compra_lineas
     WHERE orden_compra_id = NEW.orden_compra_id AND cantidad_recibida > 0;
    SELECT COUNT(*) INTO v_pend FROM public.orden_compra_lineas
     WHERE orden_compra_id = NEW.orden_compra_id AND cantidad_recibida < cantidad;
    -- Sin nada recibido, la orden vuelve a donde estaba ANTES de la entrega:
    -- 'emitida' si llegó a enviarse al proveedor, 'aprobada' si no. Forzar
    -- siempre 'emitida' inventaría un envío que quizá nunca ocurrió.
    UPDATE public.ordenes_compra
       SET estado = CASE WHEN v_recib = 0 THEN
                           CASE WHEN emitida_at IS NOT NULL THEN 'emitida' ELSE 'aprobada' END
                         WHEN v_pend = 0 THEN 'recibida'
                         ELSE 'recibida_parcial' END,
           updated_at = now()
     WHERE id = NEW.orden_compra_id;

    PERFORM public.conta_reversar_automatico(NEW.company_id, 'recepciones', NEW.id,
      'recepcion_registrada', 'Recepción anulada');

    PERFORM set_config('conta.allow_system_write', v_prev, true);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_tg_recepcion_registrar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_recepcion_registrar ON public.recepciones;
CREATE TRIGGER trg_compras_recepcion_registrar
  AFTER UPDATE OF estado ON public.recepciones
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_recepcion_registrar();

-- Correlativo y sellos de la recepción.
CREATE OR REPLACE FUNCTION public.compras_tg_recepcion_estado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();

  IF TG_OP = 'UPDATE' AND OLD.estado = 'anulada' AND NEW.estado <> 'anulada' THEN
    RAISE EXCEPTION 'COMPRAS_RECEPCION_INMUTABLE: una recepción anulada no se reabre.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.estado = 'registrada' AND COALESCE(OLD.estado, '') <> 'registrada' THEN
    IF NEW.numero IS NULL THEN
      NEW.numero := 'REC-' || lpad(
        public.compras_siguiente_correlativo(NEW.company_id, NEW.project_id, 'recepcion')::text, 6, '0');
    END IF;
    NEW.recibido_por  := COALESCE(NEW.recibido_por, auth.uid());
    NEW.registrada_at := COALESCE(NEW.registrada_at, now());
  END IF;

  IF NEW.estado = 'anulada' AND NEW.anulada_at IS NULL THEN
    NEW.anulada_at := now();
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_tg_recepcion_estado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_recepcion_estado ON public.recepciones;
CREATE TRIGGER trg_compras_recepcion_estado
  BEFORE INSERT OR UPDATE ON public.recepciones
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_recepcion_estado();

DROP TRIGGER IF EXISTS trg_activos_fijos_touch ON public.activos_fijos;
CREATE TRIGGER trg_activos_fijos_touch
  BEFORE UPDATE ON public.activos_fijos
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_compras_config_touch ON public.compras_config;
CREATE TRIGGER trg_compras_config_touch
  BEFORE UPDATE ON public.compras_config
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_touch_updated_at();
