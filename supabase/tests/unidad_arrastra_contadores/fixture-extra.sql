-- Lo que 20261204000000_unidad_proyecto_arrastra_contadores necesita además del
-- fixture de registrar_lectura + el de historial_lecturas, y de las migraciones
-- 20260522000001 (contador ← unidad) y 20261130000000 (historial), ya aplicadas:
--   · `unidades.company_id` (en producción existe; el fixture base no la trae)
--   · RLS de `unidades` reducida a «la ve y la edita su empresa»: basta para
--     ejercer a alguien que mueve una unidad SIN poder editar contadores
--   · el desfase que la migración corrige: una unidad movida de proyecto ANTES
--     de que existiera el arrastre, con su contador (y su historial) atrás.

ALTER TABLE public.unidades ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
UPDATE public.unidades u SET company_id = p.company_id FROM public.projects p WHERE p.id = u.project_id;

ALTER TABLE public.unidades ENABLE ROW LEVEL SECURITY;
CREATE POLICY unidades_select ON public.unidades
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR company_id = (SELECT public.get_my_company_id()));
CREATE POLICY unidades_update ON public.unidades
  FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR company_id = (SELECT public.get_my_company_id()))
  WITH CHECK (public.is_super_admin() OR company_id = (SELECT public.get_my_company_id()));

-- Casa 3 nace en Condominio Uno con el contador M-6 y dos filas de historial…
INSERT INTO public.unidades (id, project_id, company_id, cliente_id, nombre) VALUES
  ('d1000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', NULL, 'Casa 3');
INSERT INTO public.contadores (id, project_id, company_id, unidad_id, tarifa_id, numero_serie, lectura_inicial, fecha_instalacion, activo) VALUES
  ('c0000000-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a',
   'd1000000-0000-0000-0000-000000000003', NULL, 'M-6', 0, NULL, true);
INSERT INTO public.agua_historial_lecturas (contador_id, fecha, lectura) VALUES
  ('c0000000-0000-0000-0000-000000000006', '2025-10-31', 10),
  ('c0000000-0000-0000-0000-000000000006', '2025-11-30', 22);
-- …y se mueve a Condominio Dos: sin el arrastre, M-6 y su historial se quedan en Uno.
UPDATE public.unidades SET project_id = '11111111-0000-0000-0000-000000000002'
 WHERE id = 'd1000000-0000-0000-0000-000000000003';

-- Historial de los contadores de trabajo (todos en Condominio Uno).
INSERT INTO public.agua_historial_lecturas (contador_id, fecha, lectura) VALUES
  ('c0000000-0000-0000-0000-000000000002', '2025-12-31', 5),
  ('c0000000-0000-0000-0000-000000000003', '2025-12-31', 6),
  ('c0000000-0000-0000-0000-000000000004', '2025-12-31', 7);
