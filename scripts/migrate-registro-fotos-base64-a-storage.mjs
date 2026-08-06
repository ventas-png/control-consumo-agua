#!/usr/bin/env node
/**
 * Migración one-off de las fotos de lecturas que se guardaron como data-URI
 * base64 EN LA COLUMNA `registros.foto` hacia el bucket `registro-fotos`:
 *
 *     data:image/jpeg;base64,/9j/…   →   ${cliente_id}/${id}   (path en Storage)
 *
 * Por qué: `registros.foto` acumuló ~526 MB de base64 (promedio ~2 MB, hasta
 * 15 MB por fila). Eso volvía lentísimo el portal del cliente (las consultas
 * bajaban cientos de MB) y las imágenes más grandes ni decodifican en el
 * navegador. El código de lectura del portal ya baja las fotos bajo demanda y
 * acepta AMBOS formatos (data-URI heredado o path firmado), así que esta
 * migración puede correr sin coordinar downtime: cada fila migrada empieza a
 * servirse como objeto de Storage.
 *
 * Los bytes NO se pueden mover con SQL: se decodifican y se suben con la Storage
 * API, luego se reemplaza la columna por el path y se escribe un MANIFIESTO
 * (JSON pequeño: id + path + mime) para poder revertir.
 *
 * USO:
 *   export SUPABASE_URL=https://<ref>.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=<service_role>     # NUNCA commitear esta key
 *
 *   node scripts/migrate-registro-fotos-base64-a-storage.mjs            # DRY-RUN (no escribe)
 *   node scripts/migrate-registro-fotos-base64-a-storage.mjs --apply    # sube + reemplaza columna
 *   node scripts/migrate-registro-fotos-base64-a-storage.mjs --rollback <manifest.json>
 *
 * ⚠️ ORDEN: correr DESPUÉS de desplegar el código que escribe paths
 * (AdminNewReading + LecturasSection, PR #529) para que no entren nuevos base64
 * mientras se migra. Idempotente: solo toca filas con `foto LIKE 'data:%'`; las
 * que ya son path se saltan solas. El path destino es determinista
 * (`${cliente_id}/${id}`), así que re-correr hace upsert sobre el mismo objeto.
 *
 * NOTA DE ENTORNO: igual que migrate-condominios-media-paths.mjs, el egress
 * directo a Storage puede estar bloqueado en CI / entornos efímeros. En prod
 * (nnsqmeigtgewatameexo) la forma probada es ejecutar esta misma lógica desde
 * una Edge Function temporal con el service_role inyectado. Este script es el
 * artefacto reproducible + rollback.
 *
 * Filas con `cliente_id` NULL (no scopeables a carpeta-de-cliente por la RLS del
 * bucket) se SALTAN y se reportan: se quedan como base64 (siguen renderizando).
 */
import { writeFileSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'registro-fotos'
const BATCH = 10 // filas por lote (las fotos son grandes: lote chico = poca RAM)

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const ROLLBACK_IDX = args.indexOf('--rollback')
const ROLLBACK = ROLLBACK_IDX !== -1 ? args[ROLLBACK_IDX + 1] : null

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.')
  process.exit(1)
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } })

const DATA_URI_RE = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/

/** Parsea un data-URI → { mime, buffer }. Devuelve null si no es base64 válido. */
function parseDataUri(value) {
  const m = String(value).match(DATA_URI_RE)
  if (!m || !m[2]) return null // exige ;base64
  const mime = m[1] || 'application/octet-stream'
  try {
    return { mime, buffer: Buffer.from(m[3], 'base64') }
  } catch {
    return null
  }
}

