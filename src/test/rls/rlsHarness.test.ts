import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  TENANT_SCOPED_NO_TRIVIALES,
  TENANT_SCOPED_ESTRUCTURALES,
  FIXTURES,
  idEvidencia,
} from './coverage'
// Guard de destino: la MISMA validación que usan el seed y el preflight del
// workflow, repetida aquí como defensa en profundidad. Vive en su propio módulo
// para poder probarla sin importar este archivo de pruebas desde otro.
import { exigirDestinoDeclarado } from './destino'

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
//      Se distinguen DOS niveles (ver ./coverage.json, compartido con el seed):
//        · NO TRIVIAL   — el seed garantiza filas de las dos empresas, así que
//          aquí se EXIGE que ambos conjuntos sean NO VACÍOS antes de compararlos.
//          Sin esa exigencia, dos conjuntos vacíos hacen que el bucle de
//          disjunción no itere y el test pase sin comparar nada: el mismo verde
//          hueco que el job traía de fábrica, sólo que disfrazado de ejecución.
//        · ESTRUCTURAL  — la tabla puede estar vacía (sembrarla exigiría montar
//          flujos completos). Se comprueba que la policy responde y que no hay
//          fuga observable, pero su disjunción NO demuestra aislamiento.
//   5. Aislamiento USER-scoped: cada usuario sólo ve SUS filas (user_id = auth.uid())
//      en notification_preferences / user_preferences.
//   6. NEGATIVE WRITE: A NO puede INSERT/UPDATE con company_id ajeno (RLS WITH
//      CHECK lo rechaza → no persiste nada). El harness NO siembra; los datos
//      del sandbox los pone `scripts/seed-rls-sandbox.mjs`. Lo único que borra
//      es lo que un negative-write nunca debió dejar (barrido en afterAll).
//   7. GUARD anon/authenticated sobre los RPCs sensibles del orquestador de
//      notificaciones (#378/#380): enqueue_notification, claim_notifications_batch,
//      mark_notification_result, run_notifications_dispatcher — TODOS rechazados.
//
// CREDENCIAL-GATED: si faltan las env vars NO se crea ningún cliente ni se hace
// red — el bloque no declara pruebas en local. En CI eso no puede pasar: el
// preflight del workflow falla antes (fail-closed). Para correrlo, exporta:
//   RLS_SUPABASE_URL, RLS_SUPABASE_ANON_KEY,
//   RLS_EXPECTED_PROJECT_REF,                (ref del sandbox, declarado)
//   RLS_USER_A_EMAIL, RLS_USER_A_PASSWORD,   (empresa A)
//   RLS_USER_B_EMAIL, RLS_USER_B_PASSWORD    (empresa B, distinta de A)
// apuntando al preview branch del PR o a un sandbox — NUNCA a producción.
// Ver src/test/rls/README.md.
//
// DEFENSA EN PROFUNDIDAD SOBRE EL DESTINO
// El preflight del workflow ya valida que la URL apunte al proyecto declarado,
// pero esta suite escribe y borra filas: no puede depender de que quien la
// invoque haya hecho su parte. Alguien que corra `npx vitest` a mano con la URL
// de producción exportada no pasa por el preflight. Así que la MISMA validación
// —dominio Supabase reconocido, ref de producción rechazado, ref igual a
// RLS_EXPECTED_PROJECT_REF— se repite aquí, y su resultado se calcula ANTES de
// construir ningún cliente: si el destino no está declarado, `ENABLED` es false
// y no se abre una sola conexión.
// ════════════════════════════════════════════════════════════════════════════

const URL = process.env.RLS_SUPABASE_URL
const ANON = process.env.RLS_SUPABASE_ANON_KEY
const EXPECTED_REF = process.env.RLS_EXPECTED_PROJECT_REF
const A_EMAIL = process.env.RLS_USER_A_EMAIL
const A_PASS = process.env.RLS_USER_A_PASSWORD
const B_EMAIL = process.env.RLS_USER_B_EMAIL
const B_PASS = process.env.RLS_USER_B_PASSWORD

// ── Gate por CLASE en paquetes_recibidos (motor único, 20260829000000) ───────
// Hacen falta CUATRO usuarios de la MISMA empresa, porque hay dos gates
// distintos que comprobar y ninguno se expresa con A/B (empresas distintas):
//
//   · SELECT/INSERT/UPDATE se gobiernan por PERMISO de la clase. Solo distingue
//     a usuarios SIN rol admin: `user_has_permission` devuelve true a todo para
//     super_admin/company_owner/admin (20260518000008), así que un admin no
//     sirve para probarlo.
//   · DELETE se gobierna por ROL: correspondencia solo la borra company_owner.
//     Aquí sí hace falta un admin, para ver que NO puede.
//
//   RLS_USER_PAQ_*    rol granular (operator o similar) con condominios.tab.paqueteria
//   RLS_USER_CORR_*   rol granular con condominios.tab.correspondencia
//   RLS_USER_ADMIN_*  rol admin de esa misma empresa
//   RLS_USER_OWNER_*  rol company_owner de esa misma empresa
const PAQ_EMAIL = process.env.RLS_USER_PAQ_EMAIL
const PAQ_PASS = process.env.RLS_USER_PAQ_PASSWORD
const CORR_EMAIL = process.env.RLS_USER_CORR_EMAIL
const CORR_PASS = process.env.RLS_USER_CORR_PASSWORD
const ADMIN_EMAIL = process.env.RLS_USER_ADMIN_EMAIL
const ADMIN_PASS = process.env.RLS_USER_ADMIN_PASSWORD
const OWNER_EMAIL = process.env.RLS_USER_OWNER_EMAIL
const OWNER_PASS = process.env.RLS_USER_OWNER_PASSWORD
// NO hay un `CLASE_ENABLED` aparte. Lo hubo, y con él un
// `describe.skipIf(!CLASE_ENABLED)` que dejaba el job VERDE con 13 pruebas
// omitidas mientras los ocho secretos no existieran: el mismo falso verde por
// omisión que el resto de este archivo eliminó, sólo que un nivel más abajo.
// Las ocho variables son ahora parte del conjunto que exige
// `exigirDestinoDeclarado`, así que o están las quince y corre TODO, o el
// preflight deja el job en rojo antes de instalar nada.

// Se evalúa en tiempo de módulo, así que ocurre antes que cualquier
// `createClient`: con un destino rechazado esto LANZA y no se abre ni una
// conexión. Ver `./destino.ts` y `./__tests__/destinoHarness.test.ts`.
const { habilitado: ENABLED } = exigirDestinoDeclarado({
  RLS_SUPABASE_URL: URL,
  RLS_SUPABASE_ANON_KEY: ANON,
  RLS_EXPECTED_PROJECT_REF: EXPECTED_REF,
  RLS_USER_A_EMAIL: A_EMAIL,
  RLS_USER_A_PASSWORD: A_PASS,
  RLS_USER_B_EMAIL: B_EMAIL,
  RLS_USER_B_PASSWORD: B_PASS,
  RLS_USER_PAQ_EMAIL: PAQ_EMAIL,
  RLS_USER_PAQ_PASSWORD: PAQ_PASS,
  RLS_USER_CORR_EMAIL: CORR_EMAIL,
  RLS_USER_CORR_PASSWORD: CORR_PASS,
  RLS_USER_ADMIN_EMAIL: ADMIN_EMAIL,
  RLS_USER_ADMIN_PASSWORD: ADMIN_PASS,
  RLS_USER_OWNER_EMAIL: OWNER_EMAIL,
  RLS_USER_OWNER_PASSWORD: OWNER_PASS,
})

