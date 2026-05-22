import { useState, useEffect, useCallback, type CSSProperties } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import { SecureImage } from '../../shared/SecureImage'
import { useSignedUrl } from '../../../lib/storageUrls'
import type { SolicitudMudanzaUnidad, TipoSolicitudMudanza, EstadoSolicitudMudanza, Unidad } from '../../../types'

// Pequeño wrapper para link de descarga con signed URL del bucket mudanza-docs.
function SignedMudanzaImageLink({ url, idx }: { url: string; idx: number }) {
  const signed = useSignedUrl(url, 'mudanza-docs')
  return (
    <a
      href={signed ?? '#'}
      target="_blank"
      rel="noopener noreferrer"
      title="Ver imagen completa"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <SecureImage
        bucket="mudanza-docs"
        src={url}
        alt={`Imagen ${idx + 1}`}
        style={{
          width: 84, height: 84, objectFit: 'cover',
          borderRadius: 6, border: '1.5px solid var(--at-line)',
          cursor: 'zoom-in',
        }}
      />
    </a>
  )
}

interface Props {
  solicitudes: SolicitudMudanzaUnidad[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  autorNombre: string
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_CFG: Record<TipoSolicitudMudanza, { label: string; icon: string }> = {
  nueva_mudanza:     { label: 'Nueva mudanza',        icon: '🚛' },
  ingreso_articulos: { label: 'Ingreso de artículos', icon: '📦' },
  egreso_articulos:  { label: 'Egreso de artículos',  icon: '📤' },
  mudanza_salida:    { label: 'Mudanza de salida',    icon: '🏁' },
}

const ESTADO_CFG: Record<EstadoSolicitudMudanza, { label: string; color: string; bg: string; icon: string }> = {
  pendiente:  { label: 'Pendiente',  color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', icon: '⏳' },
  aprobada:   { label: 'Aprobada',   color: 'var(--at-success)', bg: 'var(--at-success-tint)', icon: '✅' },
  rechazada:  { label: 'Rechazada',  color: 'var(--at-danger)', bg: 'var(--at-danger-tint)', icon: '❌' },
  programada: { label: 'Programada', color: 'var(--at-primary)', bg: 'var(--at-primary-soft)', icon: '📅' },
  en_curso:   { label: 'En Curso',   color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', icon: '🚚' },
  completada: { label: 'Completada', color: 'var(--at-success)', bg: 'var(--at-success-tint)', icon: '🏁' },
  cancelada:  { label: 'Cancelada',  color: 'var(--at-ink-3)', bg: 'var(--at-chip)', icon: '🚫' },
}

// Estados que indican una mudanza ya aprobada (en flujo operativo).
const ESTADOS_OPERATIVOS: EstadoSolicitudMudanza[] = ['aprobada', 'programada', 'en_curso', 'completada']

type Filtro = EstadoSolicitudMudanza | 'all' | 'operativas'

export function SolicitudesMudanzaTab({ solicitudes, unidades, proyectoId, companyId, moneda, autorNombre, canEdit, onRefresh }: Props) {
  const hoy = new Date().toISOString().slice(0, 10)
  const [filtroEstado, setFiltroEstado] = useState<Filtro>('pendiente')
  const [expandedId, setExpandedId]     = useState<string | null>(null)
  const [fechaAut, setFechaAut]         = useState('')
  const [horaAut, setHoraAut]           = useState('')
  const [saving, setSaving]             = useState(false)

  // Terms state
  const [terminosMudanza, setTerminosMudanza] = useState<string>('')
  const [terminosId, setTerminosId]           = useState<string | null>(null)
  const [terminosText, setTerminosText]       = useState<string>('')
  const [terminosOpen, setTerminosOpen]       = useState(false)
  const [savingTerminos, setSavingTerminos]   = useState(false)

  const cargarTerminos = useCallback(async () => {
    const { data } = await supabase
      .from('config_condominio')
      .select('id, terminos_mudanza')
      .eq('project_id', proyectoId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (data) {
      setTerminosMudanza(data.terminos_mudanza ?? '')
      setTerminosId(data.id)
      setTerminosText(data.terminos_mudanza ?? '')
    } else {
      setTerminosMudanza('')
      setTerminosId(null)
      setTerminosText('')
    }
  }, [proyectoId, companyId])

  useEffect(() => { cargarTerminos() }, [cargarTerminos])

  // Collapse section by default when terms are already set
  useEffect(() => {
    setTerminosOpen(!terminosMudanza)
  }, [terminosMudanza])

  async function guardarTerminos() {
    if (!terminosText.trim()) {
      Swal.fire('Error', 'El texto de los términos no puede estar vacío.', 'error')
      return
    }
    setSavingTerminos(true)
    if (terminosId) {
      const { error } = await supabase
        .from('config_condominio')
        .update({ terminos_mudanza: terminosText.trim(), updated_at: new Date().toISOString() })
        .eq('id', terminosId)
      setSavingTerminos(false)
      if (error) { Swal.fire('Error', error.message, 'error'); return }
    } else {
      const { error } = await supabase
        .from('config_condominio')
        .upsert({ company_id: companyId, project_id: proyectoId, terminos_mudanza: terminosText.trim() }, { onConflict: 'project_id' })
      setSavingTerminos(false)
      if (error) { Swal.fire('Error', error.message, 'error'); return }
    }
    Swal.fire({ icon: 'success', title: 'Términos guardados', timer: 1400, showConfirmButton: false })
    await cargarTerminos()
  }

  const filtered = solicitudes.filter(s => {
    if (filtroEstado === 'all') return true
    if (filtroEstado === 'operativas') return ESTADOS_OPERATIVOS.includes(s.estado)
    return s.estado === filtroEstado
  })

  const pendientes = solicitudes.filter(s => s.estado === 'pendiente').length
  const aprobadas  = solicitudes.filter(s => s.estado === 'aprobada').length
  const rechazadas = solicitudes.filter(s => s.estado === 'rechazada').length

  // Alertas operativas (heredadas de "Control de Mudanzas")
  const mudanzasHoy = solicitudes.filter(s =>
    (s.estado === 'programada' || s.estado === 'en_curso' || s.estado === 'aprobada')
    && (s.fecha_autorizada === hoy || (!s.fecha_autorizada && s.fecha_solicitada === hoy))
  )
  const depositosPendientes = solicitudes.filter(s =>
    s.deposito_requerido && !s.deposito_pagado && ESTADOS_OPERATIVOS.includes(s.estado)
  )

  function unidadNombre(s: SolicitudMudanzaUnidad) {
    return s.unidad_nombre || unidades.find(u => u.id === s.unidad_id)?.nombre || s.unidad_id.slice(0, 8)
  }

  function onExpand(id: string) {
    if (expandedId === id) { setExpandedId(null); return }
    const s = solicitudes.find(x => x.id === id)
    setFechaAut(s?.fecha_autorizada ?? s?.fecha_solicitada ?? '')
    setHoraAut(s?.hora_autorizada ?? s?.hora_solicitada ?? '')
    setExpandedId(id)
  }

  async function resolver(s: SolicitudMudanzaUnidad, nuevoEstado: 'aprobada' | 'rechazada') {
    if (!canEdit) return
    const { value: comentario } = await Swal.fire({
      title: nuevoEstado === 'aprobada' ? '¿Aprobar solicitud?' : '¿Rechazar solicitud?',
      input: 'textarea',
      inputLabel: nuevoEstado === 'aprobada' ? 'Comentario (opcional)' : 'Motivo del rechazo',
      inputPlaceholder: 'Escriba un comentario…',
      showCancelButton: true,
      confirmButtonColor: nuevoEstado === 'aprobada' ? 'var(--at-success)' : 'var(--at-danger)',
      confirmButtonText: nuevoEstado === 'aprobada' ? 'Aprobar' : 'Rechazar',
      cancelButtonText: 'Cancelar',
    })
    if (comentario === undefined) return

    setSaving(true)
    const payload: Record<string, unknown> = {
      estado: nuevoEstado,
      comentario_admin: comentario || null,
      aprobado_por: autorNombre || null,
      fecha_resolucion: new Date().toISOString(),
    }
    if (nuevoEstado === 'aprobada') {
      payload.fecha_autorizada = fechaAut || s.fecha_solicitada || null
      payload.hora_autorizada  = horaAut  || s.hora_solicitada  || null
    }
    const { error } = await supabase.from('solicitud_mudanza_unidad').update(payload).eq('id', s.id)
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: nuevoEstado === 'aprobada' ? 'Solicitud aprobada' : 'Solicitud rechazada', timer: 1400, showConfirmButton: false })
    setExpandedId(null); onRefresh()
  }

  async function cambiarEstado(id: string, estado: EstadoSolicitudMudanza) {
    if (!canEdit) return
    const { error } = await supabase.from('solicitud_mudanza_unidad').update({ estado }).eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  async function toggleCampo(id: string, campo: 'deposito_requerido' | 'deposito_pagado' | 'ascensor_reservado', valor: boolean) {
    if (!canEdit) return
    const { error } = await supabase.from('solicitud_mudanza_unidad').update({ [campo]: valor }).eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  async function actualizarMontoDeposito(id: string, monto: number | null) {
    if (!canEdit) return
    const { error } = await supabase.from('solicitud_mudanza_unidad').update({ monto_deposito: monto }).eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  const chipStyle = (active: boolean, color: string): CSSProperties => ({
    padding: '5px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 600,
    cursor: 'pointer', border: 'none',
    background: active ? color : 'var(--at-chip)',
    color: active ? 'white' : 'var(--at-ink-3)',
  })

  const fieldStyle: CSSProperties = {
    padding: '7px 10px', fontSize: '13px', borderRadius: '8px',
    border: '1.5px solid var(--at-line)', background: 'var(--at-surface)',
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>
          🚛 Autorizaciones y Control de Mudanzas
        </h3>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-3)' }}>
          Gestiona el flujo completo: solicitud del residente → aprobación → ejecución con depósito y ascensor.
        </p>
      </div>

      {/* Alertas operativas */}
      {mudanzasHoy.length > 0 && (
        <div style={{ background: 'var(--at-accent-tint)', border: '1px solid var(--at-accent)', borderRadius: '10px', padding: '10px 16px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>🚚</span>
          <span style={{ fontSize: '13px', color: 'var(--at-accent-darker)', fontWeight: 600 }}>
            {mudanzasHoy.length} mudanza{mudanzasHoy.length > 1 ? 's' : ''} programada{mudanzasHoy.length > 1 ? 's' : ''} para hoy
          </span>
        </div>
      )}
      {depositosPendientes.length > 0 && (
        <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning)', borderRadius: '10px', padding: '10px 16px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>💰</span>
          <span style={{ fontSize: '13px', color: 'var(--at-warning-strong)', fontWeight: 600 }}>
            {depositosPendientes.length} depósito{depositosPendientes.length > 1 ? 's' : ''} pendiente{depositosPendientes.length > 1 ? 's' : ''} de cobro
          </span>
        </div>
      )}

      {/* Terms configuration section */}
      <div style={{ marginBottom: '20px', border: '1.5px solid var(--at-line)', borderRadius: '12px', overflow: 'hidden' }}>
        <button
          onClick={() => setTerminosOpen(o => !o)}
          style={{
            width: '100%', padding: '12px 16px', background: 'var(--at-surface-2)',
            border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '15px' }}>📋</span>
            <span style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--at-ink)' }}>Términos de mudanza</span>
            {terminosMudanza && !terminosOpen && (
              <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', fontWeight: 400, maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                — {terminosMudanza.slice(0, 80)}{terminosMudanza.length > 80 ? '…' : ''}
              </span>
            )}
          </div>
          <span style={{ color: 'var(--at-ink-3)', fontSize: '14px' }}>{terminosOpen ? '▲' : '▼'}</span>
        </button>

        {terminosOpen && (
          <div style={{ padding: '16px', borderTop: '1px solid var(--at-line)' }}>
            <p style={{ margin: '0 0 10px', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
              Este texto se mostrará al cliente cuando solicite una mudanza. Si está configurado, el cliente deberá aceptarlo para poder enviar la solicitud.
            </p>
            <textarea
              value={terminosText}
              onChange={e => setTerminosText(e.target.value)}
              placeholder="Escribe aquí los términos y condiciones para autorización de mudanzas…"
              style={{
                width: '100%', minHeight: '120px', padding: '10px 12px',
                fontSize: '13px', borderRadius: '8px', border: '1.5px solid var(--at-line)',
                resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit',
                lineHeight: 1.6, color: 'var(--at-ink-2)',
              }}
            />
            <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={guardarTerminos}
                disabled={savingTerminos}
                style={{
                  padding: '8px 20px', background: 'var(--at-accent-hover)', color: 'white',
                  border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '13px',
                  cursor: savingTerminos ? 'not-allowed' : 'pointer',
                  opacity: savingTerminos ? 0.7 : 1,
                }}
              >
                {savingTerminos ? 'Guardando…' : '💾 Guardar términos'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {[
          { label: 'Pendientes', count: pendientes, color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
          { label: 'Aprobadas',  count: aprobadas,  color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
          { label: 'Rechazadas', count: rechazadas, color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, border: `1px solid ${k.color}30`, borderRadius: '10px', padding: '12px 20px', minWidth: '110px' }}>
            <div style={{ fontSize: '22px', fontWeight: 700, color: k.color }}>{k.count}</div>
            <div style={{ fontSize: '12px', color: k.color, fontWeight: 600 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button style={chipStyle(filtroEstado === 'all', 'var(--at-ink-3)')} onClick={() => setFiltroEstado('all')}>Todas</button>
        <button style={chipStyle(filtroEstado === 'pendiente', 'var(--at-warning)')} onClick={() => setFiltroEstado('pendiente')}>⏳ Pendientes</button>
        <button style={chipStyle(filtroEstado === 'aprobada', 'var(--at-success)')} onClick={() => setFiltroEstado('aprobada')}>✅ Aprobadas</button>
        <button style={chipStyle(filtroEstado === 'operativas', 'var(--at-primary)')} onClick={() => setFiltroEstado('operativas')}>🚚 En ejecución</button>
        <button style={chipStyle(filtroEstado === 'completada', 'var(--at-success)')} onClick={() => setFiltroEstado('completada')}>🏁 Completadas</button>
        <button style={chipStyle(filtroEstado === 'rechazada', 'var(--at-danger)')} onClick={() => setFiltroEstado('rechazada')}>❌ Rechazadas</button>
        <button style={chipStyle(filtroEstado === 'cancelada', 'var(--at-ink-3)')} onClick={() => setFiltroEstado('cancelada')}>🚫 Canceladas</button>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>🚛</div>
          <div style={{ fontSize: '14px' }}>No hay solicitudes{filtroEstado !== 'all' ? ` en este estado` : ''}</div>
        </div>
      ) : filtered.map(s => {
        const tipo     = TIPO_CFG[s.tipo_mudanza]
        const est      = ESTADO_CFG[s.estado]
        const expanded = expandedId === s.id
        const fecha    = s.created_at ? new Date(s.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
        const esOperativa = ESTADOS_OPERATIVOS.includes(s.estado)

        return (
          <div key={s.id} style={{
            border: `1.5px solid ${expanded ? 'var(--at-accent-soft)' : 'var(--at-line)'}`,
            borderRadius: '12px', marginBottom: '10px',
            background: expanded ? 'var(--at-surface-2)' : 'var(--at-surface)', transition: 'all 0.15s',
          }}>
            {/* Card header */}
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', cursor: 'pointer', flexWrap: 'wrap' }}
              onClick={() => onExpand(s.id)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>
                  {tipo.icon} {unidadNombre(s)}
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                  {tipo.label} · {fecha}
                  {s.fecha_solicitada && <span>{'  ·  '}Propuesto: {s.fecha_solicitada}{s.hora_solicitada ? ` ${s.hora_solicitada}` : ''}</span>}
                </div>
                {esOperativa && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                    {s.ascensor_reservado && <span style={{ fontSize: '10px', fontWeight: 600, background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', padding: '1px 6px', borderRadius: '4px' }}>🛗 Ascensor</span>}
                    {s.deposito_requerido && (
                      <span style={{ fontSize: '10px', fontWeight: 600, background: s.deposito_pagado ? 'var(--at-success-tint)' : 'var(--at-warning-tint)', color: s.deposito_pagado ? 'var(--at-success-strong)' : 'var(--at-warning-strong)', padding: '1px 6px', borderRadius: '4px' }}>
                        💰 {s.deposito_pagado ? 'Depósito pagado' : 'Depósito pendiente'}{s.monto_deposito ? ` (${moneda} ${s.monto_deposito})` : ''}
                      </span>
                    )}
                    {s.empresa_mudanza && <span style={{ fontSize: '10px', fontWeight: 600, background: 'var(--at-chip)', color: 'var(--at-ink-2)', padding: '1px 6px', borderRadius: '4px' }}>🏢 {s.empresa_mudanza}</span>}
                  </div>
                )}
              </div>
              <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 600, background: est.bg, color: est.color, whiteSpace: 'nowrap' }}>
                {est.icon} {est.label}
              </span>
              <span style={{ color: 'var(--at-ink-3)', fontSize: '16px' }}>{expanded ? '▲' : '▼'}</span>
            </div>

            {/* Expanded */}
            {expanded && (
              <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--at-line)' }}>
                {s.descripcion && (
                  <div style={{ marginTop: '12px', background: 'var(--at-surface-2)', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: 'var(--at-ink-2)' }}>
                    <strong>Descripción:</strong> {s.descripcion}
                  </div>
                )}

                {/* Attached images */}
                {s.imagenes && s.imagenes.length > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '8px' }}>
                      🖼️ Imágenes adjuntas:
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {s.imagenes.map((url, idx) => (
                        <SignedMudanzaImageLink key={idx} url={url} idx={idx} />
                      ))}
                    </div>
                  </div>
                )}

                {s.comentario_admin && (
                  <div style={{ marginTop: '10px', background: est.bg, borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: est.color }}>
                    <strong>Resolución:</strong> {s.comentario_admin}
                    {s.aprobado_por && <span style={{ marginLeft: '8px', opacity: 0.8 }}>— {s.aprobado_por}</span>}
                  </div>
                )}

                {s.estado !== 'pendiente' && s.estado !== 'rechazada' && s.fecha_autorizada && (
                  <div style={{ marginTop: '8px', fontSize: '12.5px', color: 'var(--at-success)', fontWeight: 600 }}>
                    ✅ Fecha autorizada: {s.fecha_autorizada}{s.hora_autorizada ? ` a las ${s.hora_autorizada}` : ''}
                  </div>
                )}

                {/* Actions for pending */}
                {s.estado === 'pendiente' && canEdit && (
                  <div style={{ marginTop: '14px', display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Fecha autorizada</label>
                      <input
                        type="date" value={fechaAut} onChange={e => setFechaAut(e.target.value)}
                        onClick={e => e.stopPropagation()} style={fieldStyle}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Hora</label>
                      <input
                        type="time" value={horaAut} onChange={e => setHoraAut(e.target.value)}
                        onClick={e => e.stopPropagation()} style={fieldStyle}
                      />
                    </div>
                    <button
                      disabled={saving}
                      onClick={e => { e.stopPropagation(); resolver(s, 'aprobada') }}
                      style={{ padding: '8px 18px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '13px', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
                    >✅ Aprobar</button>
                    <button
                      disabled={saving}
                      onClick={e => { e.stopPropagation(); resolver(s, 'rechazada') }}
                      style={{ padding: '8px 18px', background: 'var(--at-danger)', color: 'var(--at-on-status)', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '13px', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
                    >❌ Rechazar</button>
                  </div>
                )}

                {/* Operational controls for aprobada/programada/en_curso/completada */}
                {esOperativa && canEdit && (
                  <div style={{ marginTop: '14px', padding: '12px', background: 'var(--at-surface-2)', borderRadius: '10px', border: '1px solid var(--at-line)' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '10px' }}>🚚 Control operativo</div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
                      <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)' }}>Estado:</label>
                      <select
                        value={s.estado}
                        onChange={e => { e.stopPropagation(); cambiarEstado(s.id, e.target.value as EstadoSolicitudMudanza) }}
                        onClick={e => e.stopPropagation()}
                        style={{ ...fieldStyle, padding: '5px 8px', fontSize: '12px', fontWeight: 600, color: est.color }}
                      >
                        <option value="aprobada">✅ Aprobada</option>
                        <option value="programada">📅 Programada</option>
                        <option value="en_curso">🚚 En Curso</option>
                        <option value="completada">🏁 Completada</option>
                        <option value="cancelada">🚫 Cancelada</option>
                      </select>
                    </div>

                    <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                        <input
                          type="checkbox" checked={s.ascensor_reservado ?? false}
                          onChange={e => { e.stopPropagation(); toggleCampo(s.id, 'ascensor_reservado', e.target.checked) }}
                          onClick={e => e.stopPropagation()}
                        />
                        🛗 Ascensor reservado
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                        <input
                          type="checkbox" checked={s.deposito_requerido ?? false}
                          onChange={e => { e.stopPropagation(); toggleCampo(s.id, 'deposito_requerido', e.target.checked) }}
                          onClick={e => e.stopPropagation()}
                        />
                        💰 Depósito requerido
                      </label>
                      {s.deposito_requerido && (
                        <>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                            <input
                              type="checkbox" checked={s.deposito_pagado ?? false}
                              onChange={e => { e.stopPropagation(); toggleCampo(s.id, 'deposito_pagado', e.target.checked) }}
                              onClick={e => e.stopPropagation()}
                            />
                            Pagado
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>{moneda}</span>
                            <input
                              type="number" min="0" step="0.01"
                              defaultValue={s.monto_deposito ?? ''}
                              placeholder="0.00"
                              onClick={e => e.stopPropagation()}
                              onBlur={e => {
                                const v = e.target.value
                                actualizarMontoDeposito(s.id, v ? Number(v) : null)
                              }}
                              style={{ ...fieldStyle, width: '90px', padding: '5px 8px', fontSize: '12px' }}
                            />
                          </div>
                        </>
                      )}
                    </div>

                    {(s.estado === 'programada' || s.estado === 'en_curso' || s.estado === 'aprobada') && (
                      <div style={{ marginTop: '10px' }}>
                        <button
                          title="Enviar recordatorio por WhatsApp"
                          onClick={e => {
                            e.stopPropagation()
                            const msg = `🚚 Recordatorio de mudanza\nUnidad: ${unidadNombre(s)}\nTipo: ${tipo.label}\nFecha: ${s.fecha_autorizada ?? s.fecha_solicitada ?? ''}${s.hora_autorizada ? `\nHora: ${s.hora_autorizada}` : ''}${s.ascensor_reservado ? '\n🛗 Ascensor reservado' : ''}${s.deposito_requerido && !s.deposito_pagado ? `\n⚠️ Depósito pendiente${s.monto_deposito ? ` (${moneda} ${s.monto_deposito})` : ''}` : ''}`
                            window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
                          }}
                          style={{ padding: '6px 14px', background: 'var(--at-success-tint)', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', color: 'var(--at-success)' }}
                        >💬 Recordatorio WhatsApp</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
