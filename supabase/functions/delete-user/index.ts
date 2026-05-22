import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function getAllowedOrigins(): string[] {
  // Production domains are always allowed (independent of the ALLOWED_ORIGINS secret).
  const origins = new Set<string>([
    'https://administratodo.com',
    'https://www.administratodo.com',
    'https://administratodo.app',
    'https://www.administratodo.app',
  ])

  const envOrigins = Deno.env.get('ALLOWED_ORIGINS')
  if (envOrigins) {
    for (const o of envOrigins.split(',')) { const t = o.trim(); if (t) origins.add(t) }
  } else {
    origins.add('http://localhost:5173')
    origins.add('http://localhost:3000')
    origins.add('http://127.0.0.1:5173')
    origins.add('http://127.0.0.1:3000')
  }

  const appUrl = Deno.env.get('APP_URL')
  if (appUrl) {
    try { origins.add(new URL(appUrl).origin) } catch { /* ignore malformed APP_URL */ }
  }

  return [...origins]
}

function getCorsHeaders(origin: string | null) {
  const allowed = getAllowedOrigins()
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0]
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

function validateOrigin(origin: string | null, corsHeaders: ReturnType<typeof getCorsHeaders>) {
  const allowed = getAllowedOrigins()
  if (!origin || !allowed.includes(origin)) {
    return new Response(
      JSON.stringify({ error: 'Origin not allowed' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
  return null
}

// Roles a non-superadmin may delete. Mirrors create-user: company_owner / admin
// can manage these tiers, but never other owners or superadmins.
const DELETABLE_ROLES = ['admin', 'operator', 'operador', 'viewer', 'visor', 'collector']

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const originError = validateOrigin(origin, corsHeaders)
  if (originError) return originError

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Client with caller's JWT to verify identity and role
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser()
    if (callerError || !caller) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: callerProfile } = await callerClient
      .from('app_users')
      .select('role, company_id')
      .eq('id', caller.id)
      .single()

    const callerRole: string = (callerProfile as { role: string; company_id: string } | null)?.role ?? ''
    const callerCompanyId: string | null = (callerProfile as { role: string; company_id: string } | null)?.company_id ?? null

    const isSuperAdmin = callerRole === 'super_admin' || callerRole === 'superadmin'
    const isCompanyOwner = callerRole === 'company_owner'
    const isAdmin = callerRole === 'admin'

    if (!isSuperAdmin && !isCompanyOwner && !isAdmin) {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json() as { user_id?: string }
    const targetId = (body.user_id ?? '').trim()

    if (!targetId) {
      return new Response(JSON.stringify({ error: 'Missing user_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Never let a user delete themselves (would lock them out mid-session).
    if (targetId === caller.id) {
      return new Response(JSON.stringify({ error: 'No puedes eliminar tu propia cuenta' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Service-role client: reads the target bypassing RLS and performs the delete.
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: target, error: targetError } = await adminClient
      .from('app_users')
      .select('id, role, company_id, full_name')
      .eq('id', targetId)
      .single()

    if (targetError || !target) {
      return new Response(JSON.stringify({ error: 'Usuario no encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const targetRow = target as { id: string; role: string; company_id: string | null; full_name: string }

    // Non-superadmins: only within their own company, and never an owner/superadmin.
    if (!isSuperAdmin) {
      if (targetRow.company_id !== callerCompanyId) {
        return new Response(JSON.stringify({ error: 'No puedes eliminar usuarios de otra empresa' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (!DELETABLE_ROLES.includes(targetRow.role)) {
        return new Response(JSON.stringify({ error: 'No tienes permiso para eliminar a este usuario' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // 1) Delete the profile row. user_roles cascades; audit/author links across
    //    the schema are cleared to NULL (see migration 20260522000001).
    const { error: profileDelError } = await adminClient.from('app_users').delete().eq('id', targetId)
    if (profileDelError) {
      return new Response(JSON.stringify({ error: 'No se pudo eliminar el perfil: ' + profileDelError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2) Delete the auth login so the person can no longer sign in.
    const { error: authDelError } = await adminClient.auth.admin.deleteUser(targetId)
    if (authDelError) {
      // Profile is already gone, so the user has effectively lost access; surface
      // the partial state so an admin can retry the auth cleanup.
      return new Response(JSON.stringify({ error: 'Perfil eliminado, pero no se pudo eliminar el acceso. Intenta de nuevo. (' + authDelError.message + ')' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3) Audit (best-effort). target_user_id is intentionally null — the row is
    //    gone — so the identity is preserved in details instead.
    await adminClient.from('permission_audit_log').insert({
      actor_id: caller.id,
      target_user_id: null,
      action: 'user_deleted',
      details: {
        deleted_user_id: targetId,
        full_name: targetRow.full_name,
        role: targetRow.role,
        company_id: targetRow.company_id,
      },
    })

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('delete-user error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
