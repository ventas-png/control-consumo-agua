import { useState, useEffect, type CSSProperties} from 'react'
import { notify } from '../shared/Dialog'
import {
  fetchCompanyPaymentConfig,
  setCompanyProviderActivo,
  savePaymentConfig,
  testStripeConnection,
} from '../../domain/cobros/paymentConfig'
import type { CompanyPaymentConfig } from '../../types'

// -- Reusable style objects --------------------------------------------------
const s = {
  card: {
    background: 'var(--at-surface-2)',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '24px',
    border: '1px solid var(--at-line)',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '20px',
  },
  title: {
    fontSize: '16px',
    fontWeight: 700,
    color: 'var(--at-ink)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  } as CSSProperties,
  subtitle: { fontSize: '13px', color: 'var(--at-ink-3)', marginTop: '4px' },
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: 700,
    color: 'var(--at-ink-2)',
    marginBottom: '8px',
  } as CSSProperties,
  input: {
    width: '100%',
    padding: '12px',
    borderRadius: '8px',
    border: '1.5px solid var(--at-line)',
    fontSize: '14px',
    fontFamily: 'monospace',
  },
  secretInput: {
    width: '100%',
    padding: '12px',
    paddingRight: '40px',
    borderRadius: '8px',
    border: '1.5px solid var(--at-line)',
    fontSize: '14px',
    fontFamily: 'monospace',
  },
  hint: { fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '6px' },
  warning: { fontSize: '11px', color: 'var(--at-danger)', marginTop: '6px', fontWeight: 600 } as CSSProperties,
  link: { color: 'var(--at-primary)' },
  toggleSecretBtn: {
    position: 'absolute',
    right: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '16px',
    color: 'var(--at-ink-3)',
  } as CSSProperties,
  editBtn: {
    fontSize: '13px',
    color: 'var(--at-primary)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
    marginBottom: '16px',
  } as CSSProperties,
  fieldGroup: { marginBottom: '20px' },
  fieldGroupLast: { marginBottom: '24px' },
  validationError: { fontSize: '11px', color: 'var(--at-danger)', marginTop: '4px' },
} as const

function badge(configured: boolean) {
  return {
    padding: '2px 10px',
    borderRadius: '20px',
    fontSize: '11px',
    fontWeight: 700,
    background: configured ? 'var(--at-success-tint)' : 'var(--at-danger-tint)',
    color: configured ? 'var(--at-success-strong)' : 'var(--at-danger-strong)',
  } as CSSProperties
}

function toggleBtn(active: boolean, saving: boolean) {
  return {
    padding: '10px 16px',
    borderRadius: '8px',
    border: 'none',
    background: active ? 'var(--at-success)' : 'var(--at-line)',
    color: active ? 'white' : 'var(--at-ink-3)',
    fontWeight: 700,
    fontSize: '13px',
    cursor: saving ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
  } as CSSProperties
}

function primaryBtn(disabled: boolean) {
  return {
    flex: 1,
    padding: '12px',
    borderRadius: '8px',
    border: 'none',
    background: disabled ? 'var(--at-line-strong)' : 'linear-gradient(135deg,var(--at-primary),var(--at-primary-hover))',
    color: 'white',
    fontWeight: 700,
    fontSize: '14px',
    cursor: disabled ? 'not-allowed' : 'pointer',
  } as CSSProperties
}

// -- Validation helpers ------------------------------------------------------
const isValidStripePublicKey = (k: string) => /^pk_(live|test)_/.test(k)
const isValidStripeSecretKey = (k: string) => /^(sk|rk)_(live|test)_/.test(k)

// -- Main component ----------------------------------------------------------
interface Props {
  companyId: string
  onConfigUpdated: () => void
}

