// El contenedor de la pantalla de empresa le pasa a «Nuevo Proyecto» sólo la decisión del PRINCIPAL (propietario o superadministrador): un administrador no crea proyectos
// (projects_insert, migración 20261026000700). Todo lo demás se simula: se comprueba únicamente el cableado de `puedeCrear`.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'

const capturado = vi.hoisted(() => ({ puedeCrear: [] as unknown[] }))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}), auth: {} } }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }))
vi.mock('../../../domain/empresa/queries', () => ({
  useEmpresaSectionDataQuery: () => ({ data: { empresa: { id: 'c1', max_projects: 5 }, proyectos: [], usuarios: [] }, isLoading: false }),
}))
vi.mock('../../../hooks/usePlanLimits', () => ({ usePlanLimits: () => ({ max_projects: 5 }) }))
vi.mock('../../../lib/featureFlags', () => ({ useFeatureFlags: () => ({ has: () => false }) }))
vi.mock('../../../lib/permissions', () => ({ isExemptPlatformRole: () => true }))
vi.mock('../EmpresaProyectosSection', () => ({ EmpresaProyectosSection: (p: { puedeCrear?: boolean }) => { capturado.puedeCrear.push(p.puedeCrear); return null } }))
for (const m of ['EmpresaHeaderCard', 'EmpresaUsuariosSection', 'StripePayPalConfig', 'PayfacConfigSection', 'RecargoTarjetaConfig', 'GoogleEmailConfig', 'WhatsAppConfig', 'CompanyBrandingSection', 'SsoConfigSection']) {
  vi.doMock(`../${m}`, () => ({ [m]: () => null }))
}

beforeEach(() => { cleanup(); capturado.puedeCrear = [] })

describe('EmpresaSection · puedeCrear solo para el principal', () => {
  it.each([['company_owner', true], ['super_admin', true], ['superadmin', true], ['admin', false], ['operator', false], ['viewer', false], ['collector', false]])(
    '%s → puedeCrear=%s', async (rol, esperado) => {
      vi.resetModules()
      const { EmpresaSection } = await import('../EmpresaSection')
      render(<EmpresaSection currentUser={{ user_id: 'u1', email: '', name: 'U', role: rol, company_id: 'c1', login_time: '', expires_at: '' } as never} />)
      expect(capturado.puedeCrear).toEqual([esperado])
    })
})
