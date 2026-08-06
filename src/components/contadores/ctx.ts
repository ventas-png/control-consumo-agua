// Contexto del feature Contadores (P1 #3, refactor de ContadoresSection). La
// sección conserva estado/handlers; el modal y las columnas destructuran de
// aquí — JSX intacto (mismo patrón que unidades, clientes y rutas).
import type { Dispatch, SetStateAction } from 'react'
import type { Contador, Tarifa, Unidad } from '../../types'
import type { ContadorForm } from '../../lib/contadoresReglas'

export const EMPTY_FORM: ContadorForm = {
  numero_serie: '',
  tipo_agua: 'potable',
  descripcion: '',
  marca: '',
  modelo: '',
  fecha_instalacion: '',
  lectura_inicial: '0',
  activo: true,
  tarifa_id: '',
  unidad_id: '',
  medida: '',
  material: '',
  tipo_contador: '',
  valvula_cheque: '',
  tipo_llave: '',
  llave_antifraude: '',
  valvula_aire: '',
  fecha_reemplazo_sugerida: '',
  numero_derecho_servicio: '',
  cantidad_derecho_servicio_m3: '',
  periodicidad_lectura_dias: '',
  contratista_instalador: '',
  garantia_instalacion_vence: '',
}

export interface ContadoresCtx {
  tarifas: Tarifa[]
  unidades: Unidad[]
  moneda: string
  canEdit: boolean
  canDelete: boolean

  // ── Estado del modal ──
  form: ContadorForm
  setForm: Dispatch<SetStateAction<ContadorForm>>
  editingId: string | null
  loading: boolean

  // ── Acciones ──
  cancelForm: () => void
  handleGuardar: () => Promise<void>
  startEdit: (c: Contador) => void
  handleEliminar: (c: Contador) => Promise<void>
  handleToggleActivo: (c: Contador) => Promise<void>
}
