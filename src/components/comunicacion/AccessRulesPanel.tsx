import { useState } from 'react'
import Swal from 'sweetalert2'
import { AGUA_CATEGORIES, CONDOMINIOS_CATEGORIES } from '../../types'
import { CATEGORY_LABELS, ROLE_LABELS } from './conversationConstants'
import type { ConversationAccessRule, ConversationCategory, ConversationServiceType } from '../../types'

interface Props {
  companyId: string
  accessRules: ConversationAccessRule[]
  onSave: (rule: Omit<ConversationAccessRule, 'id' | 'created_at' | 'updated_at'>) => Promise<void>
  canEdit: boolean
  serviceType?: ConversationServiceType
}

export function AccessRulesPanel({ companyId, accessRules, onSave, canEdit, serviceType = 'agua' }: Props) {
  const roles = serviceType === 'condominios'
    ? ['administrador_general', 'junta_directiva', 'finanzas', 'operaciones', 'seguridad', 'comunidad', 'recepcion', 'visualizador']
    : ['admin', 'operator', 'collector', 'viewer']
  const allCategories = serviceType === 'condominios' ? CONDOMINIOS_CATEGORIES : AGUA_CATEGORIES

  const getRuleForRole = (role: string): ConversationAccessRule | undefined =>
    accessRules.find(r => r.role === role)

  const [saving, setSaving] = useState<string | null>(null)

  async function handleToggle(role: string, field: 'can_view_all' | 'can_respond' | 'can_assign', current: boolean) {
    setSaving(role + field)
    try {
      const existing = getRuleForRole(role)
      await onSave({
        company_id: companyId,
        role,
        service_type: serviceType,
        can_view_all: field === 'can_view_all' ? !current : (existing?.can_view_all ?? false),
        can_respond: field === 'can_respond' ? !current : (existing?.can_respond ?? false),
        can_assign: field === 'can_assign' ? !current : (existing?.can_assign ?? false),
        categories: existing?.categories ?? null,
      })
    } catch {
      Swal.fire({ icon: 'error', title: 'Error al guardar', text: 'No se pudo actualizar el permiso. Verifique sus permisos de acceso.' })
    } finally {
      setSaving(null)
    }
  }

  async function handleCategoryToggle(role: string, cat: string) {
    setSaving(role + cat)
    try {
      const existing = getRuleForRole(role)
      const current = existing?.categories ?? null
      let next: string[] | null
      if (current === null) {
        next = allCategories.filter(c => c !== cat)
      } else if (current.includes(cat)) {
        next = current.filter(c => c !== cat)
        if (next.length === allCategories.length) next = null
      } else {
        next = [...current, cat]
        if (next.length === allCategories.length) next = null
      }
      await onSave({
        company_id: companyId,
        role,
        service_type: serviceType,
        can_view_all: existing?.can_view_all ?? false,
        can_respond: existing?.can_respond ?? false,
        can_assign: existing?.can_assign ?? false,
        categories: next,
      })
    } catch {
      Swal.fire({ icon: 'error', title: 'Error al guardar', text: 'No se pudo actualizar la categoría. Verifique sus permisos de acceso.' })
    } finally {
      setSaving(null)
    }
  }

  return (
    <div>
      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
        Configure qué roles pueden ver y responder conversaciones, y en qué categorías.
      </div>
      {!canEdit && (
        <div style={{
          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px',
          padding: '10px 14px', color: '#92400e', fontSize: '12.5px', marginBottom: '14px',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span>⚠️</span>
          Solo el <strong>Admin Empresa (company_owner)</strong> puede modificar estas reglas. Vista de solo lectura.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {roles.map(role => {
          const rule = getRuleForRole(role)
          const categories = rule?.categories ?? null
          const isBusy = saving?.startsWith(role)
          const isDisabled = isBusy || !canEdit
          return (
            <div key={role} style={{
              border: '1px solid #e5e7eb', borderRadius: '10px', padding: '14px 16px',
              background: 'white', opacity: isBusy ? 0.7 : 1,
            }}>
              <div style={{ fontWeight: 600, fontSize: '13px', color: '#374151', marginBottom: '10px' }}>
                {ROLE_LABELS[role] ?? role}
              </div>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '10px' }}>
                {(['can_view_all', 'can_respond', 'can_assign'] as const).map(field => {
                  const val = rule ? rule[field] : false
                  const label = field === 'can_view_all' ? 'Ver todas' : field === 'can_respond' ? 'Responder' : 'Asignar'
                  return (
                    <label key={field} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: isDisabled ? 'not-allowed' : 'pointer', fontSize: '12.5px', color: '#374151', opacity: !canEdit ? 0.6 : 1 }}>
                      <input
                        type="checkbox"
                        checked={val}
                        disabled={isDisabled}
                        onChange={() => !isDisabled && handleToggle(role, field, val)}
                        style={{ width: '14px', height: '14px', accentColor: '#0ea5e9' }}
                      />
                      {label}
                    </label>
                  )
                })}
              </div>
              <div style={{ fontSize: '11.5px', color: '#6b7280', marginBottom: '6px' }}>
                Categorías visibles ({categories === null ? 'Todas' : `${categories.length}`}):
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {allCategories.map(cat => {
                  const active = categories === null || categories.includes(cat)
                  return (
                    <button
                      key={cat}
                      disabled={isDisabled}
                      onClick={() => !isDisabled && handleCategoryToggle(role, cat)}
                      style={{
                        padding: '3px 10px', borderRadius: '999px',
                        border: `1px solid ${active ? '#0ea5e9' : '#d1d5db'}`,
                        background: active ? '#e0f2fe' : 'white',
                        color: active ? '#0369a1' : '#6b7280',
                        fontSize: '11px', fontWeight: 500, cursor: 'pointer',
                      }}
                    >
                      {CATEGORY_LABELS[cat as ConversationCategory]}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
