// Carga masiva de lecturas: los botones están donde se buscan (Historial de
// Lecturas y Nueva Lectura), el preview dice cómo quedaría cada lectura antes
// de mandar nada, cada fila entra por registrar_lectura en orden, y el
// resultado dice cuáles no entraron y deja bajarlas para corregirlas.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ComponentProps } from 'react'
import type { Cliente, Contador, Proyecto, Registro, Tarifa, Unidad } from '../../../types'

const h = vi.hoisted(() => ({
  registrarLectura: vi.fn(),
  fetchHistorialLecturasProyecto: vi.fn(),
  writeXlsx: vi.fn(async () => {}),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../shared/Dialog', () => ({ notify: vi.fn(), confirm: vi.fn(async () => ({ isConfirmed: false })) }))
vi.mock('../../shared/PromptDialog', () => ({ openPromptDialog: vi.fn() }))
vi.mock('../../shared/PermissionsContext', () => ({
  usePermissionsContext: () => ({ canEdit: () => true, canDelete: () => true, canCreate: () => true }),
}))
vi.mock('../../shared/SessionContext', () => ({
  useSession: () => ({ user_id: 'u1', role: 'admin', company_id: 'co1', name: 'Admin', email: 'admin@x.com' }),
}))
vi.mock('../../../domain/agua/mutations', () => ({
  registrarLectura: h.registrarLectura,
  uploadRegistroFoto: vi.fn(),
  cambiarEstadoRegistro: vi.fn(),
  deleteRegistro: vi.fn(),
}))
vi.mock('../../../domain/agua/historialLecturas', () => ({
  fetchHistorialLecturasProyecto: h.fetchHistorialLecturasProyecto,
  fetchHistorialLecturas: vi.fn(async () => []),
  importarHistorialLecturas: vi.fn(),
}))
vi.mock('../../../domain/agua/queries', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchRegistroFoto: vi.fn(async () => null),
}))
vi.mock('../../../domain/rutas/mutations', () => ({ completeRelevantOcurrencia: vi.fn(), markRutaCompletada: vi.fn() }))
vi.mock('../../../lib/nativeGeo', () => ({ watchLocation: () => () => {} }))
vi.mock('../../../lib/platform', () => ({ isNative: () => false }))
vi.mock('../../../lib/xlsx', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  writeXlsx: h.writeXlsx,
}))

const { HistorialSection } = await import('../../historial/HistorialSection')
const { LecturasSection } = await import('../LecturasSection')

const proyectos = [
  { id: 'p1', nombre: 'Viñas del Sur', company_id: 'co1' },
  { id: 'p2', nombre: 'Edificio SQ', company_id: 'co1' },
] as unknown as Proyecto[]
const tarifas = [
  { id: 't1', nombre: 'Residencial', activa: true, precio_m3: 5, precio_m3_exceso: 0, canon_fijo: 0, consumo_minimo: 0 },
] as unknown as Tarifa[]
const contadores = [
  { id: 'c1', numero_serie: '21B-001', project_id: 'p1', activo: true, tarifa_id: 't1', lectura_inicial: 100, tipo_agua: 'potable' },
  { id: 'c2', numero_serie: '21B-002', project_id: 'p1', activo: true, tarifa_id: 't1', lectura_inicial: 0, tipo_agua: 'potable' },
  { id: 'c9', numero_serie: 'SQ-001', project_id: 'p2', activo: true, tarifa_id: 't1', lectura_inicial: 0, tipo_agua: 'potable' },
] as unknown as Contador[]
const registros = [
  {
    id: 'r0', contador_id: 'c1', project_id: 'p1', cliente_nombre: 'Ana', fecha: '2026-10-31T18:00:00+00:00',
    lectura_anterior: 120, lectura_actual: 130, consumo: 10, monto_calculado: 50, estado: 'pendiente', created_at: '2026-10-31T19:00:00Z',
  },
] as unknown as Registro[]

const CSV = [
  'contador,fecha,lectura,notas',
  '21B-001,,150,Fin de mes',
  '21B-001,2026-11-15,140,',
  '21B-002,15/11/2026,20,',
  'X-9,2026-11-15,5,',
].join('\n')

function subirCsv(dialog: HTMLElement, texto: string) {
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File([texto], 'lecturas.csv', { type: 'text/csv' })] } })
}

