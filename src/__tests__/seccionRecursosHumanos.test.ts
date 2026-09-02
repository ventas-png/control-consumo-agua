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
  'personal', 'capacitacion_personal',
  'turnos', 'plantillas_cargo', 'ausencias', 'horas_extra', 'presencia', 'panel_turno',
  'tareas_personal', 'tareas_cond', 'prog_limpieza', 'rutas_ronda',
  'desempeno_personal', 'actividad_equipo',
] as const

/** Los nueve que vinieron de Seguridad en la segunda tanda (20260907001400). */
const TABS_JORNADA = [
  'turnos', 'plantillas_cargo', 'ausencias', 'horas_extra', 'presencia',
  'panel_turno', 'tareas_personal', 'rutas_ronda', 'desempeno_personal',
] as const

const MIGRACION_JORNADA = resolve('supabase/migrations/20260907001400_rbac_rrhh_absorbe_la_jornada.sql')
const sqlJornada = readFileSync(MIGRACION_JORNADA, 'utf8').replace(/--[^\n]*/g, '')

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
  // La conducta de la migración —qué se reclasifica, qué hereda cada rol, que
  // la guarda aborte— se verifica EJECUTÁNDOLA contra un Postgres desechable en
  // supabase/tests/rbac_recursos_humanos/, que corre en cada PR. Aquí sólo
  // quedan los guards que un test de conducta NO puede dar: que ese harness
  // siga cableado en CI, y la trampa de sintaxis que motivó el endurecimiento.

  it('el harness ejecutable está cableado en CI (si no, no corre nunca)', () => {
    const ci = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
    expect(ci).toContain('supabase/tests/rbac_recursos_humanos/run.sh')
  })

  it('reclasifica categoría sin renombrar claves', () => {
    expect(sqlRRHH).toMatch(/UPDATE public\.permissions[\s\S]{0,40}SET category = 'recursos_humanos'/)
    // Un rename rompería las policies que gatean sobre estas claves.
    expect(sqlRRHH).not.toMatch(/UPDATE public\.permissions[\s\S]{0,400}SET key/)
  })

  it('los cinco tabs de la primera tanda están nombrados en la migración', () => {
    for (const tab of ['personal', 'capacitacion_personal', 'tareas_cond',
                       'prog_limpieza', 'actividad_equipo']) {
      expect(sqlRRHH, tab).toContain(`'${tab}'`)
    }
  })

  // ── La trampa que motivó el endurecimiento ────────────────────────────────
  // En `LIKE`, `_` es un COMODÍN de un carácter, y cuatro de los cinco tabs lo
  // llevan en el nombre: `LIKE 'condominios.tab.actividad_equipo%'` también casa
  // `condominios.tab.actividadXequipo`. Hoy esa clave no existe y el patrón
  // parecería inofensivo — por eso es fácil reintroducirlo en una revisión.
  it('ningún LIKE ejecutable usa un guion bajo sin escapar', () => {
    const infractores: string[] = []
    for (const m of sqlRRHH.matchAll(/LIKE\s+'([^']*)'/g)) {
      const patron = m[1]
      // `\_` es el guion bajo literal; cualquier otro `_` es comodín.
      if (/(^|[^\\])_/.test(patron)) infractores.push(patron)
    }
    expect(infractores, `patrones con comodín accidental: ${infractores.join(', ')}`).toEqual([])
  })

  it('es idempotente (ON CONFLICT en los INSERT al catálogo, filtro en el UPDATE)', () => {
    // Los INSERT a la tabla TEMPORAL no llevan ON CONFLICT y no deben: se
    // crea vacía en cada corrida. Sólo se exige a los que tocan el catálogo.
    const aCatalogo = (sqlRRHH.match(/INSERT INTO public\./g) ?? []).length
    const conflictos = (sqlRRHH.match(/ON CONFLICT/g) ?? []).length
    expect(conflictos).toBe(aCatalogo)
    expect(sqlRRHH).toMatch(/category IS DISTINCT FROM 'recursos_humanos'/)
  })

  it('la guarda de postcondición aborta, no sólo avisa', () => {
    expect(sqlRRHH).toMatch(/RAISE EXCEPTION/)
    expect(sqlRRHH).toContain('no existen en el catálogo')
  })

  it('la tabla temporal no sobrevive a la migración', () => {
    expect(sqlRRHH).toMatch(/DROP TABLE _rrhh_claves/)
  })
})

