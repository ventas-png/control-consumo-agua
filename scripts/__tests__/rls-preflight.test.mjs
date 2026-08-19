// ════════════════════════════════════════════════════════════════════════════
// Prueba CONTRACTUAL del gate del job "RLS harness (server-side)".
//
// El preflight decide si el aislamiento multi-tenant se verifica o no, así que
// su tabla de verdad es parte del contrato de seguridad del repo y no puede
// vivir sólo en un bloque de bash dentro del YAML. Se cubren los cuatro
// contextos reales:
//
//   fork          → GitHub no expone secretos por diseño   → omisión explícita
//   dependabot    → los Actions secrets NO llegan al bot    → omisión explícita
//   PR interno    → los secretos DEBERÍAN estar            → fail-closed
//   push a main   → los secretos DEBERÍAN estar            → fail-closed
//
// Y además se comprueba que el workflow REAL invoca este script y que no usa
// `pull_request_target`, que expondría los secretos al código del PR.
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { VARIABLES_RLS, decidirPreflight, motivoSinSecretos, resumenMarkdown } from '../rls-preflight.mjs'

/** Entorno con las seis variables presentes. */
const CON_SECRETOS = Object.fromEntries(VARIABLES_RLS.map((v) => [v, `valor-${v}`]))

describe('decidirPreflight — con las seis variables', () => {
  it('ejecuta el harness en un PR interno', () => {
    const v = decidirPreflight({ ...CON_SECRETOS, ES_FORK: 'false', GITHUB_ACTOR: 'ventas-png' })
    expect(v.decision).toBe('run')
    expect(v.faltan).toEqual([])
  })

  it('ejecuta el harness incluso si el actor es Dependabot (si hay secretos, se usan)', () => {
    const v = decidirPreflight({ ...CON_SECRETOS, GITHUB_ACTOR: 'dependabot[bot]' })
    expect(v.decision).toBe('run')
  })
})

describe('decidirPreflight — contextos SIN secretos por diseño', () => {
  it('PR de fork: omisión explícita, no fallo', () => {
    const v = decidirPreflight({ ES_FORK: 'true', GITHUB_ACTOR: 'alguien-de-fuera' })
    expect(v.decision).toBe('skip')
    expect(v.motivo.clave).toBe('fork')
    expect(v.faltan).toEqual(VARIABLES_RLS)
  })

  it('acepta ES_FORK booleano además de la cadena "true"', () => {
    expect(decidirPreflight({ ES_FORK: true }).decision).toBe('skip')
  })

  it('Dependabot: omisión explícita, no fallo', () => {
    const v = decidirPreflight({ GITHUB_ACTOR: 'dependabot[bot]' })
    expect(v.decision).toBe('skip')
    expect(v.motivo.clave).toBe('dependabot')
  })

  it('el motivo de Dependabot explica que se valida en el push a main', () => {
    const v = decidirPreflight({ GITHUB_ACTOR: 'dependabot[bot]' })
    expect(v.motivo.detalle).toContain('push a `main`')
  })

  it('una omisión parcial (faltan sólo algunas) también se omite en fork', () => {
    const v = decidirPreflight({ ...CON_SECRETOS, RLS_USER_B_PASSWORD: '', ES_FORK: 'true' })
    expect(v.decision).toBe('skip')
    expect(v.faltan).toEqual(['RLS_USER_B_PASSWORD'])
  })
})

