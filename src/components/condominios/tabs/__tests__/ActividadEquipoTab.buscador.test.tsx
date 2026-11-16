// Actividad equipo — el buscador de la tabla acota por persona o por rol, sin
// distinguir acentos; los totales del período no cambian. La pestaña es un
// informe de solo lectura (RPC actividad_equipo): no hay formulario que mover.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { ActividadUsuario } from '../../../../domain/condominios/actividad'

const h = vi.hoisted(() => ({ useActividadEquipo: vi.fn() }))
vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/actividad', () => ({ useActividadEquipo: h.useActividadEquipo }))
// La celda de persona resuelve el nombre con una consulta real; aquí basta el id.
vi.mock('../../../shared/UsuarioChip', () => ({ UsuarioChip: ({ userId }: { userId: string }) => <span>{userId}</span> }))

const ActividadEquipoTab = (await import('../ActividadEquipoTab')).default

const fila = (over: Partial<ActividadUsuario>): ActividadUsuario => ({
  usuario_id: 'u1', usuario_nombre: 'Lecturista Ana', usuario_rol: 'lecturista',
  lecturas: 5, lecturas_m3: 50, limpiezas: 0, checklists: 0, rondas_iniciadas: 0, puntos_marcados: 0,
  visitas_registradas: 0, paquetes: 0, solicitudes_creadas: 0, tareas_cerradas: 0, total: 5,
  ultima_actividad: null, ...over,
})
const filas = [
  fila({ usuario_id: 'u1', usuario_nombre: 'Lecturista Ana', usuario_rol: 'lecturista', lecturas: 5, total: 5 }),
  fila({ usuario_id: 'u2', usuario_nombre: 'José Pérez', usuario_rol: 'guardia', lecturas: 0, rondas_iniciadas: 9, total: 9 }),
]
const visibles = () => ['u1', 'u2'].filter(id => screen.queryByText(id))

beforeEach(() => { h.useActividadEquipo.mockReset(); h.useActividadEquipo.mockReturnValue({ data: filas, isLoading: false, isError: false, error: null }) })
afterEach(cleanup)

describe('Actividad equipo · buscador', () => {
  it('acota por persona o rol sin distinguir acentos; los totales del período no cambian', () => {
    render(<ActividadEquipoTab proyectoId="p1" companyId="c1" />)
    expect(visibles()).toEqual(['u1', 'u2'])
    // El icono acompaña a la etiqueta en el mismo nodo: se busca por regex y se lee la tarjeta entera.
    const tile = () => screen.getByText(/Personas activas/).parentElement!.textContent
    expect(tile()).toContain('2')

    const buscador = screen.getByRole('searchbox', { name: 'Buscar persona o rol' })
    fireEvent.change(buscador, { target: { value: 'perez' } })
    expect(visibles()).toEqual(['u2'])
    expect(tile()).toContain('2')
    fireEvent.change(buscador, { target: { value: 'LECTURISTA' } })
    expect(visibles()).toEqual(['u1'])
    fireEvent.change(buscador, { target: { value: 'guardia' } })
    expect(visibles()).toEqual(['u2'])
    fireEvent.change(buscador, { target: { value: 'zzz' } })
    expect(visibles()).toEqual([])
    fireEvent.change(buscador, { target: { value: '' } })
    expect(visibles()).toEqual(['u1', 'u2'])
  })
})
