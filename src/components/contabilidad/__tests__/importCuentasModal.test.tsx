// La carga masiva del catálogo elige DESTINO: la contabilidad de la empresa y/o
// la de cada proyecto. El destino no puede quedar implícito — un catálogo
// cargado en el ledger equivocado ensucia los libros de otra entidad — así que
// aquí se fija el contrato de la selección.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import type { Proyecto } from '../../../types/plataforma'

// El barril de `../shared` arrastra el cliente de Supabase, que exige las env
// vars VITE_SUPABASE_* inexistentes en test.
vi.mock('../../../lib/supabase', () => ({
  supabase: {},
  warmUpSupabase: vi.fn(),
}))
vi.mock('../../../domain/contabilidad/mutations', () => ({
  useImportarCuentasMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

import { ImportCuentasModal } from '../ImportCuentasModal'

function proyecto(id: string, nombre: string, estado: Proyecto['estado'] = 'activo'): Proyecto {
  return { id, nombre, estado, company_id: 'c1' } as Proyecto
}

const PROYECTOS = [proyecto('p1', 'Mayan Residenciales'), proyecto('p2', 'Torre Vieja', 'inactivo')]

/** Casilla de un destino, buscada por su etiqueta con icono ('🏢 Empresa'). */
function casilla(nombre: string): HTMLInputElement {
  const etiqueta = screen.getByText(nombre).closest('label')!
  return etiqueta.querySelector('input[type="checkbox"]') as HTMLInputElement
}

afterEach(cleanup)

describe('ImportCuentasModal — contabilidades destino', () => {
  it('premarca la contabilidad de la empresa cuando es el ledger activo', () => {
    render(
      <ImportCuentasModal
        companyId="c1" projectId={null} proyectos={PROYECTOS}
        onClose={() => {}} onImportado={() => {}}
      />,
    )
    expect(casilla('🏢 Empresa').checked).toBe(true)
    expect(casilla('📍 Mayan Residenciales').checked).toBe(false)
  })

  it('premarca el proyecto cuando la contabilidad activa es la suya', () => {
    render(
      <ImportCuentasModal
        companyId="c1" projectId="p1" proyectos={PROYECTOS}
        onClose={() => {}} onImportado={() => {}}
      />,
    )
    expect(casilla('📍 Mayan Residenciales').checked).toBe(true)
    expect(casilla('🏢 Empresa').checked).toBe(false)
  })

  it('el atajo "Empresa + proyectos activos" deja fuera a los proyectos inactivos', () => {
    render(
      <ImportCuentasModal
        companyId="c1" projectId={null} proyectos={PROYECTOS}
        onClose={() => {}} onImportado={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('Empresa + proyectos activos'))
    expect(casilla('🏢 Empresa').checked).toBe(true)
    expect(casilla('📍 Mayan Residenciales').checked).toBe(true)
    expect(casilla('📍 Torre Vieja').checked).toBe(false)
  })

  it('permite marcar varias contabilidades a la vez y limpiarlas', () => {
    render(
      <ImportCuentasModal
        companyId="c1" projectId={null} proyectos={PROYECTOS}
        onClose={() => {}} onImportado={() => {}}
      />,
    )
    fireEvent.click(casilla('📍 Torre Vieja'))
    expect(casilla('🏢 Empresa').checked).toBe(true)
    expect(casilla('📍 Torre Vieja').checked).toBe(true)

    fireEvent.click(screen.getByText('Limpiar'))
    expect(casilla('🏢 Empresa').checked).toBe(false)
    expect(casilla('📍 Torre Vieja').checked).toBe(false)
  })
})
