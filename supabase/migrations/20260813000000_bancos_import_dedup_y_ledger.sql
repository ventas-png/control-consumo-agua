-- ════════════════════════════════════════════════════════════════════════════
-- BANCOS · importación del extracto y separación por contabilidad (ledger)
--
-- Dos fallas del módulo Bancos que se ven juntas al importar un extracto:
--
-- 1. IMPORTAR EXTRACTO FALLABA SIEMPRE ("Error en inserción · there is no
--    unique or exclusion constraint matching the ON CONFLICT specification").
--    El dedup de importaciones vivía en un índice PARCIAL
--    (uq_banco_mov_dedup … WHERE referencia IS NOT NULL). PostgREST construye
--    `ON CONFLICT (<columnas>)` y no tiene forma de mandar el predicado del
--    índice, así que Postgres no podía inferir el árbitro y RECHAZABA el lote
--    entero (42P10) — daba igual si el extracto traía 107 filas o 1.
--    Fix: el mismo dedup en un índice único COMPLETO. La semántica no cambia:
--    Postgres trata los NULL como distintos, así que las filas SIN referencia
--    (las que el índice parcial excluía) siguen sin deduplicarse.
--
-- 2. LOS MOVIMIENTOS NO RESPETABAN LA DIVISIÓN EMPRESA / PROYECTO.
--    banco_movimientos.company_id lo mandaba el cliente y cuenta_bancaria_id
--    venía del selector de la pantalla: NADA en la BD obligaba a que
--    coincidieran. Un movimiento podía quedar sellado con una empresa y
--    colgando del banco de otra, y la tabla ni siquiera sabía a qué
--    contabilidad (empresa o proyecto) pertenecía, porque el ledger solo vivía
--    en cuentas_bancarias.project_id. Resultado: extractos de distintas
--    contabilidades mezclados en las lecturas por company_id.
--    Fix: project_id propio (derivado del banco), FK compuesta
--    (cuenta_bancaria_id, company_id) y un trigger que sella empresa+proyecto
--    desde la cuenta bancaria. Con company_id ya sellado por la BD, la RLS de
--    INSERT (company_id = get_my_company_id()) pasa a rechazar de verdad meter
--    movimientos en el banco de otra empresa.
--
-- 3. CONCILIAR CRUZABA CONTABILIDADES.
--    banco_sugerencias_conciliacion ya acota candidatos al ledger del banco
--    (20260612010200), pero banco_conciliar_movimiento —el que ESCRIBE— solo
--    validaba la EMPRESA: un pago del proyecto A podía conciliarse contra el
--    banco del proyecto B (o el de la empresa), y la póliza nacía en el ledger
--    equivocado. Ahora exige el mismo ledger.
--
-- 4. El alias del banco era único por EMPRESA, no por contabilidad: dos
--    proyectos de la misma empresa no podían llamar "Banco Industrial" cada uno
--    a su propia cuenta. Unicidad por ledger (misma convención COALESCE(
--    project_id, uuid-cero) que el catálogo de cuentas, 20260612000000).
--
-- Impacto en datos productivos: sanea filas ya mezcladas (company_id que no
-- corresponde al banco de la fila) y rellena project_id desde la cuenta
-- bancaria. No borra ni mueve movimientos.
--
-- REVERSIÓN:
--   DROP TRIGGER trg_banco_movimiento_ledger ON public.banco_movimientos;
--   DROP TRIGGER trg_banco_cuenta_propaga_ledger ON public.cuentas_bancarias;
--   DROP FUNCTION public.banco_tg_movimiento_ledger();
--   DROP FUNCTION public.banco_tg_propagar_ledger_movimientos();
--   ALTER TABLE public.banco_movimientos DROP CONSTRAINT fk_banco_mov_cuenta_empresa;
--   ALTER TABLE public.banco_movimientos DROP COLUMN project_id;
--   DROP INDEX public.uq_banco_mov_dedup;
--   CREATE UNIQUE INDEX uq_banco_mov_dedup ON public.banco_movimientos
--     (cuenta_bancaria_id, fecha, monto, referencia) WHERE referencia IS NOT NULL;
--   DROP INDEX public.uq_cuentas_bancarias_ledger_nombre;
--   ALTER TABLE public.cuentas_bancarias ADD CONSTRAINT cuentas_bancarias_company_id_nombre_key
--     UNIQUE (company_id, nombre);
--   (banco_conciliar_movimiento: reinstalar la versión de 20260611030100.)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Dedup del extracto que PostgREST sí puede usar ───────────────────────
-- El índice nuevo cubre exactamente las mismas filas que el parcial más las de
-- referencia NULL (que Postgres considera siempre distintas entre sí), así que
-- el swap no puede fallar por duplicados preexistentes.
DROP INDEX IF EXISTS public.uq_banco_mov_dedup;

CREATE UNIQUE INDEX IF NOT EXISTS uq_banco_mov_dedup
  ON public.banco_movimientos(cuenta_bancaria_id, fecha, monto, referencia);

COMMENT ON INDEX public.uq_banco_mov_dedup IS
  'Dedup de importaciones repetidas del extracto. NO puede volverse PARCIAL: es el árbitro del ON CONFLICT que emite PostgREST al importar, y un índice parcial no es inferible.';

-- ── 2. El movimiento hereda la contabilidad de su banco ─────────────────────
ALTER TABLE public.banco_movimientos
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

-- Backfill + saneo ANTES de instalar las guardas (una fila mezclada haría
-- fallar la FK compuesta). La cuenta bancaria es la fuente de verdad.
UPDATE public.banco_movimientos m
   SET company_id = cb.company_id,
       project_id = cb.project_id
  FROM public.cuentas_bancarias cb
 WHERE cb.id = m.cuenta_bancaria_id
   AND (m.company_id IS DISTINCT FROM cb.company_id
     OR m.project_id IS DISTINCT FROM cb.project_id);

-- FK compuesta: la empresa del movimiento es, estructuralmente, la del banco.
-- La FK se suelta ANTES que el UNIQUE al que apunta para que la migración se
-- pueda replayar sobre una base que ya la tiene (si no, el DROP del UNIQUE
-- muere con "other objects depend on it").
ALTER TABLE public.banco_movimientos
  DROP CONSTRAINT IF EXISTS fk_banco_mov_cuenta_empresa;

ALTER TABLE public.cuentas_bancarias
  DROP CONSTRAINT IF EXISTS uq_cuentas_bancarias_id_company;
ALTER TABLE public.cuentas_bancarias
  ADD CONSTRAINT uq_cuentas_bancarias_id_company UNIQUE (id, company_id);

ALTER TABLE public.banco_movimientos
  ADD CONSTRAINT fk_banco_mov_cuenta_empresa
  FOREIGN KEY (cuenta_bancaria_id, company_id)
  REFERENCES public.cuentas_bancarias(id, company_id) ON DELETE CASCADE;

-- El trigger sella empresa+proyecto desde la cuenta bancaria: lo que mande el
-- cliente en company_id/project_id es irrelevante. SECURITY DEFINER para poder
-- leer la cuenta aunque la RLS se la oculte al que inserta — así el sello es el
-- real y la WITH CHECK de la policy (que corre DESPUÉS de los BEFORE triggers)
-- rebota el intento de escribir en el banco de otra empresa.
CREATE OR REPLACE FUNCTION public.banco_tg_movimiento_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_cta public.cuentas_bancarias;
BEGIN
  SELECT * INTO v_cta FROM public.cuentas_bancarias WHERE id = NEW.cuenta_bancaria_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BANCO_LEDGER: la cuenta bancaria del movimiento no existe.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.company_id := v_cta.company_id;
  NEW.project_id := v_cta.project_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_banco_movimiento_ledger ON public.banco_movimientos;
CREATE TRIGGER trg_banco_movimiento_ledger
  BEFORE INSERT OR UPDATE OF cuenta_bancaria_id, company_id, project_id
  ON public.banco_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.banco_tg_movimiento_ledger();

-- Si un banco se mueve de contabilidad, su extracto se mueve con él (si no, el
-- project_id de los movimientos quedaría mintiendo).
CREATE OR REPLACE FUNCTION public.banco_tg_propagar_ledger_movimientos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.banco_movimientos
     SET project_id = NEW.project_id
   WHERE cuenta_bancaria_id = NEW.id
     AND project_id IS DISTINCT FROM NEW.project_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_banco_cuenta_propaga_ledger ON public.cuentas_bancarias;
CREATE TRIGGER trg_banco_cuenta_propaga_ledger
  AFTER UPDATE OF project_id ON public.cuentas_bancarias
  FOR EACH ROW WHEN (OLD.project_id IS DISTINCT FROM NEW.project_id)
  EXECUTE FUNCTION public.banco_tg_propagar_ledger_movimientos();

CREATE INDEX IF NOT EXISTS idx_banco_mov_ledger
  ON public.banco_movimientos(company_id, project_id, estado);

COMMENT ON COLUMN public.banco_movimientos.project_id IS
  'Contabilidad dueña del movimiento, derivada de su cuenta bancaria: NULL = ledger de la empresa; uuid = ledger del proyecto. La sella el trigger banco_tg_movimiento_ledger, no el cliente.';

-- ── 3. Alias del banco único POR CONTABILIDAD ───────────────────────────────
-- El índice nuevo es más laxo que el UNIQUE que reemplaza (agrega el ledger a
-- la llave), así que tampoco puede fallar por duplicados preexistentes.
ALTER TABLE public.cuentas_bancarias
  DROP CONSTRAINT IF EXISTS cuentas_bancarias_company_id_nombre_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cuentas_bancarias_ledger_nombre
  ON public.cuentas_bancarias(company_id,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), nombre);

