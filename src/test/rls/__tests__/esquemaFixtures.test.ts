import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FIXTURES, MOTIVO_RPC_PRIVILEGIO, MOTIVO_RPC_ROL, RPCS_OBLIGATORIAS } from '../coverage'

// ════════════════════════════════════════════════════════════════════════════
// Prueba CONTRACTUAL: los fixtures del seed/harness contra el esquema real.
// ════════════════════════════════════════════════════════════════════════════
// POR QUÉ EXISTE
// El harness prueba que RLS RECHAZA una escritura cruzada. Si el payload viola
// un CHECK del esquema, Postgres lo aborta ANTES de evaluar la policy: el test
// «pasa» sin haber probado aislamiento — un falso positivo silencioso. Eso pasó
// con `regimen: 'general'`, que no está en `CHECK (regimen IN ('fel_gt',
// 'cfdi_mx'))`. Esta prueba lee la migración y falla si un fixture vuelve a
// salirse del dominio permitido.

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..', '..', '..')
const MIGRACIONES = join(RAIZ, 'supabase', 'migrations')

const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8')

const MIGRACION_FISCAL = leer(
  'supabase/migrations/20260604220000_fiscal_documents_fel_cfdi.sql',
)
const SEED = leer('scripts/seed-rls-sandbox.mjs')
const HARNESS = leer('src/test/rls/rlsHarness.test.ts')

/**
 * Extrae los literales de un `CHECK (<columna> IN ('a', 'b'))` en el bloque
 * CREATE TABLE de `documentos_fiscales`.
 */
function valoresDelCheck(sql: string, columna: string): string[] {
  const patron = new RegExp(`CHECK\\s*\\(\\s*${columna}\\s+IN\\s*\\(([^)]*)\\)`, 'i')
  const m = sql.match(patron)
  expect(m, `no se encontró el CHECK de ${columna} en la migración fiscal`).toBeTruthy()
  return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

describe('contrato de esquema — documentos_fiscales', () => {
  it('el CHECK de regimen sigue siendo exactamente fel_gt | cfdi_mx', () => {
    expect(valoresDelCheck(MIGRACION_FISCAL, 'regimen')).toEqual(['fel_gt', 'cfdi_mx'])
  })

  it('FIXTURES.regimenDocumento pertenece al dominio del CHECK', () => {
    expect(valoresDelCheck(MIGRACION_FISCAL, 'regimen')).toContain(FIXTURES.regimenDocumento)
  })

  it("'general' sigue siendo un régimen inválido (no se relajó el CHECK)", () => {
    expect(valoresDelCheck(MIGRACION_FISCAL, 'regimen')).not.toContain('general')
  })

  it('FIXTURES.tipoDocumento pertenece al dominio del CHECK de tipo', () => {
    expect(valoresDelCheck(MIGRACION_FISCAL, 'tipo')).toContain(FIXTURES.tipoDocumento)
  })

  it('ni el seed ni el harness reintroducen un régimen fuera del CHECK', () => {
    const permitidos = valoresDelCheck(MIGRACION_FISCAL, 'regimen')
    for (const [archivo, fuente] of [
      ['seed-rls-sandbox.mjs', SEED],
      ['rlsHarness.test.ts', HARNESS],
    ] as const) {
      for (const m of fuente.matchAll(/regimen:\s*'([^']+)'/g)) {
        expect(permitidos, `${archivo} usa regimen '${m[1]}', fuera del CHECK`).toContain(m[1])
      }
    }
  })
})

