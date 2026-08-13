// Bandeja de la administración para los mensajes que los residentes envían
// desde su portal ("Mensajes a la administración", PortalMiUnidadTab).
//
// Por qué existe: esos mensajes se guardan en `mensajes_portal` y hasta ahora el
// ÚNICO lector del lado admin era el mismo PortalMiUnidadTab embebido en "Portal
// Resid.", que es una vista previa del portal — obliga a elegir una unidad del
// desplegable antes de mostrar nada. Con eso, un mensaje nuevo no aparecía en
// ninguna parte del panel: había que adivinar qué unidad escribió. Este tab lo
// invierte: lista TODO el proyecto, con lo nuevo arriba y el hilo a un clic.
//
// El hilo y el cambio a 'respondido' los sigue manejando MensajePortalChatModal
// (misma UI que ve el residente); acá solo se agregan los estados de bandeja
// (leído / cerrado / reabrir).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { notify } from '../../shared/Dialog'
import { EmptyState } from '../../shared/EmptyState'
import { ImageGallery } from '../../shared/ImageGallery'
import { ListaAdjuntos } from '../../shared/FileUploader'
import { MensajePortalChatModal } from './MensajePortalChatModal'
import { updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { fetchConteoComentariosMensajePortal } from '../../../domain/condominios/tabQueries'
import type { MensajePortal, TipoMensajePortal, EstadoMensajePortal, Unidad } from '../../../types'

interface Props {
  mensajes: MensajePortal[]
  unidades: Unidad[]
  /** Firma las respuestas del equipo en el hilo. */
  autorNombre: string
  autorUserId?: string
  /** false → bandeja de solo lectura (sin responder ni mover estados). */
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_CFG: Record<TipoMensajePortal, { label: string; icon: string }> = {
  consulta:   { label: 'Consulta',   icon: '💬' },
  queja:      { label: 'Queja',      icon: '😤' },
  sugerencia: { label: 'Sugerencia', icon: '💡' },
  emergencia: { label: 'Emergencia', icon: '🚨' },
}

const ESTADO_CFG: Record<EstadoMensajePortal, { label: string; bg: string; color: string }> = {
  nuevo:      { label: 'Nuevo',      bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  leido:      { label: 'Leído',      bg: 'var(--at-chip)',         color: 'var(--at-ink-3)' },
  respondido: { label: 'Respondido', bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  cerrado:    { label: 'Cerrado',    bg: 'var(--at-chip)',         color: 'var(--at-ink-3)' },
}

/** 'pendientes' = lo que aún espera al equipo (nuevo + leído): el default. */
type FiltroEstado = 'pendientes' | EstadoMensajePortal | 'todos'

const FILTROS: { id: FiltroEstado; label: string }[] = [
  { id: 'pendientes', label: 'Pendientes' },
  { id: 'nuevo',      label: 'Nuevos' },
  { id: 'respondido', label: 'Respondidos' },
  { id: 'cerrado',    label: 'Cerrados' },
  { id: 'todos',      label: 'Todos' },
]

function fechaCorta(iso: string) {
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function MensajesPortalTab({ mensajes, unidades, autorNombre, autorUserId, canEdit, onRefresh }: Props) {
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('pendientes')
  const [filtroTipo, setFiltroTipo]     = useState<TipoMensajePortal | ''>('')
  const [filtroUnidad, setFiltroUnidad] = useState('')
  const [busqueda, setBusqueda]         = useState('')
  const [conversacion, setConversacion] = useState<MensajePortal | null>(null)
  const [conteoHilos, setConteoHilos]   = useState<Record<string, number>>({})

  // Badge "N respuestas" por tarjeta: un solo conteo para toda la bandeja (los
  // hilos completos se bajan al abrir la conversación).
  const ids = mensajes.map(m => m.id).join(',')
  const cargarConteos = useCallback(async () => {
    setConteoHilos(await fetchConteoComentariosMensajePortal(ids ? ids.split(',') : []))
  }, [ids])
  useEffect(() => { void cargarConteos() }, [cargarConteos])

  function nombreUnidad(m: MensajePortal) {
    return m.unidad_nombre || unidades.find(u => u.id === m.unidad_id)?.nombre || m.unidad_id.slice(0, 8)
  }

  const nuevos      = mensajes.filter(m => m.estado === 'nuevo').length
  const leidos      = mensajes.filter(m => m.estado === 'leido').length
  const respondidos = mensajes.filter(m => m.estado === 'respondido').length

  const lista = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return mensajes
      .filter(m => {
        if (filtroEstado === 'pendientes') { if (m.estado !== 'nuevo' && m.estado !== 'leido') return false }
        else if (filtroEstado !== 'todos' && m.estado !== filtroEstado) return false
        if (filtroTipo && m.tipo !== filtroTipo) return false
        if (filtroUnidad && m.unidad_id !== filtroUnidad) return false
        if (q && !`${m.asunto} ${m.cuerpo} ${m.unidad_nombre ?? ''}`.toLowerCase().includes(q)) return false
        return true
      })
      // Emergencias primero y, dentro de cada grupo, lo más reciente arriba: el
      // orden del query (solo created_at) enterraba una fuga de agua de ayer
      // bajo las consultas de hoy.
      .sort((a, b) => {
        if (a.tipo !== b.tipo && (a.tipo === 'emergencia' || b.tipo === 'emergencia')) {
          return a.tipo === 'emergencia' ? -1 : 1
        }
        return b.created_at.localeCompare(a.created_at)
      })
  }, [mensajes, filtroEstado, filtroTipo, filtroUnidad, busqueda])

  async function cambiarEstado(m: MensajePortal, estado: EstadoMensajePortal) {
    const { error } = await updateCondominioRow('mensajes_portal', m.id, { estado })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  // Abrir el hilo cuenta como leerlo: el mensaje deja de ser "Nuevo" sin que
  // nadie tenga que acordarse de marcarlo.
  function abrirHilo(m: MensajePortal) {
    setConversacion(m)
    if (canEdit && m.estado === 'nuevo') void cambiarEstado(m, 'leido')
  }

  const selectStyle = { padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13, background: 'var(--at-surface)', color: 'var(--at-ink)' }

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Nuevos',      val: nuevos,          bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
          { label: 'Leídos',      val: leidos,          bg: 'var(--at-surface-2)',    color: 'var(--at-ink-2)' },
          { label: 'Respondidos', val: respondidos,     bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
          { label: 'Total',       val: mensajes.length, bg: 'var(--at-surface-2)',    color: 'var(--at-ink-2)' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 11, color: k.color }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        {FILTROS.map(f => (
          <button key={f.id} onClick={() => setFiltroEstado(f.id)} aria-pressed={filtroEstado === f.id}
            style={{
              padding: '6px 13px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
              border: '1.5px solid', borderColor: filtroEstado === f.id ? 'var(--at-primary)' : 'var(--at-line)',
              background: filtroEstado === f.id ? 'var(--at-primary-tint)' : 'var(--at-surface)',
              color: filtroEstado === f.id ? 'var(--at-primary)' : 'var(--at-ink-3)',
            }}>
            {f.label}
          </button>
        ))}
        <select aria-label="Filtrar por tipo" value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as TipoMensajePortal | '')} style={selectStyle}>
          <option value="">Todos los tipos</option>
          {(Object.keys(TIPO_CFG) as TipoMensajePortal[]).map(t => (
            <option key={t} value={t}>{TIPO_CFG[t].icon} {TIPO_CFG[t].label}</option>
          ))}
        </select>
        <select aria-label="Filtrar por unidad" value={filtroUnidad} onChange={e => setFiltroUnidad(e.target.value)} style={selectStyle}>
          <option value="">Todas las unidades</option>
          {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
        <input aria-label="Buscar mensajes" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar asunto o texto…"
          style={{ ...selectStyle, minWidth: 190 }} />
        <span style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>{lista.length} mensaje{lista.length === 1 ? '' : 's'}</span>
      </div>

      {lista.length === 0 ? (
        <EmptyState icon="📭" compact
          title={mensajes.length === 0 ? 'Sin mensajes del portal' : 'Ningún mensaje coincide con el filtro'}
          description={mensajes.length === 0 ? 'Acá aparecen los mensajes que los residentes envían desde su portal.' : undefined} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lista.map(m => {
            const tc = TIPO_CFG[m.tipo] ?? TIPO_CFG.consulta
            const ec = ESTADO_CFG[m.estado] ?? ESTADO_CFG.nuevo
            const nHilo = conteoHilos[m.id] ?? 0
            const urgente = m.tipo === 'emergencia' && m.estado !== 'cerrado'
            return (
              <div key={m.id} style={{
                background: 'var(--at-surface)',
                border: `1.5px solid ${urgente ? 'var(--at-danger-border)' : 'var(--at-line)'}`,
                borderRadius: 12, padding: '14px 16px',
              }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{tc.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 3 }}>
                      <span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--at-ink)' }}>{m.asunto}</span>
                      <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 5 }}>
                      🏠 {nombreUnidad(m)} · {tc.label} · {fechaCorta(m.created_at)}
                    </div>
                    <p style={{ margin: '0 0 5px', fontSize: 13, color: 'var(--at-ink-2)', whiteSpace: 'pre-wrap' }}>{m.cuerpo}</p>
                    {m.foto_urls?.length > 0 && (
                      <div style={{ margin: '6px 0' }}><ImageGallery urls={m.foto_urls} maxVisible={4} /></div>
                    )}
                    {m.archivo_urls?.length > 0 && (
                      <div style={{ margin: '6px 0' }}><ListaAdjuntos paths={m.archivo_urls} /></div>
                    )}
                    {m.respuesta && (
                      <div style={{ background: 'var(--at-success-tint)', border: '1px solid var(--at-success-border)', borderRadius: 8, padding: '8px 12px', marginTop: 6 }}>
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--at-success)', marginBottom: 2 }}>Respuesta de administración:</div>
                        <div style={{ fontSize: 13, color: 'var(--at-ink-2)' }}>{m.respuesta}</div>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
                      <button onClick={() => abrirHilo(m)}
                        style={{ padding: '6px 13px', background: nHilo > 0 ? 'var(--at-primary-tint)' : 'var(--at-chip)', color: nHilo > 0 ? 'var(--at-primary)' : 'var(--at-ink-2)', border: 'none', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        💬 {nHilo > 0 ? `Conversación (${nHilo})` : (canEdit ? 'Responder' : 'Ver conversación')}
                      </button>
                      {canEdit && m.estado === 'nuevo' && (
                        <button onClick={() => cambiarEstado(m, 'leido')}
                          style={{ padding: '6px 13px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                          👁 Marcar leído
                        </button>
                      )}
                      {canEdit && m.estado !== 'cerrado' && (
                        <button onClick={() => cambiarEstado(m, 'cerrado')}
                          style={{ padding: '6px 13px', background: 'var(--at-chip)', color: 'var(--at-ink-3)', border: 'none', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                          ✔ Cerrar
                        </button>
                      )}
                      {canEdit && m.estado === 'cerrado' && (
                        <button onClick={() => cambiarEstado(m, 'leido')}
                          style={{ padding: '6px 13px', background: 'var(--at-chip)', color: 'var(--at-ink-3)', border: 'none', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                          ↩ Reabrir
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {conversacion && (
        <MensajePortalChatModal
          mensaje={conversacion}
          autorNombre={autorNombre}
          autorUserId={autorUserId}
          canWrite={canEdit}
          esStaff
          onClose={() => { setConversacion(null); void cargarConteos() }}
          onRefresh={onRefresh}
        />
      )}
    </div>
  )
}
