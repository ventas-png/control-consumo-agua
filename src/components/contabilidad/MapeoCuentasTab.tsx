import { useMemo } from 'react'
import { notify } from '../shared/Dialog'
import {
  useCuentasEspecialesQuery,
  useCuentasQuery,
  useMapeoQuery,
} from '../../domain/contabilidad/queries'
import {
  useGuardarMapeoMutation,
  useQuitarMapeoMutation,
} from '../../domain/contabilidad/mutations'
import {
  ESTADO_CUENTA_ESPECIAL_LABELS,
  EVENTOS_MAPEO,
  MSG_CONFIG_CONTABLE_INCOMPLETA,
} from '../../types/contabilidad'
import { input } from './ui'
import { TiposCambioMensualSection } from './TiposCambioMensualSection'

interface Props {
  companyId: string
  /** Ledger activo: null = contabilidad de la empresa. */
  projectId: string | null
  monedaBase: string
}

/**
 * Configuración del módulo, SIEMPRE sobre el ledger activo (`projectId` NULL =
 * contabilidad de la empresa; con valor = la de ese proyecto):
 *   1. Cuentas especiales del SISTEMA — las que el motor necesita para operar
 *      (cierre anual, revaluación, apertura, puente de compras). Antes se
 *      buscaban por su código del catálogo sembrado; ahora se eligen aquí, y
 *      la sección dice claramente cuáles faltan y por qué.
 *   2. Mapeo evento de negocio → cuenta que usan los asientos automáticos.
 *   3. Tipos de cambio MENSUALES de la empresa (20261008000000).
 *
 * Sólo se ofrecen cuentas ACTIVAS, DE DETALLE y DEL MISMO LEDGER: son las tres
 * condiciones que el servidor exige para resolver, así que ofrecer otra cosa
 * sería ofrecer una configuración que no va a funcionar.
 */
