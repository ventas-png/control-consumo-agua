import { useMemo } from 'react'
import {
  CuotaCondominio, TicketMantenimiento, GastoCondominio, PresupuestoCondominio,
  Unidad, IncidenteSeguridad, PolizaSeguro, ContratoProveedor,
  InspeccionNormativa, VencimientoExtra, SugerenciaCondominio,
} from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  tickets: TicketMantenimiento[]
  gastos: GastoCondominio[]
  presupuestos: PresupuestoCondominio[]
  unidades: Unidad[]
  incidentes: IncidenteSeguridad[]
  polizas: PolizaSeguro[]
  contratosProveedores: ContratoProveedor[]
  inspecciones: InspeccionNormativa[]
  vencimientosExtra: VencimientoExtra[]
  sugerencias: SugerenciaCondominio[]
  moneda: string
  proyectoNombre?: string
}

function semColorText(val: number, verde: number, amarillo: number) {
  return val <= verde ? '#16a34a' : val <= amarillo ? '#d97706' : '#ef4444'
}

export default function ResumenEjecutivoTab({
  cuotas, tickets, gastos, presupuestos, unidades, incidentes,
  polizas, contratosProveedores, inspecciones, vencimientosExtra,
  sugerencias, moneda, proyectoNombre,
}: Props) {
  const hoy = new Date().toISOString().slice(0, 10)
  const mes = hoy.slice(0, 7)
  const en30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  const fechaLarga = new Date().toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })

  const financiero = useMemo(() => {
    const pagadas = cuotas.filter(c => c.estado === 'pagado').length
    const morosas = cuotas.filter(c => (c.estado === 'pendiente' || c.estado === 'moroso') && c.fecha_vencimiento && c.fecha_vencimiento < hoy)
    const montoPendiente = cuotas.filter(c => c.estado !== 'pagado').reduce((s, c) => s + c.monto, 0)
    const montoMora = morosas.reduce((s, c) => s + c.monto, 0)
    const tasaCobro = cuotas.length > 0 ? Math.round((pagadas / cuotas.length) * 100) : 100
    const gastosMes = gastos.filter(g => g.fecha?.startsWith(mes)).reduce((s, g) => s + g.monto, 0)
    const presupMes = presupuestos.filter(p => String(p.anio) === mes.slice(0, 4)).reduce((s, p) => s + p.monto_presupuestado, 0)
    return { pagadas, morosas: morosas.length, montoPendiente, montoMora, tasaCobro, gastosMes, presupMes }
  }, [cuotas, gastos, presupuestos, hoy, mes])

  const top5Morosos = useMemo(() => {
    const moraPorUnidad: Record<string, { unidad: Unidad; monto: number; count: number }> = {}
    cuotas
      .filter(c => (c.estado === 'pendiente' || c.estado === 'moroso') && c.fecha_vencimiento && c.fecha_vencimiento < hoy)
      .forEach(c => {
        const u = unidades.find(x => x.id === c.unidad_id)
        if (!u) return
        if (!moraPorUnidad[c.unidad_id!]) moraPorUnidad[c.unidad_id!] = { unidad: u, monto: 0, count: 0 }
        moraPorUnidad[c.unidad_id!].monto += c.monto
        moraPorUnidad[c.unidad_id!].count += 1
      })
    return Object.values(moraPorUnidad).sort((a, b) => b.monto - a.monto).slice(0, 5)
  }, [cuotas, unidades, hoy])

  const ticketsCriticos = tickets.filter(t => (t.prioridad === 'urgente' || t.prioridad === 'alta') && (t.estado === 'abierto' || t.estado === 'en_proceso'))

  const venc30 = useMemo(() => [
    ...polizas.filter(p => p.fecha_vencimiento && p.fecha_vencimiento >= hoy && p.fecha_vencimiento <= en30).map(p => ({ titulo: `Póliza: ${p.tipo}`, fecha: p.fecha_vencimiento })),
    ...contratosProveedores.filter(c => c.fecha_fin && c.fecha_fin >= hoy && c.fecha_fin <= en30).map(c => ({ titulo: `Contrato: ${c.proveedor_nombre}`, fecha: c.fecha_fin! })),
    ...inspecciones.filter(i => i.fecha_proxima && i.fecha_proxima >= hoy && i.fecha_proxima <= en30).map(i => ({ titulo: `Inspección: ${i.tipo}`, fecha: i.fecha_proxima! })),
    ...vencimientosExtra.filter(v => !v.renovado && v.fecha_vencimiento >= hoy && v.fecha_vencimiento <= en30).map(v => ({ titulo: v.titulo, fecha: v.fecha_vencimiento })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha)), [polizas, contratosProveedores, inspecciones, vencimientosExtra, hoy, en30])

  function imprimir() {
    const ejecucionPct = financiero.presupMes > 0 ? Math.round((financiero.gastosMes / financiero.presupMes) * 100) : 0

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Resumen Ejecutivo — ${proyectoNombre ?? ''}</title>
<style>
  *{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:12px;color:var(--at-ink);padding:24px;max-width:900px;margin:0 auto}
  h1{margin:0 0 4px;font-size:20px}p{margin:0 0 16px;color:var(--at-ink-3);font-size:11px}
  h2{font-size:13px;margin:20px 0 8px;color:var(--at-ink);border-bottom:2px solid var(--at-line);padding-bottom:4px}
  .grid{display:grid;gap:10px}.g4{grid-template-columns:repeat(4,1fr)}.g2{grid-template-columns:repeat(2,1fr)}
  .kpi{background:var(--at-surface-2);border-radius:8px;padding:10px 12px;border-top:3px solid var(--c)}
  .kpi .val{font-size:18px;font-weight:800;color:var(--c)}.kpi .lbl{font-size:10px;color:var(--at-ink-3);font-weight:600}
  table{width:100%;border-collapse:collapse}th{background:var(--at-surface-2);padding:6px 8px;text-align:left;border-bottom:2px solid var(--at-line);font-size:10px;text-transform:uppercase;color:var(--at-ink-3)}
  td{padding:6px 8px;border-bottom:1px solid var(--at-chip);font-size:11px}
  .badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700}
  .btn{padding:8px 16px;background:var(--at-primary);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;margin-bottom:16px}
  @media print{.btn{display:none}}
