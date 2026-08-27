-- ════════════════════════════════════════════════════════════════════════════
-- Las tres tablas de turnos y amenidades, con la FORMA REAL DE PRODUCCIÓN
-- ════════════════════════════════════════════════════════════════════════════
-- El fixture de limpieza_catalogos monta companies, projects, auth.users,
-- personal_condominio, areas_condominio y plantillas_tarea_cargo; aquí se
-- agregan sólo las que faltan, y NO como las declara 20260424000060 sino como
-- están de verdad en producción, que es lo que hay que reproducir:
--
--   bloques_turno       tiene `finalizado_en`, NO `cerrado_en` ni `puntaje_completitud`
--   tareas_bloque       tiene `completado_en` y `foto_url` (text singular),
--                       NO `completada_en`, `foto_urls`, `plantilla_id`,
--                       `requiere_foto`, `evidencia_texto` ni `notas_operativo`
--   amenidades_bloqueos NO tiene `notas` ni `created_by`
--
-- La forma se estableció con dos fuentes independientes que coinciden: la
-- consulta de catálogo contra producción del run 33107076122, y el snapshot de
-- src/types/database.types.ts generado con `npm run gen:db-types`.

CREATE TABLE public.amenidades (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  nombre     text NOT NULL
);

-- Sin `notas` ni `created_by`: es el 400 visible de AmenidadesTab.
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
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- `finalizado_en` en vez de `cerrado_en`, y sin `puntaje_completitud`.
-- El fixture compartido de limpieza_catalogos crea `bloques_turno` y
-- `tareas_bloque` con la forma DECLARADA desde 20260907000000, que las necesita
-- para probar el re-apuntado de FKs. Aquí hacen falta con OTRA forma, así que
-- se reemplazan: quedarse con las del fixture dejaría este sandbox probando el
-- escenario contrario al que dice reproducir.
DROP TABLE IF EXISTS public.tareas_bloque;
DROP TABLE IF EXISTS public.bloques_turno;

CREATE TABLE public.bloques_turno (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id),
  project_id    uuid NOT NULL REFERENCES public.projects(id),
  personal_id   uuid NOT NULL REFERENCES public.personal_condominio(id),
  turno         text NOT NULL DEFAULT 'manana',
  fecha         date NOT NULL,
  estado        text NOT NULL DEFAULT 'pendiente',
  iniciado_en   timestamptz,
  finalizado_en timestamptz,
  creado_por    uuid,
  notas         text,
  created_at    timestamptz DEFAULT now()
);

-- `completado_en` (masculino) y `foto_url` (text singular).
CREATE TABLE public.tareas_bloque (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bloque_id     uuid NOT NULL REFERENCES public.bloques_turno(id) ON DELETE CASCADE,
  titulo        text NOT NULL,
  descripcion   text,
  area_id       uuid REFERENCES public.areas_condominio(id),
  orden         int  DEFAULT 0,
  icono         text,
  estado        text NOT NULL DEFAULT 'pendiente',
  completado_en timestamptz,
  foto_url      text,
  created_at    timestamptz DEFAULT now()
);

-- ── Padrón ──────────────────────────────────────────────────────────────────
-- El fixture de limpieza_catalogos crea `personal_condominio` pero no siembra
-- filas; el bloque de turno necesita una.
INSERT INTO public.personal_condominio (id, company_id, project_id, nombre) VALUES
  ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'Ana Conserje');

INSERT INTO public.amenidades (id, company_id, project_id, nombre) VALUES
  ('e1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'Salón social');

INSERT INTO public.bloques_turno (id, company_id, project_id, personal_id, fecha, estado) VALUES
  ('e2000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   DATE '2026-08-01', 'en_curso');

-- Dos tareas: una CON foto (para comprobar que el dato sobrevive a la
-- conversión a jsonb) y otra sin ella (que tiene que quedar en `[]`).
INSERT INTO public.tareas_bloque (id, bloque_id, titulo, estado, foto_url, completado_en) VALUES
  ('e3000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001',
   'Limpiar el salón', 'completada', 'p1/turnos/foto1.jpg', TIMESTAMPTZ '2026-08-01 10:00Z'),
  ('e3000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001',
   'Revisar luminarias', 'pendiente', NULL, NULL);
