import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ════════════════════════════════════════════════════════════════════════════
// plat:P15 — Harness liviano de RBAC/RLS contra un Supabase REAL (preview/sandbox).
//
// No hay pgTAP en el proyecto, así que la verificación de RLS a nivel servidor se
// hace aquí: conecta con la anon key + JWTs de DOS usuarios de DISTINTA empresa y
// afirma, sobre las tablas/RPCs sensibles, que:
//   1. Tablas de secretos (fiscal_pac_secrets / company_payment_secrets /
//      payfac_secrets) son INACCESIBLES para authenticated y anon (deny-all,
//      service-role-only). El secreto NUNCA se proyecta al cliente.
//   2. user_sessions (store de sesiones server-side, política "No direct access")
//      es deny-all para authenticated y anon.
//   3. anon NO puede leer NINGUNA tabla de negocio sensible (no hay policy anon).
//   4. Aislamiento por TENANT: A y B (empresas distintas) ven conjuntos de
//      company_id DISJUNTOS en las tablas calientes que exponen company_id.
//   5. Aislamiento USER-scoped: cada usuario sólo ve SUS filas (user_id = auth.uid())
//      en notification_preferences / user_preferences.
//   6. NEGATIVE WRITE: A NO puede INSERT/UPDATE con company_id ajeno (RLS WITH
//      CHECK lo rechaza → no persiste nada; el harness NO siembra ni limpia).
//   7. GUARD anon/authenticated sobre los RPCs sensibles del orquestador de
//      notificaciones (#378/#380): enqueue_notification, claim_notifications_batch,
//      mark_notification_result, run_notifications_dispatcher — TODOS rechazados.
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

// UUID que NO pertenece a ninguna empresa: cualquier company_id ≠ get_my_company_id()
// hace fallar el WITH CHECK de RLS, así que sirve como "company_id ajeno" para los
// negative-write sin necesidad de conocer el company_id real de B.
const FOREIGN_COMPANY_ID = '00000000-0000-0000-0000-000000000000'

// Tablas deny-all: el secreto/credencial NUNCA se proyecta al cliente. Sólo
// service_role (BYPASSRLS) las lee desde edge functions.
const SECRET_TABLES = [
  'fiscal_pac_secrets',
  'company_payment_secrets',
  'payfac_secrets',
] as const

// anon no debe leer NINGUNA fila de estas tablas de negocio (no hay policy anon;
// las user-scoped exigen auth.uid() que para anon es NULL → 0 filas).
const ANON_DENY_TABLES = [
  'registros',
  'cuotas_condominio',
  'documentos_fiscales',
  'notifications_outbox',
  'user_invitations',
  'legal_acceptances',
  'pagos',
  'notification_preferences',
  'user_preferences',
] as const

// Tablas calientes que exponen company_id directo → aislamiento por tenant
// verificable comparando los conjuntos de company_id de A y B.
const TENANT_SCOPED_TABLES = [
  'cuotas_condominio',
  'documentos_fiscales',
  'notifications_outbox',
  'user_invitations',
] as const

// Tablas con scope POR USUARIO (no por empresa): RLS = user_id = auth.uid().
const USER_SCOPED_TABLES = ['notification_preferences', 'user_preferences'] as const

// RPCs SECURITY DEFINER del orquestador de notificaciones que en #378 quedaron
// anon-ejecutables y se cerraron en #380 (revoke por nombre de rol). El guard
// regresa-guarda esa clase de bug: anon y authenticated deben ser RECHAZADOS.
const SENSITIVE_RPCS: ReadonlyArray<{ name: string; args: Record<string, unknown> }> = [
  {
    name: 'enqueue_notification',
    args: {
      p_channel: 'in_app',
      p_recipient: 'attacker@example.com',
      p_payload: {},
      p_company_id: FOREIGN_COMPANY_ID,
      p_template_key: null,
      p_scheduled_at: null,
    },
  },
  { name: 'claim_notifications_batch', args: { p_batch_size: 1 } },
  {
    name: 'mark_notification_result',
    args: { p_id: FOREIGN_COMPANY_ID, p_ok: true, p_error: null, p_retriable: false },
  },
  { name: 'run_notifications_dispatcher', args: {} },
]

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

