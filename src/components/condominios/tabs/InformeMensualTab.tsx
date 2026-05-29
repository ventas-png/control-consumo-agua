import { useState, type ReactNode} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { notify } from '../../shared/Dialog'
import { InformeMensual, EstadoInformeMensual, CuotaCondominio, GastoCondominio, TicketMantenimiento, Visitante, IncidenteSeguridad } from '../../../types'
import { exportarPDFInformeMensual } from '../exportUtils'

interface Props {
  informes: InformeMensual[]
  cuotas: CuotaCondominio[]
  gastos: GastoCondominio[]
  tickets: TicketMantenimiento[]
  visitantes: Visitante[]
  incidentes: IncidenteSeguridad[]
  proyectoId: string
  companyId: string
  moneda: string
  autorNombre: string
  canCreate: boolean
  onRefresh: () => void
}

const ESTADO_CFG: Record<EstadoInformeMensual, { label: string; bg: string; color: string }> = {
  borrador:  { label: 'Borrador',  bg: 'var(--at-warning-tint)', color: 'var(--at-warning)' },
  publicado: { label: 'Publicado', bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
}

export default function InformeMensualTab({ informes, cuotas, gastos, tickets, visitantes, incidentes, proyectoId, companyId, moneda, autorNombre, canCreate, onRefresh }: Props) {
  const [selected, setSelected] = useState<InformeMensual | null>(null)
  const [saving, setSaving] = useState(false)

  async function generar() {
    const { value: periodo } = await Swal.fire({
      title: 'Generar informe mensual',
      html: `<p style="font-size:13px;color:var(--at-ink-2);margin-bottom:8px">Período (YYYY-MM):</p>
             <input id="periodo-inf" class="swal2-input" type="month" value="${new Date().toISOString().slice(0,7)}" style="font-size:14px">`,
      showCancelButton: true, confirmButtonText: 'Generar', cancelButtonText: 'Cancelar',
      preConfirm: () => (document.getElementById('periodo-inf') as HTMLInputElement)?.value,
    })
    if (!periodo) return

    const ym = periodo // 'YYYY-MM'
    const cuotasMes = cuotas.filter(c => c.periodo === ym)
    const gastosMes = gastos.filter(g => g.fecha?.startsWith(ym))
    const ticketsMes = tickets.filter(t => t.created_at?.startsWith(ym))
    const visitantesMes = visitantes.filter(v => v.hora_entrada?.startsWith(ym))
    const incidentesMes = incidentes.filter(i => i.fecha?.startsWith(ym))

    setSaving(true)
    const { error } = await supabase.from('informes_mensuales').upsert({
      company_id: companyId, project_id: proyectoId, periodo: ym,
      total_cuotas: cuotasMes.length,
      cuotas_pagadas: cuotasMes.filter(c => c.estado === 'pagado').length,
      cuotas_morosas: cuotasMes.filter(c => c.estado === 'moroso').length,
      total_recaudado: parseFloat(cuotasMes.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0).toFixed(2)),
      total_gastos: parseFloat(gastosMes.reduce((s, g) => s + g.monto, 0).toFixed(2)),
      num_tickets: ticketsMes.length,
      tickets_resueltos: ticketsMes.filter(t => t.estado === 'resuelto' || t.estado === 'cerrado').length,
      num_visitantes: visitantesMes.length,
      num_incidentes: incidentesMes.length,
    }, { onConflict: 'project_id,periodo' })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    notify({ variant: 'success', title: `Informe ${ym} generado`, duration: 1600 })
    onRefresh()
  }

  async function publicar(c: InformeMensual) {
    const { value: notas } = await Swal.fire({
      title: `Publicar informe ${c.periodo}`,
      html: `<p style="font-size:13px;margin-bottom:8px">Notas del administrador (opcional):</p>
             <textarea id="notas-inf" class="swal2-textarea" style="font-size:13px">${c.notas ?? ''}</textarea>`,
      showCancelButton: true, confirmButtonText: 'Publicar', cancelButtonText: 'Cancelar',
      preConfirm: () => (document.getElementById('notas-inf') as HTMLTextAreaElement)?.value ?? '',
    })
    if (notas === undefined) return
    await supabase.from('informes_mensuales').update({
      estado: 'publicado', firmado_por: autorNombre, notas: notas || null,
    }).eq('id', c.id)
    onRefresh()
  }

  function stat(label: string, val: string | number, color: string, bg: string) {
    return (
      <div style={{ background: bg, borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color }}>{val}</div>
        <div style={{ fontSize: 10, color, lineHeight: 1.2 }}>{label}</div>
      </div>
    )
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--at-ink)' }}>Informes mensuales de operación</span>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>Resumen automático de indicadores por período</div>
        </div>
        {canCreate && (
          <button onClick={generar} disabled={saving}
            style={{ padding: '8px 16px', background: 'var(--at-accent-2)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            {saving ? '⏳ Generando…' : '📄 Generar informe'}
          </button>
        )}
      </div>

      {/* Lista + Detalle */}
      {informes.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
          Sin informes mensuales — genera el primero con el botón superior
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[...informes].sort((a, b) => b.periodo.localeCompare(a.periodo)).map(inf => {
              const ec = ESTADO_CFG[inf.estado]
              const tasa = inf.total_cuotas > 0 ? Math.round((inf.cuotas_pagadas / inf.total_cuotas) * 100) : 0
              const saldo = inf.total_recaudado - inf.total_gastos
              return (
                <div key={inf.id} onClick={() => setSelected(inf === selected ? null : inf)}
                  style={{ background: selected?.id === inf.id ? '#f0fdfa' : 'var(--at-surface)', border: `1.5px solid ${selected?.id === inf.id ? 'var(--at-accent-2)' : 'var(--at-line)'}`, borderRadius: 10, padding: '14px 16px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--at-ink)' }}>{inf.periodo}</span>
                      <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
                      {inf.firmado_por && <span style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>— {inf.firmado_por}</span>}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: saldo >= 0 ? 'var(--at-success)' : 'var(--at-danger)' }}>
                      {saldo >= 0 ? '+' : ''}{moneda} {saldo.toFixed(2)}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 6 }}>
                    {stat('Recaudado', `${moneda} ${inf.total_recaudado.toFixed(2)}`, 'var(--at-success)', 'var(--at-success-tint)')}
                    {stat('Gastos', `${moneda} ${inf.total_gastos.toFixed(2)}`, 'var(--at-danger)', 'var(--at-danger-tint)')}
                    {stat('Recaudación', `${tasa}%`, tasa >= 80 ? 'var(--at-success)' : 'var(--at-warning)', tasa >= 80 ? 'var(--at-success-tint)' : 'var(--at-warning-tint)')}
                    {stat('Tickets', inf.num_tickets, 'var(--at-accent-hover)', 'var(--at-accent-tint-2)')}
                    {stat('Visitantes', inf.num_visitantes, 'var(--at-primary-hover)', 'var(--at-primary-tint)')}
                    {stat('Incidentes', inf.num_incidentes, inf.num_incidentes > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)', inf.num_incidentes > 0 ? 'var(--at-danger-tint)' : 'var(--at-surface-2)')}
                  </div>
                </div>
              )
            })}
          </div>
          {selected && (
            <div style={{ width: 280, flexShrink: 0, background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16, alignSelf: 'flex-start' }}>
              <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 15 }}>Informe {selected.periodo}</div>
              {([
                ['Estado', <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: ESTADO_CFG[selected.estado].bg, color: ESTADO_CFG[selected.estado].color }}>{ESTADO_CFG[selected.estado].label}</span>],
                ['Cuotas generadas', selected.total_cuotas],
                ['Cuotas pagadas', selected.cuotas_pagadas],
                ['Cuotas morosas', selected.cuotas_morosas],
                ['Total recaudado', `${moneda} ${selected.total_recaudado.toFixed(2)}`],
                ['Total gastos', `${moneda} ${selected.total_gastos.toFixed(2)}`],
                ['Saldo', `${moneda} ${(selected.total_recaudado - selected.total_gastos).toFixed(2)}`],
                ['Tickets abiertos', selected.num_tickets],
                ['Tickets resueltos', selected.tickets_resueltos],
                ['Visitantes', selected.num_visitantes],
                ['Incidentes', selected.num_incidentes],
                ['Firmado por', selected.firmado_por ?? '—'],
              ] as [string, ReactNode][]).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '5px 0', borderBottom: '1px solid var(--at-chip)' }}>
                  <span style={{ color: 'var(--at-ink-3)' }}>{k}</span>
                  <span style={{ fontWeight: 600, color: 'var(--at-ink-2)' }}>{v}</span>
                </div>
              ))}
              {selected.notas && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 8, lineHeight: 1.4, background: 'var(--at-surface-2)', borderRadius: 6, padding: '8px 10px' }}>{selected.notas}</div>}
              <button onClick={() => exportarPDFInformeMensual(selected, moneda, autorNombre)}
                style={{ width: '100%', marginTop: 14, padding: '8px 0', background: 'var(--at-primary-hover)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                📄 Descargar PDF
              </button>
              {selected.estado === 'borrador' && (
                <button onClick={() => publicar(selected)}
                  style={{ width: '100%', marginTop: 8, padding: '8px 0', background: 'var(--at-accent-2)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  📢 Publicar informe
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
