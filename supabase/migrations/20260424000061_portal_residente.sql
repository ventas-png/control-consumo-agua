-- Token de acceso al portal del residente por unidad
ALTER TABLE unidades ADD COLUMN IF NOT EXISTS token_portal    text UNIQUE;
ALTER TABLE unidades ADD COLUMN IF NOT EXISTS portal_activo   boolean NOT NULL DEFAULT false;

-- Índice para lookup rápido por token
CREATE UNIQUE INDEX IF NOT EXISTS idx_unidades_token_portal ON unidades(token_portal) WHERE token_portal IS NOT NULL;

-- Mensajes del residente al administrador (desde el portal)
CREATE TABLE mensajes_portal (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  project_id   uuid NOT NULL REFERENCES projects(id),
  unidad_id    uuid NOT NULL REFERENCES unidades(id),
  asunto       text NOT NULL,
  cuerpo       text NOT NULL,
  tipo         text NOT NULL DEFAULT 'consulta',  -- 'consulta' | 'queja' | 'sugerencia' | 'emergencia'
  estado       text NOT NULL DEFAULT 'nuevo',     -- 'nuevo' | 'leido' | 'respondido' | 'cerrado'
  respuesta    text,
  respondido_en timestamptz,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE mensajes_portal ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_rw_mensajes_portal" ON mensajes_portal
  USING (company_id = get_my_company_id())
  WITH CHECK (company_id = get_my_company_id());

CREATE INDEX IF NOT EXISTS idx_mensajes_portal_unidad ON mensajes_portal(unidad_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mensajes_portal_project ON mensajes_portal(project_id, company_id, estado);
