// Cargos pendientes de contabilización — cuotas clasificadas, su mora y
// cargos adicionales cuyo asiento NO se generó.
//
// El recorrido es el mismo que el de las facturas: encontrar el cargo,
// entender por qué no tiene asiento, ir a corregirlo (casi siempre, la
// configuración del tipo de cargo), reprocesar y ver la póliza que salió.
//
// Lo que esta pantalla NO decide: qué es un pendiente, su motivo ni si el
// usuario puede reprocesar. Lo resuelven `conta_cargos_pendientes` y
// `conta_reprocesar_cargo`, que además filtran, paginan y revalidan permisos.
// Nada de lo anterior a la contabilización por tipo aparece aquí: no se
// contabiliza retroactivamente.
import { useEffect, useState } from 'react'
import { FilterChips } from '../shared/FilterChips'
import { StatusBadge } from '../shared/StatusBadge'
import { notify } from '../shared/Dialog'
import { PENDIENTES_POR_PAGINA, useCargosPendientesQuery } from '../../domain/contabilidad/queries'
import { useReprocesarCargoMutation } from '../../domain/contabilidad/mutations'
import { formatCurrency, formatDateShort } from '../../lib/format'
import {
  CODIGO_CARGO_LABELS,
  EVENTO_CARGO_LABELS,
  FILTROS_CARGO_PENDIENTE,
  type CargoPendiente,
  type CodigoCargoPendiente,
  type FiltroCargoPendiente,
  type RespuestaReprocesoCargo,
} from '../../types/contabilidad'
import { AsientoDetalleModal } from './AsientoDetalleModal'
import { btnLink, btnSecundario, input, usePermisosContabilidad } from './ui'

interface Props {
  companyId: string
  /** Ledger activo: null = contabilidad de la empresa. */
  projectId: string | null
  monedaBase: string
  /** Lleva a la pestaña donde se configura el tipo de cargo. */
  onIrATiposCargo?: () => void
}

type Filtro = FiltroCargoPendiente | 'todos'

const TONO: Record<CodigoCargoPendiente, 'warning' | 'danger' | 'info' | 'neutral'> = {
  sin_configuracion: 'warning',
  cuenta_invalida: 'danger',
  sin_responsable: 'warning',
  periodo_cerrado: 'info',
  devengo_pendiente: 'warning',
  excede_saldo: 'danger',
  cobro_anterior_pendiente: 'info',
  sin_cuenta: 'warning',
  documento_anulado: 'neutral',
  documento_inexistente: 'neutral',
  documento_anterior: 'neutral',
  asiento_reversado: 'neutral',
  error: 'danger',
}

/** Motivos que se corrigen en la configuración por tipo de cargo. */
export function seCorrigeEnTiposCargo(codigo: CodigoCargoPendiente): boolean {
  return codigo === 'sin_configuracion' || codigo === 'cuenta_invalida'
}

/**
 * Aviso tras reprocesar. El servidor devuelve una fila por evento: manda el
 * peor resultado (algo que sigue pendiente pesa más que lo ya contabilizado).
 */
export function mensajeReprocesoCargo(filas: RespuestaReprocesoCargo[]): {
  variant: 'success' | 'info' | 'warning'; title: string; text: string
} {
  const fallida = filas.find((f) => f.resultado === 'pendiente' || f.resultado === 'bloqueada')
  if (fallida) {
    return {
      variant: 'warning',
      title: fallida.codigo ? CODIGO_CARGO_LABELS[fallida.codigo] : 'Sigue pendiente',
      text: fallida.motivo ?? 'El cargo sigue sin asiento.',
    }
  }
  const nuevas = filas.filter((f) => f.resultado === 'contabilizada')
  if (nuevas.length > 0) {
    const borrador = nuevas.find((f) => f.asiento_estado === 'borrador')
    const numeros = nuevas.flatMap((f) => (f.asiento_numero != null ? [`#${f.asiento_numero}`] : []))
    return {
      variant: 'success',
      title: 'Cargo contabilizado',
      text: borrador
        ? borrador.motivo ?? 'Se generó el asiento en borrador.'
        : numeros.length > 0
          ? `Se generó ${numeros.length === 1 ? 'la póliza' : 'las pólizas'} ${numeros.join(', ')}.`
          : 'Se generó el asiento.',
    }
  }
  return { variant: 'info', title: 'Ya estaba contabilizado', text: 'No se generó nada nuevo.' }
}

