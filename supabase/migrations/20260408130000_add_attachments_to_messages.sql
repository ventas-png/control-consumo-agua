-- ============================================================
-- Adjuntos en mensajes del Centro de Comunicación
-- Permite adjuntar imágenes y documentos a los mensajes.
-- ============================================================

-- 1. Agregar columnas de adjunto
ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS attachment_url  text,
  ADD COLUMN IF NOT EXISTS attachment_name text,
  ADD COLUMN IF NOT EXISTS attachment_type text,    -- MIME type ej: 'image/jpeg', 'application/pdf'
  ADD COLUMN IF NOT EXISTS attachment_size integer; -- tamaño en bytes

-- 2. Permitir body vacío cuando hay adjunto
ALTER TABLE public.conversation_messages
  ALTER COLUMN body SET DEFAULT '';

ALTER TABLE public.conversation_messages
  ADD CONSTRAINT chk_message_content
    CHECK (body <> '' OR attachment_url IS NOT NULL);

-- ============================================================
-- 3. Bucket de storage para adjuntos
-- Crear desde el Dashboard: Storage → New bucket → 'conv-attachments' (public)
-- O ejecutar:
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('conv-attachments', 'conv-attachments', true)
-- ON CONFLICT (id) DO NOTHING;
-- ============================================================
