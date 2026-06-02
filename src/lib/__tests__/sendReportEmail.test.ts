import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../supabase', () => {
  const uploaded: Array<{ path: string; blob: Blob }> = []
  const insertedRows: unknown[][] = []
  return {
    supabase: {
      storage: {
        from: (_bucket: string) => ({
          upload: (path: string, blob: Blob) => {
            uploaded.push({ path, blob })
            return Promise.resolve({ error: null })
          },
          createSignedUrl: (_path: string, _ttl: number) =>
            Promise.resolve({ data: { signedUrl: 'https://signed.example/file.csv' }, error: null }),
        }),
      },
      from: (_table: string) => ({
        insert: (rows: unknown[]) => {
          insertedRows.push(rows)
          return Promise.resolve({ error: null })
        },
      }),
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-test' } } }) },
    },
    // Expose for assertions
    __uploaded: uploaded,
    __insertedRows: insertedRows,
  }
})

vi.mock('../exportData', () => ({
  exportData: vi.fn().mockImplementation(async (_format, _opts) => {
    // Simula la generación: crea blob y lo enviar a URL.createObjectURL para
    // que sendReportByEmail lo capture.
    const blob = new Blob(['header1,header2\nrow1,val1'], { type: 'text/csv' })
    URL.createObjectURL(blob)
    // No invocamos document.body.appendChild aqui — el helper sobreescribe pero
    // no es necesario para que la captura ocurra (URL.createObjectURL ya
    // basta).
  }),
}))

const { sendReportByEmail } = await import('../sendReportEmail')
const mod = await import('../supabase') as unknown as {
  __uploaded: Array<{ path: string; blob: Blob }>
  __insertedRows: unknown[][]
}

beforeEach(() => {
  mod.__uploaded.length = 0
  mod.__insertedRows.length = 0
})

describe('sendReportByEmail', () => {
  it('falla si no hay recipients', async () => {
    const res = await sendReportByEmail({
      companyId: 'c1', templateId: 't1', templateName: 'Test',
      sourceTable: 'pagos', format: 'csv',
      data: [{ id: '1' }], columns: [{ header: 'ID', accessor: 'id' as const }],
      recipients: [],
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/No hay destinatarios/)
  })

  it('sube archivo a path company/template/timestamp', async () => {
    await sendReportByEmail({
      companyId: 'c-abc', templateId: 't-xyz', templateName: 'Reporte X',
      sourceTable: 'pagos', format: 'csv',
      data: [{ id: '1' }], columns: [{ header: 'ID', accessor: 'id' as const }],
      recipients: ['user@example.com'],
    })
    expect(mod.__uploaded).toHaveLength(1)
    expect(mod.__uploaded[0].path).toMatch(/^c-abc\/t-xyz\/.+\.csv$/)
  })

  it('encola 1 email por cada recipient con vars correctos', async () => {
    const recipients = ['a@x.com', 'b@x.com', 'c@x.com']
    const res = await sendReportByEmail({
      companyId: 'c1', templateId: 't1', templateName: 'Mensual',
      sourceTable: 'cuotas_condominio', format: 'pdf',
      data: [{ id: '1' }, { id: '2' }],
      columns: [{ header: 'ID', accessor: 'id' as const }],
      recipients,
    })
    expect(res.success).toBe(true)
    expect(res.enqueued).toBe(3)
    expect(mod.__insertedRows).toHaveLength(1)
    const rows = mod.__insertedRows[0] as Array<{ payload: { to_email: string; template_key: string; vars: Record<string, string> } }>
    expect(rows).toHaveLength(3)
    expect(rows.map(r => r.payload.to_email).sort()).toEqual(recipients.sort())
    expect(rows[0].payload.template_key).toBe('saved_report_delivery')
    expect(rows[0].payload.vars.rows_count).toBe('2')
    expect(rows[0].payload.vars.format).toBe('PDF')
    expect(rows[0].payload.vars.source_table).toBe('Cuotas de condominio')
    expect(rows[0].payload.vars.attachment_url).toContain('signed.example')
  })
})