export function CargosPendientesTab({ companyId, projectId, monedaBase, onIrATiposCargo }: Props) {
  const { puedeCrear, puedeCambiarEstado } = usePermisosContabilidad()
  const permisoUI = puedeCrear && puedeCambiarEstado

  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [texto, setTexto] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(0)
  const [asientoAbierto, setAsientoAbierto] = useState<string | null>(null)
  const [enCurso, setEnCurso] = useState<string | null>(null)

  // La búsqueda va al servidor: se espera a que el usuario deje de teclear.
  useEffect(() => {
    const t = setTimeout(() => { setBusqueda(texto.trim()); setPagina(0) }, 350)
    return () => clearTimeout(t)
  }, [texto])

  const consulta = useCargosPendientesQuery({
    companyId,
    projectId,
    codigo: filtro === 'todos' ? null : filtro,
    busqueda: busqueda || null,
    pagina,
  })
  const reprocesar = useReprocesarCargoMutation(companyId)

  const filas = consulta.data?.filas ?? []
  const total = consulta.data?.total ?? 0
  const paginas = Math.max(1, Math.ceil(total / PENDIENTES_POR_PAGINA))

  useEffect(() => {
    if (!consulta.isFetching && pagina > 0 && filas.length === 0 && total > 0) {
      setPagina(Math.max(0, paginas - 1))
    }
  }, [consulta.isFetching, filas.length, pagina, paginas, total])

  async function onReprocesar(c: CargoPendiente) {
    const clave = `${c.origen_id}:${c.evento}`
    setEnCurso(clave)
    try {
      const r = await reprocesar.mutateAsync({ origen_tabla: c.origen_tabla, origen_id: c.origen_id })
      notify(mensajeReprocesoCargo(r))
      const nueva = r.find((f) => f.resultado === 'contabilizada' && f.asiento_id)
      if (nueva?.asiento_id) setAsientoAbierto(nueva.asiento_id)
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
        Cuotas clasificadas, su mora y cargos adicionales <strong>que no generaron asiento</strong>,
        casi siempre porque su tipo de cargo no está configurado. Corrige la causa y reprocesa: se usa
        la misma lógica que al emitirlos. Los cargos anteriores a esta contabilización no aparecen: no
        se contabilizan retroactivamente.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <FilterChips<Filtro>
          options={[{ value: 'todos', label: 'Todos' }, ...FILTROS_CARGO_PENDIENTE]}
          value={filtro}
          onChange={cambiarFiltro}
          ariaLabel="Filtrar cargos pendientes por motivo"
        />
        <input
          type="search"
          aria-label="Buscar cargo pendiente"
          placeholder="Buscar por concepto, unidad o responsable…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          style={{ ...input, flex: 1, minWidth: 200, maxWidth: 360 }}
        />
      </div>

      {consulta.isError ? (
        <div role="alert" style={{ border: '1px solid var(--at-danger)', borderRadius: 12, padding: 16 }}>
          <strong>No se pudo cargar la bandeja de cargos.</strong>
          <p style={{ margin: '6px 0 10px', fontSize: 13 }}>
            {consulta.error instanceof Error ? consulta.error.message : 'Error desconocido.'}
          </p>
          <button type="button" style={btnSecundario} onClick={() => void consulta.refetch()}>Reintentar</button>
        </div>
      ) : consulta.isLoading ? (
        <p role="status" style={{ margin: 0 }}>Cargando cargos pendientes…</p>
      ) : filas.length === 0 ? (
        <div role="status" style={{ border: '1px dashed var(--at-line)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
          <strong>{hayFiltro ? 'Nada coincide con el filtro' : 'Sin cargos pendientes'}</strong>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--at-ink-soft)' }}>
            {hayFiltro
              ? 'Prueba con otro motivo o quita la búsqueda.'
              : 'Todos los cargos contabilizables de esta contabilidad tienen su asiento.'}
          </p>
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <caption style={{ textAlign: 'left', fontSize: 12, color: 'var(--at-ink-soft)', paddingBottom: 6 }}>
                {total} cargo{total === 1 ? '' : 's'} pendiente{total === 1 ? '' : 's'}
              </caption>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)', fontSize: 11, borderBottom: '1px solid var(--at-line)' }}>
                  <th style={{ padding: 6 }}>Cargo</th>
                  <th style={{ padding: 6 }}>Unidad · responsable</th>
                  <th style={{ padding: 6 }}>Fecha</th>
                  <th style={{ padding: 6, textAlign: 'right' }}>Importe</th>
                  <th style={{ padding: 6 }}>Motivo</th>
                  <th style={{ padding: 6 }} aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {filas.map((c) => {
                  const clave = `${c.origen_id}:${c.evento}`
                  const puede = c.puede_reprocesar && permisoUI
                  return (
                    <tr key={clave} style={{ borderBottom: '1px solid var(--at-line)', verticalAlign: 'top' }}>
                      <td style={{ padding: 6 }}>
                        <div style={{ fontWeight: 600 }}>{c.concepto}</div>
                        <div style={{ color: 'var(--at-ink-soft)' }}>{EVENTO_CARGO_LABELS[c.evento] ?? c.evento}</div>
                      </td>
                      <td style={{ padding: 6 }}>
                        <div>{c.unidad_nombre ?? '—'}</div>
                        <div style={{ color: 'var(--at-ink-soft)' }}>{c.responsable_nombre ?? 'Sin responsable'}</div>
                      </td>
                      <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{formatDateShort(c.fecha)}</td>
                      <td style={{ padding: 6, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {formatCurrency(c.monto, monedaBase)}
                      </td>
                      <td style={{ padding: 6, maxWidth: 360 }}>
                        <StatusBadge tone={TONO[c.codigo] ?? 'neutral'}>{CODIGO_CARGO_LABELS[c.codigo] ?? c.codigo}</StatusBadge>
                        <div style={{ fontSize: 12, marginTop: 4 }}>{c.motivo}</div>
                      </td>
                      <td style={{ padding: 6 }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          {seCorrigeEnTiposCargo(c.codigo) && onIrATiposCargo && (
                            <button type="button" style={btnLink} onClick={onIrATiposCargo}>Configurar tipo</button>
                          )}
                          {puede && (
                            <button
                              type="button"
                              style={btnLink}
                              disabled={enCurso === clave}
                              aria-busy={enCurso === clave}
                              onClick={() => void onReprocesar(c)}
                            >
                              {enCurso === clave ? 'Reprocesando…' : 'Reprocesar'}
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
              Tu rol puede ver los cargos pendientes pero no reprocesarlos: hace falta el permiso de
              crear y publicar pólizas en Contabilidad.
            </p>
          )}

          {paginas > 1 && (
            <nav aria-label="Paginación de cargos pendientes" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
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

      {asientoAbierto && (
        <AsientoDetalleModal asientoId={asientoAbierto} monedaBase={monedaBase} onClose={() => setAsientoAbierto(null)} />
      )}
    </div>
  )
}
