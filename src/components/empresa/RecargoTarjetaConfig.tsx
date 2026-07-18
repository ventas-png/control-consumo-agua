import { useEffect, useState, type CSSProperties } from 'react'
import { notify } from '../shared/Dialog'
import {
  fetchRecargoTarjetaConfig,
  upsertRecargoTarjeta,
  type RecargoTarjetaConfigFila,
} from '../../domain/cobros/paymentConfig'

// ============================================================================
// RecargoTarjetaConfig — recargo por pago con tarjeta al CLIENTE FINAL.
// ============================================================================
// El fee del payfac/tarjeta lo absorbía el tenant en su liquidación. Aquí el
// company_owner define, por canal, el recargo (pct + fijo) que se traslada al
// cliente final: el edge create-charge lo suma al total del checkout y lo
// sella en payment_requests.recargo — el abono al recibo/cuota sigue siendo
// el monto base. Sin fila activa no hay recargo (default seguro).
// No confundir con la comisión de plataforma (F7, la fija el superadmin).

const CANALES: Array<{ canal: string; label: string; hint: string }> = [
  { canal: 'default', label: 'Todos los canales', hint: 'Aplica a cualquier proveedor sin fila propia' },
  { canal: 'qpaypro', label: 'QPayPro', hint: 'Override solo para cobros vía QPayPro' },
  { canal: 'stripe', label: 'Stripe', hint: 'Override solo para cobros vía Stripe' },
  { canal: 'paypal', label: 'PayPal', hint: 'Override solo para cobros vía PayPal' },
]

interface Edicion {
  activo: boolean
  /** Capturado en % (5 = 5%); se guarda como fracción. */
  pctStr: string
  fijoStr: string
  /** ¿Existe fila en BD o el usuario la tocó? Solo esas se guardan. */
  tocada: boolean
}

interface Props {
  companyId: string
}

export function RecargoTarjetaConfig({ companyId }: Props) {
  const [filas, setFilas] = useState<Record<string, Edicion>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelado = false
    setLoading(true)
    void fetchRecargoTarjetaConfig(companyId).then(({ data, error }) => {
      if (cancelado) return
      if (error) notify({ variant: 'error', title: 'Error', text: `No se pudo leer el recargo: ${error}` })
      const base: Record<string, Edicion> = {}
      for (const c of CANALES) {
        const fila = data.find(f => f.canal === c.canal)
        base[c.canal] = fila
          ? { activo: fila.activo, pctStr: String(fila.pct * 100), fijoStr: String(fila.fijo), tocada: true }
          : { activo: false, pctStr: '0', fijoStr: '0', tocada: false }
      }
      setFilas(base)
      setLoading(false)
    })
    return () => { cancelado = true }
  }, [companyId])

  function editar(canal: string, patch: Partial<Edicion>) {
    setFilas(prev => ({ ...prev, [canal]: { ...prev[canal], ...patch, tocada: true } }))
  }

  async function guardar() {
    const aGuardar: RecargoTarjetaConfigFila[] = []
    for (const c of CANALES) {
      const e = filas[c.canal]
      if (!e || !e.tocada) continue
      const pct = Number(e.pctStr)
      const fijo = Number(e.fijoStr)
      if (!Number.isFinite(pct) || pct < 0 || pct > 20) {
        notify({ variant: 'warning', title: 'Porcentaje inválido', text: `${c.label}: el porcentaje debe estar entre 0 y 20.` })
        return
      }
      if (!Number.isFinite(fijo) || fijo < 0) {
        notify({ variant: 'warning', title: 'Monto fijo inválido', text: `${c.label}: el monto fijo no puede ser negativo.` })
        return
      }
      aGuardar.push({ canal: c.canal, activo: e.activo, pct: pct / 100, fijo })
    }
    if (aGuardar.length === 0) return

    setSaving(true)
    for (const fila of aGuardar) {
      const { error } = await upsertRecargoTarjeta(companyId, fila)
      if (error) {
        notify({ variant: 'error', title: 'No se pudo guardar', text: `${fila.canal}: ${error}` })
        setSaving(false)
        return
      }
    }
    setSaving(false)
    notify({ variant: 'success', title: 'Recargo guardado', text: 'Aplica a los cobros creados desde ahora.', duration: 2000 })
  }

  return (
    <div>
      <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '8px', color: 'var(--at-ink)' }}>
        Recargo por pago con tarjeta
      </h2>
      <p style={{ fontSize: '13px', color: 'var(--at-ink-3)', margin: '0 0 20px', maxWidth: '640px' }}>
        Traslada al cliente final el fee que tu procesador te cobra por cada pago con tarjeta:
        el cobro en línea suma este recargo al total del checkout (con desglose visible) y el
        abono a su recibo o cuota sigue siendo el monto base. Sin recargo activo, el fee lo
        absorbe tu empresa como hasta ahora. Se sella por cobro: cambiarlo no afecta pagos ya creados.
      </p>

      {loading ? (
        <div style={{ fontSize: '13px', color: 'var(--at-ink-3)' }}>Cargando…</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {CANALES.map(c => {
              const e = filas[c.canal]
              if (!e) return null
              return (
                <div
                  key={c.canal}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap',
                    padding: '12px 14px', borderRadius: '10px',
                    background: 'var(--at-surface-2)', border: '1px solid var(--at-line)',
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '190px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={e.activo}
                      onChange={ev => editar(c.canal, { activo: ev.target.checked })}
                      style={{ width: 16, height: 16 }}
                    />
                    <span>
                      <span style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--at-ink)' }}>{c.label}</span>
                      <span style={{ display: 'block', fontSize: '11px', color: 'var(--at-ink-3)' }}>{c.hint}</span>
                    </span>
                  </label>
                  <label style={campoStyle}>
                    <span style={campoLabelStyle}>% del monto</span>
                    <input
                      type="number" step="0.01" min="0" max="20" inputMode="decimal"
                      value={e.pctStr}
                      onChange={ev => editar(c.canal, { pctStr: ev.target.value })}
                      style={inputStyle}
                      aria-label={`Porcentaje de recargo — ${c.label}`}
                    />
                  </label>
                  <label style={campoStyle}>
                    <span style={campoLabelStyle}>Fijo por pago</span>
                    <input
                      type="number" step="0.01" min="0" inputMode="decimal"
                      value={e.fijoStr}
                      onChange={ev => editar(c.canal, { fijoStr: ev.target.value })}
                      style={inputStyle}
                      aria-label={`Monto fijo de recargo — ${c.label}`}
                    />
                  </label>
                </div>
              )
            })}
          </div>

          <button
            onClick={() => void guardar()}
            disabled={saving}
            style={{
              marginTop: '16px', padding: '11px 22px', borderRadius: '8px', border: 'none',
              background: saving ? 'var(--at-line-strong)' : 'linear-gradient(135deg, var(--at-primary), var(--at-primary-hover))',
              color: 'white', fontWeight: 700, fontSize: '14px',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Guardando...' : 'Guardar Recargo'}
          </button>
        </>
      )}
    </div>
  )
}

const campoStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '3px' }
const campoLabelStyle: CSSProperties = {
  fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)',
  textTransform: 'uppercase', letterSpacing: '0.04em',
}
const inputStyle: CSSProperties = {
  width: '110px', padding: '9px 10px', borderRadius: '8px',
  border: '1.5px solid var(--at-line)', fontSize: '16px', fontWeight: 600,
  fontFamily: 'inherit', background: 'var(--at-surface)', color: 'var(--at-ink)',
}
