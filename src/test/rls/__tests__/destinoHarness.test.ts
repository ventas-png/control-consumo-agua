import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import cobertura from '../coverage.json'
import { credencialesPresentes, exigirDestinoDeclarado, resolverDestino } from '../destino'

// ════════════════════════════════════════════════════════════════════════════
// DEFENSA EN PROFUNDIDAD: el harness se niega a operar contra un destino que no
// esté declarado, aunque nadie haya pasado por el preflight del workflow.
// ════════════════════════════════════════════════════════════════════════════
// El preflight protege el camino de CI y sólo ese. No protege a quien exporta
// las variables en su terminal y corre `npx vitest src/test/rls/rlsHarness.test.ts`
// —que es exactamente cómo se depura esta suite— ni al día en que alguien
// reordene los pasos del YAML. Como el harness hace INSERT, UPDATE y DELETE, la
// comprobación se repite dentro del propio módulo.
//
// SOBRE "ABORTA ANTES DE CONECTARSE"
// No se demuestra observando el orden de las líneas, sino por construcción:
// `../destino.ts` no importa `@supabase/supabase-js` ni nada capaz de abrir un
// socket, y su grafo de importaciones completo se comprueba abajo. Un guard que
// no puede conectarse no puede conectarse antes de abortar.

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8')
const FUENTE_HARNESS = leer('src/test/rls/rlsHarness.test.ts')
const FUENTE_GUARD = leer('src/test/rls/destino.ts')

const REF_PROD = cobertura.refProduccionProhibido
const SANDBOX = 'refdesandbox'

/** Entorno completo (las siete) con el destino que se le indique. */
const entorno = (url: string, esperado: string) => ({
  RLS_SUPABASE_URL: url,
  RLS_EXPECTED_PROJECT_REF: esperado,
  RLS_SUPABASE_ANON_KEY: 'anon-de-juguete',
  RLS_USER_A_EMAIL: 'a@sandbox.invalid',
  RLS_USER_A_PASSWORD: 'clave-a',
  RLS_USER_B_EMAIL: 'b@sandbox.invalid',
  RLS_USER_B_PASSWORD: 'clave-b',
})

describe('el harness aborta ante un destino no declarado', () => {
  it('PRODUCCIÓN: lanza aunque la URL y el ref declarado coincidan', () => {
    // El caso más peligroso, porque todo "cuadra": alguien pega la URL de prod y
    // declara su ref, así que el cerrojo de la declaración previa no salta. La
    // lista negra explícita existe para este único escenario.
    const env = entorno(`https://${REF_PROD}.supabase.co`, REF_PROD)
    expect(() => exigirDestinoDeclarado(env)).toThrow(/PRODUCCIÓN/)
    expect(resolverDestino(env).ok).toBe(false)
  })

  it('DOMINIO DESCONOCIDO: lanza', () => {
    const env = entorno('https://loquesea.evil.example.com', 'loquesea')
    expect(() => exigirDestinoDeclarado(env)).toThrow(/no está reconocido como Supabase/)
  })

  it('REF AUSENTE: con las credenciales puestas pero sin declaración, lanza', () => {
    const env = entorno('https://unsandboxcualquiera.supabase.co', '')
    expect(() => exigirDestinoDeclarado(env)).toThrow(/RLS_EXPECTED_PROJECT_REF/)
  })

  it('REF DISTINTO: URL de un proyecto y declaración de otro, lanza', () => {
    const env = entorno('https://proyecto-uno.supabase.co', 'proyecto-dos')
    expect(() => exigirDestinoDeclarado(env)).toThrow(/NO coincide/)
  })

  it('el mensaje explica por qué se aborta en vez de omitir', () => {
    try {
      exigirDestinoDeclarado(entorno(`https://${REF_PROD}.supabase.co`, REF_PROD))
      expect.unreachable('debería haber lanzado')
    } catch (e) {
      expect((e as Error).message).toContain('INSERT, UPDATE y DELETE')
      expect((e as Error).message).toContain('No se abre ninguna conexión')
    }
  })

  it('DESTINO VÁLIDO: habilita la suite y devuelve el ref', () => {
    const r = exigirDestinoDeclarado(entorno(`https://${SANDBOX}.supabase.co`, SANDBOX))
    expect(r.habilitado).toBe(true)
    expect(r.destino).toEqual({ ok: true, ref: SANDBOX })
  })

  it('SIN CREDENCIALES: no lanza y deja la suite deshabilitada', () => {
    // Es el caso local normal. No debe confundirse con un destino peligroso: sin
    // variables no hay nada contra lo que operar, así que la suite simplemente
    // no declara pruebas. En CI esto no ocurre — el preflight falla antes.
    const r = exigirDestinoDeclarado({})
    expect(r.habilitado).toBe(false)
    expect(r.destino).toMatchObject({ ok: false, clave: 'sin-credenciales' })
  })

  it('faltando UNA credencial cualquiera, sigue siendo "sin credenciales"', () => {
    const completo = entorno(`https://${SANDBOX}.supabase.co`, SANDBOX)
    for (const k of Object.keys(completo) as Array<keyof typeof completo>) {
      if (k === 'RLS_EXPECTED_PROJECT_REF') continue // ésa no es credencial
      const parcial = { ...completo, [k]: '' }
      expect(credencialesPresentes(parcial), `${k} vacía`).toBe(false)
      expect(exigirDestinoDeclarado(parcial).habilitado).toBe(false)
    }
  })
})

