import { useState } from 'react'
import { BitacoraAccion, AccionBitacora } from '../../../types'

interface Props {
  bitacora: BitacoraAccion[]
}

const ACCION_CFG: Record<AccionBitacora, { label: string; bg: string; color: string; icon: string }> = {
  crear:    { label: 'Crear',    bg: '#f0fdf4', color: '#16a34a', icon: '➕' },
  editar:   { label: 'Editar',   bg: 'var(--at-primary-tint)', color: 'var(--at-primary)', icon: '✏️' },
  eliminar: { label: 'Eliminar', bg: '#fef2f2', color: '#ef4444', icon: '🗑' },
  aprobar:  { label: 'Aprobar',  bg: '#f0fdf4', color: '#16a34a', icon: '✅' },
  rechazar: { label: 'Rechazar', bg: '#fef2f2', color: '#ef4444', icon: '❌' },
  pagar:    { label: 'Pagar',    bg: '#f0fdf4', color: 'var(--at-accent-2)', icon: '💳' },
  cerrar:   { label: 'Cerrar',   bg: 'var(--at-chip)', color: 'var(--at-ink-2)', icon: '🔒' },
}

export default function BitacoraAccionesTab({ bitacora }: Props) {
  const [filtroAccion, setFiltroAccion] = useState<AccionBitacora | ''>('')
  const [filtroModulo, setFiltroModulo] = useState('')
  const [busqueda, setBusqueda] = useState('')

  const modulos = [...new Set(bitacora.map(b => b.modulo))].sort()

  const lista = bitacora.filter(b =>
    (!filtroAccion || b.accion === filtroAccion) &&
    (!filtroModulo || b.modulo === filtroModulo) &&
    (!busqueda ||
      b.usuario_nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      (b.entidad_desc ?? '').toLowerCase().includes(busqueda.toLowerCase()))
  )

  const resumenAcciones = (Object.keys(ACCION_CFG) as AccionBitacora[]).map(a => ({
    accion: a,
    count: bitacora.filter(b => b.accion === a).length,
    cfg: ACCION_CFG[a],
  })).filter(x => x.count > 0)

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs por acción */}
      {resumenAcciones.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {resumenAcciones.map(({ accion, count, cfg }) => (
            <button key={accion} onClick={() => setFiltroAccion(filtroAccion === accion ? '' : accion)}
              style={{ padding: '8px 14px', borderRadius: 10, border: `1.5px solid ${filtroAccion === accion ? cfg.color : 'var(--at-line)'}`, background: filtroAccion === accion ? cfg.bg : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>{cfg.icon}</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: cfg.color, lineHeight: 1 }}>{count}</div>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{cfg.label}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por usuario o registro…"
          style={{ flex: 1, minWidth: 180, padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13 }} />
        <select value={filtroModulo} onChange={e => setFiltroModulo(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13 }}>
          <option value="">Todos los módulos</option>
          {modulos.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--at-ink-3)', alignSelf: 'center' }}>{lista.length} registros</span>
      </div>

      {/* Tabla */}
      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          Sin registros de auditoría
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: 'var(--at-surface-2)' }}>
                {['Fecha/Hora', 'Usuario', 'Acción', 'Módulo', 'Registro', ''].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--at-ink-3)', fontWeight: 600, fontSize: 11, borderBottom: '1px solid var(--at-line)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lista.map(b => {
                const accionKey = b.accion as AccionBitacora
                const cfg = ACCION_CFG[accionKey] ?? { label: b.accion, bg: 'var(--at-chip)', color: 'var(--at-ink-2)', icon: '•' }
                return (
                  <tr key={b.id} style={{ borderBottom: '1px solid var(--at-chip)' }}>
                    <td style={{ padding: '8px 12px', color: 'var(--at-ink-3)', whiteSpace: 'nowrap' }}>
                      {new Date(b.created_at).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{b.usuario_nombre}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: cfg.bg, color: cfg.color }}>
                        {cfg.icon} {cfg.label}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--at-ink-2)' }}>
                      <span style={{ padding: '2px 7px', borderRadius: 6, background: 'var(--at-chip)', fontSize: 11 }}>{b.modulo}</span>
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--at-ink-2)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.entidad_desc ?? b.entidad_id?.slice(0, 8) ?? '—'}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      {b.detalles && (
                        <button onClick={() => {
                          const pre = JSON.stringify(b.detalles, null, 2)
                          import('sweetalert2').then(({ default: Swal }) => Swal.fire({ title: 'Detalles', html: `<pre style="text-align:left;font-size:11px;max-height:300px;overflow:auto">${pre}</pre>`, width: 500 }))
                        }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-ink-3)', fontSize: 13 }}>🔍</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
