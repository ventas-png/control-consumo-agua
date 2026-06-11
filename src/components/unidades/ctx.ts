// Contexto del feature Unidades (P1 #3, refactor de UnidadesSection).
// Mismo patrón ctx que clientes/amenidades/visitantes/portal: la sección
// conserva estado y handlers; el modal destructura — JSX intacto.
import type { Dispatch, SetStateAction } from 'react'
import type { Cliente, Contador, Proyecto, TipoUnidad, TipoRegimen, EstadoOcupacional, ContratoSuministro } from '../../types'

export const EMPTY_FORM = {
  nombre: '',
  tipo: 'apartamento' as TipoUnidad,
  descripcion: '',
  piso: '',
  area_m2: '',
  alicuota_pct: '',
  propietario_nombre: '',
  propietario_telefono: '',
  propietario_email: '',
  activo: true,
  cliente_id: '',
  project_id: '',
  // Datos del inmueble
  direccion: '',
  datos_registrales: '',
  tipo_regimen: '' as TipoRegimen | '',
  fecha_construccion: '',
  // Estado ocupacional
  estado_ocupacional: '' as EstadoOcupacional | '',
  // Contrato de suministro
  contrato_suministro: '' as ContratoSuministro | '',
  fecha_firma_contrato: '',
  numero_contrato_suministro: '',
  fecha_vencimiento_contrato: '',
}

export type FormState = typeof EMPTY_FORM


export interface UnidadesCtx {
  contadores: Contador[]
  clientes: Cliente[]
  proyectos: Proyecto[]
  canEdit: boolean

  form: FormState
  setForm: Dispatch<SetStateAction<FormState>>
  selectedContadorIds: string[]
  setSelectedContadorIds: Dispatch<SetStateAction<string[]>>
  editingId: string | null
  loading: boolean

  cancelForm: () => void
  handleGuardar: () => Promise<void>
}
