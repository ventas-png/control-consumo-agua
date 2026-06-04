import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TimbradoEstadoBadge, TimbradoDatos } from '../fiscalUi'
import type { DocumentoFiscal } from '../../../types/fiscal'

// Presentación del estatus de timbrado. La FUENTE DE VERDAD del estado es
// businessFiscal.ts (normalización); aquí verificamos que el badge/datos rinden
// lo esperado y se ocultan cuando no aplican.
beforeEach(cleanup)

describe('TimbradoEstadoBadge', () => {
  it('no renderiza nada cuando no hay documento (estado null/undefined)', () => {
    const { container } = render(<TimbradoEstadoBadge estado={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('muestra la etiqueta de cada estado fiscal', () => {
    render(<TimbradoEstadoBadge estado="timbrado" />)
    expect(screen.getByText(/Timbrado/)).toBeDefined()
  })

  it('muestra "Rechazado" para un comprobante rechazado', () => {
    render(<TimbradoEstadoBadge estado="rechazado" />)
    expect(screen.getByText(/Rechazado/)).toBeDefined()
  })

  it('normaliza un estado desconocido a Borrador', () => {
    render(<TimbradoEstadoBadge estado="basura" />)
    expect(screen.getByText(/Borrador/)).toBeDefined()
  })
})

describe('TimbradoDatos', () => {
  const base: Pick<
    DocumentoFiscal,
    'estado' | 'uuid_fiscal' | 'serie' | 'numero' | 'numero_autorizacion'
  > = {
    estado: 'timbrado',
    uuid_fiscal: 'UUID-123',
    serie: 'A',
    numero: '0001',
    numero_autorizacion: 'AUTH-999',
  }

  it('muestra UUID, serie/número y autorización cuando está timbrado', () => {
    render(<TimbradoDatos documento={base} />)
    expect(screen.getByText('UUID-123')).toBeDefined()
    expect(screen.getByText('A-0001')).toBeDefined()
    expect(screen.getByText('AUTH-999')).toBeDefined()
  })

  it('no renderiza nada si el documento no está timbrado', () => {
    const { container } = render(<TimbradoDatos documento={{ ...base, estado: 'por_timbrar' }} />)
    expect(container.firstChild).toBeNull()
  })

  it('no renderiza nada si está timbrado pero sin identificadores', () => {
    const { container } = render(
      <TimbradoDatos
        documento={{ estado: 'timbrado', uuid_fiscal: null, serie: null, numero: null, numero_autorizacion: null }}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('no renderiza nada cuando no hay documento', () => {
    const { container } = render(<TimbradoDatos documento={null} />)
    expect(container.firstChild).toBeNull()
  })
})
