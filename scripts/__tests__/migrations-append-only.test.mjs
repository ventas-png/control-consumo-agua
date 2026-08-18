// ════════════════════════════════════════════════════════════════════════════
// Pruebas de migrations-append-only: las migraciones ya mergeadas son
// inmutables — solo se permite AÑADIR archivos a supabase/migrations/.
// Se prueban los helpers puros exportados con salidas sintéticas de
// `git diff --name-status -M` (campos separados por TAB), sin tocar git ni las
// migraciones reales. vitest recoge este archivo por su patrón por defecto.
// ════════════════════════════════════════════════════════════════════════════
import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  evaluateAppendOnly,
  parseNameStatus,
  resolveRange,
} from '../migrations-append-only.mjs'

const MIG = 'supabase/migrations'

function violaciones(nameStatusText) {
  return evaluateAppendOnly(parseNameStatus(nameStatusText))
}

describe('parseNameStatus', () => {
  it('parsea A/M/D/T con un path y R/C con score y dos paths', () => {
    const entries = parseNameStatus(
      [
        `A\t${MIG}/20990101000000_nueva.sql`,
        `M\tsrc/App.tsx`,
        `D\t${MIG}/20260318000000_enable_rls.sql`,
        `T\t${MIG}/20260420000001_condominios_mvp.sql`,
        `R100\t${MIG}/20260713100000_viejo.sql\t${MIG}/20260713100001_viejo.sql`,
        `C75\tsrc/a.ts\tsrc/b.ts`,
        '',
      ].join('\n'),
    )
    expect(entries).toEqual([
      { status: 'A', path: `${MIG}/20990101000000_nueva.sql` },
      { status: 'M', path: 'src/App.tsx' },
      { status: 'D', path: `${MIG}/20260318000000_enable_rls.sql` },
      { status: 'T', path: `${MIG}/20260420000001_condominios_mvp.sql` },
      {
        status: 'R',
        oldPath: `${MIG}/20260713100000_viejo.sql`,
        path: `${MIG}/20260713100001_viejo.sql`,
      },
      { status: 'C', oldPath: 'src/a.ts', path: 'src/b.ts' },
    ])
  })

  it('tolera salida vacía', () => {
    expect(parseNameStatus('')).toEqual([])
    expect(parseNameStatus('\n\n')).toEqual([])
  })
})

describe('evaluateAppendOnly — lo permitido', () => {
  it('migración NUEVA (A): permitida', () => {
    expect(violaciones(`A\t${MIG}/20990101000000_nueva.sql`)).toEqual([])
  })

  it('copia (C) hacia migrations: permitida (es un alta)', () => {
    expect(violaciones(`C90\t${MIG}/20260318000000_a.sql\t${MIG}/20990101000000_b.sql`)).toEqual([])
  })

  it('cambios FUERA de migrations: permitidos aunque sean M/D/R', () => {
    const out = violaciones(
      [
        'M\tsrc/App.tsx',
        'D\tscripts/viejo.mjs',
        'R100\tsrc/a.ts\tsrc/b.ts',
        'M\tsupabase/functions/f/index.ts',
      ].join('\n'),
    )
    expect(out).toEqual([])
  })

  it('archivos no-.sql dentro de migrations (README.md): fuera de la regla', () => {
    expect(violaciones(`M\t${MIG}/README.md`)).toEqual([])
    expect(violaciones(`D\t${MIG}/README.md`)).toEqual([])
  })

  it('rename que ENTRA a migrations desde fuera: equivale a añadir', () => {
    expect(violaciones(`R95\tdocs/borrador.sql\t${MIG}/20990101000000_nueva.sql`)).toEqual([])
  })
})

