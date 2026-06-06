// T7/PR3 — Contrato de las escrituras de administración de empresa
// (empresa/mutations): update de company/proyecto y subida de logos (tabla +
// storage). Mock encadenable thenable + supabase.storage.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state: { result: unknown; upload: unknown; calls: Array<[string, ...unknown[]]> } = {
    result: { error: null }, upload: { error: null }, calls: [],
  }
  const builder: Record<string, unknown> = {}
  for (const m of ['update', 'insert', 'eq']) {
    builder[m] = (...args: unknown[]) => { state.calls.push([m, ...args]); return builder }
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(state.result)
  const uploadFn = vi.fn(async (...args: unknown[]) => { state.calls.push(['upload', ...args]); return state.upload })
  return { state, builder, uploadFn }
})

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => h.builder,
    storage: { from: (bucket: string) => { h.state.calls.push(['storage.from', bucket]); return { upload: h.uploadFn } } },
  },
}))

import {
  updateEmpresa,
  uploadEmpresaLogo,
  createProyecto,
  updateProyecto,
  uploadProyectoLogo,
} from '../mutations'

beforeEach(() => {
  h.state.result = { error: null }
  h.state.upload = { error: null }
  h.state.calls = []
  h.uploadFn.mockClear()
})

function makeFile(name = 'logo.PNG') {
  return { name, type: 'image/png' } as unknown as File
}

describe('company/proyecto updates', () => {
  it('updateEmpresa éxito', async () => {
    h.state.result = { error: null }
    expect(await updateEmpresa('co1', { nombre: 'X' })).toEqual({ error: null })
    expect(h.state.calls).toContainEqual(['eq', 'id', 'co1'])
  })

  it('updateEmpresa error → mensaje legible', async () => {
    h.state.result = { error: { message: 'denied' } }
    expect(await updateEmpresa('co1', {})).toEqual({ error: 'denied' })
  })

  it('createProyecto éxito', async () => {
    h.state.result = { error: null }
    expect(await createProyecto({ nombre: 'P', company_id: 'co1' })).toEqual({ error: null })
  })

  it('updateProyecto error → mensaje legible', async () => {
    h.state.result = { error: { message: 'rls' } }
    expect(await updateProyecto('p1', { estado: 'inactivo' })).toEqual({ error: 'rls' })
    expect(h.state.calls).toContainEqual(['eq', 'id', 'p1'])
  })
})

describe('logos (storage + tabla)', () => {
  it('uploadEmpresaLogo sube a company-logos y persiste logo_url', async () => {
    h.state.upload = { error: null }
    h.state.result = { error: null }
    expect(await uploadEmpresaLogo('co1', makeFile())).toEqual({ error: null })
    expect(h.state.calls).toContainEqual(['storage.from', 'company-logos'])
    // el path se arma como <id>/logo-<ts>.<ext> con ext en minúscula
    const uploadCall = h.state.calls.find(c => c[0] === 'upload')
    expect(String(uploadCall?.[1])).toMatch(/^co1\/logo-\d+\.png$/)
    const updateCall = h.state.calls.find(c => c[0] === 'update')
    expect(updateCall?.[1]).toHaveProperty('logo_url')
  })

  it('uploadEmpresaLogo: si falla el upload, no toca la BD', async () => {
    h.state.upload = { error: { message: 'storage full' } }
    expect(await uploadEmpresaLogo('co1', makeFile())).toEqual({ error: 'storage full' })
    expect(h.state.calls.some(c => c[0] === 'update')).toBe(false)
  })

  it('uploadProyectoLogo sube a project-logos', async () => {
    h.state.upload = { error: null }
    h.state.result = { error: null }
    expect(await uploadProyectoLogo('p1', makeFile())).toEqual({ error: null })
    expect(h.state.calls).toContainEqual(['storage.from', 'project-logos'])
  })
})