async function migrate() {
  console.log(`\n== Migración registros.foto (base64) → ${BUCKET}/\${cliente_id}/\${id} ==  (${APPLY ? 'APPLY' : 'DRY-RUN'})\n`)

  const manifest = { bucket: BUCKET, startedAt: new Date().toISOString(), apply: APPLY, moved: [] }
  let moved = 0, skippedNullCliente = 0, failed = 0

  if (!APPLY) {
    // DRY-RUN: contar sin bajar el base64 (solo id + cliente_id).
    const { data, error } = await sb.from('registros').select('id, cliente_id').like('foto', 'data:%')
    if (error) throw new Error(`select dry-run: ${error.message}`)
    const total = data?.length ?? 0
    const nulos = (data ?? []).filter(r => !r.cliente_id).length
    console.log(`Filas con foto base64: ${total}`)
    console.log(`  · migrables (cliente_id presente): ${total - nulos}`)
    console.log(`  · se saltarían (cliente_id NULL):   ${nulos}`)
    console.log('\n(DRY-RUN — nada se modificó. Re-correr con --apply para ejecutar.)')
    return
  }

  // APPLY: procesar en lotes. Al reemplazar foto por el path, la fila deja de
  // matchear `foto LIKE 'data:%'`, así que pedir siempre el primer lote vacía
  // la cola sin offsets que se desfasen. Las NULL-cliente se acumularían al
  // frente y colgarían el loop → se excluyen con `not('cliente_id','is',null)`.
  for (;;) {
    const { data, error } = await sb
      .from('registros')
      .select('id, cliente_id, foto')
      .like('foto', 'data:%')
      .not('cliente_id', 'is', null)
      .limit(BATCH)
    if (error) throw new Error(`select lote: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data) {
      const parsed = parseDataUri(row.foto)
      if (!parsed) {
        console.warn(`SKIP  ${row.id}  (data-URI no parseable)`)
        failed++
        // Para no colgar el loop con una fila irreparable, la sacamos de la cola
        // marcándola con un prefijo inválido sería destructivo; mejor abortar.
        throw new Error(`Fila ${row.id} tiene un foto base64 no parseable; revisar manualmente.`)
      }
      const newPath = `${row.cliente_id}/${row.id}`
      const { error: upErr } = await sb.storage.from(BUCKET).upload(newPath, parsed.buffer, {
        contentType: parsed.mime,
        upsert: true,
      })
      if (upErr) throw new Error(`upload ${newPath}: ${upErr.message}`)

      const { error: dbErr } = await sb.from('registros').update({ foto: newPath }).eq('id', row.id)
      if (dbErr) throw new Error(`update registros.foto (${row.id}): ${dbErr.message}`)

      console.log(`MOVE  ${row.id}  →  ${newPath}   (${parsed.mime}, ${(parsed.buffer.length / 1024).toFixed(0)} KB)`)
      manifest.moved.push({ id: row.id, newPath, mime: parsed.mime })
      moved++
    }
  }

  // Reportar cuántas NULL-cliente quedaron sin migrar (informativo).
  const { count } = await sb
    .from('registros')
    .select('id', { count: 'exact', head: true })
    .like('foto', 'data:%')
  skippedNullCliente = count ?? 0

  const file = `registro-fotos-manifest-${Date.now()}.json`
  writeFileSync(file, JSON.stringify(manifest, null, 2))
  console.log(`\nResumen: ${moved} migradas · ${skippedNullCliente} sin migrar (cliente_id NULL) · ${failed} fallidas`)
  console.log(`Manifiesto: ${file}  (guárdalo para poder revertir)`)
}

async function rollback(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  console.log(`\n== ROLLBACK desde ${manifestPath} ==  (${APPLY ? 'APPLY' : 'DRY-RUN'})\n`)
  for (const m of [...manifest.moved].reverse()) {
    console.log(`REVERT ${m.newPath}  →  registros.foto[${m.id}] (base64)`)
    if (!APPLY) continue
    // Bajar el objeto, re-codificar a data-URI y restaurar la columna; luego borrar el objeto.
    const { data, error } = await sb.storage.from(BUCKET).download(m.newPath)
    if (error) throw new Error(`download ${m.newPath}: ${error.message}`)
    const buf = Buffer.from(await data.arrayBuffer())
    const dataUri = `data:${m.mime};base64,${buf.toString('base64')}`
    const { error: dbErr } = await sb.from('registros').update({ foto: dataUri }).eq('id', m.id)
    if (dbErr) throw new Error(`update rollback (${m.id}): ${dbErr.message}`)
    const { error: rmErr } = await sb.storage.from(BUCKET).remove([m.newPath])
    if (rmErr) throw new Error(`remove ${m.newPath}: ${rmErr.message}`)
  }
  console.log(`\nRollback ${APPLY ? 'aplicado' : '(dry-run)'} sobre ${manifest.moved.length} filas.`)
}

try {
  if (ROLLBACK) await rollback(ROLLBACK)
  else await migrate()
} catch (e) {
  console.error(`\n❌ ${e.message}`)
  process.exit(1)
}
