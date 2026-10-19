// «Antes de iniciar»: lo que hay que tener a mano para el turno, para marcar
// una por una y recién entonces iniciarlo. Antes, «▶ Iniciar» arrancaba el turno
// de un clic y las indicaciones de seguridad aparecían recién al abrir cada
// tarea —o sea, ya en el área y sin el rótulo, sin el insumo, sin la escoba—.
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  duracionLegible, itemsPorConfirmar, type PreparacionTurno as Preparacion,
} from '../../../../domain/condominios/ejecucionGuiada'

interface Props {
  persona: string
  /** null = todavía cargando las herramientas. */
  prep: Preparacion | null
  /** No se pudo leer la receta de herramientas: se avisa, no se oculta. */
  errorHerramientas?: string | null
  iniciando: boolean
  onIniciar: () => void
  onCancelar: () => void
}

const seccion: CSSProperties = { margin: '14px 0 6px', fontSize: '12.5px', fontWeight: 700, color: 'var(--at-ink-2)' }

export function PreparacionTurno({ persona, prep, errorHerramientas, iniciando, onIniciar, onCancelar }: Props) {
  const [tengo, setTengo] = useState<Set<string>>(new Set())
  const items = useMemo(() => (prep ? itemsPorConfirmar(prep) : []), [prep])
  const faltan = items.filter(k => !tengo.has(k)).length

  const marcar = (clave: string) => setTengo(s => {
    const n = new Set(s)
    if (n.has(clave)) n.delete(clave); else n.add(clave)
    return n
  })

  // Función y no componente: un componente declarado acá se remontaría en cada
  // render y el checkbox perdería el foco al marcarlo.
  const item = (clave: string, contenido: ReactNode, detalle?: string) => {
    const hecho = tengo.has(clave)
    return (
      <label key={clave} style={{
        display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '9px 11px', marginBottom: '6px',
        background: hecho ? 'var(--at-success-tint)' : 'var(--at-surface)',
        border: `1px solid ${hecho ? 'var(--at-success-border)' : 'var(--at-line)'}`, borderRadius: '10px', cursor: 'pointer',
      }}>
        <input type="checkbox" checked={hecho} onChange={() => marcar(clave)} style={{ marginTop: '2px', width: '18px', height: '18px', flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: '13.5px', color: 'var(--at-ink)', fontWeight: 600 }}>{contenido}</span>
          {detalle && <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{detalle}</span>}
        </span>
      </label>
    )
  }

  const para = (tareas: string[]) =>
    `Para: ${tareas.slice(0, 3).join(', ')}${tareas.length > 3 ? ` y ${tareas.length - 3} más` : ''}`

  return (
    <section aria-label="Antes de iniciar el turno" className="shared-card-in"
      style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-primary-soft-2)', borderRadius: '14px', padding: '16px' }}>
      <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>🧰 Antes de iniciar el turno</h3>
      {!prep ? (
        <p role="status" style={{ margin: '8px 0 0', fontSize: '13px', color: 'var(--at-ink-3)' }}>Revisando qué hace falta…</p>
      ) : (
        <>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--at-ink-2)' }}>
            {persona} tiene <strong>{prep.pendientes} tarea{prep.pendientes !== 1 ? 's' : ''}</strong>
            {prep.paradas.length > 0 && <> en <strong>{prep.paradas.length} área{prep.paradas.length !== 1 ? 's' : ''}</strong></>}
            {prep.minutos > 0 && <> · unos {duracionLegible(prep.minutos)}</>}
            {prep.sinDuracion > 0 && <span style={{ color: 'var(--at-ink-3)' }}> ({prep.sinDuracion} sin tiempo estimado)</span>}.
          </p>
          <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
            {items.length > 0
              ? 'Marcá cada cosa cuando ya la tengas lista. Al terminar, confirmá para iniciar.'
              : 'Este turno no pide herramientas, insumos ni indicaciones previas.'}
          </p>

          {errorHerramientas && (
            <div role="alert" style={{ marginTop: '10px', padding: '8px 10px', background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: '8px', fontSize: '12.5px', color: 'var(--at-warning-strong)' }}>
              No se pudieron leer las herramientas de las actividades ({errorHerramientas}). Revisalas con quien programa antes de salir.
            </div>
          )}

          {prep.herramientas.length > 0 && (
            <>
              <div style={seccion}>🧰 Herramientas y equipo</div>
              {prep.herramientas.map(h => item(
                `herramienta:${h.inventario_id}`,
                <>
                  {h.nombre}{h.cantidad > 1 ? ` ×${h.cantidad}` : ''}
                  {h.obligatoria && <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: 700, color: 'var(--at-danger)' }}>Obligatoria</span>}
                </>,
                para(h.tareas),
              ))}
            </>
          )}

          {prep.insumos.length > 0 && (
            <>
              <div style={seccion}>🧴 Insumos</div>
              {prep.insumos.map(i => item(`insumo:${i.suministro_id}`, `${i.nombre} — ${i.cantidad} ${i.unidad}`, para(i.tareas)))}
            </>
          )}

          {prep.indicaciones.length > 0 && (
            <>
              <div style={seccion}>🦺 Indicaciones antes de empezar</div>
              {prep.indicaciones.map((ind, n) => item(`indicacion:${n}`, ind.texto, para(ind.tareas)))}
            </>
          )}

          {prep.conFoto > 0 && (
            <>
              <div style={seccion}>📷 Evidencia</div>
              {item('camara', 'Teléfono con cámara y batería', `${prep.conFoto} tarea${prep.conFoto !== 1 ? 's piden' : ' pide'} foto al terminar.`)}
            </>
          )}

          {prep.paradas.length > 0 && (
            <>
              <div style={seccion}>🗺️ Recorrido</div>
              <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '12.5px', color: 'var(--at-ink-2)' }}>
                {prep.paradas.map(p => (
                  <li key={p.clave} style={{ marginBottom: '2px' }}>
                    {p.icono} <strong>{p.nombre}</strong> · {p.tareas.length} tarea{p.tareas.length !== 1 ? 's' : ''}
                    {p.minutos > 0 && ` · ${duracionLegible(p.minutos)}`}
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: '16px' }}>
        <button onClick={onCancelar} disabled={iniciando}
          style={{ padding: '10px 16px', background: 'var(--at-surface)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line)', borderRadius: '9px', cursor: 'pointer', fontSize: '13.5px' }}>
          Todavía no
        </button>
        <button onClick={onIniciar} disabled={!prep || faltan > 0 || iniciando}
          style={{
            flex: '1 1 220px', maxWidth: '340px', padding: '10px 16px', border: 'none', borderRadius: '9px', fontSize: '14px', fontWeight: 700,
            cursor: !prep || faltan > 0 || iniciando ? 'default' : 'pointer',
            background: !prep || faltan > 0 ? 'var(--at-chip)' : 'var(--at-success)',
            color: !prep || faltan > 0 ? 'var(--at-ink-3)' : 'var(--at-on-status)',
          }}>
          {iniciando ? 'Iniciando…' : faltan > 0 ? `Falta confirmar ${faltan}` : '✓ Tengo todo · Iniciar turno'}
        </button>
      </div>
    </section>
  )
}
