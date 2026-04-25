import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { Amenidad, ReservaAmenidad, BloqueoAmenidad, MetodoPagoTarifa } from '../../../types'
import { bloqueoSolapaReserva } from './AmenidadesTab'

interface Props {
  amenidades: Amenidad[]
  reservas: ReservaAmenidad[]
  bloqueos: BloqueoAmenidad[]
  unidadId: string
  proyectoId: string
  companyId: string
  moneda: string
  onRefresh: () => void
}

const MOTIVO_LABEL: Record<BloqueoAmenidad['motivo'], string> = {
  mantenimiento: 'Mantenimiento',
  limpieza: 'Limpieza profunda',
  evento_privado: 'Evento privado',
  reparacion: 'Reparación',
  otro: 'No disponible',
}

type EstadoReserva = 'confirmada' | 'cancelada' | 'pendiente'

const ESTADO_RES: Record<EstadoReserva, { label: string; bg: string; color: string }> = {
  confirmada: { label: 'Confirmada', bg: '#f0fdf4', color: '#16a34a' },
  pendiente:  { label: 'Pendiente',  bg: '#fff7ed', color: '#c2410c' },
  cancelada:  { label: 'Cancelada',  bg: '#f8fafc', color: '#94a3b8' },
}

function blankForm(): { amenidad_id: string; fecha: string; hora_inicio: string; hora_fin: string; num_invitados: number; notas: string; metodo_pago_tarifa: MetodoPagoTarifa } {
  return { amenidad_id: '', fecha: '', hora_inicio: '', hora_fin: '', num_invitados: 0, notas: '', metodo_pago_tarifa: 'cargar_unidad' }
}