export function StripePayPalConfig({ companyId, onConfigUpdated }: Props) {
  const [config, setConfig] = useState<CompanyPaymentConfig>({
    stripe_configured: false,
    stripe_activo: false,
    paypal_configured: false,
    paypal_activo: false,
  })
  const [loading, setLoading] = useState(true)
  const [savingStripe, setSavingStripe] = useState(false)
  const [savingPaypal, setSavingPaypal] = useState(false)
  const [testingStripe, setTestingStripe] = useState(false)
  const [showStripeForm, setShowStripeForm] = useState(false)
  const [showPaypalForm, setShowPaypalForm] = useState(false)

  useEffect(() => {
    cargarConfig()
  }, [companyId])

  async function cargarConfig() {
    setLoading(true)
    const { data } = await fetchCompanyPaymentConfig(companyId)

    if (data) {
      setConfig({
        stripe_public_key: data.stripe_public_key || '',
        stripe_configured: data.stripe_configured || false,
        stripe_activo: data.stripe_activo !== false,
        paypal_client_id: data.paypal_client_id || '',
        paypal_configured: data.paypal_configured || false,
        paypal_activo: data.paypal_activo !== false,
      })
    }
    setLoading(false)
  }

  async function toggleStripe() {
    if (!config.stripe_configured) {
      notify({
        variant: 'warning',
        title: 'Stripe no está configurado',
        text: 'Configura las credenciales de Stripe primero',
      })
      return
    }

    setSavingStripe(true)
    const nuevoEstado = !config.stripe_activo
    const { error } = await setCompanyProviderActivo(companyId, { stripe_activo: nuevoEstado })

    setSavingStripe(false)

    if (error) {
      notify({ variant: 'error', title: 'Error', text: error })
    } else {
      setConfig(prev => ({ ...prev, stripe_activo: nuevoEstado }))
      notify({
        variant: 'success',
        title: nuevoEstado ? 'Stripe activado' : 'Stripe desactivado',
        duration: 1500,
      })
      onConfigUpdated()
    }
  }

  async function togglePayPal() {
    if (!config.paypal_configured) {
      notify({
        variant: 'warning',
        title: 'PayPal no está configurado',
        text: 'Configura las credenciales de PayPal primero',
      })
      return
    }

    setSavingPaypal(true)
    const nuevoEstado = !config.paypal_activo
    const { error } = await setCompanyProviderActivo(companyId, { paypal_activo: nuevoEstado })

    setSavingPaypal(false)

    if (error) {
      notify({ variant: 'error', title: 'Error', text: error })
    } else {
      setConfig(prev => ({ ...prev, paypal_activo: nuevoEstado }))
      notify({
        variant: 'success',
        title: nuevoEstado ? 'PayPal activado' : 'PayPal desactivado',
        duration: 1500,
      })
      onConfigUpdated()
    }
  }

  async function guardarStripe(publicKey: string, secretKey: string) {
    if (!publicKey || !secretKey) {
      notify({ variant: 'warning', title: 'Campos requeridos' })
      return
    }

    if (!isValidStripePublicKey(publicKey)) {
      notify({
        variant: 'error',
        title: 'Formato inválido',
        text: 'La Public Key debe comenzar con pk_live_ o pk_test_',
      })
      return
    }

    if (!isValidStripeSecretKey(secretKey)) {
      notify({
        variant: 'error',
        title: 'Formato inválido',
        text: 'La Secret Key debe comenzar con sk_live_ o sk_test_',
      })
      return
    }

    setSavingStripe(true)

    const { error: fnError } = await savePaymentConfig({ companyId, provider: 'stripe', publicKey, secretKey })

    setSavingStripe(false)

    if (fnError) {
      notify({
        variant: 'error',
        title: 'Error al guardar',
        text: 'No se pudo guardar la configuración. Intenta de nuevo.',
      })
      return
    }

    notify({
      variant: 'success',
      title: 'Stripe configurado',
      duration: 1500,
    })
    setShowStripeForm(false)
    onConfigUpdated()
    void cargarConfig()
  }

  async function guardarPayPal(clientId: string, clientSecret: string) {
    if (!clientId || !clientSecret) {
      notify({ variant: 'warning', title: 'Campos requeridos' })
      return
    }

    setSavingPaypal(true)

    const { error: fnError } = await savePaymentConfig({ companyId, provider: 'paypal', publicKey: clientId, secretKey: clientSecret })

    setSavingPaypal(false)

    if (fnError) {
      notify({
        variant: 'error',
        title: 'Error al guardar',
        text: 'No se pudo guardar la configuración. Intenta de nuevo.',
      })
      return
    }

    notify({
      variant: 'success',
      title: 'PayPal configurado',
      duration: 1500,
    })
    setShowPaypalForm(false)
    onConfigUpdated()
    void cargarConfig()
  }

  async function probarConexionStripe() {
    setTestingStripe(true)
    try {
      const { error } = await testStripeConnection(companyId)

      if (!error) {
        notify({
          variant: 'success',
          title: 'Conexión exitosa',
          text: 'Stripe está configurado correctamente',
          duration: 1500,
        })
      } else {
        notify({
          variant: 'error',
          title: 'Error de conexión',
          text: 'Verifica tus keys de Stripe',
        })
      }
    } finally {
      setTestingStripe(false)
    }
  }

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Cargando...</div>
  }

  return (
    <div>
      <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '24px', color: 'var(--at-ink)' }}>
        Configuración de Pagos Online
      </h2>

      {/* Stripe Section */}
      <div style={s.card}>
        <div style={s.cardHeader}>
          <div>
            <div style={s.title}>
              Stripe
              <span style={badge(config.stripe_configured)}>
                {config.stripe_configured ? 'Configurado' : 'No configurado'}
              </span>
            </div>
            <div style={s.subtitle}>
              {config.stripe_configured
                ? config.stripe_activo ? 'Los clientes pueden pagar con Stripe' : 'Stripe está desactivado'
                : 'Configura las credenciales de Stripe para habilitar pagos en línea'}
            </div>
          </div>
          {config.stripe_configured && (
            <button
              onClick={() => void toggleStripe()}
              disabled={savingStripe}
              style={toggleBtn(config.stripe_activo ?? false, savingStripe)}
            >
              {savingStripe ? 'Guardando...' : config.stripe_activo ? 'Activo' : 'Inactivo'}
            </button>
          )}
        </div>

        {config.stripe_configured && (
          <button onClick={() => setShowStripeForm(prev => !prev)} style={s.editBtn}>
            {showStripeForm ? 'Ocultar' : 'Editar configuración'}
          </button>
        )}

        {(showStripeForm || !config.stripe_configured) && (
          <StripeConfigForm
            config={config}
            saving={savingStripe}
            testing={testingStripe}
            onSave={guardarStripe}
            onTest={probarConexionStripe}
          />
        )}
      </div>

      {/* PayPal Section */}
      <div style={s.card}>
        <div style={s.cardHeader}>
          <div>
            <div style={s.title}>
              PayPal
              <span style={badge(config.paypal_configured)}>
                {config.paypal_configured ? 'Configurado' : 'No configurado'}
              </span>
            </div>
            <div style={s.subtitle}>
              {config.paypal_configured
                ? config.paypal_activo ? 'Los clientes pueden pagar con PayPal' : 'PayPal está desactivado'
                : 'Configura las credenciales de PayPal para habilitar pagos con esta plataforma'}
            </div>
          </div>
          {config.paypal_configured && (
            <button
              onClick={() => void togglePayPal()}
              disabled={savingPaypal}
              style={toggleBtn(config.paypal_activo ?? false, savingPaypal)}
            >
              {savingPaypal ? 'Guardando...' : config.paypal_activo ? 'Activo' : 'Inactivo'}
            </button>
          )}
        </div>

        {config.paypal_configured && (
          <button onClick={() => setShowPaypalForm(prev => !prev)} style={s.editBtn}>
            {showPaypalForm ? 'Ocultar' : 'Editar configuración'}
          </button>
        )}

        {(showPaypalForm || !config.paypal_configured) && (
          <PayPalConfigForm
            config={config}
            saving={savingPaypal}
            onSave={guardarPayPal}
          />
        )}
      </div>
    </div>
  )
}

