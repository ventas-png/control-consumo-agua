// El selector «Asignar Operador» ofrece a los usuarios del PROYECTO de la ruta,
// no a los de la empresa. Asignarle una ruta a alguien de otro condominio la
// deja con un responsable que ni siquiera puede abrir sus contadores
// (`rutas_select` le muestra la ruta por ser el asignado; `can_access_project`
// le niega los items), y el fallo solo se ve el día de la lectura.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { Cliente, Contador, Proyecto, Ruta, Unidad } from '../../../types'
import type { AppUser } from '../../../domain/usuarios/queries'

const mocks = vi.hoisted(() => ({
  fetchOperadoresAsignablesRuta: vi.fn(async () => [] as AppUser[]),
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({}), rpc: () => ({}), storage: { from: () => ({}) } },
  db: { from: () => ({}), rpc: () => ({}) },
}))
vi.mock('../../../domain/usuarios/queries', () => ({
  fetchOperadoresAsignablesRuta: mocks.fetchOperadoresAsignablesRuta,
}))
vi.mock('../../../domain/rutas/mutations', () => ({
  createRuta: vi.fn(), updateRuta: vi.fn(), deleteRuta: vi.fn(),
}))
vi.mock('../../shared/Dialog', () => ({ confirm: vi.fn(), notify: vi.fn() }))

const { RutasSection } = await import('../RutasSection')

function operador(over: Partial<AppUser> = {}): AppUser {
  return { id: 'u1', full_name: 'Ana Lectora', role: 'operator', activo: true, ...over }
}

const PROYECTOS: Proyecto[] = [{ id: 'p1', nombre: 'Viñas del Sur' } as Proyecto]

function renderRutas(props: Partial<Parameters<typeof RutasSection>[0]> = {}) {
  return render(
    <RutasSection
      clientes={[] as Cliente[]}
      contadores={[] as Contador[]}
      unidades={[] as Unidad[]}
      proyectos={PROYECTOS}
      rutas={[] as Ruta[]}
      userRole="admin"
      companyId="c1"
      onRutaAdded={() => {}}
      onRutaUpdated={() => {}}
      onRutaDeleted={() => {}}
      onEjecutarRuta={() => {}}
      {...props}
    />,
  )
}

/** Abre el editor de alta y espera al selector de operador. */
async function abrirAlta() {
  fireEvent.click(screen.getByText('+ Nueva Ruta'))
  return screen.findByLabelText('Operador')
}

beforeEach(() => {
  mocks.fetchOperadoresAsignablesRuta.mockReset()
  mocks.fetchOperadoresAsignablesRuta.mockResolvedValue([operador()])
})
afterEach(() => { cleanup() })

describe('RutasSection — operadores asignables a la ruta', () => {
  it('pide los operadores del proyecto de la ruta, no los de la empresa', async () => {
    renderRutas()
    // Con un solo proyecto, abrir el alta ya lo selecciona: el catálogo se pide
    // para ESE proyecto.
    await abrirAlta()
    await waitFor(() => expect(mocks.fetchOperadoresAsignablesRuta).toHaveBeenCalled())
    expect(mocks.fetchOperadoresAsignablesRuta.mock.calls[0]).toEqual(['p1'])
    expect(await screen.findByRole('option', { name: /Ana Lectora/ })).toBeTruthy()
  })

  it('sin proyecto elegido no ofrece a nadie y dice por qué', async () => {
    // Dos proyectos: el alta abre sin proyecto y no hay contra qué filtrar.
    renderRutas({ proyectos: [...PROYECTOS, { id: 'p2', nombre: 'Cascadas' } as Proyecto] })
    await abrirAlta()

    expect(mocks.fetchOperadoresAsignablesRuta).not.toHaveBeenCalled()
    expect(screen.getByText(/Elige primero el proyecto de la ruta/)).toBeTruthy()
    expect(screen.queryByRole('option', { name: /Ana Lectora/ })).toBeNull()
  })

  it('si nadie tiene acceso al proyecto lo dice, en vez de parecer vacío por error', async () => {
    mocks.fetchOperadoresAsignablesRuta.mockResolvedValue([])
    renderRutas()
    await abrirAlta()

    expect(await screen.findByText(/Ningún usuario tiene acceso a este proyecto/)).toBeTruthy()
  })

  it('el asignado que ya no está en la lista sigue visible y no se borra solo', async () => {
    // Ruta vieja asignada a alguien que perdió el acceso (o quedó de otro
    // proyecto): sin esta opción el select se vería vacío y guardar borraría la
    // asignación sin que nadie lo pidiera.
    const ruta = {
      id: 'r1', nombre: 'Ruta norte', project_id: 'p1',
      asignado_a: 'u9', asignado_nombre: 'Beto Ajeno',
      tipo_ruta: 'clientes', cliente_ids: [],
    } as unknown as Ruta
    renderRutas({ rutas: [ruta] })

    fireEvent.click(screen.getByText('Editar'))
    const select = await screen.findByLabelText('Operador') as HTMLSelectElement
    await waitFor(() => expect(mocks.fetchOperadoresAsignablesRuta).toHaveBeenCalled())

    expect(await screen.findByRole('option', { name: /Beto Ajeno \(sin acceso a este proyecto\)/ })).toBeTruthy()
    expect(select.value).toBe('u9')
  })
})
