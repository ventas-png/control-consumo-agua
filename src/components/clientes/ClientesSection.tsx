import { useState } from 'react'
import Swal from 'sweetalert2'
import type { Cliente, UserRole } from '../../types'
import { supabase } from '../../lib/supabase'
import { sanitizeInput, sanitizeHTML, validateEmail, validatePhoneNumber, validateNumber } from '../../lib/validation'
import { logSecurityEvent } from '../../lib/security'

interface Props {
  clientes: Cliente[]
  userRole: UserRole
  userId: string
  onClienteAdded: (cliente: Cliente) => void
}

const EMPTY_FORM = { nombre: '', codigo: '', medidor: '', email: '', direccion: '', telefono: '', tarifa: '3.00', canon: '20.00', consumo_minimo: '0', lectura_inicial: '0' }

export function ClientesSection({ clientes, userRole, userId, onClienteAdded }: Props) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  const canEdit = userRole !== 'viewer'

  async function handleGuardar() {
    const nombre = sanitizeInput(form.nombre)
    const codigo = sanitizeInput(form.codigo)
    const medidor = sanitizeInput(form.medidor)
    const email = sanitizeInput(form.email)
    const direccion = sanitizeInput(form.direccion)
    const telefono = sanitizeInput(form.telefono)
    const tarifa = parseFloat(form.tarifa)
    const canon = parseFloat(form.canon)
    const consumo_minimo = parseFloat(form.consumo_minimo)
    const lectura_inicial = parseFloat(form.lectura_inicial)

    const errors: string[] = []
    if (!nombre || nombre.length < 2) errors.push('Nombre debe tener al menos 2 caracteres')
    if (!codigo || codigo.length < 3) errors.push('Código debe tener al menos 3 caracteres')
    if (email && !validateEmail(email)) errors.push('Formato de email inválido')
    if (telefono && !validatePhoneNumber(telefono)) errors.push('Teléfono debe tener 8 dígitos (Guatemala)')
    if (!validateNumber(tarifa, 0, 1000)) errors.push('Tarifa debe estar entre 0 y 1000')
    if (!validateNumber(canon, 0, 1000)) errors.push('Canon debe estar entre 0 y 1000')
    if (!validateNumber(lectura_inicial, 0, 999999)) errors.push('Lectura inicial inválida')

    if (errors.length > 0) {
      Swal.fire('Error de validación', errors.join('<br>'), 'error')
      return
    }

    setLoading(true)
    await logSecurityEvent('client_creation_attempt', { client_code: codigo, user_role: userRole }, userId)

    const nuevo = { nombre, codigo, medidor, email, direccion, telefono, tarifa, canon, consumo_minimo, lectura_inicial }
    const { data, error } = await supabase.from('clientes').insert(nuevo).select()

    if (!error && data) {
      onClienteAdded(data[0] as Cliente)
      setForm(EMPTY_FORM)
      Swal.fire({ icon: 'success', title: 'Cliente Guardado', timer: 2000, showConfirmButton: false })
    } else {
      Swal.fire('Error', 'No se pudo guardar el cliente. Verifique conexión.', 'error')
    }
    setLoading(false)
  }

  const filtered = clientes.filter(c =>
    c.nombre.toLowerCase().includes(search.toLowerCase()) ||
    c.codigo.toLowerCase().includes(search.toLowerCase())
  )

  const inputStyle: React.CSSProperties = { padding: '12px 16px', border: '2px solid #e2e8f0', borderRadius: '10px', fontSize: '15px', width: '100%', boxSizing: 'border-box' }
  const labelStyle: React.CSSProperties = { fontSize: '14px', fontWeight: 600, color: '#4a5568', marginBottom: '6px', display: 'block' }

  return (
    <div>
      {canEdit && (
        <div style={{ background: 'white', borderRadius: '24px', padding: '32px', marginBottom: '24px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '20px', borderBottom: '2px solid #e2e8f0', paddingBottom: '12px' }}>
            Registrar Nuevo Cliente
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '24px' }}>
            {[
              { label: 'Nombre Completo', key: 'nombre', placeholder: 'Ej. Juan Pérez', type: 'text' },
              { label: 'Código', key: 'codigo', placeholder: 'Ej. CLI-001', type: 'text' },
              { label: 'Medidor', key: 'medidor', placeholder: 'Ej. MED-123456', type: 'text' },
              { label: 'Email', key: 'email', placeholder: 'cliente@email.com', type: 'email' },
              { label: 'Dirección', key: 'direccion', placeholder: '', type: 'text' },
              { label: 'Teléfono', key: 'telefono', placeholder: 'Ej. 55551234', type: 'tel' },
              { label: 'Tarifa Consumo (Q/m³)', key: 'tarifa', placeholder: '', type: 'number' },
              { label: 'Canon Fijo (Q)', key: 'canon', placeholder: '', type: 'number' },
              { label: 'Consumo Mínimo (m³)', key: 'consumo_minimo', placeholder: '0', type: 'number' },
              { label: 'Lectura Inicial', key: 'lectura_inicial', placeholder: '', type: 'number' },
            ].map(f => (
              <div key={f.key}>
                <label style={labelStyle}>{f.label}</label>
                <input
                  type={f.type}
                  value={form[f.key as keyof typeof form]}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  style={inputStyle}
                />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleGuardar}
              disabled={loading}
              style={{ padding: '12px 24px', background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
            >
              {loading ? 'Guardando...' : '💾 Guardar Cliente'}
            </button>
            <button
              onClick={() => setForm(EMPTY_FORM)}
              style={{ padding: '12px 24px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
            >
              Limpiar
            </button>
          </div>
        </div>
      )}

      <div style={{ background: 'white', borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px' }}>
          Directorio de Clientes ({clientes.length})
        </div>
        <input
          type="text"
          placeholder="Buscar..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, marginBottom: '16px' }}
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '12px' }}>
          {filtered.map(c => (
            <div key={c.id} style={{ background: '#f8fafc', borderRadius: '12px', padding: '16px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>{sanitizeHTML(c.nombre)}</div>
              <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>
                {sanitizeHTML(c.codigo)} | {sanitizeHTML(c.medidor)}
              </div>
              <div style={{ fontSize: '12px', color: '#0ea5e9' }}>
                Tarifa: Q{c.tarifa} | Canon: Q{c.canon}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p style={{ color: '#94a3b8', gridColumn: '1/-1' }}>No se encontraron clientes.</p>
          )}
        </div>
      </div>
    </div>
  )
}
