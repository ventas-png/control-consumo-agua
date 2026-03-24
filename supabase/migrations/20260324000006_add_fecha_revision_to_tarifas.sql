-- Agregar columna fecha_revision a tarifas
ALTER TABLE public.tarifas
  ADD COLUMN IF NOT EXISTS fecha_revision date DEFAULT NULL;

-- Función que desactiva tarifas vencidas (llamada desde la app al cargar)
-- Usa SECURITY DEFINER para que cualquier usuario autenticado pueda dispararla
-- sin necesitar permisos de escritura directa en la tabla
CREATE OR REPLACE FUNCTION public.deactivate_expired_tarifas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tarifas
  SET    activa     = false,
         updated_at = now()
  WHERE  fecha_revision IS NOT NULL
    AND  fecha_revision < CURRENT_DATE
    AND  activa = true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.deactivate_expired_tarifas() TO authenticated;
