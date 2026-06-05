import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ════════════════════════════════════════════════════════════════════════════
// plat:P15 — Harness liviano de RBAC/RLS contra un Supabase REAL (preview/sandbox).
//
// No hay pgTAP en el proyecto, así que la verificación de RLS a nivel servidor se
// hace aquí: conecta con la anon key + JWTs de DOS usuarios de DISTINTA empresa y
// afirma, sobre las tablas sensibles, que:
//   1. fiscal_pac_secrets / company_payment_secrets son INACCESIBLES para
//      authenticated y anon (patrón "deny-all, service-role-only"). El secreto
//      NUNCA se proyecta al cliente.
//   2. anon NO puede leer registros ni cuotas_condominio (no hay policy para anon).
//   3. cuotas_condominio está aislada por tenant: el usuario A y el usuario B (de
//      empresas distintas) ven conjuntos de company_id DISJUNTOS.
//
// CREDENCIAL-GATED: si faltan las env vars NO se crea ningún cliente ni se hace
// red — el bloque se SKIPEA (CI verde sin secretos). Para correrlo, exporta:
//   RLS_SUPABASE_URL, RLS_SUPABASE_ANON_KEY,
//   RLS_USER_A_EMAIL, RLS_USER_A_PASSWORD,   (empresa A)
//   RLS_USER_B_EMAIL, RLS_USER_B_PASSWORD    (empresa B, distinta de A)
// apuntando al preview branch del PR o a un sandbox — NUNCA a producción.
// Ver src/test/rls/README.md.
// ════════════════════════════════════════════════════════════════════════════

const URL = process.env.RLS_SUPABASE_URL
const ANON = process.env.RLS_SUPABASE_ANON_KEY
const A_EMAIL = process.env.RLS_USER_A_EMAIL
const A_PASS = process.env.RLS_USER_A_PASSWORD
const B_EMAIL = process.env.RLS_USER_B_EMAIL
const B_PASS = process.env.RLS_USER_B_PASSWORD

const ENABLED = Boolean(URL && ANON && A_EMAIL && A_PASS && B_EMAIL && B_PASS)

const SECRET_TABLES = ['fiscal_pac_secrets', 'company_payment_secrets'] as const

function freshClient(): SupabaseClient {
  return createClient(URL!, ANON!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function signedInClient(email: string, password: string): Promise<SupabaseClient> {
  const client = freshClient()
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`No se pudo autenticar ${email}: ${error.message}`)
  return client
}

describe.skipIf(!ENABLED)('RLS harness (server-side, preview/sandbox)', () => {
  let anon: SupabaseClient
  let userA: SupabaseClient
  let userB: SupabaseClient

  beforeAll(async () => {
    anon = freshClient()
    userA = await signedInClient(A_EMAIL!, A_PASS!)
    userB = await signedInClient(B_EMAIL!, B_PASS!)
  })

  afterAll(async () => {
    await Promise.allSettled([userA?.auth.signOut(), userB?.auth.signOut()])
  })

  describe('tablas de secretos = deny-all (nunca al cliente)', () => {
    for (const table of SECRET_TABLES) {
      it(`${table}: authenticated (empresa A) no ve filas`, async () => {
        const { data } = await userA.from(table).select('*')
        expect(data ?? []).toHaveLength(0)
      })

      it(`${table}: anon no ve filas`, async () => {
        const { data } = await anon.from(table).select('*')
        expect(data ?? []).toHaveLength(0)
      })
    }
  })

  describe('anon no puede leer tablas de negocio', () => {
    for (const table of ['registros', 'cuotas_condominio'] as const) {
      it(`${table}: anon obtiene 0 filas`, async () => {
        const { data } = await anon.from(table).select('id')
        expect(data ?? []).toHaveLength(0)
      })
    }
  })

  describe('aislamiento por tenant (cuotas_condominio)', () => {
    it('A puede leer sus cuotas sin error', async () => {
      const { error } = await userA.from('cuotas_condominio').select('id').limit(1)
      expect(error).toBeNull()
    })

    it('A y B (empresas distintas) ven company_id DISJUNTOS', async () => {
      const [{ data: aRows }, { data: bRows }] = await Promise.all([
        userA.from('cuotas_condominio').select('company_id'),
        userB.from('cuotas_condominio').select('company_id'),
      ])
      const aCos = new Set((aRows ?? []).map((r) => (r as { company_id: string }).company_id))
      const bCos = new Set((bRows ?? []).map((r) => (r as { company_id: string }).company_id))
      for (const co of bCos) {
        expect(aCos.has(co), `company_id ${co} de B no debe ser visible para A`).toBe(false)
      }
    })
  })
})

// Marcador visible cuando el harness se omite por falta de credenciales: deja
// constancia en el reporte de que NO se verificó RLS server-side (vs. un archivo
// sin tests, que pasaría inadvertido).
describe.runIf(!ENABLED)('RLS harness (server-side)', () => {
  it.skip('omitido — define RLS_SUPABASE_URL/ANON_KEY + RLS_USER_A/B_* (ver README)', () => {})
})
