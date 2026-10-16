// Carga masiva de actividades — lado del navegador: la plantilla declara lo que el servidor
// admite, el lector acota filas y la pantalla recibe mensajes sin el prefijo técnico.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: vi.fn() }, warmUpSupabase: vi.fn() }))

import {
  MAX_FILAS_ACTIVIDADES, PLANTILLA_ACTIVIDADES, csvPlantillaActividades, leerArchivoActividades,
  mensajeErrorImportacionActividades, totalRecursosVistaPrevia,
} from '../plantillasImportacion'
import { validarEncabezados } from '../../proveedores/importacion'

const buf = (t: string) => new TextEncoder().encode(t).buffer as ArrayBuffer

describe('PLANTILLA_ACTIVIDADES', () => {
  it('declara exactamente las columnas que admite el servidor (plantillas_import_evaluar)', () => {
    expect(PLANTILLA_ACTIVIDADES.columnas.map((c) => c.key)).toEqual([
      'titulo', 'cargo', 'servicio', 'descripcion', 'instrucciones_seguridad', 'duracion_min', 'icono', 'area', 'orden',
      'requiere_foto', 'requiere_comentario', 'requiere_checklist', 'checklist', 'insumos', 'herramientas', 'equipo',
    ])
    expect(PLANTILLA_ACTIVIDADES.columnas.filter((c) => c.requerida).map((c) => c.key)).toEqual(['titulo', 'cargo', 'servicio'])
  })

  it('el CSV de la plantilla trae el encabezado y dos filas de ejemplo', () => {
    const lineas = csvPlantillaActividades().trim().split(/\r?\n/)
    expect(lineas).toHaveLength(3)
    expect(lineas[0].startsWith('titulo,cargo,servicio,')).toBe(true)
  })

  it('las notas avisan de lo que importa y de lo que no', () => {
    const texto = PLANTILLA_ACTIVIDADES.notas.join(' ')
    expect(texto).toMatch(/nace ACTIVA/)
    expect(texto).toMatch(/todo o nada/)
    expect(texto).toMatch(/No se crean recursos/)
    expect(texto).toMatch(/mismo título y cargo/)
    expect(texto).toMatch(new RegExp(`Máximo ${MAX_FILAS_ACTIVIDADES} filas`))
  })

  it('faltar una columna obligatoria es error de encabezado; una desconocida solo avisa (el servidor la rechaza)', () => {
    expect(validarEncabezados(PLANTILLA_ACTIVIDADES, ['titulo', 'cargo']).errores).toEqual(['Falta la columna obligatoria «servicio».'])
    const r = validarEncabezados(PLANTILLA_ACTIVIDADES, ['titulo', 'cargo', 'servicio', 'activo'])
    expect(r.errores).toEqual([])
    expect(r.advertencias[0]).toMatch(/«activo»/)
  })
})

describe('leerArchivoActividades', () => {
  it('lee un CSV con encabezados en español y normaliza las claves', async () => {
    const r = await leerArchivoActividades('a.csv', buf('Título,Cargo,Servicio,Duración min,Insumos\nBarrido,conserje,limpieza,15,Escoba; Bolsa x 3\n'))
    expect(r.filas).toEqual([{ titulo: 'Barrido', cargo: 'conserje', servicio: 'limpieza', duracion_min: '15', insumos: 'Escoba; Bolsa x 3' }])
  })

  it('rechaza más de 500 filas', async () => {
    const filas = Array.from({ length: MAX_FILAS_ACTIVIDADES + 1 }, (_, i) => `Act ${i},conserje,otro`).join('\n')
    await expect(leerArchivoActividades('a.csv', buf(`titulo,cargo,servicio\n${filas}\n`))).rejects.toThrow(/máximo es 500/)
  })

  it('rechaza un libro con macros sin leerlo', async () => {
    await expect(leerArchivoActividades('a.xlsm', buf('x'))).rejects.toThrow(/macros/)
  })
})

describe('mensajes y totales', () => {
  it('quita el prefijo técnico del servidor', () => {
    expect(mensajeErrorImportacionActividades('PLANTILLAS_IMPORT_DUPLICADO: este mismo contenido ya se importó')).toBe('este mismo contenido ya se importó')
    expect(mensajeErrorImportacionActividades('otra cosa')).toBe('otra cosa')
  })
  it('totalRecursosVistaPrevia suma los recursos de las filas válidas', () => {
    expect(totalRecursosVistaPrevia({ filas: [
      { fila: 1, origen: {}, datos: { n_recursos: 3 } as never, errores: [], advertencias: [] },
      { fila: 2, origen: {}, datos: null, errores: [{ campo: 'x', mensaje: 'y' }], advertencias: [] },
      { fila: 3, origen: {}, datos: { n_recursos: 0 } as never, errores: [], advertencias: [] },
    ] })).toBe(3)
    expect(totalRecursosVistaPrevia(null)).toBe(0)
  })
})
