import { useState, useMemo, useCallback, type CSSProperties, type ReactNode } from 'react'
import { confirm, notify } from '../shared/Dialog'
import type { Registro, Cliente, UserRole, Unidad, Proyecto, Contador } from '../../types'
import { cambiarEstadoRegistro, deleteRegistro, type EstadoSeguimiento } from '../../domain/agua/mutations'
import { calcularTotalPagar } from '../../lib/business'
import { APP_CONFIG } from '../../lib/config'
import { DataTable, type DataTableColumn, Icon, PhotoLightbox } from '../shared'
import { UsuarioChip } from '../shared/UsuarioChip'
import { EditModal } from '../shared/EditModal'
import { Button } from '../shared/Button'
import { formatDate, formatCurrency, formatNumber } from '../../lib/format'
import {
  registroCoincide,
  numeroContadorDeRegistro,
  unidadesDelProyecto,
  type HistorialFiltros,
} from '../../lib/historialFiltros'
import { tint } from '../shared/statusTone'

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
  canDelete?: boolean
}

const ESTADO_PILL: Record<string, { bg: string; color: string; icon: string }> = {
  pendiente: { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', icon: '⏳' },
  pagado:    { bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)', icon: '✓' },
  mora:      { bg: 'var(--at-danger-tint)', color: 'var(--at-danger-strong)', icon: '⚠️' },
}

function pillDeEstado(estado: string) {
  return ESTADO_PILL[estado] ?? { bg: 'var(--at-chip)', color: 'var(--at-ink-2)', icon: '' }
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
  canDelete: canDeleteProp = true,
}: Props) {
  const [filtroTexto, setFiltroTexto] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroProyecto, setFiltroProyecto] = useState('')
  const [filtroUnidad, setFiltroUnidad] = useState('')
  const [filtroTipoAgua, setFiltroTipoAgua] = useState('')
  const [filtroFechaInicio, setFiltroFechaInicio] = useState('')
  const [filtroFechaFin, setFiltroFechaFin] = useState('')
  const [editModal, setEditModal] = useState<{ registroId: string; estado: EstadoSeguimiento } | null>(null)
  // Lectura cuya foto se está viendo en el lightbox (la foto se baja bajo demanda
  // por id; nunca viaja en el listado — ver domain/agua/queries.ts).
  const [photoModal, setPhotoModal] = useState<{ registroId: string; label: string } | null>(null)
  const [savingEstado, setSavingEstado] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table')
  const [currentPage, setCurrentPage] = useState(1)
  // Lectura abierta en la ventana de detalle. Por id y no la fila: tras cambiar
  // el estado, `registros` llega actualizado y la ventana muestra el dato nuevo;
  // si la lectura se elimina, la ventana se cierra sola.
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const itemsPerPage = 20

  const canEdit = canEditProp && canChangeStatusProp && userRole !== 'viewer'
  // Eliminar lecturas se controla con el permiso de eliminar (no el de editar).
  const canDelete = canDeleteProp && userRole !== 'viewer'

  // Index contadores por id para evitar buscar el unidad_id / tipo_agua en
  // cada iteración del filter.
  const contadoresById = useMemo(
    () => new Map(contadores.map(c => [c.id, c])),
    [contadores]
  )

  const filtrados = useMemo(() => {
    const filtros: HistorialFiltros = {
      texto: filtroTexto, estado: filtroEstado, proyecto: filtroProyecto,
      unidad: filtroUnidad, tipoAgua: filtroTipoAgua,
      fechaInicio: filtroFechaInicio, fechaFin: filtroFechaFin,
    }
    return registros
      .filter(r => registroCoincide(r, filtros, contadoresById))
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
  }, [registros, filtroTexto, filtroEstado, filtroFechaInicio, filtroFechaFin, filtroProyecto, filtroUnidad, filtroTipoAgua, contadoresById])

  // Unidades del dropdown limitadas al proyecto seleccionado (si hay uno), para
  // que el filtro de unidad no liste unidades de otros proyectos.
  const unidadesDisponibles = useMemo(
    () => unidadesDelProyecto(unidades, filtroProyecto),
    [unidades, filtroProyecto]
  )

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

  // useCallback: `columns` es un useMemo y necesita declarar estas dos como
  // dependencias reales. Como funciones sueltas se recreaban en cada render, así
  // que el memo se habría recalculado siempre — y sin declararlas se quedaba con
  // una closure vieja: `clientes` NO estaba en las deps de `columns`, de modo
  // que si el listado de clientes terminaba de cargar después del primer render,
  // el botón de WhatsApp seguía diciendo "este cliente no tiene teléfono".
  const enviarWhatsApp = useCallback((registro: Registro) => {
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
  }, [clientes, moneda])

  async function updateEstado() {
    if (!editModal) return
    setSavingEstado(true)
    const { error } = await cambiarEstadoRegistro(editModal.registroId, editModal.estado)
    if (!error) {
      onEstadoUpdated(editModal.registroId, editModal.estado)
      setEditModal(null)
      notify({ variant: 'success', title: 'Estado actualizado', duration: 1500 })
    } else {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo actualizar el estado' })
    }
    setSavingEstado(false)
  }

  // Mientras se guarda no se cierra: si falla, el error aparece con la ventana
  // todavía abierta y no queda la duda de si el cambio entró.
  function cerrarEditModal() {
    if (savingEstado) return
    setEditModal(null)
  }

  const eliminarRegistro = useCallback(async (registro: Registro) => {
    const result = await confirm({
      icon: 'warning',
      title: '¿Eliminar lectura?',
      text: `Se eliminará la lectura de ${registro.cliente_nombre ?? 'este cliente'} del ${formatDate(registro.fecha)}. Esta acción no se puede deshacer.`,
      variant: 'danger',
      confirmText: '🗑️ Eliminar',
    })
    if (!result.isConfirmed) return
    const { error, count } = await deleteRegistro(registro.id)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo eliminar la lectura' })
      return
    }
    if (count === 0) {
      notify({ variant: 'warning', title: 'Sin permisos', text: 'No tienes permisos para eliminar esta lectura.' })
      return
    }
    // Si se eliminó desde su ventana de detalle, la ventana ya no tiene qué mostrar.
    setDetalleId(prev => (prev === registro.id ? null : prev))
    onRegistroDeleted?.(registro.id)
    notify({ variant: 'success', title: 'Lectura eliminada', duration: 1500 })
  }, [onRegistroDeleted])

  function resetFiltros() {
    setFiltroTexto(''); setFiltroEstado(''); setFiltroProyecto('')
    setFiltroUnidad(''); setFiltroTipoAgua('')
    setFiltroFechaInicio(''); setFiltroFechaFin('')
    setCurrentPage(1)
  }

  // ── Tabla via DataTable ─────────────────────────────────────────────────
  // En el teléfono (≤480px) cada fila es una tarjeta con fecha, cliente,
  // consumo, total y estado; el resto (`hideOnMobile`) vive en la ventana de
  // detalle, incluidas las acciones.
  const columns: DataTableColumn<Registro>[] = useMemo(() => [
    {
      key: 'fecha', header: 'Fecha', sortable: true,
      accessor: r => r.fecha,
      render: r => `📅 ${formatDate(r.fecha)}`,
    },
    {
      // El nombre es el botón que abre el detalle: el clic en la fila
      // (onRowClick) no se alcanza con el teclado ni lo anuncia un lector.
      key: 'cliente', header: 'Cliente', sortable: true,
      accessor: r => r.cliente_nombre ?? '',
      render: r => (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setDetalleId(r.id) }}
          aria-label={`Ver detalles de la lectura de ${r.cliente_nombre ?? 'cliente sin nombre'} del ${formatDate(r.fecha)}`}
          style={rowMainBtnStyle}
        >
          {r.cliente_nombre ?? '—'}
          <span aria-hidden="true" style={{ color: 'var(--at-ink-3)', marginLeft: 6 }}>›</span>
        </button>
      ),
    },
    {
      key: 'contador', header: '# Contador', sortable: true, hideOnMobile: true,
      accessor: r => numeroContadorDeRegistro(r, contadoresById) ?? '',
      render: r => {
        const numero = numeroContadorDeRegistro(r, contadoresById)
        return numero
          ? <span style={{ color: 'var(--at-ink-2)', fontVariantNumeric: 'tabular-nums' }}>{numero}</span>
          : <span style={{ color: 'var(--at-ink-3)' }}>—</span>
      },
    },
    {
      key: 'lectAnt', header: 'Lect. Ant.', numeric: true, hideOnMobile: true,
      accessor: r => r.lectura_anterior,
      render: r => <span style={{ color: 'var(--at-ink-3)' }}>{r.lectura_anterior}</span>,
    },
    {
      key: 'lectAct', header: 'Lect. Act.', numeric: true, hideOnMobile: true,
      accessor: r => r.lectura_actual,
      render: r => <span style={{ color: 'var(--at-primary)', fontWeight: 600 }}>{r.lectura_actual}</span>,
    },
    {
      key: 'consumo', header: 'Consumo (m³)', sortable: true, numeric: true,
      accessor: r => r.consumo,
      render: r => <span style={{ fontWeight: 600 }}>{formatNumber(r.consumo)}</span>,
    },
    {
      key: 'total', header: `Total (${moneda})`, sortable: true, numeric: true,
      accessor: r => getTotal(r),
      render: r => <span style={{ fontWeight: 700, color: 'var(--at-primary)', whiteSpace: 'nowrap' }}>{formatCurrency(getTotal(r), moneda)}</span>,
    },
    {
      key: 'estado', header: 'Estado', sortable: true,
      accessor: r => r.estado,
      render: r => {
        const p = pillDeEstado(r.estado)
        return (
          <span style={pillStyle(p)}>
            {p.icon} {r.estado}
          </span>
        )
      },
    },
    {
      // Trazabilidad (20260731000000): quién capturó la lectura. Las lecturas
      // anteriores al sellado no tienen `creado_por` — de ahí `historico`, que
      // las muestra como "—" en vez de atribuirlas al "Sistema".
      key: 'capturo', header: 'Capturó', hideOnMobile: true,
      accessor: r => r.creado_por ?? '',
      render: r => <UsuarioChip userId={r.creado_por} historico />,
    },
    {
      key: 'acciones', header: 'Acciones', hideOnMobile: true,
      render: r => (
        // La fila entera abre el detalle; estos botones hacen otra cosa.
        <div style={{ display: 'flex', gap: 5 }} onClick={e => e.stopPropagation()}>
          {canEdit && (
            <button
              onClick={() => setEditModal({ registroId: r.id, estado: r.estado === 'mora' ? 'mora' : 'pendiente' })}
              aria-label="Editar estado"
              style={btnEditStyle}
            >✏️ Editar</button>
          )}
          <button
            onClick={() => setPhotoModal({ registroId: r.id, label: fotoLabel(r) })}
            aria-label="Ver imagen de la lectura"
            title="Ver imagen de la lectura"
            style={btnFotoStyle}
          >🖼️ Imagen</button>
          <button
            onClick={() => enviarWhatsApp(r)}
            aria-label="Enviar por WhatsApp"
            style={btnWaStyle}
          >💬 WhatsApp</button>
          {canDelete && onRegistroDeleted && (
            <button
              onClick={() => eliminarRegistro(r)}
              aria-label="Eliminar lectura"
              style={btnDeleteStyle}
            >🗑️ Eliminar</button>
          )}
        </div>
      ),
    },
  ], [moneda, canEdit, canDelete, onRegistroDeleted, contadoresById, enviarWhatsApp, eliminarRegistro])

  const detalle = detalleId ? registros.find(r => r.id === detalleId) ?? null : null
  const registroEnEdicion = editModal ? registros.find(r => r.id === editModal.registroId) ?? null : null

  return (
    // Padding y radio menores en el teléfono: con 32px fijos la tabla y los
    // KPIs perdían 64px de un ancho de ~350.
    <div style={{ background: 'var(--at-surface)', borderRadius: 'clamp(16px, 4vw, 24px)', padding: 'clamp(16px, 4vw, 32px)', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
      {/* Header: en el teléfono el título va en su propia línea y los botones
          en una fila que puede partirse (antes el título ocupaba tres líneas y
          el botón PDF quedaba cortado). */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 20, paddingBottom: 12, borderBottom: '2px solid var(--at-line)' }}>
        <span style={{ fontSize: 20, fontWeight: 700, flex: '1 1 240px', minWidth: 0 }}>📊 Historial de Lecturas</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            onClick={() => setShowFilters(s => !s)}
            aria-expanded={showFilters}
            style={{
              padding: '10px 16px',
              background: showFilters ? 'var(--at-primary)' : 'var(--at-chip)',
              color: showFilters ? 'white' : 'var(--at-ink-2)',
              border: 'none', borderRadius: 10, fontWeight: 600, cursor: 'pointer', fontSize: 14,
              whiteSpace: 'nowrap',
            }}
          >⚙️ Filtros</button>
          <div style={{ display: 'flex', gap: 5, border: '1px solid var(--at-line)', borderRadius: 8, padding: 4 }}>
            <button onClick={() => setViewMode('table')} aria-label="Vista de tabla" aria-pressed={viewMode === 'table'} title="Vista de tabla" style={viewBtnStyle(viewMode === 'table')}>📋</button>
            <button onClick={() => setViewMode('cards')} aria-label="Vista de tarjetas" aria-pressed={viewMode === 'cards'} title="Vista de tarjetas" style={viewBtnStyle(viewMode === 'cards')}>🎴</button>
          </div>
          <button
            onClick={async () => {
              const { exportarPDFGlobal } = await import('../../lib/pdf')
              const numeroContadorById = new Map(contadores.map(c => [c.id, c.numero_serie]))
              exportarPDFGlobal(filtrados, numeroContadorById)
            }}
            style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: 10, fontWeight: 600, cursor: 'pointer', fontSize: 14, whiteSpace: 'nowrap' }}
          >📄 PDF</button>
        </div>
      </div>

      {/* Stats — derivados del filtered set. Tres por fila en escritorio
          (totales arriba, por estado abajo) y dos en el teléfono: uno por fila
          eran seis tarjetas altas antes de la primera lectura. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(max(120px, 30%), 1fr))', gap: 'clamp(8px, 2vw, 12px)', marginBottom: 20 }}>
        <StatCard label="Total Registros" value={String(stats.totalRegistros)} color="var(--at-primary)" icon={<Icon name="inbox" size={14} />} moneda={moneda} />
        <StatCard label="Total Consumo" value={`${formatNumber(stats.totalConsumo)} m³`} color="var(--at-accent-2)" icon={<Icon name="droplet" size={14} />} moneda={moneda} />
        <StatCard label="Total Monto" value={stats.totalMonto} color="var(--at-accent)" icon={<Icon name="coins" size={14} />} moneda={moneda} />
        <StatCard label="Pagado" value={stats.pagado} color="var(--at-success)" icon={<Icon name="check" size={14} />} moneda={moneda} />
        <StatCard label={`Pendiente (${stats.countPendiente})`} value={stats.pendiente} color="var(--at-warning)" icon={<Icon name="calendar" size={14} />} moneda={moneda} />
        <StatCard label={`En Mora (${stats.countMora})`} value={stats.mora} color="var(--at-danger)" icon={<Icon name="alert" size={14} />} moneda={moneda} />
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div style={{ background: 'var(--at-surface-2)', padding: 16, marginBottom: 20, borderRadius: 12, border: '1px solid var(--at-line)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <input
            type="text"
            placeholder="🔍 Buscar cliente o # de contador..."
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
            <select value={filtroProyecto} onChange={e => { setFiltroProyecto(e.target.value); setFiltroUnidad(''); setCurrentPage(1) }} style={filterFieldStyle}>
              <option value="">Todos los Proyectos</option>
              {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          )}
          {unidadesDisponibles.length > 0 && (
            <select value={filtroUnidad} onChange={e => { setFiltroUnidad(e.target.value); setCurrentPage(1) }} style={filterFieldStyle}>
              <option value="">Todas las Unidades</option>
              {unidadesDisponibles.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
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
            mobileCardLayout
            onRowClick={r => setDetalleId(r.id)}
            emptyState={{ icon: '📭', title: 'Sin registros' }}
          />
        </div>
      )}

      {/* View Mode: Cards (custom — no es un patrón estándar de DataTable) */}
      {viewMode === 'cards' && (
        // min(100%, 320px): con 320px fijos la tarjeta se salía en teléfonos angostos.
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: 16, marginBottom: 20 }}>
          {paginados.map(r => {
            const total = getTotal(r)
            const p = pillDeEstado(r.estado)
            return (
              <div
                key={r.id}
                // Como en la tabla: tocar la tarjeta abre su detalle (el botón
                // "Ver detalles" es el camino de teclado).
                onClick={() => setDetalleId(r.id)}
                style={{
                  background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12,
                  padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                  transition: 'all 0.2s', cursor: 'pointer', minWidth: 0,
                }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 16px rgba(0,0,0,0.1)' }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.05)' }}
              >
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--at-ink)' }}>{r.cliente_nombre}</div>
                  <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 4 }}>
                    📅 {formatDate(r.fecha)}
                    {(() => {
                      const numero = numeroContadorDeRegistro(r, contadoresById)
                      return numero ? <span> · 🔢 {numero}</span> : null
                    })()}
                  </div>
                </div>
                <div style={{ background: 'var(--at-surface-2)', padding: 12, borderRadius: 8, marginBottom: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                  <div><span style={{ color: 'var(--at-ink-3)' }}>Anterior</span><div style={{ fontWeight: 600, color: 'var(--at-primary)' }}>{r.lectura_anterior}</div></div>
                  <div><span style={{ color: 'var(--at-ink-3)' }}>Actual</span><div style={{ fontWeight: 600, color: 'var(--at-primary)' }}>{r.lectura_actual}</div></div>
                  <div><span style={{ color: 'var(--at-ink-3)' }}>Consumo</span><div style={{ fontWeight: 600, color: 'var(--at-accent)' }}>💧 {formatNumber(r.consumo)} m³</div></div>
                  <div><span style={{ color: 'var(--at-ink-3)' }}>Total</span><div style={{ fontWeight: 700, color: 'var(--at-primary)' }}>{formatCurrency(total, moneda)}</div></div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <span style={pillStyle(p)}>{p.icon} {r.estado}</span>
                  <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                    {canEdit && (
                      <button onClick={() => setEditModal({ registroId: r.id, estado: r.estado === 'mora' ? 'mora' : 'pendiente' })} aria-label="Editar estado" style={{ padding: '6px 10px', background: 'var(--at-warning)', color: 'var(--at-on-status)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>✏️</button>
                    )}
                    <button onClick={() => setPhotoModal({ registroId: r.id, label: fotoLabel(r) })} aria-label="Ver imagen de la lectura" title="Ver imagen de la lectura" style={{ padding: '6px 10px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>🖼️</button>
                    <button onClick={() => enviarWhatsApp(r)} aria-label="Enviar por WhatsApp" style={{ padding: '6px 10px', background: '#25D366', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>💬</button>
                    {canDelete && onRegistroDeleted && (
                      <button onClick={() => eliminarRegistro(r)} aria-label="Eliminar lectura" style={{ padding: '6px 10px', background: 'var(--at-danger)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>🗑️</button>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setDetalleId(r.id) }}
                  aria-label={`Ver detalles de la lectura de ${r.cliente_nombre ?? 'cliente sin nombre'} del ${formatDate(r.fecha)}`}
                  style={{
                    marginTop: 12, width: '100%', padding: '8px',
                    background: 'var(--at-surface-2)',
                    color: 'var(--at-ink-2)', border: '1px solid var(--at-line)',
                    borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  }}
                >Ver detalles ›</button>
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

      {/* Detalle de la lectura en ventana (antes se desplegaba dentro de la
          fila y en el teléfono se salía por la derecha). */}
      {detalle && (() => {
        const numero = numeroContadorDeRegistro(detalle, contadoresById)
        const p = pillDeEstado(detalle.estado)
        return (
          <EditModal
            title={`${detalle.cliente_nombre ?? 'Lectura'} — ${formatDate(detalle.fecha)}`}
            subtitle={
              <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span>🔢 {numero ? `Contador ${numero}` : 'Sin contador'}</span>
                <span style={{ ...pillStyle(p), padding: '2px 10px' }}>{p.icon} {detalle.estado}</span>
              </span>
            }
            maxWidth="720px"
            fullScreenOnMobile
            // La foto se abre encima y cierra con Escape escuchando en `window`;
            // esta ventana escucha en `document`, que va antes, y se cerraba
            // junto con la foto.
            closeOnEscape={!photoModal}
            onClose={() => setDetalleId(null)}
            // Las mismas acciones y permisos que la fila: en el teléfono la
            // columna de acciones se oculta y este es su único sitio.
            // Envueltas para que bajen de línea en pantallas angostas.
            footer={
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
                {canDelete && onRegistroDeleted && (
                  <Button variant="outline-danger" onClick={() => eliminarRegistro(detalle)} aria-label="Eliminar lectura" style={{ marginRight: 'auto' }}>🗑️</Button>
                )}
                <Button variant="secondary" onClick={() => setPhotoModal({ registroId: detalle.id, label: fotoLabel(detalle) })} aria-label="Ver imagen de la lectura">🖼️ Imagen</Button>
                <Button variant="secondary" onClick={() => enviarWhatsApp(detalle)} aria-label="Enviar por WhatsApp">💬 WhatsApp</Button>
                {canEdit && (
                  <Button
                    variant="warning"
                    onClick={() => setEditModal({ registroId: detalle.id, estado: detalle.estado === 'mora' ? 'mora' : 'pendiente' })}
                    aria-label="Editar estado"
                  >✏️ Editar estado</Button>
                )}
              </div>
            }
          >
            <RegistroDetalle
              registro={detalle}
              moneda={moneda}
              total={getTotal(detalle)}
              numeroContador={numero}
            />
          </EditModal>
        )
      })()}

      {/* Cambio de estado. Abierto desde el detalle queda encima de él:
          EditModal apila las ventanas y Escape cierra solo la de arriba. */}
      {editModal && (
        <EditModal
          title="📝 Modificar Estado de Pago"
          subtitle={registroEnEdicion ? `${registroEnEdicion.cliente_nombre ?? 'Lectura'} · ${formatDate(registroEnEdicion.fecha)}` : undefined}
          maxWidth="480px"
          fullScreenOnMobile
          closeOnBackdropClick={!savingEstado}
          closeOnEscape={!savingEstado}
          onClose={cerrarEditModal}
          footer={<>
            <Button variant="secondary" onClick={cerrarEditModal} disabled={savingEstado}>Cancelar</Button>
            <Button onClick={updateEstado} loading={savingEstado} loadingText="Guardando…">Guardar</Button>
          </>}
        >
          <label htmlFor="historial-nuevo-estado" style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>Nuevo Estado</label>
          <select
            id="historial-nuevo-estado"
            value={editModal.estado}
            onChange={e => setEditModal(prev => prev ? { ...prev, estado: e.target.value as EstadoSeguimiento } : null)}
            style={{
              width: '100%', padding: 12, border: '2px solid var(--at-line)', borderRadius: 10, fontSize: 15,
              boxSizing: 'border-box', fontFamily: 'inherit', background: 'var(--at-surface)', color: 'var(--at-ink)',
            }}
          >
            <option value="pendiente">⏳ Pendiente</option>
            <option value="mora">⚠️ Mora</option>
          </select>
          {/* "Pagado" ya NO está aquí: marcar cobrado un recibo sin monto,
              sin fecha y sin rastro es el hallazgo `pagada_sin_pago` del
              reporte de inconsistencias, y era esta pantalla la que lo
              producía. Se cobra registrando el pago, que exige el monto. */}
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--at-muted)' }}>
            Para marcar un recibo como pagado, registrá el pago desde Cobros: el
            abono queda con su monto y su fecha.
          </p>
        </EditModal>
      )}

      {/* Lightbox de la foto de la lectura — baja la imagen bajo demanda por id */}
      {photoModal && (
        <PhotoLightbox
          registroId={photoModal.registroId}
          label={photoModal.label}
          onClose={() => setPhotoModal(null)}
        />
      )}
    </div>
  )
}

// Etiqueta del visor de foto: cliente + fecha de la lectura.
function fotoLabel(r: Registro): string {
  return `${r.cliente_nombre ?? 'Lectura'} · ${formatDate(r.fecha)}`
}

// ── Sub-componentes locales ───────────────────────────────────────────────

// Contenido de la ventana de detalle — todos los campos que no caben en la
// fila/card (período de servicio, desglose de tarifa, pago, notas, GPS…).
// `foto` no se incluye: el listado nunca la trae (es base64 pesado; ver
// REGISTROS_LIST_COLS en domain/agua/queries.ts).
function RegistroDetalle({ registro: r, moneda, total, numeroContador }: {
  registro: Registro; moneda: string; total: number; numeroContador: string | null
}) {
  const periodo = r.fecha_lectura_anterior
    ? `${formatDate(r.fecha_lectura_anterior)} → ${formatDate(r.fecha)}`
    : formatDate(r.fecha)
  const gps = r.gps

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10,
      }}>
        <DetailField label="Período de servicio" value={periodo} wide />
        {r.dias_servicio != null && <DetailField label="Días de servicio" value={`${formatNumber(r.dias_servicio, 0)} días`} />}
        {r.mes && <DetailField label="Mes facturado" value={r.mes} />}
        {numeroContador && <DetailField label="# Contador" value={numeroContador} />}

        <DetailField label="Lectura anterior" value={formatNumber(r.lectura_anterior, 0)} />
        <DetailField label="Lectura actual" value={formatNumber(r.lectura_actual, 0)} accent="var(--at-primary)" />
        <DetailField label="Consumo" value={`${formatNumber(r.consumo)} m³`} accent="var(--at-accent)" />

        {r.tipo_cobro && <DetailField label="Tipo de cobro" value={r.tipo_cobro} />}
        <DetailField label="Tarifa aplicada" value={`${formatCurrency(r.tarifa_aplicada, moneda)} / m³`} />
        {r.tarifa_exceso_aplicada ? <DetailField label="Tarifa de exceso" value={`${formatCurrency(r.tarifa_exceso_aplicada, moneda)} / m³`} /> : null}
        <DetailField label="Canon / cargo fijo" value={formatCurrency(r.canon_aplicado, moneda)} />
        <DetailField label="Total calculado" value={formatCurrency(total, moneda)} accent="var(--at-primary)" />

        {r.monto_pagado != null && <DetailField label="Monto pagado" value={formatCurrency(r.monto_pagado, moneda)} accent="var(--at-success-strong)" />}
        {r.fecha_pago && <DetailField label="Fecha de pago" value={formatDate(r.fecha_pago)} />}
        {/* La columna "Capturó" se oculta en el teléfono: aquí sigue a mano. */}
        <DetailField label="Capturó" value={<UsuarioChip userId={r.creado_por} historico />} />
      </div>

      {r.notas && (
        <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={detailLabelStyle}>📝 Notas</div>
          <div style={{ fontSize: 13.5, color: 'var(--at-ink)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.notas}</div>
        </div>
      )}

      {gps && (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${gps.lat},${gps.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
            fontSize: 13, fontWeight: 600, color: 'var(--at-primary)', textDecoration: 'none',
          }}
        >
          📍 Ver ubicación en el mapa ({gps.lat.toFixed(5)}, {gps.lng.toFixed(5)})
        </a>
      )}

      <div style={{ fontSize: 11, color: 'var(--at-ink-3)', overflowWrap: 'anywhere' }}>ID de lectura: {r.id}</div>
    </div>
  )
}

function DetailField({ label, value, accent, wide = false }: {
  label: string; value: ReactNode; accent?: string; wide?: boolean
}) {
  return (
    <div style={{
      minWidth: 0, background: 'var(--at-surface-2)', border: '1px solid var(--at-line)',
      borderRadius: 8, padding: '8px 10px',
      // `1 / -1` y no `span 2`: con una sola columna el span crea una columna
      // implícita y el campo se sale de la ventana.
      gridColumn: wide ? '1 / -1' : undefined,
    }}>
      <div style={detailLabelStyle}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: accent ?? 'var(--at-ink)', wordBreak: 'break-word' }}>{value}</div>
    </div>
  )
}

function StatCard({ label, value, color, icon, moneda }: {
  label: string; value: string | number; color: string; icon: ReactNode; moneda: string
}) {
  return (
    <div style={{
      minWidth: 0, padding: 'clamp(10px, 2.5vw, 16px)',
      // Contenedor de consulta: el valor se mide con `cqi` (ancho de la propia
      // tarjeta) para que un monto de seis cifras quepa con dos por fila.
      containerType: 'inline-size',
      background: `linear-gradient(135deg, ${tint(color, 12)} 0%, ${tint(color, 6)} 100%)`,
      // `border` antes que `borderLeft`: en el orden inverso el atajo pisaba
      // el filete de color y nunca se veía.
      border: `1px solid ${tint(color, 25)}`,
      borderLeft: `4px solid ${color}`,
      borderRadius: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--at-ink-3)', fontWeight: 600, marginBottom: 'clamp(4px, 1.5vw, 8px)' }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 'clamp(15px, 12cqi, 24px)', fontWeight: 700, color, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
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
  // nowrap: en columnas angostas el icono y el estado se partían en dos líneas.
  return { padding: '6px 14px', borderRadius: 12, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', ...p }
}

// Botón del nombre del cliente: se ve como texto enlazado y hereda la
// alineación de la celda (a la derecha en la tarjeta del teléfono).
const rowMainBtnStyle: CSSProperties = {
  background: 'none', border: 'none', padding: 0, margin: 0,
  fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit',
  color: 'var(--at-primary)', fontWeight: 600, textAlign: 'inherit',
  // `break-word` y no `anywhere`: este último encoge el ancho mínimo de la
  // columna y en la tabla de escritorio partía los nombres a media palabra.
  cursor: 'pointer', overflowWrap: 'break-word',
}

const detailLabelStyle: CSSProperties = {
  fontSize: 11, color: 'var(--at-ink-3)', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 3,
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

const btnFotoStyle: CSSProperties = {
  padding: '8px 12px', minHeight: 36, background: 'var(--at-primary)',
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
