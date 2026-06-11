import { describe, it, expect, vi } from 'vitest'

// auth.ts importa supabase-js desde esm.sh (runtime Deno): se mockea igual que
// en auth.test.ts para poder importar el módulo bajo vitest/node.
vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({ createClient: vi.fn() }))

describe('_shared/auth — timingSafeEqualSecret (auditoría P2 #11)', () => {
  it('true solo cuando el token coincide exactamente con el secreto', async () => {
    const { timingSafeEqualSecret } = await import('../auth.ts')
    expect(await timingSafeEqualSecret('secreto-123', 'secreto-123')).toBe(true)
    expect(await timingSafeEqualSecret('secreto-124', 'secreto-123')).toBe(false)
    expect(await timingSafeEqualSecret('secreto-12', 'secreto-123')).toBe(false)
    expect(await timingSafeEqualSecret('Secreto-123', 'secreto-123')).toBe(false)
  })

  it('vacíos o ausentes nunca autorizan (ni siquiera secreto vacío)', async () => {
    const { timingSafeEqualSecret } = await import('../auth.ts')
    expect(await timingSafeEqualSecret('', 'secreto')).toBe(false)
    expect(await timingSafeEqualSecret('secreto', '')).toBe(false)
    expect(await timingSafeEqualSecret('', '')).toBe(false)
  })

  it('longitudes muy distintas tampoco coinciden (digest de longitud fija)', async () => {
    const { timingSafeEqualSecret } = await import('../auth.ts')
    expect(await timingSafeEqualSecret('x'.repeat(500), 'x')).toBe(false)
  })
})
