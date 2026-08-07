// create-broadcast — fan-out de comunicados masivos en el SERVIDOR (T2/com:N5).
//
// Reemplaza el camino client-side de useBroadcasts, que: (1) resolvía la
// audiencia con TODO el padrón cargado en el navegador, (2) hacía un batch
// INSERT de ~500 filas en broadcast_recipients desde el cliente y (3) enviaba
// los emails uno a uno llamando a send-email. Aquí, con service_role:
//   1. Autenticamos y autorizamos al caller (admin/owner del tenant).
//   2. Rate-limit por caller (reusa _shared/rateLimit).
//   3. Resolvemos la audiencia contra la BD (clientes de la empresa + unidades).
//   4. Insertamos el broadcast y sus broadcast_recipients en lotes.
//   5. Si send_email: ENCOLAMOS un email por destinatario en notifications_outbox
//      vía enqueue_notification (consume el orquestador #378; el dispatcher los
//      envía async y, en el follow-up, respetará notification_preferences).
//
// verify_jwt=false en config.toml: validamos el JWT a mano (igual que create-user).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireUser } from '../_shared/auth.ts'
import { enforceRateLimit } from '../_shared/rateLimit.ts'
import { getCorsHeaders, validateOrigin } from '../_shared/cors.ts'
import {
  resolveBroadcastClienteIds,
  chunk,
  type UnidadRef,
} from '../_shared/broadcastAudience.ts'
import { canCreateBroadcast, parseBroadcastRequest, type BroadcastRequestBody } from './validate.ts'

const RECIPIENT_BATCH = 1000

