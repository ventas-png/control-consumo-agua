-- Track T5 · infra:I14 (fase allowed_mime_types) — restringe los content-types
-- aceptados por upload en los 2 buckets que aún tenían `allowed_mime_types = null`
-- (el resto ya estaba restringido: company-logos, condominios-media, mudanza-docs,
-- pagos-comprobantes, project-logos, registro-fotos).
--
-- POR QUÉ: sin `allowed_mime_types`, el Storage acepta cualquier content-type (p. ej.
-- `text/html`, binarios), ampliando la superficie de subida de payloads. Restringir a
-- los tipos que la app realmente sube cierra esa superficie (defensa en profundidad,
-- complementa la validación magic-byte del cliente).
--
-- report-attachments: lo sube SOLO `sendReportEmail.ts` con `mimeFor(format)` →
--   csv/pdf/xlsx. En el mismo cambio se normalizó `mimeFor` para emitir `text/csv`
--   (antes `text/csv;charset=utf-8`, que no matchea el match exacto de essence).
--
-- conv-attachments: adjuntos de chat (`useConversations.sendMessage`), sube con el
--   `file.type` del browser; el input es `accept="image/*,.pdf,.xlsx,.xls,.docx,.doc,.csv"`.
--   Se usa `image/*` (wildcard, robusto a heic/avif/variantes del browser) + los mimes
--   de office + pdf + csv. Nota: `file.type` de un .csv puede venir como `text/csv` o
--   `application/vnd.ms-excel` según el SO (ambos incluidos); un .csv con `file.type`
--   vacío sería rechazado (caso borde poco común).
--
-- IDEMPOTENTE: UPDATE directo. REVERSA: `set allowed_mime_types = null` en ambos.

update storage.buckets
  set allowed_mime_types = array[
    'text/csv',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
  where id = 'report-attachments';

update storage.buckets
  set allowed_mime_types = array[
    'image/*',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',  -- xlsx
    'application/vnd.ms-excel',                                           -- xls (y csv en algunos SO)
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', -- docx
    'application/msword',                                                 -- doc
    'text/csv'
  ]
  where id = 'conv-attachments';
