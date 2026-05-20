import { useState } from 'react'
import { NotificacionEnviada, CanalNotificacion, EstadoNotificacion, Unidad } from '../../../types'

interface Props {
  notificaciones: NotificacionEnviada[]
  unidades: Unidad[]
}

const CANAL_CFG: Record<CanalNotificacion, { label: string; icon: string; bg: string; color: string }> = {
  whatsapp: { label: 'WhatsApp', icon: '💬', bg: '#dcfce7', color: '#16a34a' },
  email:    { label: 'Email',    icon: '✉️',  bg: '#EEF2EC', color: '#1B3B36' },
  sms:      { label: 'SMS',      icon: '📱', bg: '#FAF1EA', color: '#9C5733' },
  push:     { label: 'Push',     icon: '🔔', bg: '#fef3c7', color: '#d97706' },
}

const ESTADO_CFG: Record<EstadoNotificacion, { label: string; bg: string; color: string }> = {
  enviado:   { label: 'Enviado',   bg: '#dcfce7', color: '#16a34a' },
  fallido:   { label: 'Fallido',   bg: '#fee2e2', color: '#ef4444' },
  pendiente: { label: 'Pendiente', bg: '#fef3c7', color: '#d97706' },
  leido:     { label: 'Leído',     bg: '#D9E2DC', color: '#102622' },
}

export default function NotificacionesEnviadasTab({ notificaciones, unidades }: Props) {
  const [filtroCanal, setFiltroCanal] = useState<CanalNotificacion | ''>('')
  const [filtroEstado, setFiltroEstado] = useState<EstadoNotificacion | ''>('')
  const [filtroUnidad, setFiltroUnidad] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const lista = notificaciones.filter(n =>
    (!filtroCanal || n.canal === filtroCanal) &&
    (!filtroEstado || n.estado === filtroEstado) &&
    (!filtroUnidad || n.unidad_id === filtroUnidad) &&
    (!busqueda ||
      n.destinatario.toLowerCase().includes(busqueda.toLowerCase()) ||
      n.contenido.toLowerCase().includes(busqueda.toLowerCase()) ||
      (n.asunto ?? '').toLowerCase().includes(busqueda.toLowerCase()))
  )

  const resumen = (Object.keys(CANAL_CFG) as CanalNotificacion[]).map(c => ({
    canal: c, count: notificaciones.filter(n => n.canal === c).length,
    fallidos: notificaciones.filter(n => n.canal === c && n.estado === 'fallido').length,
  })).filter(x => x.count > 0)

  return (
    <div style={{ padding: 16 }}>
      {/* Resumen por canal */}
      {resumen.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          {resumen.map(({ canal, count, fallidos }) => {
            const cfg = CANAL_CFG[canal]
            return (
              <button key={canal} onClick={() => setFiltroCanal(filtroCanal === canal ? '' : canal)}
                style={{ padding: '10px 16px', borderRadius: 10, border: `1.5px solid ${filtroCanal === canal ? cfg.color : '#E1DDD0'}`, background: filtroCanal === canal ? cfg.bg : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>{cfg.icon}</span>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: cfg.color }}>{count}</div>
                  <div style={{ fontSize: 10, color: '#7E9389' }}>{cfg.label}{fallidos > 0 ? ` · ${fallidos} fallidos` : ''}</div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por destinatario, asunto…"
          style={{ flex: 1, minWidth: 180, padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13 }} />
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as EstadoNotificacion | '')}
          style={{ padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13 }}>
          <option value="">Todos los estados</option>
          {(Object.keys(ESTADO_CFG) as EstadoNotificacion[]).map(e => <option key={e} value={e}>{ESTADO_CFG[e].label}</option>)}
        </select>
        <select value={filtroUnidad} onChange={e => setFiltroUnidad(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13 }}>
          <option value="">Todas las unidades</option>
          {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
        <span style={{ fontSize: 12, color: '#7E9389', alignSelf: 'center' }}>{lista.length} registros</span>
      </div>

      {/* Lista */}
      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#7E9389', padding: '40px 0', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📨</div>
          Sin notificaciones registradas
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {lista.map(n => {
            const ccfg = CANAL_CFG[n.canal]
            const ecfg = ESTADO_CFG[n.estado]
            const isOpen = expanded === n.id
            return (
              <div key={n.id} style={{ background: '#fff', border: `1px solid ${n.estado === 'fallido' ? '#fecaca' : '#E1DDD0'}`, borderRadius: 10, overflow: 'hidden' }}>
                <div onClick={() => setExpanded(isOpen ? null : n.id)}
                  style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{ccfg.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 13, color: '#15291F' }}>{n.destinatario}</span>
                      {n.asunto && <span style={{ fontSize: 12, color: '#7E9389' }}>· {n.asunto}</span>}
                      <span style={{ padding: '1px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: ecfg.bg, color: ecfg.color }}>{ecfg.label}</span>
                      <span style={{ padding: '1px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: ccfg.bg, color: ccfg.color }}>{ccfg.label}</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#7E9389', marginTop: 2 }}>
                      {new Date(n.fecha_envio).toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {n.enviado_por && ` · por ${n.enviado_por}`}
                    </div>
                  </div>
                  <span style={{ color: '#7E9389', fontSize: 12 }}>{isOpen ? '▲' : '▼'}</span>
                </div>
                {isOpen && (
                  <div style={{ padding: '10px 14px', borderTop: '1px solid var(--at-chip)', background: '#FAF7EF' }}>
                    <div style={{ fontSize: 13, color: '#3E5A4C', whiteSpace: 'pre-wrap', lineHeight: 1.5, maxHeight: 200, overflowY: 'auto' }}>{n.contenido}</div>
                    {n.error_detalle && (
                      <div style={{ marginTop: 8, padding: '8px 12px', background: '#fee2e2', borderRadius: 8, fontSize: 12, color: '#ef4444' }}>
                        Error: {n.error_detalle}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
