// Tab «Configuración» de Recursos Humanos: los dos catálogos del condominio
// (cargos y tipos de turno), con el código propuesto desde el nombre y
// bloqueado al editar, la validación de duplicados antes de guardar, «en uso: N»
// desde la RPC, eliminar sólo sin uso y el error 23503 traducido.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { CatalogoRrhhItem, UsoCargo, UsoTurno } from '../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  updateCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  fetchUsoCatalogoRrhh: vi.fn(async (_tipo: 'cargo' | 'turno', _p: string, _c: string[]) => new Map<string, UsoCargo | UsoTurno>()),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({}), rpc: () => ({}) },
  db: { from: () => ({}), rpc: () => ({}) },
}))
vi.mock('../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../domain/condominios/tabQueries', () => ({
  fetchUsoCatalogoRrhh: mocks.fetchUsoCatalogoRrhh,
}))
vi.mock('../../shared/Dialog', () => ({
  confirm: mocks.confirm,
  notify: mocks.notify,
}))

const { RrhhConfiguracionTab } = await import('../tabs/RrhhConfiguracionTab')

function item(over: Partial<CatalogoRrhhItem> = {}): CatalogoRrhhItem {
  return {
    id: 'c1', company_id: 'co1', project_id: 'p1', codigo: 'conserje', nombre: 'Conserje',
    descripcion: null, icono: '🧹', orden: 10, activo: true,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}
const cargos = [
  item({ id: 'c1', codigo: 'conserje', nombre: 'Conserje', icono: '🧹', orden: 10 }),
  item({ id: 'c2', codigo: 'jardinero', nombre: 'Jardinero', icono: '🌿', orden: 30 }),
]
const turnos = [
  item({ id: 't1', codigo: 'diurno', nombre: 'Diurno', icono: '☀️', orden: 10 }),
  item({ id: 't2', codigo: 'nocturno', nombre: 'Nocturno', icono: '🌙', orden: 20, activo: false }),
]

function renderTab(props: Partial<Parameters<typeof RrhhConfiguracionTab>[0]> = {}) {
  return render(
    <RrhhConfiguracionTab
      cargos={cargos}
      tiposTurno={turnos}
      proyectoId="p1"
      companyId="co1"
      canCreate
      canEdit
      canDelete
      onRefresh={() => {}}
      {...props}
    />,
  )
}

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockClear())
  mocks.confirm.mockResolvedValue({ isConfirmed: true })
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.deleteCondominioRow.mockResolvedValue({ error: null })
  mocks.fetchUsoCatalogoRrhh.mockImplementation(async (tipo) => {
    const m = new Map<string, UsoCargo | UsoTurno>()
    if (tipo === 'cargo') {
      m.set('conserje', { personal: 2, actividades: 3, programaciones: 0 })
      m.set('jardinero', { personal: 0, actividades: 0, programaciones: 0 })
    } else {
      m.set('diurno', { personal: 2, programaciones: 1, ejecuciones: 4 })
      m.set('nocturno', { personal: 0, programaciones: 0, ejecuciones: 0 })
    }
    return m
  })
})
afterEach(() => { cleanup() })

const tarjeta = (tipo: 'cargo' | 'turno', codigo: string) => screen.getByTestId(`rrhh-${tipo}-${codigo}`)

