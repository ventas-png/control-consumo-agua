import { describe, expect, it } from 'vitest'
import {
  construirCsv,
  CsvInvalidoError,
  detectarDelimitador,
  escaparCeldaCsv,
  neutralizarFormula,
  parsearCsv,
} from '../csv'

describe('parsearCsv', () => {
  it('lee comillas, comillas escapadas y saltos de línea dentro de una celda', () => {
    const filas = parsearCsv('a,b\r\n"uno, dos","dijo ""hola"""\r\n"línea 1\nlínea 2",x\r\n')
    expect(filas).toEqual([
      ['a', 'b'],
      ['uno, dos', 'dijo "hola"'],
      ['línea 1\nlínea 2', 'x'],
    ])
  })

  it('quita el BOM y respeta los ceros a la izquierda (todo es texto)', () => {
    const filas = parsearCsv('﻿codigo,nit\n00123,0001234-5\n')
    expect(filas[1]).toEqual(['00123', '0001234-5'])
  })

  it('detecta el delimitador de los Excel en español (;) y el tab', () => {
    expect(detectarDelimitador('a;b;c\n1;2;3')).toBe(';')
    expect(detectarDelimitador('a\tb\tc\n1\t2\t3')).toBe('\t')
    expect(detectarDelimitador('a,b,c')).toBe(',')
    // Una coma dentro de comillas en la cabecera no cuenta.
    expect(detectarDelimitador('"a,b";c;d\n')).toBe(';')
    expect(parsearCsv('a;b\n1;2\n')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('ignora filas totalmente vacías y la última línea sin salto', () => {
    expect(parsearCsv('a,b\n\n1,2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parsearCsv('a,b\n,\n1,2\n')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('NO interpreta nada: una celda con fórmula llega como texto', () => {
    const filas = parsearCsv('nombre\n"=HYPERLINK(""http://evil.test"",""click"")"\n')
    expect(filas[1][0]).toBe('=HYPERLINK("http://evil.test","click")')
  })

  it('rechaza comillas sin cerrar, bytes nulos, filas de más y celdas desmesuradas', () => {
    expect(() => parsearCsv('a,b\n"sin cerrar,1\n')).toThrow(CsvInvalidoError)
    expect(() => parsearCsv('a\u0000b')).toThrow(/bytes nulos/)
    expect(() => parsearCsv('a\n1\n2\n3\n', { maxFilas: 3 })).toThrow(/divídelo/)
    expect(() => parsearCsv('a\n' + 'x'.repeat(50), { maxCelda: 10 })).toThrow(/supera los 10 caracteres/)
  })
})

describe('escritura segura', () => {
  it('neutraliza todo lo que una hoja de cálculo ejecutaría como fórmula', () => {
    for (const peligro of ['=1+1', '+SUM(A1)', '-2+3', '@SUM(A1)', '\t=cmd', '\r=cmd']) {
      expect(neutralizarFormula(peligro)).toBe(`'${peligro}`)
    }
    expect(neutralizarFormula('Normal')).toBe('Normal')
    expect(neutralizarFormula('')).toBe('')
  })

  it('cita lo que lo necesita y neutraliza antes de citar', () => {
    expect(escaparCeldaCsv('a,b')).toBe('"a,b"')
    expect(escaparCeldaCsv('di "hola"')).toBe('"di ""hola"""')
    expect(escaparCeldaCsv('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(escaparCeldaCsv(null)).toBe('')
    expect(escaparCeldaCsv(42)).toBe('42')
  })

  it('construirCsv: BOM, CRLF y ninguna celda ejecutable', () => {
    const csv = construirCsv([['fila', 'dato'], [2, '=cmd|calc'], [3, 'ok']])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain("2,'=cmd|calc")
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(3)
    // El CSV que producimos se puede volver a leer sin perder nada.
    expect(parsearCsv(csv)[1]).toEqual(['2', "'=cmd|calc"])
  })
})
