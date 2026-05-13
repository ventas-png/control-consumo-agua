import { useState, useEffect, useCallback } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type {
  ContratoArrendamiento, ReservaSTR,
  EstadoContrato, EstadoSTR, PlataformaSTR,
  SolicitudRentaUnidad, TipoRenta,
} from '../../../types'

interface Props {
  unidadId: string
  unidadNombre: string
  proyectoId: string
  companyId: string
  clienteId: string
  solicitudRenta: SolicitudRentaUnidad | null
  onSolicitudChange: () => void
}

type SubTab = 'arrendamiento' | 'str'

// ── Configs ───────────────────────────────────────────────────────────────────

const ESTADO_CONTRATO: Record<EstadoContrato, { label: string; bg: string; color: string }> = {
  activo:    { label: 'Activo',    bg: '#f0fdf4', color: '#16a34a' },
  vencido:   { label: 'Vencido',  bg: '#fff7ed', color: '#c2410c' },
  terminado: { label: 'Terminado',bg: '#f8fafc', color: '#64748b' },
}

const ESTADO_STR: Record<EstadoSTR, { label: string; bg: string; color: string }> = {
  confirmada: { label: 'Confirmada',  bg: '#eff6ff', color: '#2563eb' },
  en_curso:   { label: 'En curso',    bg: '#f0fdf4', color: '#16a34a' },
  completada: { label: 'Completada',  bg: '#f8fafc', color: '#64748b' },
  cancelada:  { label: 'Cancelada',   bg: '#fef2f2', color: '#dc2626' },
}

const PLATAFORMAS: Record<PlataformaSTR, string> = {
  airbnb:  'Airbnb',
  booking: 'Booking.com',
  vrbo:    'VRBO',
  directo: 'Directo',
  otro:    'Otro',
}

const TIPO_RENTA_LABEL: Record<TipoRenta, string> = {
  arrendamiento: 'Arrendamiento (largo plazo)',
  str:           'STR / Corto Plazo',
  ambas:         'Arrendamiento + STR',
}

function blankContrato(): Partial<ContratoArrendamiento> {
  return {
    arrendatario_nombre: '', arrendatario_identificacion: '',
    arrendatario_telefono: '', arrendatario_email: '',
    monto_renta: 0, dia_pago: 1,
    fecha_inicio: '', fecha_fin: '',
    deposito: 0, estado: 'activo', notas: '',
  }
}

function blankReserva(): Partial<ReservaSTR> {
  return {
    huesped_nombre: '', huesped_email: '', huesped_telefono: '',
    fecha_entrada: '', fecha_salida: '',
    num_adultos: 1, num_ninos: 0,
    plataforma: 'directo', monto_noche: 0, monto_total: 0,
    estado: 'confirmada', notas: '',
  }
}

// ── Authorization request form ────────────────────────────────────────────────

