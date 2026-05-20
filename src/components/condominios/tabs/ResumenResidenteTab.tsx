import { useState, useMemo } from 'react'
import {
  CuotaCondominio, RecargoMora, ReservaAmenidad,
  AnuncioComunidad, TicketMantenimiento, Unidad,
} from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  recargosMora: RecargoMora[]
  reservas: ReservaAmenidad[]
  anuncios: AnuncioComunidad[]
  tickets: TicketMantenimiento[]
  unidades: Unidad[]
  moneda: string
  proyectoNombre?: string
}

const ESTADO_CUOTA_CFG: Record<string, { color: string; bg: string; label: string }> = {
  pagado:   { color: '#16a34a', bg: '#dcfce7', label: 'Pagado' },
  pendiente:{ color: '#d97706', bg: '#fef3c7', label: 'Pendiente' },
  moroso:   { color: '#ef4444', bg: '#fef2f2', label: 'Moroso' },
}

const ESTADO_TICKET_CFG: Record<string, { color: string; bg: string }> = {
  abierto:    { color: 'var(--at-ink-3)', bg: 'var(--at-surface-2)' },
  en_proceso: { color: '#d97706', bg: '#fef3c7' },
  resuelto:   { color: 'var(--at-primary)', bg: 'var(--at-primary-tint)' },
  cerrado:    { color: '#16a34a', bg: '#dcfce7' },
}

const ANUNCIO_ICON: Record<string, string> = {
  aviso:        '📢',
  urgente:      '🚨',
  evento:       '🎉',
  mantenimiento:'🔧',
}

