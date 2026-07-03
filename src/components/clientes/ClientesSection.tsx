import { useState, useEffect, useMemo, lazy, Suspense } from 'react'
import { confirm, notify } from '../shared/Dialog'
import type { Cliente, ClienteLookupResult, Unidad } from '../../types'
import { useSession } from '../shared/SessionContext'
import { usePermissionsContext } from '../shared/PermissionsContext'
import {
  fetchClienteAccountMap,
  fetchCompanyClientesActivoMap,
  buscarClienteParaOnboarding,
  fetchClienteById,
} from '../../domain/clientes/queries'
import {
  updateCliente,
  linkClienteToCompany,
  addCompanyClientesLinks,
  setCompanyClienteActivo,
  unlinkClienteFromCompany,
} from '../../domain/clientes/mutations'
import { validatedInsert } from '../../lib/validatedInsert'
import { clienteInputSchema } from '../../domain/agua/schemas'
import { sanitizeInput, sanitizeHTML, validateEmail, validatePhoneNumber } from '../../lib/validation'
import { useRegimenFiscalQuery } from '../../domain/fiscal/mutations'
import { validarReceptorFiscal } from './receptorFiscal'
import { logSecurityEvent } from '../../lib/security'
import { DataTable, type DataTableColumn } from '../shared'
import { ClienteRentasModal } from './ClienteRentasModal'
import { EMPTY_FORM, type ClientesCtx, type FormState, type LookupForm, type OnboardingStep } from './ctx'
import { ClienteFormModal } from './ClienteFormModal'
import { inputStyle } from './ui'
import { ClienteCell, IdentificacionCell, ContactoCell, CuentaCell } from './celdas'

const ImportClientesModal = lazy(() => import('./ImportClientesModal').then(m => ({ default: m.ImportClientesModal })))

interface Props {
  clientes: Cliente[]
  unidades?: Unidad[]
  userId: string
  companyId?: string
  onClienteAdded: (cliente: Cliente) => void
  onClienteUpdated: (id: string, partial: Partial<Cliente>) => void
  onClienteDeleted: (id: string) => void
}




const EMPTY_LOOKUP: LookupForm = { cui_dui: '', fecha_nacimiento: '', email: '' }

