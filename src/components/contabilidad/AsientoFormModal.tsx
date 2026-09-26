import { useMemo, useState } from 'react'
import { EditModal } from '../shared'
import { notify } from '../shared/Dialog'
import { useCuentasQuery } from '../../domain/contabilidad/queries'
import { useCrearAsientoBorradorMutation, usePublicarAsientoMutation } from '../../domain/contabilidad/mutations'
import {
  asientoFormSchema,
  convertirMontoBase,
  totalesLineas,
  type AsientoLineaFormInput,
} from '../../domain/contabilidad/schemas'
import { useMonedaEmpresaQuery, useTiposCambioMensualQuery, tasaMensualEntre } from '../../domain/contabilidad/tiposCambio'
import { formatCurrency, hoyLocalISO } from '../../lib/format'
import { TIPO_ASIENTO_LABELS, type TipoAsiento } from '../../types/contabilidad'
import { Campo, btnPrimario, btnSecundario, btnLink, input } from './ui'

interface Props {
  companyId: string
  /** Ledger activo: null = contabilidad de la empresa. */
  projectId: string | null
  monedaBase: string
  onClose: () => void
}

interface LineaForm {
  cuenta_id: string
  descripcion: string
  lado: 'debe' | 'haber'
  /** Monto capturado: en moneda base, o en moneda origen si la cuenta es FX. */
  monto: string
  /** Vacío = la tasa mensual propuesta; escrita = otra tasa (pide motivo). */
  tipo_cambio: string
}

const LINEA_VACIA: LineaForm = { cuenta_id: '', descripcion: '', lado: 'debe', monto: '', tipo_cambio: '' }

