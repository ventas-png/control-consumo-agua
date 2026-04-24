import { useMemo } from 'react'
import {
  CuotaCondominio, GastoCondominio, PresupuestoCondominio, TicketMantenimiento,
  PolizaSeguro, InspeccionNormativa, ContratoArrendamiento, InfraccionCondominio,
  SugerenciaCondominio, Unidad, RecargoMora, FondoReservaMovimiento,
} from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  gastos: GastoCondominio[]
  presupuestos: PresupuestoCondominio[]
  tickets: TicketMantenimiento[]
  polizas: PolizaSeguro[]
  inspecciones: InspeccionNormativa[]
  contratos: ContratoArrendamiento[]
  infracciones: InfraccionCondominio[]
  sugerencias: SugerenciaCondominio[]
  unidades: Unidad[]
  recargosMora: RecargoMora[]
  fondoReservaMovs: FondoReservaMovimiento[]
  moneda: string
}

const hoy = new Date().toISOString().slice(0, 10)
const mesActual = hoy.slice(0, 7)

function diasHasta(fecha: string): number {
  return Math.round((new Date(fecha).getTime() - Date.now()) / 86400000)
}

function Kpi({ label, val, sub, color, bg }: { label: string; val: string; sub?: string; color: string; bg: string }) {
  return (
    <div style={{ flex: '1 1 120px', background: bg, border: `1px solid ${color}33`, borderRadius: 10, padding: '10px 14px' }}>
      <div style={{ fontSize: 10, color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color, marginTop: 2 }}>{val}</div>
      {sub && <div style={{ fontSize: 10, color, opacity: 0.8, marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

function Semaforo({ valor, umbralBueno, umbralMalo, invertir = false }: { valor: number; umbralBueno: number; umbralMalo: number; invertir?: boolean }) {
  let color: string
  if (!invertir) {
    color = valor >= umbralBueno ? '#16a34a' : valor >= umbralMalo ? '#d97706' : '#ef4444'
  } else {
    color = valor <= umbralBueno ? '#16a34a' : valor <= umbralMalo ? '#d97706' : '#ef4444'
  }
  return <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: color, marginRight: 5 }} />
}

export default function PanelDirectivoTab({
  cuotas, gastos, presupuestos, tickets, polizas, inspecciones,
  contratos, infracciones, sugerencias, unidades, recargosMora, fondoReservaMovs, moneda,
}: Props) {
  const totalUnidades = unidades.filter(u => u.activo).length || 1

  // ── Financiero ────────────────────────────────────────────────────────────
  const cuotasMes = useMemo(() => cuotas.filter(c => c.periodo === mesActual || c.created_at.startsWith(mesActual)), [cuotas])
  const cobradoMes = cuotasMes.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0)
  const pendienteMes = cuotasMes.filter(c => c.estado === 'pendiente' || c.estado === 'moroso').reduce((s, c) => s + c.monto, 0)
  const tasaCobranza = (cobradoMes + pendienteMes) > 0 ? (cobradoMes / (cobradoMes + pendienteMes)) * 100 : 0

  const morosos = useMemo(() => {
    const unidsMorosas = new Set(cuotas.filter(c => c.estado === 'moroso').map(c => c.unidad_id))
    return unidsMorosas.size
  }, [cuotas])
  const tasaMorosidad = (morosos / totalUnidades) * 100

  const gastosMes = gastos.filter(g => g.fecha?.startsWith(mesActual) && g.estado !== 'anulado').reduce((s, g) => s + g.monto, 0)
  const presupuestoMes = presupuestos.filter(p => p.anio === new Date().getFullYear()).reduce((s, p) => s + p.monto_presupuestado / 12, 0)
  const ejecucionPresupuesto = presupuestoMes > 0 ? (gastosMes / presupuestoMes) * 100 : 0

  const saldoFondo = useMemo(() => {
    const sorted = [...fondoReservaMovs].sort((a, b) => a.fecha.localeCompare(b.fecha))
    let s = 0
    sorted.forEach(m => { s += (m.tipo === 'retiro') ? -m.monto : m.monto })
    return s
  }, [fondoReservaMovs])

  const recargosPendientes = recargosMora.filter(r => r.estado === 'aplicado').reduce((s, r) => s + r.monto_calculado, 0)

  // ── Mantenimiento ─────────────────────────────────────────────────────────
  const ticketsAbiertos = tickets.filter(t => t.estado === 'abierto').length
  const ticketsUrgentes = tickets.filter(t => t.estado === 'abierto' && t.prioridad === 'urgente').length
  const ticketsEnProceso = tickets.filter(t => t.estado === 'en_proceso').length
  const avgResolucion = useMemo(() => {
    const resueltos = tickets.filter(t => t.estado === 'resuelto' && t.fecha_cierre)
    if (!resueltos.length) return 0
    const total = resueltos.reduce((s, t) => {
      const dias = (new Date(t.fecha_cierre!).getTime() - new Date(t.created_at).getTime()) / 86400000
      return s + dias
    }, 0)
    return Math.round(total / resueltos.length)
  }, [tickets])

  // ── Ocupación ─────────────────────────────────────────────────────────────
  const contratosActivos = contratos.filter(c => c.estado === 'activo').length
  const contratosVencenProx30 = contratos.filter(c => {
    if (!c.fecha_fin) return false
    const d = diasHasta(c.fecha_fin)
    return d >= 0 && d <= 30
  }).length

  // ── Cumplimiento normativo ─────────────────────────────────────────────────
  const polizasVigentes = polizas.filter(p => p.estado === 'vigente').length
  const polizasVencenProx60 = polizas.filter(p => {
    const d = diasHasta(p.fecha_vencimiento)
    return d >= 0 && d <= 60
  }).length
  const inspeccionesReprobadas = inspecciones.filter(i => i.resultado === 'reprobado').length
  const inspeccionesConObs = inspecciones.filter(i => i.resultado === 'aprobado_con_observaciones').length

  // ── Convivencia ───────────────────────────────────────────────────────────
  const infraccionesActivas = infracciones.filter(i => i.estado !== 'resuelta' && i.estado !== 'anulada').length
  const sugerenciasPendientes = sugerencias.filter(s => s.estado === 'pendiente' || s.estado === 'en_revision').length

  // Puntaje de salud (0-100)
  const puntajeSalud = useMemo(() => {
    let p = 100
    if (tasaMorosidad > 20) p -= 20; else if (tasaMorosidad > 10) p -= 10
    if (ejecucionPresupuesto > 110) p -= 10; else if (ejecucionPresupuesto > 100) p -= 5
    if (ticketsUrgentes > 0) p -= ticketsUrgentes * 5
    if (polizasVencenProx60 > 0) p -= 8
    if (inspeccionesReprobadas > 0) p -= 15
    if (infraccionesActivas > 3) p -= 5
    return Math.max(0, Math.min(100, p))
  }, [tasaMorosidad, ejecucionPresupuesto, ticketsUrgentes, polizasVencenProx60, inspeccionesReprobadas, infraccionesActivas])

  const saludColor = puntajeSalud >= 80 ? '#16a34a' : puntajeSalud >= 60 ? '#d97706' : '#ef4444'
  const saludLabel = puntajeSalud >= 80 ? 'Óptimo' : puntajeSalud >= 60 ? 'Regular' : 'Crítico'

  const SECTION = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, marginBottom: 14 }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 2 }}>Panel Directivo</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>Indicadores clave para la junta directiva · {hoy}</div>

      {/* Puntaje de salud */}
      <div style={{ background: `${saludColor}0f`, border: `1px solid ${saludColor}44`, borderRadius: 12, padding: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ textAlign: 'center', minWidth: 80 }}>
          <div style={{ fontSize: 36, fontWeight: 900, color: saludColor, lineHeight: 1 }}>{puntajeSalud}</div>
          <div style={{ fontSize: 10, color: saludColor, fontWeight: 700, marginTop: 2 }}>/ 100</div>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: saludColor }}>Índice de Salud del Condominio: {saludLabel}</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
            Basado en cobranza, morosidad, ejecución presupuestal, tickets urgentes, normativa y convivencia
          </div>
          <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, marginTop: 8, width: 240 }}>
            <div style={{ height: 8, borderRadius: 4, background: saludColor, width: `${puntajeSalud}%`, transition: 'width 0.5s' }} />
          </div>
        </div>
      </div>

      {/* KPIs principales */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <Kpi label="Tasa de cobranza" val={`${tasaCobranza.toFixed(1)}%`} sub="este mes" color={tasaCobranza >= 90 ? '#16a34a' : tasaCobranza >= 70 ? '#d97706' : '#ef4444'} bg={tasaCobranza >= 90 ? '#dcfce7' : tasaCobranza >= 70 ? '#fef3c7' : '#fef2f2'} />
        <Kpi label="Unidades morosas" val={String(morosos)} sub={`${tasaMorosidad.toFixed(1)}% del total`} color={morosos === 0 ? '#16a34a' : morosos < 5 ? '#d97706' : '#ef4444'} bg={morosos === 0 ? '#dcfce7' : morosos < 5 ? '#fef3c7' : '#fef2f2'} />
        <Kpi label="Tickets urgentes" val={String(ticketsUrgentes)} sub={`${ticketsAbiertos} abiertos total`} color={ticketsUrgentes === 0 ? '#16a34a' : '#ef4444'} bg={ticketsUrgentes === 0 ? '#dcfce7' : '#fef2f2'} />
        <Kpi label="Fondo de reserva" val={`${moneda} ${saldoFondo.toLocaleString('es', { minimumFractionDigits: 0 })}`} sub="saldo acumulado" color={saldoFondo > 0 ? '#16a34a' : '#ef4444'} bg={saldoFondo > 0 ? '#dcfce7' : '#fef2f2'} />
        <Kpi label="Recargos mora" val={`${moneda} ${recargosPendientes.toLocaleString('es', { minimumFractionDigits: 2 })}`} sub="pendientes de cobro" color={recargosPendientes > 0 ? '#ef4444' : '#16a34a'} bg={recargosPendientes > 0 ? '#fef2f2' : '#dcfce7'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Financiero */}
        <div style={SECTION}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 10 }}>💰 Gestión Financiera</div>
          {[
            { label: 'Cobrado este mes', val: `${moneda} ${cobradoMes.toLocaleString('es', { minimumFractionDigits: 2 })}`, semaforo: { valor: tasaCobranza, umbralBueno: 90, umbralMalo: 70 } },
            { label: 'Pendiente de cobro', val: `${moneda} ${pendienteMes.toLocaleString('es', { minimumFractionDigits: 2 })}`, semaforo: { valor: pendienteMes, umbralBueno: 0, umbralMalo: 500, invertir: true } },
            { label: 'Gasto operativo (mes)', val: `${moneda} ${gastosMes.toLocaleString('es', { minimumFractionDigits: 2 })}`, semaforo: { valor: ejecucionPresupuesto, umbralBueno: 100, umbralMalo: 110, invertir: true } },
            { label: 'Ejecución presupuestal', val: `${ejecucionPresupuesto.toFixed(1)}%`, semaforo: { valor: ejecucionPresupuesto, umbralBueno: 100, umbralMalo: 110, invertir: true } },
          ].map(row => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12 }}>
              <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center' }}>
                <Semaforo valor={row.semaforo.valor} umbralBueno={row.semaforo.umbralBueno} umbralMalo={row.semaforo.umbralMalo} invertir={row.semaforo.invertir} />
                {row.label}
              </span>
              <span style={{ fontWeight: 700, color: '#0f172a' }}>{row.val}</span>
            </div>
          ))}
        </div>

        {/* Mantenimiento */}
        <div style={SECTION}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 10 }}>🔧 Mantenimiento</div>
          {[
            { label: 'Tickets abiertos', val: String(ticketsAbiertos), semaforoVal: ticketsAbiertos, b: 5, m: 10, inv: true },
            { label: 'Tickets urgentes', val: String(ticketsUrgentes), semaforoVal: ticketsUrgentes, b: 0, m: 2, inv: true },
            { label: 'En proceso', val: String(ticketsEnProceso), semaforoVal: ticketsEnProceso, b: 20, m: 5 },
            { label: 'Tiempo prom. resolución', val: avgResolucion > 0 ? `${avgResolucion} días` : '—', semaforoVal: avgResolucion, b: 3, m: 7, inv: true },
          ].map(row => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12 }}>
              <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center' }}>
                <Semaforo valor={row.semaforoVal} umbralBueno={row.b} umbralMalo={row.m} invertir={row.inv} />
                {row.label}
              </span>
              <span style={{ fontWeight: 700, color: '#0f172a' }}>{row.val}</span>
            </div>
          ))}
        </div>

        {/* Ocupación y arrendamientos */}
        <div style={SECTION}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 10 }}>🏠 Ocupación y Arrendamientos</div>
          {[
            { label: 'Unidades activas', val: String(totalUnidades) },
            { label: 'Contratos activos', val: String(contratosActivos) },
            { label: 'Contratos vencen en 30d', val: String(contratosVencenProx30), alert: contratosVencenProx30 > 0 },
            { label: 'Tasa de ocupación', val: `${totalUnidades > 0 ? Math.round((contratosActivos / totalUnidades) * 100) : 0}%` },
          ].map(row => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12 }}>
              <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center' }}>
                {row.alert !== undefined && <Semaforo valor={row.alert ? 1 : 0} umbralBueno={0} umbralMalo={0.5} invertir />}
                {row.label}
              </span>
              <span style={{ fontWeight: 700, color: row.alert ? '#d97706' : '#0f172a' }}>{row.val}</span>
            </div>
          ))}
        </div>

        {/* Cumplimiento y convivencia */}
        <div style={SECTION}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 10 }}>📋 Cumplimiento y Convivencia</div>
          {[
            { label: 'Pólizas vigentes', val: String(polizasVigentes), semaforoVal: polizas.length > 0 ? polizasVigentes / polizas.length * 100 : 100, b: 100, m: 80 },
            { label: 'Pólizas vencen en 60d', val: String(polizasVencenProx60), semaforoVal: polizasVencenProx60, b: 0, m: 1, inv: true },
            { label: 'Inspecciones reprobadas', val: String(inspeccionesReprobadas), semaforoVal: inspeccionesReprobadas, b: 0, m: 1, inv: true },
            { label: 'Insp. con observaciones', val: String(inspeccionesConObs), semaforoVal: inspeccionesConObs, b: 0, m: 2, inv: true },
            { label: 'Infracciones activas', val: String(infraccionesActivas), semaforoVal: infraccionesActivas, b: 0, m: 3, inv: true },
            { label: 'Sugerencias pendientes', val: String(sugerenciasPendientes), semaforoVal: sugerenciasPendientes, b: 0, m: 5, inv: true },
          ].map(row => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12 }}>
              <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center' }}>
                <Semaforo valor={row.semaforoVal} umbralBueno={row.b} umbralMalo={row.m} invertir={row.inv} />
                {row.label}
              </span>
              <span style={{ fontWeight: 700, color: '#0f172a' }}>{row.val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Alertas críticas */}
      {(ticketsUrgentes > 0 || polizasVencenProx60 > 0 || inspeccionesReprobadas > 0 || contratosVencenProx30 > 0) && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, padding: 12, marginTop: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: '#ef4444', marginBottom: 6 }}>⚠ Alertas que requieren atención inmediata</div>
          {ticketsUrgentes > 0 && <div style={{ fontSize: 11, color: '#b91c1c', marginBottom: 3 }}>• {ticketsUrgentes} ticket(s) urgente(s) sin resolver</div>}
          {polizasVencenProx60 > 0 && <div style={{ fontSize: 11, color: '#b91c1c', marginBottom: 3 }}>• {polizasVencenProx60} póliza(s) vencen en los próximos 60 días</div>}
          {inspeccionesReprobadas > 0 && <div style={{ fontSize: 11, color: '#b91c1c', marginBottom: 3 }}>• {inspeccionesReprobadas} inspección(es) reprobada(s) sin acciones correctivas completadas</div>}
          {contratosVencenProx30 > 0 && <div style={{ fontSize: 11, color: '#b91c1c', marginBottom: 3 }}>• {contratosVencenProx30} contrato(s) de arrendamiento vence(n) en 30 días</div>}
        </div>
      )}
    </div>
  )
}
