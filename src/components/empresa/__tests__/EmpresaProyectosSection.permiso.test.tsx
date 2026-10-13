// «Nuevo Proyecto»: sólo el PRINCIPAL de la empresa (propietario o superadministrador) crea proyectos. Decisión del dueño del negocio (2026-10-11): projects_insert y
// projects_delete son del principal (migración 20261026000700). Es defensa en profundidad —la pantalla /empresa sólo la abre el propietario—: el servidor manda. Editar un
// proyecto (fiscal, cobros, estado, logo) NO depende de esto: projects_update sigue abierto al administrador.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  createProyecto: vi.fn(async () => ({ error: null as string | null })),
  openTextPrompt: vi.fn(async () => 'Proyecto Norte' as string | null),
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}), auth: {} } }))
vi.mock('../../../domain/empresa/mutations', () => ({
  createProyecto: mocks.createProyecto,
  updateProyecto: vi.fn(async () => ({ error: null })),
  uploadProyectoLogo: vi.fn(async () => ({ error: null })),
}))
vi.mock('../../shared/PromptDialog', () => ({ openTextPrompt: mocks.openTextPrompt, openPromptDialog: vi.fn() }))
vi.mock('../../shared/Dialog', () => ({ notify: mocks.notify }))
vi.mock('../PlanUsageCard', () => ({ PlanUsageCard: () => null }))
vi.mock('../AmpliarPlanModal', () => ({ AmpliarPlanModal: () => null }))
vi.mock('../../shared/SecureImage', () => ({ SecureImage: () => null }))

import { EmpresaProyectosSection } from '../EmpresaProyectosSection'
import { MOTIVO_SOLO_PRINCIPAL_PROYECTOS } from '../../../domain/empresa/usuarios'

const PROYECTOS = [{ id: 'p1', nombre: 'Torre Norte', estado: 'activo' }]

function montar(extra: Partial<{ puedeCrear: boolean; max: number }> = {}) {
  const onReload = vi.fn()
  const props = {
    empresa: { id: 'c1', nombre: 'Empresa' } as never,
    proyectos: PROYECTOS as never,
    companyId: 'c1',
    effectiveMaxProjects: extra.max ?? 5,
    onReload,
  }
  render(extra.puedeCrear === undefined ? <EmpresaProyectosSection {...props} /> : <EmpresaProyectosSection {...props} puedeCrear={extra.puedeCrear} />)
  return { onReload, boton: screen.getByRole('button', { name: /Nuevo Proyecto/ }) as HTMLButtonElement }
}

beforeEach(() => { cleanup(); mocks.createProyecto.mockClear(); mocks.openTextPrompt.mockClear(); mocks.notify.mockClear() })

describe('EmpresaProyectosSection · «Nuevo Proyecto» es del principal', () => {
  it('sin puedeCrear (por omisión) el botón está deshabilitado, con la explicación, y el clic no abre nada ni crea', async () => {
    const { boton } = montar()
    expect(boton.disabled).toBe(true)
    expect(boton.title).toBe(MOTIVO_SOLO_PRINCIPAL_PROYECTOS)
    fireEvent.click(boton)
    await new Promise(r => setTimeout(r, 10))
    expect(mocks.openTextPrompt).not.toHaveBeenCalled()
    expect(mocks.createProyecto).not.toHaveBeenCalled()
  })

  it('con puedeCrear={false} (un administrador) igual', () => {
    const { boton } = montar({ puedeCrear: false })
    expect(boton.disabled).toBe(true)
    expect(boton.title).toMatch(/propietario/)
  })

  it('con puedeCrear (el principal) el botón está habilitado y crea el proyecto en la empresa', async () => {
    const { boton, onReload } = montar({ puedeCrear: true })
    expect(boton.disabled).toBe(false)
    expect(boton.title).toBe('')
    fireEvent.click(boton)
    await waitFor(() => expect(mocks.createProyecto).toHaveBeenCalledWith({ nombre: 'Proyecto Norte', company_id: 'c1' }))
    await waitFor(() => expect(onReload).toHaveBeenCalled())
  })

  it('el límite del plan sigue deshabilitando al principal, con su propio aviso', () => {
    const { boton } = montar({ puedeCrear: true, max: 1 })
    expect(boton.disabled).toBe(true)
    expect(boton.title).toMatch(/Límite del plan/)
  })

  it('editar un proyecto NO se quita a quien no es el principal (projects_update no cambió)', () => {
    montar({ puedeCrear: false })
    expect((screen.getAllByTitle('Editar proyecto')[0] as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getAllByTitle('Cambiar estado')[0] as HTMLButtonElement).disabled).toBe(false)
  })
})
