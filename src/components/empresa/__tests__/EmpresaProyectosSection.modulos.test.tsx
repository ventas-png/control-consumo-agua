// Módulos por proyecto en «Mis Proyectos» (migración 20261127000000): cada tarjeta muestra los módulos activos del proyecto y el principal los elige con «Módulos».
// Sólo se envían los interruptores de los módulos CONTRATADOS. La base repite las reglas (trg_projects_modulos_guard): supabase/tests/modulos_por_proyecto.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  updateProyecto: vi.fn(async () => ({ error: null as string | null })),
  openPromptDialog: vi.fn(async (): Promise<Record<string, string> | null> => null),
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}), auth: {} } }))
vi.mock('../../../domain/empresa/mutations', () => ({
  createProyecto: vi.fn(async () => ({ error: null })),
  updateProyecto: mocks.updateProyecto,
  uploadProyectoLogo: vi.fn(async () => ({ error: null })),
}))
vi.mock('../../shared/PromptDialog', () => ({ openTextPrompt: vi.fn(), openPromptDialog: mocks.openPromptDialog }))
vi.mock('../../shared/Dialog', () => ({ notify: mocks.notify }))
vi.mock('../PlanUsageCard', () => ({ PlanUsageCard: () => null }))
vi.mock('../AmpliarPlanModal', () => ({ AmpliarPlanModal: () => null }))
vi.mock('../../shared/SecureImage', () => ({ SecureImage: () => null }))

import { EmpresaProyectosSection } from '../EmpresaProyectosSection'
import type { ModuloServicio } from '../../../lib/modulosProyecto'

const PROYECTOS = [
  { id: 'p1', nombre: 'Torre Norte', estado: 'activo', modulo_agua: true, modulo_condominios: true, modulo_rentas: true },
  { id: 'p2', nombre: 'Lotes Sur', estado: 'activo', modulo_agua: true, modulo_condominios: false, modulo_rentas: false },
]
const TRES: ModuloServicio[] = ['agua', 'condominios', 'rentas']

function montar(extra: { contratados?: ModuloServicio[]; puedeElegir?: boolean } = {}) {
  const onReload = vi.fn()
  const onModulosCambiados = vi.fn()
  render(
    <EmpresaProyectosSection
      empresa={{ id: 'c1', nombre: 'Empresa' } as never}
      proyectos={PROYECTOS as never}
      companyId="c1"
      effectiveMaxProjects={5}
      onReload={onReload}
      puedeCrear
      modulosContratados={extra.contratados ?? TRES}
      puedeElegirModulos={extra.puedeElegir ?? true}
      onModulosCambiados={onModulosCambiados}
    />,
  )
  return { onReload, onModulosCambiados }
}
const chips = () => screen.getAllByLabelText('Módulos activos').map(c => c.textContent)

beforeEach(() => { cleanup(); mocks.updateProyecto.mockClear(); mocks.openPromptDialog.mockReset(); mocks.notify.mockClear() })

describe('EmpresaProyectosSection · módulos por proyecto', () => {
  it('cada tarjeta muestra los módulos activos de su proyecto', () => {
    montar()
    const [torre, lotes] = chips()
    expect(torre).toMatch(/Agua.*Condominios.*Rentas/)
    expect(lotes).toMatch(/Agua/)
    expect(lotes).not.toMatch(/Condominios|Rentas/)
  })

  it('con un solo módulo contratado no hay nada que elegir: ni chips ni botón', () => {
    montar({ contratados: ['agua'] })
    expect(screen.queryByLabelText('Módulos activos')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Módulos' })).toBeNull()
  })

  it('quien no es el principal (o sin la migración) ve los chips pero no el botón', () => {
    montar({ puedeElegir: false })
    expect(chips()).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Módulos' })).toBeNull()
  })

  it('«Módulos» abre el diálogo con los contratados marcados según el proyecto y guarda sólo esos interruptores', async () => {
    mocks.openPromptDialog.mockResolvedValueOnce({ agua: 'true', condominios: 'true' })
    const { onReload, onModulosCambiados } = montar({ contratados: ['agua', 'condominios'] })
    fireEvent.click(screen.getAllByRole('button', { name: 'Módulos' })[2]) // primera acción de «Lotes Sur» (lateral)
    await waitFor(() => expect(mocks.updateProyecto).toHaveBeenCalled())
    const opciones = mocks.openPromptDialog.mock.calls[0] as unknown as [{ title: string; fields: Array<{ name: string; initialValue: string }> }]
    expect(opciones[0].title).toBe('Módulos de Lotes Sur')
    expect(opciones[0].fields.map(f => [f.name, f.initialValue])).toEqual([['agua', 'true'], ['condominios', '']])
    expect(mocks.updateProyecto).toHaveBeenCalledWith('p2', { modulo_agua: true, modulo_condominios: true })
    await waitFor(() => expect(onModulosCambiados).toHaveBeenCalled())
    expect(onReload).toHaveBeenCalled()
  })

  it('el diálogo no deja guardar un proyecto sin módulos', async () => {
    montar()
    fireEvent.click(screen.getAllByRole('button', { name: 'Módulos' })[0])
    await waitFor(() => expect(mocks.openPromptDialog).toHaveBeenCalled())
    const opciones = mocks.openPromptDialog.mock.calls[0] as unknown as [{ validate: (d: Record<string, string>) => string | null }]
    expect(opciones[0].validate({ agua: '', condominios: '', rentas: '' })).toMatch(/al menos un módulo/)
    expect(opciones[0].validate({ agua: '', condominios: '', rentas: 'true' })).toBeNull()
    expect(mocks.updateProyecto).not.toHaveBeenCalled()
  })

  it('si la base lo rechaza por no ser el principal, lo dice y no refresca', async () => {
    mocks.openPromptDialog.mockResolvedValueOnce({ agua: 'true', condominios: '', rentas: '' })
    mocks.updateProyecto.mockResolvedValueOnce({ error: 'MODULOS_PROYECTO_SOLO_PRINCIPAL: sólo el propietario…' })
    const { onReload } = montar()
    fireEvent.click(screen.getAllByRole('button', { name: 'Módulos' })[0])
    await waitFor(() => expect(mocks.notify).toHaveBeenCalled())
    expect(mocks.notify.mock.calls[0][0]).toMatchObject({ variant: 'error', text: expect.stringMatching(/propietario/) })
    expect(onReload).not.toHaveBeenCalled()
  })
})