describe('contrato de cobertura — RPCs del portal', () => {
  const rpcsEnMigraciones = new Set<string>()
  for (const archivo of readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(join(MIGRACIONES, archivo), 'utf8')
    for (const m of sql.matchAll(/FUNCTION\s+public\.(portal_\w+)/g)) rpcsEnMigraciones.add(m[1])
  }

  it('la migración de baja de renta existe', () => {
    expect(readdirSync(MIGRACIONES)).toContain('20260827000000_portal_baja_renta.sql')
  })

  it('portal_baja_renta está DECLARADA en una colección del harness, no solo filtrada', () => {
    // El bug anterior: `portal_baja_renta` solo aparecía en un `.filter()` que
    // no encontraba nada, así que generaba CERO pruebas — cobertura aparente.
    expect(HARNESS).toMatch(/name:\s*'portal_baja_renta'/)
  })

  it('toda RPC portal_* del esquema está nombrada en el harness', () => {
    const ausentes = [...rpcsEnMigraciones].filter(
      (nombre) => !new RegExp(`name:\\s*'${nombre}'`).test(HARNESS),
    )
    expect(ausentes, `RPCs portal_* sin prueba en el harness: ${ausentes.join(', ')}`).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Contrato de HONESTIDAD: qué demuestra la prueba de cada RPC.
// ════════════════════════════════════════════════════════════════════════════
// Un rechazo puede venir de tres sitios distintos y sólo UNO de ellos prueba
// aislamiento entre tenants:
//
//   privilegio — la RPC no está concedida a `authenticated` (sólo service_role).
//   rol        — el guard exige cliente del portal y los fixture son staff.
//   tenant     — el llamante pasa privilegio y rol, así que sólo puede rechazar
//                la comparación de empresa. Aislamiento demostrado.
//
// La clasificación no se declara a mano y se cree: se DERIVA de las migraciones
// y se contrasta con lo declarado en coverage.json. Si mañana alguien concede
// una RPC de notificaciones a `authenticated`, o añade el gate de cliente a una
// del ERP, esta prueba obliga a reclasificarla en vez de dejar el informe
// diciendo algo que ya no es cierto.
describe('contrato de garantías — qué demuestra cada RPC', () => {
  const SQL = readdirSync(MIGRACIONES)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(MIGRACIONES, f), 'utf8'))
    .join('\n')

  /** Cuerpo de la ÚLTIMA definición de la RPC (la que gana tras las migraciones). */
  function cuerpoDe(nombre: string): string | null {
    const partes = SQL.split(new RegExp(`CREATE OR REPLACE FUNCTION\\s+public\\.${nombre}\\b`))
    if (partes.length < 2) return null
    const resto = partes[partes.length - 1]
    const fin = resto.indexOf('$fn$;') >= 0 ? resto.indexOf('$fn$;') : resto.indexOf('$$;')
    return resto.slice(0, fin > 0 ? fin : 4000)
  }

  /** ¿Se le concedió EXECUTE a `authenticated`? El GRANT puede partir la línea. */
  function concedidaAAuthenticated(nombre: string): boolean {
    return new RegExp(
      `GRANT EXECUTE ON FUNCTION public\\.${nombre}\\([^)]*\\)\\s*(?:\\n\\s*)?TO [^;]*authenticated`,
    ).test(SQL)
  }

  /** La garantía que el ESQUEMA sostiene, con los usuarios fixture actuales. */
  function garantiaDelEsquema(nombre: string): 'tenant' | 'rol' | 'privilegio' | null {
    const cuerpo = cuerpoDe(nombre)
    if (cuerpo === null) return null
    if (!concedidaAAuthenticated(nombre)) return 'privilegio'
    // A es company_owner: pasa rol y permisos, así que un guard que compare
    // empresas sólo puede rechazarlo por pertenencia.
    return cuerpo.includes('get_my_company_id()') ? 'tenant' : 'rol'
  }

  it('todas las RPC obligatorias existen en las migraciones', () => {
    const sinDefinir = RPCS_OBLIGATORIAS.filter((r) => cuerpoDe(r.nombre) === null).map((r) => r.nombre)
    expect(sinDefinir, `RPC declaradas que no existen: ${sinDefinir.join(', ')}`).toEqual([])
  })

  it.each(RPCS_OBLIGATORIAS.map((r) => [r.nombre, r.garantia]))(
    'la garantía declarada de %s (%s) es la que sostiene el esquema',
    (nombre, declarada) => {
      expect(garantiaDelEsquema(nombre)).toBe(declarada)
    },
  )

  it('las tres garantías están representadas y ninguna se infla', () => {
    const cuenta = (g: string) => RPCS_OBLIGATORIAS.filter((r) => r.garantia === g).length
    expect(cuenta('tenant')).toBeGreaterThan(0)
    expect(cuenta('rol')).toBeGreaterThan(0)
    expect(cuenta('privilegio')).toBeGreaterThan(0)
    expect(cuenta('tenant') + cuenta('rol') + cuenta('privilegio')).toBe(RPCS_OBLIGATORIAS.length)
  })

  it('las RPC de notificaciones NO se declaran aislamiento (sólo service_role)', () => {
    // #378/#380 se cerró revocando EXECUTE, no con un check de empresa. Contar
    // esos rechazos como aislamiento sería inventar cobertura.
    for (const nombre of ['enqueue_notification', 'claim_notifications_batch', 'mark_notification_result']) {
      const r = RPCS_OBLIGATORIAS.find((x) => x.nombre === nombre)
      expect(r?.garantia, `${nombre} no puede declararse garantía de tenant`).toBe('privilegio')
      expect(concedidaAAuthenticated(nombre)).toBe(false)
    }
  })

  it('las portal_* de escritura del propietario son garantía de ROL, no de tenant', () => {
    for (const nombre of [
      'portal_registrar_inquilino',
      'portal_quitar_inquilino',
      'portal_registrar_familiar',
      'portal_quitar_familiar',
      'portal_baja_renta',
    ]) {
      const r = RPCS_OBLIGATORIAS.find((x) => x.nombre === nombre)
      expect(r?.garantia, `${nombre} rechaza por rol con usuarios staff`).toBe('rol')
      expect(cuerpoDe(nombre)).toMatch(/current_user_role\(\)\s*<>\s*'cliente'/)
    }
  })

  it('las reservas del portal SÍ son garantía de tenant (tienen rama de staff)', () => {
    // portal_reservar_amenidad / portal_cancelar_reserva aceptan al staff del
    // tenant y comparan company_id: con A company_owner el único rechazo posible
    // es la pertenencia. Clasificarlas como "rol" habría INFRAvalorado la
    // cobertura, que es tan inexacto como inflarla.
    for (const nombre of ['portal_reservar_amenidad', 'portal_cancelar_reserva']) {
      expect(RPCS_OBLIGATORIAS.find((x) => x.nombre === nombre)?.garantia).toBe('tenant')
      expect(cuerpoDe(nombre)).toContain('get_my_company_id()')
    }
  })

  it('los motivos están escritos y dicen qué faltaría para subir de garantía', () => {
    expect(MOTIVO_RPC_ROL).toContain('cliente')
    expect(MOTIVO_RPC_ROL).toContain('unidad_residentes')
    expect(MOTIVO_RPC_PRIVILEGIO).toContain('service_role')
  })

  it('el harness declara la garantía en el nombre de cada describe de RPC', () => {
    // Es lo que se lee en el reporte JSON publicado como evidencia: quien mire
    // el artefacto ve "garantía de ROL" sin tener que abrir coverage.json.
    const esperado: Array<[string, string]> = [
      ['self-service de inquilinos', 'garantía de ROL'],
      ['accesos familiares', 'garantía de ROL'],
      ['baja de renta', 'garantía de ROL'],
      ['reservas del portal', 'garantía de TENANT'],
      ['ERP financiero', 'garantía de TENANT'],
      ['estatus de bóvedas', 'garantía de TENANT'],
      ['notificaciones', 'garantía de PRIVILEGIO'],
    ]
    for (const [bloque, marca] of esperado) {
      const linea = HARNESS.split('\n').find((l) => l.includes("describe('guard RPCs") && l.includes(bloque))
      expect(linea, `no se encontró el describe de ${bloque}`).toBeTruthy()
      expect(linea, `${bloque} debe declarar su garantía en el nombre`).toContain(marca)
    }
  })
})
