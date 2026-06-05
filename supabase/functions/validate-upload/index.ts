// validate-upload — validación server-side de uploads (infra:I13).
//
// El cliente (src/lib/fileValidation.ts) valida magic-bytes ANTES de subir, pero
// un usuario autenticado puede saltarse eso llamando directo al REST de Storage.
// Esta function da enforcement real: recibe el archivo, lo valida con la lógica
// PURA de _shared/uploadValidation.ts (magic-bytes vs MIME declarado, tamaño por
// bucket, saneo/rechazo de SVG con script/eventos) y, si pasa, sube a Storage
// USANDO EL JWT DEL LLAMADOR — así las RLS policies de storage.objects siguen
// imponiendo el scoping por tenant (no usamos service_role, que las saltaría).
//
// Es complementaria al `allowed_mime_types` del bucket (que solo mira el
// content-type declarado, no el contenido real).

import { requireUser } from '../_shared/auth.ts'
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts'
import { validateUpload } from '../_shared/uploadValidation.ts'

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (!isOriginAllowed(origin)) {
    return json({ error: 'Origin not allowed' }, 403, corsHeaders)
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, corsHeaders)
  }

  // JWT obligatorio: subir requiere usuario autenticado.
  const auth = await requireUser(req, corsHeaders)
  if ('response' in auth) return auth.response
  const { client } = auth

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json({ error: 'Se esperaba multipart/form-data con los campos file, bucket y path.' }, 400, corsHeaders)
  }

  const file = form.get('file')
  const bucket = String(form.get('bucket') ?? '')
  const path = String(form.get('path') ?? '')
  const upsert = String(form.get('upsert') ?? '') === 'true'

  if (!(file instanceof File) && !(file instanceof Blob)) {
    return json({ error: 'Falta el archivo (campo "file").' }, 400, corsHeaders)
  }
  if (!bucket || !path) {
    return json({ error: 'Faltan los campos "bucket" y/o "path".' }, 400, corsHeaders)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const declaredMime = (file instanceof File ? file.type : (file as Blob).type) || ''
  const filename = file instanceof File ? file.name : undefined

  // ── Validación PURA (magic-bytes + tamaño + SVG) ─────────────────────────
  const result = validateUpload({ bucket, declaredMime, bytes, filename })
  if (!result.ok) {
    return json({ error: result.reason, code: result.code }, 422, corsHeaders)
  }

  // ── Upload con el JWT del llamador → RLS de storage impone el tenant ─────
  const { error } = await client.storage.from(bucket).upload(path, bytes, {
    contentType: result.detected,
    upsert,
  })
  if (error) {
    // 403 si RLS/allow-list del bucket lo rechaza; 500 para el resto.
    const status = /row-level security|not authorized|mime|exceeded/i.test(error.message) ? 403 : 500
    return json({ error: error.message }, status, corsHeaders)
  }

  return json({ ok: true, bucket, path, detected: result.detected }, 200, corsHeaders)
})

function json(body: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
