import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { CierreMensual, CuotaCondominio, GastoCondominio } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { exportarPDFTabla } from '../exportUtils'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

interface Props {
  cierres: CierreMensual[]
  cuotas: CuotaCondominio[]
  gastos: GastoCondominio[]
  proyectoId: string
  companyId: string
  moneda: string
  proyectoNombre?: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

function getPeriodo(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function calcCierre(periodo: string, cuotas: CuotaCondominio[], gastos: GastoCondominio[]) {
  const cuotasPeriodo = cuotas.filter(c => c.periodo === periodo)
  const gastosPeriodo = gastos.filter(g => g.fecha.startsWith(periodo) && g.estado === 'pagado')
  const totalEmitidas = cuotasPeriodo.reduce((s, c) => s + c.monto, 0)
  const totalCobradas = cuotasPeriodo.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0)
  const totalGastos   = gastosPeriodo.reduce((s, g) => s + g.monto, 0)
  const unidadesMorosas = new Set(cuotasPeriodo.filter(c => c.estado === 'moroso').map(c => c.unidad_id)).size
  return { totalEmitidas, totalCobradas, totalGastos, saldo: totalCobradas - totalGastos, unidadesMorosas }
}

export function CierresMensualesTab({ cierres, cuotas, gastos, proyectoId, companyId, moneda, proyectoNombre = 'Condominio', canCreate, canEdit, onRefresh }: Props) {
  const now = new Date()
  const [periodoNuevo, setPeriodoNuevo] = useState(getPeriodo(new Date(now.getFullYear(), now.getMonth() - 1)))
  const [notas, setNotas] = useState('')
  const [cerradoPor, setCerradoPor] = useState('')
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)

  const sorted = [...cierres].sort((a, b) => b.periodo.localeCompare(a.periodo))
  const periodosCerrados = new Set(cierres.map(c => c.periodo))
  const preview = previewing ? calcCierre(periodoNuevo, cuotas, gastos) : null

  async function handleGenerar() {
    if (!periodoNuevo) return notify({ variant: 'warning', title: 'Requerido', text: 'Selecciona el período a cerrar.' })
    if (periodosCerrados.has(periodoNuevo)) return notify({ variant: 'info', title: 'Ya existe', text: `El período ${periodoNuevo} ya tiene cierre.` })
    const calc = calcCierre(periodoNuevo, cuotas, gastos)
    const r = await confirm({
      title: `Generar cierre ${periodoNuevo}`,
      text: `Cuotas emitidas: ${moneda} ${calc.totalEmitidas.toFixed(2)} · `
          + `Cobradas: ${moneda} ${calc.totalCobradas.toFixed(2)} · `
          + `Gastos: ${moneda} ${calc.totalGastos.toFixed(2)} · `
          + `Saldo: ${moneda} ${calc.saldo.toFixed(2)} · `
          + `Unidades morosas: ${calc.unidadesMorosas}`,
      icon: 'question',
      confirmText: 'Confirmar Cierre',
    })
    if (!r.isConfirmed) return
    setSaving(true)
    const { error } = await supabase.from('cierres_mensuales').insert({
      company_id: companyId, project_id: proyectoId, periodo: periodoNuevo,
      total_cuotas_emitidas: calc.totalEmitidas, total_cuotas_cobradas: calc.totalCobradas,
      total_gastos: calc.totalGastos, saldo_periodo: calc.saldo,
      unidades_morosas: calc.unidadesMorosas,
      notas: notas || null, cerrado_por: cerradoPor || null, estado: 'borrador',
    })
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setNotas(''); setCerradoPor(''); setPreviewing(false); onRefresh()
  }

