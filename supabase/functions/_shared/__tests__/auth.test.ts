import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Deno global for vitest
beforeEach(() => {
  ;(globalThis as unknown as { Deno: { env: { get: (k: string) => string | undefined } } }).Deno = {
    env: {
      get: (k: string) => {
        if (k === 'SUPABASE_URL') return 'https://test.supabase.co'
        if (k === 'SUPABASE_ANON_KEY') return 'anon-test-key'
        if (k === 'SUPABASE_SERVICE_ROLE_KEY') return 'service-role-test-key'
        return undefined
      },
    },
  }
})

// Mock the esm.sh supabase import
vi.mock('https://esm.sh/@supabase/supabase-js@2', () => {
  // Allow the test to override behavior per-call.
  return {
    createClient: vi.fn(() => mockClient),
  }
})

// Shared mock client — tests reassign properties before each call.
let mockClient: {
  auth: { getUser: () => Promise<{ data: { user: unknown | null }; error: unknown }> }
  from: (table: string) => { select: () => { eq: () => { single: () => Promise<{ data: unknown; error: unknown }> } } }
}

beforeEach(() => {
  mockClient = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  }
})

const corsHeaders = { 'Access-Control-Allow-Origin': '*' }

describe('_shared/auth — getUserOrNull', () => {
  it('retorna null si no hay header Authorization', async () => {
    const { getUserOrNull } = await import('../auth.ts')
    const req = new Request('http://localhost/test')
    const result = await getUserOrNull(req, corsHeaders)
    expect(result).toBeNull()
  })

  it('retorna null si getUser falla', async () => {
    const { getUserOrNull } = await import('../auth.ts')
    mockClient.auth.getUser = vi.fn().mockResolvedValue({
      data: { user: null }, error: { message: 'invalid' },
    })
    const req = new Request('http://localhost/test', { headers: { Authorization: 'Bearer bad' } })
    const result = await getUserOrNull(req, corsHeaders)
    expect(result).toBeNull()
  })

  it('retorna { user, client } si el JWT es valido', async () => {
    const { getUserOrNull } = await import('../auth.ts')
    const fakeUser = { id: 'u-1', email: 'a@b.com' }
    mockClient.auth.getUser = vi.fn().mockResolvedValue({
      data: { user: fakeUser }, error: null,
    })
    const req = new Request('http://localhost/test', { headers: { Authorization: 'Bearer good' } })
    const result = await getUserOrNull(req, corsHeaders)
    expect(result).not.toBeNull()
    expect(result?.user).toEqual(fakeUser)
  })
})

describe('_shared/auth — requireUser', () => {
  it('devuelve Response 401 si falta Authorization', async () => {
    const { requireUser } = await import('../auth.ts')
    const req = new Request('http://localhost/test')
    const result = await requireUser(req, corsHeaders)
    expect('response' in result).toBe(true)
    if ('response' in result) {
      expect(result.response.status).toBe(401)
      const body = await result.response.json()
      expect(body.error).toContain('Missing Authorization')
    }
  })

  it('devuelve Response 401 si getUser falla', async () => {
    const { requireUser } = await import('../auth.ts')
    mockClient.auth.getUser = vi.fn().mockResolvedValue({
      data: { user: null }, error: { message: 'invalid' },
    })
    const req = new Request('http://localhost/test', { headers: { Authorization: 'Bearer bad' } })
    const result = await requireUser(req, corsHeaders)
    expect('response' in result).toBe(true)
    if ('response' in result) {
      expect(result.response.status).toBe(401)
      const body = await result.response.json()
      expect(body.error).toContain('Invalid or expired')
    }
  })

  it('devuelve { user, client } si el JWT es valido', async () => {
    const { requireUser } = await import('../auth.ts')
    const fakeUser = { id: 'u-1' }
    mockClient.auth.getUser = vi.fn().mockResolvedValue({
      data: { user: fakeUser }, error: null,
    })
    const req = new Request('http://localhost/test', { headers: { Authorization: 'Bearer good' } })
    const result = await requireUser(req, corsHeaders)
    expect('user' in result).toBe(true)
    if ('user' in result) {
      expect(result.user).toEqual(fakeUser)
    }
  })
})

describe('_shared/auth — requireRole', () => {
  it('falla 401 si no hay JWT', async () => {
    const { requireRole } = await import('../auth.ts')
    const req = new Request('http://localhost/test')
    const result = await requireRole(req, corsHeaders, ['admin'])
    expect('response' in result).toBe(true)
    if ('response' in result) {
      expect(result.response.status).toBe(401)
    }
  })

  it('falla 403 si el rol no esta en la whitelist', async () => {
    const { requireRole } = await import('../auth.ts')
    mockClient.auth.getUser = vi.fn().mockResolvedValue({
      data: { user: { id: 'u-1' } }, error: null,
    })
    mockClient.from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { role: 'operator' }, error: null }),
        }),
      }),
    })
    const req = new Request('http://localhost/test', { headers: { Authorization: 'Bearer good' } })
    const result = await requireRole(req, corsHeaders, ['admin', 'owner'])
    expect('response' in result).toBe(true)
    if ('response' in result) {
      expect(result.response.status).toBe(403)
      const body = await result.response.json()
      expect(body.error).toContain('Forbidden')
      expect(body.error).toContain('admin')
    }
  })

  it('pasa si el rol matchea', async () => {
    const { requireRole } = await import('../auth.ts')
    mockClient.auth.getUser = vi.fn().mockResolvedValue({
      data: { user: { id: 'u-1' } }, error: null,
    })
    mockClient.from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
        }),
      }),
    })
    const req = new Request('http://localhost/test', { headers: { Authorization: 'Bearer good' } })
    const result = await requireRole(req, corsHeaders, ['admin', 'owner'])
    expect('user' in result).toBe(true)
    if ('user' in result) {
      expect(result.role).toBe('admin')
    }
  })

  it('falla 403 si no se encuentra perfil en app_users', async () => {
    const { requireRole } = await import('../auth.ts')
    mockClient.auth.getUser = vi.fn().mockResolvedValue({
      data: { user: { id: 'u-1' } }, error: null,
    })
    mockClient.from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
        }),
      }),
    })
    const req = new Request('http://localhost/test', { headers: { Authorization: 'Bearer good' } })
    const result = await requireRole(req, corsHeaders, ['admin'])
    expect('response' in result).toBe(true)
    if ('response' in result) {
      expect(result.response.status).toBe(403)
      const body = await result.response.json()
      expect(body.error).toContain('User profile not found')
    }
  })
})
