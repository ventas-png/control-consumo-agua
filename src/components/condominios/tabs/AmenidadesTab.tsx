import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { Amenidad, ReservaAmenidad, BloqueoAmenidad, MotivoBloqueoAmenidad, Unidad } from '../../../types'
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
  const [amenidadForm, setAmenidadForm] = useState({ nombre: '', descripcion: '', capacidad_max: '', horario_inicio: '', horario_fin: '', requiere_deposito: false, monto_deposito: '', requiere_tarifa: false, tarifa_uso: '', tarifa_uso_finde: '', max_reservas_mes_unidad: '', horas_minimas_antelacion: '', duracion_max_horas: '' })
  const [reservaForm, setReservaForm] = useState({ amenidad_id: '', unidad_id: '', fecha: '', hora_inicio: '', hora_fin: '', num_invitados: '0', notas: '', metodo_pago_tarifa: 'cargar_unidad' as 'cargar_unidad' | 'pagar_momento', tarifa_pagada: false })
  const [bloqueoForm, setBloqueoForm] = useState({ amenidad_id: '', fecha_inicio: '', fecha_fin: '', dia_completo: true, hora_inicio: '', hora_fin: '', motivo: 'mantenimiento' as MotivoBloqueoAmenidad, notas: '' })
  const [semana, setSemana] = useState<Date>(() => lunesDeSemana(new Date()))
  const [selectedReserva, setSelectedReserva] = useState<ReservaAmenidad | null>(null)

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
      foto_url: amenidadFotoUrl,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setAmenidadForm({ nombre: '', descripcion: '', capacidad_max: '', horario_inicio: '', horario_fin: '', requiere_deposito: false, monto_deposito: '', requiere_tarifa: false, tarifa_uso: '', tarifa_uso_finde: '', max_reservas_mes_unidad: '', horas_minimas_antelacion: '', duracion_max_horas: '' })
    setAmenidadFotoUrl(null)
    setShowAmenidadForm(false)
    onRefresh()
  }

  async function toggleAmenidad(a: Amenidad) {
    await supabase.from('amenidades').update({ activo: !a.activo }).eq('id', a.id)
    onRefresh()
  }

  async function actualizarTarifa(a: Amenidad) {
    const result = await Swal.fire({
      title: `Tarifa por uso de ${a.nombre}`,
      html:
        `<p style="font-size:13px;color:#64748b;margin:0 0 12px">Monto en ${moneda}. Deja vacío para desactivar.</p>` +
        `<label style="display:block;text-align:left;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px">Entre semana (L–V)</label>` +
        `<input id="swal-tarifa" type="number" min="0" step="0.01" class="swal2-input" style="margin:0 0 10px" value="${a.tarifa_uso ?? ''}">` +
        `<label style="display:block;text-align:left;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px">Fin de semana (S–D, opcional)</label>` +
        `<input id="swal-tarifa-finde" type="number" min="0" step="0.01" class="swal2-input" style="margin:0" placeholder="Igual que entre semana" value="${a.tarifa_uso_finde ?? ''}">`,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const base = (document.getElementById('swal-tarifa') as HTMLInputElement | null)?.value ?? ''
        const finde = (document.getElementById('swal-tarifa-finde') as HTMLInputElement | null)?.value ?? ''
        return { base, finde }
      },
    })
    if (!result.isConfirmed || !result.value) return
    const baseStr = result.value.base as string
    const findeStr = result.value.finde as string
    const monto = baseStr === '' ? null : Number(baseStr)
    const montoFinde = findeStr === '' ? null : Number(findeStr)
    if (monto !== null && (Number.isNaN(monto) || monto < 0)) { Swal.fire('Error', 'Monto entre semana inválido.', 'error'); return }
    if (montoFinde !== null && (Number.isNaN(montoFinde) || montoFinde < 0)) { Swal.fire('Error', 'Monto fin de semana inválido.', 'error'); return }
    const { error } = await supabase.from('amenidades')
      .update({
        tarifa_uso: monto,
        tarifa_uso_finde: montoFinde,
        requiere_tarifa: monto !== null && monto > 0,
      })
      .eq('id', a.id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    onRefresh()
  }

  async function guardarReserva() {
    if (!reservaForm.amenidad_id || !reservaForm.unidad_id || !reservaForm.fecha || !reservaForm.hora_inicio || !reservaForm.hora_fin) {
      Swal.fire('Error', 'Complete todos los campos requeridos.', 'error'); return
    }
    const conflict = reservas.find(r =>
      r.amenidad_id === reservaForm.amenidad_id &&
      r.fecha === reservaForm.fecha &&
      r.estado !== 'cancelada' &&
      r.hora_inicio < reservaForm.hora_fin &&
      r.hora_fin > reservaForm.hora_inicio
    )
    if (conflict) { Swal.fire('Conflicto', 'Ya existe una reserva en ese horario para esta amenidad.', 'warning'); return }

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

    setSaving(true)
    let cuotaId: string | null = null
    if (aplicaTarifa && metodoPago === 'cargar_unidad') {
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
      created_by: userId,
    })
    setSaving(false)
    if (error) {
      if (cuotaId) await supabase.from('cuotas_condominio').delete().eq('id', cuotaId)
      Swal.fire('Error', error.message, 'error'); return
    }
    setReservaForm({ amenidad_id: '', unidad_id: '', fecha: '', hora_inicio: '', hora_fin: '', num_invitados: '0', notas: '', metodo_pago_tarifa: 'cargar_unidad', tarifa_pagada: false })
    setShowReservaForm(false)
    const msg = aplicaTarifa
      ? metodoPago === 'cargar_unidad'
        ? `Reserva confirmada. Se cargó ${moneda} ${montoTarifa!.toFixed(2)} a la unidad.`
        : tarifaPagada
          ? `Reserva confirmada. Pago en sitio registrado.`
          : `Reserva confirmada. Cobrar ${moneda} ${montoTarifa!.toFixed(2)} en sitio.`
      : 'Reserva confirmada'
    Swal.fire({ icon: 'success', title: msg, timer: 2200, showConfirmButton: false })
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

  async function eliminarBloqueo(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar bloqueo?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, eliminar', cancelButtonText: 'No', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('amenidades_bloqueos').delete().eq('id', id)
    onRefresh()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>Amenidades y Reservas</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13.5px' }}>{amenidadesActivas.length} amenidades activas · {reservas.filter(r => r.estado === 'confirmada').length} reservas activas</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {canCreate && vista === 'amenidades' && <button onClick={() => setShowAmenidadForm(true)} style={{ padding: '10px 16px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>+ Amenidad</button>}
          {(vista === 'reservas' || vista === 'calendario') && canCreate && <button onClick={() => { setVista('reservas'); setShowReservaForm(true) }} style={{ padding: '10px 16px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>+ Reserva</button>}
          {vista === 'bloqueos' && canEdit && <button onClick={() => setShowBloqueoForm(true)} style={{ padding: '10px 16px', background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>+ Bloqueo</button>}
        </div>
      </div>

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
          {amenidades.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>🏊</div>
              <p style={{ fontWeight: 600, color: '#64748b' }}>No hay amenidades registradas</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
              {amenidades.map(a => (
                <div key={a.id} style={{ background: 'white', border: `1.5px solid ${a.activo ? '#e2e8f0' : '#f1f5f9'}`, borderRadius: '14px', overflow: 'hidden', opacity: a.activo ? 1 : 0.6 }}>
                  {a.foto_url && <img src={a.foto_url} alt={a.nombre} style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block' }} />}
                  <div style={{ padding: '18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                      <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>{a.nombre}</h4>
                      {canEdit && (
                        <button onClick={() => toggleAmenidad(a)} style={{ padding: '3px 10px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '11.5px', fontWeight: 700, background: a.activo ? '#f0fdf4' : '#f1f5f9', color: a.activo ? '#16a34a' : '#94a3b8' }}>
                          {a.activo ? 'Activa' : 'Inactiva'}
                        </button>
                      )}
                    </div>
                    {a.descripcion && <p style={{ margin: '0 0 8px', fontSize: '12.5px', color: '#64748b' }}>{a.descripcion}</p>}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '12px', color: '#64748b' }}>
                      {a.capacidad_max && <span>👥 Máx {a.capacidad_max}</span>}
                      {a.horario_inicio && <span>⏰ {a.horario_inicio}–{a.horario_fin}</span>}
                      {a.requiere_deposito && <span>💰 Depósito {moneda} {a.monto_deposito}</span>}
                      {a.requiere_tarifa && a.tarifa_uso != null && (
                        a.tarifa_uso_finde != null
                          ? <span>🎟 Tarifa L–V {moneda} {Number(a.tarifa_uso).toFixed(2)} · S–D {moneda} {Number(a.tarifa_uso_finde).toFixed(2)}</span>
                          : <span>🎟 Tarifa {moneda} {Number(a.tarifa_uso).toFixed(2)}</span>
                      )}
                      {a.max_reservas_mes_unidad != null && <span>📅 Máx {a.max_reservas_mes_unidad}/mes</span>}
                      {a.horas_minimas_antelacion != null && a.horas_minimas_antelacion > 0 && <span>⏱ {a.horas_minimas_antelacion}h antelación</span>}
                      {a.duracion_max_horas != null && <span>⌛ Máx {a.duracion_max_horas}h</span>}
                    </div>
                    <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                        {reservas.filter(r => r.amenidad_id === a.id && r.estado === 'confirmada').length} reservas activas
                      </div>
                      {canEdit && (
                        <button onClick={() => actualizarTarifa(a)} title="Actualizar tarifa por uso"
                          style={{ padding: '4px 10px', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 6, cursor: 'pointer', fontSize: 11.5, fontWeight: 600 }}>
                          {a.requiere_tarifa && a.tarifa_uso != null ? '✎ Tarifa' : '+ Tarifa'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
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
          {reservas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📅</div>
              <p style={{ fontWeight: 600, color: '#64748b' }}>No hay reservas registradas</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {reservas.sort((a, b) => b.fecha.localeCompare(a.fecha)).map(r => {
                const tieneTarifa = r.monto_tarifa != null && r.monto_tarifa > 0
                const pendientePago = tieneTarifa && r.metodo_pago_tarifa === 'pagar_momento' && !r.tarifa_pagada && r.estado !== 'cancelada'
                return (
                <div key={r.id} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{r.amenidad_nombre}</div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                      {r.unidad_nombre} · {r.fecha} · {r.hora_inicio}–{r.hora_fin}
                      {r.num_invitados > 0 && ` · ${r.num_invitados} invitados`}
                    </div>
                    {tieneTarifa && (
                      <div style={{ fontSize: 11.5, marginTop: 4, color: pendientePago ? '#c2410c' : '#16a34a', fontWeight: 600 }}>
                        🎟 {moneda} {Number(r.monto_tarifa).toFixed(2)}
                        {r.metodo_pago_tarifa === 'cargar_unidad' && ' · cargado a unidad'}
                        {r.metodo_pago_tarifa === 'pagar_momento' && (r.tarifa_pagada ? ' · pagado en sitio' : ' · por cobrar en sitio')}
                      </div>
                    )}
                  </div>
                  <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, background: ESTADO_COLORS[r.estado]?.bg || '#f1f5f9', color: ESTADO_COLORS[r.estado]?.color || '#374151' }}>
                    {r.estado}
                  </span>
                  {r.no_show && (
                    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, background: '#fef2f2', color: '#b91c1c' }}>
                      No show
                    </span>
                  )}
                  {pendientePago && canEdit && (
                    <button onClick={() => marcarTarifaPagada(r)} style={{ padding: '5px 12px', background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                      Marcar pagado
                    </button>
                  )}
                  {r.fecha < hoy && r.estado === 'confirmada' && canEdit && (
                    <button onClick={() => marcarNoShow(r)} style={{ padding: '5px 12px', background: r.no_show ? '#f1f5f9' : '#fff7ed', color: r.no_show ? '#64748b' : '#c2410c', border: `1px solid ${r.no_show ? '#cbd5e1' : '#fed7aa'}`, borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                      {r.no_show ? '↶ Quitar no-show' : 'No show'}
                    </button>
                  )}
                  {r.estado !== 'cancelada' && canEdit && (
                    <button onClick={() => cancelarReserva(r.id)} style={{ padding: '5px 12px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                      Cancelar
                    </button>
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
            <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8', fontSize: 13 }}>No hay amenidades activas para mostrar en el calendario.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={{ width: 110, padding: '8px 12px', fontSize: 11, fontWeight: 700, color: '#64748b', textAlign: 'left', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px 0 0 0' }}>Amenidad</th>
                    {dias.map((d, i) => {
                      const fechaStr = d.toISOString().slice(0, 10)
                      const esHoy = fechaStr === hoy
                      return (
                        <th key={i} style={{ padding: '8px 6px', fontSize: 11, fontWeight: 700, textAlign: 'center', border: '1px solid #e2e8f0', background: esHoy ? '#eff6ff' : '#f8fafc', color: esHoy ? '#2563eb' : '#64748b', minWidth: 100 }}>
                          <div style={{ fontWeight: 800 }}>{DIAS_ES[i]}</div>
                          <div style={{ fontSize: 14, color: esHoy ? '#1d4ed8' : '#374151', fontWeight: esHoy ? 800 : 600 }}>{d.getDate()}</div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {amenidadesActivas.map((a, ai) => (
                    <tr key={a.id}>
                      <td style={{ padding: '8px 12px', fontSize: 12, fontWeight: 700, color: '#374151', border: '1px solid #e2e8f0', background: '#fafafa', verticalAlign: 'middle' }}>
                        {a.nombre}
                        {a.horario_inicio && <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>{a.horario_inicio}–{a.horario_fin}</div>}
                      </td>
                      {dias.map((d, di) => {
                        const fechaStr = d.toISOString().slice(0, 10)
                        const esHoy = fechaStr === hoy
                        const resDia = reservas.filter(r => r.amenidad_id === a.id && r.fecha === fechaStr && r.estado !== 'cancelada')
                        const bloqDia = bloqueos.filter(b => b.amenidad_id === a.id && fechaStr >= b.fecha_inicio && fechaStr <= b.fecha_fin)
                        const bloqDiaCompleto = bloqDia.some(b => !b.hora_inicio || !b.hora_fin)
                        const paleta = RESERVA_CAL_COLORS[ai % RESERVA_CAL_COLORS.length]
                        return (
                          <td key={di} style={{ padding: '6px', border: '1px solid #e2e8f0', background: bloqDiaCompleto ? '#fef3c7' : (esHoy ? '#f0f9ff' : 'white'), verticalAlign: 'top', minHeight: 60 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 48 }}>
                              {bloqDia.map(b => (
                                <div key={b.id} title={b.notas || MOTIVO_LABEL[b.motivo]}
                                  style={{ padding: '4px 7px', borderRadius: 6, border: '1px solid #fcd34d', background: 'repeating-linear-gradient(45deg,#fef3c7,#fef3c7 4px,#fde68a 4px,#fde68a 8px)' }}>
                                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#92400e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🚫 {MOTIVO_LABEL[b.motivo]}</div>
                                  <div style={{ fontSize: 9.5, color: '#92400e', opacity: 0.85 }}>{b.hora_inicio && b.hora_fin ? `${b.hora_inicio}–${b.hora_fin}` : 'día completo'}</div>
                                </div>
                              ))}
                              {resDia.map(r => (
                                <div key={r.id}
                                  onClick={() => setSelectedReserva(selectedReserva?.id === r.id ? null : r)}
                                  style={{ padding: '4px 7px', borderRadius: 6, border: `1px solid ${paleta.border}`, background: paleta.bg, cursor: 'pointer' }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: paleta.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.unidad_nombre}</div>
                                  <div style={{ fontSize: 10, color: paleta.color, opacity: 0.8 }}>{r.hora_inicio}–{r.hora_fin}</div>
                                </div>
                              ))}
                              {canCreate && !bloqDiaCompleto && (
                                <button onClick={() => abrirReservaDesdeCalendario(a.id, fechaStr)}
                                  style={{ marginTop: (resDia.length + bloqDia.length) > 0 ? 2 : 'auto', padding: '2px 6px', border: '1px dashed #cbd5e1', borderRadius: 5, background: 'transparent', cursor: 'pointer', fontSize: 14, color: '#94a3b8', lineHeight: 1, display: 'block', width: '100%', textAlign: 'center' }}
                                  title={`Reservar ${a.nombre} el ${fechaStr}`}>+</button>
                              )}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

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
            <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>🚫</div>
              <p style={{ fontWeight: 600, color: '#64748b' }}>No hay bloqueos registrados</p>
              <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Registra un bloqueo cuando una amenidad no esté disponible (mantenimiento, limpieza, etc.).</p>
            </div>
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
              <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
                <div style={{ fontSize: '40px', marginBottom: '12px' }}>📨</div>
                <p style={{ fontWeight: 600, color: '#64748b' }}>No hay reservas próximas para recordar</p>
              </div>
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
