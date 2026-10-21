import { useState, useEffect, useMemo } from 'react'
import type { Broadcast, Cliente, Proyecto, Unidad } from '../../types'
import { useBroadcasts } from '../../hooks/useBroadcasts'
import { fetchBroadcastEmailStats, type BroadcastEmailStats } from '../../domain/comunicacion/broadcasts'
import { filterBroadcastsByProjectAccess, type ProjectScope } from '../../lib/comunicacionAccess'
import { Button } from '../shared/Button'
import { EmptyState } from '../shared/EmptyState'
import { Skeleton } from '../shared/Skeleton'
import { NuevoComunicadoModal, TARGET_LABELS } from './NuevoComunicadoModal'
import { BroadcastDetailModal, ReadBar, formatBroadcastDate, readPct } from './BroadcastDetailModal'

interface Props {
  /** Padrón seleccionable como audiencia (ya acotado a los proyectos accesibles). */
  clientes: Cliente[]
  proyectos: Proyecto[]
  /** Unidades seleccionables como audiencia (acotadas). */
  unidades: Unidad[]
  /**
   * Unidades de la empresa SIN acotar: se usan solo para resolver a qué proyecto
   * apuntaba un comunicado ya enviado (`target_type='unidades'`). Sin ellas, un
   * comunicado dirigido a unidades de otro proyecto quedaría "no resoluble" y se
   * mostraría por la regla de ambigüedad.
   */
  todasLasUnidades?: Unidad[]
  /** Scope por proyecto del usuario (ver lib/comunicacionAccess). */
  scope: ProjectScope
  canCreate: boolean
}

// ── Fila de la lista ──────────────────────────────────────────────────────────
// Resumen del comunicado; el mensaje completo y las estadísticas se abren en
// ventana emergente (BroadcastDetailModal).

function BroadcastRow({ broadcast, emailStats, onOpen }: {
  broadcast: Broadcast
  emailStats?: BroadcastEmailStats
  onOpen: () => void
}) {
  const pct = readPct(broadcast)
  return (
    <button
      type="button"
      className="conv-row"
      onClick={onOpen}
      style={{
        width: '100%', textAlign: 'left', cursor: 'pointer', color: 'var(--at-ink)',
        background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '14px',
        padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: '12px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <span aria-hidden="true" style={{
        width: '40px', height: '40px', borderRadius: '12px', flexShrink: 0,
        background: 'var(--at-primary-soft)', color: 'var(--at-primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="19" height="19" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
            d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
        </svg>
      </span>

      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontWeight: 700, fontSize: '14.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {broadcast.title}
        </span>
        <span style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {broadcast.body}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '2px', fontSize: '11.5px', color: 'var(--at-ink-3)' }}>
          <span style={{ padding: '2px 8px', borderRadius: '999px', fontWeight: 600, background: 'var(--at-chip)', color: 'var(--at-ink-2)' }}>
            {TARGET_LABELS[broadcast.target_type]}
          </span>
          {broadcast.send_email && (
            <span
              title={emailStats ? `${emailStats.enviados} enviados · ${emailStats.abiertos} abiertos` : undefined}
              style={{ padding: '2px 8px', borderRadius: '999px', fontWeight: 600, background: 'var(--at-info-tint)', color: 'var(--at-info-strong)' }}
            >
              📧 Email
            </span>
          )}
          <span>{formatBroadcastDate(broadcast.created_at)} · {broadcast.sent_by_name}</span>
        </span>
        {/* Lectura en el portal, de un vistazo */}
        <span style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
          <span style={{ flex: 1, maxWidth: '220px' }}><ReadBar pct={pct} /></span>
          <span style={{ fontSize: '12px', color: 'var(--at-ink-2)', whiteSpace: 'nowrap' }}>
            <strong style={{ color: 'var(--at-success-strong)' }}>{broadcast.read_count ?? 0}</strong> de {broadcast.recipient_count} leídos
          </span>
        </span>
      </span>

      <svg width="16" height="16" fill="none" stroke="var(--at-ink-3)" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0, alignSelf: 'center' }}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  )
}

// ── Main tab ───────────────────────────────────────────────────────────────────