// UUID que NO pertenece a ninguna empresa: cualquier company_id ≠ get_my_company_id()
// hace fallar el WITH CHECK de RLS, así que sirve como "company_id ajeno" para los
// negative-write sin necesidad de conocer el company_id real de B.
// Marcador de cualquier fila que un negative-write pudiera dejar si RLS fallara.
// Los INSERT de esta suite DEBEN ser rechazados; si alguno se colara, este texto
// permite barrerlo en afterAll. El harness no siembra nada: sólo limpia lo que
// nunca debió existir (defensa en profundidad, no parte del contrato).
// ÚNICO POR EJECUCIÓN. Con un marcador fijo, una fila infiltrada por una
// corrida anterior sería indistinguible de una escrita por ésta, y el barrido
// de limpieza podría borrar evidencia de otra ejecución en paralelo.
const MARCADOR_EFIMERO = `RLS-NEG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

// ────────────────────────────────────────────────────────────────────────────
// RECURSOS REALES DEL TENANT B
// ────────────────────────────────────────────────────────────────────────────
// La versión anterior usaba un UUID cero (`00000000-…`) como "tenant ajeno".
// Eso debilitaba TODAS las pruebas negativas: un INSERT con
// `project_id = 00000000-…` puede ser rechazado por la FOREIGN KEY antes de
// que RLS llegue a evaluarse, así que el verde no demostraba que la policy
// funcionara — sólo que el UUID no existía. Lo mismo en los RPC: pedir la
// metadata de un company_id inexistente se niega de forma trivial.
//
// Ahora se leen los ids REALES de B (entrando como B, que sí ve lo suyo) y A
// los usa como objetivo. Las FKs son válidas, así que si el write se rechaza,
// el rechazo viene de RLS. Y si un RPC niega la lectura, niega datos que
// EXISTEN.
interface RecursosB {
  companyId: string
  projectId: string
  unidadId: string
  cuotaId: string
  // Recursos que el seed crea EXPRESAMENTE para que las RPC reciban ids que
  // existen. Pasarles el company_id como asiento_id/movimiento_id/etc. hacía
  // que la RPC fallara por "no encontrado" en vez de por autorización: el
  // rechazo era real, pero no probaba aislamiento.
  asientoId: string
  movimientoId: string
  amenidadId: string
  reservaId: string
  clienteId: string
}

/** Contexto resuelto en beforeAll; los tests lo leen al ejecutarse. */
let B: RecursosB

/** Args de un RPC, construidos con los recursos reales de B. */
type ArgsRpc = (b: RecursosB) => Record<string, unknown>

// ────────────────────────────────────────────────────────────────────────────
// DENY-ALL: qué cuenta como denegación legítima
// ────────────────────────────────────────────────────────────────────────────
// `expect(data ?? []).toHaveLength(0)` convertía CUALQUIER error en "0 filas",
// así que una tabla inexistente, un schema cache desactualizado, una migración
// sin aplicar o una caída de red producían el mismo verde que una policy
// funcionando. Estos códigos son los ÚNICOS aceptables como denegación:
//   42501    insufficient_privilege — el GRANT no está, que es deny-all real.
//   PGRST116 el filtro no devolvió filas (variantes de PostgREST con .single()).
// Todo lo demás —PGRST205 "no está en el schema cache", 42P01 tabla
// inexistente, errores de auth o de red— es un FALLO: significa que la prueba
// no comprobó nada.
const CODIGOS_DENEGACION_OK = new Set(['42501', 'PGRST116'])

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

// Las tablas tenant-scoped y su NIVEL de cobertura viven en `./coverage.ts`,
// compartido con `scripts/seed-rls-sandbox.mjs`. La separación es lo que impide
// el verde vacío: para las NO_TRIVIALES el seed garantiza filas de A y de B, así
// que aquí se puede EXIGIR que los conjuntos no estén vacíos antes de compararlos.

// Tablas con scope POR USUARIO (no por empresa): RLS = user_id = auth.uid().
const USER_SCOPED_TABLES = ['notification_preferences', 'user_preferences'] as const

// ────────────────────────────────────────────────────────────────────────────
// RPCs sensibles. `args` es una FUNCIÓN de los recursos reales de B, no un
// literal: los ids se conocen recién en beforeAll y apuntar a filas que EXISTEN
// es lo que convierte estas pruebas en una comprobación de autorización y no en
// una de "el id no existe".
// ────────────────────────────────────────────────────────────────────────────

// RPCs SECURITY DEFINER del orquestador de notificaciones que en #378 quedaron
// anon-ejecutables y se cerraron en #380 (revoke por nombre de rol). El guard
// regresa-guarda esa clase de bug: anon y authenticated deben ser RECHAZADOS.
const SENSITIVE_RPCS: ReadonlyArray<{ name: string; args: ArgsRpc }> = [
  {
    name: 'enqueue_notification',
    args: (b) => ({
      p_channel: 'in_app',
      p_recipient: 'attacker@example.com',
      p_payload: {},
      p_company_id: b.companyId,
      p_template_key: null,
      p_scheduled_at: null,
    }),
  },
  { name: 'claim_notifications_batch', args: () => ({ p_batch_size: 1 }) },
  {
    name: 'mark_notification_result',
    args: (b) => ({ p_id: b.companyId, p_ok: true, p_error: null, p_retriable: false }),
  },
  { name: 'run_notifications_dispatcher', args: () => ({}) },
]

// RPCs del ERP financiero: anon DEBE ser rechazado siempre (REVOKE FROM anon).
// Para authenticated se usan ids REALES del tenant B: la RPC debe negarse por
// AUTORIZACIÓN ("no autorizado"), no porque el id no exista. El cierre anual se
// excluye de la variante authenticated porque un admin legítimo SÍ puede
// ejecutarlo sobre su propia empresa.
const ERP_RPCS_ANON: ReadonlyArray<{ name: string; args: ArgsRpc }> = [
  { name: 'conta_publicar_asiento', args: (b) => ({ p_asiento_id: b.asientoId }) },
  { name: 'conta_anular_asiento', args: (b) => ({ p_asiento_id: b.asientoId, p_motivo: null }) },
  { name: 'conta_cierre_anual', args: () => ({ p_anio: 2000 }) },
  {
    // El sujeto de la comprobación de autorización es `p_movimiento_id`: un
    // movimiento REAL de B. `p_match_id` no lo es —la RPC valida la pertenencia
    // del movimiento antes de mirar el match—, así que se reutiliza el mismo id.
    name: 'banco_conciliar_movimiento',
    args: (b) => ({ p_movimiento_id: b.movimientoId, p_match_tipo: 'pago', p_match_id: b.movimientoId }),
  },
  { name: 'banco_desconciliar_movimiento', args: (b) => ({ p_movimiento_id: b.movimientoId }) },
  { name: 'banco_ajuste_conciliacion', args: (b) => ({ p_movimiento_id: b.movimientoId, p_descripcion: null }) },
]

const ERP_RPCS_AUTH_SIN_EFECTOS = ERP_RPCS_ANON.filter((r) => r.name !== 'conta_cierre_anual')

// RPCs de estatus de las bóvedas (metadata NO sensible): REVOKE FROM PUBLIC, anon.
// anon SIEMPRE rechazado. Para authenticated se pide la metadata de la empresa
// REAL de B: si el guard fail-closed funciona, A no la obtiene aunque exista.
// Regresa-guarda el fail-open trivaluado que el equipo cazó en #611.
const ESTATUS_RPCS_ANON: ReadonlyArray<{ name: string; args: ArgsRpc }> = [
  { name: 'whatsapp_estatus', args: (b) => ({ p_company_id: b.companyId }) },
  { name: 'payfac_estatus', args: (b) => ({ p_company_id: b.companyId }) },
  { name: 'fiscal_pac_estatus', args: (b) => ({ p_company_id: b.companyId }) },
]

// ────────────────────────────────────────────────────────────────────────────
// RPCs del PORTAL — leer antes de citar estas pruebas como "aislamiento".
// ────────────────────────────────────────────────────────────────────────────
// Las del self-service del propietario (inquilinos, familiares, baja de renta)
// abren con
//
//     IF current_user_role() <> 'cliente' THEN RAISE EXCEPTION …
//
// o filtran por `mis_unidades_propietario_ids()`. Los usuarios fixture A y B son
// STAFF (`app_users.role = company_owner`), no clientes del portal, así que el
// rechazo ocurre en ese gate y NUNCA llega a evaluarse la pertenencia de la
// unidad. Lo que demuestran es real y vale la pena —la RPC no es anon-ejecutable
// y el guard existe—, pero NO es aislamiento entre tenants: `coverage.json` las
// declara `garantia: 'rol'`.
//
// Las de RESERVAS son distintas y sí llegan a tenant: aceptan al staff del
// tenant (`company_id = get_my_company_id()` + permiso) porque la vista previa
// del portal la usa el staff. Con A como company_owner, rol y permiso pasan, así
// que el único rechazo posible es la pertenencia.
//
// Los ids que se pasan son en todos los casos los REALES de B: si algún día se
// siembran usuarios con rol cliente y fila en `unidad_residentes`, las mismas
// pruebas pasan a demostrar pertenencia sin tocar un argumento. Eso exigiría dos
// credenciales más allá de las seis RLS_* que define este PR, así que queda
// documentado como limitación en docs/ACTIVAR_HARNESS_RLS.md, no como cobertura.
const PORTAL_INQUILINO_RPCS_ANON: ReadonlyArray<{ name: string; args: ArgsRpc }> = [
  { name: 'portal_mis_unidades', args: () => ({}) },
  { name: 'portal_inquilinos_de_unidad', args: (b) => ({ p_unidad_id: b.unidadId }) },
  {
    name: 'portal_registrar_inquilino',
    args: (b) => ({
      p_unidad_id: b.unidadId,
      p_nombre: 'Intruso RLS',
      p_email: 'intruso-rls@example.com',
      p_cui_dui: '0000000000000',
      p_fecha_nacimiento: '2000-01-01',
      p_telefono: null,
    }),
  },
  {
    name: 'portal_quitar_inquilino',
    args: (b) => ({ p_unidad_id: b.unidadId, p_cliente_id: b.clienteId }),
  },
]

const PORTAL_INQUILINO_RPCS_ESCRITURA = PORTAL_INQUILINO_RPCS_ANON.filter((r) =>
  ['portal_registrar_inquilino', 'portal_quitar_inquilino'].includes(r.name),
)

// RPCs de reservas del portal (20260822030000): amenidad y unidad reales de B.
const PORTAL_RESERVAS_RPCS: ReadonlyArray<{ name: string; args: ArgsRpc }> = [
  {
    name: 'portal_reservar_amenidad',
    args: (b) => ({
      p_amenidad_id: b.amenidadId,
      p_unidad_id: b.unidadId,
      p_fecha: '2099-01-01',
      p_hora_inicio: '10:00',
      p_hora_fin: '11:00',
      p_num_invitados: 0,
      p_notas: null,
      p_metodo_pago: null,
      p_reglamento_aceptado: false,
    }),
  },
  { name: 'portal_cancelar_reserva', args: (b) => ({ p_reserva_id: b.reservaId }) },
]

// RPCs de accesos familiares (20260825000000): mismo contrato, unidad real de B.
const PORTAL_FAMILIARES_RPCS: ReadonlyArray<{ name: string; args: ArgsRpc }> = [
  {
    name: 'portal_registrar_familiar',
    args: (b) => ({
      p_unidad_id: b.unidadId,
      p_nombre: 'Intruso RLS',
      p_email: 'intruso-familiar-rls@example.com',
      p_cui_dui: '0000000000001',
      p_fecha_nacimiento: '2000-01-01',
      p_telefono: null,
    }),
  },
  { name: 'portal_quitar_familiar', args: (b) => ({ p_unidad_id: b.unidadId, p_cliente_id: b.clienteId }) },
  { name: 'portal_accesos_de_unidad', args: (b) => ({ p_unidad_id: b.unidadId }) },
]


// RPC de baja de la autorización de renta (20260827000000). Es de ESCRITURA y
// destructiva —revoca los accesos de inquilino y familiares de la unidad—, así
// que un fallo de autorización aquí deja sin portal a residentes de otro
// tenant. Faltaba por completo en el harness: la migración entró en main
// después de escribirse esta suite.
const PORTAL_BAJA_RENTA_RPCS: ReadonlyArray<{ name: string; args: ArgsRpc }> = [
  { name: 'portal_baja_renta', args: (b) => ({ p_unidad_id: b.unidadId }) },
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
  // Fixture propio de A: su company_id y el id EXACTO de su cuota sembrada. El
  // UPDATE negativo apunta a ese id concreto — nunca a `.eq('company_id', …)`,
  // que en un fallo de RLS habría re-etiquetado TODAS las filas de la empresa.
  let aCompanyId: string
  let aCuotaId: string

  beforeAll(async () => {
    anon = freshClient()
    userA = await signedInClient(A_EMAIL!, A_PASS!)
    userB = await signedInClient(B_EMAIL!, B_PASS!)
    ;[aId, bId] = await Promise.all([userId(userA), userId(userB)])
    expect(aId, 'A y B deben ser usuarios DISTINTOS').not.toBe(bId)

    // ── Fixture de A ──────────────────────────────────────────────────────
    const { data: filasA, error: errorA } = await userA
      .from('cuotas_condominio')
      .select('id, company_id')
      .eq('periodo', FIXTURES.periodoCuota)
      .limit(1)
    expect(errorA, 'A debe poder leer sus propias cuotas').toBeNull()
    const filaA = filasA?.[0] as { id: string; company_id: string } | undefined
    expect(
      filaA,
      `A no tiene la cuota fixture (periodo ${FIXTURES.periodoCuota}): el sandbox no está sembrado. ` +
      'Corré scripts/seed-rls-sandbox.mjs.',
    ).toBeDefined()
    aCompanyId = filaA!.company_id
    aCuotaId = filaA!.id

    // ── Recursos REALES de B ──────────────────────────────────────────────
    // Leídos COMO B (que sí ve lo suyo). Son el objetivo de las pruebas
    // negativas de A: con FKs válidas y filas que EXISTEN, un rechazo sólo
    // puede venir de RLS o del guard interno de la RPC — nunca de "no existe".
    const leerFixtureB = async (
      tabla: string,
      columnas: string,
      filtros: Record<string, string>,
    ) => {
      let q = userB.from(tabla).select(columnas)
      for (const [col, val] of Object.entries(filtros)) q = q.eq(col, val)
      const { data, error } = await q.limit(1)
      expect(error, `B debe poder leer su fixture de ${tabla}`).toBeNull()
      const fila = data?.[0] as Record<string, string> | undefined
      expect(
        fila,
        `B no tiene el fixture de ${tabla}: el sandbox no está sembrado o el seed falló ahí. ` +
        'Corré scripts/seed-rls-sandbox.mjs y revisá su salida.',
      ).toBeDefined()
      return fila!
    }

    const cuotaB = await leerFixtureB('cuotas_condominio', 'id, company_id, project_id, unidad_id', {
      periodo: FIXTURES.periodoCuota,
    })
    expect(cuotaB.unidad_id, 'la cuota sembrada de B debe tener unidad_id').toBeTruthy()

    const asientoB = await leerFixtureB('conta_asientos', 'id', {})
    const movimientoB = await leerFixtureB('banco_movimientos', 'id', {})
    const amenidadB = await leerFixtureB('amenidades', 'id', {})
    const reservaB = await leerFixtureB('reservas_amenidades', 'id', { fecha: FIXTURES.fechaReserva })
    const clienteB = await leerFixtureB('clientes', 'id', {})

    B = {
      companyId: cuotaB.company_id,
      projectId: cuotaB.project_id,
      unidadId: cuotaB.unidad_id,
      cuotaId: cuotaB.id,
      asientoId: asientoB.id,
      movimientoId: movimientoB.id,
      amenidadId: amenidadB.id,
      reservaId: reservaB.id,
      clienteId: clienteB.id,
    }

    expect(B.companyId, 'A y B deben pertenecer a empresas DISTINTAS').not.toBe(aCompanyId)
  })

  afterAll(async () => {
    // Barrido de seguridad: ninguna de las escrituras negativas debería haber
    // persistido (RLS las rechaza), pero si una se colara quedaría basura en el
    // sandbox y —peor— un falso verde en la siguiente corrida. Es best-effort:
    // los errores se ignoran a propósito, porque lo normal es que no haya nada
    // que borrar y el DELETE devuelva 0 filas.
    //
    // ⚠️ REGLA DE LAS LIMPIEZAS, sin excepciones: cada DELETE se filtra por el
    // MARCADOR_EFIMERO de ESTA corrida o por ids concretos leídos antes. Nunca
    // por `company_id` ni por ningún otro campo compartido con los fixtures.
    //
    // Aquí había un `documentos_fiscales.delete().eq('company_id', B.companyId)`
    // que borraba TODOS los comprobantes de la empresa B —incluido el que
    // siembra `seed-rls-sandbox.mjs`, que es lo que hace que esa tabla tenga
    // cobertura NO TRIVIAL—. Efecto: la primera corrida pasaba y la segunda
    // fallaba por "B no ve ninguna fila propia", o peor, si alguien relajaba esa
    // aserción, la disjunción volvía a ser trivial. Una limpieza que destruye el
    // fixture convierte la suite en no repetible.
    //
    // El marcador es único por corrida (`RLS-NEG-<ts>-<rand>`), así que además
    // dos ejecuciones simultáneas contra el mismo sandbox no se pisan.
    await Promise.allSettled([
      userA?.from('cuotas_condominio').delete().eq('concepto', MARCADOR_EFIMERO),
      userA?.from('conta_cuentas').delete().eq('nombre', MARCADOR_EFIMERO),
      userA?.from('conta_asientos').delete().eq('concepto', MARCADOR_EFIMERO),
      userA?.from('documentos_fiscales').delete().eq('serie', MARCADOR_EFIMERO),
      // Y lo mismo desde B: si una escritura cross-tenant se colara, la fila
      // quedaría en el tenant de B y A no podría verla ni borrarla.
      userB?.from('cuotas_condominio').delete().eq('concepto', MARCADOR_EFIMERO),
      userB?.from('conta_cuentas').delete().eq('nombre', MARCADOR_EFIMERO),
      userB?.from('documentos_fiscales').delete().eq('serie', MARCADOR_EFIMERO),
    ])
    await Promise.allSettled([userA?.auth.signOut(), userB?.auth.signOut()])
  })

  /**
   * Deny-all estricto. Antes esto era `expect(data ?? []).toHaveLength(0)`, que
   * trataba CUALQUIER error como "0 filas": una tabla inexistente, un schema
   * cache desactualizado, una migración sin aplicar, un fallo de auth o de red
   * producían el mismo verde que una policy funcionando. Aquí:
   *   · sin error  → se exige que devuelva 0 filas;
   *   · con error  → sólo se acepta si el código está en CODIGOS_DENEGACION_OK;
   *                  cualquier otro FALLA e informa código y mensaje, porque
   *                  significa que la prueba no llegó a comprobar la policy.
   */
  async function esperaDenegacion(
    cliente: SupabaseClient,
    table: string,
    columnas = '*',
    quien = 'el cliente',
  ) {
    const { data, error } = await cliente.from(table).select(columnas)

    if (error) {
      expect(
        CODIGOS_DENEGACION_OK.has(error.code ?? ''),
        `${table}: ${quien} recibió un error INESPERADO (code=${error.code ?? 'sin código'}): ` +
        `${error.message}. Esto NO demuestra deny-all — puede ser tabla inexistente, ` +
        'schema cache desactualizado, migración sin aplicar, auth o red.',
      ).toBe(true)
      return
    }

    expect(data ?? [], `${table}: ${quien} no debe ver ninguna fila`).toHaveLength(0)
  }

  describe('tablas de secretos = deny-all (nunca al cliente)', () => {
    for (const table of SECRET_TABLES) {
      it(`${table}: authenticated (empresa A) no ve filas`, async () => {
        await esperaDenegacion(userA, table, '*', 'authenticated (A)')
      })

      it(`${table}: anon no ve filas`, async () => {
        await esperaDenegacion(anon, table, '*', 'anon')
      })
    }
  })

  describe('tablas sin policy de SELECT = deny-all para el cliente', () => {
    for (const table of NO_SELECT_TABLES) {
      it(`${table}: authenticated (empresa A) no ve filas`, async () => {
        await esperaDenegacion(userA, table, '*', 'authenticated (A)')
      })

      it(`${table}: anon no ve filas`, async () => {
        await esperaDenegacion(anon, table, '*', 'anon')
      })
    }
  })

  describe('store de sesiones server-side (user_sessions) = deny-all', () => {
    // user_sessions es el store de express-session (sid/sess/expire), sin user_id;
    // su política "No direct access" lo hace deny-all para todo cliente. El
    // invariante "A no ve filas de otro usuario" se cumple de forma trivial: A no
    // ve NINGUNA fila (más fuerte que el aislamiento por usuario).
    it('authenticated (empresa A) no ve filas', async () => {
      await esperaDenegacion(userA, 'user_sessions', 'sid', 'authenticated (A)')
    })

    it('anon no ve filas', async () => {
      await esperaDenegacion(anon, 'user_sessions', 'sid', 'anon')
    })
  })

  describe('anon no puede leer tablas de negocio', () => {
    // `select('*')`, NUNCA una columna concreta. Aquí se pedía `id` y dos tablas
    // no lo tienen —`notification_preferences` y `user_preferences` van por
    // `user_id`—, así que la consulta moría con 42703 (undefined_column) contra
    // el sandbox real. No es un detalle cosmético: `id` no era ni siquiera lo
    // que se quería comprobar. Este bloque sólo pregunta «¿error permitido, o
    // cero filas?», y para eso `*` es la proyección correcta y además la más
    // estricta: si la policy dejara pasar una fila, se ve entera.
    //
    // El fallo 42703 lo detectó `esperaDenegacion` precisamente porque distingue
    // «denegado» de «roto». Con el `expect(data ?? []).toHaveLength(0)` original
    // habría pasado como verde: 0 filas, ningún aislamiento demostrado.
    for (const table of ANON_DENY_TABLES) {
      it(`${table}: anon obtiene 0 filas`, async () => {
        await esperaDenegacion(anon, table, '*', 'anon')
      })
    }
  })

  // Devuelve los company_id que cada usuario ve en `table`.
  async function companyIdsVistos(table: string) {
    const [{ data: aRows, error: aErr }, { data: bRows, error: bErr }] = await Promise.all([
      userA.from(table).select('company_id'),
      userB.from(table).select('company_id'),
    ])
    expect(aErr, `A no debe recibir error leyendo ${table}`).toBeNull()
    expect(bErr, `B no debe recibir error leyendo ${table}`).toBeNull()
    return {
      a: new Set((aRows ?? []).map((r) => (r as { company_id: string }).company_id)),
      b: new Set((bRows ?? []).map((r) => (r as { company_id: string }).company_id)),
    }
  }

  function assertDisjuntos(a: Set<string>, b: Set<string>, table: string) {
    for (const co of b) {
      expect(a.has(co), `company_id ${co} de B no debe ser visible para A en ${table}`).toBe(false)
    }
    for (const co of a) {
      expect(b.has(co), `company_id ${co} de A no debe ser visible para B en ${table}`).toBe(false)
    }
  }

  // ── Cobertura REAL ────────────────────────────────────────────────────────
  // El seed garantiza filas de las DOS empresas en estas tablas, así que aquí se
  // EXIGE que los conjuntos no estén vacíos ANTES de compararlos. Sin esta
  // aserción, un sandbox sin sembrar produce dos conjuntos vacíos, el bucle de
  // disjunción no itera y el test pasa sin haber comparado nada — el mismo verde
  // hueco que este PR viene a eliminar, sólo que disfrazado de ejecución.
  describe('aislamiento por tenant — cobertura NO TRIVIAL (conjuntos no vacíos)', () => {
    for (const table of TENANT_SCOPED_NO_TRIVIALES) {
      it(`${table}: A ve al menos una fila PROPIA`, async () => {
        const { a } = await companyIdsVistos(table)
        expect(
          a.size,
          `A no ve ninguna fila de ${table}: el sandbox no está sembrado y la disjunción sería trivial. Corré scripts/seed-rls-sandbox.mjs.`,
        ).toBeGreaterThan(0)
      })

      it(`${table}: B ve al menos una fila PROPIA`, async () => {
        const { b } = await companyIdsVistos(table)
        expect(
          b.size,
          `B no ve ninguna fila de ${table}: el sandbox no está sembrado y la disjunción sería trivial. Corré scripts/seed-rls-sandbox.mjs.`,
        ).toBeGreaterThan(0)
      })

      it(`${table}: A y B ven company_id DISJUNTOS (comparación con datos reales)`, async () => {
        const { a, b } = await companyIdsVistos(table)
        expect(a.size, 'precondición: A debe ver filas').toBeGreaterThan(0)
        expect(b.size, 'precondición: B debe ver filas').toBeGreaterThan(0)
        assertDisjuntos(a, b, table)
      })
    }
  })

  // ── Cobertura ESTRUCTURAL ─────────────────────────────────────────────────
  // Estas tablas pueden estar VACÍAS en el sandbox (sembrarlas exigiría montar
  // flujos completos — ver ./coverage.ts). Se comprueba que la policy responde
  // sin error y que no hay fuga observable, pero su disjunción NO demuestra
  // aislamiento y NO debe declararse como tal.
  describe('aislamiento por tenant — cobertura ESTRUCTURAL (puede estar vacía)', () => {
    for (const table of TENANT_SCOPED_ESTRUCTURALES) {
      it(`${table}: A lee lo suyo sin error`, async () => {
        const { error } = await userA.from(table).select('company_id').limit(1)
        expect(error).toBeNull()
      })

      it(`${table}: sin fuga observable entre A y B`, async () => {
        const { a, b } = await companyIdsVistos(table)
        assertDisjuntos(a, b, table)
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

  // ────────────────────────────────────────────────────────────────────────
  // NEGATIVE WRITE — concluyente, verificado DESDE B
  // ────────────────────────────────────────────────────────────────────────
  // Antes bastaba con `expect(error).not.toBeNull()` y "A no ve la fila". Eso
  // NO demuestra que la escritura no ocurriera: si RLS deja escribir pero la
  // policy de SELECT la oculta a A, el `data` vacío de A es exactamente igual
  // que un rechazo. La única evidencia real es mirarlo desde el tenant que la
  // recibiría — B — y comprobar que la fila NO está.
  //
  // Cada intento usa MARCADOR_EFIMERO (único por ejecución) para que la
  // búsqueda desde B no confunda una fila de otra corrida con una infiltrada
  // por ésta. Si aparece, se limpia COMO B (el único que puede verla) y la
  // prueba falla: dejarla sería contaminar el sandbox y envenenar la siguiente
  // corrida.
  async function noDebeExistirEnB(tabla: string, columna: string, valor: string) {
    const { data, error } = await userB.from(tabla).select('id').eq(columna, valor)
    expect(error, `B debe poder consultar ${tabla} para verificar la no-escritura`).toBeNull()

    const infiltradas = (data ?? []) as { id: string }[]
    if (infiltradas.length > 0) {
      // Limpieza COMO B antes de fallar: la fila está en su tenant.
      await userB.from(tabla).delete().in('id', infiltradas.map((r) => r.id))
    }
    expect(
      infiltradas.length,
      `FUGA REAL: A escribió ${infiltradas.length} fila(s) en ${tabla} del tenant de B ` +
      `(${columna}=${valor}). Se limpiaron, pero RLS no está protegiendo la escritura.`,
    ).toBe(0)
  }

  describe('negative write (hacia el tenant de B → RECHAZADO y verificado COMO B)', () => {
    it('cuotas_condominio: INSERT hacia el tenant de B es rechazado — verificado COMO B', async () => {
      // Payload íntegramente válido contra el esquema: company_id, project_id y
      // unidad_id son FKs REALES de B. Si la fila no aparece, sólo puede ser
      // por RLS.
      const { data, error } = await userA
        .from('cuotas_condominio')
        .insert({
          company_id: B.companyId,
          project_id: B.projectId,
          unidad_id: B.unidadId,
          concepto: MARCADOR_EFIMERO,
          monto: 1,
          periodo: '2098-01',
          estado: 'pendiente',
        })
        .select('id')

      expect(error, 'el INSERT cross-tenant debe ser rechazado por RLS').not.toBeNull()
      expect(data ?? [], 'no debe devolver ninguna fila a A').toHaveLength(0)
      await noDebeExistirEnB('cuotas_condominio', 'concepto', MARCADOR_EFIMERO)
    })

    it('cuotas_condominio: UPDATE de UNA fila propia hacia el tenant de B es rechazado — verificado COMO B', async () => {
      // Apunta al id EXACTO de la cuota fixture de A. La versión anterior
      // filtraba por `company_id`, así que un fallo de RLS habría re-etiquetado
      // TODAS las cuotas de A de una sola vez.
      const { data, error } = await userA
        .from('cuotas_condominio')
        .update({ company_id: B.companyId, concepto: MARCADOR_EFIMERO })
        .eq('id', aCuotaId)
        .select('id')

      expect(
        error !== null || (data ?? []).length === 0,
        'el UPDATE cross-tenant no debe re-etiquetar la fila',
      ).toBe(true)
      await noDebeExistirEnB('cuotas_condominio', 'concepto', MARCADOR_EFIMERO)

      // Y la fila de A debe seguir siendo de A, intacta.
      const { data: sigue } = await userA
        .from('cuotas_condominio')
        .select('id, company_id')
        .eq('id', aCuotaId)
      const fila = (sigue ?? [])[0] as { company_id: string } | undefined
      expect(fila, 'la cuota fixture de A debe seguir siendo visible para A').toBeDefined()
      expect(fila!.company_id, 'la cuota de A no debe haber cambiado de empresa').toBe(aCompanyId)
    })

    it('documentos_fiscales: INSERT hacia el tenant de B es rechazado — verificado COMO B', async () => {
      // `regimen` respeta el CHECK del esquema ('fel_gt' | 'cfdi_mx'). Con un
      // valor inválido el INSERT moría por CHECK y el "rechazo" no probaba RLS.
      const { data, error } = await userA
        .from('documentos_fiscales')
        .insert({
          company_id: B.companyId,
          regimen: FIXTURES.regimenDocumento,
          tipo: FIXTURES.tipoDocumento,
          serie: MARCADOR_EFIMERO,
          numero: '1',
        })
        .select('id')

      expect(error, 'el INSERT cross-tenant debe ser rechazado').not.toBeNull()
      expect(data ?? [], 'no debe devolver ninguna fila a A').toHaveLength(0)
      await noDebeExistirEnB('documentos_fiscales', 'serie', MARCADOR_EFIMERO)
    })

    it('conta_cuentas: INSERT hacia el tenant de B es rechazado — verificado COMO B (ERP)', async () => {
      const { data, error } = await userA
        .from('conta_cuentas')
        .insert({
          company_id: B.companyId,
          codigo: `9999-${MARCADOR_EFIMERO.slice(-6)}`,
          nombre: MARCADOR_EFIMERO,
          tipo: 'activo',
          naturaleza: 'deudora',
          nivel: 1,
        })
        .select('id')

      expect(error, 'el INSERT cross-tenant debe ser rechazado').not.toBeNull()
      expect(data ?? [], 'no debe devolver ninguna fila a A').toHaveLength(0)
      await noDebeExistirEnB('conta_cuentas', 'nombre', MARCADOR_EFIMERO)
    })

    it('conta_asientos: publicar sin la RPC es rechazado por el guard de BD — verificado COMO A', async () => {
      // Aquí el tenant es el PROPIO de A: lo que se prueba es el trigger
      // conta_proteger_asiento, no el aislamiento. Por eso la verificación es
      // sobre A y no sobre B.
      const { data, error } = await userA
        .from('conta_asientos')
        .insert({
          company_id: aCompanyId,
          fecha: '2098-01-01',
          tipo: 'diario',
          concepto: MARCADOR_EFIMERO,
          estado: 'publicado',
          origen: 'manual',
          moneda_base: 'GTQ',
        })
        .select('id')

      if (data && data.length > 0) {
        await userA.from('conta_asientos').delete().in('id', data.map((r) => (r as { id: string }).id))
      }
      expect(error, 'publicar sin la RPC debe ser rechazado').not.toBeNull()
      expect(data ?? [], 'no debe persistir ninguna fila').toHaveLength(0)
    })
  })


  describe('guard RPCs de notificaciones (#378/#380) — garantía de PRIVILEGIO', () => {
    for (const { name, args } of SENSITIVE_RPCS) {
      it(`${idEvidencia(name, 'anon')} anon NO puede ejecutar ${name}`, async () => {
        const { data, error } = await anon.rpc(name, args(B))
        // Rechazo = error presente (permission denied / función no visible /
        // PGRST). NUNCA debe devolver un resultado exitoso.
        expect(error, `anon no debe poder invocar ${name}`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos a anon`).toBeNull()
      })

      it(`${idEvidencia(name, 'authenticated')} authenticated (empresa A) NO puede ejecutar ${name}`, async () => {
        const { data, error } = await userA.rpc(name, args(B))
        expect(error, `authenticated no debe poder invocar ${name}`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos a authenticated`).toBeNull()
      })
    }
  })

  describe('guard RPCs del ERP financiero (REVOKE anon + pertenencia) — garantía de TENANT', () => {
    for (const { name, args } of ERP_RPCS_ANON) {
      it(`${idEvidencia(name, 'anon')} anon NO puede ejecutar ${name}`, async () => {
        const { data, error } = await anon.rpc(name, args(B))
        expect(error, `anon no debe poder invocar ${name}`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos a anon`).toBeNull()
      })
    }

    // authenticated (A) con el id REAL de un recurso de B: la RPC debe fallar sin
    // efectos. El id existe, así que el rechazo no puede ser "no encontrado" —
    // viene del guard de pertenencia. conta_cierre_anual se excluye porque un
    // admin legítimo SÍ puede ejecutarlo sobre lo suyo (sería un falso positivo).
    for (const { name, args } of ERP_RPCS_AUTH_SIN_EFECTOS) {
      it(`${idEvidencia(name, 'authenticated-cross-tenant')} authenticated (A) NO obtiene éxito de ${name} sobre un recurso REAL de B`, async () => {
        const { data, error } = await userA.rpc(name, args(B))
        expect(error, `${name} sobre un recurso de otro tenant debe fallar`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos`).toBeNull()
      })
    }
  })

  describe('guard RPCs de estatus de bóvedas (#611) — garantía de TENANT', () => {
    for (const { name, args } of ESTATUS_RPCS_ANON) {
      it(`${idEvidencia(name, 'anon')} anon NO puede ejecutar ${name}`, async () => {
        const { data, error } = await anon.rpc(name, args(B))
        expect(error, `anon no debe poder invocar ${name}`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos a anon`).toBeNull()
      })
    }

    // authenticated de la empresa A pidiendo la metadata de la empresa REAL de
    // B: el guard fail-closed debe negar — nunca metadata cross-tenant, aun con
    // claims válidos y aunque el tenant consultado exista de verdad. Esto cubre
    // el bug trivaluado de #611, que un company_id inexistente no ejercitaba.
    for (const { name } of ESTATUS_RPCS_ANON) {
      it(`${idEvidencia(name, 'authenticated-cross-tenant')} authenticated (A) NO obtiene metadata de un tenant ajeno vía ${name}`, async () => {
        const { data, error } = await userA.rpc(name, { p_company_id: B.companyId })
        const negado = error !== null || (data ?? []).length === 0
        expect(negado, `${name} no debe exponer metadata de otro tenant`).toBe(true)
      })
    }
  })

  describe('guard RPCs del self-service de inquilinos (20260822000000) — garantía de ROL', () => {
    for (const { name, args } of PORTAL_INQUILINO_RPCS_ANON) {
      it(`${idEvidencia(name, 'anon')} anon NO puede ejecutar ${name}`, async () => {
        const { data, error } = await anon.rpc(name, args(B))
        expect(error, `anon no debe poder invocar ${name}`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos a anon`).toBeNull()
      })
    }

    // authenticated (A, staff) apuntando a una unidad AJENA: el guard debe
    // rechazar la escritura sin efectos. El primer gate que actúa es el de rol
    // (`current_user_role() <> 'cliente'`), así que esto NO prueba pertenencia.
    for (const { name, args } of PORTAL_INQUILINO_RPCS_ESCRITURA) {
      it(`${idEvidencia(name, 'authenticated-cross-tenant')} authenticated (A) NO puede ejecutar ${name} sobre una unidad ajena`, async () => {
        const { data, error } = await userA.rpc(name, args(B))
        expect(error, `${name} sobre unidad ajena debe fallar`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos`).toBeNull()
      })
    }

    // portal_mis_unidades no recibe argumentos, así que no hay "recurso ajeno"
    // al que apuntar: la evidencia autenticada consiste en que A —staff, no
    // cliente del portal— no obtiene NINGUNA unidad. Sin esta prueba, la RPC
    // sólo estaba acreditada por anon, que no llega al filtro de residencia.
    it(`${idEvidencia('portal_mis_unidades', 'authenticated')} authenticated (A) NO obtiene unidades del portal`, async () => {
      const { data, error } = await userA.rpc('portal_mis_unidades', {})
      const negado = error !== null || (data ?? []).length === 0
      expect(negado, 'portal_mis_unidades no debe listar unidades a un usuario staff').toBe(true)
    })

    // portal_inquilinos_de_unidad es de lectura: con unidad ajena devuelve 0
    // filas (el predicado "unidad propia" filtra), nunca residentes de otro.
    it(`${idEvidencia('portal_inquilinos_de_unidad', 'authenticated-cross-tenant')} authenticated (A) NO lista inquilinos de una unidad ajena`, async () => {
      const { data, error } = await userA.rpc('portal_inquilinos_de_unidad', {
        p_unidad_id: B.unidadId,
      })
      const negado = error !== null || (data ?? []).length === 0
      expect(negado, 'portal_inquilinos_de_unidad no debe exponer residentes ajenos').toBe(true)
    })
  })

  describe('guard RPCs de reservas del portal (20260822030000) — garantía de TENANT', () => {
    for (const { name, args } of PORTAL_RESERVAS_RPCS) {
      it(`${idEvidencia(name, 'anon')} anon NO puede ejecutar ${name}`, async () => {
        const { data, error } = await anon.rpc(name, args(B))
        expect(error, `anon no debe poder invocar ${name}`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos a anon`).toBeNull()
      })

      it(`${idEvidencia(name, 'authenticated-cross-tenant')} authenticated (A) NO puede ejecutar ${name} sobre ids ajenos`, async () => {
        const { data, error } = await userA.rpc(name, args(B))
        expect(error, `${name} sobre ids ajenos debe fallar`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos`).toBeNull()
      })
    }
  })

  describe('guard RPCs de accesos familiares (20260825000000) — garantía de ROL', () => {
    for (const { name, args } of PORTAL_FAMILIARES_RPCS) {
      it(`${idEvidencia(name, 'anon')} anon NO puede ejecutar ${name}`, async () => {
        const { data, error } = await anon.rpc(name, args(B))
        expect(error, `anon no debe poder invocar ${name}`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos a anon`).toBeNull()
      })
    }

    // Escrituras con unidad AJENA: el guard debe rechazar sin efectos. Igual que
    // arriba, quien rechaza es el gate de rol — garantía de ROL, no de tenant.
    for (const { name, args } of PORTAL_FAMILIARES_RPCS.filter((r) =>
      ['portal_registrar_familiar', 'portal_quitar_familiar'].includes(r.name),
    )) {
      it(`${idEvidencia(name, 'authenticated-cross-tenant')} authenticated (A) NO puede ejecutar ${name} sobre una unidad ajena`, async () => {
        const { data, error } = await userA.rpc(name, args(B))
        expect(error, `${name} sobre unidad ajena debe fallar`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos`).toBeNull()
      })
    }

    // portal_accesos_de_unidad es de lectura: con unidad ajena devuelve 0 filas.
    it(`${idEvidencia('portal_accesos_de_unidad', 'authenticated-cross-tenant')} authenticated (A) NO lista accesos de una unidad ajena`, async () => {
      const { data, error } = await userA.rpc('portal_accesos_de_unidad', {
        p_unidad_id: B.unidadId,
      })
      const negado = error !== null || (data ?? []).length === 0
      expect(negado, 'portal_accesos_de_unidad no debe exponer accesos ajenos').toBe(true)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // guard RPC de baja de autorización de renta (20260827000000)
  // ────────────────────────────────────────────────────────────────────────
  // Esta RPC estaba NOMBRADA en un filtro del harness pero NUNCA en ninguna
  // colección, así que el filtro no producía ni una sola prueba: una referencia
  // muerta que daba la impresión de estar cubierta. Es de escritura y
  // destructiva —revoca el acceso al portal del inquilino y de los familiares
  // de la unidad—, así que un fallo de autorización deja sin portal a
  // residentes de OTRO tenant.
  describe('guard RPCs de baja de renta (20260827000000) — garantía de ROL', () => {
    for (const { name, args } of PORTAL_BAJA_RENTA_RPCS) {
      it(`${idEvidencia(name, 'anon')} anon NO puede ejecutar ${name}`, async () => {
        const { data, error } = await anon.rpc(name, args(B))
        expect(error, `anon no debe poder invocar ${name}`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos a anon`).toBeNull()
      })

      it(`${idEvidencia(name, 'authenticated-cross-tenant')} authenticated (A) NO puede ejecutar ${name} sobre una unidad ajena`, async () => {
        // La unidad es REAL y pertenece a B, así que el rechazo no puede venir de
        // un id inexistente. Viene del gate de rol (A es staff, no cliente del
        // portal): garantía de ROL, no de tenant — ver el bloque de arriba.
        const { data, error } = await userA.rpc(name, args(B))
        expect(error, `${name} sobre unidad ajena debe fallar`).not.toBeNull()
        expect(data ?? null, `${name} no debe devolver datos`).toBeNull()
      })
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Gate por CLASE en paquetes_recibidos (motor único, 20260829000000)
// ════════════════════════════════════════════════════════════════════════════
// Que las policies estén ESCRITAS como deben lo verifica
// src/__tests__/recepcionMotorUnicoRls.test.ts; que se COMPORTEN así se prueba
// aquí (Supabase real) y en scripts/rls-recepcion-sandbox.sh (Postgres
// desechable, sin secretos).
//
// LAS PRECONDICIONES SON PARTE DE LA PRUEBA. Los cuatro usuarios tienen que
// pertenecer a la MISMA empresa y tener los roles esperados; si no, un "no ve
// la otra clase" podría estar pasando por aislamiento de tenant o por falta del
// rol, y no por el gate que se quiere comprobar. Por eso se afirman antes.
//
// NO DESTRUCTIVO: cada escenario siembra su propia fila desechable con quien sí
// tiene permiso y la limpia al final. Nunca toca datos preexistentes.
describe.skipIf(!ENABLED)('gate por clase en paquetes_recibidos (preview/sandbox)', () => {
  let paqUser: SupabaseClient    // rol granular, permiso de paquetería
  let corrUser: SupabaseClient   // rol granular, permiso de correspondencia
  let adminUser: SupabaseClient  // rol admin de la misma empresa
  let ownerUser: SupabaseClient  // rol company_owner de la misma empresa

  /** Scope para sembrar (empresa/proyecto/unidad). */
  let scopeCorr: { company_id: string; project_id: string } | null = null
  let scopePaq: { company_id: string; project_id: string; unidad_id: string } | null = null
  const basura: Array<{ cliente: () => SupabaseClient; id: string }> = []

  /** Fila `app_users` del usuario autenticado (rol + empresa). */
  async function perfil(c: SupabaseClient): Promise<{ role: string; company_id: string }> {
    const { data } = await c.from('app_users').select('role, company_id').eq('id', await userId(c)).maybeSingle()
    const p = data as { role: string; company_id: string } | null
    if (!p) throw new Error('el usuario no se ve a sí mismo en app_users')
    return p
  }

  async function tienePermiso(c: SupabaseClient, key: string): Promise<boolean> {
    const { data } = await c.rpc('user_has_permission', { perm_key: key })
    return data === true
  }

  /** Siembra una fila de la clase indicada y la deja anotada para limpiar. */
  async function sembrar(
    c: SupabaseClient, clase: 'paquete' | 'correspondencia',
  ): Promise<string> {
    const fila: Record<string, unknown> = clase === 'correspondencia'
      ? {
          company_id: scopeCorr!.company_id, project_id: scopeCorr!.project_id,
          clase, destinatario_tipo: 'administracion', unidad_id: null,
          tipo: 'carta', descripcion: 'RLS harness — desechable',
          estado: 'pendiente', direccion: 'entrante',
        }
      : {
          company_id: scopePaq!.company_id, project_id: scopePaq!.project_id,
          clase, destinatario_tipo: 'unidad', unidad_id: scopePaq!.unidad_id,
          tipo: 'paquete', descripcion: 'RLS harness — desechable',
          estado: 'pendiente', direccion: 'entrante',
        }
    const { data, error } = await c.from('paquetes_recibidos').insert(fila).select('id')
    expect(error, `quien tiene el permiso de ${clase} debe poder crearla`).toBeNull()
    const id = (data?.[0] as { id: string } | undefined)?.id
    expect(id, 'la siembra debe devolver el id').toBeTruthy()
    basura.push({ cliente: () => ownerUser, id: id! })
    return id!
  }

  beforeAll(async () => {
    ;[paqUser, corrUser, adminUser, ownerUser] = await Promise.all([
      signedInClient(PAQ_EMAIL!, PAQ_PASS!),
      signedInClient(CORR_EMAIL!, CORR_PASS!),
      signedInClient(ADMIN_EMAIL!, ADMIN_PASS!),
      signedInClient(OWNER_EMAIL!, OWNER_PASS!),
    ])

    // El scope se resuelve con el OWNER, no con los granulares. `projects` y
    // `unidades` tienen su propia RLS y no hay ninguna garantía de que un
    // `operator` las lea; si no las leyera, el scope quedaría nulo y los
    // escenarios reventarían con un error que no habla del gate. El owner sí
    // las ve, y las filas son de la misma empresa que los cuatro — cosa que las
    // precondiciones comprueban justo debajo.
    const { data: uni, error: eUni } = await ownerUser
      .from('unidades').select('id, project_id, company_id').limit(1)
    if (eUni) throw new Error(`no se pudo resolver la unidad del sandbox: ${eUni.message}`)
    const u = uni?.[0] as { id: string; project_id: string; company_id: string } | undefined
    if (!u) {
      // Fail-closed: sin unidad no se puede sembrar la clase 'paquete'
      // (`paquetes_unidad_por_clase_chk` la exige) y media suite no probaría
      // nada. Antes esto dejaba `scopePaq` en null y el fallo aparecía después,
      // disfrazado de otra cosa.
      throw new Error(
        'el sandbox no tiene ninguna unidad visible para el company_owner. ' +
        'Corré scripts/seed-rls-sandbox.mjs: crea el proyecto y la unidad del gate por clase.',
      )
    }
    scopePaq = { company_id: u.company_id, project_id: u.project_id, unidad_id: u.id }

    // ── El sandbox tiene que traer el ESQUEMA del motor único ─────────────
    // Sin esto, los seis escenarios que siembran una pieza fallan uno a uno con
    // `PGRST204 — Could not find the 'clase' column`, que suena a prueba rota y
    // no lo es: es el sandbox con el esquema atrasado. Se comprueba una vez y se
    // falla con la instrucción, en vez de seis veces con un código de PostgREST.
    //
    // Este caso apareció en cuanto el gate dejó de auto-saltarse: mientras las
    // 13 pruebas se omitían, el desajuste entre el esquema del sandbox y el del
    // repositorio era invisible.
    const { error: eEsquema } = await ownerUser
      .from('paquetes_recibidos').select('clase, destinatario_tipo').limit(1)
    if (eEsquema) {
      throw new Error(
        `El sandbox RLS no tiene el esquema del motor único de recepción: ${eEsquema.message}\n` +
        'Le faltan las migraciones 20260829000000 … 20260902000000, que son las que crean ' +
        '`clase`, `destinatario_tipo` y las policies por clase.\n' +
        'Aplicalas al proyecto del harness (el de RLS_EXPECTED_PROJECT_REF, que NO es la rama ' +
        'de preview del PR) y, si PostgREST sigue sin verlas, recargá su caché con ' +
        "NOTIFY pgrst, 'reload schema'.",
      )
    }
    // La correspondencia va dirigida a la administración, así que le basta el
    // proyecto — pero tiene que ser el MISMO, o el gate se confundiría con el
    // alcance por proyecto.
    scopeCorr = { company_id: u.company_id, project_id: u.project_id }
  })

  afterAll(async () => {
    // Limpieza con el owner, que es quien puede borrar las dos clases.
    for (const { cliente, id } of basura) {
      await cliente().from('paquetes_recibidos').delete().eq('id', id)
    }
    await Promise.allSettled([
      paqUser?.auth.signOut(), corrUser?.auth.signOut(),
      adminUser?.auth.signOut(), ownerUser?.auth.signOut(),
    ])
  })

  describe('precondiciones (sin esto, el resto no prueba lo que dice)', () => {
    it('los cuatro usuarios son de la MISMA empresa', async () => {
      const perfiles = await Promise.all([paqUser, corrUser, adminUser, ownerUser].map(perfil))
      const empresas = new Set(perfiles.map(p => p.company_id))
      expect(empresas.size, 'si fueran de empresas distintas, el aislamiento observado sería el de tenant').toBe(1)
    })

    it('los roles son los que cada gate necesita', async () => {
      const [paq, corr, admin, owner] = await Promise.all(
        [paqUser, corrUser, adminUser, ownerUser].map(perfil),
      )
      expect(admin.role).toBe('admin')
      expect(owner.role).toBe('company_owner')
      // Los granulares NO pueden ser admin: para un admin el helper de permisos
      // dice true a todo y el gate de clase de SELECT/INSERT/UPDATE no se vería.
      for (const g of [paq, corr]) {
        expect(['admin', 'company_owner', 'super_admin', 'superadmin']).not.toContain(g.role)
      }
    })

    it('los permisos efectivos son disjuntos entre los dos granulares', async () => {
      expect(await tienePermiso(paqUser, 'condominios.tab.paqueteria')).toBe(true)
      expect(await tienePermiso(paqUser, 'condominios.tab.correspondencia')).toBe(false)
      expect(await tienePermiso(corrUser, 'condominios.tab.correspondencia')).toBe(true)
      expect(await tienePermiso(corrUser, 'condominios.tab.paqueteria')).toBe(false)
    })

    it('el helper de permisos le dice true a TODO al admin (por eso DELETE va por rol)', async () => {
      expect(await tienePermiso(adminUser, 'condominios.tab.correspondencia')).toBe(true)
      expect(await tienePermiso(adminUser, 'permiso.que.no.existe')).toBe(true)
    })
  })

  describe('SELECT / INSERT / UPDATE: gate por permiso de clase', () => {
    it('cada granular ve SU clase y no la otra', async () => {
      await sembrar(corrUser, 'correspondencia')
      await sembrar(paqUser, 'paquete')

      const { data: paqVeCorr } = await paqUser.from('paquetes_recibidos').select('id').eq('clase', 'correspondencia')
      expect(paqVeCorr ?? []).toHaveLength(0)
      const { data: paqVePaq } = await paqUser.from('paquetes_recibidos').select('id').eq('clase', 'paquete')
      expect((paqVePaq ?? []).length, 'control positivo: sí ve la suya').toBeGreaterThan(0)

      const { data: corrVePaq } = await corrUser.from('paquetes_recibidos').select('id').eq('clase', 'paquete')
      expect(corrVePaq ?? []).toHaveLength(0)
      const { data: corrVeCorr } = await corrUser.from('paquetes_recibidos').select('id').eq('clase', 'correspondencia')
      expect((corrVeCorr ?? []).length, 'control positivo: sí ve la suya').toBeGreaterThan(0)
    })

    it('ninguno puede CREAR en la clase ajena', async () => {
      const { error: e1 } = await paqUser.from('paquetes_recibidos').insert({
        company_id: scopeCorr!.company_id, project_id: scopeCorr!.project_id,
        clase: 'correspondencia', destinatario_tipo: 'administracion',
        tipo: 'carta', descripcion: 'no debería entrar', estado: 'pendiente', direccion: 'entrante',
      }).select('id')
      expect(e1, 'el INSERT cross-clase debe ser rechazado').not.toBeNull()

      const { error: e2 } = await corrUser.from('paquetes_recibidos').insert({
        company_id: scopePaq!.company_id, project_id: scopePaq!.project_id,
        unidad_id: scopePaq!.unidad_id, clase: 'paquete', destinatario_tipo: 'unidad',
        tipo: 'paquete', descripcion: 'no debería entrar', estado: 'pendiente', direccion: 'entrante',
      }).select('id')
      expect(e2, 'el INSERT cross-clase debe ser rechazado').not.toBeNull()
    })

    it('reclasificar está bloqueado en LAS DOS direcciones', async () => {
      // USING mira la fila vieja y WITH CHECK la nueva: mover de clase exige
      // ambos permisos, y ninguno de los dos granulares los tiene.
      const idCorr = await sembrar(corrUser, 'correspondencia')
      const idPaq = await sembrar(paqUser, 'paquete')

      const { data: aPaquete } = await corrUser
        .from('paquetes_recibidos').update({ clase: 'paquete' }).eq('id', idCorr).select('id')
      expect(aPaquete ?? [], 'correspondencia→paquetería debe quedar en 0 filas').toHaveLength(0)

      const { data: aCorr } = await paqUser
        .from('paquetes_recibidos').update({ clase: 'correspondencia' }).eq('id', idPaq).select('id')
      expect(aCorr ?? [], 'paquetería→correspondencia debe quedar en 0 filas').toHaveLength(0)
    })
  })

  describe('DELETE: quién puede destruir cada clase', () => {
    it('admin SÍ borra paquetería (control positivo: nada cambió para paquetes)', async () => {
      const id = await sembrar(paqUser, 'paquete')
      const { data } = await adminUser.from('paquetes_recibidos').delete().eq('id', id).select('id')
      expect(data ?? [], 'el admin conserva su capacidad de siempre').toHaveLength(1)
    })

    it('admin NO borra correspondencia', async () => {
      // El caso central: mismo tenant, rol admin, y el helper de permisos
      // diciéndole true a todo. Lo único que lo detiene es el gate por rol.
      const id = await sembrar(corrUser, 'correspondencia')
      const { data: borradas } = await adminUser.from('paquetes_recibidos').delete().eq('id', id).select('id')
      expect(borradas ?? [], 'una notificación legal no la borra un admin').toHaveLength(0)

      const { data: viva } = await corrUser.from('paquetes_recibidos').select('id').eq('id', id)
      expect(viva ?? [], 'y la pieza sigue ahí').toHaveLength(1)
    })

    it('company_owner SÍ borra correspondencia (control positivo)', async () => {
      const id = await sembrar(corrUser, 'correspondencia')
      const { data } = await ownerUser.from('paquetes_recibidos').delete().eq('id', id).select('id')
      expect(data ?? [], 'alguien tiene que poder corregir un registro errado').toHaveLength(1)
    })

    it('el granular no borra ni siquiera su propia clase', async () => {
      // Borrar es competencia del rol, no del permiso de módulo.
      const id = await sembrar(paqUser, 'paquete')
      const { data } = await paqUser.from('paquetes_recibidos').delete().eq('id', id).select('id')
      expect(data ?? []).toHaveLength(0)
    })
  })
})

// NO hay bloque alternativo `describe.runIf(!ENABLED)`. Lo hubo, con un
// `it.skip('omitido — …')` que pretendía dejar constancia de la omisión, y era
// un fallo PERMANENTE: vitest incluye las pruebas skipped en el reporte JSON,
// así que ese test aparecía SIEMPRE —también con credenciales— y el verificador
// (`scripts/assert-rls-ejecutado.mjs`) lo leía como "harness omitido". El job no
// podía ponerse verde ni con el sandbox montado.
//
// La constancia de la omisión la da ahora quien tiene la información:
// `scripts/rls-preflight.mjs`, que decide antes de instalar nada y deja notice +
// resumen en la corrida. Aquí no queda ningún `it.skip`, y el verificador trata
// cualquier skip como cobertura perdida.
