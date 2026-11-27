// Fondo de reserva: traslado manual con póliza. Cada aportación, retiro o
// rendimiento queda en el registro del fondo (Condominios) y en libros a la vez
// (RPC conta_fondo_reserva_traslado). El resumen compara ambos saldos para que
// lo capturado directo en Condominios, sin póliza, se note.
import { useMemo, useState } from 'react'
import { EditModal } from '../shared/EditModal'
import { notify } from '../shared/Dialog'
import { useFondoReservaTrasladoMutation } from '../../domain/contabilidad/mutations'
import { useCuentasQuery, useFondoReservaResumenQuery } from '../../domain/contabilidad/queries'
import { formatCurrency, hoyLocalISO } from '../../lib/format'
import { FONDO_RESERVA_TIPO_LABELS, type FondoReservaTipo } from '../../types/contabilidad'
import { Campo, btnPrimario, btnSecundario, input } from './ui'

interface Props {
  companyId: string
  projectId: string
  monedaBase: string
  /** Registrar exige crear y cambiar estado en Contabilidad (y el permiso del fondo en Condominios, que valida el servidor). */
  puedeRegistrar: boolean
  onClose: () => void
}

const AYUDA_CONTRA: Record<FondoReservaTipo, string> = {
  aportacion: 'De dónde sale el dinero: normalmente el banco operativo.',
  retiro: 'A dónde va el dinero: el banco operativo, o directo la cuenta del gasto que se paga con el fondo.',
  rendimiento: 'La cuenta de ingreso por intereses o rendimientos.',
}

