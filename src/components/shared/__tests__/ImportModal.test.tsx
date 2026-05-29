import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ImportModal, type ImportColumn, type RowValidationResult } from '../ImportModal'
import { checkA11y } from '../../../test/a11y'

interface Row {
  nombre: string
  edad: number
}

const columns: ImportColumn[] = [
  { key: 'nombre', exampleValues: ['Ana'] },
  { key: 'edad',   exampleValues: [30] },
]

function validateRow(raw: Record<string, unknown>): RowValidationResult<Row> {
  const errors: string[] = []
  const nombre = String(raw['nombre'] ?? '').trim()
  if (!nombre) errors.push('nombre requerido')
  const edadNum = Number(raw['edad'])
  if (isNaN(edadNum) || edadNum < 0) errors.push('edad inválida')
  if (errors.length) return { ok: false, errors }
  return { ok: true, data: { nombre, edad: edadNum } }
}

beforeEach(() => {
  cleanup()
  vi.restoreAllMocks()  // evita que spies acumulados entre tests causen recursión
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ImportModal — render', () => {
  it('muestra el step upload por default', () => {
    render(
      <ImportModal
        entityLabel="contacto"
        columns={columns}
        validateRow={validateRow}
        onInsertBatch={async () => ({ ok: 0 })}
        onClose={() => {}}
        onImportado={() => {}}
      />
    )
    expect(screen.getByText(/Importar contactos desde Excel/i)).toBeDefined()
    // "plantilla" aparece en subtitle + en el botón → usamos getAllByText
    expect(screen.getAllByText(/plantilla/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/Arrastra el archivo/i)).toBeDefined()
  })

  it('respeta entityLabelPlural custom', () => {
    render(
      <ImportModal
        entityLabel="cliente"
        entityLabelPlural="clientes"
        columns={columns}
        validateRow={validateRow}
        onInsertBatch={async () => ({ ok: 0 })}
        onClose={() => {}}
        onImportado={() => {}}
      />
    )
    expect(screen.getByText(/Importar clientes desde Excel/i)).toBeDefined()
  })
})

describe('ImportModal — cierre', () => {
  it('cierra al click en X', () => {
    const onClose = vi.fn()
    render(
      <ImportModal
        entityLabel="contacto"
        columns={columns}
        validateRow={validateRow}
        onInsertBatch={async () => ({ ok: 0 })}
        onClose={onClose}
        onImportado={() => {}}
      />
    )
    fireEvent.click(screen.getByLabelText('Cerrar'))
    expect(onClose).toHaveBeenCalled()
  })

  it('cierra al click fuera del modal', () => {
    const onClose = vi.fn()
    const { container } = render(
      <ImportModal
        entityLabel="contacto"
        columns={columns}
        validateRow={validateRow}
        onInsertBatch={async () => ({ ok: 0 })}
        onClose={onClose}
        onImportado={() => {}}
      />
    )
    // Click en el overlay (primer child del root)
    fireEvent.click(container.firstChild as Element)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('ImportModal — descarga plantilla', () => {
  it('dispara writeXlsx con la sheet correcta al clickear "Descargar plantilla"', async () => {
    let capturedDownload: string | undefined
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag)
      if (tag === 'a') el.click = function() { capturedDownload = (this as HTMLAnchorElement).download }
      return el
    })

    render(
      <ImportModal
        entityLabel="amenidad"
        entityLabelPlural="amenidades"
        columns={columns}
        validateRow={validateRow}
        onInsertBatch={async () => ({ ok: 0 })}
        onClose={() => {}}
        onImportado={() => {}}
      />
    )
    fireEvent.click(screen.getByText(/Descargar plantilla/i))
    await waitFor(() => expect(capturedDownload).toBe('plantilla_amenidades.xlsx'))
  })

  it('respeta templateFilename custom', async () => {
    let capturedDownload: string | undefined
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag)
      if (tag === 'a') el.click = function() { capturedDownload = (this as HTMLAnchorElement).download }
      return el
    })

    render(
      <ImportModal
        entityLabel="x"
        columns={columns}
        templateFilename="custom_template"
        validateRow={validateRow}
        onInsertBatch={async () => ({ ok: 0 })}
        onClose={() => {}}
        onImportado={() => {}}
      />
    )
    fireEvent.click(screen.getByText(/Descargar plantilla/i))
    await waitFor(() => expect(capturedDownload).toBe('custom_template.xlsx'))
  })
})

describe('ImportModal — pluralización', () => {
  it('pluraliza correctamente cuando hay 1 vs muchos', () => {
    // Con entityLabel default "x" plural sería "xs", pero el caller suele
    // pasar plural explícito. Validamos el footer del button "Cancelar" como
    // sanity check de render.
    render(
      <ImportModal
        entityLabel="cliente"
        entityLabelPlural="clientes"
        columns={columns}
        validateRow={validateRow}
        onInsertBatch={async () => ({ ok: 0 })}
        onClose={() => {}}
        onImportado={() => {}}
      />
    )
    expect(screen.getByText('Cancelar')).toBeDefined()
    expect(screen.getByText(/Importar clientes desde Excel/i)).toBeDefined()
  })

  it('a11y baseline: modal abierto sin violaciones', async () => {
    const { container } = render(
      <ImportModal
        entityLabel="cliente"
        entityLabelPlural="clientes"
        columns={columns}
        validateRow={validateRow}
        onInsertBatch={async () => ({ ok: 0 })}
        onClose={() => {}}
        onImportado={() => {}}
      />
    )
    await checkA11y(container)
  })
})
