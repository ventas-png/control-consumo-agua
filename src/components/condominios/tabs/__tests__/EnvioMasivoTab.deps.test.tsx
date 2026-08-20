// Regresión react-hooks/exhaustive-deps (EnvioMasivoTab:90).
//
// El memo de vistas previas llamaba a `resolverVariables(..., proyectoNombre)`
// sin declarar `proyectoNombre`: al cambiar de condominio la previsualización
// seguía mostrando el nombre del proyecto anterior en la variable {{proyecto}},
// y ese texto es exactamente el que se envía a los residentes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { PlantillaMensajeCond, Unidad } from '../../../../types'

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
}))

const EnvioMasivoTab = (await import('../EnvioMasivoTab')).default

const plantilla = {
  id: 'pl1', nombre: 'Aviso general', canal: 'whatsapp', activa: true,
  cuerpo: 'Hola {{unidad}}, le escribe {{proyecto}}.',
} as unknown as PlantillaMensajeCond

const unidades = [{ id: 'u1', nombre: 'Apto. 2A' }] as unknown as Unidad[]

function renderTab(proyectoNombre: string) {
  return render(
    <EnvioMasivoTab
      plantillas={[plantilla]} cuotas={[]} unidades={unidades} reservas={[]}
      proyectoId="p1" companyId="c1" moneda="Q"
      proyectoNombre={proyectoNombre} onRefresh={() => {}}
    />,
  )
}

function props(proyectoNombre: string) {
  return {
    plantillas: [plantilla], cuotas: [], unidades, reservas: [],
    proyectoId: 'p1', companyId: 'c1', moneda: 'Q',
    proyectoNombre, onRefresh: () => {},
  }
}

beforeEach(cleanup)
afterEach(cleanup)

describe('EnvioMasivoTab — la vista previa reacciona a proyectoNombre', () => {
  it('resuelve {{proyecto}} con el nombre vigente y lo ACTUALIZA al cambiarlo', () => {
    const { rerender } = renderTab('Torre A')
    // Paso 1: elegir la plantilla y avanzar a la vista previa.
    fireEvent.click(screen.getByText('Aviso general'))
    fireEvent.click(screen.getByText(/Ver vista previa/))

    expect(screen.getByText(/le escribe Torre A\./)).toBeTruthy()

    rerender(<EnvioMasivoTab {...props('Torre B')} />)

    expect(screen.getByText(/le escribe Torre B\./)).toBeTruthy()
    expect(screen.queryByText(/le escribe Torre A\./)).toBeNull()
  })
})
