-- ════════════════════════════════════════════════════════════════════════════
-- Auditoría 2026-07-28 · Bloque E · PR-27
-- `project_id` en las 5 tablas hijas de condominio que solo tenían `company_id`
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL PROBLEMA
-- `sectionData.ts` carga ~140 colecciones del panel de Condominios y TODAS
-- filtran `.eq('project_id', pid).eq('company_id', cid)` … salvo cinco, que
-- filtran solo por empresa, porque su tabla no tiene la columna:
--
--   reservas_amenidades        (sectionData.ts:53 y :76)
--   registro_asistentes_evento (:131)
--   movimientos_caja           (:133)
--   cuotas_plan_pago           (:136)
--   movimientos_suministro     (:159)
--
-- En un tenant con UN condominio no se nota. En uno con varios, cada proyecto
-- muestra los movimientos de caja, las cuotas de plan de pago, las reservas de
-- amenidades, los movimientos de inventario y los asistentes a eventos de TODOS
-- los condominios de la empresa. Dos de esas tablas son dinero
-- (`movimientos_caja`, `cuotas_plan_pago`).
--
-- ALCANCE HONESTO: esto NO es fuga cross-tenant — `company_id = get_my_company_id()`
-- sigue acotando por empresa en las policies, y el proyecto no es (en ningún
-- lugar de este esquema) una frontera de RLS: el scoping por proyecto es de
-- aplicación. Es mezcla de proyectos DENTRO de la empresa. Se corrige en el
-- mismo idioma que usan las otras ~135 colecciones, en vez de inventar un
-- filtro distinto solo para estas cinco.
--
-- POR QUÉ UNA COLUMNA Y NO UN FILTRO POR EL PADRE
-- Las cinco son tablas HIJAS, y su padre ya tiene `project_id NOT NULL`:
--
--   movimientos_caja            → caja_chica              (caja_id)
--   cuotas_plan_pago            → planes_pago_condominio  (plan_id)
--   reservas_amenidades         → amenidades              (amenidad_id)
--   movimientos_suministro      → suministros_condominio  (suministro_id)
--   registro_asistentes_evento  → eventos_comunidad       (evento_id)
--
-- O sea que el dato ya existe y el backfill es EXACTO, no una conjetura. Se
-- podría filtrar por el embed del padre, pero esa vía es más frágil: en
-- PostgREST, filtrar por una columna embebida NO filtra las filas de arriba a
-- menos que el embed sea `!inner`, y basta olvidar el `!inner` para que el
-- filtro no haga nada en silencio. La columna denormalizada usa el mismo
-- `.eq('project_id', pid)` que el resto del archivo y es indexable.
--
-- POR QUÉ UN TRIGGER Y NO TOCAR LOS INSERTS
-- Los ~6 sitios que escriben estas tablas lo hacen por helpers genéricos
-- (`createCondominioRow(tabla, payload)`) y ninguno arma `project_id`. Pedirle
-- a cada call site que lo mande es justo la clase de requisito que se pierde
-- por omisión — la lección de PR-4, donde un `CREATE OR REPLACE` borró un guard
-- copiado a mano. El trigger lo DERIVA del padre y además IGNORA lo que mande
-- el cliente, así que una fila inconsistente es imposible de construir.
--
-- EFECTO SECUNDARIO DE ENDURECIMIENTO (real, pero acotado)
-- Hoy `movimientos_caja` acepta un INSERT con `company_id` propio y `caja_id` de
-- OTRO tenant: el WITH CHECK solo mira `company_id`, y las FK no pasan por RLS.
-- Eso no divulga nada (la fila queda con el company_id del atacante y la víctima
-- no la ve), pero sí ensucia la integridad referencial entre tenants. El trigger
-- compara `padre.company_id` contra `NEW.company_id` y rechaza el desajuste. No
-- es la motivación del PR; se anota porque es un cambio de comportamiento
-- observable.
--
-- Idempotente: se puede re-aplicar sin efecto.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Función de trigger, una sola para las cinco ──────────────────────────
-- Parametrizada por TG_ARGV = (tabla_padre, columna_fk) para no repetir cinco
-- cuerpos casi idénticos. `%I` (quote_ident) sobre ambos argumentos: los valores
-- son literales del CREATE TRIGGER de más abajo, nunca entrada de usuario, pero
-- se citan igual para que el patrón sea seguro por construcción.
--
-- POR QUÉ SECURITY DEFINER Y NO INVOKER
-- La versión INVOKER es tentadora —la RLS del padre bloquearía sola el caso
-- cross-tenant— pero acopla el WRITE de la hija a la VISIBILIDAD del padre, y
-- dos de los cinco padres condicionan su SELECT a un permiso de pestaña:
--
--   amenidades_select              … AND user_has_permission('condominios.tab.amenidades')
--   planes_pago_condominio_select  … AND user_has_permission('condominios.tab.plan_pago')
--
-- Con INVOKER, un usuario sin ese permiso vería su INSERT rechazado por una
-- razón que no tiene nada que ver con lo que está escribiendo, y el fallo sería
-- difícil de diagnosticar. DEFINER lee el padre siempre, y la invariante de
-- tenant se comprueba EXPLÍCITAMENTE (`padre.company_id <> NEW.company_id`), que
-- además es más fuerte: no depende de cómo estén escritas las policies del padre
-- hoy ni de cómo las reescriban mañana.
--
-- `SET search_path` es obligatorio en este repo para toda SECURITY DEFINER (206
-- funciones lo llevan; security-guard.mjs lo vigila). La función no recibe
-- parámetros y no se concede a `authenticated`: solo se alcanza vía los triggers
-- de abajo, así que no amplía superficie de RPC.
CREATE OR REPLACE FUNCTION public.set_project_id_desde_padre()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_padre   text := TG_ARGV[0];
  v_fk      text := TG_ARGV[1];
  v_fk_val  uuid;
  v_project uuid;
  v_company uuid;
