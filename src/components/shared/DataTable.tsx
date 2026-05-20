import { useState, useMemo, type ReactNode, type CSSProperties } from 'react'
import { EmptyState } from './EmptyState'
import { Skeleton } from './Skeleton'

// ── Tipos públicos ────────────────────────────────────────────────────────

export interface DataTableColumn<T> {
  /** Identificador único — usado para sort state y como React key. */
  key: string
  /** Contenido del header (texto, ReactNode). */
  header: ReactNode
  /**
   * Valor extraído de la fila para sort/search. Default: row[key as keyof T].
   * Usa esto cuando key no coincide con una propiedad de la fila (ej. cliente
   * resuelto por id desde otra colección).
   */
  accessor?: (row: T) => string | number | boolean | null | undefined
  /**
   * Renderizado de la celda. Default: String(accessor(row)).
   * Usa esto para badges, links, formato, etc.
   */
  render?: (row: T) => ReactNode
  /** Si true, el header es clickable y ordena por esta columna. */
  sortable?: boolean
  align?: 'left' | 'right' | 'center'
  width?: number | string
  /** Ocultar esta columna en mobile (< 640px). */
  hideOnMobile?: boolean
}

export interface DataTableFilter {
  /** Identificador para React key. */
  key: string
  /** Label corto a la izquierda del select. */
  label?: string
  /** Valor actualmente seleccionado. */
  value: string
  /** Opciones del dropdown. La primera suele ser "todos"/"". */
  options: { value: string; label: string }[]
  /** Handler de cambio. */
  onChange: (value: string) => void
}

export interface DataTableProps<T> {
  /** Filas a mostrar (la tabla se encarga de filter/sort/paginate). */
  data: T[]
  /** Definición de columnas. */
  columns: DataTableColumn<T>[]
  /** Cómo obtener el React key de una fila. */
  rowKey: keyof T | ((row: T) => string)

  /** Búsqueda libre que matchea contra estos campos. Si no se pasa, sin search. */
  searchableKeys?: (keyof T | ((row: T) => string))[]
  /** Placeholder del input de búsqueda. */
  searchPlaceholder?: string

  /** Dropdowns adicionales para filtrar. */
  filters?: DataTableFilter[]

  /** Filas por página. 0 = sin paginación. Default: 50. */
  pageSize?: number

  /** Orden inicial. */
  defaultSort?: { key: string; direction: 'asc' | 'desc' }

  /** Estado vacío. Default: EmptyState con texto genérico. */
  emptyState?: ReactNode | { icon?: ReactNode; title: string; description?: ReactNode }

  /** Mostrar skeletons mientras isLoading=true. */
  isLoading?: boolean

  /** Toolbar adicional (botones de export, "+ Nuevo", etc.). */
  toolbar?: ReactNode

  /** Permite estilizar filas según contenido (ej. fila destacada). */
  rowStyle?: (row: T) => CSSProperties

  /** onClick por fila para hacerla interactiva. */
  onRowClick?: (row: T) => void
}

// ── Componente ────────────────────────────────────────────────────────────

