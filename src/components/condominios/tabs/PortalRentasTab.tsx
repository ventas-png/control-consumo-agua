import { useState, useEffect, useCallback } from 'react'
import Swal from 'sweetalert2'
import { notify } from '../../shared/Dialog'
import { supabase } from '../../../lib/supabase'
import { ImageUploader } from '../../shared/ImageUploader'
import type {
  ContratoArrendamiento, ReservaSTR,
  EstadoContrato, EstadoSTR, PlataformaSTR, PoliticaCancelacionSTR,
  SolicitudRentaUnidad, TipoRenta, HuespedSTR,
} from '../../../types'

interface HuespedSTRForm {
  id?: string
  nombre: string
  identificacion: string
  es_menor: boolean
  fecha_nacimiento: string
  foto_url: string | null
  foto_documento_url: string | null
  visitante_id?: string | null
}

const defaultHuesped = (): Omit<HuespedSTRForm, 'id' | 'visitante_id'> => ({
  nombre: '', identificacion: '', es_menor: false, fecha_nacimiento: '',
  foto_url: null, foto_documento_url: null,
})

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
  activo:    { label: 'Activo',    bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  vencido:   { label: 'Vencido',  bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  terminado: { label: 'Terminado',bg: 'var(--at-surface-2)', color: 'var(--at-ink-3)' },
}

const ESTADO_STR: Record<EstadoSTR, { label: string; bg: string; color: string }> = {
  confirmada: { label: 'Confirmada',  bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  en_curso:   { label: 'En curso',    bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  completada: { label: 'Completada',  bg: 'var(--at-surface-2)', color: 'var(--at-ink-3)' },
  cancelada:  { label: 'Cancelada',   bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
}

const PLATAFORMAS: Record<PlataformaSTR, string> = {
  airbnb:  'Airbnb',
  booking: 'Booking.com',
  vrbo:    'VRBO',
  directo: 'Directo',
  otro:    'Otro',
}

const POLITICA_CANCELACION: Record<PoliticaCancelacionSTR, string> = {
  flexible: 'Flexible', moderada: 'Moderada', estricta: 'Estricta',
  no_reembolsable: 'No reembolsable', na: 'N/A', otra: 'Otra',
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
    codigo_confirmacion: '', fecha_reservacion: '',
    fecha_entrada: '', fecha_salida: '',
    hora_llegada_estimada: '', hora_salida_estimada: '',
    num_adultos: 1, num_ninos: 0, num_bebes: 0,
    plataforma: 'directo', monto_noche: 0, monto_total: 0,
    estado: 'confirmada', politica_cancelacion: 'na', mascotas: false, notas: '',
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
    border: '1.5px solid var(--at-line)', borderRadius: '8px', outline: 'none',
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
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    notify({ variant: 'success', title: '¡Solicitud enviada!', text: 'La administración revisará tu solicitud pronto.', duration: 2000 })
    onSolicitudChange()
  }

  return (
    <div style={{ maxWidth: '520px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>
          🔑 Solicitar autorización de renta
        </h3>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-3)' }}>
          Para gestionar contratos o reservas en tu unidad, primero debes solicitar autorización a la administración.
        </p>
      </div>

      {prevRechazada && (
        <div style={{
          background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)',
          borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px',
        }}>
          <div style={{ fontWeight: 700, color: 'var(--at-danger)', marginBottom: '4px' }}>❌ Solicitud anterior rechazada</div>
          {prevRechazada.comentario_admin && (
            <div style={{ color: 'var(--at-danger-strong)' }}>Motivo: {prevRechazada.comentario_admin}</div>
          )}
          <div style={{ color: 'var(--at-ink-3)', fontSize: '12px', marginTop: '4px' }}>Puedes enviar una nueva solicitud.</div>
        </div>
      )}

      <div style={{ marginBottom: '14px' }}>
        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '6px' }}>
          Tipo de renta que deseas operar *
        </label>
        {(['arrendamiento', 'str', 'ambas'] as TipoRenta[]).map(t => (
          <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', cursor: 'pointer' }}>
            <input
              type="radio" name="tipo_renta" value={t} checked={tipo === t}
              onChange={() => setTipo(t)}
              style={{ accentColor: 'var(--at-accent-hover)', width: '16px', height: '16px' }}
            />
            <span style={{ fontSize: '13.5px', color: 'var(--at-ink-2)' }}>{TIPO_RENTA_LABEL[t]}</span>
          </label>
        ))}
      </div>

      <div style={{ marginBottom: '18px' }}>
        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>
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
          padding: '10px 24px', background: 'var(--at-accent-hover)', color: 'white',
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
  const [fotoUrl, setFotoUrl]                 = useState<string | null>(null)
  const [fotoDocumentoUrl, setFotoDocumentoUrl] = useState<string | null>(null)
  const [huespedes, setHuespedes]             = useState<HuespedSTRForm[]>([])
  const [reservaHuespedes, setReservaHuespedes] = useState<Record<string, HuespedSTR[]>>({})
  const [showHuespedForm, setShowHuespedForm] = useState(false)
  const [huespedForm, setHuespedForm]         = useState<Omit<HuespedSTRForm, 'id' | 'visitante_id'>>(defaultHuesped())

  const cargar = useCallback(async () => {
    if (!unidadId || solicitudRenta?.estado !== 'aprobada') return
    setLoading(true)
    const [{ data: cd }, { data: rd }] = await Promise.all([
      supabase.from('contratos_arrendamiento').select('*').eq('unidad_id', unidadId).order('created_at', { ascending: false }),
      supabase.from('reservas_str').select('*').eq('unidad_id', unidadId).order('fecha_entrada', { ascending: false }),
    ])
    setContratos((cd as ContratoArrendamiento[]) ?? [])
    const reservasData = (rd as ReservaSTR[]) ?? []
    setReservas(reservasData)

    // Fetch group members for all reservations to show pre-registration progress.
    if (reservasData.length > 0) {
      const { data: hd } = await supabase
        .from('huespedes_str')
        .select('*')
        .in('reserva_str_id', reservasData.map(r => r.id))
      const grouped: Record<string, HuespedSTR[]> = {}
      ;(hd ?? []).forEach(h => {
        if (!grouped[h.reserva_str_id]) grouped[h.reserva_str_id] = []
        grouped[h.reserva_str_id].push(h as HuespedSTR)
      })
      setReservaHuespedes(grouped)
    } else {
      setReservaHuespedes({})
    }
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
    if (!formCA.arrendatario_nombre?.trim()) { notify({ variant: 'error', title: 'Error', text: 'El nombre del arrendatario es requerido.' }); return }
    if (!formCA.fecha_inicio) { notify({ variant: 'error', title: 'Error', text: 'La fecha de inicio es requerida.' }); return }
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
      if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setSavingCA(false); return }
    } else {
      const { error } = await supabase.from('contratos_arrendamiento').insert(payload)
      if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setSavingCA(false); return }
    }
    setSavingCA(false); setShowCA(false); cargar()
    Swal.fire({ icon: 'success', title: editCA ? 'Contrato actualizado' : 'Contrato creado', timer: 1400, showConfirmButton: false })
  }

  async function deleteCA(c: ContratoArrendamiento) {
    const r = await Swal.fire({ title: '¿Eliminar contrato?', text: `Arrendatario: ${c.arrendatario_nombre}`, icon: 'warning', showCancelButton: true, confirmButtonColor: 'var(--at-danger)', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!r.isConfirmed) return
    await supabase.from('contratos_arrendamiento').delete().eq('id', c.id)
    setContratos((prev: ContratoArrendamiento[]) => prev.filter((x: ContratoArrendamiento) => x.id !== c.id))
    notify({ variant: 'success', title: 'Eliminado', duration: 1200 })
  }

  // ── STR helpers ─────────────────────────────────────────────────────────────

  function resetSTRForm() {
    setShowSTR(false); setEditSTR(null); setFormSTR(blankReserva())
    setFotoUrl(null); setFotoDocumentoUrl(null)
    setHuespedes([]); setShowHuespedForm(false); setHuespedForm(defaultHuesped())
  }

  function openNewSTR() {
    setEditSTR(null); setFormSTR(blankReserva())
    setFotoUrl(null); setFotoDocumentoUrl(null)
    setHuespedes([]); setShowHuespedForm(false); setHuespedForm(defaultHuesped())
    setShowSTR(true)
  }

  function openEditSTR(r: ReservaSTR) {
    setEditSTR(r)
    setFormSTR({
      ...r,
      hora_llegada_estimada: (r.hora_llegada_estimada ?? '').slice(0, 5),
      hora_salida_estimada: (r.hora_salida_estimada ?? '').slice(0, 5),
    })
    setFotoUrl(r.foto_url ?? null)
    setFotoDocumentoUrl(r.foto_documento_url ?? null)
    setHuespedes((reservaHuespedes[r.id] ?? []).map(h => ({
      id: h.id,
      nombre: h.nombre,
      identificacion: h.identificacion ?? '',
      es_menor: h.es_menor,
      fecha_nacimiento: h.fecha_nacimiento ?? '',
      foto_url: h.foto_url ?? null,
      foto_documento_url: h.foto_documento_url ?? null,
      visitante_id: h.visitante_id,
    })))
    setShowHuespedForm(false); setHuespedForm(defaultHuesped())
    setShowSTR(true)
  }

  function calcNights(entrada: string, salida: string) {
    if (!entrada || !salida) return 0
    const d = (new Date(salida).getTime() - new Date(entrada).getTime()) / 86400000
    return d > 0 ? d : 0
  }

  const maxAdicionalesSTR = (Number(formSTR.num_adultos) || 1) + (Number(formSTR.num_ninos) || 0) - 1

  function agregarHuesped() {
    if (!huespedForm.nombre.trim()) { notify({ variant: 'error', title: 'Error', text: 'Ingrese el nombre de la persona.' }); return }
    if (huespedes.length >= maxAdicionalesSTR) {
      notify({ variant: 'warning', title: 'Capacidad', text: 'Ya se alcanzó el máximo de personas adicionales para esta reserva.' })
      return
    }
    setHuespedes(prev => [...prev, { ...huespedForm, nombre: huespedForm.nombre.trim() }])
    setHuespedForm(defaultHuesped()); setShowHuespedForm(false)
  }

  function quitarHuesped(index: number) {
    if (huespedes[index]?.visitante_id) {
      notify({ variant: 'info', title: 'No permitido', text: 'Esta persona ya registró su ingreso y no puede eliminarse.' })
      return
    }
    setHuespedes(prev => prev.filter((_, i) => i !== index))
  }

  async function saveGuests(reservaId: string) {
    const existing = reservaHuespedes[reservaId] ?? []
    const formIds = new Set(huespedes.filter(h => h.id).map(h => h.id!))

    const toDelete = existing.filter(h => !h.visitante_id && !formIds.has(h.id)).map(h => h.id)
    if (toDelete.length > 0) {
      await supabase.from('huespedes_str').delete().in('id', toDelete)
    }

    for (const h of huespedes.filter(g => g.id && !g.visitante_id)) {
      await supabase.from('huespedes_str').update({
        nombre: h.nombre.trim(),
        identificacion: h.identificacion.trim() || null,
        es_menor: h.es_menor,
        fecha_nacimiento: h.es_menor && h.fecha_nacimiento ? h.fecha_nacimiento : null,
        foto_url: h.foto_url,
        foto_documento_url: h.foto_documento_url,
      }).eq('id', h.id!)
    }

    const toInsert = huespedes.filter(h => !h.id && h.nombre.trim())
    if (toInsert.length > 0) {
      await supabase.from('huespedes_str').insert(toInsert.map(h => ({
        reserva_str_id: reservaId,
        nombre: h.nombre.trim(),
        identificacion: h.identificacion.trim() || null,
        es_menor: h.es_menor,
        fecha_nacimiento: h.es_menor && h.fecha_nacimiento ? h.fecha_nacimiento : null,
        foto_url: h.foto_url,
        foto_documento_url: h.foto_documento_url,
      })))
    }
  }

  async function saveSTR() {
    if (!formSTR.huesped_nombre?.trim()) { notify({ variant: 'error', title: 'Error', text: 'El nombre del huésped es requerido.' }); return }
    if (!formSTR.fecha_entrada || !formSTR.fecha_salida) { notify({ variant: 'error', title: 'Error', text: 'Las fechas de entrada y salida son requeridas.' }); return }
    setSavingSTR(true)
    const nights = calcNights(formSTR.fecha_entrada!, formSTR.fecha_salida!)
    const total  = nights * (Number(formSTR.monto_noche) || 0)
    const payload = {
      company_id: companyId, project_id: proyectoId, unidad_id: unidadId,
      huesped_nombre: formSTR.huesped_nombre!.trim(),
      huesped_email: formSTR.huesped_email || null,
      huesped_telefono: formSTR.huesped_telefono || null,
      codigo_confirmacion: formSTR.codigo_confirmacion?.trim() || null,
      fecha_reservacion: formSTR.fecha_reservacion || null,
      fecha_entrada: formSTR.fecha_entrada,
      fecha_salida: formSTR.fecha_salida,
      hora_llegada_estimada: formSTR.hora_llegada_estimada || null,
      hora_salida_estimada: formSTR.hora_salida_estimada || null,
      num_adultos: Number(formSTR.num_adultos) || 1,
      num_ninos: Number(formSTR.num_ninos) || 0,
      num_bebes: Number(formSTR.num_bebes) || 0,
      plataforma: formSTR.plataforma ?? 'directo',
      monto_noche: Number(formSTR.monto_noche) || null,
      monto_total: total || null,
      estado: formSTR.estado ?? 'confirmada',
      politica_cancelacion: formSTR.politica_cancelacion || null,
      mascotas: formSTR.mascotas ?? false,
      notas: formSTR.notas || null,
      foto_url: fotoUrl,
      foto_documento_url: fotoDocumentoUrl,
    }
    let reservaId: string | null = editSTR?.id ?? null
    if (editSTR) {
      const { error } = await supabase.from('reservas_str').update(payload).eq('id', editSTR.id)
      if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setSavingSTR(false); return }
    } else {
      const { data, error } = await supabase.from('reservas_str').insert(payload).select('id').single()
      if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setSavingSTR(false); return }
      reservaId = data.id
    }
    if (reservaId) await saveGuests(reservaId)
    setSavingSTR(false); resetSTRForm(); cargar()
    Swal.fire({ icon: 'success', title: editSTR ? 'Reserva actualizada' : 'Reserva creada', timer: 1400, showConfirmButton: false })
  }

  async function deleteSTR(r: ReservaSTR) {
    const res = await Swal.fire({ title: '¿Eliminar reserva?', text: `Huésped: ${r.huesped_nombre}`, icon: 'warning', showCancelButton: true, confirmButtonColor: 'var(--at-danger)', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!res.isConfirmed) return
    await supabase.from('reservas_str').delete().eq('id', r.id)
    setReservas((prev: ReservaSTR[]) => prev.filter((x: ReservaSTR) => x.id !== r.id))
    notify({ variant: 'success', title: 'Eliminada', duration: 1200 })
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', fontSize: '13.5px',
    border: '1.5px solid var(--at-line)', borderRadius: '8px', outline: 'none',
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '4px', display: 'block' }
  const rowStyle: React.CSSProperties   = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }

  // ── Header (always shown) ────────────────────────────────────────────────────

  const header = (
    <div style={{ marginBottom: '20px' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>
        🏠 Rentas — {unidadNombre}
      </h3>
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-3)' }}>
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
          background: 'var(--at-warning-tint)', border: '1.5px solid var(--at-warning-border)',
          borderRadius: '14px', padding: '24px 28px', maxWidth: '520px',
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
          <div style={{ fontWeight: 700, fontSize: '16px', color: 'var(--at-warning-strong)', marginBottom: '6px' }}>
            Solicitud en revisión
          </div>
          <div style={{ fontSize: '13px', color: 'var(--at-warning-strong)', lineHeight: 1.6 }}>
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
        background: 'var(--at-success-tint)', border: '1px solid var(--at-success-border)',
        borderRadius: '20px', padding: '4px 14px', marginBottom: '16px',
        fontSize: '12px', fontWeight: 600, color: 'var(--at-success)',
      }}>
        ✅ Autorizado: {TIPO_RENTA_LABEL[tipoAprobado!]}
        {solicitudRenta.aprobado_por && <span style={{ fontWeight: 400, opacity: 0.8 }}>— {solicitudRenta.aprobado_por}</span>}
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '2px solid var(--at-chip)' }}>
        {allowedSubTabs.map(id => (
          <button
            key={id}
            onClick={() => setSubTab(id)}
            style={{
              padding: '9px 18px', border: 'none', cursor: 'pointer', fontWeight: 600,
              fontSize: '13px', borderRadius: '8px 8px 0 0',
              background: subTab === id ? 'var(--at-accent-hover)' : 'transparent',
              color: subTab === id ? 'white' : 'var(--at-ink-3)',
              borderBottom: subTab === id ? '2px solid var(--at-accent-hover)' : '2px solid transparent',
              marginBottom: '-2px',
            }}
          >{id === 'arrendamiento' ? '📄 Arrendamiento' : '🏨 STR / Corto Plazo'}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--at-ink-3)', fontSize: '14px' }}>Cargando…</div>
      ) : subTab === 'arrendamiento' ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px' }}>
            <button onClick={openNewCA} style={{ padding: '8px 18px', background: 'var(--at-accent-hover)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Nuevo contrato</button>
          </div>

          {contratos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--at-ink-3)' }}>
              <div style={{ fontSize: '36px', marginBottom: '10px' }}>📄</div>
              <div style={{ fontSize: '14px' }}>Sin contratos de arrendamiento registrados</div>
            </div>
          ) : contratos.map(c => {
            const cfg = ESTADO_CONTRATO[c.estado]
            return (
              <div key={c.id} style={{ border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '10px', background: 'var(--at-surface)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--at-ink)', marginBottom: '4px' }}>👤 {c.arrendatario_nombre}</div>
                    {c.arrendatario_telefono && <div style={{ fontSize: '12.5px', color: 'var(--at-ink-2)' }}>📞 {c.arrendatario_telefono}</div>}
                    {c.arrendatario_email && <div style={{ fontSize: '12.5px', color: 'var(--at-ink-2)' }}>✉️ {c.arrendatario_email}</div>}
                    <div style={{ fontSize: '12.5px', color: 'var(--at-ink-2)', marginTop: '4px' }}>
                      📅 {c.fecha_inicio}{c.fecha_fin ? ` → ${c.fecha_fin}` : ' (indefinido)'}{'  '}|{'  '}💰 Renta: {c.monto_renta.toLocaleString()} · Día {c.dia_pago}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 600, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                    <button onClick={() => openEditCA(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '4px' }} title="Editar">✏️</button>
                    <button onClick={() => deleteCA(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '4px' }} title="Eliminar">🗑️</button>
                  </div>
                </div>
                {c.notas && <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--at-ink-3)', background: 'var(--at-surface-2)', borderRadius: '6px', padding: '8px' }}>{c.notas}</div>}
              </div>
            )
          })}

          {showCA && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }}>
              <div style={{ background: 'var(--at-surface)', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>{editCA ? 'Editar contrato' : 'Nuevo contrato de arrendamiento'}</h3>
                  <button onClick={() => setShowCA(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: 'var(--at-ink-3)' }}>✕</button>
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
                  <button onClick={() => setShowCA(false)} style={{ padding: '9px 20px', background: 'var(--at-chip)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', color: 'var(--at-ink-2)' }}>Cancelar</button>
                  <button onClick={saveCA} disabled={savingCA} style={{ padding: '9px 22px', background: 'var(--at-accent-hover)', color: 'white', border: 'none', borderRadius: '8px', cursor: savingCA ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '13px', opacity: savingCA ? 0.7 : 1 }}>
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
            <button onClick={openNewSTR} style={{ padding: '8px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Nueva reserva</button>
          </div>

          {reservas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--at-ink-3)' }}>
              <div style={{ fontSize: '36px', marginBottom: '10px' }}>🏨</div>
              <div style={{ fontSize: '14px' }}>Sin reservas STR registradas</div>
            </div>
          ) : reservas.map(r => {
            const cfg    = ESTADO_STR[r.estado]
            const nights = calcNights(r.fecha_entrada, r.fecha_salida)
            const preregistrados = (reservaHuespedes[r.id] ?? []).length
            const capacidad = r.num_adultos + r.num_ninos
            return (
              <div key={r.id} style={{ border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '10px', background: 'var(--at-surface)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--at-ink)', marginBottom: '4px' }}>
                      👤 {r.huesped_nombre}
                      {preregistrados > 0 && (
                        <span style={{ marginLeft: 8, padding: '2px 8px', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                          +{preregistrados} pre-reg
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '12.5px', color: 'var(--at-ink-2)' }}>
                      📅 {r.fecha_entrada} → {r.fecha_salida}{nights > 0 && ` (${nights} noche${nights !== 1 ? 's' : ''})`}
                    </div>
                    {(r.hora_llegada_estimada || r.hora_salida_estimada) && (
                      <div style={{ fontSize: '12.5px', color: 'var(--at-ink-2)', marginTop: '2px' }}>
                        🕒 {r.hora_llegada_estimada ? `Llegada ${r.hora_llegada_estimada.slice(0, 5)}` : ''}{r.hora_llegada_estimada && r.hora_salida_estimada ? ' · ' : ''}{r.hora_salida_estimada ? `Salida ${r.hora_salida_estimada.slice(0, 5)}` : ''}
                      </div>
                    )}
                    <div style={{ fontSize: '12.5px', color: 'var(--at-ink-2)', marginTop: '2px' }}>
                      👥 {r.num_adultos} adulto{r.num_adultos !== 1 ? 's' : ''}{r.num_ninos > 0 ? `, ${r.num_ninos} niño${r.num_ninos !== 1 ? 's' : ''}` : ''}{r.num_bebes > 0 ? `, ${r.num_bebes} bebé${r.num_bebes !== 1 ? 's' : ''}` : ''}{'  ·  '}🌐 {PLATAFORMAS[r.plataforma]}{r.monto_total ? `  ·  💰 ${r.monto_total.toLocaleString()}` : ''}{r.mascotas ? '  ·  🐾' : ''}
                      {preregistrados > 0 && ` · ${1 + preregistrados}/${capacidad} personas pre-registradas`}
                    </div>
                    {(r.codigo_confirmacion || (r.politica_cancelacion && r.politica_cancelacion !== 'na')) && (
                      <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                        {r.codigo_confirmacion ? `🔖 ${r.codigo_confirmacion}` : ''}{r.codigo_confirmacion && r.politica_cancelacion && r.politica_cancelacion !== 'na' ? '  ·  ' : ''}{r.politica_cancelacion && r.politica_cancelacion !== 'na' ? `📋 ${POLITICA_CANCELACION[r.politica_cancelacion]}` : ''}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 600, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                    <button onClick={() => openEditSTR(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '4px' }} title="Editar">✏️</button>
                    <button onClick={() => deleteSTR(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '4px' }} title="Eliminar">🗑️</button>
                  </div>
                </div>
                {r.notas && <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--at-ink-3)', background: 'var(--at-surface-2)', borderRadius: '6px', padding: '8px' }}>{r.notas}</div>}
              </div>
            )
          })}

          {showSTR && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }}>
              <div style={{ background: 'var(--at-surface)', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>{editSTR ? 'Editar reserva STR' : 'Nueva reserva STR'}</h3>
                  <button onClick={resetSTRForm} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: 'var(--at-ink-3)' }}>✕</button>
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
                    <label style={labelStyle}>Código de confirmación</label>
                    <input style={fieldStyle} value={formSTR.codigo_confirmacion ?? ''} onChange={e => setFormSTR(p => ({ ...p, codigo_confirmacion: e.target.value }))} placeholder="Ej. HMABCD123" />
                  </div>
                  <div>
                    <label style={labelStyle}>Fecha de reservación</label>
                    <input style={fieldStyle} type="date" value={formSTR.fecha_reservacion ?? ''} onChange={e => setFormSTR(p => ({ ...p, fecha_reservacion: e.target.value }))} />
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
                    <label style={labelStyle}>Hora estimada de llegada</label>
                    <input style={fieldStyle} type="time" value={formSTR.hora_llegada_estimada ?? ''} onChange={e => setFormSTR(p => ({ ...p, hora_llegada_estimada: e.target.value }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>Hora estimada de salida</label>
                    <input style={fieldStyle} type="time" value={formSTR.hora_salida_estimada ?? ''} onChange={e => setFormSTR(p => ({ ...p, hora_salida_estimada: e.target.value }))} />
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
                    <label style={labelStyle}>Bebés</label>
                    <input style={fieldStyle} type="number" min={0} value={formSTR.num_bebes ?? 0} onChange={e => setFormSTR(p => ({ ...p, num_bebes: Number(e.target.value) }))} />
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
                        <span style={{ fontWeight: 400, color: 'var(--at-ink-3)' }}>{' '}({calcNights(formSTR.fecha_entrada, formSTR.fecha_salida)} noches = {(calcNights(formSTR.fecha_entrada, formSTR.fecha_salida) * (Number(formSTR.monto_noche) || 0)).toLocaleString()})</span>
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
                  <div>
                    <label style={labelStyle}>Política de cancelación</label>
                    <select style={fieldStyle} value={formSTR.politica_cancelacion ?? 'na'} onChange={e => setFormSTR(p => ({ ...p, politica_cancelacion: e.target.value as PoliticaCancelacionSTR }))}>
                      {(Object.entries(POLITICA_CANCELACION) as [PoliticaCancelacionSTR, string][]).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Mascotas</label>
                    <select style={fieldStyle} value={formSTR.mascotas ? 'si' : 'no'} onChange={e => setFormSTR(p => ({ ...p, mascotas: e.target.value === 'si' }))}>
                      <option value="no">No</option>
                      <option value="si">Sí</option>
                    </select>
                  </div>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={labelStyle}>Notas</label>
                    <textarea style={{ ...fieldStyle, minHeight: '72px', resize: 'vertical' }} value={formSTR.notas ?? ''} onChange={e => setFormSTR(p => ({ ...p, notas: e.target.value }))} placeholder="Observaciones opcionales…" />
                  </div>

                  {/* Fotos del huésped principal */}
                  <div style={{ gridColumn: '1/-1', paddingTop: '4px', borderTop: '1px solid var(--at-line)' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '8px' }}>
                      Fotografías del huésped principal <span style={{ fontWeight: 400, color: 'var(--at-ink-3)' }}>(opcional — se pueden completar al ingreso)</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', maxWidth: '400px' }}>
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px' }}>Foto del huésped</div>
                        <ImageUploader value={fotoUrl} onChange={setFotoUrl} folder="str_guests" label="Foto del huésped" capture />
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px' }}>Foto del documento / DPI</div>
                        <ImageUploader value={fotoDocumentoUrl} onChange={setFotoDocumentoUrl} folder="str_guests" label="DPI / Documento" capture />
                      </div>
                    </div>
                  </div>

                  {/* Personas del grupo */}
                  <div style={{ gridColumn: '1/-1', borderTop: '1px solid var(--at-line)', paddingTop: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-3)' }}>
                        Personas del grupo
                        <span style={{ fontWeight: 400, color: 'var(--at-ink-3)', marginLeft: 6 }}>
                          (principal + {huespedes.length}/{maxAdicionalesSTR} adicionales pre-registradas)
                        </span>
                      </div>
                      {!showHuespedForm && huespedes.length < maxAdicionalesSTR && (
                        <button type="button" onClick={() => setShowHuespedForm(true)}
                          style={{ padding: '4px 12px', background: 'var(--at-surface-2)', color: 'var(--at-ink-2)', border: '1.5px solid var(--at-line)', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                          + Agregar persona
                        </button>
                      )}
                    </div>

                    {/* Principal */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '8px', marginBottom: '6px' }}>
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--at-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'white', fontWeight: 700, flexShrink: 0 }}>1</div>
                      <div style={{ flex: 1, fontSize: '13px', fontWeight: 600, color: 'var(--at-ink)' }}>{formSTR.huesped_nombre || 'Huésped principal'}</div>
                      <span style={{ fontSize: '10px', color: 'var(--at-primary-hover)', fontWeight: 600, padding: '2px 8px', background: 'var(--at-primary-soft)', borderRadius: '10px' }}>Principal</span>
                    </div>

                    {/* Adicionales */}
                    {huespedes.map((h, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: h.visitante_id ? 'var(--at-success-tint)' : 'var(--at-surface-2)', border: `1px solid ${h.visitante_id ? 'var(--at-success-border)' : 'var(--at-line)'}`, borderRadius: '8px', marginBottom: '6px' }}>
                        <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--at-line)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'var(--at-ink-2)', fontWeight: 700, flexShrink: 0 }}>{i + 2}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--at-ink)' }}>
                            {h.es_menor ? '👶 ' : ''}{h.nombre}
                            {h.visitante_id && <span style={{ marginLeft: 6, fontSize: '10px', color: 'var(--at-success)', fontWeight: 600 }}>✓ Ingresado</span>}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>
                            {h.es_menor
                              ? `Menor${h.fecha_nacimiento ? ` · Nac. ${h.fecha_nacimiento}` : ''}`
                              : h.identificacion ? `DPI: ${h.identificacion}` : 'Sin documento'}
                          </div>
                        </div>
                        {!h.visitante_id && (
                          <button type="button" onClick={() => quitarHuesped(i)}
                            style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--at-danger-tint)', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--at-danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            ×
                          </button>
                        )}
                      </div>
                    ))}

                    {/* Sub-form */}
                    {showHuespedForm && (
                      <div style={{ padding: '14px', background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-2)' }}>Nueva persona del grupo</div>
                        <div>
                          <label style={labelStyle}>Nombre *</label>
                          <input style={fieldStyle} value={huespedForm.nombre} onChange={e => setHuespedForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre completo" />
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--at-ink-2)', cursor: 'pointer', fontWeight: 600 }}>
                          <input type="checkbox" checked={huespedForm.es_menor} onChange={e => setHuespedForm(f => ({ ...f, es_menor: e.target.checked, identificacion: '' }))} />
                          Es menor de edad
                          {huespedForm.es_menor && <span style={{ padding: '2px 7px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', borderRadius: '20px', fontSize: '10px' }}>Menor</span>}
                        </label>
                        {huespedForm.es_menor ? (
                          <div>
                            <label style={labelStyle}>Fecha de nacimiento (opcional)</label>
                            <input type="date" style={fieldStyle} value={huespedForm.fecha_nacimiento} onChange={e => setHuespedForm(f => ({ ...f, fecha_nacimiento: e.target.value }))} />
                          </div>
                        ) : (
                          <div>
                            <label style={labelStyle}>DPI / Identificación</label>
                            <input style={fieldStyle} value={huespedForm.identificacion} onChange={e => setHuespedForm(f => ({ ...f, identificacion: e.target.value }))} placeholder="Número de documento" />
                          </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: huespedForm.es_menor ? '1fr' : '1fr 1fr', gap: '10px' }}>
                          <div>
                            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginBottom: '3px' }}>Foto de la persona</div>
                            <ImageUploader value={huespedForm.foto_url} onChange={v => setHuespedForm(f => ({ ...f, foto_url: v }))} folder="str_guests" label="Foto" capture />
                          </div>
                          {!huespedForm.es_menor && (
                            <div>
                              <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginBottom: '3px' }}>Foto del documento</div>
                              <ImageUploader value={huespedForm.foto_documento_url} onChange={v => setHuespedForm(f => ({ ...f, foto_documento_url: v }))} folder="str_guests" label="Documento" capture />
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button type="button" onClick={agregarHuesped}
                            style={{ padding: '7px 16px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                            + Agregar
                          </button>
                          <button type="button" onClick={() => { setShowHuespedForm(false); setHuespedForm(defaultHuesped()) }}
                            style={{ padding: '7px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px' }}>
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <button onClick={resetSTRForm} style={{ padding: '9px 20px', background: 'var(--at-chip)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', color: 'var(--at-ink-2)' }}>Cancelar</button>
                  <button onClick={saveSTR} disabled={savingSTR} style={{ padding: '9px 22px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', cursor: savingSTR ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '13px', opacity: savingSTR ? 0.7 : 1 }}>
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
