// Auxiliares — nomenclatura contable de los clientes de la EMPRESA.
//
// El auxiliar es el cliente al que pertenece un movimiento. Se enlaza siempre
// por `cliente_id`; el código que aquí se asigna es sólo nomenclatura, única
// por empresa e independiente del catálogo de cuentas. Por eso renombrarlo no
// toca ningún asiento, y por eso no depende del ledger activo.
//
// Sin código escrito, el servidor propone el siguiente `AUX-NNNNN`. La
// búsqueda corre en servidor y la lista se acota a `AUXILIARES_LIMITE`.
//
// Asignar exige crear y cambiar un código exige editar; sin el permiso la
// acción no se ofrece y el campo queda de sólo lectura. La RLS sigue siendo
// quien decide: una escritura que no afecte exactamente una fila se trata como
// rechazo y lo escrito se conserva.
import { useState } from 'react'
import { AUXILIARES_LIMITE, useAuxiliaresQuery } from '../../domain/contabilidad/queries'
import { useGuardarAuxiliarMutation } from '../../domain/contabilidad/mutations'
import { mensajeServidor } from './TiposCargoTab'
import { usePermisosContabilidad } from './ui'
import type { AuxiliarCliente } from '../../types/contabilidad'

interface Props {
  companyId?: string
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
  minWidth: 140,
}

export function AuxiliaresTab({ companyId }: Props) {
  const [busqueda, setBusqueda] = useState('')
  const [aplicada, setAplicada] = useState('')
  const lista = useAuxiliaresQuery(companyId, aplicada)
  const guardar = useGuardarAuxiliarMutation(companyId)
  const { puedeCrear, puedeEditar } = usePermisosContabilidad()

  const [codigos, setCodigos] = useState<Record<string, string>>({})
  const [errores, setErrores] = useState<Record<string, string>>({})

  async function guardarFila(a: AuxiliarCliente) {
    setErrores((e) => ({ ...e, [a.cliente_id]: '' }))
    try {
      await guardar.mutateAsync({
        auxiliar_id: a.auxiliar_id,
        cliente_id: a.cliente_id,
        codigo: codigos[a.cliente_id] ?? a.codigo,
      })
      setCodigos((c) => {
        const { [a.cliente_id]: _hecho, ...resto } = c
        return resto
      })
    } catch (e) {
      const msg = mensajeServidor(e)
      setErrores((prev) => ({
        ...prev,
        [a.cliente_id]: /uq_conta_auxiliares_codigo/.test(msg)
          ? 'Ese código ya lo usa otro cliente de la empresa.'
          : msg,
      }))
    }
  }

  const filas = lista.data ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--at-space-3)' }}>
      <p style={{ margin: 0, color: 'var(--at-ink-soft)', fontSize: 13 }}>
        El <strong>código de auxiliar</strong> identifica a cada cliente en los reportes contables
        de la empresa, sin necesidad de una cuenta por cliente. Es independiente del catálogo de
        cuentas y se puede cambiar: los movimientos se enlazan al cliente, no al código.
      </p>

      <form
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
        onSubmit={(e) => { e.preventDefault(); setAplicada(busqueda) }}
      >
        <input aria-label="Buscar cliente" placeholder="Buscar cliente por nombre…" value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)} style={{ ...inputStyle, minWidth: 240 }} />
        <button type="submit">Buscar</button>
      </form>

      {lista.isError && (
        <div role="alert" style={{ ...card, borderColor: 'var(--at-danger)', padding: 12 }}>
          {mensajeServidor(lista.error)}
        </div>
      )}

      <section style={card} aria-labelledby="auxiliares-titulo">
        <h3 id="auxiliares-titulo" style={{ margin: 0, fontSize: 15 }}>Auxiliares de clientes</h3>
        {lista.isLoading ? (
          <p style={{ margin: 0 }}>Cargando…</p>
        ) : filas.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--at-ink-soft)', fontSize: 13 }}>
            {aplicada ? 'Ningún cliente coincide con la búsqueda.' : 'La empresa no tiene clientes activos.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: 6 }}>Cliente</th>
                  <th style={{ padding: 6 }}>Código de cliente</th>
                  <th style={{ padding: 6 }}>Código de auxiliar</th>
                  <th style={{ padding: 6 }} />
                </tr>
              </thead>
              <tbody>
                {filas.map((a) => {
                  const puede = a.auxiliar_id ? puedeEditar : puedeCrear
                  return (
                  <tr key={a.cliente_id} style={{ borderTop: '1px solid var(--at-line)', verticalAlign: 'top' }}>
                    <td style={{ padding: 6, fontWeight: 600 }}>{a.cliente_nombre}</td>
                    <td style={{ padding: 6, color: 'var(--at-ink-soft)' }}>{a.cliente_codigo ?? '—'}</td>
                    <td style={{ padding: 6 }}>
                      <input
                        aria-label={`Código de auxiliar de ${a.cliente_nombre}`}
                        placeholder={a.auxiliar_id ? '' : 'Automático'}
                        value={codigos[a.cliente_id] ?? a.codigo ?? ''}
                        onChange={(e) => setCodigos((c) => ({ ...c, [a.cliente_id]: e.target.value }))}
                        maxLength={40}
                        readOnly={!puede}
                        style={inputStyle}
                      />
                    </td>
                    <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                      {puede && (
                        <button type="button" onClick={() => void guardarFila(a)} disabled={guardar.isPending}>
                          {a.auxiliar_id ? 'Guardar' : 'Asignar'}
                        </button>
                      )}
                      {errores[a.cliente_id] && (
                        <div role="alert" style={{ color: 'var(--at-danger)', marginTop: 4, whiteSpace: 'normal' }}>
                          {errores[a.cliente_id]}
                        </div>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
            {filas.length >= AUXILIARES_LIMITE && (
              <p style={{ margin: '8px 0 0', color: 'var(--at-ink-soft)', fontSize: 12 }}>
                Se muestran los primeros {AUXILIARES_LIMITE}. Usa la búsqueda para encontrar a otros.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
