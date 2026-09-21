// Contexto del feature Seguridad (P1 #3, refactor de SeguridadTab). El tab
// conserva estado/handlers; los bloques extraídos destructuran de aquí — JSX
// intacto (mismo patrón que tabs/amenidades, tabs/visitantes y rutas).
import type { Dispatch, SetStateAction } from 'react'
import type {
  AreaCondominio, EstadoRonda, EstadoVisitaControl, NovedadSeguridad, PrioridadNovedad,
  PuntoControlRuta, ReservaSTR, RondaSeguridad, RutaRonda, TipoNovedad,
  Unidad, VisitaControl, Visitante,
} from '../../../../types'

/**
 * La parada que se está cerrando en el modal de marcaje. `punto` va entero (no
 * solo su id) porque el modal necesita su nombre, sus instrucciones y su
 * exigencia de foto, que se resuelve con `puntoExigeFoto`.
 */
export interface MarcaPuntoState {
  visitaId: string
  punto: PuntoControlRuta
  estado: Extract<EstadoVisitaControl, 'ok' | 'novedad'>
}

export interface NovedadFormState {
  tipo: TipoNovedad
  descripcion: string
  ubicacion: string
  prioridad: PrioridadNovedad
  ronda_id: string
}

export interface RegFormState {
  nombre: string
  unidad_id: string
  placa_vehiculo: string
  motivo: string
  notas: string
  identificacion: string
}

export interface SeguridadCtx {
  // ── Props del tab ──
  rondas: RondaSeguridad[]
  novedades: NovedadSeguridad[]
  rutas: RutaRonda[]
  puntosControl: PuntoControlRuta[]
  visitasControl: VisitaControl[]
  areas: AreaCondominio[]
  unidades: Unidad[]
  reservasSTR: ReservaSTR[]
  proyectoId: string
  canCreate: boolean
  canEdit: boolean

  // ── Estado compartido ──
  saving: boolean
  filtroPrioridad: PrioridadNovedad | 'todos'
  setFiltroPrioridad: Dispatch<SetStateAction<PrioridadNovedad | 'todos'>>
  novedadDetalle: NovedadSeguridad | null
  setNovedadDetalle: Dispatch<SetStateAction<NovedadSeguridad | null>>
  novedadForm: NovedadFormState
  setNovedadForm: Dispatch<SetStateAction<NovedadFormState>>
  fotosNovedadForm: string[]
  setFotosNovedadForm: Dispatch<SetStateAction<string[]>>
  rondaForm: { notas: string; ruta_id: string }
  setRondaForm: Dispatch<SetStateAction<{ notas: string; ruta_id: string }>>
  marcandoPunto: MarcaPuntoState | null
  setMarcandoPunto: Dispatch<SetStateAction<MarcaPuntoState | null>>
  notasPunto: string
  setNotasPunto: Dispatch<SetStateAction<string>>
  fotosPunto: string[]
  setFotosPunto: Dispatch<SetStateAction<string[]>>
  setShowNovedadForm: Dispatch<SetStateAction<boolean>>
  setShowRondaForm: Dispatch<SetStateAction<boolean>>

  // ── Accesos / verificación visitante ──
  modoModal: 'dpi' | 'str'
  strSearch: string
  setStrSearch: Dispatch<SetStateAction<string>>
  dpiSearch: string
  setDpiSearch: Dispatch<SetStateAction<string>>
  searchResult: 'idle' | 'found' | 'not_found'
  setSearchResult: Dispatch<SetStateAction<'idle' | 'found' | 'not_found'>>
  searchResultVisitantes: Visitante[]
  setSearchResultVisitantes: Dispatch<SetStateAction<Visitante[]>>
  searching: boolean
  showRegForm: boolean
  setShowRegForm: Dispatch<SetStateAction<boolean>>
  regSaving: boolean
  fotoPersonaUrl: string | null
  setFotoPersonaUrl: Dispatch<SetStateAction<string | null>>
  fotoDocumentoUrl: string | null
  setFotoDocumentoUrl: Dispatch<SetStateAction<string | null>>
  fotoVehiculoUrl: string | null
  setFotoVehiculoUrl: Dispatch<SetStateAction<string | null>>
  fotosExpiradas: { foto: boolean; documento: boolean; vehiculo: boolean }
  regForm: RegFormState
  setRegForm: Dispatch<SetStateAction<RegFormState>>
  strIngresados: Set<string>

  // ── Derivados ──
  rondaEnCurso: RondaSeguridad | undefined
  novedadesFiltradas: NovedadSeguridad[]
  visitasRondaActual: VisitaControl[]
  puntosRondaActual: PuntoControlRuta[]
  puntosCompletados: number
  progreso: number
  rutasActivas: RutaRonda[]

  // ── Acciones ──
  iniciarRonda: () => Promise<void>
  finalizarRonda: (id: string, estado: EstadoRonda) => Promise<void>
  marcarVisita: (visitaId: string, estado: EstadoVisitaControl, notas?: string, fotos?: string[]) => Promise<void>
  /** Abre el modal de cierre (novedad, o punto que exige imagen). */
  abrirMarcaPunto: (visitaId: string, punto: PuntoControlRuta, estado: 'ok' | 'novedad') => void
  /** Cierra la parada con lo capturado en el modal. */
  confirmarMarcaPunto: () => Promise<void>
  registrarNovedad: () => Promise<void>
  eliminarNovedad: (id: string) => Promise<void>
  resetAccesos: () => void
  cambiarModo: (modo: 'dpi' | 'str') => void
  precargarDesdeSTR: (r: ReservaSTR) => void
  buscarPorDpi: () => Promise<void>
  handleRegistrarAcceso: () => Promise<void>
}
