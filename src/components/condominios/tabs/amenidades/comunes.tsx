// Componentes locales compartidos del feature Amenidades (fase B).
import { useState, type ReactNode } from 'react'
import { ImageUploader } from '../../../shared/ImageUploader'

export function EmptyState({ icon, title, hint, action }: { icon: string; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '56px 24px', textAlign: 'center',
      background: 'linear-gradient(180deg, #ffffff 0%, var(--at-surface-2) 100%)',
      border: '1.5px dashed var(--at-line-strong)', borderRadius: 16,
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%',
        background: 'linear-gradient(135deg,var(--at-primary-soft),#ccfbf1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 32, marginBottom: 14,
        boxShadow: '0 8px 20px -8px rgba(27, 59, 54,0.35)',
      }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--at-ink)', marginBottom: 4 }}>{title}</div>
      {hint && <div style={{ fontSize: 12.5, color: 'var(--at-ink-3)', maxWidth: 360, lineHeight: 1.5, marginBottom: action ? 14 : 0 }}>{hint}</div>}
      {action}
    </div>
  )
}

export function CheckoutForm({ onSave }: { onSave: (foto: string | null, obs: string) => void }) {
  const [foto, setFoto] = useState<string | null>(null)
  const [obs, setObs] = useState('')
  return (
    <>
      <ImageUploader value={foto} onChange={setFoto} folder="amenidades-checkout" label="Foto de cierre (opcional)" />
      <textarea value={obs} onChange={e => setObs(e.target.value)} placeholder="Observaciones del estado al salir (daños, basura, mobiliario, etc.)"
        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 13.5, background: 'var(--at-surface-2)', marginTop: 8, minHeight: 60, resize: 'vertical' }} />
      <button onClick={() => onSave(foto, obs)} style={{ marginTop: 10, padding: '8px 16px', background: 'var(--at-accent-2)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
        Registrar check-out
      </button>
    </>
  )
}