</style></head><body>
<button class="btn" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
<h1>Resumen Ejecutivo — ${proyectoNombre ?? 'Condominio'}</h1>
<p>Generado el ${fechaLarga}</p>

<h2>Finanzas y cobro</h2>
<div class="grid g4" style="margin-bottom:14px">
  <div class="kpi" style="--c:${financiero.tasaCobro >= 90 ? '#16a34a' : financiero.tasaCobro >= 70 ? '#d97706' : '#ef4444'}">
    <div class="val">${financiero.tasaCobro}%</div><div class="lbl">Tasa de cobro (${financiero.pagadas}/${cuotas.length} cuotas)</div>
  </div>
  <div class="kpi" style="--c:${financiero.morosas === 0 ? '#16a34a' : financiero.morosas <= 5 ? '#d97706' : '#ef4444'}">
    <div class="val">${financiero.morosas}</div><div class="lbl">Cuotas morosas</div>
  </div>
  <div class="kpi" style="--c:#ef4444">
    <div class="val">${moneda} ${financiero.montoMora.toLocaleString('es', { maximumFractionDigits: 0 })}</div><div class="lbl">Cartera vencida</div>
  </div>
  <div class="kpi" style="--c:${ejecucionPct > 100 ? '#ef4444' : ejecucionPct > 80 ? '#d97706' : '#16a34a'}">
    <div class="val">${ejecucionPct}%</div><div class="lbl">Ejecución presupuestal (${moneda} ${financiero.gastosMes.toLocaleString('es', { maximumFractionDigits: 0 })})</div>
  </div>
</div>

${top5Morosos.length > 0 ? `
<h2>Top 5 unidades morosas</h2>
<table>
  <thead><tr><th>Unidad</th><th>Cuotas vencidas</th><th>Monto en mora</th></tr></thead>
  <tbody>
    ${top5Morosos.map((m, i) => `<tr style="background:${i % 2 === 0 ? '#fff' : 'var(--at-surface-2)'}">
      <td><strong>${m.unidad.nombre}</strong></td>
      <td style="color:#ef4444;font-weight:700">${m.count}</td>
      <td style="color:#ef4444;font-weight:700">${moneda} ${m.monto.toFixed(2)}</td>
    </tr>`).join('')}
  </tbody>
</table>` : ''}

${ticketsCriticos.length > 0 ? `
<h2>Tickets críticos abiertos (${ticketsCriticos.length})</h2>
<table>
  <thead><tr><th>Título</th><th>Unidad</th><th>Prioridad</th></tr></thead>
  <tbody>
    ${ticketsCriticos.slice(0, 8).map(t => `<tr>
      <td>${t.titulo}</td>
      <td>${t.unidad_nombre ?? '—'}</td>
      <td><span class="badge" style="background:${t.prioridad === 'urgente' ? '#fef2f2' : '#fff7ed'};color:${t.prioridad === 'urgente' ? '#ef4444' : '#f97316'}">${t.prioridad}</span></td>
    </tr>`).join('')}
  </tbody>
</table>` : '<h2>Tickets críticos</h2><p style="color:#16a34a">✓ Sin tickets urgentes o de alta prioridad abiertos</p>'}

${venc30.length > 0 ? `
<h2>Vencimientos en los próximos 30 días (${venc30.length})</h2>
<table>
  <thead><tr><th>Descripción</th><th>Fecha vencimiento</th><th>Días restantes</th></tr></thead>
  <tbody>
    ${venc30.map(v => {
      const dias = Math.ceil((new Date(v.fecha).getTime() - Date.now()) / 86400000)
      return `<tr>
        <td>${v.titulo}</td>
        <td>${v.fecha}</td>
        <td style="color:${dias <= 7 ? '#ef4444' : '#d97706'};font-weight:700">${dias} días</td>
      </tr>`
    }).join('')}
  </tbody>
</table>` : ''}