export function PortalReservasTab({ amenidades, reservas, bloqueos, unidadId, proyectoId, companyId, moneda, onRefresh }: Props) {
  const [showForm, setShowForm]   = useState(false)
  const [saving, setSaving]       = useState(false)
  const [form, setForm]           = useState(blankForm())
  const [vistaFutura, setVistaFutura] = useState(true)

  const hoy = new Date().toISOString().slice(0, 10)
  const misReservas = reservas.filter(r => r.unidad_id === unidadId)
  const futuras = misReservas.filter(r => r.fecha >= hoy && r.estado !== 'cancelada')
  const pasadas = misReservas.filter(r => r.fecha < hoy || r.estado === 'cancelada')
  const amenidadesActivas = amenidades.filter(a => a.activo)
  const amenidadSel = amenidades.find(a => a.id === form.amenidad_id)

  async function hacerReserva() {
    if (!form.amenidad_id) { Swal.fire('Error', 'Seleccione una amenidad.', 'error'); return }
    if (!form.fecha || !form.hora_inicio || !form.hora_fin) { Swal.fire('Error', 'Complete fecha y horario.', 'error'); return }
    if (form.hora_fin <= form.hora_inicio) { Swal.fire('Error', 'La hora de fin debe ser posterior al inicio.', 'error'); return }
    // Conflict check
    const conflicto = reservas.find(r =>
      r.amenidad_id === form.amenidad_id && r.fecha === form.fecha &&
      r.estado !== 'cancelada' &&
      form.hora_inicio < r.hora_fin && form.hora_fin > r.hora_inicio
    )
    if (conflicto) { Swal.fire('Horario ocupado', 'Esa amenidad ya está reservada en ese horario. Elija otro.', 'warning'); return }

    const bloqueo = bloqueos.find(b =>
      b.amenidad_id === form.amenidad_id &&
      bloqueoSolapaReserva(b, form.fecha, form.hora_inicio, form.hora_fin)
    )
    if (bloqueo) {
      const detalle = bloqueo.hora_inicio
        ? `${bloqueo.fecha_inicio === bloqueo.fecha_fin ? bloqueo.fecha_inicio : `${bloqueo.fecha_inicio} → ${bloqueo.fecha_fin}`} ${bloqueo.hora_inicio}–${bloqueo.hora_fin}`
        : `${bloqueo.fecha_inicio === bloqueo.fecha_fin ? bloqueo.fecha_inicio : `${bloqueo.fecha_inicio} → ${bloqueo.fecha_fin}`} (día completo)`
      Swal.fire('Amenidad no disponible', `${MOTIVO_LABEL[bloqueo.motivo]} · ${detalle}. Por favor elige otra fecha u horario.`, 'warning')
      return
    }

    const aplicaTarifa = !!(amenidadSel?.requiere_tarifa && amenidadSel.tarifa_uso && amenidadSel.tarifa_uso > 0)
    const montoTarifa = aplicaTarifa ? Number(amenidadSel!.tarifa_uso) : null
    const metodoPago = aplicaTarifa ? form.metodo_pago_tarifa : null

    setSaving(true)
    let cuotaId: string | null = null
    if (aplicaTarifa && metodoPago === 'cargar_unidad') {
      const periodo = form.fecha.slice(0, 7)
      const { data: cuotaData, error: cuotaErr } = await supabase
        .from('cuotas_condominio')
        .insert({
          company_id: companyId,
          project_id: proyectoId,
          unidad_id: unidadId,
          concepto: 'amenidad',
          monto: montoTarifa,
          periodo,
          fecha_vencimiento: form.fecha,
          estado: 'pendiente',
          notas: `Reserva ${amenidadSel!.nombre} ${form.fecha} ${form.hora_inicio}-${form.hora_fin}`,
        })
        .select('id')
        .single()
      if (cuotaErr) { setSaving(false); Swal.fire('Error', `No se pudo generar el cargo: ${cuotaErr.message}`, 'error'); return }
      cuotaId = cuotaData?.id ?? null
    }

    const { error } = await supabase.from('reservas_amenidades').insert({
      company_id: companyId, amenidad_id: form.amenidad_id,
      unidad_id: unidadId, fecha: form.fecha,
      hora_inicio: form.hora_inicio, hora_fin: form.hora_fin,
      num_invitados: form.num_invitados, notas: form.notas.trim() || null,
      estado: 'confirmada',
      monto_tarifa: montoTarifa,
      metodo_pago_tarifa: metodoPago,
      tarifa_pagada: false,
      cuota_id: cuotaId,
    })
    setSaving(false)
    if (error) {
      if (cuotaId) await supabase.from('cuotas_condominio').delete().eq('id', cuotaId)
      Swal.fire('Error', error.message, 'error'); return
    }
    const titulo = aplicaTarifa
      ? metodoPago === 'cargar_unidad'
        ? `Reserva confirmada. Se cargó ${moneda} ${montoTarifa!.toFixed(2)} a tu cuenta.`
        : `Reserva confirmada. Pagar ${moneda} ${montoTarifa!.toFixed(2)} en sitio.`
      : '¡Reserva confirmada!'
    Swal.fire({ icon: 'success', title: titulo, timer: 2400, showConfirmButton: false })
    setForm(blankForm()); setShowForm(false); onRefresh()
  }

  async function cancelarReserva(id: string) {
    const r = await Swal.fire({ title: '¿Cancelar reserva?', icon: 'question', showCancelButton: true, confirmButtonText: 'Sí, cancelar', cancelButtonText: 'No' })
    if (!r.isConfirmed) return
    const reserva = reservas.find(x => x.id === id)
    await supabase.from('reservas_amenidades').update({ estado: 'cancelada' }).eq('id', id)
    if (reserva?.cuota_id) {
      await supabase.from('cuotas_condominio').delete().eq('id', reserva.cuota_id).eq('estado', 'pendiente')
    }
    onRefresh()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '10px' }}>
        <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>Amenidades y reservas</h3>
        {amenidadesActivas.length > 0 && (
          <button onClick={() => setShowForm(true)}
            style={{ padding: '9px 16px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
            + Nueva reserva
          </button>
        )}
      </div>

      {/* Amenidades disponibles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginBottom: '22px' }}>
        {amenidadesActivas.map(a => (
          <div key={a.id} style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '28px', marginBottom: '6px' }}>🏖</div>
            <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{a.nombre}</div>
            {a.capacidad_max && <div style={{ fontSize: '12px', color: '#64748b' }}>Hasta {a.capacidad_max} personas</div>}
            {a.horario_inicio && a.horario_fin && <div style={{ fontSize: '12px', color: '#64748b' }}>{a.horario_inicio} – {a.horario_fin}</div>}
            {a.requiere_deposito && a.monto_deposito && <div style={{ fontSize: '12px', color: '#c2410c', marginTop: '3px' }}>Depósito: {moneda} {a.monto_deposito.toFixed(2)}</div>}
            {a.requiere_tarifa && a.tarifa_uso != null && <div style={{ fontSize: '12px', color: '#1d4ed8', marginTop: '3px', fontWeight: 600 }}>Tarifa: {moneda} {Number(a.tarifa_uso).toFixed(2)}</div>}
          </div>
        ))}
        {amenidadesActivas.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: '13px' }}>No hay amenidades disponibles actualmente.</div>
        )}
      </div>

      {/* Formulario */}
      {showForm && (
        <div style={{ background: 'white', border: '1.5px solid #bfdbfe', borderRadius: '14px', padding: '18px', marginBottom: '18px' }}>
          <h4 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 700 }}>Solicitar reserva</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Amenidad *</label>
              <select value={form.amenidad_id} onChange={e => setForm(f => ({ ...f, amenidad_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                <option value="">Seleccionar...</option>
                {amenidadesActivas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
              {amenidadSel?.requiere_deposito && amenidadSel.monto_deposito && (
                <p style={{ margin: '5px 0 0', fontSize: '12px', color: '#c2410c' }}>⚠ Esta amenidad requiere depósito de {moneda} {amenidadSel.monto_deposito.toFixed(2)}</p>
              )}
              {(() => {
                if (!amenidadSel) return null
                const proximos = bloqueos
                  .filter(b => b.amenidad_id === amenidadSel.id && b.fecha_fin >= hoy)
                  .slice()
                  .sort((a, b) => a.fecha_inicio < b.fecha_inicio ? -1 : 1)
                  .slice(0, 3)
                if (proximos.length === 0) return null
                return (
                  <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', fontSize: 11.5, color: '#92400e' }}>
                    🚫 Fechas no disponibles: {proximos.map(b => `${b.fecha_inicio === b.fecha_fin ? b.fecha_inicio : `${b.fecha_inicio}→${b.fecha_fin}`}${b.hora_inicio ? ` ${b.hora_inicio}-${b.hora_fin}` : ''}`).join(' · ')}
                  </div>
                )
              })()}
            </div>
            {amenidadSel?.requiere_tarifa && amenidadSel.tarifa_uso != null && amenidadSel.tarifa_uso > 0 && (
              <div style={{ gridColumn: '1 / -1', background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1d4ed8', marginBottom: 8 }}>
                  🎟 Tarifa por uso: {moneda} {Number(amenidadSel.tarifa_uso).toFixed(2)}
                </div>
                <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>¿Cómo deseas pagar la tarifa?</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                    <input type="radio" name="metodo_pago" checked={form.metodo_pago_tarifa === 'cargar_unidad'}
                      onChange={() => setForm(f => ({ ...f, metodo_pago_tarifa: 'cargar_unidad' }))} />
                    <span><strong>Cargar a mi unidad</strong> — el monto aparecerá como cargo pendiente en mi cuenta.</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                    <input type="radio" name="metodo_pago" checked={form.metodo_pago_tarifa === 'pagar_momento'}
                      onChange={() => setForm(f => ({ ...f, metodo_pago_tarifa: 'pagar_momento' }))} />
                    <span><strong>Pagar al momento</strong> — pagaré directamente a la administración antes de usar la amenidad.</span>
                  </label>
                </div>
              </div>
            )}
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Fecha *</label>
              <input type="date" value={form.fecha} min={hoy} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>No. invitados</label>
              <input type="number" min={0} value={form.num_invitados} onChange={e => setForm(f => ({ ...f, num_invitados: parseInt(e.target.value) || 0 }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Hora inicio *</label>
              <input type="time" value={form.hora_inicio} onChange={e => setForm(f => ({ ...f, hora_inicio: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Hora fin *</label>
              <input type="time" value={form.hora_fin} onChange={e => setForm(f => ({ ...f, hora_fin: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Notas</label>
              <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Observaciones adicionales..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
            <button onClick={hacerReserva} disabled={saving} style={{ padding: '10px 22px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Reservando...' : '📅 Confirmar reserva'}
            </button>
            <button onClick={() => { setShowForm(false); setForm(blankForm()) }} style={{ padding: '10px 16px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Mis reservas */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        {([true, false] as const).map(v => (
          <button key={String(v)} onClick={() => setVistaFutura(v)}
            style={{ padding: '7px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', border: '1.5px solid', borderColor: vistaFutura === v ? '#2563eb' : '#e2e8f0', background: vistaFutura === v ? '#eff6ff' : 'white', color: vistaFutura === v ? '#2563eb' : '#64748b' }}>
            {v ? `📅 Próximas (${futuras.length})` : `📋 Historial (${pasadas.length})`}
          </button>
        ))}
      </div>

      {(vistaFutura ? futuras : pasadas).length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>
          <p style={{ fontWeight: 600, color: '#64748b' }}>Sin reservas {vistaFutura ? 'próximas' : 'anteriores'}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {(vistaFutura ? futuras : pasadas).sort((a, b) => a.fecha < b.fecha ? -1 : 1).map(r => {
            const ec = ESTADO_RES[(r.estado as EstadoReserva) ?? 'confirmada']
            const amenidad = amenidades.find(a => a.id === r.amenidad_id)
            return (
              <div key={r.id} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '22px', flexShrink: 0 }}>📅</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{amenidad?.nombre ?? 'Amenidad'}</div>
                  <div style={{ fontSize: '12.5px', color: '#64748b', marginTop: '2px' }}>
                    {new Date(r.fecha + 'T12:00:00').toLocaleDateString('es', { weekday: 'long', day: '2-digit', month: 'long' })} · {r.hora_inicio} – {r.hora_fin}
                    {r.num_invitados > 0 && ` · ${r.num_invitados} invitado${r.num_invitados > 1 ? 's' : ''}`}
                  </div>
                  {r.monto_tarifa != null && r.monto_tarifa > 0 && (
                    <div style={{ fontSize: 11.5, marginTop: 3, fontWeight: 600, color: r.metodo_pago_tarifa === 'cargar_unidad' ? '#1d4ed8' : (r.tarifa_pagada ? '#16a34a' : '#c2410c') }}>
                      🎟 {moneda} {Number(r.monto_tarifa).toFixed(2)}
                      {r.metodo_pago_tarifa === 'cargar_unidad' && ' · cargado a tu unidad'}
                      {r.metodo_pago_tarifa === 'pagar_momento' && (r.tarifa_pagada ? ' · pagado' : ' · pagar en sitio')}
                    </div>
                  )}
                </div>
                <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, background: ec.bg, color: ec.color, flexShrink: 0 }}>{ec.label}</span>
                {vistaFutura && r.estado !== 'cancelada' && (
                  <button onClick={() => cancelarReserva(r.id)} style={{ padding: '5px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', color: '#dc2626', fontWeight: 600, flexShrink: 0 }}>
                    Cancelar
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
