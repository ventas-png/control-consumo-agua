import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { Asamblea, Unidad, EscrutinioAsamblea, PadronAsamblea, AsistenciaAsamblea } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRowAfectando: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  upsertCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  fetchPuntosAsambleaConVotos: vi.fn(async () => [
    {
      id: 'pt1', asamblea_id: 'a1', orden: 1, titulo: 'Aprobar presupuesto', descripcion: null, tipo: 'votacion',
      votos_asamblea: [{ id: 'v1', punto_id: 'pt1', unidad_id: 'u1', voto: 'a_favor', unidades: { nombre: 'Casa 1' } }],
    },
  ] as Record<string, unknown>[]),
  fetchPadronAsamblea: vi.fn(async (): Promise<PadronAsamblea[]> => []),
  fetchAsistenciaAsamblea: vi.fn(async (): Promise<AsistenciaAsamblea[]> => []),
  fetchEscrutinioAsamblea: vi.fn(async (): Promise<EscrutinioAsamblea | null> => null),
  removeCondominiosMedia: vi.fn(async () => ({ error: null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRowAfectando: mocks.deleteCondominioRowAfectando,
  upsertCondominioRow: mocks.upsertCondominioRow,
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchPuntosAsambleaConVotos: mocks.fetchPuntosAsambleaConVotos,
  fetchPadronAsamblea: mocks.fetchPadronAsamblea,
  fetchAsistenciaAsamblea: mocks.fetchAsistenciaAsamblea,
  fetchEscrutinioAsamblea: mocks.fetchEscrutinioAsamblea,
}))
vi.mock('../../../../domain/shared/storage', () => ({ removeCondominiosMedia: mocks.removeCondominiosMedia }))
// El uploader real sube a storage; aquí «sube» un path del condominio.
vi.mock('../../../shared/FileUploader', () => ({
  FileUploader: ({ onChange, label }: { onChange: (path: string | null) => void; label: string }) =>
    <button type="button" onClick={() => onChange('p1/asambleas/poderes/carta.pdf')}>{label}</button>,
}))
vi.mock('../../../shared/SecureFileLink', () => ({
  SecureFileLink: ({ src, children }: { src: string; children: React.ReactNode }) => <a href={`#${src}`}>{children}</a>,
}))
vi.mock('../../../../lib/toast', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: vi.fn() }))

const { AsambleasTab } = await import('../AsambleasTab')

const unidades = [
  { id: 'u1', nombre: 'Casa 1', activo: true },
  { id: 'u2', nombre: 'Casa 2', activo: true },
] as unknown as Unidad[]

function asamblea(over: Partial<Asamblea> = {}): Asamblea {
  return {
    id: 'a1', company_id: 'co1', project_id: 'p1', titulo: 'Asamblea Ordinaria Abril', tipo: 'ordinaria',
    fecha: '2026-04-20', hora_inicio: '18:00', lugar: 'Salón social', estado: 'en_curso',
    quorum_requerido: 50, created_at: '2026-04-01T10:00:00Z',
    ...over,
  } as unknown as Asamblea
}

const asambleas = [
  asamblea(),
  asamblea({ id: 'a2', titulo: 'Asamblea Extraordinaria Mayo', estado: 'finalizada', acta: 'Se aprobó la pintura.' }),
]

function renderTab(props: Partial<Parameters<typeof AsambleasTab>[0]> = {}) {
  return render(
    <AsambleasTab asambleas={asambleas} unidades={unidades} proyectoId="p1" companyId="co1" userId="user1"
      canCreate canEdit canDelete onRefresh={() => {}} {...props} />,
  )
}

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockClear())
  // Por omisión, sin padrón, asistencia ni escrutinio (como una programada o
  // una lectura degradada): cada prueba de la Fase 2 pone los suyos.
  mocks.fetchPadronAsamblea.mockReset().mockResolvedValue([])
  mocks.fetchAsistenciaAsamblea.mockReset().mockResolvedValue([])
  mocks.fetchEscrutinioAsamblea.mockReset().mockResolvedValue(null)
})
afterEach(cleanup)

