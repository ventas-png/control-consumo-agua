-- ════════════════════════════════════════════════════════════════════════════
-- Lo que `actividad_equipo` necesita para poder EJECUTARSE
-- ════════════════════════════════════════════════════════════════════════════
-- La RPC agrega catorce fuentes en un UNION ALL. Para probar la rama de
-- `tareas_bloque` hay que poder llamarla, y para llamarla tienen que existir
-- las otras trece: plpgsql resuelve la consulta ENTERA en la primera ejecución,
-- así que una tabla ausente da el mismo 42703 que la columna que buscamos y el
-- sandbox no distinguiría una cosa de la otra.
--
-- Se cargan antes:
--   · supabase/tests/limpieza_catalogos/fixture.sql — identidad (auth.uid,
--     app_users, get_my_company_id, current_user_role, is_super_admin),
--     `sellar_cierre()` copiado literal de 20260731000000, y
--     `programacion_limpieza`.
--   · supabase/tests/drift_turnos/esquema_declarado.sql — `bloques_turno` y
--     `tareas_bloque` TAL COMO LOS DECLARA el repositorio: con `completada_en`
--     y SIN `completado_por`, que es justo el desacuerdo que se está cerrando.
--
-- Aquí van las once tablas restantes, con las columnas que la RPC toca y nada
-- más. Ninguna lleva datos en la ventana medida: si la RPC contara algo de
-- ellas, el conteo dejaría de ser atribuible a la tarea de turno.

-- ── Las otras trece fuentes del UNION ALL ───────────────────────────────────
-- `programacion_limpieza` viene del fixture compartido, pero le falta la
-- columna de autor: la agrega el bucle dinámico de 20260731000000, que ningún
-- fixture reproduce. La RPC la lee, así que sin ella el 42703 saldría por otro
-- lado y la negativa de este sandbox probaría otra cosa.
ALTER TABLE public.programacion_limpieza
  ADD COLUMN IF NOT EXISTS ejecutado_por uuid;

CREATE TABLE public.registros (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  creado_por uuid,
  consumo    numeric,
  fecha      date NOT NULL,
  deleted_at timestamptz
);

CREATE TABLE public.servicios_housekeeping (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  creado_por uuid,
  fecha      date NOT NULL
);

CREATE TABLE public.checklist_areas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  creado_por uuid,
  fecha      date NOT NULL
);

CREATE TABLE public.bitacora_manto (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  creado_por uuid,
  fecha      date NOT NULL
);

CREATE TABLE public.rondas_seguridad (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  creado_por uuid,
  inicio     timestamptz
);

CREATE TABLE public.visitas_control (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ronda_id     uuid NOT NULL REFERENCES public.rondas_seguridad(id),
  visitado_por uuid,
  visitado_en  timestamptz
);

CREATE TABLE public.visitantes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES public.projects(id),
  registrado_por  uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.paquetes_recibidos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  creado_por uuid,
  clase      text NOT NULL DEFAULT 'paquete',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.solicitudes_residente (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  creado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.solicitudes_concierge (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  creado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.tareas_condominio (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id),
  cerrado_por   uuid,
  fecha_cierre  date
);

CREATE TABLE public.bitacora_acciones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  usuario_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── La tarea que se va a completar durante la prueba ─────────────────────────
-- `esquema_declarado.sql` ya dejó el bloque e2…01 y una tarea e3…01 con
-- `completada_en` puesta y sin sello. Esa NO debe contarse: la RPC exige
-- `completado_por IS NOT NULL`, y así se comprueba que el conteo viene del
-- sello y no de la fecha suelta.
INSERT INTO public.tareas_bloque (id, bloque_id, titulo) VALUES
  ('e3000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001',
   'Trapear el vestíbulo');
