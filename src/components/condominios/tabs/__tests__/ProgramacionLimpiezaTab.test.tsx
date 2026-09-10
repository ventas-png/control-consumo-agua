// Corrección 6 (integración con Limpieza): el módulo Limpieza consume EL MISMO
// catálogo de actividades que el tab Plantillas —el componente compartido
// ActividadesCatalog— filtrado de entrada por servicio = limpieza y en modo
// consulta, sin implementación paralela ni permisos del módulo Seguridad.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type {
  AreaCondominio, ItemInventario, PersonalCondominio,
  PlantillaTareaCargo, ProgramacionLimpieza, SuministroCondominio,
} from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  updateCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null as { message: string; code?: string } | null })),
  fetchRecursosPlantillas: vi.fn(async () => ({
    suministros: [] as Array<Record<string, unknown>>,
    herramientas: [] as Array<Record<string, unknown>>,
    error: null as { message: string } | null,
  })),
  openPromptDialog: vi.fn(async () => null as Record<string, string> | null),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
  irATab: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: () => ({}) },
  db: { from: () => ({}) },
}))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../../domain/condominios/tabQueries', () => ({
  fetchRecursosPlantillas: mocks.fetchRecursosPlantillas,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: mocks.openPromptDialog }))
vi.mock('../../../shared/ImageUploader', () => ({ MultiImageUploader: () => null }))
vi.mock('../../../shared/ImageGallery', () => ({ ImageGallery: () => null }))

const { ProgramacionLimpiezaTab } = await import('../ProgramacionLimpiezaTab')

const area: AreaCondominio = {
  id: 'area1', company_id: 'co1', project_id: 'p1', nombre: 'Piscina',
  descripcion: null, icono: '🏊', orden: 0, activo: true,
  created_at: '2026-01-01T00:00:00.000Z',
}

const programacion: ProgramacionLimpieza = {
  id: 'prog1', company_id: 'co1', project_id: 'p1', area: 'Piscina', area_id: 'area1',
  frecuencia: 'semanal', estado: 'pendiente', activo: true,
  created_at: '2026-01-01T00:00:00.000Z', orden: 0, requiere_foto: true,
}

function plantilla(over: Partial<PlantillaTareaCargo> = {}): PlantillaTareaCargo {
  return {
    id: 'pl1', company_id: 'co1', project_id: 'p1', cargo: 'conserje',
    titulo: 'Limpiar lobby', descripcion: null, icono: '🧹', orden: 1,
    area_id: null, requiere_foto: false, activo: true,
    created_at: '2026-01-01T00:00:00.000Z',
    servicio: 'limpieza', duracion_estimada_min: 45, checklist: [],
    instrucciones_seguridad: null, requiere_comentario: false, requiere_checklist: false,
    ...over,
  }
}

const personal: PersonalCondominio[] = []
const suministros: SuministroCondominio[] = []
const inventario: ItemInventario[] = []

function renderTab(props: Partial<Parameters<typeof ProgramacionLimpiezaTab>[0]> = {}) {
  return render(
    <ProgramacionLimpiezaTab
      programaciones={[programacion]}
      ejecuciones={[]}
      personal={personal}
      areas={[area]}
      plantillas={[plantilla(), plantilla({ id: 'pl2', titulo: 'Podar setos', servicio: 'jardineria', cargo: 'jardinero' })]}
      suministros={suministros}
      inventario={inventario}
      proyectoId="p1"
      companyId="co1"
      canCreate
      canEdit
      canDelete
      puedeConfigurarAreas
      onIrATab={mocks.irATab}
      onRefresh={() => {}}
      {...props}
    />,
  )
}

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockClear())
  mocks.fetchRecursosPlantillas.mockResolvedValue({ suministros: [], herramientas: [], error: null })
})

afterEach(() => { cleanup() })