describe('AsambleasTab — ventanas', () => {
  it('cada asamblea abre su agenda en ventana (pantalla completa en el teléfono) y Escape la cierra', async () => {
    renderTab()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Asamblea Ordinaria Abril/ }))

    const dialog = screen.getByRole('dialog', { name: 'Asamblea Ordinaria Abril' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(mocks.fetchPuntosAsambleaConVotos).toHaveBeenCalledWith('a1')
    expect(await within(dialog).findByText('Aprobar presupuesto')).toBeTruthy()
    expect(within(dialog).getByText('A favor: 1')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('registrar un voto por unidad desde la ventana guarda y recarga la agenda', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /^Asamblea Ordinaria Abril/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(await within(dialog).findByRole('button', { name: 'En contra — Casa 2' }))
    await waitFor(() => expect(mocks.upsertCondominioRow).toHaveBeenCalledWith('votos_asamblea', {
      punto_id: 'pt1', unidad_id: 'u2', voto: 'en_contra', registrado_por: 'user1',
    }, 'punto_id,unidad_id'))
    await waitFor(() => expect(mocks.fetchPuntosAsambleaConVotos).toHaveBeenCalledTimes(2))
  })

  it('un voto rechazado por el servidor se avisa y no recarga como si se hubiera guardado', async () => {
    mocks.upsertCondominioRow.mockResolvedValueOnce({ error: { message: 'new row violates row-level security policy', code: '42501' } })
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /^Asamblea Ordinaria Abril/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(await within(dialog).findByRole('button', { name: 'En contra — Casa 2' }))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      'No se registró el voto: new row violates row-level security policy'))
    expect(mocks.fetchPuntosAsambleaConVotos).toHaveBeenCalledTimes(1)
  })

  it('"+ Punto" al pie abre el subformulario y agregar crea el punto', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /^Asamblea Ordinaria Abril/ }))
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByText('Aprobar presupuesto')
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Punto' }))
    fireEvent.change(within(dialog).getByLabelText('Título del punto'), { target: { value: 'Varios' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Agregar' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('puntos_asamblea', expect.objectContaining({
      asamblea_id: 'a1', orden: 2, titulo: 'Varios', tipo: 'informativo',
    })))
  })

  it('el formulario de convocatoria es una ventana y convocar crea la asamblea', async () => {
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: '+ Convocar asamblea' }))
    const dialog = screen.getByRole('dialog', { name: 'Convocar asamblea' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(within(dialog).getByLabelText('Título *'), { target: { value: 'Asamblea Junio' } })
    fireEvent.change(within(dialog).getByLabelText('Fecha *'), { target: { value: '2026-06-10' } })
    fireEvent.change(within(dialog).getByLabelText('Hora inicio *'), { target: { value: '19:00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '📅 Convocar' }))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('asambleas', expect.objectContaining({
      titulo: 'Asamblea Junio', fecha: '2026-06-10', hora_inicio: '19:00', estado: 'programada', convocado_por: 'user1',
    })))
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Asamblea convocada')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('cerrar con Escape mientras se escribe el acta la guarda igual', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /^Asamblea Extraordinaria Mayo/ }))
    const dialog = screen.getByRole('dialog', { name: 'Asamblea Extraordinaria Mayo' })
    const acta = within(dialog).getByLabelText('📝 Acta de la asamblea') as HTMLTextAreaElement
    acta.focus()
    fireEvent.change(acta, { target: { value: 'Se aprobó la pintura y el portón.' } })

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('asambleas', 'a2', { acta: 'Se aprobó la pintura y el portón.' }))
  })

  it('sin permiso de edición la agenda es de solo lectura', async () => {
    renderTab({ canCreate: false, canEdit: false })
    expect(screen.queryByRole('button', { name: '+ Convocar asamblea' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: /Estado de/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Asamblea Ordinaria Abril/ }))
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByText('Aprobar presupuesto')
    expect(within(dialog).queryByRole('button', { name: '+ Punto' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /Casa 2/ })).toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: /^Asamblea Extraordinaria Mayo/ }))
    const finalizada = screen.getByRole('dialog', { name: 'Asamblea Extraordinaria Mayo' })
    await within(finalizada).findByText('Aprobar presupuesto')
    expect(within(finalizada).getByText('Se aprobó la pintura.')).toBeTruthy()
    expect(within(finalizada).queryByLabelText('📝 Acta de la asamblea')).toBeNull()
  })

  it('eliminar exige su propio permiso: editar no basta', async () => {
    renderTab({ canDelete: false })
    expect(screen.getAllByRole('combobox', { name: /Estado de/ }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /^Eliminar / })).toBeNull()
    cleanup()

    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Asamblea Ordinaria Abril' }))
    await waitFor(() => expect(mocks.deleteCondominioRowAfectando).toHaveBeenCalledWith('asambleas', 'a1'))
  })

  it('con permiso de eliminar, aunque no edite, borra la asamblea', async () => {
    renderTab({ canEdit: false })
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Asamblea Ordinaria Abril' }))
    await waitFor(() => expect(mocks.deleteCondominioRowAfectando).toHaveBeenCalledWith('asambleas', 'a1'))
  })

  it('el estado sólo ofrece las transiciones que la base acepta; finalizada y cancelada no cambian', () => {
    renderTab({ asambleas: [
      asamblea({ id: 'p', titulo: 'Programada', estado: 'programada' }),
      asamblea({ id: 'c', titulo: 'En curso', estado: 'en_curso' }),
      asamblea({ id: 'f', titulo: 'Finalizada', estado: 'finalizada' }),
      asamblea({ id: 'x', titulo: 'Cancelada', estado: 'cancelada' }),
    ] })
    const opciones = (titulo: string) =>
      within(screen.getByRole('combobox', { name: `Estado de ${titulo}` })).getAllByRole('option').map(o => o.textContent)
    expect(opciones('Programada')).toEqual(['Programada', 'En curso', 'Cancelada'])
    expect(opciones('En curso')).toEqual(['En curso', 'Finalizada', 'Cancelada'])
    expect(screen.queryByRole('combobox', { name: 'Estado de Finalizada' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Estado de Cancelada' })).toBeNull()
  })

  it('un cambio de estado rechazado por la base se avisa y no recarga', async () => {
    mocks.updateCondominioRow.mockResolvedValueOnce({ error: { message: 'ASAMBLEA_TRANSICION: una asamblea en_curso no puede pasar a programada' } } as never)
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.change(screen.getByRole('combobox', { name: 'Estado de Asamblea Ordinaria Abril' }), { target: { value: 'finalizada' } })
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      'No se cambió el estado: ASAMBLEA_TRANSICION: una asamblea en_curso no puede pasar a programada'))
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('asambleas', 'a1', { estado: 'finalizada' })
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('un acta que la base no guarda se avisa y no recarga', async () => {
    mocks.updateCondominioRow.mockResolvedValueOnce({ error: { message: 'permission denied for table asambleas' } } as never)
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: /^Asamblea Extraordinaria Mayo/ }))
    const acta = within(screen.getByRole('dialog')).getByLabelText('📝 Acta de la asamblea')
    fireEvent.change(acta, { target: { value: 'Acta corregida' } })
    fireEvent.blur(acta)
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('No se guardó el acta: permission denied for table asambleas'))
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('con la asamblea finalizada la agenda ya no recibe puntos', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /^Asamblea Extraordinaria Mayo/ }))
    const finalizada = screen.getByRole('dialog', { name: 'Asamblea Extraordinaria Mayo' })
    await within(finalizada).findByText('Aprobar presupuesto')
    expect(within(finalizada).queryByRole('button', { name: '+ Punto' })).toBeNull()
    expect(within(finalizada).getByLabelText('📝 Acta de la asamblea')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: /^Asamblea Ordinaria Abril/ }))
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '+ Punto' })).toBeTruthy()
  })

  it('si la base no borra (la RLS lo rechaza), avisa y no da la asamblea por eliminada', async () => {
    mocks.deleteCondominioRowAfectando.mockResolvedValueOnce({ error: { message: 'El servidor no aplicó el cambio', code: 'SIN_FILAS' } })
    const onRefresh = vi.fn()
    renderTab({ onRefresh })
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Asamblea Ordinaria Abril' }))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('El servidor no aplicó el cambio'))
    expect(onRefresh).not.toHaveBeenCalled()
  })
})

