import { useState, useMemo } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
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
  emitida:      { label: 'Emitida',       color: '#d97706', bg: '#fef3c7' },
  notificada:   { label: 'Notificada',    color: '#2563eb', bg: '#eff6ff' },
  en_descargo:  { label: 'En descargo',   color: '#7c3aed', bg: '#f5f3ff' },
  resuelta:     { label: 'Resuelta',      color: '#16a34a', bg: '#dcfce7' },
  anulada:      { label: 'Anulada',       color: '#9ca3af', bg: '#f8fafc' },
}

const ESTADO_SUG_CFG: Record<EstadoSugerencia, { label: string; color: string; bg: string }> = {
  pendiente:   { label: 'Pendiente',   color: '#d97706', bg: '#fef3c7' },
  en_revision: { label: 'En revisión', color: '#2563eb', bg: '#eff6ff' },
  respondida:  { label: 'Respondida',  color: '#16a34a', bg: '#dcfce7' },
  archivada:   { label: 'Archivada',   color: '#9ca3af', bg: '#f8fafc' },
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
    const confirm = await Swal.fire({
      title: `Cambiar a "${lbl}"`,
      text: nuevoEstado === 'resuelta' ? 'Ingresa la resolución:' : '¿Confirmas el cambio de estado?',
      input: nuevoEstado === 'resuelta' ? 'textarea' : undefined,
      inputPlaceholder: 'Descripción de la resolución...',
      showCancelButton: true,
      confirmButtonColor: '#0f172a',
      confirmButtonText: 'Confirmar',
      cancelButtonText: 'Cancelar',
    })
    if (!confirm.isConfirmed) return
    setResolviendo(inf.id)
    const update: Partial<InfraccionCondominio> = { estado: nuevoEstado }
    if (nuevoEstado === 'resuelta') update.resolucion = confirm.value as string || null
    const { error } = await supabase.from('infracciones_condominio').update(update).eq('id', inf.id)
    setResolviendo(null)
    if (error) return Swal.fire({ icon: 'error', title: 'Error', text: error.message, confirmButtonColor: '#2563eb' })
    onRefresh()
  }

  async function responderSugerencia(sug: SugerenciaCondominio) {
    const { value: respuesta, isConfirmed } = await Swal.fire({
      title: 'Responder sugerencia',
      input: 'textarea',
      inputPlaceholder: 'Escribe la respuesta...',
      inputValue: sug.respuesta ?? '',
      showCancelButton: true,
      confirmButtonColor: '#0f172a',
      confirmButtonText: 'Guardar respuesta',
      cancelButtonText: 'Cancelar',
    })
    if (!isConfirmed) return
    setResolviendo(sug.id)
    const { error } = await supabase.from('sugerencias_condominio').update({
      respuesta, estado: 'respondida', fecha_respuesta: new Date().toISOString().slice(0, 10),
    }).eq('id', sug.id)
    setResolviendo(null)
    if (error) return Swal.fire({ icon: 'error', title: 'Error', text: error.message, confirmButtonColor: '#2563eb' })
    onRefresh()
  }

  async function archivarSugerencia(sug: SugerenciaCondominio) {
    const { isConfirmed } = await Swal.fire({
      title: 'Archivar sugerencia',
      text: '¿Archivar esta sugerencia?',
      showCancelButton: true,
      confirmButtonColor: '#6b7280',
      confirmButtonText: 'Archivar',
      cancelButtonText: 'Cancelar',
    })
    if (!isConfirmed) return
    setResolviendo(sug.id)
    const { error } = await supabase.from('sugerencias_condominio').update({ estado: 'archivada' }).eq('id', sug.id)
    setResolviendo(null)
    if (error) return Swal.fire({ icon: 'error', title: 'Error', text: error.message, confirmButtonColor: '#2563eb' })
    onRefresh()
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 2 }}>Gestión de Conflictos</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>
        {infActivas} infracciones activas · {sugActivas} sugerencias/quejas pendientes
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { label: 'Infracciones activas',  val: String(infActivas),  color: infActivas > 0 ? '#ef4444' : '#16a34a', bg: infActivas > 0 ? '#fef2f2' : '#dcfce7' },
          { label: 'Infracciones resueltas', val: String(infracciones.filter(i => i.estado === 'resuelta').length), color: '#16a34a', bg: '#dcfce7' },
          { label: 'Sugerencias pendientes', val: String(sugActivas), color: sugActivas > 5 ? '#ef4444' : '#d97706', bg: sugActivas > 5 ? '#fef2f2' : '#fef3c7' },
          { label: 'Sugerencias respondidas', val: String(sugerencias.filter(s => s.estado === 'respondida').length), color: '#16a34a', bg: '#dcfce7' },
        ].map(k => (
          <div key={k.label} style={{ flex: '1 1 120px', background: k.bg, border: `1px solid ${k.color}33`, borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: '#6b7280' }}>{k.label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Selector de fuente */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {([['infracciones', `⚖️ Infracciones (${infracciones.length})`], ['sugerencias', `💡 Sugerencias/Quejas (${sugerencias.length})`]] as const).map(([f, lbl]) => (
          <button key={f} onClick={() => setFuente(f)}
            style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 12, cursor: 'pointer',
              background: fuente === f ? '#0f172a' : '#f8fafc', color: fuente === f ? '#fff' : '#374151', fontWeight: fuente === f ? 700 : 400 }}>
            {lbl}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['todos', 'activos', 'resueltos'] as const).map(f => (
            <button key={f} onClick={() => setFiltroEstado(f)}
              style={{ padding: '4px 12px', borderRadius: 20, border: '1px solid #d1d5db', fontSize: 11, cursor: 'pointer',
                background: filtroEstado === f ? '#374151' : '#f8fafc', color: filtroEstado === f ? '#fff' : '#374151', fontWeight: filtroEstado === f ? 700 : 400 }}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar..." style={{ flex: 1, minWidth: 180, padding: '5px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 12, outline: 'none' }} />
      </div>

      {/* Lista de infracciones */}
      {fuente === 'infracciones' && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
          {infFiltradas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af', fontSize: 12 }}>Sin infracciones en este filtro.</div>
          ) : infFiltradas.map((inf, i) => {
            const cfg = ESTADO_INF_CFG[inf.estado]
            const sig: Partial<Record<EstadoInfraccion, EstadoInfraccion>> = { emitida: 'notificada', notificada: 'en_descargo', en_descargo: 'resuelta' }
            const puedeAvanzar = canEdit && !!sig[inf.estado]
            return (
              <div key={inf.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                padding: '12px 14px', borderBottom: i < infFiltradas.length - 1 ? '1px solid #f1f5f9' : undefined }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: cfg.color, background: cfg.bg,
                      padding: '2px 8px', borderRadius: 10, border: `1px solid ${cfg.color}33` }}>{cfg.label}</span>
                    <span style={{ fontSize: 11, color: '#374151', fontWeight: 600 }}>{inf.tipo.replace('_', ' ')}</span>
                    {inf.unidad_nombre && <span style={{ fontSize: 10, color: '#6b7280' }}>· {inf.unidad_nombre}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#0f172a', marginBottom: 2 }}>{inf.descripcion}</div>
                  <div style={{ fontSize: 10, color: '#9ca3af' }}>
                    {inf.fecha_infraccion}
                    {inf.monto_multa && <span> · Multa: ${inf.monto_multa.toFixed(2)}</span>}
                    {inf.resolucion && <span style={{ color: '#16a34a', fontWeight: 600 }}> · Resolución: {inf.resolucion.slice(0, 60)}</span>}
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
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
          {sugFiltradas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af', fontSize: 12 }}>Sin sugerencias en este filtro.</div>
          ) : sugFiltradas.map((sug, i) => {
            const cfg = ESTADO_SUG_CFG[sug.estado]
            return (
              <div key={sug.id} style={{ padding: '12px 14px', borderBottom: i < sugFiltradas.length - 1 ? '1px solid #f1f5f9' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: cfg.color, background: cfg.bg,
                        padding: '2px 8px', borderRadius: 10, border: `1px solid ${cfg.color}33` }}>{cfg.label}</span>
                      <span style={{ fontSize: 11, color: '#374151', fontWeight: 600 }}>{sug.categoria}</span>
                      {sug.unidad_nombre && <span style={{ fontSize: 10, color: '#6b7280' }}>· {sug.unidad_nombre}</span>}
                      {sug.anonima && <span style={{ fontSize: 9, color: '#9ca3af', fontStyle: 'italic' }}>anónima</span>}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', marginBottom: 2 }}>{sug.titulo}</div>
                    <div style={{ fontSize: 11, color: '#374151', marginBottom: sug.respuesta ? 6 : 0 }}>{sug.descripcion}</div>
                    {sug.respuesta && (
                      <div style={{ fontSize: 11, color: '#16a34a', background: '#f0fdf4', padding: '5px 8px', borderRadius: 6, marginTop: 4 }}>
                        <strong>Respuesta:</strong> {sug.respuesta}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 3 }}>{sug.created_at.slice(0, 10)}</div>
                  </div>
                  {canEdit && (sug.estado === 'pendiente' || sug.estado === 'en_revision') && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 10, flexShrink: 0 }}>
                      <button onClick={() => responderSugerencia(sug)} disabled={resolviendo === sug.id}
                        style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid #16a34a', fontSize: 11,
                          background: '#dcfce7', color: '#16a34a', cursor: 'pointer', fontWeight: 700 }}>
                        {resolviendo === sug.id ? '…' : '✏ Responder'}
                      </button>
                      <button onClick={() => archivarSugerencia(sug)} disabled={resolviendo === sug.id}
                        style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 11,
                          background: '#f8fafc', color: '#6b7280', cursor: 'pointer', fontWeight: 600 }}>
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
