import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireUser } from '../_shared/auth.ts'
import { enforceRateLimit } from '../_shared/rateLimit.ts'
import { getCorsHeaders, validateOrigin } from '../_shared/cors.ts'
// update-user — el PRINCIPAL de la empresa (propietario o superadministrador) edita el nombre, el correo y la contraseña de una persona de su empresa.
// El correo y la contraseña viven en auth.users y sólo se escriben con service_role: por eso es una función y no una escritura directa. La lógica pura
// (gate, validación de campos, fila de auditoría) está en ./validate.ts para probarla en vitest.
//
// Un cuerpo con sólo `user_id` (o cuyos campos ya valen lo mismo) no escribe nada y devuelve los datos actuales ({ full_name, email }): la pantalla lo usa para
// precargar el formulario, porque el correo no está en app_users. Pasa por el mismo gate que una edición.
import {
  buildUserUpdatedAudit,
  cambiosEfectivos,
  checkEditTargetGate,
  isPrincipalRole,
  isTextOrAbsent,
  mensajeErrorAuth,
  MSG_SOLO_PRINCIPAL_EDITAR,
  parseCambios,
  type TargetUserRow,
} from './validate.ts'

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const originError = validateOrigin(origin, corsHeaders)
  if (originError) return originError

  try {
    const auth = await requireUser(req, corsHeaders)
    if ('response' in auth) return auth.response
    const { user: caller, client: callerClient } = auth

    // El rol que decide sale de app_users leído con el JWT del llamador, nunca de los claims del token.
    const { data: callerProfile } = await callerClient
      .from('app_users')
      .select('role, company_id')
      .eq('id', caller.id)
      .single()

    const callerRole: string = (callerProfile as { role: string; company_id: string } | null)?.role ?? ''
    const callerCompanyId: string | null = (callerProfile as { role: string; company_id: string } | null)?.company_id ?? null

    if (!isPrincipalRole(callerRole)) return json({ error: MSG_SOLO_PRINCIPAL_EDITAR }, 403)

    // El cuerpo llega de la red: un cuerpo que no sea un objeto JSON o un campo que no sea texto es una petición mal formada → 400 (mismo criterio que create-user).
    const body = await req.json().catch(() => null) as {
      user_id?: unknown
      full_name?: unknown
      email?: unknown
      password?: unknown
    } | null
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Cuerpo inválido' }, 400)
    if (![body.user_id, body.full_name, body.email, body.password].every(isTextOrAbsent)) return json({ error: 'Datos inválidos' }, 400)

    const targetId = ((body.user_id as string | null | undefined) ?? '').trim()
    if (!targetId) return json({ error: 'Missing user_id' }, 400)
    if (targetId === caller.id) return json({ error: 'No puedes editar tu propia cuenta desde aquí' }, 400)

    const parsed = parseCambios(body as { full_name?: string | null; email?: string | null; password?: string | null })
    if (!parsed.ok) return json({ error: parsed.error }, 400)

    // Cliente de servicio: lee a la persona objetivo sin RLS y hace las escrituras.
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: target, error: targetError } = await adminClient
      .from('app_users')
      .select('id, role, company_id, full_name')
      .eq('id', targetId)
      .single()
    if (targetError || !target) return json({ error: 'Usuario no encontrado' }, 404)
    const targetRow = target as TargetUserRow

    const gate = checkEditTargetGate({ callerRole, callerCompanyId, target: targetRow })
    if (!gate.ok) return json({ error: gate.error }, 403)

    // Tope por llamador: una sesión comprometida no reescribe (ni enumera los correos de) toda la empresa de golpe.
    const rl = await enforceRateLimit(adminClient, {
      subject: caller.id,
      action: 'update_user',
      max: 120,
      message: 'Demasiadas ediciones de usuario en poco tiempo. Espera unos minutos.',
    }, corsHeaders)
    if (rl) return rl

    const { data: authData, error: authReadError } = await adminClient.auth.admin.getUserById(targetId)
    if (authReadError || !authData?.user) return json({ error: 'No se pudo leer el acceso de la persona' }, 500)
    const emailActual: string | null = authData.user.email ?? null

    const cambios = cambiosEfectivos(parsed.cambios, { full_name: targetRow.full_name, email: emailActual })
    const changed = (['full_name', 'email', 'password'] as const).filter(c => cambios[c] !== undefined)
    if (changed.length === 0) {
      return json({ ok: true, changed, full_name: targetRow.full_name, email: emailActual }, 200)
    }

    // 1) El acceso primero: es lo que puede fallar por una razón de la persona (correo ya en uso, contraseña débil) y, si falla, no se ha tocado nada.
    //    email_confirm: el correo lo fija el propietario, igual que en el alta (create-user); no se envía un enlace de confirmación.
    if (cambios.email !== undefined || cambios.password !== undefined) {
      const attrs: Record<string, unknown> = {}
      if (cambios.email !== undefined) { attrs.email = cambios.email; attrs.email_confirm = true }
      if (cambios.password !== undefined) attrs.password = cambios.password
      const { error: authUpdError } = await adminClient.auth.admin.updateUserById(targetId, attrs)
      if (authUpdError) return json({ error: mensajeErrorAuth(authUpdError.message) }, 400)
    }

    // 2) El nombre.
    let nombreFallo: string | null = null
    if (cambios.full_name !== undefined) {
      const { error: nameError } = await adminClient.from('app_users').update({ full_name: cambios.full_name }).eq('id', targetId)
      if (nameError) nombreFallo = nameError.message
    }

    // 3) Auditoría (best-effort) de lo que SÍ se aplicó. Nunca lleva la contraseña.
    const aplicados = { ...cambios }
    if (nombreFallo) delete aplicados.full_name
    if (Object.keys(aplicados).length > 0) {
      const { error: auditError } = await adminClient.from('permission_audit_log').insert(
        buildUserUpdatedAudit(caller.id, targetRow, emailActual, aplicados),
      )
      if (auditError) console.error('update-user audit error:', auditError.message)
    }

    if (nombreFallo) {
      const parcial = Object.keys(aplicados).length > 0 ? ' Los datos de acceso sí se actualizaron.' : ''
      return json({ error: 'No se pudo actualizar el nombre: ' + nombreFallo + '.' + parcial }, 500)
    }

    return json({
      ok: true,
      changed,
      full_name: cambios.full_name ?? targetRow.full_name,
      email: cambios.email ?? emailActual,
    }, 200)

  } catch (err) {
    console.error('update-user error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
