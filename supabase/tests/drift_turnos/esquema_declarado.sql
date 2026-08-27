-- ════════════════════════════════════════════════════════════════════════════
-- Las tres tablas tal como las DECLARA el repositorio
-- ════════════════════════════════════════════════════════════════════════════
-- Es el escenario opuesto a pre_produccion.sql: aquí los nombres ya son los
-- correctos, como en cualquier entorno construido desde supabase/migrations —
-- el sandbox de los E2E, el Preview de Supabase, un restore.
--
-- Sirve para probar la afirmación más frágil de la cabecera de 20260906000000:
-- que ahí es un NO-OP. Si no lo fuera, la migración rompería precisamente los
-- entornos que sí están sanos.

CREATE TABLE public.amenidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  nombre text NOT NULL
);

-- 20260425000002, con `notas` y `created_by`.
CREATE TABLE public.amenidades_bloqueos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id)  ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES public.projects(id)   ON DELETE CASCADE,
  amenidad_id  uuid NOT NULL REFERENCES public.amenidades(id) ON DELETE CASCADE,
  fecha_inicio date NOT NULL,
  fecha_fin    date NOT NULL,
  hora_inicio  time,
  hora_fin     time,
  motivo       text NOT NULL DEFAULT 'mantenimiento',
  notas        text,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 20260424000060:18, con `cerrado_en` y `puntaje_completitud`.
-- El fixture compartido de limpieza_catalogos crea `bloques_turno` y
-- `tareas_bloque` con la forma DECLARADA desde 20260907000000, que las necesita
-- para probar el re-apuntado de FKs. Aquí hacen falta con OTRA forma, así que
-- se reemplazan: quedarse con las del fixture dejaría este sandbox probando el
-- escenario contrario al que dice reproducir.
DROP TABLE IF EXISTS public.tareas_bloque;
DROP TABLE IF EXISTS public.bloques_turno;

CREATE TABLE public.bloques_turno (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id),
  project_id          uuid NOT NULL REFERENCES public.projects(id),
  personal_id         uuid NOT NULL REFERENCES public.personal_condominio(id),
  turno               text NOT NULL DEFAULT 'manana',
  fecha               date NOT NULL,
  estado              text NOT NULL DEFAULT 'pendiente',
  iniciado_en         timestamptz,
  cerrado_en          timestamptz,
  puntaje_completitud int,
  creado_por          uuid,
  notas               text,
  created_at          timestamptz DEFAULT now()
);

-- 20260424000060:35, con `completada_en` y `foto_urls`.
CREATE TABLE public.tareas_bloque (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bloque_id       uuid NOT NULL REFERENCES public.bloques_turno(id) ON DELETE CASCADE,
  plantilla_id    uuid REFERENCES public.plantillas_tarea_cargo(id),
  titulo          text NOT NULL,
  descripcion     text,
  area_id         uuid REFERENCES public.areas_condominio(id),
  orden           int  NOT NULL DEFAULT 0,
  requiere_foto   boolean NOT NULL DEFAULT false,
  estado          text NOT NULL DEFAULT 'pendiente',
  completada_en   timestamptz,
  evidencia_texto text,
  foto_urls       jsonb NOT NULL DEFAULT '[]',
  notas_operativo text,
  created_at      timestamptz DEFAULT now()
);

INSERT INTO public.personal_condominio (id, company_id, project_id, nombre) VALUES
  ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'Ana Conserje');

INSERT INTO public.bloques_turno (id, company_id, project_id, personal_id, fecha, cerrado_en, puntaje_completitud) VALUES
  ('e2000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   DATE '2026-08-01', TIMESTAMPTZ '2026-08-01 18:00Z', 75);

INSERT INTO public.tareas_bloque (id, bloque_id, titulo, foto_urls, completada_en) VALUES
  ('e3000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001',
   'Limpiar el salón', '["a.jpg","b.jpg"]'::jsonb, TIMESTAMPTZ '2026-08-01 10:00Z');
