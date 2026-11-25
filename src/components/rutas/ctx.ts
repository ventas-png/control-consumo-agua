// Contexto del feature Rutas (P1 #3, refactor de RutasSection). La sección
// conserva estado/handlers; el editor y la card destructuran de aquí — JSX
// intacto (mismo patrón que unidades, clientes, portal/customer y tabs/*).
import type { Dispatch, DragEvent, MutableRefObject, SetStateAction } from 'react'
import type { Cliente, Contador, Proyecto, Ruta, Unidad } from '../../types'
import type { AppUser } from '../../domain/usuarios/queries'
import type { RutaForm, TipoRuta } from '../../lib/rutasReglas'

export const EMPTY_FORM: RutaForm = {
  nombre: '',
  descripcion: '',
  project_id: '',
  fecha_programada: '',
  asignado_a: '',
  asignado_nombre: '',
  asignado_email: '',
  asignado_telefono: '',
  // Periodicidad
  frecuencia: 'unica',
  dias_semana: [],
  intervalo_dias: '14',
  dia_mes: '1',
  fechas_especificas: [],
  hora_programada: '',
  recurrencia_activa: true,
  fecha_inicio: '',
  fecha_fin: '',
  recordatorio_anticipacion_min: 1440,
  recordatorio_canales: ['email', 'app'],
}

export interface RutasCtx {
  // ── Props de la sección ──
  clientes: Cliente[]
  contadores: Contador[]
  unidades: Unidad[]
  proyectos: Proyecto[]
  canEdit: boolean
  canDelete: boolean
  onEjecutarRuta: (ruta: Ruta) => void

  // ── Estado compartido ──
  editando: Ruta | null
  form: RutaForm
  setForm: Dispatch<SetStateAction<RutaForm>>
  tipoRuta: TipoRuta
  setTipoRuta: Dispatch<SetStateAction<TipoRuta>>
  clientesEnRuta: Cliente[]
  contadoresEnRuta: Contador[]
  setContadoresEnRuta: Dispatch<SetStateAction<Contador[]>>
  unidadesEnRuta: Unidad[]
  setUnidadesEnRuta: Dispatch<SetStateAction<Unidad[]>>
  busqueda: string
  setBusqueda: Dispatch<SetStateAction<string>>
  saving: boolean
  recordandoId: string | null
  nuevaFecha: string
  setNuevaFecha: Dispatch<SetStateAction<string>>
  usuarios: AppUser[]
  draggingIdx: number | null
  setDraggingIdx: Dispatch<SetStateAction<number | null>>
  dragOver: MutableRefObject<number | null>

  // ── Derivados ──
  hoy: string
  clientesDisponibles: Cliente[]
  contadoresDisponibles: Contador[]
  unidadesDisponibles: Unidad[]

  // ── Acciones ──
  abrirEditar: (ruta: Ruta) => void
  cancelar: () => void
  handleProjectChange: (projectId: string) => void
  handleUsuarioChange: (userId: string) => void
  toggleDiaSemana: (iso: number) => void
  agregarFecha: () => void
  quitarFecha: (fecha: string) => void
  toggleCanal: (canal: 'email' | 'app') => void
  handleRecordarAhora: (ruta: Ruta) => Promise<void>
  agregarCliente: (cliente: Cliente) => void
  quitarCliente: (idx: number) => void
  agregarContador: (contador: Contador) => void
  quitarContador: (idx: number) => void
  agregarUnidad: (unidad: Unidad) => void
  quitarUnidad: (idx: number) => void
  handleDragStart: (idx: number) => void
  handleDragOver: (e: DragEvent, idx: number) => void
  handleDrop: () => void
  handleGuardar: (notificar: boolean) => Promise<void>
  handleEliminar: (ruta: Ruta) => Promise<void>
}