// -- Stripe Config Form ------------------------------------------------------
interface StripeFormProps {
  config: CompanyPaymentConfig
  saving: boolean
  testing: boolean
  onSave: (publicKey: string, secretKey: string) => void
  onTest: () => void
}

function StripeConfigForm({ config, saving, testing, onSave, onTest }: StripeFormProps) {
  const [publicKey, setPublicKey] = useState(config.stripe_public_key || '')
  const [secretKey, setSecretKey] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [pkError, setPkError] = useState('')
  const [skError, setSkError] = useState('')

  function validateAndSave() {
    let hasError = false

    if (publicKey && !isValidStripePublicKey(publicKey)) {
      setPkError('Debe comenzar con pk_live_ o pk_test_')
      hasError = true
    } else {
      setPkError('')
    }

    if (secretKey && !isValidStripeSecretKey(secretKey)) {
      setSkError('Debe comenzar con sk_live_ o sk_test_')
      hasError = true
    } else {
      setSkError('')
    }

    if (!hasError) {
      onSave(publicKey, secretKey)
    }
  }

  return (
    <div>
      <div style={s.fieldGroup}>
        <label htmlFor="stripe-public-key" style={s.label}>
          Public Key (pk_live_xxx) *
        </label>
        <input
          id="stripe-public-key"
          type="text"
          value={publicKey}
          onChange={e => { setPublicKey(e.target.value); setPkError('') }}
          placeholder="pk_live_..."
          style={s.input}
        />
        {pkError
          ? <div style={s.validationError}>{pkError}</div>
          : (
            <div style={s.hint}>
              Obtén esta key en tu dashboard de Stripe →{' '}
              <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" style={s.link}>
                Stripe API Keys
              </a>
            </div>
          )}
      </div>

      <div style={s.fieldGroupLast}>
        <label htmlFor="stripe-secret-key" style={s.label}>
          Secret Key (sk_live_xxx) *
        </label>
        <div style={{ position: 'relative' }}>
          <input
            id="stripe-secret-key"
            type={showSecret ? 'text' : 'password'}
            value={secretKey}
            onChange={e => { setSecretKey(e.target.value); setSkError('') }}
            placeholder="sk_live_..."
            style={s.secretInput}
          />
          <button type="button" onClick={() => setShowSecret(!showSecret)} style={s.toggleSecretBtn}>
            {showSecret ? '🙈' : '👁️'}
          </button>
        </div>
        {skError
          ? <div style={s.validationError}>{skError}</div>
          : <div style={s.warning}>Nunca compartas tu Secret Key. Se almacena de forma segura y solo es accesible por el servidor.</div>}
      </div>

      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          onClick={validateAndSave}
          disabled={saving || !publicKey || !secretKey}
          style={primaryBtn(saving || !publicKey || !secretKey)}
        >
          {saving ? 'Guardando...' : 'Guardar Configuración'}
        </button>
        {config.stripe_configured && (
          <button
            onClick={onTest}
            disabled={testing}
            style={{
              padding: '12px 20px',
              borderRadius: '8px',
              border: '1.5px solid var(--at-primary)',
              background: 'var(--at-surface)',
              color: 'var(--at-primary)',
              fontWeight: 700,
              fontSize: '14px',
              cursor: testing ? 'not-allowed' : 'pointer',
            }}
          >
            {testing ? 'Probando...' : 'Probar'}
          </button>
        )}
      </div>
    </div>
  )
}

