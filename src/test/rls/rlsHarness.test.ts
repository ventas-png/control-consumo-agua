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
  // Bóveda WhatsApp por tenant (#611): deny-all "Deny access to all", el
  // access_token de Meta nunca se proyecta al cliente (la metadata no sensible
  // sale por el RPC whatsapp_estatus). Auditoría 2026-07-16, S5.
  'company_whatsapp_configs',
  // No es un secreto, pero es deny-all por diseño: el folio correlativo de
  // pólizas solo lo asignan las funciones SECURITY DEFINER al publicar.
  'conta_folios',
] as const

// Tablas con RLS habilitada pero SIN policy de SELECT: solo service_role
// (BYPASSRLS) las lee. Para authenticated Y anon el SELECT devuelve 0 filas.
// payment_requests guarda el camino de dinero del pago en línea; sus filas
// nunca deben proyectarse a un cliente (auditoría 2026-07-16, S5).
const NO_SELECT_TABLES = ['payment_requests'] as const

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
  // Tablas de julio 2026 (auditoría 2026-07-16, S5): portal residente, log de
  // recordatorios de cobranza, config de email OAuth por tenant, y el camino
  // de dinero del pago en línea. Ninguna tiene policy para anon → 0 filas.
  'unidad_residentes',
  'cuota_recordatorios_log',
  'company_email_configs',
  'payment_requests',
  // ERP financiero (fases 1–5): catálogo, pólizas, CxP, presupuesto, bancos.
  'conta_cuentas',
  'conta_asientos',
  'conta_asiento_lineas',
  'conta_mapeo_cuentas',
  'conta_tipos_cambio',
  'conta_cierres_anuales',
  'proveedores',
  'facturas_proveedor',
  'ordenes_pago',
  'presupuestos',
  'presupuesto_partidas',
  'cuentas_bancarias',
  'banco_movimientos',
  // Auditoría 2026-07-28 (Bloque A · PR-1): `fuentes_agua` tenía 8 policies pero
  // NINGUNA migración le encendía RLS, así que eran código muerto y `anon` podía
  // leerla y escribirla entera. `empresa` no tenía ni RLS ni policy. Ambas se
  // cierran en 20260729000000; estas aserciones son el regresa-guarda.
  'fuentes_agua',
  'empresa',
] as const

