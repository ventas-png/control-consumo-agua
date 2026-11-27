// Saldos iniciales por residente: carga las cuotas que cada unidad debía en el
// sistema anterior, una por renglón, con su periodo y su vencimiento. Cada una
// queda como una cuota normal (se cobra, sale en el estado de cuenta y en la
// antigüedad) pero su póliza va contra la contrapartida de apertura, no contra
// ingreso. Las reglas viven en el RPC conta_cuotas_saldo_inicial; aquí se pega,
// se previsualiza y se aplica.
import { useMemo, useState } from 'react'
import { EditModal } from '../shared/EditModal'
import { notify } from '../shared/Dialog'
import { useCuotasSaldoInicialMutation } from '../../domain/contabilidad/mutations'
import { useCuentasEspecialesQuery, useCuentasQuery, useUnidadesLedgerQuery } from '../../domain/contabilidad/queries'
import { COLUMNAS_SALDO_INICIAL, parsearCuotasPegadas } from '../../domain/contabilidad/saldosInicialesResidente'
import { formatCurrency, formatDateShort, hoyLocalISO } from '../../lib/format'
import {
  CUOTA_SALDO_INICIAL_LABELS,
  type CuotaSaldoInicialFila,
  type CuotaSaldoInicialResultado,
} from '../../types/contabilidad'
import { Campo, btnPrimario, btnSecundario, input } from './ui'

