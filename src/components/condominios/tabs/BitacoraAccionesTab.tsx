import { useState } from 'react'
import { notify } from '../../shared/Dialog'
import { BitacoraAccion, AccionBitacora } from '../../../types'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

interface Props {
  bitacora: BitacoraAccion[]
}

const ACCION_CFG: Record<AccionBitacora, { label: string; bg: string; color: string; icon: string }> = {
  crear:    { label: 'Crear',    bg: 'var(--at-success-tint)', color: 'var(--at-success)', icon: '➕' },
  editar:   { label: 'Editar',   bg: 'var(--at-primary-tint)', color: 'var(--at-primary)', icon: '✏️' },
  eliminar: { label: 'Eliminar', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', icon: '🗑' },
  aprobar:  { label: 'Aprobar',  bg: 'var(--at-success-tint)', color: 'var(--at-success)', icon: '✅' },
  rechazar: { label: 'Rechazar', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', icon: '❌' },
  pagar:    { label: 'Pagar',    bg: 'var(--at-success-tint)', color: 'var(--at-accent-2)', icon: '💳' },
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
              style={{ padding: '8px 14px', borderRadius: 10, border: `1.5px solid ${filtroAccion === accion ? cfg.color : 'var(--at-line)'}`, background: filtroAccion === accion ? cfg.bg : 'var(--at-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
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

      {/* Tabla — F3.9: migrado a <DataTable> shared */}
      <DataTable<BitacoraAccion>
        data={lista}
        rowKey="id"
        pageSize={50}
        defaultSort={{ key: 'created_at', direction: 'desc' }}
        emptyState={{ icon: '📋', title: 'Sin registros de auditoría' }}
        columns={[
          {
            key: 'created_at',
            header: 'Fecha/Hora',
            sortable: true,
            render: (b) => (
              <span style={{ color: 'var(--at-ink-3)', whiteSpace: 'nowrap' }}>
                {new Date(b.created_at).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            ),
          },
          {
            key: 'usuario_nombre',
            header: 'Usuario',
            sortable: true,
            render: (b) => <span style={{ fontWeight: 600 }}>{b.usuario_nombre}</span>,
          },
          {
            key: 'accion',
            header: 'Acción',
            sortable: true,
            render: (b) => {
              const cfg = ACCION_CFG[b.accion as AccionBitacora] ?? { label: b.accion, bg: 'var(--at-chip)', color: 'var(--at-ink-2)', icon: '•' }
              return (
                <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: cfg.bg, color: cfg.color }}>
                  {cfg.icon} {cfg.label}
                </span>
              )
            },
          },
          {
            key: 'modulo',
            header: 'Módulo',
            sortable: true,
            render: (b) => (
              <span style={{ padding: '2px 7px', borderRadius: 6, background: 'var(--at-chip)', fontSize: 11, color: 'var(--at-ink-2)' }}>{b.modulo}</span>
            ),
          },
          {
            key: 'entidad_desc',
            header: 'Registro',
            hideOnMobile: true,
            accessor: (b) => b.entidad_desc ?? b.entidad_id ?? '',
            render: (b) => (
              <span style={{ color: 'var(--at-ink-2)', display: 'inline-block', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {b.entidad_desc ?? b.entidad_id?.slice(0, 8) ?? '—'}
              </span>
            ),
          },
          {
            key: 'detalles',
            header: '',
            align: 'center',
            render: (b) => b.detalles ? (
              <button onClick={(e) => {
                e.stopPropagation()
                const pre = JSON.stringify(b.detalles, null, 2)
                notify({ variant: 'info', title: 'Detalles', text: pre, duration: 8000 })
              }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-ink-3)', fontSize: 13 }} aria-label="Ver detalles">🔍</button>
            ) : null,
          },
        ] satisfies DataTableColumn<BitacoraAccion>[]}
      />
    </div>
  )
}
