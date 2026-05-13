import { useState, useEffect } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../lib/supabase'
import type { CompanyPaymentConfig } from '../../types'

// ─── Validation ──────────────────────────────────────────────────────────────
const isValidStripePublicKey = (k: string) => /^pk_(live|test)_/.test(k)
const isValidStripeSecretKey = (k: string) => /^(sk|rk)_(live|test)_/.test(k)

const PAYPAL_CURRENCIES = [
  { code: 'USD', label: 'USD — Dólar estadounidense' },
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'GBP', label: 'GBP — Libra esterlina' },
  { code: 'CAD', label: 'CAD — Dólar canadiense' },
  { code: 'AUD', label: 'AUD — Dólar australiano' },
  { code: 'MXN', label: 'MXN — Peso mexicano' },
  { code: 'BRL', label: 'BRL — Real brasileño' },
  { code: 'COP', label: 'COP — Peso colombiano' },
  { code: 'GTQ', label: 'GTQ — Quetzal guatemalteco' },
]

// ─── Logos ───────────────────────────────────────────────────────────────────
function StripeLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="#635BFF" />
      <path
        d="M14.07 13.16c0-.77.63-1.07 1.67-1.07 1.49 0 3.38.45 4.87 1.26V9.42C19.1 8.84 17.6 8.6 16.1 8.6c-3.52 0-5.86 1.84-5.86 4.9 0 4.78 6.58 4.02 6.58 6.08 0 .91-.79 1.21-1.89 1.21-1.64 0-3.73-.67-5.38-1.58v3.97c1.83.79 3.69 1.12 5.38 1.12 4.1 0 6.91-2.03 6.91-5.13-.04-5.16-6.57-4.24-6.57-6.01z"
        fill="white"
      />
    </svg>
  )
}

function PayPalLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="#003087" />
      <path
        d="M21.8 10.5c.3 2-1.2 4.3-3.2 5.2-.3.1-.6.1-.9.1h-2.5l-.7 4.1H12l2-11.4h4.5c1.7 0 3 .7 3.3 2zm-6.3 3.7h1.7c.8 0 1.7-.4 2-1.1.4-.9-.1-1.9-1.2-1.9h-1.7l-.8 3z"
        fill="white"
      />
      <path
        d="M24.5 12.3c.3 2-1.2 4.3-3.2 5.2-.3.1-.6.1-.9.1h-1.6l-.5 3h-2.4l1.9-10.9h3.4c1.8.1 3.1.8 3.3 2.6z"
        fill="#009cde"
      />
    </svg>
  )
}

// ─── Status chip ─────────────────────────────────────────────────────────────
function StatusChip({ configured, active }: { configured: boolean; active: boolean }) {
  if (!configured) return (
    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: 'rgba(100,116,139,.12)', color: '#64748b' }}>
      No configurado
    </span>
  )
  if (active) return (
    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: 'rgba(34,197,94,.12)', color: '#15803d' }}>
      Activo
    </span>
  )
  return (
    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: 'rgba(245,158,11,.12)', color: '#92400e' }}>
      Inactivo
    </span>
  )
}

// ─── Inline form helper ───────────────────────────────────────────────────────
function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '6px' }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '5px' }}>{hint}</div>}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: '8px',
  border: '1.5px solid #e2e8f0', fontSize: '13px', fontFamily: 'monospace',
  outline: 'none', boxSizing: 'border-box',
}

// ─── Main component ───────────────────────────────────────────────────────────
interface Props {
  companyId: string
  onConfigUpdated: () => void
}

type Config = CompanyPaymentConfig & { paypal_currency_code: string }

