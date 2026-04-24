import { useState, useMemo } from 'react'
import Swal from 'sweetalert2'
import type { Registro, Cliente, UserRole, Unidad, Proyecto, Contador } from '../../types'
import { supabase } from '../../lib/supabase'
import { calcularTotalPagar } from '../../lib/business'
import { exportarPDFGlobal } from '../../lib/pdf'
import { APP_CONFIG } from '../../lib/config'

interface Props {
  registros: Registro[]
  clientes: Cliente[]
  unidades?: Unidad[]
  proyectos?: Proyecto[]
  contadores?: Contador[]
  userRole: UserRole
  moneda?: string
  onEstadoUpdated: (id: string, estado: Registro['estado']) => void
  canEdit?: boolean
  canChangeStatus?: boolean
}

export function HistorialSection({
  registros,
  clientes,
  unidades = [],
  proyectos = [],
  contadores = [],
  userRole,
  moneda = 'Q',
  onEstadoUpdated,
  canEdit: canEditProp = true,
  canChangeStatus: canChangeStatusProp = true,
}: Props) {
  const [filtroTexto, setFiltroTexto] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroProyecto, setFiltroProyecto] = useState('')
  const [filtroUnidad, setFiltroUnidad] = useState('')
  const [filtroTipoAgua, setFiltroTipoAgua] = useState('')
  const [filtroFechaInicio, setFiltroFechaInicio] = useState('')
  const [filtroFechaFin, setFiltroFechaFin] = useState('')
  const [editModal, setEditModal] = useState<{ registroId: string; estado: Registro['estado'] } | null>(null)
  const [savingEstado, setSavingEstado] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 20

  const canEdit = canEditProp && canChangeStatusProp && userRole !== 'viewer'

  // Filtrado avanzado
  const filtrados = useMemo(() => {
    return registros
      .filter(r => {
        // Texto
        const matchTxt = (r.cliente_nombre ?? '').toLowerCase().includes(filtroTexto.toLowerCase())

        // Estado
        const matchEst = filtroEstado ? r.estado === filtroEstado : true

        // Fecha
        const fecha = new Date(r.fecha)
        const matchFechaInicio = filtroFechaInicio ? fecha >= new Date(filtroFechaInicio) : true
        const matchFechaFin = filtroFechaFin ? fecha <= new Date(filtroFechaFin + 'T23:59:59') : true

        // Proyecto (si el registro tiene project_id)
        const matchProyecto = filtroProyecto ? (r as any).project_id === filtroProyecto : true

        // Unidad — registros link via contador_id → contador.unidad_id
        const matchUnidad = filtroUnidad
          ? contadores.some(c => c.unidad_id === filtroUnidad && c.id === r.contador_id)
          : true

        // Tipo de agua — registros link via contador_id → contador.tipo_agua
        const matchTipoAgua = filtroTipoAgua
          ? contadores.some(c => c.tipo_agua === filtroTipoAgua && c.id === r.contador_id)
          : true

        return matchTxt && matchEst && matchFechaInicio && matchFechaFin && matchProyecto && matchUnidad && matchTipoAgua
      })
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
  }, [registros, filtroTexto, filtroEstado, filtroFechaInicio, filtroFechaFin, filtroProyecto, filtroUnidad, filtroTipoAgua, contadores])

  // Paginación
  const totalPages = Math.ceil(filtrados.length / itemsPerPage)
  const paginados = filtrados.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)

  // Estadísticas
  const stats = useMemo(() => {
    const total = filtrados.reduce((sum, r) => sum + (getTotal(r) || 0), 0)
    const pagado = filtrados
      .filter(r => r.estado === 'pagado')
      .reduce((sum, r) => sum + (getTotal(r) || 0), 0)
    const pendiente = filtrados
      .filter(r => r.estado === 'pendiente')
      .reduce((sum, r) => sum + (getTotal(r) || 0), 0)
    const mora = filtrados.filter(r => r.estado === 'mora').reduce((sum, r) => sum + (getTotal(r) || 0), 0)

    return {
      totalRegistros: filtrados.length,
      totalMonto: total,
      pagado,
      pendiente,
      mora,
      countPendiente: filtrados.filter(r => r.estado === 'pendiente').length,
      countMora: filtrados.filter(r => r.estado === 'mora').length,
    }
  }, [filtrados])

  function getTotal(r: Registro): number {
    return r.monto_calculado ?? calcularTotalPagar(r.consumo, r.tarifa_aplicada, r.canon_aplicado ?? 20).total
  }

  function enviarWhatsApp(registro: Registro) {
    const cliente = clientes.find(c => c.id === registro.cliente_id)
    const rawTel = cliente?.whatsapp ?? cliente?.telefono ?? ''
    if (!rawTel) {
      Swal.fire('Sin Teléfono', 'Este cliente no tiene teléfono.', 'warning')
      return
    }
    let telefono = rawTel.trim().replace(/[\s\-\.\(\)]/g, '')
    if (telefono.startsWith('+')) telefono = telefono.slice(1)
    else {
      telefono = telefono.replace(/\D/g, '')
      if (telefono.length === 8) telefono = APP_CONFIG.COUNTRY_CODE + telefono
    }
    const total = getTotal(registro)
    const periodoStr = registro.fecha_lectura_anterior
      ? `\n📆 Período: ${new Date(registro.fecha_lectura_anterior).toLocaleDateString()} al ${new Date(registro.fecha).toLocaleDateString()} (${registro.dias_servicio ?? '—'} días)`
      : ''
    const msg = `Hola ${registro.cliente_nombre}, su recibo de agua potable:\n📅 Fecha: ${new Date(registro.fecha).toLocaleDateString()}${periodoStr}\n💧 Lectura Actual: ${registro.lectura_actual}\n📊 Consumo: ${registro.consumo.toFixed(2)} m³\n💰 Total a Pagar: ${moneda}${total.toFixed(2)}\nℹ️ Estado: ${registro.estado.toUpperCase()}\n\nGracias por su pago puntual.`
    window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  async function updateEstado() {
    if (!editModal) return
    setSavingEstado(true)
    const { error } = await supabase
      .from('registros')
      .update({ estado: editModal.estado, updated_at: new Date().toISOString() })
      .eq('id', editModal.registroId)

    if (!error) {
      onEstadoUpdated(editModal.registroId, editModal.estado)
      setEditModal(null)
      Swal.fire({ icon: 'success', title: 'Estado actualizado', timer: 1500, showConfirmButton: false })
    } else {
      Swal.fire('Error', 'No se pudo actualizar el estado', 'error')
    }
    setSavingEstado(false)
  }

  const pillStyle = (estado: string): React.CSSProperties => {
    const colors: Record<string, { bg: string; color: string }> = {
      pendiente: { bg: '#fef3c7', color: '#92400e' },
      pagado: { bg: '#d1fae5', color: '#065f46' },
      mora: { bg: '#fee2e2', color: '#991b1b' },
    }
    return { padding: '6px 14px', borderRadius: '12px', fontSize: '12px', fontWeight: 600, ...colors[estado] }
  }

  const statCard = (label: string, value: string | number, color: string, icon: string) => (
    <div
      style={{
        flex: 1,
        minWidth: '200px',
        padding: '16px',
        background: `linear-gradient(135deg, ${color}20 0%, ${color}10 100%)`,
        borderLeft: `4px solid ${color}`,
        borderRadius: '12px',
        border: `1px solid ${color}40`,
      }}
    >
      <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, marginBottom: '8px' }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: '24px', fontWeight: 700, color }}>
        {typeof value === 'number' ? `${moneda}${value.toFixed(2)}` : value}
      </div>
    </div>
  )

  return (
    <div style={{ background: 'white', borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingBottom: '12px', borderBottom: '2px solid #e2e8f0' }}>
        <span style={{ fontSize: '20px', fontWeight: 700 }}>📊 Historial de Lecturas</span>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => setShowFilters(!showFilters)}
            style={{
              padding: '10px 16px',
              background: showFilters ? '#0ea5e9' : '#f1f5f9',
              color: showFilters ? 'white' : '#475569',
              border: 'none',
              borderRadius: '10px',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            ⚙️ Filtros
          </button>
          <div style={{ display: 'flex', gap: '5px', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '4px' }}>
            <button
              onClick={() => setViewMode('table')}
              style={{
                padding: '8px 12px',
                background: viewMode === 'table' ? '#0ea5e9' : 'transparent',
                color: viewMode === 'table' ? 'white' : '#64748b',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              📋
            </button>
            <button
              onClick={() => setViewMode('cards')}
              style={{
                padding: '8px 12px',
                background: viewMode === 'cards' ? '#0ea5e9' : 'transparent',
                color: viewMode === 'cards' ? 'white' : '#64748b',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              🎴
            </button>
          </div>
          <button
            onClick={() => exportarPDFGlobal(filtrados)}
            style={{ padding: '10px 20px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '14px' }}
          >
            📄 PDF
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {statCard('Total Registros', String(stats.totalRegistros), '#0ea5e9', '📝')}
        {statCard('Total Monto', stats.totalMonto, '#8b5cf6', '💰')}
        {statCard('Pagado', stats.pagado, '#10b981', '✓')}
        {statCard('Pendiente', stats.pendiente, '#f59e0b', `⏳ (${stats.countPendiente})`)}
        {statCard('En Mora', stats.mora, '#ef4444', `⚠️ (${stats.countMora})`)}
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div style={{ background: '#f8fafc', padding: '16px', marginBottom: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          <input
            type="text"
            placeholder="🔍 Buscar cliente..."
            value={filtroTexto}
            onChange={e => { setFiltroTexto(e.target.value); setCurrentPage(1) }}
            style={{ padding: '10px 12px', border: '1px solid #cbd5e0', borderRadius: '8px', fontSize: '14px' }}
          />
          <select
            value={filtroEstado}
            onChange={e => { setFiltroEstado(e.target.value); setCurrentPage(1) }}
            style={{ padding: '10px 12px', border: '1px solid #cbd5e0', borderRadius: '8px', fontSize: '14px' }}
          >
            <option value="">Todos los Estados</option>
            <option value="pendiente">⏳ Pendiente</option>
            <option value="pagado">✓ Pagado</option>
            <option value="mora">⚠️ Mora</option>
          </select>
          {proyectos.length > 1 && (
            <select
              value={filtroProyecto}
              onChange={e => { setFiltroProyecto(e.target.value); setCurrentPage(1) }}
              style={{ padding: '10px 12px', border: '1px solid #cbd5e0', borderRadius: '8px', fontSize: '14px' }}
            >
              <option value="">Todos los Proyectos</option>
              {proyectos.map(p => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          )}
          {unidades.length > 0 && (
            <select
              value={filtroUnidad}
              onChange={e => { setFiltroUnidad(e.target.value); setCurrentPage(1) }}
              style={{ padding: '10px 12px', border: '1px solid #cbd5e0', borderRadius: '8px', fontSize: '14px' }}
            >
              <option value="">Todas las Unidades</option>
              {unidades.map(u => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          )}
          {(() => {
            const tiposDisponibles = [...new Set(contadores.map(c => c.tipo_agua).filter(Boolean))]
            if (tiposDisponibles.length < 2) return null
            const TIPO_LABELS: Record<string, string> = {
              potable: 'Agua Potable', rehuso: 'Agua de Rehúso', piscina: 'Piscina',
              desalinada: 'Desalinada', riego: 'Riego', jacuzzi: 'Jacuzzi',
              consumo_humano: 'Consumo Humano', desmineralizada: 'Desmineralizada',
              residuales_tratadas: 'Residuales Tratadas',
            }
            return (
              <select
                value={filtroTipoAgua}
                onChange={e => { setFiltroTipoAgua(e.target.value); setCurrentPage(1) }}
                style={{ padding: '10px 12px', border: '1px solid #cbd5e0', borderRadius: '8px', fontSize: '14px' }}
              >
                <option value="">Todos los Tipos de Agua</option>
                {tiposDisponibles.map(tipo => (
                  <option key={tipo} value={tipo}>{TIPO_LABELS[tipo] ?? tipo}</option>
                ))}
              </select>
            )
          })()}
          <div>
            <input
              type="date"
              value={filtroFechaInicio}
              onChange={e => { setFiltroFechaInicio(e.target.value); setCurrentPage(1) }}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #cbd5e0', borderRadius: '8px', fontSize: '14px' }}
            />
            <small style={{ color: '#64748b', marginTop: '4px', display: 'block' }}>Desde</small>
          </div>
          <div>
            <input
              type="date"
              value={filtroFechaFin}
              onChange={e => { setFiltroFechaFin(e.target.value); setCurrentPage(1) }}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #cbd5e0', borderRadius: '8px', fontSize: '14px' }}
            />
            <small style={{ color: '#64748b', marginTop: '4px', display: 'block' }}>Hasta</small>
          </div>
          <button
            onClick={() => {
              setFiltroTexto('')
              setFiltroEstado('')
              setFiltroProyecto('')
              setFiltroUnidad('')
              setFiltroTipoAgua('')
              setFiltroFechaInicio('')
              setFiltroFechaFin('')
              setCurrentPage(1)
            }}
            style={{ padding: '10px 12px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '14px' }}
          >
            🔄 Limpiar Filtros
          </button>
        </div>
      )}

      {/* View Mode: Table */}
      {viewMode === 'table' && (
        <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead style={{ background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)', color: 'white' }}>
              <tr>
                {['Fecha', 'Cliente', 'Lect. Ant.', 'Lect. Act.', 'Consumo (m³)', `Total (${moneda})`, 'Estado', 'Acciones'].map(h => (
                  <th scope="col" key={h} style={{ padding: '14px 12px', textAlign: 'left', fontWeight: 600 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginados.map(r => {
                const total = getTotal(r)
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #e2e8f0', transition: 'background 0.2s' }} onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')} onMouseLeave={e => (e.currentTarget.style.background = 'white')}>
                    <td style={{ padding: '14px 12px', fontWeight: 500 }}>
                      📅 {new Date(r.fecha).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '14px 12px' }}>{r.cliente_nombre}</td>
                    <td style={{ padding: '14px 12px', color: '#64748b' }}>{r.lectura_anterior}</td>
                    <td style={{ padding: '14px 12px', color: '#0ea5e9', fontWeight: 600 }}>{r.lectura_actual}</td>
                    <td style={{ padding: '14px 12px', fontWeight: 600 }}>💧 {r.consumo.toFixed(2)}</td>
                    <td style={{ padding: '14px 12px', fontWeight: 700, color: '#0ea5e9' }}>
                      {moneda}
                      {total.toFixed(2)}
                    </td>
                    <td style={{ padding: '14px 12px' }}>
                      <span style={pillStyle(r.estado)}>
                        {r.estado === 'pagado' && '✓'}
                        {r.estado === 'pendiente' && '⏳'}
                        {r.estado === 'mora' && '⚠️'} {r.estado}
                      </span>
                    </td>
                    <td style={{ padding: '14px 12px' }}>
                      <div style={{ display: 'flex', gap: '5px' }}>
                        {canEdit && (
                          <button
                            onClick={() => setEditModal({ registroId: r.id, estado: r.estado })}
                            aria-label="Editar estado"
                            style={{
                              padding: '6px 10px',
                              background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              cursor: 'pointer',
                              fontSize: '12px',
                              fontWeight: 600,
                            }}
                          >
                            ✏️ Editar
                          </button>
                        )}
                        <button
                          onClick={() => enviarWhatsApp(r)}
                          aria-label="Enviar por WhatsApp"
                          style={{
                            padding: '6px 10px',
                            background: '#25D366',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: 600,
                          }}
                        >
                          💬 WhatsApp
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {paginados.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                    <div style={{ fontSize: '48px', marginBottom: '10px' }}>📭</div>
                    <div>Sin registros</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* View Mode: Cards */}
      {viewMode === 'cards' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px', marginBottom: '20px' }}>
          {paginados.map(r => {
            const total = getTotal(r)
            return (
              <div
                key={r.id}
                style={{
                  background: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '16px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                  transition: 'all 0.2s',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 8px 16px rgba(0,0,0,0.1)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.05)')}
              >
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#1e293b' }}>{r.cliente_nombre}</div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>📅 {new Date(r.fecha).toLocaleDateString()}</div>
                </div>
                <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', marginBottom: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                  <div>
                    <span style={{ color: '#64748b' }}>Anterior</span>
                    <div style={{ fontWeight: 600, color: '#0ea5e9' }}>{r.lectura_anterior}</div>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>Actual</span>
                    <div style={{ fontWeight: 600, color: '#0ea5e9' }}>{r.lectura_actual}</div>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>Consumo</span>
                    <div style={{ fontWeight: 600, color: '#8b5cf6' }}>💧 {r.consumo.toFixed(2)} m³</div>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>Total</span>
                    <div style={{ fontWeight: 700, color: '#0ea5e9' }}>
                      {moneda}
                      {total.toFixed(2)}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={pillStyle(r.estado)}>
                    {r.estado === 'pagado' && '✓'}
                    {r.estado === 'pendiente' && '⏳'}
                    {r.estado === 'mora' && '⚠️'} {r.estado}
                  </span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {canEdit && (
                      <button
                        onClick={() => setEditModal({ registroId: r.id, estado: r.estado })}
                        style={{ padding: '6px 10px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}
                      >
                        ✏️
                      </button>
                    )}
                    <button
                      onClick={() => enviarWhatsApp(r)}
                      style={{ padding: '6px 10px', background: '#25D366', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}
                    >
                      💬
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
          {paginados.length === 0 && (
            <div style={{ gridColumn: '1 / -1', padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
              📭 Sin registros
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (() => {
        const btnStyle = (active: boolean, disabled = false): React.CSSProperties => ({
          minWidth: '36px', height: '36px', padding: '0 10px',
          background: active ? '#0ea5e9' : disabled ? '#f1f5f9' : '#f8fafc',
          color: active ? 'white' : disabled ? '#cbd5e0' : '#475569',
          border: '1px solid', borderColor: active ? '#0ea5e9' : '#e2e8f0',
          borderRadius: '8px', fontSize: '13px', fontWeight: active ? 700 : 400,
          cursor: disabled ? 'not-allowed' : 'pointer', transition: 'all 0.12s',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        })
        // Build visible page tokens: numbers + '…' separators
        const pages: (number | '…')[] = []
        const delta = 2 // pages around current
        const add = (n: number) => { if (!pages.includes(n)) pages.push(n) }
        add(1)
        for (let i = Math.max(2, currentPage - delta); i <= Math.min(totalPages - 1, currentPage + delta); i++) add(i)
        if (totalPages > 1) add(totalPages)
        const withEllipsis: (number | '…')[] = []
        pages.forEach((p, idx) => {
          if (idx > 0) {
            const prev = pages[idx - 1] as number
            if ((p as number) - prev > 1) withEllipsis.push('…')
          }
          withEllipsis.push(p)
        })
        return (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} style={btnStyle(false, currentPage === 1)}>«</button>
            <button onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1} style={btnStyle(false, currentPage === 1)}>‹</button>
            {withEllipsis.map((p, idx) =>
              p === '…'
                ? <span key={`e${idx}`} style={{ padding: '0 4px', color: '#94a3b8', fontSize: '13px', userSelect: 'none' }}>…</span>
                : <button key={p} onClick={() => setCurrentPage(p as number)} style={btnStyle(currentPage === p)}>{p}</button>
            )}
            <button onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages} style={btnStyle(false, currentPage === totalPages)}>›</button>
            <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} style={btnStyle(false, currentPage === totalPages)}>»</button>
            <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '6px' }}>Pág. {currentPage} de {totalPages}</span>
          </div>
        )
      })()}

      {/* Edit Status Modal */}
      {editModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(0,0,0,0.5)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(4px)',
          }}
          onClick={e => e.target === e.currentTarget && setEditModal(null)}
        >
          <div style={{ background: 'white', padding: '32px', borderRadius: '16px', width: '90%', maxWidth: '480px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0 }}>📝 Modificar Estado de Pago</h3>
              <button onClick={() => setEditModal(null)} aria-label="Cerrar modal" style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer' }}>
                ×
              </button>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '8px' }}>Nuevo Estado</label>
              <select
                value={editModal.estado}
                onChange={e => setEditModal(prev => (prev ? { ...prev, estado: e.target.value as Registro['estado'] } : null))}
                style={{ width: '100%', padding: '12px', border: '2px solid #e2e8f0', borderRadius: '10px', fontSize: '15px' }}
              >
                <option value="pendiente">⏳ Pendiente</option>
                <option value="pagado">✓ Pagado</option>
                <option value="mora">⚠️ Mora</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={updateEstado}
                disabled={savingEstado}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  fontWeight: 600,
                  cursor: savingEstado ? 'not-allowed' : 'pointer',
                  opacity: savingEstado ? 0.6 : 1,
                }}
              >
                {savingEstado ? '⏳ Guardando...' : '✓ Actualizar'}
              </button>
              <button
                onClick={() => setEditModal(null)}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: '#f1f5f9',
                  color: '#475569',
                  border: 'none',
                  borderRadius: '10px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ✕ Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