-- ── 4. Conciliar: mismo tenant Y misma contabilidad ─────────────────────────
CREATE OR REPLACE FUNCTION public.banco_conciliar_movimiento(
  p_movimiento_id uuid,
  p_match_tipo    text,
  p_match_id      uuid
)
RETURNS public.banco_movimientos LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_mov     public.banco_movimientos;
  v_cta     public.cuentas_bancarias;
  v_company uuid;
  v_project uuid;
BEGIN
  SELECT * INTO v_mov FROM public.banco_movimientos WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento no encontrado.' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (
    public.is_super_admin()
    OR (v_mov.company_id = public.get_my_company_id()
        AND public.current_user_role() = ANY(ARRAY['company_owner','admin']))
  ) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  IF v_mov.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Solo un movimiento pendiente puede conciliarse (estado: %).', v_mov.estado
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_match_tipo NOT IN ('pago','orden_pago') THEN
    RAISE EXCEPTION 'match_tipo inválido: % (los ajustes usan banco_ajuste_conciliacion).', p_match_tipo
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_cta FROM public.cuentas_bancarias WHERE id = v_mov.cuenta_bancaria_id;

  -- El match debe existir y ser del mismo tenant.
  IF p_match_tipo = 'pago' THEN
    SELECT pr.company_id, p.project_id INTO v_company, v_project
    FROM public.pagos p JOIN public.projects pr ON pr.id = p.project_id
    WHERE p.id = p_match_id AND p.deleted_at IS NULL;
  ELSE
    SELECT o.company_id, o.project_id INTO v_company, v_project
    FROM public.ordenes_pago o WHERE o.id = p_match_id;
  END IF;
  IF v_company IS NULL OR v_company <> v_mov.company_id THEN
    RAISE EXCEPTION 'El documento a conciliar no existe o no pertenece a la empresa.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- …y de la MISMA contabilidad que el banco: un cobro del proyecto no cuadra
  -- el banco de la empresa (ni el de otro proyecto). Es la misma frontera que
  -- ya aplica banco_sugerencias_conciliacion al proponer candidatos.
  IF v_project IS DISTINCT FROM v_cta.project_id THEN
    RAISE EXCEPTION 'El documento pertenece a otra contabilidad (empresa/proyecto) que la cuenta bancaria.'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('conta.allow_system_write', 'on', true);
  UPDATE public.banco_movimientos
  SET estado = 'conciliado',
      match_tipo = p_match_tipo,
      match_id = p_match_id,
      conciliado_por = auth.uid(),
      conciliado_at = now()
  WHERE id = p_movimiento_id
  RETURNING * INTO v_mov;
  PERFORM set_config('conta.allow_system_write', 'off', true);

  RETURN v_mov;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.banco_conciliar_movimiento(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_conciliar_movimiento(uuid, text, uuid) TO authenticated;
