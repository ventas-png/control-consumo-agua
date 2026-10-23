import { useState, useEffect, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { fetchVotosVotacion } from '../../../domain/condominios/tabQueries'
import type { Votacion, Voto, Unidad } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'

interface Props {
  votaciones: Votacion[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

interface FormState {
  titulo: string; descripcion: string
  opciones: { id: string; texto: string }[]
  quorum_requerido: number; fecha_cierre: string
}
const BLANK: FormState = {
  titulo: '', descripcion: '',
  opciones: [{ id: '1', texto: '' }, { id: '2', texto: '' }],
  quorum_requerido: 0, fecha_cierre: '',
}

const ESTADO_COLORS: Record<string, { bg: string; color: string }> = {
  abierta: { bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  cerrada: { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
  anulada: { bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
}

export function VotacionesTab({ votaciones, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [votos, setVotos] = useState<Voto[]>([])
  const [loadingVotos, setLoadingVotos] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [selUnidad, setSelUnidad] = useState('')
  const [selOpcion, setSelOpcion] = useState('')
  const [registering, setRegistering] = useState(false)

  const votacion = votaciones.find(v => v.id === selected)

  useEffect(() => {
    if (!selected) return
    setLoadingVotos(true)
    void fetchVotosVotacion(selected).then(data => {
      setVotos(data.map((r: Record<string, unknown>) => ({
        ...r, unidad_nombre: (r.unidades as { nombre: string } | null)?.nombre,
      } as Voto)))
      setLoadingVotos(false)
    })
  }, [selected])

  async function handleSave() {
    if (!form.titulo.trim()) return notify({ variant: 'warning', title: 'Requerido', text: 'El título es obligatorio.' })
    if (form.opciones.some(o => !o.texto.trim())) return notify({ variant: 'warning', title: 'Requerido', text: 'Completa todas las opciones.' })
    setSaving(true)
    const { error } = await createCondominioRow('votaciones', {
      company_id: companyId, project_id: proyectoId,
      titulo: form.titulo.trim(), descripcion: form.descripcion || null,
      opciones: form.opciones.map(o => ({ id: o.id, texto: o.texto.trim() })),
      quorum_requerido: form.quorum_requerido || null,
      total_unidades: unidades.length,
      fecha_cierre: form.fecha_cierre || null,
      estado: 'abierta',
    })
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); setForm({ ...BLANK }); onRefresh()
  }

  async function handleVotar() {
    if (!selected || !selUnidad || !selOpcion) return notify({ variant: 'warning', title: 'Requerido', text: 'Selecciona unidad y opción.' })
    if (votos.some(v => v.unidad_id === selUnidad)) return notify({ variant: 'info', title: 'Ya votó', text: 'Esta unidad ya registró su voto.' })
    setRegistering(true)
    const { error } = await createCondominioRow('votos', { company_id: companyId, votacion_id: selected, unidad_id: selUnidad, opcion_id: selOpcion })
    setRegistering(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setSelUnidad(''); setSelOpcion('')
    const data = await fetchVotosVotacion(selected)
    setVotos(data.map((r: Record<string, unknown>) => ({ ...r, unidad_nombre: (r.unidades as { nombre: string } | null)?.nombre } as Voto)))
  }

  async function handleCerrar(id: string) {
    const r = await confirm({ title: '¿Cerrar votación?', text: 'No se podrán registrar más votos.', icon: 'warning', variant: 'danger', confirmText: 'Cerrar' })
    if (!r.isConfirmed) return
    // El conteo, el resultado y la fecha de cierre los escribe la base
    // (votaciones_tg_integridad, 20261106000300): antes los calculaba el
    // navegador con los votos que alcanzaba a ver.
    const { error } = await updateCondominioRow('votaciones', id, { estado: 'cerrada' })
    if (error) return notify({ variant: 'error', title: 'No se cerró la votación', text: error.message })
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }

  const totalVotos = votos.length
  const counts = votacion ? votacion.opciones.map(o => ({ id: o.id, texto: o.texto, count: votos.filter(v => v.opcion_id === o.id).length })) : []
  const maxCount = Math.max(...counts.map(c => c.count), 1)

  function cerrarForm() {
    if (saving) return
    setShowForm(false)
  }

  function cerrarDetalle() {
    setSelected(null)
    // Sin esto, al abrir otra votación se veían un instante los votos de la
    // anterior (y faltaban esas unidades en "Registrar voto").
    setVotos([])
  }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Votaciones</h2>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>Consultas a los propietarios entre asambleas (en asamblea se votan los puntos)</p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(true)}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nueva Votación
          </button>
        )}
      </div>

      {/* Form en ventana: antes se desplegaba arriba de la lista y en el
          teléfono la empujaba fuera de la vista. */}
      {showForm && (
        <EditModal
          title="Nueva votación"
          maxWidth="640px"
          fullScreenOnMobile
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          onClose={cerrarForm}
          footer={<>
            <Button variant="secondary" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} loading={saving} loadingText="Guardando…">Crear Votación</Button>
          </>}
        >
          {/* `1 / -1` y no `span 2`: con una sola columna (teléfono) el span
              creaba una columna implícita y el campo se salía de la ventana. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="vot-titulo" style={labelStyle}>Título *</label>
              <input id="vot-titulo" style={inputStyle} value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Ej: Aprobación del presupuesto 2026" autoFocus />
            </div>
            <div>
              <label htmlFor="vot-quorum" style={labelStyle}>Mínimo de votos</label>
              <input id="vot-quorum" style={inputStyle} type="number" min="0" value={form.quorum_requerido} onChange={e => setForm(f => ({ ...f, quorum_requerido: parseInt(e.target.value) || 0 }))} placeholder="0 = sin mínimo" />
            </div>
            <div>
              <label htmlFor="vot-cierre" style={labelStyle}>Fecha de cierre</label>
              <input id="vot-cierre" style={inputStyle} type="datetime-local" value={form.fecha_cierre} onChange={e => setForm(f => ({ ...f, fecha_cierre: e.target.value }))} />
            </div>
          </div>
          <div style={{ marginTop: '12px' }}>
            <div style={{ ...labelStyle, marginBottom: '6px' }}>Opciones de voto *</div>
            {form.opciones.map((op, i) => (
              <div key={op.id} style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                <input style={{ ...inputStyle, flex: 1, minWidth: 0 }} value={op.texto}
                  onChange={e => setForm(f => ({ ...f, opciones: f.opciones.map((o, j) => j === i ? { ...o, texto: e.target.value } : o) }))}
                  placeholder={`Opción ${i + 1}`} aria-label={`Opción ${i + 1}`} />
                {form.opciones.length > 2 && (
                  <button onClick={() => setForm(f => ({ ...f, opciones: f.opciones.filter((_, j) => j !== i) }))} aria-label={`Quitar opción ${i + 1}`}
                    style={{ padding: '6px 10px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>✕</button>
                )}
              </div>
            ))}
            <button onClick={() => setForm(f => ({ ...f, opciones: [...f.opciones, { id: String(Date.now()), texto: '' }] }))}
              style={{ padding: '5px 12px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>
              + Agregar opción
            </button>
          </div>
        </EditModal>
      )}

      {/* Lista — cada votación se abre en ventana. Antes el detalle iba al
          lado de una columna fija de 300px que en el teléfono partía la
          pantalla y dejaba los resultados fuera de la vista. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {votaciones.length === 0 ? (
          <EmptyState icon="📋" title="No hay votaciones. Crea una para comenzar" />
        ) : (
          votaciones.map(v => {
            const ec = ESTADO_COLORS[v.estado] ?? { bg: 'var(--at-chip)', color: 'var(--at-ink-3)' }
            return (
              <button key={v.id} type="button" onClick={() => setSelected(v.id)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', cursor: 'pointer' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--at-ink)', marginBottom: '2px' }}>{v.titulo}</div>
                  <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{v.fecha_inicio.slice(0, 10)} · {v.opciones.length} opciones</div>
                  {v.resultado && <div style={{ fontSize: '11px', color: 'var(--at-primary-hover)', fontWeight: 600, marginTop: '2px' }}>→ {v.resultado}</div>}
                </div>
                <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: ec.bg, color: ec.color, flexShrink: 0 }}>
                  {v.estado}
                </span>
              </button>
            )
          })
        )}
      </div>

      {/* Detalle en ventana (a pantalla completa en el teléfono). */}
      {votacion && (() => {
        const ec = ESTADO_COLORS[votacion.estado] ?? { bg: 'var(--at-chip)', color: 'var(--at-ink-3)' }
        return (
          <EditModal
            title={votacion.titulo}
            subtitle={<span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: ec.bg, color: ec.color }}>{votacion.estado}</span>
              <span>{votacion.fecha_inicio.slice(0, 10)} · {votacion.opciones.length} opciones</span>
            </span>}
            maxWidth="640px"
            fullScreenOnMobile
            onClose={cerrarDetalle}
            footer={canEdit && votacion.estado === 'abierta' ? (
              <Button variant="danger" onClick={() => handleCerrar(votacion.id)}>Cerrar votación</Button>
            ) : undefined}
          >
            {votacion.descripcion && <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--at-ink-3)', whiteSpace: 'pre-wrap' }}>{votacion.descripcion}</p>}

            {/* Results */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '10px' }}>
                Resultados · {totalVotos} voto(s) de {votacion.total_unidades ?? unidades.length} unidades
                {votacion.quorum_requerido ? ` · Mínimo: ${votacion.quorum_requerido} votos` : ''}
              </div>
              {loadingVotos ? (
                <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>Cargando votos…</div>
              ) : (
                counts.map(c => (
                  <div key={c.id} style={{ marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '12px', marginBottom: '3px' }}>
                      <span style={{ fontWeight: 600 }}>{c.texto}</span>
                      <span style={{ color: 'var(--at-ink-3)', whiteSpace: 'nowrap' }}>{c.count} · {totalVotos > 0 ? Math.round(c.count / totalVotos * 100) : 0}%</span>
                    </div>
                    <div style={{ height: '8px', background: 'var(--at-chip)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: '4px', transition: 'width 0.3s',
                        background: c.count === maxCount && c.count > 0 ? 'var(--at-success)' : 'var(--at-primary)',
                        width: `${totalVotos > 0 ? c.count / totalVotos * 100 : 0}%` }} />
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Register vote */}
            {canCreate && votacion.estado === 'abierta' && (
              <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink)', marginBottom: '8px' }}>Registrar voto</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px', marginBottom: '8px' }}>
                  <div>
                    <label htmlFor="vot-voto-unidad" style={labelStyle}>Unidad</label>
                    <select id="vot-voto-unidad" style={inputStyle} value={selUnidad} onChange={e => setSelUnidad(e.target.value)}>
                      <option value="">— Seleccionar —</option>
                      {unidades.filter(u => !votos.some(v => v.unidad_id === u.id)).map(u => (
                        <option key={u.id} value={u.id}>{u.nombre}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="vot-voto-opcion" style={labelStyle}>Opción</label>
                    <select id="vot-voto-opcion" style={inputStyle} value={selOpcion} onChange={e => setSelOpcion(e.target.value)}>
                      <option value="">— Seleccionar —</option>
                      {votacion.opciones.map(o => <option key={o.id} value={o.id}>{o.texto}</option>)}
                    </select>
                  </div>
                </div>
                <button onClick={handleVotar} disabled={registering || !selUnidad || !selOpcion}
                  style={{ padding: '6px 16px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                  {registering ? '…' : 'Registrar voto'}
                </button>
              </div>
            )}

            {/* Votes log */}
            {votos.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '6px' }}>Registro</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {votos.map(v => {
                    const op = votacion.opciones.find(o => o.id === v.opcion_id)
                    return (
                      <div key={v.id} style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '6px', padding: '4px 8px', fontSize: '11px' }}>
                        <span style={{ fontWeight: 600 }}>{v.unidad_nombre ?? v.unidad_id.slice(0, 6)}</span>
                        <span style={{ color: 'var(--at-ink-3)', marginLeft: '4px' }}>→ {op?.texto ?? v.opcion_id}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {votacion.resultado && votacion.estado === 'cerrada' && (
              <div style={{ marginTop: '12px', background: 'var(--at-success-tint)', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: 'var(--at-success)', fontWeight: 600 }}>
                ✓ Resultado: {votacion.resultado}
              </div>
            )}
          </EditModal>
        )
      })()}
    </div>
  )
}
