import { useState, useEffect, useCallback, type CSSProperties } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { SolicitudMudanzaUnidad, TipoSolicitudMudanza, EstadoSolicitudMudanza, Unidad } from '../../../types'

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
  pendiente:  { label: 'Pendiente',  color: '#d97706', bg: '#fef3c7', icon: '⏳' },
  aprobada:   { label: 'Aprobada',   color: '#16a34a', bg: '#dcfce7', icon: '✅' },
  rechazada:  { label: 'Rechazada',  color: '#dc2626', bg: '#fef2f2', icon: '❌' },
  programada: { label: 'Programada', color: '#0ea5e9', bg: '#e0f2fe', icon: '📅' },
  en_curso:   { label: 'En Curso',   color: '#f59e0b', bg: '#fef3c7', icon: '🚚' },
  completada: { label: 'Completada', color: '#10b981', bg: '#d1fae5', icon: '🏁' },
  cancelada:  { label: 'Cancelada',  color: '#64748b', bg: '#f1f5f9', icon: '🚫' },
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
      confirmButtonColor: nuevoEstado === 'aprobada' ? '#16a34a' : '#dc2626',
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
    background: active ? color : '#f1f5f9',
    color: active ? 'white' : '#64748b',
  })

  const fieldStyle: CSSProperties = {
    padding: '7px 10px', fontSize: '13px', borderRadius: '8px',
    border: '1.5px solid #e2e8f0', background: 'white',
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
          🚛 Autorizaciones y Control de Mudanzas
        </h3>
        <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
          Gestiona el flujo completo: solicitud del residente → aprobación → ejecución con depósito y ascensor.
        </p>
      </div>

      {/* Alertas operativas */}
      {mudanzasHoy.length > 0 && (
        <div style={{ background: '#ede9fe', border: '1px solid #8b5cf6', borderRadius: '10px', padding: '10px 16px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>🚚</span>
          <span style={{ fontSize: '13px', color: '#5b21b6', fontWeight: 600 }}>
            {mudanzasHoy.length} mudanza{mudanzasHoy.length > 1 ? 's' : ''} programada{mudanzasHoy.length > 1 ? 's' : ''} para hoy
          </span>
        </div>
      )}
      {depositosPendientes.length > 0 && (
        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '10px', padding: '10px 16px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>💰</span>
          <span style={{ fontSize: '13px', color: '#92400e', fontWeight: 600 }}>
            {depositosPendientes.length} depósito{depositosPendientes.length > 1 ? 's' : ''} pendiente{depositosPendientes.length > 1 ? 's' : ''} de cobro
          </span>
        </div>
      )}

      {/* Terms configuration section */}
      <div style={{ marginBottom: '20px', border: '1.5px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
        <button
          onClick={() => setTerminosOpen(o => !o)}
          style={{
            width: '100%', padding: '12px 16px', background: '#f8fafc',
            border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '15px' }}>📋</span>
            <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#0f172a' }}>Términos de mudanza</span>
            {terminosMudanza && !terminosOpen && (
              <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 400, maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                — {terminosMudanza.slice(0, 80)}{terminosMudanza.length > 80 ? '…' : ''}
              </span>
            )}
          </div>
          <span style={{ color: '#94a3b8', fontSize: '14px' }}>{terminosOpen ? '▲' : '▼'}</span>
        </button>

        {terminosOpen && (
          <div style={{ padding: '16px', borderTop: '1px solid #e2e8f0' }}>
            <p style={{ margin: '0 0 10px', fontSize: '12.5px', color: '#64748b' }}>
              Este texto se mostrará al cliente cuando solicite una mudanza. Si está configurado, el cliente deberá aceptarlo para poder enviar la solicitud.
            </p>
            <textarea
              value={terminosText}
              onChange={e => setTerminosText(e.target.value)}
              placeholder="Escribe aquí los términos y condiciones para autorización de mudanzas…"
              style={{
                width: '100%', minHeight: '120px', padding: '10px 12px',
                fontSize: '13px', borderRadius: '8px', border: '1.5px solid #e2e8f0',
                resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit',
                lineHeight: 1.6, color: '#334155',
              }}
            />
            <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={guardarTerminos}
                disabled={savingTerminos}
                style={{
                  padding: '8px 20px', background: '#4f46e5', color: 'white',
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
          { label: 'Pendientes', count: pendientes, color: '#f59e0b', bg: '#fef3c7' },
          { label: 'Aprobadas',  count: aprobadas,  color: '#16a34a', bg: '#dcfce7' },
          { label: 'Rechazadas', count: rechazadas, color: '#dc2626', bg: '#fef2f2' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, border: `1px solid ${k.color}30`, borderRadius: '10px', padding: '12px 20px', minWidth: '110px' }}>
            <div style={{ fontSize: '22px', fontWeight: 700, color: k.color }}>{k.count}</div>
            <div style={{ fontSize: '12px', color: k.color, fontWeight: 600 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button style={chipStyle(filtroEstado === 'all', '#64748b')} onClick={() => setFiltroEstado('all')}>Todas</button>
        <button style={chipStyle(filtroEstado === 'pendiente', '#f59e0b')} onClick={() => setFiltroEstado('pendiente')}>⏳ Pendientes</button>
        <button style={chipStyle(filtroEstado === 'aprobada', '#16a34a')} onClick={() => setFiltroEstado('aprobada')}>✅ Aprobadas</button>
        <button style={chipStyle(filtroEstado === 'operativas', '#0ea5e9')} onClick={() => setFiltroEstado('operativas')}>🚚 En ejecución</button>
        <button style={chipStyle(filtroEstado === 'completada', '#10b981')} onClick={() => setFiltroEstado('completada')}>🏁 Completadas</button>
        <button style={chipStyle(filtroEstado === 'rechazada', '#dc2626')} onClick={() => setFiltroEstado('rechazada')}>❌ Rechazadas</button>
        <button style={chipStyle(filtroEstado === 'cancelada', '#64748b')} onClick={() => setFiltroEstado('cancelada')}>🚫 Canceladas</button>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
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
            border: `1.5px solid ${expanded ? '#c7d2fe' : '#e2e8f0'}`,
            borderRadius: '12px', marginBottom: '10px',
            background: expanded ? '#fafafe' : 'white', transition: 'all 0.15s',
          }}>
            {/* Card header */}
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', cursor: 'pointer', flexWrap: 'wrap' }}
              onClick={() => onExpand(s.id)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>
                  {tipo.icon} {unidadNombre(s)}
                </div>
                <div style={{ fontSize: '12.5px', color: '#64748b', marginTop: '2px' }}>
                  {tipo.label} · {fecha}
                  {s.fecha_solicitada && <span>{'  ·  '}Propuesto: {s.fecha_solicitada}{s.hora_solicitada ? ` ${s.hora_solicitada}` : ''}</span>}
                </div>
                {esOperativa && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                    {s.ascensor_reservado && <span style={{ fontSize: '10px', fontWeight: 600, background: '#e0f2fe', color: '#0369a1', padding: '1px 6px', borderRadius: '4px' }}>🛗 Ascensor</span>}
                    {s.deposito_requerido && (
                      <span style={{ fontSize: '10px', fontWeight: 600, background: s.deposito_pagado ? '#d1fae5' : '#fef3c7', color: s.deposito_pagado ? '#059669' : '#92400e', padding: '1px 6px', borderRadius: '4px' }}>
                        💰 {s.deposito_pagado ? 'Depósito pagado' : 'Depósito pendiente'}{s.monto_deposito ? ` (${moneda} ${s.monto_deposito})` : ''}
                      </span>
                    )}
                    {s.empresa_mudanza && <span style={{ fontSize: '10px', fontWeight: 600, background: '#f1f5f9', color: '#475569', padding: '1px 6px', borderRadius: '4px' }}>🏢 {s.empresa_mudanza}</span>}
                  </div>
                )}
              </div>
              <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 600, background: est.bg, color: est.color, whiteSpace: 'nowrap' }}>
                {est.icon} {est.label}
              </span>
              <span style={{ color: '#94a3b8', fontSize: '16px' }}>{expanded ? '▲' : '▼'}</span>
            </div>

            {/* Expanded */}
            {expanded && (
              <div style={{ padding: '0 16px 16px', borderTop: '1px solid #e2e8f0' }}>
                {s.descripcion && (
                  <div style={{ marginTop: '12px', background: '#f8fafc', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: '#334155' }}>
                    <strong>Descripción:</strong> {s.descripcion}
                  </div>
                )}

                {/* Attached images */}
                {s.imagenes && s.imagenes.length > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '8px' }}>
                      🖼️ Imágenes adjuntas:
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {s.imagenes.map((url, idx) => (
                        <a
                          key={idx}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Ver imagen completa"
                          style={{ display: 'block', flexShrink: 0 }}
                        >
                          <img
                            src={url}
                            alt={`Imagen ${idx + 1}`}
                            style={{
                              width: '72px', height: '72px', objectFit: 'cover',
                              borderRadius: '8px', border: '1.5px solid #e2e8f0',
                              cursor: 'pointer', transition: 'opacity 0.15s',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
                            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                          />
                        </a>
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
                  <div style={{ marginTop: '8px', fontSize: '12.5px', color: '#16a34a', fontWeight: 600 }}>
                    ✅ Fecha autorizada: {s.fecha_autorizada}{s.hora_autorizada ? ` a las ${s.hora_autorizada}` : ''}
                  </div>
                )}

                {/* Actions for pending */}
                {s.estado === 'pendiente' && canEdit && (
                  <div style={{ marginTop: '14px', display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>Fecha autorizada</label>
                      <input
                        type="date" value={fechaAut} onChange={e => setFechaAut(e.target.value)}
                        onClick={e => e.stopPropagation()} style={fieldStyle}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>Hora</label>
                      <input
                        type="time" value={horaAut} onChange={e => setHoraAut(e.target.value)}
                        onClick={e => e.stopPropagation()} style={fieldStyle}
                      />
                    </div>
                    <button
                      disabled={saving}
                      onClick={e => { e.stopPropagation(); resolver(s, 'aprobada') }}
                      style={{ padding: '8px 18px', background: '#16a34a', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '13px', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
                    >✅ Aprobar</button>
                    <button
                      disabled={saving}
                      onClick={e => { e.stopPropagation(); resolver(s, 'rechazada') }}
                      style={{ padding: '8px 18px', background: '#dc2626', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '13px', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
                    >❌ Rechazar</button>
                  </div>
                )}

                {/* Operational controls for aprobada/programada/en_curso/completada */}
                {esOperativa && canEdit && (
                  <div style={{ marginTop: '14px', padding: '12px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '10px' }}>🚚 Control operativo</div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
                      <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#475569' }}>Estado:</label>
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
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: '#374151', cursor: 'pointer' }}>
                        <input
                          type="checkbox" checked={s.ascensor_reservado ?? false}
                          onChange={e => { e.stopPropagation(); toggleCampo(s.id, 'ascensor_reservado', e.target.checked) }}
                          onClick={e => e.stopPropagation()}
                        />
                        🛗 Ascensor reservado
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: '#374151', cursor: 'pointer' }}>
                        <input
                          type="checkbox" checked={s.deposito_requerido ?? false}
                          onChange={e => { e.stopPropagation(); toggleCampo(s.id, 'deposito_requerido', e.target.checked) }}
                          onClick={e => e.stopPropagation()}
                        />
                        💰 Depósito requerido
                      </label>
                      {s.deposito_requerido && (
                        <>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: '#374151', cursor: 'pointer' }}>
                            <input
                              type="checkbox" checked={s.deposito_pagado ?? false}
                              onChange={e => { e.stopPropagation(); toggleCampo(s.id, 'deposito_pagado', e.target.checked) }}
                              onClick={e => e.stopPropagation()}
                            />
                            Pagado
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '12px', color: '#475569' }}>{moneda}</span>
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
                          style={{ padding: '6px 14px', background: '#dcfce7', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', color: '#16a34a' }}
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
