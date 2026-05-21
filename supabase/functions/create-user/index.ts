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

  // Always allow the configured public app URL so production CORS works even
  // when ALLOWED_ORIGINS is unset (APP_URL is already set for Google OAuth).
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
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

    const body = await req.json() as {
      email: string
      password: string
      full_name: string
      role: string
      company_id: string
    }

    const { email, password, full_name, role, company_id } = body

    if (!email || !password || !full_name || !role || !company_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Non-superadmins can only create users within their own company
    const allowedRolesForNonSuper = ['admin', 'operator', 'operador', 'viewer', 'visor', 'collector']
    if (!isSuperAdmin) {
      if (!allowedRolesForNonSuper.includes(role)) {
        return new Response(JSON.stringify({ error: 'Solo puedes crear usuarios con rol admin/operador/visualizador/cobros' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (company_id !== callerCompanyId) {
        return new Response(JSON.stringify({ error: 'No puedes crear usuarios para otra empresa' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (createError || !newUser.user) {
      return new Response(JSON.stringify({ error: createError?.message ?? 'Failed to create auth user' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { error: profileError } = await adminClient.from('app_users').insert({
      id: newUser.user.id,
      full_name,
      role,
      company_id,
      activo: true,
    })

    if (profileError) {
      await adminClient.auth.admin.deleteUser(newUser.user.id)
      return new Response(JSON.stringify({ error: 'Failed to create user profile: ' + profileError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Assign the matching platform system role in user_roles (RBAC).
    // Mirrors the mapping in migration 20260518000013_rbac_platform_modules.sql.
    const PLATFORM_ROLE_ID: Record<string, string> = {
      admin:     '00000000-0000-0000-0000-000000000201',
      operator:  '00000000-0000-0000-0000-000000000202',
      operador:  '00000000-0000-0000-0000-000000000202',
      viewer:    '00000000-0000-0000-0000-000000000203',
      visor:     '00000000-0000-0000-0000-000000000203',
      collector: '00000000-0000-0000-0000-000000000204',
    }
    const platformRoleId = PLATFORM_ROLE_ID[role]
    if (platformRoleId) {
      const { error: roleError } = await adminClient.from('user_roles').insert({
        user_id:     newUser.user.id,
        role_id:     platformRoleId,
        assigned_by: caller.id,
      })
      if (roleError) {
        // Roll back to avoid leaving an orphan user with no permissions
        await adminClient.from('app_users').delete().eq('id', newUser.user.id)
        await adminClient.auth.admin.deleteUser(newUser.user.id)
        return new Response(JSON.stringify({ error: 'Failed to assign platform role: ' + roleError.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }
    // Note: super_admin / company_owner / cliente do not get a platform role —
    // they bypass RBAC checks via EXEMPT_ROLES in moduleConfig.ts.

    return new Response(JSON.stringify({ user_id: newUser.user.id }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('create-user error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
