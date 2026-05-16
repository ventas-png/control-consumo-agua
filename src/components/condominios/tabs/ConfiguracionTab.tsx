import { useState, useEffect, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { ConfiguracionCondominio } from '../../../types'
import { toast } from '../../../lib/toast'

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
      const { error } = await supabase.from('configuracion_condominio')
        .update({ valor: values[clave] || null, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) { toast.error(error.message); setSaving(null); return }
    } else {
      const { error } = await supabase.from('configuracion_condominio').insert({
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
        await supabase.from('configuracion_condominio')
          .update({ valor: values[clave] || null, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
      } else {
        await supabase.from('configuracion_condominio').insert({
          company_id: companyId, project_id: proyectoId, clave, valor: values[clave] || null, tipo,
        })
      }
    }
    setSaving(null)
    setDirty(new Set())
    onRefresh()
    toast.success('Configuración guardada')
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', color: '#1e293b', background: canEdit ? 'white' : '#f8fafc', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Configuración del Condominio</h2>
        {canEdit && dirty.size > 0 && (
          <button onClick={handleSaveAll} disabled={saving === 'all'}
            style={{ padding: '8px 20px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            {saving === 'all' ? 'Guardando…' : `💾 Guardar todo (${dirty.size})`}
          </button>
        )}
      </div>

      {GROUPS.map(group => (
        <div key={group} style={{ marginBottom: '24px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px' }}>
            {group}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
            {CONFIG_SCHEMA.filter(s => s.group === group).map(schema => {
              const isDirty = dirty.has(schema.clave)
              const isSaving = saving === schema.clave
              return (
                <div key={schema.clave} style={{ background: 'white', border: `1.5px solid ${isDirty ? '#bfdbfe' : '#e2e8f0'}`, borderRadius: '10px', padding: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>{schema.label}</label>
                    {canEdit && isDirty && (
                      <button onClick={() => handleSave(schema.clave)} disabled={!!saving}
                        style={{ padding: '2px 8px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                        {isSaving ? '…' : '✓ Guardar'}
                      </button>
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
                      style={{ ...inputStyle, border: `1.5px solid ${isDirty ? '#93c5fd' : '#e2e8f0'}` }}
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
