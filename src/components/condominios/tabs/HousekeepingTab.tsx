// Pestaña de housekeeping: agenda por fecha, alta/edición en ventana emergente y flujo por
// pasos de cada servicio (Iniciar servicio → evidencia de ingreso → Finalizar limpieza →
// informe). El estado lo mueven los botones de la tarjeta, nunca un selector: la base
// (trg_hk_estado_transicion) rechaza cualquier otro salto.
import { hoyLocalISO } from '../../../lib/format'
import { useEffect, useRef, useState } from 'react'
import { updateCondominioRowAfectando } from '../../../domain/condominios/tabMutations'
import type { ServicioHousekeeping, EstadoHousekeeping, Unidad } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { eliminarServicioConEvidencias } from '../../../domain/condominios/housekeepingEvidencias'
import { etiquetaReserva, horasDedicadas, mensajeErrorFlujo } from '../../../domain/condominios/housekeepingFlujo'
import { HousekeepingServicioPasos, type PasoHK } from './HousekeepingServicioPasos'
import { HousekeepingServicioModal, TIPO_CONFIG } from './HousekeepingServicioModal'
import { UsuarioChip } from '../../shared/UsuarioChip'
import type { AppUser } from '../../../domain/usuarios/queries'
import { estadoResponsable, fetchResponsablesElegibles } from '../../../domain/condominios/housekeepingResponsable'
import { ResponsableLinea } from './ResponsableSelector'