describe('ProgramacionLimpiezaTab — catálogo de actividades compartido', () => {
  it('la vista Actividades abre filtrada por servicio = limpieza', async () => {
    renderTab()
    fireEvent.click(screen.getByText(/Actividades/))
    await waitFor(() => expect(screen.getByText('Actividades de limpieza')).toBeTruthy())

    const filtro = screen.getByLabelText('Filtrar por servicio') as HTMLSelectElement
    expect(filtro.value).toBe('limpieza')
    // Solo la actividad de limpieza; la de jardinería queda fuera del filtro.
    expect(screen.getByText('Limpiar lobby')).toBeTruthy()
    expect(screen.queryByText('Podar setos')).toBeNull()
  })

  it('es CONSULTA: no ofrece crear ni editar el catálogo desde Limpieza', async () => {
    renderTab()
    fireEvent.click(screen.getByText(/Actividades/))
    await waitFor(() => expect(screen.getByText('Actividades de limpieza')).toBeTruthy())

    expect(screen.queryByText('+ Nueva actividad')).toBeNull()
    expect(screen.queryByText('✏️ Editar')).toBeNull()
    expect(screen.queryByLabelText('Eliminar Limpiar lobby')).toBeNull()
    expect(screen.getByText(/se administra en Seguridad → Plantillas/)).toBeTruthy()
  })

  it('muestra la receta de la actividad en consulta (sin poder alterarla)', async () => {
    mocks.fetchRecursosPlantillas.mockResolvedValue({
      suministros: [{
        id: 'pts1', company_id: 'co1', project_id: 'p1', plantilla_tarea_id: 'pl1',
        suministro_id: 'sum1', cantidad: 0.5, created_at: '2026-01-01T00:00:00.000Z',
        suministro_nombre: 'Cloro', unidad_medida: 'litro', suministro_activo: true,
      }],
      herramientas: [], error: null,
    })
    renderTab()
    fireEvent.click(screen.getByText(/Actividades/))
    await waitFor(() => expect(screen.getByText('🧴 1 insumo')).toBeTruthy())

    fireEvent.click(screen.getByLabelText('Recursos de Limpiar lobby'))
    expect(screen.getByText(/Cloro — 0.5 litro/)).toBeTruthy()
    // En consulta no hay selectores de alta ni avisos de guardado inmediato.
    expect(screen.queryByLabelText('Insumo a agregar')).toBeNull()
    expect(screen.queryByText(/se guardan al instante/)).toBeNull()
  })

  // El alta de áreas se mudó a su propio tab: Limpieza las MUESTRA para saber
  // qué se puede programar, pero no las crea ni las edita. Es la mitad del
  // arreglo del punto único de creación (la otra mitad vive en RutasRondaTab).
  it('la vista Áreas del catálogo es de solo lectura', () => {
    renderTab()
    fireEvent.click(screen.getByText(/Áreas del catálogo/))
    expect(screen.getByText('Piscina')).toBeTruthy()
    expect(screen.queryByText('+ Nueva área')).toBeNull()
    expect(screen.queryByText('✏️ Editar')).toBeNull()
    expect(screen.queryByLabelText('Eliminar Piscina')).toBeNull()
    expect(screen.queryByText('Desactivar')).toBeNull()
  })

  it('ofrece el atajo al tab Áreas a quien puede verlo', () => {
    renderTab()
    fireEvent.click(screen.getByText(/Áreas del catálogo/))
    fireEvent.click(screen.getByText(/Configurar áreas/))
    expect(mocks.irATab).toHaveBeenCalledWith('areas_config')
  })

  it('sin visibilidad del tab Áreas, explica dónde se administran en vez de ofrecer el atajo', () => {
    renderTab({ puedeConfigurarAreas: false })
    fireEvent.click(screen.getByText(/Áreas del catálogo/))
    expect(screen.queryByText(/Configurar áreas/)).toBeNull()
    expect(screen.getByText(/Sin acceso al tab Áreas/)).toBeTruthy()
  })
})
