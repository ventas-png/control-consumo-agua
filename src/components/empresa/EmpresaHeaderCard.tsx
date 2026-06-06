// T7 / plat:P12 — Extraído de EmpresaSection.
// Cabecera de la empresa (logo + datos de contacto + contador de proyectos) y
// la card de datos fiscales para Stripe Tax. Posee sus propias mutaciones
// (editar empresa, editar datos fiscales, subir logo) y refresca la vista vía
// `onReload`, que el contenedor cablea a la invalidación de la query de dominio.
import { notify } from '../shared/Dialog'
import { openPromptDialog } from '../shared/PromptDialog'
import { updateEmpresa, uploadEmpresaLogo } from '../../domain/empresa/mutations'
import { SecureImage } from '../shared/SecureImage'
import { COUNTRIES, countryByCode, countryName } from '../../lib/countries'
import type { EmpresaInfo } from '../../domain/empresa/queries'

interface Props {
  empresa: EmpresaInfo | null
  proyectosCount: number
  maxProjectsDisplay: number
  onReload: () => void
}

export function EmpresaHeaderCard({ empresa, proyectosCount, maxProjectsDisplay, onReload }: Props) {
  async function editarEmpresa() {
    if (!empresa) return
    // F3.4b: PromptDialog reemplaza Swal.fire con html:/preConfirm: por
    // forma type-safe con InputField accesible (label asociado, aria-required).
    const formValues = await openPromptDialog({
      title: 'Editar información de empresa',
      fields: [
        { name: 'nombre', label: 'Nombre de la empresa', required: true, initialValue: empresa.nombre },
        { name: 'nit', label: 'NIT (legacy)', initialValue: empresa.nit ?? '' },
        { name: 'email', label: 'Email de contacto', type: 'email', autoComplete: 'email', initialValue: empresa.email ?? '' },
        { name: 'telefono', label: 'Teléfono', type: 'tel', autoComplete: 'tel', initialValue: empresa.telefono ?? '' },
      ],
      submitText: 'Guardar',
      validate: (data) => data.nombre.trim() ? null : 'El nombre es obligatorio',
    })
    if (!formValues) return
    const payload = {
      nombre: formValues.nombre.trim(),
      nit: formValues.nit.trim() || null,
      email: formValues.email.trim() || null,
      telefono: formValues.telefono.trim() || null,
    }
    const { error } = await updateEmpresa(empresa.id, payload)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo actualizar la información.' })
    } else {
      notify({ variant: 'success', title: 'Actualizado', duration: 1200 })
      onReload()
    }
  }

  // F4.3.4: datos fiscales para Stripe Tax. Se llaman directamente al renderizar
  // un botón aparte (no se mezclan con los datos generales para mantener el
  // diálogo enfocado y porque cambiar tax_id en producción requiere mas cuidado).
  async function editarDatosFiscales() {
    if (!empresa) return
    const currentCountry = countryByCode(empresa.country)
    const taxIdTypeOptions = currentCountry?.taxIdTypes ?? [{ value: 'other', label: 'Otro' }]
    const initialTaxIdType = empresa.tax_id_type && taxIdTypeOptions.some(o => o.value === empresa.tax_id_type)
      ? empresa.tax_id_type
      : taxIdTypeOptions[0]?.value ?? 'other'

    const formValues = await openPromptDialog({
      title: 'Datos fiscales (Stripe Tax)',
      submitText: 'Guardar',
      fields: [
        {
          name: 'country', label: 'País', control: 'select',
          initialValue: empresa.country ?? '',
          options: [{ value: '', label: '— Seleccionar —' }, ...COUNTRIES.map(c => ({ value: c.code, label: `${c.code} — ${c.name}` }))],
        },
        {
          name: 'tax_id_type', label: 'Tipo de identificación fiscal', control: 'select',
          initialValue: initialTaxIdType,
          options: taxIdTypeOptions,
        },
        { name: 'tax_id', label: 'Número fiscal (RFC/NIT/RUT/etc.)', initialValue: empresa.tax_id ?? '' },
        { name: 'address_line1', label: 'Dirección', initialValue: empresa.address_line1 ?? '' },
        { name: 'address_city', label: 'Ciudad', initialValue: empresa.address_city ?? '' },
        { name: 'address_state', label: 'Estado / Provincia', initialValue: empresa.address_state ?? '' },
        { name: 'address_postal_code', label: 'Código postal', initialValue: empresa.address_postal_code ?? '' },
      ],
    })
    if (!formValues) return

    // Cuando se elige país nuevo, validamos que tax_id_type es compatible.
    // Si el usuario selecciona MX por ej, el tax_id_type debe ser mx_rfc.
    const country = formValues.country.trim() || null
    const selectedCountry = countryByCode(country ?? undefined)
    let taxIdType: string | null = formValues.tax_id_type.trim() || null
    if (selectedCountry && taxIdType && !selectedCountry.taxIdTypes.some(t => t.value === taxIdType)) {
      // El tipo previo no aplica al país nuevo. Reset.
      taxIdType = selectedCountry.taxIdTypes[0]?.value ?? null
    }

    const payload = {
      country,
      tax_id: formValues.tax_id.trim() || null,
      tax_id_type: taxIdType,
      address_line1: formValues.address_line1.trim() || null,
      address_city: formValues.address_city.trim() || null,
      address_state: formValues.address_state.trim() || null,
      address_postal_code: formValues.address_postal_code.trim() || null,
    }
    const { error } = await updateEmpresa(empresa.id, payload)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo actualizar los datos fiscales.' })
    } else {
      notify({
        variant: 'success',
        title: 'Datos fiscales actualizados',
        text: 'Los próximos cobros usarán esta información para calcular IVA vía Stripe Tax.',
        duration: 2200,
      })
      onReload()
    }
  }

  async function subirLogo(file: File) {
    if (!empresa) return
    // Path único por upload (lo arma el dominio) para que cada cambio produzca
    // una signed URL fresca; logos viejos quedan huérfanos (cleanup pendiente).
    const { error } = await uploadEmpresaLogo(empresa.id, file)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo subir el logo.' })
      return
    }
    onReload()
  }

  return (
    <>
      {/* Input de archivo oculto para subir logo */}
      <input
        id="logo-upload"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) void subirLogo(f) }}
      />

      {/* Header empresa */}
      <div className="empresa-card" style={{
        background: 'var(--at-surface)',
        borderRadius: '16px', padding: '24px 24px 20px', marginBottom: '24px',
        border: '1px solid var(--at-line)',
      }}>
        <div className="empresa-header-inner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
          {/* Left: logo + info */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '14px' }}>
            {/* Avatar logo */}
            <div
              onClick={() => document.getElementById('logo-upload')?.click()}
              title="Haz clic para cambiar el logo"
              style={{
                width: 56, height: 56, borderRadius: 12, overflow: 'hidden',
                cursor: 'pointer', flexShrink: 0,
                border: '2px solid var(--at-line)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}
            >
              {empresa?.logo_url
                ? <SecureImage bucket="company-logos" src={empresa.logo_url} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{
                    background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))',
                    width: '100%', height: '100%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontSize: 22, fontWeight: 700,
                  }}>
                    {empresa?.nombre?.[0]?.toUpperCase() ?? 'E'}
                  </div>
              }
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '4px' }}>
                <h1 style={{ color: 'var(--at-ink)', fontSize: '20px', fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
                  {empresa?.nombre ?? 'Mi Empresa'}
                </h1>
              </div>
              <div className="empresa-info-row" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '6px' }}>
                {empresa?.nit && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--at-ink-3)', fontSize: '12px' }}>
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    NIT: {empresa.nit}
                  </span>
                )}
                {empresa?.email && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--at-ink-3)', fontSize: '12px' }}>
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                    {empresa.email}
                  </span>
                )}
                {empresa?.telefono && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--at-ink-3)', fontSize: '12px' }}>
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                    {empresa.telefono}
                  </span>
                )}
                {!empresa?.nit && !empresa?.email && !empresa?.telefono && (
                  <span style={{ color: 'var(--at-ink-2)', fontSize: '12px', fontStyle: 'italic' }}>Sin datos de contacto</span>
                )}
              </div>
            </div>
          </div>

          {/* Right: stats + edit button */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px', flexShrink: 0 }}>
            <div className="empresa-stats-box" style={{
              background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft)',
              borderRadius: '10px', padding: '10px 16px', textAlign: 'center',
            }}>
              <div style={{ color: 'var(--at-accent-2)', fontSize: '22px', fontWeight: 700, lineHeight: 1 }}>
                {proyectosCount}<span style={{ color: 'var(--at-ink-3)', fontSize: '15px' }}>/{maxProjectsDisplay}</span>
              </div>
              <div style={{ color: 'var(--at-ink-3)', fontSize: '11px', marginTop: '3px' }}>proyectos</div>
            </div>
            <button
              onClick={() => void editarEmpresa()}
              style={{
                padding: '7px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                border: '1px solid var(--at-line-strong)', background: 'var(--at-surface-2)',
                color: 'var(--at-ink-2)', cursor: 'pointer', whiteSpace: 'nowrap',
                transition: 'background 0.15s',
              }}
            >
              Editar información
            </button>
          </div>
        </div>
      </div>

      {/* F4.3.4: datos fiscales para Stripe Tax */}
      <div style={{
        background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '12px',
        padding: '18px 22px', marginBottom: '24px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ color: 'var(--at-ink)', fontSize: '14px', fontWeight: 700, margin: '0 0 4px' }}>
              🧾 Datos fiscales
            </h2>
            <p style={{ color: 'var(--at-ink-3)', fontSize: '12px', margin: '0 0 12px' }}>
              País + identificación fiscal usados por Stripe Tax para calcular IVA en tu factura mensual.
            </p>
            {empresa?.country ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', fontWeight: 600, textTransform: 'uppercase' }}>País</div>
                  <div style={{ fontSize: '13px', color: 'var(--at-ink)', fontWeight: 600 }}>
                    {countryName(empresa.country)} ({empresa.country})
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', fontWeight: 600, textTransform: 'uppercase' }}>ID fiscal</div>
                  <div style={{ fontSize: '13px', color: 'var(--at-ink)', fontFamily: 'monospace' }}>
                    {empresa.tax_id ?? '—'}
                    {empresa.tax_id_type && (
                      <span style={{ marginLeft: '6px', fontSize: '10px', color: 'var(--at-ink-3)', fontFamily: 'inherit' }}>
                        ({empresa.tax_id_type})
                      </span>
                    )}
                  </div>
                </div>
                {empresa.address_line1 && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', fontWeight: 600, textTransform: 'uppercase' }}>Dirección</div>
                    <div style={{ fontSize: '13px', color: 'var(--at-ink-2)' }}>
                      {[empresa.address_line1, empresa.address_city, empresa.address_state, empresa.address_postal_code].filter(Boolean).join(', ')}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{
                background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)',
                borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: 'var(--at-warning-strong)',
              }}>
                ⚠️ Sin configurar — Stripe no podrá calcular IVA en tu próxima factura. Configúralos antes del siguiente cobro.
              </div>
            )}
          </div>
          <button
            onClick={() => void editarDatosFiscales()}
            style={{
              padding: '7px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
              border: '1px solid var(--at-line-strong)', background: 'var(--at-surface-2)',
              color: 'var(--at-ink-2)', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {empresa?.country ? 'Editar' : 'Configurar'}
          </button>
        </div>
      </div>
    </>
  )
}
