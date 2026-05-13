-- Rental authorization requests per unit.
-- A client requests permission to operate arrendamiento / STR / both.
-- One active (non-rejected) authorization per unit enforced by the unique partial index.

CREATE TABLE IF NOT EXISTS public.solicitud_renta_unidad (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID        NOT NULL,
  project_id          UUID        NOT NULL,
  unidad_id           UUID        NOT NULL,
  cliente_id          UUID,
  tipo_renta          TEXT        NOT NULL DEFAULT 'arrendamiento'
                                  CHECK (tipo_renta IN ('arrendamiento','str','ambas')),
  motivo              TEXT,
  estado              TEXT        NOT NULL DEFAULT 'pendiente'
                                  CHECK (estado IN ('pendiente','aprobada','rechazada')),
  tipo_aprobado       TEXT        CHECK (tipo_aprobado IN ('arrendamiento','str','ambas')),
  comentario_admin    TEXT,
  aprobado_por        TEXT,
  fecha_resolucion    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active (non-rejected) authorization per unit at a time.
-- Rejected rows are kept for audit; a new request can be submitted after rejection.
CREATE UNIQUE INDEX IF NOT EXISTS idx_solicitud_renta_unidad_activa
  ON public.solicitud_renta_unidad (unidad_id)
  WHERE estado IN ('pendiente', 'aprobada');

CREATE INDEX IF NOT EXISTS idx_solicitud_renta_project
  ON public.solicitud_renta_unidad (project_id, company_id);

CREATE INDEX IF NOT EXISTS idx_solicitud_renta_unidad
  ON public.solicitud_renta_unidad (unidad_id);

ALTER TABLE public.solicitud_renta_unidad ENABLE ROW LEVEL SECURITY;

CREATE POLICY "solicitud_renta_all"
  ON public.solicitud_renta_unidad FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
