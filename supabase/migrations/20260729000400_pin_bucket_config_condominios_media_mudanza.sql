-- ════════════════════════════════════════════════════════════════════════════
-- Fijar en SQL la configuración de `condominios-media` y `mudanza-docs`
-- (auditoría 2026-07-28, Bloque A · PR-8).
--
-- POR QUÉ
-- Son los dos buckets más sensibles del producto: guardan
-- `huespedes_str.foto_documento_url` y `visitantes.foto_documento_url` (escaneos
-- de documento de identidad), `novedades_seguridad.fotos` y
-- `solicitud_mudanza_unidad.imagenes` (ver 20260516000003:62-100).
--
-- El repo solo contiene un `UPDATE storage.buckets SET public = false`
-- (20260516000003:103). NO hay `INSERT INTO storage.buckets` para ninguno de los
-- dos, ni nada que fije `file_size_limit` o `allowed_mime_types`.
-- 20260603230000:3 AFIRMA que ya están restringidos, pero ninguna migración lo
-- hace: se configuraron desde el dashboard. Resultado: en cualquier entorno
-- provisionado desde el repo, los buckets nacen sin límite de tamaño y sin
-- allowlist de MIME (NULL = todo permitido).
--
-- Eso importa porque `src/lib/fileValidation.ts:9-14` documenta el riesgo
-- residual: un usuario autenticado puede saltarse la validación del cliente
-- llamando a la REST API de Storage directamente. La única defensa real es la
-- config del bucket.
--
-- POR QUÉ `DO UPDATE` SOLO TOCA DOS COLUMNAS
-- `public` y `file_size_limit` se pueden afirmar con certeza: el primero ya lo
-- fija 20260516000003, y el segundo está en el código como fuente de verdad
-- (`_shared/uploadValidation.ts:129-130` → 10 MiB para ambos).
--
-- `allowed_mime_types` NO se toca en el UPDATE, a propósito. `condominios-media`
-- lo usa un `FileUploader` genérico que admite ofimática, y
-- `fileValidation.ts:116-119` deja claro que el bucket de PROD ya restringe por
-- MIME ofimático específico. No sé cuál es exactamente esa lista, y
-- sobrescribirla con una mía —si resultara más estrecha— rompería subidas
-- legítimas en producción. Así que:
--
--   · INSERT (deploy fresco, bucket inexistente) → nace con allowlist cerrada.
--   · CONFLICT (prod, bucket existente)          → se respeta su allowlist.
--
-- La lista del INSERT se deriva del propio código, no de una suposición:
-- `CATEGORY_MIMES.document` (`fileValidation.ts:38`) más las refinaciones
-- ofimáticas de `OOXML_BY_EXT` / `OLE2_BY_EXT` (`:121-130`).
--
-- FOLLOW-UP: alinear la allowlist de prod con ésta requiere leer primero la que
-- tiene hoy (`select allowed_mime_types from storage.buckets where id = ...`).
-- Es una tarea de operador con acceso al proyecto, no de esta migración.
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'condominios-media',
    'condominios-media',
    false,
    10485760,  -- 10 MiB — espeja BUCKET_POLICIES de _shared/uploadValidation.ts
    ARRAY[
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint'
    ]
  ),
  (
    'mudanza-docs',
    'mudanza-docs',
    false,
    10485760,  -- 10 MiB
    ARRAY[
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf'
    ]
  )
ON CONFLICT (id) DO UPDATE
  SET public          = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;
      -- allowed_mime_types NO se actualiza: ver el bloque de arriba.
