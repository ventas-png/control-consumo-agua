import { hoyLocalISO, formatFechaCalendario } from '../../../lib/format'
import { useState } from 'react'
import { ImportAmenidadesModal } from '../ImportAmenidadesModal'
import { notify, confirm } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import {
  createCondominioRow,
  createCondominioRowReturning,
  updateCondominioRow,
  deleteCondominioRow,
} from '../../../domain/condominios/tabMutations'
import { softDelete } from '../../../lib/softDelete'
import type { Amenidad, ReservaAmenidad, BloqueoAmenidad, MotivoBloqueoAmenidad, EstadoDepositoReserva, Unidad } from '../../../types'
import { useSignedUrls } from '../../../lib/storageUrls'
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

import {
  bloqueoSolapaReserva,
  tarifaAplicable,
  addMinutosToTime,
  validarReglasAmenidad,
  lunesDeSemana,
  diasDeSemana,
} from '../../../lib/amenidadesReglas'
import {
  MOTIVO_LABEL,
  btnHero,
} from './amenidades/ui'
import type { AmenidadesCtx } from './amenidades/ctx'
import { VistaAmenidades } from './amenidades/VistaAmenidades'
import { VistaReservas } from './amenidades/VistaReservas'
import { VistaCalendario } from './amenidades/VistaCalendario'
import { VistaBloqueos } from './amenidades/VistaBloqueos'
import { ReservaDetalle } from './amenidades/ReservaDetalle'
import { VistaRecordatorios } from './amenidades/VistaRecordatorios'

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

  const [showImportModal, setShowImportModal] = useState(false)

  // Edición de amenidad existente
  const [editingAmenidad, setEditingAmenidad] = useState<Amenidad | null>(null)
  const [editAmenidadFotoUrl, setEditAmenidadFotoUrl] = useState<string | null>(null)
  const [editAmenidadForm, setEditAmenidadForm] = useState({ nombre: '', descripcion: '', capacidad_max: '', horario_inicio: '', horario_fin: '', requiere_deposito: false, monto_deposito: '', requiere_tarifa: false, tarifa_uso: '', tarifa_uso_finde: '', max_reservas_mes_unidad: '', horas_minimas_antelacion: '', duracion_max_horas: '', minutos_preparacion_previa: '', minutos_preparacion_posterior: '', requiere_aprobacion: false, reglamento: '' })
  const [savingEdit, setSavingEdit] = useState(false)

  const hoy = hoyLocalISO()
  const amenidadesActivas = amenidades.filter(a => a.activo)
  const dias = diasDeSemana(semana)
  // Firma las fotos (paths bare en condominios-media tras la migración S6) en
  // UNA petición batch; se indexa por la misma posición que `amenidades`.
  const amenidadFotoUrls = useSignedUrls(amenidades.map(a => a.foto_url), 'condominios-media')

  function abrirReservaDesdeCalendario(amenidadId: string, fecha: string) {
    setReservaForm(f => ({ ...f, amenidad_id: amenidadId, fecha }))
    setVista('reservas')
    setShowReservaForm(true)
  }

  async function guardarAmenidad() {
    if (!amenidadForm.nombre.trim()) { notify({ variant: 'error', title: 'Error', text: 'Ingrese el nombre.' }); return }
    if (amenidadForm.requiere_tarifa && !amenidadForm.tarifa_uso) { notify({ variant: 'error', title: 'Error', text: 'Indique el monto de la tarifa por uso.' }); return }
    setSaving(true)
    const { error } = await createCondominioRow('amenidades', {
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
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setAmenidadForm({ nombre: '', descripcion: '', capacidad_max: '', horario_inicio: '', horario_fin: '', requiere_deposito: false, monto_deposito: '', requiere_tarifa: false, tarifa_uso: '', tarifa_uso_finde: '', max_reservas_mes_unidad: '', horas_minimas_antelacion: '', duracion_max_horas: '', minutos_preparacion_previa: '', minutos_preparacion_posterior: '', requiere_aprobacion: false, reglamento: '' })
    setAmenidadFotoUrl(null)
    setShowAmenidadForm(false)
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
  }

  async function guardarEdicion() {
    if (!editingAmenidad) return
    if (!editAmenidadForm.nombre.trim()) { notify({ variant: 'error', title: 'Error', text: 'Ingrese el nombre.' }); return }
    if (editAmenidadForm.requiere_tarifa && !editAmenidadForm.tarifa_uso) { notify({ variant: 'error', title: 'Error', text: 'Indique el monto de la tarifa por uso.' }); return }
    setSavingEdit(true)
    const { error } = await updateCondominioRow('amenidades', editingAmenidad.id, {
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
    })
    setSavingEdit(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setEditingAmenidad(null)
    onRefresh()
  }

  async function toggleAmenidad(a: Amenidad) {
    await updateCondominioRow('amenidades', a.id, { activo: !a.activo })
    onRefresh()
  }

  async function eliminarAmenidad(id: string) {
    const reservasActivas = reservas.filter(
      r => r.amenidad_id === id && (r.estado === 'confirmada' || r.estado === 'pendiente')
    )
    if (reservasActivas.length > 0) {
      notify({
        variant: 'warning',
        title: 'No se puede eliminar',
        text: `Esta amenidad tiene ${reservasActivas.length} reserva${reservasActivas.length !== 1 ? 's' : ''} activa${reservasActivas.length !== 1 ? 's' : ''}. Cancélalas primero.`,
      })
      return
    }
    const r = await confirm({ title: '¿Eliminar amenidad?', text: 'Esta acción no se puede deshacer.', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow('amenidades', id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  async function guardarReserva() {
    if (!reservaForm.amenidad_id || !reservaForm.unidad_id || !reservaForm.fecha || !reservaForm.hora_inicio || !reservaForm.hora_fin) {
      notify({ variant: 'error', title: 'Error', text: 'Complete todos los campos requeridos.' }); return
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
    if (conflict) { notify({ variant: 'warning', title: 'Conflicto', text: 'Ya existe una reserva confirmada en ese horario para esta amenidad (incluyendo tiempos de preparación).' }); return }

    const bloqueo = bloqueos.find(b =>
      b.amenidad_id === reservaForm.amenidad_id &&
      bloqueoSolapaReserva(b, reservaForm.fecha, reservaForm.hora_inicio, reservaForm.hora_fin)
    )
    if (bloqueo) {
      const detalle = bloqueo.hora_inicio
        ? `${bloqueo.fecha_inicio === bloqueo.fecha_fin ? bloqueo.fecha_inicio : `${bloqueo.fecha_inicio} → ${bloqueo.fecha_fin}`} ${bloqueo.hora_inicio}–${bloqueo.hora_fin}`
        : `${bloqueo.fecha_inicio === bloqueo.fecha_fin ? bloqueo.fecha_inicio : `${bloqueo.fecha_inicio} → ${bloqueo.fecha_fin}`} (día completo)`
      notify({ variant: 'warning', title: 'Amenidad bloqueada', text: `${MOTIVO_LABEL[bloqueo.motivo]} · ${detalle}` })
      return
    }

    const amen = amenidades.find(a => a.id === reservaForm.amenidad_id)
    if (amen) {
      const errReglas = validarReglasAmenidad(amen, reservaForm.fecha, reservaForm.hora_inicio, reservaForm.hora_fin, reservaForm.unidad_id, reservas)
      if (errReglas) { notify({ variant: 'warning', title: 'No permitido', text: errReglas }); return }
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
      const { data: cuotaData, error: cuotaErr } = await createCondominioRowReturning('cuotas_condominio', {
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
      if (cuotaErr) { setSaving(false); notify({ variant: 'error', title: 'Error', text: `No se pudo generar el cargo: ${cuotaErr.message}` }); return }
      cuotaId = (cuotaData?.id as string | undefined) ?? null
    }

    const tarifaPagada = aplicaTarifa && metodoPago === 'pagar_momento' ? reservaForm.tarifa_pagada : false

    const { error } = await createCondominioRow('reservas_amenidades', {
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
      if (cuotaId) await softDelete('cuotas_condominio', { id: cuotaId })
      notify({ variant: 'error', title: 'Error', text: error.message }); return
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
    notify({ variant: 'success', title: msg, duration: 2400 })
    onRefresh()
  }

  async function cancelarReserva(id: string) {
    const r = await confirm({ title: '¿Cancelar reserva?', icon: 'warning', variant: 'danger', confirmText: 'Sí, cancelar', cancelText: 'No' })
    if (!r.isConfirmed) return
    const reserva = reservas.find(x => x.id === id)
    await updateCondominioRow('reservas_amenidades', id, { estado: 'cancelada' })
    if (reserva?.cuota_id) {
      await softDelete('cuotas_condominio', { id: reserva.cuota_id, estado: 'pendiente' })
    }
    setSelectedReserva(null)
    onRefresh()
  }

  async function marcarNoShow(r: ReservaAmenidad) {
    const update = !r.no_show
    await updateCondominioRow('reservas_amenidades', r.id, { no_show: update })
    onRefresh()
  }

  async function marcarTarifaPagada(r: ReservaAmenidad) {
    const update: Record<string, unknown> = { tarifa_pagada: true }
    const { error } = await updateCondominioRow('reservas_amenidades', r.id, update)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  async function guardarBloqueo() {
    if (!bloqueoForm.amenidad_id || !bloqueoForm.fecha_inicio || !bloqueoForm.fecha_fin) {
      notify({ variant: 'error', title: 'Error', text: 'Seleccione amenidad y rango de fechas.' }); return
    }
    if (bloqueoForm.fecha_fin < bloqueoForm.fecha_inicio) {
      notify({ variant: 'error', title: 'Error', text: 'La fecha fin debe ser igual o posterior a la fecha inicio.' }); return
    }
    if (!bloqueoForm.dia_completo) {
      if (!bloqueoForm.hora_inicio || !bloqueoForm.hora_fin) { notify({ variant: 'error', title: 'Error', text: 'Indique horario o marque día completo.' }); return }
      if (bloqueoForm.hora_fin <= bloqueoForm.hora_inicio) { notify({ variant: 'error', title: 'Error', text: 'La hora fin debe ser posterior a la hora inicio.' }); return }
    }
    setSaving(true)
    const { error } = await createCondominioRow('amenidades_bloqueos', {
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
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setBloqueoForm({ amenidad_id: '', fecha_inicio: '', fecha_fin: '', dia_completo: true, hora_inicio: '', hora_fin: '', motivo: 'mantenimiento', notas: '' })
    setShowBloqueoForm(false)
    notify({ variant: 'success', title: 'Bloqueo registrado', duration: 1500 })
    onRefresh()
  }

  function buildMensajeRecordatorio(r: ReservaAmenidad, unidad: Unidad | undefined): string {
    const fechaStr = formatFechaCalendario(r.fecha, { weekday: 'long', day: '2-digit', month: 'long' }, 'es', '—')
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
      notify({ variant: 'warning', title: 'Sin teléfono', text: `La unidad ${r.unidad_nombre || ''} no tiene un teléfono registrado para el propietario.` })
      return
    }
    const mensaje = buildMensajeRecordatorio(r, unidad)
    const url = `https://wa.me/${formatPhoneForWa(tel)}?text=${encodeURIComponent(mensaje)}`
    window.open(url, '_blank', 'noopener,noreferrer')
    await updateCondominioRow('reservas_amenidades', r.id, { recordatorio_enviado: true, recordatorio_enviado_at: new Date().toISOString() })
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
    const { error } = await updateCondominioRow('reservas_amenidades', r.id, update)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
    setReservaDetalle(d => d && d.id === r.id ? { ...d, ...update } as ReservaAmenidad : d)
  }

  async function registrarCheckout(r: ReservaAmenidad, fotoUrl: string | null, observaciones: string) {
    const { error } = await updateCondominioRow('reservas_amenidades', r.id, {
      checkout_at: new Date().toISOString(),
      checkout_foto_url: fotoUrl,
      checkout_por: userId,
      observaciones_uso: observaciones || null,
    })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
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
    const { error } = await updateCondominioRow('reservas_amenidades', r.id, update)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
    setReservaDetalle(d => d && d.id === r.id ? { ...d, ...update } as ReservaAmenidad : d)
  }

  async function retenerDeposito(r: ReservaAmenidad) {
    const amen = amenidades.find(a => a.id === r.amenidad_id)
    const tope = amen?.monto_deposito ?? null
    const result = await openPromptDialog({
      title: 'Retener depósito',
      description: `Indica el monto que se retiene${tope != null ? ` (máximo ${moneda} ${tope.toFixed(2)})` : ''} y el motivo. Opcionalmente puedes generar un cargo a la unidad.`,
      fields: [
        {
          name: 'monto',
          label: `Monto retenido (${moneda})`,
          type: 'number',
          min: 0,
          max: tope ?? undefined,
          step: 0.01,
          required: true,
          autoFocus: true,
        },
        {
          name: 'motivo',
          label: 'Motivo de la retención',
          control: 'textarea',
          rows: 3,
          required: true,
        },
        {
          name: 'cargo',
          label: 'Generar cargo a la unidad',
          control: 'select',
          options: [
            { value: 'no', label: 'No, solo retener depósito' },
            { value: 'si', label: 'Sí, generar cargo a la unidad' },
          ],
          initialValue: 'no',
        },
      ],
      submitText: 'Retener',
      validate: (data) => {
        const monto = Number(data.monto)
        if (!monto || monto <= 0) return 'Indica un monto mayor a 0.'
        if (!data.motivo?.trim()) return 'Indica un motivo.'
        if (tope != null && monto > tope) return `El monto excede el depósito (${tope}).`
        return null
      },
    })
    if (!result) return
    const form = { monto: Number(result.monto), motivo: result.motivo.trim(), cargo: result.cargo === 'si' }
    let cuotaId: string | null = null
    if (form.cargo) {
      const periodo = r.fecha.slice(0, 7)
      const { data: cuotaData, error: cuotaErr } = await createCondominioRowReturning('cuotas_condominio', {
          company_id: companyId,
          project_id: proyectoId,
          unidad_id: r.unidad_id,
          concepto: 'amenidad',
          monto: form.monto,
          periodo,
          fecha_vencimiento: hoyLocalISO(),
          estado: 'pendiente',
          notas: `Retención por daños — ${amen?.nombre || 'amenidad'} · ${r.fecha} · ${form.motivo}`,
          created_by: userId,
      })
      if (cuotaErr) { notify({ variant: 'error', title: 'Error', text: `No se pudo generar el cargo: ${cuotaErr.message}` }); return }
      cuotaId = (cuotaData?.id as string | undefined) ?? null
    }
    const update = {
      deposito_estado: 'retenido' as EstadoDepositoReserva,
      deposito_retenido_monto: form.monto,
      deposito_retenido_motivo: form.motivo,
      cuota_retencion_id: cuotaId,
    }
    const { error } = await updateCondominioRow('reservas_amenidades', r.id, update)
    if (error) {
      if (cuotaId) await softDelete('cuotas_condominio', { id: cuotaId })
      notify({ variant: 'error', title: 'Error', text: error.message }); return
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
      notify({ variant: 'warning', title: 'Conflicto', text: 'Otra reserva ya confirmada ocupa ese horario (incluyendo tiempos de preparación). No es posible aprobar.' })
      return
    }
    const amen = amenidades.find(a => a.id === r.amenidad_id)
    let cuotaId: string | null = r.cuota_id ?? null
    // Generar cargo si tiene tarifa con cargar_unidad y aún no existe
    if (!cuotaId && r.monto_tarifa && r.monto_tarifa > 0 && r.metodo_pago_tarifa === 'cargar_unidad') {
      const periodo = r.fecha.slice(0, 7)
      const { data: cuotaData, error: cuotaErr } = await createCondominioRowReturning('cuotas_condominio', {
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
      if (cuotaErr) { notify({ variant: 'error', title: 'Error', text: `No se pudo generar el cargo: ${cuotaErr.message}` }); return }
      cuotaId = (cuotaData?.id as string | undefined) ?? null
    }
    const { error } = await updateCondominioRow('reservas_amenidades', r.id, {
      estado: 'confirmada',
      aprobada_por: userId,
      aprobada_at: new Date().toISOString(),
      cuota_id: cuotaId,
      rechazada_motivo: null,
    })
    if (error) {
      if (cuotaId && !r.cuota_id) await softDelete('cuotas_condominio', { id: cuotaId })
      notify({ variant: 'error', title: 'Error', text: error.message }); return
    }
    onRefresh()
  }

  async function rechazarReserva(r: ReservaAmenidad) {
    const result = await openPromptDialog({
      title: 'Rechazar reserva',
      fields: [{
        name: 'motivo',
        label: 'Motivo del rechazo',
        control: 'textarea',
        rows: 4,
        placeholder: 'Ej. el salón está reservado para evento del condominio...',
        required: true,
        autoFocus: true,
      }],
      submitText: 'Rechazar',
      validate: (data) => data.motivo?.trim() ? null : 'Indica un motivo.',
    })
    if (!result) return
    const motivo = result.motivo
    if (r.cuota_id) {
      await softDelete('cuotas_condominio', { id: r.cuota_id, estado: 'pendiente' })
    }
    await updateCondominioRow('reservas_amenidades', r.id, {
      estado: 'cancelada',
      rechazada_motivo: motivo.trim(),
    })
    onRefresh()
  }

  async function eliminarBloqueo(id: string) {
    const r = await confirm({ title: '¿Eliminar bloqueo?', icon: 'warning', variant: 'danger', confirmText: 'Sí, eliminar', cancelText: 'No' })
    if (!r.isConfirmed) return
    await deleteCondominioRow('amenidades_bloqueos', id)
    onRefresh()
  }

  const ctx: AmenidadesCtx = {
    amenidades, reservas, bloqueos, unidades, proyectoId, companyId, userId, moneda, canCreate, canEdit, onRefresh,
    showAmenidadForm, setShowAmenidadForm, showReservaForm, setShowReservaForm, showBloqueoForm, setShowBloqueoForm, saving, amenidadFotoUrl, setAmenidadFotoUrl, amenidadForm, setAmenidadForm, reservaForm, setReservaForm, bloqueoForm,
    setBloqueoForm, semana, setSemana, selectedReserva, setSelectedReserva, reservaDetalle, setReservaDetalle, editingAmenidad, setEditingAmenidad, editAmenidadFotoUrl, setEditAmenidadFotoUrl, editAmenidadForm, setEditAmenidadForm, savingEdit,
    hoy, amenidadesActivas, dias, amenidadFotoUrls,
    abrirReservaDesdeCalendario, abrirEdicion, guardarAmenidad, guardarEdicion, toggleAmenidad, eliminarAmenidad, guardarReserva, cancelarReserva, marcarNoShow, marcarTarifaPagada, guardarBloqueo, enviarRecordatorio, registrarCheckin, registrarCheckout, actualizarEstadoDeposito, retenerDeposito, aprobarReserva, rechazarReserva, eliminarBloqueo,
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>
      {/* Hero header con gradiente */}
      <div style={{
        background: 'linear-gradient(135deg,var(--at-primary) 0%,var(--at-accent-2) 100%)',
        borderRadius: 20,
        padding: '24px 28px',
        marginBottom: 16,
        color: 'white',
        boxShadow: '0 10px 30px -10px rgba(27, 59, 54,0.4)',
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
              <button onClick={() => { setShowAmenidadForm(true); setEditingAmenidad(null) }} style={btnHero}>+ Amenidad</button>
              <button onClick={() => setShowImportModal(true)} style={{ ...btnHero, background: 'rgba(255,255,255,0.12)', border: '1.5px solid rgba(255,255,255,0.35)' }}>⬆ Carga masiva</button>
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
          { label: 'Amenidades activas', value: amenidadesActivas.length, accent: 'var(--at-primary)', icon: '🏊' },
          { label: 'Reservas hoy', value: hoyReservas, accent: 'var(--at-accent-2)', icon: '📅' },
          { label: 'Pendientes aprobación', value: pendientesAprob, accent: pendientesAprob > 0 ? 'var(--at-warning)' : 'var(--at-ink-3)', icon: '⏳' },
          { label: 'Depósitos por cerrar', value: depositosPorCerrar, accent: depositosPorCerrar > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)', icon: '💰' },
          { label: 'Cobros en sitio', value: cobrosPendientes, accent: cobrosPendientes > 0 ? 'var(--at-warning-strong)' : 'var(--at-ink-3)', icon: '🎟' },
          { label: `Tarifa cobrada ${mes}`, value: `${moneda} ${tarifasMes.toFixed(2)}`, accent: 'var(--at-success)', icon: '💸' },
        ]
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10, marginBottom: 20 }}>
            {kpis.map(k => (
              <div key={k.label}
                style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: 14, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4, position: 'relative', overflow: 'hidden', transition: 'transform 0.15s ease, box-shadow 0.15s ease', cursor: 'default' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px -10px rgba(15,23,42,0.18)' }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, width: 4, height: '100%', background: k.accent }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11.5, color: 'var(--at-ink-3)', fontWeight: 600 }}>{k.label}</span>
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
          <button key={v} onClick={() => setVista(v)} style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '13.5px', background: vista === v ? 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))' : 'var(--at-chip)', color: vista === v ? 'white' : 'var(--at-ink-2)' }}>
            {v === 'amenidades' ? '🏊 Amenidades' : v === 'reservas' ? '📋 Lista' : v === 'calendario' ? '📆 Calendario' : v === 'bloqueos' ? '🚫 Bloqueos' : '📨 Recordatorios'}
          </button>
        ))}
      </div>

      {/* ── AMENIDADES ── */}
      {vista === 'amenidades' && <VistaAmenidades ctx={ctx} />}

      {/* ── RESERVAS LISTA ── */}
      {vista === 'reservas' && <VistaReservas ctx={ctx} />}

      {/* ── CALENDARIO SEMANAL ── */}
      {vista === 'calendario' && <VistaCalendario ctx={ctx} />}

      {/* ── BLOQUEOS ── */}
      {vista === 'bloqueos' && <VistaBloqueos ctx={ctx} />}

      {/* ── PANEL DETALLE / CHECK-IN-OUT (stepper) ── */}
      <ReservaDetalle ctx={ctx} />

      {/* ── RECORDATORIOS ── */}
      {vista === 'recordatorios' && <VistaRecordatorios ctx={ctx} />}

      {/* Modal de carga masiva */}
      {showImportModal && (
        <ImportAmenidadesModal
          proyectoId={proyectoId}
          companyId={companyId}
          onClose={() => setShowImportModal(false)}
          onImportado={() => { setShowImportModal(false); onRefresh() }}
        />
      )}
    </div>
  )
}

