// Modal de alta/edición con onboarding de 4 pasos, extraído de
// ClientesSection (P1 #3): JSX idéntico al original.
import type { ClientesCtx } from './ctx'
import { inputStyle, labelStyle, sectionHeaderStyle, fieldLabelMap } from './ui'
import { sanitizeHTML } from '../../lib/validation'
import { EditModal } from '../shared/EditModal'
import { USO_CFDI_OPCIONES } from './usoCfdi'

export function ClienteFormModal({ ctx }: { ctx: ClientesCtx }) {
  const { esFEL, esCFDI, muestraFiscal, form, setForm, editingId, loading, onboardingStep, setOnboardingStep, lookupForm, setLookupForm, lookupResult, modalTitle, cancelForm, handleLookup, proceedToFullForm, handleGuardar } = ctx
  return (
        <EditModal title={modalTitle} onClose={cancelForm} maxWidth="700px">

      {/* Lookup Form - Step 1 */}
      {(onboardingStep === 'lookup' || onboardingStep === 'lookup_loading') && (
        <div>
          <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--at-ink-3)' }}>
            Ingrese los datos del cliente para verificar si ya se encuentra registrado en la plataforma.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
            <div>
              <label htmlFor="lookup-cui" style={labelStyle}>CUI / DUI *</label>
              <input
                id="lookup-cui"
                style={inputStyle}
                value={lookupForm.cui_dui}
                onChange={e => setLookupForm(f => ({ ...f, cui_dui: e.target.value }))}
                placeholder="Ej. 1234567890101"
                maxLength={20}
                disabled={onboardingStep === 'lookup_loading'}
              />
            </div>
            <div>
              <label htmlFor="lookup-birthdate" style={labelStyle}>Fecha de Nacimiento *</label>
              <input
                id="lookup-birthdate"
                style={inputStyle}
                type="date"
                value={lookupForm.fecha_nacimiento}
                onChange={e => setLookupForm(f => ({ ...f, fecha_nacimiento: e.target.value }))}
                disabled={onboardingStep === 'lookup_loading'}
              />
            </div>
            <div>
              <label htmlFor="lookup-email" style={labelStyle}>Correo Electrónico *</label>
              <input
                id="lookup-email"
                style={inputStyle}
                type="email"
                value={lookupForm.email}
                onChange={e => setLookupForm(f => ({ ...f, email: e.target.value }))}
                placeholder="cliente@email.com"
                maxLength={150}
                disabled={onboardingStep === 'lookup_loading'}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <button
              onClick={handleLookup}
              disabled={onboardingStep === 'lookup_loading'}
              style={{
                padding: '10px 24px',
                background: onboardingStep === 'lookup_loading' ? 'var(--at-ink-3)' : 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: onboardingStep === 'lookup_loading' ? 'not-allowed' : 'pointer',
                fontSize: '14px',
              }}
            >
              {onboardingStep === 'lookup_loading' ? 'Buscando...' : 'Solicitar Cliente'}
            </button>
            <button
              onClick={cancelForm}
              disabled={onboardingStep === 'lookup_loading'}
              style={{
                padding: '10px 24px',
                background: 'var(--at-chip)',
                color: 'var(--at-ink-2)',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Result: 2 of 3 match - Warning */}
      {onboardingStep === 'result_match2' && lookupResult && (
        <div>
          <div style={{
            background: 'var(--at-warning-tint)',
            border: '2px solid var(--at-warning)',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
          }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--at-warning-strong)', marginBottom: '8px' }}>
              Coincidencia parcial encontrada
            </div>
            <p style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--at-warning-strong)', lineHeight: '1.5' }}>
              Se encontró un cliente con datos similares: <b>{sanitizeHTML(lookupResult.cliente_nombre ?? '')}</b>.
              Sin embargo, el/los siguiente(s) dato(s) no coincide(n):
            </p>
            {lookupResult.mismatched_fields && lookupResult.mismatched_fields.length > 0 && (
              <ul style={{ margin: '0 0 12px', paddingLeft: '20px', color: 'var(--at-warning-strong)', fontSize: '14px' }}>
                {lookupResult.mismatched_fields.map(field => (
                  <li key={field} style={{ marginBottom: '4px', fontWeight: 600 }}>
                    {fieldLabelMap[field] || field}
                  </li>
                ))}
              </ul>
            )}
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--at-warning-strong)', lineHeight: '1.5' }}>
              Debe verificar con el cliente si ya cuenta con algún usuario en la plataforma para corregir el dato que no coincide.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => setOnboardingStep('lookup')}
              style={{
                padding: '10px 24px',
                background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Volver a buscar
            </button>
            <button
              onClick={cancelForm}
              style={{
                padding: '10px 24px',
                background: 'var(--at-chip)',
                color: 'var(--at-ink-2)',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Result: No match - Proceed to register */}
      {onboardingStep === 'result_no_match' && (
        <div>
          <div style={{
            background: 'var(--at-primary-tint)',
            border: '2px solid var(--at-primary)',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
          }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--at-ink-deep)', marginBottom: '8px' }}>
              Cliente no encontrado
            </div>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--at-primary-hover)', lineHeight: '1.5' }}>
              No se encontró un cliente con esos datos en la plataforma.
              Puede proceder a registrar un nuevo cliente con la información completa.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={proceedToFullForm}
              style={{
                padding: '10px 24px',
                background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Registrar Nuevo Cliente
            </button>
            <button
              onClick={() => setOnboardingStep('lookup')}
              style={{
                padding: '10px 24px',
                background: 'var(--at-chip)',
                color: 'var(--at-ink-2)',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Volver a buscar
            </button>
            <button
              onClick={cancelForm}
              style={{
                padding: '10px 24px',
                background: 'var(--at-chip)',
                color: 'var(--at-ink-2)',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Full Form (for new registration after no-match, or for editing) */}
      {onboardingStep === 'full_form' && (
        <div>

          {/* Datos de Identificación */}
          <div style={{ marginBottom: '20px' }}>
            <div style={sectionHeaderStyle}>Datos de Identificación</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="cli-nombre" style={labelStyle}>Nombre Completo *</label>
                <input
                  id="cli-nombre"
                  style={inputStyle}
                  value={form.nombre}
                  onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Ej. Juan Pérez García"
                  maxLength={150}
                />
              </div>
              <div>
                <label htmlFor="cli-cui" style={labelStyle}>CUI / DUI</label>
                <input
                  id="cli-cui"
                  style={inputStyle}
                  value={form.cui_dui}
                  onChange={e => setForm(f => ({ ...f, cui_dui: e.target.value }))}
                  placeholder="Ej. 1234567890101"
                  maxLength={20}
                />
              </div>
              <div>
                <label htmlFor="cli-birthdate" style={labelStyle}>Fecha de Nacimiento</label>
                <input
                  id="cli-birthdate"
                  style={inputStyle}
                  type="date"
                  value={form.fecha_nacimiento}
                  onChange={e => setForm(f => ({ ...f, fecha_nacimiento: e.target.value }))}
                />
              </div>
              <div>
                <label htmlFor="cli-nacionalidad" style={labelStyle}>Nacionalidad</label>
                <input
                  id="cli-nacionalidad"
                  style={inputStyle}
                  value={form.nacionalidad}
                  onChange={e => setForm(f => ({ ...f, nacionalidad: e.target.value }))}
                  placeholder="Ej. Guatemalteca, Salvadoreña..."
                  maxLength={80}
                />
              </div>
            </div>
          </div>

          {/* Datos de Contacto */}
          <div style={{ marginBottom: '20px' }}>
            <div style={sectionHeaderStyle}>Datos de Contacto</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div>
                <label htmlFor="cli-email" style={labelStyle}>Correo Electrónico</label>
                <input
                  id="cli-email"
                  style={inputStyle}
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="cliente@email.com"
                  maxLength={150}
                />
              </div>
              <div>
                <label htmlFor="cli-telefono" style={labelStyle}>Teléfono Principal</label>
                <input
                  id="cli-telefono"
                  style={inputStyle}
                  type="tel"
                  value={form.telefono}
                  onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))}
                  placeholder="Ej. 55551234 o +15551234567"
                  maxLength={20}
                />
                <span style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '3px', display: 'block' }}>Local: 8 dígitos — Internacional: +código+número</span>
              </div>
              <div>
                <label htmlFor="cli-telefono-alt" style={labelStyle}>Teléfono Alterno</label>
                <input
                  id="cli-telefono-alt"
                  style={inputStyle}
                  type="tel"
                  value={form.telefono_alterno}
                  onChange={e => setForm(f => ({ ...f, telefono_alterno: e.target.value }))}
                  placeholder="Ej. 44441234 o +15551234567"
                  maxLength={20}
                />
                <span style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '3px', display: 'block' }}>Local: 8 dígitos — Internacional: +código+número</span>
              </div>
              <div>
                <label htmlFor="cli-whatsapp" style={labelStyle}>Número de WhatsApp</label>
                <input
                  id="cli-whatsapp"
                  style={inputStyle}
                  type="tel"
                  value={form.whatsapp}
                  onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))}
                  placeholder="Ej. 55551234 o +15551234567"
                  maxLength={20}
                />
                <span style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '3px', display: 'block' }}>Local: 8 dígitos — Internacional: +código+número</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Habilitar acceso / Crear cuenta:</label>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, puede_crear_cuenta: !f.puede_crear_cuenta }))}
                  style={{
                    padding: '6px 16px',
                    borderRadius: '20px',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '13px',
                    background: form.puede_crear_cuenta ? 'var(--at-success-tint)' : 'var(--at-chip)',
                    color: form.puede_crear_cuenta ? 'var(--at-success-strong)' : 'var(--at-ink-3)',
                  }}
                >
                  {form.puede_crear_cuenta ? 'Sí' : 'No'}
                </button>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="cli-direccion" style={labelStyle}>Dirección</label>
                <input
                  id="cli-direccion"
                  style={inputStyle}
                  value={form.direccion}
                  onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))}
                  placeholder="Dirección del cliente..."
                  maxLength={255}
                />
              </div>
            </div>
          </div>

          {/* Datos de Facturación */}
          <div style={{ marginBottom: '20px' }}>
            <div style={sectionHeaderStyle}>Datos de Facturación</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div>
                <label htmlFor="cli-codigo" style={labelStyle}>Código de Cliente *</label>
                <input
                  id="cli-codigo"
                  style={inputStyle}
                  value={form.codigo}
                  onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))}
                  placeholder="Ej. CLI-001"
                  maxLength={50}
                />
              </div>
              <div>
                <label htmlFor="cli-nit" style={labelStyle}>Número para Facturación (NIT)</label>
                <input
                  id="cli-nit"
                  style={inputStyle}
                  value={form.numero_facturacion}
                  onChange={e => setForm(f => ({ ...f, numero_facturacion: e.target.value }))}
                  placeholder="Ej. 12345678-9 o CF"
                  maxLength={30}
                />
              </div>
            </div>
          </div>

          {/* serv:S11 — Datos fiscales del receptor (Facturación Electrónica).
              Solo cuando el tenant tiene régimen fiscal: NIT (FEL/GT) vs RFC + Uso
              CFDI (CFDI/MX). nombre_fiscal (razón social) aplica a ambos. */}
          {muestraFiscal && (
            <div style={{ marginBottom: '20px' }}>
              <div style={sectionHeaderStyle}>
                Datos Fiscales del Receptor {esFEL ? '(FEL · Guatemala)' : '(CFDI · México)'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
                <div>
                  <label htmlFor="cli-nombre-fiscal" style={labelStyle}>Nombre / Razón Social Fiscal</label>
                  <input
                    id="cli-nombre-fiscal"
                    style={inputStyle}
                    value={form.nombre_fiscal}
                    onChange={e => setForm(f => ({ ...f, nombre_fiscal: e.target.value }))}
                    placeholder="Razón social tal como aparece ante el SAT"
                    maxLength={300}
                  />
                </div>
                {esFEL && (
                  <div>
                    <label htmlFor="cli-fiscal-nit" style={labelStyle}>NIT (Guatemala)</label>
                    <input
                      id="cli-fiscal-nit"
                      style={inputStyle}
                      value={form.nit}
                      onChange={e => setForm(f => ({ ...f, nit: e.target.value }))}
                      placeholder="Ej. 12345678-9 o CF (Consumidor Final)"
                      maxLength={20}
                    />
                  </div>
                )}
                {esCFDI && (
                  <>
                    <div>
                      <label htmlFor="cli-fiscal-rfc" style={labelStyle}>RFC (México)</label>
                      <input
                        id="cli-fiscal-rfc"
                        style={inputStyle}
                        value={form.rfc}
                        onChange={e => setForm(f => ({ ...f, rfc: e.target.value.toUpperCase() }))}
                        placeholder="Ej. XAXX010101000"
                        maxLength={13}
                      />
                    </div>
                    <div>
                      <label htmlFor="cli-fiscal-uso-cfdi" style={labelStyle}>Uso del CFDI</label>
                      <select
                        id="cli-fiscal-uso-cfdi"
                        style={inputStyle}
                        value={form.uso_cfdi}
                        onChange={e => setForm(f => ({ ...f, uso_cfdi: e.target.value }))}
                      >
                        <option value="">— Seleccione —</option>
                        {USO_CFDI_OPCIONES.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={handleGuardar}
              disabled={loading}
              style={{
                padding: '10px 24px',
                background: loading ? 'var(--at-ink-3)' : 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
              }}
            >
              {loading ? 'Guardando...' : editingId ? 'Actualizar' : 'Guardar'}
            </button>
            <button
              onClick={cancelForm}
              style={{
                padding: '10px 24px',
                background: 'var(--at-chip)',
                color: 'var(--at-ink-2)',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

        </EditModal>
  )
}
