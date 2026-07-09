#!/usr/bin/env node
/**
 * infra:I14 — Migración one-off de los objetos de `condominios-media` a la
 * convención scopeada por tenant:
 *
 *     <categoría>/<archivo>            →   ${project_id}/<categoría>/<archivo>
 *
 * El key físico del objeto NO se puede mover con SQL: se hace con la Storage API
 * (copy + delete). Por cada objeto referenciado por una fila se: copia al path
 * nuevo, se actualiza la columna de la BD a ese path, se verifica y se borra el
 * viejo. Se escribe un MANIFIESTO (JSON) para poder revertir.
 *
 * Los objetos HUÉRFANOS (sin fila que los referencie) se mueven a cuarentena
 * `_orphans/<name>` dentro del mismo bucket (copy+delete) — reversible y purgable
 * luego, en vez de un borrado destructivo.
 *
 * USO:
 *   export SUPABASE_URL=https://<ref>.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=<service_role>     # NUNCA commitear esta key
 *
 *   node scripts/migrate-condominios-media-paths.mjs            # DRY-RUN (no escribe)
 *   node scripts/migrate-condominios-media-paths.mjs --apply    # aplica copy+update+delete
 *   node scripts/migrate-condominios-media-paths.mjs --rollback <manifest.json>
 *
 * ⚠️ ORDEN: correr DESPUÉS de desplegar el código que escribe paths scopeados y
 * ANTES de aplicar la migración de policy 20260603220000. Idempotente: re-correr
 * salta los ya scopeados (primer segmento UUID) y los ya en cuarentena (_orphans/).
 *
 * NOTA: ya ejecutado en prod (nnsqmeigtgewatameexo) el 2026-06-03 — 42 objetos
 * migrados + 7 huérfanos en cuarentena — vía una Edge Function temporal equivalente
 * (el egress directo a Storage estaba bloqueado en el entorno de CI). Este script
 * queda como artefacto reproducible/rollback para otros entornos (p. ej. Preview).
 */
import { writeFileSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'condominios-media'

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

// Columnas de cada tabla que guardan un path de condominios-media + cómo resolver
// el project_id. `kind: 'array'` → columna text[].
const SOURCES = [
  { table: 'amenidades',         cols: [{ name: 'foto_url', kind: 'scalar' }],                                                              project: 'direct' },
  { table: 'anuncios_comunidad', cols: [{ name: 'foto_url', kind: 'scalar' }],                                                              project: 'direct' },
  { table: 'novedades_seguridad',cols: [{ name: 'foto_url', kind: 'scalar' }, { name: 'fotos', kind: 'array' }],                            project: 'direct' },
  { table: 'visitantes',         cols: [{ name: 'foto_url', kind: 'scalar' }, { name: 'foto_documento_url', kind: 'scalar' }, { name: 'foto_vehiculo_url', kind: 'scalar' }], project: 'direct' },
  { table: 'reservas_str',       cols: [{ name: 'foto_url', kind: 'scalar' }, { name: 'foto_documento_url', kind: 'scalar' }],              project: 'direct' },
  { table: 'paquetes_recibidos', cols: [{ name: 'fotos', kind: 'array' }, { name: 'firma_path', kind: 'scalar' }],                          project: 'direct' },
  { table: 'huespedes_str',      cols: [{ name: 'foto_url', kind: 'scalar' }, { name: 'foto_documento_url', kind: 'scalar' }],              project: 'via_reserva' },
  // Lote 2 (auditoría #335 post-aplicación): uploaders que también escriben a este
  // bucket y no estaban indexados — sus objetos legacy caían a _orphans/ en vez de
  // re-pathearse. En prod ya se reconciliaron (ver SECURITY_ADVISORS.md, Fase 3);
  // el índice completo evita repetirlo si el one-off corre en otro entorno.
  { table: 'tickets_mantenimiento',   cols: [{ name: 'foto_urls', kind: 'array' }],                                                         project: 'direct' },
  { table: 'personal_condominio',     cols: [{ name: 'foto_url', kind: 'scalar' }],                                                         project: 'direct' },
  { table: 'polizas_seguro',          cols: [{ name: 'documento_url', kind: 'scalar' }],                                                    project: 'direct' },
  { table: 'mascotas',                cols: [{ name: 'foto_url', kind: 'scalar' }],                                                         project: 'direct' },
  { table: 'proveedores',             cols: [{ name: 'documento_url', kind: 'scalar' }],                                                    project: 'direct' },
  { table: 'inspecciones_normativas', cols: [{ name: 'certificado_url', kind: 'scalar' }],                                                  project: 'direct' },
  { table: 'reservas_amenidades',     cols: [{ name: 'checkin_foto_url', kind: 'scalar' }, { name: 'checkout_foto_url', kind: 'scalar' }],  project: 'direct' },
]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PUBLIC_URL_RE = new RegExp(`/storage/v1/object/(?:public|sign)/${BUCKET}/(.+?)(?:\\?.*)?$`)

/** Normaliza un valor guardado (path bare o URL legacy) → path bare del bucket, o null. */
function bucketPathOf(value) {
  if (!value) return null
  const m = String(value).match(PUBLIC_URL_RE)
  if (m) return decodeURIComponent(m[1])
  if (/^https?:\/\//.test(value) || /^data:/.test(value)) return null
  return String(value).replace(/^\/+/, '')
}

/** Lista recursiva de todos los objetos (files) del bucket. */
async function listAll(prefix = '') {
  const out = []
  let offset = 0
  for (;;) {
    const { data, error } = await sb.storage.from(BUCKET).list(prefix, { limit: 100, offset })
    if (error) throw new Error(`list(${prefix}) falló: ${error.message}`)
    if (!data || data.length === 0) break
    for (const e of data) {
      const full = prefix ? `${prefix}/${e.name}` : e.name
      if (e.id === null) out.push(...await listAll(full))   // carpeta → recursar
      else out.push(full)                                    // archivo
    }
    if (data.length < 100) break
    offset += data.length
  }
  return out
}

/** Construye el índice path-normalizado → { project_id, table, column, kind, rowId }. */
async function buildIndex() {
  // reserva_str_id → project_id (para huespedes_str)
  const reservaProject = new Map()
  {
    const { data, error } = await sb.from('reservas_str').select('id, project_id')
    if (error) throw new Error(`reservas_str: ${error.message}`)
    for (const r of data ?? []) reservaProject.set(r.id, r.project_id)
  }

  const index = new Map()
  for (const src of SOURCES) {
    const selectCols = ['id', ...src.cols.map(c => c.name)]
    if (src.project === 'direct') selectCols.push('project_id')
    if (src.project === 'via_reserva') selectCols.push('reserva_str_id')
    const { data, error } = await sb.from(src.table).select(selectCols.join(', '))
    if (error) throw new Error(`${src.table}: ${error.message}`)

    for (const row of data ?? []) {
      const projectId = src.project === 'direct' ? row.project_id : reservaProject.get(row.reserva_str_id)
      for (const col of src.cols) {
        const raw = row[col.name]
        const values = col.kind === 'array' ? (Array.isArray(raw) ? raw : []) : [raw]
        for (const v of values) {
          const p = bucketPathOf(v)
          if (!p) continue
          index.set(p, { projectId: projectId ?? null, table: src.table, column: col.name, kind: col.kind, rowId: row.id })
        }
      }
    }
  }
  return index
}

/** Actualiza la columna de la fila para que apunte a `newPath`. */
async function updateDbRef(ref, oldPath, newPath) {
  if (ref.kind === 'scalar') {
    const { error } = await sb.from(ref.table).update({ [ref.column]: newPath }).eq('id', ref.rowId)
    if (error) throw new Error(`update ${ref.table}.${ref.column} (${ref.rowId}): ${error.message}`)
  } else {
    const { data, error } = await sb.from(ref.table).select(`${ref.column}`).eq('id', ref.rowId).single()
    if (error) throw new Error(`select array ${ref.table} (${ref.rowId}): ${error.message}`)
    const arr = (data?.[ref.column] ?? []).map(el => (bucketPathOf(el) === oldPath ? newPath : el))
    const { error: upErr } = await sb.from(ref.table).update({ [ref.column]: arr }).eq('id', ref.rowId)
    if (upErr) throw new Error(`update array ${ref.table}.${ref.column} (${ref.rowId}): ${upErr.message}`)
  }
}

async function migrate() {
  console.log(`\n== Migración condominios-media → \${project_id}/… ==  (${APPLY ? 'APPLY' : 'DRY-RUN'})\n`)
  const [objects, index] = await Promise.all([listAll(), buildIndex()])
  console.log(`Objetos en bucket: ${objects.length} · refs indexadas: ${index.size}\n`)

  const manifest = { bucket: BUCKET, startedAt: new Date().toISOString(), apply: APPLY, moved: [], orphansQuarantined: [] }
  let moved = 0, skipped = 0, orphans = 0

  for (const name of objects) {
    const seg0 = name.split('/')[0]
    // Idempotente: salta ya-scopeados (1er segmento UUID) y ya-en-cuarentena.
    if (UUID_RE.test(seg0) || name.startsWith('_orphans/')) { skipped++; continue }

    const ref = index.get(name)
    if (ref && ref.projectId) {
      const newPath = `${ref.projectId}/${name}`
      console.log(`MOVE  ${name}  →  ${newPath}   [${ref.table}.${ref.column}]`)
      if (APPLY) {
        const { error: cpErr } = await sb.storage.from(BUCKET).copy(name, newPath)
        if (cpErr && !/exists/i.test(cpErr.message)) throw new Error(`copy ${name}: ${cpErr.message}`)
        await updateDbRef(ref, name, newPath)
        const { error: rmErr } = await sb.storage.from(BUCKET).remove([name])
        if (rmErr) throw new Error(`remove ${name}: ${rmErr.message}`)
      }
      manifest.moved.push({ oldPath: name, newPath, table: ref.table, column: ref.column, kind: ref.kind, rowId: ref.rowId })
      moved++
    } else {
      // Huérfano (sin fila que lo referencie) → cuarentena en _orphans/ (copy+delete).
      const quarantine = `_orphans/${name}`
      console.log(`ORPHAN ${name}  →  ${quarantine}   (cuarentena, sin fila que lo referencie)`)
      if (APPLY) {
        const { error: cpErr } = await sb.storage.from(BUCKET).copy(name, quarantine)
        if (cpErr && !/exists/i.test(cpErr.message)) throw new Error(`copy orphan ${name}: ${cpErr.message}`)
        const { error: rmErr } = await sb.storage.from(BUCKET).remove([name])
        if (rmErr) throw new Error(`remove orphan ${name}: ${rmErr.message}`)
      }
      manifest.orphansQuarantined.push({ oldPath: name, quarantine })
      orphans++
    }
  }

  const file = `condominios-media-manifest-${Date.now()}.json`
  writeFileSync(file, JSON.stringify(manifest, null, 2))
  console.log(`\nResumen: ${moved} movidos · ${orphans} en cuarentena · ${skipped} saltados (ya scopeados/cuarentena)`)
  console.log(`Manifiesto: ${file}`)
  if (!APPLY) console.log('\n(DRY-RUN — nada se modificó. Re-correr con --apply para ejecutar.)')
}

async function rollback(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  console.log(`\n== ROLLBACK desde ${manifestPath} ==  (${APPLY ? 'APPLY' : 'DRY-RUN'})\n`)
  // Revertir los movimientos: copiar new→old, restaurar columna, borrar new.
  for (const m of [...manifest.moved].reverse()) {
    console.log(`REVERT ${m.newPath}  →  ${m.oldPath}   [${m.table}.${m.column}]`)
    if (APPLY) {
      const { error: cpErr } = await sb.storage.from(BUCKET).copy(m.newPath, m.oldPath)
      if (cpErr && !/exists/i.test(cpErr.message)) throw new Error(`copy ${m.newPath}: ${cpErr.message}`)
      await updateDbRef({ table: m.table, column: m.column, kind: m.kind, rowId: m.rowId }, m.newPath, m.oldPath)
      const { error: rmErr } = await sb.storage.from(BUCKET).remove([m.newPath])
      if (rmErr) throw new Error(`remove ${m.newPath}: ${rmErr.message}`)
    }
  }
  // Restaurar huérfanos: copiar de la cuarentena al path original y limpiar la cuarentena.
  for (const o of manifest.orphansQuarantined ?? []) {
    console.log(`RESTORE orphan ${o.quarantine}  →  ${o.oldPath}`)
    if (APPLY) {
      const { error: cpErr } = await sb.storage.from(BUCKET).copy(o.quarantine, o.oldPath)
      if (cpErr && !/exists/i.test(cpErr.message)) throw new Error(`copy ${o.quarantine}: ${cpErr.message}`)
      const { error: rmErr } = await sb.storage.from(BUCKET).remove([o.quarantine])
      if (rmErr) throw new Error(`remove ${o.quarantine}: ${rmErr.message}`)
    }
  }
  console.log(`\nRollback ${APPLY ? 'aplicado' : '(dry-run)'} sobre ${manifest.moved.length} movimientos y ${(manifest.orphansQuarantined ?? []).length} huérfanos.`)
}

try {
  if (ROLLBACK) await rollback(ROLLBACK)
  else await migrate()
} catch (e) {
  console.error(`\n❌ ${e.message}`)
  process.exit(1)
}
