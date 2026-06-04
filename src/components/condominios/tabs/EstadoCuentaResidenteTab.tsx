import { useState, useMemo } from 'react'
import { CuotaCondominio, RecargoMora, ConvenioCuotaCond, Unidad } from '../../../types'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { exportarPDFEstadoCuenta } from '../exportUtils'
// T4 · cond:C4 — estado canónico de la cuota + desglose. La query de cuotas de
// CondominiosSection trae `select('*')`, así que las filas YA cargan
// cuota_estado/mora_monto/total_a_pagar en runtime aunque el tipo CuotaCondominio
// no las declare; las leemos con esta proyección de la capa de dominio.
import type { CuotaConEstado } from '../../../domain/condominios/queries'
import { CuotaEstadoBadge } from './CuotasUi'

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
  /** Estado canónico de la cuota (`cuota_estado`), solo para tipo 'cuota'. */
  cuotaEstado?: string | null
}

interface MovimientoConSaldo extends Movimiento {
  id: string
  saldoAcum: number
}

const ESTADO_CFG: Record<string, { color: string; bg: string }> = {
  pagado:   { color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  pendiente:{ color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  moroso:   { color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
  activo:   { color: 'var(--at-primary)', bg: 'var(--at-primary-tint)' },
  aplicado: { color: 'var(--at-accent-hover)', bg: 'var(--at-accent-tint-2)' },
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
        // Estado canónico (`cuota_estado`) de la máquina de estados: presente en
        // runtime (select('*')) aunque el tipo no lo declare. Cae al legacy
        // `estado` si la fila aún no se ha emitido. El abono se reconoce cuando la
        // cuota está saldada (pagada/pagado).
        const ce = (c as CuotaConEstado).cuota_estado ?? null
        const saldada = ce === 'pagada' || c.estado === 'pagado'
        list.push({
          fecha: c.fecha_vencimiento ?? c.periodo + '-01',
          tipo: 'cuota',
          descripcion: `${c.concepto} — Período ${c.periodo}`,
          cargo: c.monto,
          abono: saldada ? c.monto : 0,
          estado: c.estado,
          cuotaEstado: ce,
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

  // Pre-compute saldo acumulado por fila (orden cronológico).
  const movimientosConSaldo: MovimientoConSaldo[] = useMemo(() => {
    let acc = 0
    return movimientos.map((m, i) => {
      acc += m.cargo - m.abono
      return { ...m, id: `mov-${i}-${m.fecha}`, saldoAcum: acc }
    })
  }, [movimientos])

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
        <td style="text-align:center"><span style="padding:2px 8px;border-radius:12px;background:${ESTADO_CFG[m.estado]?.bg ?? 'var(--at-chip)'};color:${ESTADO_CFG[m.estado]?.color ?? 'var(--at-ink-2)'};font-size:11px">${m.estado}</span></td>
      </tr>`).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Estado de Cuenta — ${unidad?.nombre}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:32px;max-width:900px;margin:auto;color:#15291F}
      h1{font-size:20px;margin:0}h2{font-size:13px;color:var(--at-ink-3);font-weight:normal;margin:4px 0 0}
      .header{display:flex;justify-content:space-between;border-bottom:2px solid #15291F;padding-bottom:12px;margin-bottom:20px}
      .meta{background:var(--at-surface-2);padding:12px 16px;border-radius:8px;margin-bottom:20px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:12px}
      .meta strong{font-size:16px;display:block}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th{background:var(--at-chip);padding:8px 10px;text-align:left;color:var(--at-ink-3);font-weight:600}
      td{padding:8px 10px;border-bottom:1px solid var(--at-chip)}
      tfoot td{font-weight:700;border-top:2px solid #15291F;background:var(--at-surface-2)}
      .saldo{font-size:18px;font-weight:800;color:${saldo <= 0 ? 'var(--at-success)' : 'var(--at-danger)'}}
      .footer{margin-top:32px;font-size:10px;color:var(--at-ink-3);border-top:1px solid var(--at-line);padding-top:8px}
    </style></head><body>
    <div class="header">
      <div><h1>Estado de Cuenta</h1><h2>${proyectoNombre ?? 'Condominio'}</h2></div>
      <div style="text-align:right;font-size:12px;color:var(--at-ink-3)">Generado: ${new Date().toLocaleDateString('es')}</div>
    </div>
    <div class="meta">
      <div><span style="font-size:10px;color:var(--at-ink-3)">Unidad</span><strong>${unidad?.nombre ?? unidadId}</strong></div>
      <div><span style="font-size:10px;color:var(--at-ink-3)">Período</span><strong>${anio}</strong></div>
      <div><span style="font-size:10px;color:var(--at-ink-3)">Saldo</span><strong class="saldo">${saldo <= 0 ? 'Al día' : moneda + ' ' + saldo.toFixed(2)}</strong></div>
    </div>
    <table>
      <thead><tr><th>Fecha</th><th>Descripción</th><th style="text-align:right">Cargo</th><th style="text-align:right">Abono</th><th style="text-align:center">Estado</th></tr></thead>
      <tbody>${filas}</tbody>
      <tfoot>
        <tr>
          <td colspan="2">TOTALES</td>
          <td style="text-align:right">${moneda} ${totalCargos.toFixed(2)}</td>
          <td style="text-align:right">${moneda} ${totalAbonos.toFixed(2)}</td>
          <td style="text-align:center;font-size:13px;color:${saldo <= 0 ? 'var(--at-success)' : 'var(--at-danger)'}">${saldo <= 0 ? '✓ Al día' : 'Debe: ' + moneda + ' ' + saldo.toFixed(2)}</td>
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
        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)' }}>Estado de Cuenta por Residente</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={unidadId} onChange={e => setUnidadId(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 13, background: 'var(--at-surface)' }}>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
          <select value={anio} onChange={e => setAnio(Number(e.target.value))}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 13, background: 'var(--at-surface)' }}>
            {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button onClick={() => exportarPDFEstadoCuenta(movimientos, unidad?.nombre ?? unidadId, anio, moneda, proyectoNombre)}
            style={{ padding: '6px 16px', background: 'var(--at-accent-2)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            📄 Descargar PDF
          </button>
          <button onClick={imprimir}
            style={{ padding: '6px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            🖨️ Imprimir
          </button>
        </div>
      </div>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { label: 'Unidad', val: unidad?.nombre ?? '—', color: 'var(--at-ink)', bg: 'var(--at-surface-2)' },
          { label: 'Total cargos', val: `${moneda} ${totalCargos.toFixed(2)}`, color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
          { label: 'Total abonos', val: `${moneda} ${totalAbonos.toFixed(2)}`, color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
          { label: 'Saldo', val: saldo <= 0 ? '✓ Al día' : `${moneda} ${saldo.toFixed(2)}`, color: saldo <= 0 ? 'var(--at-success)' : 'var(--at-danger)', bg: saldo <= 0 ? 'var(--at-success-tint)' : 'var(--at-danger-tint)' },
          { label: 'Cuotas pendientes', val: String(pendientes), color: pendientes === 0 ? 'var(--at-success)' : 'var(--at-warning)', bg: pendientes === 0 ? 'var(--at-success-tint)' : 'var(--at-warning-tint)' },
        ].map(k => (
          <div key={k.label} style={{ flex: '1 1 100px', background: k.bg, border: `1px solid ${k.color}22`, borderRadius: 10, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{k.label}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Table — F3.9.1: migrado a <DataTable> shared con footer */}
      <DataTable<MovimientoConSaldo>
        data={movimientosConSaldo}
        rowKey="id"
        pageSize={0}
        defaultSort={{ key: 'fecha', direction: 'asc' }}
        emptyState={
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--at-ink-3)', fontSize: 13 }}>
            Sin movimientos para {unidad?.nombre} en {anio}.
          </div>
        }
        columns={[
          {
            key: 'fecha', header: 'Fecha', sortable: true,
            accessor: m => m.fecha,
            render: m => <span style={{ color: 'var(--at-ink-3)' }}>{m.fecha}</span>,
          },
          {
            key: 'descripcion', header: 'Descripción', sortable: true,
            accessor: m => m.descripcion,
            render: m => <span style={{ color: 'var(--at-ink)' }}>{m.descripcion}</span>,
          },
          {
            key: 'cargo', header: 'Cargo', sortable: true, align: 'right',
            accessor: m => m.cargo,
            render: m => (
              <span style={{ color: m.cargo > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>
                {m.cargo > 0 ? `${moneda} ${m.cargo.toFixed(2)}` : '—'}
              </span>
            ),
          },
          {
            key: 'abono', header: 'Abono', sortable: true, align: 'right',
            accessor: m => m.abono,
            render: m => (
              <span style={{ color: m.abono > 0 ? 'var(--at-success)' : 'var(--at-ink-3)' }}>
                {m.abono > 0 ? `${moneda} ${m.abono.toFixed(2)}` : '—'}
              </span>
            ),
          },
          {
            key: 'saldoAcum', header: 'Saldo acum.', align: 'right',
            accessor: m => m.saldoAcum,
            render: m => (
              <span style={{ fontWeight: 600, color: m.saldoAcum > 0 ? 'var(--at-danger)' : 'var(--at-success)' }}>
                {m.saldoAcum > 0 ? `${moneda} ${m.saldoAcum.toFixed(2)}` : '✓'}
              </span>
            ),
          },
          {
            key: 'estado', header: 'Estado', sortable: true, align: 'right',
            accessor: m => m.cuotaEstado ?? m.estado,
            // Para movimientos de cuota mostramos el badge del estado canónico
            // (cond:C4); el resto (recargos/convenios) conservan su chip legacy.
            render: m => {
              if (m.tipo === 'cuota' && m.cuotaEstado != null) {
                return <CuotaEstadoBadge estado={m.cuotaEstado} />
              }
              const sCfg = ESTADO_CFG[m.estado] ?? { color: 'var(--at-ink-2)', bg: 'var(--at-chip)' }
              return (
                <span style={{ padding: '2px 8px', borderRadius: 20, background: sCfg.bg, color: sCfg.color, fontSize: 10, fontWeight: 600 }}>{m.estado}</span>
              )
            },
          },
        ] satisfies DataTableColumn<MovimientoConSaldo>[]}
        footer={
          <tr>
            <td colSpan={2} style={{ padding: '9px 12px', fontWeight: 700 }}>TOTAL</td>
            <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--at-danger)' }}>{moneda} {totalCargos.toFixed(2)}</td>
            <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--at-success)' }}>{moneda} {totalAbonos.toFixed(2)}</td>
            <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 800, color: saldo <= 0 ? 'var(--at-success)' : 'var(--at-danger)' }}>
              {saldo <= 0 ? '✓ Al día' : `${moneda} ${saldo.toFixed(2)}`}
            </td>
            <td />
          </tr>
        }
      />
    </div>
  )
}
