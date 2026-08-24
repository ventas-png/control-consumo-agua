// Pruebas 4-6 del PR de catálogos: crear/editar actividades con sus campos
// nuevos (servicio obligatorio, duración > 0, checklist), asociar insumos y
// herramientas con cantidad (unidad derivada del suministro, nunca capturada),
// duplicados rechazados con mensaje accionable, recursos inactivos señalados
// sin desvincular, y estados de error del fetch de recursos.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type {
  ItemInventario,
  PlantillaTareaCargo,
  PlantillaTareaHerramienta,
  PlantillaTareaSuministro,
  SuministroCondominio,
} from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  updateCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  fetchRecursosPlantillas: vi.fn(async () => ({
    suministros: [] as PlantillaTareaSuministro[],
    herramientas: [] as PlantillaTareaHerramienta[],
    error: null as { message: string } | null,
  })),
  openPromptDialog: vi.fn(async () => null as Record<string, string> | null),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: () => ({}) },
  db: { from: () => ({}) },
}))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchRecursosPlantillas: mocks.fetchRecursosPlantillas,
}))
vi.mock('../../../shared/Dialog', () => ({
  confirm: mocks.confirm,
  notify: mocks.notify,
}))
vi.mock('../../../shared/PromptDialog', () => ({
  openPromptDialog: mocks.openPromptDialog,
}))

const { PlantillasCargoTab } = await import('../PlantillasCargoTab')

function plantilla(over: Partial<PlantillaTareaCargo> = {}): PlantillaTareaCargo {
  return {
    id: 'pl1', company_id: 'co1', project_id: 'p1', cargo: 'conserje',
    titulo: 'Limpiar lobby', descripcion: null, icono: '🧹', orden: 1,
    area_id: null, requiere_foto: false, activo: true,
    created_at: '2026-01-01T00:00:00.000Z',
    servicio: 'limpieza', duracion_estimada_min: 45, checklist: ['Barrer'],
    instrucciones_seguridad: null, requiere_comentario: false, requiere_checklist: false,
    ...over,
  }
}

const suministro = {
  id: 'sum1', company_id: 'co1', project_id: 'p1', nombre: 'Cloro',
  categoria: 'limpieza', unidad_medida: 'litro', stock_actual: 10, stock_minimo: 1,
  activo: true, created_at: '2026-01-01T00:00:00.000Z',
} as SuministroCondominio

const herramienta = {
  id: 'inv1', company_id: 'co1', project_id: 'p1', nombre: 'Hidrolavadora',
  categoria: 'equipo', estado: 'disponible', cantidad: 1, cantidad_minima: 0,
  unidad_medida: 'unidad', created_at: '2026-01-01T00:00:00.000Z',
} as ItemInventario

function vinculoSuministro(over: Partial<PlantillaTareaSuministro> = {}): PlantillaTareaSuministro {
  return {
    id: 'pts1', company_id: 'co1', project_id: 'p1', plantilla_tarea_id: 'pl1',
    suministro_id: 'sum1', cantidad: 0.5, created_at: '2026-01-01T00:00:00.000Z',
    suministro_nombre: 'Cloro', unidad_medida: 'litro', suministro_activo: true,
    ...over,
  }
}

function renderTab(props: Partial<Parameters<typeof PlantillasCargoTab>[0]> = {}) {
  return render(
    <PlantillasCargoTab
      plantillas={[plantilla()]}
      areas={[]}
      suministros={[suministro]}
      inventario={[herramienta]}
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
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.deleteCondominioRow.mockResolvedValue({ error: null })
  mocks.fetchRecursosPlantillas.mockResolvedValue({ suministros: [], herramientas: [], error: null })
  mocks.confirm.mockResolvedValue({ isConfirmed: true })
})

afterEach(() => { cleanup() })

async function esperarRecursos() {
  await waitFor(() => expect(mocks.fetchRecursosPlantillas).toHaveBeenCalled())
}

