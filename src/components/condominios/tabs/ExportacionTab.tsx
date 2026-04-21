import { useState } from 'react'
import { CuotaCondominio, GastoCondominio, TicketMantenimiento, Visitante, Unidad } from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  gastos: GastoCondominio[]
  tickets: TicketMantenimiento[]
  visitantes: Visitante[]
  unidades: Unidad[]
  moneda: string
  proyectoNombre?: string
}

type Row = (string | number | null | undefined)[]

function descargarCSV(nombre: string, encabezados: string[], filas: Row[]) {
  const esc = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [encabezados, ...filas].map(r => r.map(esc).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${nombre}.csv`; a.click()
  URL.revokeObjectURL(url)
}

export default function ExportacionTab({ cuotas, gastos, tickets, visitantes, unidades, moneda, proyectoNombre }: Props) {
  const hoy = new Date().toISOString().slice(0, 10)

  const periodos = [...new Set(cuotas.map(c => c.periodo).filter(Boolean))].sort().reverse()
  const anios = [...new Set((gastos.map(g => g.fecha?.slice(0, 4)).filter(Boolean) as string[]))].sort().reverse()

  const [periodo, setPeriodo] = useState(periodos[0] ?? '')
  const [anio, setAnio] = useState(anios[0] ?? new Date().getFullYear().toString())

  const morosos = cuotas.filter(c =>
    (c.estado === 'pendiente' || c.estado === 'moroso') && c.fecha_vencimiento && c.fecha_vencimiento < hoy
  )

  function exportCuotas() {
    const datos = cuotas.filter(c => !periodo || c.periodo === periodo)
    descargarCSV(`cuotas_${periodo || 'todas'}`,
      ['Unidad', 'Concepto', 'Monto', 'Período', 'Vencimiento', 'Estado'],
      datos.map(c => [c.unidad_nombre ?? '', c.concepto, c.monto, c.periodo, c.fecha_vencimiento ?? '', c.estado])
    )
  }

  function exportMorosos() {
    const datos = [...morosos].sort((a, b) => (a.unidad_nombre ?? '').localeCompare(b.unidad_nombre ?? ''))
    descargarCSV(`morosos_${hoy}`,
      ['Unidad', 'Concepto', 'Monto', 'Período', 'Vencimiento', 'Días vencido', 'Estado'],
      datos.map(c => {
        const dias = Math.floor((Date.now() - new Date(c.fecha_vencimiento!).getTime()) / 86400000)
        return [c.unidad_nombre ?? '', c.concepto, c.monto, c.periodo, c.fecha_vencimiento ?? '', dias, c.estado]
      })
    )
  }

  function exportGastos() {
    const datos = gastos.filter(g => !anio || g.fecha?.startsWith(anio))
    descargarCSV(`gastos_${anio}`,
      ['Concepto', 'Categoría', 'Monto', 'Fecha', 'Proveedor', 'Estado'],
      datos.map(g => [g.concepto, g.categoria, g.monto, g.fecha, g.proveedor_nombre ?? '', g.estado])
    )
  }

  function exportTickets() {
    descargarCSV(`tickets_${hoy}`,
      ['Título', 'Unidad', 'Prioridad', 'Estado', 'Tipo', 'Creado', 'Cerrado'],
      tickets.map(t => [t.titulo, t.unidad_nombre ?? '', t.prioridad, t.estado, t.tipo, t.created_at?.slice(0, 10) ?? '', t.fecha_cierre?.slice(0, 10) ?? ''])
    )
  }

  function exportVisitantes() {
    const datos = visitantes.slice(0, 1000)
    descargarCSV(`visitantes_${hoy}`,
      ['Nombre', 'Unidad', 'Identificación', 'Motivo', 'Entrada', 'Salida'],
      datos.map(v => [v.nombre, v.unidad_nombre ?? '', v.identificacion ?? '', v.motivo ?? '', v.hora_entrada?.slice(0, 16) ?? '', v.hora_salida?.slice(0, 16) ?? ''])
    )
  }

  function imprimirEstadoCuenta() {
    const fecha = new Date().toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })
    const filas = unidades.map(u => {
      const cuotasU = cuotas.filter(c => c.unidad_id === u.id)
      const saldo = cuotasU.filter(c => c.estado !== 'pagado').reduce((s, c) => s + c.monto, 0)
      const venc = cuotasU.filter(c => (c.estado === 'pendiente' || c.estado === 'moroso') && c.fecha_vencimiento && c.fecha_vencimiento < hoy).length
      return `<tr><td>${u.nombre}</td><td style="text-align:center">${cuotasU.length}</td><td style="text-align:center">${cuotasU.filter(c => c.estado === 'pagado').length}</td><td style="text-align:center;color:${venc > 0 ? '#ef4444' : '#16a34a'}">${venc}</td><td style="text-align:right;font-weight:700;color:${saldo > 0 ? '#ef4444' : '#16a34a'}">${moneda} ${saldo.toFixed(2)}</td></tr>`
    }).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Estado de cuenta — ${proyectoNombre ?? ''}</title>
<style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:12px;padding:24px;color:#0f172a}h2{margin:0 0 4px}p{color:#64748b;margin:0 0 16px}table{width:100%;border-collapse:collapse}th{background:#f8fafc;padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0;font-size:11px;text-transform:uppercase;color:#64748b}td{padding:8px 10px;border-bottom:1px solid #f1f5f9}tr:hover{background:#f8fafc}.btn{padding:8px 16px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;margin-bottom:16px}@media print{.btn{display:none}}</style></head>
<body><h2>Estado de cuenta — ${proyectoNombre ?? ''}</h2><p>Generado el ${fecha}</p>
<button class="btn" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
<table><thead><tr><th>Unidad</th><th>Cuotas</th><th>Pagadas</th><th>Vencidas</th><th>Saldo pendiente</th></tr></thead><tbody>${filas}</tbody></table>
<p style="margin-top:16px;font-size:10px;color:#94a3b8">Total unidades: ${unidades.length} · Total cartera vencida: ${moneda} ${morosos.reduce((s, c) => s + c.monto, 0).toFixed(2)}</p>
</body></html>`
    const w = window.open('', '_blank', 'width=960,height=720')
    if (w) { w.document.write(html); w.document.close() }
  }

  const cuotasFiltradas = cuotas.filter(c => !periodo || c.periodo === periodo)
  const gastosFiltrados = gastos.filter(g => !anio || g.fecha?.startsWith(anio))

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
        Los CSV se descargan directamente en el navegador. El estado de cuenta se abre en una ventana imprimible (también permite guardar como PDF desde el navegador).
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        {/* Cuotas */}
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>💳</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#1d4ed8', marginBottom: 4 }}>Cuotas</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>{cuotasFiltradas.length} registros del período</div>
          <select value={periodo} onChange={e => setPeriodo(e.target.value)}
            style={{ width: '100%', padding: '5px 8px', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 11, marginBottom: 10 }}>
            <option value="">Todos los períodos</option>
            {periodos.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button onClick={exportCuotas}
            style={{ padding: '7px 14px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            ⬇ Descargar CSV
          </button>
        </div>

        {/* Morosos */}
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>⚠️</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#dc2626', marginBottom: 4 }}>Morosos</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>{morosos.length} cuotas vencidas al {hoy}</div>
          <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, marginBottom: 10 }}>
            {moneda} {morosos.reduce((s, c) => s + c.monto, 0).toLocaleString('es', { minimumFractionDigits: 2 })} en mora
          </div>
          <button onClick={exportMorosos}
            style={{ padding: '7px 14px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            ⬇ Descargar CSV
          </button>
        </div>

        {/* Gastos */}
        <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>💸</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#d97706', marginBottom: 4 }}>Gastos</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>{gastosFiltrados.length} gastos del año</div>
          <select value={anio} onChange={e => setAnio(e.target.value)}
            style={{ width: '100%', padding: '5px 8px', border: '1px solid #fde68a', borderRadius: 6, fontSize: 11, marginBottom: 10 }}>
            {anios.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button onClick={exportGastos}
            style={{ padding: '7px 14px', background: '#d97706', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            ⬇ Descargar CSV
          </button>
        </div>

        {/* Tickets */}
        <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>🔧</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#7c3aed', marginBottom: 4 }}>Tickets</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>{tickets.length} tickets totales</div>
          <div style={{ fontSize: 11, color: '#7c3aed', marginBottom: 10 }}>
            {tickets.filter(t => t.estado === 'abierto' || t.estado === 'en_proceso').length} abiertos actualmente
          </div>
          <button onClick={exportTickets}
            style={{ padding: '7px 14px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            ⬇ Descargar CSV
          </button>
        </div>

        {/* Visitantes */}
        <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>🚪</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#0369a1', marginBottom: 4 }}>Visitantes</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>{Math.min(visitantes.length, 1000)} registros recientes</div>
          <div style={{ fontSize: 11, color: '#0369a1', marginBottom: 10 }}>
            {visitantes.filter(v => !v.hora_salida).length} actualmente dentro
          </div>
          <button onClick={exportVisitantes}
            style={{ padding: '7px 14px', background: '#0369a1', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            ⬇ Descargar CSV
          </button>
        </div>

        {/* Estado de cuenta imprimible */}
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>🖨️</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#374151', marginBottom: 4 }}>Estado de cuenta</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>Resumen de saldo por unidad — {unidades.length} unidades</div>
          <div style={{ fontSize: 11, color: '#374151', marginBottom: 10 }}>
            Abre una ventana para imprimir o guardar como PDF
          </div>
          <button onClick={imprimirEstadoCuenta}
            style={{ padding: '7px 14px', background: '#374151', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            🖨️ Ver / Imprimir
          </button>
        </div>
      </div>
    </div>
  )
}
