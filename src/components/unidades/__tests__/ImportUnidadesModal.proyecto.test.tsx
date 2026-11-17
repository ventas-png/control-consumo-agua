// Importar unidades: se elige el proyecto destino. Antes el importador no
// preguntaba y metía todo en el primer proyecto de la empresa (o en el del
// usuario).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { Proyecto, UserSession } from '../../../types'

const h = vi.hoisted(() => ({
  resolveUnidadProjectCompany: vi.fn(),
  insertUnidades: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify, confirm: vi.fn() }))
vi.mock('../../../domain/unidades/queries', () => ({ resolveUnidadProjectCompany: h.resolveUnidadProjectCompany }))
vi.mock('../../../domain/unidades/mutations', () => ({ insertUnidades: h.insertUnidades }))

const { ImportUnidadesModal, proyectoDestinoInicial } = await import('../ImportUnidadesModal')

const usuario = { user_id: 'u1', company_id: 'co1', role: 'admin', name: 'Admin', email: 'a@x.com' } as unknown as UserSession
const p = (id: string, nombre: string, company_id = 'co1') => ({ id, nombre, company_id }) as unknown as Proyecto
const viñas = p('p1', 'Viñas del Sur Fase 1')
const sq = p('p2', 'Edificio SQ')

function subirCsv(texto: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const archivo = new File([texto], 'unidades.csv', { type: 'text/csv' })
  fireEvent.change(input, { target: { files: [archivo] } })
}

beforeEach(() => {
  Object.values(h).forEach(m => m.mockReset())
  // Lo que el importador hacía antes por su cuenta: el primer proyecto.
  h.resolveUnidadProjectCompany.mockResolvedValue({ projectId: 'p1', companyId: 'co1' })
  h.insertUnidades.mockImplementation(async (rows: Record<string, unknown>[]) => ({ data: rows.map((r, i) => ({ id: `n${i}`, ...r })), error: null }))
})
afterEach(cleanup)

describe('proyectoDestinoInicial', () => {
  it('propone el proyecto filtrado, el único, o ninguno', () => {
    expect(proyectoDestinoInicial([viñas, sq], 'p2')).toBe('p2')
    expect(proyectoDestinoInicial([viñas], undefined)).toBe('p1')
    expect(proyectoDestinoInicial([viñas, sq], '')).toBe('')
    expect(proyectoDestinoInicial([viñas, sq], 'otro')).toBe('')
  })
})

describe('ImportUnidadesModal — proyecto destino', () => {
  it('con varios proyectos y sin filtro obliga a elegir, y crea las unidades en el elegido', async () => {
    const onImportado = vi.fn()
    render(<ImportUnidadesModal currentUser={usuario} proyectos={[viñas, sq]} onClose={() => {}} onImportado={onImportado} />)
    const selector = await screen.findByLabelText('Proyecto destino *') as HTMLSelectElement
    expect(selector.value).toBe('')

    subirCsv('nombre,tipo\nApto 1A,apartamento\nApto 1B,apartamento\n')
    const importar = await screen.findByRole('button', { name: 'Importar 2 unidades' }) as HTMLButtonElement
    expect(importar.disabled).toBe(true)
    expect(screen.getByText('Elige el proyecto destino.')).toBeTruthy()

    fireEvent.change(selector, { target: { value: 'p2' } })
    expect(importar.disabled).toBe(false)
    fireEvent.click(importar)

    await waitFor(() => expect(h.insertUnidades).toHaveBeenCalledTimes(1))
    const filas = h.insertUnidades.mock.calls[0][0] as Record<string, unknown>[]
    expect(filas.map(f => [f.nombre, f.project_id, f.company_id])).toEqual([
      ['Apto 1A', 'p2', 'co1'],
      ['Apto 1B', 'p2', 'co1'],
    ])
  })

  it('propone el proyecto filtrado en la pantalla', async () => {
    render(<ImportUnidadesModal currentUser={usuario} proyectos={[viñas, sq]} proyectoInicial="p2" onClose={() => {}} onImportado={() => {}} />)
    const selector = await screen.findByLabelText('Proyecto destino *') as HTMLSelectElement
    expect(selector.value).toBe('p2')
  })

  it('con un solo proyecto no pregunta: lo dice y lo usa', async () => {
    render(<ImportUnidadesModal currentUser={usuario} proyectos={[sq]} onClose={() => {}} onImportado={() => {}} />)
    await screen.findByText(/Las unidades se crearán en el proyecto/)
    expect(screen.getByText('Edificio SQ')).toBeTruthy()
    expect(screen.queryByLabelText('Proyecto destino *')).toBeNull()

    subirCsv('nombre,tipo\nCasa 5,casa\n')
    fireEvent.click(await screen.findByRole('button', { name: 'Importar 1 unidad' }))
    await waitFor(() => expect(h.insertUnidades).toHaveBeenCalledTimes(1))
    expect(h.insertUnidades.mock.calls[0][0][0]).toMatchObject({ project_id: 'p2', company_id: 'co1' })
  })

  it('la empresa de cada unidad es la del proyecto elegido', async () => {
    const otraEmpresa = p('p9', 'Torre Norte', 'co9')
    render(<ImportUnidadesModal currentUser={usuario} proyectos={[viñas, otraEmpresa]} proyectoInicial="p9" onClose={() => {}} onImportado={() => {}} />)
    await screen.findByLabelText('Proyecto destino *')
    subirCsv('nombre,tipo\nLocal 1,local_comercial\n')
    fireEvent.click(await screen.findByRole('button', { name: 'Importar 1 unidad' }))
    await waitFor(() => expect(h.insertUnidades).toHaveBeenCalledTimes(1))
    expect(h.insertUnidades.mock.calls[0][0][0]).toMatchObject({ project_id: 'p9', company_id: 'co9' })
  })
})
