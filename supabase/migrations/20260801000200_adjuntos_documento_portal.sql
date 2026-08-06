-- Documentos adjuntos (PDF/Word/Excel) en los flujos de conversación del portal.
--
-- Hoy los cuatro puntos solo aceptan FOTOS: `foto_urls` guarda imágenes que la UI
-- comprime a JPEG por canvas y pinta en <ImageGallery>. Un PDF no pasa por ahí
-- (ni se comprime ni se renderiza como imagen), así que necesita su propia
-- columna en vez de reusar `foto_urls` — que además dejaría de significar lo que
-- dice su nombre.
--
--   * tickets_mantenimiento        — el reporte inicial del residente
--   * comentarios_ticket           — cada mensaje del hilo del ticket
--   * mensajes_portal              — el mensaje inicial a la administración
--   * comentarios_mensaje_portal   — cada mensaje de ese hilo
--
-- Mismo shape que `foto_urls`: array de paths bare de `condominios-media`, que la
-- UI firma al render (SecureFileLink). El bucket ya acepta application/pdf y los
-- mimes ofimáticos (20260729000400), y las policies de storage ya dejan al
-- residente escribir bajo `${project_id}/…` de sus unidades (20260603220000), así
-- que no hay cambios de storage ni de RLS: agregar una columna no altera quién
-- puede leer o escribir estas filas.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS.
-- REVERSA: DROP COLUMN archivo_urls en las cuatro tablas.

DO $$
DECLARE
  v_tablas text[] := ARRAY[
    'tickets_mantenimiento',
    'comentarios_ticket',
    'mensajes_portal',
    'comentarios_mensaje_portal'
  ];
  v_t text;
BEGIN
  FOREACH v_t IN ARRAY v_tablas LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS archivo_urls jsonb NOT NULL DEFAULT ''[]''::jsonb',
      v_t);
    EXECUTE format(
      'COMMENT ON COLUMN public.%I.archivo_urls IS %L',
      v_t,
      'Paths (bare) de documentos en `condominios-media` (PDF/Word/Excel). Se firman al render.');
  END LOOP;
END;
$$;
