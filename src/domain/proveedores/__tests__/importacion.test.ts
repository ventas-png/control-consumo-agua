import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  ArchivoImportacionError,
  construirInformeLote,
  csvPlantilla,
  filasPlantilla,
  leerArchivoImportacion,
  MAX_FILAS_CARGA,
  normalizarEncabezado,
  PLANTILLAS,
  validarEncabezados,
  xlsxPlantilla,
} from '../importacion'
import { parsearCsv } from '../../../lib/csv'
import type { FilaImportacion, TipoImportacion } from '../../../types/proveedores'

const enc = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer

async function libro(armar: (ws: ExcelJS.Worksheet) => void): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  armar(wb.addWorksheet('Datos'))
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

describe('plantillas', () => {
  it.each(['proveedores', 'asignaciones', 'contratos'] as TipoImportacion[])(
    '%s: encabezado + 2 ejemplos, y la plantilla se lee a sí misma sin errores', async (tipo) => {
      const filas = filasPlantilla(tipo)
      expect(filas).toHaveLength(3)
      expect(filas[0]).toEqual(PLANTILLAS[tipo].columnas.map((c) => c.key))
      // CSV: lo que descargamos se puede volver a cargar.
      const leido = await leerArchivoImportacion('p.csv', enc(csvPlantilla(tipo)), tipo)
      expect(leido.filas.length).toBeGreaterThan(0)
      expect(leido.advertencias).toEqual([])
    })

  it('el XLSX de plantilla tiene Datos + Instrucciones, todo como TEXTO, y se relee', async () => {
    const buffer = await xlsxPlantilla('proveedores')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Datos', 'Instrucciones'])
    expect(wb.getWorksheet('Datos')!.getColumn(1).numFmt).toBe('@')
    const leido = await leerArchivoImportacion('plantilla.xlsx', buffer, 'proveedores')
    expect(leido.filas[0].nombre).toBe('Ferretería La Unión, S.A.')
    expect(leido.filas[0].nit).toBe('1234567-8')
  })

  it('los ejemplos no traen nada ejecutable', () => {
    for (const tipo of ['proveedores', 'asignaciones', 'contratos'] as TipoImportacion[]) {
      for (const fila of filasPlantilla(tipo)) for (const v of fila) expect(v).not.toMatch(/^[=@]/)
    }
  })
})

