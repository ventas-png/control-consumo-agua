import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { notify } from '../../shared/Dialog'
import { PlantillaCuota, PeriodicidadPlantilla, RubroConfig, Unidad } from '../../../types'
import { RubrosBuilder } from '../RubrosBuilder'

interface Props {
  plantillas: PlantillaCuota[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const PERIODO_LABELS: Record<PeriodicidadPlantilla, string> = {
  mensual: 'Mensual', bimestral: 'Bimestral', trimestral: 'Trimestral',
  semestral: 'Semestral', anual: 'Anual', 'única': 'Única',
}

function calcularMontoPorUnidad(unidad: Unidad, rubros: RubroConfig[], totalM2: number): number {
  return rubros.reduce((sum, r) => {
    if (r.metodo === 'fijo') return sum + r.valor
    if (r.metodo === 'por_m2') return sum + (unidad.area_m2 ?? 0) * r.valor
    if (r.metodo === 'alicuota') {
      const pct = unidad.alicuota_pct != null
        ? unidad.alicuota_pct
        : totalM2 > 0 ? ((unidad.area_m2 ?? 0) / totalM2) * 100 : 0
      return sum + r.valor * (pct / 100)
    }
    return sum
  }, 0)
}

export default function PlantillasCuotaTab({ plantillas, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generando, setGenerando] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [usarRubros, setUsarRubros] = useState(false)
  const [rubros, setRubros] = useState<RubroConfig[]>([{ nombre: 'Mantenimiento general', metodo: 'fijo', valor: 0 }])
  const [form, setForm] = useState({
    nombre: '', concepto: 'mantenimiento', monto: '',
    dia_vencimiento: '5', periodicidad: 'mensual' as PeriodicidadPlantilla,
    aplica_a: 'todas', notas: '',
  })

  function resetForm() {
    setForm({ nombre: '', concepto: 'mantenimiento', monto: '', dia_vencimiento: '5', periodicidad: 'mensual', aplica_a: 'todas', notas: '' })
    setRubros([{ nombre: 'Mantenimiento general', metodo: 'fijo', valor: 0 }])
    setUsarRubros(false)
    setMostrarForm(false); setEditingId(null)
  }

  function startEdit(p: PlantillaCuota) {
    setForm({
      nombre: p.nombre, concepto: p.concepto, monto: String(p.monto),
      dia_vencimiento: String(p.dia_vencimiento), periodicidad: p.periodicidad,
      aplica_a: p.aplica_a, notas: p.notas ?? '',
    })
    if (p.rubros && p.rubros.length > 0) {
      setRubros(p.rubros)
      setUsarRubros(true)
    } else {
      setRubros([{ nombre: 'Mantenimiento general', metodo: 'fijo', valor: 0 }])
      setUsarRubros(false)
    }
    setEditingId(p.id); setMostrarForm(true)
  }

  async function guardar() {
    if (!form.nombre.trim()) { notify({ variant: 'warning', title: 'Error', text: 'El nombre es obligatorio' }); return }
    if (!usarRubros && !form.monto) { notify({ variant: 'warning', title: 'Error', text: 'El monto es obligatorio' }); return }
    if (usarRubros && rubros.length === 0) { notify({ variant: 'warning', title: 'Error', text: 'Agrega al menos un rubro' }); return }
    if (usarRubros && rubros.some(r => !r.nombre.trim() || r.valor <= 0)) {
      notify({ variant: 'warning', title: 'Error', text: 'Todos los rubros deben tener nombre y valor mayor a 0' }); return
    }

    setSaving(true)
    const montoTotal = usarRubros
      ? rubros.filter(r => r.metodo === 'fijo').reduce((s, r) => s + r.valor, 0)
      : parseFloat(form.monto)

    const data = {
      company_id: companyId, project_id: proyectoId,
      nombre: form.nombre.trim(), concepto: form.concepto,
      monto: montoTotal,
      dia_vencimiento: parseInt(form.dia_vencimiento),
      periodicidad: form.periodicidad, aplica_a: form.aplica_a,
      notas: form.notas.trim() || null,
      rubros: usarRubros ? rubros : null,
      monto_total_estimado: usarRubros ? montoTotal : null,
    }
    const { error } = editingId
      ? await supabase.from('plantillas_cuota').update(data).eq('id', editingId)
      : await supabase.from('plantillas_cuota').insert(data)
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    resetForm(); onRefresh()
  }

  async function toggleActiva(p: PlantillaCuota) {
    await supabase.from('plantillas_cuota').update({ activa: !p.activa }).eq('id', p.id)
    onRefresh()
  }

  async function eliminar(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar plantilla?', icon: 'warning', showCancelButton: true, confirmButtonColor: 'var(--at-danger)', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!r.isConfirmed) return
    await supabase.from('plantillas_cuota').delete().eq('id', id)
    onRefresh()
  }

  async function generarCuotas(p: PlantillaCuota) {
    const { value: periodo } = await Swal.fire({
      title: `Generar cuotas — ${p.nombre}`,
      html: `<p style="font-size:13px;color:var(--at-ink-2);margin-bottom:8px">Período (YYYY-MM):</p>
             <input id="periodo-input" class="swal2-input" type="month" value="${new Date().toISOString().slice(0,7)}" style="font-size:14px">`,
      showCancelButton: true,
      confirmButtonText: 'Generar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => (document.getElementById('periodo-input') as HTMLInputElement)?.value,
    })
    if (!periodo) return

    const unidadesTarget = unidades.filter(u => u.activo !== false)
    if (unidadesTarget.length === 0) { notify({ variant: 'info', title: 'Sin unidades', text: 'No hay unidades activas para generar cuotas' }); return }

    const usaRubros = p.rubros && p.rubros.length > 0
    const totalM2 = unidadesTarget.reduce((s, u) => s + (u.area_m2 ?? 0), 0)

    const resumenMonto = usaRubros
      ? `rubros variables (${p.rubros!.length} rubro${p.rubros!.length !== 1 ? 's' : ''})`
      : `${moneda} ${p.monto.toLocaleString()} c/u`

    const confirm = await Swal.fire({
      title: '¿Confirmar generación?',
      text: `Se crearán ${unidadesTarget.length} cuotas — ${resumenMonto} — período ${periodo}`,
      icon: 'question', showCancelButton: true, confirmButtonText: 'Generar', cancelButtonText: 'Cancelar',
    })
    if (!confirm.isConfirmed) return

    setGenerando(p.id)
    const [year, month] = periodo.split('-').map(Number)
    const fechaVenc = new Date(year, month - 1, p.dia_vencimiento).toISOString().slice(0, 10)

    const rows = unidadesTarget.map(u => {
      const monto = usaRubros
        ? Math.round(calcularMontoPorUnidad(u, p.rubros!, totalM2) * 100) / 100
        : p.monto
      return {
        company_id: companyId, project_id: proyectoId,
        unidad_id: u.id,
        concepto: p.concepto,
        monto,
        periodo,
        fecha_vencimiento: fechaVenc,
        estado: 'pendiente',
        rubros_detalle: usaRubros ? p.rubros!.map(r => ({
          ...r,
          monto_calculado: Math.round(calcularMontoPorUnidad(u, [r], totalM2) * 100) / 100,
        })) : null,
      }
    })

    const { error } = await supabase.from('cuotas_condominio').insert(rows)
    setGenerando(null)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    notify({ variant: 'success', title: `${rows.length} cuotas generadas`, text: `Período ${periodo}`, duration: 2000 })
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Plantillas de cuota</div>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>{plantillas.filter(p => p.activa).length} activas · {unidades.filter(u => u.activo !== false).length} unidades</div>
        </div>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Nueva plantilla'}
          </button>
        )}
      </div>

      {/* Form */}
      {mostrarForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>{editingId ? 'Editar plantilla' : 'Nueva plantilla de cuota'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl}>Nombre *</label>
              <input style={inp} value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} placeholder="Ej. Cuota de mantenimiento mensual" />
            </div>
            <div>
              <label style={lbl}>Concepto</label>
              <select style={inp} value={form.concepto} onChange={e => setForm(p => ({ ...p, concepto: e.target.value }))}>
                {['mantenimiento','agua','seguridad','amenidades','extraordinaria','cam','otro'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Día de vencimiento</label>
              <input type="number" min={1} max={28} style={inp} value={form.dia_vencimiento} onChange={e => setForm(p => ({ ...p, dia_vencimiento: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Periodicidad</label>
              <select style={inp} value={form.periodicidad} onChange={e => setForm(p => ({ ...p, periodicidad: e.target.value as PeriodicidadPlantilla }))}>
                {(Object.entries(PERIODO_LABELS) as [PeriodicidadPlantilla, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Aplica a</label>
              <select style={inp} value={form.aplica_a} onChange={e => setForm(p => ({ ...p, aplica_a: e.target.value }))}>
                <option value="todas">Todas las unidades</option>
                <option value="residencial">Solo residencial</option>
                <option value="comercial">Solo comercial</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Notas</label>
              <input style={inp} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} placeholder="Opcional" />
            </div>
          </div>

          {/* Toggle monto simple vs rubros */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: usarRubros ? 0 : 12 }}>
              <button type="button" onClick={() => setUsarRubros(false)}
                style={{ padding: '6px 14px', fontSize: 12, border: '1px solid var(--at-line-strong)', borderRadius: 6, cursor: 'pointer',
                  background: !usarRubros ? 'var(--at-primary)' : 'var(--at-surface-2)', color: !usarRubros ? 'white' : 'var(--at-ink-2)', fontWeight: !usarRubros ? 700 : 400 }}>
                Monto fijo simple
              </button>
              <button type="button" onClick={() => setUsarRubros(true)}
                style={{ padding: '6px 14px', fontSize: 12, border: '1px solid var(--at-line-strong)', borderRadius: 6, cursor: 'pointer',
                  background: usarRubros ? 'var(--at-primary)' : 'var(--at-surface-2)', color: usarRubros ? 'white' : 'var(--at-ink-2)', fontWeight: usarRubros ? 700 : 400 }}>
                Rubros desglozados
              </button>
            </div>

            {!usarRubros && (
              <div style={{ marginTop: 8, maxWidth: 200 }}>
                <label style={lbl}>Monto ({moneda}) *</label>
                <input type="number" step="0.01" style={inp} value={form.monto} onChange={e => setForm(p => ({ ...p, monto: e.target.value }))} placeholder="0.00" />
              </div>
            )}

            {usarRubros && (
              <div style={{ marginTop: 12, background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 8, padding: 14 }}>
                <RubrosBuilder rubros={rubros} onChange={setRubros} moneda={moneda} />
              </div>
            )}
          </div>

          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Guardar plantilla'}
          </button>
        </div>
      )}

      {/* Lista */}
      {plantillas.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          No hay plantillas de cuota — crea una para generar cuotas masivas
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {plantillas.map(p => {
            const tieneRubros = p.rubros && p.rubros.length > 0
            return (
              <div key={p.id} style={{ background: p.activa ? 'var(--at-surface)' : 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 14, opacity: p.activa ? 1 : 0.65 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--at-ink)' }}>{p.nombre}</span>
                    <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: 'var(--at-success-tint)', color: 'var(--at-success)' }}>{PERIODO_LABELS[p.periodicidad]}</span>
                    <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, background: 'var(--at-chip)', color: 'var(--at-ink-2)' }}>{p.concepto}</span>
                    {tieneRubros && (
                      <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, background: 'var(--at-primary-tint)', color: 'var(--at-primary)' }}>
                        {p.rubros!.length} rubro{p.rubros!.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--at-ink-2)' }}>
                    {tieneRubros
                      ? <span style={{ color: 'var(--at-ink-3)' }}>{p.rubros!.map(r => `${r.nombre} (${r.metodo === 'fijo' ? `${moneda} ${r.valor}` : r.metodo === 'por_m2' ? `${moneda} ${r.valor}/m²` : `${r.valor.toLocaleString()} total alíc.`})`).join(' + ')}</span>
                      : <><strong>{moneda} {p.monto.toLocaleString()}</strong> por unidad</>
                    }
                    {' '}· vence día {p.dia_vencimiento} · {p.aplica_a === 'todas' ? 'Todas las unidades' : p.aplica_a}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  {canCreate && p.activa && (
                    <button onClick={() => generarCuotas(p)} disabled={generando === p.id}
                      style={{ padding: '7px 14px', background: 'var(--at-accent-hover)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                      {generando === p.id ? '⏳' : '⚡ Generar'}
                    </button>
                  )}
                  {canEdit && (
                    <>
                      <button onClick={() => startEdit(p)} style={{ padding: '7px 12px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>✏️</button>
                      <button onClick={() => toggleActiva(p)} style={{ padding: '7px 12px', background: p.activa ? 'var(--at-warning-tint)' : 'var(--at-success-tint)', border: '1px solid var(--at-line)', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>{p.activa ? '⏸' : '▶'}</button>
                      <button onClick={() => eliminar(p.id)} style={{ padding: '7px 10px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-danger)', fontSize: 14 }}>🗑</button>
                    </>
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