  function exportarPDF(c: CierreMensual) {
    exportarPDFTabla({
      titulo: `Cierre Mensual — ${c.periodo}`,
      subtitulo: `Estado: ${c.estado === 'cerrado' ? 'Cerrado' : 'Borrador'}${c.cerrado_por ? ` · ${c.cerrado_por}` : ''}`,
      proyectoNombre,
      headers: ['Indicador', 'Valor'],
      rows: [
        ['Cuotas emitidas',  `${moneda} ${c.total_cuotas_emitidas.toFixed(2)}`],
        ['Cuotas cobradas',  `${moneda} ${c.total_cuotas_cobradas.toFixed(2)}`],
        ['Total gastos',     `${moneda} ${c.total_gastos.toFixed(2)}`],
        ['Saldo del período', `${c.saldo_periodo >= 0 ? '+' : ''}${moneda} ${c.saldo_periodo.toFixed(2)}`],
        ['Unidades morosas', String(c.unidades_morosas)],
        ['Estado',           c.estado === 'cerrado' ? 'Cerrado' : 'Borrador'],
        ['Notas',            c.notas ?? '—'],
      ],
      rightAlignCols: [1],
      filename: `cierre-${c.periodo}`,
    })
  }

  async function toggleEstado(c: CierreMensual) {
    const nuevoEstado = c.estado === 'cerrado' ? 'borrador' : 'cerrado'
    if (nuevoEstado === 'cerrado') {
      const r = await confirm({ title: `¿Cerrar período ${c.periodo}?`, text: 'Un cierre finalizado bloquea modificaciones.', icon: 'warning', variant: 'danger', confirmText: 'Cerrar período' })
      if (!r.isConfirmed) return
    }
    await supabase.from('cierres_mensuales').update({ estado: nuevoEstado }).eq('id', c.id)
    onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: '¿Eliminar cierre?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await supabase.from('cierres_mensuales').delete().eq('id', id)
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface)', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Cierres Mensuales</h2>
      </div>

      {/* Generate new close */}
      {canCreate && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>Generar nuevo cierre</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Período *</label>
              <input style={inputStyle} type="month" value={periodoNuevo} onChange={e => { setPeriodoNuevo(e.target.value); setPreviewing(false) }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Cerrado por</label>
              <input style={inputStyle} value={cerradoPor} onChange={e => setCerradoPor(e.target.value)} placeholder="Administración" />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Notas</label>
              <input style={inputStyle} value={notas} onChange={e => setNotas(e.target.value)} placeholder="Observaciones del período (opcional)" />
            </div>
          </div>

          {/* Preview */}
          {periodoNuevo && (
            <div>
              <button onClick={() => setPreviewing(v => !v)} style={{ padding: '6px 12px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', marginRight: '8px' }}>
                {previewing ? '▾ Ocultar' : '▸ Vista previa'}
              </button>
              <button onClick={handleGenerar} disabled={saving || periodosCerrados.has(periodoNuevo)}
                style={{ padding: '6px 18px', background: periodosCerrados.has(periodoNuevo) ? 'var(--at-line)' : 'var(--at-primary)', color: periodosCerrados.has(periodoNuevo) ? 'var(--at-ink-3)' : 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: periodosCerrados.has(periodoNuevo) ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Generando…' : periodosCerrados.has(periodoNuevo) ? '✓ Ya existe' : '⚡ Generar cierre'}
              </button>
            </div>
          )}

          {previewing && preview && (
            <div style={{ marginTop: '12px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' }}>
                {[
                  { label: 'Cuotas emitidas', value: preview.totalEmitidas,    color: 'var(--at-primary)' },
                  { label: 'Cuotas cobradas', value: preview.totalCobradas,    color: 'var(--at-success)' },
                  { label: 'Gastos del mes',  value: preview.totalGastos,      color: 'var(--at-danger)' },
                  { label: 'Saldo neto',      value: preview.saldo,            color: preview.saldo >= 0 ? 'var(--at-success)' : 'var(--at-danger)' },
                ].map(k => (
                  <div key={k.label} style={{ textAlign: 'center', padding: '8px' }}>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: k.color }}>{moneda} {k.value.toFixed(2)}</div>
                    <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{k.label}</div>
                  </div>
                ))}
              </div>
              {preview.unidadesMorosas > 0 && <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--at-danger)', fontWeight: 600 }}>⚠️ {preview.unidadesMorosas} unidad(es) con cuotas morosas</div>}
            </div>
          )}
        </div>
      )}

