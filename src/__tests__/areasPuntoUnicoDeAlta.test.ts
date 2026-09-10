// ════════════════════════════════════════════════════════════════════════════
// Las áreas del condominio se dan de alta en UN SOLO lugar
//
// `areas_condominio` siempre fue un catálogo único, pero su CRUD estaba montado
// dos veces (Rutas Ronda y Limpieza). No producía datos distintos: producía
// duplicados, porque quien creaba un área desde un tab no sabía que estaba
// tocando el catálogo del otro y, al no encontrarla donde la había creado, la
// volvía a crear. El arreglo es un tab propio —"Áreas"— y los demás tabs en
// consulta.
//
// Lo que se vigila aquí es lo que una regresión rompe callando:
//
//   1. Que el CRUD (AreasCatalog) se monte en UN solo componente de UI. Volver
//      a montarlo en un tab consumidor reabre el problema entero y no rompe
//      ninguna prueba de ese tab.
//   2. Que el tab exista en la nav, en UNA sola sección (`sectionForTab` mapea
//      por tab y la última gana: duplicarlo manda al usuario a otra sección) y
//      en el editor de roles.
//   3. Que quien administraba áreas de facto conserve el acceso: el rol
//      seguridad las administraba embebidas en Rutas Ronda.
//   4. Que la migración siembre la clave RBAC del tab y la sume a las policies
//      de escritura — sin eso el tab se ve y la BD rechaza cada guardado.
//   5. Que `tareas_condominio.area_id` y `checklist_areas.area_id` existan con
//      ON DELETE RESTRICT: el área en uso se desactiva, no se borra dejando
//      tareas ni inspecciones colgando.
//   6. Que NINGÚN consumidor vuelva a capturar el área como texto libre. Es la
//      regresión barata: basta un `<input>` nuevo en un tab para que "Piscina"
//      y "piscina" vuelvan a ser dos áreas.
// ════════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { SECTIONS, sectionForTab } from '../components/condominios/sections'
import { CONDOMINIOS_SECTION_GROUPS, CONDOMINIOS_TAB_ACCESS } from '../lib/condominiosRoles'

const TAB = 'areas_config'

const MIGRACION = resolve('supabase/migrations/20260910000000_areas_un_solo_lugar_y_tareas_por_catalogo.sql')
/** Sin comentarios: que la clave aparezca en la explicación no es que se siembre. */
const sql = readFileSync(MIGRACION, 'utf8').replace(/--[^\n]*/g, '')

const MIGRACION_CHECKLIST = resolve('supabase/migrations/20260910000100_checklist_areas_por_catalogo.sql')
const sqlChecklist = readFileSync(MIGRACION_CHECKLIST, 'utf8').replace(/--[^\n]*/g, '')

const DIR_TABS = resolve('src/components/condominios/tabs')

/** Archivos .tsx de UI (los tabs y sus subcarpetas), sin las pruebas. */
function archivosUI(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const ruta = join(dir, e.name)
    if (e.isDirectory()) return e.name === '__tests__' ? [] : archivosUI(ruta)
    return e.name.endsWith('.tsx') && !e.name.includes('.test.') ? [ruta] : []
  })
}

describe('catálogo de áreas: un solo punto de alta', () => {
  it('AreasCatalog (el CRUD) se monta solo en el tab Áreas', () => {
    const montan = [
      ...archivosUI(DIR_TABS),
      resolve('src/components/condominios/AreasCatalog.tsx'),
      resolve('src/components/condominios/AreasResumen.tsx'),
    ].filter(f => /<AreasCatalog\b/.test(readFileSync(f, 'utf8')))

    expect(montan.map(f => f.split('/').pop())).toEqual(['AreasCondominioTab.tsx'])
  })

  it('los tabs que consumen el catálogo lo muestran en solo lectura', () => {
    for (const tab of ['RutasRondaTab.tsx', 'ProgramacionLimpiezaTab.tsx']) {
      const src = readFileSync(join(DIR_TABS, tab), 'utf8')
      expect(src).toContain('<AreasResumen')
      expect(src).not.toContain('<AreasCatalog')
    }
  })

  it('el tab está registrado y vive en una sola sección de la nav', () => {
    const registro = readFileSync(resolve('src/components/condominios/tabRegistry.tsx'), 'utf8')
    expect(registro).toContain(`{ id: '${TAB}', label: 'Áreas'`)

    const secciones = SECTIONS.filter(s => s.tabs.includes(TAB))
    expect(secciones).toHaveLength(1)
    expect(sectionForTab(TAB)).toBe(secciones[0].id)
  })

  it('aparece una sola vez en el editor de roles', () => {
    const grupos = CONDOMINIOS_SECTION_GROUPS.filter(g => g.tabs.includes(TAB))
    expect(grupos).toHaveLength(1)
  })

  it('los roles que ya administraban áreas conservan el acceso', () => {
    // operaciones: dueño natural del catálogo (traía checklist_areas).
    expect(CONDOMINIOS_TAB_ACCESS.operaciones?.has(TAB)).toBe(true)
    // seguridad: lo administraba embebido en Rutas Ronda.
    expect(CONDOMINIOS_TAB_ACCESS.seguridad?.has(TAB)).toBe(true)
    // administrador_general = null (acceso total), no necesita la entrada.
    expect(CONDOMINIOS_TAB_ACCESS.administrador_general).toBeNull()
  })
})