const RESULTADO_COLOR: Record<CuotaSaldoInicialResultado | 'local', { bg: string; color: string }> = {
  previsualizacion: { bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  cargada:          { bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)' },
  ya_existe:        { bg: 'var(--at-chip)', color: 'var(--at-ink-2)' },
  rechazada:        { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
  error:            { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
  local:            { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
}

interface Props {
  companyId: string
  /** Los residentes son de un proyecto: no existe en la contabilidad de la empresa. */
  projectId: string
  monedaBase: string
  /** Cargar exige crear y cambiar estado en Contabilidad (y crear cuotas en Condominios, que valida el servidor). */
  puedeAplicar: boolean
  onClose: () => void
}

/** Un renglón de la tabla: lo que se pegó más lo que respondió el servidor (si se envió). */
interface Renglon {
  linea: number
  unidad: string
  errorLocal: string | null
  servidor: CuotaSaldoInicialFila | null
}

export function SaldosInicialesResidenteModal({ companyId, projectId, monedaBase, puedeAplicar, onClose }: Props) {
  const [fecha, setFecha] = useState(hoyLocalISO())
  const [contrapartida, setContrapartida] = useState('')
  const [texto, setTexto] = useState('')
  const [renglones, setRenglones] = useState<Renglon[] | null>(null)
  const [aplicado, setAplicado] = useState(false)

  const { data: unidades = [], isLoading: cargandoUnidades } = useUnidadesLedgerQuery(companyId, projectId)
  const { data: cuentas = [] } = useCuentasQuery(companyId, projectId)
  const { data: especiales = [] } = useCuentasEspecialesQuery(companyId, projectId)
  const cargar = useCuotasSaldoInicialMutation()

  const resultadosAcumulados = useMemo(
    () => especiales.find((e) => e.evento === 'resultados_acumulados' && e.cuenta_id) ?? null,
    [especiales],
  )
  const cuentasDetalle = useMemo(() => cuentas.filter((c) => c.es_detalle && c.activa), [cuentas])
  const sinContrapartida = !contrapartida && !resultadosAcumulados

  function limpiarVista() { setRenglones(null); setAplicado(false) }

  async function ejecutar(aplicar: boolean) {
    const pegadas = parsearCuotasPegadas(texto, unidades)
    if (pegadas.length === 0) {
      notify({ variant: 'warning', title: 'Nada que cargar', text: 'Pegue al menos un renglón con unidad, periodo y monto.' })
      return
    }
    const enviables = pegadas.filter((p) => p.input)
    try {
      const respuesta = enviables.length === 0 ? [] : (await cargar.mutateAsync({
        projectId, fecha, aplicar, contrapartidaCuentaId: contrapartida || null,
        filas: enviables.map((p) => p.input!),
      })) ?? []
      // El servidor numera las filas en el orden en que se enviaron.
      const porFila = new Map(respuesta.map((r) => [r.fila, r]))
      let n = 0
      setRenglones(pegadas.map((p) => ({
        linea: p.linea,
        unidad: p.unidadTexto,
        errorLocal: p.error,
        servidor: p.input ? porFila.get(++n) ?? null : null,
      })))
      setAplicado(aplicar)
      if (aplicar) {
        const cargadas = respuesta.filter((r) => r.resultado === 'cargada')
        const fallidas = respuesta.filter((r) => r.resultado === 'rechazada' || r.resultado === 'error').length
          + pegadas.length - enviables.length
        const total = cargadas.reduce((s, r) => s + (r.monto ?? 0) + (r.mora ?? 0), 0)
        notify({
          variant: fallidas > 0 ? 'warning' : 'success',
          title: 'Saldos iniciales cargados',
          text: `${cargadas.length} cuota(s) por ${formatCurrency(Math.round(total * 100) / 100, monedaBase)}.`
            + (fallidas > 0 ? ` ${fallidas} renglón(es) no entraron: revise la columna Estado.` : ''),
          duration: 3600,
        })
      }
    } catch (err) {
      notify({
        variant: 'error',
        title: 'No se pudo cargar',
        text: err instanceof Error ? err.message : 'Intente de nuevo.',
      })
    }
  }

  const listas = (renglones ?? []).filter((r) => r.servidor?.resultado === 'previsualizacion')
  const totalListo = Math.round(listas.reduce((s, r) => s + (r.servidor!.monto ?? 0) + (r.servidor!.mora ?? 0), 0) * 100) / 100

  return (
    <EditModal title="Saldos iniciales por residente" onClose={onClose} maxWidth="980px">
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--at-ink-3)', lineHeight: 1.6 }}>
        Cargue aquí lo que cada unidad debía en el sistema anterior, <strong>una cuota pendiente por renglón</strong>.
        Cada una queda como una cuota normal —se cobra, sale en el estado de cuenta y en la antigüedad de saldos— pero
        su póliza va <strong>contra la contrapartida de apertura, no contra ingreso</strong>: el ingreso de ejercicios
        anteriores no infla el resultado de este mes. Lo que entra ya vencido no recibe mora automática: la mora
        histórica es la que usted cargue.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
        <Campo label="Fecha de saldos iniciales">
          <input
            type="date"
            aria-label="Fecha de saldos iniciales"
            style={input}
            value={fecha}
            max={hoyLocalISO()}
            onChange={(e) => { setFecha(e.target.value); limpiarVista() }}
          />
        </Campo>
        <Campo label="Contrapartida">
          <select
            aria-label="Contrapartida"
            style={{ ...input, minWidth: 320 }}
            value={contrapartida}
            onChange={(e) => { setContrapartida(e.target.value); limpiarVista() }}
          >
            <option value="">
              {resultadosAcumulados
                ? `Resultados acumulados (${resultadosAcumulados.codigo} · ${resultadosAcumulados.nombre})`
                : 'Resultados acumulados — sin asignar'}
            </option>
            {cuentasDetalle.map((c) => (
              <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
            ))}
          </select>
        </Campo>
      </div>

      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--at-ink-3)', lineHeight: 1.55 }}>
        Use <strong>Resultados acumulados</strong> si el asiento de apertura <em>no</em> incluye lo que deben los
        residentes. Si la apertura ya trae ese total en la cuenta por cobrar, elija aquí esa misma cuenta: la carga
        solo reparte el total entre los residentes y el saldo de la cuenta no cambia.
      </p>

      {sinContrapartida && (
        <div role="alert" style={{ background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 12 }}>
          Esta contabilidad no tiene asignada la cuenta «Resultados acumulados». Asígnela en Configuración › Cuentas
          especiales, o elija otra cuenta de contrapartida.
        </div>
      )}

      <Campo label={`Cuotas pendientes — pegue desde Excel: ${COLUMNAS_SALDO_INICIAL.join(' · ')}`}>
        <textarea
          aria-label="Cuotas pendientes"
          style={{ ...input, width: '100%', minHeight: 130, fontFamily: 'var(--at-font-mono, monospace)', fontSize: 12.5, whiteSpace: 'pre' }}
          placeholder={'Casa 14\t2026-02\t600.00\t15/02/2026\t25.00\nCasa 14\t2026-03\t600.00\t15/03/2026\nCasa 22\t2026-03\t1,500.00\t31/03/2026\t\textraordinaria'}
          value={texto}
          onChange={(e) => { setTexto(e.target.value); limpiarVista() }}
        />
      </Campo>
      <p style={{ margin: '6px 0 12px', fontSize: 12, color: 'var(--at-ink-3)' }}>
        La unidad se reconoce por su nombre. Vencimiento, mora y tipo son opcionales: sin vencimiento se toma el fin
        de mes del periodo; sin tipo, «mantenimiento» (el otro es «extraordinaria»). El monto es lo que sigue pendiente.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <button
          style={btnSecundario}
          disabled={cargar.isPending || cargandoUnidades || !fecha || !texto.trim() || sinContrapartida}
          onClick={() => void ejecutar(false)}
        >
          {cargar.isPending ? 'Revisando…' : '🔍 Previsualizar'}
        </button>
        {puedeAplicar && (
          <button
            style={{ ...btnPrimario, opacity: listas.length > 0 && !aplicado ? 1 : 0.5 }}
            disabled={cargar.isPending || listas.length === 0 || aplicado}
            onClick={() => void ejecutar(true)}
          >
            ✓ Cargar {listas.length > 0 && !aplicado ? `${listas.length} cuota(s)` : 'cuotas'}
          </button>
        )}
        {renglones !== null && !aplicado && listas.length > 0 && (
          <span style={{ fontSize: 13, color: 'var(--at-ink-2)' }}>
            Listas para cargar: <strong>{formatCurrency(totalListo, monedaBase)}</strong>
          </span>
        )}
      </div>

      {!puedeAplicar && (
        <p style={{ fontSize: 12.5, color: 'var(--at-ink-3)', margin: '0 0 12px' }}>
          Solo puede previsualizar. Cargar requiere «Crear» y «Cambiar estado» en Contabilidad y «Crear» cuotas en Condominios.
        </p>
      )}

      {renglones !== null && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--at-line)', textAlign: 'right' }}>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>#</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Unidad · responsable</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Periodo</th>
                <th style={{ textAlign: 'left', padding: '8px 6px' }}>Vence</th>
                <th style={{ padding: '8px 6px' }}>Monto</th>
                <th style={{ padding: '8px 6px' }}>Mora</th>
                <th style={{ textAlign: 'center', padding: '8px 6px' }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {renglones.map((r) => {
                const s = r.servidor
                const clave: CuotaSaldoInicialResultado | 'local' = r.errorLocal || !s ? 'local' : s.resultado
                const rc = RESULTADO_COLOR[clave] ?? RESULTADO_COLOR.error
                const motivo = r.errorLocal ?? s?.motivo ?? (!s ? 'El servidor no devolvió este renglón.' : null)
                return (
                  <tr key={r.linea} style={{ borderBottom: '1px solid var(--at-chip)', textAlign: 'right' }}>
                    <td style={{ textAlign: 'left', padding: '8px 6px', color: 'var(--at-ink-3)' }}>{r.linea}</td>
                    <td style={{ textAlign: 'left', padding: '8px 6px' }}>
                      <span style={{ fontWeight: 600 }}>{s?.unidad_nombre ?? (r.unidad || '—')}</span>
                      {s?.responsable_nombre && <span style={{ color: 'var(--at-ink-3)' }}> · {s.responsable_nombre}</span>}
                      {motivo && <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 2 }}>{motivo}</div>}
                    </td>
                    <td style={{ textAlign: 'left', padding: '8px 6px' }}>
                      {s?.periodo ?? '—'}{s?.tipo_cargo === 'cuota_extraordinaria' ? ' · extraordinaria' : ''}
                    </td>
                    <td style={{ textAlign: 'left', padding: '8px 6px' }}>{s?.fecha_vencimiento ? formatDateShort(s.fecha_vencimiento) : '—'}</td>
                    <td style={{ padding: '8px 6px', fontVariantNumeric: 'tabular-nums' }}>{s?.monto != null ? formatCurrency(s.monto, monedaBase) : '—'}</td>
                    <td style={{ padding: '8px 6px', fontVariantNumeric: 'tabular-nums' }}>{s && s.mora > 0 ? formatCurrency(s.mora, monedaBase) : '—'}</td>
                    <td style={{ textAlign: 'center', padding: '8px 6px' }}>
                      <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 700, background: rc.bg, color: rc.color, whiteSpace: 'nowrap' }}>
                        {clave === 'local' ? 'No se envió' : CUOTA_SALDO_INICIAL_LABELS[clave] ?? clave}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </EditModal>
  )
}
