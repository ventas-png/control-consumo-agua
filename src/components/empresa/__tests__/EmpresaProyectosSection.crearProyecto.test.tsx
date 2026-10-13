// EmpresaProyectosSection: la guarda DENTRO de crearProyecto() (no sólo el atributo `disabled` del botón) y un alta del propietario con promesa controlada.
// Quitar `!puedeCrear` de crearProyecto() deja la prueba P1 en rojo (fireEvent.click sobre un botón deshabilitado nunca llama al manejador; aquí se invoca directamente).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'

const h = vi.hoisted(() => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void
    const promise = new Promise<T>((res) => { resolve = res })
    return { promise, resolve }
  }
  return {
    deferred,
    createProyecto: vi.fn(async (_p: Record<string, unknown>) => ({ error: null as string | null })),
    openTextPrompt: vi.fn(async () => 'Proyecto Norte' as string | null),
    notify: vi.fn(),
  }
})

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}), auth: {} } }))
vi.mock('../../../domain/empresa/mutations', () => ({
  createProyecto: h.createProyecto,
  updateProyecto: vi.fn(async () => ({ error: null })),
  uploadProyectoLogo: vi.fn(async () => ({ error: null })),
}))
vi.mock('../../shared/PromptDialog', () => ({ openTextPrompt: h.openTextPrompt, openPromptDialog: vi.fn() }))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify }))
vi.mock('../PlanUsageCard', () => ({ PlanUsageCard: () => null }))
vi.mock('../AmpliarPlanModal', () => ({ AmpliarPlanModal: () => null }))
vi.mock('../../shared/SecureImage', () => ({ SecureImage: () => null }))

import { EmpresaProyectosSection } from '../EmpresaProyectosSection'

const props = (extra: Record<string, unknown> = {}) => ({
  empresa: { id: 'c1', nombre: 'Empresa' } as never,
  proyectos: [{ id: 'p1', nombre: 'Torre Norte', estado: 'activo' }] as never,
  companyId: 'c1',
  effectiveMaxProjects: 5,
  onReload: vi.fn(),
  ...extra,
})
function forzarClick(el: HTMLElement) {
  const clave = Object.keys(el).find(k => k.startsWith('__reactProps$'))!
  ;(el as unknown as Record<string, { onClick?: () => void }>)[clave].onClick?.()
}

beforeEach(() => { cleanup(); h.createProyecto.mockClear(); h.openTextPrompt.mockClear(); h.notify.mockClear() })

describe('EmpresaProyectosSection.crearProyecto', () => {
  it('P1 · quien NO es el principal: aunque se invoque el handler del botón deshabilitado (Enter, lector de pantalla, código) no se abre el diálogo ni se crea nada', async () => {
    render(<EmpresaProyectosSection {...props({ puedeCrear: false })} />)
    const boton = screen.getByRole('button', { name: /Nuevo Proyecto/ }) as HTMLButtonElement
    expect(boton.disabled).toBe(true)
    forzarClick(boton)
    await act(async () => { await Promise.resolve() })
    expect(h.openTextPrompt).not.toHaveBeenCalled()
    expect(h.createProyecto).not.toHaveBeenCalled()
  })

  it('P2 · el propietario con el diálogo EN VUELO (promesa sin resolver): no se crea nada hasta que responde; al responder se crea UNA vez con su empresa y se recarga', async () => {
    const dialogo = h.deferred<string | null>()
    h.openTextPrompt.mockImplementation(() => dialogo.promise as never)
    const p = props({ puedeCrear: true })
    render(<EmpresaProyectosSection {...p} />)
    fireEvent.click(screen.getByRole('button', { name: /Nuevo Proyecto/ }))
    await waitFor(() => expect(h.openTextPrompt).toHaveBeenCalledTimes(1))
    expect(h.createProyecto).not.toHaveBeenCalled()
    await act(async () => { dialogo.resolve('  Torre Sur  ') })
    await waitFor(() => expect(h.createProyecto).toHaveBeenCalledTimes(1))
    expect(h.createProyecto).toHaveBeenCalledWith({ nombre: 'Torre Sur', company_id: 'c1' })
    await waitFor(() => expect(p.onReload).toHaveBeenCalledTimes(1))
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Proyecto creado' }))
  })

  it('P3 · si el servidor rechaza el alta (RLS) el propietario ve el error y NO se recarga', async () => {
    h.createProyecto.mockResolvedValueOnce({ error: 'new row violates row-level security policy for table "projects"' })
    const p = props({ puedeCrear: true })
    render(<EmpresaProyectosSection {...p} />)
    fireEvent.click(screen.getByRole('button', { name: /Nuevo Proyecto/ }))
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' })))
    expect(p.onReload).not.toHaveBeenCalled()
  })
})
