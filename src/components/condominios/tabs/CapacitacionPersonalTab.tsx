import { hoyLocalISO, diasHastaFechaCalendario } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify, confirm } from '../../shared/Dialog'
import { CapacitacionPersonal, EstadoCapacitacion } from '../../../types'

interface Props {
  capacitaciones: CapacitacionPersonal[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_CFG: Record<EstadoCapacitacion, { label: string; bg: string; color: string }> = {
  planificado: { label: 'Planificado', bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
  en_progreso: { label: 'En progreso', bg: 'var(--at-warning-tint)', color: 'var(--at-warning)' },
  completado:  { label: 'Completado',  bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  vencido:     { label: 'Vencido',     bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
}

const BLANK = {
  nombre_empleado: '', cargo: '', curso: '', proveedor: '',
  fecha_inicio: hoyLocalISO(),
  fecha_fin: '', fecha_vencimiento_cert: '',
  costo: '', estado: 'completado' as EstadoCapacitacion, notas: '',
}

export default function CapacitacionPersonalTab({ capacitaciones, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoCapacitacion | ''>('')
  const [busqueda, setBusqueda] = useState('')
  const [form, setForm] = useState(BLANK)

  const lista = capacitaciones.filter(c =>
    (!filtroEstado || c.estado === filtroEstado) &&
    (!busqueda || c.nombre_empleado.toLowerCase().includes(busqueda.toLowerCase()) ||
      c.curso.toLowerCase().includes(busqueda.toLowerCase()))
  )

  // Auto-detect vencidos
  const proxVencer = capacitaciones.filter(c => {
    if (!c.fecha_vencimiento_cert) return false
    const dias = diasHastaFechaCalendario(c.fecha_vencimiento_cert)
    return dias !== null && dias >= 0 && dias <= 30
  }).length

  const totalCosto = capacitaciones.reduce((s, c) => s + (c.costo ?? 0), 0)

  async function guardar() {
    if (!form.nombre_empleado.trim() || !form.curso.trim() || !form.fecha_inicio) {
      notify({ variant: 'warning', title: 'Error', text: 'Empleado, curso y fecha de inicio son obligatorios' }); return
    }
    setSaving(true)
    const { error } = await createCondominioRow('capacitacion_personal_cond', {
      company_id: companyId, project_id: proyectoId,
      nombre_empleado: form.nombre_empleado.trim(),
      cargo: form.cargo.trim() || null,
      curso: form.curso.trim(),
      proveedor: form.proveedor.trim() || null,
      fecha_inicio: form.fecha_inicio,
      fecha_fin: form.fecha_fin || null,
      fecha_vencimiento_cert: form.fecha_vencimiento_cert || null,
      costo: form.costo ? parseFloat(form.costo) : null,
      estado: form.estado,
      notas: form.notas.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setMostrarForm(false); setForm(BLANK); onRefresh()
  }

  async function cambiarEstado(id: string, estado: EstadoCapacitacion) {
    await updateCondominioRow('capacitacion_personal_cond', id, { estado })
    onRefresh()
  }

  async function eliminar(id: string) {
    const { isConfirmed } = await confirm({ title: '¿Eliminar registro?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!isConfirmed) return
    await deleteCondominioRow('capacitacion_personal_cond', id)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  // Group by employee
  const empleados = [...new Set(lista.map(c => c.nombre_empleado))].sort()

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Completadas', val: capacitaciones.filter(c => c.estado === 'completado').length, bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
          { label: 'En progreso', val: capacitaciones.filter(c => c.estado === 'en_progreso').length, bg: 'var(--at-warning-tint)', color: 'var(--at-warning)' },
          { label: 'Cert. por vencer (30d)', val: proxVencer, bg: 'var(--at-warning-tint)', color: 'var(--at-warning)' },
          { label: `Inversión total`, val: `${moneda} ${totalCosto.toFixed(2)}`, bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 11, color: k.color }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar empleado o curso…"
            style={{ padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13, minWidth: 200 }} />
          <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as EstadoCapacitacion | '')}
            style={{ padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13 }}>
            <option value="">Todos los estados</option>
            {(Object.keys(ESTADO_CFG) as EstadoCapacitacion[]).map(e => <option key={e} value={e}>{ESTADO_CFG[e].label}</option>)}
          </select>
          <span style={{ fontSize: 12, color: 'var(--at-ink-3)', alignSelf: 'center' }}>{lista.length} registros</span>
        </div>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: 'var(--at-primary-hover)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Nueva capacitación'}
          </button>
        )}
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Registrar capacitación</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Empleado *</label>
              <input style={inp} value={form.nombre_empleado} onChange={e => setForm(p => ({ ...p, nombre_empleado: e.target.value }))} placeholder="Nombre completo" />
            </div>
            <div>
              <label style={lbl}>Cargo</label>
              <input style={inp} value={form.cargo} onChange={e => setForm(p => ({ ...p, cargo: e.target.value }))} placeholder="Ej. Guardia, Conserje…" />
            </div>
            <div>
              <label style={lbl}>Estado</label>
              <select style={inp} value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value as EstadoCapacitacion }))}>
                {(Object.keys(ESTADO_CFG) as EstadoCapacitacion[]).map(e => <option key={e} value={e}>{ESTADO_CFG[e].label}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl}>Curso / capacitación *</label>
              <input style={inp} value={form.curso} onChange={e => setForm(p => ({ ...p, curso: e.target.value }))} placeholder="Ej. Primeros auxilios, Seguridad industrial…" />
            </div>
            <div>
              <label style={lbl}>Proveedor / institución</label>
              <input style={inp} value={form.proveedor} onChange={e => setForm(p => ({ ...p, proveedor: e.target.value }))} placeholder="Nombre del proveedor" />
            </div>
            <div>
              <label style={lbl}>Fecha inicio *</label>
              <input type="date" style={inp} value={form.fecha_inicio} onChange={e => setForm(p => ({ ...p, fecha_inicio: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Fecha fin</label>
              <input type="date" style={inp} value={form.fecha_fin} onChange={e => setForm(p => ({ ...p, fecha_fin: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Vencimiento certificado</label>
              <input type="date" style={inp} value={form.fecha_vencimiento_cert} onChange={e => setForm(p => ({ ...p, fecha_vencimiento_cert: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Costo ({moneda})</label>
              <input type="number" step="0.01" style={inp} value={form.costo} onChange={e => setForm(p => ({ ...p, costo: e.target.value }))} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl}>Notas</label>
              <input style={inp} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} placeholder="Opcional" />
            </div>
          </div>
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: 'var(--at-primary-hover)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Registrar'}
          </button>
        </div>
      )}

      {/* Lista agrupada por empleado */}
      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🎓</div>
          Sin capacitaciones registradas
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {empleados.map(emp => {
            const caps = lista.filter(c => c.nombre_empleado === emp)
            return (
              <div key={emp}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--at-ink)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--at-primary-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: 'var(--at-primary-hover)' }}>
                    {emp.charAt(0).toUpperCase()}
                  </div>
                  {emp}
                  {caps[0]?.cargo && <span style={{ fontSize: 11, color: 'var(--at-ink-3)', fontWeight: 400 }}>— {caps[0].cargo}</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 36 }}>
                  {caps.map(c => {
                    const ec = ESTADO_CFG[c.estado]
                    const certVence = c.fecha_vencimiento_cert
                    // Misma cuenta que el resumen de arriba. Con
                    // `new Date(certVence) - Date.now()` el badge restaba un
                    // día en husos negativos y contradecía al KPI.
                    const diasCert = diasHastaFechaCalendario(certVence)
                    const certAlerta = diasCert !== null && diasCert >= 0 && diasCert <= 30
                    return (
                      <div key={c.id} style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600, fontSize: 13 }}>{c.curso}</span>
                            <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
                            {certAlerta && <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10, background: 'var(--at-warning-tint)', color: 'var(--at-warning)', fontWeight: 700 }}>⚠ Cert. vence en {diasCert}d</span>}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>
                            {c.proveedor && `${c.proveedor} · `}
                            {c.fecha_inicio}{c.fecha_fin ? ` → ${c.fecha_fin}` : ''}
                            {c.costo && ` · ${moneda} ${c.costo.toFixed(2)}`}
                            {certVence && ` · Cert. vence: ${certVence}`}
                          </div>
                        </div>
                        {canEdit && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            {c.estado !== 'completado' && (
                              <button onClick={() => cambiarEstado(c.id, 'completado')}
                                style={{ padding: '4px 8px', background: 'var(--at-success-tint)', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 10, color: 'var(--at-success)' }}>✓</button>
                            )}
                            <button onClick={() => eliminar(c.id)}
                              style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 10, color: 'var(--at-danger)' }}>✕</button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
