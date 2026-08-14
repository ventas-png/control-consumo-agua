-- ════════════════════════════════════════════════════════════════════════════
-- FASE 7 · parte A: UN HECHO ECONÓMICO, UN SOLO ASIENTO
-- Ver ROADMAP_ERP_FINANZAS.md (Fase 7). Depende de la Fase 6 (compras).
--
-- POR QUÉ EXISTE
-- `gastos_condominio` y `facturas_proveedor` postean al MISMO libro sin
-- conocerse. El mismo desembolso capturado por las dos se contabiliza dos
-- veces —el gasto se debita dos veces y el banco se acredita dos veces— y NADA
-- lo detecta.
--
-- La causa es estructural, no un descuido. La clave de idempotencia de los
-- asientos es (company_id, origen_tabla, origen_id, origen_evento)
-- —20260611000000_contabilidad_fase1_schema.sql:99—. Como `origen_tabla` forma
-- parte de la clave, un gasto y su factura producen claves DISTINTAS, cero
-- conflicto, y dos débitos a la misma cuenta `gasto_<categoria>` (ambos
-- triggers la resuelven con literalmente el mismo CASE). El índice garantiza
-- «un asiento por evento de documento», no «un asiento por hecho económico».
--
-- QUÉ HACE
--   1. `gastos_condominio.factura_id`: el gasto puede declarar que ES la
--      factura que ya está en cuentas por pagar.
--   2. `conta_tg_gastos` gana la guarda: con factura enlazada NO asienta,
--      porque la factura ya lo hizo. Es exactamente el patrón que la Fase 6 ya
--      probó en `conta_tg_facturas_prov`, que al ver una recepción previa
--      liquida 2105 en vez de volver a debitar el gasto.
--   3. Revive `proveedor_id`, que existe desde 20260611010000 y está MUERTO: la
--      pantalla escribe el proveedor como texto libre y nunca setea la FK. Sin
--      eso, cruzar gastos contra facturas no tiene con qué hacerse.
--
-- POR QUÉ ENLAZAR UN GASTO YA CONTABILIZADO EXIGE ANULARLO
-- `conta_reversar_automatico` deja el asiento original en estado 'publicado'
-- (solo le marca `anulado_por_id`), y el índice único filtra por
-- `estado <> 'anulado'` — así que un documento reversado SIGUE OCUPANDO su
-- clave y no puede volver a asentarse con el mismo evento. Inventar eventos
-- `gasto_pagado_r1`, `_r2`… para sortearlo sería ensuciar el libro para
-- resolver un problema de nomenclatura.
-- La salida limpia ya existe: ANULAR el gasto, que dispara el reverso por el
-- camino de siempre. Por eso enlazar un gasto con asiento vivo exige anularlo
-- en la misma operación (es lo que hace el botón «Enlazar» del reporte de
-- duplicados). Un gasto sin asiento —nuevo, o pendiente— se enlaza sin más.
--
-- COMPATIBILIDAD
-- Aditiva y degradable: sin `factura_id`, el comportamiento es IDÉNTICO al de
-- hoy. Ningún reporte cambia — EEFF, balanza, presupuesto vs real y el cierre
-- anual leen `conta_asiento_lineas`, no esta tabla.
--
-- CÓMO REVERTIR
--   DROP TRIGGER trg_gastos_factura_coherente ON public.gastos_condominio;
--   DROP FUNCTION public.gastos_tg_factura_coherente();
--   Restaurar conta_tg_gastos() a la versión de 20260611000200;
--   ALTER TABLE public.gastos_condominio DROP COLUMN factura_id;
--
-- IMPACTO EN DATOS PRODUCTIVOS: un UPDATE de una pasada sobre
-- `gastos_condominio` para poblar `proveedor_id` en las filas creadas después
-- de junio. No toca asientos, ni montos, ni estados.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. El gasto puede declarar su factura ───────────────────────────────────
ALTER TABLE public.gastos_condominio
  ADD COLUMN IF NOT EXISTS factura_id uuid REFERENCES public.facturas_proveedor(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gastos_factura
  ON public.gastos_condominio(factura_id) WHERE factura_id IS NOT NULL;

COMMENT ON COLUMN public.gastos_condominio.factura_id IS
  'Factura de proveedor que YA contabilizó este desembolso. Con la factura enlazada, el gasto NO genera asiento: es el mismo hecho económico visto desde la operación.';

COMMENT ON TABLE public.gastos_condominio IS
  'Desembolso SIN factura de proveedor: caja chica, reembolsos, compras menores con recibo simple. Lo que trae factura formal va por facturas_proveedor (CxP), y si se captura en ambas se enlaza con factura_id para no contarlo dos veces.';

-- ── 2. Revivir `proveedor_id` ───────────────────────────────────────────────
-- La columna existe desde 20260611010000 y su backfill corrió UNA vez, en
-- junio. Desde entonces la pantalla sigue guardando el proveedor como texto
-- libre sin tocar la FK, así que todo lo capturado después está en NULL. Se
-- repite el mismo procedimiento para esas filas; la parte de UI que deja de
-- crear NULLs nuevos va en este mismo PR.
DO $$
BEGIN
  INSERT INTO public.proveedores (company_id, nombre)
  SELECT DISTINCT g.company_id, trim(g.proveedor_nombre)
  FROM public.gastos_condominio g
  WHERE g.proveedor_id IS NULL
    AND g.proveedor_nombre IS NOT NULL AND trim(g.proveedor_nombre) <> ''
  ON CONFLICT (company_id, nombre) DO NOTHING;

  UPDATE public.gastos_condominio g
  SET proveedor_id = p.id
  FROM public.proveedores p
  WHERE g.proveedor_id IS NULL
    AND g.proveedor_nombre IS NOT NULL
    AND p.company_id = g.company_id
    AND p.nombre = trim(g.proveedor_nombre);
END $$;

-- ── 3. ¿Este gasto tiene un asiento vivo? ───────────────────────────────────
-- Lo consultan el guard de enlace y el reporte de duplicados. Se aísla en una
-- función para que «vivo» signifique lo mismo en los dos sitios: publicado y
-- no reversado.
CREATE OR REPLACE FUNCTION public.gasto_tiene_asiento(p_gasto_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conta_asientos
    WHERE origen = 'automatico'
      AND origen_tabla = 'gastos_condominio'
      AND origen_id = p_gasto_id
      AND origen_evento = 'gasto_pagado'
      AND estado = 'publicado'
      AND anulado_por_id IS NULL
  )
$$;

REVOKE EXECUTE ON FUNCTION public.gasto_tiene_asiento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gasto_tiene_asiento(uuid) TO authenticated;

-- ── 4. Coherencia del enlace ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gastos_tg_factura_coherente()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_f      record;
  v_enlaza boolean;
BEGIN
  v_enlaza := NEW.factura_id IS NOT NULL
              AND (TG_OP = 'INSERT' OR OLD.factura_id IS DISTINCT FROM NEW.factura_id);

  IF NOT v_enlaza THEN
    RETURN NEW;
  END IF;

  SELECT company_id, project_id, proveedor_id, estado, numero_factura
    INTO v_f
  FROM public.facturas_proveedor WHERE id = NEW.factura_id;

  IF v_f IS NULL THEN
    RAISE EXCEPTION 'GASTO_FACTURA_INEXISTENTE: la factura enlazada no existe.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Mismo LEDGER: si no, el gasto viviría en una contabilidad y la factura que
  -- dice haberlo contabilizado en otra — y el doble conteo seguiría, solo que
  -- repartido entre dos libros.
  IF v_f.company_id <> NEW.company_id OR v_f.project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'GASTO_FACTURA_OTRA_CONTABILIDAD: la factura pertenece a otra contabilidad.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Mismo proveedor. Si el gasto no lo tiene resuelto, lo hereda de la factura:
  -- enlazarlas es afirmar que son el mismo desembolso.
  IF NEW.proveedor_id IS NULL THEN
    NEW.proveedor_id := v_f.proveedor_id;
  ELSIF NEW.proveedor_id <> v_f.proveedor_id THEN
    RAISE EXCEPTION 'GASTO_FACTURA_OTRO_PROVEEDOR: el gasto es de un proveedor y la factura de otro.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_f.estado = 'anulada' THEN
    RAISE EXCEPTION 'GASTO_FACTURA_ANULADA: no se enlaza a una factura anulada.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Un gasto YA contabilizado solo se enlaza anulándolo en la misma operación:
  -- su asiento tiene que irse, y el reverso por anulación es el único camino
  -- limpio (ver la nota de la cabecera sobre la clave única).
  IF TG_OP = 'UPDATE' AND NEW.estado <> 'anulado' AND public.gasto_tiene_asiento(NEW.id) THEN
    RAISE EXCEPTION 'GASTO_ENLACE_REQUIERE_ANULAR: el gasto "%" ya está contabilizado; para enlazarlo a la factura % hay que anularlo en la misma operación (es lo que hace «Enlazar» en el reporte de duplicados).',
      NEW.concepto, COALESCE(v_f.numero_factura, '')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.gastos_tg_factura_coherente() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_gastos_factura_coherente ON public.gastos_condominio;
CREATE TRIGGER trg_gastos_factura_coherente
  BEFORE INSERT OR UPDATE ON public.gastos_condominio
  FOR EACH ROW EXECUTE FUNCTION public.gastos_tg_factura_coherente();

-- ── 5. El trigger contable aprende que la factura pudo llegar primero ───────
-- Se reescribe `conta_tg_gastos()` conservando ÍNTEGRA la ruta de siempre —la
-- que siguen todos los gastos sin factura— y añadiéndole dos condiciones.
-- Ojo: esta función NUNCA se había redefinido (sigue en su v1 de junio,
-- mientras la de facturas va por la v3), así que este es el primer
-- CREATE OR REPLACE sobre ella. Ver 20260611000200_contabilidad_fase1_seed_y_triggers.sql:515.
CREATE OR REPLACE FUNCTION public.conta_tg_gastos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_moneda text;
  v_metodo text;
  v_gasto  text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.conta_reversar_automatico(OLD.company_id, 'gastos_condominio', OLD.id,
      'gasto_pagado', 'Gasto eliminado');
    RETURN OLD;
  END IF;

  -- Reverso: anulado después de pagado. NO se filtra por `factura_id` a
  -- propósito — anular es justamente lo que se hace al descubrir que el gasto
  -- duplicaba una factura, y ahí el asiento SÍ tiene que reversarse.
  -- Si el gasto nació enlazado nunca hubo asiento y `conta_reversar_automatico`
  -- no encuentra nada, que es inofensivo.
  IF TG_OP = 'UPDATE' AND OLD.estado = 'pagado' AND NEW.estado = 'anulado' THEN
    PERFORM public.conta_reversar_automatico(NEW.company_id, 'gastos_condominio', NEW.id,
      'gasto_pagado', 'Gasto anulado');
    RETURN NEW;
  END IF;

  -- Contabilizar: gasto pagado (alta directa en pagado o transición).
  --
  -- Dos condiciones nuevas:
  --   · `NEW.factura_id IS NULL` — con factura enlazada, ella ya devengó el
  --     gasto contra cuentas por pagar; volver a debitarlo aquí es el doble
  --     conteo que esta fase viene a cerrar.
  --   · `OR OLD.factura_id IS NOT NULL` en el disparador — al DESENLAZAR un
  --     gasto que ya estaba en 'pagado', el estado no cambia, así que sin esto
  --     no se asentaría nunca. La clave única está libre en ese caso porque
  --     mientras estuvo enlazado no se generó ningún asiento.
  IF NEW.estado = 'pagado'
     AND NEW.factura_id IS NULL
     AND (TG_OP = 'INSERT'
          OR OLD.estado <> 'pagado'
          OR OLD.factura_id IS NOT NULL)
     AND COALESCE(NEW.monto, 0) > 0 THEN

    v_gasto := CASE WHEN NEW.categoria IN ('mantenimiento','servicios','administrativo',
                                           'seguridad','limpieza','obras')
                    THEN 'gasto_' || NEW.categoria ELSE 'gasto_otros' END;
    v_metodo := CASE NEW.metodo_pago
      WHEN 'efectivo'      THEN 'metodo_efectivo'
      WHEN 'transferencia' THEN 'metodo_transferencia'
      WHEN 'cheque'        THEN 'metodo_cheque'
      WHEN 'tarjeta'       THEN 'metodo_tarjeta'
      ELSE 'metodo_otro'
    END;
    SELECT COALESCE(moneda_condominios, moneda) INTO v_moneda
    FROM public.projects WHERE id = NEW.project_id;

    PERFORM public.conta_generar_asiento(
      NEW.company_id, NEW.project_id, 'gastos_condominio', NEW.id, 'gasto_pagado',
      NEW.fecha,
      'Gasto: ' || NEW.concepto || COALESCE(' — ' || NULLIF(NEW.proveedor_nombre, ''), ''),
      'egreso', v_moneda,
      jsonb_build_array(
        jsonb_build_object('evento', v_gasto, 'debe', NEW.monto),
        jsonb_build_object('evento', v_metodo, 'haber', NEW.monto)
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.conta_tg_gastos() IS
  'Asiento del gasto de condominio (Dr gasto_<categoria> / Cr metodo_<pago>). Con factura_id enlazada NO asienta: la factura de proveedor ya devengó ese desembolso.';

-- El guard nocturno de seguridad (20260612192952) exige que las funciones de
-- trigger no sean ejecutables por el cliente. `CREATE OR REPLACE` conserva los
-- privilegios, pero se repone explícitamente para que el REVOKE viva junto a la
-- definición y no dependa de una migración de hace dos meses.
REVOKE EXECUTE ON FUNCTION public.conta_tg_gastos() FROM PUBLIC, anon, authenticated;