describe('RrhhConfiguracionTab — los dos catálogos', () => {
  it('lista cargos y tipos de turno con su código, estado y «en uso» de la RPC', async () => {
    renderTab()
    expect(screen.getByText('Configuración de Recursos Humanos')).toBeTruthy()
    expect(screen.getByText('2 cargos (2 activos) · 2 tipos de turno (1 activos) · se configuran una vez y el resto del área los usa')).toBeTruthy()
    await waitFor(() => expect(mocks.fetchUsoCatalogoRrhh).toHaveBeenCalledWith('cargo', 'p1', ['conserje', 'jardinero']))
    await waitFor(() => expect(within(tarjeta('cargo', 'conserje')).getByText(/en uso: 5/)).toBeTruthy())
    expect(within(tarjeta('cargo', 'conserje')).getByText('2 empleado(s) · 3 actividad(es) · 0 programación(es)')).toBeTruthy()
    expect(within(tarjeta('turno', 'nocturno')).getByText(/Inactivo/)).toBeTruthy()
  })

  it('eliminar sólo se ofrece cuando nadie lo usa; en uso queda Desactivar', async () => {
    renderTab()
    await waitFor(() => expect(within(tarjeta('cargo', 'jardinero')).getByText(/en uso: 0/)).toBeTruthy())
    expect(within(tarjeta('cargo', 'jardinero')).queryByLabelText('Eliminar Jardinero')).toBeTruthy()
    expect(within(tarjeta('cargo', 'conserje')).queryByLabelText('Eliminar Conserje')).toBeNull()
    expect(within(tarjeta('cargo', 'conserje')).getByLabelText('Desactivar Conserje')).toBeTruthy()
  })

  it('sin canDelete nunca se ofrece eliminar', async () => {
    renderTab({ canDelete: false })
    await waitFor(() => expect(within(tarjeta('cargo', 'jardinero')).getByText(/en uso: 0/)).toBeTruthy())
    expect(within(tarjeta('cargo', 'jardinero')).queryByLabelText('Eliminar Jardinero')).toBeNull()
  })

  it('crear: el código se propone desde el nombre y se guarda con el proyecto', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Nuevo cargo'))
    const nombre = screen.getByLabelText('Nombre *') as HTMLInputElement
    fireEvent.change(nombre, { target: { value: 'Supervisor de piscina' } })
    const codigo = screen.getByLabelText('Código *') as HTMLInputElement
    expect(codigo.value).toBe('supervisor_de_piscina')
    fireEvent.change(codigo, { target: { value: 'Supervisor_Piscina' } })
    expect(codigo.value).toBe('supervisor_piscina')
    fireEvent.click(screen.getByLabelText('Ícono 🏊'))
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow.mock.calls[0]).toEqual(['rrhh_cargos', {
      nombre: 'Supervisor de piscina', descripcion: null, icono: '🏊', orden: 30, activo: true,
      codigo: 'supervisor_piscina', company_id: 'co1', project_id: 'p1',
    }])
  })

  it('crear: un nombre que ya existe (normalizado) se rechaza antes de guardar', async () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Nuevo cargo'))
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: '  CONSERJE ' } })
    // El código propuesto («conserje») ya existe: se dice primero.
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect((mocks.notify.mock.calls[0][0] as { text: string }).text).toMatch(/Ya existe el código «conserje»/)
    // Con otro código, el nombre normalizado sigue chocando.
    fireEvent.change(screen.getByLabelText('Código *'), { target: { value: 'conserje_2' } })
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(2))
    expect((mocks.notify.mock.calls[1][0] as { text: string }).text).toMatch(/Ya existe «Conserje»/)
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
  })

  it('editar: el código no se puede cambiar y el update no lo manda', async () => {
    renderTab()
    fireEvent.click(within(tarjeta('cargo', 'jardinero')).getByLabelText('Editar Jardinero'))
    const codigo = screen.getByLabelText('Código (no se cambia)') as HTMLInputElement
    expect(codigo.readOnly).toBe(true)
    expect(codigo.value).toBe('jardinero')
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Jardinero/a' } })
    fireEvent.click(screen.getByText('Actualizar'))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, id, patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(tabla).toBe('rrhh_cargos'); expect(id).toBe('c2')
    expect(patch).toMatchObject({ nombre: 'Jardinero/a' })
    expect(patch).not.toHaveProperty('codigo')
  })

  it('desactivar y activar mandan sólo `activo`', async () => {
    renderTab()
    fireEvent.click(within(tarjeta('turno', 'diurno')).getByLabelText('Desactivar Diurno'))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('rrhh_tipos_turno', 't1', { activo: false }))
    fireEvent.click(within(tarjeta('turno', 'nocturno')).getByLabelText('Activar Nocturno'))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('rrhh_tipos_turno', 't2', { activo: true }))
  })

  it('eliminar: confirma, borra, y si la BD dice en uso (23503) lo explica', async () => {
    renderTab()
    await waitFor(() => expect(within(tarjeta('cargo', 'jardinero')).getByText(/en uso: 0/)).toBeTruthy())
    fireEvent.click(within(tarjeta('cargo', 'jardinero')).getByLabelText('Eliminar Jardinero'))
    await waitFor(() => expect(mocks.deleteCondominioRow).toHaveBeenCalledWith('rrhh_cargos', 'c2'))

    mocks.deleteCondominioRow.mockResolvedValueOnce({ error: { code: '23503', message: 'RRHH_CARGO_EN_USO: el cargo "jardinero" lo usan 1 empleado(s), 0 actividad(es) y 0 programación(es): desactívalo en vez de borrarlo' } })
    fireEvent.click(within(tarjeta('cargo', 'jardinero')).getByLabelText('Eliminar Jardinero'))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect((mocks.notify.mock.calls.at(-1)![0] as { title: string; text: string })).toMatchObject({
      title: 'Jardinero está en uso',
      text: expect.stringMatching(/Está en uso: el cargo "jardinero" lo usan 1 empleado/),
    })
  })

  it('sin canCreate ni canEdit: sólo lectura', () => {
    renderTab({ canCreate: false, canEdit: false })
    expect(screen.queryByText('+ Nuevo cargo')).toBeNull()
    expect(screen.queryByText('+ Nuevo tipo de turno')).toBeNull()
    expect(screen.queryByLabelText('Editar Conserje')).toBeNull()
  })

  it('sin catálogo: estado vacío que explica qué crear', () => {
    renderTab({ cargos: [], tiposTurno: [] })
    expect(screen.getByText('Sin cargos definidos')).toBeTruthy()
    expect(screen.getByText('Sin tipos de turno definidos')).toBeTruthy()
  })
})