BEGIN
  EXECUTE format('SELECT ($1).%I', v_fk) INTO v_fk_val USING NEW;

  IF v_fk_val IS NULL THEN
    RAISE EXCEPTION '%.% no puede ser NULL', TG_TABLE_NAME, v_fk
      USING ERRCODE = 'not_null_violation';
  END IF;

  EXECUTE format('SELECT project_id, company_id FROM public.%I WHERE id = $1', v_padre)
    INTO v_project, v_company USING v_fk_val;

  IF v_project IS NULL THEN
    -- La FK ya cubre el caso "no existe"; esto lo hace explícito y deja un
    -- mensaje legible si alguien dropea la FK en el futuro.
    RAISE EXCEPTION 'No se encontró % con id=% al derivar project_id para %',
      v_padre, v_fk_val, TG_TABLE_NAME
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Invariante de tenant: la hija no puede colgar de un padre de otra empresa.
  IF NEW.company_id IS DISTINCT FROM v_company THEN
    RAISE EXCEPTION
      '% .company_id=% no coincide con %.company_id=% (id=%)',
      TG_TABLE_NAME, NEW.company_id, v_padre, v_company, v_fk_val
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Se IMPONE, no se respeta lo que venga del cliente: el padre es la verdad.
  NEW.project_id := v_project;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_project_id_desde_padre() IS
  'Deriva project_id de la tabla padre (TG_ARGV: tabla, columna_fk), ignora el valor del cliente y exige que company_id coincida con el del padre. Auditoría 2026-07-28 PR-27.';

-- ── 2. Columna + backfill + NOT NULL + índice + trigger, por tabla ──────────
-- El orden importa: la columna nace NULLABLE, se rellena desde el padre, y solo
-- entonces se pone NOT NULL. Al revés fallaría con filas existentes.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('movimientos_caja',           'caja_chica',             'caja_id'),
      ('cuotas_plan_pago',           'planes_pago_condominio', 'plan_id'),
      ('reservas_amenidades',        'amenidades',             'amenidad_id'),
      ('movimientos_suministro',     'suministros_condominio', 'suministro_id'),
      ('registro_asistentes_evento', 'eventos_comunidad',      'evento_id')
    ) AS v(hija, padre, fk)
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE',
      t.hija);

    -- Backfill exacto desde el padre (no hay conjetura: la FK es NOT NULL).
    EXECUTE format(
      'UPDATE public.%I h SET project_id = p.project_id FROM public.%I p WHERE h.%I = p.id AND h.project_id IS DISTINCT FROM p.project_id',
      t.hija, t.padre, t.fk);

    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN project_id SET NOT NULL', t.hija);

    -- Índice: el filtro nuevo de sectionData.ts es (project_id, company_id).
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I(project_id, company_id)',
      'idx_' || t.hija || '_project_company', t.hija);

    -- `UPDATE OF <fk>, project_id, company_id`: además del INSERT, cualquier
    -- intento de reapuntar el padre o de escribir project_id/company_id a mano
    -- vuelve a derivarlos del padre. Sin incluir project_id aquí, un UPDATE
    -- directo podría dejar la fila en otro proyecto y el trigger ni se enteraría.
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_project_id ON public.%I', t.hija);
    EXECUTE format(
      'CREATE TRIGGER trg_set_project_id BEFORE INSERT OR UPDATE OF %I, project_id, company_id ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.set_project_id_desde_padre(%L, %L)',
      t.fk, t.hija, t.padre, t.fk);
  END LOOP;
END $$;

-- ── 3. Verificación dentro de la propia migración ──────────────────────────
-- Dos comprobaciones con severidad DISTINTA a propósito:
--
--   project_id descuadrado → EXCEPTION. Lo acaba de escribir el backfill de esta
--     misma migración, así que un desajuste solo puede ser un bug de arriba: hay
--     que abortar y no dejar el esquema a medias.
--
--   company_id descuadrado → WARNING. Eso sería suciedad PREEXISTENTE (el hueco
--     cross-tenant que el trigger cierra de aquí en adelante). Abortar por datos
--     que esta migración no creó dejaría el deploy bloqueado sin vía de arreglo;
--     se reporta con el conteo para poder limpiarlo aparte. El trigger impide
--     que aparezcan nuevos.
DO $$
DECLARE
  t record;
  n bigint;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('movimientos_caja',           'caja_chica',             'caja_id'),
      ('cuotas_plan_pago',           'planes_pago_condominio', 'plan_id'),
      ('reservas_amenidades',        'amenidades',             'amenidad_id'),
      ('movimientos_suministro',     'suministros_condominio', 'suministro_id'),
      ('registro_asistentes_evento', 'eventos_comunidad',      'evento_id')
    ) AS v(hija, padre, fk)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I h JOIN public.%I p ON h.%I = p.id WHERE h.project_id <> p.project_id',
      t.hija, t.padre, t.fk) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'PR-27: % filas de % con project_id distinto al de su padre %', n, t.hija, t.padre;
    END IF;

    EXECUTE format(
      'SELECT count(*) FROM public.%I h JOIN public.%I p ON h.%I = p.id WHERE h.company_id IS DISTINCT FROM p.company_id',
      t.hija, t.padre, t.fk) INTO n;
    IF n > 0 THEN
      RAISE WARNING 'PR-27: % filas PREEXISTENTES de % cuelgan de un % de otra empresa — revisar (el trigger impide nuevas)',
        n, t.hija, t.padre;
    END IF;
  END LOOP;
END $$;
