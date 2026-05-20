import { useState, type ReactNode} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
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
  borrador: { label: 'Borrador', bg: '#fef3c7', color: '#d97706' },
  cerrado:  { label: 'Cerrado',  bg: '#dcfce7', color: '#16a34a' },
}

export default function CierreAnualTab({ cierres, cuotas, gastos, proyectoId, companyId, moneda, autorNombre, canCreate, onRefresh }: Props) {
  const [selected, setSelected] = useState<CierreAnual | null>(null)
  const [saving, setSaving] = useState(false)

  async function generarCierre() {
    const anioActual = new Date().getFullYear()
    const { value: anio } = await Swal.fire({
      title: 'Generar cierre anual',
      html: `<p style="font-size:13px;margin-bottom:8px">Año a cerrar:</p>
             <input id="anio-cierre" class="swal2-input" type="number" value="${anioActual}" min="2020" max="${anioActual}" style="font-size:14px">`,
      showCancelButton: true, confirmButtonText: 'Generar', cancelButtonText: 'Cancelar',
      preConfirm: () => parseInt((document.getElementById('anio-cierre') as HTMLInputElement)?.value ?? ''),
    })
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
    const { error } = await supabase.from('cierres_anuales').upsert({
      company_id: companyId, project_id: proyectoId, anio,
      total_ingresos: parseFloat(total_ingresos.toFixed(2)),
      total_egresos: parseFloat(total_egresos.toFixed(2)),
      saldo, total_cuotas_generadas, total_cuotas_cobradas,
      tasa_recaudacion, unidades_morosas,
      monto_mora_total: parseFloat(monto_mora_total.toFixed(2)),
    }, { onConflict: 'project_id,anio' })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success(`Cierre ${anio} generado`)
    onRefresh()
  }

  async function firmar(c: CierreAnual) {
    const { isConfirmed } = await Swal.fire({
      title: `¿Cerrar definitivamente el año ${c.anio}?`,
      html: '<p style="font-size:13px;color:#3E5A4C">Esta acción marca el cierre como definitivo. No podrá volver a estado borrador.</p>',
      icon: 'warning', showCancelButton: true,
      confirmButtonText: 'Sí, cerrar', cancelButtonText: 'Cancelar',
    })
    if (!isConfirmed) return
    await supabase.from('cierres_anuales').update({
      estado: 'cerrado', firmado_por: autorNombre, fecha_cierre: new Date().toISOString(),
    }).eq('id', c.id)
    onRefresh()
  }

  const totalIngresos = cierres.reduce((s, c) => s + c.total_ingresos, 0)
  const totalEgresos = cierres.reduce((s, c) => s + c.total_egresos, 0)
  const saldoAcumulado = cierres.reduce((s, c) => s + c.saldo, 0)

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs globales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
        <div style={{ background: '#f0fdf4', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#16a34a' }}>{moneda} {totalIngresos.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 11, color: '#16a34a' }}>Ingresos totales (todos los años)</div>
        </div>
        <div style={{ background: '#fef2f2', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#ef4444' }}>{moneda} {totalEgresos.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 11, color: '#ef4444' }}>Egresos totales</div>
        </div>
        <div style={{ background: saldoAcumulado >= 0 ? '#EEF2EC' : '#fef2f2', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: saldoAcumulado >= 0 ? '#1B3B36' : '#ef4444' }}>
            {moneda} {Math.abs(saldoAcumulado).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 11, color: '#7E9389' }}>Saldo acumulado {saldoAcumulado < 0 ? '(déficit)' : '(superávit)'}</div>
        </div>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: '#7E9389' }}>{cierres.length} cierre(s) registrado(s)</span>
        {canCreate && (
          <button onClick={generarCierre} disabled={saving}
            style={{ padding: '8px 16px', background: '#577B69', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            {saving ? '⏳ Generando…' : '📊 Generar cierre anual'}
          </button>
        )}
      </div>

      {/* Lista + Detalle */}
      {cierres.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#7E9389', padding: '40px 0', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📆</div>
          Sin cierres anuales — genera el primero con el botón superior
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[...cierres].sort((a, b) => b.anio - a.anio).map(c => {
              const ec = ESTADO_CFG[c.estado]
              const tasaColor = (c.tasa_recaudacion ?? 0) >= 80 ? '#16a34a' : (c.tasa_recaudacion ?? 0) >= 60 ? '#d97706' : '#ef4444'
              return (
                <div key={c.id} onClick={() => setSelected(c === selected ? null : c)}
                  style={{ background: selected?.id === c.id ? '#f0fdfa' : '#fff', border: `1.5px solid ${selected?.id === c.id ? '#577B69' : '#E1DDD0'}`, borderRadius: 10, padding: '14px 16px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: '#15291F' }}>{c.anio}</div>
                      <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 20, fontSize: 12, color: '#7E9389' }}>
                      <span>Ingresos: <strong style={{ color: '#16a34a' }}>{moneda} {c.total_ingresos.toFixed(2)}</strong></span>
                      <span>Egresos: <strong style={{ color: '#ef4444' }}>{moneda} {c.total_egresos.toFixed(2)}</strong></span>
                      <span>Saldo: <strong style={{ color: c.saldo >= 0 ? '#1B3B36' : '#ef4444' }}>{moneda} {c.saldo.toFixed(2)}</strong></span>
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
            <div style={{ width: 280, flexShrink: 0, background: '#fff', border: '1px solid #E1DDD0', borderRadius: 12, padding: 16, alignSelf: 'flex-start' }}>
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
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '5px 0', borderBottom: '1px solid #EAE6D8' }}>
                  <span style={{ color: '#7E9389' }}>{k}</span>
                  <span style={{ fontWeight: 600, color: '#3E5A4C' }}>{v}</span>
                </div>
              ))}
              {selected.notas && <div style={{ fontSize: 11, color: '#7E9389', marginTop: 8 }}>{selected.notas}</div>}
              {selected.estado === 'borrador' && (
                <button onClick={() => firmar(selected)}
                  style={{ width: '100%', marginTop: 14, padding: '8px 0', background: '#577B69', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
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