<p style="margin-top:20px;font-size:9px;color:var(--at-ink-3);border-top:1px solid var(--at-line);padding-top:8px">
  ${proyectoNombre} · Reporte generado el ${fechaLarga} · Total de unidades: ${unidades.length}
</p>
</body></html>`

    const w = window.open('', '_blank', 'width=980,height=740')
    if (w) { w.document.write(html); w.document.close() }
  }

  const ejecPct = financiero.presupMes > 0 ? Math.round((financiero.gastosMes / financiero.presupMes) * 100) : 0

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--at-ink)' }}>Resumen ejecutivo — {proyectoNombre}</div>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>Generado el {fechaLarga}</div>
        </div>
        <button onClick={imprimir}
          style={{ padding: '8px 18px', background: 'var(--at-ink)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          🖨️ Imprimir / PDF
        </button>
      </div>

      {/* KPIs Financieros */}
      <div style={{ fontWeight: 700, fontSize: 11, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Finanzas y cobro</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Tasa de cobro', val: `${financiero.tasaCobro}%`, sub: `${financiero.pagadas}/${cuotas.length} cuotas`, color: financiero.tasaCobro >= 90 ? '#16a34a' : financiero.tasaCobro >= 70 ? '#d97706' : '#ef4444' },
          { label: 'Cuotas morosas', val: financiero.morosas, sub: 'Vencidas hoy', color: semColorText(financiero.morosas, 0, 5) },
          { label: 'Cartera vencida', val: `${moneda} ${financiero.montoMora.toLocaleString('es', { maximumFractionDigits: 0 })}`, sub: 'Saldo en mora', color: '#ef4444' },
          { label: 'Ejecución presup.', val: `${ejecPct}%`, sub: `${moneda} ${financiero.gastosMes.toLocaleString('es', { maximumFractionDigits: 0 })} gastado`, color: ejecPct > 100 ? '#ef4444' : ejecPct > 80 ? '#d97706' : '#16a34a' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: `1px solid ${k.color}33`, borderRadius: 10, padding: '12px 14px', borderTop: `3px solid ${k.color}` }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 10, color: 'var(--at-ink-3)', fontWeight: 600 }}>{k.label}</div>
            <div style={{ fontSize: 9, color: 'var(--at-ink-3)' }}>{k.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        {/* Top morosos */}
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>⚠️ Top morosos</div>
          {top5Morosos.length === 0 ? (
            <div style={{ fontSize: 12, color: '#16a34a', textAlign: 'center', padding: '20px 0' }}>✓ Sin unidades morosas</div>
          ) : top5Morosos.map((m, i) => (
            <div key={m.unidad.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < top5Morosos.length - 1 ? '1px solid var(--at-chip)' : 'none' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{m.unidad.nombre}</div>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{m.count} cuotas vencidas</div>
              </div>
              <div style={{ fontWeight: 700, color: '#ef4444', fontSize: 13 }}>{moneda} {m.monto.toFixed(2)}</div>
            </div>
          ))}
        </div>

        {/* Tickets críticos */}
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>🔧 Tickets críticos ({ticketsCriticos.length})</div>
          {ticketsCriticos.length === 0 ? (
            <div style={{ fontSize: 12, color: '#16a34a', textAlign: 'center', padding: '20px 0' }}>✓ Sin tickets urgentes abiertos</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
              {ticketsCriticos.slice(0, 6).map(t => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 8px', background: '#fef2f2', borderRadius: 6 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{t.titulo}</span>
                  <span style={{ color: t.prioridad === 'urgente' ? '#ef4444' : '#f97316', fontWeight: 700, flexShrink: 0, marginLeft: 6 }}>{t.prioridad}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Vencimientos */}
      {venc30.length > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: '#d97706' }}>⏳ Vencimientos próximos 30 días ({venc30.length})</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {venc30.map((v, i) => {
              const dias = Math.ceil((new Date(v.fecha).getTime() - Date.now()) / 86400000)
              return (
                <div key={i} style={{ padding: '4px 10px', background: 'var(--at-surface)', border: `1px solid ${dias <= 7 ? '#fca5a5' : '#fde68a'}`, borderRadius: 8, fontSize: 11 }}>
                  <strong>{v.titulo}</strong>
                  <span style={{ color: dias <= 7 ? '#ef4444' : '#d97706', marginLeft: 6 }}>{dias}d · {v.fecha}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Incidentes y sugerencias */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>🚨 Incidentes del mes</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: semColorText(incidentes.filter(i => i.fecha?.startsWith(mes)).length, 0, 3) }}>
            {incidentes.filter(i => i.fecha?.startsWith(mes)).length}
          </div>
          <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>registrados en {mes}</div>
        </div>
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>💡 Sugerencias pendientes</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: semColorText(sugerencias.filter(s => s.estado === 'pendiente').length, 3, 8) }}>
            {sugerencias.filter(s => s.estado === 'pendiente').length}
          </div>
          <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>de {sugerencias.length} totales</div>
        </div>
      </div>
    </div>
  )
}
