import { useState } from 'react'
import { notify, confirm } from '../../shared/Dialog'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { Mascota, Unidad, EspecieMascota } from '../../../types'
import { ImageUploader } from '../../shared/ImageUploader'
import { SecureImage } from '../../shared/SecureImage'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { useTranslation, type TranslationKey } from '../../../lib/i18n'

interface Props {
  mascotas: Mascota[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESPECIE_ICON: Record<EspecieMascota, string> = { perro: '🐕', gato: '🐈', ave: '🦜', otro: '🐾' }
const ESPECIE_LABEL_KEY: Record<EspecieMascota, TranslationKey> = {
  perro: 'condominios.mascotas.especie_perro_label',
  gato:  'condominios.mascotas.especie_gato_label',
  ave:   'condominios.mascotas.especie_ave_label',
  otro:  'condominios.mascotas.especie_otro_label',
}

export function MascotasTab({ mascotas, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const { t } = useTranslation()
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroEspecie, setFiltroEspecie] = useState<EspecieMascota | 'todos'>('todos')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [form, setForm] = useState({
    unidad_id: '', nombre: '', especie: 'perro' as EspecieMascota,
    raza: '', color: '', fecha_nacimiento: '', fecha_ultima_vacuna: '', notas: '',
  })

  const hoy = new Date().toISOString().slice(0, 10)

  const filtradas = mascotas.filter(m => {
    const matchEspecie = filtroEspecie === 'todos' || m.especie === filtroEspecie
    return matchEspecie && m.activo
  })

  // Alert for overdue vaccines (>1 year)
  const vencidasVacuna = mascotas.filter(m => {
    if (!m.fecha_ultima_vacuna || !m.activo) return false
    const diff = (new Date(hoy).getTime() - new Date(m.fecha_ultima_vacuna).getTime()) / (1000 * 60 * 60 * 24)
    return diff > 365
  })

  function resetForm() {
    setForm({ unidad_id: '', nombre: '', especie: 'perro', raza: '', color: '', fecha_nacimiento: '', fecha_ultima_vacuna: '', notas: '' })
    setFotoUrl(null)
    setShowForm(false); setEditingId(null)
  }

  function startEdit(m: Mascota) {
    setForm({
      unidad_id: m.unidad_id, nombre: m.nombre, especie: m.especie,
      raza: m.raza ?? '', color: m.color ?? '',
      fecha_nacimiento: m.fecha_nacimiento ?? '', fecha_ultima_vacuna: m.fecha_ultima_vacuna ?? '',
      notas: m.notas ?? '',
    })
    setFotoUrl(m.foto_url ?? null)
    setEditingId(m.id); setShowForm(true)
  }

  async function handleGuardar() {
    if (!form.nombre.trim()) { notify({ variant: 'error', title: t('condominios.comun.error'), text: t('condominios.mascotas.err_name') }); return }
    if (!form.unidad_id) { notify({ variant: 'error', title: t('condominios.comun.error'), text: t('condominios.mascotas.err_unit') }); return }
    setSaving(true)
    const data = {
      company_id: companyId, project_id: proyectoId, unidad_id: form.unidad_id,
      nombre: form.nombre.trim(), especie: form.especie,
      raza: form.raza.trim() || null, color: form.color.trim() || null,
      fecha_nacimiento: form.fecha_nacimiento || null, fecha_ultima_vacuna: form.fecha_ultima_vacuna || null,
      notas: form.notas.trim() || null,
      foto_url: fotoUrl,
    }
    const { error } = editingId
      ? await updateCondominioRow('mascotas', editingId, data)
      : await createCondominioRow('mascotas', data)
    setSaving(false)
    if (error) { notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message }); return }
    notify({ variant: 'success', title: editingId ? t('condominios.mascotas.saved_edit') : t('condominios.mascotas.saved_new'), duration: 1400 })
    resetForm(); onRefresh()
  }

