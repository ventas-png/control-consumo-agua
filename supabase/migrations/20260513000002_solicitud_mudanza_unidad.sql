-- Authorization requests for unit moves (move-in, item ingress/egress, move-out).
-- Unlike rentas, multiple requests can be active since each is a one-time event.

CREATE TABLE IF NOT EXISTS public.solicitud_mudanza_unidad (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID        NOT NULL,
  project_id          UUID        NOT NULL,
  unidad_id           UUID        NOT NULL,
  cliente_id          UUID,
  tipo_mudanza        TEXT        NOT NULL
                                  CHECK (tipo_mudanza IN ('nueva_mudanza','ingreso_articulos','egreso_articulos','mudanza_salida')),
  fecha_solicitada    DATE,
  hora_solicitada     TEXT,
  descripcion         TEXT,
  estado              TEXT        NOT NULL DEFAULT 'pendiente'
                                  CHECK (estado IN ('pendiente','aprobada','rechazada')),
  comentario_admin    TEXT,
  fecha_autorizada    DATE,
  hora_autorizada     TEXT,
  aprobado_por        TEXT,
  fecha_resolucion    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_solicitud_mudanza_unidad
  ON public.solicitud_mudanza_unidad (unidad_id, estado);
CREATE INDEX IF NOT EXISTS idx_solicitud_mudanza_project
  ON public.solicitud_mudanza_unidad (project_id, company_id);

ALTER TABLE public.solicitud_mudanza_unidad ENABLE ROW LEVEL SECURITY;

CREATE POLICY "solicitud_mudanza_all"
  ON public.solicitud_mudanza_unidad FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