describe('CSV: lectura', () => {
  it('lee, normaliza encabezados y deja TODO como texto (ceros intactos)', async () => {
    const csv = 'Nombre *,País,NIT,Código\n"Ferretería, S.A.",GT,0001234-5,00123\n'
    const leido = await leerArchivoImportacion('prov.csv', enc(csv), 'proveedores')
    expect(leido.columnas).toEqual(['nombre', 'pais', 'nit', 'codigo'])
    expect(leido.filas[0]).toEqual({ nombre: 'Ferretería, S.A.', pais: 'GT', nit: '0001234-5', codigo: '00123' })
    expect(leido.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('acepta el CSV de Excel en español (; y Windows-1252)', async () => {
    const latin1 = new Uint8Array([...'nombre;pais\n'].map((c) => c.charCodeAt(0)))
    const cuerpo = new Uint8Array([0x4d, 0x75, 0xf1, 0x6f, 0x7a, 0x3b, 0x47, 0x54]) // «Muñoz;GT» en latin1
    const todo = new Uint8Array(latin1.length + cuerpo.length)
    todo.set(latin1); todo.set(cuerpo, latin1.length)
    const leido = await leerArchivoImportacion('prov.csv', todo.buffer as ArrayBuffer, 'proveedores')
    expect(leido.filas[0].nombre).toBe('Muñoz')
  })

  it('una fórmula en un CSV llega como TEXTO (el servidor la rechaza), no se evalúa', async () => {
    const csv = 'nombre\n"=HYPERLINK(""http://evil.test"",""x"")"\n'
    const leido = await leerArchivoImportacion('p.csv', enc(csv), 'proveedores')
    expect(leido.filas[0].nombre).toBe('=HYPERLINK("http://evil.test","x")')
  })

  it('avisa de columnas desconocidas y rechaza columnas repetidas y faltantes', async () => {
    const ok = await leerArchivoImportacion('p.csv', enc('nombre,estado\nX,autorizado\n'), 'proveedores')
    expect(ok.advertencias.join(' ')).toMatch(/Columna desconocida «estado»/)
    await expect(leerArchivoImportacion('p.csv', enc('nombre,nombre\nX,Y\n'), 'proveedores')).rejects.toThrow(/repetidas/)
    await expect(leerArchivoImportacion('p.csv', enc('pais\nGT\n'), 'proveedores')).rejects.toThrow(/obligatoria «nombre»/)
  })

  it('asignaciones y contratos exigen identificar proveedor y proyecto', async () => {
    await expect(leerArchivoImportacion('a.csv', enc('proyecto,dias_credito\nX,30\n'), 'asignaciones'))
      .rejects.toThrow(/proveedor_codigo|proveedor_identificacion/)
    await expect(leerArchivoImportacion('a.csv', enc('proveedor_codigo,dias_credito\nP,30\n'), 'asignaciones'))
      .rejects.toThrow(/proyecto/)
    const ok = await leerArchivoImportacion('a.csv', enc('proveedor_codigo,proyecto_id\nP,6c1c9c4e-0000-0000-0000-000000000001\n'), 'asignaciones')
    expect(ok.filas).toHaveLength(1)
    await expect(leerArchivoImportacion('c.csv', enc('proveedor_codigo,proyecto,modalidad,fecha_inicio\nP,X,recurrente,2026-01-01\n'), 'contratos'))
      .rejects.toThrow(/«referencia»/)
  })

  it('rechaza archivo vacío, sin filas, demasiado grande y con demasiadas filas', async () => {
    await expect(leerArchivoImportacion('p.csv', new ArrayBuffer(0), 'proveedores')).rejects.toThrow(/vacío/)
    await expect(leerArchivoImportacion('p.csv', enc('nombre\n'), 'proveedores')).rejects.toThrow(/no tiene filas de datos/)
    const muchas = 'nombre\n' + Array.from({ length: MAX_FILAS_CARGA + 1 }, (_, i) => `P${i}`).join('\n')
    await expect(leerArchivoImportacion('p.csv', enc(muchas), 'proveedores')).rejects.toThrow(/divídelo|divide/i)
    const justo = 'nombre\n' + Array.from({ length: MAX_FILAS_CARGA }, (_, i) => `P${i}`).join('\n')
    await expect(leerArchivoImportacion('p.csv', enc(justo), 'proveedores')).resolves.toBeTruthy()
  })

  it('un .xlsx renombrado a .csv (y viceversa) se detecta por el contenido', async () => {
    const xlsx = await libro((ws) => { ws.addRow(['nombre']); ws.addRow(['X']) })
    await expect(leerArchivoImportacion('p.csv', xlsx, 'proveedores')).rejects.toThrow(/renombrado/)
    await expect(leerArchivoImportacion('p.xlsx', enc('nombre\nX\n'), 'proveedores')).rejects.toThrow(/no es un \.xlsx válido/)
  })
})

describe('formatos rechazados por seguridad', () => {
  it.each([
    ['p.xlsm', /macros/],
    ['p.xls', /\.xls/],
    ['p.xlsb', /binario/],
    ['p.xltm', /macros/],
    ['p.ods', /\.xlsx o \.csv/],
  ])('%s', async (nombre, patron) => {
    await expect(leerArchivoImportacion(nombre, enc('x'), 'proveedores')).rejects.toThrow(patron)
  })
  it('una extensión desconocida o ausente', async () => {
    await expect(leerArchivoImportacion('p.pdf', enc('x'), 'proveedores')).rejects.toThrow(/\.csv o \.xlsx/)
    await expect(leerArchivoImportacion('p', enc('x'), 'proveedores')).rejects.toThrow(/\.csv o \.xlsx/)
  })
  it('el error es un ArchivoImportacionError apto para mostrar', async () => {
    await expect(leerArchivoImportacion('p.xlsm', enc('x'), 'proveedores')).rejects.toBeInstanceOf(ArchivoImportacionError)
  })
})

describe('XLSX: lectura segura', () => {
  it('lee texto, fechas ISO y booleanos', async () => {
    const buffer = await libro((ws) => {
      ws.addRow(['nombre', 'pais', 'notas'])
      ws.addRow(['Ferretería', 'GT', 'ok'])
      const fila = ws.addRow(['Con fecha', 'GT', new Date(Date.UTC(2026, 1, 1))])
      fila.getCell(3).numFmt = 'yyyy-mm-dd'
    })
    const leido = await leerArchivoImportacion('p.xlsx', buffer, 'proveedores')
    expect(leido.filas).toHaveLength(2)
    expect(leido.filas[1].notas).toBe('2026-02-01')
  })

  it('RECHAZA el libro con fórmulas y dice dónde están', async () => {
    const buffer = await libro((ws) => {
      ws.addRow(['nombre', 'notas'])
      ws.addRow(['X', { formula: '1+1', result: 2 }])
      ws.addRow(['Y', { formula: 'HYPERLINK("http://evil.test","x")', result: 'x' }])
    })
    await expect(leerArchivoImportacion('p.xlsx', buffer, 'proveedores')).rejects.toThrow(/2 celda\(s\) con FÓRMULAS \(B2, B3\)/)
  })

  it('un hipervínculo aporta SOLO su texto y avisa; la URL no pasa', async () => {
    const buffer = await libro((ws) => {
      ws.addRow(['nombre', 'email'])
      ws.addRow(['X', { text: 'ventas@x.test', hyperlink: 'http://evil.test/robar' }])
    })
    const leido = await leerArchivoImportacion('p.xlsx', buffer, 'proveedores')
    expect(leido.filas[0].email).toBe('ventas@x.test')
    expect(JSON.stringify(leido)).not.toContain('evil.test')
    expect(leido.advertencias.join(' ')).toMatch(/1 hipervínculo/)
  })

  it('avisa si un código o NIT llegó como NÚMERO (pudo perder ceros)', async () => {
    const buffer = await libro((ws) => {
      ws.addRow(['nombre', 'nit', 'telefono'])
      ws.addRow(['X', 12345678, '5555-1234'])
      ws.addRow(['Y', '0001234-5', 55551234])
    })
    const leido = await leerArchivoImportacion('p.xlsx', buffer, 'proveedores')
    expect(leido.advertencias.join(' ')).toMatch(/NUMÉRICAS/)
    expect(leido.advertencias.join(' ')).toMatch(/B2/)
    expect(leido.advertencias.join(' ')).toMatch(/C3/)
    // Las celdas de texto conservan sus ceros.
    expect(leido.filas[1].nit).toBe('0001234-5')
  })

  it('ignora filas vacías y lee solo la primera hoja', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Datos')
    ws.addRow([])
    ws.addRow(['nombre'])
    ws.addRow(['X'])
    ws.addRow([])
    ws.addRow(['Z'])
    wb.addWorksheet('Otra').addRow(['nombre', 'Ñ'])
    const leido = await leerArchivoImportacion('p.xlsx', (await wb.xlsx.writeBuffer()) as ArrayBuffer, 'proveedores')
    expect(leido.filas.map((f) => f.nombre)).toEqual(['X', 'Z'])
  })

  it('un libro dañado da un mensaje claro', async () => {
    const roto = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]).buffer as ArrayBuffer
    await expect(leerArchivoImportacion('p.xlsx', roto, 'proveedores')).rejects.toThrow(/No se pudo leer el libro/)
  })
})

