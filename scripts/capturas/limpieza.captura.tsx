// Capturas del manual de LIMPIEZA: monta los componentes REALES con la empresa demo
// (./demo.ts), reproduce cada paso con clics y vuelca el HTML de la pantalla.
// Después `fotografiar.mjs` abre cada HTML con los estilos del sistema y lo
// fotografía con Chromium.
//
//   npx vitest run --config scripts/capturas/vitest.config.ts
//   node scripts/capturas/fotografiar.mjs
//
// No hay red ni base: todas las lecturas y escrituras están simuladas.
import { describe, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as D from './demo'

vi.mock('../../src/lib/supabase', () => {
  // Cliente falso: cualquier consulta que no esté simulada abajo devuelve vacío.
  const falso = (): unknown => new Proxy(function () {}, {
    get(_t, k) {
      if (k === 'then') return (ok: (v: unknown) => void) => ok({ data: [], error: null, count: 0 })
      return falso()
    },
    apply() { return falso() },
  })
  return { supabase: falso(), db: falso() }
})
vi.mock('../../src/domain/condominios/tabQueries', async (orig) => {
  const d = await import('./demo')
  return {
    ...(await orig<object>()),
    fetchCalendarioLimpieza: async (_p: string, desde: string, hasta: string) => ({
      turnos: d.TURNOS_CAL.filter(t => t.fecha >= desde && t.fecha <= hasta), error: null,
    }),
    fetchRutinasLimpieza: async () => ({
      rutinas: d.RUTINAS, pasos: d.PASOS, paradas: d.PARADAS,
      horarios: d.JORNADAS.map(j => ({ id: j.id, nombre: j.nombre, hora_inicio: j.hora_inicio, hora_fin: j.hora_fin })),
      error: null,
    }),
    fetchNovedadesRutinas: async () => ({ tareas: d.NOVEDADES, error: null }),
    fetchTareasDeTurnos: async (ids: string[]) => ({ tareas: ids.flatMap(d.tareasDelTurno), error: null }),
    fetchInsumosDeTareas: async (ids: string[]) => ({ insumos: d.insumosDe(ids), error: null }),
    fetchHerramientasDePlantillas: async (ids: string[]) => ({
      herramientas: d.HERRAMIENTAS.filter(h => ids.includes(h.plantilla_tarea_id)), error: null,
    }),
    fetchRecursosPlantillas: async () => ({ suministros: [], herramientas: d.HERRAMIENTAS, error: null }),
  }
})
vi.mock('../../src/domain/condominios/tabMutations', async (orig) => {
  const ok = async () => ({ data: null, error: null })
  return {
    ...(await orig<object>()),
    asignarRutinasTurno: async () => ({ data: { generadas: 12, omitidas_existente: 0 }, error: null }),
    quitarRutinaTurno: async () => ({ data: 4, error: null }),
    updateCondominioRow: ok, createCondominioRow: ok, deleteCondominioRow: ok,
    createCondominioRowReturning: async () => ({ data: { id: 'nuevo' }, error: null }),
    cerrarTareaYConsumir: async () => ({ data: { consumidos: 0, no_usados: 0, sin_stock: [] }, error: null }),
    guardarRecorridoRutina: ok, atenderNovedad: ok,
    generarBloquesTurno: async () => ({ data: { generados: 0, omitidos_ausencia: 0, omitidos_no_laborable: 0, omitidos_existente: 0 }, error: null }),
  }
})
vi.mock('../../src/domain/condominios/sectionData', async (orig) => {
  const d = await import('./demo')
  return {
    ...(await orig<object>()),
    fetchTurnosDelMes: async (_p: string, _c: string, desde: string, hasta: string) => [
      { data: d.BLOQUES.filter(b => b.fecha >= desde && b.fecha <= hasta), error: null },
      { data: [], error: null },
    ],
  }
})
vi.mock('../../src/domain/condominios/politicaJornada', async (orig) => {
  const d = await import('./demo')
  return {
    ...(await orig<object>()),
    fetchCuposDePlantillas: async (ids: string[]) => ({ cupos: d.CUPOS.filter(c => ids.includes(c.plantilla_horario_id)), error: null }),
  }
})
vi.mock('../../src/domain/condominios/pausasPresencia', async (orig) => {
  const d = await import('./demo')
  return { ...(await orig<object>()), fetchTiposPausa: async () => ({ tipos: d.TIPOS_PAUSA, error: null }) }
})
vi.mock('../../src/components/shared/Dialog', async (orig) => ({
  ...(await orig<object>()),
  confirm: async () => ({ isConfirmed: false }),
  notify: () => {},
}))

const { ProgramacionLimpiezaTab } = await import('../../src/components/condominios/tabs/ProgramacionLimpiezaTab')
const { TareasPersonalTab } = await import('../../src/components/condominios/tabs/TareasPersonalTab')
const { AreasCondominioTab } = await import('../../src/components/condominios/tabs/AreasCondominioTab')
const { PlantillasCargoTab } = await import('../../src/components/condominios/tabs/PlantillasCargoTab')
const TurnosTab = (await import('../../src/components/condominios/tabs/TurnosTab')).default

const OUT = process.env.CAPTURAS_OUT ?? join(process.cwd(), 'scripts/capturas/salida')
mkdirSync(join(OUT, 'html'), { recursive: true })

/** Vuelca la pantalla tal como está: el HTML del cuerpo y los <style> que haya inyectado algún componente. */
function volcar(nombre: string, opciones: { ancho?: number; alto?: number } = {}) {
  const ancho = opciones.ancho ?? 1280
  // El estado de los controles vive en propiedades, no en atributos: se copia para que el HTML lo muestre.
  document.querySelectorAll('input').forEach(i => {
    if (i.type === 'checkbox' || i.type === 'radio') {
      if (i.checked) i.setAttribute('checked', '')
      else i.removeAttribute('checked')
    } else i.setAttribute('value', i.value)
  })
  document.querySelectorAll('textarea').forEach(t => { t.textContent = t.value })
  document.querySelectorAll('select').forEach(s => [...s.options].forEach(o => {
    if (o.selected) o.setAttribute('selected', '')
    else o.removeAttribute('selected')
  }))
  const estilos = [...document.head.querySelectorAll('style')].map(s => s.outerHTML).join('\n')
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=${ancho}">
<link rel="stylesheet" href="../index.css">${estilos}
<style>html,body{background:var(--at-bg);margin:0} #cap{padding:${ancho < 600 ? 0 : 8}px 0}</style>
</head><body data-ancho="${ancho}" data-alto="${opciones.alto ?? 0}"><div id="cap">${document.body.innerHTML}</div></body></html>`
  writeFileSync(join(OUT, 'html', `${nombre}.html`), html)
}

const pausa = (ms = 30) => act(() => new Promise(r => setTimeout(r, ms)))

const propsLimpieza = {
  personal: D.PERSONAL, cargos: [], areas: D.AREAS, plantillas: D.PLANTILLAS,
  proyectoId: D.PR, companyId: D.CO, userId: 'u_admin', canCreate: true, canEdit: true, canDelete: true, onRefresh: () => {},
}

async function montarLimpieza() {
  render(<ProgramacionLimpiezaTab {...propsLimpieza} />)
  await screen.findByRole('region', { name: 'Calendario de Ana Pérez' })
  await screen.findByText(/Pendientes hoy \(de 18\)/)
  await pausa()
}
const vista = (nombre: RegExp) => fireEvent.click(screen.getByRole('tab', { name: nombre }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 25, 10, 0, 0))
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Limpieza', () => {
  it('10 · calendario con indicadores', async () => {
    await montarLimpieza()
    volcar('10-limpieza-calendario', { alto: 1240 })
  })

  it('11 · ＋ varias rutinas en un día', async () => {
    await montarLimpieza()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar rutinas a Ana Pérez el lun 30 nov' }))
    const dlg = await screen.findByText('Rutinas para Ana Pérez')
    const ventana = dlg.closest('[role="dialog"]') as HTMLElement ?? document.body
    fireEvent.click(within(ventana).getByText('Limpieza de Lobby'))
    fireEvent.click(within(ventana).getByText('Barrido de Pasillos y Gradas'))
    await pausa()
    volcar('11-limpieza-mas-varias', { alto: 1000 })
  })

  it('12 · detalle de una rutina asignada', async () => {
    await montarLimpieza()
    fireEvent.click(screen.getByRole('button', { name: /^Limpieza de Lobby, Ana Pérez el jue 26 nov/ }))
    await screen.findByText('Quitar del día')
    volcar('12-limpieza-detalle', { alto: 1000 })
  })

  it('13 · teléfono: lista de días', async () => {
    const ro = globalThis.ResizeObserver
    globalThis.ResizeObserver = class { constructor(private cb: () => void) {} observe() { this.cb() } unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
    try {
      await montarLimpieza()
      fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar empleado' }), { target: { value: 'Ana' } })
      await pausa()
      volcar('13-limpieza-movil', { ancho: 390, alto: 1400 })
    } finally { globalThis.ResizeObserver = ro }
  })

  it('20 · lista de rutinas', async () => {
    await montarLimpieza()
    vista(/Rutinas/)
    await screen.findByText('Rutinas de limpieza')
    await screen.findByText('Vidrios de temporada')
    volcar('20-rutinas-lista', { alto: 1300 })
  })

  it('21 · editor del recorrido', async () => {
    await montarLimpieza()
    vista(/Rutinas/)
    fireEvent.click(await screen.findByRole('button', { name: 'Editar el recorrido de Barrido de Pasillos y Gradas' }))
    await screen.findByText('Editar «Barrido de Pasillos y Gradas»')
    await pausa()
    volcar('21-rutinas-editor', { alto: 1200 })
  })

  it('30 · ruta del día', async () => {
    await montarLimpieza()
    vista(/Ruta del día/)
    await screen.findByText(/Luis Gómez/)
    await pausa()
    volcar('30-ruta-dia', { alto: 900 })
  })

  it('31 · antes de iniciar el turno', async () => {
    await montarLimpieza()
    vista(/Ruta del día/)
    await screen.findByText(/Luis Gómez/)
    fireEvent.click(await screen.findByText('▶ Iniciar'))
    const prep = await screen.findByRole('region', { name: 'Antes de iniciar el turno' })
    await within(prep).findByText('Trapeador')
    const casillas = within(prep).getAllByRole('checkbox')
    casillas.slice(0, 3).forEach(c => fireEvent.click(c))
    await pausa()
    volcar('31-ruta-preparacion', { alto: 1800 })
  })

  it('32 · llegada a un área y tarea', async () => {
    await montarLimpieza()
    vista(/Ruta del día/)
    await screen.findByText(/Ana Pérez/)
    fireEvent.click(screen.getAllByText('▾')[0])
    await pausa()
    const empezar = screen.queryByText(/^Empezar en/)
    if (empezar) {
      volcar('32-ruta-parada', { alto: 1100 })
      fireEvent.click(empezar)
      await pausa()
    }
    await screen.findByRole('region', { name: /^Tarea \d+ de \d+:/ })
    await pausa(60)
    volcar('33-ruta-tarea', { alto: 1300 })
  })

  it('40 · novedades', async () => {
    await montarLimpieza()
    vista(/Novedades/)
    await screen.findByText(/Luminaria fundida/)
    volcar('40-novedades', { alto: 900 })
  })
})

describe('Ruta del día · fin del turno', () => {
  it('34 · resumen y cierre', async () => {
    const bid = 'b_per_ana_25'
    const tareas = D.tareasDelTurno(bid).map((t, i) => ({
      ...t,
      estado: (i === 6 ? 'con_observacion' : i === 9 ? 'omitida' : 'completada') as typeof t.estado,
      completada_en: '2026-11-25T19:00:00Z',
      checklist_completado: (t.checklist ?? []).map((_, k) => k),
      foto_urls: t.requiere_foto ? ['demo.jpg'] : [],
      novedad: i === 6 ? 'Luminaria fundida en el pasillo del nivel 3' : null,
    }))
    const bloque = { ...D.BLOQUES.find(b => b.id === bid)!, estado: 'en_curso' as const }
    render(
      <TareasPersonalTab
        bloques={[bloque]} tareas={tareas} plantillas={D.PLANTILLAS} personal={D.PERSONAL} areas={D.AREAS} cargos={[]}
        proyectoId={D.PR} companyId={D.CO} userId="u_admin" canCreate={false} canEdit canDelete={false} onRefresh={() => {}}
        modoRuta={{ titulo: 'Ruta del día', subtitulo: 'Lo que cada empleado tiene asignado en el calendario. Iniciá el turno para ejecutar sus tareas, con evidencia, y cerralo al terminar.', onFechaChange: () => {} }}
      />,
    )
    fireEvent.click(screen.getAllByText('▾')[0])
    await waitFor(() => { if (!screen.queryAllByText(/Cerrar turno/).length) throw new Error('sin cierre') })
    await pausa()
    volcar('34-ruta-fin', { alto: 1000 })
  })
})

describe('Requisitos previos', () => {
  it('01 · Operaciones → Áreas', async () => {
    render(<AreasCondominioTab areas={D.AREAS} proyectoId={D.PR} companyId={D.CO} canCreate canEdit canDelete onRefresh={() => {}} />)
    await screen.findByText('Gradas')
    volcar('01-areas', { alto: 1100 })
  })

  it('02 · RRHH → Plantillas: catálogo de actividades', async () => {
    render(<PlantillasCargoTab plantillas={D.PLANTILLAS} cargos={[]} areas={D.AREAS} suministros={[]} equipos={[]} proyectoId={D.PR} companyId={D.CO} canCreate canEdit canDelete onRefresh={() => {}} />)
    await screen.findByText('Trapeado de piso')
    await pausa()
    volcar('02-plantillas', { alto: 1300 })
  })

  it('03 · RRHH → Plantillas: formulario de una actividad', async () => {
    render(<PlantillasCargoTab plantillas={D.PLANTILLAS} cargos={[]} areas={D.AREAS} suministros={[]} equipos={[]} proyectoId={D.PR} companyId={D.CO} canCreate canEdit canDelete onRefresh={() => {}} />)
    await screen.findByText('Trapeado de piso')
    fireEvent.click(screen.getAllByText('✏️ Editar')[1])
    await screen.findByLabelText(/Duración estimada/)
    await screen.findByDisplayValue('Trapeado de piso')
    await pausa()
    volcar('03-plantillas-form', { alto: 1300 })
  })

  const turnos = () => render(
    <TurnosTab plantillas={D.JORNADAS} asignaciones={D.REGLAS} bloques={D.BLOQUES} ausencias={[]} diasNoLaborables={[]} excepciones={[]}
      personal={D.PERSONAL} proyectoId={D.PR} companyId={D.CO} canCreate canEdit canDelete onRefresh={() => {}} />,
  )

  it('04 · Asignación turnos → Jornadas', async () => {
    turnos()
    fireEvent.click(await screen.findByRole('tab', { name: /Jornadas/ }))
    await screen.findByText('Sábado medio día')
    await pausa()
    volcar('04-turnos-jornadas', { alto: 900 })
  })

  it('05 · Asignación turnos → Editar jornada (con descansos)', async () => {
    turnos()
    fireEvent.click(await screen.findByRole('tab', { name: /Jornadas/ }))
    await screen.findByText('Sábado medio día')
    fireEvent.click(screen.getAllByText('Editar')[0])
    await screen.findByText('Editar jornada')
    await pausa(80)
    volcar('05-turnos-jornada-form', { alto: 1300 })
  })

  it('06 · Asignación turnos → Reglas', async () => {
    turnos()
    fireEvent.click(await screen.findByRole('tab', { name: /Reglas/ }))
    await screen.findAllByText(/Luis Gómez/)
    await pausa()
    volcar('06-turnos-reglas', { alto: 900 })
  })

  it('07 · Asignación turnos → Calendario y Generar', async () => {
    turnos()
    await screen.findByText(/Generar Noviembre/)
    await pausa(80)
    volcar('07-turnos-calendario', { alto: 1000 })
  })
})
