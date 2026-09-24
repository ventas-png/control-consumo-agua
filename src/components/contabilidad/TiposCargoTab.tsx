// Tipos de cargo — configuración contable por tipo, del LEDGER activo.
//
// Una fila por tipo del catálogo que declara el servidor (`conta_tipos_cargo`),
// configurado o no, con tres cuentas: por cobrar, de ingreso y —sólo donde el
// sistema ya calcula un impuesto, agua— de impuesto.
//
// Lo que esta pantalla NO hace:
//   · validar. Cuenta activa, de detalle, del mismo ledger y del tipo contable
//     correcto lo decide el trigger `conta_tg_config_tipo_cargo`; los selects
//     sólo filtran para no ofrecer lo que el servidor va a rechazar, y si aun
//     así rechaza, se muestra su mensaje;
//   · elegir cuentas por nombre ni por código: el usuario elige;
//   · autorizar. Guardar exige crear (sin configuración) o editar (con ella);
//     Quitar exige eliminar. Sin permiso las acciones se ocultan y los campos
//     quedan de sólo lectura, pero quien decide sigue siendo la RLS: una
//     escritura que no afecte exactamente una fila se trata como rechazo y el
//     borrador se conserva;
//   · contabilizar. Esta configuración todavía no la consume ningún documento:
//     los cargos se contabilizarán con ella en la siguiente entrega. La
//     pantalla lo dice, para no prometer un asiento que no ocurre.
import { useMemo, useState } from 'react'
import { useConfigTiposCargoQuery, useCuentasQuery } from '../../domain/contabilidad/queries'
import {
  useEliminarConfigTipoCargoMutation,
  useGuardarConfigTipoCargoMutation,
} from '../../domain/contabilidad/mutations'
import { usePermisosContabilidad } from './ui'
import type {
  ConfigTipoCargoEstado,
  CuentaContable,
  EstadoConfigTipoCargo,
} from '../../types/contabilidad'

interface Props {
  companyId?: string
  projectId?: string | null
}

const card: React.CSSProperties = {
  border: '1px solid var(--at-line)',
  borderRadius: 12,
  padding: 16,
  background: 'var(--at-surface)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid var(--at-line)',
  borderRadius: 6,
  background: 'var(--at-surface)',
  color: 'inherit',
  minWidth: 160,
  maxWidth: '100%',
}

export const ETIQUETA_ESTADO_CONFIG: Record<EstadoConfigTipoCargo, string> = {
  ok: 'Configurado',
  sin_configurar: 'Sin configurar',
  cuenta_invalida: 'Cuenta inválida',
  inactiva: 'Desactivado',
}

/**
 * Mensaje legible de un rechazo del servidor. Los triggers anteponen un código
 * (`CONFIG_CUENTA_INACTIVA: …`) que sirve para las pruebas, no para la persona.
 */
export function mensajeServidor(e: unknown): string {
  const texto = e instanceof Error ? e.message : String(e ?? '')
  if (/row-level security/i.test(texto)) {
    return 'No tienes permiso para cambiar la configuración contable de esta empresa.'
  }
  return texto.replace(/^[A-Z_]+:\s*/, '') || 'No se pudo guardar.'
}

interface Borrador {
  cxc: string
  ingreso: string
  impuesto: string
  activa: boolean
}

function borradorDe(fila: ConfigTipoCargoEstado): Borrador {
  return {
    cxc: fila.cuenta_cxc_id ?? '',
    ingreso: fila.cuenta_ingreso_id ?? '',
    impuesto: fila.cuenta_impuesto_id ?? '',
    activa: fila.activa ?? true,
  }
}

