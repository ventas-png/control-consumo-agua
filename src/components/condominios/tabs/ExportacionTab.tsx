import { hoyLocalISO } from '../../../lib/format'
import { useState } from 'react'
import { CuotaCondominio, GastoCondominio, TicketMantenimiento, Visitante, Unidad } from '../../../types'
import { exportarExcel, exportarPDFTabla } from '../exportUtils'

interface Props {
  cuotas: CuotaCondominio[]
  gastos: GastoCondominio[]
  tickets: TicketMantenimiento[]
  visitantes: Visitante[]
  unidades: Unidad[]
  moneda: string
  proyectoNombre?: string
}

export default function ExportacionTab({ cuotas, gastos, tickets, visitantes, unidades, moneda, proyectoNombre }: Props) {
  const hoy = hoyLocalISO()

  const periodos = [...new Set(cuotas.map(c => c.periodo).filter(Boolean))].sort().reverse()
  const anios = [...new Set((gastos.map(g => g.fecha?.slice(0, 4)).filter(Boolean) as string[]))].sort().reverse()

  const [periodo, setPeriodo] = useState(periodos[0] ?? '')
  const [anio, setAnio] = useState(anios[0] ?? new Date().getFullYear().toString())

  const morosos = cuotas.filter(c =>
    (c.estado === 'pendiente' || c.estado === 'moroso') && c.fecha_vencimiento && c.fecha_vencimiento < hoy
  )

  const cuotasFiltradas = cuotas.filter(c => !periodo || c.periodo === periodo)
  const gastosFiltrados = gastos.filter(g => !anio || g.fecha?.startsWith(anio))

  function exportCuotas() {
    exportarExcel(`cuotas_${periodo || 'todas'}`, [{
      name: 'Cuotas',
      headers: ['Unidad', 'Concepto', 'Monto', 'Período', 'Vencimiento', 'Estado'],
      rows: cuotasFiltradas.map(c => [c.unidad_nombre ?? '', c.concepto, c.monto, c.periodo, c.fecha_vencimiento ?? '', c.estado]),
    }])
  }

  function exportMorosos() {
    const datos = [...morosos].sort((a, b) => (a.unidad_nombre ?? '').localeCompare(b.unidad_nombre ?? ''))
    exportarExcel(`morosos_${hoy}`, [{
      name: 'Morosos',
      headers: ['Unidad', 'Concepto', 'Monto', 'Período', 'Vencimiento', 'Días vencido', 'Estado'],
      rows: datos.map(c => {
        const dias = c.fecha_vencimiento
          ? Math.floor((Date.now() - new Date(c.fecha_vencimiento).getTime()) / 86400000)
          : 0
        return [c.unidad_nombre ?? '', c.concepto, c.monto, c.periodo, c.fecha_vencimiento ?? '', dias, c.estado]
      }),
    }])
  }

  function exportGastos() {
    exportarExcel(`gastos_${anio}`, [{
      name: 'Gastos',
      headers: ['Concepto', 'Categoría', 'Monto', 'Fecha', 'Proveedor', 'Estado'],
      rows: gastosFiltrados.map(g => [g.concepto, g.categoria, g.monto, g.fecha, g.proveedor_nombre ?? '', g.estado]),
    }])
  }

  function exportTickets() {
    exportarExcel(`tickets_${hoy}`, [{
      name: 'Tickets',
      headers: ['Título', 'Unidad', 'Prioridad', 'Estado', 'Tipo', 'Creado', 'Cerrado'],
      rows: tickets.map(t => [t.titulo, t.unidad_nombre ?? '', t.prioridad, t.estado, t.tipo, t.created_at?.slice(0, 10) ?? '', t.fecha_cierre?.slice(0, 10) ?? '']),
    }])
  }

  function exportVisitantes() {
    exportarExcel(`visitantes_${hoy}`, [{
      name: 'Visitantes',
      headers: ['Nombre', 'Unidad', 'Identificación', 'Motivo', 'Entrada', 'Salida'],
      rows: visitantes.slice(0, 5000).map(v => [v.nombre, v.unidad_nombre ?? '', v.identificacion ?? '', v.motivo ?? '', v.hora_entrada?.slice(0, 16) ?? '', v.hora_salida?.slice(0, 16) ?? '']),
    }])
  }

  function exportUnidades() {
    exportarExcel(`unidades_${hoy}`, [{
      name: 'Unidades',
      headers: ['Nombre', 'Tipo', 'Propietario', 'Área m²', 'Activa'],
      rows: unidades.map(u => [u.nombre, u.tipo, u.propietario_nombre ?? '', u.area_m2 ?? '', u.activo ? 'Sí' : 'No']),
    }])
  }

  function exportResumenFinanciero() {
    const totalRecaudado = cuotasFiltradas.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0)
    const totalPendiente = cuotasFiltradas.filter(c => c.estado !== 'pagado').reduce((s, c) => s + c.monto, 0)
    const totalGastos = gastosFiltrados.reduce((s, g) => s + g.monto, 0)

    exportarExcel(`resumen_financiero_${periodo || anio}`, [
      {
        name: 'Resumen',
        headers: ['Concepto', 'Valor'],
        rows: [
          ['Cuotas totales período', cuotasFiltradas.length],
          ['Cuotas pagadas', cuotasFiltradas.filter(c => c.estado === 'pagado').length],
          ['Cuotas pendientes/morosas', cuotasFiltradas.filter(c => c.estado !== 'pagado').length],
          [`Total recaudado (${moneda})`, totalRecaudado],
          [`Total pendiente (${moneda})`, totalPendiente],
          [`Total gastos (${moneda})`, totalGastos],
          [`Saldo neto (${moneda})`, totalRecaudado - totalGastos],
        ],
      },
      {
        name: 'Cuotas',
        headers: ['Unidad', 'Concepto', 'Monto', 'Período', 'Estado'],
        rows: cuotasFiltradas.map(c => [c.unidad_nombre ?? '', c.concepto, c.monto, c.periodo, c.estado]),
      },
      {
        name: 'Gastos',
        headers: ['Concepto', 'Categoría', 'Monto', 'Fecha'],
        rows: gastosFiltrados.map(g => [g.concepto, g.categoria, g.monto, g.fecha]),
      },
    ])
  }

  function pdfMorosos() {
    exportarPDFTabla({
      titulo: 'Reporte de Deudores',
      subtitulo: `Al ${hoy} · ${morosos.length} unidades con saldo pendiente`,
      proyectoNombre,
      headers: ['Unidad', 'Concepto', 'Período', `Monto (${moneda})`, 'Días vencido', 'Estado'],
      rows: morosos.map(c => {
        const dias = c.fecha_vencimiento
          ? Math.floor((Date.now() - new Date(c.fecha_vencimiento).getTime()) / 86400000)
          : 0
        return [c.unidad_nombre ?? '', c.concepto, c.periodo, c.monto.toFixed(2), dias, c.estado]
      }),
      totalesRow: ['', '', 'TOTAL', `${moneda} ${morosos.reduce((s, c) => s + c.monto, 0).toFixed(2)}`, '', `${morosos.length} cuotas`],
      rightAlignCols: [3, 4],
      filename: `morosos-${hoy}`,
      landscape: true,
    })
  }

  function pdfTickets() {
    exportarPDFTabla({
      titulo: 'Reporte de Tickets de Mantenimiento',
      subtitulo: `${tickets.filter(t => t.estado !== 'cerrado').length} activos de ${tickets.length} totales`,
      proyectoNombre,
      headers: ['Título', 'Unidad', 'Prioridad', 'Estado', 'Tipo', 'Creado'],
      rows: tickets.map(t => [t.titulo, t.unidad_nombre ?? '', t.prioridad, t.estado, t.tipo, t.created_at?.slice(0, 10) ?? '']),
      filename: `tickets-${hoy}`,
      landscape: true,
    })
  }

  type ExportCard = {
    icon: string; title: string; desc: string
    accentColor: string; bg: string; border: string
    period?: { value: string; onChange: (v: string) => void; options: string[] }
    actions: { label: string; color: string; onClick: () => void }[]
  }

  const cards: ExportCard[] = [
    {
      icon: '💳', title: 'Cuotas', accentColor: 'var(--at-primary-hover)', bg: 'var(--at-primary-tint)', border: 'var(--at-primary-soft-2)',
      desc: `${cuotasFiltradas.length} registros del período`,
      period: { value: periodo, onChange: setPeriodo, options: periodos },
      actions: [
        { label: '📊 Excel', color: 'var(--at-primary-hover)', onClick: exportCuotas },
      ],
    },
    {
      icon: '⚠️', title: 'Deudores / Morosos', accentColor: 'var(--at-danger)', bg: 'var(--at-danger-tint)', border: 'var(--at-danger-border)',
      desc: `${morosos.length} cuotas vencidas — ${moneda} ${morosos.reduce((s, c) => s + c.monto, 0).toLocaleString('es', { minimumFractionDigits: 2 })}`,
      actions: [
        { label: '📊 Excel', color: 'var(--at-danger)', onClick: exportMorosos },
        { label: '📄 PDF', color: 'var(--at-danger-strong)', onClick: pdfMorosos },
      ],
    },
    {
      icon: '💸', title: 'Gastos', accentColor: 'var(--at-warning)', bg: 'var(--at-warning-tint)', border: 'var(--at-warning-border)',
      desc: `${gastosFiltrados.length} gastos del año`,
      period: { value: anio, onChange: setAnio, options: anios },
      actions: [
        { label: '📊 Excel', color: 'var(--at-warning)', onClick: exportGastos },
      ],
    },
    {
      icon: '🔧', title: 'Tickets', accentColor: 'var(--at-accent-hover)', bg: 'var(--at-accent-tint-2)', border: 'var(--at-accent-soft-2)',
      desc: `${tickets.length} tickets — ${tickets.filter(t => t.estado !== 'cerrado').length} activos`,
      actions: [
        { label: '📊 Excel', color: 'var(--at-accent-hover)', onClick: exportTickets },
        { label: '📄 PDF', color: '#4c1d95', onClick: pdfTickets },
      ],
    },
    {
      icon: '🚪', title: 'Visitantes', accentColor: 'var(--at-primary-hover)', bg: 'var(--at-primary-tint)', border: 'var(--at-primary-soft-2)',
      desc: `${Math.min(visitantes.length, 5000)} registros — ${visitantes.filter(v => !v.hora_salida).length} en premisas`,
      actions: [
        { label: '📊 Excel', color: 'var(--at-primary-hover)', onClick: exportVisitantes },
      ],
    },
    {
      icon: '🏠', title: 'Unidades', accentColor: 'var(--at-accent-2)', bg: '#f0fdfa', border: '#99f6e4',
      desc: `${unidades.length} unidades — ${unidades.filter(u => u.activo).length} activas`,
      actions: [
        { label: '📊 Excel', color: 'var(--at-accent-2)', onClick: exportUnidades },
      ],
    },
    {
      icon: '📊', title: 'Resumen Financiero', accentColor: 'var(--at-ink-2)', bg: 'var(--at-surface-2)', border: 'var(--at-line)',
      desc: 'Cuotas + Gastos en un solo libro (3 hojas)',
      actions: [
        { label: '📊 Excel multi-hoja', color: 'var(--at-ink-2)', onClick: exportResumenFinanciero },
      ],
    },
  ]

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 13, color: 'var(--at-ink-3)', marginBottom: 20 }}>
        Exporta datos a <strong>Excel (.xlsx)</strong> o descarga reportes en <strong>PDF</strong> directamente desde el navegador.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
        {cards.map(card => (
          <div key={card.title} style={{ background: card.bg, border: `1px solid ${card.border}`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>{card.icon}</div>
            <div style={{ fontWeight: 700, fontSize: 14, color: card.accentColor, marginBottom: 4 }}>{card.title}</div>
            <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 10 }}>{card.desc}</div>
            {card.period && (
              <select
                value={card.period.value}
                onChange={e => card.period!.onChange(e.target.value)}
                style={{ width: '100%', padding: '5px 8px', border: `1px solid ${card.border}`, borderRadius: 6, fontSize: 11, marginBottom: 10, background: 'var(--at-surface)' }}>
                <option value="">Todos</option>
                {card.period.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {card.actions.map(act => (
                <button
                  key={act.label}
                  onClick={act.onClick}
                  style={{ padding: '7px 12px', background: act.color, color: 'white', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  {act.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
