import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { SolicitudRentaUnidad, TipoRenta, EstadoSolicitudRenta, Unidad } from '../../../types'

interface Props {
  solicitudes: SolicitudRentaUnidad[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  autorNombre: string
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_LABEL: Record<TipoRenta, string> = {
  arrendamiento: 'Arrendamiento',
  str:           'STR / Corto Plazo',
  ambas:         'Arrendamiento + STR',
}

const ESTADO_CFG: Record<EstadoSolicitudRenta, { label: string; color: string; bg: string; icon: string }> = {
  pendiente: { label: 'Pendiente', color: '#d97706', bg: '#fef3c7', icon: '⏳' },
  aprobada:  { label: 'Aprobada',  color: '#16a34a', bg: '#dcfce7', icon: '✅' },
  rechazada: { label: 'Rechazada', color: '#dc2626', bg: '#fef2f2', icon: '❌' },
}

export function SolicitudesRentaTab({ solicitudes, unidades, autorNombre, canEdit, onRefresh }: Props) {
  const [filtroEstado, setFiltroEstado] = useState<EstadoSolicitudRenta | 'all'>('pendiente')
  const [expandedId, setExpandedId]     = useState<string | null>(null)
  const [tipoAprobado, setTipoAprobado] = useState<TipoRenta>('arrendamiento')
  const [saving, setSaving]             = useState(false)

  const filtered = solicitudes.filter(s =>
    filtroEstado === 'all' || s.estado === filtroEstado
  )

  const pendientes = solicitudes.filter(s => s.estado === 'pendiente').length
  const aprobadas  = solicitudes.filter(s => s.estado === 'aprobada').length
  const rechazadas = solicitudes.filter(s => s.estado === 'rechazada').length

  function unidadNombre(s: SolicitudRentaUnidad) {
    return s.unidad_nombre || unidades.find(u => u.id === s.unidad_id)?.nombre || s.unidad_id.slice(0, 8)
  }

  async function resolver(s: SolicitudRentaUnidad, nuevoEstado: 'aprobada' | 'rechazada') {
    if (!canEdit) return
    const { value: comentario } = await Swal.fire({
      title: nuevoEstado === 'aprobada' ? '¿Aprobar solicitud?' : '¿Rechazar solicitud?',
      input: 'textarea',
      inputLabel: nuevoEstado === 'aprobada' ? 'Comentario (opcional)' : 'Motivo del rechazo (recomendado)',
      inputPlaceholder: 'Escriba un comentario…',
      showCancelButton: true,
      confirmButtonColor: nuevoEstado === 'aprobada' ? '#16a34a' : '#dc2626',
      confirmButtonText: nuevoEstado === 'aprobada' ? 'Aprobar' : 'Rechazar',
      cancelButtonText: 'Cancelar',
    })
    if (comentario === undefined) return

    setSaving(true)
    const payload: Partial<SolicitudRentaUnidad> & { estado: string } = {
      estado: nuevoEstado,
      comentario_admin: comentario || null,
      aprobado_por: autorNombre || null,
      fecha_resolucion: new Date().toISOString(),
    }
    if (nuevoEstado === 'aprobada') {
      payload.tipo_aprobado = tipoAprobado
    }
    const { error } = await supabase
      .from('solicitud_renta_unidad')
      .update(payload)
      .eq('id', s.id)
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({
      icon: 'success',
      title: nuevoEstado === 'aprobada' ? 'Solicitud aprobada' : 'Solicitud rechazada',
      timer: 1400, showConfirmButton: false,
    })
    setExpandedId(null)
    onRefresh()
  }

  const chipStyle = (active: boolean, color: string): React.CSSProperties => ({
    padding: '5px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 600,
    cursor: 'pointer', border: 'none',
    background: active ? color : 'var(--at-chip)',
    color: active ? 'white' : 'var(--at-ink-3)',
  })

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>
          🔑 Autorizaciones de Renta
        </h3>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-3)' }}>
          Gestiona las solicitudes de los propietarios para operar sus unidades bajo modelos de renta.
        </p>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {[
          { label: 'Pendientes', count: pendientes, color: '#f59e0b', bg: '#fef3c7' },
          { label: 'Aprobadas',  count: aprobadas,  color: '#16a34a', bg: '#dcfce7' },
          { label: 'Rechazadas', count: rechazadas, color: '#dc2626', bg: '#fef2f2' },
        ].map(k => (
          <div key={k.label} style={{
            background: k.bg, border: `1px solid ${k.color}30`,
            borderRadius: '10px', padding: '12px 20px', minWidth: '110px',
          }}>
            <div style={{ fontSize: '22px', fontWeight: 700, color: k.color }}>{k.count}</div>
            <div style={{ fontSize: '12px', color: k.color, fontWeight: 600 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button style={chipStyle(filtroEstado === 'all', 'var(--at-ink-3)')} onClick={() => setFiltroEstado('all')}>Todas</button>
        <button style={chipStyle(filtroEstado === 'pendiente', '#f59e0b')} onClick={() => setFiltroEstado('pendiente')}>⏳ Pendientes</button>
        <button style={chipStyle(filtroEstado === 'aprobada', '#16a34a')} onClick={() => setFiltroEstado('aprobada')}>✅ Aprobadas</button>
        <button style={chipStyle(filtroEstado === 'rechazada', '#dc2626')} onClick={() => setFiltroEstado('rechazada')}>❌ Rechazadas</button>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>🔑</div>
          <div style={{ fontSize: '14px' }}>No hay solicitudes{filtroEstado !== 'all' ? ` ${filtroEstado}s` : ''}</div>
        </div>
      ) : filtered.map(s => {
        const cfg       = ESTADO_CFG[s.estado]
        const expanded  = expandedId === s.id
        const fecha     = s.created_at ? new Date(s.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

        return (
          <div key={s.id} style={{
            border: `1.5px solid ${expanded ? 'var(--at-accent-soft)' : 'var(--at-line)'}`,
            borderRadius: '12px', marginBottom: '10px',
            background: expanded ? '#fafafe' : 'white',
            transition: 'all 0.15s',
          }}>
            {/* Card header */}
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', cursor: 'pointer', flexWrap: 'wrap' }}
              onClick={() => setExpandedId(expanded ? null : s.id)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>
                  🏠 {unidadNombre(s)}
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                  {TIPO_LABEL[s.tipo_renta]} · {fecha}
                </div>
              </div>
              <span style={{
                padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 600,
                background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap',
              }}>
                {cfg.icon} {cfg.label}
              </span>
              <span style={{ color: 'var(--at-ink-3)', fontSize: '16px' }}>{expanded ? '▲' : '▼'}</span>
            </div>

            {/* Expanded detail */}
            {expanded && (
              <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--at-line)' }}>
                {s.motivo && (
                  <div style={{ marginTop: '12px', background: 'var(--at-surface-2)', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: 'var(--at-ink-2)' }}>
                    <strong>Motivo del cliente:</strong><br />{s.motivo}
                  </div>
                )}

                {s.comentario_admin && (
                  <div style={{ marginTop: '10px', background: cfg.bg, borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: cfg.color }}>
                    <strong>Resolución:</strong> {s.comentario_admin}
                    {s.aprobado_por && <span style={{ marginLeft: '8px', opacity: 0.8 }}>— {s.aprobado_por}</span>}
                  </div>
                )}

                {s.tipo_aprobado && s.estado === 'aprobada' && (
                  <div style={{ marginTop: '8px', fontSize: '12.5px', color: '#16a34a', fontWeight: 600 }}>
                    ✅ Autorizado para: {TIPO_LABEL[s.tipo_aprobado]}
                  </div>
                )}

                {/* Actions for pending */}
                {s.estado === 'pendiente' && canEdit && (
                  <div style={{ marginTop: '14px', display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>
                        Autorizar para:
                      </label>
                      <select
                        value={tipoAprobado}
                        onChange={e => setTipoAprobado(e.target.value as TipoRenta)}
                        onClick={e => e.stopPropagation()}
                        style={{
                          padding: '7px 12px', fontSize: '13px', borderRadius: '8px',
                          border: '1.5px solid var(--at-line)', background: 'var(--at-surface)', cursor: 'pointer',
                        }}
                      >
                        <option value="arrendamiento">Arrendamiento</option>
                        <option value="str">STR / Corto Plazo</option>
                        <option value="ambas">Arrendamiento + STR</option>
                      </select>
                    </div>
                    <button
                      disabled={saving}
                      onClick={e => { e.stopPropagation(); resolver(s, 'aprobada') }}
                      style={{
                        padding: '8px 18px', background: '#16a34a', color: 'white',
                        border: 'none', borderRadius: '8px', fontWeight: 600,
                        fontSize: '13px', cursor: saving ? 'not-allowed' : 'pointer',
                        opacity: saving ? 0.7 : 1,
                      }}
                    >✅ Aprobar</button>
                    <button
                      disabled={saving}
                      onClick={e => { e.stopPropagation(); resolver(s, 'rechazada') }}
                      style={{
                        padding: '8px 18px', background: '#dc2626', color: 'white',
                        border: 'none', borderRadius: '8px', fontWeight: 600,
                        fontSize: '13px', cursor: saving ? 'not-allowed' : 'pointer',
                        opacity: saving ? 0.7 : 1,
                      }}
                    >❌ Rechazar</button>
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