export function StripePayPalConfig({ companyId, onConfigUpdated }: Props) {
  const [config, setConfig] = useState<Config>({
    stripe_configured: false,
    stripe_activo: false,
    stripe_public_key: '',
    paypal_configured: false,
    paypal_activo: false,
    paypal_client_id: '',
    paypal_currency_code: 'USD',
  })
  const [loading, setLoading] = useState(true)

  // Stripe form state
  const [showStripeForm, setShowStripeForm] = useState(false)
  const [savingStripe, setSavingStripe] = useState(false)
  const [testingStripe, setTestingStripe] = useState(false)
  const [stripePublicKey, setStripePublicKey] = useState('')
  const [stripeSecretKey, setStripeSecretKey] = useState('')
  const [showStripeSecret, setShowStripeSecret] = useState(false)

  // PayPal form state
  const [showPaypalForm, setShowPaypalForm] = useState(false)
  const [savingPaypal, setSavingPaypal] = useState(false)
  const [paypalClientId, setPaypalClientId] = useState('')
  const [paypalCurrency, setPaypalCurrency] = useState('USD')

  useEffect(() => { void cargarConfig() }, [companyId])

  async function cargarConfig() {
    setLoading(true)
    const { data } = await supabase
      .from('companies')
      .select('stripe_public_key,stripe_configured,stripe_activo,paypal_client_id,paypal_currency_code,paypal_configured,paypal_activo')
      .eq('id', companyId)
      .single()

    if (data) {
      const c: Config = {
        stripe_public_key: (data as any).stripe_public_key || '',
        stripe_configured: data.stripe_configured || false,
        stripe_activo: data.stripe_activo !== false,
        paypal_client_id: data.paypal_client_id || '',
        paypal_currency_code: (data as any).paypal_currency_code || 'USD',
        paypal_configured: data.paypal_configured || false,
        paypal_activo: data.paypal_activo !== false,
      }
      setConfig(c)
      setStripePublicKey(c.stripe_public_key || '')
      setPaypalClientId(c.paypal_client_id || '')
      setPaypalCurrency(c.paypal_currency_code)
    }
    setLoading(false)
  }

  // ── Stripe actions ──
  async function guardarStripe() {
    if (!stripePublicKey || !stripeSecretKey) {
      void Swal.fire({ icon: 'warning', title: 'Campos requeridos', text: 'Ingresa la Public Key y la Secret Key.' })
      return
    }
    if (!isValidStripePublicKey(stripePublicKey)) {
      void Swal.fire({ icon: 'error', title: 'Public Key inválida', text: 'Debe comenzar con pk_live_ o pk_test_' })
      return
    }
    if (!isValidStripeSecretKey(stripeSecretKey)) {
      void Swal.fire({ icon: 'error', title: 'Secret Key inválida', text: 'Debe comenzar con sk_live_ o sk_test_' })
      return
    }
    setSavingStripe(true)
    const { error } = await supabase.functions.invoke('save-payment-config', {
      body: { companyId, provider: 'stripe', publicKey: stripePublicKey, secretKey: stripeSecretKey },
    })
    setSavingStripe(false)
    if (error) {
      void Swal.fire({ icon: 'error', title: 'Error al guardar', text: 'No se pudo guardar la configuración.' })
      return
    }
    void Swal.fire({ icon: 'success', title: 'Stripe configurado', timer: 1500, showConfirmButton: false })
    setShowStripeForm(false)
    setStripeSecretKey('')
    onConfigUpdated()
    void cargarConfig()
  }

  async function toggleStripe() {
    if (!config.stripe_configured) return
    const next = !config.stripe_activo
    const { error } = await supabase.from('companies').update({ stripe_activo: next }).eq('id', companyId)
    if (!error) {
      setConfig(p => ({ ...p, stripe_activo: next }))
      onConfigUpdated()
    }
  }

  async function desconectarStripe() {
    const { isConfirmed } = await Swal.fire({
      icon: 'warning',
      title: '¿Desconectar Stripe?',
      text: 'Se eliminarán las credenciales guardadas. Podrás volver a configurarlo en cualquier momento.',
      showCancelButton: true,
      confirmButtonText: 'Desconectar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef4444',
    })
    if (!isConfirmed) return
    await supabase.from('companies').update({ stripe_configured: false, stripe_activo: false, stripe_public_key: null }).eq('id', companyId)
    await supabase.from('company_payment_secrets').update({ stripe_secret_key: null }).eq('company_id', companyId)
    void Swal.fire({ icon: 'success', title: 'Desconectado', timer: 1500, showConfirmButton: false })
    setShowStripeForm(false)
    onConfigUpdated()
    void cargarConfig()
  }

  async function probarStripe() {
    setTestingStripe(true)
    const { error } = await supabase.functions.invoke('test-stripe', { body: { companyId } })
    setTestingStripe(false)
    if (!error) {
      void Swal.fire({ icon: 'success', title: '¡Conexión exitosa!', text: 'Stripe está respondiendo correctamente.', timer: 2000, showConfirmButton: false })
    } else {
      void Swal.fire({ icon: 'error', title: 'Error de conexión', text: 'Verifica que tus keys de Stripe sean correctas.' })
    }
  }

  // ── PayPal actions ──
  async function guardarPayPal() {
    if (!paypalClientId.trim()) {
      void Swal.fire({ icon: 'warning', title: 'Ingresa el Client ID de PayPal' })
      return
    }
    setSavingPaypal(true)
    const { error } = await supabase
      .from('companies')
      .update({ paypal_client_id: paypalClientId.trim(), paypal_currency_code: paypalCurrency, paypal_configured: true, paypal_activo: true })
      .eq('id', companyId)
    setSavingPaypal(false)
    if (error) {
      void Swal.fire({ icon: 'error', title: 'Error al guardar', text: 'No se pudo guardar la configuración.' })
      return
    }
    void Swal.fire({ icon: 'success', title: 'PayPal configurado', timer: 1500, showConfirmButton: false })
    setShowPaypalForm(false)
    onConfigUpdated()
    void cargarConfig()
  }

  async function togglePayPal() {
    if (!config.paypal_configured) return
    const next = !config.paypal_activo
    const { error } = await supabase.from('companies').update({ paypal_activo: next }).eq('id', companyId)
    if (!error) {
      setConfig(p => ({ ...p, paypal_activo: next }))
      onConfigUpdated()
    }
  }

  async function desconectarPayPal() {
    const { isConfirmed } = await Swal.fire({
      icon: 'warning',
      title: '¿Desconectar PayPal?',
      text: 'Se eliminará el Client ID guardado. Podrás volver a configurarlo en cualquier momento.',
      showCancelButton: true,
      confirmButtonText: 'Desconectar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef4444',
    })
    if (!isConfirmed) return
    await supabase.from('companies').update({ paypal_configured: false, paypal_activo: false, paypal_client_id: null }).eq('id', companyId)
    void Swal.fire({ icon: 'success', title: 'Desconectado', timer: 1500, showConfirmButton: false })
    setShowPaypalForm(false)
    onConfigUpdated()
    void cargarConfig()
  }

  if (loading) {
    return <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>Cargando configuración…</div>
  }

  const stripeActive = config.stripe_configured && config.stripe_activo
  const paypalActive = config.paypal_configured && config.paypal_activo

  return (
    <div>
      {/* ── STRIPE ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <span style={{ fontSize: '22px' }}>💳</span>
        <div>
          <h3 style={{ margin: 0, color: '#0f172a', fontSize: '16px', fontWeight: 700 }}>
            Stripe — Pagos con Tarjeta
          </h3>
          <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
            Acepta tarjetas de crédito y débito de forma segura. Requiere una cuenta en{' '}
            <a href="https://stripe.com" target="_blank" rel="noopener noreferrer" style={{ color: '#635BFF' }}>stripe.com</a>.
          </p>
        </div>
      </div>

      {/* Status card */}
      <div style={{
        background: stripeActive ? 'rgba(34,197,94,.06)' : config.stripe_configured ? 'rgba(245,158,11,.06)' : 'rgba(100,116,139,.06)',
        border: `1.5px solid ${stripeActive ? 'rgba(34,197,94,.25)' : config.stripe_configured ? 'rgba(245,158,11,.25)' : 'rgba(100,116,139,.2)'}`,
        borderRadius: '12px', padding: '18px 20px', marginBottom: '16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <StripeLogo size={36} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <StatusChip configured={config.stripe_configured} active={config.stripe_activo ?? false} />
              {config.stripe_public_key && (
                <span style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>
                  {config.stripe_public_key.startsWith('pk_live') ? '🟢 Producción' : '🟡 Test'}
                </span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
              {config.stripe_configured
                ? config.stripe_activo
                  ? `Los clientes pueden pagar con tarjeta · ${config.stripe_public_key?.slice(0, 18)}…`
                  : 'Credenciales guardadas, pero el método de pago está desactivado.'
                : 'Conecta Stripe para habilitar pagos con tarjeta de crédito y débito.'}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {!config.stripe_configured ? (
            <button
              onClick={() => { setShowStripeForm(true); setShowPaypalForm(false) }}
              style={{
                padding: '10px 20px', borderRadius: '8px', border: 'none',
                background: '#635BFF', color: 'white',
                fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(99,91,255,.35)',
              }}
            >
              Configurar Stripe
            </button>
          ) : (
            <>
              {config.stripe_activo ? (
                <button onClick={() => void probarStripe()} disabled={testingStripe}
                  style={{ padding: '8px 14px', borderRadius: '8px', border: '1.5px solid rgba(99,91,255,.3)', background: 'rgba(99,91,255,.08)', color: '#635BFF', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                  {testingStripe ? 'Probando…' : 'Probar conexión'}
                </button>
              ) : null}
              <button onClick={() => void toggleStripe()}
                style={{ padding: '8px 14px', borderRadius: '8px', border: `1.5px solid ${stripeActive ? 'rgba(239,68,68,.3)' : 'rgba(34,197,94,.3)'}`, background: stripeActive ? 'rgba(239,68,68,.08)' : 'rgba(34,197,94,.08)', color: stripeActive ? '#dc2626' : '#16a34a', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                {stripeActive ? 'Desactivar' : 'Activar'}
              </button>
              <button onClick={() => { setShowStripeForm(f => !f); setShowPaypalForm(false) }}
                style={{ padding: '8px 14px', borderRadius: '8px', border: '1.5px solid #e2e8f0', background: 'white', color: '#475569', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                {showStripeForm ? 'Ocultar' : 'Editar'}
              </button>
              <button onClick={() => void desconectarStripe()}
                style={{ padding: '8px 14px', borderRadius: '8px', border: '1.5px solid rgba(239,68,68,.25)', background: 'rgba(239,68,68,.06)', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                Desconectar
              </button>
            </>
          )}
        </div>
      </div>

      {/* Stripe credentials form */}
      {showStripeForm && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
          <p style={{ margin: '0 0 16px', fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
            Credenciales de Stripe
          </p>

          <Field
            label="Publishable Key (pk_live_… o pk_test_…)"
            hint={<>Obtenla en <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" style={{ color: '#635BFF' }}>dashboard.stripe.com → API Keys</a></>}
          >
            <input type="text" value={stripePublicKey} onChange={e => setStripePublicKey(e.target.value)}
              placeholder="pk_live_..." style={inputStyle} />
          </Field>

          <Field
            label="Secret Key (sk_live_… o sk_test_…)"
            hint="Se almacena encriptada en el servidor. Nunca se expone al cliente."
          >
            <div style={{ position: 'relative' }}>
              <input type={showStripeSecret ? 'text' : 'password'} value={stripeSecretKey}
                onChange={e => setStripeSecretKey(e.target.value)}
                placeholder={config.stripe_configured ? '(guardada — ingresa una nueva para cambiarla)' : 'sk_live_...'}
                style={{ ...inputStyle, paddingRight: '44px' }} />
              <button type="button" onClick={() => setShowStripeSecret(v => !v)}
                style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#64748b' }}>
                {showStripeSecret ? '🙈' : '👁️'}
              </button>
            </div>
          </Field>

          <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
            <button onClick={() => void guardarStripe()} disabled={savingStripe || !stripePublicKey || !stripeSecretKey}
              style={{ flex: 1, padding: '11px', borderRadius: '8px', border: 'none', background: savingStripe || !stripePublicKey || !stripeSecretKey ? '#cbd5e1' : '#635BFF', color: 'white', fontWeight: 700, fontSize: '14px', cursor: savingStripe || !stripePublicKey || !stripeSecretKey ? 'not-allowed' : 'pointer' }}>
              {savingStripe ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setShowStripeForm(false)}
              style={{ padding: '11px 20px', borderRadius: '8px', border: '1.5px solid #e2e8f0', background: 'white', color: '#64748b', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Webhook info when configured */}
      {config.stripe_configured && !showStripeForm && (
        <div style={{ background: 'rgba(99,91,255,.04)', border: '1px solid rgba(99,91,255,.15)', borderRadius: '10px', padding: '12px 16px', marginBottom: '24px', fontSize: '12px', color: '#475569' }}>
          <strong style={{ color: '#0f172a' }}>Webhook de Stripe</strong> — Para registrar pagos automáticamente, configura en tu dashboard de Stripe un endpoint apuntando a tu función <code style={{ background: 'rgba(99,91,255,.1)', padding: '1px 5px', borderRadius: '4px' }}>stripe-webhook-handler</code> y guarda el <em>Signing Secret</em> en la configuración de tu cuenta.
        </div>
      )}

      {/* ── PAYPAL ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', marginTop: config.stripe_configured && !showStripeForm ? '0' : '24px' }}>
        <span style={{ fontSize: '22px' }}>🅿️</span>
        <div>
          <h3 style={{ margin: 0, color: '#0f172a', fontSize: '16px', fontWeight: 700 }}>
            PayPal — Pagos con Cuenta PayPal
          </h3>
          <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#64748b' }}>
            Solo necesitas tu Client ID público. Requiere una cuenta en{' '}
            <a href="https://www.paypal.com" target="_blank" rel="noopener noreferrer" style={{ color: '#003087' }}>paypal.com</a>.
          </p>
        </div>
      </div>

      {/* PayPal status card */}
      <div style={{
        background: paypalActive ? 'rgba(34,197,94,.06)' : config.paypal_configured ? 'rgba(245,158,11,.06)' : 'rgba(100,116,139,.06)',
        border: `1.5px solid ${paypalActive ? 'rgba(34,197,94,.25)' : config.paypal_configured ? 'rgba(245,158,11,.25)' : 'rgba(100,116,139,.2)'}`,
        borderRadius: '12px', padding: '18px 20px', marginBottom: '16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <PayPalLogo size={36} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <StatusChip configured={config.paypal_configured} active={config.paypal_activo ?? false} />
              {config.paypal_configured && (
                <span style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>
                  {config.paypal_currency_code}
                </span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
              {config.paypal_configured
                ? config.paypal_activo
                  ? `Los clientes pueden pagar con PayPal · ${config.paypal_client_id?.slice(0, 20)}…`
                  : 'Client ID guardado, pero el método de pago está desactivado.'
                : 'Conecta PayPal para que tus clientes puedan pagar con su cuenta PayPal.'}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {!config.paypal_configured ? (
            <button onClick={() => { setShowPaypalForm(true); setShowStripeForm(false) }}
              style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#003087', color: 'white', fontSize: '13px', fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,48,135,.3)' }}>
              Configurar PayPal
            </button>
          ) : (
            <>
              <button onClick={() => void togglePayPal()}
                style={{ padding: '8px 14px', borderRadius: '8px', border: `1.5px solid ${paypalActive ? 'rgba(239,68,68,.3)' : 'rgba(34,197,94,.3)'}`, background: paypalActive ? 'rgba(239,68,68,.08)' : 'rgba(34,197,94,.08)', color: paypalActive ? '#dc2626' : '#16a34a', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                {paypalActive ? 'Desactivar' : 'Activar'}
              </button>
              <button onClick={() => { setShowPaypalForm(f => !f); setShowStripeForm(false) }}
                style={{ padding: '8px 14px', borderRadius: '8px', border: '1.5px solid #e2e8f0', background: 'white', color: '#475569', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                {showPaypalForm ? 'Ocultar' : 'Editar'}
              </button>
              <button onClick={() => void desconectarPayPal()}
                style={{ padding: '8px 14px', borderRadius: '8px', border: '1.5px solid rgba(239,68,68,.25)', background: 'rgba(239,68,68,.06)', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                Desconectar
              </button>
            </>
          )}
        </div>
      </div>

      {/* PayPal credentials form */}
      {showPaypalForm && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: '#1d4ed8', marginBottom: '16px' }}>
            Solo necesitas el <strong>Client ID</strong> público de tu app de PayPal. No se requiere ningún secreto.
          </div>

          <Field
            label="Client ID de PayPal"
            hint={<>Encuéntralo en <a href="https://developer.paypal.com/dashboard/applications" target="_blank" rel="noopener noreferrer" style={{ color: '#003087' }}>PayPal Developer → My Apps &amp; Credentials</a></>}
          >
            <input type="text" value={paypalClientId} onChange={e => setPaypalClientId(e.target.value)}
              placeholder="AXxxxxxxxxxxxxxxxxx..." style={inputStyle} />
          </Field>

          <Field label="Moneda para cobros" hint="PayPal procesa el cobro en esta moneda (código ISO 4217).">
            <select value={paypalCurrency} onChange={e => setPaypalCurrency(e.target.value)}
              style={{ ...inputStyle, fontFamily: 'inherit', background: 'white', cursor: 'pointer' }}>
              {PAYPAL_CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </Field>

          <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
            <button onClick={() => void guardarPayPal()} disabled={savingPaypal || !paypalClientId.trim()}
              style={{ flex: 1, padding: '11px', borderRadius: '8px', border: 'none', background: savingPaypal || !paypalClientId.trim() ? '#cbd5e1' : '#003087', color: 'white', fontWeight: 700, fontSize: '14px', cursor: savingPaypal || !paypalClientId.trim() ? 'not-allowed' : 'pointer' }}>
              {savingPaypal ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setShowPaypalForm(false)}
              style={{ padding: '11px 20px', borderRadius: '8px', border: '1.5px solid #e2e8f0', background: 'white', color: '#64748b', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
