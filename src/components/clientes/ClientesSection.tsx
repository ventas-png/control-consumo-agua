import { useState, useEffect, useMemo, lazy, Suspense, type CSSProperties} from 'react'
import Swal from 'sweetalert2'
import type { Cliente, UserRole, UserSession, ClienteLookupResult, Unidad } from '../../types'
import { supabase } from '../../lib/supabase'
import { sanitizeInput, sanitizeHTML, validateEmail, validatePhoneNumber, formatPhoneForWa } from '../../lib/validation'
import { logSecurityEvent } from '../../lib/security'
import { EditModal } from '../shared/EditModal'
import { DataTable, type DataTableColumn } from '../shared'
import { getEditedTagInfo } from '../../lib/timeUtils'
import { ClienteRentasModal } from './ClienteRentasModal'

const ImportClientesModal = lazy(() => import('./ImportClientesModal').then(m => ({ default: m.ImportClientesModal })))

interface Props {
  clientes: Cliente[]
  unidades?: Unidad[]
  userRole: UserRole
  userId: string
  currentUser: UserSession
  companyId?: string
  onClienteAdded: (cliente: Cliente) => void
  onClienteUpdated: (id: string, partial: Partial<Cliente>) => void
  onClienteDeleted: (id: string) => void
  canCreate?: boolean
  canEdit?: boolean
  canChangeStatus?: boolean
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

type OnboardingStep = 'idle' | 'lookup' | 'lookup_loading' | 'result_match2' | 'result_no_match' | 'full_form'

interface LookupForm {
  cui_dui: string
  fecha_nacimiento: string
  email: string
}

const EMPTY_LOOKUP: LookupForm = { cui_dui: '', fecha_nacimiento: '', email: '' }

export function ClientesSection({ clientes, unidades = [], userRole, userId, currentUser, companyId, onClienteAdded, onClienteUpdated, onClienteDeleted, canCreate: canCreateProp = true, canEdit: canEditProp = true, canChangeStatus: _canChangeStatus = true }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [showImportModal, setShowImportModal] = useState(false)
  const [rentasClienteId, setRentasClienteId] = useState<string | null>(null)

  // Onboarding state
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>('idle')
  const [lookupForm, setLookupForm] = useState<LookupForm>(EMPTY_LOOKUP)
  const [lookupResult, setLookupResult] = useState<ClienteLookupResult | null>(null)

  // Portal account status per cliente
  const [accountMap, setAccountMap] = useState<Record<string, boolean>>({})
  // company_clientes activo per cliente
  const [activoMap, setActivoMap] = useState<Record<string, { ccId: string; activo: boolean }>>({})

  const canEdit = canEditProp && userRole !== 'viewer'

  // Load account status and company_clientes.activo whenever clientes list changes
  useEffect(() => {
    if (!companyId || clientes.length === 0) return
    const ids = clientes.map(c => c.id)

    supabase
      .from('app_users')
      .select('cliente_id')
      .in('cliente_id', ids)
      .then(({ data }) => {
        const map: Record<string, boolean> = {}
        data?.forEach(u => { if (u.cliente_id) map[u.cliente_id] = true })
        setAccountMap(map)
      })

    supabase
      .from('company_clientes')
      .select('id, cliente_id, activo')
      .eq('company_id', companyId)
      .in('cliente_id', ids)
      .then(({ data }) => {
        const map: Record<string, { ccId: string; activo: boolean }> = {}
        data?.forEach(row => { map[row.cliente_id] = { ccId: row.id, activo: row.activo ?? true } })
        setActivoMap(map)
      })
  }, [companyId, clientes])

  async function handleToggleActivo(clienteId: string) {
    const current = activoMap[clienteId]
    if (!current) return
    const newActivo = !current.activo
    setActivoMap(prev => ({ ...prev, [clienteId]: { ...current, activo: newActivo } }))
    const { error } = await supabase
      .from('company_clientes')
      .update({ activo: newActivo })
      .eq('id', current.ccId)
    if (error) {
      setActivoMap(prev => ({ ...prev, [clienteId]: current }))
      Swal.fire('Error', 'No se pudo actualizar la visibilidad del cliente.', 'error')
    }
  }
  void (canCreateProp && userRole !== 'viewer') // canCreate reservado para uso futuro

  function startCreate() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setLookupForm(EMPTY_LOOKUP)
    setLookupResult(null)
    setOnboardingStep('lookup')
    setIsModalOpen(true)
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
    setOnboardingStep('full_form')
    setIsModalOpen(true)
  }

