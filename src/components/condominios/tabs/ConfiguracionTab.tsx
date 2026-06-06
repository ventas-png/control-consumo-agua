import { useState, useEffect, type CSSProperties} from 'react'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { ConfiguracionCondominio } from '../../../types'
import { toast } from '../../../lib/toast'
import { Button } from '../../shared/Button'

interface Props {
  configuracion: ConfiguracionCondominio[]
  proyectoId: string
  companyId: string
  canEdit: boolean
  onRefresh: () => void
}

interface ConfigKey {
  clave: string
  label: string
  tipo: 'texto' | 'numero' | 'texto_largo'
  placeholder?: string
  group: string
}

const CONFIG_SCHEMA: ConfigKey[] = [
  { clave: 'nombre_condominio',      label: 'Nombre del condominio',       tipo: 'texto',       placeholder: 'Ej: Residencial El Roble',       group: 'General' },
  { clave: 'correo_admin',           label: 'Correo administración',        tipo: 'texto',       placeholder: 'admin@condominio.com',           group: 'General' },
  { clave: 'telefono_admin',         label: 'Teléfono administración',      tipo: 'texto',       placeholder: '+502 0000-0000',                 group: 'General' },
  { clave: 'sitio_web',              label: 'Sitio web',                    tipo: 'texto',       placeholder: 'https://...',                    group: 'General' },
  { clave: 'dia_cobro_mensual',      label: 'Día de cobro mensual',         tipo: 'numero',      placeholder: '5',                              group: 'Financiero' },
  { clave: 'porcentaje_mora',        label: 'Porcentaje de mora (%)',        tipo: 'numero',      placeholder: '5',                              group: 'Financiero' },
  { clave: 'dias_gracia_mora',       label: 'Días de gracia antes de mora', tipo: 'numero',      placeholder: '10',                             group: 'Financiero' },
  { clave: 'cuota_mantenimiento',    label: 'Cuota mantenimiento base',      tipo: 'numero',      placeholder: '0.00',                           group: 'Financiero' },
  { clave: 'capacidad_visitas_max',  label: 'Máx. visitantes por unidad',   tipo: 'numero',      placeholder: '10',                             group: 'Operacional' },
  { clave: 'horario_acceso_inicio',  label: 'Horario acceso inicio',        tipo: 'texto',       placeholder: '06:00',                          group: 'Operacional' },
  { clave: 'horario_acceso_fin',     label: 'Horario acceso fin',           tipo: 'texto',       placeholder: '22:00',                          group: 'Operacional' },
  { clave: 'reglamento',             label: 'Reglamento del condominio',    tipo: 'texto_largo', placeholder: 'Texto del reglamento interno…',  group: 'Documentos' },
  { clave: 'notas_generales',        label: 'Notas generales',              tipo: 'texto_largo', placeholder: 'Información adicional…',         group: 'Documentos' },
]

const GROUPS = [...new Set(CONFIG_SCHEMA.map(c => c.group))]

export function ConfiguracionTab({ configuracion, proyectoId, companyId, canEdit, onRefresh }: Props) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    const init: Record<string, string> = {}
    for (const c of configuracion) init[c.clave] = c.valor ?? ''
    setValues(init)
    setDirty(new Set())
  }, [configuracion])

  function handleChange(clave: string, val: string) {
    setValues(prev => ({ ...prev, [clave]: val }))
    setDirty(prev => new Set(prev).add(clave))
  }

  async function handleSave(clave: string) {
    const schema = CONFIG_SCHEMA.find(s => s.clave === clave)
    if (!schema) return
    setSaving(clave)
    const existing = configuracion.find(c => c.clave === clave)
    const tipo = schema.tipo === 'texto_largo' ? 'texto' : schema.tipo

    if (existing) {
      const { error } = await updateCondominioRow('configuracion_condominio', existing.id, { valor: values[clave] || null, updated_at: new Date().toISOString() })
      if (error) { toast.error(error.message); setSaving(null); return }
    } else {
      const { error } = await createCondominioRow('configuracion_condominio', {
        company_id: companyId, project_id: proyectoId,
        clave, valor: values[clave] || null, tipo,
      })
      if (error) { toast.error(error.message); setSaving(null); return }
    }
    setSaving(null)
    setDirty(prev => { const n = new Set(prev); n.delete(clave); return n })
    onRefresh()
  }

  async function handleSaveAll() {
    const dirtyKeys = Array.from(dirty)
    if (dirtyKeys.length === 0) return
    setSaving('all')
    for (const clave of dirtyKeys) {
      const schema = CONFIG_SCHEMA.find(s => s.clave === clave)
      if (!schema) continue
      const existing = configuracion.find(c => c.clave === clave)
      const tipo = schema.tipo === 'texto_largo' ? 'texto' : schema.tipo
      if (existing) {
        await updateCondominioRow('configuracion_condominio', existing.id, { valor: values[clave] || null, updated_at: new Date().toISOString() })
      } else {
        await createCondominioRow('configuracion_condominio', {
          company_id: companyId, project_id: proyectoId, clave, valor: values[clave] || null, tipo,
        })
      }
    }
    setSaving(null)
    setDirty(new Set())
    onRefresh()
    toast.success('Configuración guardada')
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', color: 'var(--at-ink)', background: canEdit ? 'var(--at-surface)' : 'var(--at-surface-2)', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Configuración del Condominio</h2>
        {canEdit && dirty.size > 0 && (
          <Button
            size="sm"
            onClick={handleSaveAll}
            loading={saving === 'all'}
            loadingText="Guardando…"
            iconLeft={saving !== 'all' ? '💾' : undefined}
          >
            Guardar todo ({dirty.size})
          </Button>
        )}
      </div>

      {GROUPS.map(group => (
        <div key={group} style={{ marginBottom: '24px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--at-chip)', paddingBottom: '6px' }}>
            {group}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
            {CONFIG_SCHEMA.filter(s => s.group === group).map(schema => {
              const isDirty = dirty.has(schema.clave)
              const isSaving = saving === schema.clave
              return (
                <div key={schema.clave} style={{ background: 'var(--at-surface)', border: `1.5px solid ${isDirty ? 'var(--at-primary-soft-2)' : 'var(--at-line)'}`, borderRadius: '10px', padding: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)' }}>{schema.label}</label>
                    {canEdit && isDirty && (
                      <Button
                        size="sm"
                        onClick={() => handleSave(schema.clave)}
                        disabled={!!saving}
                        loading={isSaving}
                        style={{ padding: '2px 8px', fontSize: '11px' }}
                      >
                        ✓ Guardar
                      </Button>
                    )}
                  </div>
                  {schema.tipo === 'texto_largo' ? (
                    <textarea
                      value={values[schema.clave] ?? ''}
                      onChange={e => canEdit && handleChange(schema.clave, e.target.value)}
                      placeholder={schema.placeholder}
                      readOnly={!canEdit}
                      rows={4}
                      style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                    />
                  ) : (
                    <input
                      type={schema.tipo === 'numero' ? 'number' : 'text'}
                      value={values[schema.clave] ?? ''}
                      onChange={e => canEdit && handleChange(schema.clave, e.target.value)}
                      placeholder={schema.placeholder}
                      readOnly={!canEdit}
                      min={schema.tipo === 'numero' ? 0 : undefined}
                      style={{ ...inputStyle, border: `1.5px solid ${isDirty ? 'var(--at-accent-2)' : 'var(--at-line)'}` }}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
