// Contexto compartido del feature Visitantes (P1 #3, fase B del refactor del
// tab). VisitantesTab conserva el estado y los handlers; cada bloque extraído
// recibe este objeto y destructura lo que usa — el JSX quedó idéntico al
// original (mismo patrón que tabs/amenidades/ctx.ts).
import type { Dispatch, SetStateAction } from 'react'
import type {
  HuespedSTR,
  ReservaSTR,
  SolicitudMudanzaUnidad,
  Unidad,
  Visitante,
} from '../../../../types'
import type { FiltroFechaVisitas, GruposVisitantes } from '../../../../lib/visitantesFiltros'

export interface AcompananteForm {
  tempId: string
  nombre: string
  identificacion: string
  es_menor: boolean
  fecha_nacimiento: string
  notas: string
  foto_url: string | null
  foto_documento_url: string | null
}

export const defaultAcompForm = (): Omit<AcompananteForm, 'tempId'> => ({
  nombre: '', identificacion: '', es_menor: false, fecha_nacimiento: '', notas: '', foto_url: null, foto_documento_url: null,
})

export type TipoNovedad = 'incidente' | 'observacion' | 'alarma' | 'acceso' | 'otro'
export type PrioridadNovedad = 'normal' | 'alta' | 'critica'
export type ModoSalida = 'idle' | 'sin_novedad' | 'con_novedad'

export interface FormVisita {
  unidad_id: string
  nombre: string
  identificacion: string
  placa_vehiculo: string
  motivo: string
  notas: string
}

export interface NovedadForm {
  tipo: TipoNovedad
  comentarios: string
  ubicacion: string
  prioridad: PrioridadNovedad
}

export interface VisitantesCtx extends GruposVisitantes {
  // ── Props del tab ──
  visitantes: Visitante[]
  unidades: Unidad[]
  reservasSTR: ReservaSTR[]
  solicitudesMudanza: SolicitudMudanzaUnidad[]
  proyectoId: string
  companyId: string
  userId: string
  proyectoNombre: string
  canCreate: boolean
  onRefresh: () => void

  // ── Estado compartido ──
  showForm: boolean
  setShowForm: Dispatch<SetStateAction<boolean>>
  saving: boolean
  busqueda: string
  setBusqueda: Dispatch<SetStateAction<string>>
  soloActivos: boolean
  setSoloActivos: Dispatch<SetStateAction<boolean>>
  filtroFecha: FiltroFechaVisitas
  setFiltroFecha: Dispatch<SetStateAction<FiltroFechaVisitas>>
  salidaPendiente: Visitante | null
  setSalidaPendiente: Dispatch<SetStateAction<Visitante | null>>
  modoSalida: ModoSalida
  setModoSalida: Dispatch<SetStateAction<ModoSalida>>
  guardandoSalida: boolean
  novedadForm: NovedadForm
  setNovedadForm: Dispatch<SetStateAction<NovedadForm>>
  fotosNovedad: string[]
  setFotosNovedad: Dispatch<SetStateAction<string[]>>
  visitanteDetalle: Visitante | null
  setVisitanteDetalle: Dispatch<SetStateAction<Visitante | null>>
  fotoUrl: string | null
  setFotoUrl: Dispatch<SetStateAction<string | null>>
  fotoDocumentoUrl: string | null
  setFotoDocumentoUrl: Dispatch<SetStateAction<string | null>>
  fotoVehiculoUrl: string | null
  setFotoVehiculoUrl: Dispatch<SetStateAction<string | null>>
  fotosExpiradas: { foto: boolean; documento: boolean; vehiculo: boolean }
  setFotosExpiradas: Dispatch<SetStateAction<{ foto: boolean; documento: boolean; vehiculo: boolean }>>
  showStrModal: boolean
  setShowStrModal: Dispatch<SetStateAction<boolean>>
  strSearch: string
  setStrSearch: Dispatch<SetStateAction<string>>
  strHuespedes: Record<string, HuespedSTR[]>
  strCtx: { reservaId: string; huespedId?: string } | null
  setStrCtx: Dispatch<SetStateAction<{ reservaId: string; huespedId?: string } | null>>
  showMudanzaModal: boolean
  setShowMudanzaModal: Dispatch<SetStateAction<boolean>>
  mudanzaSearch: string
  setMudanzaSearch: Dispatch<SetStateAction<string>>
  mudanzaCtx: { solicitudId: string } | null
  setMudanzaCtx: Dispatch<SetStateAction<{ solicitudId: string } | null>>
  form: FormVisita
  setForm: Dispatch<SetStateAction<FormVisita>>
  formEsMenor: boolean
  setFormEsMenor: Dispatch<SetStateAction<boolean>>
  formFechaNacimiento: string
  setFormFechaNacimiento: Dispatch<SetStateAction<string>>
  acompanantes: AcompananteForm[]
  setAcompanantes: Dispatch<SetStateAction<AcompananteForm[]>>
  showAcompForm: boolean
  setShowAcompForm: Dispatch<SetStateAction<boolean>>
  acompForm: Omit<AcompananteForm, 'tempId'>
  setAcompForm: Dispatch<SetStateAction<Omit<AcompananteForm, 'tempId'>>>
  salidaConAcomp: boolean
  setSalidaConAcomp: Dispatch<SetStateAction<boolean>>

  // ── Derivados (lib/visitantesFiltros) ──
  hoy: string
  filtrados: Visitante[]
  sugerencias: Visitante[]
  acompSugerencias: Visitante[]
  mudanzasElegibles: SolicitudMudanzaUnidad[]

  // ── Acciones ──
  resetForm: () => void
  abrirRegistroMudanza: (s: SolicitudMudanzaUnidad) => void
  abrirRegistroSTR: (r: ReservaSTR, huesped?: HuespedSTR) => void
  autocompletar: (v: Visitante) => void
  autocompletarAcompanante: (v: Visitante) => void
  agregarAcompanante: () => void
  quitarAcompanante: (tempId: string) => void
  handleRegistrar: () => Promise<void>
  iniciarSalida: (v: Visitante) => void
  cancelarSalida: () => void
  confirmarSalida: () => Promise<void>
}
