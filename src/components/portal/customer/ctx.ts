// Contexto compartido del portal del residente (P1 #3, refactor de
// CustomerPortal). El componente conserva estado, carga de datos y handlers;
// las vistas extraídas destructuran de aquí — JSX intacto (mismo patrón que
// tabs/amenidades y tabs/visitantes).
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { Registro, UserSession } from '../../../types'
import type {
  ContadorInfo,
  LecturaInfo,
  PortalDashboardData,
  UnidadInfo,
} from '../../../lib/portalDashboard'

export interface CompanyInfo {
  id: string
  nombre: string
}

export interface ProjectInfo {
  id: string
  nombre: string
  company_id: string
  moneda: string
}

export interface ClienteContacto {
  email: string | null
  telefono: string | null
  whatsapp: string | null
  telefono_alterno: string | null
}

export interface PortalCtx {
  currentUser: UserSession

  // ── Datos cargados ──
  loading: boolean
  companies: CompanyInfo[]
  companyActivoMap: Record<string, boolean>
  projects: ProjectInfo[]
  unidades: UnidadInfo[]
  contadores: ContadorInfo[]
  lecturas: LecturaInfo[]
  registros: Registro[]

  // ── Estado de UI ──
  contactoEdit: ClienteContacto
  setContactoEdit: Dispatch<SetStateAction<ClienteContacto>>
  savingContacto: boolean
  contactoMsg: { type: 'success' | 'error'; text: string } | null
  setContactoMsg: Dispatch<SetStateAction<{ type: 'success' | 'error'; text: string } | null>>
  expandedContador: string | null
  setExpandedContador: Dispatch<SetStateAction<string | null>>
  selectedProjectId: string | null
  setSelectedProjectId: Dispatch<SetStateAction<string | null>>
  setPhotoModal: Dispatch<SetStateAction<{ registroId: string; label: string } | null>>
  chartMonthsBack: number
  setChartMonthsBack: Dispatch<SetStateAction<number>>
  chartCustomStart: string
  setChartCustomStart: Dispatch<SetStateAction<string>>
  chartCustomEnd: string
  setChartCustomEnd: Dispatch<SetStateAction<string>>
  chartRangeMode: 'preset' | 'custom'
  setChartRangeMode: Dispatch<SetStateAction<'preset' | 'custom'>>
  chartMetric: 'm3' | 'moneda'
  setChartMetric: Dispatch<SetStateAction<'m3' | 'moneda'>>
  selectedUnidadId: string | null
  setSelectedUnidadId: Dispatch<SetStateAction<string | null>>
  selectedTipoAgua: string | null
  setSelectedTipoAgua: Dispatch<SetStateAction<string | null>>

  // ── Refs / derivados ──
  chartRef: RefObject<HTMLCanvasElement>
  dashboardData: PortalDashboardData
  hasServices: boolean

  // ── Acciones ──
  guardarContacto: () => Promise<void>
}
