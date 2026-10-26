// Paso «Equipo» del detalle de una reserva (20261108000000): qué se pidió,
// qué se entregó, qué volvió y cuánto cuesta lo que faltó. Entregar y recibir
// escriben varias filas en una transacción (RPC), así que aquí sólo se arma
// el formulario y se muestra el resultado.
import { useState } from 'react'
import type { AmenidadesCtx } from './ctx'
import type { PrestamoEquipo, ReservaAmenidad } from '../../../../types'
import type { RecepcionPrestamo } from '../../../../domain/condominios/prestamosEquipo'
import {
  ESTADO_PRESTAMO_LABEL,
  estadoRecepcionSugerido,
  faltantes,
  montoReposicionSugerido,
  prestamosDeReserva,
  resumenEquiposReserva,
} from '../../../../lib/prestamosEquipo'
import { btnAction } from './ui'
import { SelectorEquiposReserva } from './SelectorEquiposReserva'

type Modo = 'ver' | 'agregar' | 'entregar' | 'recibir'
type EstadoCierre = 'devuelto' | 'dañado' | 'perdido'

interface LineaRecepcion { devuelta: string; estado: EstadoCierre; monto: string; obs: string }

const CHIP: Record<PrestamoEquipo['estado'], { bg: string; color: string }> = {
  solicitado: { bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  prestado:   { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  devuelto:   { bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)' },
  dañado:     { bg: 'var(--at-danger-tint)', color: 'var(--at-danger-strong)' },
  perdido:    { bg: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)' },
  cancelado:  { bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
}

const inputStyle = { padding: '6px 8px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 13, background: 'var(--at-surface-2)', boxSizing: 'border-box' as const }

export function EquiposReserva({ ctx, reserva }: { ctx: AmenidadesCtx; reserva: ReservaAmenidad }) {
  const { prestamos, inventario, amenidadInventario, moneda, canEdit, solicitarEquiposReserva, entregarEquipos, recibirEquipos } = ctx
  const [modo, setModo] = useState<Modo>('ver')
  const [saving, setSaving] = useState(false)
  const [agregar, setAgregar] = useState<Record<string, number>>({})
  const [entrega, setEntrega] = useState<Record<string, string>>({})
  const [entregadoPor, setEntregadoPor] = useState('')
  const [entregaObs, setEntregaObs] = useState('')
  const [recepcion, setRecepcion] = useState<Record<string, LineaRecepcion>>({})
  const [recibidoPor, setRecibidoPor] = useState('')
  const [generarCargo, setGenerarCargo] = useState(false)

  const lista = prestamosDeReserva(reserva.id, prestamos)
  const resumen = resumenEquiposReserva(lista)
  const links = amenidadInventario.filter(l => l.amenidad_id === reserva.amenidad_id)
  const solicitados = lista.filter(p => p.estado === 'solicitado')
  const prestados = lista.filter(p => p.estado === 'prestado')
  const puedeAgregar = canEdit && links.length > 0 && (reserva.estado === 'pendiente' || reserva.estado === 'confirmada') && !reserva.checkout_at

  function abrirEntrega() {
    setEntrega(Object.fromEntries(solicitados.map(p => [p.id, String(p.cantidad)])))
    setModo('entregar')
  }
  function abrirRecepcion() {
    setRecepcion(Object.fromEntries(prestados.map(p => [p.id, {
      devuelta: String(p.cantidad), estado: 'devuelto' as EstadoCierre, monto: '', obs: '',
    }])))
    setGenerarCargo(false)
    setModo('recibir')
  }
  function setLinea(id: string, patch: Partial<LineaRecepcion>) {
    setRecepcion(prev => {
      const p = prestados.find(x => x.id === id)!
      const actual = prev[id]
      const next = { ...actual, ...patch }
      if (patch.devuelta !== undefined && patch.estado === undefined) {
        const dev = parseInt(patch.devuelta) || 0
        // Sólo se re-propone el estado cuando la administración no eligió uno a mano.
        if (actual.estado === 'devuelto' || actual.estado === 'perdido') next.estado = estadoRecepcionSugerido(p.cantidad, dev)
      }
      return { ...prev, [id]: next }
    })
  }

  /** Reposición de una línea: lo tecleado, o faltantes × costo congelado. */
  function montoLinea(p: PrestamoEquipo, l: LineaRecepcion): number {
    if (l.monto.trim() !== '') return Math.max(0, Number(l.monto) || 0)
    return montoReposicionSugerido(p.cantidad, parseInt(l.devuelta) || 0, p.costo_reposicion_unitario)
  }
  const totalRecepcion = prestados.reduce((s, p) => s + (recepcion[p.id] ? montoLinea(p, recepcion[p.id]) : 0), 0)

  async function confirmarAgregar() {
    const equipos = Object.entries(agregar).filter(([, n]) => n > 0).map(([inventario_id, cantidad]) => ({ inventario_id, cantidad }))
    if (equipos.length === 0) return
    setSaving(true)
    const ok = await solicitarEquiposReserva(reserva.id, equipos)
    setSaving(false)
    if (ok) { setAgregar({}); setModo('ver') }
  }

  async function confirmarEntrega() {
    const entregas = solicitados.map(p => ({ id: p.id, cantidad: Math.max(0, parseInt(entrega[p.id] ?? '') || 0) }))
    setSaving(true)
    const ok = await entregarEquipos(entregas, entregadoPor.trim(), entregaObs.trim())
    setSaving(false)
    if (ok) setModo('ver')
  }

  async function confirmarRecepcion() {
    const recepciones: RecepcionPrestamo[] = prestados.map(p => {
      const l = recepcion[p.id]
      const devuelta = Math.max(0, Math.min(p.cantidad, parseInt(l.devuelta) || 0))
      return {
        id: p.id,
        cantidad_devuelta: devuelta,
        estado: l.estado,
        monto_reposicion: l.monto.trim() !== '' ? Math.max(0, Number(l.monto) || 0) : null,
        observaciones: l.obs.trim() || null,
      }
    })
    setSaving(true)
    const r = await recibirEquipos(recepciones, recibidoPor.trim(), generarCargo && totalRecepcion > 0)
    setSaving(false)
    if (r) setModo('ver')
  }

  return (
    <div style={{ marginTop: 8 }}>
      {lista.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {lista.map(p => {
            const c = CHIP[p.estado]
            const falt = faltantes(p)
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px', background: 'var(--at-surface-2)', borderRadius: 8, border: '1px solid var(--at-line)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--at-ink)' }}>🪑 {p.equipo_nombre} <span style={{ color: 'var(--at-ink-2)' }}>×{p.cantidad}</span></span>
                    <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 800, background: c.bg, color: c.color }}>{ESTADO_PRESTAMO_LABEL[p.estado]}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--at-ink-3)', marginTop: 2 }}>
                    {p.cantidad_solicitada != null && p.cantidad_solicitada !== p.cantidad && `Pedido ${p.cantidad_solicitada} · `}
                    {p.estado === 'prestado' && `Entregado ${p.fecha_prestamo}${p.hora_prestamo ? ` ${p.hora_prestamo.slice(0, 5)}` : ''}${p.entregado_por ? ` por ${p.entregado_por}` : ''}`}
                    {p.estado === 'solicitado' && 'Pendiente de entrega'}
                    {p.estado === 'cancelado' && 'No se entregó'}
                    {(p.estado === 'devuelto' || p.estado === 'dañado' || p.estado === 'perdido') && (
                      <>
                        Devuelto {p.cantidad_devuelta ?? p.cantidad} de {p.cantidad}
                        {falt > 0 && <strong style={{ color: 'var(--at-danger)' }}> · faltan {falt}</strong>}
                        {p.fecha_devolucion && ` · ${p.fecha_devolucion}${p.hora_devolucion ? ` ${p.hora_devolucion.slice(0, 5)}` : ''}`}
                        {p.recibido_por && ` · recibió ${p.recibido_por}`}
                        {p.monto_reposicion != null && Number(p.monto_reposicion) > 0 && (
                          <strong style={{ color: 'var(--at-danger-strong)' }}> · reposición {moneda} {Number(p.monto_reposicion).toFixed(2)}{p.cuota_reposicion_id ? ' (cargo generado)' : ''}</strong>
                        )}
                      </>
                    )}
                  </div>
                  {p.observaciones && <div style={{ fontSize: 11.5, color: 'var(--at-ink-2)', marginTop: 2 }}>📝 {p.observaciones}</div>}
                  {p.observaciones_devolucion && <div style={{ fontSize: 11.5, color: 'var(--at-ink-2)', marginTop: 2 }}>↩ {p.observaciones_devolucion}</div>}
                </div>
              </div>
            )
          })}
          {resumen.reposicion > 0 && (
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--at-danger-strong)', padding: '4px 2px' }}>
              Reposición total: {moneda} {resumen.reposicion.toFixed(2)}
              {resumen.reposicionSinCargo > 0 && <span style={{ fontWeight: 500, color: 'var(--at-ink-3)' }}> · {moneda} {resumen.reposicionSinCargo.toFixed(2)} sin cargo a la unidad (puedes retenerlo del depósito)</span>}
            </div>
          )}
        </div>
      )}
      {lista.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>La reserva no pidió equipo{links.length > 0 ? '; puedes agregarlo aquí.' : '.'}</div>
      )}

      {canEdit && modo === 'ver' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {solicitados.length > 0 && (
            <button onClick={abrirEntrega} style={btnAction('var(--at-primary-tint)', 'var(--at-primary-soft-2)', 'var(--at-primary-hover)')}>📦 Registrar entrega</button>
          )}
          {prestados.length > 0 && (
            <button onClick={abrirRecepcion} style={btnAction('var(--at-success-tint)', 'var(--at-success-border)', 'var(--at-success-strong)')}>↩ Registrar recepción</button>
          )}
          {puedeAgregar && (
            <button onClick={() => setModo('agregar')} style={btnAction('var(--at-surface)', 'var(--at-line-strong)', 'var(--at-ink-2)')}>+ Agregar equipo</button>
          )}
        </div>
      )}

      {modo === 'agregar' && (
        <div style={{ marginTop: 10 }}>
          <SelectorEquiposReserva
            links={links} inventario={inventario} prestamos={prestamos} fecha={reserva.fecha} moneda={moneda}
            value={agregar} onChange={setAgregar} titulo="🪑 Agregar equipo a la reserva"
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button onClick={confirmarAgregar} disabled={saving || Object.keys(agregar).length === 0} style={btnAction('var(--at-primary-soft)', 'var(--at-accent-2)', 'var(--at-primary-hover)')}>
              {saving ? 'Guardando…' : 'Solicitar equipo'}
            </button>
            <button onClick={() => { setModo('ver'); setAgregar({}) }} style={btnAction('var(--at-surface)', 'var(--at-line-strong)', 'var(--at-ink-3)')}>Cancelar</button>
          </div>
        </div>
      )}

      {modo === 'entregar' && (
        <div style={{ marginTop: 10, background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--at-ink)', marginBottom: 8 }}>📦 Entrega de equipo</div>
          <div style={{ fontSize: 11.5, color: 'var(--at-ink-3)', marginBottom: 8 }}>Indica cuánto se entrega de cada equipo (0 = no se entregó). La fecha y hora las sella el sistema.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {solicitados.map(p => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--at-ink)' }}>
                <span style={{ flex: 1 }}>{p.equipo_nombre} <span style={{ color: 'var(--at-ink-3)', fontSize: 11.5 }}>(pedido {p.cantidad})</span></span>
                <input type="number" min={0} value={entrega[p.id] ?? ''} onChange={e => setEntrega(prev => ({ ...prev, [p.id]: e.target.value }))}
                  aria-label={`Cantidad entregada de ${p.equipo_nombre}`} style={{ ...inputStyle, width: 78, textAlign: 'right' }} />
              </label>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginTop: 10 }}>
            <input type="text" value={entregadoPor} onChange={e => setEntregadoPor(e.target.value)} placeholder="Entregado por (nombre)" aria-label="Entregado por" style={inputStyle} />
            <input type="text" value={entregaObs} onChange={e => setEntregaObs(e.target.value)} placeholder="Observaciones del estado al entregar" aria-label="Observaciones de la entrega" style={inputStyle} />
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <button onClick={confirmarEntrega} disabled={saving} style={btnAction('var(--at-primary-soft)', 'var(--at-accent-2)', 'var(--at-primary-hover)')}>{saving ? 'Guardando…' : 'Confirmar entrega'}</button>
            <button onClick={() => setModo('ver')} style={btnAction('var(--at-surface)', 'var(--at-line-strong)', 'var(--at-ink-3)')}>Cancelar</button>
          </div>
        </div>
      )}

      {modo === 'recibir' && (
        <div style={{ marginTop: 10, background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--at-ink)', marginBottom: 8 }}>↩ Recepción de equipo</div>
          <div style={{ fontSize: 11.5, color: 'var(--at-ink-3)', marginBottom: 8 }}>Cuánto volvió de cada equipo y en qué estado. La reposición se propone con los faltantes al costo congelado al prestar; puedes ajustarla.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {prestados.map(p => {
              const l = recepcion[p.id]
              if (!l) return null
              const sugerido = montoReposicionSugerido(p.cantidad, parseInt(l.devuelta) || 0, p.costo_reposicion_unitario)
              return (
                <div key={p.id} style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 8, padding: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--at-ink)', marginBottom: 6 }}>
                    {p.equipo_nombre} <span style={{ color: 'var(--at-ink-3)', fontSize: 11.5, fontWeight: 500 }}>entregado {p.cantidad}{p.costo_reposicion_unitario != null ? ` · ${moneda} ${Number(p.costo_reposicion_unitario).toFixed(2)} c/u` : ''}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                    <label style={{ fontSize: 11.5, color: 'var(--at-ink-2)', fontWeight: 600 }}>Devueltos
                      <input type="number" min={0} max={p.cantidad} value={l.devuelta} onChange={e => setLinea(p.id, { devuelta: e.target.value })} style={{ ...inputStyle, width: '100%', marginTop: 3 }} />
                    </label>
                    <label style={{ fontSize: 11.5, color: 'var(--at-ink-2)', fontWeight: 600 }}>Estado
                      <select value={l.estado} onChange={e => setLinea(p.id, { estado: e.target.value as EstadoCierre })} style={{ ...inputStyle, width: '100%', marginTop: 3 }}>
                        <option value="devuelto">Devuelto</option>
                        <option value="dañado">Dañado</option>
                        <option value="perdido">Perdido</option>
                      </select>
                    </label>
                    <label style={{ fontSize: 11.5, color: 'var(--at-ink-2)', fontWeight: 600 }}>Reposición ({moneda})
                      <input type="number" min={0} step="0.01" value={l.monto} placeholder={sugerido.toFixed(2)} onChange={e => setLinea(p.id, { monto: e.target.value })} style={{ ...inputStyle, width: '100%', marginTop: 3 }} />
                    </label>
                    <label style={{ fontSize: 11.5, color: 'var(--at-ink-2)', fontWeight: 600, gridColumn: '1 / -1' }}>Observaciones
                      <input type="text" value={l.obs} onChange={e => setLinea(p.id, { obs: e.target.value })} placeholder="Daños, limpieza, piezas faltantes…" style={{ ...inputStyle, width: '100%', marginTop: 3 }} />
                    </label>
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginTop: 10, alignItems: 'center' }}>
            <input type="text" value={recibidoPor} onChange={e => setRecibidoPor(e.target.value)} placeholder="Recibido por (nombre)" aria-label="Recibido por" style={inputStyle} />
            <div style={{ fontSize: 13, fontWeight: 700, color: totalRecepcion > 0 ? 'var(--at-danger-strong)' : 'var(--at-success-strong)' }}>
              {totalRecepcion > 0 ? `Reposición: ${moneda} ${totalRecepcion.toFixed(2)}` : 'Sin faltantes ni daños'}
            </div>
          </div>
          {totalRecepcion > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12.5, color: 'var(--at-ink-2)', cursor: 'pointer', fontWeight: 600 }}>
              <input type="checkbox" checked={generarCargo} onChange={e => setGenerarCargo(e.target.checked)} />
              Generar un cargo a la unidad por la reposición ({moneda} {totalRecepcion.toFixed(2)})
            </label>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <button onClick={confirmarRecepcion} disabled={saving} style={btnAction('var(--at-success-tint)', 'var(--at-success-border)', 'var(--at-success-strong)')}>{saving ? 'Guardando…' : 'Confirmar recepción'}</button>
            <button onClick={() => setModo('ver')} style={btnAction('var(--at-surface)', 'var(--at-line-strong)', 'var(--at-ink-3)')}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
