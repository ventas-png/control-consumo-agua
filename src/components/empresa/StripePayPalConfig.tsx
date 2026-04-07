import { useState, useEffect } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../lib/supabase'
import type { CompanyPaymentConfig } from '../../types'

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

  useEffect(() => {
    cargarConfig()
  }, [companyId])

  async function cargarConfig() {
    setLoading(true)
    const { data } = await supabase
      .from('companies')
      .select(
        'stripe_public_key,stripe_configured,stripe_activo,paypal_client_id,paypal_configured,paypal_activo'
      )
      .eq('id', companyId)
      .single()

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
      void Swal.fire({
        icon: 'warning',
        title: 'Stripe no está configurado',
        text: 'Configura las credenciales de Stripe primero',
      })
      return
    }

    setSavingStripe(true)
    const nuevoEstado = !config.stripe_activo
    const { error } = await supabase
      .from('companies')
      .update({
        stripe_activo: nuevoEstado,
      })
      .eq('id', companyId)

    setSavingStripe(false)

    if (error) {
      void Swal.fire({ icon: 'error', title: 'Error', text: error.message })
    } else {
      setConfig(prev => ({ ...prev, stripe_activo: nuevoEstado }))
      void Swal.fire({
        icon: 'success',
        title: nuevoEstado ? '✅ Stripe activado' : '⏹️ Stripe desactivado',
        timer: 1500,
        showConfirmButton: false,
      })
      onConfigUpdated()
    }
  }

  async function togglePayPal() {
    if (!config.paypal_configured) {
      void Swal.fire({
        icon: 'warning',
        title: 'PayPal no está configurado',
        text: 'Configura las credenciales de PayPal primero',
      })
      return
    }

    setSavingPaypal(true)
    const nuevoEstado = !config.paypal_activo
    const { error } = await supabase
      .from('companies')
      .update({
        paypal_activo: nuevoEstado,
      })
      .eq('id', companyId)

    setSavingPaypal(false)

    if (error) {
      void Swal.fire({ icon: 'error', title: 'Error', text: error.message })
    } else {
      setConfig(prev => ({ ...prev, paypal_activo: nuevoEstado }))
      void Swal.fire({
        icon: 'success',
        title: nuevoEstado ? '✅ PayPal activado' : '⏹️ PayPal desactivado',
        timer: 1500,
        showConfirmButton: false,
      })
      onConfigUpdated()
    }
  }

  async function guardarStripe(publicKey: string, secretKey: string) {
    if (!publicKey || !secretKey) {
      void Swal.fire({ icon: 'warning', title: 'Campos requeridos' })
      return
    }

    setSavingStripe(true)

    // Save secret key via Edge Function to avoid exposing it in the frontend
    const { error: fnError } = await supabase.functions.invoke('save-payment-config', {
      body: { companyId, provider: 'stripe', publicKey, secretKey },
    })

    if (fnError) {
      // Fallback: save public key only via direct update (secret stays server-side)
      const { error } = await supabase
        .from('companies')
        .update({
          stripe_public_key: publicKey,
          stripe_configured: true,
          stripe_activo: true,
        })
        .eq('id', companyId)

      setSavingStripe(false)
      if (error) {
        void Swal.fire({ icon: 'error', title: 'Error', text: error.message })
        return
      }
    } else {
      setSavingStripe(false)
    }

    void Swal.fire({
      icon: 'success',
      title: 'Stripe configurado',
      timer: 1500,
      showConfirmButton: false,
    })
    onConfigUpdated()
    void cargarConfig()
  }

  async function guardarPayPal(clientId: string, clientSecret: string) {
    if (!clientId || !clientSecret) {
      void Swal.fire({ icon: 'warning', title: 'Campos requeridos' })
      return
    }

    setSavingPaypal(true)

    // Save secret via Edge Function to avoid exposing it in the frontend
    const { error: fnError } = await supabase.functions.invoke('save-payment-config', {
      body: { companyId, provider: 'paypal', publicKey: clientId, secretKey: clientSecret },
    })

    if (fnError) {
      // Fallback: save client ID only via direct update (secret stays server-side)
      const { error } = await supabase
        .from('companies')
        .update({
          paypal_client_id: clientId,
          paypal_configured: true,
          paypal_activo: true,
        })
        .eq('id', companyId)

      setSavingPaypal(false)
      if (error) {
        void Swal.fire({ icon: 'error', title: 'Error', text: error.message })
        return
      }
    } else {
      setSavingPaypal(false)
    }

    void Swal.fire({
      icon: 'success',
      title: 'PayPal configurado',
      timer: 1500,
      showConfirmButton: false,
    })
    onConfigUpdated()
    void cargarConfig()
  }

  async function probarConexionStripe() {
    setTestingStripe(true)
    try {
      const { error } = await supabase.functions.invoke('test-stripe', {
        body: { companyId },
      })

      if (!error) {
        void Swal.fire({
          icon: 'success',
          title: 'Conexion exitosa',
          text: 'Stripe esta configurado correctamente',
          timer: 1500,
          showConfirmButton: false,
        })
      } else {
        void Swal.fire({
          icon: 'error',
          title: 'Error de conexion',
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
      <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '24px', color: '#0f172a' }}>
        ⚙️ Configuración de Pagos Online
      </h2>

      {/* Stripe Section */}
      <div style={{
        background: '#f8fafc',
        borderRadius: '12px',
        padding: '24px',
        marginBottom: '24px',
        border: '1px solid #e2e8f0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
              💳 Stripe
              <span style={{
                padding: '2px 10px',
                borderRadius: '20px',
                fontSize: '11px',
                fontWeight: 700,
                background: config.stripe_configured ? '#f0fdf4' : '#fee2e2',
                color: config.stripe_configured ? '#15803d' : '#991b1b',
              }}>
                {config.stripe_configured ? '✅ Configurado' : '⚠️ No configurado'}
              </span>
            </div>
            <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
              {config.stripe_configured
                ? config.stripe_activo ? 'Los clientes pueden pagar con Stripe' : 'Stripe está desactivado'
                : 'Configura las credenciales de Stripe para habilitar pagos en línea'}
            </div>
          </div>
          {config.stripe_configured && (
            <button
              onClick={() => void toggleStripe()}
              disabled={savingStripe}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: 'none',
                background: config.stripe_activo ? '#10b981' : '#e2e8f0',
                color: config.stripe_activo ? 'white' : '#64748b',
                fontWeight: 700,
                fontSize: '13px',
                cursor: savingStripe ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {savingStripe ? '⏳' : config.stripe_activo ? '✅ Activo' : '⏹️ Inactivo'}
            </button>
          )}
        </div>

        {config.stripe_configured && (
          <button
            onClick={() => {
              const form = document.getElementById('stripe-edit-form') as HTMLDivElement
              form.style.display = form.style.display === 'none' ? 'block' : 'none'
            }}
            style={{
              fontSize: '13px',
              color: '#0ea5e9',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              marginBottom: '16px',
            }}
          >
            📝 Editar configuración
          </button>
        )}

        <div id="stripe-edit-form" style={{ display: 'none' }}>
          <StripeConfigForm
            config={config}
            saving={savingStripe}
            testing={testingStripe}
            onSave={guardarStripe}
            onTest={probarConexionStripe}
          />
        </div>

        {!config.stripe_configured && (
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
      <div style={{
        background: '#f8fafc',
        borderRadius: '12px',
        padding: '24px',
        marginBottom: '24px',
        border: '1px solid #e2e8f0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
              🅿️ PayPal
              <span style={{
                padding: '2px 10px',
                borderRadius: '20px',
                fontSize: '11px',
                fontWeight: 700,
                background: config.paypal_configured ? '#f0fdf4' : '#fee2e2',
                color: config.paypal_configured ? '#15803d' : '#991b1b',
              }}>
                {config.paypal_configured ? '✅ Configurado' : '⚠️ No configurado'}
              </span>
            </div>
            <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
              {config.paypal_configured
                ? config.paypal_activo ? 'Los clientes pueden pagar con PayPal' : 'PayPal está desactivado'
                : 'Configura las credenciales de PayPal para habilitar pagos con esta plataforma'}
            </div>
          </div>
          {config.paypal_configured && (
            <button
              onClick={() => void togglePayPal()}
              disabled={savingPaypal}
              style={{
                padding: '10px 16px',
                borderRadius: '8px',
                border: 'none',
                background: config.paypal_activo ? '#10b981' : '#e2e8f0',
                color: config.paypal_activo ? 'white' : '#64748b',
                fontWeight: 700,
                fontSize: '13px',
                cursor: savingPaypal ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {savingPaypal ? '⏳' : config.paypal_activo ? '✅ Activo' : '⏹️ Inactivo'}
            </button>
          )}
        </div>

        {config.paypal_configured && (
          <button
            onClick={() => {
              const form = document.getElementById('paypal-edit-form') as HTMLDivElement
              form.style.display = form.style.display === 'none' ? 'block' : 'none'
            }}
            style={{
              fontSize: '13px',
              color: '#0ea5e9',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              marginBottom: '16px',
            }}
          >
            📝 Editar configuración
          </button>
        )}

        <div id="paypal-edit-form" style={{ display: 'none' }}>
          <PayPalConfigForm
            config={config}
            saving={savingPaypal}
            onSave={guardarPayPal}
          />
        </div>

        {!config.paypal_configured && (
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

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <label htmlFor="stripe-public-key" style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#475569', marginBottom: '8px' }}>
          Public Key (pk_live_xxx) *
        </label>
        <input
          id="stripe-public-key"
          type="text"
          value={publicKey}
          onChange={e => setPublicKey(e.target.value)}
          placeholder="pk_live_..."
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: '8px',
            border: '1.5px solid #e2e8f0',
            fontSize: '14px',
            fontFamily: 'monospace',
          }}
        />
        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
          Obtén esta key en tu dashboard de Stripe →{' '}
          <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" style={{ color: '#0ea5e9' }}>
            Stripe API Keys
          </a>
        </div>
      </div>

      <div style={{ marginBottom: '24px' }}>
        <label htmlFor="stripe-secret-key" style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#475569', marginBottom: '8px' }}>
          Secret Key (sk_live_xxx) *
        </label>
        <div style={{ position: 'relative' }}>
          <input
            id="stripe-secret-key"
            type={showSecret ? 'text' : 'password'}
            value={secretKey}
            onChange={e => setSecretKey(e.target.value)}
            placeholder="sk_live_..."
            style={{
              width: '100%',
              padding: '12px',
              paddingRight: '40px',
              borderRadius: '8px',
              border: '1.5px solid #e2e8f0',
              fontSize: '14px',
              fontFamily: 'monospace',
            }}
          />
          <button
            type="button"
            onClick={() => setShowSecret(!showSecret)}
            style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '16px',
              color: '#64748b',
            }}
          >
            {showSecret ? '🙈' : '👁️'}
          </button>
        </div>
        <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '6px', fontWeight: 600 }}>
          ⚠️ Nunca compartas tu Secret Key. Se encriptará en la base de datos.
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          onClick={() => onSave(publicKey, secretKey)}
          disabled={saving || !publicKey || !secretKey}
          style={{
            flex: 1,
            padding: '12px',
            borderRadius: '8px',
            border: 'none',
            background: saving || !publicKey || !secretKey ? '#cbd5e1' : 'linear-gradient(135deg,#0ea5e9,#0284c7)',
            color: 'white',
            fontWeight: 700,
            fontSize: '14px',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? '⏳ Guardando...' : '💾 Guardar Configuración'}
        </button>
        {config.stripe_configured && (
          <button
            onClick={onTest}
            disabled={testing}
            style={{
              padding: '12px 20px',
              borderRadius: '8px',
              border: '1.5px solid #0ea5e9',
              background: 'white',
              color: '#0ea5e9',
              fontWeight: 700,
              fontSize: '14px',
              cursor: testing ? 'not-allowed' : 'pointer',
            }}
          >
            {testing ? '⏳' : '🔌'} Probar
          </button>
        )}
      </div>
    </div>
  )
}

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
      <div style={{ marginBottom: '20px' }}>
        <label htmlFor="paypal-client-id" style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#475569', marginBottom: '8px' }}>
          Client ID *
        </label>
        <input
          id="paypal-client-id"
          type="text"
          value={clientId}
          onChange={e => setClientId(e.target.value)}
          placeholder="AVG3..."
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: '8px',
            border: '1.5px solid #e2e8f0',
            fontSize: '14px',
            fontFamily: 'monospace',
          }}
        />
        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
          Obtén esta key en tu dashboard de PayPal →{' '}
          <a href="https://developer.paypal.com/dashboard" target="_blank" rel="noopener noreferrer" style={{ color: '#0ea5e9' }}>
            PayPal Developer Dashboard
          </a>
        </div>
      </div>

      <div style={{ marginBottom: '24px' }}>
        <label htmlFor="paypal-client-secret" style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#475569', marginBottom: '8px' }}>
          Client Secret *
        </label>
        <div style={{ position: 'relative' }}>
          <input
            id="paypal-client-secret"
            type={showSecret ? 'text' : 'password'}
            value={clientSecret}
            onChange={e => setClientSecret(e.target.value)}
            placeholder="Secret..."
            style={{
              width: '100%',
              padding: '12px',
              paddingRight: '40px',
              borderRadius: '8px',
              border: '1.5px solid #e2e8f0',
              fontSize: '14px',
              fontFamily: 'monospace',
            }}
          />
          <button
            type="button"
            onClick={() => setShowSecret(!showSecret)}
            style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '16px',
              color: '#64748b',
            }}
          >
            {showSecret ? '🙈' : '👁️'}
          </button>
        </div>
        <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '6px', fontWeight: 600 }}>
          ⚠️ Nunca compartas tu Client Secret. Se encriptará en la base de datos.
        </div>
      </div>

      <button
        onClick={() => onSave(clientId, clientSecret)}
        disabled={saving || !clientId || !clientSecret}
        style={{
          width: '100%',
          padding: '12px',
          borderRadius: '8px',
          border: 'none',
          background: saving || !clientId || !clientSecret ? '#cbd5e1' : 'linear-gradient(135deg,#0ea5e9,#0284c7)',
          color: 'white',
          fontWeight: 700,
          fontSize: '14px',
          cursor: saving ? 'not-allowed' : 'pointer',
        }}
      >
        {saving ? '⏳ Guardando...' : '💾 Guardar Configuración'}
      </button>
    </div>
  )
}