function renderHistorial(props: Partial<ComponentProps<typeof HistorialSection>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onRegistroAdded = vi.fn()
  render(
    <QueryClientProvider client={qc}>
      <HistorialSection
        registros={registros} clientes={[] as Cliente[]} proyectos={proyectos} contadores={contadores} tarifas={tarifas}
        userRole="admin" moneda="Q" onEstadoUpdated={() => {}} canCargarLecturas
        onRegistroAdded={onRegistroAdded} onContadorUpdated={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { onRegistroAdded }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-17T15:00:00'))
  Object.values(h).forEach(m => m.mockReset())
  // c2 consumía 2 m³ al mes según el historial importado.
  h.fetchHistorialLecturasProyecto.mockResolvedValue([
    { id: 'h1', contador_id: 'c2', project_id: 'p1', fecha: '2026-09-30', lectura: null, consumo: 2, notas: null },
    { id: 'h2', contador_id: 'c2', project_id: 'p1', fecha: '2026-10-31', lectura: null, consumo: 2, notas: null },
  ])
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Historial de Lecturas — botones de importación', () => {
  it('con permiso muestra «Carga masiva» e «Importar historial»; sin permiso, no', () => {
    renderHistorial()
    expect(screen.getByRole('button', { name: /Carga masiva/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Importar historial/ })).toBeTruthy()
    cleanup()
    renderHistorial({ canCargarLecturas: false })
    expect(screen.queryByRole('button', { name: /Carga masiva/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Importar historial/ })).toBeNull()
  })

  it('«Importar historial» abre la importación de referencia (no genera cobros)', async () => {
    renderHistorial()
    fireEvent.click(screen.getByRole('button', { name: /Importar historial/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Importar lecturas históricas desde Excel' })
    expect(within(dialog).getByText(/no genera cobros/)).toBeTruthy()
  })
})

describe('Carga masiva de lecturas', () => {
  it('valida contra el proyecto elegido, muestra cómo quedaría, registra en orden y reporta lo que no entró', async () => {
    h.registrarLectura.mockImplementation(async (c: { contadorId: string; lecturaActual: number }) =>
      c.contadorId === 'c2'
        ? { data: null, error: 'la tarifa del contador no está vigente', duplicado: false }
        : { data: { id: `nuevo-${c.lecturaActual}`, contador_id: c.contadorId, consumo: 10, monto_calculado: 50 }, error: null, duplicado: false })
    const { onRegistroAdded } = renderHistorial()

    fireEvent.click(screen.getByRole('button', { name: /Carga masiva/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Importar lecturas desde Excel' })
    expect(within(dialog).getByText(/genera su cobro/)).toBeTruthy()

    // Sin proyecto todavía: nada es válido.
    subirCsv(dialog, CSV)
    expect(await within(dialog).findByText(/0 válidas, 4 con errores/)).toBeTruthy()

    // Al elegir el proyecto se vuelve a validar lo que ya se subió.
    fireEvent.change(within(dialog).getByLabelText('Proyecto *'), { target: { value: 'p1' } })
    expect(await within(dialog).findByText(/3 válidas, 1 con error/)).toBeTruthy()
    expect(within(dialog).getByText(/el contador «X-9» no existe en el proyecto elegido/)).toBeTruthy()

    const preview = await within(dialog).findByTestId('carga-masiva-preview')
    expect(preview.textContent).toContain('Se registrarán 3 lecturas de 2 contadores')
    expect(preview.textContent).toMatch(/40\.00 m³/)
    expect(preview.textContent).toMatch(/200\.00/)
    // La de c2 se dispara contra su promedio del historial importado.
    await waitFor(() => expect(preview.textContent).toContain('10× su promedio (2 m³)'))
    expect(preview.textContent).toContain('1 con aviso')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Importar 3 lecturas' }))
    const resultado = await within(dialog).findByTestId('carga-masiva-resultado')

    // c1: la del 15 primero (140) y después la de la fecha por defecto (150, hoy).
    const llamadasC1 = h.registrarLectura.mock.calls.map(([c]) => c).filter(c => c.contadorId === 'c1')
    expect(llamadasC1.map(c => [c.lecturaActual, c.fecha, c.notas])).toEqual([
      [140, '2026-11-15', null],
      [150, '2026-11-17', 'Fin de mes'],
    ])
    expect(typeof llamadasC1[0].idempotencyKey).toBe('string')
    expect(llamadasC1[0].idempotencyKey).not.toBe(llamadasC1[1].idempotencyKey)

    expect(resultado.textContent).toContain('2 registradas')
    expect(resultado.textContent).toContain('1 rechazada por el sistema')
    expect(resultado.textContent).toContain('Fila 4 · 21B-002')
    expect(resultado.textContent).toContain('la tarifa del contador no está vigente')
    expect(onRegistroAdded).toHaveBeenCalledTimes(2)

    fireEvent.click(within(dialog).getByRole('button', { name: /Descargar las que no entraron/ }))
    expect(h.writeXlsx).toHaveBeenCalledWith('lecturas_no_registradas', [expect.objectContaining({
      rows: [
        ['contador', 'fecha', 'lectura', 'notas', 'motivo_error'],
        ['21B-002', '2026-11-15', 20, '', 'la tarifa del contador no está vigente'],
      ],
    })])
  })

  it('el proyecto filtrado en el Historial se propone como destino', async () => {
    renderHistorial()
    fireEvent.click(screen.getByRole('button', { name: /Filtros/ }))
    fireEvent.change(screen.getByDisplayValue('Todos los Proyectos'), { target: { value: 'p2' } })
    fireEvent.click(screen.getByRole('button', { name: /Carga masiva/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Importar lecturas desde Excel' })
    expect((within(dialog).getByLabelText('Proyecto *') as HTMLSelectElement).value).toBe('p2')
    await waitFor(() => expect(h.fetchHistorialLecturasProyecto).toHaveBeenCalledWith('p2'))
  })
})

describe('Nueva Lectura — botón de carga masiva', () => {
  it('está junto a «Ingreso de Lectura» y abre la carga masiva', async () => {
    render(
      <LecturasSection
        clientes={[] as Cliente[]} unidades={[] as Unidad[]} contadores={contadores} registros={registros}
        tarifas={tarifas} proyectos={proyectos} onRegistroAdded={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Carga masiva \(Excel\)/ }))
    expect(await screen.findByRole('dialog', { name: 'Importar lecturas desde Excel' })).toBeTruthy()
  })

  it('sin proyectos no se ofrece', () => {
    render(
      <LecturasSection
        clientes={[] as Cliente[]} unidades={[] as Unidad[]} contadores={contadores} registros={registros}
        tarifas={tarifas} onRegistroAdded={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /Carga masiva/ })).toBeNull()
  })
})
