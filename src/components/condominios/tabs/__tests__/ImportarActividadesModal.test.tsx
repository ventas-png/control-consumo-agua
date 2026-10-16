// Carga masiva de actividades — lo que una persona VE y puede hacer: vista previa con errores
// por fila, guardar bloqueado mientras haya errores (todo o nada), confirmación antes de guardar,
// doble clic sin duplicar y cancelar descarta el lote. Las reglas las aplica el servidor
// (supabase/tests/plantillas_importacion/assert.sql).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const m = vi.hoisted(() => ({ rpc: vi.fn(), confirm: vi.fn(), notify: vi.fn() }))
vi.mock('../../../../lib/supabase', () => ({ supabase: { rpc: m.rpc }, warmUpSupabase: vi.fn() }))
vi.mock('../../../shared/Dialog', () => ({ confirm: m.confirm, notify: m.notify }))

import { ImportarActividadesModal } from '../ImportarActividadesModal'

const CSV = 'titulo,cargo,servicio,duracion_min,insumos,equipo\nBarrido,conserje,limpieza,15,Escoba; Bolsa x 3,Hidrolavadora!\nPoda,jardinero,jardineria,,Nada,\n'
const archivo = (texto: string, nombre = 'a.csv') => {
  const f = new File([texto], nombre, { type: 'text/csv' })
  Object.defineProperty(f, 'arrayBuffer', { value: async () => new TextEncoder().encode(texto).buffer })
  return f
}
const datos = {
  titulo: 'Barrido', cargo: 'conserje', servicio: 'limpieza', descripcion: null, instrucciones_seguridad: null,
  duracion_estimada_min: 15, icono: '🧹', area: null, area_id: null, orden: 0,
  requiere_foto: false, requiere_comentario: false, requiere_checklist: true, checklist: ['Barrer', 'Recoger'],
  recursos: {
    suministros: [{ id: 's1', nombre: 'Escoba', cantidad: 1 }, { id: 's2', nombre: 'Bolsa', cantidad: 3 }],
    inventario: [{ id: 'i1', nombre: 'Hidrolavadora', categoria: 'equipo', cantidad: 1, obligatoria: true }],
  },
  n_recursos: 3,
}
const fila = (n: number, d: unknown, errores: { campo: string; mensaje: string }[] = [], origen: Record<string, string> = {}) =>
  ({ fila: n, origen, datos: d, errores, advertencias: [] })

function vista(conError: number) {
  return {
    lote_id: 'L1', project_id: 'p1',
    resumen: { total: 2, validas: 2 - conError, con_error: conError, duplicado_de_lote_aplicado: false },
    filas: [
      fila(1, datos, [], { titulo: 'Barrido' }),
      conError
        ? fila(2, null, [{ campo: 'insumos', mensaje: 'El insumo «Nada» no existe (o está inactivo) en este proyecto. La importación no crea insumos.' }], { titulo: 'Poda', cargo: 'jardinero', insumos: 'Nada' })
        : fila(2, { ...datos, titulo: 'Poda', cargo: 'jardinero', servicio: 'jardineria', recursos: { suministros: [], inventario: [] }, n_recursos: 0, requiere_checklist: false, checklist: [] }, [], { titulo: 'Poda' }),
    ],
  }
}

function abrir() {
  const onClose = vi.fn()
  const onImportado = vi.fn()
  render(<ImportarActividadesModal proyectoId="p1" proyectoNombre="Torre Norte" onClose={onClose} onImportado={onImportado} />)
  return { onClose, onImportado }
}
async function subir(texto = CSV) {
  fireEvent.change(screen.getByLabelText('Archivo de actividades'), { target: { files: [archivo(texto)] } })
  await screen.findByLabelText('Vista previa de la importación')
}

beforeEach(() => { m.confirm.mockResolvedValue({ isConfirmed: true }) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Carga masiva de actividades', () => {
  it('explica antes de empezar qué hace y qué no, y ofrece la plantilla', () => {
    abrir()
    expect(screen.getByText(/nace ACTIVA/)).toBeTruthy()
    expect(screen.getByText(/No se crean recursos/)).toBeTruthy()
    expect(screen.getByText('Descargar CSV')).toBeTruthy()
    expect(screen.getByText('Descargar XLSX')).toBeTruthy()
  })

  it('con errores por fila: los muestra en su fila, enseña los recursos resueltos y NO deja guardar (todo o nada)', async () => {
    m.rpc.mockResolvedValueOnce({ data: vista(1), error: null })
    abrir()
    await subir()
    expect(m.rpc).toHaveBeenCalledWith('plantillas_importar_previsualizar', expect.objectContaining({
      p_project_id: 'p1', p_archivo: 'a.csv',
      p_filas: [
        { titulo: 'Barrido', cargo: 'conserje', servicio: 'limpieza', duracion_min: '15', insumos: 'Escoba; Bolsa x 3', equipo: 'Hidrolavadora!' },
        { titulo: 'Poda', cargo: 'jardinero', servicio: 'jardineria', duracion_min: '', insumos: 'Nada', equipo: '' },
      ],
    }))
    const f2 = screen.getByTestId('fila-2')
    expect(f2.getAttribute('data-estado')).toBe('error')
    expect(within(f2).getByText(/no crea insumos/)).toBeTruthy()
    const f1 = screen.getByTestId('fila-1')
    expect(f1.getAttribute('data-estado')).toBe('ok')
    expect(within(f1).getByText(/Bolsa ×3/)).toBeTruthy()
    expect(within(f1).getByText(/Hidrolavadora ×1 \(obligatoria\)/)).toBeTruthy()
    expect(within(f1).getByText(/2 pasos/)).toBeTruthy()
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
    const guardar = screen.getByRole('button', { name: /Confirmar y guardar 2 actividades/ }) as HTMLButtonElement
    expect(guardar.disabled).toBe(false)
    fireEvent.click(guardar)
    fireEvent.click(guardar)
    await waitFor(() => expect(m.confirm).toHaveBeenCalled())
    expect(m.confirm.mock.calls[0][0].text).toMatch(/Se crearán 2 actividades en Torre Norte con 3 recursos vinculados/)
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('plantillas_importar_aplicar', { p_lote_id: 'L1' }))
    resolver({ data: { lote_id: 'L1', project_id: 'p1', actividades_creadas: 2, plantilla_ids: ['a', 'b'], insumos_vinculados: 2, herramientas_vinculadas: 1, reutilizada: false }, error: null })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(m.rpc.mock.calls.filter((c) => c[0] === 'plantillas_importar_aplicar')).toHaveLength(1)
    expect(onImportado).toHaveBeenCalledTimes(1)
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', text: expect.stringMatching(/2 actividades creadas \(2 insumos y 1 herramientas\/equipos vinculados\)/) }))
    expect(m.rpc.mock.calls.filter((c) => c[0] === 'plantillas_importar_descartar')).toHaveLength(0)
  })

  it('si el servidor rechaza al aplicar, lo dice sin el prefijo técnico y no cierra', async () => {
    m.rpc.mockResolvedValueOnce({ data: vista(0), error: null })
    m.rpc.mockResolvedValueOnce({ data: null, error: { message: 'PLANTILLAS_IMPORT_CON_ERRORES: 1 fila(s) con error; la carga es todo o nada' } })
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
    fireEvent.change(screen.getByLabelText('Archivo de actividades'), { target: { files: [archivo('x', 'a.xlsm')] } })
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
    expect(m.rpc).toHaveBeenCalledWith('plantillas_importar_descartar', { p_lote_id: 'L1' })
  })
})