async function userId(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getUser()
  const id = data.user?.id
  if (!id) throw new Error('No se pudo obtener auth.uid() del cliente autenticado')
  return id
}

describe.skipIf(!ENABLED)('RLS harness (server-side, preview/sandbox)', () => {
  let anon: SupabaseClient
  let userA: SupabaseClient
  let userB: SupabaseClient
  let aId: string
  let bId: string
  // company_id propio de A, para el UPDATE negativo (re-etiquetar a tenant ajeno).
  let aOwnedCompanyId: string | null = null

  beforeAll(async () => {
    anon = freshClient()
    userA = await signedInClient(A_EMAIL!, A_PASS!)
    userB = await signedInClient(B_EMAIL!, B_PASS!)
    ;[aId, bId] = await Promise.all([userId(userA), userId(userB)])
    expect(aId, 'A y B deben ser usuarios DISTINTOS').not.toBe(bId)
    const { data } = await userA.from('cuotas_condominio').select('company_id').limit(1)
    aOwnedCompanyId = (data?.[0] as { company_id: string } | undefined)?.company_id ?? null
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

  describe('store de sesiones server-side (user_sessions) = deny-all', () => {
    // user_sessions es el store de express-session (sid/sess/expire), sin user_id;
    // su política "No direct access" lo hace deny-all para todo cliente. El
    // invariante "A no ve filas de otro usuario" se cumple de forma trivial: A no
    // ve NINGUNA fila (más fuerte que el aislamiento por usuario).
    it('authenticated (empresa A) no ve filas', async () => {
      const { data } = await userA.from('user_sessions').select('sid')
      expect(data ?? []).toHaveLength(0)
    })

    it('anon no ve filas', async () => {
      const { data } = await anon.from('user_sessions').select('sid')
      expect(data ?? []).toHaveLength(0)
    })
  })

  describe('anon no puede leer tablas de negocio', () => {
    for (const table of ANON_DENY_TABLES) {
      it(`${table}: anon obtiene 0 filas`, async () => {
        const { data } = await anon.from(table).select('id')
        expect(data ?? []).toHaveLength(0)
      })
    }
  })

  describe('aislamiento por tenant (company_id disjunto entre A y B)', () => {
    for (const table of TENANT_SCOPED_TABLES) {
      it(`${table}: A lee lo suyo sin error`, async () => {
        const { error } = await userA.from(table).select('company_id').limit(1)
        expect(error).toBeNull()
      })

      it(`${table}: A y B (empresas distintas) ven company_id DISJUNTOS`, async () => {
        const [{ data: aRows }, { data: bRows }] = await Promise.all([
          userA.from(table).select('company_id'),
          userB.from(table).select('company_id'),
        ])
        const aCos = new Set((aRows ?? []).map((r) => (r as { company_id: string }).company_id))
        const bCos = new Set((bRows ?? []).map((r) => (r as { company_id: string }).company_id))
        for (const co of bCos) {
          expect(aCos.has(co), `company_id ${co} de B no debe ser visible para A`).toBe(false)
        }
      })
    }
  })

  describe('aislamiento user-scoped (A nunca ve filas de otro usuario)', () => {
    for (const table of USER_SCOPED_TABLES) {
      it(`${table}: toda fila visible para A tiene user_id = A`, async () => {
        const { data, error } = await userA.from(table).select('user_id')
        expect(error).toBeNull()
        for (const row of data ?? []) {
          expect((row as { user_id: string }).user_id).toBe(aId)
        }
      })

      it(`${table}: los user_id que ven A y B son DISJUNTOS`, async () => {
        const [{ data: aRows }, { data: bRows }] = await Promise.all([
          userA.from(table).select('user_id'),
          userB.from(table).select('user_id'),
        ])
        const aUsers = new Set((aRows ?? []).map((r) => (r as { user_id: string }).user_id))
        const bUsers = new Set((bRows ?? []).map((r) => (r as { user_id: string }).user_id))
        for (const u of bUsers) {
          expect(aUsers.has(u), `user_id ${u} de B no debe ser visible para A`).toBe(false)
        }
      })
    }
  })

  describe('negative write (company_id ajeno → RECHAZADO, no persiste)', () => {
    // El WITH CHECK de RLS exige company_id = get_my_company_id(); cualquier
    // company_id ajeno (FOREIGN_COMPANY_ID) hace fallar el write SIN persistir.
    // Defensa: si por un bug el write se colara, intentamos borrar lo escrito.
    it('cuotas_condominio: INSERT con company_id ajeno es rechazado', async () => {
      const { data, error } = await userA
        .from('cuotas_condominio')
        .insert({
          company_id: FOREIGN_COMPANY_ID,
          project_id: FOREIGN_COMPANY_ID,
          concepto: 'mantenimiento',
          monto: 1,
          periodo: '2099-01',
          estado: 'pendiente',
        })
        .select('id')

      if (data && data.length > 0) {
        // No debería ocurrir: limpieza best-effort antes de fallar.
        const ids = data.map((r) => (r as { id: string }).id)
        await userA.from('cuotas_condominio').delete().in('id', ids)
      }
      expect(error, 'el INSERT cross-tenant debe ser rechazado por RLS').not.toBeNull()
      expect(data ?? [], 'no debe persistir ninguna fila').toHaveLength(0)
    })

    it('cuotas_condominio: UPDATE moviendo una fila propia a company_id ajeno es rechazado', async () => {
      // Re-etiquetar a un tenant ajeno viola el WITH CHECK. Si A no tiene filas,
      // el UPDATE afecta 0 filas (tampoco persiste): ambos resultados son válidos.
      const { data, error } = await userA
        .from('cuotas_condominio')
        .update({ company_id: FOREIGN_COMPANY_ID })
        .eq('company_id', aOwnedCompanyId ?? FOREIGN_COMPANY_ID)
        .select('id')

      const rejected = error !== null || (data ?? []).length === 0
      expect(rejected, 'el UPDATE cross-tenant no debe re-etiquetar filas').toBe(true)
    })

    it('documentos_fiscales: INSERT con company_id ajeno es rechazado', async () => {
      const { data, error } = await userA
        .from('documentos_fiscales')
        .insert({ company_id: FOREIGN_COMPANY_ID, regimen: 'general', tipo: 'factura' })
        .select('id')

      if (data && data.length > 0) {
        const ids = data.map((r) => (r as { id: string }).id)
        await userA.from('documentos_fiscales').delete().in('id', ids)
      }
      expect(error, 'el INSERT cross-tenant debe ser rechazado').not.toBeNull()
      expect(data ?? [], 'no debe persistir ninguna fila').toHaveLength(0)
    })
  })

  describe('guard anon: RPCs sensibles de notificaciones (#378/#380) RECHAZADOS', () => {
    for (const { name, args } of SENSITIVE_RPCS) {
      it(`anon NO puede ejecutar ${name}`, async () => {
        const { data, error } = await anon.rpc(name, args)
        // Rechazo = error presente (permission denied / función no visible /
        // PGRST). NUNCA debe devolver un resultado exitoso.
        expect(error, `anon no debe poder invocar ${name}`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos a anon`).toBeNull()
      })

      it(`authenticated (empresa A) NO puede ejecutar ${name}`, async () => {
        const { data, error } = await userA.rpc(name, args)
        expect(error, `authenticated no debe poder invocar ${name}`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos a authenticated`).toBeNull()
      })
    }
  })
})

// Marcador visible cuando el harness se omite por falta de credenciales: deja
// constancia en el reporte de que NO se verificó RLS server-side (vs. un archivo
// sin tests, que pasaría inadvertido).
describe.runIf(!ENABLED)('RLS harness (server-side)', () => {
  it.skip('omitido — define RLS_SUPABASE_URL/ANON_KEY + RLS_USER_A/B_* (ver README)', () => {})
})
