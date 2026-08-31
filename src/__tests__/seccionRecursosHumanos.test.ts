import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SECTIONS, sectionForTab } from '../components/condominios/sections'
import { SECTION_ICONS } from '../components/condominios/sectionIcons'
import {
  CONDOMINIOS_SECTION_GROUPS,
  CONDOMINIOS_TAB_ACCESS,
  getEffectiveTabAccess,
} from '../lib/condominiosRoles'

// ════════════════════════════════════════════════════════════════════════════
// Sección "Recursos Humanos": los cinco tabs del personal salen de
// Administración (expediente, formación, actividad) y de Operaciones (tareas,
// limpieza) para vivir en su propia sección, con su propio bloque en el editor
// de roles (`permissions.category = 'recursos_humanos'`).
//
// Lo que se vigila aquí es lo que una reorganización de nav rompe callando:
//
//   1. Que la mudanza sea MUDANZA y no COPIA: un tab en dos secciones hace que
//      `sectionForTab` (mapa por tab, última gana) mande al usuario a una
//      sección distinta de la que muestra la pestaña activa.
//   2. Que el ACCESO EFECTIVO por rol no se mueva con la sección. Agrupar es
//      presentación; `CONDOMINIOS_TAB_ACCESS` es autorización. El rol
//      operaciones tenía tareas y limpieza antes de la mudanza y las conserva.
//   3. Que la migración reclasifique CATEGORÍA sin renombrar CLAVES: media
//      docena de policies gatean sobre `condominios.tab.prog_limpieza` y
//      `condominios.tab.tareas_cond`, y un rename las dejaría apuntando al
//      vacío sin que ninguna prueba de UI se entere.
// ════════════════════════════════════════════════════════════════════════════

const TABS_RRHH = [
  'personal', 'capacitacion_personal', 'tareas_cond', 'prog_limpieza', 'actividad_equipo',
] as const

const MIGRACION = resolve('supabase/migrations/20260907001200_rbac_seccion_recursos_humanos.sql')
const sqlRRHH = readFileSync(MIGRACION, 'utf8').replace(/--[^\n]*/g, '')

describe('sección Recursos Humanos (nav)', () => {
  it('existe, va después de Administración y antes de Especiales', () => {
    const ids = SECTIONS.map(s => s.id)
    expect(ids).toContain('recursos_humanos')
    expect(ids.indexOf('recursos_humanos')).toBe(ids.indexOf('administracion') + 1)
    expect(ids.indexOf('recursos_humanos')).toBeLessThan(ids.indexOf('especiales'))
  })

  it('agrupa los cinco tabs del personal', () => {
    const sec = SECTIONS.find(s => s.id === 'recursos_humanos')!
    expect([...sec.tabs].sort()).toEqual([...TABS_RRHH].sort())
  })

  it('cada tab quedó en UNA sola sección (mudanza, no copia)', () => {
    for (const tab of TABS_RRHH) {
      const secciones = SECTIONS.filter(s => s.tabs.includes(tab)).map(s => s.id)
      expect(secciones, `${tab} aparece en ${secciones.join(', ')}`).toEqual(['recursos_humanos'])
      expect(sectionForTab(tab)).toBe('recursos_humanos')
    }
  })

  it('ninguna sección repite un tab de otra (guardia global del mapa por tab)', () => {
    const vistos = new Map<string, string>()
    for (const sec of SECTIONS) {
      for (const tab of sec.tabs) {
        expect(vistos.has(tab), `${tab} duplicado en ${vistos.get(tab)} y ${sec.id}`).toBe(false)
        vistos.set(tab, sec.id)
      }
    }
  })

  it('la sección nueva tiene ícono (el sidebar renderiza SECTION_ICONS[sec.id])', () => {
    for (const sec of SECTIONS) expect(SECTION_ICONS[sec.id], sec.id).toBeTruthy()
  })
})

describe('editor de roles: bloque Recursos Humanos', () => {
  it('el grupo existe con los cinco tabs', () => {
    const grupo = CONDOMINIOS_SECTION_GROUPS.find(g => g.key === 'recursos_humanos')
    expect(grupo).toBeDefined()
    expect([...grupo!.tabs].sort()).toEqual([...TABS_RRHH].sort())
  })

  it('Operaciones ya no ofrece tareas ni limpieza en su bloque', () => {
    const ops = CONDOMINIOS_SECTION_GROUPS.find(g => g.key === 'operaciones')!
    expect(ops.tabs).not.toContain('tareas_cond')
    expect(ops.tabs).not.toContain('prog_limpieza')
  })

  it('ningún tab aparece en dos bloques del editor', () => {
    const vistos = new Map<string, string>()
    for (const g of CONDOMINIOS_SECTION_GROUPS) {
      for (const tab of g.tabs) {
        expect(vistos.has(tab), `${tab} duplicado en ${vistos.get(tab)} y ${g.key}`).toBe(false)
        vistos.set(tab, g.key)
      }
    }
  })
})

describe('el acceso efectivo NO se movió con la sección', () => {
  it('el rol operaciones conserva tareas y limpieza', () => {
    const acceso = CONDOMINIOS_TAB_ACCESS.operaciones!
    expect(acceso.has('tareas_cond')).toBe(true)
    expect(acceso.has('prog_limpieza')).toBe(true)
    expect(acceso.has('personal')).toBe(true)
    expect(acceso.has('capacitacion_personal')).toBe(true)
  })

  it('multi-rol: operaciones sigue viendo los tabs que se mudaron', () => {
    const acceso = getEffectiveTabAccess(['operaciones'])!
    expect(acceso.has('tareas_cond')).toBe(true)
    expect(acceso.has('prog_limpieza')).toBe(true)
  })
})

describe('migración 20260907001200 (catálogo RBAC)', () => {
  it('siembra la clave que faltaba de actividad_equipo', () => {
    expect(sqlRRHH).toMatch(/INSERT INTO public\.permissions[\s\S]*'condominios\.tab\.actividad_equipo'/)
  })

  it('reclasifica categoría sin renombrar claves', () => {
    expect(sqlRRHH).toMatch(/UPDATE public\.permissions\s+SET category = 'recursos_humanos'/)
    // Un rename de clave rompería las policies que gatean sobre ellas.
    for (const clave of ['condominios.tab.tareas_cond', 'condominios.tab.prog_limpieza']) {
      expect(sqlRRHH).toContain(`'${clave}'`)
    }
    expect(sqlRRHH).not.toMatch(/UPDATE public\.permissions[\s\S]{0,400}SET key/)
  })

  it('los cuatro tabs que se mudan quedan en la reclasificación', () => {
    for (const tab of ['personal', 'capacitacion_personal', 'tareas_cond', 'prog_limpieza']) {
      expect(sqlRRHH, tab).toContain(`'condominios.tab.${tab}'`)
    }
  })

  it('es idempotente (ON CONFLICT en los INSERT, filtro de categoría en el UPDATE)', () => {
    const inserts = sqlRRHH.match(/INSERT INTO/g) ?? []
    const conflicts = sqlRRHH.match(/ON CONFLICT/g) ?? []
    expect(conflicts.length).toBe(inserts.length)
    expect(sqlRRHH).toMatch(/category IS DISTINCT FROM 'recursos_humanos'/)
  })
})