export default function DifusionTab({ clientes, proyectos, unidades, todasLasUnidades, scope, canCreate }: Props) {
  const { broadcasts: allBroadcasts, loading, error, loadBroadcasts } = useBroadcasts()
  const [showModal, setShowModal] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [emailStats, setEmailStats] = useState<Record<string, BroadcastEmailStats>>({})

  useEffect(() => { loadBroadcasts() }, [loadBroadcasts])

  // `broadcasts` solo se acota por empresa (RLS staff_broadcasts_all), así que el
  // histórico llegaba completo. Aquí se reconstruye la audiencia de cada
  // comunicado (proyecto / unidades / clientes) y se deja solo lo que toca a los
  // proyectos del usuario.
  const broadcasts = useMemo(
    () => filterBroadcastsByProjectAccess({
      broadcasts: allBroadcasts,
      scope,
      unidades: todasLasUnidades ?? unidades,
    }),
    [allBroadcasts, scope, todasLasUnidades, unidades],
  )

  // Stats de entrega de los emails (com:N4): una sola query al outbox por lote
  // de comunicados con email. Degrada a {} (sin stats) si la RLS no aplica al rol.
  useEffect(() => {
    const ids = broadcasts.filter(b => b.send_email).map(b => b.id)
    if (ids.length === 0) { setEmailStats({}); return }
    let cancelled = false
    fetchBroadcastEmailStats(ids).then(stats => { if (!cancelled) setEmailStats(stats) })
    return () => { cancelled = true }
  }, [broadcasts])

  const opened = openId ? broadcasts.find(b => b.id === openId) ?? null : null

  return (
    <div style={{ maxWidth: '820px', width: '100%', margin: '0 auto', padding: '4px 0 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--at-ink)' }}>Difusión</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--at-ink-3)' }}>
            Comunicados masivos que tus clientes ven en su portal
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setShowModal(true)}>
            + Nuevo comunicado
          </Button>
        )}
      </div>

      {/* List */}
      {loading && (
        <div aria-busy="true" aria-label="Cargando comunicados" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ display: 'flex', gap: '12px', padding: '14px 16px', background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '14px' }}>
              <Skeleton width={40} height={40} radius={12} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Skeleton width="45%" height={14} />
                <Skeleton width="70%" height={12} />
                <Skeleton width="30%" height={6} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Un fallo de carga NO debe verse como "no hay comunicados": se distingue
          el vacío real del error, y se ofrece reintentar. */}
      {!loading && error && (
        <div style={{
          textAlign: 'center', padding: '40px 24px',
          background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '16px',
        }}>
          <div style={{ fontSize: '34px', marginBottom: '10px' }}>⚠️</div>
          <p style={{ margin: 0, color: 'var(--at-danger)', fontWeight: 700, fontSize: '14px' }}>
            No se pudieron cargar los comunicados
          </p>
          <p style={{ margin: '6px 0 14px', color: 'var(--at-ink-3)', fontSize: '13px' }}>{error}</p>
          <Button variant="secondary" size="sm" onClick={loadBroadcasts}>Reintentar</Button>
        </div>
      )}

      {!loading && !error && broadcasts.length === 0 && (
        <div style={{ background: 'var(--at-surface)', border: '1px dashed var(--at-line)', borderRadius: '16px' }}>
          <EmptyState
            icon="📣"
            title="No hay comunicados enviados todavía"
            description="Avisa a tus clientes de cortes, mantenimientos o novedades: lo verán en su portal."
            action={canCreate ? <Button variant="primary" onClick={() => setShowModal(true)}>+ Nuevo comunicado</Button> : undefined}
          />
        </div>
      )}

      {!loading && !error && broadcasts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {broadcasts.map(b => (
            <BroadcastRow key={b.id} broadcast={b} emailStats={emailStats[b.id]} onOpen={() => setOpenId(b.id)} />
          ))}
        </div>
      )}

      {opened && (
        <BroadcastDetailModal
          broadcast={opened}
          emailStats={emailStats[opened.id]}
          onClose={() => setOpenId(null)}
        />
      )}

      {showModal && (
        <NuevoComunicadoModal
          clientes={clientes}
          proyectos={proyectos}
          unidades={unidades}
          onClose={() => setShowModal(false)}
          onSent={loadBroadcasts}
        />
      )}
    </div>
  )
}