// Tablas calientes que exponen company_id directo → aislamiento por tenant
// verificable comparando los conjuntos de company_id de A y B.
const TENANT_SCOPED_TABLES = [
  'cuotas_condominio',
  'documentos_fiscales',
  'notifications_outbox',
  'user_invitations',
  // ERP financiero: el dinero es lo más sensible al cross-tenant.
  'conta_cuentas',
  'conta_asientos',
  'proveedores',
  'facturas_proveedor',
  'presupuestos',
  'cuentas_bancarias',
  'banco_movimientos',
  // Tablas de julio 2026 con company_id directo (auditoría 2026-07-16, S5):
  // el portal de residentes y la config de email OAuth por tenant.
  'unidad_residentes',
  'company_email_configs',
  // Auditoría 2026-07-28 (Bloque A · PR-1): sus policies ya acotaban por
  // `company_id = get_my_company_id()`, pero sin RLS encendida no se evaluaban.
  // (`empresa` NO va aquí: no tiene columna de tenant — ver 20260729000000.)
  'fuentes_agua',
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

// RPCs del ERP financiero: anon DEBE ser rechazado siempre (REVOKE FROM anon).
// Para authenticated solo probamos las que reciben un id inexistente (fallan con
// "no encontrado"/"no autorizado" SIN efectos secundarios posibles); el cierre
// anual se omite para authenticated porque un admin legítimo SÍ puede ejecutarlo.
const ERP_RPCS_ANON: ReadonlyArray<{ name: string; args: Record<string, unknown> }> = [
  { name: 'conta_publicar_asiento', args: { p_asiento_id: FOREIGN_COMPANY_ID } },
  { name: 'conta_anular_asiento', args: { p_asiento_id: FOREIGN_COMPANY_ID, p_motivo: null } },
  { name: 'conta_cierre_anual', args: { p_anio: 2000 } },
  {
    name: 'banco_conciliar_movimiento',
    args: { p_movimiento_id: FOREIGN_COMPANY_ID, p_match_tipo: 'pago', p_match_id: FOREIGN_COMPANY_ID },
  },
  { name: 'banco_desconciliar_movimiento', args: { p_movimiento_id: FOREIGN_COMPANY_ID } },
  { name: 'banco_ajuste_conciliacion', args: { p_movimiento_id: FOREIGN_COMPANY_ID, p_descripcion: null } },
]

const ERP_RPCS_AUTH_SIN_EFECTOS = ERP_RPCS_ANON.filter((r) => r.name !== 'conta_cierre_anual')

// RPCs de estatus de las bóvedas (metadata NO sensible): REVOKE FROM PUBLIC, anon
// (whatsapp_estatus explícito; payfac/fiscal por el mismo patrón). anon SIEMPRE
// rechazado. Regresa-guarda el fail-open trivaluado que el equipo cazó en #611
// (guards IF NOT con helpers NULL exponían metadata de cualquier tenant).
// Auditoría 2026-07-16, S5.
const ESTATUS_RPCS_ANON: ReadonlyArray<{ name: string; args: Record<string, unknown> }> = [
  { name: 'whatsapp_estatus', args: { p_company_id: FOREIGN_COMPANY_ID } },
  { name: 'payfac_estatus', args: { p_company_id: FOREIGN_COMPANY_ID } },
  { name: 'fiscal_pac_estatus', args: { p_company_id: FOREIGN_COMPANY_ID } },
]

// RPCs del self-service del propietario (20260822000000): SECURITY DEFINER con
// REVOKE FROM public, anon. anon SIEMPRE rechazado. Para authenticated, las de
// escritura con una unidad AJENA (FOREIGN_COMPANY_ID) deben fallar por el guard
// interno (rol ≠ cliente o unidad no propia) SIN efectos secundarios.
const PORTAL_INQUILINO_RPCS_ANON: ReadonlyArray<{ name: string; args: Record<string, unknown> }> = [
  { name: 'portal_mis_unidades', args: {} },
  { name: 'portal_inquilinos_de_unidad', args: { p_unidad_id: FOREIGN_COMPANY_ID } },
  {
    name: 'portal_registrar_inquilino',
    args: {
      p_unidad_id: FOREIGN_COMPANY_ID,
      p_nombre: 'Intruso RLS',
      p_email: 'intruso-rls@example.com',
      p_cui_dui: '0000000000000',
      p_fecha_nacimiento: '2000-01-01',
      p_telefono: null,
    },
  },
  {
    name: 'portal_quitar_inquilino',
    args: { p_unidad_id: FOREIGN_COMPANY_ID, p_cliente_id: FOREIGN_COMPANY_ID },
  },
]

const PORTAL_INQUILINO_RPCS_ESCRITURA = PORTAL_INQUILINO_RPCS_ANON.filter((r) =>
  ['portal_registrar_inquilino', 'portal_quitar_inquilino'].includes(r.name),
)

// RPCs de reservas del portal (20260822030000): SECURITY DEFINER, REVOKE FROM
// public/anon. anon SIEMPRE rechazado; authenticated (usuarios A/B del harness)
// rechazado por el guard interno (unidad/reserva inexistente o ajena) SIN
// efectos secundarios.
const PORTAL_RESERVAS_RPCS: ReadonlyArray<{ name: string; args: Record<string, unknown> }> = [
  {
    name: 'portal_reservar_amenidad',
    args: {
      p_amenidad_id: FOREIGN_COMPANY_ID,
      p_unidad_id: FOREIGN_COMPANY_ID,
      p_fecha: '2099-01-01',
      p_hora_inicio: '10:00',
      p_hora_fin: '11:00',
      p_num_invitados: 0,
      p_notas: null,
      p_metodo_pago: null,
      p_reglamento_aceptado: false,
    },
  },
  { name: 'portal_cancelar_reserva', args: { p_reserva_id: FOREIGN_COMPANY_ID } },
]

// RPCs de accesos familiares (20260825000000): mismo contrato que los de
// inquilinos — anon SIEMPRE rechazado (REVOKE); authenticated sobre una unidad
// ajena rechazado por el guard interno SIN efectos secundarios.
const PORTAL_FAMILIARES_RPCS: ReadonlyArray<{ name: string; args: Record<string, unknown> }> = [
  {
    name: 'portal_registrar_familiar',
    args: {
      p_unidad_id: FOREIGN_COMPANY_ID,
      p_nombre: 'Intruso RLS',
      p_email: 'intruso-familiar-rls@example.com',
      p_cui_dui: '0000000000001',
      p_fecha_nacimiento: '2000-01-01',
      p_telefono: null,
    },
  },
  { name: 'portal_quitar_familiar', args: { p_unidad_id: FOREIGN_COMPANY_ID, p_cliente_id: FOREIGN_COMPANY_ID } },
  { name: 'portal_accesos_de_unidad', args: { p_unidad_id: FOREIGN_COMPANY_ID } },
  // Baja de la autorización de renta (20260827000000): mismo contrato de guard.
  { name: 'portal_baja_renta', args: { p_unidad_id: FOREIGN_COMPANY_ID } },
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

  describe('tablas sin policy de SELECT = deny-all para el cliente', () => {
    for (const table of NO_SELECT_TABLES) {
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

    it('conta_cuentas: INSERT con company_id ajeno es rechazado (ERP)', async () => {
      const { data, error } = await userA
        .from('conta_cuentas')
        .insert({
          company_id: FOREIGN_COMPANY_ID,
          codigo: '9999-RLS',
          nombre: 'Cuenta intrusa',
          tipo: 'activo',
          naturaleza: 'deudora',
          nivel: 1,
        })
        .select('id')

      if (data && data.length > 0) {
        const ids = data.map((r) => (r as { id: string }).id)
        await userA.from('conta_cuentas').delete().in('id', ids)
      }
      expect(error, 'el INSERT cross-tenant debe ser rechazado').not.toBeNull()
      expect(data ?? [], 'no debe persistir ninguna fila').toHaveLength(0)
    })

    it('conta_asientos: INSERT directo con estado publicado es rechazado (guard de BD)', async () => {
      // Aunque el tenant fuera el propio, publicar SIN la RPC debe fallar por el
      // trigger conta_proteger_asiento (CONTA_PUBLICAR_RPC).
      const { data, error } = await userA
        .from('conta_asientos')
        .insert({
          company_id: aOwnedCompanyId ?? FOREIGN_COMPANY_ID,
          fecha: '2099-01-01',
          tipo: 'diario',
          concepto: 'Intento de publicación directa',
          estado: 'publicado',
          origen: 'manual',
          moneda_base: 'GTQ',
        })
        .select('id')

      if (data && data.length > 0) {
        const ids = data.map((r) => (r as { id: string }).id)
        await userA.from('conta_asientos').delete().in('id', ids)
      }
      expect(error, 'publicar sin la RPC debe ser rechazado').not.toBeNull()
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

  describe('guard RPCs del ERP financiero (REVOKE anon + validación interna)', () => {
    for (const { name, args } of ERP_RPCS_ANON) {
      it(`anon NO puede ejecutar ${name}`, async () => {
        const { data, error } = await anon.rpc(name, args)
        expect(error, `anon no debe poder invocar ${name}`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos a anon`).toBeNull()
      })
    }

    // authenticated con un id INEXISTENTE: la RPC debe fallar ("no encontrado"
    // o "no autorizado") sin efectos. conta_cierre_anual se excluye porque un
    // admin legítimo SÍ puede ejecutarlo (sería un falso positivo).
    for (const { name, args } of ERP_RPCS_AUTH_SIN_EFECTOS) {
      it(`authenticated con id inexistente NO obtiene éxito de ${name}`, async () => {
        const { data, error } = await userA.rpc(name, args)
        expect(error, `${name} con id inexistente debe fallar`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos`).toBeNull()
      })
    }
  })

  describe('guard anon: RPCs de estatus de bóvedas (#611) RECHAZADOS', () => {
    for (const { name, args } of ESTATUS_RPCS_ANON) {
      it(`anon NO puede ejecutar ${name}`, async () => {
        const { data, error } = await anon.rpc(name, args)
        expect(error, `anon no debe poder invocar ${name}`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos a anon`).toBeNull()
      })
    }

    // authenticated de la empresa A pidiendo la metadata de un tenant AJENO
    // (FOREIGN_COMPANY_ID): el guard fail-closed debe negar — nunca metadata
    // cross-tenant, aun con claims válidos. Esto cubre el bug trivaluado de #611.
    for (const { name } of ESTATUS_RPCS_ANON) {
      it(`authenticated (A) NO obtiene metadata de un tenant ajeno vía ${name}`, async () => {
        const { data, error } = await userA.rpc(name, { p_company_id: FOREIGN_COMPANY_ID })
        const negado = error !== null || (data ?? []).length === 0
        expect(negado, `${name} no debe exponer metadata de otro tenant`).toBe(true)
      })
    }
  })

  describe('guard RPCs del self-service de inquilinos (20260822000000)', () => {
    for (const { name, args } of PORTAL_INQUILINO_RPCS_ANON) {
      it(`anon NO puede ejecutar ${name}`, async () => {
        const { data, error } = await anon.rpc(name, args)
        expect(error, `anon no debe poder invocar ${name}`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos a anon`).toBeNull()
      })
    }

    // authenticated apuntando a una unidad AJENA: el guard interno (rol cliente +
    // unidad propia + renta aprobada) debe rechazar las escrituras sin efectos.
    for (const { name, args } of PORTAL_INQUILINO_RPCS_ESCRITURA) {
      it(`authenticated (A) NO puede ejecutar ${name} sobre una unidad ajena`, async () => {
        const { data, error } = await userA.rpc(name, args)
        expect(error, `${name} sobre unidad ajena debe fallar`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos`).toBeNull()
      })
    }

    // portal_inquilinos_de_unidad es de lectura: con unidad ajena devuelve 0
    // filas (el predicado "unidad propia" filtra), nunca residentes de otro.
    it('authenticated (A) NO lista inquilinos de una unidad ajena', async () => {
      const { data, error } = await userA.rpc('portal_inquilinos_de_unidad', {
        p_unidad_id: FOREIGN_COMPANY_ID,
      })
      const negado = error !== null || (data ?? []).length === 0
      expect(negado, 'portal_inquilinos_de_unidad no debe exponer residentes ajenos').toBe(true)
    })
  })

  describe('guard RPCs de reservas del portal (20260822030000)', () => {
    for (const { name, args } of PORTAL_RESERVAS_RPCS) {
      it(`anon NO puede ejecutar ${name}`, async () => {
        const { data, error } = await anon.rpc(name, args)
        expect(error, `anon no debe poder invocar ${name}`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos a anon`).toBeNull()
      })

      it(`authenticated (A) NO puede ejecutar ${name} sobre ids ajenos`, async () => {
        const { data, error } = await userA.rpc(name, args)
        expect(error, `${name} sobre ids ajenos debe fallar`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos`).toBeNull()
      })
    }
  })

  describe('guard RPCs de accesos familiares (20260825000000)', () => {
    for (const { name, args } of PORTAL_FAMILIARES_RPCS) {
      it(`anon NO puede ejecutar ${name}`, async () => {
        const { data, error } = await anon.rpc(name, args)
        expect(error, `anon no debe poder invocar ${name}`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos a anon`).toBeNull()
      })
    }

    // Escrituras con unidad AJENA: el guard interno (rol cliente + unidad
    // propia) debe rechazar sin efectos.
    for (const { name, args } of PORTAL_FAMILIARES_RPCS.filter((r) =>
      ['portal_registrar_familiar', 'portal_quitar_familiar', 'portal_baja_renta'].includes(r.name),
    )) {
      it(`authenticated (A) NO puede ejecutar ${name} sobre una unidad ajena`, async () => {
        const { data, error } = await userA.rpc(name, args)
        expect(error, `${name} sobre unidad ajena debe fallar`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos`).toBeNull()
      })
    }

    // portal_accesos_de_unidad es de lectura: con unidad ajena devuelve 0 filas.
    it('authenticated (A) NO lista accesos de una unidad ajena', async () => {
      const { data, error } = await userA.rpc('portal_accesos_de_unidad', {
        p_unidad_id: FOREIGN_COMPANY_ID,
      })
      const negado = error !== null || (data ?? []).length === 0
      expect(negado, 'portal_accesos_de_unidad no debe exponer accesos ajenos').toBe(true)
    })
  })
})

// Marcador visible cuando el harness se omite por falta de credenciales: deja
// constancia en el reporte de que NO se verificó RLS server-side (vs. un archivo
// sin tests, que pasaría inadvertido).
describe.runIf(!ENABLED)('RLS harness (server-side)', () => {
  it.skip('omitido — define RLS_SUPABASE_URL/ANON_KEY + RLS_USER_A/B_* (ver README)', () => {})
})
