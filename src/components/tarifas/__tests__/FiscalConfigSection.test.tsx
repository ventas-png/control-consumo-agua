import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import type { Proyecto } from '../../../types/plataforma'
import type { ConfigFiscalEfectiva, EstatusCredencialesPac } from '../../../types/fiscal'

// serv:S11 (UI parte 2). Test de integración ligero de FiscalConfigSection:
// verifica el selector de ámbito, el selector de PAC por régimen, los chips de
// herencia (empresa vs locación) y que las credenciales guardadas NUNCA se
// renderizan (solo flags). Mockeamos contextos + capa de datos: sin red.

// ── Contextos ────────────────────────────────────────────────────────────────
const mockSession = { company_id: 'co-1', role: 'company_owner' as const }
vi.mock('../../shared/SessionContext', () => ({ useSession: () => mockSession }))
const mockPerms = { canEdit: vi.fn(() => true) }
vi.mock('../../shared/PermissionsContext', () => ({ usePermissionsContext: () => mockPerms }))
// notify/confirm no deben tocar el DOM real ni romper el render.
vi.mock('../../shared/Dialog', () => ({ notify: vi.fn(), confirm: vi.fn(async () => ({ isConfirmed: true })) }))
// supabase real lanza sin env vars: lo stubeamos (la lectura del override crudo
// pasa por runQuery, que mockeamos abajo, así que `from` no se usa de verdad).
vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) } }))

// El override CRUDO de la locación se lee con un useQuery local que pasa por
// runQuery. Mockeamos runQuery para devolver una fila controlable por test (o
// null = la locación no tiene override). Evita red y mockear react-query entero.
let rawProjectRow: Record<string, string | null> | null = null
vi.mock('../../../domain/queryFetch', () => ({
  runQuery: vi.fn(async () => (rawProjectRow ? [rawProjectRow] : [])),
}))

// ── Capa de datos (queries + mutations) ──────────────────────────────────────
vi.mock('../../../domain/fiscal/queries', () => ({
  useConfigFiscalEfectivaQuery: vi.fn(),
  useEstatusCredencialesPacQuery: vi.fn(),
}))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const guardarCredsMutate = vi.fn(async (_vars: any) => ({ ok: true }))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const probarConexionMutate = vi.fn(async (_vars: any) => ({ ok: true, mensaje: 'Conexión OK' }))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const guardarConfigMutate = vi.fn(async (_vars: any) => ({}))
vi.mock('../../../domain/fiscal/mutations', () => ({
  useGuardarConfigFiscalLocacionMutation: () => ({ mutateAsync: guardarConfigMutate, isPending: false }),
  useGuardarCredencialesPacMutation: () => ({ mutateAsync: guardarCredsMutate, isPending: false }),
  useProbarConexionPacMutation: () => ({ mutateAsync: probarConexionMutate, isPending: false }),
}))

import { FiscalConfigSection } from '../FiscalConfigSection'
import {
  useConfigFiscalEfectivaQuery,
  useEstatusCredencialesPacQuery,
} from '../../../domain/fiscal/queries'

const mockedConfig = vi.mocked(useConfigFiscalEfectivaQuery)
const mockedEstatus = vi.mocked(useEstatusCredencialesPacQuery)

const PROYECTOS = [
  { id: 'p-1', nombre: 'Condominio Norte' },
  { id: 'p-2', nombre: 'Sistema Sur' },
] as unknown as Proyecto[]

