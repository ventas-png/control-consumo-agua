// SSO/SAML enterprise (plat:P10) — UI admin "registra tu IdP y asocia dominios".
// Gemela de PayfacConfigSection: misma estructura (aviso → secciones → acciones),
// mismo gating admin/owner. Gated además por el feature flag 'enterprise_sso'
// (lo monta EmpresaSection).
//
// Flujo del owner/admin:
//   1. Asocia dominio(s) de SU empresa (UNIQUE global; sin secuestro cross-tenant).
//   2. Inicia verificación de propiedad (token + registro DNS TXT). El chequeo
//      automático es follow-up; hasta verificar, no se puede forzar SSO (gate).
//   3. Sube metadata del IdP (URL o XML) + entity/ACS → el edge intenta registrar
//      el proveedor SAML en GoTrue. Si SSO no está habilitado en el proyecto,
//      queda "parqueado" pero la config se persiste igual.
//   4. Toggle "Forzar SSO" por dominio (oculta el password en el login).
//
// Toda escritura pasa por el edge sso-admin (deriva company_id de la sesión).
import { useState, type CSSProperties } from 'react'
import { notify } from '../shared/Dialog'
import { useSession } from '../shared/SessionContext'
import { usePermissionsContext } from '../shared/PermissionsContext'
import { useSsoDomainsQuery } from '../../domain/sso/queries'
import {
  useUpsertSsoDomainMutation,
  useDeleteSsoDomainMutation,
  useSetSsoEnforcedMutation,
  useStartSsoVerificationMutation,
  useSaveSsoMetadataMutation,
  type SsoIdpMetadataInput,
} from '../../domain/sso/mutations'
import { domainSchema } from '../../domain/sso/schemas'
import type { SsoDomain } from '../../domain/sso/schemas'

