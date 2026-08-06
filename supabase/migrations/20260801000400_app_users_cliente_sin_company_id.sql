-- ════════════════════════════════════════════════════════════════════════════
-- `app_users.company_id` en cuentas de cliente: invariante explícita y forzada.
--
-- CONTEXTO
-- Al arreglar comunicados/difusión (20260801000300) salió que las cuentas de
-- cliente tienen `company_id` NULL: ni `create-cliente-account` ni
-- `complete-oauth-onboarding` lo escriben. La reacción intuitiva —"rellenémoslo
-- y se arreglan las policies"— es EXACTAMENTE lo contrario de lo que hay que
-- hacer, y esta migración existe para dejarlo cerrado.
--
-- POR QUÉ NO SE RELLENA
-- Un montón de policies usan `company_id` como rama de STAFF **sin mirar el
-- rol**. Ejemplo vivo y reciente — `20260801000100_chat_mensaje_portal.sql:69`:
--
--     OR EXISTS (SELECT 1 FROM mensajes_portal m
--                 WHERE m.id = comentarios_mensaje_portal.mensaje_id
--                   AND m.company_id = get_my_company_id())     ← staff
--     OR (es_interno = false AND …)                             ← residente
--
-- La rama de residente filtra `es_interno = false` a propósito. Si el residente
-- trajera `company_id`, pasaría por la rama de ARRIBA y leería los comentarios
-- INTERNOS de todos los hilos de la empresa. El mismo patrón se repite en
-- `mensajes_portal`, `conversations`/`conversation_messages` y decenas más: la
-- separación residente/staff descansa, sin decirlo, en que el cliente no tenga
-- company_id.
--
-- Es decir: `company_id IS NULL` en una cuenta de cliente NO es un dato faltante
-- que haya que completar — es la frontera de privilegio. Y además es ambiguo:
-- un cliente puede estar ligado a VARIAS empresas vía `company_clientes`.
--
-- QUÉ HACE
--   1. Normaliza las filas que se hayan desviado (`create-user` acepta hoy
--      `role: 'cliente'` con company_id si quien llama es super_admin; este PR
--      también cierra ese hueco en el edge).
--   2. Un trigger BEFORE INSERT/UPDATE mantiene la invariante. Se elige trigger
--      —y no CHECK— por la misma razón que `fn_set_recipient_company_id`: se
--      auto-sana y no puede romper un deploy ni un alta por un writer que aún
--      no conozcamos.
--
-- La empresa de un cliente se resuelve SIEMPRE por su vínculo: `company_clientes`
-- (portal de agua) o el proyecto de sus unidades (portal de condominios).
-- Idempotente.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Normalizar el drift existente (con reporte, no silencioso) ───────────
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n
  FROM public.app_users
  WHERE role = 'cliente' AND company_id IS NOT NULL;

  IF n > 0 THEN
    UPDATE public.app_users SET company_id = NULL
    WHERE role = 'cliente' AND company_id IS NOT NULL;
    RAISE WARNING 'app_users: % cuenta(s) de cliente traían company_id; se normalizaron a NULL (tenían acceso de staff a las policies sin guard de rol).', n;
  ELSE
    RAISE NOTICE 'app_users: ninguna cuenta de cliente traía company_id; nada que normalizar.';
  END IF;
END $$;

-- ── 2. Mantenerla ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_cliente_sin_company_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'cliente' AND NEW.company_id IS NOT NULL THEN
    NEW.company_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_cliente_sin_company_id() FROM public, anon;

DROP TRIGGER IF EXISTS trg_cliente_sin_company_id ON public.app_users;
CREATE TRIGGER trg_cliente_sin_company_id
  BEFORE INSERT OR UPDATE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.fn_cliente_sin_company_id();

COMMENT ON FUNCTION public.fn_cliente_sin_company_id() IS
  'Fuerza company_id = NULL en las cuentas con role = cliente. No es higiene de datos: es la frontera de privilegio de la que dependen las ramas de staff que sólo miran company_id (ver 20260801000400).';

COMMENT ON COLUMN public.app_users.company_id IS
  'Empresa del usuario de STAFF. SIEMPRE NULL para role = cliente — la empresa de un cliente se resuelve por company_clientes o por el proyecto de sus unidades, y darle company_id lo colaría por las ramas de staff de las policies. Lo mantiene trg_cliente_sin_company_id.';
