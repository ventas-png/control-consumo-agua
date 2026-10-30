// Piscina: el nuevo registro se hace en ventana (pantalla completa en el
// teléfono, sin cerrarse a mitad del guardado), el pH y el cloro dicen en
// palabras si están fuera de rango, y cada registro —desde el historial o
// desde la tarjeta de su piscina— abre su detalle en ventana. Abrir/cerrar
// avisa si falla (antes no hacía nada). El mismo registro sirve para el
// jacuzzi, el área se elige del catálogo, se miden los parámetros de las tiras
// de prueba, lleva fotos (muestra, resultado, área) y «Registrado por» se
// propone con el usuario que mide.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { AreaCondominio, ControlPiscina, PersonalCondominio } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  updateCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: vi.fn(),
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: vi.fn(), notify: mocks.notify }))
// Subir y firmar imágenes es del storage; aquí basta con qué rutas viajan.
vi.mock('../../../shared/ImageUploader', () => ({
  MultiImageUploader: ({ values, onChange, label, maxFiles }: { values: string[]; onChange: (v: string[]) => void; label: string; maxFiles: number }) => (
    <button type="button" disabled={values.length >= maxFiles} onClick={() => onChange([...values, `p1/piscina/${label.split(' ')[0].toLowerCase()}-${values.length + 1}.jpg`])}>{`${label}: agregar (${values.length}/${maxFiles})`}</button>
  ),
}))
vi.mock('../../../shared/ImageGallery', () => ({
  ImageGallery: ({ urls }: { urls: string[] }) => <ul aria-label="Galería">{urls.map(u => <li key={u}>{u}</li>)}</ul>,
}))

const { default: ControlPiscinaTab } = await import('../ControlPiscinaTab')

function registro(over: Partial<ControlPiscina>): ControlPiscina {
  return {
    id: 'p1', company_id: 'co1', project_id: 'pr1', fecha: '2026-10-20', hora: '08:30:00', piscina: 'Principal', tipo: 'piscina',
    ph: 7.4, cloro: 1.5, temperatura: 27, turbiedad: 'cristalina', estado: 'abierta',
    num_usuarios: 4, registrado_por: 'Pedro', observaciones: null, created_at: '2026-10-20T14:30:00Z',
    ...over,
  }
}

const registros = [
  registro({ id: 'p1' }),
  registro({ id: 'p0', fecha: '2026-10-19', ph: 8.6, cloro: 0.3, estado: 'cerrada_quimica', observaciones: 'Se agregó ácido muriático.' }),
  registro({ id: 'i1', piscina: 'Infantil', fecha: '2026-10-20', hora: '09:00:00', ph: 7.9, estado: 'cerrada_mantenimiento' }),
]

const areas: AreaCondominio[] = [
  { id: 'a-social', company_id: 'co1', project_id: 'pr1', nombre: 'Área social', icono: '🌴', orden: 1, activo: true, created_at: '2026-01-01T00:00:00Z' },
  { id: 'a-azotea', company_id: 'co1', project_id: 'pr1', nombre: 'Azotea', icono: '🏢', orden: 2, activo: true, created_at: '2026-01-01T00:00:00Z' },
  { id: 'a-vieja', company_id: 'co1', project_id: 'pr1', nombre: 'Terraza vieja', icono: '🧱', orden: 3, activo: false, created_at: '2026-01-01T00:00:00Z' },
]
function empleado(over: Partial<PersonalCondominio>): PersonalCondominio {
  return { id: 'e1', company_id: 'co1', project_id: 'pr1', nombre: 'Ana López', cargo: 'conserje', turno: 'diurno', estado: 'activo', created_at: '2026-01-01T00:00:00Z', ...over } as PersonalCondominio
}

function props(over: Partial<Parameters<typeof ControlPiscinaTab>[0]> = {}): Parameters<typeof ControlPiscinaTab>[0] {
  return { registros, areas, personal: [], proyectoId: 'pr1', companyId: 'co1', canCreate: true, canEdit: true, onRefresh: vi.fn(), ...over }
}

