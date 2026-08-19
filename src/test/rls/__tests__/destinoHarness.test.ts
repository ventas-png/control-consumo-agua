import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import cobertura from '../coverage.json'

// ════════════════════════════════════════════════════════════════════════════
// DEFENSA EN PROFUNDIDAD: el harness se niega a conectarse a un destino no
// declarado, aunque nadie haya pasado por el preflight.
// ════════════════════════════════════════════════════════════════════════════
// El preflight del workflow protege el camino de CI. No protege a quien exporta
// las variables en su terminal y corre `npx vitest src/test/rls/rlsHarness.test.ts`
// —que es exactamente cómo se depura esta suite— ni al día en que alguien
// reordene los pasos del YAML. Como el harness hace INSERT, UPDATE y DELETE, la
// comprobación se repite dentro del propio módulo.
//
// Lo que estas pruebas demuestran no es que el mensaje sea bonito, sino que
// **no se abre ninguna conexión**: se sustituye `@supabase/supabase-js` por un
// espía y se afirma que `createClient` no se llamó ni una vez.

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const FUENTE = readFileSync(join(RAIZ, 'src', 'test', 'rls', 'rlsHarness.test.ts'), 'utf8')

const createClientEspia = vi.fn(() => {
  throw new Error('createClient NO debería llamarse con un destino rechazado')
})
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientEspia }))

const REF_PROD = cobertura.refProduccionProhibido
const CLAVES = [
  'RLS_SUPABASE_URL',
  'RLS_SUPABASE_ANON_KEY',
  'RLS_EXPECTED_PROJECT_REF',
  'RLS_USER_A_EMAIL',
  'RLS_USER_A_PASSWORD',
  'RLS_USER_B_EMAIL',
  'RLS_USER_B_PASSWORD',
] as const

const originales: Record<string, string | undefined> = {}

/** Exporta un entorno COMPLETO (las siete) con el destino que se le indique. */
function conDestino(url: string, esperado: string) {
  process.env.RLS_SUPABASE_URL = url
  process.env.RLS_EXPECTED_PROJECT_REF = esperado
  process.env.RLS_SUPABASE_ANON_KEY = 'anon-de-juguete'
  process.env.RLS_USER_A_EMAIL = 'a@sandbox.invalid'
  process.env.RLS_USER_A_PASSWORD = 'clave-a'
  process.env.RLS_USER_B_EMAIL = 'b@sandbox.invalid'
  process.env.RLS_USER_B_PASSWORD = 'clave-b'
}

/**
 * Importa el harness de cero y devuelve el error que lanzó, o null.
 * `resetModules` es imprescindible: sin él la segunda importación reutilizaría
 * la evaluación de la primera y el caso no se ejercitaría.
 */
async function importarHarness(): Promise<Error | null> {
  vi.resetModules()
  try {
    await import('../rlsHarness.test')
    return null
  } catch (e) {
    return e as Error
  }
}

beforeEach(() => {
  for (const k of CLAVES) originales[k] = process.env[k]
  createClientEspia.mockClear()
})

afterEach(() => {
  for (const k of CLAVES) {
    if (originales[k] === undefined) delete process.env[k]
    else process.env[k] = originales[k]
  }
})

describe('el harness aborta ANTES de conectarse a un destino no declarado', () => {
  it('PRODUCCIÓN: lanza al importar y no crea ningún cliente', async () => {
    conDestino(`https://${REF_PROD}.supabase.co`, REF_PROD)
    const error = await importarHarness()
    expect(error, 'importar el harness apuntando a producción debe lanzar').not.toBeNull()
    expect(error!.message).toContain('PRODUCCIÓN')
    expect(createClientEspia, 'no debe abrirse ninguna conexión').not.toHaveBeenCalled()
  })

  it('DOMINIO DESCONOCIDO: lanza y no crea ningún cliente', async () => {
    conDestino('https://loquesea.evil.example.com', 'loquesea')
    const error = await importarHarness()
    expect(error).not.toBeNull()
    expect(error!.message).toContain('no está reconocido como Supabase')
    expect(createClientEspia).not.toHaveBeenCalled()
  })

  it('REF AUSENTE: con las credenciales puestas pero sin declaración, lanza', async () => {
    conDestino('https://unsandboxcualquiera.supabase.co', '')
    const error = await importarHarness()
    expect(error).not.toBeNull()
    expect(error!.message).toContain('RLS_EXPECTED_PROJECT_REF')
    expect(createClientEspia).not.toHaveBeenCalled()
  })

  it('REF DISTINTO: URL de un proyecto y declaración de otro, lanza', async () => {
    conDestino('https://proyecto-uno.supabase.co', 'proyecto-dos')
    const error = await importarHarness()
    expect(error).not.toBeNull()
    expect(error!.message).toContain('NO coincide')
    expect(createClientEspia).not.toHaveBeenCalled()
  })

  // El caso "sin credenciales" NO se prueba importando: ahí el módulo NO lanza,
  // así que llega a su `describe`, y vitest prohíbe registrar suites desde
  // dentro de un test. Que la ausencia de secretos no se confunda con un
  // destino peligroso queda cubierto por el bloque estático de abajo
  // (`ENABLED = CREDENCIALES_OK && DESTINO.ok`) y por las pruebas del preflight.
})