// -- PayPal Config Form ------------------------------------------------------
interface PayPalFormProps {
  config: CompanyPaymentConfig
  saving: boolean
  onSave: (clientId: string, clientSecret: string) => void
}

function PayPalConfigForm({ config, saving, onSave }: PayPalFormProps) {
  const [clientId, setClientId] = useState(config.paypal_client_id || '')
  const [clientSecret, setClientSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)

  return (
    <div>
      <div style={s.fieldGroup}>
        <label htmlFor="paypal-client-id" style={s.label}>
          Client ID *
        </label>
        <input
          id="paypal-client-id"
          type="text"
          value={clientId}
          onChange={e => setClientId(e.target.value)}
          placeholder="AVG3..."
          style={s.input}
        />
        <div style={s.hint}>
          Obtén esta key en tu dashboard de PayPal →{' '}
          <a href="https://developer.paypal.com/dashboard" target="_blank" rel="noopener noreferrer" style={s.link}>
            PayPal Developer Dashboard
          </a>
        </div>
      </div>

      <div style={s.fieldGroupLast}>
        <label htmlFor="paypal-client-secret" style={s.label}>
          Client Secret *
        </label>
        <div style={{ position: 'relative' }}>
          <input
            id="paypal-client-secret"
            type={showSecret ? 'text' : 'password'}
            value={clientSecret}
            onChange={e => setClientSecret(e.target.value)}
            placeholder="Secret..."
            style={s.secretInput}
          />
          <button type="button" onClick={() => setShowSecret(!showSecret)} style={s.toggleSecretBtn}>
            {showSecret ? '🙈' : '👁️'}
          </button>
        </div>
        <div style={s.warning}>
          Nunca compartas tu Client Secret. Se almacena de forma segura y solo es accesible por el servidor.
        </div>
      </div>

      <button
        onClick={() => onSave(clientId, clientSecret)}
        disabled={saving || !clientId || !clientSecret}
        style={{ ...primaryBtn(saving || !clientId || !clientSecret), width: '100%' }}
      >
        {saving ? 'Guardando...' : 'Guardar Configuración'}
      </button>
    </div>
  )
}
