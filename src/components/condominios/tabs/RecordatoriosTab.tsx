import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify, confirm } from '../../shared/Dialog'
import { RecordatorioCondominio, PrioridadRecordatorio, TipoEntidadRecordatorio } from '../../../types'

interface Props {
  recordatorios: RecordatorioCondominio[]
  proyectoId: string
  companyId: string
  userId: string
  autorNombre: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const PRIORIDAD_CFG: Record<PrioridadRecordatorio, { label: string; bg: string; color: string; icon: string }> = {
  normal:  { label: 'Normal',  bg: 'var(--at-chip)', color: 'var(--at-ink-2)', icon: '📌' },
  alta:    { label: 'Alta',    bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', icon: '⚠️' },
  critica: { label: 'Crítica', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', icon: '🚨' },
}

const TIPO_LABELS: Record<TipoEntidadRecordatorio, string> = {
  cuota: 'Cuota', contrato: 'Contrato', inspeccion: 'Inspección', mantenimiento: 'Mantenimiento', general: 'General',
}

export default function RecordatoriosTab({ recordatorios, proyectoId, companyId, userId, autorNombre, canCreate, canEdit, onRefresh }: Props) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<'pendientes' | 'completados' | 'todos'>('pendientes')
  const [filtroPrioridad, setFiltroPrioridad] = useState<PrioridadRecordatorio | ''>('')
  const [form, setForm] = useState({
    titulo: '', descripcion: '', fecha_limite: '', tipo_entidad: '' as TipoEntidadRecordatorio | '',
    prioridad: 'normal' as PrioridadRecordatorio,
  })

  const hoy = hoyLocalISO()

  const lista = recordatorios.filter(r => {
    const matchEstado = filtroEstado === 'todos' || (filtroEstado === 'pendientes' ? !r.completado : r.completado)
    const matchPrioridad = !filtroPrioridad || r.prioridad === filtroPrioridad
    return matchEstado && matchPrioridad
  })

  const vencidosHoy = recordatorios.filter(r => !r.completado && r.fecha_limite <= hoy).length
  const proximosSemana = recordatorios.filter(r => {
    if (r.completado) return false
    const dias = Math.ceil((new Date(r.fecha_limite).getTime() - new Date(hoy).getTime()) / (1000 * 60 * 60 * 24))
    return dias > 0 && dias <= 7
  }).length

  function diasRestantes(fecha: string) {
    return Math.ceil((new Date(fecha).getTime() - new Date(hoy).getTime()) / (1000 * 60 * 60 * 24))
  }

  function resetForm() {
    setForm({ titulo: '', descripcion: '', fecha_limite: '', tipo_entidad: '', prioridad: 'normal' })
    setMostrarForm(false)
  }

  async function guardar() {
    if (!form.titulo.trim()) { notify({ variant: 'warning', title: 'Error', text: 'El título es obligatorio' }); return }
    if (!form.fecha_limite) { notify({ variant: 'warning', title: 'Error', text: 'La fecha límite es obligatoria' }); return }
    setSaving(true)
    const { error } = await createCondominioRow('recordatorios_condominio', {
      company_id: companyId, project_id: proyectoId,
      titulo: form.titulo.trim(),
      descripcion: form.descripcion.trim() || null,
      fecha_limite: form.fecha_limite,
      tipo_entidad: form.tipo_entidad || null,
      prioridad: form.prioridad,
      asignado_nombre: autorNombre,
      created_by: userId,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    resetForm(); onRefresh()
  }

  async function marcarCompletado(r: RecordatorioCondominio) {
    await updateCondominioRow('recordatorios_condominio', r.id, {
      completado: !r.completado,
      fecha_completado: !r.completado ? new Date().toISOString() : null,
    })
    onRefresh()
  }

  async function eliminar(id: string) {
    const res = await confirm({ title: '¿Eliminar recordatorio?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!res.isConfirmed) return
    await deleteCondominioRow('recordatorios_condominio', id)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        <div style={{ background: 'var(--at-danger-tint)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--at-danger)' }}>{vencidosHoy}</div>
          <div style={{ fontSize: 11, color: 'var(--at-danger)' }}>Vencidos</div>
        </div>
        <div style={{ background: 'var(--at-warning-tint)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--at-warning)' }}>{proximosSemana}</div>
          <div style={{ fontSize: 11, color: 'var(--at-warning)' }}>Esta semana</div>
        </div>
        <div style={{ background: 'var(--at-success-tint)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--at-success)' }}>{recordatorios.filter(r => r.completado).length}</div>
          <div style={{ fontSize: 11, color: 'var(--at-success)' }}>Completados</div>
        </div>
        <div style={{ background: 'var(--at-surface-2)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--at-ink-2)' }}>{recordatorios.length}</div>
          <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Total</div>
        </div>
      </div>

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['pendientes', 'completados', 'todos'] as const).map(e => (
            <button key={e} onClick={() => setFiltroEstado(e)}
              style={{ padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroEstado === e ? 'var(--at-accent-hover)' : 'var(--at-line)', background: filtroEstado === e ? 'var(--at-accent-tint)' : 'var(--at-surface)', color: filtroEstado === e ? 'var(--at-accent-hover)' : 'var(--at-ink-3)' }}>
              {e.charAt(0).toUpperCase() + e.slice(1)}
            </button>
          ))}
          <select value={filtroPrioridad} onChange={e => setFiltroPrioridad(e.target.value as PrioridadRecordatorio | '')}
            style={{ padding: '6px 10px', border: '1.5px solid var(--at-line)', borderRadius: 7, fontSize: 12 }}>
            <option value="">Todas las prioridades</option>
            {(Object.entries(PRIORIDAD_CFG) as [PrioridadRecordatorio, typeof PRIORIDAD_CFG[PrioridadRecordatorio]][]).map(([k, v]) => (
              <option key={k} value={k}>{v.icon} {v.label}</option>
            ))}
          </select>
        </div>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: 'var(--at-accent-hover)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Recordatorio'}
          </button>
        )}
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Nuevo recordatorio</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl}>Título *</label>
              <input style={inp} value={form.titulo} onChange={e => setForm(p => ({ ...p, titulo: e.target.value }))} placeholder="Ej. Renovar contrato Piscina…" />
            </div>
            <div>
              <label style={lbl}>Fecha límite *</label>
              <input type="date" style={inp} value={form.fecha_limite} onChange={e => setForm(p => ({ ...p, fecha_limite: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Tipo</label>
              <select style={inp} value={form.tipo_entidad} onChange={e => setForm(p => ({ ...p, tipo_entidad: e.target.value as TipoEntidadRecordatorio | '' }))}>
                <option value="">— General —</option>
                {(Object.entries(TIPO_LABELS) as [TipoEntidadRecordatorio, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Prioridad</label>
              <select style={inp} value={form.prioridad} onChange={e => setForm(p => ({ ...p, prioridad: e.target.value as PrioridadRecordatorio }))}>
                {(Object.entries(PRIORIDAD_CFG) as [PrioridadRecordatorio, typeof PRIORIDAD_CFG[PrioridadRecordatorio]][]).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Descripción</label>
              <input style={inp} value={form.descripcion} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} placeholder="Detalle opcional…" />
            </div>
          </div>
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: 'var(--at-accent-hover)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Crear recordatorio'}
          </button>
        </div>
      )}

      {/* Lista */}
      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0', fontSize: 13 }}>Sin recordatorios para los filtros seleccionados</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lista.sort((a, b) => a.fecha_limite.localeCompare(b.fecha_limite)).map(r => {
            const dias = diasRestantes(r.fecha_limite)
            const vencido = !r.completado && dias < 0
            const urgente = !r.completado && dias >= 0 && dias <= 3
            const pcfg = PRIORIDAD_CFG[r.prioridad]
            return (
              <div key={r.id} style={{ background: r.completado ? 'var(--at-surface-2)' : vencido ? 'var(--at-danger-tint)' : urgente ? 'var(--at-warning-tint)' : 'var(--at-surface)', border: `1px solid ${vencido ? 'var(--at-danger-border)' : urgente ? 'var(--at-warning-border)' : 'var(--at-line)'}`, borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <input type="checkbox" checked={r.completado} onChange={() => marcarCompletado(r)}
                  style={{ width: 18, height: 18, cursor: 'pointer', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: r.completado ? 'var(--at-ink-3)' : 'var(--at-ink)', textDecoration: r.completado ? 'line-through' : 'none' }}>{r.titulo}</span>
                    <span style={{ padding: '1px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: pcfg.bg, color: pcfg.color }}>{pcfg.icon} {pcfg.label}</span>
                    {r.tipo_entidad && <span style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{TIPO_LABELS[r.tipo_entidad]}</span>}
                  </div>
                  {r.descripcion && <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>{r.descripcion}</div>}
                  <div style={{ fontSize: 11, marginTop: 3, color: vencido ? 'var(--at-danger)' : urgente ? 'var(--at-warning)' : 'var(--at-ink-3)', fontWeight: vencido || urgente ? 600 : 400 }}>
                    {r.completado
                      ? `✓ Completado ${r.fecha_completado ? new Date(r.fecha_completado).toLocaleDateString('es') : ''}`
                      : vencido
                        ? `🔴 Vencido hace ${Math.abs(dias)} día${Math.abs(dias) !== 1 ? 's' : ''}`
                        : dias === 0
                          ? '🟡 Vence hoy'
                          : `Vence en ${dias} día${dias !== 1 ? 's' : ''} (${r.fecha_limite})`
                    }
                  </div>
                </div>
                {canEdit && !r.completado && (
                  <button onClick={() => eliminar(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-ink-3)', fontSize: 16, flexShrink: 0 }}>🗑</button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
