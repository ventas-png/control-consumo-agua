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
  /**
   * Si true, la primera columna queda pegada al borde izquierdo durante el
   * scroll horizontal (mobile). Util para tablas anchas donde el identificador
   * de fila (nombre, codigo) no debe perderse al desplazarse.
   */
  stickyFirstColumn?: boolean
  /**
   * Si true, en phones ≤480px la tabla se re-renderiza como una lista de
   * cards (un card por fila), con el header de cada columna mostrado como
   * label dentro de la celda. Aplica la clase `.table-cards-on-mobile`
   * y agrega `data-label` a cada `<td>`. Util para tablas con muchas
   * columnas donde el scroll horizontal es incomodo.
   */
  mobileCardLayout?: boolean
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

  /**
   * Footer/totales row. Renderiza dentro de `<tfoot>` y el consumer
   * provee sus propios `<tr>`/`<td>` para tener libertad total de colSpan,
   * alineación y estilos.
   *
   * Se renderiza siempre (incluso en estado vacío) si pasas algo; pasar
   * `null`/`undefined` lo omite.
   */
  footer?: ReactNode

  /**
   * Row expansion (controlado). Cuando `isRowExpanded(row)` retorna true,
   * DataTable inserta una fila adicional inmediatamente debajo con el
   * contenido de `expandedContent(row)` envuelto en un `<td colSpan>`.
   *
   * Si `expandedContent` retorna `null`/`undefined`, no se renderiza la fila
   * (útil para filas que no tienen detalle aunque estén "expandidas").
   *
   * El consumer maneja el estado y el toggle (típicamente con un botón
   * en una columna). DataTable solo renderiza.
   */
  expandedContent?: (row: T) => ReactNode | null | undefined
  isRowExpanded?: (row: T) => boolean

  /**
   * Modo de paginación.
   * - `'client'` (default): DataTable maneja filter/sort/pagination sobre
   *   el `data` completo.
   * - `'server'`: el consumer ya paginó/filtró/ordenó. DataTable solo
   *   renderiza `data` (1 página) y dispara `onPageChange` al navegar.
   */
  paginationMode?: 'client' | 'server'

  /** Página actual (0-indexed) en modo server. */
  currentPage?: number

  /** Handler de navegación en modo server. */
  onPageChange?: (page: number) => void

  /**
   * Total de filas en el dataset completo (modo server). Si se omite,
   * se usa heurística `hasMore = data.length === pageSize` (botón Siguiente
   * habilitado mientras la página esté llena).
   */
  totalRows?: number
}

// ── Componente ────────────────────────────────────────────────────────────

