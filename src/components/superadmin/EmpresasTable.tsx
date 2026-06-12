import { useState, useEffect, type ChangeEvent } from 'react'
import { DataTable, type DataTableColumn } from '../shared/DataTable'
import { StatusBadge } from '../shared/StatusBadge'
import { ExportButton } from '../shared/ExportButton'
import {
  useEmpresasSuperadminQuery,
  type EmpresaSuperadminRow,
  type EmpresaStatusFilter,
  type EmpresaModuleFilter,
  type EmpresaSortOption,
} from '../../domain/superadmin/queries'
import { moduleBadgeLabel, planCodeLabel, formatUsdCents } from './empresaHelpers'

// ============================================================================
// EmpresasTable — listado profesional de empresas del superadmin.
// ============================================================================
// Reemplaza la lista de cards de SuperAdminSection por la DataTable compartida
// en modo server (la RPC get_superadmin_empresas v2 pagina/busca/filtra/ordena
// en Postgres). La edición pasa al drawer de detalle (onRowClick).

const PAGE_SIZE = 25

/** Tono + etiqueta del chip de suscripción. */
export function subscriptionBadge(status: string | null): { tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; label: string } {
  switch (status) {
    case 'active': return { tone: 'success', label: 'Activa' }
    case 'trialing': return { tone: 'info', label: 'En trial' }
    case 'past_due': return { tone: 'warning', label: 'Pago vencido' }
    case 'incomplete': return { tone: 'warning', label: 'Incompleta' }
    default: return { tone: 'neutral', label: 'Sin suscripción' }
  }
}

interface Props {
  onRowClick: (empresa: EmpresaSuperadminRow) => void
  onNuevaEmpresa: () => void
}

