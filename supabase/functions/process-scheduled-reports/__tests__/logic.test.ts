// Tests de la lógica pura de process-scheduled-reports (infra:I22 · Track
// T8/T5). Como el resto de tests de edge fns, corre bajo vitest (no Deno)
// tratando el módulo como TS normal. Cubre: serialización CSV (quoting RFC 4180
// + BOM UTF-8), qué filtros del template aplican, path de Storage aislado por
// tenant, variables del correo y filas de email_send_queue.

import { describe, it, expect } from 'vitest'
import {
  SOURCE_LABEL_MAP,
  applicableFilters,
  buildQueueRows,
  buildReportVars,
  buildStoragePath,
  escapeCsv,
  serializeCsv,
  sourceLabel,
} from '../logic.ts'

describe('process-scheduled-reports/sourceLabel', () => {
  it('mapea cada source_table permitida a su etiqueta es', () => {
    expect(sourceLabel('cuotas_condominio')).toBe('Cuotas de condominio')
    expect(sourceLabel('pagos')).toBe('Pagos')
    expect(sourceLabel('tickets_mantenimiento')).toBe('Tickets de mantenimiento')
    expect(sourceLabel('gastos_condominio')).toBe('Gastos')
    expect(sourceLabel('fondo_reserva_condominio')).toBe('Fondo de reserva')
    expect(Object.keys(SOURCE_LABEL_MAP)).toHaveLength(5)
  })

  it('tabla no mapeada cae al nombre crudo', () => {
    expect(sourceLabel('tabla_nueva')).toBe('tabla_nueva')
  })
})

describe('process-scheduled-reports/applicableFilters', () => {
  it('descarta null, "" y undefined pero conserva 0 y false-y numéricos', () => {
    const out = applicableFilters({
      estado: 'pendiente',
      monto: 0,
      proyecto: null,
      unidad: '',
    })
    expect(out).toEqual([['estado', 'pendiente'], ['monto', 0]])
  })

  it('objeto vacío → sin filtros (query solo por company_id + soft-delete)', () => {
    expect(applicableFilters({})).toEqual([])
  })
})

describe('process-scheduled-reports/escapeCsv', () => {
  it('encierra en comillas si hay coma, comilla o salto de línea (RFC 4180)', () => {
    expect(escapeCsv('a,b')).toBe('"a,b"')
    expect(escapeCsv('linea1\nlinea2')).toBe('"linea1\nlinea2"')
    expect(escapeCsv('dijo "hola"')).toBe('"dijo ""hola"""')
  })

  it('texto simple queda intacto', () => {
    expect(escapeCsv('García Q100.50')).toBe('García Q100.50')
  })
})

describe('process-scheduled-reports/serializeCsv', () => {
  const cols = [
    { header: 'Unidad', accessor: 'unidad' },
    { header: 'Monto, Q', accessor: 'monto' },
  ]

  it('empieza con BOM UTF-8 para que Excel detecte acentos', () => {
    const csv = serializeCsv(cols, [])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })

  it('header + una línea por fila, celdas por accessor', () => {
    const csv = serializeCsv(cols, [
      { unidad: 'A-1', monto: 100.5 },
      { unidad: 'A-2', monto: 0 },
    ])
    expect(csv.slice(1).split('\n')).toEqual([
      'Unidad,"Monto, Q"',
      'A-1,100.5',
      'A-2,0',
    ])
  })

  it('null/undefined → celda vacía; objetos se serializan como JSON escapado', () => {
    const csv = serializeCsv(cols, [
      { unidad: null, monto: { moneda: 'GTQ' } },
      { unidad: 'B-1' }, // monto undefined
    ])
    expect(csv.slice(1).split('\n')).toEqual([
      'Unidad,"Monto, Q"',
      ',"{""moneda"":""GTQ""}"',
      'B-1,',
    ])
  })
})

describe('process-scheduled-reports/buildStoragePath', () => {
  it('aísla por tenant: company/{template}/{timestamp}.csv', () => {
    const now = new Date('2026-07-09T12:34:56.789Z')
    expect(buildStoragePath('comp-1', 'tpl-9', now))
      .toBe('comp-1/tpl-9/2026-07-09T12-34-56-789Z.csv')
  })

  it('el timestamp no contiene ":" ni "." (Storage no los acepta en el key)', () => {
    const path = buildStoragePath('c', 't', new Date())
    const timestamp = path.split('/')[2].replace(/\.csv$/, '')
    expect(timestamp).not.toMatch(/[:.]/)
  })
})

describe('process-scheduled-reports/buildReportVars', () => {
  it('arma las vars de saved_report_delivery (rows_count como string, formato CSV fijo)', () => {
    const vars = buildReportVars(
      { name: 'Cuotas del mes', source_table: 'cuotas_condominio' },
      42,
      'https://signed.url/x.csv',
      '9 de julio de 2026, 10:00',
    )
    expect(vars).toEqual({
      report_name:    'Cuotas del mes',
      rows_count:     '42',
      format:         'CSV',
      source_table:   'Cuotas de condominio',
      attachment_url: 'https://signed.url/x.csv',
      generated_at:   '9 de julio de 2026, 10:00',
    })
  })
})

describe('process-scheduled-reports/buildQueueRows', () => {
  const vars = { report_name: 'R', rows_count: '1', format: 'CSV', source_table: 'Pagos', attachment_url: 'u', generated_at: 'g' }

  it('una fila pending por recipient, con template_key fijo y company_id en payload y columna', () => {
    const rows = buildQueueRows({ company_id: 'c1', recipients: ['a@x.com', 'b@x.com'] }, vars)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      payload: {
        company_id:   'c1',
        template_key: 'saved_report_delivery',
        to_email:     'a@x.com',
        vars,
      },
      company_id: 'c1',
      status:     'pending',
    })
    expect((rows[1].payload as Record<string, unknown>).to_email).toBe('b@x.com')
  })

  it('sin recipients no genera filas (el handler ya responde 422 antes)', () => {
    expect(buildQueueRows({ company_id: 'c1', recipients: [] }, vars)).toEqual([])
  })
})