function json(payload: unknown, status: number, corsHeaders: HeadersInit) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const originError = validateOrigin(origin, corsHeaders)
  if (originError) return originError

  try {
    // 1. Auth: JWT válido + perfil (rol + empresa).
    const auth = await requireUser(req, corsHeaders)
    if ('response' in auth) return auth.response
    const { user: caller, client: callerClient } = auth

    const { data: profile } = await callerClient
      .from('app_users')
      .select('role, company_id, full_name')
      .eq('id', caller.id)
      .single()

    const callerRole = (profile as { role?: string } | null)?.role ?? ''
    const callerCompanyId = (profile as { company_id?: string } | null)?.company_id ?? null
    const callerName = (profile as { full_name?: string } | null)?.full_name ?? 'Administrador'

    if (!canCreateBroadcast(callerRole)) {
      return json({ error: 'No tienes permisos para enviar comunicados.' }, 403, corsHeaders)
    }
    if (!callerCompanyId) {
      return json({ error: 'Tu usuario no está asociado a una empresa.' }, 403, corsHeaders)
    }

    // 2. Parse + validación de entrada (decisión pura en validate.ts).
    const body = (await req.json().catch(() => ({}))) as BroadcastRequestBody
    const parsed = parseBroadcastRequest(body)
    if (!parsed.ok) return json({ error: parsed.error }, 400, corsHeaders)
    const { title, message, targetType, targetIds, sendEmail } = parsed

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // 3. Rate-limit por caller: máx 20 comunicados/hora. Un comunicado puede
    //    abanicar a cientos de destinatarios → limita el abuso si una sesión
    //    admin es comprometida.
    const rl = await enforceRateLimit(adminClient, {
      subject: caller.id,
      action: 'create_broadcast',
      max: 20,
      message: 'Demasiados comunicados en poco tiempo. Espera unos minutos.',
    }, corsHeaders)
    if (rl) return rl

    // 4. Resolución de audiencia en el servidor.
    //    4a. Clientes vinculados a la empresa (company_clientes).
    const { data: ccRows, error: ccError } = await adminClient
      .from('company_clientes')
      .select('cliente_id')
      .eq('company_id', callerCompanyId)
    if (ccError) return json({ error: ccError.message }, 500, corsHeaders)
    const companyClienteIds = (ccRows ?? []).map((r: { cliente_id: string }) => r.cliente_id)

    //    4b. Unidades (solo si la audiencia depende de ellas).
    let unidades: UnidadRef[] = []
    if (targetType === 'proyecto' || targetType === 'unidades') {
      const { data: uRows, error: uError } = await adminClient
        .from('unidades')
        .select('id, project_id, cliente_id')
        .eq('company_id', callerCompanyId)
      if (uError) return json({ error: uError.message }, 500, corsHeaders)
      unidades = (uRows ?? []) as UnidadRef[]
    }

    const clienteIds = resolveBroadcastClienteIds({
      targetType,
      targetIds,
      companyClienteIds,
      unidades,
    })

    if (clienteIds.length === 0) {
      return json({ error: 'No hay destinatarios para los criterios seleccionados.' }, 400, corsHeaders)
    }

    // 5. INSERT del broadcast.
    const { data: broadcast, error: bError } = await adminClient
      .from('broadcasts')
      .insert({
        company_id: callerCompanyId,
        title,
        body: message,
        sent_by_id: caller.id,
        sent_by_name: callerName,
        target_type: targetType,
        target_ids: targetIds,
        recipient_count: clienteIds.length,
        send_email: sendEmail,
      })
      .select('id')
      .single()
    if (bError || !broadcast) {
      return json({ error: bError?.message ?? 'No se pudo crear el comunicado.' }, 500, corsHeaders)
    }
    const broadcastId = (broadcast as { id: string }).id

    // 6. INSERT de destinatarios en lotes (server-side, sin enviar el padrón al
    //    cliente). Si falla, removemos el broadcast para no dejar uno huérfano.
    for (const part of chunk(clienteIds, RECIPIENT_BATCH)) {
      const rows = part.map((cid) => ({
        broadcast_id: broadcastId,
        cliente_id: cid,
        company_id: callerCompanyId,
      }))
      const { error: rError } = await adminClient.from('broadcast_recipients').insert(rows)
      if (rError) {
        await adminClient.from('broadcasts').delete().eq('id', broadcastId)
        return json({ error: rError.message }, 500, corsHeaders)
      }
    }

    // 7. Email opcional → encolar en notifications_outbox (orquestador #378).
    let emailsQueued = 0
    if (sendEmail) {
      // Nombre de la empresa para las variables de la plantilla.
      const { data: company } = await adminClient
        .from('companies').select('nombre').eq('id', callerCompanyId).maybeSingle()
      const empresaNombre = (company as { nombre?: string } | null)?.nombre ?? 'AdministraTodo'

      // Clientes con email, en chunks para el .in().
      const clientesConEmail: { id: string; nombre: string; email: string }[] = []
      for (const part of chunk(clienteIds, RECIPIENT_BATCH)) {
        const { data: cRows } = await adminClient
          .from('clientes')
          .select('id, nombre, email')
          .in('id', part)
        for (const c of (cRows ?? []) as { id: string; nombre: string | null; email: string | null }[]) {
          if (c.email) clientesConEmail.push({ id: c.id, nombre: c.nombre ?? '', email: c.email })
        }
      }

      for (const c of clientesConEmail) {
        const { error: qError } = await adminClient.rpc('enqueue_notification', {
          p_channel: 'email',
          p_recipient: c.email,
          p_payload: {
            subject: title,
            body: message,
            message,
            to_name: c.nombre,
            from_name: callerName,
            empresa_nombre: empresaNombre,
            broadcast_id: broadcastId,
            cliente_id: c.id,
          },
          p_company_id: callerCompanyId,
          p_template_key: 'difusion',
        })
        if (!qError) emailsQueued++
      }
    }

    return json(
      { success: true, broadcast_id: broadcastId, recipientCount: clienteIds.length, emailsQueued },
      200,
      corsHeaders,
    )
  } catch (err) {
    console.error('create-broadcast error:', err)
    return json({ error: 'Error interno del servidor.' }, 500, corsHeaders)
  }
})
