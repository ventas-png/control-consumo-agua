// Contexto del feature Clientes (P1 #3, refactor de ClientesSection).
// La sección conserva estado/handlers; el modal de alta-edición (con su
// onboarding de 4 pasos) destructura de aquí — JSX intacto (mismo patrón que
// tabs/amenidades, tabs/visitantes y portal/customer).
import type { Dispatch, SetStateAction } from 'react'
import type { ClienteLookupResult, Unidad } from '../../types'

export const EMPTY_FORM = {
  nombre: '',
  codigo: '',
  email: '',
  direccion: '',
  telefono: '',
  whatsapp: '',
  puede_crear_cuenta: false,
  // Datos personales
  nacionalidad: '',
  cui_dui: '',
  fecha_nacimiento: '',
  // Facturación
  numero_facturacion: '',
  // serv:S11 — Datos fiscales del receptor (FEL/CFDI). Columnas en `clientes`.
  nit: '',          // Guatemala (FEL). 'CF' = Consumidor Final.
  rfc: '',          // México (CFDI).
  nombre_fiscal: '', // Razón social (ambos regímenes).
  uso_cfdi: '',      // México (CFDI), catálogo c_UsoCFDI.
  // Contacto adicional
  telefono_alterno: '',
}

export type FormState = typeof EMPTY_FORM

export interface LookupForm {
  cui_dui: string
  fecha_nacimiento: string
  email: string
}

export type OnboardingStep = 'idle' | 'lookup' | 'lookup_loading' | 'result_match2' | 'result_no_match' | 'full_form'

export interface ClientesCtx {
  unidades: Unidad[]
  canEdit: boolean
  esFEL: boolean
  esCFDI: boolean
  muestraFiscal: boolean

  // ── Estado del modal/onboarding ──
  form: FormState
  setForm: Dispatch<SetStateAction<FormState>>
  editingId: string | null
  loading: boolean
  onboardingStep: OnboardingStep
  setOnboardingStep: Dispatch<SetStateAction<OnboardingStep>>
  lookupForm: LookupForm
  setLookupForm: Dispatch<SetStateAction<LookupForm>>
  lookupResult: ClienteLookupResult | null

  // ── Acciones ──
  modalTitle: string
  cancelForm: () => void
  handleLookup: () => Promise<void>
  autoLinkCliente: (clienteId: string, clienteNombre: string) => Promise<void>
  proceedToFullForm: () => void
  handleGuardar: () => Promise<void>
}

