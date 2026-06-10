import { useMemo, useState } from 'react'
import { DataTable, type DataTableColumn } from '../shared'
import { FilterChips } from '../shared/FilterChips'
import { StatusBadge } from '../shared/StatusBadge'
import { useAsientosQuery } from '../../domain/contabilidad/queries'
import { formatCurrency, formatDateShort } from '../../lib/format'
import { TIPO_ASIENTO_LABELS, type AsientoContable } from '../../types/contabilidad'
import type { Proyecto } from '../../types'
import { AsientoFormModal } from './AsientoFormModal'
import { AsientoDetalleModal } from './AsientoDetalleModal'
import { AperturaSaldosModal } from './AperturaSaldosModal'
import { btnPrimario, btnSecundario, input } from './ui'

interface Props {
  companyId: string
  proyectos: Proyecto[]
  monedaBase: string
}

type FiltroEstado = 'todos' | 'borrador' | 'publicado' | 'anulado'

function periodoActual(): string {
  return new Date().toISOString().slice(0, 7)
}

const TONO_ESTADO = { borrador: 'warning', publicado: 'success', anulado: 'neutral' } as const

export function AsientosTab({ companyId, proyectos, monedaBase }: Props) {
  const [periodo, setPeriodo] = useState(periodoActual())
  const [estado, setEstado] = useState<FiltroEstado>('todos')
  const [projectId, setProjectId] = useState('')
  const [nuevo, setNuevo] = useState(false)
  const [apertura, setApertura] = useState(false)
  const [detalleId, setDetalleId] = useState<string | null>(null)

  const { data: asientos = [], isLoading } = useAsientosQuery(companyId, {
    periodo: periodo || undefined,
    estado: estado === 'todos' ? undefined : estado,
    projectId: projectId || undefined,
  })

  const hayApertura = useMemo(
    () => asientos.some((a) => a.tipo === 'apertura' && a.estado === 'publicado'),
    [asientos],
  )

  const columns: DataTableColumn<AsientoContable>[] = [
    {
      key: 'numero',
      header: 'Folio',
      accessor: (a) => a.numero ?? 0,
      render: (a) => a.numero ?? '—',
      numeric: true,
      sortable: true,
      width: 70,
    },
    {
      key: 'fecha',
      header: 'Fecha',
      accessor: (a) => a.fecha,
      render: (a) => formatDateShort(a.fecha),
      sortable: true,
      width: 100,
    },
    { key: 'tipo', header: 'Tipo', accessor: (a) => a.tipo, render: (a) => TIPO_ASIENTO_LABELS[a.tipo], width: 90, hideOnMobile: true },
    { key: 'concepto', header: 'Concepto', accessor: (a) => a.concepto },
    {
      key: 'origen',
      header: 'Origen',
      accessor: (a) => a.origen,
      render: (a) => (a.origen === 'automatico' ? 'Automático' : 'Manual'),
      width: 95,
      hideOnMobile: true,
    },
    {
      key: 'total',
      header: `Total (${monedaBase})`,
      accessor: (a) => a.total_debe,
      render: (a) => formatCurrency(a.total_debe, monedaBase),
      numeric: true,
      width: 130,
    },
    {
      key: 'estado',
      header: 'Estado',
      accessor: (a) => a.estado,
      render: (a) => (
        <StatusBadge tone={TONO_ESTADO[a.estado]}>
          {a.anulado_por_id ? 'reversado' : a.estado}
        </StatusBadge>
      ),
      width: 100,
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--at-space-3)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="month"
          value={periodo}
          onChange={(e) => setPeriodo(e.target.value)}
          style={{ ...input, width: 150 }}
          aria-label="Periodo"
        />
        {proyectos.length > 1 && (
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ ...input, width: 200 }} aria-label="Proyecto">
            <option value="">Todos los proyectos</option>
            {proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        )}
        <FilterChips<FiltroEstado>
          options={[
            { value: 'todos', label: 'Todas' },
            { value: 'borrador', label: 'Borradores', color: 'var(--at-warning)' },
            { value: 'publicado', label: 'Publicadas', color: 'var(--at-success)' },
            { value: 'anulado', label: 'Anuladas' },
          ]}
          value={estado}
          onChange={setEstado}
          ariaLabel="Filtrar por estado"
        />
      </div>

      <DataTable<AsientoContable>
        data={asientos}
        columns={columns}
        rowKey="id"
        isLoading={isLoading}
        searchableKeys={['concepto']}
        searchPlaceholder="Buscar póliza…"
        defaultSort={{ key: 'fecha', direction: 'desc' }}
        onRowClick={(a) => setDetalleId(a.id)}
        toolbar={
          <div style={{ display: 'flex', gap: 8 }}>
            {!hayApertura && (
              <button onClick={() => setApertura(true)} style={btnSecundario}>
                Saldos iniciales
              </button>
            )}
            <button onClick={() => setNuevo(true)} style={btnPrimario}>+ Nueva póliza</button>
          </div>
        }
        emptyState={{
          title: 'Sin pólizas en este periodo',
          description: 'La contabilidad arranca desde los saldos iniciales (asiento de apertura); los documentos anteriores a la activación no se contabilizan retroactivamente.',
        }}
      />

      {nuevo && (
        <AsientoFormModal
          companyId={companyId}
          proyectos={proyectos}
          monedaBase={monedaBase}
          onClose={() => setNuevo(false)}
        />
      )}
      {apertura && (
        <AperturaSaldosModal
          companyId={companyId}
          proyectos={proyectos}
          monedaBase={monedaBase}
          onClose={() => setApertura(false)}
        />
      )}
      {detalleId && (
        <AsientoDetalleModal
          asientoId={detalleId}
          monedaBase={monedaBase}
          onClose={() => setDetalleId(null)}
        />
      )}
    </div>
  )
}
