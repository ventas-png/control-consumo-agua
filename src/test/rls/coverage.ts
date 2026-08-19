import cobertura from './coverage.json'

// ════════════════════════════════════════════════════════════════════════════
// Cobertura del harness RLS — tipado sobre `./coverage.json`.
// ════════════════════════════════════════════════════════════════════════════
// El JSON es la fuente única: lo lee también `scripts/seed-rls-sandbox.mjs`
// (Node puro, sin build), así que seed y harness no pueden desincronizarse.
//
// POR QUÉ EXISTE LA SEPARACIÓN
// La aserción de aislamiento es, en esencia:
//
//     for (const co of companyIdsDeB) expect(companyIdsDeA.has(co)).toBe(false)
//
// Con ambos conjuntos vacíos el bucle no itera y el test pasa SIN COMPARAR
// NADA. Declarar una tabla en `noTriviales` afirma «hay filas de las dos
// empresas y el aislamiento quedó demostrado». Declararla en `estructurales`
// afirma algo mucho más débil y honesto: «la policy responde y no hay fuga
// observable, pero la tabla puede estar vacía, así que su disjunción NO prueba
// aislamiento».

/**
 * Tablas tenant-scoped con cobertura REAL: el seed garantiza ≥1 fila de A y ≥1
 * de B, así que la disjunción compara conjuntos no vacíos.
 */
export const TENANT_SCOPED_NO_TRIVIALES: readonly string[] = cobertura.noTriviales

/**
 * Tablas tenant-scoped con cobertura ESTRUCTURAL: se consultan y se comprueba
 * que no hay fuga, pero pueden estar vacías. Su disjunción NO demuestra
 * aislamiento y no debe declararse como tal en ningún informe.
 */
export const TENANT_SCOPED_ESTRUCTURALES: readonly string[] = cobertura.estructurales

/**
 * Marcadores deterministas que el seed escribe y el harness busca. Es el canal
 * por el que el seed «entrega» los ids: entre una ejecución local del seed y un
 * job de CI no hay paso de parámetros, así que la identidad viaja por la BD.
 *
 * `regimenDocumento` respeta el CHECK de `documentos_fiscales`
 * (`regimen IN ('fel_gt','cfdi_mx')`, migración 20260604220000): un valor fuera
 * de esa lista aborta el INSERT por CHECK y nunca llega a evaluarse RLS, con lo
 * que la prueba negativa pasaría sin haber probado el aislamiento.
 */
export const FIXTURES: Readonly<Record<string, string>> = cobertura.fixtures

/** Todas las tablas tenant-scoped que el harness inspecciona. */
export const TENANT_SCOPED_TABLES: readonly string[] = [
  ...TENANT_SCOPED_NO_TRIVIALES,
  ...TENANT_SCOPED_ESTRUCTURALES,
]

/**
 * RPC críticas declaradas una a una, con lo que su prueba demuestra DE VERDAD.
 * Los tres valores se derivan del esquema (los verifica
 * `src/test/rls/__tests__/esquemaFixtures.test.ts` leyendo las migraciones):
 *
 *   `'tenant'`     — ejecutable por `authenticated` y con guard que compara
 *   `get_my_company_id()` contra la empresa del recurso. El usuario A es
 *   `company_owner`, así que pasa rol y permisos: el rechazo sólo puede venir de
 *   la pertenencia. Es el único valor que demuestra aislamiento entre tenants.
 *
 *   `'rol'`        — el guard exige ser cliente del portal, y los usuarios
 *   fixture son staff: rechaza antes de mirar la pertenencia. Demuestra que el
 *   guard existe y que la RPC no es anon-ejecutable. NO es aislamiento.
 *
 *   `'privilegio'` — EXECUTE revocado de PUBLIC y concedido sólo a
 *   `service_role`: no la puede invocar ningún usuario del navegador (#378/#380).
 *   Tampoco es aislamiento entre tenants.
 *
 * La distinción existe para que ningún informe cuente un rechazo por rol o por
 * privilegio como aislamiento verificado.
 */
export type GarantiaRpc = 'tenant' | 'rol' | 'privilegio'

export interface RpcObligatoria {
  nombre: string
  dominio: string
  porQue: string
  garantia: GarantiaRpc
}

export const RPCS_OBLIGATORIAS: readonly RpcObligatoria[] =
  cobertura.rpcsObligatorias as RpcObligatoria[]

/** Por qué las `portal_*` de escritura sólo alcanzan garantía de rol. */
export const MOTIVO_RPC_ROL: string = cobertura.motivoRpcRol

/** Por qué las RPC de notificaciones sólo alcanzan garantía de privilegio. */
export const MOTIVO_RPC_PRIVILEGIO: string = cobertura.motivoRpcPrivilegio
