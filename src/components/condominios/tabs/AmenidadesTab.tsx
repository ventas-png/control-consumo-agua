import { useState, Fragment, type CSSProperties, type ReactNode } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { Amenidad, ReservaAmenidad, BloqueoAmenidad, MotivoBloqueoAmenidad, EstadoDepositoReserva, Unidad } from '../../../types'
import { ImageUploader } from '../ImageUploader'
import { formatPhoneForWa } from '../../../lib/validation'

interface Props {
  amenidades: Amenidad[]
  reservas: ReservaAmenidad[]
  bloqueos: BloqueoAmenidad[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  userId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

type Vista = 'amenidades' | 'reservas' | 'calendario' | 'bloqueos' | 'recordatorios'

const MOTIVO_LABEL: Record<MotivoBloqueoAmenidad, string> = {
  mantenimiento: 'Mantenimiento',
  limpieza: 'Limpieza profunda',
  evento_privado: 'Evento privado',
  reparacion: 'Reparación',
  otro: 'Otro',
}

export function bloqueoSolapaReserva(b: BloqueoAmenidad, fecha: string, hi: string, hf: string): boolean {
  if (fecha < b.fecha_inicio || fecha > b.fecha_fin) return false
  if (!b.hora_inicio || !b.hora_fin) return true   // día completo
  return hi < b.hora_fin && hf > b.hora_inicio
}

export function esFinDeSemana(fecha: string): boolean {
  if (!fecha) return false
  const dow = new Date(fecha + 'T12:00:00').getDay()
  return dow === 0 || dow === 6
}

export function tarifaAplicable(amen: Amenidad, fecha: string): number {
  if (!amen.requiere_tarifa) return 0
  const base = Number(amen.tarifa_uso ?? 0)
  if (esFinDeSemana(fecha) && amen.tarifa_uso_finde != null) {
    return Number(amen.tarifa_uso_finde)
  }
  return base
}

function diferenciaHoras(hi: string, hf: string): number {
  const [h1, m1] = hi.split(':').map(Number)
  const [h2, m2] = hf.split(':').map(Number)
  return ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60
}

export function addMinutosToTime(hhmm: string, minutos: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = h * 60 + m + minutos
  const hh = Math.floor(Math.max(0, total) / 60) % 24
  const mm = Math.max(0, total) % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function validarReglasAmenidad(
  amen: Amenidad,
  fecha: string,
  horaInicio: string,
  horaFin: string,
  unidadId: string,
  reservasExistentes: ReservaAmenidad[],
): string | null {
  if (amen.duracion_max_horas != null && amen.duracion_max_horas > 0) {
    const horas = diferenciaHoras(horaInicio, horaFin)
    if (horas > amen.duracion_max_horas + 1e-6) {
      return `La duración máxima permitida es de ${amen.duracion_max_horas} horas.`
    }
  }
  if (amen.horas_minimas_antelacion != null && amen.horas_minimas_antelacion > 0) {
    const inicio = new Date(`${fecha}T${horaInicio}:00`)
    const ahora = new Date()
    const horasAntelacion = (inicio.getTime() - ahora.getTime()) / 3600000
    if (horasAntelacion < amen.horas_minimas_antelacion) {
      return `Debes reservar con al menos ${amen.horas_minimas_antelacion} h de anticipación.`
    }
  }
  if (amen.max_reservas_mes_unidad != null && amen.max_reservas_mes_unidad > 0) {
    const mes = fecha.slice(0, 7)
    const usadas = reservasExistentes.filter(r =>
      r.amenidad_id === amen.id &&
      r.unidad_id === unidadId &&
      r.estado !== 'cancelada' &&
      r.fecha.startsWith(mes)
    ).length
    if (usadas >= amen.max_reservas_mes_unidad) {
      return `Esta unidad ya alcanzó el límite de ${amen.max_reservas_mes_unidad} reserva(s) en ${mes} para esta amenidad.`
    }
  }
  return null
}

const DIAS_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function lunesDeSemana(ref: Date): Date {
  const d = new Date(ref)
  d.setHours(0, 0, 0, 0)
  const dow = d.getDay() === 0 ? 6 : d.getDay() - 1
  d.setDate(d.getDate() - dow)
  return d
}

function diasDeSemana(lunes: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lunes)
    d.setDate(d.getDate() + i)
    return d
  })
}

const ESTADO_COLORS: Record<string, { bg: string; color: string }> = {
  confirmada: { bg: '#f0fdf4', color: '#16a34a' },
  pendiente:  { bg: '#eff6ff', color: '#2563eb' },
  cancelada:  { bg: '#f1f5f9', color: '#94a3b8' },
}

function pillStyle(bg: string, border: string, color: string): CSSProperties {
  return {
    padding: '3px 9px',
    borderRadius: 999,
    border: `1px solid ${border}`,
    background: bg,
    color,
    fontSize: 10.5,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  }
}

const CHIP_STYLES: Record<string, { bg: string; border: string; color: string }> = {
  confirmada:        { bg: '#dcfce7', border: '#86efac', color: '#15803d' },
  pendiente:         { bg: '#fef3c7', border: '#fcd34d', color: '#92400e' },
  cancelada:         { bg: '#f1f5f9', border: '#cbd5e1', color: '#475569' },
  no_show:           { bg: '#fee2e2', border: '#fca5a5', color: '#b91c1c' },
  pagado:            { bg: '#dcfce7', border: '#86efac', color: '#15803d' },
  cobro_pendiente:   { bg: '#fed7aa', border: '#fb923c', color: '#9a3412' },
}

function chipStyle(estado: string): CSSProperties {
  const c = CHIP_STYLES[estado] ?? CHIP_STYLES.cancelada
  return {
    padding: '3px 10px',
    borderRadius: 999,
    border: `1px solid ${c.border}`,
    background: c.bg,
    color: c.color,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.01em',
    whiteSpace: 'nowrap',
  }
}

function btnAction(bg: string, border: string, color: string): CSSProperties {
  return {
    padding: '6px 12px',
    background: bg,
    color,
    border: `1px solid ${border}`,
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
    transition: 'transform 0.12s ease, filter 0.12s ease',
  }
}

const btnHero: CSSProperties = {
  padding: '10px 18px',
  background: 'rgba(255,255,255,0.18)',
  color: 'white',
  border: '1.5px solid rgba(255,255,255,0.45)',
  borderRadius: 12,
  fontWeight: 700,
  cursor: 'pointer',
  fontSize: 13.5,
  backdropFilter: 'blur(6px)',
}

const RESERVA_CAL_COLORS = [
  { bg: '#dbeafe', border: '#93c5fd', color: '#1e40af' },
  { bg: '#d1fae5', border: '#6ee7b7', color: '#065f46' },
  { bg: '#ede9fe', border: '#c4b5fd', color: '#4c1d95' },
  { bg: '#fce7f3', border: '#f9a8d4', color: '#9d174d' },
  { bg: '#fef3c7', border: '#fcd34d', color: '#78350f' },
]

