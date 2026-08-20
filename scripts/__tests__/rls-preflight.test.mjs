// ════════════════════════════════════════════════════════════════════════════
// Prueba CONTRACTUAL del gate del job "RLS harness (server-side)".
//
// El preflight decide si el aislamiento multi-tenant se verifica o no, y contra
// QUÉ proyecto. Su tabla de verdad es parte del contrato de seguridad del repo y
// no puede vivir en un bloque de bash dentro del YAML. Se cubren:
//
//   fork          → GitHub no expone secretos por diseño → BLOQUEADO (rojo)
//   dependabot PR → los Actions secrets no llegan al bot → BLOQUEADO (rojo)
//   PR interno    → los secretos DEBERÍAN estar          → fail-closed
//   push a main   → los secretos DEBERÍAN estar          → fail-closed
//   destino malo  → producción / dominio raro / ref que no cuadra → fail-closed,
//                   y ANTES de instalar nada o abrir ninguna conexión
//
// Y además se comprueba que el workflow REAL invoca este script, que le pasa el
// contexto, que conserva el disparador de `push`, y que no usa
// `pull_request_target`, que expondría los secretos al código del PR.
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  VARIABLES_RLS,
  cargarCobertura,
  decidirPreflight,
  motivoSinSecretos,
  resumenMarkdown,
} from '../rls-preflight.mjs'

const COBERTURA = cargarCobertura()
const REF_SANDBOX = 'sandboxdeprueba'
const REF_PRODUCCION = COBERTURA.refProduccionProhibido

/** Entorno con las SIETE variables presentes y un destino coherente. */
const CON_SECRETOS = {
  RLS_SUPABASE_URL: `https://${REF_SANDBOX}.supabase.co`,
  RLS_SUPABASE_ANON_KEY: 'anon-de-juguete',
  RLS_EXPECTED_PROJECT_REF: REF_SANDBOX,
  RLS_USER_A_EMAIL: 'a@sandbox.invalid',
  RLS_USER_A_PASSWORD: 'clave-a',
  RLS_USER_B_EMAIL: 'b@sandbox.invalid',
  RLS_USER_B_PASSWORD: 'clave-b',
}

/** Azúcar: `decidirPreflight` con la cobertura real siempre enchufada. */
const decidir = (env) => decidirPreflight(env, COBERTURA)

describe('el contrato de variables', () => {
  it('son SIETE, y RLS_EXPECTED_PROJECT_REF es una de ellas', () => {
    // No es una credencial: es la DECLARACIÓN del proyecto. Sin ella, cambiar el
    // secreto de la URL bastaría para que el harness —que hace INSERT, UPDATE y
    // DELETE— escribiera en otro proyecto sin que nada lo notara.
    expect(VARIABLES_RLS).toHaveLength(7)
    expect(VARIABLES_RLS).toContain('RLS_EXPECTED_PROJECT_REF')
  })

  it('el fixture de prueba cubre exactamente las siete', () => {
    expect(Object.keys(CON_SECRETOS).sort()).toEqual([...VARIABLES_RLS].sort())
  })
})

