// Carga masiva de reservas STR — lo que una persona VE y puede hacer: vista previa con errores
// por fila, guardar bloqueado mientras haya errores (todo o nada), confirmación antes de guardar,
// doble clic sin duplicar y cancelar descarta el lote. Las reglas las aplica el servidor
// (supabase/tests/str_importacion/assert.sql).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const m = vi.hoisted(() => ({ rpc: vi.fn(), confirm: vi.fn(), notify: vi.fn() }))
vi.mock('../../../../lib/supabase', () => ({ supabase: { rpc: m.rpc }, warmUpSupabase: vi.fn() }))
vi.mock('../../../shared/Dialog', () => ({ confirm: m.confirm, notify: m.notify }))

import { ImportarReservasSTRModal } from '../ImportarReservasSTRModal'

const CSV = 'unidad,huesped_nombre,fecha_entrada,fecha_salida,codigo_confirmacion\nApto 1A,Ana,2026-12-10,2026-12-12,HM-100\nNada,Beto,2026-12-10,2026-12-12,\n'
const archivo = (texto: string, nombre = 'r.csv') => {
  const f = new File([texto], nombre, { type: 'text/csv' })
  Object.defineProperty(f, 'arrayBuffer', { value: async () => new TextEncoder().encode(texto).buffer })
  return f
}
const datos = {
  unidad_id: 'u1', unidad: 'Apto 1A', huesped_nombre: 'Ana', huesped_email: null, huesped_telefono: null,
  fecha_entrada: '2026-12-10', fecha_salida: '2026-12-12', noches: 2, hora_llegada_estimada: null, hora_salida_estimada: null,
  num_adultos: 1, num_ninos: 0, num_bebes: 0, plataforma: 'airbnb', codigo_confirmacion: 'HM-100', fecha_reservacion: null,
  monto_noche: 100, monto_total: 200, politica_cancelacion: 'na', mascotas: false, notas: null, estado: 'confirmada',
}
const fila = (n: number, d: unknown, errores: { campo: string; mensaje: string }[] = [], advertencias: { campo: string; mensaje: string }[] = [], origen: Record<string, string> = {}) =>
  ({ fila: n, origen, datos: d, errores, advertencias })

function vista(conError: number) {
  return {
    lote_id: 'L1', project_id: 'p1',
    resumen: { total: 2, validas: 2 - conError, con_error: conError, duplicado_de_lote_aplicado: false },
    filas: [
      fila(1, datos, [], [{ campo: 'fecha_entrada', mensaje: 'Se solapa con otra reserva no cancelada de la misma unidad.' }], { unidad: 'Apto 1A' }),
      conError ? fila(2, null, [{ campo: 'unidad', mensaje: 'La unidad «Nada» no existe (o está inactiva) en este proyecto. La importación no crea unidades.' }], [], { unidad: 'Nada', huesped_nombre: 'Beto' })
               : fila(2, { ...datos, huesped_nombre: 'Beto', codigo_confirmacion: null, monto_total: null }, [], [], { unidad: 'Apto 1A' }),
    ],
  }
}

function abrir() {
  const onClose = vi.fn()
  const onImportado = vi.fn()
  render(<ImportarReservasSTRModal proyectoId="p1" proyectoNombre="Torre Norte" moneda="GTQ" onClose={onClose} onImportado={onImportado} />)
  return { onClose, onImportado }
}
async function subir(texto = CSV) {
  fireEvent.change(screen.getByLabelText('Archivo de reservas'), { target: { files: [archivo(texto)] } })
  await screen.findByLabelText('Vista previa de la importación')
}

