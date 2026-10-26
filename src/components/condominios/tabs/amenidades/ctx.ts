// Contexto compartido del feature Amenidades (fase B del refactor del tab).
// AmenidadesTab conserva TODO el estado y los handlers; cada vista extraída
// recibe este objeto y destructura lo que usa — así el JSX de las vistas quedó
// idéntico al original (mismo patrón ctx que tabRegistry.tsx).
import type { Dispatch, SetStateAction } from 'react'
import type {
  Amenidad,
  AmenidadInventario,
  BloqueoAmenidad,
  EstadoDepositoReserva,
  ItemInventario,
  MotivoBloqueoAmenidad,
  PrestamoEquipo,
  ReservaAmenidad,
  SolicitudEquipoReserva,
  Unidad,
} from '../../../../types'
import type { EntregaPrestamo, RecepcionPrestamo, ResultadoRecepcion } from '../../../../domain/condominios/prestamosEquipo'

export interface AmenidadFormState {
  nombre: string
  descripcion: string
  capacidad_max: string
  horario_inicio: string
  horario_fin: string
  requiere_deposito: boolean
  monto_deposito: string
  requiere_tarifa: boolean
  tarifa_uso: string
  tarifa_uso_finde: string
  max_reservas_mes_unidad: string
  horas_minimas_antelacion: string
  duracion_max_horas: string
  minutos_preparacion_previa: string
  minutos_preparacion_posterior: string
  requiere_aprobacion: boolean
  reglamento: string
  /** Equipo del inventario que se presta con la amenidad: inventario_id → tope por reserva ('' = sin tope). */
  equipos: Record<string, string>
}

export interface ReservaFormState {
  amenidad_id: string
  unidad_id: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  num_invitados: string
  notas: string
  metodo_pago_tarifa: 'cargar_unidad' | 'pagar_momento'
  tarifa_pagada: boolean
  /** Equipo que se pide con la reserva: inventario_id → cantidad. */
  equipos: Record<string, number>
}

export interface BloqueoFormState {
  amenidad_id: string
  fecha_inicio: string
  fecha_fin: string
  dia_completo: boolean
  hora_inicio: string
  hora_fin: string
  motivo: MotivoBloqueoAmenidad
  notas: string
}

export interface AmenidadesCtx {
  // ── Props del tab ──
  amenidades: Amenidad[]
  reservas: ReservaAmenidad[]
  bloqueos: BloqueoAmenidad[]
  unidades: Unidad[]
  /** Inventario del condominio: de aquí se eligen los equipos que se prestan con cada amenidad. */
  inventario: ItemInventario[]
  /** Préstamos de equipo del proyecto (los pedidos con una reserva cuelgan de `reserva_id`). */
  prestamos: PrestamoEquipo[]
  /** Enlaces amenidad ↔ inventario (20261108000000). */
  amenidadInventario: AmenidadInventario[]
  proyectoId: string
  companyId: string
  userId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  /** Eliminar amenidades y bloqueos tiene su propio permiso (condominios.tab.amenidades.delete). */
  canDelete: boolean
  onRefresh: () => void

  // ── Estado compartido ──
  showAmenidadForm: boolean
  setShowAmenidadForm: Dispatch<SetStateAction<boolean>>
  showReservaForm: boolean
  setShowReservaForm: Dispatch<SetStateAction<boolean>>
  showBloqueoForm: boolean
  setShowBloqueoForm: Dispatch<SetStateAction<boolean>>
  saving: boolean
  amenidadFotoUrl: string | null
  setAmenidadFotoUrl: Dispatch<SetStateAction<string | null>>
  amenidadForm: AmenidadFormState
  setAmenidadForm: Dispatch<SetStateAction<AmenidadFormState>>
  reservaForm: ReservaFormState
  setReservaForm: Dispatch<SetStateAction<ReservaFormState>>
  bloqueoForm: BloqueoFormState
  setBloqueoForm: Dispatch<SetStateAction<BloqueoFormState>>
  semana: Date
  setSemana: Dispatch<SetStateAction<Date>>
  selectedReserva: ReservaAmenidad | null
  setSelectedReserva: Dispatch<SetStateAction<ReservaAmenidad | null>>
  reservaDetalle: ReservaAmenidad | null
  setReservaDetalle: Dispatch<SetStateAction<ReservaAmenidad | null>>
  editingAmenidad: Amenidad | null
  setEditingAmenidad: Dispatch<SetStateAction<Amenidad | null>>
  editAmenidadFotoUrl: string | null
  setEditAmenidadFotoUrl: Dispatch<SetStateAction<string | null>>
  editAmenidadForm: AmenidadFormState
  setEditAmenidadForm: Dispatch<SetStateAction<AmenidadFormState>>
  savingEdit: boolean

  // ── Derivados ──
  hoy: string
  amenidadesActivas: Amenidad[]
  dias: Date[]
  amenidadFotoUrls: (string | null)[]

  // ── Acciones ──
  abrirReservaDesdeCalendario: (amenidadId: string, fecha: string) => void
  abrirEdicion: (a: Amenidad) => void
  guardarAmenidad: () => Promise<void>
  guardarEdicion: () => Promise<void>
  toggleAmenidad: (a: Amenidad) => Promise<void>
  eliminarAmenidad: (id: string) => Promise<void>
  guardarReserva: () => Promise<void>
  cancelarReserva: (id: string) => Promise<void>
  marcarNoShow: (r: ReservaAmenidad) => Promise<void>
  marcarTarifaPagada: (r: ReservaAmenidad) => Promise<void>
  guardarBloqueo: () => Promise<void>
  enviarRecordatorio: (r: ReservaAmenidad) => Promise<void>
  registrarCheckin: (r: ReservaAmenidad, fotoUrl: string | null) => Promise<void>
  registrarCheckout: (r: ReservaAmenidad, fotoUrl: string | null, observaciones: string) => Promise<void>
  actualizarEstadoDeposito: (r: ReservaAmenidad, nuevoEstado: EstadoDepositoReserva) => Promise<void>
  retenerDeposito: (r: ReservaAmenidad) => Promise<void>
  aprobarReserva: (r: ReservaAmenidad) => Promise<void>
  rechazarReserva: (r: ReservaAmenidad) => Promise<void>
  eliminarBloqueo: (id: string) => Promise<void>
  // ── Equipo de la reserva (20261108000000) ──
  /** Agrega equipo enlazado a la amenidad a una reserva ya creada. Devuelve true si se registró. */
  solicitarEquiposReserva: (reservaId: string, equipos: SolicitudEquipoReserva[]) => Promise<boolean>
  /** Registra la entrega de préstamos 'solicitado'. Devuelve true si se registró. */
  entregarEquipos: (entregas: EntregaPrestamo[], entregadoPor: string, observaciones: string) => Promise<boolean>
  /** Registra la recepción de préstamos 'prestado' (y el cargo por reposición si se pide). */
  recibirEquipos: (recepciones: RecepcionPrestamo[], recibidoPor: string, generarCargo: boolean) => Promise<ResultadoRecepcion | null>
}