  function cancelForm() {
    setIsModalOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setOnboardingStep('idle')
    setLookupForm(EMPTY_LOOKUP)
    setLookupResult(null)
  }

  async function handleLookup() {
    const cui_dui = sanitizeInput(lookupForm.cui_dui).trim()
    const email = sanitizeInput(lookupForm.email).trim()
    const fecha_nacimiento = lookupForm.fecha_nacimiento

    const errors: string[] = []
    if (!cui_dui) errors.push('CUI / DUI es requerido')
    if (!fecha_nacimiento) errors.push('Fecha de nacimiento es requerida')
    if (!email) errors.push('Correo electrónico es requerido')
    if (email && !validateEmail(email)) errors.push('Formato de correo electrónico inválido')

    if (errors.length > 0) {
      Swal.fire('Datos incompletos', errors.join('<br>'), 'warning')
      return
    }

    setOnboardingStep('lookup_loading')

    const { data, error } = await supabase.rpc('buscar_cliente_para_onboarding', {
      p_cui_dui: cui_dui,
      p_fecha_nac: fecha_nacimiento,
      p_email: email,
    })

    if (error) {
      Swal.fire('Error', 'No se pudo realizar la búsqueda. Verifique conexión.', 'error')
      setOnboardingStep('lookup')
      return
    }

    const result = data as ClienteLookupResult

    if (result.match_count === 3) {
      // All 3 match - auto-add to company
      await linkClientToCompany(result.cliente_id!, result.cliente_nombre!)
    } else if (result.match_count === 2) {
      // 2 of 3 match - warning
      setLookupResult(result)
      setOnboardingStep('result_match2')
    } else {
      // No match - proceed to registration
      setLookupResult(result)
      setOnboardingStep('result_no_match')
    }
  }

  async function linkClientToCompany(clienteId: string, clienteNombre: string) {
    if (!companyId) {
      Swal.fire('Error', 'No se pudo determinar la empresa actual.', 'error')
      setOnboardingStep('lookup')
      return
    }

    const { error } = await supabase.from('company_clientes').insert({
      company_id: companyId,
      cliente_id: clienteId,
      added_by: userId,
    })

    if (error) {
      if (error.code === '23505') {
        Swal.fire({
          icon: 'info',
          title: 'Cliente ya vinculado',
          text: `${clienteNombre} ya se encuentra vinculado a tu empresa.`,
          timer: 3000,
          showConfirmButton: true,
        })
      } else {
        Swal.fire('Error', error.message ?? 'No se pudo vincular el cliente.', 'error')
      }
      setOnboardingStep('lookup')
      return
    }

    // Fetch the full client record to add to local state
    const { data: clienteData } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', clienteId)
      .single()

    if (clienteData) {
      // Only add to local list if not already present
      const alreadyInList = clientes.some(c => c.id === clienteId)
      if (!alreadyInList) {
        onClienteAdded(clienteData as Cliente)
      }
    }

    Swal.fire({
      icon: 'success',
      title: 'Cliente adicionado con éxito',
      html: `<b>${sanitizeHTML(clienteNombre)}</b> ha sido adicionado con éxito en tu empresa.`,
      timer: 3000,
      showConfirmButton: true,
    })

    cancelForm()
  }

