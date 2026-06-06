import { useState, type ReactNode} from 'react'
import { upsertCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { confirm } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import { toast } from '../../../lib/toast'
import { CierreAnual, EstadoCierreAnual, CuotaCondominio, GastoCondominio } from '../../../types'

interface Props {
  cierres: CierreAnual[]
  cuotas: CuotaCondominio[]
  gastos: GastoCondominio[]
  proyectoId: string
  companyId: string
  moneda: string
  autorNombre: string
  canCreate: boolean
  onRefresh: () => void
}

const ESTADO_CFG: Record<EstadoCierreAnual, { label: string; bg: string; color: string }> = {
  borrador: { label: 'Borrador', bg: 'var(--at-warning-tint)', color: 'var(--at-warning)' },
  cerrado:  { label: 'Cerrado',  bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
}

export default function CierreAnualTab({ cierres, cuotas, gastos, proyectoId, companyId, moneda, autorNombre, canCreate, onRefresh }: Props) {
  const [selected, setSelected] = useState<CierreAnual | null>(null)
  const [saving, setSaving] = useState(false)

  async function generarCierre() {
    const anioActual = new Date().getFullYear()
    const result = await openPromptDialog({
      title: 'Generar cierre anual',
      fields: [{
        name: 'anio',
        label: 'Año a cerrar',
        type: 'number',
        required: true,
        initialValue: String(anioActual),
        min: 2020,
        max: anioActual,
        autoFocus: true,
      }],
      submitText: 'Generar',
    })
    if (!result) return
    const anio = parseInt(result.anio)
    if (!anio) return

    const periodoPrefix = String(anio)
    const cuotasAnio = cuotas.filter(c => c.periodo?.startsWith(periodoPrefix))
    const gastosAnio = gastos.filter(g => g.fecha?.startsWith(periodoPrefix))

    const total_cuotas_generadas = cuotasAnio.length
    const total_cuotas_cobradas = cuotasAnio.filter(c => c.estado === 'pagado').length
    const total_ingresos = cuotasAnio.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0)
    const total_egresos = gastosAnio.reduce((s, g) => s + g.monto, 0)
    const saldo = parseFloat((total_ingresos - total_egresos).toFixed(2))
    const tasa_recaudacion = total_cuotas_generadas > 0
      ? parseFloat(((total_cuotas_cobradas / total_cuotas_generadas) * 100).toFixed(2))
      : null
    const unidades_morosas = [...new Set(cuotasAnio.filter(c => c.estado === 'moroso').map(c => c.unidad_id))].length
    const monto_mora_total = cuotasAnio.filter(c => c.estado === 'moroso').reduce((s, c) => s + c.monto, 0)

    setSaving(true)
    const { error } = await upsertCondominioRow('cierres_anuales', {
      company_id: companyId, project_id: proyectoId, anio,
      total_ingresos: parseFloat(total_ingresos.toFixed(2)),
      total_egresos: parseFloat(total_egresos.toFixed(2)),
      saldo, total_cuotas_generadas, total_cuotas_cobradas,
      tasa_recaudacion, unidades_morosas,
      monto_mora_total: parseFloat(monto_mora_total.toFixed(2)),
    }, 'project_id,anio')
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success(`Cierre ${anio} generado`)
    onRefresh()
  }

  async function firmar(c: CierreAnual) {
    const { isConfirmed } = await confirm({
      title: `¿Cerrar definitivamente el año ${c.anio}?`,
      text: 'Esta acción marca el cierre como definitivo. No podrá volver a estado borrador.',
      icon: 'warning',
      variant: 'danger',
      confirmText: 'Sí, cerrar',
    })
    if (!isConfirmed) return
    await updateCondominioRow('cierres_anuales', c.id, {
      estado: 'cerrado', firmado_por: autorNombre, fecha_cierre: new Date().toISOString(),
    })
    onRefresh()
  }

  const totalIngresos = cierres.reduce((s, c) => s + c.total_ingresos, 0)
  const totalEgresos = cierres.reduce((s, c) => s + c.total_egresos, 0)
  const saldoAcumulado = cierres.reduce((s, c) => s + c.saldo, 0)

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs globales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
        <div style={{ background: 'var(--at-success-tint)', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--at-success)' }}>{moneda} {totalIngresos.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 11, color: 'var(--at-success)' }}>Ingresos totales (todos los años)</div>
        </div>
        <div style={{ background: 'var(--at-danger-tint)', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--at-danger)' }}>{moneda} {totalEgresos.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 11, color: 'var(--at-danger)' }}>Egresos totales</div>
        </div>
        <div style={{ background: saldoAcumulado >= 0 ? 'var(--at-primary-tint)' : 'var(--at-danger-tint)', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: saldoAcumulado >= 0 ? 'var(--at-primary)' : 'var(--at-danger)' }}>
            {moneda} {Math.abs(saldoAcumulado).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Saldo acumulado {saldoAcumulado < 0 ? '(déficit)' : '(superávit)'}</div>
        </div>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: 'var(--at-ink-3)' }}>{cierres.length} cierre(s) registrado(s)</span>
        {canCreate && (
          <button onClick={generarCierre} disabled={saving}
            style={{ padding: '8px 16px', background: 'var(--at-accent-2)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            {saving ? '⏳ Generando…' : '📊 Generar cierre anual'}
          </button>
        )}
      </div>

      {/* Lista + Detalle */}
      {cierres.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📆</div>
          Sin cierres anuales — genera el primero con el botón superior
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[...cierres].sort((a, b) => b.anio - a.anio).map(c => {
              const ec = ESTADO_CFG[c.estado]
              const tasaColor = (c.tasa_recaudacion ?? 0) >= 80 ? 'var(--at-success)' : (c.tasa_recaudacion ?? 0) >= 60 ? 'var(--at-warning)' : 'var(--at-danger)'
              return (
                <div key={c.id} onClick={() => setSelected(c === selected ? null : c)}
                  style={{ background: selected?.id === c.id ? '#f0fdfa' : 'var(--at-surface)', border: `1.5px solid ${selected?.id === c.id ? 'var(--at-accent-2)' : 'var(--at-line)'}`, borderRadius: 10, padding: '14px 16px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--at-ink)' }}>{c.anio}</div>
                      <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 20, fontSize: 12, color: 'var(--at-ink-3)' }}>
                      <span>Ingresos: <strong style={{ color: 'var(--at-success)' }}>{moneda} {c.total_ingresos.toFixed(2)}</strong></span>
                      <span>Egresos: <strong style={{ color: 'var(--at-danger)' }}>{moneda} {c.total_egresos.toFixed(2)}</strong></span>
                      <span>Saldo: <strong style={{ color: c.saldo >= 0 ? 'var(--at-primary)' : 'var(--at-danger)' }}>{moneda} {c.saldo.toFixed(2)}</strong></span>
                      {c.tasa_recaudacion != null && (
                        <span>Recaudación: <strong style={{ color: tasaColor }}>{c.tasa_recaudacion}%</strong></span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {selected && (
            <div style={{ width: 280, flexShrink: 0, background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16, alignSelf: 'flex-start' }}>
              <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 15 }}>Cierre {selected.anio}</div>
              {([
                ['Estado', <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: ESTADO_CFG[selected.estado].bg, color: ESTADO_CFG[selected.estado].color }}>{ESTADO_CFG[selected.estado].label}</span>],
                ['Total ingresos', `${moneda} ${selected.total_ingresos.toFixed(2)}`],
                ['Total egresos', `${moneda} ${selected.total_egresos.toFixed(2)}`],
                ['Saldo', `${moneda} ${selected.saldo.toFixed(2)}`],
                ['Cuotas generadas', selected.total_cuotas_generadas],
                ['Cuotas cobradas', selected.total_cuotas_cobradas],
                ['Tasa recaudación', selected.tasa_recaudacion != null ? `${selected.tasa_recaudacion}%` : '—'],
                ['Unidades morosas', selected.unidades_morosas],
                ['Monto mora', `${moneda} ${selected.monto_mora_total.toFixed(2)}`],
                ['Firmado por', selected.firmado_por ?? '—'],
                ['Fecha cierre', selected.fecha_cierre ? new Date(selected.fecha_cierre).toLocaleDateString('es') : '—'],
              ] as [string, ReactNode][]).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '5px 0', borderBottom: '1px solid var(--at-chip)' }}>
                  <span style={{ color: 'var(--at-ink-3)' }}>{k}</span>
                  <span style={{ fontWeight: 600, color: 'var(--at-ink-2)' }}>{v}</span>
                </div>
              ))}
              {selected.notas && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 8 }}>{selected.notas}</div>}
              {selected.estado === 'borrador' && (
                <button onClick={() => firmar(selected)}
                  style={{ width: '100%', marginTop: 14, padding: '8px 0', background: 'var(--at-accent-2)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  🔒 Cerrar definitivamente
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
