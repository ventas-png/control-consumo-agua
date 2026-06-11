// Vista extraída de CustomerPortal (refactor P1 #3): JSX idéntico al original.
import type { PortalCtx } from './ctx'

export function PerfilTab({ ctx }: { ctx: PortalCtx }) {
  const { currentUser, contactoEdit, setContactoEdit, savingContacto, contactoMsg, guardarContacto } = ctx
  return (
          <div>
            <div style={{
              background: 'var(--at-surface)', borderRadius: '16px', padding: '28px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              maxWidth: '520px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                <div style={{
                  width: '44px', height: '44px', borderRadius: '12px',
                  background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '20px', color: 'white',
                }}>👤</div>
                <div>
                  <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>
                    {currentUser.name}
                  </h2>
                  <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)' }}>Actualice su información de contacto</div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {([
                  { key: 'email', label: 'Correo electrónico', placeholder: 'correo@ejemplo.com', type: 'email' },
                  { key: 'telefono', label: 'Teléfono', placeholder: 'Ej. 5555-1234', type: 'tel' },
                  { key: 'whatsapp', label: 'WhatsApp', placeholder: 'Ej. 5555-1234', type: 'tel' },
                  { key: 'telefono_alterno', label: 'Teléfono alterno', placeholder: 'Ej. 2255-1234', type: 'tel' },
                ] as const).map(field => (
                  <div key={field.key}>
                    <label style={{
                      display: 'block', fontSize: '12.5px',
                      fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '5px',
                    }}>
                      {field.label}
                    </label>
                    <input
                      className="portal-input"
                      type={field.type}
                      value={contactoEdit[field.key] ?? ''}
                      onChange={e => setContactoEdit(prev => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        padding: '10px 14px', fontSize: '14px',
                        border: '1.5px solid var(--at-line)', borderRadius: '10px',
                        background: 'var(--at-surface-2)', color: 'var(--at-ink)',
                        transition: 'border-color 0.2s, box-shadow 0.2s',
                      }}
                    />
                  </div>
                ))}

                {contactoMsg && (
                  <div style={{
                    padding: '11px 14px', borderRadius: '10px', fontSize: '13px',
                    background: contactoMsg.type === 'success' ? 'var(--at-success-tint)' : 'var(--at-danger-tint)',
                    border: `1px solid ${contactoMsg.type === 'success' ? 'var(--at-success-border)' : 'var(--at-danger-border)'}`,
                    color: contactoMsg.type === 'success' ? 'var(--at-success-strong)' : 'var(--at-danger-strong)',
                    display: 'flex', gap: '8px', alignItems: 'center',
                  }}>
                    <span>{contactoMsg.type === 'success' ? '✅' : '⚠️'}</span>
                    {contactoMsg.text}
                  </div>
                )}

                <button
                  onClick={guardarContacto}
                  disabled={savingContacto}
                  style={{
                    padding: '12px', marginTop: '4px',
                    background: savingContacto
                      ? 'var(--at-ink-3)'
                      : 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
                    color: 'white', border: 'none', borderRadius: '12px',
                    fontSize: '14.5px', fontWeight: 600,
                    cursor: savingContacto ? 'not-allowed' : 'pointer',
                    boxShadow: savingContacto ? 'none' : '0 4px 14px rgba(27, 59, 54,0.3)',
                    transition: 'all 0.2s',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  }}
                >
                  {savingContacto ? (
                    <>
                      <div style={{
                        width: '14px', height: '14px',
                        border: '2px solid rgba(255,255,255,0.4)',
                        borderTop: '2px solid white',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                      }} />
                      Guardando...
                    </>
                  ) : (
                    'Guardar cambios'
                  )}
                </button>
              </div>
            </div>
          </div>
  )
}