describe('decidirPreflight — fail-closed', () => {
  it('PR interno sin ninguna variable: FALLA', () => {
    const v = decidirPreflight({ ES_FORK: 'false', GITHUB_ACTOR: 'ventas-png', GITHUB_EVENT_NAME: 'pull_request' })
    expect(v.decision).toBe('fail')
    expect(v.faltan).toEqual(VARIABLES_RLS)
  })

  it('push a main (sin ES_FORK) sin variables: FALLA', () => {
    // En push, `head.repo.fork` no existe y llega vacío: debe tratarse como
    // interno, nunca como omisión legítima.
    const v = decidirPreflight({ ES_FORK: '', GITHUB_ACTOR: 'ventas-png', GITHUB_EVENT_NAME: 'push' })
    expect(v.decision).toBe('fail')
  })

  it('el agujero histórico: URL puesta pero UNA credencial vacía → FALLA', () => {
    // Antes esto entraba a correr, el harness se auto-saltaba por su propio
    // ENABLED y el job terminaba verde con CERO pruebas.
    const v = decidirPreflight({ ...CON_SECRETOS, RLS_USER_B_PASSWORD: '' })
    expect(v.decision).toBe('fail')
    expect(v.faltan).toEqual(['RLS_USER_B_PASSWORD'])
  })

  it('cada una de las seis variables, por separado, basta para fallar', () => {
    for (const variable of VARIABLES_RLS) {
      const v = decidirPreflight({ ...CON_SECRETOS, [variable]: '' })
      expect(v.decision, `${variable} vacía debe hacer fallar el preflight`).toBe('fail')
      expect(v.faltan).toEqual([variable])
    }
  })

  it('el mensaje nombra las variables que faltan y nunca un valor', () => {
    const v = decidirPreflight({ ...CON_SECRETOS, RLS_SUPABASE_ANON_KEY: '' })
    expect(v.mensaje).toContain('RLS_SUPABASE_ANON_KEY')
    expect(v.mensaje).not.toContain('valor-RLS_SUPABASE_URL')
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

describe('resumenMarkdown', () => {
  it('el resumen de fallo lista las variables y apunta a la documentación', () => {
    const md = resumenMarkdown(decidirPreflight({}))
    expect(md).toContain('fail-closed')
    expect(md).toContain('`RLS_SUPABASE_URL`')
    expect(md).toContain('docs/ACTIVAR_HARNESS_RLS.md')
  })

  it('el resumen de omisión distingue fork de Dependabot', () => {
    expect(resumenMarkdown(decidirPreflight({ ES_FORK: 'true' }))).toContain('fork')
    expect(resumenMarkdown(decidirPreflight({ GITHUB_ACTOR: 'dependabot[bot]' }))).toContain('Dependabot')
  })
})

describe('el workflow real usa este gate', () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const yaml = readFileSync(join(raiz, '.github', 'workflows', 'coverage.yml'), 'utf8')

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

  it('NO usa pull_request_target como DISPARADOR (expondría secretos al código del PR)', () => {
    // Se busca la clave YAML, no la subcadena: el workflow menciona
    // `pull_request_target` en un comentario justamente para explicar por qué
    // NO se usa, y una comprobación por subcadena confundiría las dos cosas.
    const esClave = yaml.split('\n').some((l) => /^\s*pull_request_target\s*:/.test(l))
    expect(esClave, 'pull_request_target no debe aparecer como clave/disparador').toBe(false)
  })

  it('los disparadores son los esperados: pull_request, push y dispatch', () => {
    const claves = yaml
      .split('\n')
      .slice(yaml.split('\n').findIndex((l) => /^on:/.test(l)) + 1)
      .filter((l) => /^ {2}\S/.test(l))
      .map((l) => l.trim().replace(/:.*$/, ''))
    // La sección `on:` termina en la primera clave de nivel 0 posterior.
    const disparadores = []
    for (const l of yaml.split('\n')) {
      if (/^concurrency:|^permissions:|^jobs:/.test(l)) break
      if (/^ {2}\S/.test(l)) disparadores.push(l.trim().replace(/:.*$/, ''))
    }
    expect(disparadores).toContain('pull_request')
    expect(disparadores).toContain('workflow_dispatch')
    expect(claves.length).toBeGreaterThan(0)
  })

  it('los pasos que ejecutan el harness están condicionados al preflight', () => {
    expect(yaml).toContain("if: steps.preflight.outputs.run == 'true'")
  })

  it('verifica el reporte con assert-rls-ejecutado.mjs', () => {
    expect(yaml).toContain('node scripts/assert-rls-ejecutado.mjs')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Dependabot: la garantía tiene que ser COMPROBABLE, no una promesa.
// ════════════════════════════════════════════════════════════════════════════
// La versión anterior decía «se valida igualmente en el push a main posterior».
// Con auto-merge, ese push también corre como `dependabot[bot]`: con la regla
// vieja se habría omitido OTRA VEZ y el bump nunca se habría verificado. Estas
// pruebas fijan las dos mitades de la garantía:
//   · en `pull_request` de Dependabot se omite (los Actions secrets no llegan);
//   · en `push` NO se omite jamás, sea quien sea el actor.
// Y la salida disponible para verificar ya en el PR: declarar las seis
// variables también como *Dependabot secrets*, con los mismos nombres.
describe('Dependabot — omisión acotada al PR', () => {
  const DEPENDABOT_PR = {
    ES_FORK: 'false',
    GITHUB_ACTOR: 'dependabot[bot]',
    GITHUB_EVENT_NAME: 'pull_request',
  }

  it('PR de Dependabot sin secretos: se OMITE explícitamente', () => {
    const v = decidirPreflight(DEPENDABOT_PR)
    expect(v.decision).toBe('skip')
    expect(v.motivo.clave).toBe('dependabot')
    expect(v.faltan).toEqual(VARIABLES_RLS)
  })

  it('el motivo nombra la salida real: declarar los *Dependabot secrets*', () => {
    expect(decidirPreflight(DEPENDABOT_PR).motivo.detalle).toContain('Dependabot secrets')
  })

  it('PR de Dependabot CON los Dependabot secrets declarados: se EJECUTA', () => {
    // Si el repo declara las seis variables en Settings → Secrets → Dependabot,
    // llegan con los mismos nombres y el harness corre en el propio PR: la
    // verificación no se difiere a nada.
    const v = decidirPreflight({ ...CON_SECRETOS, ...DEPENDABOT_PR })
    expect(v.decision).toBe('run')
    expect(v.motivo).toBeNull()
  })

  it('PR de Dependabot con los secretos A MEDIAS: se omite, no corre a medias', () => {
    const v = decidirPreflight({ ...CON_SECRETOS, ...DEPENDABOT_PR, RLS_USER_B_PASSWORD: '' })
    expect(v.decision).toBe('skip')
    expect(v.faltan).toEqual(['RLS_USER_B_PASSWORD'])
  })
})

describe('Dependabot — el push a main NO puede omitirse (donde vive la garantía)', () => {
  const PUSH_DEPENDABOT = { GITHUB_ACTOR: 'dependabot[bot]', GITHUB_EVENT_NAME: 'push' }

  it('push a main iniciado por Dependabot (auto-merge) sin secretos: FALLA', () => {
    // Ésta es la regresión que hacía falsa la garantía anterior.
    const v = decidirPreflight(PUSH_DEPENDABOT)
    expect(v.decision).toBe('fail')
    expect(v.motivo).toBeNull()
  })

  it('el mensaje explica por qué aquí no se omite pese al actor', () => {
    const v = decidirPreflight(PUSH_DEPENDABOT)
    expect(v.mensaje).toContain('Dependabot')
    expect(v.mensaje).toContain('NO se omite')
  })

  it('ES_FORK residual en un push de Dependabot tampoco lo convierte en omisión', () => {
    // `head.repo.fork` no aplica a `push`; si llegara un 'true' espurio no debe
    // abrir una vía de escape en el evento donde se difirió la verificación.
    const v = decidirPreflight({ ...PUSH_DEPENDABOT, ES_FORK: 'true' })
    expect(v.decision).toBe('fail')
  })

  it('push a main de un humano sin secretos: FALLA igual', () => {
    expect(decidirPreflight({ GITHUB_ACTOR: 'ventas-png', GITHUB_EVENT_NAME: 'push' }).decision).toBe('fail')
  })

  it('ningún evento que no sea pull_request admite omisión', () => {
    for (const evento of ['push', 'workflow_dispatch', 'schedule', 'merge_group']) {
      for (const actor of ['dependabot[bot]', 'ventas-png']) {
        const v = decidirPreflight({ GITHUB_EVENT_NAME: evento, GITHUB_ACTOR: actor, ES_FORK: 'true' })
        expect(v.decision, `${evento} por ${actor} no debe omitirse`).toBe('fail')
      }
    }
  })

  it('motivoSinSecretos: mismo actor, distinto evento, distinto desenlace', () => {
    expect(motivoSinSecretos({ actor: 'dependabot[bot]', evento: 'pull_request' })).not.toBeNull()
    expect(motivoSinSecretos({ actor: 'dependabot[bot]', evento: 'push' })).toBeNull()
  })
})

describe('el workflow sostiene la garantía diferida de Dependabot', () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const yaml = readFileSync(join(raiz, '.github', 'workflows', 'coverage.yml'), 'utf8')
  const lineas = yaml.split('\n')

  it('el workflow se dispara en push a main (sin eso, diferir a main no verifica nada)', () => {
    // La omisión en PR de Dependabot sólo es aceptable porque el push a `main`
    // vuelve a correr el job y ahí el preflight no puede omitirse. Si alguien
    // quita este disparador, la omisión pasa a ser una pérdida de cobertura.
    const iOn = lineas.findIndex((l) => /^on:\s*$/.test(l))
    expect(iOn, 'no se encontró la sección on:').toBeGreaterThanOrEqual(0)
    const seccionOn = []
    for (const l of lineas.slice(iOn + 1)) {
      if (/^\S/.test(l)) break
      seccionOn.push(l)
    }
    const texto = seccionOn.join('\n')
    expect(texto).toMatch(/^ {2}push:/m)
    expect(texto).toMatch(/branches:\s*\[\s*main\s*\]/)
  })

  it('el preflight corre ANTES de instalar dependencias (no se ejecuta nada sin secretos)', () => {
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
})
