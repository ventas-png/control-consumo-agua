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
  moneda?: string
  onClienteAdded: (cliente: Cliente) => void
  onClienteUpdated: (id: string, partial: Partial<Cliente>) => void
  onClienteDeleted: (id: string) => void
}

const EMPTY_FORM = {
  nombre: '',
  codigo: '',
  medidor: '',
  email: '',
  direccion: '',
  telefono: '',
  tarifa: '3.00',
  canon: '20.00',
  consumo_minimo: '0',
  lectura_inicial: '0',
}

type FormState = typeof EMPTY_FORM

export function ClientesSection({ clientes, userRole, userId, moneda = 'Q', onClienteAdded, onClienteUpdated, onClienteDeleted }: Props) {
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
      medidor: c.medidor,
      email: c.email ?? '',
      direccion: c.direccion ?? '',
      telefono: c.telefono ?? '',
      tarifa: String(c.tarifa),
      canon: String(c.canon),
      consumo_minimo: String(c.consumo_minimo),
      lectura_inicial: String(c.lectura_inicial),
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
    if (!validateNumber(consumo_minimo, 0, 999999)) errors.push('Consumo mínimo inválido')
    if (!validateNumber(lectura_inicial, 0, 999999)) errors.push('Lectura inicial inválida')

    if (errors.length > 0) {
      Swal.fire('Error de validación', errors.join('<br>'), 'error')
      return
    }

    setLoading(true)

    if (editingId) {
      const payload = { nombre, codigo, medidor, email: email || null, direccion: direccion || null, telefono: telefono || null, tarifa, canon, consumo_minimo, lectura_inicial }
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
      const nuevo = { nombre, codigo, medidor, email: email || null, direccion: direccion || null, telefono: telefono || null, tarifa, canon, consumo_minimo, lectura_inicial }
      const { data, error } = await supabase.from('clientes').insert(nuevo).select()

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
    c.codigo.toLowerCase().includes(search.toLowerCase())
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

  const FIELDS = [
    { label: 'Nombre Completo *', key: 'nombre', placeholder: 'Ej. Juan Pérez', type: 'text' },
    { label: 'Código *', key: 'codigo', placeholder: 'Ej. CLI-001', type: 'text' },
    { label: 'N° Medidor', key: 'medidor', placeholder: 'Ej. MED-123456', type: 'text' },
    { label: 'Email', key: 'email', placeholder: 'cliente@email.com', type: 'email' },
    { label: 'Dirección', key: 'direccion', placeholder: '', type: 'text' },
    { label: 'Teléfono', key: 'telefono', placeholder: 'Ej. 55551234', type: 'tel' },
    { label: `Tarifa Consumo (${moneda}/m³)`, key: 'tarifa', placeholder: '3.00', type: 'number' },
    { label: `Canon Fijo (${moneda})`, key: 'canon', placeholder: '20.00', type: 'number' },
    { label: 'Consumo Mínimo (m³)', key: 'consumo_minimo', placeholder: '0', type: 'number' },
    { label: 'Lectura Inicial', key: 'lectura_inicial', placeholder: '0', type: 'number' },
  ]

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
            placeholder="Buscar por nombre o código..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, width: '240px' }}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            {FIELDS.map(f => (
              <div key={f.key}>
                <label style={labelStyle}>{f.label}</label>
                <input
                  type={f.type}
                  value={form[f.key as keyof FormState]}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  style={inputStyle}
                  min={f.type === 'number' ? '0' : undefined}
                  step={f.type === 'number' ? '0.01' : undefined}
                />
              </div>
            ))}
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

      {/* Grid */}
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
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Medidor</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Contacto</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>Tarifa</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>Canon</th>
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
                    </td>
                    <td style={{ padding: '12px 16px', color: '#475569', fontFamily: 'monospace' }}>
                      {sanitizeHTML(c.codigo)}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#475569', fontFamily: 'monospace' }}>
                      {c.medidor ? sanitizeHTML(c.medidor) : <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#475569' }}>
                      {c.email && <div style={{ fontSize: '13px' }}>{sanitizeHTML(c.email)}</div>}
                      {c.telefono && <div style={{ fontSize: '12px', color: '#94a3b8' }}>{sanitizeHTML(c.telefono)}</div>}
                      {!c.email && !c.telefono && <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                      {moneda} {Number(c.tarifa).toFixed(2)}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: '#475569' }}>
                      {moneda} {Number(c.canon).toFixed(2)}
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