function SolicitudForm({ unidadId, proyectoId, companyId, clienteId, onSolicitudChange, prevRechazada }: {
  unidadId: string; proyectoId: string; companyId: string; clienteId: string
  onSolicitudChange: () => void; prevRechazada: SolicitudRentaUnidad | null
}) {
  const [tipo, setTipo]       = useState<TipoRenta>('arrendamiento')
  const [motivo, setMotivo]   = useState('')
  const [saving, setSaving]   = useState(false)

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', fontSize: '13.5px',
    border: '1.5px solid #e2e8f0', borderRadius: '8px', outline: 'none',
    boxSizing: 'border-box',
  }

  async function submit() {
    setSaving(true)
    const { error } = await supabase.from('solicitud_renta_unidad').insert({
      company_id: companyId,
      project_id: proyectoId,
      unidad_id: unidadId,
      cliente_id: clienteId || null,
      tipo_renta: tipo,
      motivo: motivo.trim() || null,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: '¡Solicitud enviada!', text: 'La administración revisará tu solicitud pronto.', timer: 2000, showConfirmButton: false })
    onSolicitudChange()
  }

  return (
    <div style={{ maxWidth: '520px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
          🔑 Solicitar autorización de renta
        </h3>
        <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
          Para gestionar contratos o reservas en tu unidad, primero debes solicitar autorización a la administración.
        </p>
      </div>

      {prevRechazada && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fecaca',
          borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px',
        }}>
          <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: '4px' }}>❌ Solicitud anterior rechazada</div>
          {prevRechazada.comentario_admin && (
            <div style={{ color: '#7f1d1d' }}>Motivo: {prevRechazada.comentario_admin}</div>
          )}
          <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '4px' }}>Puedes enviar una nueva solicitud.</div>
        </div>
      )}

      <div style={{ marginBottom: '14px' }}>
        <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '6px' }}>
          Tipo de renta que deseas operar *
        </label>
        {(['arrendamiento', 'str', 'ambas'] as TipoRenta[]).map(t => (
          <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', cursor: 'pointer' }}>
            <input
              type="radio" name="tipo_renta" value={t} checked={tipo === t}
              onChange={() => setTipo(t)}
              style={{ accentColor: '#4f46e5', width: '16px', height: '16px' }}
            />
            <span style={{ fontSize: '13.5px', color: '#334155' }}>{TIPO_RENTA_LABEL[t]}</span>
          </label>
        ))}
      </div>

      <div style={{ marginBottom: '18px' }}>
        <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
          Motivo / descripción (opcional)
        </label>
        <textarea
          style={{ ...fieldStyle, minHeight: '80px', resize: 'vertical' }}
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
          placeholder="Describe brevemente cómo planeas operar la renta…"
        />
      </div>

      <button
        onClick={submit}
        disabled={saving}
        style={{
          padding: '10px 24px', background: '#4f46e5', color: 'white',
          border: 'none', borderRadius: '9px', fontWeight: 600, fontSize: '14px',
          cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
        }}
      >{saving ? 'Enviando…' : 'Enviar solicitud'}</button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function PortalRentasTab({ unidadId, unidadNombre, proyectoId, companyId, clienteId, solicitudRenta, onSolicitudChange }: Props) {

  // Determine allowed sub-tabs based on authorization
  const tipoAprobado = solicitudRenta?.estado === 'aprobada'
    ? (solicitudRenta.tipo_aprobado ?? solicitudRenta.tipo_renta)
    : null

  const allowedSubTabs: SubTab[] = tipoAprobado === 'ambas'
    ? ['arrendamiento', 'str']
    : tipoAprobado === 'arrendamiento' ? ['arrendamiento']
    : tipoAprobado === 'str'           ? ['str']
    : []

  const [subTab, setSubTab]       = useState<SubTab>('arrendamiento')
  const [loading, setLoading]     = useState(false)
  const [contratos, setContratos] = useState<ContratoArrendamiento[]>([])
  const [reservas, setReservas]   = useState<ReservaSTR[]>([])

  // Arrendamiento form
  const [showCA, setShowCA]       = useState(false)
  const [editCA, setEditCA]       = useState<ContratoArrendamiento | null>(null)
  const [formCA, setFormCA]       = useState<Partial<ContratoArrendamiento>>(blankContrato())
  const [savingCA, setSavingCA]   = useState(false)

  // STR form
  const [showSTR, setShowSTR]     = useState(false)
  const [editSTR, setEditSTR]     = useState<ReservaSTR | null>(null)
  const [formSTR, setFormSTR]     = useState<Partial<ReservaSTR>>(blankReserva())
  const [savingSTR, setSavingSTR] = useState(false)

  const cargar = useCallback(async () => {
    if (!unidadId || solicitudRenta?.estado !== 'aprobada') return
    setLoading(true)
    const [{ data: cd }, { data: rd }] = await Promise.all([
      supabase.from('contratos_arrendamiento').select('*').eq('unidad_id', unidadId).order('created_at', { ascending: false }),
      supabase.from('reservas_str').select('*').eq('unidad_id', unidadId).order('fecha_entrada', { ascending: false }),
    ])
    setContratos((cd as ContratoArrendamiento[]) ?? [])
    setReservas((rd as ReservaSTR[]) ?? [])
    setLoading(false)
  }, [unidadId, solicitudRenta?.estado])

  useEffect(() => {
    if (solicitudRenta?.estado === 'aprobada') cargar()
    else setLoading(false)
  }, [cargar, solicitudRenta?.estado])

  // Ensure subTab is one of the allowed ones
  useEffect(() => {
    if (allowedSubTabs.length > 0 && !allowedSubTabs.includes(subTab)) {
      setSubTab(allowedSubTabs[0])
    }
  }, [allowedSubTabs, subTab])

  // ── Contrato helpers ────────────────────────────────────────────────────────

  function openNewCA() { setEditCA(null); setFormCA(blankContrato()); setShowCA(true) }
  function openEditCA(c: ContratoArrendamiento) { setEditCA(c); setFormCA({ ...c }); setShowCA(true) }

  async function saveCA() {
    if (!formCA.arrendatario_nombre?.trim()) { Swal.fire('Error', 'El nombre del arrendatario es requerido.', 'error'); return }
    if (!formCA.fecha_inicio) { Swal.fire('Error', 'La fecha de inicio es requerida.', 'error'); return }
    setSavingCA(true)
    const payload = {
      company_id: companyId, project_id: proyectoId, unidad_id: unidadId,
      arrendatario_nombre: formCA.arrendatario_nombre!.trim(),
      arrendatario_identificacion: formCA.arrendatario_identificacion || null,
      arrendatario_telefono: formCA.arrendatario_telefono || null,
      arrendatario_email: formCA.arrendatario_email || null,
      monto_renta: Number(formCA.monto_renta) || 0,
      dia_pago: Number(formCA.dia_pago) || 1,
      fecha_inicio: formCA.fecha_inicio,
      fecha_fin: formCA.fecha_fin || null,
      deposito: formCA.deposito ? Number(formCA.deposito) : null,
      estado: formCA.estado ?? 'activo',
      notas: formCA.notas || null,
    }
    if (editCA) {
      const { error } = await supabase.from('contratos_arrendamiento').update(payload).eq('id', editCA.id)
      if (error) { Swal.fire('Error', error.message, 'error'); setSavingCA(false); return }
    } else {
      const { error } = await supabase.from('contratos_arrendamiento').insert(payload)
      if (error) { Swal.fire('Error', error.message, 'error'); setSavingCA(false); return }
    }
    setSavingCA(false); setShowCA(false); cargar()
    Swal.fire({ icon: 'success', title: editCA ? 'Contrato actualizado' : 'Contrato creado', timer: 1400, showConfirmButton: false })
  }

  async function deleteCA(c: ContratoArrendamiento) {
    const r = await Swal.fire({ title: '¿Eliminar contrato?', text: `Arrendatario: ${c.arrendatario_nombre}`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc2626', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!r.isConfirmed) return
    await supabase.from('contratos_arrendamiento').delete().eq('id', c.id)
    setContratos((prev: ContratoArrendamiento[]) => prev.filter((x: ContratoArrendamiento) => x.id !== c.id))
    Swal.fire({ icon: 'success', title: 'Eliminado', timer: 1200, showConfirmButton: false })
  }

  // ── STR helpers ─────────────────────────────────────────────────────────────

  function openNewSTR() { setEditSTR(null); setFormSTR(blankReserva()); setShowSTR(true) }
  function openEditSTR(r: ReservaSTR) { setEditSTR(r); setFormSTR({ ...r }); setShowSTR(true) }

  function calcNights(entrada: string, salida: string) {
    if (!entrada || !salida) return 0
    const d = (new Date(salida).getTime() - new Date(entrada).getTime()) / 86400000
    return d > 0 ? d : 0
  }

  async function saveSTR() {
    if (!formSTR.huesped_nombre?.trim()) { Swal.fire('Error', 'El nombre del huésped es requerido.', 'error'); return }
    if (!formSTR.fecha_entrada || !formSTR.fecha_salida) { Swal.fire('Error', 'Las fechas de entrada y salida son requeridas.', 'error'); return }
    setSavingSTR(true)
    const nights = calcNights(formSTR.fecha_entrada!, formSTR.fecha_salida!)
    const total  = nights * (Number(formSTR.monto_noche) || 0)
    const payload = {
      company_id: companyId, project_id: proyectoId, unidad_id: unidadId,
      huesped_nombre: formSTR.huesped_nombre!.trim(),
      huesped_email: formSTR.huesped_email || null,
      huesped_telefono: formSTR.huesped_telefono || null,
      fecha_entrada: formSTR.fecha_entrada,
      fecha_salida: formSTR.fecha_salida,
      num_adultos: Number(formSTR.num_adultos) || 1,
      num_ninos: Number(formSTR.num_ninos) || 0,
      plataforma: formSTR.plataforma ?? 'directo',
      monto_noche: Number(formSTR.monto_noche) || null,
      monto_total: total || null,
      estado: formSTR.estado ?? 'confirmada',
      notas: formSTR.notas || null,
    }
    if (editSTR) {
      const { error } = await supabase.from('reservas_str').update(payload).eq('id', editSTR.id)
      if (error) { Swal.fire('Error', error.message, 'error'); setSavingSTR(false); return }
    } else {
      const { error } = await supabase.from('reservas_str').insert(payload)
      if (error) { Swal.fire('Error', error.message, 'error'); setSavingSTR(false); return }
    }
    setSavingSTR(false); setShowSTR(false); cargar()
    Swal.fire({ icon: 'success', title: editSTR ? 'Reserva actualizada' : 'Reserva creada', timer: 1400, showConfirmButton: false })
  }

  async function deleteSTR(r: ReservaSTR) {
    const res = await Swal.fire({ title: '¿Eliminar reserva?', text: `Huésped: ${r.huesped_nombre}`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#dc2626', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!res.isConfirmed) return
    await supabase.from('reservas_str').delete().eq('id', r.id)
    setReservas((prev: ReservaSTR[]) => prev.filter((x: ReservaSTR) => x.id !== r.id))
    Swal.fire({ icon: 'success', title: 'Eliminada', timer: 1200, showConfirmButton: false })
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', fontSize: '13.5px',
    border: '1.5px solid #e2e8f0', borderRadius: '8px', outline: 'none',
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px', display: 'block' }
  const rowStyle: React.CSSProperties   = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }

  // ── Header (always shown) ────────────────────────────────────────────────────

  const header = (
    <div style={{ marginBottom: '20px' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
        🏠 Rentas — {unidadNombre}
      </h3>
      <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
        Administra los contratos de arrendamiento y reservas de corto plazo de tu unidad.
      </p>
    </div>
  )

  // ── State: no authorization or rejected ─────────────────────────────────────

  if (!solicitudRenta || solicitudRenta.estado === 'rechazada') {
    return (
      <div>
        {header}
        <SolicitudForm
          unidadId={unidadId}
          proyectoId={proyectoId}
          companyId={companyId}
          clienteId={clienteId}
          onSolicitudChange={onSolicitudChange}
          prevRechazada={solicitudRenta?.estado === 'rechazada' ? solicitudRenta : null}
        />
      </div>
    )
  }

  // ── State: pending ───────────────────────────────────────────────────────────

  if (solicitudRenta.estado === 'pendiente') {
    const fechaSol = new Date(solicitudRenta.created_at).toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })
    return (
      <div>
        {header}
        <div style={{
          background: '#fef3c7', border: '1.5px solid #fde68a',
          borderRadius: '14px', padding: '24px 28px', maxWidth: '520px',
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
          <div style={{ fontWeight: 700, fontSize: '16px', color: '#92400e', marginBottom: '6px' }}>
            Solicitud en revisión
          </div>
          <div style={{ fontSize: '13px', color: '#78350f', lineHeight: 1.6 }}>
            Tu solicitud para operar <strong>{TIPO_RENTA_LABEL[solicitudRenta.tipo_renta]}</strong> fue enviada el {fechaSol} y está siendo revisada por la administración.
          </div>
          <div style={{ marginTop: '12px', fontSize: '12.5px', color: '#a16207' }}>
            Te notificaremos cuando haya una respuesta.
          </div>
        </div>
      </div>
    )
  }

  // ── State: approved — show authorized sub-tabs ───────────────────────────────

  return (
    <div>
      {header}

      {/* Authorization badge */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        background: '#f0fdf4', border: '1px solid #bbf7d0',
        borderRadius: '20px', padding: '4px 14px', marginBottom: '16px',
        fontSize: '12px', fontWeight: 600, color: '#16a34a',
      }}>
        ✅ Autorizado: {TIPO_RENTA_LABEL[tipoAprobado!]}
        {solicitudRenta.aprobado_por && <span style={{ fontWeight: 400, opacity: 0.8 }}>— {solicitudRenta.aprobado_por}</span>}
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '2px solid #f1f5f9' }}>
        {allowedSubTabs.map(id => (
          <button
            key={id}
            onClick={() => setSubTab(id)}
            style={{
              padding: '9px 18px', border: 'none', cursor: 'pointer', fontWeight: 600,
              fontSize: '13px', borderRadius: '8px 8px 0 0',
              background: subTab === id ? '#4f46e5' : 'transparent',
              color: subTab === id ? 'white' : '#64748b',
              borderBottom: subTab === id ? '2px solid #4f46e5' : '2px solid transparent',
              marginBottom: '-2px',
            }}
          >{id === 'arrendamiento' ? '📄 Arrendamiento' : '🏨 STR / Corto Plazo'}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '14px' }}>Cargando…</div>
      ) : subTab === 'arrendamiento' ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px' }}>
            <button onClick={openNewCA} style={{ padding: '8px 18px', background: '#4f46e5', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Nuevo contrato</button>
          </div>

          {contratos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
              <div style={{ fontSize: '36px', marginBottom: '10px' }}>📄</div>
              <div style={{ fontSize: '14px' }}>Sin contratos de arrendamiento registrados</div>
            </div>
          ) : contratos.map(c => {
            const cfg = ESTADO_CONTRATO[c.estado]
            return (
              <div key={c.id} style={{ border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginBottom: '10px', background: 'white' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a', marginBottom: '4px' }}>👤 {c.arrendatario_nombre}</div>
                    {c.arrendatario_telefono && <div style={{ fontSize: '12.5px', color: '#475569' }}>📞 {c.arrendatario_telefono}</div>}
                    {c.arrendatario_email && <div style={{ fontSize: '12.5px', color: '#475569' }}>✉️ {c.arrendatario_email}</div>}
                    <div style={{ fontSize: '12.5px', color: '#475569', marginTop: '4px' }}>
                      📅 {c.fecha_inicio}{c.fecha_fin ? ` → ${c.fecha_fin}` : ' (indefinido)'}{'  '}|{'  '}💰 Renta: {c.monto_renta.toLocaleString()} · Día {c.dia_pago}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 600, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                    <button onClick={() => openEditCA(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '4px' }} title="Editar">✏️</button>
                    <button onClick={() => deleteCA(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '4px' }} title="Eliminar">🗑️</button>
                  </div>
                </div>
                {c.notas && <div style={{ marginTop: '8px', fontSize: '12px', color: '#64748b', background: '#f8fafc', borderRadius: '6px', padding: '8px' }}>{c.notas}</div>}
              </div>
            )
          })}

          {showCA && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }}>
              <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>{editCA ? 'Editar contrato' : 'Nuevo contrato de arrendamiento'}</h3>
                  <button onClick={() => setShowCA(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: '#94a3b8' }}>✕</button>
                </div>
                <div style={rowStyle}>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={labelStyle}>Nombre del arrendatario *</label>
                    <input style={fieldStyle} value={formCA.arrendatario_nombre ?? ''} onChange={e => setFormCA(p => ({ ...p, arrendatario_nombre: e.target.value }))} placeholder="Nombre completo" />
                  </div>
                  <div>
                    <label style={labelStyle}>Identificación</label>
                    <input style={fieldStyle} value={formCA.arrendatario_identificacion ?? ''} onChange={e => setFormCA(p => ({ ...p, arrendatario_identificacion: e.target.value }))} placeholder="DPI / Pasaporte" />
                  </div>
                  <div>
                    <label style={labelStyle}>Teléfono</label>
                    <input style={fieldStyle} value={formCA.arrendatario_telefono ?? ''} onChange={e => setFormCA(p => ({ ...p, arrendatario_telefono: e.target.value }))} placeholder="+502 0000-0000" />
                  </div>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={labelStyle}>Email</label>
                    <input style={fieldStyle} type="email" value={formCA.arrendatario_email ?? ''} onChange={e => setFormCA(p => ({ ...p, arrendatario_email: e.target.value }))} placeholder="correo@ejemplo.com" />
                  </div>
                  <div>
                    <label style={labelStyle}>Monto de renta *</label>
                    <input style={fieldStyle} type="number" min={0} value={formCA.monto_renta ?? 0} onChange={e => setFormCA(p => ({ ...p, monto_renta: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>Día de pago (1-28)</label>
                    <input style={fieldStyle} type="number" min={1} max={28} value={formCA.dia_pago ?? 1} onChange={e => setFormCA(p => ({ ...p, dia_pago: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>Fecha inicio *</label>
                    <input style={fieldStyle} type="date" value={formCA.fecha_inicio ?? ''} onChange={e => setFormCA(p => ({ ...p, fecha_inicio: e.target.value }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>Fecha fin</label>
                    <input style={fieldStyle} type="date" value={formCA.fecha_fin ?? ''} onChange={e => setFormCA(p => ({ ...p, fecha_fin: e.target.value }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>Depósito</label>
                    <input style={fieldStyle} type="number" min={0} value={formCA.deposito ?? 0} onChange={e => setFormCA(p => ({ ...p, deposito: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>Estado</label>
                    <select style={fieldStyle} value={formCA.estado ?? 'activo'} onChange={e => setFormCA(p => ({ ...p, estado: e.target.value as EstadoContrato }))}>
                      <option value="activo">Activo</option>
                      <option value="vencido">Vencido</option>
                      <option value="terminado">Terminado</option>
                    </select>
                  </div>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={labelStyle}>Notas</label>
                    <textarea style={{ ...fieldStyle, minHeight: '72px', resize: 'vertical' }} value={formCA.notas ?? ''} onChange={e => setFormCA(p => ({ ...p, notas: e.target.value }))} placeholder="Observaciones opcionales…" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <button onClick={() => setShowCA(false)} style={{ padding: '9px 20px', background: '#f1f5f9', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', color: '#475569' }}>Cancelar</button>
                  <button onClick={saveCA} disabled={savingCA} style={{ padding: '9px 22px', background: '#4f46e5', color: 'white', border: 'none', borderRadius: '8px', cursor: savingCA ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '13px', opacity: savingCA ? 0.7 : 1 }}>
                    {savingCA ? 'Guardando…' : editCA ? 'Actualizar' : 'Crear contrato'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px' }}>
            <button onClick={openNewSTR} style={{ padding: '8px 18px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Nueva reserva</button>
          </div>

          {reservas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
              <div style={{ fontSize: '36px', marginBottom: '10px' }}>🏨</div>
              <div style={{ fontSize: '14px' }}>Sin reservas STR registradas</div>
            </div>
          ) : reservas.map(r => {
            const cfg    = ESTADO_STR[r.estado]
            const nights = calcNights(r.fecha_entrada, r.fecha_salida)
            return (
              <div key={r.id} style={{ border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginBottom: '10px', background: 'white' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a', marginBottom: '4px' }}>👤 {r.huesped_nombre}</div>
                    <div style={{ fontSize: '12.5px', color: '#475569' }}>
                      📅 {r.fecha_entrada} → {r.fecha_salida}{nights > 0 && ` (${nights} noche${nights !== 1 ? 's' : ''})`}
                    </div>
                    <div style={{ fontSize: '12.5px', color: '#475569', marginTop: '2px' }}>
                      👥 {r.num_adultos} adulto{r.num_adultos !== 1 ? 's' : ''}{r.num_ninos > 0 ? `, ${r.num_ninos} niño${r.num_ninos !== 1 ? 's' : ''}` : ''}{'  ·  '}🌐 {PLATAFORMAS[r.plataforma]}{r.monto_total ? `  ·  💰 ${r.monto_total.toLocaleString()}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 600, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                    <button onClick={() => openEditSTR(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '4px' }} title="Editar">✏️</button>
                    <button onClick={() => deleteSTR(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '4px' }} title="Eliminar">🗑️</button>
                  </div>
                </div>
                {r.notas && <div style={{ marginTop: '8px', fontSize: '12px', color: '#64748b', background: '#f8fafc', borderRadius: '6px', padding: '8px' }}>{r.notas}</div>}
              </div>
            )
          })}

          {showSTR && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }}>
              <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>{editSTR ? 'Editar reserva STR' : 'Nueva reserva STR'}</h3>
                  <button onClick={() => setShowSTR(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: '#94a3b8' }}>✕</button>
                </div>
                <div style={rowStyle}>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={labelStyle}>Nombre del huésped *</label>
                    <input style={fieldStyle} value={formSTR.huesped_nombre ?? ''} onChange={e => setFormSTR(p => ({ ...p, huesped_nombre: e.target.value }))} placeholder="Nombre completo" />
                  </div>
                  <div>
                    <label style={labelStyle}>Teléfono</label>
                    <input style={fieldStyle} value={formSTR.huesped_telefono ?? ''} onChange={e => setFormSTR(p => ({ ...p, huesped_telefono: e.target.value }))} placeholder="+502 0000-0000" />
                  </div>
                  <div>
                    <label style={labelStyle}>Email</label>
                    <input style={fieldStyle} type="email" value={formSTR.huesped_email ?? ''} onChange={e => setFormSTR(p => ({ ...p, huesped_email: e.target.value }))} placeholder="correo@ejemplo.com" />
                  </div>
                  <div>
                    <label style={labelStyle}>Fecha entrada *</label>
                    <input style={fieldStyle} type="date" value={formSTR.fecha_entrada ?? ''} onChange={e => setFormSTR(p => ({ ...p, fecha_entrada: e.target.value }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>Fecha salida *</label>
                    <input style={fieldStyle} type="date" value={formSTR.fecha_salida ?? ''} onChange={e => setFormSTR(p => ({ ...p, fecha_salida: e.target.value }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>Adultos</label>
                    <input style={fieldStyle} type="number" min={1} value={formSTR.num_adultos ?? 1} onChange={e => setFormSTR(p => ({ ...p, num_adultos: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>Niños</label>
                    <input style={fieldStyle} type="number" min={0} value={formSTR.num_ninos ?? 0} onChange={e => setFormSTR(p => ({ ...p, num_ninos: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>Plataforma</label>
                    <select style={fieldStyle} value={formSTR.plataforma ?? 'directo'} onChange={e => setFormSTR(p => ({ ...p, plataforma: e.target.value as PlataformaSTR }))}>
                      {(Object.entries(PLATAFORMAS) as [PlataformaSTR, string][]).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>
                      Tarifa por noche
                      {formSTR.fecha_entrada && formSTR.fecha_salida && (
                        <span style={{ fontWeight: 400, color: '#94a3b8' }}>{' '}({calcNights(formSTR.fecha_entrada, formSTR.fecha_salida)} noches = {(calcNights(formSTR.fecha_entrada, formSTR.fecha_salida) * (Number(formSTR.monto_noche) || 0)).toLocaleString()})</span>
                      )}
                    </label>
                    <input style={fieldStyle} type="number" min={0} value={formSTR.monto_noche ?? 0} onChange={e => setFormSTR(p => ({ ...p, monto_noche: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>Estado</label>
                    <select style={fieldStyle} value={formSTR.estado ?? 'confirmada'} onChange={e => setFormSTR(p => ({ ...p, estado: e.target.value as EstadoSTR }))}>
                      <option value="confirmada">Confirmada</option>
                      <option value="en_curso">En curso</option>
                      <option value="completada">Completada</option>
                      <option value="cancelada">Cancelada</option>
                    </select>
                  </div>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={labelStyle}>Notas</label>
                    <textarea style={{ ...fieldStyle, minHeight: '72px', resize: 'vertical' }} value={formSTR.notas ?? ''} onChange={e => setFormSTR(p => ({ ...p, notas: e.target.value }))} placeholder="Observaciones opcionales…" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <button onClick={() => setShowSTR(false)} style={{ padding: '9px 20px', background: '#f1f5f9', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', color: '#475569' }}>Cancelar</button>
                  <button onClick={saveSTR} disabled={savingSTR} style={{ padding: '9px 22px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', cursor: savingSTR ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '13px', opacity: savingSTR ? 0.7 : 1 }}>
                    {savingSTR ? 'Guardando…' : editSTR ? 'Actualizar' : 'Crear reserva'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