export function DataTable<T>({
  data,
  columns,
  stickyFirstColumn = false,
  mobileCardLayout = false,
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
  footer,
  expandedContent,
  isRowExpanded,
  paginationMode = 'client',
  currentPage,
  onPageChange,
  totalRows,
}: DataTableProps<T>) {
  const isServer = paginationMode === 'server'
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

  // ── Filtrado (solo modo client) ─────────────────────────────────────────
  const filtered = useMemo(() => {
    if (isServer) return data
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
  }, [data, search, searchableKeys, isServer])

  // ── Sort (solo modo client) ─────────────────────────────────────────────
  const sorted = useMemo(() => {
    if (isServer) return filtered
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
  }, [filtered, sortConfig, columns, isServer])

  // ── Paginación ──────────────────────────────────────────────────────────
  // Modo server: `data` ya viene paginado, no slicemos. Modo client: paginamos.
  const paginated = useMemo(() => {
    if (isServer) return sorted
    if (pageSize <= 0) return sorted
    const start = page * pageSize
    return sorted.slice(start, start + pageSize)
  }, [sorted, page, pageSize, isServer])

  // Modo server: el consumer controla la página. Modo client: estado interno.
  const effectivePage = isServer ? (currentPage ?? 0) : page
  const totalPages = isServer
    ? (totalRows != null && pageSize > 0 ? Math.max(1, Math.ceil(totalRows / pageSize)) : 0)
    : (pageSize > 0 ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1)
  // Heurística cuando totalRows no se pasa en modo server.
  const hasMore = isServer
    ? (totalRows != null ? effectivePage < totalPages - 1 : data.length === pageSize)
    : effectivePage < totalPages - 1

  // Reset page si quedó fuera de rango en modo client (ej. al cambiar filtro).
  if (!isServer && page > 0 && page >= totalPages) {
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
          <div className="table-scroll-wrapper">
            <table
              className={mobileCardLayout ? 'table-cards-on-mobile' : undefined}
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}
            >
              <thead>
                <tr style={{ background: 'var(--at-surface-2)' }}>
                  {columns.map((col, colIdx) => {
                    const isSorted = sortConfig?.key === col.key
                    const arrow = !isSorted ? '' : sortConfig.direction === 'asc' ? ' ↑' : ' ↓'
                    const isStickyCol = stickyFirstColumn && colIdx === 0
                    return (
                      <th
                        key={col.key}
                        scope="col"
                        className={[
                          col.hideOnMobile ? 'table-col-secondary' : '',
                          isStickyCol ? 'table-col-sticky' : '',
                        ].filter(Boolean).join(' ') || undefined}
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
                          // background sobreescrito por la clase sticky para que
                          // los headers no queden transparentes encima del scroll.
                          background: isStickyCol ? 'var(--at-surface-2)' : undefined,
                        }}
                      >
                        {col.header}{arrow}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {paginated.flatMap((row, idx) => {
                  const expanded = isRowExpanded?.(row) ?? false
                  const expandContent = expanded ? expandedContent?.(row) : null
                  const rowKey = getRowKey(row, idx)
                  const mainRow = (
                    <tr
                      key={rowKey}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      style={{
                        borderBottom: expandContent ? 'none' : '1px solid var(--at-chip)',
                        cursor: onRowClick ? 'pointer' : 'default',
                        transition: 'background 0.12s',
                        ...(rowStyle ? rowStyle(row) : {}),
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--at-surface-2)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = '' }}
                    >
                      {columns.map((col, colIdx) => {
                        const isStickyCol = stickyFirstColumn && colIdx === 0
                        // data-label se usa por el CSS .table-cards-on-mobile
                        // para mostrar el header como label de la celda en
                        // phones. Si col.header no es string, fallback al key.
                        const labelStr = mobileCardLayout
                          ? (typeof col.header === 'string' ? col.header : col.key)
                          : undefined
                        return (
                          <td
                            key={col.key}
                            data-label={labelStr}
                            className={[
                              col.hideOnMobile ? 'table-col-secondary' : '',
                              isStickyCol ? 'table-col-sticky' : '',
                            ].filter(Boolean).join(' ') || undefined}
                            style={{
                              padding: '10px 14px',
                              textAlign: col.align ?? 'left',
                              color: 'var(--at-ink)',
                              // background hereda del tr (var(--at-surface) o
                              // surface-2 hover). En sticky-col forzamos surface
                              // para que el contenido no se vea transparente
                              // sobre el scroll.
                              background: isStickyCol ? 'var(--at-surface)' : undefined,
                            }}
                          >
                            {col.render ? col.render(row) : String(getAccessorValue(col, row) ?? '')}
                          </td>
                        )
                      })}
                    </tr>
                  )
                  if (!expandContent) return [mainRow]
                  return [
                    mainRow,
                    <tr
                      key={`${rowKey}-expanded`}
                      style={{
                        borderBottom: '1px solid var(--at-chip)',
                        background: 'var(--at-surface-2)',
                      }}
                    >
                      <td colSpan={columns.length} style={{ padding: '0 14px 12px' }}>
                        {expandContent}
                      </td>
                    </tr>,
                  ]
                })}
              </tbody>
              {footer && (
                <tfoot style={{ background: 'var(--at-surface-2)', borderTop: '2px solid var(--at-line)' }}>
                  {footer}
                </tfoot>
              )}
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
              {isServer
                ? `${paginated.length} ${paginated.length === 1 ? 'evento' : 'eventos'}${totalRows != null ? ` (de ${totalRows})` : ''}`
                : (
                  <>
                    {sorted.length} {sorted.length === 1 ? 'resultado' : 'resultados'}
                    {data.length !== sorted.length && ` (de ${data.length})`}
                  </>
                )}
            </div>
            {pageSize > 0 && (totalPages > 1 || isServer) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={() => {
                    const next = Math.max(0, effectivePage - 1)
                    if (isServer) onPageChange?.(next)
                    else setPage(next)
                  }}
                  disabled={effectivePage === 0}
                  style={paginationBtnStyle(effectivePage === 0)}
                >
                  ← Anterior
                </button>
                <span>
                  Página {effectivePage + 1}
                  {totalPages > 0 && ` de ${totalPages}`}
                </span>
                <button
                  onClick={() => {
                    const next = effectivePage + 1
                    if (isServer) onPageChange?.(next)
                    else setPage(p => Math.min(totalPages - 1, p + 1))
                  }}
                  disabled={!hasMore}
                  style={paginationBtnStyle(!hasMore)}
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