function configEfectiva(over: Partial<ConfigFiscalEfectiva> = {}): ConfigFiscalEfectiva {
  return {
    regimenFiscal: 'fel_gt',
    nombreFiscal: 'ACME SA',
    nit: '1234567-8',
    rfc: null,
    proveedorTimbrado: 'infile',
    establecimiento: null,
    lugarExpedicion: null,
    serieFiscal: null,
    desdeLocacion: false,
    ...over,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asQuery<T>(data: T, isLoading = false): any {
  return { data, isLoading, isError: false, error: null, refetch: vi.fn() }
}

// El componente usa un useQuery REAL para el override crudo (con runQuery
// mockeado), así que envolvemos en un QueryClientProvider con retry off.
function renderWithClient(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  rawProjectRow = null
  mockPerms.canEdit.mockReturnValue(true)
  mockedConfig.mockReturnValue(asQuery(configEfectiva()))
  mockedEstatus.mockReturnValue(asQuery<EstatusCredencialesPac[]>([]))
})

describe('FiscalConfigSection — render base (ámbito empresa, GT/FEL)', () => {
  it('muestra el aviso de Sandbox / timbrado real pendiente del adapter', () => {
    renderWithClient(<FiscalConfigSection proyectos={PROYECTOS} />)
    expect(screen.getByText(/Modo de pruebas/i)).toBeDefined()
    expect(screen.getByText(/adapter/i)).toBeDefined()
  })

  it('el selector de ámbito ofrece Empresa + cada locación (project)', () => {
    renderWithClient(<FiscalConfigSection proyectos={PROYECTOS} />)
    expect(screen.getByText(/Empresa \(config base\)/)).toBeDefined()
    expect(screen.getByText(/Condominio Norte/)).toBeDefined()
    expect(screen.getByText(/Sistema Sur/)).toBeDefined()
  })

  it('el selector de PAC para FEL lista Infile, Guatefacturas (G4S) y Megaprint', () => {
    renderWithClient(<FiscalConfigSection proyectos={PROYECTOS} />)
    // El PAC vive en el select cuyo valor inicial es 'infile' (de la config).
    expect(screen.getByRole('option', { name: 'Infile' })).toBeDefined()
    expect(screen.getByRole('option', { name: 'Guatefacturas (G4S)' })).toBeDefined()
    expect(screen.getByRole('option', { name: 'Megaprint' })).toBeDefined()
    // No deben aparecer los PACs de México en régimen GT.
    expect(screen.queryByRole('option', { name: 'Facturama' })).toBeNull()
  })

  it('cambia el catálogo de PAC al elegir régimen CFDI (México)', () => {
    renderWithClient(<FiscalConfigSection proyectos={PROYECTOS} />)
    const regimenSelect = screen.getByDisplayValue(/Factura Electrónica en Línea/i)
    fireEvent.change(regimenSelect, { target: { value: 'cfdi_mx' } })
    expect(screen.getByRole('option', { name: 'Facturama' })).toBeDefined()
    expect(screen.getByRole('option', { name: 'Finkok' })).toBeDefined()
    expect(screen.getByRole('option', { name: 'SW sapien' })).toBeDefined()
    expect(screen.queryByRole('option', { name: 'Infile' })).toBeNull()
  })

  it('a nivel empresa NO muestra chips de herencia', () => {
    renderWithClient(<FiscalConfigSection proyectos={PROYECTOS} />)
    expect(screen.queryByText(/Hereda de empresa/)).toBeNull()
    expect(screen.queryByText(/Propio de locación/)).toBeNull()
  })
})

describe('FiscalConfigSection — credenciales: nunca se muestran las guardadas', () => {
  it('solo muestra flags de presencia (configurado/sin configurar), nunca el secreto', () => {
    mockedEstatus.mockReturnValue(
      asQuery<EstatusCredencialesPac[]>([
        {
          id: 's1', company_id: 'co-1', project_id: null, proveedor: 'infile',
          estado_conexion: 'ok', estado_mensaje: 'Conexión OK', estado_probado_en: '2026-06-04T00:00:00Z',
          tiene_sandbox: true, tiene_prod: false, created_at: '', updated_at: '',
        },
      ]),
    )
    renderWithClient(<FiscalConfigSection proyectos={PROYECTOS} />)
    expect(screen.getByText(/configurado ✓/)).toBeDefined()
    expect(screen.getByText(/Conectado/)).toBeDefined()
    // Los inputs de credenciales arrancan VACÍOS (no se precarga ningún secreto).
    const inputs = screen.getAllByPlaceholderText(/nuevo valor/i) as HTMLInputElement[]
    expect(inputs.length).toBeGreaterThan(0)
    for (const i of inputs) expect(i.value).toBe('')
  })

  it('badge "Sin probar" cuando no hay estatus para el ámbito', () => {
    renderWithClient(<FiscalConfigSection proyectos={PROYECTOS} />)
    expect(screen.getByText(/Sin probar/)).toBeDefined()
  })
})

describe('FiscalConfigSection — herencia por locación', () => {
  it('al elegir una locación con override, marca campos propios vs heredados', async () => {
    // Config efectiva de la locación + override CRUDO (fila projects) con NIT
    // propio: eso dibuja los chips. El nombre fiscal queda NULL → heredado.
    // IMPORTANTE: referencias ESTABLES por scope (un objeto nuevo por render
    // dispararía el useEffect en bucle). react-query real ya es estable.
    const qEmpresa = asQuery(configEfectiva())
    const qLocacion = asQuery(configEfectiva({ nit: '7777777-7', desdeLocacion: true }))
    mockedConfig.mockImplementation((_companyId?: string, projectId?: string) =>
      projectId ? qLocacion : qEmpresa,
    )
    rawProjectRow = { regimen_fiscal: 'fel_gt', nit: '7777777-7', nombre_fiscal: null, nombre: null, rfc: null, proveedor_timbrado: null, establecimiento: null, lugar_expedicion: null, serie_fiscal: null }
    renderWithClient(<FiscalConfigSection proyectos={PROYECTOS} />)
    // Cambiar el ámbito a la locación p-1.
    const ambitoSelect = screen.getByDisplayValue(/Empresa \(config base\)/)
    fireEvent.change(ambitoSelect, { target: { value: 'p-1' } })
    // El override crudo carga async (runQuery): esperamos a que aparezcan los chips.
    expect((await screen.findAllByText(/Propio de locación/)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Hereda de empresa/).length).toBeGreaterThan(0)
  })

  it('una locación que hereda todo (sin override crudo) muestra el aviso de herencia total', () => {
    const qEmpresa = asQuery(configEfectiva())
    const qLocacion = asQuery(configEfectiva({ desdeLocacion: false }))
    mockedConfig.mockImplementation((_companyId?: string, projectId?: string) =>
      projectId ? qLocacion : qEmpresa,
    )
    rawProjectRow = null // sin override: hereda todo
    renderWithClient(<FiscalConfigSection proyectos={PROYECTOS} />)
    const ambitoSelect = screen.getByDisplayValue(/Empresa \(config base\)/)
    fireEvent.change(ambitoSelect, { target: { value: 'p-2' } })
    expect(screen.getByText(/hereda toda su configuración fiscal de la empresa/i)).toBeDefined()
  })
})

describe('FiscalConfigSection — gating viewer', () => {
  it('sin permiso de edición oculta los formularios pero permite probar conexión', () => {
    mockPerms.canEdit.mockReturnValue(false)
    renderWithClient(<FiscalConfigSection proyectos={PROYECTOS} />)
    expect(screen.queryByText('Guardar datos del emisor')).toBeNull()
    expect(screen.queryByText('Guardar credenciales')).toBeNull()
    // "Probar conexión" sigue disponible (lectura). El texto aparece también en el
    // aviso (entre comillas); seleccionamos el BOTÓN para desambiguar.
    expect(screen.getByRole('button', { name: /Probar conexión/ })).toBeDefined()
  })
})

describe('FiscalConfigSection — acciones invocan la capa de datos', () => {
  it('"Probar conexión" llama a la mutación con el ámbito empresa (project_id null)', () => {
    renderWithClient(<FiscalConfigSection proyectos={PROYECTOS} />)
    fireEvent.click(screen.getByRole('button', { name: /Probar conexión/ }))
    expect(probarConexionMutate).toHaveBeenCalledTimes(1)
    expect(probarConexionMutate.mock.calls[0][0]).toMatchObject({ projectId: null })
  })

  it('guardar credenciales no envía nada si ambos ambientes están vacíos', () => {
    renderWithClient(<FiscalConfigSection proyectos={PROYECTOS} />)
    fireEvent.click(screen.getByText('Guardar credenciales'))
    expect(guardarCredsMutate).not.toHaveBeenCalled()
  })

  it('guardar credenciales envía el ambiente sandbox capturado (sin tocar prod)', () => {
    renderWithClient(<FiscalConfigSection proyectos={PROYECTOS} />)
    // Captura usuario+clave en la tarjeta de Sandbox. El encabezado es un <div>;
    // su contenedor (parentElement) es la tarjeta que agrupa los inputs.
    const sandboxHeading = screen.getByText('🧪 Sandbox (pruebas)')
    const sandboxCard = sandboxHeading.parentElement as HTMLElement
    const inputs = within(sandboxCard).getAllByPlaceholderText(/nuevo valor/i) as HTMLInputElement[]
    fireEvent.change(inputs[0], { target: { value: 'mi-usuario' } })
    fireEvent.change(inputs[1], { target: { value: 'mi-clave' } })
    fireEvent.click(screen.getByText('Guardar credenciales'))
    expect(guardarCredsMutate).toHaveBeenCalledTimes(1)
    const arg = guardarCredsMutate.mock.calls[0][0]
    expect(arg.projectId).toBeNull()
    expect(arg.credenciales.sandbox).toMatchObject({ usuario: 'mi-usuario', clave: 'mi-clave' })
    expect(arg.credenciales.prod).toBeUndefined()
  })
})
