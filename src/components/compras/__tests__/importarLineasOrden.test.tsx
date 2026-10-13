// Carga masiva de renglones — lo que una persona VE y puede hacer: vista previa con errores por
// fila, el botón de guardar bloqueado mientras haya errores (todo o nada), confirmación antes de
// guardar y que el doble clic no duplique. Las reglas las aplica el servidor
// (supabase/tests/compras_bloque_b/assert_importacion_lineas.sql).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const m = vi.hoisted(() => ({ rpc: vi.fn(), confirm: vi.fn(), notify: vi.fn() }))
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: m.rpc }, warmUpSupabase: vi.fn() }))
vi.mock('../../shared/Dialog', () => ({ confirm: m.confirm, notify: m.notify }))

import { ImportarLineasOrdenModal } from '../ImportarLineasOrdenModal'

const CSV = 'descripcion,destino,insumo,cantidad,precio_unitario\nCloro,inventario,Cloro,10,12.50\nFantasma,inventario,Nada,1,1\n'
const archivo = (texto: string, nombre = 'r.csv') => {
  const f = new File([texto], nombre, { type: 'text/csv' })
  Object.defineProperty(f, 'arrayBuffer', { value: async () => new TextEncoder().encode(texto).buffer })
  return f
}
const fila = (n: number, datos: unknown, errores: { campo: string; mensaje: string }[] = [], origen: Record<string, string> = {}) =>
  ({ fila: n, origen, datos, errores, advertencias: [] })
const datos = { descripcion: 'Cloro', destino_tipo: 'inventario', suministro_id: 's1', categoria: 'limpieza', cantidad: 10, unidad: 'litro', precio_unitario: 12.5, iva_monto: 0, cuenta_id: null }

function vista(conError: number) {
  return {
    lote_id: 'L1', orden_compra_id: 'o1',
    resumen: { total: 2, validas: 2 - conError, con_error: conError, duplicado_de_lote_aplicado: false },
    filas: [
      fila(1, datos, [], { insumo: 'Cloro' }),
      conError ? fila(2, null, [{ campo: 'insumo', mensaje: 'El insumo «Nada» no existe (la importación no crea insumos).' }], { descripcion: 'Fantasma', destino: 'inventario', insumo: 'Nada' })
               : fila(2, { ...datos, descripcion: 'Otro' }, [], { insumo: 'Cloro' }),
    ],
  }
}

function abrir() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={qc}>
      <ImportarLineasOrdenModal orden={{ id: 'o1', numero: 'OC-000001', concepto: 'Cloro' }} monedaBase="GTQ" onClose={onClose} />
    </QueryClientProvider>,
  )
  return { onClose }
}
async function subir(texto = CSV) {
  fireEvent.change(screen.getByLabelText('Archivo de renglones'), { target: { files: [archivo(texto)] } })
  await screen.findByLabelText('Vista previa de la importación')
}