describe('el guard no puede abrir una conexión ni queriendo', () => {
  it('no importa el SDK de Supabase ni ningún cliente HTTP', () => {
    // Se miran los IMPORTS, no el texto: el comentario del módulo nombra el SDK
    // justamente para explicar por qué no se usa.
    const imports = [...FUENTE_GUARD.matchAll(/from '([^']+)'/g)].map((m) => m[1])
    for (const prohibido of ['@supabase/supabase-js', 'node:http', 'node:https']) {
      expect(imports, `destino.ts no debe importar ${prohibido}`).not.toContain(prohibido)
    }
    // Y tampoco una llamada suelta a fetch, que no aparecería como import.
    expect(FUENTE_GUARD).not.toMatch(/\bfetch\s*\(/)
  })

  it('su grafo de importaciones se limita al manifiesto y a la validación pura', () => {
    const imports = [...FUENTE_GUARD.matchAll(/from '([^']+)'/g)].map((m) => m[1])
    expect(imports.sort()).toEqual(['../../../scripts/rls-destino.mjs', './coverage.json'])
  })

  it('la validación se importa, no se reimplementa', () => {
    expect(FUENTE_GUARD).toContain("from '../../../scripts/rls-destino.mjs'")
  })

  it('el harness llama al guard y de él sale su ENABLED', () => {
    expect(FUENTE_HARNESS).toContain("import { exigirDestinoDeclarado } from './destino'")
    expect(FUENTE_HARNESS).toContain('const { habilitado: ENABLED } = exigirDestinoDeclarado({')
  })

  it('el guard se invoca antes de la primera línea que crea un cliente', () => {
    const iGuard = FUENTE_HARNESS.indexOf('exigirDestinoDeclarado({')
    const iCliente = FUENTE_HARNESS.indexOf('createClient(URL!')
    expect(iGuard).toBeGreaterThan(0)
    expect(iCliente).toBeGreaterThan(iGuard)
  })

  it('las siete variables llegan al guard', () => {
    const bloque = FUENTE_HARNESS.slice(
      FUENTE_HARNESS.indexOf('exigirDestinoDeclarado({'),
      FUENTE_HARNESS.indexOf('exigirDestinoDeclarado({') + 500,
    )
    for (const v of [
      'RLS_SUPABASE_URL',
      'RLS_SUPABASE_ANON_KEY',
      'RLS_EXPECTED_PROJECT_REF',
      'RLS_USER_A_EMAIL',
      'RLS_USER_A_PASSWORD',
      'RLS_USER_B_EMAIL',
      'RLS_USER_B_PASSWORD',
    ]) {
      expect(bloque, `${v} no se le pasa al guard`).toContain(v)
    }
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
  // Sólo código: los comentarios de estos archivos CITAN el DELETE amplio que se
  // eliminó, y esa cita no debe contarse como una limpieza viva.
  const borrados = FUENTE_HARNESS.split('\n')
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
    expect(FUENTE_HARNESS).toMatch(/MARCADOR_EFIMERO\s*=\s*`RLS-NEG-\$\{Date\.now\(\)\}-\$\{Math\.random\(\)/)
  })

  it('el marcador no puede colisionar con los fixtures del seed', () => {
    for (const [clave, valor] of Object.entries(cobertura.fixtures)) {
      expect(String(valor).startsWith('RLS-NEG'), `el fixture ${clave} colisiona con el marcador`).toBe(false)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Regresión: las pruebas deny-all no pueden asumir que existe una columna.
// ════════════════════════════════════════════════════════════════════════════
// Contra el sandbox real, el bloque «anon no puede leer tablas de negocio»
// pedía `select('id')` para las 31 tablas, y dos de ellas no tienen `id`:
// `notification_preferences` y `user_preferences` van por `user_id`. Resultado:
// 42703 (undefined_column) y dos pruebas en rojo — 125/127.
//
// Lo importante es qué habría pasado ANTES de endurecer `esperaDenegacion`: con
// el `expect(data ?? []).toHaveLength(0)` original, ese error se habría contado
// como «0 filas» y el job habría salido verde sin haber comprobado nada. El
// fallo es, en realidad, la prueba de que el deny-all estricto funciona.
//
// La corrección es `select('*')`, que es además lo que el bloque quiere: sólo
// pregunta «¿error permitido, o cero filas?», nunca el valor de una columna.
describe('deny-all: ninguna aserción asume una columna concreta', () => {
  /** Todas las llamadas a `esperaDenegacion` del harness, con sus argumentos. */
  const llamadas = [...FUENTE_HARNESS.matchAll(/esperaDenegacion\(([^)]*)\)/g)].map((m) =>
    m[1].split(',').map((a) => a.trim()),
  )

  it('hay llamadas que auditar (si no, esta prueba sería vacua)', () => {
    expect(llamadas.length).toBeGreaterThan(3)
  })

  it('el bloque de tablas de negocio NO pide `id`', () => {
    // La regresión concreta: `esperaDenegacion(anon, table, 'id', 'anon')`.
    const conId = llamadas.filter((args) => args[2] === "'id'")
    expect(conId, `siguen pidiendo 'id': ${JSON.stringify(conId)}`).toEqual([])
  })

  it('toda llamada iterada sobre una LISTA de tablas proyecta `*`', () => {
    // Cuando el nombre de la tabla es una variable de bucle, no se puede saber
    // qué columnas tiene: la única proyección segura es `*`. Una columna literal
    // sólo se admite para una tabla concreta y nombrada (p. ej. user_sessions,
    // que sí se sabe que tiene `sid`).
    const iteradas = llamadas.filter((args) => args[1] === 'table')
    expect(iteradas.length).toBeGreaterThan(0)
    for (const args of iteradas) {
      expect(args[2], `proyección insegura sobre una tabla variable: ${args.join(', ')}`).toBe("'*'")
    }
  })

  it('las dos tablas del fallo real se consultan por user_id, no por id', () => {
    // Comprobación de que el diagnóstico era correcto: en el bloque user-scoped
    // —que sí pasó— estas tablas se leen por `user_id`.
    for (const tabla of ['notification_preferences', 'user_preferences']) {
      expect(FUENTE_HARNESS).toContain(tabla)
    }
    expect(FUENTE_HARNESS).toMatch(/USER_SCOPED_TABLES[\s\S]{0,200}notification_preferences/)
    expect(FUENTE_HARNESS).toContain("select('user_id')")
  })

  it('esperaDenegacion sigue distinguiendo «denegado» de «roto»', () => {
    // Si alguien lo relajara a `expect(data ?? []).toHaveLength(0)`, un 42703
    // volvería a pasar por verde. Es lo que hizo visible este fallo.
    expect(FUENTE_HARNESS).toContain('CODIGOS_DENEGACION_OK')
    expect(FUENTE_HARNESS).toContain('recibió un error INESPERADO')
  })
})
