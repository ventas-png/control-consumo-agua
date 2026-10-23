import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { PORTAL_TABS_CONFIGURABLES } from '../lib/portalTabs'
import { SECTIONS, sectionForTab } from '../components/condominios/sections'
import { CONDOMINIOS_SECTION_GROUPS, CONDOMINIOS_TAB_ACCESS } from '../lib/condominiosRoles'

// ════════════════════════════════════════════════════════════════════════════
// Pestañas del portal por condominio (20261106000000).
//
// La conducta (quién escribe, quién lee, el CHECK) se prueba ejecutando la
// migración contra un Postgres desechable en supabase/tests/portal_pestanas/.
// Aquí quedan los contratos entre la migración y el código que esa suite no ve:
//
//   1. El CHECK de la base y PORTAL_TABS_CONFIGURABLES son la MISMA lista. Si se
//      agrega una pestaña al portal sin ampliar el CHECK, apagarla daría un
//      error de la base; si el CHECK admite 'mi_unidad', el portal se podría
//      quedar sin pestaña de aterrizaje.
//   2. La escritura NO tiene policy propia: es projects_update, que limita a
//      super_admin y company_owner/admin. Por eso la pestaña «Config. portal» no
//      lleva clave RBAC en el catálogo ni la da ningún rol de condominios: un
//      rol que la viera no podría guardar (UPDATE con cero filas).
// ════════════════════════════════════════════════════════════════════════════

const DIR = resolve('supabase/migrations')
const MIG = resolve(DIR, '20261106000000_portal_pestanas_por_condominio.sql')
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, '')
const sql = soloCodigo(readFileSync(MIG, 'utf8'))

describe('20261106000000 — la columna y su CHECK', () => {
  it('agrega projects.portal_tabs_ocultos NOT NULL con vacío por defecto (nada apagado)', () => {
    expect(sql).toMatch(/ALTER TABLE public\.projects\s+ADD COLUMN IF NOT EXISTS portal_tabs_ocultos text\[\] NOT NULL DEFAULT '\{\}'::text\[\];/)
  })

  it('el CHECK admite exactamente las pestañas configurables del portal', () => {
    const m = sql.match(/portal_tabs_ocultos <@ ARRAY\[([\s\S]*?)\]::text\[\]/)
    expect(m).not.toBeNull()
    const enCheck = [...m![1].matchAll(/'([a-z_]+)'/g)].map(x => x[1])
    expect([...enCheck].sort()).toEqual([...PORTAL_TABS_CONFIGURABLES].sort())
    expect(enCheck).not.toContain('mi_unidad')
  })

  it('el CHECK se recrea (idempotente) y no hay policies nuevas', () => {
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS projects_portal_tabs_ocultos_check')
    expect(sql).not.toMatch(/\b(CREATE|ALTER|DROP)\s+POLICY\b/i)
    expect(sql).not.toMatch(/\bGRANT\b/i)
  })
})

describe('quién escribe: projects_update (propietario/administrador de la empresa)', () => {
  it('la última definición de projects_update sigue limitada a company_owner/admin', () => {
    // La escritura de la config descansa entera en esta policy. Si alguien la
    // ensancha, este test obliga a revisar si el personal debe poder apagar
    // pestañas del portal.
    const defs: string[] = []
    for (const f of readdirSync(DIR).filter(n => n.endsWith('.sql')).sort()) {
      const s = soloCodigo(readFileSync(resolve(DIR, f), 'utf8'))
      for (const m of s.matchAll(/(?:CREATE|ALTER) POLICY "?projects_update"? ON (?:public\.)?projects[\s\S]*?;/g)) defs.push(m[0])
    }
    expect(defs.length).toBeGreaterThan(0)
    const ultima = defs[defs.length - 1]
    expect(ultima).toMatch(/company_owner/)
    expect(ultima).toMatch(/'admin'/)
    expect(ultima).not.toMatch(/operator|viewer|collector|cliente/)
  })
})

describe('la pestaña «Config. portal»', () => {
  it('vive en Residentes, junto al portal, y está en el registro', () => {
    expect(sectionForTab('portal_config')).toBe('residentes')
    const residentes = SECTIONS.find(s => s.id === 'residentes')!.tabs
    expect(residentes.indexOf('portal_config')).toBe(residentes.indexOf('portal') + 1)
    expect(SECTIONS.filter(s => s.tabs.includes('portal_config'))).toHaveLength(1)
    // El registro se lee como texto: importarlo arrastra el cliente de Supabase.
    const registro = readFileSync(resolve('src/components/condominios/tabRegistry.tsx'), 'utf8')
    expect(registro).toContain("{ id: 'portal_config', label: 'Config. portal'")
    expect(registro).toMatch(/\| 'portal_config'/)
  })

  it('ninguna migración siembra su clave RBAC', () => {
    for (const f of readdirSync(DIR).filter(n => n.endsWith('.sql'))) {
      const s = soloCodigo(readFileSync(resolve(DIR, f), 'utf8'))
      expect(s.includes('condominios.tab.portal_config'), f).toBe(false)
    }
  })

  it('ningún rol de condominios la da ni el editor de roles la ofrece', () => {
    for (const [rol, acceso] of Object.entries(CONDOMINIOS_TAB_ACCESS)) {
      if (acceso === null) continue // administrador_general: lo resuelve el RBAC (sin clave → sólo exentos)
      expect(acceso.has('portal_config'), rol).toBe(false)
    }
    for (const g of CONDOMINIOS_SECTION_GROUPS) expect(g.tabs, g.key).not.toContain('portal_config')
  })
})
