// backfill-tenant-secrets (P0 #7, fase MIGRATE) — recifra los secretos por
// tenant que quedaron en TEXTO PLANO antes de provisionar la llave.
//
// Uso: operación de UNA SOLA VEZ (o por tabla) que un operador dispara tras
// hacer `supabase secrets set TENANT_SECRETS_ENC_KEY=…`. Recorre las bóvedas
// deny-all, cifra las filas que aún no lo están (isEncrypted=false) y las
// reescribe. IDEMPOTENTE: re-ejecutar solo salta lo ya cifrado.
//
// Auth: NO es pública. service_role (Bearer) o x-cron-secret. verify_jwt=false
// en config.toml.
//
// Seguridad: exige que TENANT_SECRETS_ENC_KEY esté configurada (si no, cifrar
// sería passthrough → recifraría a texto plano, un no-op engañoso) → 400.
// Soporta `dry_run` para reportar sin escribir, y `tables` para acotar.
//
// Ver docs/RUNBOOK_TENANT_SECRETS_ENCRYPTION.md (sección "Backfill (MIGRATE)").

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encryptSecret, encryptJson, isEncrypted, hasEncryptionKey } from '../_shared/secretsCrypto.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''

type Admin = ReturnType<typeof createClient>

interface TableResult {
  table: string
  scanned: number
  encrypted: number
  skipped: number
  errors: number
  last_error: string | null
}

// Todas las bóvedas tienen PK `id` (uuid) → actualizamos fila por fila por id.
const TEXT_TABLES: Record<string, string[]> = {
  company_payment_secrets: ['stripe_secret_key', 'stripe_webhook_secret', 'paypal_client_secret'],
  company_email_configs: ['access_token', 'refresh_token'],
  // Bóveda WhatsApp por tenant (#611): el access_token de Meta se sembraba en
  // texto plano (interin por SQL editor) y quedaba fuera del backfill de cifrado
  // (auditoría 2026-07-16, S4). Incluirlo aquí lo cifra en la próxima corrida.
  company_whatsapp_configs: ['access_token'],
}
const JSONB_TABLES = ['fiscal_pac_secrets', 'payfac_secrets']
const ALL_TABLES = [...Object.keys(TEXT_TABLES), ...JSONB_TABLES]

// Cifra columnas de texto plano (una o varias) por fila.
async function backfillTextColumns(
  admin: Admin, table: string, columns: string[], dryRun: boolean,
): Promise<TableResult> {
  const r: TableResult = { table, scanned: 0, encrypted: 0, skipped: 0, errors: 0, last_error: null }
  const { data, error } = await admin.from(table).select(['id', ...columns].join(','))
  if (error) { r.errors++; r.last_error = error.message; return r }
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    r.scanned++
    const update: Record<string, string> = {}
    for (const col of columns) {
      const val = row[col]
      if (typeof val === 'string' && val.length > 0 && !isEncrypted(val)) {
        update[col] = await encryptSecret(val)
      }
    }
    if (Object.keys(update).length === 0) { r.skipped++; continue }
    if (dryRun) { r.encrypted++; continue }
    const { error: upErr } = await admin.from(table).update(update).eq('id', row.id as string)
    if (upErr) { r.errors++; r.last_error = upErr.message } else { r.encrypted++ }
  }
  return r
}

// Cifra el blob jsonb `credenciales` por fila (si aún es objeto plano).
async function backfillJsonbCredenciales(
  admin: Admin, table: string, dryRun: boolean,
): Promise<TableResult> {
  const r: TableResult = { table, scanned: 0, encrypted: 0, skipped: 0, errors: 0, last_error: null }
  const { data, error } = await admin.from(table).select('id, credenciales')
  if (error) { r.errors++; r.last_error = error.message; return r }
  for (const row of (data ?? []) as Array<{ id: string; credenciales: unknown }>) {
    r.scanned++
    const cred = row.credenciales
    // Ya cifrado (string enc:v1:) o vacío/nulo → nada que hacer.
    if (typeof cred === 'string' && isEncrypted(cred)) { r.skipped++; continue }
    if (cred == null || (typeof cred === 'object' && Object.keys(cred as object).length === 0)) { r.skipped++; continue }
    const enc = await encryptJson(cred)
    // Con la llave presente (gate previo) enc es el string cifrado; si por lo que
    // fuera no lo es, no reescribimos (evita degradar el objeto).
    if (!(typeof enc === 'string' && isEncrypted(enc))) { r.skipped++; continue }
    if (dryRun) { r.encrypted++; continue }
    const { error: upErr } = await admin.from(table).update({ credenciales: enc }).eq('id', row.id)
    if (upErr) { r.errors++; r.last_error = upErr.message } else { r.encrypted++ }
  }
  return r
}

Deno.serve(async (req: Request) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Auth: solo operador/interno — service_role (Bearer) o x-cron-secret.
  const cronHdr = req.headers.get('x-cron-secret')
  const bearer = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim()
  const authorized = (CRON_SECRET !== '' && cronHdr === CRON_SECRET) ||
    (SERVICE_ROLE_KEY !== '' && bearer === SERVICE_ROLE_KEY)
  if (!authorized) return json({ error: 'Unauthorized' }, 401)

  // Gate: sin llave, el cifrado es passthrough → el backfill sería un no-op
  // engañoso. Exigir la llave provisionada.
  if (!(await hasEncryptionKey())) {
    return json({
      error: 'TENANT_SECRETS_ENC_KEY no está configurada. Provisiónala antes del backfill (ver docs/RUNBOOK_TENANT_SECRETS_ENCRYPTION.md).',
    }, 400)
  }

  const body = (await req.json().catch(() => ({}))) as { tables?: string[]; dry_run?: boolean }
  const dryRun = body.dry_run === true
  const selected = Array.isArray(body.tables) && body.tables.length > 0
    ? ALL_TABLES.filter(t => body.tables!.includes(t))
    : ALL_TABLES

  if (selected.length === 0) {
    return json({ error: `Ninguna tabla válida. Opciones: ${ALL_TABLES.join(', ')}` }, 400)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const results: TableResult[] = []
  for (const t of selected) {
    if (t in TEXT_TABLES) {
      results.push(await backfillTextColumns(admin, t, TEXT_TABLES[t], dryRun))
    } else {
      results.push(await backfillJsonbCredenciales(admin, t, dryRun))
    }
  }

  const totalErrors = results.reduce((s, r) => s + r.errors, 0)
  return json({ ok: totalErrors === 0, dry_run: dryRun, results }, totalErrors === 0 ? 200 : 207)
})
