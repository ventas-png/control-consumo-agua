import { hoyLocalISO } from '../../../lib/format'
import { useState, useMemo } from 'react'
import { updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { confirm, notify } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import { InfraccionCondominio, SugerenciaCondominio, Unidad, EstadoInfraccion, EstadoSugerencia } from '../../../types'

interface Props {
  infracciones: InfraccionCondominio[]
  sugerencias: SugerenciaCondominio[]
  unidades: Unidad[]
  canEdit: boolean
  onRefresh: () => void
}

type FuenteConflicto = 'infracciones' | 'sugerencias'
type FiltroEstado = 'todos' | 'activos' | 'resueltos'

const ESTADO_INF_CFG: Record<EstadoInfraccion, { label: string; color: string; bg: string }> = {
  emitida:      { label: 'Emitida',       color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  notificada:   { label: 'Notificada',    color: 'var(--at-primary)', bg: 'var(--at-primary-tint)' },
  en_descargo:  { label: 'En descargo',   color: 'var(--at-accent-hover)', bg: 'var(--at-accent-tint-2)' },
  resuelta:     { label: 'Resuelta',      color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  anulada:      { label: 'Anulada',       color: 'var(--at-ink-3)', bg: 'var(--at-surface-2)' },
}

const ESTADO_SUG_CFG: Record<EstadoSugerencia, { label: string; color: string; bg: string }> = {
  pendiente:   { label: 'Pendiente',   color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  en_revision: { label: 'En revisión', color: 'var(--at-primary)', bg: 'var(--at-primary-tint)' },
  respondida:  { label: 'Respondida',  color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  archivada:   { label: 'Archivada',   color: 'var(--at-ink-3)', bg: 'var(--at-surface-2)' },
}

const ESTADOS_INF_ACTIVOS: EstadoInfraccion[] = ['emitida', 'notificada', 'en_descargo']
const ESTADOS_SUG_ACTIVOS: EstadoSugerencia[] = ['pendiente', 'en_revision']

export default function GestionConflictosTab({ infracciones, sugerencias, unidades: _unidades, canEdit, onRefresh }: Props) {
  const [fuente, setFuente] = useState<FuenteConflicto>('infracciones')
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('activos')
  const [busqueda, setBusqueda] = useState('')
  const [resolviendo, setResolviendo] = useState<string | null>(null)

  const infActivas = infracciones.filter(i => ESTADOS_INF_ACTIVOS.includes(i.estado)).length
  const sugActivas = sugerencias.filter(s => ESTADOS_SUG_ACTIVOS.includes(s.estado)).length

  const infFiltradas = useMemo(() => {
    let r = [...infracciones]
    if (filtroEstado === 'activos') r = r.filter(i => ESTADOS_INF_ACTIVOS.includes(i.estado))
    else if (filtroEstado === 'resueltos') r = r.filter(i => !ESTADOS_INF_ACTIVOS.includes(i.estado))
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase()
      r = r.filter(i => i.descripcion.toLowerCase().includes(q) || (i.unidad_nombre ?? '').toLowerCase().includes(q) || i.tipo.toLowerCase().includes(q))
    }
    return r.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [infracciones, filtroEstado, busqueda])

  const sugFiltradas = useMemo(() => {
    let r = [...sugerencias]
    if (filtroEstado === 'activos') r = r.filter(s => ESTADOS_SUG_ACTIVOS.includes(s.estado))
    else if (filtroEstado === 'resueltos') r = r.filter(s => !ESTADOS_SUG_ACTIVOS.includes(s.estado))
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase()
      r = r.filter(s => s.titulo.toLowerCase().includes(q) || s.descripcion.toLowerCase().includes(q) || (s.unidad_nombre ?? '').toLowerCase().includes(q))
    }
    return r.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [sugerencias, filtroEstado, busqueda])

  async function avanzarEstadoInfraccion(inf: InfraccionCondominio) {
    const siguiente: Partial<Record<EstadoInfraccion, EstadoInfraccion>> = {
      emitida: 'notificada', notificada: 'en_descargo', en_descargo: 'resuelta',
    }
    const nuevoEstado = siguiente[inf.estado]
    if (!nuevoEstado) return
    const lbl = ESTADO_INF_CFG[nuevoEstado].label
    let resolucion: string | undefined
    if (nuevoEstado === 'resuelta') {
      const result = await openPromptDialog({
        title: `Cambiar a "${lbl}"`,
        description: 'Ingresa la resolución:',
        fields: [{
          name: 'resolucion',
          label: 'Resolución',
          control: 'textarea',
          rows: 4,
          placeholder: 'Descripción de la resolución...',
          required: true,
          autoFocus: true,
        }],
        submitText: 'Confirmar',
      })
      if (!result) return
      resolucion = result.resolucion
    } else {
      const conf = await confirm({ title: `Cambiar a "${lbl}"`, text: '¿Confirmas el cambio de estado?', confirmText: 'Confirmar' })
      if (!conf.isConfirmed) return
    }
    setResolviendo(inf.id)
    const update: Partial<InfraccionCondominio> = { estado: nuevoEstado }
    if (resolucion !== undefined) update.resolucion = resolucion || null
    const { error } = await updateCondominioRow('infracciones_condominio', inf.id, update)
    setResolviendo(null)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  async function responderSugerencia(sug: SugerenciaCondominio) {
    const result = await openPromptDialog({
      title: 'Responder sugerencia',
      fields: [{
        name: 'respuesta',
        label: 'Respuesta',
        control: 'textarea',
        rows: 4,
        placeholder: 'Escribe la respuesta...',
        initialValue: sug.respuesta ?? '',
        required: true,
        autoFocus: true,
      }],
      submitText: 'Guardar respuesta',
    })
    if (!result) return
    const respuesta = result.respuesta
    setResolviendo(sug.id)
    const { error } = await updateCondominioRow('sugerencias_condominio', sug.id, {
      respuesta, estado: 'respondida', fecha_respuesta: hoyLocalISO(),
    })
    setResolviendo(null)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  async function archivarSugerencia(sug: SugerenciaCondominio) {
    const { isConfirmed } = await confirm({ title: 'Archivar sugerencia', text: '¿Archivar esta sugerencia?', confirmText: 'Archivar' })
    if (!isConfirmed) return
    setResolviendo(sug.id)
    const { error } = await updateCondominioRow('sugerencias_condominio', sug.id, { estado: 'archivada' })
    setResolviendo(null)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)', marginBottom: 2 }}>Gestión de Conflictos</div>
      <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 14 }}>
        {infActivas} infracciones activas · {sugActivas} sugerencias/quejas pendientes
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { label: 'Infracciones activas',  val: String(infActivas),  color: infActivas > 0 ? 'var(--at-danger)' : 'var(--at-success)', bg: infActivas > 0 ? 'var(--at-danger-tint)' : 'var(--at-success-tint)' },
          { label: 'Infracciones resueltas', val: String(infracciones.filter(i => i.estado === 'resuelta').length), color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
          { label: 'Sugerencias pendientes', val: String(sugActivas), color: sugActivas > 5 ? 'var(--at-danger)' : 'var(--at-warning)', bg: sugActivas > 5 ? 'var(--at-danger-tint)' : 'var(--at-warning-tint)' },
          { label: 'Sugerencias respondidas', val: String(sugerencias.filter(s => s.estado === 'respondida').length), color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
        ].map(k => (
          <div key={k.label} style={{ flex: '1 1 120px', background: k.bg, border: `1px solid ${k.color}33`, borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{k.label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Selector de fuente */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {([['infracciones', `⚖️ Infracciones (${infracciones.length})`], ['sugerencias', `💡 Sugerencias/Quejas (${sugerencias.length})`]] as const).map(([f, lbl]) => (
          <button key={f} onClick={() => setFuente(f)}
            style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 12, cursor: 'pointer',
              background: fuente === f ? 'var(--at-ink)' : 'var(--at-surface-2)', color: fuente === f ? 'white' : 'var(--at-ink-2)', fontWeight: fuente === f ? 700 : 400 }}>
            {lbl}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['todos', 'activos', 'resueltos'] as const).map(f => (
            <button key={f} onClick={() => setFiltroEstado(f)}
              style={{ padding: '4px 12px', borderRadius: 20, border: '1px solid var(--at-line-strong)', fontSize: 11, cursor: 'pointer',
                background: filtroEstado === f ? 'var(--at-ink-2)' : 'var(--at-surface-2)', color: filtroEstado === f ? 'white' : 'var(--at-ink-2)', fontWeight: filtroEstado === f ? 700 : 400 }}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar..." style={{ flex: 1, minWidth: 180, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 12, outline: 'none' }} />
      </div>

      {/* Lista de infracciones */}
      {fuente === 'infracciones' && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, overflow: 'hidden' }}>
          {infFiltradas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--at-ink-3)', fontSize: 12 }}>Sin infracciones en este filtro.</div>
          ) : infFiltradas.map((inf, i) => {
            const cfg = ESTADO_INF_CFG[inf.estado]
            const sig: Partial<Record<EstadoInfraccion, EstadoInfraccion>> = { emitida: 'notificada', notificada: 'en_descargo', en_descargo: 'resuelta' }
            const puedeAvanzar = canEdit && !!sig[inf.estado]
            return (
              <div key={inf.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                padding: '12px 14px', borderBottom: i < infFiltradas.length - 1 ? '1px solid var(--at-chip)' : undefined }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: cfg.color, background: cfg.bg,
                      padding: '2px 8px', borderRadius: 10, border: `1px solid ${cfg.color}33` }}>{cfg.label}</span>
                    <span style={{ fontSize: 11, color: 'var(--at-ink-2)', fontWeight: 600 }}>{inf.tipo.replace('_', ' ')}</span>
                    {inf.unidad_nombre && <span style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>· {inf.unidad_nombre}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--at-ink)', marginBottom: 2 }}>{inf.descripcion}</div>
                  <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>
                    {inf.fecha_infraccion}
                    {inf.monto_multa && <span> · Multa: ${inf.monto_multa.toFixed(2)}</span>}
                    {inf.resolucion && <span style={{ color: 'var(--at-success)', fontWeight: 600 }}> · Resolución: {inf.resolucion.slice(0, 60)}</span>}
                  </div>
                </div>
                {puedeAvanzar && (
                  <button onClick={() => avanzarEstadoInfraccion(inf)} disabled={resolviendo === inf.id}
                    style={{ marginLeft: 10, padding: '5px 12px', borderRadius: 7, border: `1px solid ${cfg.color}`, fontSize: 11,
                      background: cfg.bg, color: cfg.color, cursor: 'pointer', fontWeight: 700, flexShrink: 0 }}>
                    {resolviendo === inf.id ? '…' : `→ ${ESTADO_INF_CFG[sig[inf.estado]!].label}`}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Lista de sugerencias */}
      {fuente === 'sugerencias' && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, overflow: 'hidden' }}>
          {sugFiltradas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--at-ink-3)', fontSize: 12 }}>Sin sugerencias en este filtro.</div>
          ) : sugFiltradas.map((sug, i) => {
            const cfg = ESTADO_SUG_CFG[sug.estado]
            return (
              <div key={sug.id} style={{ padding: '12px 14px', borderBottom: i < sugFiltradas.length - 1 ? '1px solid var(--at-chip)' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: cfg.color, background: cfg.bg,
                        padding: '2px 8px', borderRadius: 10, border: `1px solid ${cfg.color}33` }}>{cfg.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--at-ink-2)', fontWeight: 600 }}>{sug.categoria}</span>
                      {sug.unidad_nombre && <span style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>· {sug.unidad_nombre}</span>}
                      {sug.anonima && <span style={{ fontSize: 9, color: 'var(--at-ink-3)', fontStyle: 'italic' }}>anónima</span>}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink)', marginBottom: 2 }}>{sug.titulo}</div>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-2)', marginBottom: sug.respuesta ? 6 : 0 }}>{sug.descripcion}</div>
                    {sug.respuesta && (
                      <div style={{ fontSize: 11, color: 'var(--at-success)', background: 'var(--at-success-tint)', padding: '5px 8px', borderRadius: 6, marginTop: 4 }}>
                        <strong>Respuesta:</strong> {sug.respuesta}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginTop: 3 }}>{sug.created_at.slice(0, 10)}</div>
                  </div>
                  {canEdit && (sug.estado === 'pendiente' || sug.estado === 'en_revision') && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 10, flexShrink: 0 }}>
                      <button onClick={() => responderSugerencia(sug)} disabled={resolviendo === sug.id}
                        style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid var(--at-success)', fontSize: 11,
                          background: 'var(--at-success-tint)', color: 'var(--at-success)', cursor: 'pointer', fontWeight: 700 }}>
                        {resolviendo === sug.id ? '…' : '✏ Responder'}
                      </button>
                      <button onClick={() => archivarSugerencia(sug)} disabled={resolviendo === sug.id}
                        style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid var(--at-line-strong)', fontSize: 11,
                          background: 'var(--at-surface-2)', color: 'var(--at-ink-3)', cursor: 'pointer', fontWeight: 600 }}>
                        Archivar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
