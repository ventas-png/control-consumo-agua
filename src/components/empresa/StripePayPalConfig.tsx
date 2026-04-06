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
    paypal_configured: false,
  })
  const [loading, setLoading] = useState(true)
  const [savingStripe, setSavingStripe] = useState(false)
  const [testingStripe, setTestingStripe] = useState(false)
  const [tab, setTab] = useState<'stripe' | 'paypal'>('stripe')

  useEffect(() => {
    cargarConfig()
  }, [companyId])

  async function cargarConfig() {
    setLoading(true)
    const { data } = await supabase
      .from('companies')
      .select(
        'stripe_public_key,stripe_configured,paypal_client_id,paypal_configured'
      )
      .eq('id', companyId)
      .single()

    if (data) {
      setConfig({
        stripe_public_key: data.stripe_public_key || '',
        stripe_configured: data.stripe_configured || false,
        paypal_client_id: data.paypal_client_id || '',
        paypal_configured: data.paypal_configured || false,
      })
    }
    setLoading(false)
  }

  async function guardarStripe(publicKey: string, secretKey: string) {
    if (!publicKey || !secretKey) {
      void Swal.fire({ icon: 'warning', title: 'Campos requeridos' })
      return
    }

    setSavingStripe(true)
    const { error } = await supabase.from('companies').update({
      stripe_public_key: publicKey,
      stripe_secret_key: secretKey,
      stripe_configured: true,
    }).eq('id', companyId)

    setSavingStripe(false)

    if (error) {
      void Swal.fire({ icon: 'error', title: 'Error', text: error.message })
    } else {
      void Swal.fire({
        icon: 'success',
        title: 'Stripe configurado',
        timer: 1500,
        showConfirmButton: false,
      })
      onConfigUpdated()
      void cargarConfig()
    }
  }

  async function probarConexionStripe() {
    setTestingStripe(true)
    try {
      // Llamar edge function para probar
      const response = await fetch('/api/test-stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      })

      if (response.ok) {
        void Swal.fire({
          icon: 'success',
          title: '✓ Conexión exitosa',
          text: 'Stripe está configurado correctamente',
          timer: 1500,
          showConfirmButton: false,
        })
      } else {
        void Swal.fire({
          icon: 'error',
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
    <div style={{ background: 'white', borderRadius: '16px', padding: '32px', boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}>
      <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '24px', color: '#0f172a' }}>
        ⚙️ Configuración de Pagos Online
      </h2>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '2px solid #e2e8f0', marginBottom: '28px' }}>
        {(['stripe', 'paypal'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '12px 20px',
              fontSize: '14px',
              fontWeight: tab === t ? 700 : 500,
              color: tab === t ? '#0ea5e9' : '#64748b',
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t ? '3px solid #0ea5e9' : 'none',
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {t === 'stripe' ? '💳 Stripe' : '🅿️ PayPal'}
          </button>
        ))}
      </div>

      {/* Tab: Stripe */}
      {tab === 'stripe' && (
        <StripeConfigForm
          config={config}
          saving={savingStripe}
          testing={testingStripe}
          onSave={guardarStripe}
          onTest={probarConexionStripe}
        />
      )}

      {/* Tab: PayPal */}
      {tab === 'paypal' && (
        <div style={{ padding: '20px', background: '#f8fafc', borderRadius: '12px', textAlign: 'center', color: '#64748b' }}>
          <div style={{ fontSize: '14px', marginBottom: '12px' }}>
            Configuración de PayPal disponible próximamente
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>
            Por ahora usa Stripe para pagos online
          </div>
        </div>
      )}
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
    <div style={{ maxWidth: '600px' }}>
      <div style={{ marginBottom: '20px' }}>
        <div style={{
          padding: '14px',
          background: config.stripe_configured ? '#f0fdf4' : '#fef3c7',
          border: `1px solid ${config.stripe_configured ? '#bbf7d0' : '#fde68a'}`,
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: 600,
          color: config.stripe_configured ? '#15803d' : '#b45309',
        }}>
          {config.stripe_configured ? '✅ Stripe configurado' : '⚠️ Stripe no configurado'}
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#475569', marginBottom: '8px' }}>
          Public Key (pk_live_xxx) *
        </label>
        <input
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
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#475569', marginBottom: '8px' }}>
          Secret Key (sk_live_xxx) *
        </label>
        <div style={{ position: 'relative' }}>
          <input
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