describe('migración del tab Áreas y del área de las tareas', () => {
  it('siembra la clave del tab con sus cinco acciones', () => {
    expect(sql).toContain(`'condominios.tab.${TAB}'`)
    for (const accion of ['create', 'edit', 'change_status', 'approve', 'delete']) {
      expect(sql).toContain(`'condominios.tab.${TAB}.${accion}'`)
    }
  })

  it('agrega el tab a las policies de escritura de areas_condominio sin quitar las anteriores', () => {
    const insert = sql.slice(sql.indexOf('CREATE POLICY "areas_condominio_insert"'), sql.indexOf('CREATE POLICY "areas_condominio_update"'))
    for (const clave of ['condominios.tab.checklist_areas', 'condominios.areas.manage', `condominios.tab.${TAB}`]) {
      expect(insert).toContain(clave)
    }
    const update = sql.slice(sql.indexOf('CREATE POLICY "areas_condominio_update"'))
    for (const clave of ['condominios.tab.checklist_areas', 'condominios.areas.manage', `condominios.tab.${TAB}`]) {
      expect(update).toContain(clave)
    }
  })

  it('hereda los grants de quien ya podía escribir el catálogo', () => {
    expect(sql).toMatch(/rp\.permission_key IN \('condominios\.areas\.manage', 'condominios\.tab\.checklist_areas'\)/)
  })

  it('vincula tareas_condominio al catálogo con ON DELETE RESTRICT', () => {
    expect(sql).toMatch(/ALTER TABLE public\.tareas_condominio\s+ADD COLUMN IF NOT EXISTS area_id uuid\s+REFERENCES public\.areas_condominio\(id\) ON DELETE RESTRICT/)
  })

  it('el backfill no ata a un nombre ambiguo (deja NULL, que la UI marca)', () => {
    // Tres pasos: vincular único → crear faltante → vincular las creadas.
    expect(sql.match(/UPDATE public\.tareas_condominio t\s+SET area_id = a\.id/g)).toHaveLength(2)
    expect(sql.match(/SELECT 1 FROM public\.areas_condominio otra/g)).toHaveLength(2)
  })

  it('vincula checklist_areas al catálogo con ON DELETE RESTRICT y su backfill', () => {
    expect(sqlChecklist).toMatch(/ALTER TABLE public\.checklist_areas\s+ADD COLUMN IF NOT EXISTS area_id uuid\s+REFERENCES public\.areas_condominio\(id\) ON DELETE RESTRICT/)
    expect(sqlChecklist.match(/UPDATE public\.checklist_areas c\s+SET area_id = a\.id/g)).toHaveLength(2)
    expect(sqlChecklist.match(/SELECT 1 FROM public\.areas_condominio otra/g)).toHaveLength(2)
  })
})

describe('ningún tab captura el área como texto libre', () => {
  // Los tres consumidores que alguna vez la transcribieron. El día que alguno
  // vuelva a un <input>, esto se cae — que es el punto: el arreglo no es un
  // formulario, es que el área tenga una sola fuente.
  // (En Limpieza el formulario vive en la vista, no en el tab contenedor.)
  const CONSUMIDORES = ['limpieza/VistaAreas.tsx', 'TareasCondominioTab.tsx', 'ChecklistAreasTab.tsx']

  it.each(CONSUMIDORES)('%s captura el área con un <select> del catálogo', archivo => {
    const [ruta] = archivosUI(DIR_TABS).filter(f => f.endsWith(archivo))
    const src = readFileSync(ruta, 'utf8')
    // El estado del formulario apunta al id del catálogo, no a un nombre suelto.
    expect(src).toMatch(/area_?[Ii]d/)
    // Y ninguno conserva los placeholders de captura libre que tenían antes.
    for (const placeholder of ['Piscina, lobby', 'Ej. Lobby, Piscina, Gimnasio', 'Ej. Piscina, Lobby, Gimnasio']) {
      expect(src).not.toContain(placeholder)
    }
  })
})