export function EmpresasTable({ onRowClick, onNuevaEmpresa }: Props) {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [status, setStatus] = useState<EmpresaStatusFilter>('')
  const [moduleFilter, setModuleFilter] = useState<EmpresaModuleFilter>('')
  const [sort, setSort] = useState<EmpresaSortOption>('nombre')

  // Debounce de la búsqueda (300 ms) y reseteo a la primera página al buscar.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(0) }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const { data, isLoading, isFetching } = useEmpresasSuperadminQuery({
    search: search || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    status,
    module: moduleFilter,
    sort,
  })
  const empresas = data?.rows ?? []
  const total = data?.total ?? 0

  const columns: DataTableColumn<EmpresaSuperadminRow>[] = [
    {
      key: 'nombre',
      header: 'Empresa',
      render: (e) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700 }}>{e.nombre}</span>
            {!e.activa && <StatusBadge tone="danger" dot>Suspendida</StatusBadge>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px', flexWrap: 'wrap' }}>
            <StatusBadge tone="neutral">{moduleBadgeLabel(e.servicio_agua, e.servicio_condominios)}</StatusBadge>
            {e.email && <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{e.email}</span>}
          </div>
        </div>
      ),
    },
    {
      key: 'project_count',
      header: 'Proyectos',
      numeric: true,
      render: (e) => <span>{e.project_count}<span style={{ color: 'var(--at-ink-3)' }}>/{e.max_projects}</span></span>,
    },
    {
      key: 'unit_count',
      header: 'Unidades',
      numeric: true,
      render: (e) => {
        const pct = e.max_units > 0 ? Math.round((e.unit_count / e.max_units) * 100) : 0
        let color = 'var(--at-success)'
        if (pct >= 100) color = 'var(--at-danger)'
        else if (pct >= 80) color = 'var(--at-warning)'
        return (
          <span>
            <span style={{ color, fontWeight: 600 }}>{e.unit_count}</span>
            <span style={{ color: 'var(--at-ink-3)' }}>/{e.max_units}</span>
          </span>
        )
      },
    },
    { key: 'user_count', header: 'Usuarios', numeric: true },
    {
      key: 'subscription_status',
      header: 'Suscripción',
      render: (e) => {
        const badge = subscriptionBadge(e.subscription_status)
        return (
          <div>
            <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
            {e.plan_code && (
              <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                {planCodeLabel(e.plan_code)}
              </div>
            )}
          </div>
        )
      },
    },
    {
      key: 'monthly_total_cents',
      header: 'Total / mes',
      numeric: true,
      render: (e) => formatUsdCents(e.monthly_total_cents),
    },
    {
      key: 'created_at',
      header: 'Creada',
      hideOnMobile: true,
      render: (e) => e.created_at ? new Date(e.created_at).toLocaleDateString('es-GT') : '—',
    },
  ]

  const exportColumns = [
    { header: 'Empresa', accessor: 'nombre' as const },
    { header: 'NIT', accessor: (e: EmpresaSuperadminRow) => e.nit ?? '' },
    { header: 'Email', accessor: (e: EmpresaSuperadminRow) => e.email ?? '' },
    { header: 'Módulos', accessor: (e: EmpresaSuperadminRow) => moduleBadgeLabel(e.servicio_agua, e.servicio_condominios) },
    { header: 'Estado', accessor: (e: EmpresaSuperadminRow) => e.activa ? 'Activa' : 'Suspendida' },
    { header: 'Proyectos', accessor: 'project_count' as const, align: 'right' as const },
    { header: 'Unidades', accessor: 'unit_count' as const, align: 'right' as const },
    { header: 'Usuarios', accessor: 'user_count' as const, align: 'right' as const },
    { header: 'Suscripción', accessor: (e: EmpresaSuperadminRow) => subscriptionBadge(e.subscription_status).label },
    { header: 'Total mensual (USD)', accessor: (e: EmpresaSuperadminRow) => (e.monthly_total_cents / 100).toFixed(2), align: 'right' as const },
  ]

  return (
    <div>
      {/* Búsqueda server-side por nombre / NIT / email + filtros */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="search"
          value={searchInput}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSearchInput(e.target.value)}
          placeholder="Buscar empresa por nombre, NIT o email…"
          style={{
            flex: '1 1 260px', minWidth: '200px', padding: '9px 12px', borderRadius: '8px',
            border: '1px solid var(--at-line)', fontSize: '13px', outline: 'none',
          }}
        />
        <select
          value={status}
          onChange={e => { setStatus(e.target.value as EmpresaStatusFilter); setPage(0) }}
          aria-label="Filtrar por estado"
          style={filterSelectStyle}
        >
          <option value="">Todas</option>
          <option value="activas">Activas</option>
          <option value="suspendidas">Suspendidas</option>
        </select>
        <select
          value={moduleFilter}
          onChange={e => { setModuleFilter(e.target.value as EmpresaModuleFilter); setPage(0) }}
          aria-label="Filtrar por módulo"
          style={filterSelectStyle}
        >
          <option value="">Todos los módulos</option>
          <option value="agua">Solo Agua</option>
          <option value="condominios">Solo Condominios</option>
          <option value="ambos">Agua + Condominios</option>
        </select>
        <select
          value={sort}
          onChange={e => { setSort(e.target.value as EmpresaSortOption); setPage(0) }}
          aria-label="Ordenar por"
          style={filterSelectStyle}
        >
          <option value="nombre">Nombre A-Z</option>
          <option value="created_at">Más recientes</option>
          <option value="unidades">Más unidades</option>
          <option value="monto">Mayor facturación</option>
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          {isFetching && <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>actualizando…</span>}
          <ExportButton
            data={empresas}
            columns={exportColumns}
            filename="empresas-superadmin"
            title="Empresas — AdministraTodo"
            subtitle={`${total} empresa(s)`}
          />
          <button onClick={onNuevaEmpresa} style={primaryBtnStyle}>
            + Nueva Empresa
          </button>
        </div>
      </div>

      <DataTable<EmpresaSuperadminRow>
        data={empresas}
        columns={columns}
        rowKey="id"
        isLoading={isLoading}
        paginationMode="server"
        pageSize={PAGE_SIZE}
        currentPage={page}
        onPageChange={setPage}
        totalRows={total}
        onRowClick={onRowClick}
        mobileCardLayout
        emptyState={{
          title: search || status || moduleFilter
            ? 'No hay empresas que coincidan con los filtros'
            : 'No hay empresas registradas',
          description: 'Crea la primera con "+ Nueva Empresa".',
        }}
      />
    </div>
  )
}

const filterSelectStyle = {
  padding: '8px 12px', borderRadius: '8px',
  border: '1px solid var(--at-line)', fontSize: '13px',
  background: 'var(--at-surface)', cursor: 'pointer',
} as const

const primaryBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: '6px',
  padding: '9px 16px', borderRadius: '8px', border: 'none',
  background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
  color: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
} as const