function StatusBadge({ verified, enforced }: { verified: boolean; enforced: boolean }) {
  const s = enforced
    ? { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', label: '🔒 SSO forzado' }
    : verified
      ? { bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)', label: '✓ Verificado' }
      : { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: '⏳ Sin verificar' }
  return (
    <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

export function SsoConfigSection() {
  const currentUser = useSession()
  const perms = usePermissionsContext()
  const companyId = currentUser.company_id
  const canEdit = perms.canEdit('empresa') && currentUser.role !== 'viewer'

  const { data: domains = [], isLoading } = useSsoDomainsQuery(companyId)

  const upsertDomain = useUpsertSsoDomainMutation(companyId)
  const deleteDomain = useDeleteSsoDomainMutation(companyId)
  const setEnforced = useSetSsoEnforcedMutation(companyId)
  const startVerification = useStartSsoVerificationMutation(companyId)
  const saveMetadata = useSaveSsoMetadataMutation(companyId)

  // ── Estado del form ──
  const [nuevoDominio, setNuevoDominio] = useState('')
  const [metaDomainId, setMetaDomainId] = useState('')
  const [metaUrl, setMetaUrl] = useState('')
  const [metaXml, setMetaXml] = useState('')
  const [entityId, setEntityId] = useState('')
  const [acsUrl, setAcsUrl] = useState('')
  const [verifInfo, setVerifInfo] = useState<{ id: string; name: string; value: string; note: string } | null>(null)

  // ── Estilos (espejo de PayfacConfigSection) ──
  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }
  const card: CSSProperties = { background: 'var(--at-surface)', borderRadius: 14, padding: 20, boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }
  const h3: CSSProperties = { margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: 'var(--at-ink)' }
  const sub: CSSProperties = { margin: '0 0 14px', fontSize: 13, color: 'var(--at-ink-3)' }
  const btnPrimary = (disabled: boolean): CSSProperties => ({
    padding: '9px 20px', borderRadius: 8, border: 'none',
    background: disabled ? 'var(--at-ink-3)' : 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
    color: 'white', fontWeight: 600, fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer',
  })
  const btnGhost: CSSProperties = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--at-line-strong)', background: 'transparent', color: 'var(--at-ink-2)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }

  async function onAgregarDominio() {
    if (!canEdit) return
    const parsed = domainSchema.safeParse(nuevoDominio)
    if (!parsed.success) {
      notify({ variant: 'warning', title: 'Dominio inválido', text: parsed.error.issues[0]?.message ?? 'Revisa el dominio.' })
      return
    }
    try {
      await upsertDomain.mutateAsync(parsed.data)
      setNuevoDominio('')
      notify({ variant: 'success', title: 'Dominio asociado', duration: 1600 })
    } catch (err) {
      notify({ variant: 'error', title: 'Error', text: (err as Error).message })
    }
  }

  async function onEliminarDominio(d: SsoDomain) {
    if (!canEdit) return
    try {
      await deleteDomain.mutateAsync(d.id)
      if (metaDomainId === d.id) setMetaDomainId('')
      notify({ variant: 'success', title: 'Dominio eliminado', duration: 1400 })
    } catch (err) {
      notify({ variant: 'error', title: 'Error', text: (err as Error).message })
    }
  }

  async function onToggleEnforce(d: SsoDomain) {
    if (!canEdit) return
    try {
      await setEnforced.mutateAsync({ id: d.id, enforced: !d.enforced })
      notify({ variant: 'success', title: d.enforced ? 'SSO ya no es obligatorio' : 'SSO forzado', duration: 1600 })
    } catch (err) {
      notify({ variant: 'error', title: 'No se pudo cambiar', text: (err as Error).message })
    }
  }

  async function onIniciarVerificacion(d: SsoDomain) {
    if (!canEdit) return
    try {
      const res = await startVerification.mutateAsync(d.id)
      if (res.verification) {
        setVerifInfo({ id: d.id, name: res.verification.record_name, value: res.verification.record_value, note: res.verification.note })
      }
    } catch (err) {
      notify({ variant: 'error', title: 'Error', text: (err as Error).message })
    }
  }

  async function onGuardarMetadata() {
    if (!canEdit) return
    if (!metaDomainId) {
      notify({ variant: 'warning', title: 'Elige un dominio', text: 'Selecciona el dominio al que pertenece este IdP.' })
      return
    }
    if (!metaUrl.trim() && !metaXml.trim()) {
      notify({ variant: 'warning', title: 'Falta metadata', text: 'Pega la URL de metadata del IdP o su XML.' })
      return
    }
    const metadata: SsoIdpMetadataInput = {}
    if (metaUrl.trim()) metadata.metadata_url = metaUrl.trim()
    if (metaXml.trim()) metadata.metadata_xml = metaXml.trim()
    if (entityId.trim()) metadata.entity_id = entityId.trim()
    if (acsUrl.trim()) metadata.acs_url = acsUrl.trim()
    try {
      const res = await saveMetadata.mutateAsync({ id: metaDomainId, metadata })
      if (res.parked) {
        notify({ variant: 'info', title: 'Guardado (parqueado)', text: res.message ?? 'SSO no habilitado en el proyecto; la config quedó guardada.', duration: 3200 })
      } else {
        notify({ variant: 'success', title: 'Proveedor sincronizado', text: res.message ?? 'IdP registrado en GoTrue.', duration: 2400 })
      }
    } catch (err) {
      notify({ variant: 'error', title: 'Error', text: (err as Error).message })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Aviso de estado / handshake parqueado */}
      <div style={{ background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: 'var(--at-primary-hover)' }}>
        <strong>🔐 SSO/SAML para tu empresa.</strong> Asocia los dominios de correo de tu organización,
        verifica su propiedad y registra tu proveedor de identidad (Okta, Azure AD, Google Workspace…).
        El registro real del proveedor requiere habilitar SSO a nivel proyecto; mientras tanto la
        configuración se guarda y queda <strong>parqueada</strong> sin afectar el login normal.
      </div>

      {/* ── Dominios asociados ── */}
      <section style={card}>
        <h3 style={h3}>Dominios de la empresa</h3>
        <p style={sub}>Cada dominio pertenece a una sola empresa. No puedes forzar SSO sin verificar su propiedad (evita secuestro de dominios ajenos).</p>

        {canEdit && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <input
              style={{ ...inp, maxWidth: 320 }}
              placeholder="acme.com"
              value={nuevoDominio}
              autoComplete="off"
              onChange={(e) => setNuevoDominio(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void onAgregarDominio()}
            />
            <button onClick={() => void onAgregarDominio()} disabled={upsertDomain.isPending} style={btnPrimary(upsertDomain.isPending)}>
              {upsertDomain.isPending ? 'Agregando…' : 'Asociar dominio'}
            </button>
          </div>
        )}

        {isLoading ? (
          <div style={{ color: 'var(--at-ink-3)', fontSize: 13 }}>Cargando dominios…</div>
        ) : domains.length === 0 ? (
          <div style={{ color: 'var(--at-ink-3)', fontSize: 13 }}>Aún no hay dominios asociados.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {domains.map((d) => (
              <div key={d.id} style={{ border: '1px solid var(--at-line)', borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <strong style={{ fontSize: 14 }}>{d.domain}</strong>
                    <StatusBadge verified={d.verified} enforced={d.enforced} />
                    {d.sso_provider_id && <span style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>proveedor sincronizado</span>}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button onClick={() => void onIniciarVerificacion(d)} disabled={startVerification.isPending} style={btnGhost}>
                        Verificar propiedad
                      </button>
                      <button
                        onClick={() => void onToggleEnforce(d)}
                        disabled={setEnforced.isPending || (!d.verified && !d.enforced)}
                        title={!d.verified && !d.enforced ? 'Verifica el dominio antes de forzar SSO' : ''}
                        style={{ ...btnGhost, opacity: !d.verified && !d.enforced ? 0.5 : 1 }}
                      >
                        {d.enforced ? 'Quitar forzado' : 'Forzar SSO'}
                      </button>
                      <button onClick={() => void onEliminarDominio(d)} disabled={deleteDomain.isPending} style={{ ...btnGhost, color: 'var(--at-danger)' }}>
                        Eliminar
                      </button>
                    </div>
                  )}
                </div>
                {verifInfo && verifInfo.id === d.id && (
                  <div style={{ marginTop: 10, background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 8, padding: 10, fontSize: 12, color: 'var(--at-ink-2)' }}>
                    <div>Crea este registro <strong>TXT</strong> en tu DNS para probar la propiedad:</div>
                    <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 12 }}>
                      <div><span style={{ color: 'var(--at-ink-3)' }}>name: </span>{verifInfo.name}</div>
                      <div><span style={{ color: 'var(--at-ink-3)' }}>value: </span>{verifInfo.value}</div>
                    </div>
                    <div style={{ marginTop: 6, color: 'var(--at-ink-3)' }}>{verifInfo.note}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Metadata del IdP ── */}
      <section style={card}>
        <h3 style={h3}>Proveedor de identidad (SAML)</h3>
        <p style={sub}>Sube la metadata de tu IdP. Al guardar, intentamos registrar el proveedor en el proyecto; si SSO no está habilitado, queda parqueado y la config se conserva.</p>

        {!canEdit ? (
          <div style={{ color: 'var(--at-ink-3)', fontSize: 13 }}>Solo administradores pueden configurar el IdP.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>
            <div>
              <label style={lbl}>Dominio</label>
              <select style={inp} value={metaDomainId} onChange={(e) => setMetaDomainId(e.target.value)}>
                <option value="">Selecciona un dominio…</option>
                {domains.map((d) => (
                  <option key={d.id} value={d.id}>{d.domain}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={lbl}>URL de metadata del IdP</label>
              <input style={inp} placeholder="https://idp.example.com/metadata.xml" value={metaUrl} autoComplete="off" onChange={(e) => setMetaUrl(e.target.value)} />
            </div>
            <div>
              <label style={lbl}>…o pega el XML de metadata</label>
              <textarea style={{ ...inp, minHeight: 96, fontFamily: 'monospace' }} placeholder="<EntityDescriptor …>" value={metaXml} onChange={(e) => setMetaXml(e.target.value)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              <div>
                <label style={lbl}>EntityID (opcional)</label>
                <input style={inp} placeholder="urn:idp:acme" value={entityId} autoComplete="off" onChange={(e) => setEntityId(e.target.value)} />
              </div>
              <div>
                <label style={lbl}>ACS URL (opcional)</label>
                <input style={inp} placeholder="https://…/auth/v1/sso/saml/acs" value={acsUrl} autoComplete="off" onChange={(e) => setAcsUrl(e.target.value)} />
              </div>
            </div>
            <div>
              <button onClick={() => void onGuardarMetadata()} disabled={saveMetadata.isPending} style={btnPrimary(saveMetadata.isPending)}>
                {saveMetadata.isPending ? 'Guardando…' : 'Guardar y sincronizar proveedor'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
