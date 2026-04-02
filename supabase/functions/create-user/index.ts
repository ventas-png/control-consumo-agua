import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Restrict CORS to the configured allowed origin.
// Set ALLOWED_ORIGIN in Supabase Edge Function secrets (e.g. https://your-app.vercel.app).
// Falls back to no wildcard — requests without a matching Origin are rejected.
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? ''

function corsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin = (ALLOWED_ORIGIN && requestOrigin === ALLOWED_ORIGIN)
    ? ALLOWED_ORIGIN
    : (ALLOWED_ORIGIN || 'null') // deny unrecognised origins
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

// All roles that may exist in app_users. super_admin can assign any of these;
// company_owner is limited to a subset enforced below.
const VALID_ROLES = new Set([
  'admin', 'operator', 'operador', 'viewer', 'visor', 'cliente', 'company_owner',
])

// Roles a company_owner is allowed to create
const OWNER_ALLOWED_ROLES = new Set(['admin', 'operator', 'operador', 'viewer', 'visor'])

function validatePassword(password: string): string | null {
  if (!password || password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.'
  if (password.length > 128) return 'La contraseña es demasiado larga.'
  if (!/[a-zA-Z]/.test(password)) return 'La contraseña debe contener al menos una letra.'
  if (!/[0-9]/.test(password)) return 'La contraseña debe contener al menos un número.'
  return null
}

Deno.serve(async (req) => {
  const requestOrigin = req.headers.get('Origin')
  const cors = corsHeaders(requestOrigin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  try {
    // Validate caller using their JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Client with caller's JWT to check their role
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser()
    if (callerError || !caller) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Get caller's role from app_users
    const { data: callerProfile } = await callerClient
      .from('app_users')
      .select('role, company_id')
      .eq('id', caller.id)
      .single()

    const callerRole: string = (callerProfile as { role: string; company_id: string } | null)?.role ?? ''
    const callerCompanyId: string | null = (callerProfile as { role: string; company_id: string } | null)?.company_id ?? null

    const isSuperAdmin = callerRole === 'super_admin' || callerRole === 'superadmin'
    const isCompanyOwner = callerRole === 'company_owner'

    if (!isSuperAdmin && !isCompanyOwner) {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
        status: 403, headers: { ...cors, 'Content-Type': 'application/json' },
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
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Validate input lengths
    if (email.length > 254 || full_name.length > 200 || company_id.length > 36) {
      return new Response(JSON.stringify({ error: 'Invalid input length' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Enforce role allowlist — prevents assigning arbitrary/unknown roles
    if (!VALID_ROLES.has(role)) {
      return new Response(JSON.stringify({ error: 'Invalid role' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Validate password strength
    const pwdError = validatePassword(password)
    if (pwdError) {
      return new Response(JSON.stringify({ error: pwdError }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Company owners can only create admins/operators/viewers in their own company
    if (isCompanyOwner) {
      if (!OWNER_ALLOWED_ROLES.has(role)) {
        return new Response(JSON.stringify({ error: 'Company owners can only create admin/operator/viewer users' }), {
          status: 403, headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
      if (company_id !== callerCompanyId) {
        return new Response(JSON.stringify({ error: 'Cannot create users for other companies' }), {
          status: 403, headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }
    }

    // Admin client with service role to create auth user
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password,
      email_confirm: true,
    })

    if (createError || !newUser.user) {
      return new Response(JSON.stringify({ error: createError?.message ?? 'Failed to create auth user' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Insert app_users profile
    const { error: profileError } = await adminClient.from('app_users').insert({
      id: newUser.user.id,
      full_name: full_name.trim(),
      role,
      company_id,
      activo: true,
    })

    if (profileError) {
      // Rollback: delete the auth user we just created
      await adminClient.auth.admin.deleteUser(newUser.user.id)
      return new Response(JSON.stringify({ error: 'Failed to create user profile: ' + profileError.message }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ user_id: newUser.user.id }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    // Never leak internal error details to the client
    console.error('create-user error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders(req.headers.get('Origin')), 'Content-Type': 'application/json' },
    })
  }
})
