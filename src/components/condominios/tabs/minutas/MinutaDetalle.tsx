// Detalle de una minuta en ventana: participantes, puntos con sus acuerdos y
// compromisos (que se marcan cumplidos desde aquí), avance y acciones
// (editar, fijar, cerrar/reabrir, imprimir, eliminar).
import { useEffect, useState, type CSSProperties } from 'react'
import { EditModal } from '../../../shared/EditModal'
import { Button } from '../../../shared/Button'
import { confirm, notify } from '../../../shared/Dialog'
import { deleteCondominioRow, updateCondominioRow } from '../../../../domain/condominios/tabMutations'
import {
  TIPO_ACUERDO_INFO, fechaDeMinuta, gestorDe, marcarCumplido, participantesDe, plazoCompromiso, plazoSeguimiento, puntosDe, resumenCompromisos, situacionCompromiso,
} from '../../../../domain/condominios/minutas'
import { diasHastaFechaCalendario, formatFechaCalendario } from '../../../../lib/format'
import type { AcuerdoMinuta, NotaAdmin } from '../../../../types'
import { tint } from '../../../shared/statusTone'
import { BarraAvance, ParticipanteCard, categoriaInfo, prioridadInfo } from './comun'
import { imprimirMinuta } from './imprimirMinuta'
import './minutas.css'

interface Props {
  nota: NotaAdmin
  canEdit: boolean
  canDelete: boolean
  onClose: () => void
  onEditar: () => void
  onRefresh: () => void
}

const chip = (bg: string, color: string): CSSProperties => ({ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: bg, color, whiteSpace: 'nowrap' })
const bloque: CSSProperties = { border: '1px solid var(--at-line)', borderRadius: 12, padding: 14, background: 'var(--at-surface)' }
const tituloBloque: CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }

export function MinutaDetalle({ nota, canEdit, canDelete, onClose, onEditar, onRefresh }: Props) {
  const participantes = participantesDe(nota)
  const gestor = gestorDe(participantes)
  // Copia local de los puntos: marcar un compromiso se ve al instante y la
  // sección recarga detrás; cuando llega la fila fresca, se vuelve a tomar.
  const [puntos, setPuntos] = useState(() => puntosDe(nota))
  useEffect(() => { setPuntos(puntosDe(nota)) }, [nota])
  const [ocupado, setOcupado] = useState<string | null>(null)

  const cat = categoriaInfo(nota.categoria)
  const prio = prioridadInfo(nota.prioridad)
  const resumen = resumenCompromisos(puntos)
  const diasSeguimiento = diasHastaFechaCalendario(nota.fecha_recordatorio)
  const nombreDe = (id: string | null | undefined) => participantes.find(p => p.id === id)?.nombre ?? null

  async function cambiar(campos: Record<string, unknown>, clave: string, exito?: string) {
    if (ocupado) return
    setOcupado(clave)
    const { error } = await updateCondominioRow('notas_admin', nota.id, campos)
    setOcupado(null)
    if (error) { notify({ variant: 'error', title: 'No se pudo actualizar', text: error.message }); return false }
    if (exito) notify({ variant: 'success', title: exito })
    onRefresh()
    return true
  }

  async function marcar(a: AcuerdoMinuta, cumplido: boolean) {
    const nuevos = marcarCumplido(puntos, a.id, cumplido, new Date().toISOString())
    setPuntos(nuevos)
    const ok = await cambiar({ puntos: nuevos }, `acuerdo:${a.id}`)
    if (!ok) setPuntos(puntos)
  }

  async function cerrarMinuta() {
    const pendientes = resumen.total - resumen.cumplidos
    const res = await confirm({
      title: 'Cerrar minuta',
      text: pendientes > 0 ? `Quedan ${pendientes} compromiso${pendientes === 1 ? '' : 's'} sin cumplir. ¿Cerrar de todos modos?` : '¿Dar la minuta por cerrada?',
      icon: 'question', confirmText: 'Cerrar minuta',
    })
    if (!res.isConfirmed) return
    await cambiar({ resuelta: true, fijada: false }, 'cerrar', 'Minuta cerrada')
  }

  async function eliminar() {
    if (!canDelete) return
    const res = await confirm({ title: 'Eliminar minuta', text: `¿Eliminar «${nota.titulo}»? No se puede deshacer.`, icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!res.isConfirmed) return
    const { error } = await deleteCondominioRow('notas_admin', nota.id)
    if (error) { notify({ variant: 'error', title: 'No se pudo eliminar', text: error.message }); return }
    onClose()
    onRefresh()
  }

  const editable = canEdit && !nota.resuelta

  return (
    <EditModal
      title={nota.titulo}
      subtitle={<>
        📅 {formatFechaCalendario(fechaDeMinuta(nota), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        {gestor && <> · ★ Gestiona <strong>{gestor.nombre}</strong></>}
        {nota.autor && nota.autor !== gestor?.nombre && <> · Registró {nota.autor}</>}
      </>}
      size="lg"
      fullScreenOnMobile
      onClose={onClose}
      footer={
        <div className="minuta-acciones minuta-acciones--detalle">
          {canDelete && <Button className="minuta-eliminar" variant="outline-danger" size="sm" onClick={() => void eliminar()}>🗑 Eliminar</Button>}
          <Button variant="secondary" size="sm" onClick={() => imprimirMinuta(nota)}>🖨 Imprimir</Button>
          {canEdit && !nota.resuelta && (
            <Button variant="secondary" size="sm" onClick={() => void cambiar({ fijada: !nota.fijada }, 'fijar')} loading={ocupado === 'fijar'}>
              {nota.fijada ? '📌 Desfijar' : '📌 Fijar'}
            </Button>
          )}
          {canEdit && (nota.resuelta
            ? <Button variant="secondary" size="sm" onClick={() => void cambiar({ resuelta: false }, 'reabrir', 'Minuta reabierta')} loading={ocupado === 'reabrir'}>↺ Reabrir</Button>
            : <Button variant="success" size="sm" onClick={() => void cerrarMinuta()} loading={ocupado === 'cerrar'}>✓ Cerrar minuta</Button>)}
          {editable && <Button variant="primary" size="sm" onClick={onEditar}>✏️ Editar</Button>}
        </div>
      }
    >
      <div className="minuta-detalle-cuerpo" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={chip(tint(cat.color, 14), cat.color)}>{cat.icon} {cat.label}</span>
          {prio.value !== 'normal' && <span style={chip(prio.bg, prio.color)}>Prioridad {prio.label.toLowerCase()}</span>}
          {nota.fijada && <span style={chip('var(--at-warning-tint)', 'var(--at-warning-strong)')}>📌 Fijada</span>}
          <span style={chip(nota.resuelta ? 'var(--at-success-tint)' : 'var(--at-info-tint)', nota.resuelta ? 'var(--at-success-strong)' : 'var(--at-info-strong)')}>{nota.resuelta ? '✓ Cerrada' : '● Abierta'}</span>
        </div>

        {diasSeguimiento !== null && !nota.resuelta && (
          <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10,
            background: diasSeguimiento < 0 ? 'var(--at-danger-tint)' : diasSeguimiento === 0 ? 'var(--at-warning-tint)' : 'var(--at-info-tint)',
            border: `1px solid ${diasSeguimiento < 0 ? 'var(--at-danger-border)' : diasSeguimiento === 0 ? 'var(--at-warning-border)' : 'var(--at-info-border)'}` }}>
            <span aria-hidden="true" style={{ fontSize: 18 }}>⏰</span>
            <div style={{ fontSize: 13 }}>
              <strong>Próximo seguimiento</strong> {formatFechaCalendario(nota.fecha_recordatorio)} · {plazoSeguimiento(diasSeguimiento)}
            </div>
          </div>
        )}

        {nota.contenido?.trim() && (
          <div style={bloque}>
            <h3 style={tituloBloque}>Objetivo</h3>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--at-ink-2)', whiteSpace: 'pre-wrap' }}>{nota.contenido}</div>
          </div>
        )}

        <div style={bloque}>
          <h3 style={tituloBloque}>Participantes ({participantes.length})</h3>
          {participantes.length === 0
            ? <p style={{ margin: 0, fontSize: 13, color: 'var(--at-ink-3)', fontStyle: 'italic' }}>Sin participantes registrados.</p>
            : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))', gap: 8 }}>
                {participantes.map(p => <ParticipanteCard key={p.id} p={p} />)}
              </div>}
        </div>

        <div style={bloque}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={tituloBloque}>Puntos abordados ({puntos.length})</h3>
            {resumen.total > 0 && (
              <span style={{ fontSize: 12, color: resumen.vencidos > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)', fontWeight: 600 }}>
                {resumen.cumplidos} de {resumen.total} compromisos cumplidos{resumen.vencidos > 0 ? ` · ${resumen.vencidos} vencido${resumen.vencidos === 1 ? '' : 's'}` : ''}
              </span>
            )}
          </div>
          {resumen.total > 0 && <div style={{ margin: '0 0 12px' }}><BarraAvance cumplidos={resumen.cumplidos} total={resumen.total} alto={8} /></div>}
          {puntos.length === 0 && <p style={{ margin: 0, fontSize: 13, color: 'var(--at-ink-3)', fontStyle: 'italic' }}>Sin puntos registrados.</p>}
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
            {puntos.map((p, i) => (
              <li key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', fontWeight: 800, fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)' }}>{p.titulo}</div>
                  {p.descripcion && <div style={{ fontSize: 13, color: 'var(--at-ink-2)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{p.descripcion}</div>}
                  {p.acuerdos.length > 0 && (
                    <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
                      {p.acuerdos.map(a => {
                        const esCompromiso = a.tipo === 'compromiso'
                        const situacion = esCompromiso ? situacionCompromiso(a) : null
                        const dias = esCompromiso ? diasHastaFechaCalendario(a.fecha_limite) : null
                        const responsable = esCompromiso ? nombreDe(a.responsable_id) : null
                        const colorPlazo = situacion === 'vencido' ? 'var(--at-danger)' : situacion === 'hoy' ? 'var(--at-warning-strong)' : 'var(--at-ink-3)'
                        return (
                          <li key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 8,
                            background: a.cumplido ? 'var(--at-success-tint)' : 'var(--at-surface-2)', borderLeft: `3px solid ${esCompromiso ? (a.cumplido ? 'var(--at-success)' : situacion === 'vencido' ? 'var(--at-danger)' : 'var(--at-accent)') : 'var(--at-primary-mint)'}` }}>
                            {esCompromiso && (
                              <label className="minuta-check-hit" style={{ marginTop: -2 }}>
                                <input type="checkbox" className="minuta-check" checked={a.cumplido} disabled={!canEdit || nota.resuelta || ocupado !== null}
                                  aria-label={`${a.cumplido ? 'Desmarcar' : 'Marcar'} cumplido: ${a.texto}`}
                                  onChange={e => void marcar(a, e.target.checked)} />
                              </label>
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14, color: 'var(--at-ink)', textDecoration: a.cumplido ? 'line-through' : 'none', opacity: a.cumplido ? 0.75 : 1 }}>
                                <span aria-hidden="true">{TIPO_ACUERDO_INFO[a.tipo].icon} </span>{a.texto}
                              </div>
                              {esCompromiso && (
                                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, marginTop: 3 }}>
                                  <span style={{ color: 'var(--at-ink-3)' }}>{responsable ? `👤 ${responsable}` : '👤 Sin responsable'}</span>
                                  {a.fecha_limite && (
                                    <span style={{ color: a.cumplido ? 'var(--at-ink-3)' : colorPlazo, fontWeight: !a.cumplido && situacion !== 'pendiente' ? 700 : 500 }}>
                                      📅 {formatFechaCalendario(a.fecha_limite)}{!a.cumplido && dias !== null ? ` · ${plazoCompromiso(dias)}` : ''}
                                    </span>
                                  )}
                                  {a.cumplido && <span style={{ color: 'var(--at-success-strong)', fontWeight: 600 }}>✓ Cumplido</span>}
                                </div>
                              )}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </EditModal>
  )
}
