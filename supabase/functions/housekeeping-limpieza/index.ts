// Edge Function: housekeeping-limpieza
// -----------------------------------------------------------------------------
// Retira del bucket `housekeeping-evidencias` los archivos de las fotos/servicios que ya se
// eliminaron (cola `hk_limpieza_storage`), con reintentos. La invoca la pantalla justo después
// de borrar y, cada hora, `purgar-fotos-registros` (pg_cron) con el barrido de huérfanos.
//
// AUTORIZACIÓN. Los clientes no pueden borrar del bucket (no hay policy de DELETE): esta
// función usa el service-role, así que valida a mano el JWT:
//   · usuario con empresa → drena SOLO la cola de SU empresa;
//   · super_admin         → toda la cola.
// No acepta rutas del cliente: solo drena lo que la BD ya encoló al borrar una fila. Con
// verify_jwt = false (config.toml) porque valida el token aquí, igual que las demás.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { drenarColaHousekeeping, type ClienteLimpieza } from '../_shared/housekeepingLimpieza.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req.headers.get('origin'))
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim()
    if (!token) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data: { user }, error } = await admin.auth.getUser(token)
    if (error || !user) return json({ error: 'Unauthorized' }, 401)

    const { data: perfil } = await admin.from('app_users').select('role, company_id, activo').eq('id', user.id).maybeSingle()
    if (!perfil || perfil.activo === false) return json({ error: 'Forbidden' }, 403)

    const esSuper = perfil.role === 'super_admin' || perfil.role === 'superadmin'
    if (!esSuper && !perfil.company_id) return json({ error: 'Forbidden' }, 403)

    const resultado = await drenarColaHousekeeping(admin as unknown as ClienteLimpieza, {
      company: esSuper ? null : perfil.company_id,
    })
    return json({ success: resultado.errores.length === 0, ...resultado })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
