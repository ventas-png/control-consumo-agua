-- Lo que 20261130000000_agua_historial_lecturas necesita además del fixture de
-- registrar_lectura (tenancy, padrón de agua, helpers de RLS y la RLS real de
-- `registros`):
--   · `sellar_actor()`     — copia literal de 20260731000000_trazabilidad_creado_por.sql
--   · `touch_updated_at()` — copia literal de 20260528000030
--   · RLS de `contadores` reducida a lo que la importación ejerce: la ve su
--     empresa; la edita la dueña / un admin, o quien tiene `agua.contadores.edit`
--     en un proyecto a su alcance (forma de 20260521000003 + 20260815000000).
--   · dos contadores con el MISMO número de serie (ambigüedad) y una lectura
--     del sistema en M-3 (contador que ya tiene lecturas).

-- `sellar_actor()`: COPIA LITERAL de 20260731000000_trazabilidad_creado_por.sql
CREATE OR REPLACE FUNCTION public.sellar_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_col  text := TG_ARGV[0];
  v_modo text := COALESCE(TG_ARGV[1], 'forzar');
  v_uid  uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL AND (v_modo = 'forzar' OR to_jsonb(NEW)->>v_col IS NULL) THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object(v_col, v_uid));
    END IF;
  ELSE
    -- INMUTABLE. Solo se reescribe si alguien intentó cambiarla, para no pagar
    -- el jsonb_populate_record en cada UPDATE normal.
    IF to_jsonb(NEW)->>v_col IS DISTINCT FROM to_jsonb(OLD)->>v_col THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object(v_col, to_jsonb(OLD)->>v_col));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- `touch_updated_at()`: COPIA LITERAL de 20260528000030
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ── RLS de contadores ───────────────────────────────────────────────────────
ALTER TABLE public.contadores ENABLE ROW LEVEL SECURITY;

CREATE POLICY contadores_select ON public.contadores
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR company_id = (SELECT public.get_my_company_id()));

CREATE POLICY contadores_update ON public.contadores
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = (SELECT public.get_my_company_id())
        AND public.can_access_project(project_id)
        AND (public.current_user_role() = ANY (ARRAY['admin','company_owner'])
             OR public.user_has_permission('agua.contadores.edit')))
  )
  WITH CHECK (public.is_super_admin() OR company_id = (SELECT public.get_my_company_id()));

-- ── Datos extra ─────────────────────────────────────────────────────────────
-- DUP-7 · dos contadores con el mismo número en Condominio Uno.
INSERT INTO public.contadores (id, project_id, company_id, unidad_id, tarifa_id, numero_serie, lectura_inicial, fecha_instalacion, activo) VALUES
  ('c0000000-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', NULL, NULL, 'DUP-7', 0, NULL, true),
  ('c0000000-0000-0000-0000-00000000000b', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', NULL, NULL, 'dup-7 ', 0, NULL, true);

-- M-3 ya tiene una lectura del sistema: su base es esa lectura, no lectura_inicial.
INSERT INTO public.registros (id, contador_id, project_id, fecha, lectura_anterior, lectura_actual, consumo, estado) VALUES
  ('a0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001',
   '2026-03-15 12:00-06', 0, 50, 50, 'pendiente');
