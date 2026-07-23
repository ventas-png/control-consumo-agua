// Edge Function: purgar-fotos-registros
// -----------------------------------------------------------------------------
// Borra del bucket privado `registro-fotos` los objetos de fotos de lecturas con
// más de N días (default 90) y luego pone `registros.foto = NULL` en esas filas.
// Solo toca fotos en formato PATH de Storage; las heredadas en base64 (data-URI
// inline en la columna) las limpia el paso SQL de `purgar_datos_expirados`.
//
// La antigüedad se mide con `registros.fecha`. No se filtra por estado de pago
// (política: todas las lecturas >N días) — los datos de la lectura se conservan,
// solo se descarta la imagen.
//
// Invocada por pg_cron → pg_net (run_purga_fotos_storage, secretos en Vault) con
// la service_role key, o manualmente por un super_admin con su JWT. En
// config.toml va con verify_jwt = false: valida el token a mano (service_role o
// super_admin), igual que route-reminders / delete-company.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { timingSafeEqualSecret } from '../_shared/auth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const BUCKET = 'registro-fotos'
const DIAS_RETENCION_DEFAULT = 90
const BATCH_SIZE = 200
// Tope duro por corrida (200 × 100 = 20 000 fotos); evita una corrida infinita.
const MAX_ITERACIONES = 100

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim()

    // ── Auth: interno (cron, service key) o super_admin (JWT) ──
    if (!token) return json({ error: 'Unauthorized' }, 401)
    let autorizado = await timingSafeEqualSecret(token, SERVICE_ROLE_KEY)
    if (!autorizado) {
      const { data: { user }, error } = await admin.auth.getUser(token)
      if (error || !user) return json({ error: 'Unauthorized' }, 401)
      const { data: au } = await admin.from('app_users').select('role').eq('id', user.id).maybeSingle()
      if (au?.role === 'super_admin') autorizado = true
    }
    if (!autorizado) return json({ error: 'Forbidden' }, 403)

    const body = await req.json().catch(() => ({})) as { dias?: number }
    const dias = Number.isFinite(body.dias) && (body.dias as number) > 0
      ? Math.floor(body.dias as number)
      : DIAS_RETENCION_DEFAULT
    const cutoff = new Date(Date.now() - dias * 86400000).toISOString()

    let objetosBorrados = 0
    let filasActualizadas = 0
    let iteraciones = 0
    const errores: string[] = []

    for (let i = 0; i < MAX_ITERACIONES; i++) {
      // Solo fotos en formato PATH de Storage (el base64 lo maneja el SQL).
      // Al anular la columna, la siguiente vuelta ya no las trae → pagina sola.
      const { data: rows, error } = await admin
        .from('registros')
        .select('id, foto')
        .not('foto', 'is', null)
        .not('foto', 'like', 'data:%')
        .lt('fecha', cutoff)
        .limit(BATCH_SIZE)
      if (error) { errores.push(`select: ${error.message}`); break }
      if (!rows || rows.length === 0) break

      iteraciones++
      const ids = rows.map((r) => r.id as string)
      const paths = rows.map((r) => r.foto as string)

      // 1) Borrar los objetos del bucket. Best-effort: un objeto ausente NO es
      //    error en la Storage API (mismo criterio tolerante que delete-company).
      const { error: rmErr } = await admin.storage.from(BUCKET).remove(paths)
      if (rmErr) { errores.push(`remove: ${rmErr.message}`); break }
      objetosBorrados += paths.length

      // 2) Anular la columna SOLO tras borrar el objeto (si el remove fallara, no
      //    perdemos el path y se reintenta el próximo mes).
      const { error: updErr } = await admin.from('registros').update({ foto: null }).in('id', ids)
      if (updErr) { errores.push(`update: ${updErr.message}`); break }
      filasActualizadas += ids.length
    }

    return json({
      success: errores.length === 0,
      dias,
      objetos_borrados: objetosBorrados,
      filas_actualizadas: filasActualizadas,
      iteraciones,
      errores,
    })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