describe('evaluateAppendOnly — lo prohibido', () => {
  it('migración histórica MODIFICADA: rechazada', () => {
    expect(violaciones(`M\t${MIG}/20260318000000_enable_rls.sql`)).toEqual([
      { kind: 'modificada', path: `${MIG}/20260318000000_enable_rls.sql` },
    ])
  })

  it('migración histórica ELIMINADA: rechazada', () => {
    expect(violaciones(`D\t${MIG}/20260318000000_enable_rls.sql`)).toEqual([
      { kind: 'eliminada', path: `${MIG}/20260318000000_enable_rls.sql` },
    ])
  })

  it('migración histórica RENOMBRADA dentro de migrations: rechazada', () => {
    expect(
      violaciones(`R100\t${MIG}/20260713100000_viejo.sql\t${MIG}/20260713100001_viejo.sql`),
    ).toEqual([
      {
        kind: 'renombrada',
        path: `${MIG}/20260713100000_viejo.sql`,
        detail: `renombrada a ${MIG}/20260713100001_viejo.sql`,
      },
    ])
  })

  it('migración histórica movida FUERA de migrations: rechazada (desaparece del historial)', () => {
    expect(violaciones(`R100\t${MIG}/20260318000000_enable_rls.sql\tdocs/archivo.sql`)).toEqual([
      {
        kind: 'renombrada',
        path: `${MIG}/20260318000000_enable_rls.sql`,
        detail: 'renombrada a docs/archivo.sql',
      },
    ])
  })

  it('typechange (T) cuenta como modificación', () => {
    expect(violaciones(`T\t${MIG}/20260318000000_enable_rls.sql`)).toEqual([
      { kind: 'modificada', path: `${MIG}/20260318000000_enable_rls.sql` },
    ])
  })

  it('mezcla realista: reporta SOLO las violaciones, con las altas intactas', () => {
    const out = violaciones(
      [
        `A\t${MIG}/20990101000000_nueva.sql`,
        `M\t${MIG}/20260318000000_enable_rls.sql`,
        'M\tsrc/App.tsx',
        `D\t${MIG}/20260420000001_condominios_mvp.sql`,
      ].join('\n'),
    )
    expect(out.map((v) => `${v.kind}:${v.path}`)).toEqual([
      `modificada:${MIG}/20260318000000_enable_rls.sql`,
      `eliminada:${MIG}/20260420000001_condominios_mvp.sql`,
    ])
  })
})