describe('decidirPreflight — con las siete variables y destino declarado', () => {
  it('ejecuta el harness en un PR interno', () => {
    const v = decidir({ ...CON_SECRETOS, ES_FORK: 'false', GITHUB_ACTOR: 'ventas-png' })
    expect(v.decision).toBe('run')
    expect(v.faltan).toEqual([])
    expect(v.destino.ok).toBe(true)
    expect(v.destino.ref).toBe(REF_SANDBOX)
  })

  it('ejecuta el harness incluso si el actor es Dependabot (si hay secretos, se usan)', () => {
    expect(decidir({ ...CON_SECRETOS, GITHUB_ACTOR: 'dependabot[bot]' }).decision).toBe('run')
  })

  it('el mensaje nombra el ref del destino, que no es secreto', () => {
    expect(decidir(CON_SECRETOS).mensaje).toContain(REF_SANDBOX)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// El destino: abortar ANTES de instalar nada y ANTES de conectarse.
// ════════════════════════════════════════════════════════════════════════════
// El harness escribe y borra filas. Apuntarlo al proyecto equivocado no es un CI
// en rojo: son datos de alguien contaminados. Estas pruebas fijan que los cuatro
// casos peligrosos terminan en `fail` —nunca en `run`— así que el paso de
// `npm ci` y todo lo que venga después queda condicionado a `run` y no llega a
// ejecutarse. La validación es PURA: no abre sockets, así que "abortó antes de
// conectarse" es una propiedad de su firma, no una promesa.
describe('decidirPreflight — destino RECHAZADO antes de cualquier conexión', () => {
  it('PRODUCCIÓN: aunque la URL y el ref declarado coincidan, se rechaza', () => {
    // El caso más peligroso, porque es el único en que todo "cuadra": alguien
    // pega la URL de prod y declara su ref. La lista negra explícita lo corta.
    const v = decidir({
      ...CON_SECRETOS,
      RLS_SUPABASE_URL: `https://${REF_PRODUCCION}.supabase.co`,
      RLS_EXPECTED_PROJECT_REF: REF_PRODUCCION,
    })
    expect(v.decision).toBe('fail')
    expect(v.destino.clave).toBe('produccion')
    expect(v.mensaje).toContain('PRODUCCIÓN')
    expect(v.mensaje).toContain('No se instaló nada ni se abrió ninguna conexión')
  })

  it('DOMINIO DESCONOCIDO: un host que no es Supabase se rechaza', () => {
    const v = decidir({
      ...CON_SECRETOS,
      RLS_SUPABASE_URL: `https://${REF_SANDBOX}.evil.example.com`,
    })
    expect(v.decision).toBe('fail')
    expect(v.destino.clave).toBe('dominio-desconocido')
  })

  it('REF AUSENTE: sin declaración previa no se opera, aunque la URL sea válida', () => {
    const v = decidir({ ...CON_SECRETOS, RLS_EXPECTED_PROJECT_REF: '' })
    // Ojo: la variable vacía cuenta primero como AUSENTE (fail-closed de las
    // siete). El desenlace es el mismo —`fail`— y es lo que importa.
    expect(v.decision).toBe('fail')
    expect(v.faltan).toEqual(['RLS_EXPECTED_PROJECT_REF'])
  })

  it('REF DISTINTO: URL de un proyecto y declaración de otro → abortar', () => {
    // El descuido típico: se actualiza el secreto de la URL y se olvida el ref
    // (o al revés). No se adivina cuál de los dos está bien.
    const v = decidir({
      ...CON_SECRETOS,
      RLS_SUPABASE_URL: 'https://otroproyectodistinto.supabase.co',
    })
    expect(v.decision).toBe('fail')
    expect(v.destino.clave).toBe('ref-distinto')
    expect(v.mensaje).toContain('otroproyectodistinto')
    expect(v.mensaje).toContain(REF_SANDBOX)
  })

  it('URL MALFORMADA: no se intenta adivinar el destino', () => {
    const v = decidir({ ...CON_SECRETOS, RLS_SUPABASE_URL: 'postgres://algo/db' })
    expect(v.decision).toBe('fail')
    expect(v.destino.clave).toBe('url-malformada')
  })

  it('ningún destino rechazado produce `run` — es lo que gatea npm ci', () => {
    const peligrosos = [
      { RLS_SUPABASE_URL: `https://${REF_PRODUCCION}.supabase.co`, RLS_EXPECTED_PROJECT_REF: REF_PRODUCCION },
      { RLS_SUPABASE_URL: `https://${REF_SANDBOX}.no-supabase.test` },
      { RLS_SUPABASE_URL: 'https://otro-ref-distinto.supabase.co' },
      { RLS_SUPABASE_URL: 'no-es-una-url' },
      { RLS_EXPECTED_PROJECT_REF: ' ' },
    ]
    for (const caso of peligrosos) {
      const v = decidir({ ...CON_SECRETOS, ...caso })
      expect(v.decision, `${JSON.stringify(caso)} no debe ejecutarse`).not.toBe('run')
    }
  })

  it('el resumen del destino rechazado explica el riesgo, sin filtrar valores', () => {
    const md = resumenMarkdown(decidir({
      ...CON_SECRETOS,
      RLS_SUPABASE_URL: `https://${REF_PRODUCCION}.supabase.co`,
      RLS_EXPECTED_PROJECT_REF: REF_PRODUCCION,
    }))
    expect(md).toContain('el destino no está declarado')
    expect(md).toContain('antes')
    expect(md).not.toContain('anon-de-juguete')
    expect(md).not.toContain('clave-a')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Sin secretos por diseño: BLOQUEADO, no omitido.
// ════════════════════════════════════════════════════════════════════════════
// Antes, fork y Dependabot salían con exit 0 y un `::notice`: un check VERDE en
// un PR cuyo aislamiento nadie había verificado. Y un check verde es
// exactamente lo que autoriza a fusionar. El argumento «se valida en el push a
// main posterior» confunde detección con prevención: cuando ese job falla, el
// cambio ya está en main.
describe('contextos sin secretos por diseño — el check queda ROJO', () => {
  const FORK = { ES_FORK: 'true', GITHUB_ACTOR: 'alguien-de-fuera', GITHUB_EVENT_NAME: 'pull_request' }
  const DEPENDABOT_PR = { ES_FORK: 'false', GITHUB_ACTOR: 'dependabot[bot]', GITHUB_EVENT_NAME: 'pull_request' }

  it('PR de fork: bloqueado, NUNCA `run`', () => {
    const v = decidir(FORK)
    expect(v.decision).toBe('bloqueado')
    expect(v.motivo.clave).toBe('fork')
    expect(v.faltan).toEqual(VARIABLES_RLS)
  })

  it('PR de Dependabot: bloqueado', () => {
    const v = decidir(DEPENDABOT_PR)
    expect(v.decision).toBe('bloqueado')
    expect(v.motivo.clave).toBe('dependabot')
  })

  it('acepta ES_FORK booleano además de la cadena "true"', () => {
    expect(decidir({ ES_FORK: true }).decision).toBe('bloqueado')
  })

  it('«bloqueado» NO es «run»: los pasos del harness siguen sin ejecutarse', () => {
    for (const ctx of [FORK, DEPENDABOT_PR]) {
      expect(decidir(ctx).decision).not.toBe('run')
    }
  })

  it('el resumen dice que el harness NO se ejecutó y que el PR está bloqueado', () => {
    for (const ctx of [FORK, DEPENDABOT_PR]) {
      const md = resumenMarkdown(decidir(ctx))
      expect(md).toContain('NO ejecutado')
      expect(md).toContain('bloqueado')
      expect(md).toContain('rama INTERNA')
    }
  })

  it('el resumen NO ofrece "se valida al mergear" como consuelo', () => {
    const md = resumenMarkdown(decidir(FORK))
    expect(md).toContain('detección, no prevención')
  })

  it('el motivo de Dependabot nombra la salida real: los *Dependabot secrets*', () => {
    expect(decidir(DEPENDABOT_PR).motivo.detalle).toContain('Dependabot secrets')
  })

  it('PR de Dependabot CON los Dependabot secrets declarados: se EJECUTA', () => {
    const v = decidir({ ...CON_SECRETOS, ...DEPENDABOT_PR })
    expect(v.decision).toBe('run')
    expect(v.motivo).toBeNull()
  })

  it('una omisión PARCIAL (faltan sólo algunas) también bloquea', () => {
    const v = decidir({ ...CON_SECRETOS, ...FORK, RLS_USER_B_PASSWORD: '' })
    expect(v.decision).toBe('bloqueado')
    expect(v.faltan).toEqual(['RLS_USER_B_PASSWORD'])
  })
})

describe('decidirPreflight — fail-closed', () => {
  it('PR interno sin ninguna variable: FALLA', () => {
    const v = decidir({ ES_FORK: 'false', GITHUB_ACTOR: 'ventas-png', GITHUB_EVENT_NAME: 'pull_request' })
    expect(v.decision).toBe('fail')
    expect(v.faltan).toEqual(VARIABLES_RLS)
  })

  it('push a main (sin ES_FORK) sin variables: FALLA', () => {
    const v = decidir({ ES_FORK: '', GITHUB_ACTOR: 'ventas-png', GITHUB_EVENT_NAME: 'push' })
    expect(v.decision).toBe('fail')
  })

  it('el agujero histórico: URL puesta pero UNA credencial vacía → FALLA', () => {
    const v = decidir({ ...CON_SECRETOS, RLS_USER_B_PASSWORD: '' })
    expect(v.decision).toBe('fail')
    expect(v.faltan).toEqual(['RLS_USER_B_PASSWORD'])
  })

  it('cada una de las siete variables, por separado, basta para fallar', () => {
    for (const variable of VARIABLES_RLS) {
      const v = decidir({ ...CON_SECRETOS, [variable]: '' })
      expect(v.decision, `${variable} vacía debe hacer fallar el preflight`).toBe('fail')
      expect(v.faltan).toEqual([variable])
    }
  })

  it('el mensaje nombra las variables que faltan y nunca un valor', () => {
    const v = decidir({ ...CON_SECRETOS, RLS_SUPABASE_ANON_KEY: '' })
    expect(v.mensaje).toContain('RLS_SUPABASE_ANON_KEY')
    expect(v.mensaje).not.toContain('anon-de-juguete')
  })
})

describe('motivoSinSecretos', () => {
  it('no inventa motivos para un actor humano', () => {
    expect(motivoSinSecretos({ esFork: 'false', actor: 'ventas-png' })).toBeNull()
  })

  it('no confunde otros bots con Dependabot', () => {
    expect(motivoSinSecretos({ actor: 'github-actions[bot]' })).toBeNull()
    expect(motivoSinSecretos({ actor: 'vercel[bot]' })).toBeNull()
  })
})

describe('Dependabot — el push a main NO admite excusas', () => {
  const PUSH_DEPENDABOT = { GITHUB_ACTOR: 'dependabot[bot]', GITHUB_EVENT_NAME: 'push' }

  it('push a main iniciado por Dependabot (auto-merge) sin secretos: FALLA', () => {
    const v = decidir(PUSH_DEPENDABOT)
    expect(v.decision).toBe('fail')
    expect(v.motivo).toBeNull()
  })

  it('el mensaje explica que aquí no hay omisión posible', () => {
    expect(decidir(PUSH_DEPENDABOT).mensaje).toContain('no hay omisión posible')
  })

  it('ES_FORK residual en un push de Dependabot tampoco abre una vía de escape', () => {
    expect(decidir({ ...PUSH_DEPENDABOT, ES_FORK: 'true' }).decision).toBe('fail')
  })

  it('ningún evento que no sea pull_request admite bloqueo-por-contexto', () => {
    for (const evento of ['push', 'workflow_dispatch', 'schedule', 'merge_group']) {
      for (const actor of ['dependabot[bot]', 'ventas-png']) {
        const v = decidir({ GITHUB_EVENT_NAME: evento, GITHUB_ACTOR: actor, ES_FORK: 'true' })
        expect(v.decision, `${evento} por ${actor}`).toBe('fail')
      }
    }
  })

  it('motivoSinSecretos: mismo actor, distinto evento, distinto desenlace', () => {
    expect(motivoSinSecretos({ actor: 'dependabot[bot]', evento: 'pull_request' })).not.toBeNull()
    expect(motivoSinSecretos({ actor: 'dependabot[bot]', evento: 'push' })).toBeNull()
  })
})

describe('resumenMarkdown', () => {
  it('el resumen de fallo lista las variables y apunta a la documentación', () => {
    const md = resumenMarkdown(decidir({}))
    expect(md).toContain('fail-closed')
    expect(md).toContain('`RLS_SUPABASE_URL`')
    expect(md).toContain('`RLS_EXPECTED_PROJECT_REF`')
    expect(md).toContain('docs/ACTIVAR_HARNESS_RLS.md')
  })

  it('el resumen de bloqueo distingue fork de Dependabot', () => {
    expect(resumenMarkdown(decidir({ ES_FORK: 'true' }))).toContain('fork')
    expect(resumenMarkdown(decidir({ GITHUB_ACTOR: 'dependabot[bot]' }))).toContain('Dependabot')
  })

  it('el resumen de ejecución confirma el ref validado', () => {
    expect(resumenMarkdown(decidir(CON_SECRETOS))).toContain(REF_SANDBOX)
  })
})

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const yaml = readFileSync(join(raiz, '.github', 'workflows', 'coverage.yml'), 'utf8')
const lineas = yaml.split('\n')

describe('el workflow real usa este gate', () => {
  it('el job rls-harness invoca scripts/rls-preflight.mjs', () => {
    expect(yaml).toContain('node scripts/rls-preflight.mjs')
  })

  it('pasa el actor y el evento para poder detectar Dependabot', () => {
    expect(yaml).toContain('GITHUB_ACTOR: ${{ github.actor }}')
    expect(yaml).toContain('GITHUB_EVENT_NAME: ${{ github.event_name }}')
  })

  it('pasa el indicador de fork', () => {
    expect(yaml).toContain('ES_FORK: ${{ github.event.pull_request.head.repo.fork }}')
  })

  it('expone las SIETE variables al job, incluida la declaración del proyecto', () => {
    for (const v of VARIABLES_RLS) {
      expect(yaml, `${v} no se pasa al job`).toContain(`${v}: \${{ secrets.${v} }}`)
    }
  })

  it('NO usa pull_request_target como DISPARADOR (expondría secretos al código del PR)', () => {
    // Se busca la clave YAML, no la subcadena: el workflow menciona
    // `pull_request_target` en un comentario justamente para explicar por qué
    // NO se usa, y una comprobación por subcadena confundiría las dos cosas.
    const esClave = lineas.some((l) => /^\s*pull_request_target\s*:/.test(l))
    expect(esClave, 'pull_request_target no debe aparecer como clave/disparador').toBe(false)
  })

  it('los pasos que ejecutan el harness están condicionados al preflight', () => {
    expect(yaml).toContain("if: steps.preflight.outputs.run == 'true'")
  })

  it('el preflight corre ANTES de instalar dependencias', () => {
    // Es lo que hace cierta la frase "aborta antes de instalar nada": si npm ci
    // fuera primero, un destino rechazado ya habría ejecutado los postinstall.
    const iPreflight = lineas.findIndex((l) => l.includes('node scripts/rls-preflight.mjs'))
    const iNpmCi = lineas.findIndex((l, i) => i > iPreflight && /run:\s*npm ci/.test(l))
    expect(iPreflight).toBeGreaterThanOrEqual(0)
    expect(iNpmCi).toBeGreaterThan(iPreflight)
  })

  it('el verificador de salida también está gateado por el preflight', () => {
    const iVerif = lineas.findIndex((l) => l.includes('node scripts/assert-rls-ejecutado.mjs'))
    expect(iVerif).toBeGreaterThanOrEqual(0)
    const contexto = lineas.slice(Math.max(0, iVerif - 4), iVerif).join('\n')
    expect(contexto).toContain("if: steps.preflight.outputs.run == 'true'")
  })

  it('el workflow se dispara en push a main', () => {
    const iOn = lineas.findIndex((l) => /^on:\s*$/.test(l))
    expect(iOn).toBeGreaterThanOrEqual(0)
    const seccionOn = []
    for (const l of lineas.slice(iOn + 1)) {
      if (/^\S/.test(l)) break
      seccionOn.push(l)
    }
    const texto = seccionOn.join('\n')
    expect(texto).toMatch(/^ {2}push:/m)
    expect(texto).toMatch(/branches:\s*\[\s*main\s*\]/)
  })
})