export function AsientoFormModal({ companyId, projectId, monedaBase, onClose }: Props) {
  // El catálogo es el DEL LEDGER activo. Sin `projectId` la query cae al de la
  // empresa (`project_id IS NULL`), así que una póliza del proyecto se armaba
  // con cuentas de la empresa y moría al publicar ("cuentas de otra
  // contabilidad"), dejando el borrador cruzado atrás.
  const { data: cuentas = [] } = useCuentasQuery(companyId, projectId)
  const crear = useCrearAsientoBorradorMutation(companyId)
  const publicar = usePublicarAsientoMutation()

  const [fecha, setFecha] = useState(hoyLocalISO())
  const [tipo, setTipo] = useState<TipoAsiento>('diario')
  const [concepto, setConcepto] = useState('')
  const [lineas, setLineas] = useState<LineaForm[]>([{ ...LINEA_VACIA }, { ...LINEA_VACIA, lado: 'haber' }])
  const [guardando, setGuardando] = useState(false)
  const [motivoTasa, setMotivoTasa] = useState('')
  // Decisión B1: la tasa mensual de la fecha se PROPONE; usar otra exige motivo.
  const { data: tasasMensuales = [] } = useTiposCambioMensualQuery(companyId)
  const { data: monedaEmpresa } = useMonedaEmpresaQuery(companyId)

  const detalle = useMemo(() => cuentas.filter((c) => c.es_detalle && c.activa), [cuentas])
  const cuentaDe = (id: string) => detalle.find((c) => c.id === id)

  function tasaSugerida(l: LineaForm): number | null {
    const cuenta = cuentaDe(l.cuenta_id)
    if (!cuenta?.moneda || cuenta.moneda === monedaBase || !monedaEmpresa) return null
    return tasaMensualEntre(tasasMensuales, cuenta.moneda, monedaBase, fecha.slice(0, 7), monedaEmpresa)
  }

  /** La tasa que se usará: la escrita o, si no hay, la mensual propuesta. */
  function tasaEfectiva(l: LineaForm): number {
    return l.tipo_cambio !== '' ? parseFloat(l.tipo_cambio) || 0 : tasaSugerida(l) ?? 0
  }

  function esFxLinea(l: LineaForm): boolean {
    const cuenta = cuentaDe(l.cuenta_id)
    return !!cuenta?.moneda && cuenta.moneda !== monedaBase
  }

  /** Línea en otra moneda cuya tasa no es la mensual (o no hay mensual). */
  function tasaDistinta(l: LineaForm): boolean {
    if (!esFxLinea(l)) return false
    const sugerida = tasaSugerida(l)
    return sugerida == null || Math.abs(tasaEfectiva(l) - sugerida) > 1e-9
  }

  const pideMotivo = lineas.some(tasaDistinta)
  const motivoValido = motivoTasa.trim().length >= 5

  function montoBase(l: LineaForm): number {
    const monto = parseFloat(l.monto) || 0
    if (esFxLinea(l)) return convertirMontoBase(monto, tasaEfectiva(l))
    return monto
  }

  const totales = totalesLineas(
    lineas.map((l) => ({
      debe: l.lado === 'debe' ? montoBase(l) : 0,
      haber: l.lado === 'haber' ? montoBase(l) : 0,
    })),
  )

  function setLinea(i: number, patch: Partial<LineaForm>) {
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  }

  function construirLineas(): AsientoLineaFormInput[] {
    return lineas.map((l) => {
      const cuenta = cuentaDe(l.cuenta_id)
      const esFx = !!cuenta?.moneda && cuenta.moneda !== monedaBase
      const base = montoBase(l)
      return {
        cuenta_id: l.cuenta_id,
        descripcion: l.descripcion || undefined,
        debe: l.lado === 'debe' ? base : 0,
        haber: l.lado === 'haber' ? base : 0,
        moneda_origen: esFx ? cuenta!.moneda : null,
        monto_origen: esFx ? parseFloat(l.monto) || 0 : null,
        tipo_cambio: esFx ? tasaEfectiva(l) : null,
      }
    })
  }

  async function guardar(publicarDespues: boolean) {
    const parsed = asientoFormSchema.safeParse({
      fecha,
      tipo,
      concepto,
      project_id: projectId,
      lineas: construirLineas(),
      tipo_cambio_motivo: pideMotivo ? motivoTasa : undefined,
    })
    if (!parsed.success) {
      notify({ variant: 'warning', title: 'Atención', text: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
      return
    }
    if (publicarDespues && pideMotivo && !motivoValido) {
      notify({
        variant: 'warning',
        title: 'Falta el motivo',
        text: 'Una línea en otra moneda no usa la tasa mensual. Indica por qué (al menos 5 caracteres) o usa la tasa propuesta.',
      })
      return
    }
    setGuardando(true)
    try {
      const asiento = await crear.mutateAsync({ ...parsed.data, moneda_base: monedaBase })
      if (publicarDespues) {
        await publicar.mutateAsync(asiento.id)
        notify({ variant: 'success', title: 'Publicada', text: 'Póliza creada y publicada.' })
      } else {
        notify({ variant: 'success', title: 'Guardada', text: 'Póliza guardada como borrador.' })
      }
      onClose()
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo guardar la póliza.' })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <EditModal
      title="Nueva póliza"
      subtitle={`Moneda base ${monedaBase} · las cuentas en otra moneda piden monto origen y tipo de cambio`}
      onClose={onClose}
      size="lg"
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: totales.diferencia === 0 && totales.debe > 0 ? 'var(--at-success)' : 'var(--at-danger)' }}>
            Debe {formatCurrency(totales.debe, monedaBase)} · Haber {formatCurrency(totales.haber, monedaBase)}
            {totales.diferencia !== 0 && ` · descuadre ${formatCurrency(totales.diferencia, monedaBase)}`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={btnSecundario}>Cancelar</button>
            <button onClick={() => void guardar(false)} disabled={guardando} style={btnSecundario}>
              Guardar borrador
            </button>
            <button onClick={() => void guardar(true)} disabled={guardando || totales.diferencia !== 0 || totales.debe <= 0} style={btnPrimario}>
              Guardar y publicar
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '140px 140px 1fr', gap: 10 }}>
          <Campo label="Fecha">
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={input} />
          </Campo>
          <Campo label="Tipo">
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoAsiento)} style={input}>
              {(Object.keys(TIPO_ASIENTO_LABELS) as TipoAsiento[])
                .filter((t) => t !== 'apertura' && t !== 'cierre')
                .map((t) => <option key={t} value={t}>{TIPO_ASIENTO_LABELS[t]}</option>)}
            </select>
          </Campo>

        </div>
        <Campo label="Concepto *">
          <input value={concepto} onChange={(e) => setConcepto(e.target.value)} style={input} placeholder="Descripción de la operación" />
        </Campo>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)', fontSize: 11 }}>
              <th style={{ padding: 4 }}>Cuenta</th>
              <th style={{ padding: 4 }}>Descripción</th>
              <th style={{ padding: 4, width: 90 }}>Lado</th>
              <th style={{ padding: 4, width: 120 }}>Monto</th>
              <th style={{ padding: 4, width: 110 }}>T. cambio</th>
              <th style={{ width: 30 }} />
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => {
              const cuenta = cuentaDe(l.cuenta_id)
              const esFx = !!cuenta?.moneda && cuenta.moneda !== monedaBase
              return (
                <tr key={i}>
                  <td style={{ padding: 4 }}>
                    <select value={l.cuenta_id} onChange={(e) => setLinea(i, { cuenta_id: e.target.value })} style={{ ...input, width: '100%' }}>
                      <option value="">Selecciona…</option>
                      {detalle.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.codigo} — {c.nombre}{c.moneda && c.moneda !== monedaBase ? ` (${c.moneda})` : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: 4 }}>
                    <input value={l.descripcion} onChange={(e) => setLinea(i, { descripcion: e.target.value })} style={{ ...input, width: '100%' }} />
                  </td>
                  <td style={{ padding: 4 }}>
                    <select value={l.lado} onChange={(e) => setLinea(i, { lado: e.target.value as 'debe' | 'haber' })} style={input}>
                      <option value="debe">Debe</option>
                      <option value="haber">Haber</option>
                    </select>
                  </td>
                  <td style={{ padding: 4 }}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={l.monto}
                      onChange={(e) => setLinea(i, { monto: e.target.value })}
                      style={{ ...input, width: '100%', textAlign: 'right' }}
                      placeholder={esFx ? `0.00 ${cuenta!.moneda}` : '0.00'}
                    />
                  </td>
                  <td style={{ padding: 4 }}>
                    {esFx ? (
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        value={l.tipo_cambio}
                        onChange={(e) => setLinea(i, { tipo_cambio: e.target.value })}
                        style={{
                          ...input,
                          width: '100%',
                          textAlign: 'right',
                          borderColor: tasaDistinta(l) ? 'var(--at-warning)' : undefined,
                        }}
                        aria-label={`Tipo de cambio de la línea ${i + 1}`}
                        placeholder={tasaSugerida(l) != null ? String(tasaSugerida(l)) : `1 ${cuenta!.moneda} = ? ${monedaBase}`}
                        title={tasaSugerida(l) != null
                          ? `Tasa mensual de ${fecha.slice(0, 7)}: ${tasaSugerida(l)}. Déjalo vacío para usarla.`
                          : `No hay tasa mensual de ${cuenta!.moneda} para ${fecha.slice(0, 7)}: escribe la tasa y el motivo.`}
                      />
                    ) : (
                      <span style={{ color: 'var(--at-ink-soft)', fontSize: 11 }}>—</span>
                    )}
                  </td>
                  <td>
                    {lineas.length > 2 && (
                      <button onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} style={btnLink} aria-label="Quitar línea">✕</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div>
          <button onClick={() => setLineas((ls) => [...ls, { ...LINEA_VACIA, lado: 'haber' }])} style={btnLink}>
            + Agregar línea
          </button>
        </div>
        {pideMotivo && (
          <Campo label="Motivo de la tasa distinta de la mensual *">
            <input
              value={motivoTasa}
              onChange={(e) => setMotivoTasa(e.target.value)}
              style={input}
              placeholder="Ej.: tasa pactada con el banco en la operación del día"
              aria-label="Motivo de la tasa distinta de la mensual"
            />
          </Campo>
        )}
      </div>
    </EditModal>
  )
}
