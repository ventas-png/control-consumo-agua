import { CuotaCondominio, GastoCondominio, TicketMantenimiento, Visitante, Unidad, PolizaSeguro, ContratoProveedor, InspeccionNormativa, SugerenciaCondominio } from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  gastos: GastoCondominio[]
  tickets: TicketMantenimiento[]
  visitantes: Visitante[]
  unidades: Unidad[]
  polizas: PolizaSeguro[]
  contratosProveedores: ContratoProveedor[]
  inspecciones: InspeccionNormativa[]
  sugerencias: SugerenciaCondominio[]
  moneda: string
  proyectoNombre?: string
}

function diasHasta(fecha: string): number {
  return Math.ceil((new Date(fecha).getTime() - Date.now()) / 86400000)
}

export default function InformeEjecutivoTab({
  cuotas, gastos, tickets, visitantes, unidades,
  polizas, contratosProveedores, inspecciones, sugerencias,
  moneda, proyectoNombre,
}: Props) {
  const hoy = new Date()
  const mesActual = hoy.toISOString().slice(0, 7)
  const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

  function build() {
    // — Financiero —
    const cuotasMes = cuotas.filter(c => c.periodo === mesActual)
    const cobradoMes = cuotasMes.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0)
    const totalMes   = cuotasMes.reduce((s, c) => s + c.monto, 0)
    const tasaCobro  = totalMes > 0 ? cobradoMes / totalMes : 0
    const gastosMes  = gastos.filter(g => g.fecha?.startsWith(mesActual) && g.estado !== 'anulado').reduce((s, g) => s + g.monto, 0)
    const superavit  = cobradoMes - gastosMes
    const deudaTotal = cuotas.filter(c => c.estado === 'pendiente' || c.estado === 'moroso').reduce((s, c) => s + c.monto, 0)
    const morosos    = new Set(cuotas.filter(c => c.estado === 'moroso').map(c => c.unidad_id)).size

    // — Mantenimiento —
    const ticketsAbiertos  = tickets.filter(t => t.estado !== 'cerrado').length
    const ticketsUrgentes  = tickets.filter(t => t.prioridad === 'urgente' && t.estado !== 'cerrado').length
    const ticketsCerradosMes = tickets.filter(t => t.fecha_cierre?.startsWith(mesActual)).length
    const costoMantoMes    = tickets.filter(t => t.fecha_cierre?.startsWith(mesActual)).reduce((s, t) => s + (t.costo_real ?? 0), 0)

    // — Contratos y riesgo —
    const polizasVencen60  = polizas.filter(p => p.estado === 'vigente' && p.fecha_vencimiento && diasHasta(p.fecha_vencimiento) <= 60).length
    const contratosVencen90 = contratosProveedores.filter(c => c.estado === 'activo' && c.fecha_fin && diasHasta(c.fecha_fin) <= 90).length
    const inspFallidas     = inspecciones.filter(i => i.resultado === 'reprobado').length

    // — Comunidad —
    const visitasMes   = visitantes.filter(v => v.hora_entrada?.startsWith(mesActual)).length
    const sugerPend    = sugerencias.filter(s => s.estado === 'pendiente').length

    // — Histórico 6 meses —
    const hist = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - (5 - i), 1)
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const ing = cuotas.filter(c => c.periodo === mes && c.estado === 'pagado').reduce((s, c) => s + c.monto, 0)
      const egr = gastos.filter(g => g.fecha?.startsWith(mes) && g.estado !== 'anulado').reduce((s, g) => s + g.monto, 0)
      return { mes, ing, egr, label: MESES[d.getMonth()] }
    })

    const maxHist = Math.max(...hist.map(h => Math.max(h.ing, h.egr)), 1)
    const BAR_H = 60

    const barraH = (v: number, color: string) =>
      `<div style="width:24px;height:${Math.round((v/maxHist)*BAR_H)}px;background:${color};border-radius:3px 3px 0 0;margin:auto;min-height:${v>0?2:0}px"></div>`

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Informe Ejecutivo — ${proyectoNombre ?? 'Condominio'}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,sans-serif;padding:32px;max-width:960px;margin:auto;color:#15291F;font-size:13px;line-height:1.5}
  .header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #15291F;padding-bottom:14px;margin-bottom:24px}
  h1{margin:0;font-size:22px}
  h3{font-size:14px;font-weight:700;color:#15291F;border-bottom:1px solid #E1DDD0;padding-bottom:6px;margin:20px 0 12px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}
  .kpi{border-radius:10px;padding:12px 14px;border:1px solid #E1DDD0}
  .kpi-label{font-size:10px;color:#7E9389;margin-bottom:4px}
  .kpi-val{font-size:18px;font-weight:800}
  .section{background:#FAF7EF;border-radius:10px;padding:14px 18px;margin-bottom:16px}
  .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #EAE6D8;font-size:12px}
  .row:last-child{border-bottom:none}
  .label{color:#7E9389}
  .value{font-weight:700}
  .ok{color:#16a34a}.warn{color:#d97706}.bad{color:#ef4444}
  .chart{display:flex;gap:8px;align-items:flex-end;height:${BAR_H+20}px;margin-top:8px}
  .bar-wrap{flex:1;text-align:center}
  .bar-group{display:flex;gap:2px;justify-content:center;align-items:flex-end;height:${BAR_H}px}
  .bar-label{font-size:9px;color:#7E9389;margin-top:4px}
  .footer{margin-top:32px;font-size:10px;color:#7E9389;border-top:1px solid #E1DDD0;padding-top:10px;display:flex;justify-content:space-between}
  .alert-box{background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;margin-bottom:8px;font-size:12px}
  .alert-title{font-weight:700;color:#ef4444;margin-bottom:2px}
  @media print{body{padding:20px}}
</style>
</head><body>
<div class="header">
  <div>
    <h1>${proyectoNombre ?? 'Condominio'}</h1>
    <div style="font-size:12px;color:#7E9389;margin-top:4px">Informe Ejecutivo Mensual — ${MESES[hoy.getMonth()]} ${hoy.getFullYear()}</div>
  </div>
  <div style="text-align:right;font-size:11px;color:#7E9389">
    Generado: ${hoy.toLocaleDateString('es', { day:'2-digit', month:'long', year:'numeric' })}<br>
    ${unidades.length} unidades registradas
  </div>
</div>

<h3>📊 Resumen Financiero del Mes</h3>
<div class="kpis">
  <div class="kpi" style="background:#dcfce7">
    <div class="kpi-label">Cobrado este mes</div>
    <div class="kpi-val ok">${moneda} ${cobradoMes.toLocaleString('es',{minimumFractionDigits:2})}</div>
  </div>
  <div class="kpi" style="background:#fef2f2">
    <div class="kpi-label">Egresos este mes</div>
    <div class="kpi-val bad">${moneda} ${gastosMes.toLocaleString('es',{minimumFractionDigits:2})}</div>
  </div>
  <div class="kpi" style="background:${superavit>=0?'#dcfce7':'#fef2f2'}">
    <div class="kpi-label">Superávit / Déficit</div>
    <div class="kpi-val ${superavit>=0?'ok':'bad'}">${superavit>=0?'+':''}${moneda} ${superavit.toLocaleString('es',{minimumFractionDigits:2})}</div>
  </div>
  <div class="kpi" style="background:${tasaCobro>=0.9?'#dcfce7':tasaCobro>=0.7?'#fef3c7':'#fef2f2'}">
    <div class="kpi-label">Tasa de cobro</div>
    <div class="kpi-val ${tasaCobro>=0.9?'ok':tasaCobro>=0.7?'warn':'bad'}">${Math.round(tasaCobro*100)}%</div>
  </div>
</div>

<div class="section">
  <div class="row"><span class="label">Deuda total acumulada</span><span class="value bad">${moneda} ${deudaTotal.toLocaleString('es',{minimumFractionDigits:2})}</span></div>
  <div class="row"><span class="label">Unidades morosas</span><span class="value ${morosos>0?'bad':'ok'}">${morosos} de ${unidades.length}</span></div>
  <div class="row"><span class="label">Cuotas emitidas este mes</span><span class="value">${cuotasMes.length} cuotas · ${moneda} ${totalMes.toLocaleString('es',{minimumFractionDigits:2})}</span></div>
</div>

<h3>📈 Evolución Financiera — Últimos 6 Meses</h3>
<div class="chart">
  ${hist.map(m => `
  <div class="bar-wrap">
    <div class="bar-group">
      ${barraH(m.ing,'#16a34a')}${barraH(m.egr,'#ef4444')}
    </div>
    <div class="bar-label">${m.label}</div>
  </div>`).join('')}
</div>
<div style="display:flex;gap:16px;font-size:10px;margin-top:6px">
  <span><span style="display:inline-block;width:10px;height:10px;background:#16a34a;border-radius:2px;margin-right:4px"></span>Ingresos</span>
  <span><span style="display:inline-block;width:10px;height:10px;background:#ef4444;border-radius:2px;margin-right:4px"></span>Egresos</span>
</div>

<h3>🔧 Mantenimiento</h3>
<div class="kpis">
  <div class="kpi" style="background:${ticketsUrgentes>0?'#fef2f2':'var(--at-surface-2)'}">
    <div class="kpi-label">Tickets urgentes abiertos</div>
    <div class="kpi-val ${ticketsUrgentes>0?'bad':'ok'}">${ticketsUrgentes}</div>
  </div>
  <div class="kpi" style="background:#fef3c7">
    <div class="kpi-label">Total tickets activos</div>
    <div class="kpi-val warn">${ticketsAbiertos}</div>
  </div>
  <div class="kpi" style="background:#dcfce7">
    <div class="kpi-label">Cerrados este mes</div>
    <div class="kpi-val ok">${ticketsCerradosMes}</div>
  </div>
  <div class="kpi" style="background:var(--at-primary-tint)">
    <div class="kpi-label">Costo manto. mes</div>
    <div class="kpi-val" style="color:var(--at-primary)">${moneda} ${costoMantoMes.toLocaleString('es',{minimumFractionDigits:2})}</div>
  </div>
</div>

<h3>🛡️ Riesgos y Cumplimiento</h3>
<div class="section">
  <div class="row"><span class="label">Pólizas vencen en ≤60 días</span><span class="value ${polizasVencen60>0?'warn':'ok'}">${polizasVencen60}</span></div>
  <div class="row"><span class="label">Contratos vencen en ≤90 días</span><span class="value ${contratosVencen90>0?'warn':'ok'}">${contratosVencen90}</span></div>
  <div class="row"><span class="label">Inspecciones reprobadas</span><span class="value ${inspFallidas>0?'bad':'ok'}">${inspFallidas}</span></div>
</div>

<h3>🏘️ Comunidad y Operaciones</h3>
<div class="section">
  <div class="row"><span class="label">Visitas registradas este mes</span><span class="value">${visitasMes}</span></div>
  <div class="row"><span class="label">Sugerencias sin responder</span><span class="value ${sugerPend>0?'warn':'ok'}">${sugerPend}</span></div>
  <div class="row"><span class="label">Unidades totales</span><span class="value">${unidades.length}</span></div>
</div>

${ticketsUrgentes > 0 || polizasVencen60 > 0 || morosos > 5 ? `
<h3>⚠️ Puntos de Atención Prioritaria</h3>
${ticketsUrgentes > 0 ? `<div class="alert-box"><div class="alert-title">Tickets urgentes sin resolver</div>${ticketsUrgentes} ticket(s) urgente(s) requieren atención inmediata.</div>` : ''}
${polizasVencen60 > 0 ? `<div class="alert-box"><div class="alert-title">Pólizas próximas a vencer</div>${polizasVencen60} póliza(s) vencen en menos de 60 días.</div>` : ''}
${morosos > 5 ? `<div class="alert-box"><div class="alert-title">Alto nivel de morosidad</div>${morosos} unidades en estado moroso. Considerar acciones de cobro.</div>` : ''}
` : ''}

<div class="footer">
  <span>${proyectoNombre ?? 'Condominio'} · Informe generado automáticamente</span>
  <span>Sistema de Administración Condominios</span>
</div>
</body></html>`

    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close(); win.print() }
  }

  // Preview data
  const cuotasMes = cuotas.filter(c => c.periodo === mesActual)
  const cobrado = cuotasMes.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0)
  const total   = cuotasMes.reduce((s, c) => s + c.monto, 0)
  const tasaCobro = total > 0 ? cobrado / total : 0
  const gastosMes = gastos.filter(g => g.fecha?.startsWith(mesActual) && g.estado !== 'anulado').reduce((s, g) => s + g.monto, 0)

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)', marginBottom: 2 }}>Informe Ejecutivo</div>
      <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 16 }}>
        Genera un PDF consolidado con todos los KPIs del condominio — listo para presentar a la junta directiva
      </div>

      {/* Preview */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Cobrado este mes', val: `${moneda} ${cobrado.toLocaleString('es', { minimumFractionDigits: 2 })}`, color: '#16a34a', bg: '#dcfce7' },
          { label: 'Egresos este mes', val: `${moneda} ${gastosMes.toLocaleString('es', { minimumFractionDigits: 2 })}`, color: '#ef4444', bg: '#fef2f2' },
          { label: 'Tasa de cobro', val: `${Math.round(tasaCobro * 100)}%`, color: tasaCobro >= 0.9 ? '#16a34a' : tasaCobro >= 0.7 ? '#d97706' : '#ef4444', bg: tasaCobro >= 0.9 ? '#dcfce7' : tasaCobro >= 0.7 ? '#fef3c7' : '#fef2f2' },
          { label: 'Tickets activos', val: String(tickets.filter(t => t.estado !== 'cerrado').length), color: '#d97706', bg: '#fef3c7' },
          { label: 'Deuda acumulada', val: `${moneda} ${cuotas.filter(c => c.estado === 'pendiente' || c.estado === 'moroso').reduce((s, c) => s + c.monto, 0).toLocaleString('es', { minimumFractionDigits: 2 })}`, color: '#ef4444', bg: '#fef2f2' },
          { label: 'Unidades', val: String(unidades.length), color: 'var(--at-primary)', bg: 'var(--at-primary-tint)' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, border: `1px solid ${k.color}33`, borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{k.label}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Secciones del informe */}
      <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 10 }}>El informe incluye:</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            '📊 Resumen financiero del mes (cobrado, egresos, tasa cobro, superávit)',
            '📈 Gráfica de evolución financiera — últimos 6 meses',
            '🔧 Estado de mantenimiento (tickets urgentes, activos, cerrados, costos)',
            '🛡️ Riesgos y cumplimiento (pólizas, contratos, inspecciones)',
            '🏘️ Comunidad y operaciones (visitas, sugerencias)',
            '⚠️ Puntos de atención prioritaria (alertas automáticas)',
          ].map(s => (
            <div key={s} style={{ fontSize: 12, color: 'var(--at-ink-2)', padding: '5px 0', borderBottom: '1px solid var(--at-chip)' }}>
              {s}
            </div>
          ))}
        </div>
      </div>

      <button onClick={build}
        style={{ width: '100%', padding: '14px 0', background: 'var(--at-ink)', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 15, fontWeight: 700, letterSpacing: 0.3 }}>
        🖨️ Generar Informe Ejecutivo — {MESES[hoy.getMonth()]} {hoy.getFullYear()}
      </button>

      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--at-ink-3)', textAlign: 'center' }}>
        El informe se abre en una nueva pestaña listo para imprimir o guardar como PDF
      </div>
    </div>
  )
}
