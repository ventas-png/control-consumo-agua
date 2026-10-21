import type { CSSProperties } from 'react'
import { ConversationList } from './ConversationList'
import { Skeleton } from '../shared/Skeleton'
import { CATEGORY_LABELS, STATUS_LABELS } from './conversationConstants'
import { AGUA_CATEGORIES, CONDOMINIOS_CATEGORIES } from '../../types'
import type {
  Conversation,
  ConversationCategory,
  ConversationStatus,
  ConversationServiceType,
} from '../../types'

// Lista del centro de comunicación: tabs Clientes/Equipo + filtros + filas.
// Ocupa todo el ancho: el detalle se abre en una ventana emergente
// (ConversationDetailModal), ya no comparte la fila con la lista.
interface Props {
  convTab: 'clientes' | 'equipo'
  onChangeTab: (tab: 'clientes' | 'equipo') => void
  clientesTabLabel: string
  clientConvCount: number
  teamConvCount: number
  filterText: string
  onFilterText: (v: string) => void
  filterStatus: ConversationStatus | 'todas'
  onFilterStatus: (v: ConversationStatus | 'todas') => void
  filterCategory: ConversationCategory | 'todas'
  onFilterCategory: (v: ConversationCategory | 'todas') => void
  serviceType: ConversationServiceType
  loading: boolean
  visibleConversations: Conversation[]
  activeConversationId: string | null
  onSelect: (id: string) => void
  unseenConvIds: Set<string>
}

const fieldStyle: CSSProperties = {
  width: '100%', height: '40px', padding: '0 12px', boxSizing: 'border-box',
  border: '1px solid var(--at-line-strong)', borderRadius: '10px',
  background: 'var(--at-surface)', color: 'var(--at-ink)', fontSize: '13.5px',
}

export function ConversationListPanel({
  convTab, onChangeTab, clientesTabLabel, clientConvCount, teamConvCount,
  filterText, onFilterText, filterStatus, onFilterStatus, filterCategory, onFilterCategory,
  serviceType, loading, visibleConversations, activeConversationId, onSelect, unseenConvIds,
}: Props) {
  return (
    <div style={{
      background: 'var(--at-surface)',
      border: '1px solid var(--at-line)',
      borderRadius: '14px',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      {/* Tabs: Clientes / Equipo */}
      <div role="tablist" aria-label="Tipo de conversación" style={{ display: 'flex', borderBottom: '1px solid var(--at-line)' }}>
        {([['clientes', `👥 ${clientesTabLabel}`, clientConvCount], ['equipo', '🏢 Equipo', teamConvCount]] as const).map(([tab, label, count]) => {
          const active = convTab === tab
          const color = tab === 'equipo' ? 'var(--at-accent-hover)' : 'var(--at-primary)'
          return (
            <button key={tab} type="button" role="tab" aria-selected={active} onClick={() => onChangeTab(tab)}
              style={{
                flex: 1, padding: '12px 8px', borderTop: 'none', borderRight: 'none', borderLeft: 'none',
                borderBottom: `2px solid ${active ? color : 'transparent'}`, marginBottom: '-1px',
                background: active ? 'var(--at-surface)' : 'var(--at-surface-2)', cursor: 'pointer',
                fontSize: '13.5px', fontWeight: active ? 700 : 500,
                color: active ? color : 'var(--at-ink-3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              }}>
              {label}
              <span style={{
                background: active ? (tab === 'equipo' ? 'var(--at-accent-tint)' : 'var(--at-primary-soft)') : 'var(--at-chip)',
                color: active ? (tab === 'equipo' ? 'var(--at-accent-hover)' : 'var(--at-primary-hover)') : 'var(--at-ink-3)',
                borderRadius: '999px', padding: '1px 8px', fontSize: '11.5px', fontWeight: 700,
              }}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Filtros: una fila en escritorio, buscador arriba en el teléfono (index.css) */}
      <div className="conv-filters" style={{ padding: '12px', borderBottom: '1px solid var(--at-line)' }}>
        <input
          type="search"
          placeholder="🔍  Buscar por asunto o cliente…"
          aria-label="Buscar conversación"
          value={filterText}
          onChange={e => onFilterText(e.target.value)}
          style={fieldStyle}
        />
        <select
          value={filterStatus}
          aria-label="Filtrar por estado"
          onChange={e => onFilterStatus(e.target.value as ConversationStatus | 'todas')}
          style={fieldStyle}
        >
          <option value="todas">Estado: todos</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={filterCategory}
          aria-label="Filtrar por categoría"
          onChange={e => onFilterCategory(e.target.value as ConversationCategory | 'todas')}
          style={fieldStyle}
        >
          <option value="todas">Categoría: todas</option>
          {(serviceType === 'condominios' ? CONDOMINIOS_CATEGORIES : AGUA_CATEGORIES).map(k => (
            <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>
          ))}
        </select>
      </div>

      {/* Lista de conversaciones */}
      {loading ? (
        <div aria-busy="true" aria-label="Cargando conversaciones">
          {[0, 1, 2].map(i => (
            <div key={i} style={{ display: 'flex', gap: '12px', padding: '14px', borderBottom: '1px solid var(--at-line)' }}>
              <Skeleton width={40} height={40} radius="50%" />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '7px' }}>
                <Skeleton width="45%" height={14} />
                <Skeleton width="30%" height={12} />
                <Skeleton width="55%" height={12} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ConversationList
          conversations={visibleConversations}
          activeId={activeConversationId}
          onSelect={onSelect}
          filter={filterText}
          unseenConvIds={unseenConvIds}
        />
      )}
    </div>
  )
}