describe('el riel del sidebar con 11 secciones', () => {
  // Añadir Recursos Humanos hizo que la lista desbordara el viewport y que
  // "Especiales" —la última— quedara bajo el corte, con aspecto de haber
  // desaparecido. Se recuperó bajando el padding de 12px a 8px, que con el
  // ícono de 28px deja la fila EXACTAMENTE en 44px.
  //
  // 44px es el mínimo de área táctil (WCAG 2.5.5 / HIG) y esta app se empaqueta
  // con Capacitor, así que el siguiente que necesite espacio no puede sacarlo
  // de ahí. Este guard existe para que ese recorte no pase callando.
  const sidebar = readFileSync(resolve('src/components/layout/Sidebar.tsx'), 'utf8')
  const botonSeccion = sidebar.slice(sidebar.indexOf('key={`condo-sec-'))

  it('la fila de sección conserva el piso de área táctil de 44px', () => {
    expect(botonSeccion).toMatch(/minHeight: '44px'/)
  })

  it('el padding vertical no vuelve a inflar la fila por encima de 44px', () => {
    const m = botonSeccion.match(/padding: '(\d+)px \d+px'/)
    expect(m, 'no se encontró el padding de la fila de sección').not.toBeNull()
    const vertical = Number(m![1])
    // 28px de ícono + 2 × padding ≤ 44 ⇒ padding ≤ 8.
    expect(vertical * 2 + 28).toBeLessThanOrEqual(44)
  })

  it('Especiales sigue siendo la última sección del riel', () => {
    expect(SECTIONS[SECTIONS.length - 1].id).toBe('especiales')
    expect(SECTIONS.find(s => s.id === 'especiales')!.tabs).toContain('str')
  })
})

describe('migración 20260907001400 (la jornada, desde Seguridad)', () => {
  it('nombra los nueve tabs que se mudan', () => {
    for (const tab of TABS_JORNADA) {
      expect(sqlJornada, tab).toContain(`'${tab}'`)
    }
  })

  it('NO toca revision_tareas, que se queda en Seguridad', () => {
    // Es la contraparte de tareas_personal: si algún día se muda, que sea una
    // decisión, no un arrastre.
    const sinCabecera = sqlJornada.slice(sqlJornada.indexOf('CREATE TEMP TABLE'))
    expect(sinCabecera).not.toContain('revision_tareas')
  })

  it('reclasifica categoría sin renombrar claves ni tocar grants', () => {
    expect(sqlJornada).toMatch(/UPDATE public\.permissions[\s\S]{0,40}SET category = 'recursos_humanos'/)
    expect(sqlJornada).not.toMatch(/UPDATE public\.permissions[\s\S]{0,400}SET key/)
    // Esta tanda no siembra nada: los nueve ya existen con sus acciones.
    expect(sqlJornada).not.toMatch(/INSERT INTO public\./)
  })

  it('ningún LIKE ejecutable usa un guion bajo sin escapar', () => {
    const infractores: string[] = []
    for (const m of sqlJornada.matchAll(/LIKE\s+'([^']*)'/g)) {
      if (/(^|[^\\])_/.test(m[1])) infractores.push(m[1])
    }
    expect(infractores, `patrones con comodín accidental: ${infractores.join(', ')}`).toEqual([])
  })

  it('la guarda de postcondición aborta, y la temporal no sobrevive', () => {
    expect(sqlJornada).toMatch(/RAISE EXCEPTION/)
    expect(sqlJornada).toContain('no existen en el catálogo')
    expect(sqlJornada).toMatch(/category IS DISTINCT FROM 'recursos_humanos'/)
    expect(sqlJornada).toMatch(/DROP TABLE _rrhh_jornada/)
  })

  it('el harness ejecutable aplica AMBAS migraciones', () => {
    const run = readFileSync(resolve('supabase/tests/rbac_recursos_humanos/run.sh'), 'utf8')
    expect(run).toContain('20260907001200_rbac_seccion_recursos_humanos.sql')
    expect(run).toContain('20260907001400_rbac_rrhh_absorbe_la_jornada.sql')
    // Y mira el estado intermedio, que es donde se ve el arrastre de la primera.
    expect(run).toContain('entre_tandas.sql')
  })

  it('Seguridad conserva su acceso efectivo pese a la mudanza de sección', () => {
    const acceso = CONDOMINIOS_TAB_ACCESS.seguridad!
    for (const tab of TABS_JORNADA) {
      expect(acceso.has(tab), `seguridad perdió ${tab}`).toBe(true)
    }
  })

  it('el bloque Seguridad del editor ya no ofrece los tabs de la jornada', () => {
    const seg = CONDOMINIOS_SECTION_GROUPS.find(g => g.key === 'seguridad')!
    for (const tab of TABS_JORNADA) {
      expect(seg.tabs, `${tab} sigue en el bloque de Seguridad`).not.toContain(tab)
    }
    // Lo que sí se queda.
    expect(seg.tabs).toContain('revision_tareas')
    expect(seg.tabs).toContain('bitacora_guardia')
  })
})
