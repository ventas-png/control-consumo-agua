import { useMemo } from 'react'
import {
  CuotaCondominio, GastoCondominio, PresupuestoCondominio, TicketMantenimiento,
  PolizaSeguro, InspeccionNormativa, ContratoArrendamiento, InfraccionCondominio,
  SugerenciaCondominio, Unidad, RecargoMora, FondoReservaMovimiento,
} from '../../../types'
import { exportarPDFTabla, exportarExcel } from '../exportUtils'

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
  proyectoNombre?: string
}

const hoy = new Date().toISOString().slice(0, 10)
const mesActual = hoy.slice(0, 7)

function diasHasta(fecha: string): number {
  return Math.round((new Date(fecha).getTime() - Date.now()) / 86400000)
}

function Kpi({ label, val, sub, color, bg }: { label: string; val: string; sub?: string; color: string; bg: string }) {
  return (
    <div style={{ flex: '1 1 120px', background: bg, border: `1px solid ${color}33`, borderRadius: 10, padding: '10px 14px' }}>
      <div style={{ fontSize: 10, color: '#7E9389' }}>{label}</div>
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
  contratos, infracciones, sugerencias, unidades, recargosMora, fondoReservaMovs, moneda, proyectoNombre = 'Condominio',
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

  const SECTION = { background: '#fff', border: '1px solid #E1DDD0', borderRadius: 12, padding: 14, marginBottom: 14 }

  const maxFinanciero = Math.max(cobradoMes, pendienteMes, gastosMes, 1)

  const alertas: { texto: string; accion: string; nivel: 'rojo' | 'naranja' }[] = []
  if (ticketsUrgentes > 0) alertas.push({ texto: `${ticketsUrgentes} ticket(s) urgente(s) sin resolver`, accion: 'Ir a Mantenimiento → filtrar por Urgente', nivel: 'rojo' })
  if (inspeccionesReprobadas > 0) alertas.push({ texto: `${inspeccionesReprobadas} inspección(es) reprobada(s)`, accion: 'Revisar plan de acciones correctivas en Inspecciones', nivel: 'rojo' })
  if (tasaMorosidad > 20) alertas.push({ texto: `Morosidad alta: ${tasaMorosidad.toFixed(1)}% de unidades en mora`, accion: 'Ejecutar campaña de cobro y revisar convenios de pago', nivel: 'rojo' })
  if (polizasVencenProx60 > 0) alertas.push({ texto: `${polizasVencenProx60} póliza(s) vencen en 60 días`, accion: 'Contactar agente de seguros para renovación anticipada', nivel: 'naranja' })
  if (contratosVencenProx30 > 0) alertas.push({ texto: `${contratosVencenProx30} contrato(s) de arrendamiento vence(n) en 30 días`, accion: 'Notificar arrendatarios y gestionar renovación', nivel: 'naranja' })
  if (ejecucionPresupuesto > 100) alertas.push({ texto: `Presupuesto excedido: ${ejecucionPresupuesto.toFixed(1)}% ejecutado`, accion: 'Revisar gastos del mes y diferir no urgentes', nivel: 'naranja' })

  function exportarInformePDF() {
    exportarPDFTabla({
      titulo: 'Informe Panel Directivo',
      proyectoNombre,
      headers: ['Indicador', 'Valor', 'Estado'],
      rows: [
        ['Índice de salud', `${puntajeSalud}/100`, saludLabel],
        ['Tasa de cobranza', `${tasaCobranza.toFixed(1)}%`, tasaCobranza >= 90 ? 'Óptimo' : tasaCobranza >= 70 ? 'Regular' : 'Crítico'],
        ['Unidades morosas', `${morosos} (${tasaMorosidad.toFixed(1)}%)`, morosos === 0 ? 'Óptimo' : 'Atención'],
        ['Cobrado este mes', `${moneda} ${cobradoMes.toFixed(2)}`, ''],
        ['Pendiente de cobro', `${moneda} ${pendienteMes.toFixed(2)}`, ''],
        ['Gasto operativo mes', `${moneda} ${gastosMes.toFixed(2)}`, ''],
        ['Ejecución presupuestal', `${ejecucionPresupuesto.toFixed(1)}%`, ejecucionPresupuesto <= 100 ? 'Óptimo' : 'Excedido'],
        ['Fondo de reserva', `${moneda} ${saldoFondo.toFixed(2)}`, saldoFondo > 0 ? 'Positivo' : 'Déficit'],
        ['Tickets urgentes', String(ticketsUrgentes), ticketsUrgentes === 0 ? 'Óptimo' : 'Urgente'],
        ['Tickets abiertos total', String(ticketsAbiertos), ''],
        ['Tiempo prom. resolución', avgResolucion > 0 ? `${avgResolucion} días` : '—', ''],
        ['Pólizas vigentes', String(polizasVigentes), ''],
        ['Pólizas vencen 60d', String(polizasVencenProx60), polizasVencenProx60 > 0 ? 'Atención' : 'OK'],
        ['Infracciones activas', String(infraccionesActivas), ''],
        ['Sugerencias pendientes', String(sugerenciasPendientes), ''],
      ],
      filename: `panel-directivo-${hoy}`,
    })
  }

  function exportarResumenXlsx() {
    exportarExcel(`panel-directivo-${hoy}`, [{
      name: 'KPIs',
      headers: ['Indicador', 'Valor', 'Estado'],
      rows: [
        ['Índice de salud', puntajeSalud, saludLabel],
        ['Tasa de cobranza %', tasaCobranza.toFixed(1), tasaCobranza >= 90 ? 'Óptimo' : tasaCobranza >= 70 ? 'Regular' : 'Crítico'],
        ['Unidades morosas', morosos, ''],
        ['Tasa morosidad %', tasaMorosidad.toFixed(1), ''],
        ['Cobrado este mes', cobradoMes, ''],
        ['Pendiente cobro', pendienteMes, ''],
        ['Gasto operativo mes', gastosMes, ''],
        ['Ejecución presupuestal %', ejecucionPresupuesto.toFixed(1), ''],
        ['Fondo de reserva', saldoFondo, ''],
        ['Recargos mora pendientes', recargosPendientes, ''],
        ['Tickets urgentes', ticketsUrgentes, ''],
        ['Tickets abiertos', ticketsAbiertos, ''],
        ['Tiempo prom. resolución (días)', avgResolucion, ''],
        ['Pólizas vigentes', polizasVigentes, ''],
        ['Pólizas vencen 60d', polizasVencenProx60, ''],
        ['Inspecciones reprobadas', inspeccionesReprobadas, ''],
        ['Infracciones activas', infraccionesActivas, ''],
        ['Sugerencias pendientes', sugerenciasPendientes, ''],
      ],
    }])
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#15291F' }}>Panel Directivo</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={exportarInformePDF} style={{ padding: '5px 10px', background: '#EEF2EC', color: '#1B3B36', border: '1.5px solid #C2D2CA', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 11 }}>📄 PDF</button>
          <button onClick={exportarResumenXlsx} style={{ padding: '5px 10px', background: '#f0fdf4', color: '#16a34a', border: '1.5px solid #86efac', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 11 }}>📊 Excel</button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#7E9389', marginBottom: 14 }}>Indicadores clave para la junta directiva · {hoy}</div>

      {/* Puntaje de salud */}
      <div style={{ background: `${saludColor}0f`, border: `1px solid ${saludColor}44`, borderRadius: 12, padding: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ textAlign: 'center', minWidth: 80 }}>
          <div style={{ fontSize: 36, fontWeight: 900, color: saludColor, lineHeight: 1 }}>{puntajeSalud}</div>
          <div style={{ fontSize: 10, color: saludColor, fontWeight: 700, marginTop: 2 }}>/ 100</div>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: saludColor }}>Índice de Salud del Condominio: {saludLabel}</div>
          <div style={{ fontSize: 11, color: '#7E9389', marginTop: 2 }}>
            Basado en cobranza, morosidad, ejecución presupuestal, tickets urgentes, normativa y convivencia
          </div>
          <div style={{ height: 8, background: '#E1DDD0', borderRadius: 4, marginTop: 8, width: 240 }}>
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
          <div style={{ fontWeight: 700, fontSize: 13, color: '#15291F', marginBottom: 10 }}>💰 Gestión Financiera</div>
          {[
            { label: 'Cobrado este mes', val: `${moneda} ${cobradoMes.toLocaleString('es', { minimumFractionDigits: 2 })}`, semaforo: { valor: tasaCobranza, umbralBueno: 90, umbralMalo: 70 } },
            { label: 'Pendiente de cobro', val: `${moneda} ${pendienteMes.toLocaleString('es', { minimumFractionDigits: 2 })}`, semaforo: { valor: pendienteMes, umbralBueno: 0, umbralMalo: 500, invertir: true } },
            { label: 'Gasto operativo (mes)', val: `${moneda} ${gastosMes.toLocaleString('es', { minimumFractionDigits: 2 })}`, semaforo: { valor: ejecucionPresupuesto, umbralBueno: 100, umbralMalo: 110, invertir: true } },
            { label: 'Ejecución presupuestal', val: `${ejecucionPresupuesto.toFixed(1)}%`, semaforo: { valor: ejecucionPresupuesto, umbralBueno: 100, umbralMalo: 110, invertir: true } },
          ].map(row => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #EAE6D8', fontSize: 12 }}>
              <span style={{ color: '#7E9389', display: 'flex', alignItems: 'center' }}>
                <Semaforo valor={row.semaforo.valor} umbralBueno={row.semaforo.umbralBueno} umbralMalo={row.semaforo.umbralMalo} invertir={row.semaforo.invertir} />
                {row.label}
              </span>
              <span style={{ fontWeight: 700, color: '#15291F' }}>{row.val}</span>
            </div>
          ))}
        </div>

        {/* Mantenimiento */}
        <div style={SECTION}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#15291F', marginBottom: 10 }}>🔧 Mantenimiento</div>
          {[
            { label: 'Tickets abiertos', val: String(ticketsAbiertos), semaforoVal: ticketsAbiertos, b: 5, m: 10, inv: true },
            { label: 'Tickets urgentes', val: String(ticketsUrgentes), semaforoVal: ticketsUrgentes, b: 0, m: 2, inv: true },
            { label: 'En proceso', val: String(ticketsEnProceso), semaforoVal: ticketsEnProceso, b: 20, m: 5 },
            { label: 'Tiempo prom. resolución', val: avgResolucion > 0 ? `${avgResolucion} días` : '—', semaforoVal: avgResolucion, b: 3, m: 7, inv: true },
          ].map(row => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #EAE6D8', fontSize: 12 }}>
              <span style={{ color: '#7E9389', display: 'flex', alignItems: 'center' }}>
                <Semaforo valor={row.semaforoVal} umbralBueno={row.b} umbralMalo={row.m} invertir={row.inv} />
                {row.label}
              </span>
              <span style={{ fontWeight: 700, color: '#15291F' }}>{row.val}</span>
            </div>
          ))}
        </div>

        {/* Ocupación y arrendamientos */}
        <div style={SECTION}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#15291F', marginBottom: 10 }}>🏠 Ocupación y Arrendamientos</div>
          {[
            { label: 'Unidades activas', val: String(totalUnidades) },
            { label: 'Contratos activos', val: String(contratosActivos) },
            { label: 'Contratos vencen en 30d', val: String(contratosVencenProx30), alert: contratosVencenProx30 > 0 },
            { label: 'Tasa de ocupación', val: `${totalUnidades > 0 ? Math.round((contratosActivos / totalUnidades) * 100) : 0}%` },
          ].map(row => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #EAE6D8', fontSize: 12 }}>
              <span style={{ color: '#7E9389', display: 'flex', alignItems: 'center' }}>
                {row.alert !== undefined && <Semaforo valor={row.alert ? 1 : 0} umbralBueno={0} umbralMalo={0.5} invertir />}
                {row.label}
              </span>
              <span style={{ fontWeight: 700, color: row.alert ? '#d97706' : '#15291F' }}>{row.val}</span>
            </div>
          ))}
        </div>

        {/* Cumplimiento y convivencia */}
        <div style={SECTION}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#15291F', marginBottom: 10 }}>📋 Cumplimiento y Convivencia</div>
          {[
            { label: 'Pólizas vigentes', val: String(polizasVigentes), semaforoVal: polizas.length > 0 ? polizasVigentes / polizas.length * 100 : 100, b: 100, m: 80 },
            { label: 'Pólizas vencen en 60d', val: String(polizasVencenProx60), semaforoVal: polizasVencenProx60, b: 0, m: 1, inv: true },
            { label: 'Inspecciones reprobadas', val: String(inspeccionesReprobadas), semaforoVal: inspeccionesReprobadas, b: 0, m: 1, inv: true },
            { label: 'Insp. con observaciones', val: String(inspeccionesConObs), semaforoVal: inspeccionesConObs, b: 0, m: 2, inv: true },
            { label: 'Infracciones activas', val: String(infraccionesActivas), semaforoVal: infraccionesActivas, b: 0, m: 3, inv: true },
            { label: 'Sugerencias pendientes', val: String(sugerenciasPendientes), semaforoVal: sugerenciasPendientes, b: 0, m: 5, inv: true },
          ].map(row => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #EAE6D8', fontSize: 12 }}>
              <span style={{ color: '#7E9389', display: 'flex', alignItems: 'center' }}>
                <Semaforo valor={row.semaforoVal} umbralBueno={row.b} umbralMalo={row.m} invertir={row.inv} />
                {row.label}
              </span>
              <span style={{ fontWeight: 700, color: '#15291F' }}>{row.val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Gráfica: Financiero del mes */}
      <div style={{ ...SECTION, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#15291F', marginBottom: 10 }}>📊 Financiero del mes — {mesActual}</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', height: 80 }}>
          {[
            { label: 'Cobrado', val: cobradoMes, color: '#16a34a' },
            { label: 'Pendiente', val: pendienteMes, color: '#d97706' },
            { label: 'Gasto', val: gastosMes, color: '#1B3B36' },
          ].map(b => {
            const pct = maxFinanciero > 0 ? (b.val / maxFinanciero) * 64 : 0
            return (
              <div key={b.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: b.color }}>{moneda} {b.val.toFixed(0)}</span>
                <div style={{ width: '100%', background: '#EAE6D8', borderRadius: '4px 4px 0 0', display: 'flex', alignItems: 'flex-end', height: 64 }}>
                  <div style={{ width: '100%', background: b.color, height: `${pct}px`, borderRadius: '4px 4px 0 0', transition: 'height 0.4s', minHeight: b.val > 0 ? 4 : 0 }} />
                </div>
                <span style={{ fontSize: 10, color: '#7E9389', fontWeight: 600 }}>{b.label}</span>
              </div>
            )
          })}
          <div style={{ flex: 2, paddingLeft: 8, borderLeft: '1px solid #E1DDD0' }}>
            <div style={{ fontSize: 11, color: '#7E9389', marginBottom: 4 }}>Ejecución presupuestal</div>
            <div style={{ height: 8, background: '#E1DDD0', borderRadius: 4, marginBottom: 4 }}>
              <div style={{ height: 8, borderRadius: 4, background: ejecucionPresupuesto > 100 ? '#ef4444' : '#1B3B36', width: `${Math.min(ejecucionPresupuesto, 100)}%`, transition: 'width 0.4s' }} />
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: ejecucionPresupuesto > 100 ? '#ef4444' : '#1B3B36' }}>{ejecucionPresupuesto.toFixed(1)}%</div>
            <div style={{ fontSize: 10, color: '#7E9389', marginTop: 6 }}>Fondo reserva: {moneda} {saldoFondo.toFixed(0)}</div>
            <div style={{ fontSize: 10, color: recargosPendientes > 0 ? '#ef4444' : '#7E9389' }}>Recargos mora: {moneda} {recargosPendientes.toFixed(0)}</div>
          </div>
        </div>
      </div>

      {/* Alertas con acciones recomendadas */}
      {alertas.length > 0 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, padding: 12, marginTop: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: '#ef4444', marginBottom: 8 }}>⚠ Alertas que requieren atención</div>
          {alertas.map((a, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, background: a.nivel === 'rojo' ? '#fef2f2' : '#fff7ed', borderRadius: 8, padding: '6px 10px', border: `1px solid ${a.nivel === 'rojo' ? '#fecaca' : '#fed7aa'}` }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>{a.nivel === 'rojo' ? '🔴' : '🟠'}</span>
              <div>
                <div style={{ fontSize: 11, color: a.nivel === 'rojo' ? '#b91c1c' : '#9a3412', fontWeight: 700 }}>{a.texto}</div>
                <div style={{ fontSize: 10, color: a.nivel === 'rojo' ? '#dc2626' : '#ea580c', marginTop: 2 }}>→ {a.accion}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {alertas.length === 0 && (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: 12, marginTop: 4, textAlign: 'center' }}>
          <span style={{ fontSize: 16 }}>✅</span>
          <div style={{ fontSize: 12, color: '#16a34a', fontWeight: 700, marginTop: 4 }}>Sin alertas críticas — el condominio opera en condiciones normales</div>
        </div>
      )}
    </div>
  )
}
