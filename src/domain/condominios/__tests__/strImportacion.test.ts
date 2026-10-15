// Carga masiva de reservas STR — lado del navegador: la plantilla declara lo que el servidor
// admite, el lector acota filas y la pantalla recibe mensajes sin el prefijo técnico.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: vi.fn() }, warmUpSupabase: vi.fn() }))

import {
  MAX_FILAS_STR, PLANTILLA_RESERVAS_STR, csvPlantillaSTR, leerArchivoReservasSTR,
  mensajeErrorImportacionSTR, totalVistaPrevia,
} from '../strImportacion'
import { validarEncabezados } from '../../proveedores/importacion'

const buf = (t: string) => new TextEncoder().encode(t).buffer as ArrayBuffer

describe('PLANTILLA_RESERVAS_STR', () => {
  it('declara exactamente las columnas que admite el servidor (str_import_evaluar)', () => {
    expect(PLANTILLA_RESERVAS_STR.columnas.map((c) => c.key)).toEqual([
      'unidad', 'huesped_nombre', 'huesped_email', 'huesped_telefono', 'fecha_entrada', 'fecha_salida',
      'hora_llegada_estimada', 'hora_salida_estimada', 'num_adultos', 'num_ninos', 'num_bebes', 'plataforma',
      'codigo_confirmacion', 'fecha_reservacion', 'monto_noche', 'monto_total', 'politica_cancelacion', 'mascotas', 'notas',
    ])
    expect(PLANTILLA_RESERVAS_STR.columnas.filter((c) => c.requerida).map((c) => c.key))
      .toEqual(['unidad', 'huesped_nombre', 'fecha_entrada', 'fecha_salida'])
    // Códigos y teléfonos se leen como texto (Excel no les quita ceros).
    expect(PLANTILLA_RESERVAS_STR.columnas.filter((c) => c.identificador).map((c) => c.key))
      .toEqual(['unidad', 'huesped_telefono', 'codigo_confirmacion'])
  })

  it('el CSV de la plantilla trae el encabezado y dos filas de ejemplo', () => {
    const lineas = csvPlantillaSTR().trim().split(/\r?\n/)
    expect(lineas).toHaveLength(3)
    expect(lineas[0].startsWith('unidad,huesped_nombre,')).toBe(true)
  })

  it('las notas avisan de lo que importa y de lo que no', () => {
    const texto = PLANTILLA_RESERVAS_STR.notas.join(' ')
    expect(texto).toMatch(/nace CONFIRMADA/)
    expect(texto).toMatch(/todo o nada/)
    expect(texto).toMatch(/No se crean unidades/)
    expect(texto).toMatch(new RegExp(`Máximo ${MAX_FILAS_STR} filas`))
  })

  it('faltar una columna obligatoria es error de encabezado; una desconocida solo avisa (el servidor la rechaza)', () => {
    expect(validarEncabezados(PLANTILLA_RESERVAS_STR, ['unidad', 'huesped_nombre', 'fecha_entrada']).errores).toEqual(['Falta la columna obligatoria «fecha_salida».'])
    const r = validarEncabezados(PLANTILLA_RESERVAS_STR, ['unidad', 'huesped_nombre', 'fecha_entrada', 'fecha_salida', 'estado'])
    expect(r.errores).toEqual([])
    expect(r.advertencias[0]).toMatch(/«estado»/)
  })
})

describe('leerArchivoReservasSTR', () => {
  it('lee un CSV con encabezados en español y normaliza las claves', async () => {
    const r = await leerArchivoReservasSTR('r.csv', buf('Unidad,Huésped nombre,Fecha entrada,Fecha salida,Código confirmación\nApto 1A,Ana,2026-12-10,2026-12-12,HM-100\n'))
    expect(r.filas).toEqual([{ unidad: 'Apto 1A', huesped_nombre: 'Ana', fecha_entrada: '2026-12-10', fecha_salida: '2026-12-12', codigo_confirmacion: 'HM-100' }])
  })

  it('rechaza más de 500 filas', async () => {
    const filas = Array.from({ length: MAX_FILAS_STR + 1 }, (_, i) => `Apto ${i},Ana,2026-12-10,2026-12-12`).join('\n')
    await expect(leerArchivoReservasSTR('r.csv', buf(`unidad,huesped_nombre,fecha_entrada,fecha_salida\n${filas}\n`))).rejects.toThrow(/máximo es 500/)
  })

  it('rechaza un libro con macros sin leerlo', async () => {
    await expect(leerArchivoReservasSTR('r.xlsm', buf('x'))).rejects.toThrow(/macros/)
  })
})

describe('mensajes y totales', () => {
  it('quita el prefijo técnico del servidor', () => {
    expect(mensajeErrorImportacionSTR('STR_IMPORT_DUPLICADO: este mismo contenido ya se importó')).toBe('este mismo contenido ya se importó')
    expect(mensajeErrorImportacionSTR('otra cosa')).toBe('otra cosa')
  })
  it('totalVistaPrevia suma solo las filas válidas con monto', () => {
    const d = { monto_total: 200 } as never
    expect(totalVistaPrevia({ filas: [
      { fila: 1, origen: {}, datos: d, errores: [], advertencias: [] },
      { fila: 2, origen: {}, datos: null, errores: [{ campo: 'x', mensaje: 'y' }], advertencias: [] },
      { fila: 3, origen: {}, datos: { monto_total: null } as never, errores: [], advertencias: [] },
    ] })).toBe(200)
    expect(totalVistaPrevia(null)).toBe(0)
  })
})
