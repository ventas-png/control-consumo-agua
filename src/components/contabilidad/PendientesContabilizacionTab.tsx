// Pendientes de contabilización — facturas de proveedor APROBADAS SIN ASIENTO.
//
// El recorrido que esta pantalla sostiene: encontrar la factura, entender POR
// QUÉ no tiene asiento, ir a la pantalla donde eso se corrige, reprocesarla y
// ver el asiento que salió, sin perder el historial de intentos.
//
// Lo que esta pantalla NO decide: qué es un pendiente, qué motivo tiene, ni si
// el usuario puede reprocesar. Todo eso lo resuelve el servidor
// (`conta_facturas_pendientes` y `conta_reprocesar_factura_proveedor`), que
// además filtra y pagina. Ocultar el botón es cortesía; la autorización real
// está en la RPC, que la revalida aunque alguien fabrique la petición.
import { useEffect, useState } from 'react'
import { EditModal } from '../shared'
import { FilterChips } from '../shared/FilterChips'
import { StatusBadge } from '../shared/StatusBadge'
import { notify } from '../shared/Dialog'
import {
  PENDIENTES_POR_PAGINA,
  useFacturasPendientesQuery,
  useIntentosFacturaQuery,
} from '../../domain/contabilidad/queries'
import { useReprocesarFacturaMutation } from '../../domain/contabilidad/mutations'
import { formatCurrency, formatDateShort } from '../../lib/format'
import {
  CODIGO_PENDIENTE_LABELS,
  FILTROS_PENDIENTE,
  type CodigoPendiente,
  type FacturaPendiente,
  type FiltroPendiente,
  type RespuestaReproceso,
} from '../../types/contabilidad'
import { AsientoDetalleModal } from './AsientoDetalleModal'
import { btnLink, btnSecundario, input, usePermisosContabilidad } from './ui'

/** Pestañas de Contabilidad a las que la bandeja puede mandar a corregir. */
export type DestinoCorreccion = 'reglas' | 'configuracion' | 'catalogo' | 'cxp'

interface Props {
  companyId: string
  /** Ledger activo: null = contabilidad de la empresa. */
  projectId: string | null
  monedaBase: string
  /** Lleva a la pantalla autorizada donde se corrige la configuración. */
  onIrA?: (destino: DestinoCorreccion) => void
}

type Filtro = FiltroPendiente | 'todos'

const TONO: Record<CodigoPendiente, 'warning' | 'danger' | 'info' | 'neutral'> = {
  sin_cuenta: 'warning',
  cuenta_invalida: 'danger',
  configuracion_incompleta: 'warning',
  reparto_lineas: 'info',
  periodo_cerrado: 'info',
  documento_anulado: 'neutral',
  documento_no_aprobado: 'neutral',
  documento_inexistente: 'neutral',
  asiento_reversado: 'neutral',
  error: 'danger',
}

/**
 * Dónde se corrige cada motivo. `null` = no hay una configuración que tocar
 * (un período cerrado se resuelve con el cierre, no desde aquí).
 */
export function correccionPara(codigo: CodigoPendiente): { destino: DestinoCorreccion; etiqueta: string } | null {
  switch (codigo) {
    case 'sin_cuenta':
      return { destino: 'reglas', etiqueta: 'Configurar cuenta' }
    case 'cuenta_invalida':
      return { destino: 'catalogo', etiqueta: 'Revisar catálogo' }
    case 'configuracion_incompleta':
      return { destino: 'configuracion', etiqueta: 'Completar mapeo' }
    case 'reparto_lineas':
      return { destino: 'cxp', etiqueta: 'Revisar factura' }
    default:
      return null
  }
}

/** Texto para el aviso tras un reproceso. */
export function mensajeReproceso(r: RespuestaReproceso): { variant: 'success' | 'info' | 'warning'; title: string; text: string } {
  switch (r.resultado) {
    case 'contabilizada':
      return {
        variant: 'success',
        title: 'Factura contabilizada',
        text: r.asiento_estado === 'borrador'
          ? r.motivo ?? 'Se generó el asiento en borrador.'
          : `Se generó la póliza${r.asiento_numero != null ? ` #${r.asiento_numero}` : ''}.`,
      }
    case 'ya_contabilizada':
      return {
        variant: 'info',
        title: 'Ya estaba contabilizada',
        text: `No se generó nada nuevo${r.asiento_numero != null ? `: su póliza es la #${r.asiento_numero}` : ''}.`,
      }
    default:
      return {
        variant: 'warning',
        title: r.codigo ? CODIGO_PENDIENTE_LABELS[r.codigo] : 'Sigue pendiente',
        text: r.motivo ?? 'La factura sigue sin asiento.',
      }
  }
}

