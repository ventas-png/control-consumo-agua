// Carga masiva de renglones — lado del NAVEGADOR: plantilla, lectura del archivo y llamadas al
// servidor. Las reglas de validación (insumo, cuenta, unidad, todo o nada, duplicados) las aplica el
// SERVIDOR y se prueban en supabase/tests/compras_bloque_b/assert_importacion_lineas.sql.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc }, warmUpSupabase: vi.fn() }))

import {
  MAX_FILAS_LINEAS,
  PLANTILLA_LINEAS,
  aplicarLineas,
  csvPlantillaLineas,
  leerArchivoLineas,
  previsualizarLineas,
} from '../importacionLineas'
import { ArchivoImportacionError } from '../../proveedores/importacion'

const bytes = (texto: string) => new TextEncoder().encode(texto).buffer as ArrayBuffer

beforeEach(() => rpc.mockReset())

describe('plantilla', () => {
  it('trae las columnas del servidor, con dos filas de ejemplo', () => {
    const csv = csvPlantillaLineas().split('\n').filter(Boolean)
    expect(csv[0].replace(/^\ufeff/, '').replace(/\r$/, '')).toBe('descripcion,destino,insumo,categoria,cantidad,unidad,precio_unitario,iva,cuenta')
    expect(csv).toHaveLength(3)
    expect(PLANTILLA_LINEAS.columnas.filter((c) => c.requerida).map((c) => c.key))
      .toEqual(['descripcion', 'destino', 'cantidad', 'precio_unitario'])
  })

  it('avisa que importar no aprueba, emite, recibe ni contabiliza, ni crea insumos o cuentas', () => {
    const notas = PLANTILLA_LINEAS.notas.join(' ')
    expect(notas).toMatch(/NO aprueba, emite, recibe ni contabiliza/)
    expect(notas).toMatch(/crea proveedores, cuentas ni insumos/)
    expect(notas).toMatch(/todo o nada/)
  })
})

describe('leerArchivoLineas', () => {
  it('lee un CSV y devuelve TEXTO (los ceros a la izquierda no se pierden)', async () => {
    const r = await leerArchivoLineas('r.csv', bytes('descripcion,destino,insumo,cantidad,precio_unitario,cuenta\nCloro,inventario,Cloro,10,12.50,00123\n'))
    expect(r.filas).toEqual([{ descripcion: 'Cloro', destino: 'inventario', insumo: 'Cloro', cantidad: '10', precio_unitario: '12.50', cuenta: '00123' }])
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('normaliza los encabezados («Precio unitario *» → precio_unitario) y avisa de las columnas desconocidas', async () => {
    const r = await leerArchivoLineas('r.csv', bytes('Descripción,Destino,Cantidad,Precio unitario *,proveedor\nCloro,gasto,1,5,Otro\n'))
    expect(r.columnas).toContain('precio_unitario')
    expect(r.advertencias.join(' ')).toMatch(/proveedor/)
  })

  it('exige las columnas obligatorias', async () => {
    await expect(leerArchivoLineas('r.csv', bytes('descripcion,destino\nCloro,gasto\n'))).rejects.toThrow(/cantidad/)
  })

  it('rechaza formatos con macros o binarios, y archivos vacíos', async () => {
    await expect(leerArchivoLineas('r.xlsm', bytes('x'))).rejects.toBeInstanceOf(ArchivoImportacionError)
    await expect(leerArchivoLineas('r.xls', bytes('x'))).rejects.toBeInstanceOf(ArchivoImportacionError)
    await expect(leerArchivoLineas('r.csv', new ArrayBuffer(0))).rejects.toThrow(/vacío/)
  })

  it('rechaza un zip renombrado como CSV', async () => {
    await expect(leerArchivoLineas('r.csv', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]).buffer)).rejects.toThrow(/xlsx/)
  })

  it(`acota a ${MAX_FILAS_LINEAS} filas por carga`, async () => {
    const filas = Array.from({ length: MAX_FILAS_LINEAS + 1 }, (_, i) => `Fila ${i},gasto,1,1`).join('\n')
    await expect(leerArchivoLineas('r.csv', bytes(`descripcion,destino,cantidad,precio_unitario\n${filas}\n`))).rejects.toThrow(/máximo es 500/)
  })

  it('no ejecuta nada: una celda que empieza con = llega como texto y la rechaza el servidor', async () => {
    const r = await leerArchivoLineas('r.csv', bytes('descripcion,destino,cantidad,precio_unitario\n"=SUMA(1,2)",gasto,1,1\n'))
    expect(r.filas[0].descripcion).toBe('=SUMA(1,2)')
  })
})

describe('llamadas al servidor', () => {
  it('previsualiza con la orden, las filas y el nombre del archivo (nada más)', async () => {
    rpc.mockResolvedValue({ data: { lote_id: 'L1', filas: [], resumen: {} }, error: null })
    await previsualizarLineas('o1', [{ descripcion: 'Cloro' }], 'r.csv')
    expect(rpc).toHaveBeenCalledWith('compras_lineas_importar_previsualizar', { p_orden_id: 'o1', p_filas: [{ descripcion: 'Cloro' }], p_archivo: 'r.csv' })
  })

  it('aplica por lote y expone el error del servidor tal cual (todo o nada)', async () => {
    rpc.mockResolvedValueOnce({ data: { renglones_creados: 4 }, error: null })
    await expect(aplicarLineas('L1')).resolves.toEqual({ renglones_creados: 4 })
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'COMPRAS_IMPORT_CON_ERRORES: 2 fila(s) con error' } })
    await expect(aplicarLineas('L1')).rejects.toThrow(/COMPRAS_IMPORT_CON_ERRORES/)
  })
})