// confirm() devuelve Promise<{ isConfirmed }>, no un booleano: un mock `true` escondía que «Cancelar» nunca frenaba (un objeto siempre es verdadero).
beforeEach(() => { m.confirm.mockResolvedValue({ isConfirmed: true }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Importar renglones a una orden en borrador', () => {
  it('explica antes de empezar que no aprueba, emite, recibe ni contabiliza, ni crea insumos', () => {
    abrir()
    expect(screen.getByText(/NO aprueba, emite, recibe ni contabiliza/)).toBeTruthy()
    expect(screen.getByText(/crea proveedores, cuentas ni insumos/)).toBeTruthy()
    expect(screen.getByText('Descargar CSV')).toBeTruthy()
    expect(screen.getByText('Descargar XLSX')).toBeTruthy()
  })

  it('con errores por fila: los muestra en su fila y NO deja guardar (todo o nada)', async () => {
    m.rpc.mockResolvedValueOnce({ data: vista(1), error: null })
    abrir()
    await subir()
    expect(m.rpc).toHaveBeenCalledWith('compras_lineas_importar_previsualizar', expect.objectContaining({ p_orden_id: 'o1', p_archivo: 'r.csv' }))
    const f2 = screen.getByTestId('fila-2')
    expect(f2.getAttribute('data-estado')).toBe('error')
    expect(within(f2).getByText(/no crea insumos/)).toBeTruthy()
    expect(screen.getByTestId('fila-1').getAttribute('data-estado')).toBe('ok')
    expect(screen.getByText('1 fila(s) con error')).toBeTruthy()
    const guardar = screen.getByRole('button', { name: /Confirmar y guardar/ }) as HTMLButtonElement
    expect(guardar.disabled).toBe(true)
    // «Solo filas con error» filtra la vista
    fireEvent.click(screen.getByLabelText('Solo filas con error'))
    expect(screen.queryByTestId('fila-1')).toBeNull()
    expect(screen.getByTestId('fila-2')).toBeTruthy()
  })

  it('sin errores: pide confirmación, guarda UNA vez aunque se dé doble clic y cierra', async () => {
    m.rpc.mockResolvedValueOnce({ data: vista(0), error: null })
    let resolver: (v: unknown) => void = () => {}
    m.rpc.mockImplementationOnce(() => new Promise((r) => { resolver = r }))
    const { onClose } = abrir()
    await subir()
    const guardar = screen.getByRole('button', { name: /Confirmar y guardar 2 renglones/ }) as HTMLButtonElement
    expect(guardar.disabled).toBe(false)
    fireEvent.click(guardar)
    fireEvent.click(guardar)
    await waitFor(() => expect(m.confirm).toHaveBeenCalled())
    expect(m.confirm.mock.calls[0][0].text).toMatch(/La orden sigue en borrador: no se aprueba, emite, recibe ni contabiliza nada/)
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('compras_lineas_importar_aplicar', { p_lote_id: 'L1' }))
    resolver({ data: { lote_id: 'L1', orden_compra_id: 'o1', renglones_creados: 2, linea_ids: ['a', 'b'], reutilizada: false }, error: null })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const aplicaciones = m.rpc.mock.calls.filter((c) => c[0] === 'compras_lineas_importar_aplicar')
    expect(aplicaciones).toHaveLength(1)
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', text: expect.stringMatching(/2 renglones agregados/) }))
  })

  it('«Cancelar» en la confirmación NO guarda nada: ni llama a aplicar, ni cierra, ni avisa', async () => {
    m.rpc.mockResolvedValueOnce({ data: vista(0), error: null })
    m.confirm.mockResolvedValueOnce({ isConfirmed: false })
    const { onClose } = abrir()
    await subir()
    fireEvent.click(screen.getByRole('button', { name: /Confirmar y guardar 2 renglones/ }))
    await waitFor(() => expect(m.confirm).toHaveBeenCalledTimes(1))
    // un tick más para asegurar que nada se encadenó tras el diálogo
    await Promise.resolve(); await Promise.resolve()
    expect(m.rpc.mock.calls.filter((c) => c[0] === 'compras_lineas_importar_aplicar')).toHaveLength(0)
    expect(onClose).not.toHaveBeenCalled()
    expect(m.notify).not.toHaveBeenCalled()
    // sigue en la vista previa y se puede volver a intentar: confirmar ahora sí guarda
    m.rpc.mockResolvedValueOnce({ data: { lote_id: 'L1', orden_compra_id: 'o1', renglones_creados: 2, linea_ids: ['a', 'b'], reutilizada: false }, error: null })
    fireEvent.click(screen.getByRole('button', { name: /Confirmar y guardar 2 renglones/ }))
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('compras_lineas_importar_aplicar', { p_lote_id: 'L1' }))
  })

  it('si el servidor rechaza al aplicar, lo dice y no cierra (no se guardó nada)', async () => {
    m.rpc.mockResolvedValueOnce({ data: vista(0), error: null })
    m.rpc.mockResolvedValueOnce({ data: null, error: { message: 'COMPRAS_IMPORT_DUPLICADO: este mismo contenido ya se importó' } })
    const { onClose } = abrir()
    await subir()
    fireEvent.click(screen.getByRole('button', { name: /Confirmar y guardar/ }))
    await waitFor(() => expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', title: 'No se guardó nada' })))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('un contenido ya importado a esta orden no se puede volver a guardar', async () => {
    const v = vista(0)
    v.resumen.duplicado_de_lote_aplicado = true
    m.rpc.mockResolvedValueOnce({ data: v, error: null })
    abrir()
    await subir()
    expect(screen.getByText(/ya se importó a esta orden/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /Confirmar y guardar/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('un archivo inválido se explica y no llega al servidor', async () => {
    abrir()
    fireEvent.change(screen.getByLabelText('Archivo de renglones'), { target: { files: [archivo('x', 'r.xlsm')] } })
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
    expect(m.rpc).toHaveBeenCalledWith('compras_lineas_importar_descartar', { p_lote_id: 'L1' })
  })
})