interface Props {
  servicios: ServicioHousekeeping[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  /** Usuario conectado: preseleccionado como responsable al crear si es elegible. */
  userId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_CONFIG: Record<EstadoHousekeeping, { label: string; color: string; bg: string }> = {
  pendiente:  { label: 'Pendiente',  color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  en_proceso: { label: 'En proceso', color: 'var(--at-primary)', bg: 'var(--at-primary-soft)' },
  completado: { label: 'Completado', color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  cancelado:  { label: 'Cancelado',  color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
}

export function HousekeepingTab({ servicios, unidades, proyectoId, companyId, userId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [filtroEstado, setFiltroEstado] = useState<EstadoHousekeeping | 'todos'>('todos')
  const [modal, setModal] = useState<{ abierto: boolean; servicio: ServicioHousekeeping | null }>({ abierto: false, servicio: null })
  const [pasos, setPasos] = useState<{ id: string; paso: PasoHK } | null>(null)
  const [iniciando, setIniciando] = useState<string | null>(null)
  const servicioPasos = pasos ? servicios.find(s => s.id === pasos.id) ?? null : null

  // Catálogo de responsables ELEGIBLES de este proyecto (lo decide la base). `null`
  // mientras no se ha cargado. Se vacía y se vuelve a pedir al cambiar de proyecto,
  // de empresa o de sesión, y con él se cierra cualquier ventana a medias.
  const [elegibles, setElegibles] = useState<AppUser[] | null>(null)
  const [elegiblesError, setElegiblesError] = useState<string | null>(null)
  const [cargandoElegibles, setCargandoElegibles] = useState(false)
  const peticion = useRef(0)
  const cargarElegibles = async () => {
    const n = ++peticion.current
    setCargandoElegibles(true)
    const { data, error } = await fetchResponsablesElegibles(proyectoId)
    if (n !== peticion.current) return   // llegó tarde: ya cambió el proyecto/empresa/sesión
    setElegibles(error ? [] : data); setElegiblesError(error); setCargandoElegibles(false)
  }
  useEffect(() => {
    setModal({ abierto: false, servicio: null }); setPasos(null)
    setElegibles(null); setElegiblesError(null)
    void cargarElegibles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectoId, companyId, userId])

  const today = hoyLocalISO()
  const thisMonth = today.slice(0, 7)

  const filtered = servicios.filter(s => filtroEstado === 'todos' || s.estado === filtroEstado)
  const pendientes  = servicios.filter(s => s.estado === 'pendiente').length
  const enProceso   = servicios.filter(s => s.estado === 'en_proceso').length
  const completados = servicios.filter(s => s.estado === 'completado' && s.fecha.startsWith(thisMonth)).length
  const costoMes    = servicios.filter(s => s.estado === 'completado' && s.fecha.startsWith(thisMonth)).reduce((s, r) => s + (r.costo ?? 0), 0)

  // Agrupar por fecha para vista de agenda
  const byFecha: Record<string, ServicioHousekeeping[]> = {}
  for (const s of filtered) {
    byFecha[s.fecha] = byFecha[s.fecha] ?? []
    byFecha[s.fecha].push(s)
  }
  const fechas = Object.keys(byFecha).sort((a, b) => b.localeCompare(a))

  const nombreResponsable = (s: ServicioHousekeeping) => {
    const e = estadoResponsable(s, elegibles)
    return e.kind === 'vinculado' ? e.nombre : e.kind === 'anterior_sin_vincular' ? e.texto : undefined
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: '¿Eliminar servicio?', text: 'Se eliminarán también sus fotos y observaciones.', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error, limpieza } = await eliminarServicioConEvidencias(id)
    if (error) return notify({ variant: 'error', title: 'No se eliminó el servicio', text: error })
    if (limpieza === 'pendiente') notify({ variant: 'info', title: 'Servicio eliminado', text: 'Las fotos se retirarán del almacenamiento en segundo plano.' })
    onRefresh()
  }

  /** «Iniciar servicio»: sella la hora de inicio real (la base) y abre el paso 1. */
  async function iniciar(s: ServicioHousekeeping) {
    const r = await confirm({ title: 'Iniciar servicio', text: `Se registrará la hora de inicio ahora y podrás documentar el estado en que encontraste ${s.unidad_nombre ? `la unidad ${s.unidad_nombre}` : 'la unidad'}.`, confirmText: 'Iniciar' })
    if (!r.isConfirmed) return
    setIniciando(s.id)
    const { error } = await updateCondominioRowAfectando('servicios_housekeeping', s.id, { estado: 'en_proceso' })
    setIniciando(null)
    if (error) {
      return notify({ variant: 'error', title: 'No se inició el servicio', text: error.code === 'SIN_FILAS' ? 'El servicio ya no existe o no tienes acceso.' : mensajeErrorFlujo(error.message) })
    }
    onRefresh()
    setPasos({ id: s.id, paso: 1 })
  }

  const btnChip = (extra: React.CSSProperties = {}): React.CSSProperties => ({ flex: 1, padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', ...extra })

  return (
    <div style={{ padding: '20px 24px' }}>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Pendientes',       value: String(pendientes),                                                     icon: '⏳', color: 'var(--at-warning)' },
          { label: 'En proceso',       value: String(enProceso),                                                      icon: '🔄', color: 'var(--at-primary)' },
          { label: 'Completados (mes)',value: String(completados),                                                    icon: '✅', color: 'var(--at-success)' },
          { label: 'Costo del mes',    value: costoMes > 0 ? `${moneda} ${costoMes.toFixed(0)}` : '—',               icon: '💰', color: 'var(--at-accent)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Housekeeping</h2>
        {canCreate && (
          <button onClick={() => setModal({ abierto: true, servicio: null })} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Nuevo Servicio</button>
        )}
      </div>

      {modal.abierto && (
        <HousekeepingServicioModal
          servicio={modal.servicio} unidades={unidades} proyectoId={proyectoId} companyId={companyId} userId={userId} moneda={moneda}
          elegibles={elegibles} cargandoElegibles={cargandoElegibles} elegiblesError={elegiblesError} onRecargarElegibles={() => void cargarElegibles()}
          onClose={() => setModal({ abierto: false, servicio: null })} onSaved={onRefresh} />
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {(['todos', 'pendiente', 'en_proceso', 'completado', 'cancelado'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '5px 12px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              borderColor: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-line)',
              background: filtroEstado === e ? 'var(--at-primary-soft)' : 'var(--at-surface)',
              color: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
            {e === 'todos' ? `Todos (${servicios.length})` : `${ESTADO_CONFIG[e as EstadoHousekeeping]?.label} (${servicios.filter(s => s.estado === e).length})`}
          </button>
        ))}
      </div>

      {/* Vista agrupada por fecha */}
      {fechas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🧹</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay servicios de housekeeping</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {fechas.map(fecha => (
            <div key={fecha}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <div style={{ height: '1px', flex: 1, background: 'var(--at-line)' }} />
                <span style={{ fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap',
                  background: fecha === today ? 'var(--at-warning-tint)' : 'var(--at-surface)', padding: '2px 8px', borderRadius: '10px',
                  border: `1.5px solid ${fecha === today ? '#fcd34d' : 'var(--at-line)'}`,
                  color: fecha === today ? 'var(--at-warning-strong)' : 'var(--at-ink-3)' }}>
                  {fecha === today ? '⭐ Hoy' : ''} {fecha}
                </span>
                <div style={{ height: '1px', flex: 1, background: 'var(--at-line)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '10px' }}>
                {byFecha[fecha].map(s => {
                  const est = ESTADO_CONFIG[s.estado]
                  const tipo = TIPO_CONFIG[s.tipo]
                  const cerrado = s.estado === 'completado' || s.estado === 'cancelado'
                  return (
                    <div key={s.id} data-testid={`servicio-${s.id}`} data-estado={s.estado} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{tipo.icon} {tipo.label}</div>
                        <span style={{ padding: '2px 7px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: est.bg, color: est.color }}>{est.label}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '10px' }}>
                        {s.unidad_nombre && <div>🏠 {s.unidad_nombre}</div>}
                        {s.reserva_str_resumen && <div title="Reserva STR vinculada">🔖 {etiquetaReserva(s.reserva_str_resumen)}</div>}
                        <ResponsableLinea estado={estadoResponsable(s, elegibles)} />
                        {(s.hora_inicio || s.hora_fin) && <div>🕐 Ingreso tentativo {s.hora_inicio?.slice(0, 5) ?? '?'}{s.hora_fin ? ` — fin ${s.hora_fin.slice(0, 5)}` : ''}</div>}
                        {s.costo && <div style={{ fontWeight: 600, color: 'var(--at-ink)' }}>💰 {moneda} {s.costo.toFixed(2)}</div>}
                        {s.completado_por && <div>✅ Completó: <UsuarioChip userId={s.completado_por} /> · ⏱ {horasDedicadas(s)}</div>}
                        {!s.completado_por && s.iniciado_por && <div>▶️ Inició: <UsuarioChip userId={s.iniciado_por} /></div>}
                        {s.informe_enviado_en && <div>📨 Informe enviado</div>}
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {s.estado === 'pendiente' && canEdit && (
                          <button onClick={() => iniciar(s)} disabled={iniciando === s.id} style={btnChip({ background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' })}>
                            {iniciando === s.id ? 'Iniciando…' : '▶️ Iniciar servicio'}
                          </button>
                        )}
                        {s.estado === 'en_proceso' && (
                          <>
                            <button onClick={() => setPasos({ id: s.id, paso: 1 })} style={btnChip()}>📝 Evidencia de ingreso</button>
                            {canEdit && <button onClick={() => setPasos({ id: s.id, paso: 2 })} style={btnChip({ background: 'var(--at-success-tint)', color: 'var(--at-success-strong)' })}>🏁 Finalizar limpieza</button>}
                          </>
                        )}
                        {(cerrado || (s.estado === 'pendiente' && !canEdit)) && (
                          <button onClick={() => setPasos({ id: s.id, paso: 1 })} style={btnChip()}>📋 Ver evidencia</button>
                        )}
                      </div>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                          <button onClick={() => setModal({ abierto: true, servicio: s })} aria-label="Editar servicio" style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                          <button onClick={() => handleDelete(s.id)} aria-label="Eliminar servicio" style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {servicioPasos && pasos && (
        <HousekeepingServicioPasos
          key={`${servicioPasos.id}-${pasos.paso}`}
          servicio={servicioPasos} projectId={proyectoId} companyId={companyId}
          tipoLabel={TIPO_CONFIG[servicioPasos.tipo].label} estadoLabel={ESTADO_CONFIG[servicioPasos.estado].label}
          responsableEstado={estadoResponsable(servicioPasos, elegibles)} responsableNombre={nombreResponsable(servicioPasos)}
          canEdit={canEdit} pasoInicial={pasos.paso} onClose={() => setPasos(null)} onRefresh={onRefresh} />
      )}
    </div>
  )
}