export default function ResumenResidenteTab({ cuotas, recargosMora, reservas, anuncios, tickets, unidades, moneda, proyectoNombre }: Props) {
  const [unidadId, setUnidadId] = useState(unidades[0]?.id ?? '')

  const unidad = unidades.find(u => u.id === unidadId)

  const cuotasUnidad = useMemo(() =>
    cuotas.filter(c => c.unidad_id === unidadId).sort((a, b) => b.periodo.localeCompare(a.periodo)).slice(0, 12)
  , [cuotas, unidadId])

  const recargosUnidad = useMemo(() =>
    recargosMora.filter(r => r.unidad_id === unidadId && r.estado !== 'aplicado').slice(0, 5)
  , [recargosMora, unidadId])

  const reservasUnidad = useMemo(() =>
    reservas
      .filter(r => r.unidad_id === unidadId && r.fecha >= new Date().toISOString().slice(0, 10))
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
      .slice(0, 5)
  , [reservas, unidadId])

  const ticketsUnidad = useMemo(() =>
    tickets.filter(t => t.unidad_id === unidadId && t.estado !== 'cerrado').slice(0, 5)
  , [tickets, unidadId])

  const anunciosActivos = useMemo(() =>
    anuncios.filter(a => a.activo).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5)
  , [anuncios])

  const pendientes = cuotasUnidad.filter(c => c.estado === 'pendiente' || c.estado === 'moroso')
  const saldoPendiente = pendientes.reduce((s, c) => s + c.monto, 0)
  const saldoRecargos = recargosUnidad.reduce((s, r) => s + r.monto_calculado, 0)

  const mesActual = new Date().toISOString().slice(0, 7)
  const cuotaMes = cuotasUnidad.find(c => c.periodo === mesActual)

  function imprimir() {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Resumen Residente — ${unidad?.nombre}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:32px;max-width:700px;margin:auto;color:#15291F;font-size:13px}
      h1{font-size:20px;margin:0}h2{font-size:13px;color:#7E9389;font-weight:normal;margin:4px 0 0}
      .header{border-bottom:2px solid #15291F;padding-bottom:12px;margin-bottom:20px;display:flex;justify-content:space-between}
      .kpi{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:16px 0}
      .kpi-card{background:#FAF7EF;border-radius:8px;padding:10px 14px;border:1px solid #E1DDD0}
      .kpi-val{font-size:18px;font-weight:800;margin:2px 0}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px}
      th{background:#EAE6D8;padding:7px 10px;text-align:left;color:#7E9389;font-weight:600}
      td{padding:7px 10px;border-bottom:1px solid #EAE6D8}
      section{margin-top:20px}
      h3{font-size:14px;font-weight:700;border-bottom:1px solid #E1DDD0;padding-bottom:6px;margin-bottom:12px}
      .footer{margin-top:32px;font-size:10px;color:#7E9389;border-top:1px solid #E1DDD0;padding-top:8px}
    </style></head><body>
    <div class="header">
      <div><h1>${proyectoNombre ?? 'Condominio'}</h1><h2>Resumen de Residente — ${unidad?.nombre ?? unidadId}</h2></div>
      <div style="font-size:11px;color:#7E9389">Generado: ${new Date().toLocaleDateString('es')}</div>
    </div>
    <div class="kpi">
      <div class="kpi-card"><div style="font-size:10px;color:#7E9389">Saldo cuotas</div><div class="kpi-val" style="color:${saldoPendiente > 0 ? '#ef4444' : '#16a34a'}">${moneda} ${saldoPendiente.toFixed(2)}</div></div>
      <div class="kpi-card"><div style="font-size:10px;color:#7E9389">Recargos pendientes</div><div class="kpi-val" style="color:${saldoRecargos > 0 ? '#d97706' : '#16a34a'}">${moneda} ${saldoRecargos.toFixed(2)}</div></div>
      <div class="kpi-card"><div style="font-size:10px;color:#7E9389">Tickets activos</div><div class="kpi-val" style="color:#1B3B36">${ticketsUnidad.length}</div></div>
    </div>
    <section><h3>Cuotas (últimos 12 meses)</h3>
    <table><tr><th>Concepto</th><th>Período</th><th>Monto</th><th>Estado</th></tr>
    ${cuotasUnidad.map(c => `<tr><td>${c.concepto}</td><td>${c.periodo}</td><td>${moneda} ${c.monto.toFixed(2)}</td><td>${c.estado}</td></tr>`).join('')}
    </table></section>
    ${ticketsUnidad.length > 0 ? `<section><h3>Tickets activos</h3>
    <table><tr><th>Título</th><th>Tipo</th><th>Prioridad</th><th>Estado</th></tr>
    ${ticketsUnidad.map(t => `<tr><td>${t.titulo}</td><td>${t.tipo}</td><td>${t.prioridad}</td><td>${t.estado}</td></tr>`).join('')}
    </table></section>` : ''}
    <div class="footer">Documento informativo generado por el sistema de administración.</div>
    </body></html>`
    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close(); win.print() }
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)' }}>Resumen del Residente</div>
          <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>{proyectoNombre ?? 'Condominio'} — vista consolidada</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={unidadId} onChange={e => setUnidadId(e.target.value)}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 13, background: 'var(--at-surface)', fontWeight: 600 }}>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
          <button onClick={imprimir}
            style={{ padding: '6px 14px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            🖨️ Imprimir
          </button>
        </div>
      </div>

      {/* Banner de estado */}
      {pendientes.length > 0 ? (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, padding: '12px 16px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, color: '#ef4444', fontSize: 13 }}>⚠️ Tiene pagos pendientes</div>
            <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>{pendientes.length} cuota{pendientes.length > 1 ? 's' : ''} por regularizar</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Saldo pendiente</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#ef4444' }}>{moneda} {saldoPendiente.toFixed(2)}</div>
          </div>
        </div>
      ) : (
        <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 10, padding: '12px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>✅</span>
          <div>
            <div style={{ fontWeight: 700, color: '#16a34a', fontSize: 13 }}>Unidad al día</div>
            <div style={{ fontSize: 11, color: '#15803d' }}>No hay cuotas pendientes. ¡Gracias por su pago oportuno!</div>
          </div>
        </div>
      )}

      {/* Resumen cards */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Unidad', val: unidad?.nombre ?? '—', color: 'var(--at-ink)', bg: 'var(--at-surface-2)' },
          { label: 'Cuota este mes', val: cuotaMes ? ESTADO_CUOTA_CFG[cuotaMes.estado]?.label ?? cuotaMes.estado : 'Sin cuota', color: cuotaMes ? (ESTADO_CUOTA_CFG[cuotaMes.estado]?.color ?? 'var(--at-ink-3)') : 'var(--at-ink-3)', bg: cuotaMes ? (ESTADO_CUOTA_CFG[cuotaMes.estado]?.bg ?? 'var(--at-surface-2)') : 'var(--at-surface-2)' },
          { label: 'Recargos pend.', val: `${moneda} ${saldoRecargos.toFixed(2)}`, color: saldoRecargos > 0 ? '#d97706' : '#16a34a', bg: saldoRecargos > 0 ? '#fef3c7' : '#dcfce7' },
          { label: 'Tickets activos', val: String(ticketsUnidad.length), color: ticketsUnidad.length > 0 ? '#d97706' : '#16a34a', bg: ticketsUnidad.length > 0 ? '#fef3c7' : '#dcfce7' },
          { label: 'Reservas próx.', val: String(reservasUnidad.length), color: 'var(--at-primary)', bg: 'var(--at-primary-tint)' },
        ].map(k => (
          <div key={k.label} style={{ flex: '1 1 100px', background: k.bg, border: `1px solid ${k.color}22`, borderRadius: 10, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{k.label}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.val}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Cuotas */}
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 12 }}>Cuotas — Últimos 12 meses</div>
          {cuotasUnidad.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--at-ink-3)', fontSize: 12 }}>Sin cuotas registradas</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {cuotasUnidad.map(c => {
                const cfg = ESTADO_CUOTA_CFG[c.estado] ?? { color: 'var(--at-ink-2)', bg: 'var(--at-chip)', label: c.estado }
                return (
                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '7px 10px', background: cfg.bg, borderRadius: 8, border: `1px solid ${cfg.color}22` }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink)' }}>{c.concepto}</div>
                      <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>Período {c.periodo}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>{moneda} {c.monto.toFixed(2)}</div>
                      <span style={{ fontSize: 10, color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Panel derecho */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Recargos pendientes */}
          {recargosUnidad.length > 0 && (
            <div style={{ background: 'var(--at-surface)', border: '1px solid #fde68a', borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#d97706', marginBottom: 10 }}>⚡ Recargos por mora</div>
              {recargosUnidad.map(r => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #fef3c7' }}>
                  <div style={{ fontSize: 12, color: 'var(--at-ink-2)' }}>{r.motivo ?? r.tipo}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#d97706' }}>{moneda} {r.monto_calculado.toFixed(2)}</div>
                </div>
              ))}
            </div>
          )}

          {/* Tickets activos */}
          <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 10 }}>🔧 Mis Solicitudes de Mantenimiento</div>
            {ticketsUnidad.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--at-ink-3)', fontSize: 12 }}>Sin solicitudes activas</div>
            ) : (
              ticketsUnidad.map(t => {
                const cfg = ESTADO_TICKET_CFG[t.estado] ?? { color: 'var(--at-ink-2)', bg: 'var(--at-chip)' }
                return (
                  <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '7px 10px', background: cfg.bg, borderRadius: 8, marginBottom: 6, border: `1px solid ${cfg.color}22` }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink)', flex: 1 }}>{t.titulo}</div>
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: 'var(--at-surface)', color: cfg.color, fontWeight: 600, flexShrink: 0 }}>
                      {t.estado.replace('_', ' ')}
                    </span>
                  </div>
                )
              })
            )}
          </div>

          {/* Reservas próximas */}
          <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 10 }}>📅 Mis Reservas Próximas</div>
            {reservasUnidad.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--at-ink-3)', fontSize: 12 }}>Sin reservas próximas</div>
            ) : (
              reservasUnidad.map(r => (
                <div key={r.id} style={{ padding: '7px 10px', background: 'var(--at-primary-tint)', borderRadius: 8, marginBottom: 6, border: '1px solid var(--at-primary-soft-2)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--at-primary-hover)' }}>{r.amenidad_nombre ?? 'Amenidad'}</div>
                  <div style={{ fontSize: 11, color: 'var(--at-primary-2)', marginTop: 2 }}>
                    {r.fecha} · {r.hora_inicio}–{r.hora_fin}
                    {r.num_invitados > 0 && <span style={{ marginLeft: 6 }}>👥 {r.num_invitados}</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Anuncios */}
      <div style={{ marginTop: 14, background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 12 }}>📋 Tablón de Anuncios</div>
        {anunciosActivos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--at-ink-3)', fontSize: 12 }}>Sin anuncios activos</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {anunciosActivos.map(a => {
              const isUrgente = a.tipo === 'urgente'
              return (
                <div key={a.id} style={{ padding: '10px 14px', borderRadius: 10,
                  border: `1px solid ${isUrgente ? '#fca5a5' : 'var(--at-line)'}`,
                  background: isUrgente ? '#fef2f2' : 'var(--at-surface-2)' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 16 }}>{ANUNCIO_ICON[a.tipo] ?? '📢'}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: isUrgente ? '#ef4444' : 'var(--at-ink)' }}>{a.titulo}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--at-ink-2)', lineHeight: 1.5 }}>
                    {a.contenido.length > 100 ? a.contenido.slice(0, 100) + '…' : a.contenido}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginTop: 4 }}>
                    {new Date(a.created_at).toLocaleDateString('es')}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