// ── Fase 2: padrón, asistencia, mayoría y escrutinio ─────────────────────────
function escrutinio(over: Partial<EscrutinioAsamblea> = {}): EscrutinioAsamblea {
  const cero = { unidades: 0, peso: 0 }
  return {
    base: 'unidad', padron: { unidades: 2, peso: 2 }, presentes: { unidades: 1, peso: 1 },
    quorum_pct: 50, quorum_requerido: 50, hay_quorum: true,
    puntos: [{ punto_id: 'pt1', titulo: 'Aprobar presupuesto', mayoria: 'simple', mayoria_pct: null,
      a_favor: { unidades: 1, peso: 1 }, en_contra: cero, abstencion: cero, decision: 'aprobado' }],
    ...over,
  }
}

const padronCur: PadronAsamblea[] = [
  { asamblea_id: 'a1', unidad_id: 'u1', unidad_nombre: 'Casa 1', peso: 1 },
  { asamblea_id: 'a1', unidad_id: 'u3', unidad_nombre: 'Casa 3', peso: 1 },
]

function asistencia(over: Partial<AsistenciaAsamblea> = {}): AsistenciaAsamblea {
  return { id: 's1', asamblea_id: 'a1', unidad_id: 'u3', modalidad: 'virtual', apoderado_nombre: null,
    poder_documento: null, registrado_por: 'user1', created_at: '2026-04-20T18:05:00Z', ...over }
}

