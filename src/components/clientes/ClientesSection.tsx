import { useState } from 'react'
import Swal from 'sweetalert2'
import type { Cliente, UserRole } from '../../types'
import { supabase } from '../../lib/supabase'
import { sanitizeInput, sanitizeHTML, validateEmail, validatePhoneNumber } from '../../lib/validation'
import { logSecurityEvent } from '../../lib/security'

interface Props {
  clientes: Cliente[]
  userRole: UserRole
  userId: string
  onClienteAdded: (cliente: Cliente) => void
  onClienteUpdated: (id: string, partial: Partial<Cliente>) => void
  onClienteDeleted: (id: string) => void
}

const EMPTY_FORM = {
  nombre: '',
  codigo: '',
  email: '',
  direccion: '',
  telefono: '',
  whatsapp: '',
  puede_crear_cuenta: false,
  // Datos personales
  nacionalidad: '',
  cui_dui: '',
  fecha_nacimiento: '',
  // Facturación
  numero_facturacion: '',
  // Contacto adicional
  telefono_alterno: '',
}

type FormState = typeof EMPTY_FORM

export function ClientesSection({ clientes, userRole, userId, onClienteAdded, onClienteUpdated, onClienteDeleted }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  const canEdit = userRole !== 'viewer'

  function startCreate() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setShowForm(true)
  }

  function startEdit(c: Cliente) {
    setForm({
      nombre: c.nombre,
      codigo: c.codigo,
      email: c.email ?? '',
      direccion: c.direccion ?? '',
      telefono: c.telefono ?? '',
      whatsapp: c.whatsapp ?? '',
      puede_crear_cuenta: c.puede_crear_cuenta ?? false,
      nacionalidad: c.nacionalidad ?? '',
      cui_dui: c.cui_dui ?? '',
      fecha_nacimiento: c.fecha_nacimiento ?? '',
      numero_facturacion: c.numero_facturacion ?? '',
      telefono_alterno: c.telefono_alterno ?? '',
    })
    setEditingId(c.id)
    setShowForm(true)
  }

  function cancelForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  async function handleGuardar() {
    const nombre = sanitizeInput(form.nombre)
    const codigo = sanitizeInput(form.codigo)
    const email = sanitizeInput(form.email)
    const direccion = sanitizeInput(form.direccion)
    const telefono = sanitizeInput(form.telefono)
    const whatsapp = sanitizeInput(form.whatsapp)
    const telefono_alterno = sanitizeInput(form.telefono_alterno)

    const errors: string[] = []
    if (!nombre || nombre.length < 2) errors.push('Nombre debe tener al menos 2 caracteres')
    if (!codigo || codigo.length < 3) errors.push('Código debe tener al menos 3 caracteres')
    if (email && !validateEmail(email)) errors.push('Formato de email inválido')
    if (telefono && !validatePhoneNumber(telefono)) errors.push('Teléfono principal: formato inválido (debe tener 8 dígitos)')
    if (telefono_alterno && !validatePhoneNumber(telefono_alterno)) errors.push('Teléfono alterno: formato inválido (debe tener 8 dígitos)')

    if (errors.length > 0) {
      Swal.fire('Error de validación', errors.join('<br>'), 'error')
      return
    }

    setLoading(true)

    const payload = {
      nombre,
      codigo,
      email: email || null,
      direccion: direccion || null,
      telefono: telefono || null,
      whatsapp: whatsapp || null,
      puede_crear_cuenta: form.puede_crear_cuenta,
      nacionalidad: sanitizeInput(form.nacionalidad) || null,
      cui_dui: sanitizeInput(form.cui_dui) || null,
      fecha_nacimiento: form.fecha_nacimiento || null,
      numero_facturacion: sanitizeInput(form.numero_facturacion) || null,
      telefono_alterno: telefono_alterno || null,
    }

    if (editingId) {
      const { data, error } = await supabase
        .from('clientes')
        .update(payload)
        .eq('id', editingId)
        .select()
        .single()

      if (!error && data) {
        onClienteUpdated(editingId, data as Cliente)
        cancelForm()
        Swal.fire({ icon: 'success', title: 'Cliente actualizado', timer: 1800, showConfirmButton: false })
      } else {
        Swal.fire('Error', error?.message ?? 'No se pudo actualizar el cliente.', 'error')
      }
    } else {
      await logSecurityEvent('client_creation_attempt', { client_code: codigo, user_role: userRole }, userId)
      const { data, error } = await supabase.from('clientes').insert(payload).select()

      if (!error && data) {
        onClienteAdded(data[0] as Cliente)
        cancelForm()
        Swal.fire({ icon: 'success', title: 'Cliente guardado', timer: 2000, showConfirmButton: false })
      } else {
        Swal.fire('Error', 'No se pudo guardar el cliente. Verifique conexión.', 'error')
      }
    }

    setLoading(false)
  }

  async function handleEliminar(c: Cliente) {
    const result = await Swal.fire({
      title: '¿Eliminar cliente?',
      html: `<b>${c.nombre}</b> y todos sus datos asociados serán eliminados permanentemente.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
    })
    if (!result.isConfirmed) return

    const { error } = await supabase.from('clientes').delete().eq('id', c.id)
    if (!error) {
      onClienteDeleted(c.id)
      Swal.fire({ icon: 'success', title: 'Cliente eliminado', timer: 1500, showConfirmButton: false })
    } else {
      Swal.fire('Error', error.message ?? 'No se pudo eliminar el cliente.', 'error')
    }
  }

  const filtered = clientes.filter(c =>
    c.nombre.toLowerCase().includes(search.toLowerCase()) ||
    c.codigo.toLowerCase().includes(search.toLowerCase()) ||
    (c.cui_dui ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const inputStyle: React.CSSProperties = {
    padding: '10px 14px',
    border: '2px solid #e2e8f0',
    borderRadius: '8px',
    fontSize: '14px',
    width: '100%',
    boxSizing: 'border-box',
    outline: 'none',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: '13px',
    fontWeight: 600,
    color: '#4a5568',
    marginBottom: '5px',
    display: 'block',
  }
  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: 600,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '10px',
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#1e293b' }}>Clientes</h2>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#64748b' }}>
            {clientes.length} cliente{clientes.length !== 1 ? 's' : ''} registrado{clientes.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Buscar por nombre, código o CUI/DUI..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, width: '280px' }}
          />
          {canEdit && (
            <button
              onClick={startCreate}
              style={{
                padding: '10px 20px',
                background: 'linear-gradient(135deg, #0ea5e9, #0d9488)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '14px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              + Nuevo Cliente
            </button>
          )}
        </div>
      </div>

      {/* Form */}
      {showForm && canEdit && (
        <div style={{ background: 'white', borderRadius: '16px', padding: '28px', marginBottom: '24px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '17px', fontWeight: 700, marginBottom: '20px', color: '#1e293b' }}>
            {editingId ? 'Editar Cliente' : 'Nuevo Cliente'}
          </div>

          {/* Datos de Identificación */}
          <div style={{ marginBottom: '20px' }}>
            <div style={sectionHeaderStyle}>Datos de Identificación</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Nombre Completo *</label>
                <input
                  style={inputStyle}
                  value={form.nombre}
                  onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Ej. Juan Pérez García"
                  maxLength={150}
                />
              </div>
              <div>
                <label style={labelStyle}>CUI / DUI</label>
                <input
                  style={inputStyle}
                  value={form.cui_dui}
                  onChange={e => setForm(f => ({ ...f, cui_dui: e.target.value }))}
                  placeholder="Ej. 1234567890101"
                  maxLength={20}
                />
              </div>
              <div>
                <label style={labelStyle}>Fecha de Nacimiento</label>
                <input
                  style={inputStyle}
                  type="date"
                  value={form.fecha_nacimiento}
                  onChange={e => setForm(f => ({ ...f, fecha_nacimiento: e.target.value }))}
                />
              </div>
              <div>
                <label style={labelStyle}>Nacionalidad</label>
                <input
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
                <label style={labelStyle}>Correo Electrónico</label>
                <input
                  style={inputStyle}
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="cliente@email.com"
                  maxLength={150}
                />
              </div>
              <div>
                <label style={labelStyle}>Teléfono Principal</label>
                <input
                  style={inputStyle}
                  type="tel"
                  value={form.telefono}
                  onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))}
                  placeholder="Ej. 55551234"
                  maxLength={20}
                />
              </div>
              <div>
                <label style={labelStyle}>Teléfono Alterno</label>
                <input
                  style={inputStyle}
                  type="tel"
                  value={form.telefono_alterno}
                  onChange={e => setForm(f => ({ ...f, telefono_alterno: e.target.value }))}
                  placeholder="Ej. 44441234"
                  maxLength={20}
                />
              </div>
              <div>
                <label style={labelStyle}>Número de WhatsApp</label>
                <input
                  style={inputStyle}
                  type="tel"
                  value={form.whatsapp}
                  onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))}
                  placeholder="Ej. 55551234"
                  maxLength={20}
                />
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
                    background: form.puede_crear_cuenta ? '#dcfce7' : '#f1f5f9',
                    color: form.puede_crear_cuenta ? '#166534' : '#64748b',
                  }}
                >
                  {form.puede_crear_cuenta ? 'Sí' : 'No'}
                </button>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Dirección</label>
                <input
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
                <label style={labelStyle}>Código de Cliente *</label>
                <input
                  style={inputStyle}
                  value={form.codigo}
                  onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))}
                  placeholder="Ej. CLI-001"
                  maxLength={50}
                />
              </div>
              <div>
                <label style={labelStyle}>Número para Facturación (NIT)</label>
                <input
                  style={inputStyle}
                  value={form.numero_facturacion}
                  onChange={e => setForm(f => ({ ...f, numero_facturacion: e.target.value }))}
                  placeholder="Ej. 12345678-9 o CF"
                  maxLength={30}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={handleGuardar}
              disabled={loading}
              style={{
                padding: '10px 24px',
                background: loading ? '#94a3b8' : 'linear-gradient(135deg, #0ea5e9, #0d9488)',
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
                background: '#f1f5f9',
                color: '#475569',
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

      {/* Table */}
      <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>👤</div>
            <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '6px' }}>
              {search ? 'Sin resultados' : 'No hay clientes registrados'}
            </div>
            <div style={{ fontSize: '14px' }}>
              {search ? 'Intenta con otro término' : canEdit ? 'Crea el primer cliente con el botón "+ Nuevo Cliente"' : 'No hay clientes aún'}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Cliente</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Código</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Identificación</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Contacto</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Facturación</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>Cuenta</th>
                  {canEdit && (
                    <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: '#475569' }}>Acciones</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, idx) => (
                  <tr
                    key={c.id}
                    style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? 'white' : '#fafbfc' }}
                  >
                    <td style={{ padding: '12px 16px', fontWeight: 600, color: '#1e293b' }}>
                      {sanitizeHTML(c.nombre)}
                      {c.direccion && (
                        <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 400, marginTop: '2px' }}>
                          {sanitizeHTML(c.direccion)}
                        </div>
                      )}
                      {c.fecha_nacimiento && (
                        <div style={{ fontSize: '11px', color: '#cbd5e1', marginTop: '1px' }}>
                          Nac: {c.fecha_nacimiento}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#475569', fontFamily: 'monospace' }}>
                      {sanitizeHTML(c.codigo)}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#475569' }}>
                      {c.cui_dui ? (
                        <div style={{ fontSize: '13px', fontFamily: 'monospace' }}>{sanitizeHTML(c.cui_dui)}</div>
                      ) : null}
                      {c.nacionalidad ? (
                        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{sanitizeHTML(c.nacionalidad)}</div>
                      ) : null}
                      {!c.cui_dui && !c.nacionalidad && <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#475569' }}>
                      {c.email && <div style={{ fontSize: '13px' }}>✉️ {sanitizeHTML(c.email)}</div>}
                      {c.telefono && <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>📞 {sanitizeHTML(c.telefono)}</div>}
                      {c.telefono_alterno && <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>📱 {sanitizeHTML(c.telefono_alterno)}</div>}
                      {c.whatsapp && <div style={{ fontSize: '12px', color: '#16a34a', marginTop: '2px' }}>💬 {sanitizeHTML(c.whatsapp)}</div>}
                      {!c.email && !c.telefono && !c.telefono_alterno && !c.whatsapp && <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#475569' }}>
                      {c.numero_facturacion ? (
                        <div style={{ fontSize: '13px', fontFamily: 'monospace' }}>{sanitizeHTML(c.numero_facturacion)}</div>
                      ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <span style={{
                        padding: '3px 12px',
                        borderRadius: '20px',
                        fontSize: '12px',
                        fontWeight: 600,
                        background: c.puede_crear_cuenta ? '#dcfce7' : '#f1f5f9',
                        color: c.puede_crear_cuenta ? '#166534' : '#94a3b8',
                      }}>
                        {c.puede_crear_cuenta ? 'Sí' : 'No'}
                      </span>
                    </td>
                    {canEdit && (
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button
                            onClick={() => startEdit(c)}
                            style={{
                              padding: '5px 12px',
                              background: '#eff6ff',
                              color: '#1d4ed8',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontWeight: 600,
                              fontSize: '12px',
                            }}
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => handleEliminar(c)}
                            style={{
                              padding: '5px 12px',
                              background: '#fef2f2',
                              color: '#dc2626',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontWeight: 600,
                              fontSize: '12px',
                            }}
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #f1f5f9', color: '#94a3b8', fontSize: '12px' }}>
          {filtered.length} cliente{filtered.length !== 1 ? 's' : ''} {search ? 'encontrados' : 'registrados'}
        </div>
      </div>
    </div>
  )
}
