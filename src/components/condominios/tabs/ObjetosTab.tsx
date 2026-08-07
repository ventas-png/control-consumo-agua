import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { ObjetoPerdido, EstadoObjeto } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { useTranslation, type TranslationKey } from '../../../lib/i18n'
import { ModalPortal } from '../../shared/ModalPortal'

interface Props {
  objetos: ObjetoPerdido[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_COLOR: Record<EstadoObjeto, { color: string; bg: string }> = {
  en_custodia: { color: 'var(--at-primary)', bg: 'var(--at-primary-soft)' },
  reclamado:   { color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  donado:      { color: 'var(--at-accent)', bg: 'var(--at-accent-tint)' },
  descartado:  { color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
}
const ESTADO_LABEL_KEY: Record<EstadoObjeto, TranslationKey> = {
  en_custodia: 'condominios.objetos.estado_en_custodia',
  reclamado:   'condominios.objetos.estado_reclamado',
  donado:      'condominios.objetos.estado_donado',
  descartado:  'condominios.objetos.estado_descartado',
}

const blank = (): Partial<ObjetoPerdido> => ({
  descripcion: '',
  lugar_encontrado: '',
  fecha_encontrado: hoyLocalISO(),
  estado: 'en_custodia',
  notas: '',
})

export function ObjetosTab({ objetos, proyectoId, companyId, userId, canCreate, canEdit, onRefresh }: Props) {
  const { t } = useTranslation()
  const [filtroEstado, setFiltroEstado] = useState<EstadoObjeto | 'todos'>('en_custodia')
  const [form, setForm] = useState<Partial<ObjetoPerdido>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reclamoId, setReclamoId] = useState<string | null>(null)
  const [reclamadoPor, setReclamadoPor] = useState('')

  const filtered = objetos.filter(o => filtroEstado === 'todos' || o.estado === filtroEstado)

  function startEdit(o: ObjetoPerdido) {
    setForm({
      descripcion: o.descripcion,
      lugar_encontrado: o.lugar_encontrado ?? '',
      fecha_encontrado: o.fecha_encontrado,
      estado: o.estado,
      notas: o.notas ?? '',
    })
    setEditId(o.id)
    setShowForm(true)
  }

  function cancelForm() {
    setShowForm(false)
    setEditId(null)
    setForm(blank())
  }

  async function handleSave() {
    if (!form.descripcion?.trim()) return notify({ variant: 'warning', title: t('condominios.comun.required'), text: t('condominios.objetos.err_descripcion') })
    setSaving(true)
    const payload = {
      company_id: companyId,
      project_id: proyectoId,
      descripcion: form.descripcion!.trim(),
      lugar_encontrado: form.lugar_encontrado || null,
      fecha_encontrado: form.fecha_encontrado ?? hoyLocalISO(),
      estado: form.estado ?? 'en_custodia',
      notas: form.notas || null,
      registrado_por: userId || null,
    }
    if (editId) {
      const { error } = await updateCondominioRow('objetos_perdidos', editId, payload)
      if (error) { notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message }); setSaving(false); return }
    } else {
      const { error } = await createCondominioRow('objetos_perdidos', payload)
      if (error) { notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message }); setSaving(false); return }
    }
    setSaving(false)
    cancelForm()
    onRefresh()
  }

  async function handleDelete(id: string) {
    const result = await confirm({ title: t('condominios.objetos.delete_confirm'), icon: 'warning', variant: 'danger', confirmText: t('condominios.comun.delete') })
    if (!result.isConfirmed) return
    const { error } = await deleteCondominioRow('objetos_perdidos', id)
    if (error) return notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message })
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoObjeto) {
    if (estado === 'reclamado') {
      setReclamoId(id)
      setReclamadoPor('')
      return
    }
    const { error } = await updateCondominioRow('objetos_perdidos', id, { estado })
    if (error) return notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message })
    onRefresh()
  }

  async function confirmarReclamo() {
    if (!reclamoId) return
    const { error } = await updateCondominioRow('objetos_perdidos', reclamoId, {
      estado: 'reclamado',
      reclamado_por: reclamadoPor || null,
      fecha_reclamo: hoyLocalISO(),
    })
    if (error) return notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message })
    setReclamoId(null)
    setReclamadoPor('')
    onRefresh()
  }

  const inputStyle: CSSProperties = {
    width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px',
    fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box',
  }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>{t('condominios.objetos.title')}</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            {t('condominios.objetos.new_button')}
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700, color: 'var(--at-ink)' }}>
            {editId ? t('condominios.objetos.form_title_edit') : t('condominios.objetos.form_title_new')}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>{t('condominios.objetos.descripcion')}</label>
              <input style={inputStyle} value={form.descripcion ?? ''} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder={t('condominios.objetos.descripcion_placeholder')} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.objetos.lugar')}</label>
              <input style={inputStyle} value={form.lugar_encontrado ?? ''} onChange={e => setForm(f => ({ ...f, lugar_encontrado: e.target.value }))} placeholder={t('condominios.objetos.lugar_placeholder')} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.objetos.fecha')}</label>
              <input style={inputStyle} type="date" value={form.fecha_encontrado ?? ''} onChange={e => setForm(f => ({ ...f, fecha_encontrado: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.comun.status')}</label>
              <select style={inputStyle} value={form.estado ?? 'en_custodia'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoObjeto }))}>
                {(Object.keys(ESTADO_LABEL_KEY) as EstadoObjeto[]).map(k => <option key={k} value={k}>{t(ESTADO_LABEL_KEY[k])}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t('condominios.comun.notes')}</label>
              <input style={inputStyle} value={form.notas ?? ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder={t('condominios.objetos.notas_placeholder')} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>{t('condominios.comun.cancel')}</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? t('condominios.comun.saving') : editId ? t('condominios.comun.update') : t('condominios.comun.register')}
            </button>
          </div>
        </div>
      )}

      {/* Reclamo modal */}
      {reclamoId && (
        <ModalPortal>
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--at-surface)', borderRadius: '12px', padding: '24px', width: '360px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 700 }}>{t('condominios.objetos.reclamo_title')}</h3>
            <label style={labelStyle}>{t('condominios.objetos.reclamado_por')}</label>
            <input style={{ ...inputStyle, marginBottom: '16px' }} value={reclamadoPor} onChange={e => setReclamadoPor(e.target.value)} placeholder={t('condominios.objetos.reclamado_por_placeholder')} autoFocus />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setReclamoId(null)} style={{ padding: '8px 14px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>{t('condominios.comun.cancel')}</button>
              <button onClick={confirmarReclamo} style={{ padding: '8px 14px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>{t('condominios.objetos.confirmar_reclamo')}</button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* List — cond:B2: migrado a <DataTable> shared */}
      <DataTable<ObjetoPerdido>
        data={filtered}
        rowKey="id"
        pageSize={50}
        mobileCardLayout
        defaultSort={{ key: 'fecha_encontrado', direction: 'desc' }}
        searchPlaceholder={t('condominios.objetos.search_placeholder')}
        searchableKeys={['descripcion', o => o.lugar_encontrado ?? '', o => o.reclamado_por ?? '']}
        filters={[
          {
            key: 'estado',
            label: t('condominios.comun.status'),
            value: filtroEstado,
            onChange: v => setFiltroEstado(v as EstadoObjeto | 'todos'),
            options: [
              { value: 'todos', label: t('condominios.comun.all_statuses') },
              ...(Object.keys(ESTADO_LABEL_KEY) as EstadoObjeto[]).map(k => ({ value: k, label: t(ESTADO_LABEL_KEY[k]) })),
            ],
          },
        ]}
        emptyState={{ icon: '🔍', title: t('condominios.objetos.empty') }}
        columns={[
          {
            key: 'descripcion', header: t('condominios.objetos.col_objeto'), sortable: true,
            render: o => (
              <div>
                <div style={{ fontWeight: 700, color: 'var(--at-ink)', fontSize: '14px' }}>{o.descripcion}</div>
                {o.lugar_encontrado && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>📍 {o.lugar_encontrado}</div>}
                {o.notas && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontStyle: 'italic' }}>{o.notas}</div>}
              </div>
            ),
          },
          {
            key: 'estado', header: t('condominios.comun.status'), sortable: true,
            accessor: o => t(ESTADO_LABEL_KEY[o.estado]),
            render: o => {
              const c = ESTADO_COLOR[o.estado]
              return <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: c.bg, color: c.color, whiteSpace: 'nowrap' }}>{t(ESTADO_LABEL_KEY[o.estado])}</span>
            },
          },
          {
            key: 'fecha_encontrado', header: t('condominios.objetos.col_encontrado'), sortable: true, hideOnMobile: true,
            render: o => <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{o.fecha_encontrado}</span>,
          },
          {
            key: 'reclamo', header: t('condominios.objetos.col_reclamo'), hideOnMobile: true,
            accessor: o => o.reclamado_por ?? '',
            render: o => o.reclamado_por ? (
              <span style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>{o.reclamado_por}{o.fecha_reclamo ? ` (${o.fecha_reclamo})` : ''}</span>
            ) : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'actions', header: '', align: 'right',
            render: o => canEdit ? (
              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {o.estado === 'en_custodia' && (
                  <>
                    <button onClick={() => handleEstado(o.id, 'reclamado')} style={{ padding: '4px 8px', background: 'var(--at-success-tint)', color: 'var(--at-success-strong)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                      {t('condominios.objetos.accion_reclamado')}
                    </button>
                    <button onClick={() => handleEstado(o.id, 'donado')} style={{ padding: '4px 8px', background: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                      {t('condominios.objetos.accion_donar')}
                    </button>
                    <button onClick={() => handleEstado(o.id, 'descartado')} style={{ padding: '4px 8px', background: 'var(--at-chip)', color: 'var(--at-ink-3)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                      {t('condominios.objetos.accion_descartar')}
                    </button>
                  </>
                )}
                <button onClick={() => startEdit(o)} aria-label={t('condominios.comun.edit')} style={{ padding: '4px 8px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                <button onClick={() => handleDelete(o.id)} aria-label={t('condominios.comun.delete')} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>🗑️</button>
              </div>
            ) : null,
          },
        ] satisfies DataTableColumn<ObjetoPerdido>[]}
      />
    </div>
  )
}
