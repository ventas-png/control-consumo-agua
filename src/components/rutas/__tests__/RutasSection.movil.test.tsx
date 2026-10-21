// Rutas en el teléfono: la lista no se sale de pantallas angostas y en el
// editor el selector de tipo envuelve y los paneles "disponibles" / "en esta
// ruta" se apilan en vez de quedar en dos columnas fijas de ~140px.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { Cliente, Contador, Proyecto, Ruta, Unidad, UserRole } from '../../../types'

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({}), rpc: () => ({}), storage: { from: () => ({}) } },
  db: { from: () => ({}), rpc: () => ({}) },
}))
vi.mock('../../../domain/usuarios/queries', () => ({ fetchOperadoresAsignablesRuta: vi.fn(async () => []) }))
vi.mock('../../../domain/rutas/mutations', () => ({ createRuta: vi.fn(), updateRuta: vi.fn(), deleteRuta: vi.fn() }))
vi.mock('../../shared/Dialog', () => ({ confirm: vi.fn(), notify: vi.fn() }))

const { RutasSection } = await import('../RutasSection')

const RUTA = { id: 'r1', nombre: 'Ruta norte', project_id: 'p1', tipo_ruta: 'clientes', cliente_ids: [] } as unknown as Ruta

function renderRutas(userRole: UserRole = 'admin') {
  return render(
    <RutasSection
      clientes={[{ id: 'c1', nombre: 'Ana', codigo: 'C-1' }] as Cliente[]}
      contadores={[] as Contador[]}
      unidades={[] as Unidad[]}
      proyectos={[{ id: 'p1', nombre: 'Viñas del Sur' }] as Proyecto[]}
      rutas={[RUTA]}
      userRole={userRole}
      onRutaAdded={() => {}}
      onRutaUpdated={() => {}}
      onRutaDeleted={() => {}}
      onEjecutarRuta={() => {}}
    />,
  )
}

afterEach(cleanup)

describe('RutasSection — teléfono', () => {
  it('la rejilla de tarjetas nunca pide más ancho que el disponible', () => {
    renderRutas()
    const rejilla = screen.getByText('Ruta norte').closest('div[style*="grid"]') as HTMLElement
    expect(rejilla.style.gridTemplateColumns).toContain('min(100%, 320px)')
  })

  it('en el editor el tipo de ruta envuelve y los paneles de selección se apilan', () => {
    renderRutas()
    fireEvent.click(screen.getByText('+ Nueva Ruta'))

    const tipos = screen.getByRole('button', { name: 'Por contador' }).parentElement!
    expect(tipos.style.flexWrap).toBe('wrap')

    const panel = screen.getByText(/Clientes disponibles/).parentElement!.parentElement!
    expect(panel.style.gridTemplateColumns).not.toBe('1fr 1fr')
    expect(panel.style.gridTemplateColumns).toContain('min(100%, 280px)')
    // Agregar desde "disponibles" sigue llevando el cliente a "en esta ruta".
    fireEvent.click(screen.getByRole('button', { name: '+' }))
    expect(screen.getByText(/En esta ruta \(1\)/)).toBeTruthy()
  })

  it('el permiso de crear no cambia: un operador no ve "+ Nueva Ruta"', () => {
    renderRutas('operator')
    expect(screen.queryByText('+ Nueva Ruta')).toBeNull()
    expect(screen.queryByText('Editar')).toBeNull()
  })
})
