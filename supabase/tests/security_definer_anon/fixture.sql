-- ════════════════════════════════════════════════════════════════════════════
-- Fixture de security_definer_anon.
--
-- Crea las 8 funciones del hallazgo P1 como STUBS con las MISMAS firmas y el
-- MISMO estado de ACL que dejaron sus migraciones de origen (verificado contra
-- 20260813000000/120000, 20260814000000, 20260816000000, 20260818000000 y
-- 20260820000100). No se aplican esas migraciones reales: sus
-- dependencias abarcan 5 módulos sin relación entre sí (la cadena contable sola
-- son 21 migraciones, ver compras_flujo/run.sh) y lo que se prueba aquí es SOLO
-- la ACL. Mismo patrón que compras_flujo/fixture.sql (stub de
-- conta_puede_escribir).
--
-- Si una firma real cambiara, este fixture quedaría desalineado — pero la
-- migración 20260825010000 fallaría RUIDOSAMENTE al aplicarse a preview/prod
-- (to_regprocedure + REVOKE sobre firma inexistente), no en silencio.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 5 funciones trigger (nacen SIN revoke: grant implícito a PUBLIC) ────────
-- banco_tg_movimiento_ledger es la que se cablea a tg_smoke más abajo; su
-- cuerpo marca la fila para probar "el trigger dispara sin EXECUTE".
CREATE FUNCTION public.banco_tg_movimiento_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN NEW.marcado := true; RETURN NEW; END $$;

CREATE FUNCTION public.banco_tg_propagar_ledger_movimientos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN RETURN NEW; END $$;

CREATE FUNCTION public.conta_tg_linea_mismo_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN RETURN NEW; END $$;

CREATE FUNCTION public.fn_sincronizar_estado_personal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN RETURN COALESCE(NEW, OLD); END $$;

CREATE FUNCTION public.set_registros_project_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN RETURN NEW; END $$;

-- ── 3 helpers de policies RLS ────────────────────────────────────────────────
-- 20260814000000 no tocó ACLs: nacen abiertas vía PUBLIC.
CREATE FUNCTION public.can_access_conversation_project(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT true $$;

CREATE FUNCTION public.is_conversation_assigned_to_me(p_conversation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT false $$;

-- 20260818000000:38-39 TAL CUAL — la ACL exacta que esa migración dejó en prod:
-- GRANT a authenticated y un REVOKE FROM anon SIN PUBLIC (la causa raíz del
-- P1: anon sigue heredando EXECUTE del grant implícito a PUBLIC).
CREATE FUNCTION public.conta_puede_escribir(p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT true $$;
GRANT EXECUTE ON FUNCTION public.conta_puede_escribir(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.conta_puede_escribir(text) FROM anon;

-- ── Tabla de humo para "el trigger dispara sin EXECUTE" ─────────────────────
CREATE TABLE public.tg_smoke (
  id      int,
  marcado boolean NOT NULL DEFAULT false
);
CREATE TRIGGER tg_smoke_marca
  BEFORE INSERT ON public.tg_smoke
  FOR EACH ROW EXECUTE FUNCTION public.banco_tg_movimiento_ledger();

-- ── Helper de aserción (patrón de la casa) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.chk(actual bigint, esperado bigint, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '❌ %  → obtenido %, esperado %', msg, actual, esperado;
  END IF;
  RAISE NOTICE 'OK    %', msg;
END $$;