describe('el guard está donde tiene que estar', () => {
  it('la validación se importa, no se reimplementa', () => {
    expect(FUENTE).toContain("import { validarDestino } from '../../../scripts/rls-destino.mjs'")
  })

  it('el destino se evalúa antes de la primera línea que crea un cliente', () => {
    // Orden en el fuente: si `createClient` apareciera antes del guard, el
    // módulo podría abrir una conexión durante su propia evaluación.
    const iGuard = FUENTE.indexOf('validarDestino({')
    const iCliente = FUENTE.indexOf('createClient(URL!')
    expect(iGuard).toBeGreaterThan(0)
    expect(iCliente).toBeGreaterThan(iGuard)
  })

  it('ENABLED exige credenciales Y destino válido', () => {
    expect(FUENTE).toContain('const ENABLED = CREDENCIALES_OK && DESTINO.ok')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Auditoría de las LIMPIEZAS.
// ════════════════════════════════════════════════════════════════════════════
// Una limpieza demasiado amplia no rompe la corrida en la que se escribe: rompe
// la SIGUIENTE. El `afterAll` borraba `documentos_fiscales` filtrando por
// `company_id`, así que se llevaba por delante el comprobante que siembra
// `seed-rls-sandbox.mjs` — el que hace que esa tabla tenga cobertura NO TRIVIAL.
// La segunda corrida fallaba por "B no ve ninguna fila propia", y si alguien
// hubiera relajado esa aserción para "arreglarlo", la disjunción habría vuelto a
// ser trivial: verde hueco otra vez, por la puerta de atrás.
describe('ninguna limpieza puede tocar fixtures preexistentes', () => {
  // Sólo código: los comentarios de este archivo CITAN el DELETE amplio que se
  // eliminó, y esa cita no debe contarse como una limpieza viva.
  const borrados = FUENTE.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('.delete()') && !l.startsWith('//') && !l.startsWith('*'))

  it('hay limpiezas que auditar (si no, esta prueba sería vacua)', () => {
    expect(borrados.length).toBeGreaterThan(0)
  })

  it('ningún DELETE filtra por company_id', () => {
    // Es el filtro que arrasa con todo lo del tenant, fixtures incluidos.
    const amplios = borrados.filter((l) => /\.delete\(\)[^\n]*company_id/.test(l))
    expect(amplios, `DELETE demasiado amplio:\n${amplios.join('\n')}`).toEqual([])
  })

  it('cada DELETE se acota por el marcador efímero o por ids concretos', () => {
    const sospechosos = borrados.filter(
      (l) => !l.includes('MARCADOR_EFIMERO') && !/\.in\('id',/.test(l),
    )
    expect(sospechosos, `DELETE sin acotar:\n${sospechosos.join('\n')}`).toEqual([])
  })

  it('el marcador es único por corrida (dos ejecuciones no se pisan)', () => {
    // Sin la parte aleatoria, dos corridas simultáneas contra el mismo sandbox
    // se borrarían las filas la una a la otra.
    expect(FUENTE).toMatch(/MARCADOR_EFIMERO\s*=\s*`RLS-NEG-\$\{Date\.now\(\)\}-\$\{Math\.random\(\)/)
  })

  it('el marcador no puede colisionar con los fixtures del seed', () => {
    // Los fixtures llevan prefijos propios (SANDBOX, CLI-SANDBOX…). Si alguno
    // empezara por RLS-NEG, la limpieza se lo llevaría.
    for (const [clave, valor] of Object.entries(cobertura.fixtures)) {
      expect(String(valor).startsWith('RLS-NEG'), `el fixture ${clave} colisiona con el marcador`).toBe(false)
    }
  })
})
