import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { softDelete } from '../../../lib/softDelete'
import type { FondoReserva } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { exportarPDFTabla, exportarExcel } from '../exportUtils'

interface Props {
  movimientos: FondoReserva[]
  proyectoId: string
  companyId: string
  moneda: string
  proyectoNombre?: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_STYLE: Record<string, { bg: string; color: string; label: string; sign: string }> = {
  aporte:  { bg: 'var(--at-success-tint)', color: 'var(--at-success)', label: 'Aporte',  sign: '+' },
  retiro:  { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', label: 'Retiro',  sign: '-' },
  ajuste:  { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: 'Ajuste',  sign: '±' },
}

const ESTADO_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  pendiente:  { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: 'Pendiente' },
  aprobado:   { bg: 'var(--at-success-tint)', color: 'var(--at-success)', label: 'Aprobado' },
  rechazado:  { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', label: 'Rechazado' },
}

const BLANK = {
  tipo: 'aporte', concepto: '', monto: '', fecha: hoyLocalISO(),
  justificacion: '', aprobado_por: '', estado: 'aprobado', notas: '',
}

const inputStyle: CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1.5px solid var(--at-line)',
  borderRadius: '7px', fontSize: '13px', boxSizing: 'border-box',
}

function fmt(n: number, m: string) {
  return `${m} ${n.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function FondoReservaTab({ movimientos, proyectoId, companyId, moneda, proyectoNombre = 'Condominio', canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({ ...BLANK })
  const [filterTipo, setFilterTipo] = useState('')
  const [filterEstado, setFilterEstado] = useState('')
  const [saving, setSaving] = useState(false)

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const openNew = () => { setForm({ ...BLANK }); setEditId(null); setShowForm(true) }
  const openEdit = (m: FondoReserva) => {
    setForm({
      tipo: m.tipo, concepto: m.concepto, monto: String(m.monto),
      fecha: m.fecha, justificacion: m.justificacion ?? '',
      aprobado_por: m.aprobado_por ?? '', estado: m.estado, notas: m.notas ?? '',
    })
    setEditId(m.id)
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.concepto.trim() || !form.monto) return notify({ variant: 'warning', title: 'Campos requeridos', text: 'Concepto y monto son obligatorios.' })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      tipo: form.tipo, concepto: form.concepto.trim(),
      monto: parseFloat(form.monto), fecha: form.fecha,
      justificacion: form.justificacion || null,
      aprobado_por: form.aprobado_por || null,
      estado: form.estado,
      notas: form.notas || null,
    }
    const { error } = editId
      ? await updateCondominioRow('fondo_reserva_condominio', editId, payload)
      : await createCondominioRow('fondo_reserva_condominio', payload)
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false)
    onRefresh()
  }

  const handleDelete = async (m: FondoReserva) => {
    const r = await confirm({ title: '¿Eliminar movimiento?', text: m.concepto, icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await softDelete('fondo_reserva_condominio', { id: m.id })
    onRefresh()
  }

  // sorted chronologically for running balance
  const sorted = [...movimientos].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.created_at.localeCompare(b.created_at))

  // compute running saldo
  const withSaldo = sorted.map((m, i) => {
    const prev = i === 0 ? 0 : sorted.slice(0, i).reduce((acc, x) => {
      if (x.estado === 'rechazado') return acc
      return x.tipo === 'aporte' ? acc + x.monto : x.tipo === 'retiro' ? acc - x.monto : acc + x.monto
    }, 0)
    const delta = m.estado === 'rechazado' ? 0 : m.tipo === 'aporte' ? m.monto : m.tipo === 'retiro' ? -m.monto : m.monto
    return { ...m, saldo: prev + delta }
  })

  const saldoTotal = withSaldo.length > 0 ? withSaldo[withSaldo.length - 1].saldo : 0

  const filtered = [...withSaldo].reverse().filter(m =>
    (!filterTipo || m.tipo === filterTipo) &&
    (!filterEstado || m.estado === filterEstado)
  )

  const totalAportes = movimientos.filter(m => m.tipo === 'aporte' && m.estado !== 'rechazado').reduce((a, m) => a + m.monto, 0)
  const totalRetiros = movimientos.filter(m => m.tipo === 'retiro' && m.estado !== 'rechazado').reduce((a, m) => a + m.monto, 0)

  function exportarPDF() {
    exportarPDFTabla({
      titulo: 'Fondo de Reserva',
      subtitulo: `Saldo actual: ${fmt(saldoTotal, moneda)}`,
      proyectoNombre,
      headers: ['Fecha', 'Concepto', 'Tipo', 'Estado', 'Monto', 'Saldo acum.'],
      rows: filtered.map(m => {
        const ts = TIPO_STYLE[m.tipo]
        return [m.fecha, m.concepto, ts.label, ESTADO_STYLE[m.estado].label, `${ts.sign} ${fmt(m.monto, moneda)}`, fmt(m.saldo, moneda)]
      }),
      rightAlignCols: [4, 5],
      filename: 'fondo-reserva',
      landscape: false,
    })
  }

  function exportarXlsx() {
    exportarExcel('fondo-reserva', [{
      name: 'Movimientos',
      headers: ['Fecha', 'Concepto', 'Tipo', 'Estado', 'Monto', 'Saldo acumulado', 'Aprobado por', 'Justificación', 'Notas'],
      rows: filtered.map(m => [m.fecha, m.concepto, m.tipo, m.estado, m.monto, m.saldo, m.aprobado_por ?? '', m.justificacion ?? '', m.notas ?? '']),
    }])
  }

  return (
    <div style={{ padding: '20px', maxWidth: '960px', margin: '0 auto' }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '14px', marginBottom: '20px' }}>
        {[
          { label: 'Saldo Actual', value: fmt(saldoTotal, moneda), color: saldoTotal >= 0 ? 'var(--at-success)' : 'var(--at-danger)', bg: saldoTotal >= 0 ? 'var(--at-success-tint)' : 'var(--at-danger-tint)', icon: '🏦' },
          { label: 'Total Aportes', value: fmt(totalAportes, moneda), color: 'var(--at-success)', bg: 'var(--at-success-tint)', icon: '📥' },
          { label: 'Total Retiros', value: fmt(totalRetiros, moneda), color: 'var(--at-danger)', bg: 'var(--at-danger-tint)', icon: '📤' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '24px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', fontWeight: 600 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {canCreate && (
          <button onClick={openNew} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
            + Nuevo movimiento
          </button>
        )}
        <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)} style={{ ...inputStyle, width: '140px' }}>
          <option value="">Todos los tipos</option>
          <option value="aporte">Aporte</option>
          <option value="retiro">Retiro</option>
          <option value="ajuste">Ajuste</option>
        </select>
        <select value={filterEstado} onChange={e => setFilterEstado(e.target.value)} style={{ ...inputStyle, width: '140px' }}>
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="aprobado">Aprobado</option>
          <option value="rechazado">Rechazado</option>
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
          <button onClick={exportarPDF} disabled={filtered.length === 0}
            style={{ padding: '7px 14px', background: filtered.length === 0 ? 'var(--at-chip)' : 'var(--at-primary-tint)', color: filtered.length === 0 ? 'var(--at-ink-3)' : 'var(--at-primary)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: filtered.length === 0 ? 'not-allowed' : 'pointer' }}>
            📄 PDF
          </button>
          <button onClick={exportarXlsx} disabled={filtered.length === 0}
            style={{ padding: '7px 14px', background: filtered.length === 0 ? 'var(--at-chip)' : 'var(--at-success-tint)', color: filtered.length === 0 ? 'var(--at-ink-3)' : 'var(--at-success)', border: '1px solid var(--at-success-border)', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: filtered.length === 0 ? 'not-allowed' : 'pointer' }}>
            📊 Excel
          </button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar movimiento' : 'Nuevo movimiento'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Tipo *</label>
              <select style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value)}>
                <option value="aporte">Aporte</option>
                <option value="retiro">Retiro</option>
                <option value="ajuste">Ajuste</option>
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Concepto *</label>
              <input style={inputStyle} value={form.concepto} onChange={e => setF('concepto', e.target.value)} placeholder="Descripción del movimiento" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Monto *</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.monto} onChange={e => setF('monto', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Fecha</label>
              <input style={inputStyle} type="date" value={form.fecha} onChange={e => setF('fecha', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Estado</label>
              <select style={inputStyle} value={form.estado} onChange={e => setF('estado', e.target.value)}>
                <option value="aprobado">Aprobado</option>
                <option value="pendiente">Pendiente</option>
                <option value="rechazado">Rechazado</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Aprobado por</label>
              <input style={inputStyle} value={form.aprobado_por} onChange={e => setF('aprobado_por', e.target.value)} placeholder="Nombre o cargo" />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Justificación</label>
              <input style={inputStyle} value={form.justificacion} onChange={e => setF('justificacion', e.target.value)} placeholder="Motivo del movimiento" />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Notas</label>
              <input style={inputStyle} value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder="Observaciones adicionales" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 20px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setShowForm(false)} style={{ padding: '8px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Timeline */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>🏦</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>Sin movimientos registrados</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map(m => {
            const ts = TIPO_STYLE[m.tipo]
            const es = ESTADO_STYLE[m.estado]
            return (
              <div key={m.id} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: ts.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: '20px', fontWeight: 800, color: ts.color }}>{ts.sign}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{m.concepto}</span>
                    <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: 700, background: ts.bg, color: ts.color }}>{ts.label}</span>
                    <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: 600, background: es.bg, color: es.color }}>{es.label}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                    {m.fecha}{m.aprobado_por ? ` · Aprobado por: ${m.aprobado_por}` : ''}{m.justificacion ? ` · ${m.justificacion}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: ts.color }}>
                    {ts.sign} {fmt(m.monto, moneda)}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                    Saldo: {fmt(m.saldo, moneda)}
                  </div>
                </div>
                {(canEdit || canCreate) && (
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    {canEdit && (
                      <button onClick={() => openEdit(m)} style={{ padding: '5px 10px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>✏️</button>
                    )}
                    <button onClick={() => handleDelete(m)} style={{ padding: '5px 10px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-danger)' }}>🗑</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