describe('RrhhConfiguracionTab — buscador y formulario en ventana emergente', () => {
  const buscador = (tipo: 'cargo' | 'tipo de turno') => screen.getByRole('searchbox', { name: `Buscar ${tipo}` })
  const visibles = (tipo: 'cargo' | 'turno', codigos: string[]) => codigos.filter(c => screen.queryByTestId(`rrhh-${tipo}-${c}`))

  it('cada catálogo tiene su buscador: acota por nombre, código o descripción sin acentos y no toca al otro', () => {
    renderTab({ cargos: [...cargos, item({ id: 'c3', codigo: 'recepcion', nombre: 'Recepción', icono: '🛎️', orden: 20, descripcion: 'Atiende la garita' })] })
    expect(visibles('cargo', ['conserje', 'recepcion', 'jardinero'])).toEqual(['conserje', 'recepcion', 'jardinero'])

    fireEvent.change(buscador('cargo'), { target: { value: 'RECEPCION' } })
    expect(visibles('cargo', ['conserje', 'recepcion', 'jardinero'])).toEqual(['recepcion'])
    // Los tipos de turno siguen completos: el buscador es de su catálogo.
    expect(visibles('turno', ['diurno', 'nocturno'])).toEqual(['diurno', 'nocturno'])
    // Por descripción y por código.
    fireEvent.change(buscador('cargo'), { target: { value: 'garita' } })
    expect(visibles('cargo', ['conserje', 'recepcion', 'jardinero'])).toEqual(['recepcion'])
    fireEvent.change(buscador('cargo'), { target: { value: 'jardin' } })
    expect(visibles('cargo', ['conserje', 'recepcion', 'jardinero'])).toEqual(['jardinero'])

    fireEvent.change(buscador('cargo'), { target: { value: 'zzz' } })
    expect(visibles('cargo', ['conserje', 'recepcion', 'jardinero'])).toEqual([])
    expect(screen.getByText('Ningún cargo coincide con «zzz»')).toBeTruthy()
    // Los contadores de la cabecera siguen siendo del catálogo completo.
    expect(screen.getByText(/^3 cargos \(3 activos\)/)).toBeTruthy()

    fireEvent.change(buscador('tipo de turno'), { target: { value: 'noct' } })
    expect(visibles('turno', ['diurno', 'nocturno'])).toEqual(['nocturno'])
    fireEvent.change(buscador('cargo'), { target: { value: '' } })
    expect(visibles('cargo', ['conserje', 'recepcion', 'jardinero'])).toEqual(['conserje', 'recepcion', 'jardinero'])
  })

  it('sin catálogo no hay buscador; en consulta sí lo hay aunque no haya «+ Nuevo»', () => {
    renderTab({ cargos: [], tiposTurno: [] })
    expect(screen.queryByRole('searchbox', { name: 'Buscar cargo' })).toBeNull()
    cleanup()
    renderTab({ canCreate: false, canEdit: false })
    expect(screen.queryByText('+ Nuevo cargo')).toBeNull()
    expect(buscador('cargo')).toBeTruthy()
  })

  it('+ Nuevo abre un diálogo con el formulario en blanco; Cancelar descarta el borrador y el botón sigue a la vista', () => {
    renderTab()
    fireEvent.click(screen.getByText('+ Nuevo tipo de turno'))
    const ventana = screen.getByRole('dialog', { name: 'Nuevo tipo de turno' })
    expect((within(ventana).getByLabelText('Nombre *') as HTMLInputElement).value).toBe('')
    expect(screen.getByText('+ Nuevo tipo de turno')).toBeTruthy()
    expect(screen.getByTestId('rrhh-turno-diurno')).toBeTruthy()
    fireEvent.change(within(ventana).getByLabelText('Nombre *'), { target: { value: 'Madrugada' } })
    expect((within(ventana).getByLabelText('Código *') as HTMLInputElement).value).toBe('madrugada')
    fireEvent.click(within(ventana).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('+ Nuevo tipo de turno'))
    expect((screen.getByLabelText('Nombre *') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Código *') as HTMLInputElement).value).toBe('')
  })

  it('Editar abre el diálogo con los datos y Escape lo cierra sin guardar', () => {
    renderTab()
    fireEvent.click(within(tarjeta('cargo', 'conserje')).getByLabelText('Editar Conserje'))
    const ventana = screen.getByRole('dialog', { name: 'Editar cargo' })
    expect((within(ventana).getByLabelText('Nombre *') as HTMLInputElement).value).toBe('Conserje')
    expect((within(ventana).getByLabelText('Código (no se cambia)') as HTMLInputElement).readOnly).toBe(true)
    expect(within(ventana).getByRole('group', { name: 'Ícono' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('Guardar cierra la ventana y refresca', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByText('+ Nuevo cargo'))
    const ventana = screen.getByRole('dialog', { name: 'Nuevo cargo' })
    fireEvent.change(within(ventana).getByLabelText('Nombre *'), { target: { value: 'Recepcionista' } })
    fireEvent.click(within(ventana).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})
