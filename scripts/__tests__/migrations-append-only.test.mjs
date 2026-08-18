// ════════════════════════════════════════════════════════════════════════════
// Pruebas de migrations-append-only: las migraciones ya mergeadas son
// inmutables — solo se permite AÑADIR archivos a supabase/migrations/.
// Se prueban los helpers puros exportados con salidas sintéticas de
// `git diff --name-status -M` (campos separados por TAB), sin tocar git ni las
// migraciones reales. vitest recoge este archivo por su patrón por defecto.
// ════════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest'
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
