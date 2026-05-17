import { useState } from 'react'
import { BitacoraAccion, AccionBitacora } from '../../../types'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

interface Props {
  bitacora: BitacoraAccion[]
}

const ACCION_CFG: Record<AccionBitacora, { label: string; bg: string; color: string; icon: string }> = {
  crear:    { label: 'Crear',    bg: '#f0fdf4', color: '#16a34a', icon: '➕' },
  editar:   { label: 'Editar',   bg: '#eff6ff', color: '#2563eb', icon: '✏️' },
  eliminar: { label: 'Eliminar', bg: '#fef2f2', color: '#ef4444', icon: '🗑' },
  aprobar:  { label: 'Aprobar',  bg: '#f0fdf4', color: '#16a34a', icon: '✅' },
  rechazar: { label: 'Rechazar', bg: '#fef2f2', color: '#ef4444', icon: '❌' },
  pagar:    { label: 'Pagar',    bg: '#f0fdf4', color: '#0d9488', icon: '💳' },
  cerrar:   { label: 'Cerrar',   bg: '#f3f4f6', color: '#374151', icon: '🔒' },
}

export default function BitacoraAccionesTab({ bitacora }: Props) {
  const [filtroAccion, setFiltroAccion] = useState<AccionBitacora | ''>('')
  const [filtroModulo, setFiltroModulo] = useState('')

  const modulos = [...new Set(bitacora.map(b => b.modulo))].sort()

  // filtroAccion (vía KPI-buttons) y filtroModulo se aplican antes de pasar
  // a DataTable; búsqueda y sort los maneja DataTable internamente.
  const dataFiltrada = bitacora.filter(b =>
    (!filtroAccion || b.accion === filtroAccion) &&
    (!filtroModulo || b.modulo === filtroModulo)
  )

  const resumenAcciones = (Object.keys(ACCION_CFG) as AccionBitacora[]).map(a => ({
    accion: a,
    count: bitacora.filter(b => b.accion === a).length,
    cfg: ACCION_CFG[a],
  })).filter(x => x.count > 0)

  const columns: DataTableColumn<BitacoraAccion>[] = [
    {
      key: 'created_at',
      header: 'Fecha/Hora',
      sortable: true,
      accessor: row => row.created_at,
      render: row => (
        <span style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>
          {new Date(row.created_at).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      ),
    },
    {
      key: 'usuario_nombre',
      header: 'Usuario',
      sortable: true,
      render: row => <span style={{ fontWeight: 600 }}>{row.usuario_nombre}</span>,
    },
    {
      key: 'accion',
      header: 'Acción',
      sortable: true,
      render: row => {
        const cfg = ACCION_CFG[row.accion as AccionBitacora] ?? { label: row.accion, bg: '#f3f4f6', color: '#374151', icon: '•' }
        return (
          <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap' }}>
            {cfg.icon} {cfg.label}
          </span>
        )
      },
    },
    {
      key: 'modulo',
      header: 'Módulo',
      sortable: true,
      render: row => <span style={{ padding: '2px 7px', borderRadius: 6, background: '#f3f4f6', fontSize: 11 }}>{row.modulo}</span>,
    },
    {
      key: 'entidad_desc',
      header: 'Registro',
      accessor: row => row.entidad_desc ?? row.entidad_id ?? '',
      render: row => (
        <span style={{ color: '#374151', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
          {row.entidad_desc ?? row.entidad_id?.slice(0, 8) ?? '—'}
        </span>
      ),
    },
    {
      key: 'detalles',
      header: '',
      width: 50,
      render: row => row.detalles ? (
        <button onClick={() => {
          const pre = JSON.stringify(row.detalles, null, 2)
          import('sweetalert2').then(({ default: Swal }) => Swal.fire({ title: 'Detalles', html: `<pre style="text-align:left;font-size:11px;max-height:300px;overflow:auto">${pre}</pre>`, width: 500 }))
        }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 13 }}>🔍</button>
      ) : null,
    },
  ]

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs por acción (también funcionan como filtros toggle) */}
      {resumenAcciones.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {resumenAcciones.map(({ accion, count, cfg }) => (
            <button key={accion} onClick={() => setFiltroAccion(filtroAccion === accion ? '' : accion)}
              style={{ padding: '8px 14px', borderRadius: 10, border: `1.5px solid ${filtroAccion === accion ? cfg.color : '#e5e7eb'}`, background: filtroAccion === accion ? cfg.bg : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>{cfg.icon}</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: cfg.color, lineHeight: 1 }}>{count}</div>
                <div style={{ fontSize: 10, color: '#6b7280' }}>{cfg.label}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <DataTable
        data={dataFiltrada}
        columns={columns}
        rowKey="id"
        searchableKeys={['usuario_nombre', row => row.entidad_desc ?? '']}
        searchPlaceholder="Buscar por usuario o registro…"
        filters={[
          {
            key: 'modulo',
            value: filtroModulo,
            onChange: setFiltroModulo,
            options: [{ value: '', label: 'Todos los módulos' }, ...modulos.map(m => ({ value: m, label: m }))],
          },
        ]}
        pageSizeOptions={[25, 50, 100, 200]}
        defaultSort={{ key: 'created_at', direction: 'desc' }}
        emptyState={{ icon: '📋', title: 'Sin registros de auditoría' }}
      />
    </div>
  )
}