  function proceedToFullForm() {
    // Pre-fill the form with the lookup data
    setForm({
      ...EMPTY_FORM,
      cui_dui: lookupForm.cui_dui,
      fecha_nacimiento: lookupForm.fecha_nacimiento,
      email: lookupForm.email,
    })
    setEditingId(null)
    setOnboardingStep('full_form')
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
    if (telefono && !validatePhoneNumber(telefono)) errors.push('Teléfono principal: formato inválido (use 8 dígitos o +código+número, ej. +15551234567)')
    if (telefono_alterno && !validatePhoneNumber(telefono_alterno)) errors.push('Teléfono alterno: formato inválido (use 8 dígitos o +código+número, ej. +15551234567)')

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
        .update({
          ...payload,
          updated_at: new Date().toISOString(),
          updated_by: currentUser.user_id,
          updated_by_name: currentUser.name || currentUser.email,
        })
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
      const clienteId = crypto.randomUUID()
      const { error } = await supabase.from('clientes').insert({ ...payload, id: clienteId })

      if (!error) {
        // Link new client to company first so SELECT RLS policy passes
        if (companyId) {
          await supabase.from('company_clientes').insert({
            company_id: companyId,
            cliente_id: clienteId,
            added_by: userId,
          })
        }

        const newCliente = { ...payload, id: clienteId } as Cliente
        onClienteAdded(newCliente)
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
      title: '¿Quitar cliente de la empresa?',
      html: `<b>${c.nombre}</b> será removido de esta empresa. El registro del cliente se mantendrá en la plataforma y podrá ser re-vinculado posteriormente.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#7E9389',
      confirmButtonText: 'Sí, quitar',
      cancelButtonText: 'Cancelar',
    })
    if (!result.isConfirmed) return

    if (!companyId) {
      Swal.fire('Error', 'No se pudo determinar la empresa actual.', 'error')
      return
    }

    const { error } = await supabase
      .from('company_clientes')
      .delete()
      .eq('cliente_id', c.id)
      .eq('company_id', companyId)

    if (!error) {
      onClienteDeleted(c.id)
      Swal.fire({ icon: 'success', title: 'Cliente removido de la empresa', timer: 1500, showConfirmButton: false })
    } else {
      Swal.fire('Error', error.message ?? 'No se pudo quitar el cliente.', 'error')
    }
  }

  const filtered = clientes.filter(c =>
    c.nombre.toLowerCase().includes(search.toLowerCase()) ||
    c.codigo.toLowerCase().includes(search.toLowerCase()) ||
    (c.cui_dui ?? '').toLowerCase().includes(search.toLowerCase())
  )

  // Columnas de la tabla de clientes. Memoizamos para que React.memo en
  // DataTable y los sub-componentes funcione efectivamente.
  const columns: DataTableColumn<Cliente>[] = useMemo(() => {
    const cols: DataTableColumn<Cliente>[] = [
      {
        key: 'cliente',
        header: 'Cliente',
        sortable: true,
        accessor: c => c.nombre,
        render: c => <ClienteCell cliente={c} />,
      },
      {
        key: 'codigo',
        header: 'Código',
        sortable: true,
        accessor: c => c.codigo,
        render: c => (
          <span style={{ color: '#3E5A4C', fontFamily: 'monospace' }}>
            {sanitizeHTML(c.codigo)}
          </span>
        ),
      },
      {
        key: 'identificacion',
        header: 'Identificación',
        hideOnMobile: true,
        accessor: c => c.cui_dui ?? '',
        render: c => <IdentificacionCell cliente={c} />,
      },
      {
        key: 'contacto',
        header: 'Contacto',
        render: c => <ContactoCell cliente={c} />,
      },
      {
        key: 'facturacion',
        header: 'Facturación',
        hideOnMobile: true,
        accessor: c => c.numero_facturacion ?? '',
        render: c => c.numero_facturacion
          ? <span style={{ fontSize: 13, fontFamily: 'monospace' }}>{sanitizeHTML(c.numero_facturacion)}</span>
          : <span style={{ color: '#C7C2B0' }}>—</span>,
      },
      {
        key: 'cuenta',
        header: 'Cuenta',
        align: 'center',
        render: c => (
          <CuentaCell
            cliente={c}
            hasAccount={!!accountMap[c.id]}
            activoEntry={activoMap[c.id]}
            canEdit={canEdit}
            onToggleActivo={handleToggleActivo}
          />
        ),
      },
      {
        key: 'rentas',
        header: 'Rentas',
        align: 'center',
        render: c => {
          const count = unidades.filter(u => u.cliente_id === c.id && u.activo).length
          return (
            <button
              onClick={() => setRentasClienteId(c.id)}
              title={count > 0 ? `${count} unidad${count !== 1 ? 'es' : ''} asignada${count !== 1 ? 's' : ''}` : 'Sin unidades asignadas'}
              style={{
                padding: '4px 12px',
                background: count > 0 ? '#f0fdf4' : '#FAF7EF',
                color: count > 0 ? '#16a34a' : '#7E9389',
                border: `1px solid ${count > 0 ? '#bbf7d0' : '#E1DDD0'}`,
                borderRadius: 20,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 12,
                whiteSpace: 'nowrap',
              }}
            >
              🏠 {count > 0 ? `${count} unidad${count !== 1 ? 'es' : ''}` : 'Sin unidades'}
            </button>
          )
        },
      },
    ]
    if (canEdit) {
      cols.push({
        key: 'acciones',
        header: 'Acciones',
        align: 'center',
        render: c => (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
            <button
              onClick={() => startEdit(c)}
              style={{
                padding: '5px 12px', background: '#EEF2EC', color: '#102622',
                border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12,
              }}
            >
              Editar
            </button>
            <button
              onClick={() => handleEliminar(c)}
              style={{
                padding: '5px 12px', background: '#fef2f2', color: '#dc2626',
                border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12,
              }}
            >
              Eliminar
            </button>
          </div>
        ),
      })
    }
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, accountMap, activoMap, unidades])

  const inputStyle: CSSProperties = {
    padding: '10px 14px',
    border: '2px solid #E1DDD0',
    borderRadius: '8px',
    fontSize: '14px',
    width: '100%',
    boxSizing: 'border-box',
    outline: 'none',
  }
  const labelStyle: CSSProperties = {
    fontSize: '13px',
    fontWeight: 600,
    color: '#4a5568',
    marginBottom: '5px',
    display: 'block',
  }
  const sectionHeaderStyle: CSSProperties = {
    fontSize: '12px',
    fontWeight: 600,
    color: '#7E9389',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '10px',
  }

  const fieldLabelMap: Record<string, string> = {
    cui_dui: 'CUI / DUI',
    fecha_nacimiento: 'Fecha de Nacimiento',
    email: 'Correo Electrónico',
  }

  const modalTitle = (() => {
    if (!isModalOpen) return ''
    if (editingId) return 'Editar Cliente'
    if (onboardingStep === 'lookup' || onboardingStep === 'lookup_loading') return 'Solicitar Cliente'
    if (onboardingStep === 'result_match2') return 'Coincidencia parcial encontrada'
    if (onboardingStep === 'result_no_match') return 'Cliente no encontrado'
    return 'Nuevo Cliente'
  })()

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#15291F' }}>Clientes</h2>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#7E9389' }}>
            {clientes.length} cliente{clientes.length !== 1 ? 's' : ''} registrado{clientes.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Buscar por nombre, código o CUI/DUI..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoComplete="off"
            style={{ ...inputStyle, flex: 1, minWidth: 0, maxWidth: '280px' }}
          />
          {canEdit && (
            <>
              <button
                onClick={() => setShowImportModal(true)}
                style={{
                  padding: '10px 20px',
                  background: '#EAE6D8',
                  color: '#3E5A4C',
                  border: '1px solid #E1DDD0',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                📥 Importar Excel
              </button>
              <button
                onClick={startCreate}
                style={{
                  padding: '10px 20px',
                  background: 'linear-gradient(135deg, #1B3B36, #577B69)',
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
            </>
          )}
        </div>
      </div>

      {/* All client forms inside a single modal */}
      {isModalOpen && canEdit && (
        <EditModal title={modalTitle} onClose={cancelForm} maxWidth="700px">

      {/* Lookup Form - Step 1 */}
      {(onboardingStep === 'lookup' || onboardingStep === 'lookup_loading') && (
        <div>
          <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#7E9389' }}>
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
                background: onboardingStep === 'lookup_loading' ? '#7E9389' : 'linear-gradient(135deg, #1B3B36, #577B69)',
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
                background: '#EAE6D8',
                color: '#3E5A4C',
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
            background: '#fffbeb',
            border: '2px solid #f59e0b',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
          }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#92400e', marginBottom: '8px' }}>
              Coincidencia parcial encontrada
            </div>
            <p style={{ margin: '0 0 12px', fontSize: '14px', color: '#78350f', lineHeight: '1.5' }}>
              Se encontró un cliente con datos similares: <b>{sanitizeHTML(lookupResult.cliente_nombre ?? '')}</b>.
              Sin embargo, el/los siguiente(s) dato(s) no coincide(n):
            </p>
            {lookupResult.mismatched_fields && lookupResult.mismatched_fields.length > 0 && (
              <ul style={{ margin: '0 0 12px', paddingLeft: '20px', color: '#92400e', fontSize: '14px' }}>
                {lookupResult.mismatched_fields.map(field => (
                  <li key={field} style={{ marginBottom: '4px', fontWeight: 600 }}>
                    {fieldLabelMap[field] || field}
                  </li>
                ))}
              </ul>
            )}
            <p style={{ margin: 0, fontSize: '14px', color: '#78350f', lineHeight: '1.5' }}>
              Debe verificar con el cliente si ya cuenta con algún usuario en la plataforma para corregir el dato que no coincide.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => setOnboardingStep('lookup')}
              style={{
                padding: '10px 24px',
                background: 'linear-gradient(135deg, #1B3B36, #577B69)',
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
                background: '#EAE6D8',
                color: '#3E5A4C',
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
            background: '#EEF2EC',
            border: '2px solid #1B3B36',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
          }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#0E2A24', marginBottom: '8px' }}>
              Cliente no encontrado
            </div>
            <p style={{ margin: 0, fontSize: '14px', color: '#102622', lineHeight: '1.5' }}>
              No se encontró un cliente con esos datos en la plataforma.
              Puede proceder a registrar un nuevo cliente con la información completa.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={proceedToFullForm}
              style={{
                padding: '10px 24px',
                background: 'linear-gradient(135deg, #1B3B36, #577B69)',
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
                background: '#EAE6D8',
                color: '#3E5A4C',
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
                background: '#EAE6D8',
                color: '#3E5A4C',
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
                <span style={{ fontSize: '11px', color: '#7E9389', marginTop: '3px', display: 'block' }}>Local: 8 dígitos — Internacional: +código+número</span>
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
                <span style={{ fontSize: '11px', color: '#7E9389', marginTop: '3px', display: 'block' }}>Local: 8 dígitos — Internacional: +código+número</span>
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
                <span style={{ fontSize: '11px', color: '#7E9389', marginTop: '3px', display: 'block' }}>Local: 8 dígitos — Internacional: +código+número</span>
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
                    background: form.puede_crear_cuenta ? '#dcfce7' : '#EAE6D8',
                    color: form.puede_crear_cuenta ? '#166534' : '#7E9389',
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

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={handleGuardar}
              disabled={loading}
              style={{
                padding: '10px 24px',
                background: loading ? '#7E9389' : 'linear-gradient(135deg, #1B3B36, #577B69)',
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
                background: '#EAE6D8',
                color: '#3E5A4C',
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
      )}

      {/* Table */}
      <DataTable<Cliente>
        data={filtered}
        columns={columns}
        rowKey="id"
        pageSize={50}
        defaultSort={{ key: 'cliente', direction: 'asc' }}
        emptyState={{
          icon: '👤',
          title: search ? 'Sin resultados' : 'No hay clientes registrados',
          description: search
            ? 'Intenta con otro término'
            : canEdit
              ? 'Crea el primer cliente con el botón "+ Nuevo Cliente"'
              : 'No hay clientes aún',
        }}
      />

      {showImportModal && (
        <Suspense fallback={null}>
        <ImportClientesModal
          existingClientes={clientes}
          userId={userId}
          companyId={companyId}
          onClose={() => setShowImportModal(false)}
          onImportado={(nuevos) => {
            nuevos.forEach(c => onClienteAdded(c))
            setShowImportModal(false)
          }}
        />
        </Suspense>
      )}

      {rentasClienteId && companyId && (
        <ClienteRentasModal
          cliente={clientes.find(c => c.id === rentasClienteId)!}
          unidades={unidades}
          companyId={companyId}
          canEdit={canEdit}
          onClose={() => setRentasClienteId(null)}
        />
      )}
    </div>
  )
}

// ── Sub-componentes de celdas para la tabla de clientes ──────────────────
// Extraídos del render principal para mantener el cuerpo de ClientesSection
// más legible y para que React pueda potencialmente memoizarlos en el futuro.

function ClienteCell({ cliente: c }: { cliente: Cliente }) {
  const tag = getEditedTagInfo(c.updated_at, c.updated_by_name)
  return (
    <div>
      <div style={{ fontWeight: 600, color: '#15291F' }}>{sanitizeHTML(c.nombre)}</div>
      {c.direccion && (
        <div style={{ fontSize: 12, color: '#7E9389', fontWeight: 400, marginTop: 2 }}>
          {sanitizeHTML(c.direccion)}
        </div>
      )}
      {c.fecha_nacimiento && (
        <div style={{ fontSize: 11, color: '#C7C2B0', marginTop: 1 }}>
          Nac: {c.fecha_nacimiento}
        </div>
      )}
      {tag && (
        <span
          title={tag.tooltip}
          style={{
            display: 'inline-block', marginTop: 4, padding: '2px 8px',
            borderRadius: 10, fontSize: 11, fontWeight: 500,
            color: tag.color, background: tag.bg, cursor: 'default',
          }}
        >
          {tag.label}
        </span>
      )}
    </div>
  )
}

function IdentificacionCell({ cliente: c }: { cliente: Cliente }) {
  if (!c.cui_dui && !c.nacionalidad) return <span style={{ color: '#C7C2B0' }}>—</span>
  return (
    <>
      {c.cui_dui && <div style={{ fontSize: 13, fontFamily: 'monospace' }}>{sanitizeHTML(c.cui_dui)}</div>}
      {c.nacionalidad && (
        <div style={{ fontSize: 11, color: '#7E9389', marginTop: 2 }}>{sanitizeHTML(c.nacionalidad)}</div>
      )}
    </>
  )
}

function ContactoCell({ cliente: c }: { cliente: Cliente }) {
  if (!c.email && !c.telefono && !c.telefono_alterno && !c.whatsapp) {
    return <span style={{ color: '#C7C2B0' }}>—</span>
  }
  return (
    <>
      {c.email && <div style={{ fontSize: 13 }}>✉️ {sanitizeHTML(c.email)}</div>}
      {c.telefono && (
        <div style={{ fontSize: 12, marginTop: 2 }}>
          <a href={`tel:${c.telefono}`} style={{ color: '#102622', textDecoration: 'none' }} title="Llamar">
            📞 {sanitizeHTML(c.telefono)}
          </a>
        </div>
      )}
      {c.telefono_alterno && (
        <div style={{ fontSize: 12, marginTop: 2 }}>
          <a href={`tel:${c.telefono_alterno}`} style={{ color: '#7E9389', textDecoration: 'none' }} title="Llamar alterno">
            📱 {sanitizeHTML(c.telefono_alterno)}
          </a>
        </div>
      )}
      {c.whatsapp && (
        <div style={{ fontSize: 12, marginTop: 2 }}>
          <a
            href={`https://wa.me/${formatPhoneForWa(c.whatsapp)}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#16a34a', textDecoration: 'none' }}
            title="Abrir WhatsApp"
          >
            💬 {sanitizeHTML(c.whatsapp)}
          </a>
        </div>
      )}
    </>
  )
}

