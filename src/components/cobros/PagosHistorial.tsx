import { useState, useMemo } from 'react'
import type { Pago, Cliente, Registro, FormaPago } from '../../types'

interface Props {
  pagos: Pago[]
  clientes: Cliente[]
  registros: Registro[]
  moneda: string
  loading: boolean
  formasPagoLabels: Record<FormaPago, string>
}

export function PagosHistorial({ pagos, clientes, moneda, loading, formasPagoLabels }: Props) {
  const [busqueda, setBusqueda] = useState('')
  const [filtroMetodo, setFiltroMetodo] = useState<string>('todos')
  const [filtroFecha, setFiltroFecha] = useState<'hoy' | 'semana' | 'mes' | 'todos'>('todos')

  const hoy = new Date().toISOString().split('T')[0]
  const inicioSemana = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]

  const pagosFiltrados = useMemo(() => {
    return pagos.filter(p => {
      const cliente = clientes.find(c => c.id === p.cliente_id)
      const matchBusqueda = !busqueda || (
        (cliente?.nombre ?? '').toLowerCase().includes(busqueda.toLowerCase()) ||
        (p.numero_documento ?? '').toLowerCase().includes(busqueda.toLowerCase()) ||
        (p.referencia ?? '').toLowerCase().includes(busqueda.toLowerCase())
      )
      const matchMetodo = filtroMetodo === 'todos' || p.metodo === filtroMetodo
      const fechaPago = p.created_at?.split('T')[0] ?? ''
      const matchFecha =
        filtroFecha === 'todos' ? true :
        filtroFecha === 'hoy' ? fechaPago === hoy :
        filtroFecha === 'semana' ? fechaPago >= inicioSemana :
        fechaPago >= inicioMes
      return matchBusqueda && matchMetodo && matchFecha
    })
  }, [pagos, clientes, busqueda, filtroMetodo, filtroFecha, hoy, inicioSemana, inicioMes])

  const totalPagos = pagosFiltrados.reduce((acc, p) => acc + p.monto, 0)

  const METODO_COLOR: Record<string, { bg: string; color: string }> = {
    efectivo:       { bg: '#dcfce7', color: '#15803d' },
    transferencia:  { bg: '#D9E2DC', color: '#102622' },
    deposito:       { bg: '#D9E2DC', color: '#102622' },
    tarjeta_credito:{ bg: '#F4EBE3', color: '#9C5733' },
    tarjeta_debito: { bg: '#f5d0fe', color: '#a21caf' },
    cheque:         { bg: '#fef9c3', color: '#854d0e' },
    convenio_pago:  { bg: '#fce7f3', color: '#be185d' },
    otro:           { bg: '#EAE6D8', color: '#3E5A4C' },
  }

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: '#7E9389' }}>Cargando pagos...</div>
  }

  return (
    <div>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px', alignItems: 'center' }}>
        <input
          type="text" placeholder="Buscar por cliente, N° doc, referencia..."
          value={busqueda} onChange={e => setBusqueda(e.target.value)}
          style={{ flex: 1, minWidth: '220px', padding: '10px 14px', borderRadius: '8px', border: '1.5px solid #E1DDD0', fontSize: '14px', fontFamily: 'inherit' }}
        />
        <select value={filtroMetodo} onChange={e => setFiltroMetodo(e.target.value)}
          style={{ padding: '10px 14px', borderRadius: '8px', border: '1.5px solid #E1DDD0', fontSize: '14px', fontFamily: 'inherit', background: 'white' }}>
          <option value="todos">Todas las formas</option>
          {(Object.entries(formasPagoLabels) as [FormaPago, string][]).map(([val, lbl]) => (
            <option key={val} value={val}>{lbl}</option>
          ))}
        </select>
        <select value={filtroFecha} onChange={e => setFiltroFecha(e.target.value as any)}
          style={{ padding: '10px 14px', borderRadius: '8px', border: '1.5px solid #E1DDD0', fontSize: '14px', fontFamily: 'inherit', background: 'white' }}>
          <option value="todos">Todas las fechas</option>
          <option value="hoy">Hoy</option>
          <option value="semana">Últimos 7 días</option>
          <option value="mes">Este mes</option>
        </select>
      </div>

      {/* Resumen */}
      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '14px 18px', marginBottom: '20px', display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '14px', color: '#15803d', fontWeight: 600 }}>
          {pagosFiltrados.length} pago{pagosFiltrados.length !== 1 ? 's' : ''}
        </span>
        <span style={{ fontSize: '18px', fontWeight: 700, color: '#15803d' }}>
          Total: {moneda} {totalPagos.toFixed(2)}
        </span>
      </div>

      {pagosFiltrados.length === 0 ? (
        <div style={{ padding: '48px', textAlign: 'center', color: '#7E9389', background: 'white', borderRadius: '12px' }}>
          No hay pagos registrados
        </div>
      ) : (
        <div style={{ background: 'white', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.07)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead style={{ background: '#FAF7EF', borderBottom: '2px solid #E1DDD0' }}>
                <tr>
                  {['Fecha','Cliente','Monto','Forma de Pago','N° Documento','Referencia / Banco','Notas'].map(h => (
                    <th scope="col" key={h} style={{ padding: '14px 16px', textAlign: 'left', fontWeight: 700, color: '#3E5A4C', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagosFiltrados.map(p => {
                  const cliente = clientes.find(c => c.id === p.cliente_id)
                  const mc = METODO_COLOR[p.metodo] ?? METODO_COLOR.otro
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid #EAE6D8' }}
                      onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = '#FAF7EF'}
                      onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'}>
                      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap', color: '#3E5A4C' }}>
                        {new Date(p.created_at).toLocaleDateString('es-GT')}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: 600, color: '#15291F' }}>{cliente?.nombre ?? '—'}</div>
                        <div style={{ fontSize: '12px', color: '#7E9389' }}>{cliente?.codigo}</div>
                      </td>
                      <td style={{ padding: '14px 16px', fontWeight: 700, color: '#10b981', whiteSpace: 'nowrap' }}>
                        {moneda} {p.monto.toFixed(2)}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 600, background: mc.bg, color: mc.color, whiteSpace: 'nowrap' }}>
                          {formasPagoLabels[p.metodo] ?? p.metodo}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', fontFamily: 'monospace', fontSize: '13px', color: '#15291F' }}>
                        {p.numero_documento ?? <span style={{ color: '#C7C2B0' }}>—</span>}
                      </td>
                      <td style={{ padding: '14px 16px', color: '#3E5A4C', fontSize: '13px' }}>
                        {p.referencia ?? <span style={{ color: '#C7C2B0' }}>—</span>}
                      </td>
                      <td style={{ padding: '14px 16px', color: '#7E9389', fontSize: '13px', maxWidth: '200px' }}>
                        {p.notas ?? <span style={{ color: '#C7C2B0' }}>—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