export function AmenidadesTab({ amenidades, reservas, bloqueos, unidades, proyectoId, companyId, userId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [vista, setVista] = useState<Vista>('amenidades')
  const [showAmenidadForm, setShowAmenidadForm] = useState(false)
  const [showReservaForm, setShowReservaForm] = useState(false)
  const [showBloqueoForm, setShowBloqueoForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [amenidadFotoUrl, setAmenidadFotoUrl] = useState<string | null>(null)
  const [amenidadForm, setAmenidadForm] = useState({ nombre: '', descripcion: '', capacidad_max: '', horario_inicio: '', horario_fin: '', requiere_deposito: false, monto_deposito: '', requiere_tarifa: false, tarifa_uso: '', tarifa_uso_finde: '', max_reservas_mes_unidad: '', horas_minimas_antelacion: '', duracion_max_horas: '', minutos_preparacion_previa: '', minutos_preparacion_posterior: '', requiere_aprobacion: false, reglamento: '' })
  const [reservaForm, setReservaForm] = useState({ amenidad_id: '', unidad_id: '', fecha: '', hora_inicio: '', hora_fin: '', num_invitados: '0', notas: '', metodo_pago_tarifa: 'cargar_unidad' as 'cargar_unidad' | 'pagar_momento', tarifa_pagada: false })
  const [bloqueoForm, setBloqueoForm] = useState({ amenidad_id: '', fecha_inicio: '', fecha_fin: '', dia_completo: true, hora_inicio: '', hora_fin: '', motivo: 'mantenimiento' as MotivoBloqueoAmenidad, notas: '' })
  const [semana, setSemana] = useState<Date>(() => lunesDeSemana(new Date()))
  const [selectedReserva, setSelectedReserva] = useState<ReservaAmenidad | null>(null)
  const [reservaDetalle, setReservaDetalle] = useState<ReservaAmenidad | null>(null)

  // Carga masiva
  type BulkRow = { nombre: string; descripcion: string; capacidad_max: string; horario_inicio: string; horario_fin: string }
  const emptyBulkRow = (): BulkRow => ({ nombre: '', descripcion: '', capacidad_max: '', horario_inicio: '', horario_fin: '' })
  const [showBulkForm, setShowBulkForm] = useState(false)
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([emptyBulkRow()])
  const [savingBulk, setSavingBulk] = useState(false)

  // Edición de amenidad existente
  const [editingAmenidad, setEditingAmenidad] = useState<Amenidad | null>(null)
  const [editAmenidadFotoUrl, setEditAmenidadFotoUrl] = useState<string | null>(null)
  const [editAmenidadForm, setEditAmenidadForm] = useState({ nombre: '', descripcion: '', capacidad_max: '', horario_inicio: '', horario_fin: '', requiere_deposito: false, monto_deposito: '', requiere_tarifa: false, tarifa_uso: '', tarifa_uso_finde: '', max_reservas_mes_unidad: '', horas_minimas_antelacion: '', duracion_max_horas: '', minutos_preparacion_previa: '', minutos_preparacion_posterior: '', requiere_aprobacion: false, reglamento: '' })
  const [savingEdit, setSavingEdit] = useState(false)

  const hoy = new Date().toISOString().slice(0, 10)
  const amenidadesActivas = amenidades.filter(a => a.activo)
  const dias = diasDeSemana(semana)

  function abrirReservaDesdeCalendario(amenidadId: string, fecha: string) {
    setReservaForm(f => ({ ...f, amenidad_id: amenidadId, fecha }))
    setVista('reservas')
    setShowReservaForm(true)
  }

  async function guardarAmenidad() {
    if (!amenidadForm.nombre.trim()) { Swal.fire('Error', 'Ingrese el nombre.', 'error'); return }
    if (amenidadForm.requiere_tarifa && !amenidadForm.tarifa_uso) { Swal.fire('Error', 'Indique el monto de la tarifa por uso.', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('amenidades').insert({
      company_id: companyId, project_id: proyectoId,
      nombre: amenidadForm.nombre.trim(),
      descripcion: amenidadForm.descripcion.trim() || null,
      capacidad_max: amenidadForm.capacidad_max ? Number(amenidadForm.capacidad_max) : null,
      horario_inicio: amenidadForm.horario_inicio || null,
      horario_fin: amenidadForm.horario_fin || null,
      requiere_deposito: amenidadForm.requiere_deposito,
      monto_deposito: amenidadForm.monto_deposito ? Number(amenidadForm.monto_deposito) : null,
      requiere_tarifa: amenidadForm.requiere_tarifa,
      tarifa_uso: amenidadForm.requiere_tarifa && amenidadForm.tarifa_uso ? Number(amenidadForm.tarifa_uso) : null,
      tarifa_uso_finde: amenidadForm.requiere_tarifa && amenidadForm.tarifa_uso_finde ? Number(amenidadForm.tarifa_uso_finde) : null,
      max_reservas_mes_unidad: amenidadForm.max_reservas_mes_unidad ? Number(amenidadForm.max_reservas_mes_unidad) : null,
      horas_minimas_antelacion: amenidadForm.horas_minimas_antelacion ? Number(amenidadForm.horas_minimas_antelacion) : null,
      duracion_max_horas: amenidadForm.duracion_max_horas ? Number(amenidadForm.duracion_max_horas) : null,
      minutos_preparacion_previa: amenidadForm.minutos_preparacion_previa ? Number(amenidadForm.minutos_preparacion_previa) : 0,
      minutos_preparacion_posterior: amenidadForm.minutos_preparacion_posterior ? Number(amenidadForm.minutos_preparacion_posterior) : 0,
      requiere_aprobacion: amenidadForm.requiere_aprobacion,
      reglamento: amenidadForm.reglamento.trim() || null,
      foto_url: amenidadFotoUrl,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setAmenidadForm({ nombre: '', descripcion: '', capacidad_max: '', horario_inicio: '', horario_fin: '', requiere_deposito: false, monto_deposito: '', requiere_tarifa: false, tarifa_uso: '', tarifa_uso_finde: '', max_reservas_mes_unidad: '', horas_minimas_antelacion: '', duracion_max_horas: '', minutos_preparacion_previa: '', minutos_preparacion_posterior: '', requiere_aprobacion: false, reglamento: '' })
    setAmenidadFotoUrl(null)
    setShowAmenidadForm(false)
    onRefresh()
  }

  async function guardarBulk() {
    const validas = bulkRows.filter(r => r.nombre.trim())
    if (validas.length === 0) { Swal.fire('Error', 'Agrega al menos una amenidad con nombre.', 'error'); return }
    setSavingBulk(true)
    const { error } = await supabase.from('amenidades').insert(
      validas.map(r => ({
        company_id: companyId,
        project_id: proyectoId,
        nombre: r.nombre.trim(),
        descripcion: r.descripcion.trim() || null,
        capacidad_max: r.capacidad_max ? Number(r.capacidad_max) : null,
        horario_inicio: r.horario_inicio || null,
        horario_fin: r.horario_fin || null,
      }))
    )
    setSavingBulk(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setBulkRows([emptyBulkRow()])
    setShowBulkForm(false)
    onRefresh()
  }

  function abrirEdicion(a: Amenidad) {
    setEditingAmenidad(a)
    setEditAmenidadFotoUrl(a.foto_url ?? null)
    setEditAmenidadForm({
      nombre: a.nombre,
      descripcion: a.descripcion ?? '',
      capacidad_max: a.capacidad_max != null ? String(a.capacidad_max) : '',
      horario_inicio: a.horario_inicio ?? '',
      horario_fin: a.horario_fin ?? '',
      requiere_deposito: a.requiere_deposito ?? false,
      monto_deposito: a.monto_deposito != null ? String(a.monto_deposito) : '',
      requiere_tarifa: a.requiere_tarifa ?? false,
      tarifa_uso: a.tarifa_uso != null ? String(a.tarifa_uso) : '',
      tarifa_uso_finde: a.tarifa_uso_finde != null ? String(a.tarifa_uso_finde) : '',
      max_reservas_mes_unidad: a.max_reservas_mes_unidad != null ? String(a.max_reservas_mes_unidad) : '',
      horas_minimas_antelacion: a.horas_minimas_antelacion != null ? String(a.horas_minimas_antelacion) : '',
      duracion_max_horas: a.duracion_max_horas != null ? String(a.duracion_max_horas) : '',
      minutos_preparacion_previa: a.minutos_preparacion_previa != null ? String(a.minutos_preparacion_previa) : '',
      minutos_preparacion_posterior: a.minutos_preparacion_posterior != null ? String(a.minutos_preparacion_posterior) : '',
      requiere_aprobacion: a.requiere_aprobacion ?? false,
      reglamento: a.reglamento ?? '',
    })
    setShowAmenidadForm(false)
    setShowBulkForm(false)
  }

  async function guardarEdicion() {
    if (!editingAmenidad) return
    if (!editAmenidadForm.nombre.trim()) { Swal.fire('Error', 'Ingrese el nombre.', 'error'); return }
    if (editAmenidadForm.requiere_tarifa && !editAmenidadForm.tarifa_uso) { Swal.fire('Error', 'Indique el monto de la tarifa por uso.', 'error'); return }
    setSavingEdit(true)
    const { error } = await supabase.from('amenidades').update({
      nombre: editAmenidadForm.nombre.trim(),
      descripcion: editAmenidadForm.descripcion.trim() || null,
      capacidad_max: editAmenidadForm.capacidad_max ? Number(editAmenidadForm.capacidad_max) : null,
      horario_inicio: editAmenidadForm.horario_inicio || null,
      horario_fin: editAmenidadForm.horario_fin || null,
      requiere_deposito: editAmenidadForm.requiere_deposito,
      monto_deposito: editAmenidadForm.monto_deposito ? Number(editAmenidadForm.monto_deposito) : null,
      requiere_tarifa: editAmenidadForm.requiere_tarifa,
      tarifa_uso: editAmenidadForm.requiere_tarifa && editAmenidadForm.tarifa_uso ? Number(editAmenidadForm.tarifa_uso) : null,
      tarifa_uso_finde: editAmenidadForm.requiere_tarifa && editAmenidadForm.tarifa_uso_finde ? Number(editAmenidadForm.tarifa_uso_finde) : null,
      max_reservas_mes_unidad: editAmenidadForm.max_reservas_mes_unidad ? Number(editAmenidadForm.max_reservas_mes_unidad) : null,
      horas_minimas_antelacion: editAmenidadForm.horas_minimas_antelacion ? Number(editAmenidadForm.horas_minimas_antelacion) : null,
      duracion_max_horas: editAmenidadForm.duracion_max_horas ? Number(editAmenidadForm.duracion_max_horas) : null,
      minutos_preparacion_previa: editAmenidadForm.minutos_preparacion_previa ? Number(editAmenidadForm.minutos_preparacion_previa) : 0,
      minutos_preparacion_posterior: editAmenidadForm.minutos_preparacion_posterior ? Number(editAmenidadForm.minutos_preparacion_posterior) : 0,
      requiere_aprobacion: editAmenidadForm.requiere_aprobacion,
      reglamento: editAmenidadForm.reglamento.trim() || null,
      foto_url: editAmenidadFotoUrl,
    }).eq('id', editingAmenidad.id)
    setSavingEdit(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setEditingAmenidad(null)
    onRefresh()
  }

  async function toggleAmenidad(a: Amenidad) {
    await supabase.from('amenidades').update({ activo: !a.activo }).eq('id', a.id)
    onRefresh()
  }

  async function eliminarAmenidad(id: string) {
    const reservasActivas = reservas.filter(
      r => r.amenidad_id === id && (r.estado === 'confirmada' || r.estado === 'pendiente')
    )
    if (reservasActivas.length > 0) {
      Swal.fire({
        icon: 'warning',
        title: 'No se puede eliminar',
        text: `Esta amenidad tiene ${reservasActivas.length} reserva${reservasActivas.length !== 1 ? 's' : ''} activa${reservasActivas.length !== 1 ? 's' : ''}. Cancélalas primero.`,
      })
      return
    }
    const r = await Swal.fire({
      title: '¿Eliminar amenidad?',
      text: 'Esta acción no se puede deshacer.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
    })
    if (!r.isConfirmed) return
    const { error } = await supabase.from('amenidades').delete().eq('id', id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    onRefresh()
  }

  async function guardarReserva() {
    if (!reservaForm.amenidad_id || !reservaForm.unidad_id || !reservaForm.fecha || !reservaForm.hora_inicio || !reservaForm.hora_fin) {
      Swal.fire('Error', 'Complete todos los campos requeridos.', 'error'); return
    }
    const conflict = reservas.find(r => {
      if (r.amenidad_id !== reservaForm.amenidad_id) return false
      if (r.fecha !== reservaForm.fecha) return false
      if (r.estado !== 'confirmada') return false
      const amenR = amenidades.find(a => a.id === r.amenidad_id)
      const efectivoInicio = (amenR?.minutos_preparacion_previa ?? 0) > 0
        ? addMinutosToTime(r.hora_inicio, -(amenR!.minutos_preparacion_previa!))
        : r.hora_inicio
      const efectivoFin = (amenR?.minutos_preparacion_posterior ?? 0) > 0
        ? addMinutosToTime(r.hora_fin, amenR!.minutos_preparacion_posterior!)
        : r.hora_fin
      return reservaForm.hora_inicio < efectivoFin && reservaForm.hora_fin > efectivoInicio
    })
    if (conflict) { Swal.fire('Conflicto', 'Ya existe una reserva confirmada en ese horario para esta amenidad (incluyendo tiempos de preparación).', 'warning'); return }

    const bloqueo = bloqueos.find(b =>
      b.amenidad_id === reservaForm.amenidad_id &&
      bloqueoSolapaReserva(b, reservaForm.fecha, reservaForm.hora_inicio, reservaForm.hora_fin)
    )
    if (bloqueo) {
      const detalle = bloqueo.hora_inicio
        ? `${bloqueo.fecha_inicio === bloqueo.fecha_fin ? bloqueo.fecha_inicio : `${bloqueo.fecha_inicio} → ${bloqueo.fecha_fin}`} ${bloqueo.hora_inicio}–${bloqueo.hora_fin}`
        : `${bloqueo.fecha_inicio === bloqueo.fecha_fin ? bloqueo.fecha_inicio : `${bloqueo.fecha_inicio} → ${bloqueo.fecha_fin}`} (día completo)`
      Swal.fire('Amenidad bloqueada', `${MOTIVO_LABEL[bloqueo.motivo]} · ${detalle}`, 'warning')
      return
    }

    const amen = amenidades.find(a => a.id === reservaForm.amenidad_id)
    if (amen) {
      const errReglas = validarReglasAmenidad(amen, reservaForm.fecha, reservaForm.hora_inicio, reservaForm.hora_fin, reservaForm.unidad_id, reservas)
      if (errReglas) { Swal.fire('No permitido', errReglas, 'warning'); return }
    }
    const tarifaCalc = amen ? tarifaAplicable(amen, reservaForm.fecha) : 0
    const aplicaTarifa = !!(amen?.requiere_tarifa && tarifaCalc > 0)
    const montoTarifa = aplicaTarifa ? tarifaCalc : null
    const metodoPago = aplicaTarifa ? reservaForm.metodo_pago_tarifa : null
    const requiereAprob = !!amen?.requiere_aprobacion
    const estadoInicial: 'confirmada' | 'pendiente' = requiereAprob ? 'pendiente' : 'confirmada'

    setSaving(true)
    let cuotaId: string | null = null
    // Solo generar cuota si la reserva queda confirmada de inmediato
    if (!requiereAprob && aplicaTarifa && metodoPago === 'cargar_unidad') {
      const periodo = reservaForm.fecha.slice(0, 7)
      const { data: cuotaData, error: cuotaErr } = await supabase
        .from('cuotas_condominio')
        .insert({
          company_id: companyId,
          project_id: proyectoId,
          unidad_id: reservaForm.unidad_id,
          concepto: 'amenidad',
          monto: montoTarifa,
          periodo,
          fecha_vencimiento: reservaForm.fecha,
          estado: 'pendiente',
          notas: `Reserva ${amen!.nombre} ${reservaForm.fecha} ${reservaForm.hora_inicio}-${reservaForm.hora_fin}`,
          created_by: userId,
        })
        .select('id')
        .single()
      if (cuotaErr) { setSaving(false); Swal.fire('Error', `No se pudo generar el cargo: ${cuotaErr.message}`, 'error'); return }
      cuotaId = cuotaData?.id ?? null
    }

    const tarifaPagada = aplicaTarifa && metodoPago === 'pagar_momento' ? reservaForm.tarifa_pagada : false

    const { error } = await supabase.from('reservas_amenidades').insert({
      company_id: companyId,
      amenidad_id: reservaForm.amenidad_id,
      unidad_id: reservaForm.unidad_id,
      fecha: reservaForm.fecha,
      hora_inicio: reservaForm.hora_inicio,
      hora_fin: reservaForm.hora_fin,
      num_invitados: Number(reservaForm.num_invitados),
      notas: reservaForm.notas.trim() || null,
      monto_tarifa: montoTarifa,
      metodo_pago_tarifa: metodoPago,
      tarifa_pagada: tarifaPagada,
      cuota_id: cuotaId,
      deposito_estado: amen?.requiere_deposito ? 'pendiente' : 'no_aplica',
      estado: estadoInicial,
      created_by: userId,
    })
    setSaving(false)
    if (error) {
      if (cuotaId) await supabase.from('cuotas_condominio').delete().eq('id', cuotaId)
      Swal.fire('Error', error.message, 'error'); return
    }
    setReservaForm({ amenidad_id: '', unidad_id: '', fecha: '', hora_inicio: '', hora_fin: '', num_invitados: '0', notas: '', metodo_pago_tarifa: 'cargar_unidad', tarifa_pagada: false })
    setShowReservaForm(false)
    const msg = requiereAprob
      ? 'Reserva enviada como pendiente. Apruébala desde la lista.'
      : aplicaTarifa
        ? metodoPago === 'cargar_unidad'
          ? `Reserva confirmada. Se cargó ${moneda} ${montoTarifa!.toFixed(2)} a la unidad.`
          : tarifaPagada
            ? `Reserva confirmada. Pago en sitio registrado.`
            : `Reserva confirmada. Cobrar ${moneda} ${montoTarifa!.toFixed(2)} en sitio.`
        : 'Reserva confirmada'
    Swal.fire({ icon: 'success', title: msg, timer: 2400, showConfirmButton: false })
    onRefresh()
  }

  async function cancelarReserva(id: string) {
    const r = await Swal.fire({ title: '¿Cancelar reserva?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, cancelar', cancelButtonText: 'No', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    const reserva = reservas.find(x => x.id === id)
    await supabase.from('reservas_amenidades').update({ estado: 'cancelada' }).eq('id', id)
    if (reserva?.cuota_id) {
      await supabase.from('cuotas_condominio').delete().eq('id', reserva.cuota_id).eq('estado', 'pendiente')
    }
    setSelectedReserva(null)
    onRefresh()
  }

  async function marcarNoShow(r: ReservaAmenidad) {
    const update = !r.no_show
    await supabase.from('reservas_amenidades').update({ no_show: update }).eq('id', r.id)
    onRefresh()
  }

  async function marcarTarifaPagada(r: ReservaAmenidad) {
    const update: Record<string, unknown> = { tarifa_pagada: true }
    const { error } = await supabase.from('reservas_amenidades').update(update).eq('id', r.id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    onRefresh()
  }

  async function guardarBloqueo() {
    if (!bloqueoForm.amenidad_id || !bloqueoForm.fecha_inicio || !bloqueoForm.fecha_fin) {
      Swal.fire('Error', 'Seleccione amenidad y rango de fechas.', 'error'); return
    }
    if (bloqueoForm.fecha_fin < bloqueoForm.fecha_inicio) {
      Swal.fire('Error', 'La fecha fin debe ser igual o posterior a la fecha inicio.', 'error'); return
    }
    if (!bloqueoForm.dia_completo) {
      if (!bloqueoForm.hora_inicio || !bloqueoForm.hora_fin) { Swal.fire('Error', 'Indique horario o marque día completo.', 'error'); return }
      if (bloqueoForm.hora_fin <= bloqueoForm.hora_inicio) { Swal.fire('Error', 'La hora fin debe ser posterior a la hora inicio.', 'error'); return }
    }
    setSaving(true)
    const { error } = await supabase.from('amenidades_bloqueos').insert({
      company_id: companyId,
      project_id: proyectoId,
      amenidad_id: bloqueoForm.amenidad_id,
      fecha_inicio: bloqueoForm.fecha_inicio,
      fecha_fin: bloqueoForm.fecha_fin,
      hora_inicio: bloqueoForm.dia_completo ? null : bloqueoForm.hora_inicio,
      hora_fin: bloqueoForm.dia_completo ? null : bloqueoForm.hora_fin,
      motivo: bloqueoForm.motivo,
      notas: bloqueoForm.notas.trim() || null,
      created_by: userId,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setBloqueoForm({ amenidad_id: '', fecha_inicio: '', fecha_fin: '', dia_completo: true, hora_inicio: '', hora_fin: '', motivo: 'mantenimiento', notas: '' })
    setShowBloqueoForm(false)
    Swal.fire({ icon: 'success', title: 'Bloqueo registrado', timer: 1500, showConfirmButton: false })
    onRefresh()
  }

  function buildMensajeRecordatorio(r: ReservaAmenidad, unidad: Unidad | undefined): string {
    const fechaStr = new Date(r.fecha + 'T12:00:00').toLocaleDateString('es', { weekday: 'long', day: '2-digit', month: 'long' })
    const tarifa = r.monto_tarifa && r.monto_tarifa > 0 && r.metodo_pago_tarifa === 'pagar_momento' && !r.tarifa_pagada
      ? `\n\n💰 Recuerda traer ${moneda} ${Number(r.monto_tarifa).toFixed(2)} para la tarifa de uso.`
      : ''
    const nombreSaludo = unidad?.propietario_nombre ? `Hola ${unidad.propietario_nombre.split(' ')[0]}, ` : 'Hola, '
    return `${nombreSaludo}te recordamos tu reserva de *${r.amenidad_nombre}* el ${fechaStr} de ${r.hora_inicio} a ${r.hora_fin}.${tarifa}\n\nNos vemos pronto. 🏖`
  }

  async function enviarRecordatorio(r: ReservaAmenidad) {
    const unidad = unidades.find(u => u.id === r.unidad_id)
    const tel = unidad?.propietario_telefono?.trim()
    if (!tel) {
      Swal.fire('Sin teléfono', `La unidad ${r.unidad_nombre || ''} no tiene un teléfono registrado para el propietario.`, 'warning')
      return
    }
    const mensaje = buildMensajeRecordatorio(r, unidad)
    const url = `https://wa.me/${formatPhoneForWa(tel)}?text=${encodeURIComponent(mensaje)}`
    window.open(url, '_blank', 'noopener,noreferrer')
    await supabase.from('reservas_amenidades')
      .update({ recordatorio_enviado: true, recordatorio_enviado_at: new Date().toISOString() })
      .eq('id', r.id)
    onRefresh()
  }

  async function registrarCheckin(r: ReservaAmenidad, fotoUrl: string | null) {
    const update: Record<string, unknown> = {
      checkin_at: new Date().toISOString(),
      checkin_foto_url: fotoUrl,
      checkin_por: userId,
    }
    const amen = amenidades.find(a => a.id === r.amenidad_id)
    if (amen?.requiere_deposito && r.deposito_estado === 'no_aplica') {
      update.deposito_estado = 'pendiente'
    }
    const { error } = await supabase.from('reservas_amenidades').update(update).eq('id', r.id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    onRefresh()
    setReservaDetalle(d => d && d.id === r.id ? { ...d, ...update } as ReservaAmenidad : d)
  }

  async function registrarCheckout(r: ReservaAmenidad, fotoUrl: string | null, observaciones: string) {
    const { error } = await supabase.from('reservas_amenidades').update({
      checkout_at: new Date().toISOString(),
      checkout_foto_url: fotoUrl,
      checkout_por: userId,
      observaciones_uso: observaciones || null,
    }).eq('id', r.id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    onRefresh()
    setReservaDetalle(d => d && d.id === r.id ? { ...d, checkout_at: new Date().toISOString(), checkout_foto_url: fotoUrl, observaciones_uso: observaciones || null } : d)
  }

  async function actualizarEstadoDeposito(r: ReservaAmenidad, nuevoEstado: EstadoDepositoReserva) {
    const update: Record<string, unknown> = { deposito_estado: nuevoEstado }
    if (nuevoEstado === 'cobrado') {
      update.deposito_pagado = true
    }
    if (nuevoEstado === 'devuelto') {
      update.deposito_devuelto_at = new Date().toISOString()
      update.deposito_retenido_monto = null
      update.deposito_retenido_motivo = null
    }
    const { error } = await supabase.from('reservas_amenidades').update(update).eq('id', r.id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    onRefresh()
    setReservaDetalle(d => d && d.id === r.id ? { ...d, ...update } as ReservaAmenidad : d)
  }

  async function retenerDeposito(r: ReservaAmenidad) {
    const amen = amenidades.find(a => a.id === r.amenidad_id)
    const tope = amen?.monto_deposito ?? null
    const { value: form } = await Swal.fire({
      title: 'Retener depósito',
      html:
        `<p style="font-size:13px;color:#64748b;margin:0 0 10px;text-align:left">Indica el monto que se retiene${tope != null ? ` (máximo ${moneda} ${tope.toFixed(2)})` : ''} y el motivo. Opcionalmente puedes generar un cargo a la unidad si la retención no cubre el daño.</p>` +
        `<input id="swal-monto" type="number" min="0" step="0.01" max="${tope ?? ''}" class="swal2-input" placeholder="Monto retenido (${moneda})">` +
        `<textarea id="swal-motivo" class="swal2-textarea" placeholder="Motivo de la retención"></textarea>` +
        `<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#374151;margin-top:6px;text-align:left"><input type="checkbox" id="swal-cargo"> Generar cargo a la unidad por el monto retenido</label>`,
      showCancelButton: true,
      confirmButtonText: 'Retener',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#dc2626',
      preConfirm: () => {
        const monto = (document.getElementById('swal-monto') as HTMLInputElement | null)?.value ?? ''
        const motivo = (document.getElementById('swal-motivo') as HTMLTextAreaElement | null)?.value ?? ''
        const cargo = (document.getElementById('swal-cargo') as HTMLInputElement | null)?.checked ?? false
        if (!monto || Number(monto) <= 0) { Swal.showValidationMessage('Indica un monto mayor a 0.'); return false }
        if (!motivo.trim()) { Swal.showValidationMessage('Indica un motivo.'); return false }
        if (tope != null && Number(monto) > tope) { Swal.showValidationMessage(`El monto excede el depósito (${tope}).`); return false }
        return { monto: Number(monto), motivo: motivo.trim(), cargo }
      },
    })
    if (!form) return
    let cuotaId: string | null = null
    if (form.cargo) {
      const periodo = r.fecha.slice(0, 7)
      const { data: cuotaData, error: cuotaErr } = await supabase
        .from('cuotas_condominio')
        .insert({
          company_id: companyId,
          project_id: proyectoId,
          unidad_id: r.unidad_id,
          concepto: 'amenidad',
          monto: form.monto,
          periodo,
          fecha_vencimiento: new Date().toISOString().slice(0, 10),
          estado: 'pendiente',
          notas: `Retención por daños — ${amen?.nombre || 'amenidad'} · ${r.fecha} · ${form.motivo}`,
          created_by: userId,
        })
        .select('id')
        .single()
      if (cuotaErr) { Swal.fire('Error', `No se pudo generar el cargo: ${cuotaErr.message}`, 'error'); return }
      cuotaId = cuotaData?.id ?? null
    }
    const update = {
      deposito_estado: 'retenido' as EstadoDepositoReserva,
      deposito_retenido_monto: form.monto,
      deposito_retenido_motivo: form.motivo,
      cuota_retencion_id: cuotaId,
    }
    const { error } = await supabase.from('reservas_amenidades').update(update).eq('id', r.id)
    if (error) {
      if (cuotaId) await supabase.from('cuotas_condominio').delete().eq('id', cuotaId)
      Swal.fire('Error', error.message, 'error'); return
    }
    onRefresh()
    setReservaDetalle(d => d && d.id === r.id ? { ...d, ...update } as ReservaAmenidad : d)
  }

  async function aprobarReserva(r: ReservaAmenidad) {
    // Detectar conflicto con otra reserva ya confirmada (incluyendo tiempos de preparación)
    const amenAprov = amenidades.find(a => a.id === r.amenidad_id)
    const conflict = reservas.find(x => {
      if (x.id === r.id) return false
      if (x.amenidad_id !== r.amenidad_id) return false
      if (x.fecha !== r.fecha) return false
      if (x.estado !== 'confirmada') return false
      const efectivoInicio = (amenAprov?.minutos_preparacion_previa ?? 0) > 0
        ? addMinutosToTime(x.hora_inicio, -(amenAprov!.minutos_preparacion_previa!))
        : x.hora_inicio
      const efectivoFin = (amenAprov?.minutos_preparacion_posterior ?? 0) > 0
        ? addMinutosToTime(x.hora_fin, amenAprov!.minutos_preparacion_posterior!)
        : x.hora_fin
      return r.hora_inicio < efectivoFin && r.hora_fin > efectivoInicio
    })
    if (conflict) {
      Swal.fire('Conflicto', 'Otra reserva ya confirmada ocupa ese horario (incluyendo tiempos de preparación). No es posible aprobar.', 'warning')
      return
    }
    const amen = amenidades.find(a => a.id === r.amenidad_id)
    let cuotaId: string | null = r.cuota_id ?? null
    // Generar cargo si tiene tarifa con cargar_unidad y aún no existe
    if (!cuotaId && r.monto_tarifa && r.monto_tarifa > 0 && r.metodo_pago_tarifa === 'cargar_unidad') {
      const periodo = r.fecha.slice(0, 7)
      const { data: cuotaData, error: cuotaErr } = await supabase
        .from('cuotas_condominio')
        .insert({
          company_id: companyId,
          project_id: proyectoId,
          unidad_id: r.unidad_id,
          concepto: 'amenidad',
          monto: r.monto_tarifa,
          periodo,
          fecha_vencimiento: r.fecha,
          estado: 'pendiente',
          notas: `Reserva ${amen?.nombre || 'amenidad'} ${r.fecha} ${r.hora_inicio}-${r.hora_fin}`,
          created_by: userId,
        })
        .select('id')
        .single()
      if (cuotaErr) { Swal.fire('Error', `No se pudo generar el cargo: ${cuotaErr.message}`, 'error'); return }
      cuotaId = cuotaData?.id ?? null
    }
    const { error } = await supabase.from('reservas_amenidades').update({
      estado: 'confirmada',
      aprobada_por: userId,
      aprobada_at: new Date().toISOString(),
      cuota_id: cuotaId,
      rechazada_motivo: null,
    }).eq('id', r.id)
    if (error) {
      if (cuotaId && !r.cuota_id) await supabase.from('cuotas_condominio').delete().eq('id', cuotaId)
      Swal.fire('Error', error.message, 'error'); return
    }
    onRefresh()
  }

  async function rechazarReserva(r: ReservaAmenidad) {
    const { value: motivo } = await Swal.fire({
      title: 'Rechazar reserva',
      input: 'textarea',
      inputLabel: 'Motivo del rechazo',
      inputPlaceholder: 'Ej. el salón está reservado para evento del condominio...',
      showCancelButton: true,
      confirmButtonText: 'Rechazar',
      confirmButtonColor: '#ef4444',
      cancelButtonText: 'Cancelar',
      inputValidator: v => (!v || !v.trim()) ? 'Indica un motivo.' : null,
    })
    if (!motivo) return
    if (r.cuota_id) {
      await supabase.from('cuotas_condominio').delete().eq('id', r.cuota_id).eq('estado', 'pendiente')
    }
    await supabase.from('reservas_amenidades').update({
      estado: 'cancelada',
      rechazada_motivo: motivo.trim(),
    }).eq('id', r.id)
    onRefresh()
  }

  async function eliminarBloqueo(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar bloqueo?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, eliminar', cancelButtonText: 'No', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('amenidades_bloqueos').delete().eq('id', id)
    onRefresh()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>
      <style>{SHIMMER_KEYFRAMES}</style>
      {/* Hero header con gradiente */}
      <div style={{
        background: 'linear-gradient(135deg,#0ea5e9 0%,#0d9488 100%)',
        borderRadius: 20,
        padding: '24px 28px',
        marginBottom: 16,
        color: 'white',
        boxShadow: '0 10px 30px -10px rgba(14,165,233,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.85, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>Módulo de amenidades</div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>Amenidades y Reservas</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13.5, opacity: 0.9 }}>Gestiona el ciclo completo: configuración, reservas, cobros, check-in y depósitos.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canCreate && vista === 'amenidades' && (
            <>
              <button onClick={() => { setShowAmenidadForm(true); setShowBulkForm(false); setEditingAmenidad(null) }} style={btnHero}>+ Amenidad</button>
              <button onClick={() => { setShowBulkForm(true); setShowAmenidadForm(false); setEditingAmenidad(null) }} style={{ ...btnHero, background: 'rgba(255,255,255,0.12)', border: '1.5px solid rgba(255,255,255,0.35)' }}>⬆ Carga masiva</button>
            </>
          )}
          {(vista === 'reservas' || vista === 'calendario') && canCreate && <button onClick={() => { setVista('reservas'); setShowReservaForm(true) }} style={btnHero}>+ Reserva</button>}
          {vista === 'bloqueos' && canEdit && <button onClick={() => setShowBloqueoForm(true)} style={btnHero}>+ Bloqueo</button>}
        </div>
      </div>

      {/* KPIs */}
      {(() => {
        const hoyReservas = reservas.filter(r => r.fecha === hoy && r.estado === 'confirmada').length
        const pendientesAprob = reservas.filter(r => r.estado === 'pendiente' && r.fecha >= hoy).length
        const depositosPorCerrar = reservas.filter(r => r.deposito_estado === 'cobrado' && r.fecha < hoy).length
        const cobrosPendientes = reservas.filter(r => r.metodo_pago_tarifa === 'pagar_momento' && !r.tarifa_pagada && r.estado === 'confirmada' && r.fecha >= hoy).length
        const mes = hoy.slice(0, 7)
        const tarifasMes = reservas
          .filter(r => r.estado === 'confirmada' && r.fecha.startsWith(mes) && r.monto_tarifa)
          .reduce((s, r) => s + Number(r.monto_tarifa || 0), 0)
        const kpis = [
          { label: 'Amenidades activas', value: amenidadesActivas.length, accent: '#0ea5e9', icon: '🏊' },
          { label: 'Reservas hoy', value: hoyReservas, accent: '#0d9488', icon: '📅' },
          { label: 'Pendientes aprobación', value: pendientesAprob, accent: pendientesAprob > 0 ? '#f59e0b' : '#94a3b8', icon: '⏳' },
          { label: 'Depósitos por cerrar', value: depositosPorCerrar, accent: depositosPorCerrar > 0 ? '#dc2626' : '#94a3b8', icon: '💰' },
          { label: 'Cobros en sitio', value: cobrosPendientes, accent: cobrosPendientes > 0 ? '#c2410c' : '#94a3b8', icon: '🎟' },
          { label: `Tarifa cobrada ${mes}`, value: `${moneda} ${tarifasMes.toFixed(2)}`, accent: '#16a34a', icon: '💸' },
        ]
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10, marginBottom: 20 }}>
            {kpis.map(k => (
              <div key={k.label}
                style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 14, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4, position: 'relative', overflow: 'hidden', transition: 'transform 0.15s ease, box-shadow 0.15s ease', cursor: 'default' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px -10px rgba(15,23,42,0.18)' }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, width: 4, height: '100%', background: k.accent }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600 }}>{k.label}</span>
                  <span style={{ fontSize: 16 }}>{k.icon}</span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: k.accent, letterSpacing: '-0.02em' }}>{k.value}</div>
              </div>
            ))}
          </div>
        )
      })()}

      {/* Vista toggle */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {(['amenidades', 'reservas', 'calendario', 'bloqueos', 'recordatorios'] as const).map(v => (
          <button key={v} onClick={() => setVista(v)} style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '13.5px', background: vista === v ? 'linear-gradient(135deg,#0ea5e9,#0d9488)' : '#f1f5f9', color: vista === v ? 'white' : '#374151' }}>
            {v === 'amenidades' ? '🏊 Amenidades' : v === 'reservas' ? '📋 Lista' : v === 'calendario' ? '📆 Calendario' : v === 'bloqueos' ? '🚫 Bloqueos' : '📨 Recordatorios'}
          </button>
        ))}
      </div>

      {/* ── AMENIDADES ── */}
      {vista === 'amenidades' && (
        <>
          {showAmenidadForm && (
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Nueva amenidad</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Nombre *</label>
                  <input value={amenidadForm.nombre} onChange={e => setAmenidadForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej. Piscina, Gimnasio, Salón Social"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Capacidad máxima</label>
                  <input type="number" value={amenidadForm.capacidad_max} onChange={e => setAmenidadForm(f => ({ ...f, capacidad_max: e.target.value }))} placeholder="Personas"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Descripción</label>
                  <input value={amenidadForm.descripcion} onChange={e => setAmenidadForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Opcional"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Horario inicio</label>
                  <input type="time" value={amenidadForm.horario_inicio} onChange={e => setAmenidadForm(f => ({ ...f, horario_inicio: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Horario fin</label>
                  <input type="time" value={amenidadForm.horario_fin} onChange={e => setAmenidadForm(f => ({ ...f, horario_fin: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="checkbox" id="deposito" checked={amenidadForm.requiere_deposito} onChange={e => setAmenidadForm(f => ({ ...f, requiere_deposito: e.target.checked }))} />
                  <label htmlFor="deposito" style={{ fontSize: '13.5px', fontWeight: 600, color: '#374151', cursor: 'pointer' }}>Requiere depósito</label>
                </div>
                {amenidadForm.requiere_deposito && (
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Monto depósito ({moneda})</label>
                    <input type="number" value={amenidadForm.monto_deposito} onChange={e => setAmenidadForm(f => ({ ...f, monto_deposito: e.target.value }))} min="0" step="0.01"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="checkbox" id="tarifa" checked={amenidadForm.requiere_tarifa} onChange={e => setAmenidadForm(f => ({ ...f, requiere_tarifa: e.target.checked }))} />
                  <label htmlFor="tarifa" style={{ fontSize: '13.5px', fontWeight: 600, color: '#374151', cursor: 'pointer' }}>Tarifa por uso</label>
                </div>
                {amenidadForm.requiere_tarifa && (
                  <>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Tarifa entre semana ({moneda})</label>
                      <input type="number" value={amenidadForm.tarifa_uso} onChange={e => setAmenidadForm(f => ({ ...f, tarifa_uso: e.target.value }))} min="0" step="0.01"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Tarifa fin de semana ({moneda})</label>
                      <input type="number" value={amenidadForm.tarifa_uso_finde} onChange={e => setAmenidadForm(f => ({ ...f, tarifa_uso_finde: e.target.value }))} min="0" step="0.01" placeholder="Igual que entre semana"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                    </div>
                  </>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="checkbox" id="aprobacion" checked={amenidadForm.requiere_aprobacion} onChange={e => setAmenidadForm(f => ({ ...f, requiere_aprobacion: e.target.checked }))} />
                  <label htmlFor="aprobacion" style={{ fontSize: '13.5px', fontWeight: 600, color: '#374151', cursor: 'pointer' }}>Requiere aprobación del administrador</label>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Reglamento (opcional)</label>
                  <textarea value={amenidadForm.reglamento} onChange={e => setAmenidadForm(f => ({ ...f, reglamento: e.target.value }))}
                    placeholder="Texto del reglamento que el residente debe aceptar al reservar (horarios, limpieza, daños, invitados, etc.)"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13.5px', background: '#f8fafc', minHeight: 70, resize: 'vertical' }} />
                </div>
                <div style={{ gridColumn: '1 / -1', borderTop: '1px dashed #e2e8f0', paddingTop: 12, marginTop: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 8 }}>Reglas de reserva (opcional)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Máx. reservas/mes por unidad</label>
                      <input type="number" min={1} value={amenidadForm.max_reservas_mes_unidad} onChange={e => setAmenidadForm(f => ({ ...f, max_reservas_mes_unidad: e.target.value }))} placeholder="sin límite"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, background: '#f8fafc' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Antelación mínima (horas)</label>
                      <input type="number" min={0} value={amenidadForm.horas_minimas_antelacion} onChange={e => setAmenidadForm(f => ({ ...f, horas_minimas_antelacion: e.target.value }))} placeholder="sin restricción"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, background: '#f8fafc' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Duración máx. (horas)</label>
                      <input type="number" min={0.5} step={0.5} value={amenidadForm.duracion_max_horas} onChange={e => setAmenidadForm(f => ({ ...f, duracion_max_horas: e.target.value }))} placeholder="sin tope"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, background: '#f8fafc' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Preparación previa (min)</label>
                      <input type="number" min={0} step={5} value={amenidadForm.minutos_preparacion_previa} onChange={e => setAmenidadForm(f => ({ ...f, minutos_preparacion_previa: e.target.value }))} placeholder="0"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, background: '#f8fafc' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Preparación posterior (min)</label>
                      <input type="number" min={0} step={5} value={amenidadForm.minutos_preparacion_posterior} onChange={e => setAmenidadForm(f => ({ ...f, minutos_preparacion_posterior: e.target.value }))} placeholder="0"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, background: '#f8fafc' }} />
                    </div>
                  </div>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <ImageUploader value={amenidadFotoUrl} onChange={setAmenidadFotoUrl} folder="amenidades" label="Foto de la amenidad" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button onClick={guardarAmenidad} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
                <button onClick={() => setShowAmenidadForm(false)} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
              </div>
            </div>
          )}
          {/* Formulario carga masiva */}
          {showBulkForm && (
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: 20, marginBottom: 20 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Carga masiva de amenidades</h3>
              <p style={{ margin: '0 0 16px', fontSize: 12.5, color: '#64748b' }}>Ingresa varias amenidades a la vez. Puedes agregar las fotografías editando cada una después.</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Nombre *', 'Descripción', 'Capacidad máx.', 'Horario inicio', 'Horario fin', ''].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, color: '#374151', borderBottom: '1.5px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bulkRows.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '6px 8px' }}>
                          <input value={row.nombre} onChange={e => setBulkRows(rows => rows.map((r, j) => j === i ? { ...r, nombre: e.target.value } : r))}
                            placeholder="Ej. Piscina" style={{ width: 160, padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 12.5, background: '#f8fafc' }} />
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <input value={row.descripcion} onChange={e => setBulkRows(rows => rows.map((r, j) => j === i ? { ...r, descripcion: e.target.value } : r))}
                            placeholder="Opcional" style={{ width: 160, padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 12.5, background: '#f8fafc' }} />
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <input type="number" min={1} value={row.capacidad_max} onChange={e => setBulkRows(rows => rows.map((r, j) => j === i ? { ...r, capacidad_max: e.target.value } : r))}
                            placeholder="—" style={{ width: 80, padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 12.5, background: '#f8fafc' }} />
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <input type="time" value={row.horario_inicio} onChange={e => setBulkRows(rows => rows.map((r, j) => j === i ? { ...r, horario_inicio: e.target.value } : r))}
                            style={{ width: 110, padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 12.5, background: '#f8fafc' }} />
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <input type="time" value={row.horario_fin} onChange={e => setBulkRows(rows => rows.map((r, j) => j === i ? { ...r, horario_fin: e.target.value } : r))}
                            style={{ width: 110, padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: 12.5, background: '#f8fafc' }} />
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          {bulkRows.length > 1 && (
                            <button onClick={() => setBulkRows(rows => rows.filter((_, j) => j !== i))}
                              style={{ padding: '5px 9px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>×</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                <button onClick={() => setBulkRows(rows => [...rows, emptyBulkRow()])}
                  style={{ padding: '8px 16px', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }}>
                  + Agregar fila
                </button>
                <button onClick={guardarBulk} disabled={savingBulk}
                  style={{ padding: '8px 20px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 12.5 }}>
                  {savingBulk ? 'Guardando...' : `Guardar ${bulkRows.filter(r => r.nombre.trim()).length} amenidad${bulkRows.filter(r => r.nombre.trim()).length !== 1 ? 'es' : ''}`}
                </button>
                <button onClick={() => { setShowBulkForm(false); setBulkRows([emptyBulkRow()]) }}
                  style={{ padding: '8px 16px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12.5 }}>Cancelar</button>
              </div>
            </div>
          )}

          {/* Formulario edición de amenidad */}
          {editingAmenidad && (
            <div style={{ background: 'white', border: '2px solid #0ea5e9', borderRadius: 16, padding: 20, marginBottom: 20 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>Editar amenidad: <span style={{ color: '#0ea5e9' }}>{editingAmenidad.nombre}</span></h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Nombre *</label>
                  <input value={editAmenidadForm.nombre} onChange={e => setEditAmenidadForm(f => ({ ...f, nombre: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Capacidad máxima</label>
                  <input type="number" value={editAmenidadForm.capacidad_max} onChange={e => setEditAmenidadForm(f => ({ ...f, capacidad_max: e.target.value }))} placeholder="Personas"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Descripción</label>
                  <input value={editAmenidadForm.descripcion} onChange={e => setEditAmenidadForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Opcional"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Horario inicio</label>
                  <input type="time" value={editAmenidadForm.horario_inicio} onChange={e => setEditAmenidadForm(f => ({ ...f, horario_inicio: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Horario fin</label>
                  <input type="time" value={editAmenidadForm.horario_fin} onChange={e => setEditAmenidadForm(f => ({ ...f, horario_fin: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, background: '#f8fafc' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" id="edit-deposito" checked={editAmenidadForm.requiere_deposito} onChange={e => setEditAmenidadForm(f => ({ ...f, requiere_deposito: e.target.checked }))} />
                  <label htmlFor="edit-deposito" style={{ fontSize: 13.5, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>Requiere depósito</label>
                </div>
                {editAmenidadForm.requiere_deposito && (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Monto depósito ({moneda})</label>
                    <input type="number" value={editAmenidadForm.monto_deposito} onChange={e => setEditAmenidadForm(f => ({ ...f, monto_deposito: e.target.value }))} min="0" step="0.01"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, background: '#f8fafc' }} />
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" id="edit-tarifa" checked={editAmenidadForm.requiere_tarifa} onChange={e => setEditAmenidadForm(f => ({ ...f, requiere_tarifa: e.target.checked }))} />
                  <label htmlFor="edit-tarifa" style={{ fontSize: 13.5, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>Tarifa por uso</label>
                </div>
                {editAmenidadForm.requiere_tarifa && (
                  <>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Tarifa entre semana ({moneda})</label>
                      <input type="number" value={editAmenidadForm.tarifa_uso} onChange={e => setEditAmenidadForm(f => ({ ...f, tarifa_uso: e.target.value }))} min="0" step="0.01"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, background: '#f8fafc' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Tarifa fin de semana ({moneda})</label>
                      <input type="number" value={editAmenidadForm.tarifa_uso_finde} onChange={e => setEditAmenidadForm(f => ({ ...f, tarifa_uso_finde: e.target.value }))} min="0" step="0.01" placeholder="Igual que entre semana"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, background: '#f8fafc' }} />
                    </div>
                  </>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" id="edit-aprobacion" checked={editAmenidadForm.requiere_aprobacion} onChange={e => setEditAmenidadForm(f => ({ ...f, requiere_aprobacion: e.target.checked }))} />
                  <label htmlFor="edit-aprobacion" style={{ fontSize: 13.5, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>Requiere aprobación del administrador</label>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Reglamento (opcional)</label>
                  <textarea value={editAmenidadForm.reglamento} onChange={e => setEditAmenidadForm(f => ({ ...f, reglamento: e.target.value }))}
                    placeholder="Texto del reglamento"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13.5, background: '#f8fafc', minHeight: 60, resize: 'vertical' }} />
                </div>
                <div style={{ gridColumn: '1 / -1', borderTop: '1px dashed #e2e8f0', paddingTop: 12, marginTop: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 8 }}>Reglas de reserva (opcional)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Máx. reservas/mes por unidad</label>
                      <input type="number" min={1} value={editAmenidadForm.max_reservas_mes_unidad} onChange={e => setEditAmenidadForm(f => ({ ...f, max_reservas_mes_unidad: e.target.value }))} placeholder="sin límite"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, background: '#f8fafc' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Antelación mínima (horas)</label>
                      <input type="number" min={0} value={editAmenidadForm.horas_minimas_antelacion} onChange={e => setEditAmenidadForm(f => ({ ...f, horas_minimas_antelacion: e.target.value }))} placeholder="sin restricción"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, background: '#f8fafc' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Duración máx. (horas)</label>
                      <input type="number" min={0.5} step={0.5} value={editAmenidadForm.duracion_max_horas} onChange={e => setEditAmenidadForm(f => ({ ...f, duracion_max_horas: e.target.value }))} placeholder="sin tope"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, background: '#f8fafc' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Preparación previa (min)</label>
                      <input type="number" min={0} step={5} value={editAmenidadForm.minutos_preparacion_previa} onChange={e => setEditAmenidadForm(f => ({ ...f, minutos_preparacion_previa: e.target.value }))} placeholder="0"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, background: '#f8fafc' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Preparación posterior (min)</label>
                      <input type="number" min={0} step={5} value={editAmenidadForm.minutos_preparacion_posterior} onChange={e => setEditAmenidadForm(f => ({ ...f, minutos_preparacion_posterior: e.target.value }))} placeholder="0"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, background: '#f8fafc' }} />
                    </div>
                  </div>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <ImageUploader value={editAmenidadFotoUrl} onChange={setEditAmenidadFotoUrl} folder="amenidades" label="Foto de la amenidad" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button onClick={guardarEdicion} disabled={savingEdit} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
                  {savingEdit ? 'Guardando...' : 'Guardar cambios'}
                </button>
                <button onClick={() => setEditingAmenidad(null)} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Cancelar</button>
              </div>
            </div>
          )}

          {amenidades.length === 0 ? (
            <EmptyState
              icon="🏊"
              title="Aún no hay amenidades registradas"
              hint="Crea piscinas, salones, gimnasios u otras áreas comunes. Cada amenidad puede tener foto, horario, capacidad, depósito, tarifa y reglas de reserva."
              action={canCreate ? (
                <button onClick={() => setShowAmenidadForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: 13.5 }}>
                  + Crear primera amenidad
                </button>
              ) : null}
            />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {amenidades.map((a, idx) => {
                const reservasA = reservas.filter(r => r.amenidad_id === a.id && r.estado === 'confirmada')
                const proxima = reservasA.filter(r => r.fecha >= hoy).sort((x, y) => (x.fecha + x.hora_inicio).localeCompare(y.fecha + y.hora_inicio))[0]
                const paleta = RESERVA_CAL_COLORS[idx % RESERVA_CAL_COLORS.length]
                return (
                <div key={a.id}
                  style={{
                    background: 'white',
                    border: `1.5px solid ${a.activo ? '#e2e8f0' : '#f1f5f9'}`,
                    borderRadius: 18,
                    overflow: 'hidden',
                    opacity: a.activo ? 1 : 0.55,
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'transform 0.18s ease, box-shadow 0.18s ease',
                    boxShadow: '0 2px 8px -4px rgba(15,23,42,0.08)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 14px 32px -14px rgba(15,23,42,0.25)' }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 8px -4px rgba(15,23,42,0.08)' }}>
                  {/* Hero foto */}
                  <div style={{ position: 'relative', height: 140, background: a.foto_url ? `center/cover no-repeat url(${a.foto_url})` : `linear-gradient(135deg, ${paleta.bg}, ${paleta.border})` }}>
                    {!a.foto_url && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48, opacity: 0.7 }}>🏊</div>
                    )}
                    {/* Overlay gradiente abajo */}
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(15,23,42,0.75) 0%, rgba(15,23,42,0.0) 60%)' }} />
                    {/* Estado pill */}
                    {canEdit && (
                      <button onClick={() => toggleAmenidad(a)}
                        style={{ position: 'absolute', top: 10, right: 10, padding: '4px 10px', borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 800, background: a.activo ? 'rgba(240,253,244,0.95)' : 'rgba(241,245,249,0.95)', color: a.activo ? '#15803d' : '#64748b', backdropFilter: 'blur(4px)', boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>
                        {a.activo ? '● Activa' : '○ Inactiva'}
                      </button>
                    )}
                    {/* Nombre */}
                    <h4 style={{ position: 'absolute', bottom: 12, left: 14, right: 14, margin: 0, fontSize: 18, fontWeight: 800, color: 'white', letterSpacing: '-0.01em', textShadow: '0 2px 6px rgba(0,0,0,0.4)' }}>
                      {a.nombre}
                    </h4>
                  </div>
                  <div style={{ padding: '16px 18px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    {a.descripcion && <p style={{ margin: '0 0 10px', fontSize: 12.5, color: '#475569', lineHeight: 1.45 }}>{a.descripcion}</p>}
                    {/* Datos clave */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11.5, color: '#475569', marginBottom: 10 }}>
                      {a.capacidad_max && <span>👥 Máx <strong>{a.capacidad_max}</strong></span>}
                      {a.horario_inicio && <span>⏰ {a.horario_inicio}–{a.horario_fin}</span>}
                    </div>
                    {/* Badges */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
                      {a.requiere_deposito && <span style={pillStyle('#fffbeb', '#fde68a', '#92400e')}>💰 Dep. {moneda} {a.monto_deposito}</span>}
                      {a.requiere_tarifa && a.tarifa_uso != null && (
                        a.tarifa_uso_finde != null
                          ? <span style={pillStyle('#eff6ff', '#bfdbfe', '#1d4ed8')}>🎟 L–V {moneda} {Number(a.tarifa_uso).toFixed(0)} · S–D {moneda} {Number(a.tarifa_uso_finde).toFixed(0)}</span>
                          : <span style={pillStyle('#eff6ff', '#bfdbfe', '#1d4ed8')}>🎟 {moneda} {Number(a.tarifa_uso).toFixed(2)}</span>
                      )}
                      {a.max_reservas_mes_unidad != null && <span style={pillStyle('#f0f9ff', '#bae6fd', '#0369a1')}>📅 Máx {a.max_reservas_mes_unidad}/mes</span>}
                      {a.horas_minimas_antelacion != null && a.horas_minimas_antelacion > 0 && <span style={pillStyle('#f0f9ff', '#bae6fd', '#0369a1')}>⏱ {a.horas_minimas_antelacion}h</span>}
                      {a.duracion_max_horas != null && <span style={pillStyle('#f0f9ff', '#bae6fd', '#0369a1')}>⌛ {a.duracion_max_horas}h máx</span>}
                      {((a.minutos_preparacion_previa ?? 0) > 0 || (a.minutos_preparacion_posterior ?? 0) > 0) && (
                        <span style={pillStyle('#f5f3ff', '#ddd6fe', '#6d28d9')}>🔧 {(a.minutos_preparacion_previa ?? 0) > 0 ? `${a.minutos_preparacion_previa}min prev.` : ''}{(a.minutos_preparacion_previa ?? 0) > 0 && (a.minutos_preparacion_posterior ?? 0) > 0 ? ' · ' : ''}{(a.minutos_preparacion_posterior ?? 0) > 0 ? `${a.minutos_preparacion_posterior}min post.` : ''}</span>
                      )}
                      {a.requiere_aprobacion && <span style={pillStyle('#fff7ed', '#fed7aa', '#9a3412')}>👤 Aprobación</span>}
                      {a.reglamento && <span style={pillStyle('#f5f3ff', '#ddd6fe', '#6d28d9')}>📜 Reglamento</span>}
                    </div>
                    {/* Stats footer */}
                    <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px dashed #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>
                          <strong style={{ color: paleta.color, fontSize: 14 }}>{reservasA.length}</strong> reservas confirmadas
                        </div>
                        {proxima && (
                          <div style={{ fontSize: 10.5, color: '#64748b' }}>Próxima: {proxima.fecha === hoy ? 'HOY' : new Date(proxima.fecha + 'T12:00').toLocaleDateString('es', { day: '2-digit', month: 'short' })} {proxima.hora_inicio}</div>
                        )}
                      </div>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => abrirEdicion(a)} title="Editar amenidad"
                            style={{ padding: '5px 11px', background: editingAmenidad?.id === a.id ? '#e0f2fe' : '#f0f9ff', color: '#0369a1', border: `1px solid ${editingAmenidad?.id === a.id ? '#7dd3fc' : '#bae6fd'}`, borderRadius: 8, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, transition: 'background 0.15s ease' }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#e0f2fe' }}
                            onMouseLeave={e => { e.currentTarget.style.background = editingAmenidad?.id === a.id ? '#e0f2fe' : '#f0f9ff' }}>
                            ✎ Editar
                          </button>
                          <button onClick={() => eliminarAmenidad(a.id)} title="Eliminar amenidad"
                            style={{ padding: '5px 10px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, transition: 'background 0.15s ease' }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#fee2e2' }}
                            onMouseLeave={e => { e.currentTarget.style.background = '#fef2f2' }}>
                            🗑
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )})}
            </div>
          )}
        </>
      )}

      {/* ── RESERVAS LISTA ── */}
      {vista === 'reservas' && (
        <>
          {showReservaForm && (
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Nueva reserva</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Amenidad *</label>
                  <select value={reservaForm.amenidad_id} onChange={e => setReservaForm(f => ({ ...f, amenidad_id: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                    <option value="">Seleccionar...</option>
                    {amenidadesActivas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Unidad *</label>
                  <select value={reservaForm.unidad_id} onChange={e => setReservaForm(f => ({ ...f, unidad_id: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                    <option value="">Seleccionar...</option>
                    {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Fecha *</label>
                  <input type="date" value={reservaForm.fecha} onChange={e => setReservaForm(f => ({ ...f, fecha: e.target.value }))} min={hoy}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>N° invitados</label>
                  <input type="number" value={reservaForm.num_invitados} onChange={e => setReservaForm(f => ({ ...f, num_invitados: e.target.value }))} min="0"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Hora inicio *</label>
                  <input type="time" value={reservaForm.hora_inicio} onChange={e => setReservaForm(f => ({ ...f, hora_inicio: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Hora fin *</label>
                  <input type="time" value={reservaForm.hora_fin} onChange={e => setReservaForm(f => ({ ...f, hora_fin: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                {(() => {
                  const am = amenidades.find(a => a.id === reservaForm.amenidad_id)
                  if (!am?.requiere_tarifa) return null
                  const tarifa = tarifaAplicable(am, reservaForm.fecha)
                  if (tarifa <= 0) return null
                  const finde = esFinDeSemana(reservaForm.fecha) && am.tarifa_uso_finde != null
                  return (
                    <div style={{ gridColumn: '1 / -1', background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 8 }}>
                        🎟 Tarifa por uso: {moneda} {tarifa.toFixed(2)} {finde && <span style={{ fontSize: 11, fontWeight: 600 }}>(fin de semana)</span>}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                          <input type="radio" name="metodo_pago_admin" checked={reservaForm.metodo_pago_tarifa === 'cargar_unidad'}
                            onChange={() => setReservaForm(f => ({ ...f, metodo_pago_tarifa: 'cargar_unidad' }))} />
                          Cargar a la unidad
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                          <input type="radio" name="metodo_pago_admin" checked={reservaForm.metodo_pago_tarifa === 'pagar_momento'}
                            onChange={() => setReservaForm(f => ({ ...f, metodo_pago_tarifa: 'pagar_momento' }))} />
                          Pagar en sitio
                        </label>
                        {reservaForm.metodo_pago_tarifa === 'pagar_momento' && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151', cursor: 'pointer', marginLeft: 'auto' }}>
                            <input type="checkbox" checked={reservaForm.tarifa_pagada}
                              onChange={e => setReservaForm(f => ({ ...f, tarifa_pagada: e.target.checked }))} />
                            Ya pagado
                          </label>
                        )}
                      </div>
                    </div>
                  )
                })()}
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button onClick={guardarReserva} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
                  {saving ? 'Guardando...' : 'Confirmar reserva'}
                </button>
                <button onClick={() => setShowReservaForm(false)} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
              </div>
            </div>
          )}
          {(() => {
            const pendientesAprob = reservas.filter(r => r.estado === 'pendiente' && r.fecha >= hoy).length
            if (pendientesAprob === 0) return null
            return (
              <div style={{ background: '#fff7ed', border: '1.5px solid #fed7aa', borderRadius: 12, padding: '12px 16px', marginBottom: 12, fontSize: 13, color: '#9a3412', fontWeight: 600 }}>
                ⚠ {pendientesAprob} reserva{pendientesAprob > 1 ? 's' : ''} esperando aprobación.
              </div>
            )
          })()}
          {reservas.length === 0 ? (
            <EmptyState
              icon="📅"
              title="Aún no hay reservas"
              hint="Las reservas que se hagan desde esta vista o desde el portal del residente aparecerán aquí. Puedes crear una manualmente para una unidad."
              action={canCreate ? (
                <button onClick={() => setShowReservaForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: 13.5 }}>
                  + Crear reserva manual
                </button>
              ) : null}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {reservas.sort((a, b) => b.fecha.localeCompare(a.fecha)).map(r => {
                const tieneTarifa = r.monto_tarifa != null && r.monto_tarifa > 0
                const pendientePago = tieneTarifa && r.metodo_pago_tarifa === 'pagar_momento' && !r.tarifa_pagada && r.estado !== 'cancelada'
                const accent = r.estado === 'confirmada' ? '#16a34a' : r.estado === 'pendiente' ? '#f59e0b' : '#94a3b8'
                return (
                <div key={r.id}
                  style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 14, padding: '14px 18px 14px 22px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', position: 'relative', overflow: 'hidden', transition: 'box-shadow 0.15s ease, border-color 0.15s ease' }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 18px -8px rgba(15,23,42,0.18)'; e.currentTarget.style.borderColor = '#cbd5e1' }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = '#e2e8f0' }}>
                  {/* barra acento lateral */}
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: accent }} />
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 800, fontSize: 14.5, color: '#0f172a' }}>{r.amenidad_nombre}</div>
                      <span style={chipStyle(r.estado)}>{r.estado === 'confirmada' ? '✓ Confirmada' : r.estado === 'pendiente' ? '⏳ Pendiente' : '✗ Cancelada'}</span>
                      {r.no_show && <span style={chipStyle('no_show')}>👻 No show</span>}
                      {tieneTarifa && (
                        <span style={chipStyle(pendientePago ? 'cobro_pendiente' : 'pagado')}>
                          🎟 {moneda} {Number(r.monto_tarifa).toFixed(2)}
                          {r.metodo_pago_tarifa === 'cargar_unidad' ? ' · unidad' : (r.tarifa_pagada ? ' · pagado' : ' · pendiente')}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                      🏠 {r.unidad_nombre} · 📅 {r.fecha} · ⏰ {r.hora_inicio}–{r.hora_fin}
                      {r.num_invitados > 0 && ` · 👥 ${r.num_invitados} invitados`}
                    </div>
                    {r.rechazada_motivo && (
                      <div style={{ fontSize: 11.5, color: '#b91c1c', marginTop: 4, fontStyle: 'italic', background: '#fef2f2', padding: '4px 8px', borderRadius: 6, display: 'inline-block' }}>↩ {r.rechazada_motivo}</div>
                    )}
                  </div>
                  {r.estado === 'pendiente' && canEdit && (
                    <>
                      <button onClick={() => aprobarReserva(r)} style={btnAction('#dcfce7', '#bbf7d0', '#15803d')}>✓ Aprobar</button>
                      <button onClick={() => rechazarReserva(r)} style={btnAction('#fee2e2', '#fecaca', '#b91c1c')}>✗ Rechazar</button>
                    </>
                  )}
                  {pendientePago && canEdit && (
                    <button onClick={() => marcarTarifaPagada(r)} style={btnAction('#f0fdf4', '#bbf7d0', '#16a34a')}>Marcar pagado</button>
                  )}
                  {r.fecha < hoy && r.estado === 'confirmada' && canEdit && (
                    <button onClick={() => marcarNoShow(r)} style={btnAction(r.no_show ? '#f1f5f9' : '#fff7ed', r.no_show ? '#cbd5e1' : '#fed7aa', r.no_show ? '#64748b' : '#c2410c')}>
                      {r.no_show ? '↶ Quitar no-show' : 'No show'}
                    </button>
                  )}
                  {canEdit && (
                    <button onClick={() => setReservaDetalle(reservaDetalle?.id === r.id ? null : r)} style={btnAction('#eff6ff', '#bfdbfe', '#2563eb')}>
                      {reservaDetalle?.id === r.id ? 'Cerrar' : '⋯ Detalle'}
                    </button>
                  )}
                  {r.estado !== 'cancelada' && canEdit && (
                    <button onClick={() => cancelarReserva(r.id)} style={btnAction('#fef2f2', '#fecaca', '#dc2626')}>Cancelar</button>
                  )}
                </div>
              )})}
            </div>
          )}
        </>
      )}

      {/* ── CALENDARIO SEMANAL ── */}
      {vista === 'calendario' && (
        <div>
          {/* Navegación de semana */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <button onClick={() => setSemana(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })}
              style={{ padding: '6px 14px', border: '1.5px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', fontSize: 13, background: '#f8fafc', fontWeight: 600 }}>← Ant.</button>
            <div style={{ flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
              Semana del {dias[0].toLocaleDateString('es', { day: 'numeric', month: 'long' })} al {dias[6].toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            <button onClick={() => setSemana(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })}
              style={{ padding: '6px 14px', border: '1.5px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', fontSize: 13, background: '#f8fafc', fontWeight: 600 }}>Sig. →</button>
            <button onClick={() => setSemana(lunesDeSemana(new Date()))}
              style={{ padding: '6px 12px', border: '1.5px solid #bfdbfe', borderRadius: 8, cursor: 'pointer', fontSize: 12, background: '#eff6ff', color: '#2563eb', fontWeight: 600 }}>Hoy</button>
          </div>

          {amenidadesActivas.length === 0 ? (
            <EmptyState icon="📆" title="No hay amenidades activas"
              hint="Activa al menos una amenidad desde la pestaña Amenidades para ver el calendario semanal con horarios y reservas." />
          ) : (() => {
            // Rango horario global
            const minH = Math.min(...amenidadesActivas.map(a => a.horario_inicio ? parseInt(a.horario_inicio.slice(0, 2)) : 8), 8)
            const maxH = Math.max(...amenidadesActivas.map(a => a.horario_fin ? parseInt(a.horario_fin.slice(0, 2)) + (parseInt(a.horario_fin.slice(3, 5)) > 0 ? 1 : 0) : 22), 22)
            const horas = Array.from({ length: maxH - minH + 1 }, (_, i) => minH + i)
            const ROW_H = 220                      // alto de cada fila amenidad
            const minutosTotal = (maxH - minH) * 60
            const toPct = (hhmm: string) => {
              const [h, m] = hhmm.split(':').map(Number)
              return Math.max(0, Math.min(100, ((h - minH) * 60 + m) / minutosTotal * 100))
            }
            return (
              <div style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 14, padding: 16, overflowX: 'auto' }}>
                {/* Header de días */}
                <div style={{ display: 'grid', gridTemplateColumns: `140px repeat(7, minmax(120px,1fr))`, gap: 4, marginBottom: 8, minWidth: 980 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', alignSelf: 'end', paddingBottom: 6 }}>Amenidad / Día</div>
                  {dias.map((d, i) => {
                    const fechaStr = d.toISOString().slice(0, 10)
                    const esHoy = fechaStr === hoy
                    return (
                      <div key={i} style={{ textAlign: 'center', padding: '8px 4px', borderRadius: 10, background: esHoy ? 'linear-gradient(135deg,#0ea5e9,#0d9488)' : '#f8fafc', color: esHoy ? 'white' : '#475569' }}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, opacity: esHoy ? 0.9 : 1 }}>{DIAS_ES[i]}</div>
                        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em' }}>{d.getDate()}</div>
                        <div style={{ fontSize: 9.5, opacity: 0.8, textTransform: 'capitalize' }}>{d.toLocaleDateString('es', { month: 'short' })}</div>
                      </div>
                    )
                  })}
                </div>

                {/* Filas amenidad */}
                {amenidadesActivas.map((a, ai) => {
                  const paleta = RESERVA_CAL_COLORS[ai % RESERVA_CAL_COLORS.length]
                  return (
                    <div key={a.id} style={{ display: 'grid', gridTemplateColumns: `140px repeat(7, minmax(120px,1fr))`, gap: 4, marginBottom: 6, minWidth: 980 }}>
                      {/* Etiqueta de amenidad */}
                      <div style={{ background: 'linear-gradient(135deg,#f8fafc,#f1f5f9)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'center', borderLeft: `4px solid ${paleta.color}` }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a' }}>{a.nombre}</div>
                        {a.horario_inicio && <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>⏰ {a.horario_inicio}–{a.horario_fin}</div>}
                      </div>
                      {dias.map((d, di) => {
                        const fechaStr = d.toISOString().slice(0, 10)
                        const esHoy = fechaStr === hoy
                        const resDia = reservas.filter(r => r.amenidad_id === a.id && r.fecha === fechaStr && r.estado !== 'cancelada')
                        const bloqDia = bloqueos.filter(b => b.amenidad_id === a.id && fechaStr >= b.fecha_inicio && fechaStr <= b.fecha_fin)
                        const bloqDiaCompleto = bloqDia.some(b => !b.hora_inicio || !b.hora_fin)
                        return (
                          <div key={di} style={{
                            position: 'relative',
                            height: ROW_H,
                            background: bloqDiaCompleto
                              ? 'repeating-linear-gradient(45deg,#fef3c7,#fef3c7 6px,#fde68a 6px,#fde68a 12px)'
                              : esHoy ? '#f0f9ff' : '#fcfcfd',
                            border: `1px solid ${esHoy ? '#bae6fd' : '#e2e8f0'}`,
                            borderRadius: 10,
                            overflow: 'hidden',
                            cursor: canCreate && !bloqDiaCompleto ? 'pointer' : 'default',
                          }}
                          onClick={(e) => {
                            // sólo si no es click en una reserva
                            if (canCreate && !bloqDiaCompleto && (e.target as HTMLElement).dataset.role !== 'reserva') {
                              abrirReservaDesdeCalendario(a.id, fechaStr)
                            }
                          }}>
                            {/* Líneas de hora horizontales */}
                            {horas.slice(1).map((h, hi) => (
                              <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: `${((h - minH) / (maxH - minH)) * 100}%`, height: 1, background: hi % 2 === 0 ? '#e2e8f0' : '#f1f5f9' }} />
                            ))}
                            {/* Etiquetas de hora a la izquierda (solo en primera celda de día) */}
                            {di === 0 && horas.map((h, hi) => (
                              <div key={h} style={{ position: 'absolute', left: 2, top: `${(hi / (maxH - minH)) * 100}%`, fontSize: 8.5, color: '#cbd5e1', fontWeight: 600, transform: 'translateY(-3px)', pointerEvents: 'none' }}>
                                {String(h).padStart(2, '0')}
                              </div>
                            ))}
                            {/* Bloqueos por horario */}
                            {bloqDia.filter(b => b.hora_inicio && b.hora_fin).map(b => {
                              const top = toPct(b.hora_inicio!)
                              const bottom = toPct(b.hora_fin!)
                              return (
                                <div key={b.id} title={b.notas || MOTIVO_LABEL[b.motivo]}
                                  style={{ position: 'absolute', left: 4, right: 4, top: `${top}%`, height: `${bottom - top}%`, borderRadius: 6, background: 'repeating-linear-gradient(45deg,#fef3c7,#fef3c7 4px,#fde68a 4px,#fde68a 8px)', border: '1px solid #fcd34d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#92400e' }}>
                                  🚫 {MOTIVO_LABEL[b.motivo]}
                                </div>
                              )
                            })}
                            {/* Reservas */}
                            {resDia.map(r => {
                              const pend = r.estado === 'pendiente'
                              const top = toPct(r.hora_inicio)
                              const bottom = toPct(r.hora_fin)
                              const prepPrevia = a.minutos_preparacion_previa ?? 0
                              const prepPost = a.minutos_preparacion_posterior ?? 0
                              const topPrevia = prepPrevia > 0 ? toPct(addMinutosToTime(r.hora_inicio, -prepPrevia)) : null
                              const bottomPost = prepPost > 0 ? toPct(addMinutosToTime(r.hora_fin, prepPost)) : null
                              return (
                                <Fragment key={r.id}>
                                  {topPrevia !== null && (
                                    <div title={`Preparación previa: ${prepPrevia} min`} style={{ position: 'absolute', left: 6, right: 6, top: `${topPrevia}%`, height: `${top - topPrevia}%`, borderRadius: '6px 6px 0 0', background: `${paleta.color}22`, border: `1px dashed ${paleta.border}`, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: paleta.color, fontWeight: 700 }}>
                                      🔧 {prepPrevia}m
                                    </div>
                                  )}
                                  <div data-role="reserva"
                                    onClick={(e) => { e.stopPropagation(); setSelectedReserva(selectedReserva?.id === r.id ? null : r) }}
                                    title={`${r.unidad_nombre} · ${r.hora_inicio}–${r.hora_fin}${pend ? ' (pendiente)' : ''}`}
                                    style={{
                                      position: 'absolute', left: 6, right: 6,
                                      top: `${top}%`, height: `${Math.max(bottom - top, 4)}%`,
                                      borderRadius: 8, padding: '4px 8px',
                                      background: pend ? 'white' : `linear-gradient(135deg, ${paleta.bg}, ${paleta.border})`,
                                      border: `${pend ? '1.5px dashed' : '1px solid'} ${paleta.border}`,
                                      color: paleta.color, cursor: 'pointer',
                                      boxShadow: pend ? 'none' : '0 2px 6px -2px rgba(0,0,0,0.15)',
                                      overflow: 'hidden', transition: 'transform 0.12s ease',
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.03)' }}
                                    onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}>
                                    <div style={{ fontSize: 10.5, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pend && '⏳ '}{r.unidad_nombre}</div>
                                    <div style={{ fontSize: 9.5, opacity: 0.85, fontWeight: 600 }}>{r.hora_inicio}–{r.hora_fin}</div>
                                  </div>
                                  {bottomPost !== null && (
                                    <div title={`Preparación posterior: ${prepPost} min`} style={{ position: 'absolute', left: 6, right: 6, top: `${bottom}%`, height: `${bottomPost - bottom}%`, borderRadius: '0 0 6px 6px', background: `${paleta.color}22`, border: `1px dashed ${paleta.border}`, borderTop: 'none', pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: paleta.color, fontWeight: 700 }}>
                                      🔧 {prepPost}m
                                    </div>
                                  )}
                                </Fragment>
                              )
                            })}
                            {/* Hover para crear */}
                            {canCreate && !bloqDiaCompleto && resDia.length === 0 && bloqDia.length === 0 && (
                              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 22, pointerEvents: 'none' }}>+</div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}

                {/* Leyenda */}
                <div style={{ display: 'flex', gap: 14, marginTop: 14, flexWrap: 'wrap', fontSize: 11, color: '#64748b' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 14, height: 10, borderRadius: 4, background: '#dbeafe', border: '1px solid #93c5fd' }} /> Confirmada
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 14, height: 10, borderRadius: 4, background: 'white', border: '1.5px dashed #93c5fd' }} /> Pendiente
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 14, height: 10, borderRadius: 4, background: 'repeating-linear-gradient(45deg,#fef3c7,#fef3c7 3px,#fde68a 3px,#fde68a 6px)', border: '1px solid #fcd34d' }} /> Bloqueado
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 14, height: 10, borderRadius: 4, background: '#c4b5fd44', border: '1px dashed #a78bfa' }} /> Preparación
                  </span>
                </div>
              </div>
            )
          })()}

          {/* Detalle de reserva seleccionada */}
          {selectedReserva && (
            <div style={{ marginTop: 16, background: 'white', border: '1.5px solid #bfdbfe', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{selectedReserva.amenidad_nombre}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  {selectedReserva.unidad_nombre} · {selectedReserva.fecha} · {selectedReserva.hora_inicio}–{selectedReserva.hora_fin}
                  {selectedReserva.num_invitados > 0 && ` · ${selectedReserva.num_invitados} invitados`}
                </div>
                {selectedReserva.notas && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{selectedReserva.notas}</div>}
              </div>
              <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: ESTADO_COLORS[selectedReserva.estado]?.bg, color: ESTADO_COLORS[selectedReserva.estado]?.color }}>
                {selectedReserva.estado}
              </span>
              {selectedReserva.estado !== 'cancelada' && canEdit && (
                <button onClick={() => cancelarReserva(selectedReserva.id)}
                  style={{ padding: '5px 12px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  Cancelar
                </button>
              )}
              <button onClick={() => setSelectedReserva(null)}
                style={{ padding: '4px 8px', background: '#f1f5f9', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#64748b' }}>✕</button>
            </div>
          )}

          <div style={{ marginTop: 12, fontSize: 11, color: '#94a3b8' }}>
            Haz clic en una reserva para ver detalles · Haz clic en <strong>+</strong> para crear una nueva reserva en esa fecha y amenidad.
          </div>
        </div>
      )}

      {/* ── BLOQUEOS ── */}
      {vista === 'bloqueos' && (
        <>
          {showBloqueoForm && (
            <div style={{ background: 'white', border: '1.5px solid #fde68a', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Nuevo bloqueo</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Amenidad *</label>
                  <select value={bloqueoForm.amenidad_id} onChange={e => setBloqueoForm(f => ({ ...f, amenidad_id: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                    <option value="">Seleccionar...</option>
                    {amenidades.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Desde *</label>
                  <input type="date" value={bloqueoForm.fecha_inicio} onChange={e => setBloqueoForm(f => ({ ...f, fecha_inicio: e.target.value, fecha_fin: f.fecha_fin || e.target.value }))} min={hoy}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Hasta *</label>
                  <input type="date" value={bloqueoForm.fecha_fin} onChange={e => setBloqueoForm(f => ({ ...f, fecha_fin: e.target.value }))} min={bloqueoForm.fecha_inicio || hoy}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
                <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" id="dia_completo" checked={bloqueoForm.dia_completo} onChange={e => setBloqueoForm(f => ({ ...f, dia_completo: e.target.checked }))} />
                  <label htmlFor="dia_completo" style={{ fontSize: '13.5px', fontWeight: 600, color: '#374151', cursor: 'pointer' }}>Día completo (sin horario específico)</label>
                </div>
                {!bloqueoForm.dia_completo && (
                  <>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Hora inicio *</label>
                      <input type="time" value={bloqueoForm.hora_inicio} onChange={e => setBloqueoForm(f => ({ ...f, hora_inicio: e.target.value }))}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Hora fin *</label>
                      <input type="time" value={bloqueoForm.hora_fin} onChange={e => setBloqueoForm(f => ({ ...f, hora_fin: e.target.value }))}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                    </div>
                  </>
                )}
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Motivo *</label>
                  <select value={bloqueoForm.motivo} onChange={e => setBloqueoForm(f => ({ ...f, motivo: e.target.value as MotivoBloqueoAmenidad }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                    {(Object.keys(MOTIVO_LABEL) as MotivoBloqueoAmenidad[]).map(m => <option key={m} value={m}>{MOTIVO_LABEL[m]}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Notas</label>
                  <input value={bloqueoForm.notas} onChange={e => setBloqueoForm(f => ({ ...f, notas: e.target.value }))} placeholder="Detalle del bloqueo (opcional)"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button onClick={guardarBloqueo} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
                  {saving ? 'Guardando...' : 'Registrar bloqueo'}
                </button>
                <button onClick={() => setShowBloqueoForm(false)} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
              </div>
            </div>
          )}
          {bloqueos.length === 0 ? (
            <EmptyState
              icon="🚫"
              title="No hay bloqueos registrados"
              hint="Registra un bloqueo cuando una amenidad no esté disponible — mantenimiento, limpieza, evento privado, reparación. Puede ser día completo o sólo en un rango horario."
              action={canEdit ? (
                <button onClick={() => setShowBloqueoForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: 13.5 }}>
                  + Registrar bloqueo
                </button>
              ) : null}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {bloqueos
                .slice()
                .sort((a, b) => a.fecha_inicio < b.fecha_inicio ? 1 : -1)
                .map(b => {
                  const vigente = b.fecha_fin >= hoy
                  return (
                    <div key={b.id} style={{ background: 'white', border: `1.5px solid ${vigente ? '#fde68a' : '#e2e8f0'}`, borderRadius: '12px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', opacity: vigente ? 1 : 0.7 }}>
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>
                          {b.amenidad_nombre || amenidades.find(a => a.id === b.amenidad_id)?.nombre || 'Amenidad'}
                          <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 12, fontSize: 10.5, fontWeight: 700, background: '#fef3c7', color: '#92400e' }}>{MOTIVO_LABEL[b.motivo]}</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                          {b.fecha_inicio === b.fecha_fin ? b.fecha_inicio : `${b.fecha_inicio} → ${b.fecha_fin}`}
                          {b.hora_inicio && b.hora_fin ? ` · ${b.hora_inicio}–${b.hora_fin}` : ' · día completo'}
                        </div>
                        {b.notas && <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>{b.notas}</div>}
                      </div>
                      <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 700, background: vigente ? '#fef3c7' : '#f1f5f9', color: vigente ? '#92400e' : '#94a3b8' }}>
                        {vigente ? 'Vigente' : 'Pasado'}
                      </span>
                      {canEdit && (
                        <button onClick={() => eliminarBloqueo(b.id)} style={{ padding: '5px 12px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                          Eliminar
                        </button>
                      )}
                    </div>
                  )
                })}
            </div>
          )}
        </>
      )}

      {/* ── PANEL DETALLE / CHECK-IN-OUT (stepper) ── */}
      {reservaDetalle && (() => {
        const r = reservaDetalle
        const amen = amenidades.find(a => a.id === r.amenidad_id)
        // Pasos del ciclo de la reserva
        const steps: { id: string; label: string; done: boolean; current: boolean; meta?: string; render?: ReactNode }[] = []
        steps.push({
          id: 'creada', label: 'Solicitud creada', done: true, current: false,
          meta: new Date(r.created_at).toLocaleString('es'),
        })
        if (amen?.requiere_aprobacion || r.estado === 'pendiente' || r.aprobada_at || r.rechazada_motivo) {
          const apr = !!r.aprobada_at
          const rch = !!r.rechazada_motivo
          steps.push({
            id: 'aprobacion',
            label: rch ? 'Rechazada' : apr ? 'Aprobada' : 'En aprobación',
            done: apr || rch,
            current: !apr && !rch,
            meta: apr && r.aprobada_at ? new Date(r.aprobada_at).toLocaleString('es') : (rch ? r.rechazada_motivo! : 'Esperando admin'),
          })
        }
        // Check-in
        steps.push({
          id: 'checkin', label: 'Check-in', done: !!r.checkin_at,
          current: !r.checkin_at && r.estado === 'confirmada',
          meta: r.checkin_at ? new Date(r.checkin_at).toLocaleString('es') : 'Pendiente',
          render: (
            <>
              {r.checkin_foto_url && (
                <img src={r.checkin_foto_url} alt="check-in" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 10, marginTop: 8 }} />
              )}
              {!r.checkin_at && canEdit && r.estado === 'confirmada' && (
                <div style={{ marginTop: 10 }}>
                  <ImageUploader value={null} onChange={(url) => registrarCheckin(r, url)} folder="amenidades-checkin" label="Foto del estado inicial" />
                  <button onClick={() => registrarCheckin(r, null)} style={{ marginTop: 6, padding: '6px 12px', background: 'transparent', color: '#0ea5e9', border: '1px dashed #7dd3fc', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
                    Registrar sin foto
                  </button>
                </div>
              )}
              {r.checkin_at && canEdit && !r.checkin_foto_url && !r.checkout_at && (
                <div style={{ marginTop: 8 }}>
                  <ImageUploader value={null} onChange={async (url) => {
                    if (!url) return
                    await supabase.from('reservas_amenidades').update({ checkin_foto_url: url }).eq('id', r.id)
                    onRefresh()
                    setReservaDetalle(d => d ? { ...d, checkin_foto_url: url } : d)
                  }} folder="amenidades-checkin" label="Agregar foto" />
                </div>
              )}
            </>
          ),
        })
        // Check-out
        steps.push({
          id: 'checkout', label: 'Check-out', done: !!r.checkout_at,
          current: !!r.checkin_at && !r.checkout_at,
          meta: r.checkout_at ? new Date(r.checkout_at).toLocaleString('es') : (r.checkin_at ? 'Pendiente' : '—'),
          render: r.checkin_at ? (
            <>
              {r.checkout_foto_url && (
                <img src={r.checkout_foto_url} alt="check-out" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 10, marginTop: 8 }} />
              )}
              {r.observaciones_uso && (
                <div style={{ fontSize: 12.5, color: '#475569', background: '#f8fafc', borderRadius: 8, padding: 8, marginTop: 8 }}>
                  <strong>Observaciones:</strong> {r.observaciones_uso}
                </div>
              )}
              {!r.checkout_at && canEdit && (
                <div style={{ marginTop: 10 }}>
                  <CheckoutForm onSave={(foto, obs) => registrarCheckout(r, foto, obs)} />
                </div>
              )}
            </>
          ) : null,
        })
        // Depósito
        if (amen?.requiere_deposito) {
          const cerrado = r.deposito_estado === 'devuelto' || r.deposito_estado === 'retenido'
          steps.push({
            id: 'deposito',
            label: r.deposito_estado === 'devuelto' ? 'Depósito devuelto'
              : r.deposito_estado === 'retenido' ? 'Depósito retenido'
              : r.deposito_estado === 'cobrado' ? 'Depósito cobrado'
              : 'Depósito pendiente',
            done: cerrado,
            current: !cerrado,
            meta: r.deposito_estado === 'retenido' && r.deposito_retenido_motivo
              ? `${moneda} ${Number(r.deposito_retenido_monto || 0).toFixed(2)} retenido — ${r.deposito_retenido_motivo}`
              : r.deposito_devuelto_at ? `Devuelto el ${new Date(r.deposito_devuelto_at).toLocaleDateString('es')}`
              : `${moneda} ${amen.monto_deposito?.toFixed(2)} en garantía`,
            render: canEdit ? (
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {r.deposito_estado === 'pendiente' && (
                  <button onClick={() => actualizarEstadoDeposito(r, 'cobrado')} style={btnAction('#dbeafe', '#93c5fd', '#1d4ed8')}>💵 Marcar cobrado</button>
                )}
                {r.deposito_estado === 'cobrado' && (
                  <>
                    <button onClick={() => actualizarEstadoDeposito(r, 'devuelto')} style={btnAction('#dcfce7', '#86efac', '#15803d')}>↩ Devolver completo</button>
                    <button onClick={() => retenerDeposito(r)} style={btnAction('#fee2e2', '#fca5a5', '#b91c1c')}>⚠ Retener por daños</button>
                  </>
                )}
              </div>
            ) : null,
          })
        }
        const accent = r.estado === 'confirmada' ? '#0d9488' : r.estado === 'pendiente' ? '#f59e0b' : '#94a3b8'
        return (
          <div onClick={() => setReservaDetalle(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, animation: 'fadeIn 0.15s ease' }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: 'white', borderRadius: 18, maxWidth: 700, width: '100%', maxHeight: '92vh', overflow: 'auto', boxShadow: '0 30px 60px -20px rgba(0,0,0,0.4)' }}>
              {/* Header gradiente */}
              <div style={{ padding: '20px 24px', background: `linear-gradient(135deg, ${accent}, ${accent}dd)`, color: 'white', borderRadius: '18px 18px 0 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.85, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Reserva · {r.estado}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>{r.amenidad_nombre}</div>
                  <div style={{ fontSize: 13, opacity: 0.92, marginTop: 4 }}>
                    🏠 {r.unidad_nombre} · 📅 {new Date(r.fecha + 'T12:00').toLocaleDateString('es', { weekday: 'long', day: '2-digit', month: 'long' })} · ⏰ {r.hora_inicio}–{r.hora_fin}
                  </div>
                </div>
                <button onClick={() => setReservaDetalle(null)} style={{ background: 'rgba(255,255,255,0.18)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>✕</button>
              </div>

              {/* Stepper */}
              <div style={{ padding: 24 }}>
                <div style={{ position: 'relative' }}>
                  {steps.map((s, i) => {
                    const isLast = i === steps.length - 1
                    const dotColor = s.done ? '#16a34a' : s.current ? accent : '#cbd5e1'
                    const lineColor = s.done ? '#86efac' : '#e2e8f0'
                    return (
                      <div key={s.id} style={{ display: 'flex', gap: 14, position: 'relative', paddingBottom: isLast ? 0 : 18 }}>
                        {/* Línea vertical */}
                        {!isLast && (
                          <div style={{ position: 'absolute', left: 13, top: 28, bottom: 0, width: 2, background: lineColor }} />
                        )}
                        {/* Bullet */}
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%',
                          background: s.done ? '#dcfce7' : s.current ? `${accent}22` : '#f1f5f9',
                          border: `2px solid ${dotColor}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: dotColor, fontWeight: 800, fontSize: 13,
                          flexShrink: 0, zIndex: 1, position: 'relative',
                          boxShadow: s.current ? `0 0 0 4px ${accent}22` : 'none',
                        }}>
                          {s.done ? '✓' : i + 1}
                        </div>
                        {/* Contenido */}
                        <div style={{ flex: 1, paddingTop: 2 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <div style={{ fontWeight: 800, fontSize: 14, color: s.done ? '#0f172a' : s.current ? '#0f172a' : '#94a3b8' }}>{s.label}</div>
                            {s.id === 'aprobacion' && r.estado === 'pendiente' && canEdit && (
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => aprobarReserva(r)} style={btnAction('#dcfce7', '#bbf7d0', '#15803d')}>✓ Aprobar</button>
                                <button onClick={() => rechazarReserva(r)} style={btnAction('#fee2e2', '#fecaca', '#b91c1c')}>✗ Rechazar</button>
                              </div>
                            )}
                          </div>
                          {s.meta && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{s.meta}</div>}
                          {s.render && <div>{s.render}</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Datos extra: tarifa y notas */}
                {(r.monto_tarifa || r.notas) && (
                  <div style={{ marginTop: 18, padding: 14, background: '#f8fafc', borderRadius: 12 }}>
                    {r.monto_tarifa != null && r.monto_tarifa > 0 && (
                      <div style={{ fontSize: 12.5, color: '#475569', marginBottom: r.notas ? 6 : 0 }}>
                        🎟 <strong>Tarifa:</strong> {moneda} {Number(r.monto_tarifa).toFixed(2)} ·
                        {r.metodo_pago_tarifa === 'cargar_unidad' ? ' cargado a unidad' : (r.tarifa_pagada ? ' pagado en sitio' : ' por cobrar en sitio')}
                      </div>
                    )}
                    {r.notas && <div style={{ fontSize: 12.5, color: '#475569' }}>📝 {r.notas}</div>}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── RECORDATORIOS ── */}
      {vista === 'recordatorios' && (() => {
        const limite = new Date()
        limite.setDate(limite.getDate() + 2)
        const limiteStr = limite.toISOString().slice(0, 10)
        const proximas = reservas
          .filter(r => r.estado !== 'cancelada' && r.fecha >= hoy && r.fecha <= limiteStr)
          .sort((a, b) => (a.fecha + a.hora_inicio).localeCompare(b.fecha + b.hora_inicio))
        const pendientes = proximas.filter(r => !r.recordatorio_enviado)

        return (
          <>
            <div style={{ background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: 12, padding: '14px 18px', marginBottom: 16, fontSize: 13, color: '#1e40af' }}>
              📨 Reservas para hoy y los próximos 2 días: <strong>{proximas.length}</strong> · Sin recordatorio enviado: <strong>{pendientes.length}</strong>
              <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4 }}>Al hacer clic en <strong>Enviar WhatsApp</strong> se abrirá la app/web de WhatsApp con el mensaje listo. La reserva queda marcada como recordada.</div>
            </div>
            {proximas.length === 0 ? (
              <EmptyState icon="📨" title="No hay reservas próximas para recordar"
                hint="Cuando haya reservas confirmadas para hoy o los próximos 2 días, aparecerán aquí con un botón para enviarles WhatsApp." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {proximas.map(r => {
                  const unidad = unidades.find(u => u.id === r.unidad_id)
                  const tieneTel = !!unidad?.propietario_telefono?.trim()
                  return (
                    <div key={r.id} style={{ background: 'white', border: `1.5px solid ${r.recordatorio_enviado ? '#bbf7d0' : '#e2e8f0'}`, borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{r.amenidad_nombre}</div>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                          {r.unidad_nombre} · {r.fecha === hoy ? 'HOY' : new Date(r.fecha + 'T12:00:00').toLocaleDateString('es', { weekday: 'long', day: '2-digit', month: 'long' })} · {r.hora_inicio}–{r.hora_fin}
                        </div>
                        <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>
                          {unidad?.propietario_nombre || '— sin propietario —'} {tieneTel ? `· ${unidad?.propietario_telefono}` : '· sin teléfono'}
                        </div>
                      </div>
                      {r.recordatorio_enviado && (
                        <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 700, background: '#f0fdf4', color: '#16a34a' }}>
                          ✓ Enviado
                        </span>
                      )}
                      <button onClick={() => enviarRecordatorio(r)} disabled={!tieneTel}
                        style={{ padding: '7px 14px', background: tieneTel ? '#25d366' : '#e2e8f0', color: tieneTel ? 'white' : '#94a3b8', border: 'none', borderRadius: 8, cursor: tieneTel ? 'pointer' : 'not-allowed', fontSize: 12.5, fontWeight: 700 }}
                        title={tieneTel ? 'Abrir WhatsApp con mensaje' : 'Falta teléfono del propietario'}>
                        💬 {r.recordatorio_enviado ? 'Reenviar' : 'Enviar WhatsApp'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )
      })()}
    </div>
  )
}

function EmptyState({ icon, title, hint, action }: { icon: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '56px 24px', textAlign: 'center',
      background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
      border: '1.5px dashed #cbd5e1', borderRadius: 16,
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%',
        background: 'linear-gradient(135deg,#e0f2fe,#ccfbf1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 32, marginBottom: 14,
        boxShadow: '0 8px 20px -8px rgba(14,165,233,0.35)',
      }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', marginBottom: 4 }}>{title}</div>
      {hint && <div style={{ fontSize: 12.5, color: '#64748b', maxWidth: 360, lineHeight: 1.5, marginBottom: action ? 14 : 0 }}>{hint}</div>}
      {action}
    </div>
  )
}

const SHIMMER_KEYFRAMES = `@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`

function CheckoutForm({ onSave }: { onSave: (foto: string | null, obs: string) => void }) {
  const [foto, setFoto] = useState<string | null>(null)
  const [obs, setObs] = useState('')
  return (
    <>
      <ImageUploader value={foto} onChange={setFoto} folder="amenidades-checkout" label="Foto de cierre (opcional)" />
      <textarea value={obs} onChange={e => setObs(e.target.value)} placeholder="Observaciones del estado al salir (daños, basura, mobiliario, etc.)"
        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13.5, background: '#f8fafc', marginTop: 8, minHeight: 60, resize: 'vertical' }} />
      <button onClick={() => onSave(foto, obs)} style={{ marginTop: 10, padding: '8px 16px', background: '#0d9488', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
        Registrar check-out
      </button>
    </>
  )
}