async function abrirEnCurso() {
  renderTab()
  fireEvent.click(screen.getByRole('button', { name: /^Asamblea Ordinaria Abril/ }))
  const dialog = screen.getByRole('dialog')
  await within(dialog).findByText('Aprobar presupuesto')
  return dialog
}

describe('AsambleasTab — quórum y resultados', () => {
  it('un punto de votación lleva su regla de mayoría; la calificada, su porcentaje', async () => {
    const dialog = await abrirEnCurso()
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Punto' }))
    fireEvent.change(within(dialog).getByLabelText('Título del punto'), { target: { value: 'Reforma de estatutos' } })
    expect(within(dialog).queryByLabelText('Mayoría')).toBeNull()
    fireEvent.change(within(dialog).getByLabelText('Tipo de punto'), { target: { value: 'votacion' } })
    fireEvent.change(within(dialog).getByLabelText('Mayoría'), { target: { value: 'calificada' } })

    fireEvent.change(within(dialog).getByLabelText('Porcentaje del padrón'), { target: { value: '50' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Agregar' }))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('La mayoría calificada va de más del 50 % hasta el 100 % del padrón.'))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText('Porcentaje del padrón'), { target: { value: '75' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Agregar' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('puntos_asamblea', expect.objectContaining({
      titulo: 'Reforma de estatutos', tipo: 'votacion', mayoria: 'calificada', mayoria_pct: 75,
    })))
  })

  it('un punto que no es de votación queda con mayoría simple y sin porcentaje', async () => {
    const dialog = await abrirEnCurso()
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Punto' }))
    fireEvent.change(within(dialog).getByLabelText('Título del punto'), { target: { value: 'Informe' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Agregar' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('puntos_asamblea', expect.objectContaining({
      tipo: 'informativo', mayoria: 'simple', mayoria_pct: null,
    })))
  })

  it('en curso: muestra el quórum de la base y vota el padrón, no las unidades de hoy', async () => {
    mocks.fetchPadronAsamblea.mockResolvedValue(padronCur)
    mocks.fetchEscrutinioAsamblea.mockResolvedValue(escrutinio())
    const dialog = await abrirEnCurso()
    expect(mocks.fetchEscrutinioAsamblea).toHaveBeenCalledWith('a1')
    const quorum = within(dialog).getByRole('region', { name: 'Quórum' })
    expect(within(quorum).getByText('Presentes 1 de 2 (50 %)')).toBeTruthy()
    expect(within(quorum).getByText('Hay quórum')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'A favor — Casa 3' })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'A favor — Casa 2' })).toBeNull()
    expect(within(dialog).getByText('Total: 1/2')).toBeTruthy()
  })

  it('registra la asistencia presencial; quien ya votó figura presente sin registrarla', async () => {
    mocks.fetchPadronAsamblea.mockResolvedValue(padronCur)
    const dialog = await abrirEnCurso()
    expect(within(dialog).getByText('Votó (presente)')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Presencial — Casa 1' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Presencial — Casa 3' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('asistencia_asamblea', {
      asamblea_id: 'a1', unidad_id: 'u3', modalidad: 'presencial', apoderado_nombre: null, poder_documento: null, registrado_por: 'user1',
    }))
    await waitFor(() => expect(mocks.fetchPuntosAsambleaConVotos).toHaveBeenCalledTimes(2))
  })

  it('por poder: exige apoderado y documento; cancelar borra el documento subido', async () => {
    mocks.fetchPadronAsamblea.mockResolvedValue(padronCur)
    const dialog = await abrirEnCurso()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Por poder — Casa 3' }))
    const guardar = within(dialog).getByRole('button', { name: 'Guardar poder' }) as HTMLButtonElement
    expect(guardar.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('Apoderado de Casa 3'), { target: { value: 'Juana Pérez' } })
    expect(guardar.disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Documento del poder' }))
    expect(guardar.disabled).toBe(false)
    fireEvent.click(guardar)
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledWith('asistencia_asamblea', expect.objectContaining({
      unidad_id: 'u3', modalidad: 'poder', apoderado_nombre: 'Juana Pérez', poder_documento: 'p1/asambleas/poderes/carta.pdf',
    })))
    await waitFor(() => expect(within(dialog).queryByRole('button', { name: 'Guardar poder' })).toBeNull())

    fireEvent.click(within(dialog).getByRole('button', { name: 'Por poder — Casa 3' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Documento del poder' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar poder' }))
    expect(mocks.removeCondominiosMedia).toHaveBeenCalledWith(['p1/asambleas/poderes/carta.pdf'])
  })

  it('una asistencia que la base rechaza se avisa y el poder sigue abierto', async () => {
    mocks.fetchPadronAsamblea.mockResolvedValue(padronCur)
    mocks.createCondominioRow.mockResolvedValueOnce({ error: { message: 'ASAMBLEA_PADRON: la unidad no está en el padrón de esta asamblea' } } as never)
    const dialog = await abrirEnCurso()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Por poder — Casa 3' }))
    fireEvent.change(within(dialog).getByLabelText('Apoderado de Casa 3'), { target: { value: 'Juana Pérez' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Documento del poder' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar poder' }))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(
      'No se registró la asistencia: ASAMBLEA_PADRON: la unidad no está en el padrón de esta asamblea'))
    expect(within(dialog).getByRole('button', { name: 'Guardar poder' })).toBeTruthy()
  })

  it('quita una asistencia mal registrada', async () => {
    mocks.fetchPadronAsamblea.mockResolvedValue(padronCur)
    mocks.fetchAsistenciaAsamblea.mockResolvedValue([asistencia({ modalidad: 'poder', apoderado_nombre: 'Juana Pérez', poder_documento: 'p1/asambleas/poderes/carta.pdf' })])
    const dialog = await abrirEnCurso()
    expect(within(dialog).getByText('Por poder: Juana Pérez')).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'Ver poder' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Quitar asistencia — Casa 3' }))
    await waitFor(() => expect(mocks.deleteCondominioRowAfectando).toHaveBeenCalledWith('asistencia_asamblea', 's1'))
  })

  it('finalizada: el resultado y el conteo ponderado son los que escribió la base, sin botones', async () => {
    mocks.fetchPadronAsamblea.mockResolvedValue([
      { asamblea_id: 'a2', unidad_id: 'u1', unidad_nombre: 'Local 1', peso: 40 },
      { asamblea_id: 'a2', unidad_id: 'u3', unidad_nombre: 'Local 3', peso: 20 },
    ])
    mocks.fetchAsistenciaAsamblea.mockResolvedValue([asistencia({ asamblea_id: 'a2', modalidad: 'presencial' })])
    mocks.fetchEscrutinioAsamblea.mockResolvedValue(escrutinio({
      base: 'alicuota', padron: { unidades: 2, peso: 60 }, presentes: { unidades: 2, peso: 60 }, quorum_pct: 100,
      puntos: [{ punto_id: 'pt1', titulo: 'Aprobar presupuesto', mayoria: 'simple', mayoria_pct: null,
        a_favor: { unidades: 1, peso: 20 }, en_contra: { unidades: 1, peso: 40 }, abstencion: { unidades: 0, peso: 0 }, decision: 'rechazado' }],
    }))
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /^Asamblea Extraordinaria Mayo/ }))
    const dialog = screen.getByRole('dialog', { name: 'Asamblea Extraordinaria Mayo' })
    expect(await within(dialog).findByText('Rechazado')).toBeTruthy()
    expect(within(dialog).getByText('A favor: 1 · 20 %')).toBeTruthy()
    expect(within(dialog).getByText('En contra: 1 · 40 %')).toBeTruthy()
    expect(within(dialog).getByText('Presentes 2 de 2 · 100 % de las alícuotas')).toBeTruthy()
    expect(within(dialog).getByText('Presencial')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: /Quitar asistencia/ })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /A favor —/ })).toBeNull()
  })

  it('programada: no pide padrón, asistencia ni escrutinio', async () => {
    renderTab({ asambleas: [asamblea({ estado: 'programada' })] })
    fireEvent.click(screen.getByRole('button', { name: /^Asamblea Ordinaria Abril/ }))
    await within(screen.getByRole('dialog')).findByText('Aprobar presupuesto')
    expect(mocks.fetchPadronAsamblea).not.toHaveBeenCalled()
    expect(mocks.fetchEscrutinioAsamblea).not.toHaveBeenCalled()
  })

  it('la lista muestra el quórum alcanzado de una finalizada contra el requerido', () => {
    renderTab({ asambleas: [asamblea({ estado: 'finalizada', quorum_alcanzado: 63.16 })] })
    expect(screen.getByText('Quórum: 63.16 % de 50 %')).toBeTruthy()
    cleanup()
    renderTab({ asambleas: [asamblea({ estado: 'programada' })] })
    expect(screen.getByText('Quórum requerido: 50 %')).toBeTruthy()
  })
})