function CuentaCell({
  cliente: c, hasAccount, activoEntry, canEdit, onToggleActivo,
}: {
  cliente: Cliente
  hasAccount: boolean
  activoEntry: { ccId: string; activo: boolean } | undefined
  canEdit: boolean
  onToggleActivo: (id: string) => void
}) {
  const pill: CSSProperties = {
    padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <span style={{
        ...pill,
        background: c.puede_crear_cuenta ? '#dcfce7' : '#EAE6D8',
        color: c.puede_crear_cuenta ? '#166534' : '#7E9389',
      }}>
        {c.puede_crear_cuenta ? 'Habilitado' : 'Deshabilitado'}
      </span>
      {hasAccount ? (
        <>
          <span style={{ ...pill, background: '#D9E2DC', color: '#102622' }}>Cuenta activa</span>
          {canEdit && activoEntry && (
            <button
              onClick={() => onToggleActivo(c.id)}
              title={activoEntry.activo ? 'Clic para ocultar datos al cliente' : 'Clic para mostrar datos al cliente'}
              style={{
                ...pill, border: 'none', cursor: 'pointer',
                background: activoEntry.activo ? '#f0fdf4' : '#fff7ed',
                color: activoEntry.activo ? '#15803d' : '#c2410c',
              }}
            >
              {activoEntry.activo ? '● Datos visibles' : '○ Datos ocultos'}
            </button>
          )}
        </>
      ) : (
        <span style={{ ...pill, color: '#7E9389', background: '#FAF7EF', fontWeight: 400 }}>Sin cuenta</span>
      )}
    </div>
  )
}
