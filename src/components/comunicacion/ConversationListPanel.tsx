import { ConversationList } from './ConversationList'
import { CATEGORY_LABELS, STATUS_LABELS } from './conversationConstants'
import { AGUA_CATEGORIES, CONDOMINIOS_CATEGORIES } from '../../types'
import type {
  Conversation,
  ConversationCategory,
  ConversationStatus,
  ConversationServiceType,
} from '../../types'

// Panel izquierdo del centro de comunicación: tabs Clientes/Equipo + filtros +
// lista. Extraído de ComunicacionSection (com:N6) sin cambiar comportamiento.
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

export function ConversationListPanel({
  convTab, onChangeTab, clientesTabLabel, clientConvCount, teamConvCount,
  filterText, onFilterText, filterStatus, onFilterStatus, filterCategory, onFilterCategory,
  serviceType, loading, visibleConversations, activeConversationId, onSelect, unseenConvIds,
}: Props) {
  return (
    <div style={{
      background: 'var(--at-surface)',
      border: '1px solid var(--at-line)',
      borderRadius: '12px',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Tabs: Clientes / Equipo */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--at-chip)' }}>
        {([['clientes', `👥 ${clientesTabLabel}`, clientConvCount], ['equipo', '🏢 Equipo', teamConvCount]] as const).map(([tab, label, count]) => (
          <button key={tab} onClick={() => onChangeTab(tab)}
            style={{
              flex: 1, padding: '10px 8px', border: 'none', borderBottom: `2px solid ${convTab === tab ? (tab === 'equipo' ? 'var(--at-accent-hover)' : 'var(--at-primary)') : 'transparent'}`,
              background: 'var(--at-surface)', cursor: 'pointer', fontSize: '12.5px', fontWeight: convTab === tab ? 700 : 400,
              color: convTab === tab ? (tab === 'equipo' ? 'var(--at-accent-hover)' : 'var(--at-primary)') : 'var(--at-ink-3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
            }}>
            {label}
            <span style={{ background: convTab === tab ? (tab === 'equipo' ? 'var(--at-accent-tint)' : 'var(--at-primary-soft)') : 'var(--at-chip)', color: convTab === tab ? (tab === 'equipo' ? 'var(--at-accent-hover)' : 'var(--at-primary-hover)') : 'var(--at-ink-3)', borderRadius: '999px', padding: '1px 6px', fontSize: '11px', fontWeight: 600 }}>
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--at-chip)' }}>
        <input
          type="text"
          placeholder="Buscar conversación..."
          value={filterText}
          onChange={e => onFilterText(e.target.value)}
          style={{
            width: '100%',
            padding: '7px 10px',
            border: '1px solid var(--at-line)',
            borderRadius: '8px',
            fontSize: '12.5px',
            outline: 'none',
            boxSizing: 'border-box',
            marginBottom: '8px',
          }}
        />
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <select
            value={filterStatus}
            onChange={e => onFilterStatus(e.target.value as ConversationStatus | 'todas')}
            style={{ flex: 1, padding: '5px 8px', border: '1px solid var(--at-line)', borderRadius: '6px', fontSize: '11.5px', outline: 'none' }}
          >
            <option value="todas">Todos los estados</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={filterCategory}
            onChange={e => onFilterCategory(e.target.value as ConversationCategory | 'todas')}
            style={{ flex: 1, padding: '5px 8px', border: '1px solid var(--at-line)', borderRadius: '6px', fontSize: '11.5px', outline: 'none' }}
          >
            <option value="todas">Todas las categorías</option>
            {(serviceType === 'condominios' ? CONDOMINIOS_CATEGORIES : AGUA_CATEGORIES).map(k => (
              <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Lista de conversaciones */}
      <div style={{ flex: 1, overflowY: 'auto', maxHeight: '600px' }}>
        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--at-ink-3)', fontSize: '13px' }}>
            Cargando…
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
    </div>
  )
}
