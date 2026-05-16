import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { toast } from '../../../lib/toast'
import { HistorialSaldoUnidad, Unidad, CuotaCondominio } from '../../../types'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

interface Props {
  historial: HistorialSaldoUnidad[]
  cuotas: CuotaCondominio[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  onRefresh: () => void
}

export default function HistorialSaldosTab({ historial, cuotas, unidades, proyectoId, companyId, moneda, canCreate, onRefresh }: Props) {
  const [filtroUnidad, setFiltroUnidad] = useState('')
  const [filtroPeriodo, setFiltroPeriodo] = useState('')
  const [saving, setSaving] = useState(false)

  const periodos = [...new Set(historial.map(h => h.periodo))].sort().reverse()

  const dataFiltrada = historial.filter(h =>
    (!filtroUnidad || h.unidad_id === filtroUnidad) &&
    (!filtroPeriodo || h.periodo === filtroPeriodo)
  )

  const totalDeuda = historial
    .filter(h => !filtroPeriodo || h.periodo === filtroPeriodo)
    .reduce((s, h) => s + h.saldo_final, 0)

  const totalPagos = historial
    .filter(h => !filtroPeriodo || h.periodo === filtroPeriodo)
    .reduce((s, h) => s + h.pagos_periodo, 0)

  async function generarSnapshot() {
    const { value: periodo } = await Swal.fire({
      title: 'Generar snapshot de saldos',
      html: `<p style="font-size:13px;color:#374151;margin-bottom:8px">Período (YYYY-MM):</p>
             <input id="periodo-snap" class="swal2-input" type="month" value="${new Date().toISOString().slice(0,7)}" style="font-size:14px">`,
      showCancelButton: true, confirmButtonText: 'Generar', cancelButtonText: 'Cancelar',
      preConfirm: () => (document.getElementById('periodo-snap') as HTMLInputElement)?.value,
    })
    if (!periodo) return

    setSaving(true)
    const rows = unidades.filter(u => u.activo).map(u => {
      const cuotasU = cuotas.filter(c => c.unidad_id === u.id && c.periodo === periodo)
      const cargos = cuotasU.reduce((s, c) => s + c.monto, 0)
      const pagos = cuotasU.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0)
      const vencidas = cuotasU.filter(c => c.estado === 'moroso').length
      const prevSnap = historial.filter(h => h.unidad_id === u.id).sort((a, b) => b.periodo.localeCompare(a.periodo))[0]
      const saldo_anterior = prevSnap?.saldo_final ?? 0
      return {
        company_id: companyId, project_id: proyectoId,
        unidad_id: u.id, periodo,
        saldo_anterior,
        cargos_periodo: cargos,
        pagos_periodo: pagos,
        saldo_final: parseFloat((saldo_anterior + cargos - pagos).toFixed(2)),
        num_cuotas_vencidas: vencidas,
      }
    })

    const { error } = await supabase.from('historial_saldos_unidad').upsert(rows, { onConflict: 'project_id,unidad_id,periodo' })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success(`Snapshot ${periodo} generado`, { description: `${rows.length} unidades procesadas` })
    onRefresh()
  }

  const unidadNombre = (id: string) => unidades.find(u => u.id === id)?.nombre ?? ''

  const columns: DataTableColumn<HistorialSaldoUnidad>[] = [
    {
      key: 'unidad',
      header: 'Unidad',
      sortable: true,
      accessor: row => unidadNombre(row.unidad_id) || row.unidad_nombre || '',
      render: row => <span style={{ fontWeight: 600 }}>{unidadNombre(row.unidad_id) || row.unidad_nombre || '—'}</span>,
    },
    {
      key: 'periodo',
      header: 'Período',
      sortable: true,
      render: row => <span style={{ color: '#6b7280' }}>{row.periodo}</span>,
    },
    {
      key: 'saldo_anterior',
      header: 'Saldo anterior',
      sortable: true,
      align: 'right',
      render: row => <span style={{ color: '#374151' }}>{moneda} {row.saldo_anterior.toFixed(2)}</span>,
    },
    {
      key: 'cargos_periodo',
      header: 'Cargos',
      sortable: true,
      align: 'right',
      render: row => <span style={{ color: '#dc2626' }}>+ {moneda} {row.cargos_periodo.toFixed(2)}</span>,
    },
    {
      key: 'pagos_periodo',
      header: 'Pagos',
      sortable: true,
      align: 'right',
      render: row => <span style={{ color: '#16a34a' }}>− {moneda} {row.pagos_periodo.toFixed(2)}</span>,
    },
    {
      key: 'saldo_final',
      header: 'Saldo final',
      sortable: true,
      align: 'right',
      render: row => (
        <span style={{ fontWeight: 700, color: row.saldo_final > 0 ? '#ef4444' : '#16a34a' }}>
          {moneda} {row.saldo_final.toFixed(2)}
        </span>
      ),
    },
    {
      key: 'num_cuotas_vencidas',
      header: 'Cuotas vencidas',
      sortable: true,
      align: 'center',
      render: row => row.num_cuotas_vencidas > 0
        ? <span style={{ padding: '2px 7px', borderRadius: 20, background: '#fee2e2', color: '#ef4444', fontSize: 11, fontWeight: 700 }}>{row.num_cuotas_vencidas}</span>
        : <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>,
    },
  ]

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
        <div style={{ background: '#fef2f2', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#ef4444' }}>{moneda} {totalDeuda.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 11, color: '#ef4444' }}>Deuda acumulada{filtroPeriodo ? ` (${filtroPeriodo})` : ' (todos los períodos)'}</div>
        </div>
        <div style={{ background: '#f0fdf4', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#16a34a' }}>{moneda} {totalPagos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 11, color: '#16a34a' }}>Pagos recibidos</div>
        </div>
        <div style={{ background: '#f9fafb', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#374151' }}>{periodos.length}</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>Períodos con snapshot</div>
        </div>
      </div>

      <DataTable
        data={dataFiltrada}
        columns={columns}
        rowKey="id"
        filters={[
          {
            key: 'unidad',
            value: filtroUnidad,
            onChange: setFiltroUnidad,
            options: [{ value: '', label: 'Todas las unidades' }, ...unidades.map(u => ({ value: u.id, label: u.nombre }))],
          },
          {
            key: 'periodo',
            value: filtroPeriodo,
            onChange: setFiltroPeriodo,
            options: [{ value: '', label: 'Todos los períodos' }, ...periodos.map(p => ({ value: p, label: p }))],
          },
        ]}
        defaultSort={{ key: 'periodo', direction: 'desc' }}
        rowStyle={row => row.saldo_final > 0 ? { background: '#fef9f9' } : {}}
        emptyState={{ icon: '📊', title: 'Sin snapshots de saldo', description: 'Usa "Generar snapshot" para el período actual' }}
        toolbar={canCreate ? (
          <button onClick={generarSnapshot} disabled={saving}
            style={{ padding: '8px 16px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            {saving ? '⏳ Generando…' : '📸 Generar snapshot'}
          </button>
        ) : undefined}
      />
    </div>
  )
}