  async function eliminar(id: string) {
    const r = await confirm({ title: t('condominios.mascotas.delete_confirm'), icon: 'warning', variant: 'danger', confirmText: t('condominios.comun.delete') })
    if (!r.isConfirmed) return
    await deleteCondominioRow('mascotas', id)
    onRefresh()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>{t('condominios.mascotas.title')}</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>{t('condominios.mascotas.subtitle', { count: mascotas.filter(m => m.activo).length })}</p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
            {t('condominios.mascotas.new_button')}
          </button>
        )}
      </div>

      {/* Vacunas vencidas */}
      {vencidasVacuna.length > 0 && (
        <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: '12px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>⚠️</span>
          <span style={{ fontSize: '13.5px', color: 'var(--at-warning-strong)', fontWeight: 600 }}>
            {t('condominios.mascotas.vaccine_alert', { count: vencidasVacuna.length, nombres: vencidasVacuna.map(m => m.nombre).join(', ') })}
          </span>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>{editingId ? t('condominios.mascotas.form_title_edit') : t('condominios.mascotas.form_title_new')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>{t('condominios.mascotas.name')}</label>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder={t('condominios.mascotas.name_placeholder')}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>{t('condominios.comun.unit_required')}</label>
              <select value={form.unidad_id} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                <option value="">{t('condominios.comun.select_placeholder')}</option>
                {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>{t('condominios.mascotas.especie')}</label>
              <select value={form.especie} onChange={e => setForm(f => ({ ...f, especie: e.target.value as EspecieMascota }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                <option value="perro">{t('condominios.mascotas.especie_perro')}</option>
                <option value="gato">{t('condominios.mascotas.especie_gato')}</option>
                <option value="ave">{t('condominios.mascotas.especie_ave')}</option>
                <option value="otro">{t('condominios.mascotas.especie_otro')}</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>{t('condominios.mascotas.raza')}</label>
              <input value={form.raza} onChange={e => setForm(f => ({ ...f, raza: e.target.value }))} placeholder={t('condominios.mascotas.raza_placeholder')}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>{t('condominios.mascotas.color')}</label>
              <input value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} placeholder={t('condominios.mascotas.color_placeholder')}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>{t('condominios.mascotas.fecha_nacimiento')}</label>
              <input type="date" value={form.fecha_nacimiento} onChange={e => setForm(f => ({ ...f, fecha_nacimiento: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>{t('condominios.mascotas.ultima_vacuna')}</label>
              <input type="date" value={form.fecha_ultima_vacuna} onChange={e => setForm(f => ({ ...f, fecha_ultima_vacuna: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>{t('condominios.comun.notes')}</label>
              <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder={t('condominios.mascotas.notas_placeholder')}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <ImageUploader value={fotoUrl} onChange={setFotoUrl} folder="mascotas" label={t('condominios.mascotas.foto_label')} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={handleGuardar} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? t('condominios.comun.saving') : t('condominios.comun.save')}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>{t('condominios.comun.cancel')}</button>
          </div>
        </div>
      )}

      {/* Lista — cond:B2: migrado a <DataTable> shared */}
      <DataTable<Mascota>
        data={filtradas}
        rowKey="id"
        pageSize={50}
        defaultSort={{ key: 'nombre', direction: 'asc' }}
        searchPlaceholder={t('condominios.mascotas.search_placeholder')}
        searchableKeys={['nombre', m => m.raza ?? '', m => m.unidad_nombre ?? '']}
        rowStyle={m => {
          const vencida = m.fecha_ultima_vacuna
            && (new Date(hoy).getTime() - new Date(m.fecha_ultima_vacuna).getTime()) / (1000 * 60 * 60 * 24) > 365
          return vencida ? { background: 'var(--at-warning-tint)' } : {}
        }}
        filters={[{
          key: 'especie',
          label: t('condominios.mascotas.especie'),
          value: filtroEspecie,
          onChange: v => setFiltroEspecie(v as EspecieMascota | 'todos'),
          options: [
            { value: 'todos', label: t('condominios.mascotas.all_species') },
            ...(['perro', 'gato', 'ave', 'otro'] as const).map(e => ({ value: e, label: `${ESPECIE_ICON[e]} ${t(ESPECIE_LABEL_KEY[e])}` })),
          ],
        }]}
        emptyState={{ icon: '🐾', title: t('condominios.mascotas.empty') }}
        columns={[
          {
            key: 'nombre', header: t('condominios.mascotas.header_mascota'), sortable: true,
            render: m => (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {m.foto_url
                  ? <SecureImage src={m.foto_url} alt={m.nombre} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--at-line)', flexShrink: 0 }} />
                  : <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--at-success-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>
                      {ESPECIE_ICON[m.especie]}
                    </div>
                }
                <div>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{m.nombre}</div>
                  <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{t(ESPECIE_LABEL_KEY[m.especie])}{m.raza ? ` · ${m.raza}` : ''}</div>
                </div>
              </div>
            ),
          },
          {
            key: 'unidad_nombre', header: t('condominios.comun.unit'), sortable: true,
            accessor: m => m.unidad_nombre ?? '',
            render: m => m.unidad_nombre ? <span>📍 {m.unidad_nombre}</span> : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'color', header: t('condominios.mascotas.color'), hideOnMobile: true,
            accessor: m => m.color ?? '',
            render: m => m.color ? <span>🎨 {m.color}</span> : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'fecha_ultima_vacuna', header: t('condominios.mascotas.header_vacuna'), sortable: true,
            accessor: m => m.fecha_ultima_vacuna ?? '',
            render: m => {
              if (!m.fecha_ultima_vacuna) return <span style={{ color: 'var(--at-ink-3)' }}>—</span>
              const vencida = (new Date(hoy).getTime() - new Date(m.fecha_ultima_vacuna).getTime()) / (1000 * 60 * 60 * 24) > 365
              return (
                <span style={{ color: vencida ? 'var(--at-danger)' : 'var(--at-success)', fontWeight: vencida ? 700 : 400 }}>
                  {t('condominios.mascotas.vaccine_label', { fecha: m.fecha_ultima_vacuna })} {vencida ? t('condominios.mascotas.vaccine_overdue') : ''}
                </span>
              )
            },
          },
          {
            key: 'actions', header: '', align: 'right',
            render: m => canEdit ? (
              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                <button onClick={() => startEdit(m)} aria-label={t('condominios.comun.edit')} style={{ padding: '6px 10px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-ink-2)' }}>✏️ {t('condominios.comun.edit')}</button>
                <button onClick={() => eliminar(m.id)} aria-label={t('condominios.comun.delete')} style={{ padding: '6px 10px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-danger)', fontSize: '14px' }}>🗑</button>
              </div>
            ) : null,
          },
        ] satisfies DataTableColumn<Mascota>[]}
      />
    </div>
  )
}
