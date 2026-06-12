import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { notify } from '../shared/Dialog'
import { openPromptDialog } from '../shared/PromptDialog'
import { createEmpresa, createCompanyOwner } from '../../domain/superadmin/mutations'
import { GoogleEmailConfig } from '../empresa/GoogleEmailConfig'
import { SystemHealthModal } from './SystemHealthModal'
import { SuperAdminDashboardTab } from './SuperAdminDashboardTab'
import { EmpresasTable } from './EmpresasTable'
import { EmpresaDetailDrawer } from './EmpresaDetailDrawer'
import { type EmpresaSuperadminRow } from '../../domain/superadmin/queries'
import { superadminKeys } from '../../domain/superadmin/keys'

// ============================================================================
// SuperAdminSection — shell del panel de plataforma (super_admin).
// ============================================================================
// Tres pestañas:
//   · Dashboard      — KPIs (MRR/activas/churn) + gráficas de tendencia.
//   · Empresas       — DataTable server-side + drawer de detalle/gestión.
//   · Configuración  — correo del superadmin + salud del sistema.
// La gestión por empresa (editar, límites, módulos, suspender/eliminar) vive
// en EmpresaDetailDrawer; aquí solo queda el alta de empresas.

type TabId = 'dashboard' | 'empresas' | 'configuracion'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'empresas', label: 'Empresas' },
  { id: 'configuracion', label: 'Configuración' },
]

export function SuperAdminSection() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabId>('dashboard')
  const [showHealth, setShowHealth] = useState(false)
  const [selected, setSelected] = useState<EmpresaSuperadminRow | null>(null)

  const invalidar = () => { void queryClient.invalidateQueries({ queryKey: superadminKeys.all }) }

  async function crearEmpresa() {
    const result = await openPromptDialog({
      title: 'Nueva Empresa',
      description: 'Datos de la empresa y de su administrador inicial.',
      fields: [
        { name: 'empresaNombre', label: 'Nombre de la empresa', required: true, autoFocus: true },
        { name: 'nit', label: 'NIT', helpText: 'Opcional' },
        { name: 'emailEmpresa', label: 'Email de la empresa', type: 'email', helpText: 'Opcional' },
        { name: 'telefono', label: 'Teléfono', type: 'tel', helpText: 'Opcional' },
        { name: 'maxProj', label: 'Límite de proyectos', type: 'number', min: 1, initialValue: '5' },
        { name: 'maxUnits', label: 'Límite de unidades', type: 'number', min: 1, initialValue: '50' },
        { name: 'ownerNombre', label: 'Nombre del administrador', required: true },
        { name: 'ownerEmail', label: 'Email del administrador', type: 'email', required: true },
        { name: 'ownerPass', label: 'Contraseña temporal', type: 'password', required: true, helpText: 'Mínimo 8 caracteres' },
      ],
      submitText: 'Crear',
      validate: (data) => {
        if (!data.empresaNombre?.trim() || !data.ownerNombre?.trim() || !data.ownerEmail?.trim() || !data.ownerPass) {
          return 'Los campos marcados con * son obligatorios'
        }
        if (data.ownerPass.length < 8) return 'La contraseña debe tener al menos 8 caracteres'
        return null
      },
    })
    const formValues = result ? {
      empresaNombre: result.empresaNombre.trim(),
      nit: result.nit?.trim() || null,
      emailEmpresa: result.emailEmpresa?.trim() || null,
      telefono: result.telefono?.trim() || null,
      ownerNombre: result.ownerNombre.trim(),
      ownerEmail: result.ownerEmail.trim(),
      ownerPass: result.ownerPass,
      maxProj: parseInt(result.maxProj) || 5,
      maxUnits: parseInt(result.maxUnits) || 50,
    } : null

    if (!formValues) return

    // 1. Crear la empresa
    const { data: nuevaEmpresa, error: empresaError } = await createEmpresa({
      nombre: formValues.empresaNombre,
      nit: formValues.nit,
      email: formValues.emailEmpresa,
      telefono: formValues.telefono,
      max_projects: formValues.maxProj,
      max_units: formValues.maxUnits,
    })

    if (empresaError || !nuevaEmpresa) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo crear la empresa.' })
      return
    }

    // 2. Crear el company_owner via Edge Function (requiere service role)
    const { ok, error: ownerError } = await createCompanyOwner({
      email: formValues.ownerEmail,
      password: formValues.ownerPass,
      full_name: formValues.ownerNombre,
      company_id: (nuevaEmpresa as { id: string }).id,
    })

    if (!ok) {
      notify({ variant: 'error', title: 'Advertencia', text: `Empresa creada pero error al crear administrador: ${ownerError ?? 'Error desconocido'}` })
    } else {
      notify({ variant: 'success', title: 'Empresa creada', text: `"${formValues.empresaNombre}" lista con su administrador.`, duration: 2000 })
      invalidar()
    }
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, var(--at-ink), var(--at-ink))',
        borderRadius: '16px', padding: '24px 28px', marginBottom: '20px',
        border: '1px solid rgba(255,255,255,0.06)',
      }}>
        <h1 style={{ color: 'var(--at-chip)', fontSize: '22px', fontWeight: 700, margin: 0 }}>
          Panel Superadministrador
        </h1>
        <p style={{ color: 'var(--at-ink-3)', fontSize: '14px', margin: '4px 0 16px' }}>
          Operación de la plataforma: métricas, empresas y configuración.
        </p>
        <div role="tablist" aria-label="Secciones del panel" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {TABS.map(t => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                style={{
                  padding: '8px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                  cursor: 'pointer',
                  border: active ? 'none' : '1px solid rgba(255,255,255,0.12)',
                  background: active
                    ? 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))'
                    : 'rgba(255,255,255,0.06)',
                  color: active ? 'white' : 'var(--at-chip)',
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {tab === 'dashboard' && <SuperAdminDashboardTab />}

      {tab === 'empresas' && (
        <EmpresasTable
          onRowClick={setSelected}
          onNuevaEmpresa={() => void crearEmpresa()}
        />
      )}

      {tab === 'configuracion' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{
            background: 'var(--at-surface)', borderRadius: '16px', padding: '24px 28px',
            border: '1px solid var(--at-line)', boxShadow: '0 2px 12px rgba(0,0,0,.04)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px',
          }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--at-ink)' }}>Salud del sistema</div>
              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                Verifica el estado de la infraestructura Supabase (edge function /health).
              </div>
            </div>
            <button
              onClick={() => setShowHealth(true)}
              style={{
                padding: '9px 16px', borderRadius: '8px',
                border: '1px solid var(--at-line)', background: 'var(--at-surface)',
                color: 'var(--at-ink-2)', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
              }}
            >
              🩺 Verificar ahora
            </button>
          </div>

          <div style={{
            background: 'var(--at-surface)', borderRadius: '16px', padding: '28px',
            border: '1px solid var(--at-line)', boxShadow: '0 2px 12px rgba(0,0,0,.04)',
          }}>
            <GoogleEmailConfig isSuperadmin={true} />
          </div>
        </div>
      )}

      {selected && (
        <EmpresaDetailDrawer
          empresa={selected}
          onClose={() => setSelected(null)}
          onChanged={invalidar}
        />
      )}

      {showHealth && <SystemHealthModal onClose={() => setShowHealth(false)} />}
    </div>
  )
}