export function PendientesContabilizacionTab({ companyId, projectId, monedaBase, onIrA }: Props) {
  const { puedeCrear, puedeCambiarEstado } = usePermisosContabilidad()
  const permisoUI = puedeCrear && puedeCambiarEstado

  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [texto, setTexto] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(0)
  const [detalle, setDetalle] = useState<FacturaPendiente | null>(null)
  const [asientoAbierto, setAsientoAbierto] = useState<string | null>(null)
  const [enCurso, setEnCurso] = useState<string | null>(null)

  // La búsqueda va al servidor: se espera a que el usuario deje de teclear.
  useEffect(() => {
    const t = setTimeout(() => { setBusqueda(texto.trim()); setPagina(0) }, 350)
    return () => clearTimeout(t)
  }, [texto])

  const consulta = useFacturasPendientesQuery({
    companyId,
    projectId,
    codigo: filtro === 'todos' ? null : filtro,
    busqueda: busqueda || null,
    pagina,
  })
  const reprocesar = useReprocesarFacturaMutation(companyId)

  const filas = consulta.data?.filas ?? []
  const total = consulta.data?.total ?? 0
  const paginas = Math.max(1, Math.ceil(total / PENDIENTES_POR_PAGINA))

  // Si un reproceso vació la última página, retroceder en vez de mostrar vacío.
  useEffect(() => {
    if (!consulta.isFetching && pagina > 0 && filas.length === 0 && total > 0) {
      setPagina(Math.max(0, paginas - 1))
    }
  }, [consulta.isFetching, filas.length, pagina, paginas, total])

  async function onReprocesar(f: FacturaPendiente) {
    setEnCurso(f.factura_id)
    try {
      const r = await reprocesar.mutateAsync(f.factura_id)
      notify(mensajeReproceso(r))
      if (r.resultado === 'contabilizada' || r.resultado === 'ya_contabilizada') {
        setDetalle(null)
        if (r.asiento_id) setAsientoAbierto(r.asiento_id)
      }
    } catch (e) {
      notify({
        variant: 'error',
        title: 'No se pudo reprocesar',
        text: e instanceof Error ? e.message : 'Error desconocido.',
      })
    } finally {
      setEnCurso(null)
    }
  }

  function cambiarFiltro(f: Filtro) {
    setFiltro(f)
    setPagina(0)
  }

  const hayFiltro = filtro !== 'todos' || busqueda !== ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--at-space-3)' }}>
      <p style={{ margin: 0, color: 'var(--at-ink-soft)', fontSize: 13 }}>
        Facturas de proveedor <strong>aprobadas que no generaron asiento</strong> porque faltaba una
        cuenta o una configuración. Corrige la causa desde la pantalla indicada y reprocesa: se usa la
        misma lógica que al aprobar, sin cambiar la factura ni sus pagos.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <FilterChips<Filtro>
          options={[{ value: 'todos', label: 'Todos' }, ...FILTROS_PENDIENTE]}
          value={filtro}
          onChange={cambiarFiltro}
          ariaLabel="Filtrar pendientes por motivo"
        />
        <input
          type="search"
          aria-label="Buscar factura pendiente"
          placeholder="Buscar por proveedor, número o concepto…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          style={{ ...input, flex: 1, minWidth: 200, maxWidth: 360 }}
        />
      </div>

      {consulta.isError ? (
        <div role="alert" style={{ border: '1px solid var(--at-danger)', borderRadius: 12, padding: 16 }}>
          <strong>No se pudo cargar la bandeja.</strong>
          <p style={{ margin: '6px 0 10px', fontSize: 13 }}>
            {consulta.error instanceof Error ? consulta.error.message : 'Error desconocido.'}
          </p>
          <button type="button" style={btnSecundario} onClick={() => void consulta.refetch()}>Reintentar</button>
        </div>
      ) : consulta.isLoading ? (
        <p role="status" style={{ margin: 0 }}>Cargando pendientes…</p>
      ) : filas.length === 0 ? (
        <div role="status" style={{ border: '1px dashed var(--at-line)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
          <strong>{hayFiltro ? 'Nada coincide con el filtro' : 'Sin pendientes de contabilización'}</strong>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--at-ink-soft)' }}>
            {hayFiltro
              ? 'Prueba con otro motivo o quita la búsqueda.'
              : 'Todas las facturas aprobadas de esta contabilidad tienen su asiento.'}
          </p>
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <caption style={{ textAlign: 'left', fontSize: 12, color: 'var(--at-ink-soft)', paddingBottom: 6 }}>
                {total} factura{total === 1 ? '' : 's'} pendiente{total === 1 ? '' : 's'}
              </caption>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)', fontSize: 11, borderBottom: '1px solid var(--at-line)' }}>
                  <th style={{ padding: 6 }}>Factura</th>
                  <th style={{ padding: 6 }}>Fecha</th>
                  <th style={{ padding: 6, textAlign: 'right' }}>Importe</th>
                  <th style={{ padding: 6 }}>Motivo</th>
                  <th style={{ padding: 6 }}>Último intento</th>
                  <th style={{ padding: 6 }} aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const corr = correccionPara(f.codigo)
                  const puede = f.puede_reprocesar && permisoUI
                  return (
                    <tr key={f.factura_id} style={{ borderBottom: '1px solid var(--at-line)', verticalAlign: 'top' }}>
                      <td style={{ padding: 6 }}>
                        <div style={{ fontWeight: 600 }}>{f.proveedor_nombre ?? '—'}</div>
                        <div style={{ color: 'var(--at-ink-soft)' }}>
                          {f.numero_factura ? `#${f.numero_factura} · ` : ''}{f.concepto}
                        </div>
                      </td>
                      <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{formatDateShort(f.fecha_emision)}</td>
                      <td style={{ padding: 6, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {formatCurrency(f.monto_total, f.moneda ?? monedaBase)}
                      </td>
                      <td style={{ padding: 6, maxWidth: 360 }}>
                        <StatusBadge tone={TONO[f.codigo]}>{CODIGO_PENDIENTE_LABELS[f.codigo] ?? f.codigo}</StatusBadge>
                        {f.linea_numero != null && (
                          <span style={{ marginLeft: 6, fontSize: 12 }}>Línea {f.linea_numero}</span>
                        )}
                        <div style={{ fontSize: 12, marginTop: 4 }}>{f.motivo}</div>
                      </td>
                      <td style={{ padding: 6, whiteSpace: 'nowrap', fontSize: 12 }}>
                        {f.ultimo_intento_at ? formatDateShort(f.ultimo_intento_at) : '—'}
                        {f.ultimo_disparo && (
                          <div style={{ color: 'var(--at-ink-soft)' }}>
                            {f.ultimo_disparo === 'reproceso' ? 'Reproceso' : 'Aprobación'}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: 6 }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <button type="button" style={btnLink} onClick={() => setDetalle(f)}>Ver factura</button>
                          {corr && onIrA && (
                            <button type="button" style={btnLink} onClick={() => onIrA(corr.destino)}>{corr.etiqueta}</button>
                          )}
                          {puede && (
                            <button
                              type="button"
                              style={btnLink}
                              disabled={enCurso === f.factura_id}
                              aria-busy={enCurso === f.factura_id}
                              onClick={() => void onReprocesar(f)}
                            >
                              {enCurso === f.factura_id ? 'Reprocesando…' : 'Reprocesar'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {!permisoUI && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--at-ink-soft)' }}>
              Tu rol puede ver los pendientes pero no reprocesarlos: hace falta el permiso de crear y
              publicar pólizas en Contabilidad.
            </p>
          )}

          {paginas > 1 && (
            <nav aria-label="Paginación de pendientes" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
              <button type="button" style={btnSecundario} disabled={pagina === 0} onClick={() => setPagina((p) => Math.max(0, p - 1))}>
                Anterior
              </button>
              <span style={{ fontSize: 12 }}>Página {pagina + 1} de {paginas}</span>
              <button type="button" style={btnSecundario} disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)}>
                Siguiente
              </button>
            </nav>
          )}
        </>
      )}

      {detalle && (
        <DetallePendienteModal
          factura={detalle}
          monedaBase={monedaBase}
          puedeReprocesar={detalle.puede_reprocesar && permisoUI}
          reprocesando={enCurso === detalle.factura_id}
          onReprocesar={() => void onReprocesar(detalle)}
          onClose={() => setDetalle(null)}
        />
      )}
      {asientoAbierto && (
        <AsientoDetalleModal asientoId={asientoAbierto} monedaBase={monedaBase} onClose={() => setAsientoAbierto(null)} />
      )}
    </div>
  )
}

// ── Detalle: la factura y TODOS sus intentos ────────────────────────────────
function DetallePendienteModal({ factura, monedaBase, puedeReprocesar, reprocesando, onReprocesar, onClose }: {
  factura: FacturaPendiente
  monedaBase: string
  puedeReprocesar: boolean
  reprocesando: boolean
  onReprocesar: () => void
  onClose: () => void
}) {
  const intentos = useIntentosFacturaQuery(factura.factura_id)

  return (
    <EditModal
      title={`Factura ${factura.numero_factura ? `#${factura.numero_factura}` : factura.concepto}`}
      subtitle={factura.proveedor_nombre ?? undefined}
      onClose={onClose}
      size="md"
      footer={puedeReprocesar ? (
        <button type="button" style={btnSecundario} disabled={reprocesando} onClick={onReprocesar}>
          {reprocesando ? 'Reprocesando…' : 'Reprocesar'}
        </button>
      ) : undefined}
    >
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px', margin: 0, fontSize: 13 }}>
        <dt>Concepto</dt><dd style={{ margin: 0 }}>{factura.concepto}</dd>
        <dt>Fecha</dt><dd style={{ margin: 0 }}>{formatDateShort(factura.fecha_emision)}</dd>
        <dt>Importe</dt><dd style={{ margin: 0 }}>{formatCurrency(factura.monto_total, factura.moneda ?? monedaBase)}</dd>
        <dt>Estado</dt><dd style={{ margin: 0 }}>{factura.estado}</dd>
        <dt>Motivo</dt>
        <dd style={{ margin: 0 }}>
          {CODIGO_PENDIENTE_LABELS[factura.codigo] ?? factura.codigo}
          {factura.linea_numero != null && ` · Línea ${factura.linea_numero}${factura.linea_descripcion ? ` (${factura.linea_descripcion})` : ''}`}
          <div style={{ color: 'var(--at-ink-soft)' }}>{factura.motivo}</div>
        </dd>
      </dl>

      <h4 style={{ margin: '16px 0 6px', fontSize: 14 }}>Intentos de contabilización</h4>
      {intentos.isLoading ? (
        <p role="status" style={{ margin: 0 }}>Cargando historial…</p>
      ) : intentos.isError ? (
        <p role="alert" style={{ margin: 0 }}>No se pudo cargar el historial.</p>
      ) : (intentos.data ?? []).length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--at-ink-soft)' }}>
          Sin intentos en la bitácora nueva: esta factura se aprobó antes de que existiera. Su motivo
          sale de la bitácora de resoluciones.
        </p>
      ) : (
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
          {(intentos.data ?? []).map((i) => (
            <li key={i.id} style={{ marginBottom: 6 }}>
              <strong>{formatDateShort(i.created_at)}</strong> · {i.disparo === 'reproceso' ? 'Reproceso' : 'Aprobación'} ·{' '}
              {i.resultado === 'contabilizada' ? 'Contabilizada'
                : i.resultado === 'ya_contabilizada' ? 'Ya contabilizada'
                  : i.codigo ? CODIGO_PENDIENTE_LABELS[i.codigo] : i.resultado}
              {i.motivo && <div style={{ color: 'var(--at-ink-soft)' }}>{i.motivo}</div>}
            </li>
          ))}
        </ol>
      )}
    </EditModal>
  )
}