export function DataTable<T>({
  data,
  columns,
  rowKey,
  searchableKeys,
  searchPlaceholder = 'Buscar…',
  filters,
  pageSize = 50,
  defaultSort,
  emptyState,
  isLoading = false,
  toolbar,
  rowStyle,
  onRowClick,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('')
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(
    defaultSort ?? null
  )
  const [page, setPage] = useState(0)

  // Helper para obtener el valor de una columna desde una fila.
  const getAccessorValue = (col: DataTableColumn<T>, row: T): string | number | boolean | null | undefined => {
    if (col.accessor) return col.accessor(row)
    return (row as Record<string, unknown>)[col.key] as string | number | boolean | null | undefined
  }

  // ── Filtrado ─────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = data
    if (search && searchableKeys && searchableKeys.length > 0) {
      const needle = search.toLowerCase().trim()
      result = result.filter(row =>
        searchableKeys.some(key => {
          const value = typeof key === 'function'
            ? key(row)
            : ((row as Record<string, unknown>)[key as string] as unknown)
          if (value === null || value === undefined) return false
          return String(value).toLowerCase().includes(needle)
        })
      )
    }
    return result
  }, [data, search, searchableKeys])

  // ── Sort ────────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    if (!sortConfig) return filtered
    const col = columns.find(c => c.key === sortConfig.key)
    if (!col) return filtered
    const copy = filtered.slice()
    copy.sort((a, b) => {
      const av = getAccessorValue(col, a)
      const bv = getAccessorValue(col, b)
      // null/undefined al final siempre
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      let cmp = 0
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv
      else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
      return sortConfig.direction === 'asc' ? cmp : -cmp
    })
    return copy
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortConfig, columns])

  // ── Paginación ──────────────────────────────────────────────────────────
  const paginated = useMemo(() => {
    if (pageSize <= 0) return sorted
    const start = page * pageSize
    return sorted.slice(start, start + pageSize)
  }, [sorted, page, pageSize])

  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1

  // Reset page si quedó fuera de rango (ej. al cambiar filtro).
  if (page > 0 && page >= totalPages) {
    setPage(0)
  }

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleHeaderClick = (col: DataTableColumn<T>) => {
    if (!col.sortable) return
    setSortConfig(prev => {
      if (!prev || prev.key !== col.key) return { key: col.key, direction: 'desc' }
      if (prev.direction === 'desc') return { key: col.key, direction: 'asc' }
      return null
    })
    setPage(0)
  }

  const getRowKey = (row: T, idx: number): string => {
    if (typeof rowKey === 'function') return rowKey(row)
    const v = (row as Record<string, unknown>)[rowKey as string]
    return v != null ? String(v) : `row-${idx}`
  }

  // ── Render: estados especiales ──────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ background: 'var(--at-surface)', borderRadius: '12px', padding: '16px' }}>
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
            {columns.map(col => (
              <Skeleton key={col.key} width={col.width ?? '100%'} height={20} />
            ))}
          </div>
        ))}
      </div>
    )
  }

  // ── Render: principal ───────────────────────────────────────────────────
  const hasFiltersOrSearch = !!searchableKeys || (filters && filters.length > 0) || !!toolbar
  return (
    <div>
      {hasFiltersOrSearch && (
        <div
          style={{
            display: 'flex',
            gap: '10px',
            marginBottom: '14px',
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          {searchableKeys && (
            <input
              type="search"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0) }}
              placeholder={searchPlaceholder}
              style={{
                flex: '1 1 240px',
                minWidth: '180px',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid var(--at-line)',
                fontSize: '13px',
                outline: 'none',
              }}
            />
          )}
          {filters?.map(f => (
            <select
              key={f.key}
              value={f.value}
              onChange={e => { f.onChange(e.target.value); setPage(0) }}
              aria-label={f.label}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid var(--at-line)',
                fontSize: '13px',
                background: 'var(--at-surface)',
                cursor: 'pointer',
              }}
            >
              {f.options.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ))}
          {toolbar && <div style={{ marginLeft: 'auto' }}>{toolbar}</div>}
        </div>
      )}

      <div
        style={{
          background: 'var(--at-surface)',
          borderRadius: '12px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.06)',
          overflow: 'hidden',
        }}
      >
        {paginated.length === 0 ? (
          isEmptyStateObject(emptyState) ? (
            <EmptyState icon={emptyState.icon} title={emptyState.title} description={emptyState.description} />
          ) : (
            emptyState ?? <EmptyState title="No hay datos para mostrar" />
          )
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
              <thead>
                <tr style={{ background: 'var(--at-surface-2)' }}>
                  {columns.map(col => {
                    const isSorted = sortConfig?.key === col.key
                    const arrow = !isSorted ? '' : sortConfig.direction === 'asc' ? ' ↑' : ' ↓'
                    return (
                      <th
                        key={col.key}
                        scope="col"
                        aria-sort={!col.sortable ? 'none' : isSorted ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                        onClick={() => handleHeaderClick(col)}
                        style={{
                          padding: '12px 14px',
                          textAlign: col.align ?? 'left',
                          fontWeight: 600,
                          color: 'var(--at-ink-2)',
                          fontSize: '12px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          borderBottom: '2px solid var(--at-line)',
                          cursor: col.sortable ? 'pointer' : 'default',
                          userSelect: col.sortable ? 'none' : 'auto',
                          width: col.width,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {col.header}{arrow}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {paginated.map((row, idx) => (
                  <tr
                    key={getRowKey(row, idx)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    style={{
                      borderBottom: '1px solid var(--at-chip)',
                      cursor: onRowClick ? 'pointer' : 'default',
                      transition: 'background 0.12s',
                      ...(rowStyle ? rowStyle(row) : {}),
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--at-surface-2)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = '' }}
                  >
                    {columns.map(col => (
                      <td
                        key={col.key}
                        style={{
                          padding: '10px 14px',
                          textAlign: col.align ?? 'left',
                          color: 'var(--at-ink)',
                        }}
                      >
                        {col.render ? col.render(row) : String(getAccessorValue(col, row) ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer con totales + paginación */}
        {paginated.length > 0 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 16px',
              borderTop: '1px solid var(--at-chip)',
              fontSize: '12px',
              color: 'var(--at-ink-3)',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <div>
              {sorted.length} {sorted.length === 1 ? 'resultado' : 'resultados'}
              {data.length !== sorted.length && ` (de ${data.length})`}
            </div>
            {pageSize > 0 && totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  style={paginationBtnStyle(page === 0)}
                >
                  ← Anterior
                </button>
                <span>Página {page + 1} de {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  style={paginationBtnStyle(page >= totalPages - 1)}
                >
                  Siguiente →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function paginationBtnStyle(disabled: boolean): CSSProperties {
  return {
    padding: '4px 10px',
    fontSize: '12px',
    borderRadius: '6px',
    border: '1px solid var(--at-line)',
    background: disabled ? 'var(--at-chip)' : 'var(--at-surface)',
    color: disabled ? 'var(--at-line-strong)' : 'var(--at-ink-2)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 600,
  }
}

function isEmptyStateObject(
  v: ReactNode | { icon?: ReactNode; title: string; description?: ReactNode } | undefined,
): v is { icon?: ReactNode; title: string; description?: ReactNode } {
  return !!v && typeof v === 'object' && 'title' in (v as { title: unknown })
}