export function ClientesSection({ clientes, unidades = [], userId, companyId, onClienteAdded, onClienteUpdated, onClienteDeleted }: Props) {
  const currentUser = useSession()
  const perms = usePermissionsContext()
  // serv:S11 — régimen fiscal del tenant: decide qué campos del receptor mostrar
  // (NIT en GT vs RFC + Uso CFDI en MX) y qué validador aplicar. 'ninguno' (o sin
  // company) oculta la sección fiscal (el tenant no emite comprobante fiscal).
  const { data: regimenFiscal = 'ninguno' } = useRegimenFiscalQuery(companyId)
  const esFEL = regimenFiscal === 'fel_gt'
  const esCFDI = regimenFiscal === 'cfdi_mx'
  const muestraFiscal = esFEL || esCFDI
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

  const canEdit = perms.canEdit('clientes') && currentUser.role !== 'viewer'
  // RBAC granular: quitar cliente de la empresa requiere permiso de eliminar
  const canDelete = perms.canDelete('clientes') && currentUser.role !== 'viewer'

  // Load account status and company_clientes.activo whenever clientes list changes
  useEffect(() => {
    if (!companyId || clientes.length === 0) return
    const ids = clientes.map(c => c.id)
    void fetchClienteAccountMap(ids).then(setAccountMap)
    void fetchCompanyClientesActivoMap(companyId, ids).then(setActivoMap)
  }, [companyId, clientes])

  async function handleToggleActivo(clienteId: string) {
    const current = activoMap[clienteId]
    if (!current) return
    const newActivo = !current.activo
    setActivoMap(prev => ({ ...prev, [clienteId]: { ...current, activo: newActivo } }))
    const { error } = await setCompanyClienteActivo(current.ccId, newActivo)
    if (error) {
      setActivoMap(prev => ({ ...prev, [clienteId]: current }))
      notify({ variant: 'error', title: 'Error', text: 'No se pudo actualizar la visibilidad del cliente.' })
    }
  }
  void (perms.canCreate('clientes') && currentUser.role !== 'viewer') // canCreate reservado para uso futuro

  function startCreate() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setLookupForm(EMPTY_LOOKUP)
    setLookupResult(null)
    setOnboardingStep('lookup')
    setIsModalOpen(true)
  }

  function startEdit(c: Cliente) {
    // serv:S11 — los campos fiscales del receptor (nit/rfc/nombre_fiscal/uso_cfdi)
    // existen como columnas de `clientes` (#387) pero aún no están en el tipo
    // compartido `Cliente` (lo edita otro PR); se leen vía cast a runtime.
    const cf = c as Cliente & {
      nit?: string | null; rfc?: string | null
      nombre_fiscal?: string | null; uso_cfdi?: string | null
    }
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
      nit: cf.nit ?? '',
      rfc: cf.rfc ?? '',
      nombre_fiscal: cf.nombre_fiscal ?? '',
      uso_cfdi: cf.uso_cfdi ?? '',
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
      notify({ variant: 'warning', title: 'Datos incompletos', text: errors.join('<br>') })
      return
    }

    setOnboardingStep('lookup_loading')

    const { data, error } = await buscarClienteParaOnboarding({
      cuiDui: cui_dui,
      fechaNac: fecha_nacimiento,
      email,
    })

    if (error || !data) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo realizar la búsqueda. Verifique conexión.' })
      setOnboardingStep('lookup')
      return
    }

    const result = data

    if (result.match_count === 3) {
      // All 3 match - auto-add to company
      await autoLinkCliente(result.cliente_id!, result.cliente_nombre!)
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

  async function autoLinkCliente(clienteId: string, clienteNombre: string) {
    if (!companyId) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo determinar la empresa actual.' })
      setOnboardingStep('lookup')
      return
    }

    const { error, alreadyLinked } = await linkClienteToCompany(companyId, clienteId, userId)

    if (alreadyLinked) {
      notify({
        variant: 'info',
        title: 'Cliente ya vinculado',
        text: `${clienteNombre} ya se encuentra vinculado a tu empresa.`,
        duration: 3000,
      })
      setOnboardingStep('lookup')
      return
    }
    if (error) {
      notify({ variant: 'error', title: 'Error', text: error ?? 'No se pudo vincular el cliente.' })
      setOnboardingStep('lookup')
      return
    }

    // Fetch the full client record to add to local state
    const clienteData = await fetchClienteById(clienteId)

    if (clienteData) {
      // Only add to local list if not already present
      const alreadyInList = clientes.some(c => c.id === clienteId)
      if (!alreadyInList) {
        onClienteAdded(clienteData)
      }
    }

    notify({
      variant: 'success',
      title: 'Cliente adicionado con éxito',
      text: `${clienteNombre} ha sido adicionado con éxito en tu empresa.`,
      duration: 3000,
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

    // serv:S11 — datos fiscales del receptor (FEL/CFDI).
    const nit = sanitizeInput(form.nit).trim()
    const rfc = sanitizeInput(form.rfc).trim()
    const nombre_fiscal = sanitizeInput(form.nombre_fiscal).trim()
    const uso_cfdi = sanitizeInput(form.uso_cfdi).trim()

    const errors: string[] = []
    if (!nombre || nombre.length < 2) errors.push('Nombre debe tener al menos 2 caracteres')
    if (!codigo || codigo.length < 3) errors.push('Código debe tener al menos 3 caracteres')
    if (email && !validateEmail(email)) errors.push('Formato de email inválido')
    if (telefono && !validatePhoneNumber(telefono)) errors.push('Teléfono principal: formato inválido (use 8 dígitos o +código+número, ej. +15551234567)')
    if (telefono_alterno && !validatePhoneNumber(telefono_alterno)) errors.push('Teléfono alterno: formato inválido (use 8 dígitos o +código+número, ej. +15551234567)')
    // Formato del identificador tributario del receptor (NIT GT / RFC MX). Helper
    // puro que reusa los validadores de businessFiscal.ts; opcional salvo formato.
    errors.push(...validarReceptorFiscal(regimenFiscal, { nit, rfc }))

    if (errors.length > 0) {
      notify({ variant: 'error', title: 'Error de validación', text: errors.join('<br>') })
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
      // serv:S11 — datos fiscales del receptor. nombre_fiscal aplica a ambos
      // regímenes; nit (GT) / rfc + uso_cfdi (MX) son específicos. Se guardan como
      // null si vacíos. `validatedInsert` usa el schema con `.passthrough()`, así
      // que estos campos extra pasan sin tocar `domain/agua/schemas.ts`.
      nombre_fiscal: nombre_fiscal || null,
      nit: nit || null,
      rfc: rfc || null,
      uso_cfdi: uso_cfdi || null,
      telefono_alterno: telefono_alterno || null,
    }

    if (editingId) {
      const { data, error } = await updateCliente(editingId, {
        ...payload,
        updated_at: new Date().toISOString(),
        updated_by: currentUser.user_id,
        updated_by_name: currentUser.name || currentUser.email,
      })

      if (!error && data) {
        onClienteUpdated(editingId, data)
        cancelForm()
        notify({ variant: 'success', title: 'Cliente actualizado', duration: 1800 })
      } else {
        notify({ variant: 'error', title: 'Error', text: error ?? 'No se pudo actualizar el cliente.' })
      }
    } else {
      await logSecurityEvent('client_creation_attempt', { client_code: codigo, user_role: currentUser.role }, userId)
      const clienteId = crypto.randomUUID()
      // agua:C6 — pre-validación Zod en boundary de persistencia. La
      // validación de UX (más estricta, con mensajes custom) ya corrió arriba
      // en `errors[]`; ésta es defense in depth contra payloads malformados.
      // `.passthrough()` preserva el `id` generado (campo no-input del schema).
      const { error } = await validatedInsert(
        'clientes',
        clienteInputSchema.passthrough(),
        { ...payload, id: clienteId },
      )

      if (!error) {
        // Link new client to company first so SELECT RLS policy passes
        if (companyId) {
          await addCompanyClientesLinks([{ company_id: companyId, cliente_id: clienteId, added_by: userId }])
        }

        const newCliente = { ...payload, id: clienteId } as Cliente
        onClienteAdded(newCliente)
        cancelForm()
        notify({ variant: 'success', title: 'Cliente guardado', duration: 2000 })
      } else {
        notify({ variant: 'error', title: 'Error', text: 'No se pudo guardar el cliente. Verifique conexión.' })
      }
    }

    setLoading(false)
  }

  async function handleEliminar(c: Cliente) {
    const result = await confirm({
      title: '¿Quitar cliente de la empresa?',
      text: `${c.nombre} será removido de esta empresa. El registro del cliente se mantendrá en la plataforma y podrá ser re-vinculado posteriormente.`,
      icon: 'warning',
      variant: 'danger',
      confirmText: 'Sí, quitar',
    })
    if (!result.isConfirmed) return

    if (!companyId) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo determinar la empresa actual.' })
      return
    }

    const { error } = await unlinkClienteFromCompany(c.id, companyId)

    if (!error) {
      onClienteDeleted(c.id)
      notify({ variant: 'success', title: 'Cliente removido de la empresa', duration: 1500 })
    } else {
      notify({ variant: 'error', title: 'Error', text: error ?? 'No se pudo quitar el cliente.' })
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
          <span style={{ color: 'var(--at-ink-2)', fontFamily: 'monospace' }}>
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
          : <span style={{ color: 'var(--at-line-strong)' }}>—</span>,
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
                background: count > 0 ? 'var(--at-success-tint)' : 'var(--at-surface-2)',
                color: count > 0 ? 'var(--at-success)' : 'var(--at-ink-3)',
                border: `1px solid ${count > 0 ? 'var(--at-success-border)' : 'var(--at-line)'}`,
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
    if (canEdit || canDelete) {
      cols.push({
        key: 'acciones',
        header: 'Acciones',
        align: 'center',
        render: c => (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
            {canEdit && (
              <button
                onClick={() => startEdit(c)}
                style={{
                  padding: '5px 12px', background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12,
                }}
              >
                Editar
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => handleEliminar(c)}
                style={{
                  padding: '5px 12px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12,
                }}
              >
                Eliminar
              </button>
            )}
          </div>
        ),
      })
    }
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, canDelete, accountMap, activoMap, unidades])

  const modalTitle = (() => {
    if (!isModalOpen) return ''
    if (editingId) return 'Editar Cliente'
    if (onboardingStep === 'lookup' || onboardingStep === 'lookup_loading') return 'Solicitar Cliente'
    if (onboardingStep === 'result_match2') return 'Coincidencia parcial encontrada'
    if (onboardingStep === 'result_no_match') return 'Cliente no encontrado'
    return 'Nuevo Cliente'
  })()

  const ctx: ClientesCtx = {
    unidades, canEdit, esFEL, esCFDI, muestraFiscal,
    form, setForm, editingId, loading,
    onboardingStep, setOnboardingStep, lookupForm, setLookupForm, lookupResult,
    modalTitle, cancelForm, handleLookup, autoLinkCliente, proceedToFullForm, handleGuardar,
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--at-ink)' }}>Clientes</h2>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--at-ink-3)' }}>
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
                  background: 'var(--at-chip)',
                  color: 'var(--at-ink-2)',
                  border: '1px solid var(--at-line)',
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
                  background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
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
      {isModalOpen && canEdit && <ClienteFormModal ctx={ctx} />}

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
          canDelete={canDelete}
          onClose={() => setRentasClienteId(null)}
        />
      )}
    </div>
  )
}