export function TiposCargoTab({ companyId, projectId }: Props) {
  const estado = useConfigTiposCargoQuery(companyId, projectId)
  const cuentas = useCuentasQuery(companyId, projectId)
  const guardar = useGuardarConfigTipoCargoMutation(companyId, projectId)
  const quitar = useEliminarConfigTipoCargoMutation(companyId)
  const { puedeCrear, puedeEditar, puedeEliminar } = usePermisosContabilidad()
  const soloLectura = !puedeCrear && !puedeEditar && !puedeEliminar

  // Sólo cuentas que pueden recibir el movimiento: de detalle, activas y del
  // tipo contable que cada columna exige. El servidor valida lo mismo.
  const porTipo = useMemo(() => {
    const imputables = (cuentas.data ?? []).filter((c) => c.es_detalle && c.activa)
    const de = (tipo: CuentaContable['tipo']) => imputables.filter((c) => c.tipo === tipo)
    return { activo: de('activo'), ingreso: de('ingreso'), pasivo: de('pasivo') }
  }, [cuentas.data])

  const [borradores, setBorradores] = useState<Record<string, Borrador>>({})
  const [errores, setErrores] = useState<Record<string, string>>({})

  function borrador(fila: ConfigTipoCargoEstado): Borrador {
    return borradores[fila.tipo_cargo] ?? borradorDe(fila)
  }
  function editar(tipo: string, fila: ConfigTipoCargoEstado, cambio: Partial<Borrador>) {
    setBorradores((b) => ({ ...b, [tipo]: { ...(b[tipo] ?? borradorDe(fila)), ...cambio } }))
  }

  async function guardarFila(fila: ConfigTipoCargoEstado) {
    const b = borrador(fila)
    setErrores((e) => ({ ...e, [fila.tipo_cargo]: '' }))
    if (!b.cxc || !b.ingreso) {
      setErrores((e) => ({ ...e, [fila.tipo_cargo]: 'Elige la cuenta por cobrar y la de ingreso.' }))
      return
    }
    try {
      await guardar.mutateAsync({
        id: fila.config_id,
        tipo_cargo: fila.tipo_cargo,
        cuenta_cxc_id: b.cxc,
        cuenta_ingreso_id: b.ingreso,
        cuenta_impuesto_id: fila.admite_impuesto && b.impuesto ? b.impuesto : null,
        activa: b.activa,
      })
      setBorradores((prev) => {
        const { [fila.tipo_cargo]: _hecho, ...resto } = prev
        return resto
      })
    } catch (e) {
      setErrores((prev) => ({ ...prev, [fila.tipo_cargo]: mensajeServidor(e) }))
    }
  }

  async function quitarFila(fila: ConfigTipoCargoEstado) {
    if (!fila.config_id) return
    setErrores((e) => ({ ...e, [fila.tipo_cargo]: '' }))
    try {
      await quitar.mutateAsync(fila.config_id)
      setBorradores((prev) => {
        const { [fila.tipo_cargo]: _quitado, ...resto } = prev
        return resto
      })
    } catch (e) {
      setErrores((prev) => ({ ...prev, [fila.tipo_cargo]: mensajeServidor(e) }))
    }
  }

  const filas = estado.data ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--at-space-3)' }}>
      <p style={{ margin: 0, color: 'var(--at-ink-soft)', fontSize: 13 }}>
        Cada tipo de cargo lleva su <strong>cuenta por cobrar</strong> y su{' '}
        <strong>cuenta de ingreso</strong>. Muchos clientes comparten la misma cuenta por cobrar:
        sus movimientos se separan por <strong>auxiliar</strong> (el cliente), no con una cuenta
        por cliente. Sólo el servicio de agua admite cuenta de impuesto, porque es el único con
        impuesto calculado.
      </p>
      <p style={{ margin: 0, color: 'var(--at-ink-soft)', fontSize: 13 }}>
        Esta configuración todavía no genera asientos: la contabilización de cargos con estas
        cuentas llega en la siguiente entrega. Mientras tanto, cuotas y cobros siguen usando el
        mapeo general de la pestaña Configuración, como hasta ahora.
      </p>

      {soloLectura && (
        <p role="note" style={{ margin: 0, color: 'var(--at-ink-soft)', fontSize: 13 }}>
          Sólo lectura: no tienes permiso para cambiar la configuración contable.
        </p>
      )}

      {estado.isError && (
        <div role="alert" style={{ ...card, borderColor: 'var(--at-danger)', padding: 12 }}>
          {mensajeServidor(estado.error)}
        </div>
      )}

      <section style={card} aria-labelledby="tipos-cargo-titulo">
        <h3 id="tipos-cargo-titulo" style={{ margin: 0, fontSize: 15 }}>
          Cuentas por tipo de cargo
        </h3>
        {estado.isLoading ? (
          <p style={{ margin: 0 }}>Cargando…</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: 6 }}>Tipo de cargo</th>
                  <th style={{ padding: 6 }}>Estado</th>
                  <th style={{ padding: 6 }}>Cuenta por cobrar</th>
                  <th style={{ padding: 6 }}>Cuenta de ingreso</th>
                  <th style={{ padding: 6 }}>Cuenta de impuesto</th>
                  <th style={{ padding: 6 }}>Activa</th>
                  <th style={{ padding: 6 }} />
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => {
                  const b = borrador(fila)
                  const error = errores[fila.tipo_cargo]
                  // Guardar es crear si todavía no hay configuración, editar si ya existe.
                  const puedeGuardar = fila.config_id ? puedeEditar : puedeCrear
                  return (
                    <tr key={fila.tipo_cargo} style={{ borderTop: '1px solid var(--at-line)', verticalAlign: 'top' }}>
                      <td style={{ padding: 6, fontWeight: 600 }}>{fila.etiqueta}</td>
                      <td style={{ padding: 6 }}>
                        <span data-estado={fila.estado}>{ETIQUETA_ESTADO_CONFIG[fila.estado]}</span>
                        {fila.motivo && (
                          <div style={{ color: 'var(--at-danger)', marginTop: 4 }}>{fila.motivo}</div>
                        )}
                      </td>
                      <td style={{ padding: 6 }}>
                        <select aria-label={`Cuenta por cobrar de ${fila.etiqueta}`} disabled={!puedeGuardar} value={b.cxc}
                          onChange={(e) => editar(fila.tipo_cargo, fila, { cxc: e.target.value })} style={inputStyle}>
                          <option value="">Elegir…</option>
                          {porTipo.activo.map((c) => (
                            <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: 6 }}>
                        <select aria-label={`Cuenta de ingreso de ${fila.etiqueta}`} disabled={!puedeGuardar} value={b.ingreso}
                          onChange={(e) => editar(fila.tipo_cargo, fila, { ingreso: e.target.value })} style={inputStyle}>
                          <option value="">Elegir…</option>
                          {porTipo.ingreso.map((c) => (
                            <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: 6 }}>
                        {fila.admite_impuesto ? (
                          <select aria-label={`Cuenta de impuesto de ${fila.etiqueta}`} disabled={!puedeGuardar} value={b.impuesto}
                            onChange={(e) => editar(fila.tipo_cargo, fila, { impuesto: e.target.value })} style={inputStyle}>
                            <option value="">Sin impuesto</option>
                            {porTipo.pasivo.map((c) => (
                              <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
                            ))}
                          </select>
                        ) : (
                          <span style={{ color: 'var(--at-ink-soft)' }}>No aplica</span>
                        )}
                      </td>
                      <td style={{ padding: 6 }}>
                        <input type="checkbox" aria-label={`${fila.etiqueta} activa`} checked={b.activa} disabled={!puedeGuardar}
                          onChange={(e) => editar(fila.tipo_cargo, fila, { activa: e.target.checked })} />
                      </td>
                      <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                        {puedeGuardar && (
                          <button type="button" onClick={() => void guardarFila(fila)} disabled={guardar.isPending}>
                            Guardar
                          </button>
                        )}
                        {fila.config_id && puedeEliminar && (
                          <button type="button" style={{ marginLeft: 6 }} onClick={() => void quitarFila(fila)}
                            disabled={quitar.isPending}>
                            Quitar
                          </button>
                        )}
                        {error && (
                          <div role="alert" style={{ color: 'var(--at-danger)', marginTop: 4, whiteSpace: 'normal' }}>
                            {error}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
