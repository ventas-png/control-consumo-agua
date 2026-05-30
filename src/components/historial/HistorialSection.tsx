import { useState, useMemo, type CSSProperties } from 'react'
import { confirm, notify } from '../shared/Dialog'
import type { Registro, Cliente, UserRole, Unidad, Proyecto, Contador } from '../../types'
import { supabase } from '../../lib/supabase'
import { calcularTotalPagar } from '../../lib/business'
import { APP_CONFIG } from '../../lib/config'
import { DataTable, type DataTableColumn } from '../shared'
import { formatDate, formatCurrency, formatNumber } from '../../lib/format'

interface Props {
  registros: Registro[]
  clientes: Cliente[]
  unidades?: Unidad[]
  proyectos?: Proyecto[]
  contadores?: Contador[]
  userRole: UserRole
  moneda?: string
  onEstadoUpdated: (id: string, estado: Registro['estado']) => void
  onRegistroDeleted?: (id: string) => void
  canEdit?: boolean
  canChangeStatus?: boolean
}

const ESTADO_PILL: Record<string, { bg: string; color: string; icon: string }> = {
  pendiente: { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', icon: '⏳' },
  pagado:    { bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)', icon: '✓' },
  mora:      { bg: 'var(--at-danger-tint)', color: 'var(--at-danger-strong)', icon: '⚠️' },
}

const TIPO_AGUA_LABELS: Record<string, string> = {
  potable: 'Agua Potable', rehuso: 'Agua de Rehúso', piscina: 'Piscina',
  desalinada: 'Desalinada', riego: 'Riego', jacuzzi: 'Jacuzzi',
  consumo_humano: 'Consumo Humano', desmineralizada: 'Desmineralizada',
  residuales_tratadas: 'Residuales Tratadas',
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
  onRegistroDeleted,
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

  // Index contadores por id para evitar buscar el unidad_id / tipo_agua en
  // cada iteración del filter.
  const contadoresById = useMemo(
    () => new Map(contadores.map(c => [c.id, c])),
    [contadores]
  )

  const filtrados = useMemo(() => {
    const needle = filtroTexto.toLowerCase().trim()
    return registros
      .filter(r => {
        const matchTxt = !needle || (r.cliente_nombre ?? '').toLowerCase().includes(needle)
        const matchEst = !filtroEstado || r.estado === filtroEstado
        const fecha = new Date(r.fecha)
        const matchFechaInicio = !filtroFechaInicio || fecha >= new Date(filtroFechaInicio)
        const matchFechaFin = !filtroFechaFin || fecha <= new Date(filtroFechaFin + 'T23:59:59')
        const matchProyecto = !filtroProyecto || (r as Registro & { project_id?: string }).project_id === filtroProyecto
        const contador = r.contador_id ? contadoresById.get(r.contador_id) : undefined
        const matchUnidad = !filtroUnidad || contador?.unidad_id === filtroUnidad
        const matchTipoAgua = !filtroTipoAgua || contador?.tipo_agua === filtroTipoAgua
        return matchTxt && matchEst && matchFechaInicio && matchFechaFin && matchProyecto && matchUnidad && matchTipoAgua
      })
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
  }, [registros, filtroTexto, filtroEstado, filtroFechaInicio, filtroFechaFin, filtroProyecto, filtroUnidad, filtroTipoAgua, contadoresById])

  const totalPages = Math.max(1, Math.ceil(filtrados.length / itemsPerPage))
  const paginados = useMemo(
    () => filtrados.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
    [filtrados, currentPage]
  )

  function getTotal(r: Registro): number {
    return r.monto_calculado ?? calcularTotalPagar(r.consumo, r.tarifa_aplicada, r.canon_aplicado ?? 20).total
  }

  const stats = useMemo(() => {
    let totalMonto = 0, totalConsumo = 0, pagado = 0, pendiente = 0, mora = 0
    let countPendiente = 0, countMora = 0
    for (const r of filtrados) {
      const t = getTotal(r)
      totalMonto += t
      totalConsumo += r.consumo || 0
      if (r.estado === 'pagado') pagado += t
      else if (r.estado === 'pendiente') { pendiente += t; countPendiente++ }
      else if (r.estado === 'mora') { mora += t; countMora++ }
    }
    return {
      totalRegistros: filtrados.length,
      totalMonto, totalConsumo, pagado, pendiente, mora, countPendiente, countMora,
    }
  }, [filtrados])

  function enviarWhatsApp(registro: Registro) {
    const cliente = clientes.find(c => c.id === registro.cliente_id)
    const rawTel = cliente?.whatsapp ?? cliente?.telefono ?? ''
    if (!rawTel) {
      notify({ variant: 'warning', title: 'Sin Teléfono', text: 'Este cliente no tiene teléfono.' })
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
      ? `\n📆 Período: ${formatDate(registro.fecha_lectura_anterior)} al ${formatDate(registro.fecha)} (${registro.dias_servicio ?? '—'} días)`
      : ''
    const msg = `Hola ${registro.cliente_nombre}, su recibo de agua potable:\n📅 Fecha: ${formatDate(registro.fecha)}${periodoStr}\n💧 Lectura Actual: ${registro.lectura_actual}\n📊 Consumo: ${formatNumber(registro.consumo)} m³\n💰 Total a Pagar: ${formatCurrency(total, moneda)}\nℹ️ Estado: ${registro.estado.toUpperCase()}\n\nGracias por su pago puntual.`
    window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  async function updateEstado() {
    if (!editModal) return
    setSavingEstado(true)
    const { error } = await supabase
      .from('registros')
      .update({ estado: editModal.estado })
      .eq('id', editModal.registroId)
    if (!error) {
      onEstadoUpdated(editModal.registroId, editModal.estado)
      setEditModal(null)
      notify({ variant: 'success', title: 'Estado actualizado', duration: 1500 })
    } else {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo actualizar el estado' })
    }
    setSavingEstado(false)
  }

  async function eliminarRegistro(registro: Registro) {
    const result = await confirm({
      icon: 'warning',
      title: '¿Eliminar lectura?',
      text: `Se eliminará la lectura de ${registro.cliente_nombre ?? 'este cliente'} del ${formatDate(registro.fecha)}. Esta acción no se puede deshacer.`,
      variant: 'danger',
      confirmText: '🗑️ Eliminar',
    })
    if (!result.isConfirmed) return
    const { error, count } = await supabase
      .from('registros')
      .delete({ count: 'exact' })
      .eq('id', registro.id)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo eliminar la lectura' })
      return
    }
    if (count === 0) {
      notify({ variant: 'warning', title: 'Sin permisos', text: 'No tienes permisos para eliminar esta lectura.' })
      return
    }
    onRegistroDeleted?.(registro.id)
    notify({ variant: 'success', title: 'Lectura eliminada', duration: 1500 })
  }

  function resetFiltros() {
    setFiltroTexto(''); setFiltroEstado(''); setFiltroProyecto('')
    setFiltroUnidad(''); setFiltroTipoAgua('')
    setFiltroFechaInicio(''); setFiltroFechaFin('')
    setCurrentPage(1)
  }

  // ── Tabla via DataTable ─────────────────────────────────────────────────
  const columns: DataTableColumn<Registro>[] = useMemo(() => [
    {
      key: 'fecha', header: 'Fecha', sortable: true,
      accessor: r => r.fecha,
      render: r => `📅 ${formatDate(r.fecha)}`,
    },
    {
      key: 'cliente', header: 'Cliente', sortable: true,
      accessor: r => r.cliente_nombre ?? '',
      render: r => r.cliente_nombre ?? '—',
    },
    {
      key: 'lectAnt', header: 'Lect. Ant.', align: 'right',
      accessor: r => r.lectura_anterior,
      render: r => <span style={{ color: 'var(--at-ink-3)' }}>{r.lectura_anterior}</span>,
    },
    {
      key: 'lectAct', header: 'Lect. Act.', align: 'right',
      accessor: r => r.lectura_actual,
      render: r => <span style={{ color: 'var(--at-primary)', fontWeight: 600 }}>{r.lectura_actual}</span>,
    },
    {
      key: 'consumo', header: 'Consumo (m³)', sortable: true, align: 'right',
      accessor: r => r.consumo,
      render: r => <span style={{ fontWeight: 600 }}>💧 {formatNumber(r.consumo)}</span>,
    },
    {
      key: 'total', header: `Total (${moneda})`, sortable: true, align: 'right',
      accessor: r => getTotal(r),
      render: r => <span style={{ fontWeight: 700, color: 'var(--at-primary)' }}>{formatCurrency(getTotal(r), moneda)}</span>,
    },
    {
      key: 'estado', header: 'Estado', sortable: true,
      accessor: r => r.estado,
      render: r => {
        const p = ESTADO_PILL[r.estado] ?? { bg: 'var(--at-chip)', color: 'var(--at-ink-2)', icon: '' }
        return (
          <span style={pillStyle(p)}>
            {p.icon} {r.estado}
          </span>
        )
      },
    },
    {
      key: 'acciones', header: 'Acciones',
      render: r => (
        <div style={{ display: 'flex', gap: 5 }}>
          {canEdit && (
            <button
              onClick={() => setEditModal({ registroId: r.id, estado: r.estado })}
              aria-label="Editar estado"
              style={btnEditStyle}
            >✏️ Editar</button>
          )}
          <button
            onClick={() => enviarWhatsApp(r)}
            aria-label="Enviar por WhatsApp"
            style={btnWaStyle}
          >💬 WhatsApp</button>
          {canEdit && onRegistroDeleted && (
            <button
              onClick={() => eliminarRegistro(r)}
              aria-label="Eliminar lectura"
              style={btnDeleteStyle}
            >🗑️ Eliminar</button>
          )}
        </div>
      ),
    },
  ], [moneda, canEdit, onRegistroDeleted])

  return (
    <div style={{ background: 'var(--at-surface)', borderRadius: 24, padding: 32, boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 12, borderBottom: '2px solid var(--at-line)' }}>
        <span style={{ fontSize: 20, fontWeight: 700 }}>📊 Historial de Lecturas</span>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => setShowFilters(s => !s)}
            style={{
              padding: '10px 16px',
              background: showFilters ? 'var(--at-primary)' : 'var(--at-chip)',
              color: showFilters ? 'white' : 'var(--at-ink-2)',
              border: 'none', borderRadius: 10, fontWeight: 600, cursor: 'pointer', fontSize: 14,
            }}
          >⚙️ Filtros</button>
          <div style={{ display: 'flex', gap: 5, border: '1px solid var(--at-line)', borderRadius: 8, padding: 4 }}>
            <button onClick={() => setViewMode('table')} style={viewBtnStyle(viewMode === 'table')}>📋</button>
            <button onClick={() => setViewMode('cards')} style={viewBtnStyle(viewMode === 'cards')}>🎴</button>
          </div>
          <button
            onClick={async () => {
              const { exportarPDFGlobal } = await import('../../lib/pdf')
              exportarPDFGlobal(filtrados)
            }}
            style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: 10, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}
          >📄 PDF</button>
        </div>
      </div>

      {/* Stats — derivados del filtered set */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <StatCard label="Total Registros" value={String(stats.totalRegistros)} color="var(--at-primary)" icon="📝" moneda={moneda} />
        <StatCard label="Total Consumo" value={`${formatNumber(stats.totalConsumo)} m³`} color="var(--at-accent-2)" icon="💧" moneda={moneda} />
        <StatCard label="Total Monto" value={stats.totalMonto} color="var(--at-accent)" icon="💰" moneda={moneda} />
        <StatCard label="Pagado" value={stats.pagado} color="var(--at-success)" icon="✓" moneda={moneda} />
        <StatCard label="Pendiente" value={stats.pendiente} color="var(--at-warning)" icon={`⏳ (${stats.countPendiente})`} moneda={moneda} />
        <StatCard label="En Mora" value={stats.mora} color="var(--at-danger)" icon={`⚠️ (${stats.countMora})`} moneda={moneda} />
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div style={{ background: 'var(--at-surface-2)', padding: 16, marginBottom: 20, borderRadius: 12, border: '1px solid var(--at-line)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <input
            type="text"
            placeholder="🔍 Buscar cliente..."
            value={filtroTexto}
            onChange={e => { setFiltroTexto(e.target.value); setCurrentPage(1) }}
            style={filterFieldStyle}
          />
          <select value={filtroEstado} onChange={e => { setFiltroEstado(e.target.value); setCurrentPage(1) }} style={filterFieldStyle}>
            <option value="">Todos los Estados</option>
            <option value="pendiente">⏳ Pendiente</option>
            <option value="pagado">✓ Pagado</option>
            <option value="mora">⚠️ Mora</option>
          </select>
          {proyectos.length > 1 && (
            <select value={filtroProyecto} onChange={e => { setFiltroProyecto(e.target.value); setCurrentPage(1) }} style={filterFieldStyle}>
              <option value="">Todos los Proyectos</option>
              {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          )}
          {unidades.length > 0 && (
            <select value={filtroUnidad} onChange={e => { setFiltroUnidad(e.target.value); setCurrentPage(1) }} style={filterFieldStyle}>
              <option value="">Todas las Unidades</option>
              {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          )}
          {(() => {
            const tipos = [...new Set(contadores.map(c => c.tipo_agua).filter(Boolean))]
            if (tipos.length < 2) return null
            return (
              <select value={filtroTipoAgua} onChange={e => { setFiltroTipoAgua(e.target.value); setCurrentPage(1) }} style={filterFieldStyle}>
                <option value="">Todos los Tipos de Agua</option>
                {tipos.map(tipo => <option key={tipo} value={tipo}>{TIPO_AGUA_LABELS[tipo] ?? tipo}</option>)}
              </select>
            )
          })()}
          <div>
            <input type="date" value={filtroFechaInicio} onChange={e => { setFiltroFechaInicio(e.target.value); setCurrentPage(1) }} style={{ ...filterFieldStyle, width: '100%' }} />
            <small style={{ color: 'var(--at-ink-3)', marginTop: 4, display: 'block' }}>Desde</small>
          </div>
          <div>
            <input type="date" value={filtroFechaFin} onChange={e => { setFiltroFechaFin(e.target.value); setCurrentPage(1) }} style={{ ...filterFieldStyle, width: '100%' }} />
            <small style={{ color: 'var(--at-ink-3)', marginTop: 4, display: 'block' }}>Hasta</small>
          </div>
          <button onClick={resetFiltros} style={{ padding: '10px 12px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
            🔄 Limpiar Filtros
          </button>
        </div>
      )}

      {/* View Mode: Table (vía DataTable, sin paginación interna) */}
      {viewMode === 'table' && (
        <div style={{ marginBottom: 20 }}>
          <DataTable<Registro>
            data={paginados}
            columns={columns}
            rowKey="id"
            pageSize={0}  // paginación la hacemos en el padre para que cards también use la misma
            emptyState={{ icon: '📭', title: 'Sin registros' }}
          />
        </div>
      )}

      {/* View Mode: Cards (custom — no es un patrón estándar de DataTable) */}
      {viewMode === 'cards' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16, marginBottom: 20 }}>
          {paginados.map(r => {
            const total = getTotal(r)
            const p = ESTADO_PILL[r.estado] ?? { bg: 'var(--at-chip)', color: 'var(--at-ink-2)', icon: '' }
            return (
              <div
                key={r.id}
                style={{
                  background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12,
                  padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                  transition: 'all 0.2s', cursor: 'pointer',
                }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 16px rgba(0,0,0,0.1)' }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.05)' }}
              >
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--at-ink)' }}>{r.cliente_nombre}</div>
                  <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 4 }}>📅 {formatDate(r.fecha)}</div>
                </div>
                <div style={{ background: 'var(--at-surface-2)', padding: 12, borderRadius: 8, marginBottom: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                  <div><span style={{ color: 'var(--at-ink-3)' }}>Anterior</span><div style={{ fontWeight: 600, color: 'var(--at-primary)' }}>{r.lectura_anterior}</div></div>
                  <div><span style={{ color: 'var(--at-ink-3)' }}>Actual</span><div style={{ fontWeight: 600, color: 'var(--at-primary)' }}>{r.lectura_actual}</div></div>
                  <div><span style={{ color: 'var(--at-ink-3)' }}>Consumo</span><div style={{ fontWeight: 600, color: 'var(--at-accent)' }}>💧 {formatNumber(r.consumo)} m³</div></div>
                  <div><span style={{ color: 'var(--at-ink-3)' }}>Total</span><div style={{ fontWeight: 700, color: 'var(--at-primary)' }}>{formatCurrency(total, moneda)}</div></div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={pillStyle(p)}>{p.icon} {r.estado}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {canEdit && (
                      <button onClick={() => setEditModal({ registroId: r.id, estado: r.estado })} aria-label="Editar estado" style={{ padding: '6px 10px', background: 'var(--at-warning)', color: 'var(--at-on-status)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>✏️</button>
                    )}
                    <button onClick={() => enviarWhatsApp(r)} aria-label="Enviar por WhatsApp" style={{ padding: '6px 10px', background: '#25D366', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>💬</button>
                    {canEdit && onRegistroDeleted && (
                      <button onClick={() => eliminarRegistro(r)} aria-label="Eliminar lectura" style={{ padding: '6px 10px', background: 'var(--at-danger)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>🗑️</button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          {paginados.length === 0 && (
            <div style={{ gridColumn: '1 / -1', padding: 40, textAlign: 'center', color: 'var(--at-ink-3)' }}>
              📭 Sin registros
            </div>
          )}
        </div>
      )}

      {/* Pagination compartida entre table y cards */}
      {totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onChange={setCurrentPage}
        />
      )}

      {/* Edit Status Modal */}
      {editModal && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            background: 'rgba(0,0,0,0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(4px)',
          }}
          onClick={e => e.target === e.currentTarget && setEditModal(null)}
        >
          <div style={{ background: 'var(--at-surface)', padding: 32, borderRadius: 16, width: '90%', maxWidth: 480 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>📝 Modificar Estado de Pago</h3>
              <button onClick={() => setEditModal(null)} aria-label="Cerrar modal" style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>Nuevo Estado</label>
              <select
                value={editModal.estado}
                onChange={e => setEditModal(prev => prev ? { ...prev, estado: e.target.value as Registro['estado'] } : null)}
                style={{ width: '100%', padding: 12, border: '2px solid var(--at-line)', borderRadius: 10, fontSize: 15 }}
              >
                <option value="pendiente">⏳ Pendiente</option>
                <option value="pagado">✓ Pagado</option>
                <option value="mora">⚠️ Mora</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={updateEstado}
                disabled={savingEstado}
                style={{
                  flex: 1, padding: 12,
                  background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)',
                  color: 'white', border: 'none', borderRadius: 10, fontWeight: 600,
                  cursor: savingEstado ? 'not-allowed' : 'pointer',
                  opacity: savingEstado ? 0.6 : 1,
                }}
              >
                {savingEstado ? '⏳ Guardando...' : '✓ Actualizar'}
              </button>
              <button
                onClick={() => setEditModal(null)}
                style={{ flex: 1, padding: 12, background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: 10, fontWeight: 600, cursor: 'pointer' }}
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

// ── Sub-componentes locales ───────────────────────────────────────────────

function StatCard({ label, value, color, icon, moneda }: {
  label: string; value: string | number; color: string; icon: string; moneda: string
}) {
  return (
    <div style={{
      flex: 1, minWidth: 200, padding: 16,
      background: `linear-gradient(135deg, ${color}20 0%, ${color}10 100%)`,
      borderLeft: `4px solid ${color}`,
      borderRadius: 12, border: `1px solid ${color}40`,
    }}>
      <div style={{ fontSize: 12, color: 'var(--at-ink-3)', fontWeight: 600, marginBottom: 8 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>
        {typeof value === 'number' ? formatCurrency(value, moneda) : value}
      </div>
    </div>
  )
}

function Pagination({ currentPage, totalPages, onChange }: {
  currentPage: number; totalPages: number; onChange: (page: number) => void
}) {
  const btnStyle = (active: boolean, disabled = false): CSSProperties => ({
    minWidth: 40, height: 40, padding: '0 10px',
    background: active ? 'var(--at-primary)' : disabled ? 'var(--at-chip)' : 'var(--at-surface-2)',
    color: active ? 'white' : disabled ? 'var(--at-line-strong)' : 'var(--at-ink-2)',
    border: '1px solid', borderColor: active ? 'var(--at-primary)' : 'var(--at-line)',
    borderRadius: 8, fontSize: 13, fontWeight: active ? 700 : 400,
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  })
  const pages: (number | '…')[] = []
  const delta = 2
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
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, marginBottom: 20, flexWrap: 'wrap' }}>
      <button onClick={() => onChange(1)} disabled={currentPage === 1} style={btnStyle(false, currentPage === 1)}>«</button>
      <button onClick={() => onChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1} style={btnStyle(false, currentPage === 1)}>‹</button>
      {withEllipsis.map((p, idx) =>
        p === '…'
          ? <span key={`e${idx}`} style={{ padding: '0 4px', color: 'var(--at-ink-3)', fontSize: 13 }}>…</span>
          : <button key={p} onClick={() => onChange(p as number)} style={btnStyle(currentPage === p)}>{p}</button>
      )}
      <button onClick={() => onChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages} style={btnStyle(false, currentPage === totalPages)}>›</button>
      <button onClick={() => onChange(totalPages)} disabled={currentPage === totalPages} style={btnStyle(false, currentPage === totalPages)}>»</button>
      <span style={{ fontSize: 12, color: 'var(--at-ink-3)', marginLeft: 6 }}>Pág. {currentPage} de {totalPages}</span>
    </div>
  )
}

// ── Styles compartidos ────────────────────────────────────────────────────

function pillStyle(p: { bg: string; color: string }): CSSProperties {
  return { padding: '6px 14px', borderRadius: 12, fontSize: 12, fontWeight: 600, ...p }
}

function viewBtnStyle(active: boolean): CSSProperties {
  return {
    padding: '8px 12px', background: active ? 'var(--at-primary)' : 'transparent',
    color: active ? 'white' : 'var(--at-ink-3)',
    border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12,
  }
}

const filterFieldStyle: CSSProperties = {
  padding: '10px 12px', border: '1px solid var(--at-line-strong)', borderRadius: 8, fontSize: 14,
}

const btnEditStyle: CSSProperties = {
  padding: '8px 12px', minHeight: 36,
  background: 'linear-gradient(135deg, var(--at-warning) 0%, var(--at-warning) 100%)',
  color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer',
  fontSize: 12, fontWeight: 600,
}

const btnWaStyle: CSSProperties = {
  padding: '8px 12px', minHeight: 36, background: '#25D366',
  color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer',
  fontSize: 12, fontWeight: 600,
}

const btnDeleteStyle: CSSProperties = {
  padding: '8px 12px', minHeight: 36, background: 'var(--at-danger)',
  color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer',
  fontSize: 12, fontWeight: 600,
}
