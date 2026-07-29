-- Fixture mínimo: reproduce las columnas relevantes del esquema real para poder
-- EJECUTAR la migración 20260729000600 contra un Postgres de verdad.
CREATE TABLE public.companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE
);
CREATE TABLE public.unidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE
);

-- ── padres (todos con project_id NOT NULL, como en producción) ──
CREATE TABLE public.caja_chica (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE
);
CREATE TABLE public.planes_pago_condominio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE
);
CREATE TABLE public.amenidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE
);
CREATE TABLE public.suministros_condominio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE
);
CREATE TABLE public.eventos_comunidad (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE
);

-- ── hijas: EXACTAMENTE como están hoy en prod (sin project_id) ──
CREATE TABLE public.movimientos_caja (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  caja_id uuid NOT NULL REFERENCES public.caja_chica(id) ON DELETE CASCADE,
  tipo text NOT NULL, concepto text NOT NULL, monto numeric(12,2) NOT NULL,
  fecha date NOT NULL DEFAULT CURRENT_DATE
);
CREATE TABLE public.cuotas_plan_pago (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.planes_pago_condominio(id) ON DELETE CASCADE,
  numero int NOT NULL, monto numeric(12,2) NOT NULL,
  fecha_vencimiento date NOT NULL,
  UNIQUE (plan_id, numero)
);
CREATE TABLE public.reservas_amenidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  amenidad_id uuid NOT NULL REFERENCES public.amenidades(id) ON DELETE CASCADE,
  unidad_id uuid NOT NULL REFERENCES public.unidades(id) ON DELETE CASCADE,
  fecha date NOT NULL, hora_inicio time NOT NULL, hora_fin time NOT NULL
);
CREATE TABLE public.movimientos_suministro (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  suministro_id uuid NOT NULL REFERENCES public.suministros_condominio(id) ON DELETE CASCADE,
  tipo text NOT NULL DEFAULT 'salida', cantidad numeric(10,2) NOT NULL,
  fecha date NOT NULL DEFAULT CURRENT_DATE
);
CREATE TABLE public.registro_asistentes_evento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  evento_id uuid NOT NULL REFERENCES public.eventos_comunidad(id) ON DELETE CASCADE,
  unidad_id uuid NOT NULL REFERENCES public.unidades(id) ON DELETE CASCADE,
  nombre text NOT NULL, num_personas int NOT NULL DEFAULT 1,
  UNIQUE (evento_id, unidad_id)
);

-- ── datos: 1 empresa, DOS proyectos (el caso multi-condominio del hallazgo) ──
INSERT INTO public.companies (id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000002');  -- segundo tenant, para el cross-tenant

INSERT INTO public.projects (id, company_id) VALUES
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('33333333-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002');

INSERT INTO public.unidades (id, company_id) VALUES
  ('dd111111-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001');

-- padres: uno en cada proyecto de la empresa A, y uno en la empresa B
INSERT INTO public.caja_chica (id, company_id, project_id) VALUES
  ('ca111111-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001'),
  ('ca222222-0000-0000-0000-000000000002'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002'),
  ('ca333333-0000-0000-0000-000000000003'::uuid, 'bbbbbbbb-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000003');

INSERT INTO public.planes_pago_condominio (id, company_id, project_id) VALUES
  ('d1111111-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001'),
  ('d2222222-0000-0000-0000-000000000002'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002');

INSERT INTO public.amenidades (id, company_id, project_id) VALUES
  ('aa111111-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001');

INSERT INTO public.suministros_condominio (id, company_id, project_id) VALUES
  ('5b111111-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002');

INSERT INTO public.eventos_comunidad (id, company_id, project_id) VALUES
  ('ef111111-0000-0000-0000-000000000001'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001');

-- filas hijas PREEXISTENTES, repartidas entre los dos proyectos: son las que
-- el backfill debe rellenar correctamente.
INSERT INTO public.movimientos_caja (company_id, caja_id, tipo, concepto, monto) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'ca111111-0000-0000-0000-000000000001', 'ingreso', 'proyecto 1', 100.00),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'ca222222-0000-0000-0000-000000000002', 'egreso',  'proyecto 2', 50.00),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'ca333333-0000-0000-0000-000000000003', 'ingreso', 'otro tenant', 7.00);

INSERT INTO public.cuotas_plan_pago (company_id, plan_id, numero, monto, fecha_vencimiento) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'd1111111-0000-0000-0000-000000000001', 1, 250.00, '2026-08-01'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'd2222222-0000-0000-0000-000000000002', 1, 300.00, '2026-08-01');

INSERT INTO public.reservas_amenidades (company_id, amenidad_id, unidad_id, fecha, hora_inicio, hora_fin) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aa111111-0000-0000-0000-000000000001', 'dd111111-0000-0000-0000-000000000001', '2026-08-05', '10:00', '12:00');

INSERT INTO public.movimientos_suministro (company_id, suministro_id, cantidad) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '5b111111-0000-0000-0000-000000000001', 3.00);

INSERT INTO public.registro_asistentes_evento (company_id, evento_id, unidad_id, nombre) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'ef111111-0000-0000-0000-000000000001', 'dd111111-0000-0000-0000-000000000001', 'Ana');