describe('PlantillasCargoTab — crear y editar actividades', () => {
  it('crea con servicio, duración y checklist en el payload', async () => {
    renderTab()
    await esperarRecursos()
    fireEvent.click(screen.getByText('+ Nueva actividad'))
    fireEvent.change(screen.getByLabelText('Servicio de la actividad'), { target: { value: 'mantenimiento' } })
    fireEvent.change(screen.getByLabelText('Cargo que desempeña la actividad'), { target: { value: 'mantenimiento' } })
    fireEvent.change(screen.getByPlaceholderText(/Ej\. Limpiar lobby/), { target: { value: 'Revisar bomba' } })
    fireEvent.change(screen.getByPlaceholderText('Ej. 45'), { target: { value: '30' } })
    fireEvent.change(screen.getByPlaceholderText('Ej. Barrer y trapear el piso'), { target: { value: 'Cerrar la válvula' } })
    fireEvent.click(screen.getByText('+ Paso'))
    fireEvent.change(screen.getByPlaceholderText(/EPP requerido/), { target: { value: 'Guantes dieléctricos' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('plantillas_tarea_cargo')
    expect(payload).toMatchObject({
      company_id: 'co1', project_id: 'p1',
      servicio: 'mantenimiento', cargo: 'mantenimiento', titulo: 'Revisar bomba',
      duracion_estimada_min: 30, checklist: ['Cerrar la válvula'],
      instrucciones_seguridad: 'Guantes dieléctricos',
    })
  })

  it('sin servicio no guarda: las capturas nuevas van con opciones controladas', async () => {
    renderTab()
    await esperarRecursos()
    fireEvent.click(screen.getByText('+ Nueva actividad'))
    fireEvent.change(screen.getByLabelText('Cargo que desempeña la actividad'), { target: { value: 'conserje' } })
    fireEvent.change(screen.getByPlaceholderText(/Ej\. Limpiar lobby/), { target: { value: 'Trapear' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect((mocks.notify.mock.calls[0][0] as { text: string }).text).toMatch(/servicio/i)
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
  })

  it('la duración 0 o negativa se rechaza en UI (la BD tiene su propio CHECK)', async () => {
    renderTab()
    await esperarRecursos()
    fireEvent.click(screen.getByText('+ Nueva actividad'))
    fireEvent.change(screen.getByLabelText('Servicio de la actividad'), { target: { value: 'limpieza' } })
    fireEvent.change(screen.getByLabelText('Cargo que desempeña la actividad'), { target: { value: 'conserje' } })
    fireEvent.change(screen.getByPlaceholderText(/Ej\. Limpiar lobby/), { target: { value: 'Trapear' } })
    fireEvent.change(screen.getByPlaceholderText('Ej. 45'), { target: { value: '0' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect((mocks.notify.mock.calls[0][0] as { text: string }).text).toMatch(/mayor que cero/)
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
  })

  it('checklist obligatorio sin pasos no guarda', async () => {
    renderTab()
    await esperarRecursos()
    fireEvent.click(screen.getByText('+ Nueva actividad'))
    fireEvent.change(screen.getByLabelText('Servicio de la actividad'), { target: { value: 'limpieza' } })
    fireEvent.change(screen.getByLabelText('Cargo que desempeña la actividad'), { target: { value: 'conserje' } })
    fireEvent.change(screen.getByPlaceholderText(/Ej\. Limpiar lobby/), { target: { value: 'Trapear' } })
    // Con duración: si no, la valida primero la regla de limpieza y el mensaje
    // que se comprueba sería el de duración, no el del checklist.
    fireEvent.change(screen.getByPlaceholderText('Ej. 45'), { target: { value: '20' } })
    fireEvent.click(screen.getByText('☑️ Checklist obligatorio'))
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect((mocks.notify.mock.calls[0][0] as { text: string }).text).toMatch(/checklist/i)
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
  })

  it('actividad NUEVA de limpieza exige duración estimada', async () => {
    renderTab()
    await esperarRecursos()
    fireEvent.click(screen.getByText('+ Nueva actividad'))
    fireEvent.change(screen.getByLabelText('Servicio de la actividad'), { target: { value: 'limpieza' } })
    fireEvent.change(screen.getByLabelText('Cargo que desempeña la actividad'), { target: { value: 'conserje' } })
    fireEvent.change(screen.getByPlaceholderText(/Ej\. Limpiar lobby/), { target: { value: 'Trapear' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect((mocks.notify.mock.calls[0][0] as { text: string }).text).toMatch(/duración estimada/i)
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
  })

  it('el cargo se elige de valores controlados, no es texto libre', async () => {
    renderTab()
    await esperarRecursos()
    fireEvent.click(screen.getByText('+ Nueva actividad'))
    const select = screen.getByLabelText('Cargo que desempeña la actividad') as HTMLSelectElement
    expect(select.tagName).toBe('SELECT')
    expect([...select.options].map(o => o.value)).toEqual([
      '', 'conserje', 'guardia', 'jardinero', 'mantenimiento', 'administrador', 'otro',
    ])
  })

  it('el cargo histórico (texto libre) se conserva como opción al editar', async () => {
    renderTab({ plantillas: [plantilla({ cargo: 'Polivalente' })] })
    await esperarRecursos()
    fireEvent.click(screen.getByText('✏️ Editar'))
    const select = screen.getByLabelText('Cargo que desempeña la actividad') as HTMLSelectElement
    expect(select.value).toBe('Polivalente')
    expect([...select.options].map(o => o.value)).toContain('Polivalente')
  })

  it('canEdit sin canDelete: no se ofrece eliminar la actividad', async () => {
    renderTab({ canDelete: false })
    await esperarRecursos()
    expect(screen.getByText('✏️ Editar')).toBeTruthy()
    expect(screen.getByText('Desactivar')).toBeTruthy()
    expect(screen.queryByLabelText('Eliminar Limpiar lobby')).toBeNull()
  })

  it('editar actualiza la fila con los campos nuevos', async () => {
    renderTab()
    await esperarRecursos()
    fireEvent.click(screen.getByText('✏️ Editar'))
    fireEvent.change(screen.getByPlaceholderText('Ej. 45'), { target: { value: '60' } })
    fireEvent.click(screen.getByText('Actualizar'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, id, patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(tabla).toBe('plantillas_tarea_cargo')
    expect(id).toBe('pl1')
    expect(patch).toMatchObject({ servicio: 'limpieza', duracion_estimada_min: 60, checklist: ['Barrer'] })
  })
})

describe('PlantillasCargoTab — recursos planificados', () => {
  it('agrega un insumo con cantidad; la unidad viene del suministro, no se captura', async () => {
    renderTab()
    await esperarRecursos()
    fireEvent.click(screen.getByLabelText('Recursos de Limpiar lobby'))
    fireEvent.change(screen.getByLabelText('Insumo a agregar'), { target: { value: 'sum1' } })
    fireEvent.change(screen.getByLabelText('Cantidad planificada'), { target: { value: '0.5' } })
    fireEvent.click(screen.getAllByText('Agregar')[0])

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('plantilla_tarea_suministros')
    expect(payload).toMatchObject({ plantilla_tarea_id: 'pl1', suministro_id: 'sum1', cantidad: 0.5 })
    expect('unidad' in payload).toBe(false)
  })

  it('agrega una herramienta con cantidad entera y bandera de obligatoria', async () => {
    renderTab()
    await esperarRecursos()
    fireEvent.click(screen.getByLabelText('Recursos de Limpiar lobby'))
    fireEvent.change(screen.getByLabelText('Herramienta a agregar'), { target: { value: 'inv1' } })
    fireEvent.change(screen.getByLabelText('Cantidad de herramientas'), { target: { value: '2' } })
    fireEvent.click(screen.getAllByText('Obligatoria')[0])
    fireEvent.click(screen.getAllByText('Agregar')[1])

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('plantilla_tarea_herramientas')
    expect(payload).toMatchObject({ plantilla_tarea_id: 'pl1', inventario_id: 'inv1', cantidad: 2, obligatoria: true })
  })

  it('el duplicado (23505) se explica: editar la cantidad, no repetir el recurso', async () => {
    mocks.createCondominioRow.mockResolvedValue({ error: { message: 'duplicate key value', code: '23505' } })
    renderTab()
    await esperarRecursos()
    fireEvent.click(screen.getByLabelText('Recursos de Limpiar lobby'))
    fireEvent.change(screen.getByLabelText('Insumo a agregar'), { target: { value: 'sum1' } })
    fireEvent.click(screen.getAllByText('Agregar')[0])

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect((mocks.notify.mock.calls[0][0] as { text: string }).text).toMatch(/ya está en la actividad/)
  })

  it('cantidad no positiva de insumo se rechaza en UI', async () => {
    renderTab()
    await esperarRecursos()
    fireEvent.click(screen.getByLabelText('Recursos de Limpiar lobby'))
    fireEvent.change(screen.getByLabelText('Insumo a agregar'), { target: { value: 'sum1' } })
    fireEvent.change(screen.getByLabelText('Cantidad planificada'), { target: { value: '0' } })
    fireEvent.click(screen.getAllByText('Agregar')[0])

    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect((mocks.notify.mock.calls[0][0] as { text: string }).text).toMatch(/mayor que cero/)
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
  })

  it('el insumo inactivo vinculado sigue visible y marcado; el resumen lo advierte', async () => {
    mocks.fetchRecursosPlantillas.mockResolvedValue({
      suministros: [vinculoSuministro({ suministro_activo: false })],
      herramientas: [],
      error: null,
    })
    renderTab({ suministros: [{ ...suministro, activo: false } as SuministroCondominio] })
    await waitFor(() => expect(screen.getByText('⚠ Recursos por revisar')).toBeTruthy())

    fireEvent.click(screen.getByLabelText('Recursos de Limpiar lobby'))
    expect(screen.getByText(/⚠ inactivo/)).toBeTruthy()
    // …pero el select de agregar ya no lo ofrece.
    const select = screen.getByLabelText('Insumo a agregar') as HTMLSelectElement
    expect([...select.options].map(o => o.value)).toEqual([''])
  })

  it('el error del fetch de recursos se muestra con reintento, no como "sin recursos"', async () => {
    mocks.fetchRecursosPlantillas.mockResolvedValue({ suministros: [], herramientas: [], error: { message: 'permission denied' } })
    renderTab()
    await waitFor(() => expect(screen.getByText(/No se pudieron cargar los recursos/)).toBeTruthy())
    expect(screen.getByText('Reintentar')).toBeTruthy()
  })
})

describe('PlantillasCargoTab — legados y filtros', () => {
  it('la plantilla sin servicio se señala como sin clasificar', async () => {
    renderTab({ plantillas: [plantilla({ servicio: null, duracion_estimada_min: null, checklist: [] })] })
    await esperarRecursos()
    // Por `title` y no por texto: "⚠ Sin clasificar" también existe como opción
    // del filtro de servicio.
    expect(screen.getByTitle('Registro anterior: edítalo y elegí su servicio.')).toBeTruthy()
  })

  it('el resumen de la tarjeta trae duración y recursos', async () => {
    mocks.fetchRecursosPlantillas.mockResolvedValue({
      suministros: [vinculoSuministro()], herramientas: [], error: null,
    })
    renderTab()
    await waitFor(() => expect(screen.getByText('🧴 1 insumo')).toBeTruthy())
    expect(screen.getByText('⏱ 45 min')).toBeTruthy()
  })

  it('el filtro de estado separa activas de inactivas', async () => {
    renderTab({ plantillas: [plantilla(), plantilla({ id: 'pl2', titulo: 'Actividad retirada', activo: false })] })
    await esperarRecursos()
    fireEvent.change(screen.getByLabelText('Filtrar por estado'), { target: { value: 'activas' } })
    expect(screen.getByText('Limpiar lobby')).toBeTruthy()
    expect(screen.queryByText('Actividad retirada')).toBeNull()
    fireEvent.change(screen.getByLabelText('Filtrar por estado'), { target: { value: 'inactivas' } })
    expect(screen.queryByText('Limpiar lobby')).toBeNull()
    expect(screen.getByText('Actividad retirada')).toBeTruthy()
  })

  it('el filtro "Sin clasificar" aísla los legados', async () => {
    renderTab({ plantillas: [plantilla(), plantilla({ id: 'pl2', titulo: 'Legada', servicio: null })] })
    await esperarRecursos()
    fireEvent.change(screen.getByLabelText('Filtrar por servicio'), { target: { value: 'pendiente' } })
    expect(screen.queryByText('Limpiar lobby')).toBeNull()
    expect(screen.getByText('Legada')).toBeTruthy()
  })
})

describe('PlantillasCargoTab — el borrador no persiste nada a escondidas', () => {
  it('cancelar el formulario no escribe nada (los recursos viven fuera del form)', async () => {
    renderTab()
    await esperarRecursos()
    fireEvent.click(screen.getByText('✏️ Editar'))
    // Se toquetea el borrador: servicio, duración y un paso de checklist.
    fireEvent.change(screen.getByPlaceholderText('Ej. 45'), { target: { value: '99' } })
    fireEvent.change(screen.getByPlaceholderText('Ej. Barrer y trapear el piso'), { target: { value: 'Paso fantasma' } })
    fireEvent.click(screen.getByText('+ Paso'))
    fireEvent.click(screen.getByText('Cancelar'))

    // Nada se guardó: ni la actividad ni ningún recurso.
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
    expect(mocks.deleteCondominioRow).not.toHaveBeenCalled()
  })

  it('el formulario NO ofrece capturar recursos: se gestionan desde la tarjeta', async () => {
    renderTab()
    await esperarRecursos()
    fireEvent.click(screen.getByText('✏️ Editar'))
    expect(screen.queryByLabelText('Insumo a agregar')).toBeNull()
    expect(screen.queryByLabelText('Herramienta a agregar')).toBeNull()
    expect(screen.getByText(/se gestionan desde el botón «Recursos»/)).toBeTruthy()
  })

  it('el panel de recursos avisa que cada cambio se guarda al instante', async () => {
    renderTab()
    await esperarRecursos()
    fireEvent.click(screen.getByLabelText('Recursos de Limpiar lobby'))
    expect(screen.getByText(/se guardan al instante/)).toBeTruthy()
  })
})
