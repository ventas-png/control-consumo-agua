import { useState, useMemo } from 'react'
import { CuotaCondominio, RecargoMora, ConvenioCuotaCond, Unidad } from '../../../types'
import { exportarPDFEstadoCuenta } from '../exportUtils'

interface Props {
  cuotas: CuotaCondominio[]
  recargosMora: RecargoMora[]
  conveniosCuota: ConvenioCuotaCond[]
  unidades: Unidad[]
  moneda: string
  proyectoNombre?: string
}

type TipoMovimiento = 'cuota' | 'recargo' | 'pago' | 'convenio'

interface Movimiento {
  fecha: string
  tipo: TipoMovimiento
  descripcion: string
  cargo: number
  abono: number
  estado: string
}

const ESTADO_CFG: Record<string, { color: string; bg: string }> = {
  pagado:   { color: '#16a34a', bg: '#dcfce7' },
  pendiente:{ color: '#d97706', bg: '#fef3c7' },
  moroso:   { color: '#ef4444', bg: '#fef2f2' },
  activo:   { color: '#2563eb', bg: '#eff6ff' },
  aplicado: { color: '#7c3aed', bg: '#f5f3ff' },
}

export default function EstadoCuentaResidenteTab({ cuotas, recargosMora, conveniosCuota, unidades, moneda, proyectoNombre }: Props) {
  const [unidadId, setUnidadId] = useState(unidades[0]?.id ?? '')
  const [anio, setAnio] = useState(new Date().getFullYear())

  const aniosDisponibles = useMemo(() => {
    const set = new Set<number>()
    set.add(new Date().getFullYear())
    cuotas.forEach(c => { if (c.periodo) set.add(parseInt(c.periodo.slice(0, 4))) })
    return Array.from(set).sort((a, b) => b - a)
  }, [cuotas])

  const movimientos: Movimiento[] = useMemo(() => {
    const list: Movimiento[] = []

    cuotas
      .filter(c => c.unidad_id === unidadId && c.periodo?.startsWith(String(anio)))
      .forEach(c => {
        list.push({
          fecha: c.fecha_vencimiento ?? c.periodo + '-01',
          tipo: 'cuota',
          descripcion: `${c.concepto} — Período ${c.periodo}`,
          cargo: c.monto,
          abono: c.estado === 'pagado' ? c.monto : 0,
          estado: c.estado,
        })
      })

    recargosMora
      .filter(r => r.unidad_id === unidadId && r.fecha_aplicacion?.startsWith(String(anio)))
      .forEach(r => {
        list.push({
          fecha: r.fecha_aplicacion,
          tipo: 'recargo',
          descripcion: `Recargo mora — ${r.motivo ?? r.tipo}`,
          cargo: r.monto_calculado,
          abono: r.estado === 'aplicado' ? r.monto_calculado : 0,
          estado: r.estado,
        })
      })

    conveniosCuota
      .filter(cv => cv.unidad_id === unidadId && cv.created_at?.startsWith(String(anio)))
      .forEach(cv => {
        list.push({
          fecha: cv.created_at?.slice(0, 10) ?? '',
          tipo: 'convenio',
          descripcion: `Convenio de pago — ${cv.descripcion} (${cv.num_cuotas} cuotas)`,
          cargo: 0,
          abono: 0,
          estado: cv.estado,
        })
      })

    return list.sort((a, b) => a.fecha.localeCompare(b.fecha))
  }, [cuotas, recargosMora, conveniosCuota, unidadId, anio])

  const totalCargos = movimientos.reduce((s, m) => s + m.cargo, 0)
  const totalAbonos = movimientos.reduce((s, m) => s + m.abono, 0)
  const saldo = totalCargos - totalAbonos

  const cuotasUnidad = cuotas.filter(c => c.unidad_id === unidadId)
  const pendientes = cuotasUnidad.filter(c => c.estado === 'pendiente' || c.estado === 'moroso').length
  const unidad = unidades.find(u => u.id === unidadId)

  function imprimir() {
    const filas = movimientos.map(m => `
      <tr>
        <td>${m.fecha}</td>
        <td>${m.descripcion}</td>
        <td style="text-align:right">${m.cargo > 0 ? moneda + ' ' + m.cargo.toFixed(2) : '—'}</td>
        <td style="text-align:right">${m.abono > 0 ? moneda + ' ' + m.abono.toFixed(2) : '—'}</td>
        <td style="text-align:center"><span style="padding:2px 8px;border-radius:12px;background:${ESTADO_CFG[m.estado]?.bg ?? '#f1f5f9'};color:${ESTADO_CFG[m.estado]?.color ?? '#374151'};font-size:11px">${m.estado}</span></td>
      </tr>`).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Estado de Cuenta — ${unidad?.nombre}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:32px;max-width:900px;margin:auto;color:#0f172a}
      h1{font-size:20px;margin:0}h2{font-size:13px;color:#64748b;font-weight:normal;margin:4px 0 0}
      .header{display:flex;justify-content:space-between;border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:20px}
      .meta{background:#f8fafc;padding:12px 16px;border-radius:8px;margin-bottom:20px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:12px}
      .meta strong{font-size:16px;display:block}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th{background:#f1f5f9;padding:8px 10px;text-align:left;color:#64748b;font-weight:600}
      td{padding:8px 10px;border-bottom:1px solid #f1f5f9}
      tfoot td{font-weight:700;border-top:2px solid #0f172a;background:#f8fafc}
      .saldo{font-size:18px;font-weight:800;color:${saldo <= 0 ? '#16a34a' : '#ef4444'}}
      .footer{margin-top:32px;font-size:10px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:8px}
    </style></head><body>
    <div class="header">
      <div><h1>Estado de Cuenta</h1><h2>${proyectoNombre ?? 'Condominio'}</h2></div>
      <div style="text-align:right;font-size:12px;color:#64748b">Generado: ${new Date().toLocaleDateString('es')}</div>
    </div>
    <div class="meta">
      <div><span style="font-size:10px;color:#6b7280">Unidad</span><strong>${unidad?.nombre ?? unidadId}</strong></div>
      <div><span style="font-size:10px;color:#6b7280">Período</span><strong>${anio}</strong></div>
      <div><span style="font-size:10px;color:#6b7280">Saldo</span><strong class="saldo">${saldo <= 0 ? 'Al día' : moneda + ' ' + saldo.toFixed(2)}</strong></div>
    </div>
    <table>
      <thead><tr><th>Fecha</th><th>Descripción</th><th style="text-align:right">Cargo</th><th style="text-align:right">Abono</th><th style="text-align:center">Estado</th></tr></thead>
      <tbody>${filas}</tbody>
      <tfoot>
        <tr>
          <td colspan="2">TOTALES</td>
          <td style="text-align:right">${moneda} ${totalCargos.toFixed(2)}</td>
          <td style="text-align:right">${moneda} ${totalAbonos.toFixed(2)}</td>
          <td style="text-align:center;font-size:13px;color:${saldo <= 0 ? '#16a34a' : '#ef4444'}">${saldo <= 0 ? '✓ Al día' : 'Debe: ' + moneda + ' ' + saldo.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
    <div class="footer">Este documento es de carácter informativo. Para consultas comunicarse con la administración del condominio.</div>
    </body></html>`

    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close(); win.print() }
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Estado de Cuenta por Residente</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={unidadId} onChange={e => setUnidadId(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, background: '#fff' }}>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
          <select value={anio} onChange={e => setAnio(Number(e.target.value))}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, background: '#fff' }}>
            {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button onClick={() => exportarPDFEstadoCuenta(movimientos, unidad?.nombre ?? unidadId, anio, moneda, proyectoNombre)}
            style={{ padding: '6px 16px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            📄 Descargar PDF
          </button>
          <button onClick={imprimir}
            style={{ padding: '6px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            🖨️ Imprimir
          </button>
        </div>
      </div>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { label: 'Unidad', val: unidad?.nombre ?? '—', color: '#0f172a', bg: '#f8fafc' },
          { label: 'Total cargos', val: `${moneda} ${totalCargos.toFixed(2)}`, color: '#ef4444', bg: '#fef2f2' },
          { label: 'Total abonos', val: `${moneda} ${totalAbonos.toFixed(2)}`, color: '#16a34a', bg: '#dcfce7' },
          { label: 'Saldo', val: saldo <= 0 ? '✓ Al día' : `${moneda} ${saldo.toFixed(2)}`, color: saldo <= 0 ? '#16a34a' : '#ef4444', bg: saldo <= 0 ? '#dcfce7' : '#fef2f2' },
          { label: 'Cuotas pendientes', val: String(pendientes), color: pendientes === 0 ? '#16a34a' : '#d97706', bg: pendientes === 0 ? '#dcfce7' : '#fef3c7' },
        ].map(k => (
          <div key={k.label} style={{ flex: '1 1 100px', background: k.bg, border: `1px solid ${k.color}22`, borderRadius: 10, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, color: '#6b7280' }}>{k.label}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      {movimientos.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: 13 }}>
          Sin movimientos para {unidad?.nombre} en {anio}.
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Fecha', 'Descripción', 'Cargo', 'Abono', 'Saldo acum.', 'Estado'].map(h => (
                  <th key={h} style={{ padding: '9px 12px', textAlign: h === 'Fecha' || h === 'Descripción' ? 'left' : 'right', color: '#64748b', fontWeight: 600, fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {movimientos.reduce<{ rows: JSX.Element[]; saldoAcum: number }>((acc, m, i) => {
                acc.saldoAcum += m.cargo - m.abono
                const sCfg = ESTADO_CFG[m.estado] ?? { color: '#374151', bg: '#f1f5f9' }
                acc.rows.push(
                  <tr key={i} style={{ borderTop: i > 0 ? '1px solid #f1f5f9' : undefined }}>
                    <td style={{ padding: '9px 12px', color: '#64748b' }}>{m.fecha}</td>
                    <td style={{ padding: '9px 12px', color: '#0f172a' }}>{m.descripcion}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: m.cargo > 0 ? '#ef4444' : '#9ca3af' }}>{m.cargo > 0 ? `${moneda} ${m.cargo.toFixed(2)}` : '—'}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', color: m.abono > 0 ? '#16a34a' : '#9ca3af' }}>{m.abono > 0 ? `${moneda} ${m.abono.toFixed(2)}` : '—'}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600, color: acc.saldoAcum > 0 ? '#ef4444' : '#16a34a' }}>
                      {acc.saldoAcum > 0 ? `${moneda} ${acc.saldoAcum.toFixed(2)}` : '✓'}
                    </td>
                    <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 20, background: sCfg.bg, color: sCfg.color, fontSize: 10, fontWeight: 600 }}>{m.estado}</span>
                    </td>
                  </tr>
                )
                return acc
              }, { rows: [], saldoAcum: 0 }).rows}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #e5e7eb', background: '#f8fafc' }}>
                <td colSpan={2} style={{ padding: '9px 12px', fontWeight: 700 }}>TOTAL</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: '#ef4444' }}>{moneda} {totalCargos.toFixed(2)}</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{moneda} {totalAbonos.toFixed(2)}</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 800, color: saldo <= 0 ? '#16a34a' : '#ef4444' }}>
                  {saldo <= 0 ? '✓ Al día' : `${moneda} ${saldo.toFixed(2)}`}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
