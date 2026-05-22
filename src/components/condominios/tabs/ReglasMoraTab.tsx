import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { ReglaMoraConfig, TipoReglaRecargo, AplicarSobreRecargo } from '../../../types'

interface Props {
  reglas: ReglaMoraConfig[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_LABEL: Record<TipoReglaRecargo, string> = { porcentaje: 'Porcentaje (%)', monto_fijo: 'Monto fijo' }
const SOBRE_LABEL: Record<AplicarSobreRecargo, string> = { saldo_vencido: 'Saldo vencido', monto_cuota: 'Monto de cuota' }

const BLANK = {
  nombre: '', dias_vencimiento: '30', tipo: 'porcentaje' as TipoReglaRecargo,
  valor: '', aplicar_sobre: 'saldo_vencido' as AplicarSobreRecargo,
  periodo_gracia: '0', notas: '',
}

export default function ReglasMoraTab({ reglas, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(BLANK)

  function abrirNueva() { setForm(BLANK); setEditId(null); setMostrarForm(true) }
  function abrirEditar(r: ReglaMoraConfig) {
    setForm({
      nombre: r.nombre, dias_vencimiento: String(r.dias_vencimiento),
      tipo: r.tipo, valor: String(r.valor),
      aplicar_sobre: r.aplicar_sobre, periodo_gracia: String(r.periodo_gracia),
      notas: r.notas ?? '',
    })
    setEditId(r.id); setMostrarForm(true)
  }
  function cancelar() { setMostrarForm(false); setEditId(null) }

  async function guardar() {
    if (!form.nombre.trim() || !form.valor) {
      Swal.fire('Error', 'Nombre y valor son obligatorios', 'warning'); return
    }
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      nombre: form.nombre.trim(),
      dias_vencimiento: parseInt(form.dias_vencimiento) || 30,
      tipo: form.tipo, valor: parseFloat(form.valor),
      aplicar_sobre: form.aplicar_sobre,
      periodo_gracia: parseInt(form.periodo_gracia) || 0,
      notas: form.notas.trim() || null,
    }
    const { error } = editId
      ? await supabase.from('reglas_mora_config').update(payload).eq('id', editId)
      : await supabase.from('reglas_mora_config').insert(payload)
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    cancelar(); onRefresh()
  }

  async function toggleActiva(r: ReglaMoraConfig) {
    await supabase.from('reglas_mora_config').update({ activa: !r.activa }).eq('id', r.id)
    onRefresh()
  }

  async function eliminar(id: string) {
    const { isConfirmed } = await Swal.fire({ title: '¿Eliminar regla?', icon: 'warning', showCancelButton: true, confirmButtonColor: 'var(--at-danger)', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!isConfirmed) return
    await supabase.from('reglas_mora_config').delete().eq('id', id)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  const activas = reglas.filter(r => r.activa).length

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Reglas activas', val: activas, bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
          { label: 'Reglas inactivas', val: reglas.length - activas, bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
          { label: 'Total reglas', val: reglas.length, bg: 'var(--at-surface-2)', color: 'var(--at-ink-2)' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 11, color: k.color }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: 'var(--at-ink-3)' }}>
          Reglas que generan recargos automáticos cuando una cuota supera el plazo configurado
        </span>
        {canCreate && (
          <button onClick={mostrarForm ? cancelar : abrirNueva}
            style={{ padding: '8px 16px', background: 'var(--at-danger)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm && !editId ? '✕ Cancelar' : '+ Nueva regla'}
          </button>
        )}
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: '#fff7f7', border: '1px solid var(--at-danger-border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>{editId ? 'Editar regla' : 'Nueva regla de mora'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div style={{ gridColumn: 'span 3' }}>
              <label style={lbl}>Nombre de la regla *</label>
              <input style={inp} value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} placeholder="Ej. Mora del 5% a los 30 días" />
            </div>
            <div>
              <label style={lbl}>Días de vencimiento *</label>
              <input type="number" min={1} style={inp} value={form.dias_vencimiento} onChange={e => setForm(p => ({ ...p, dias_vencimiento: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Período de gracia (días)</label>
              <input type="number" min={0} style={inp} value={form.periodo_gracia} onChange={e => setForm(p => ({ ...p, periodo_gracia: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Tipo de recargo</label>
              <select style={inp} value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value as TipoReglaRecargo }))}>
                {(Object.keys(TIPO_LABEL) as TipoReglaRecargo[]).map(t => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Valor {form.tipo === 'porcentaje' ? '(%)' : `(${moneda})`} *</label>
              <input type="number" step="0.01" min={0} style={inp} value={form.valor} onChange={e => setForm(p => ({ ...p, valor: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Aplicar sobre</label>
              <select style={inp} value={form.aplicar_sobre} onChange={e => setForm(p => ({ ...p, aplicar_sobre: e.target.value as AplicarSobreRecargo }))}>
                {(Object.keys(SOBRE_LABEL) as AplicarSobreRecargo[]).map(s => <option key={s} value={s}>{SOBRE_LABEL[s]}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Notas</label>
              <input style={inp} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} placeholder="Opcional" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={guardar} disabled={saving}
              style={{ padding: '8px 20px', background: 'var(--at-danger)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
              {saving ? 'Guardando…' : editId ? '💾 Actualizar' : '✅ Crear regla'}
            </button>
            <button onClick={cancelar} style={{ padding: '8px 16px', background: 'var(--at-chip)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista */}
      {reglas.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📏</div>
          Sin reglas de mora — crea una para generar recargos automáticamente
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {reglas.map(r => (
            <div key={r.id} style={{ background: 'var(--at-surface)', border: `1px solid ${r.activa ? 'var(--at-line)' : 'var(--at-chip)'}`, borderRadius: 10, padding: '12px 16px', opacity: r.activa ? 1 : 0.6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{r.nombre}</span>
                    <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: r.activa ? 'var(--at-success-tint)' : 'var(--at-chip)', color: r.activa ? 'var(--at-success)' : 'var(--at-ink-3)' }}>
                      {r.activa ? 'Activa' : 'Inactiva'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--at-ink-3)', flexWrap: 'wrap' }}>
                    <span>⏱ A los <strong>{r.dias_vencimiento}</strong> días</span>
                    {r.periodo_gracia > 0 && <span>🕊 Gracia: <strong>{r.periodo_gracia}d</strong></span>}
                    <span>💸 {r.tipo === 'porcentaje' ? `${r.valor}%` : `${moneda} ${r.valor}`} sobre {SOBRE_LABEL[r.aplicar_sobre]}</span>
                  </div>
                  {r.notas && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 4 }}>{r.notas}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => toggleActiva(r)}
                    style={{ padding: '5px 10px', background: r.activa ? 'var(--at-warning-tint)' : 'var(--at-success-tint)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600, color: r.activa ? 'var(--at-warning-strong)' : 'var(--at-success-strong)' }}>
                    {r.activa ? 'Pausar' : 'Activar'}
                  </button>
                  {canEdit && (
                    <button onClick={() => abrirEditar(r)}
                      style={{ padding: '5px 10px', background: 'var(--at-primary-tint)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-primary)' }}>
                      ✏️
                    </button>
                  )}
                  {canEdit && (
                    <button onClick={() => eliminar(r.id)}
                      style={{ padding: '5px 10px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-danger)' }}>
                      🗑
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info box */}
      <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: 8, fontSize: 12, color: 'var(--at-warning-strong)' }}>
        <strong>ℹ️ Nota:</strong> Estas reglas definen la configuración. Para aplicar recargos a las unidades morosas, usa el módulo <strong>Recargos mora</strong> con la opción "Recargo masivo".
      </div>
    </div>
  )
}
