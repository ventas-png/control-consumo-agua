-- Add currency symbol, status and per-type unit limits to projects
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS moneda text NOT NULL DEFAULT 'Q',
  ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'activo'
    CHECK (estado IN ('activo', 'inactivo', 'suspendido')),
  ADD COLUMN IF NOT EXISTS max_unidades_apartamento     integer,
  ADD COLUMN IF NOT EXISTS max_unidades_casa            integer,
  ADD COLUMN IF NOT EXISTS max_unidades_bodega          integer,
  ADD COLUMN IF NOT EXISTS max_unidades_local_comercial integer,
  ADD COLUMN IF NOT EXISTS max_unidades_oficina         integer,
  ADD COLUMN IF NOT EXISTS max_unidades_parqueadero     integer,
  ADD COLUMN IF NOT EXISTS max_unidades_otro            integer;