describe('resolveRange — selección de rango por contexto', () => {
  it('--base/--head explícitos tienen prioridad', () => {
    expect(resolveRange({ argv: ['--base', 'abc123', '--head', 'def456'], env: {} })).toMatchObject(
      { base: 'abc123', head: 'def456' },
    )
  })

  it('pull_request usa origin/<base_ref> (merge-base)', () => {
    expect(
      resolveRange({ argv: [], env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' } }),
    ).toMatchObject({ base: 'origin/main', head: 'HEAD' })
  })

  it('push usa before..HEAD lineal', () => {
    expect(
      resolveRange({
        argv: [],
        env: { GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_BEFORE: 'abc123' },
      }),
    ).toMatchObject({ base: 'abc123', head: 'HEAD', linear: true })
  })

  it('push con before 0000… (force-push/rama nueva) degrada a base nula', () => {
    expect(
      resolveRange({
        argv: [],
        env: {
          GITHUB_EVENT_NAME: 'push',
          GITHUB_EVENT_BEFORE: '0000000000000000000000000000000000000000',
        },
      }),
    ).toMatchObject({ base: null })
  })

  it('sin contexto de CI cae a origin/main (uso local)', () => {
    expect(resolveRange({ argv: [], env: {} })).toMatchObject({ base: 'origin/main' })
  })
})

// ─── CLI end-to-end contra repos git TEMPORALES ──────────────────────────────
// Aquí se prueba la política FAIL-CLOSED del binario real: sin rango
// verificable el guard termina con exit 1 sin validar nada. Degradar a mirar
// solo HEAD sería fail-open — un force-push puede reescribir históricas en
// commits ANTERIORES al último y ese diff no las ve (caso de regresión abajo).
// Cada escenario corre el script con execFileSync sobre un repo git creado en
// un directorio temporal; no se toca ni el repo real ni sus migraciones.
describe('CLI — fail-closed sobre repos git temporales', () => {
  const SCRIPT = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'migrations-append-only.mjs',
  )
  const SHA_BOGUS = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
  const dirs = []
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
  })

  function gitc(cwd, ...args) {
    return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd,
      encoding: 'utf8',
    }).trim()
  }

  // Repo con: A (migración histórica) → B (la MODIFICA) → C (añade una nueva).
  // La reescritura queda en un commit ANTERIOR al HEAD a propósito.
  function repoConHistoriaReescrita() {
    const dir = mkdtempSync(join(tmpdir(), 'append-only-'))
    dirs.push(dir)
    gitc(dir, 'init', '-q')
    mkdirSync(join(dir, 'supabase/migrations'), { recursive: true })
    const historica = join(dir, 'supabase/migrations/20260101000000_base.sql')
    writeFileSync(historica, '-- base\n')
    gitc(dir, 'add', '-A')
    gitc(dir, 'commit', '-qm', 'A: histórica')
    const shaA = gitc(dir, 'rev-parse', 'HEAD')
    appendFileSync(historica, '-- REESCRITA\n')
    gitc(dir, 'add', '-A')
    gitc(dir, 'commit', '-qm', 'B: modifica la histórica')
    writeFileSync(join(dir, 'supabase/migrations/20260102000000_nueva.sql'), '-- nueva\n')
    gitc(dir, 'add', '-A')
    gitc(dir, 'commit', '-qm', 'C: añade nueva')
    return { dir, shaA }
  }

  function correr(dir, { args = [], env = {} } = {}) {
    const limpio = {
      ...process.env,
      GITHUB_EVENT_NAME: undefined,
      GITHUB_BASE_REF: undefined,
      GITHUB_EVENT_BEFORE: undefined,
      ...env,
    }
    try {
      const out = execFileSync(process.execPath, [SCRIPT, ...args], {
        cwd: dir,
        encoding: 'utf8',
        env: limpio,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return { code: 0, out }
    } catch (e) {
      return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
    }
  }

  const esperaFailClosed = (res) => {
    expect(res.code).toBe(1)
    expect(res.out).toContain('rango Git VERIFICABLE')
    expect(res.out).toContain('ningún SQL')
  }

  it('push con before 0000… (force-push/rama nueva): exit 1, sin validar', () => {
    const { dir } = repoConHistoriaReescrita()
    esperaFailClosed(
      correr(dir, {
        env: {
          GITHUB_EVENT_NAME: 'push',
          GITHUB_EVENT_BEFORE: '0000000000000000000000000000000000000000',
        },
      }),
    )
  })

  it('push con before INEXISTENTE: exit 1, sin validar', () => {
    const { dir } = repoConHistoriaReescrita()
    esperaFailClosed(
      correr(dir, { env: { GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_BEFORE: SHA_BOGUS } }),
    )
  })

  it('--base explícita inexistente: exit 1, sin validar', () => {
    const { dir } = repoConHistoriaReescrita()
    esperaFailClosed(correr(dir, { args: ['--base', SHA_BOGUS] }))
  })

  it('base de PR (origin/<base_ref>) inaccesible: exit 1, sin validar', () => {
    const { dir } = repoConHistoriaReescrita() // sin remoto: origin/main no existe
    esperaFailClosed(
      correr(dir, { env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' } }),
    )
  })

  it('REGRESIÓN fail-open: histórica reescrita en un commit ANTERIOR al HEAD con before inalcanzable → rechazado (la degradación a `git show HEAD` habría dado verde)', () => {
    const { dir } = repoConHistoriaReescrita()
    // HEAD (C) solo añade una migración nueva; la modificación vive en B.
    // Un diff de "solo HEAD" no la vería — por eso sin rango se falla cerrado.
    const res = correr(dir, {
      env: { GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_BEFORE: SHA_BOGUS },
    })
    esperaFailClosed(res)
  })

  it('camino feliz: rango válido con solo altas → exit 0; con la modificación en rango → exit 1 nombrándola', () => {
    const { dir, shaA } = repoConHistoriaReescrita()
    // Rango C..HEAD no existe; usamos HEAD~1..HEAD (solo el alta de C): pasa.
    const soloAltas = correr(dir, { args: ['--base', 'HEAD~1'] })
    expect(soloAltas.code).toBe(0)
    expect(soloAltas.out).toContain('migraciones nuevas: 1')
    // Rango A..HEAD incluye la modificación de B: falla nombrando el archivo.
    const conReescritura = correr(dir, {
      env: { GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_BEFORE: shaA },
    })
    expect(conReescritura.code).toBe(1)
    expect(conReescritura.out).toContain('20260101000000_base.sql — MODIFICADA')
  })
})