      {/* Table — F3.9: migrado a <DataTable> shared */}
      <DataTable<CierreMensual>
        data={sorted}
        rowKey="id"
        pageSize={50}
        emptyState={{ icon: '📋', title: 'No hay cierres mensuales registrados' }}
        columns={[
          { key: 'periodo', header: 'Período', sortable: true,
            render: (c) => <span style={{ fontWeight: 700 }}>{c.periodo}</span> },
          { key: 'total_cuotas_emitidas', header: 'Cuotas emitidas', align: 'right', sortable: true, hideOnMobile: true,
            render: (c) => <span style={{ color: 'var(--at-ink-3)' }}>{moneda} {c.total_cuotas_emitidas.toFixed(2)}</span> },
          { key: 'total_cuotas_cobradas', header: 'Cuotas cobradas', align: 'right', sortable: true,
            render: (c) => <span style={{ color: 'var(--at-success)', fontWeight: 600 }}>{moneda} {c.total_cuotas_cobradas.toFixed(2)}</span> },
          { key: 'total_gastos', header: 'Gastos', align: 'right', sortable: true, hideOnMobile: true,
            render: (c) => <span style={{ color: 'var(--at-danger)' }}>{moneda} {c.total_gastos.toFixed(2)}</span> },
          { key: 'saldo_periodo', header: 'Saldo', align: 'right', sortable: true,
            render: (c) => <span style={{ fontWeight: 700, color: c.saldo_periodo >= 0 ? 'var(--at-success)' : 'var(--at-danger)' }}>
              {c.saldo_periodo >= 0 ? '+' : ''}{moneda} {c.saldo_periodo.toFixed(2)}
            </span> },
          { key: 'unidades_morosas', header: 'Morosas', align: 'right', sortable: true,
            render: (c) => <span style={{ color: c.unidades_morosas > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)', fontWeight: c.unidades_morosas > 0 ? 700 : 400 }}>{c.unidades_morosas}</span> },
          { key: 'estado', header: 'Estado', sortable: true,
            render: (c) => (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                background: c.estado === 'cerrado' ? 'var(--at-success-tint)' : 'var(--at-warning-tint)',
                color: c.estado === 'cerrado' ? 'var(--at-success)' : 'var(--at-warning-strong)' }}>
                {c.estado === 'cerrado' ? '✓ Cerrado' : 'Borrador'}
              </span>
            ) },
          { key: 'actions', header: '', align: 'right',
            render: (c) => (
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <button onClick={(e) => { e.stopPropagation(); exportarPDF(c) }}
                  style={{ padding: '3px 7px', background: 'var(--at-primary-tint)', border: 'none', borderRadius: 5, fontSize: 11, cursor: 'pointer', color: 'var(--at-primary)', fontWeight: 600 }} title="Exportar PDF" aria-label="Exportar PDF">📄</button>
                {canEdit && (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); toggleEstado(c) }}
                      style={{ padding: '3px 8px', background: c.estado === 'cerrado' ? 'var(--at-warning-tint)' : 'var(--at-success-tint)', color: c.estado === 'cerrado' ? 'var(--at-warning-strong)' : 'var(--at-success)', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                      {c.estado === 'cerrado' ? '↩ Reabrir' : '✓ Cerrar'}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(c.id) }} aria-label="Eliminar cierre"
                      style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: 5, fontSize: 11, cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
                  </>
                )}
              </div>
            ) },
        ] satisfies DataTableColumn<CierreMensual>[]}
      />
    </div>
  )
}