function esperar() {
  let resolver!: (v: { error: null }) => void
  const promesa = new Promise<{ error: null }>(res => { resolver = res })
  return { promesa, resolver }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
})
afterEach(cleanup)

describe('Piscina — nuevo registro en ventana', () => {
  it('abre a pantalla completa y registra; no se cierra mientras guarda', async () => {
    const onRefresh = vi.fn()
    render(<ControlPiscinaTab {...props({ onRefresh })} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    const ventana = screen.getByRole('dialog', { name: '🏊 Nuevo registro de piscina' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(screen.getByLabelText('Piscina'), { target: { value: 'Infantil' } })
    fireEvent.change(screen.getByLabelText('pH'), { target: { value: '7.5' } })
    fireEvent.change(screen.getByLabelText('Cloro libre (ppm)'), { target: { value: '1.2' } })
    fireEvent.change(screen.getByLabelText('N° usuarios en piscina'), { target: { value: '6' } })

    const guardado = esperar()
    mocks.createCondominioRow.mockReturnValueOnce(guardado.promesa)
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow).toHaveBeenCalledWith('control_piscina', expect.objectContaining({
      company_id: 'co1', project_id: 'pr1', tipo: 'piscina', piscina: 'Infantil', area_id: null, ph: 7.5, cloro: 1.2, num_usuarios: 6,
      cloro_total: null, bromo: null, dureza_total: null, acido_cianurico: null, alcalinidad_total: null, cobre: null, sal: null,
      fotos_muestra: [], fotos_resultado: [], fotos_area: [],
    }))

    // Mientras guarda, ni Escape ni la X la cierran.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(ventana).getByLabelText('Cerrar modal'))
    expect(screen.getByRole('dialog', { name: '🏊 Nuevo registro de piscina' })).toBeTruthy()

    guardado.resolver({ error: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('el pH y el cloro dicen en palabras si están fuera de rango', () => {
    render(<ControlPiscinaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    const ventana = screen.getByRole('dialog')
    expect(within(ventana).getByText('Ideal 7.2–7.8')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('pH'), { target: { value: '8.5' } })
    expect(within(ventana).getByText('Fuera de rango (ideal 7.2–7.8)')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Cloro libre (ppm)'), { target: { value: '3.5' } })
    expect(within(ventana).getByText('Revisar: cerca del límite (ideal 0.5–3)')).toBeTruthy()
  })

  it('un pH imposible (72 por 7.2) no se envía', async () => {
    render(<ControlPiscinaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    fireEvent.change(screen.getByLabelText('pH'), { target: { value: '72' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await new Promise(r => setTimeout(r, 0))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('sin nombre de piscina avisa; si falla el guardado, la ventana conserva lo escrito', async () => {
    render(<ControlPiscinaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    fireEvent.change(screen.getByLabelText('Piscina'), { target: { value: '  ' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' })))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()

    mocks.createCondominioRow.mockResolvedValueOnce({ error: { message: 'Sin conexión' } })
    fireEvent.change(screen.getByLabelText('Piscina'), { target: { value: 'Sur' } })
    fireEvent.change(screen.getByLabelText('Observaciones'), { target: { value: 'Hojas en el skimmer' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Sin conexión' })))
    expect((screen.getByLabelText('Observaciones') as HTMLTextAreaElement).value).toBe('Hojas en el skimmer')
  })

  it('sin permiso de crear no hay botón; sin editar no hay Abrir/Cerrar', () => {
    render(<ControlPiscinaTab {...props({ canCreate: false, canEdit: false })} />)
    expect(screen.queryByRole('button', { name: '+ Nuevo registro' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^(Abrir|Cerrar) / })).toBeNull()
  })
})

describe('Piscina — historial y detalle', () => {
  it('el historial se lee como tarjetas con rótulos; acciones al pie', () => {
    const { container } = render(<ControlPiscinaTab {...props()} />)
    const tabla = container.querySelector('table')!
    expect(tabla.classList.contains('table-cards-on-mobile')).toBe(true)
    const celdas = Array.from(tabla.querySelectorAll('tbody tr:first-child td'))
    expect(celdas.map(td => td.getAttribute('data-label'))).toEqual(
      ['Piscina', 'Área', 'Fecha', 'pH', 'Cloro libre', '°C', 'Turbiedad', 'Estado', null])
  })

  it('«Ver» abre el detalle con el rango en palabras y las observaciones', () => {
    render(<ControlPiscinaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver registro de Principal del 2026-10-19 08:30' }))
    const detalle = screen.getByRole('dialog', { name: '🏊 Principal' })
    expect(detalle.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(detalle).getByText('Se agregó ácido muriático.')).toBeTruthy()
    expect(within(detalle).getByText('Fuera de rango · ideal 7.2–7.8')).toBeTruthy() // pH 8.6
    expect(within(detalle).getByText('Revisar: cerca del límite · ideal 0.5–3')).toBeTruthy() // cloro 0.3
    expect(within(detalle).getByText('Pedro')).toBeTruthy()
  })

  it('la tarjeta de una piscina abre su último registro', () => {
    render(<ControlPiscinaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver último registro de Principal: Abierta' }))
    const detalle = screen.getByRole('dialog', { name: '🏊 Principal' })
    expect(within(detalle).getByText('2026-10-20 · 08:30')).toBeTruthy()
  })

  it('cerrar por mantenimiento desde el detalle; si falla, avisa', async () => {
    const onRefresh = vi.fn()
    render(<ControlPiscinaTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver registro de Principal del 2026-10-20 08:30' }))
    mocks.updateCondominioRow.mockResolvedValueOnce({ error: { message: 'Permiso denegado' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '🔧 Cerrar por mantenimiento' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Permiso denegado' })))
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('control_piscina', 'p1', { estado: 'cerrada_mantenimiento' })
    expect(onRefresh).not.toHaveBeenCalled()

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '🔧 Cerrar por mantenimiento' }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })

  it('«Abrir» en la fila no abre el detalle', async () => {
    render(<ControlPiscinaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Infantil' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('control_piscina', 'i1', { estado: 'abierta' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

// El estado de la piscina es el de su último registro. Antes cada fila tenía
// Abrir/Cerrar: «Abrir» en el registro del 19 (cerrado por química) lo
// cambiaba a él y la tarjeta de Principal seguía igual.
describe('Piscina — Abrir/Cerrar sólo en el último registro', () => {
  it('cada piscina tiene un solo botón de estado, el de su último registro', () => {
    render(<ControlPiscinaTab {...props()} />)
    const botones = screen.getAllByRole('button', { name: /^(Abrir|Cerrar) / }).map(b => b.getAttribute('aria-label'))
    expect(botones.sort()).toEqual(['Abrir Infantil', 'Cerrar Principal por mantenimiento'])
  })

  it('el detalle de un registro viejo no cambia el estado y lleva al último', () => {
    render(<ControlPiscinaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver registro de Principal del 2026-10-19 08:30' }))
    let detalle = screen.getByRole('dialog', { name: '🏊 Principal' })
    expect(within(detalle).queryByRole('button', { name: '✅ Marcar abierta' })).toBeNull()
    expect(within(detalle).getByText(/Hay un registro más reciente de Principal/)).toBeTruthy()

    fireEvent.click(within(detalle).getByRole('button', { name: 'Ver el último' }))
    detalle = screen.getByRole('dialog', { name: '🏊 Principal' })
    expect(within(detalle).getByText('2026-10-20 · 08:30')).toBeTruthy()
    expect(within(detalle).getByRole('button', { name: '🔧 Cerrar por mantenimiento' })).toBeTruthy()
    expect(within(detalle).queryByText(/Hay un registro más reciente/)).toBeNull()
  })

  it('con la misma fecha y hora, el último es el que se capturó después', () => {
    render(<ControlPiscinaTab {...props({ registros: [
      registro({ id: 'a', estado: 'abierta', created_at: '2026-10-20T14:31:00Z' }),
      registro({ id: 'b', estado: 'cerrada_incidente', created_at: '2026-10-20T14:35:00Z' }),
    ] })} />)
    expect(screen.getByRole('button', { name: 'Ver último registro de Principal: Cerrada (incidente)' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Principal' }))
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('control_piscina', 'b', { estado: 'abierta' })
  })
})

describe('Piscina — jacuzzi, área, parámetros, fotos y quién registra', () => {
  it('el mismo registro sirve para el jacuzzi: la ventana, el nombre y la tarjeta cambian con el tipo', async () => {
    render(<ControlPiscinaTab {...props({ registros: [...registros, registro({ id: 'j1', tipo: 'jacuzzi', piscina: 'Terraza', ph: 7.6, estado: 'abierta' })] })} />)
    expect(screen.getByRole('button', { name: 'Ver último registro de Terraza: Abierta' }).textContent).toContain('🛁 Terraza')
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'jacuzzi' } })
    const ventana = screen.getByRole('dialog', { name: '🛁 Nuevo registro de jacuzzi' })
    fireEvent.change(within(ventana).getByLabelText('Jacuzzi'), { target: { value: 'Terraza' } })
    expect(within(ventana).getByLabelText('N° usuarios en jacuzzi')).toBeTruthy()
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('control_piscina', expect.objectContaining({ tipo: 'jacuzzi', piscina: 'Terraza' })))
  })

  it('el área se elige de las activas y se propone la del último registro de esa piscina', async () => {
    render(<ControlPiscinaTab {...props({ registros: [registro({ id: 'p1', area_id: 'a-social' }), registro({ id: 'i1', piscina: 'Infantil', area_id: 'a-vieja' })] })} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    const area = screen.getByLabelText('Área') as HTMLSelectElement
    // Al abrir con «Principal», ya viene su área.
    expect(area.value).toBe('a-social')
    expect(Array.from(area.options).map(o => o.textContent)).toEqual(['— Sin área —', '🌴 Área social', '🏢 Azotea'])
    fireEvent.change(area, { target: { value: 'a-azotea' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('control_piscina', expect.objectContaining({ area_id: 'a-azotea' })))
  })

  it('un área inactiva guardada se sigue ofreciendo; sin áreas activas lleva al tab Áreas', () => {
    const onIrATab = vi.fn()
    render(<ControlPiscinaTab {...props({ registros: [registro({ id: 'i1', piscina: 'Infantil', area_id: 'a-vieja' })], areas: areas.filter(a => a.id === 'a-vieja'), puedeConfigurarAreas: true, onIrATab })} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crearlas en el tab Áreas' }))
    expect(onIrATab).toHaveBeenCalledWith('areas_config')
    // El área inactiva no se propone (sólo activas), pero el detalle la muestra.
    fireEvent.click(within(screen.getByRole('dialog')).getByLabelText('Cerrar modal'))
    fireEvent.click(screen.getByRole('button', { name: 'Ver registro de Infantil del 2026-10-20 08:30' }))
    // En el subtítulo y en la fila «Área».
    expect(within(screen.getByRole('dialog')).getAllByText('📍 Terraza vieja').length).toBeGreaterThan(0)
  })

  it('«Registrado por» se propone con el usuario y el cargo de su ficha; se puede cambiar', async () => {
    render(<ControlPiscinaTab {...props({ userId: 'u-ana', autorNombre: 'ana@condominio.com', personal: [empleado({ user_id: 'u-ana' })] })} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    const campo = screen.getByLabelText('Registrado por') as HTMLInputElement
    expect(campo.value).toBe('Ana López — Conserje')
    expect(screen.getByText('Con tu usuario. Cámbialo si lo midió otra persona.')).toBeTruthy()
    fireEvent.change(campo, { target: { value: 'Pedro' } })
    expect(screen.queryByText('Con tu usuario. Cámbialo si lo midió otra persona.')).toBeNull()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('control_piscina', expect.objectContaining({ registrado_por: 'Pedro' })))
  })

  it('sin ficha, propone el nombre de usuario', () => {
    render(<ControlPiscinaTab {...props({ userId: 'u-x', autorNombre: 'Carlos Admin' })} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    expect((screen.getByLabelText('Registrado por') as HTMLInputElement).value).toBe('Carlos Admin')
  })

  it('los parámetros de las tiras se califican con su franja y viajan en el registro', async () => {
    render(<ControlPiscinaTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    const ventana = screen.getByRole('dialog')
    expect(within(ventana).getByText('Ideal 250–500')).toBeTruthy()
    expect(within(ventana).getByText('Piscinas de sal: 2700–3400')).toBeTruthy()
    fireEvent.change(within(ventana).getByLabelText('Bromo (ppm)'), { target: { value: '12' } })
    expect(within(ventana).getByText('Fuera de rango (ideal 2–6)')).toBeTruthy()
    fireEvent.change(within(ventana).getByLabelText('Dureza total (ppm)'), { target: { value: '300' } })
    fireEvent.change(within(ventana).getByLabelText('Alcalinidad total (ppm)'), { target: { value: '100' } })
    fireEvent.change(within(ventana).getByLabelText('Ácido cianúrico (ppm)'), { target: { value: '40' } })
    fireEvent.change(within(ventana).getByLabelText('Cloro total (ppm)'), { target: { value: '2' } })
    fireEvent.change(within(ventana).getByLabelText('Cobre (ppm)'), { target: { value: '0.2' } })
    fireEvent.change(within(ventana).getByLabelText('Sal (ppm)'), { target: { value: '3000' } })
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('control_piscina', expect.objectContaining({
      bromo: 12, dureza_total: 300, alcalinidad_total: 100, acido_cianurico: 40, cloro_total: 2, cobre: 0.2, sal: 3000,
    })))
  })

  it('la tarjeta y el detalle dicen qué quedó fuera de rango; el detalle sólo lista lo medido', () => {
    render(<ControlPiscinaTab {...props({ registros: [registro({ id: 'p1', bromo: 12, dureza_total: 300 })] })} />)
    expect(screen.getByRole('button', { name: /Ver último registro de Principal/ }).textContent).toContain('⚠ Fuera de rango: Bromo')
    fireEvent.click(screen.getByRole('button', { name: 'Ver registro de Principal del 2026-10-20 08:30' }))
    const detalle = screen.getByRole('dialog', { name: '🏊 Principal' })
    expect(within(detalle).getByText('Bromo (ppm)')).toBeTruthy()
    expect(within(detalle).getByText('Fuera de rango · ideal 2–6')).toBeTruthy()
    expect(within(detalle).getByText('Dureza total (ppm)')).toBeTruthy()
    expect(within(detalle).queryByText('Cobre (ppm)')).toBeNull()
  })

  it('las fotos de la muestra, del resultado y del área viajan por separado y el detalle las muestra', async () => {
    render(<ControlPiscinaTab {...props({ registros: [registro({ id: 'p1', fotos_muestra: ['p1/piscina/m.jpg'], fotos_resultado: [], fotos_area: ['p1/piscina/a1.jpg', 'p1/piscina/a2.jpg'] })] })} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo registro' }))
    fireEvent.click(screen.getByRole('button', { name: 'Muestra de agua: agregar (0/2)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Resultado (tira de prueba): agregar (0/2)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Área inspeccionada: agregar (0/4)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Área inspeccionada: agregar (1/4)' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar/ }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('control_piscina', expect.objectContaining({
      fotos_muestra: ['p1/piscina/muestra-1.jpg'], fotos_resultado: ['p1/piscina/resultado-1.jpg'], fotos_area: ['p1/piscina/área-1.jpg', 'p1/piscina/área-2.jpg'],
    })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Ver registro de Principal del 2026-10-20 08:30' }))
    const detalle = screen.getByRole('dialog', { name: '🏊 Principal' })
    expect(within(detalle).getByText('Muestra de agua (1)')).toBeTruthy()
    expect(within(detalle).queryByText(/Resultado \(tira de prueba\) \(/)).toBeNull()
    expect(within(detalle).getByText('Área inspeccionada (2)')).toBeTruthy()
    expect(within(detalle).getAllByRole('list', { name: 'Galería' })).toHaveLength(2)
  })
})