export function FondoReservaModal({ companyId, projectId, monedaBase, puedeRegistrar, onClose }: Props) {
  const { data: resumen, isLoading } = useFondoReservaResumenQuery(companyId, projectId)
  const { data: cuentas = [] } = useCuentasQuery(companyId, projectId)
  const trasladar = useFondoReservaTrasladoMutation()

  const [tipo, setTipo] = useState<FondoReservaTipo>('aportacion')
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(hoyLocalISO())
  const [concepto, setConcepto] = useState('')
  const [referencia, setReferencia] = useState('')
  // '' = «la de la última vez» (resumen); el usuario puede cambiarla.
  const [cuentaFondoSel, setCuentaFondoSel] = useState('')
  const [cuentaContraSel, setCuentaContraSel] = useState('')

  const detalle = useMemo(() => cuentas.filter((c) => c.es_detalle && c.activa), [cuentas])
  const activos = useMemo(() => detalle.filter((c) => c.tipo === 'activo'), [detalle])
  const cuentaFondo = cuentaFondoSel || resumen?.cuenta_fondo_id || ''
  // La contrapartida sugerida solo vale para aportaciones (la del retiro o rendimiento es otra cuenta).
  const cuentaContra = cuentaContraSel || (tipo === 'aportacion' ? resumen?.cuenta_contra_id ?? '' : '')

  const importe = Number(monto)
  const diferencia = resumen ? Math.round((resumen.saldo_registro - resumen.saldo_libros) * 100) / 100 : 0
  const excede = tipo === 'retiro' && !!resumen && cuentaFondo === resumen.cuenta_fondo_id && importe > resumen.saldo_libros
  const listo = importe > 0 && !!fecha && concepto.trim().length > 0 && !!cuentaFondo && !!cuentaContra
    && cuentaFondo !== cuentaContra && !excede

  async function registrar() {
    try {
      const r = await trasladar.mutateAsync({
        projectId, tipo, monto: importe, fecha, concepto: concepto.trim(),
        cuentaFondoId: cuentaFondo, cuentaContraId: cuentaContra, referencia: referencia.trim() || null,
      })
      notify({
        variant: 'success',
        title: `${FONDO_RESERVA_TIPO_LABELS[tipo]} registrada`,
        text: r ? `Saldo del fondo en libros: ${formatCurrency(r.saldo_fondo, monedaBase)}.` : 'Quedó con su póliza.',
        duration: 3000,
      })
      setMonto(''); setConcepto(''); setReferencia(''); setCuentaContraSel('')
    } catch (err) {
      notify({ variant: 'error', title: 'No se pudo registrar', text: err instanceof Error ? err.message : 'Intente de nuevo.' })
    }
  }

  return (
    <EditModal title="Fondo de reserva" onClose={onClose} maxWidth="760px">
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--at-ink-3)', lineHeight: 1.6 }}>
        El fondo de reserva se mueve <strong>a mano</strong>: usted decide cuándo y cuánto trasladar. Cada movimiento
        registrado aquí queda en el registro del fondo y en libros con su póliza.
      </p>

      {!isLoading && resumen && (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 8, background: 'var(--at-chip)', marginBottom: 12, fontSize: 13 }}>
          <span>Saldo en libros: <strong>{resumen.cuenta_fondo_id ? formatCurrency(resumen.saldo_libros, monedaBase) : '—'}</strong></span>
          <span>Saldo según el registro: <strong>{formatCurrency(resumen.saldo_registro, monedaBase)}</strong></span>
          <span>Movimientos: <strong>{resumen.movimientos}</strong></span>
        </div>
      )}
      {resumen && (resumen.movimientos_sin_poliza > 0 || (resumen.cuenta_fondo_id && diferencia !== 0)) && (
        <div role="alert" style={{ background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
          {resumen.movimientos_sin_poliza > 0 && (
            <>Hay {resumen.movimientos_sin_poliza} movimiento(s) del fondo capturados en Condominios <strong>sin póliza</strong>. </>
          )}
          {resumen.cuenta_fondo_id && diferencia !== 0 && (
            <>El registro y los libros difieren en {formatCurrency(Math.abs(diferencia), monedaBase)}. </>
          )}
          Regístrelos con una póliza manual o captúrelos de nuevo desde aquí para que el fondo cuadre.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 12 }}>
        <Campo label="Movimiento">
          <select aria-label="Movimiento" style={input} value={tipo} onChange={(e) => { setTipo(e.target.value as FondoReservaTipo); setCuentaContraSel('') }}>
            {(Object.keys(FONDO_RESERVA_TIPO_LABELS) as FondoReservaTipo[]).map((t) => (
              <option key={t} value={t}>{FONDO_RESERVA_TIPO_LABELS[t]}</option>
            ))}
          </select>
        </Campo>
        <Campo label={`Monto (${monedaBase})`}>
          <input aria-label="Monto" type="number" min="0" step="0.01" style={input} value={monto} onChange={(e) => setMonto(e.target.value)} />
        </Campo>
        <Campo label="Fecha">
          <input aria-label="Fecha" type="date" style={input} value={fecha} max={hoyLocalISO()} onChange={(e) => setFecha(e.target.value)} />
        </Campo>
        <Campo label="Referencia (opcional)">
          <input aria-label="Referencia" style={input} value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="No. de transferencia, acta…" />
        </Campo>
      </div>
      <Campo label="Concepto">
        <input aria-label="Concepto" style={{ ...input, width: '100%' }} value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Traslado mensual al fondo de reserva" />
      </Campo>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, margin: '12px 0 4px' }}>
        <Campo label="Cuenta del fondo de reserva">
          <select aria-label="Cuenta del fondo de reserva" style={{ ...input, width: '100%' }} value={cuentaFondo} onChange={(e) => setCuentaFondoSel(e.target.value)}>
            <option value="">Elija la cuenta (banco o inversión del fondo)…</option>
            {activos.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </select>
        </Campo>
        <Campo label="Contrapartida">
          <select aria-label="Contrapartida" style={{ ...input, width: '100%' }} value={cuentaContra} onChange={(e) => setCuentaContraSel(e.target.value)}>
            <option value="">Elija la cuenta…</option>
            {detalle.filter((c) => c.id !== cuentaFondo).map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </select>
        </Campo>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--at-ink-3)' }}>{AYUDA_CONTRA[tipo]}</p>

      {excede && (
        <p role="alert" style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--at-danger)' }}>
          El retiro supera el saldo en libros del fondo ({formatCurrency(resumen!.saldo_libros, monedaBase)}).
        </p>
      )}

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', alignItems: 'center' }}>
        {!puedeRegistrar && (
          <span style={{ fontSize: 12.5, color: 'var(--at-ink-3)', marginRight: 'auto' }}>
            Solo consulta. Registrar requiere «Crear» y «Cambiar estado» en Contabilidad y crear movimientos del fondo en Condominios.
          </span>
        )}
        <button style={btnSecundario} onClick={onClose}>Cerrar</button>
        {puedeRegistrar && (
          <button style={{ ...btnPrimario, opacity: listo ? 1 : 0.5 }} disabled={!listo || trasladar.isPending} onClick={() => void registrar()}>
            {trasladar.isPending ? 'Registrando…' : `Registrar ${FONDO_RESERVA_TIPO_LABELS[tipo].toLowerCase()}`}
          </button>
        )}
      </div>
    </EditModal>
  )
}