export function MapeoCuentasTab({ companyId, projectId, monedaBase }: Props) {
  const { data: cuentas = [] } = useCuentasQuery(companyId, projectId)
  const { data: mapeos = [] } = useMapeoQuery(companyId, projectId)
  const { data: especiales = [] } = useCuentasEspecialesQuery(companyId, projectId)
  const guardarMapeo = useGuardarMapeoMutation(companyId)
  const quitarMapeo = useQuitarMapeoMutation(companyId)

  const detalle = useMemo(() => cuentas.filter((c) => c.es_detalle && c.activa), [cuentas])
  // `useMapeoQuery` ya trae SÓLO las filas del ledger activo (project_id NULL
  // o exacto). Filtrar aquí otra vez por `!x.project_id` dejaba la pantalla de
  // un proyecto siempre vacía y, al guardar, escribía sobre la empresa.
  const mapeoLedger = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of mapeos) m.set(x.evento, x.cuenta_id)
    return m
  }, [mapeos])

  // Las especiales tienen su propia sección: mostrarlas también aquí daría dos
  // controles para la misma cuenta, que es como se configuran cosas distintas
  // sin querer.
  const eventosEspeciales = useMemo(
    () => new Set(especiales.map((e) => e.evento)),
    [especiales],
  )

  const faltantes = useMemo(() => especiales.filter((e) => e.estado !== 'ok'), [especiales])

  const grupos = useMemo(() => {
    const g = new Map<string, typeof EVENTOS_MAPEO[number][]>()
    for (const e of EVENTOS_MAPEO) {
      if (eventosEspeciales.has(e.evento)) continue
      const arr = g.get(e.grupo) ?? []
      arr.push(e)
      g.set(e.grupo, arr)
    }
    return [...g.entries()]
  }, [eventosEspeciales])

  async function onCambioMapeo(evento: string, cuentaId: string) {
    // La opción vacía es «sin asignar», y significa DESASIGNAR: antes se salía
    // con un `return` y el select rebotaba al valor anterior, así que no había
    // forma de deshacer un mapeo desde la pantalla que lo configura.
    try {
      // El ledger activo, siempre explícito —tanto al guardar como al quitar—:
      // sin `projectId` la escritura caía en la contabilidad de la empresa
      // aunque se estuviera configurando un proyecto.
      if (cuentaId) {
        await guardarMapeo.mutateAsync({ evento, cuentaId, projectId })
        notify({ variant: 'success', title: 'Guardado', text: 'Mapeo actualizado.' })
      } else {
        await quitarMapeo.mutateAsync({ evento, projectId })
        notify({ variant: 'success', title: 'Desasignado', text: 'El evento quedó sin cuenta.' })
      }
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo guardar el mapeo.' })
    }
  }



  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.4fr) minmax(280px, 1fr)', gap: 'var(--at-space-5)', alignItems: 'start' }}>
      {/* ── Cuentas especiales del sistema ── */}
      <section style={{ gridColumn: '1 / -1' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Cuentas especiales del sistema</h3>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--at-ink-soft)' }}>
          Cuentas que el módulo necesita para operar. No dependen del código del
          catálogo: se eligen aquí, dentro de esta contabilidad. Sólo aparecen
          cuentas activas y de detalle del ledger activo.
        </p>

        {faltantes.length > 0 && (
          <div
            role="status"
            style={{
              marginBottom: 12, padding: '8px 10px', borderRadius: 8, fontSize: 12,
              border: '1px solid var(--at-warning)', color: 'var(--at-ink)',
            }}
          >
            <strong>{MSG_CONFIG_CONTABLE_INCOMPLETA}:</strong>{' '}
            {faltantes.length === 1 ? 'falta 1 cuenta' : `faltan ${faltantes.length} cuentas`}
            {' '}({faltantes.map((f) => f.etiqueta).join(', ')}).
            {faltantes.some((f) => f.bloqueante) &&
              ' Los procesos que la necesitan no se ejecutarán hasta asignarla; el resto de la operación no se ve afectada.'}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {especiales.map((e) => (
            <div
              key={e.evento}
              style={{ display: 'grid', gridTemplateColumns: '220px 1fr 180px', gap: 8, alignItems: 'center' }}
            >
              <span style={{ fontSize: 13 }}>
                {e.etiqueta}
                <span style={{ display: 'block', fontSize: 11, color: 'var(--at-ink-soft)' }}>{e.proceso}</span>
              </span>
              <select
                value={e.cuenta_id ?? ''}
                onChange={(ev) => void onCambioMapeo(e.evento, ev.target.value)}
                style={input}
                aria-label={`Cuenta para ${e.etiqueta}`}
              >
                <option value="">— sin asignar —</option>
                {detalle.map((c) => (
                  <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
                ))}
              </select>
              <span
                style={{
                  fontSize: 11,
                  color: e.estado === 'ok' ? 'var(--at-success)' : 'var(--at-warning)',
                }}
              >
                {ESTADO_CUENTA_ESPECIAL_LABELS[e.estado]}
                {e.estado !== 'ok' && e.bloqueante ? ' · requerida' : ''}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Mapeo evento → cuenta ── */}
      <section>
        <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Cuentas por evento</h3>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--at-ink-soft)' }}>
          Define a qué cuenta va cada evento de negocio. Los asientos automáticos
          (pagos, gastos, facturas, cuotas) usan este mapeo; si falta uno, ese
          evento no se contabiliza.
        </p>
        {grupos.map(([grupo, eventos]) => (
          <div key={grupo} style={{ marginBottom: 14 }}>
            <h4 style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--at-ink-soft)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{grupo}</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {eventos.map((e) => (
                <div key={e.evento} style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 13 }}>{e.label}</span>
                  <select
                    value={mapeoLedger.get(e.evento) ?? ''}
                    onChange={(ev) => void onCambioMapeo(e.evento, ev.target.value)}
                    style={input}
                    aria-label={`Cuenta para ${e.label}`}
                  >
                    <option value="">— sin mapear —</option>
                    {detalle.map((c) => (
                      <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* ── Tipos de cambio (mensuales, 20261008000000) ── */}
      <TiposCambioMensualSection companyId={companyId} monedaLedger={monedaBase} />
    </div>
  )
}