beforeEach(() => { m.confirm.mockResolvedValue({ isConfirmed: true }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Carga masiva de reservas STR', () => {
  it('explica antes de empezar qué hace y qué no, y ofrece la plantilla', () => {
    abrir()
    expect(screen.getByText(/nace CONFIRMADA/)).toBeTruthy()
    expect(screen.getByText(/No se crean unidades/)).toBeTruthy()
    expect(screen.getByText('Descargar CSV')).toBeTruthy()
    expect(screen.getByText('Descargar XLSX')).toBeTruthy()
  })

  it('con errores por fila: los muestra en su fila, enseña los avisos y NO deja guardar (todo o nada)', async () => {
    m.rpc.mockResolvedValueOnce({ data: vista(1), error: null })
    abrir()
    await subir()
    expect(m.rpc).toHaveBeenCalledWith('str_reservas_importar_previsualizar', expect.objectContaining({ p_project_id: 'p1', p_archivo: 'r.csv' }))
    const f2 = screen.getByTestId('fila-2')
    expect(f2.getAttribute('data-estado')).toBe('error')
    expect(within(f2).getByText(/no crea unidades/)).toBeTruthy()
    const f1 = screen.getByTestId('fila-1')
    expect(f1.getAttribute('data-estado')).toBe('ok')
    expect(within(f1).getByText(/Se solapa/)).toBeTruthy()
    expect(within(f1).getByText('Con aviso')).toBeTruthy()
    expect(screen.getByText('1 fila(s) con error')).toBeTruthy()
    const guardar = screen.getByRole('button', { name: /Confirmar y guardar/ }) as HTMLButtonElement
    expect(guardar.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Solo filas con error'))
    expect(screen.queryByTestId('fila-1')).toBeNull()
    expect(screen.getByTestId('fila-2')).toBeTruthy()
  })

  it('sin errores: pide confirmación, guarda UNA vez aunque se dé doble clic, recarga y cierra', async () => {
    m.rpc.mockResolvedValueOnce({ data: vista(0), error: null })
    let resolver: (v: unknown) => void = () => {}
    m.rpc.mockImplementationOnce(() => new Promise((r) => { resolver = r }))
    const { onClose, onImportado } = abrir()
    await subir()
    const guardar = screen.getByRole('button', { name: /Confirmar y guardar 2 reservas/ }) as HTMLButtonElement
    expect(guardar.disabled).toBe(false)
    fireEvent.click(guardar)
    fireEvent.click(guardar)
    await waitFor(() => expect(m.confirm).toHaveBeenCalled())
    expect(m.confirm.mock.calls[0][0].text).toMatch(/Se crearán 2 reservas confirmadas en Torre Norte \(total GTQ 200\.00\)/)
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('str_reservas_importar_aplicar', { p_lote_id: 'L1' }))
    resolver({ data: { lote_id: 'L1', project_id: 'p1', reservas_creadas: 2, reserva_ids: ['a', 'b'], reutilizada: false }, error: null })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(m.rpc.mock.calls.filter((c) => c[0] === 'str_reservas_importar_aplicar')).toHaveLength(1)
    expect(onImportado).toHaveBeenCalledTimes(1)
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', text: expect.stringMatching(/2 reservas creadas/) }))
    // al cerrar tras guardar NO se descarta el lote
    expect(m.rpc.mock.calls.filter((c) => c[0] === 'str_reservas_importar_descartar')).toHaveLength(0)
  })

  it('«Cancelar» en la confirmación no guarda nada y permite reintentar', async () => {
    m.rpc.mockResolvedValueOnce({ data: vista(0), error: null })
    m.confirm.mockResolvedValueOnce({ isConfirmed: false })
    const { onClose } = abrir()
    await subir()
    fireEvent.click(screen.getByRole('button', { name: /Confirmar y guardar 2 reservas/ }))
    await waitFor(() => expect(m.confirm).toHaveBeenCalledTimes(1))
    await Promise.resolve(); await Promise.resolve()
    expect(m.rpc.mock.calls.filter((c) => c[0] === 'str_reservas_importar_aplicar')).toHaveLength(0)
    expect(onClose).not.toHaveBeenCalled()
    m.rpc.mockResolvedValueOnce({ data: { lote_id: 'L1', project_id: 'p1', reservas_creadas: 2, reserva_ids: ['a', 'b'], reutilizada: false }, error: null })
    fireEvent.click(screen.getByRole('button', { name: /Confirmar y guardar 2 reservas/ }))
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('str_reservas_importar_aplicar', { p_lote_id: 'L1' }))
  })

  it('si el servidor rechaza al aplicar, lo dice sin el prefijo técnico y no cierra', async () => {
    m.rpc.mockResolvedValueOnce({ data: vista(0), error: null })
    m.rpc.mockResolvedValueOnce({ data: null, error: { message: 'STR_IMPORT_CON_ERRORES: 1 fila(s) con error; la carga es todo o nada' } })
    const { onClose } = abrir()
    await subir()
    fireEvent.click(screen.getByRole('button', { name: /Confirmar y guardar/ }))
    await waitFor(() => expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', title: 'No se guardó nada', text: '1 fila(s) con error; la carga es todo o nada' })))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('un contenido ya importado a este proyecto no se puede volver a guardar', async () => {
    const v = vista(0)
    v.resumen.duplicado_de_lote_aplicado = true
    m.rpc.mockResolvedValueOnce({ data: v, error: null })
    abrir()
    await subir()
    expect(screen.getByText(/ya se importó a este proyecto/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /Confirmar y guardar/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('un archivo inválido se explica y no llega al servidor', async () => {
    abrir()
    fireEvent.change(screen.getByLabelText('Archivo de reservas'), { target: { files: [archivo('x', 'r.xlsm')] } })
    await screen.findByText(/macros/)
    expect(m.rpc).not.toHaveBeenCalled()
  })

  it('cancelar descarta el lote sin aplicar', async () => {
    m.rpc.mockResolvedValueOnce({ data: vista(1), error: null })
    m.rpc.mockResolvedValueOnce({ data: { lote_id: 'L1', estado: 'descartado' }, error: null })
    const { onClose } = abrir()
    await subir()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(m.rpc).toHaveBeenCalledWith('str_reservas_importar_descartar', { p_lote_id: 'L1' })
  })
})