describe('encabezados', () => {
  it.each([
    ['Código *', 'codigo'],
    ['Días de crédito', 'dias_de_credito'],
    ['  NIT  ', 'nit'],
    ['proveedor-codigo', 'proveedor_codigo'],
    ['País', 'pais'],
  ])('%s → %s', (entrada, esperado) => expect(normalizarEncabezado(entrada)).toBe(esperado))

  it('validarEncabezados separa errores de advertencias', () => {
    const r = validarEncabezados('proveedores', ['nombre', 'raro'])
    expect(r.errores).toEqual([])
    expect(r.advertencias).toHaveLength(1)
  })
})

describe('informe de errores', () => {
  const fila = (over: Partial<FilaImportacion>): FilaImportacion => ({
    id: 'f', lote_id: 'l', fila: 2, accion: 'error', estado: 'pendiente', entidad_id: null,
    origen: {}, datos: null, cambios: {}, errores: [], advertencias: [], resultado: null, ...over,
  })

  it('lleva fila, acción, valores originales, errores y cambios', () => {
    const csv = construirInformeLote(
      [fila({
        fila: 3, origen: { nombre: 'Ferretería', nit: '123' },
        errores: [{ campo: 'nit', mensaje: 'Duplicada' }],
        cambios: { email: { antes: 'a@x.test', despues: 'b@x.test' }, telefono: { antes: '1', despues: null } },
      })],
      ['nombre', 'nit'],
    )
    const [cab, datos] = parsearCsv(csv)
    expect(cab).toEqual(['fila', 'accion', 'estado', 'nombre', 'nit', 'errores', 'advertencias', 'cambios', 'resultado'])
    expect(datos[0]).toBe('3')
    expect(datos[5]).toBe('nit: Duplicada')
    expect(datos[7]).toBe('email: a@x.test → b@x.test | telefono: 1 → ∅')
  })

  it('NO es un vector de fórmulas: lo que venía del archivo se neutraliza al exportar', () => {
    const csv = construirInformeLote(
      [fila({ origen: { nombre: '=HYPERLINK("http://evil.test","x")', nit: '+cmd|calc' }, errores: [{ campo: 'nombre', mensaje: '=SUM(1)' }] })],
      ['nombre', 'nit'],
    )
    const [, datos] = parsearCsv(csv)
    for (const celda of datos) expect(celda).not.toMatch(/^[=+\-@]/)
    expect(datos[3]).toBe(`'=HYPERLINK("http://evil.test","x")`)
    expect(datos[4]).toBe("'+cmd|calc")
  })
})
