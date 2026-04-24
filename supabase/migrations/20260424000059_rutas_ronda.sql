-- Áreas del condominio: zonas físicas definidas por proyecto
CREATE TABLE areas_condominio (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  project_id  uuid NOT NULL REFERENCES projects(id),
  nombre      text NOT NULL,
  descripcion text,
  icono       text NOT NULL DEFAULT '📍',
  orden       int  NOT NULL DEFAULT 0,
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

-- Rutas de ronda: plantilla con nombre y tiempo estimado
CREATE TABLE rutas_ronda (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id),
  project_id          uuid NOT NULL REFERENCES projects(id),
  nombre              text NOT NULL,
  descripcion         text,
  tiempo_estimado_min int,
  activo              boolean NOT NULL DEFAULT true,
  created_at          timestamptz DEFAULT now()
);

-- Puntos de control: áreas ordenadas que conforman una ruta
CREATE TABLE puntos_control_ruta (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ruta_id             uuid NOT NULL REFERENCES rutas_ronda(id) ON DELETE CASCADE,
  area_id             uuid NOT NULL REFERENCES areas_condominio(id),
  orden               int  NOT NULL DEFAULT 0,
  instrucciones       text,
  tiempo_estimado_min int,
  created_at          timestamptz DEFAULT now()
);

-- Visitas de control: ejecución de cada punto durante una ronda activa
CREATE TABLE visitas_control (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ronda_id    uuid NOT NULL REFERENCES rondas_seguridad(id) ON DELETE CASCADE,
  punto_id    uuid NOT NULL REFERENCES puntos_control_ruta(id),
  estado      text NOT NULL DEFAULT 'pendiente',  -- 'pendiente' | 'ok' | 'novedad' | 'omitido'
  notas       text,
  visitado_en timestamptz,
  created_at  timestamptz DEFAULT now()
);

-- Enlace de ronda con su ruta
ALTER TABLE rondas_seguridad ADD COLUMN IF NOT EXISTS ruta_id uuid REFERENCES rutas_ronda(id);

-- RLS
ALTER TABLE areas_condominio       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rutas_ronda            ENABLE ROW LEVEL SECURITY;
ALTER TABLE puntos_control_ruta    ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitas_control        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_rw_areas" ON areas_condominio
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "company_rw_rutas_ronda" ON rutas_ronda
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "company_rw_puntos_control" ON puntos_control_ruta
  USING  (EXISTS (SELECT 1 FROM rutas_ronda r WHERE r.id = ruta_id AND r.company_id = get_my_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM rutas_ronda r WHERE r.id = ruta_id AND r.company_id = get_my_company_id()));

CREATE POLICY "company_rw_visitas_control" ON visitas_control
  USING  (EXISTS (SELECT 1 FROM rondas_seguridad rs WHERE rs.id = ronda_id AND rs.company_id = get_my_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM rondas_seguridad rs WHERE rs.id = ronda_id AND rs.company_id = get_my_company_id()));

-- Índices
CREATE INDEX IF NOT EXISTS idx_areas_project         ON areas_condominio(project_id, company_id);
CREATE INDEX IF NOT EXISTS idx_rutas_project         ON rutas_ronda(project_id, company_id);
CREATE INDEX IF NOT EXISTS idx_puntos_ruta           ON puntos_control_ruta(ruta_id, orden);
CREATE INDEX IF NOT EXISTS idx_visitas_ronda         ON visitas_control(ronda_id);
CREATE INDEX IF NOT EXISTS idx_rondas_ruta           ON rondas_seguridad(ruta_id);
