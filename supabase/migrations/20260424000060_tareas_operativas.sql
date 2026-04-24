-- Plantillas de tarea por cargo: tareas predefinidas reutilizables por puesto
CREATE TABLE plantillas_tarea_cargo (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  project_id  uuid NOT NULL REFERENCES projects(id),
  cargo       text NOT NULL,          -- 'limpieza' | 'mantenimiento' | 'jardinería' | etc.
  titulo      text NOT NULL,
  descripcion text,
  icono       text NOT NULL DEFAULT '✅',
  orden       int  NOT NULL DEFAULT 0,
  area_id     uuid REFERENCES areas_condominio(id),
  requiere_foto boolean NOT NULL DEFAULT false,
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

-- Bloques de turno: trabajo asignado a un empleado operativo
CREATE TABLE bloques_turno (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id),
  project_id          uuid NOT NULL REFERENCES projects(id),
  personal_id         uuid NOT NULL REFERENCES personal_condominio(id),
  turno               text NOT NULL DEFAULT 'manana',  -- 'manana' | 'tarde' | 'noche'
  fecha               date NOT NULL,
  estado              text NOT NULL DEFAULT 'pendiente',  -- 'pendiente' | 'en_curso' | 'completado' | 'incompleto'
  iniciado_en         timestamptz,
  cerrado_en          timestamptz,
  puntaje_completitud int,            -- % 0-100, calculado al cerrar
  creado_por          uuid REFERENCES app_users(id),
  notas               text,
  created_at          timestamptz DEFAULT now()
);

-- Tareas individuales dentro de un bloque
CREATE TABLE tareas_bloque (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bloque_id         uuid NOT NULL REFERENCES bloques_turno(id) ON DELETE CASCADE,
  plantilla_id      uuid REFERENCES plantillas_tarea_cargo(id),
  titulo            text NOT NULL,
  descripcion       text,
  area_id           uuid REFERENCES areas_condominio(id),
  orden             int  NOT NULL DEFAULT 0,
  requiere_foto     boolean NOT NULL DEFAULT false,
  estado            text NOT NULL DEFAULT 'pendiente',  -- 'pendiente' | 'completada' | 'con_observacion' | 'omitida'
  completada_en     timestamptz,
  evidencia_texto   text,
  foto_urls         jsonb NOT NULL DEFAULT '[]',
  notas_operativo   text,
  created_at        timestamptz DEFAULT now()
);

-- Revisión del administrador sobre tareas completadas
CREATE TABLE revisiones_tarea (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarea_id     uuid NOT NULL REFERENCES tareas_bloque(id) ON DELETE CASCADE,
  bloque_id    uuid NOT NULL REFERENCES bloques_turno(id),
  revisado_por uuid NOT NULL REFERENCES app_users(id),
  estado       text NOT NULL DEFAULT 'pendiente',  -- 'aprobado' | 'rechazado' | 'pendiente'
  comentario   text,
  revisado_en  timestamptz DEFAULT now(),
  created_at   timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE plantillas_tarea_cargo ENABLE ROW LEVEL SECURITY;
ALTER TABLE bloques_turno           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tareas_bloque           ENABLE ROW LEVEL SECURITY;
ALTER TABLE revisiones_tarea        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_rw_plantillas_cargo" ON plantillas_tarea_cargo
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "company_rw_bloques_turno" ON bloques_turno
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "company_rw_tareas_bloque" ON tareas_bloque
  USING (EXISTS (SELECT 1 FROM bloques_turno b WHERE b.id = bloque_id AND b.company_id = get_my_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM bloques_turno b WHERE b.id = bloque_id AND b.company_id = get_my_company_id()));

CREATE POLICY "company_rw_revisiones_tarea" ON revisiones_tarea
  USING (EXISTS (SELECT 1 FROM bloques_turno b WHERE b.id = bloque_id AND b.company_id = get_my_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM bloques_turno b WHERE b.id = bloque_id AND b.company_id = get_my_company_id()));

-- Índices
CREATE INDEX IF NOT EXISTS idx_plantillas_cargo_project ON plantillas_tarea_cargo(project_id, company_id, cargo);
CREATE INDEX IF NOT EXISTS idx_bloques_turno_project    ON bloques_turno(project_id, company_id, fecha);
CREATE INDEX IF NOT EXISTS idx_bloques_turno_personal   ON bloques_turno(personal_id, fecha);
CREATE INDEX IF NOT EXISTS idx_tareas_bloque_bloque     ON tareas_bloque(bloque_id, orden);
CREATE INDEX IF NOT EXISTS idx_revisiones_tarea_bloque  ON revisiones_tarea(bloque_id);
