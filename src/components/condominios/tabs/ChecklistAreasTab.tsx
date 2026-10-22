// Tab Checklist de áreas — inspección área por área.
//
// El área se ELIGE del catálogo canónico (`areas_condominio`, que se administra
// en el tab Áreas): era el último texto libre de área del módulo, y con él
// "Piscina", " piscina " y "PISCINA" eran tres áreas distintas que no se podían
// cruzar con lo que la limpieza programa ni con lo que la ronda recorre.
// Desde 20260910000100 la fila guarda `area_id` y conserva `area` como SNAPSHOT
// del nombre; lo legado que el backfill no pudo vincular (nombres ambiguos) se
// sigue mostrando con su texto, marcado como lo que es.
//
// Los ÍTEMS del checklist siguen siendo texto libre a propósito: son líneas
// dentro del jsonb de su fila, sin identidad ni nada que las referencie.
// ITEMS_PREDEFINIDOS es una lista de SUGERENCIAS para no teclear las quince de
// siempre — no un catálogo. Meterlas en el de actividades (que carga cargo,
// servicio, duración, insumos y herramientas) les daría un peso que no piden.
import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { createCondominioRow, deleteCondominioRowAfectando, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { nombreAreaDe } from '../../../domain/condominios/areas'
import type { AreaCondominio, ChecklistArea, ChecklistItem } from '../../../types'
import { confirm, notify } from '../../shared/Dialog'

interface Props {
  checklists: ChecklistArea[]
  /** Catálogo compartido: la inspección ELIGE de aquí, nunca escribe el nombre. */
  areas: AreaCondominio[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  /** Eliminar tiene su propio permiso (condominios.tab.<tab>.delete): ver o
   *  editar no basta. */
  canDelete: boolean
  /** Visibilidad del tab Áreas: decide si se ofrece el atajo para configurarlas. */
  puedeConfigurarAreas: boolean
  onIrATab: (tabId: 'areas_config') => void
  onRefresh: () => void
}

const ESTADO_STYLE: Record<string, { bg: string; color: string; label: string; icon: string }> = {
  completo:          { bg: 'var(--at-success-tint)', color: 'var(--at-success)', label: 'Completo',           icon: '✅' },
  con_observaciones: { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: 'Con observaciones',  icon: '⚠️' },
  pendiente:         { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', label: 'Pendiente',          icon: '🕐' },
}

const ITEMS_PREDEFINIDOS = [
  'Lobby principal', 'Escaleras y pasillos', 'Ascensor',
  'Área de piscina', 'Gimnasio', 'Salón social',
  'Parqueos', 'Jardines y áreas verdes', 'Cuarto de basura',
  'Bombas de agua', 'Tablero eléctrico', 'Cámaras de seguridad',
  'Iluminación exterior', 'Portones y accesos', 'Área de juegos',
]

const BLANK_ITEM: ChecklistItem = { item: '', ok: false, observacion: '' }

const inputStyle: CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1.5px solid var(--at-line)',
  borderRadius: '7px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box',
}
const labelStyle: CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }

function calcEstado(items: ChecklistItem[]): ChecklistArea['estado'] {
  if (items.length === 0) return 'pendiente'
  if (items.every(i => i.ok)) return 'completo'
  if (items.some(i => !i.ok)) return 'con_observaciones'
  return 'pendiente'
}

export function ChecklistAreasTab({ checklists, areas, proyectoId, companyId, canCreate, canEdit, canDelete, puedeConfigurarAreas, onIrATab, onRefresh }: Props) {
  // Por id y no la fila: tras editar, la ventana muestra lo que trae
  // onRefresh (la copia guardada quedaba con los datos de antes).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /**
   * Ítems recién marcados en la ventana, para que la casilla responda al
   * instante y no tras la recarga. Vale solo mientras `checklists` siga
   * trayendo esa misma fila: cualquier versión nueva la descarta.
   */
  const [cambioLocal, setCambioLocal] = useState<{ fila: ChecklistArea; cambios: Partial<ChecklistArea> } | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [formAreaId, setFormAreaId] = useState('')
  /**
   * Texto del área de la fila que se está editando cuando NO tiene area_id.
   * Sin esto, editar un checklist legado solo para marcar un ítem obligaría a
   * elegir área (o perdería el texto, y `area` es NOT NULL). Se conserva tal
   * cual hasta que alguien lo vincule a propósito.
   */
  const [formAreaLegado, setFormAreaLegado] = useState('')
  const [formFecha, setFormFecha] = useState(hoyLocalISO())
  const [formInspector, setFormInspector] = useState('')
  const [formNotas, setFormNotas] = useState('')
  const [formItems, setFormItems] = useState<ChecklistItem[]>([])
  const [filterEstado, setFilterEstado] = useState('')
  const [filterArea, setFilterArea] = useState('')
  const [saving, setSaving] = useState(false)
  const [predefinidoSel, setPredefinidoSel] = useState('')

  // Solo las activas se ofrecen al capturar; las inactivas siguen renderizándose
  // en las inspecciones que ya las usan.
  const areasActivas = [...areas]
    .filter(a => a.activo)
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
  /** Inspecciones anteriores al catálogo que quedaron sin vincular. */
  const hayLegadas = checklists.some(c => !c.area_id)
  const nombreArea = (c: ChecklistArea) => nombreAreaDe(c.area_id, areas, c.area)
  const iconoArea = (c: ChecklistArea) =>
    (c.area_id && areas.find(a => a.id === c.area_id)?.icono) || '🗒️'

  const filaSel = selectedId ? checklists.find(c => c.id === selectedId) ?? null : null
  const selected = filaSel && cambioLocal?.fila === filaSel ? { ...filaSel, ...cambioLocal.cambios } : filaSel

  const openNew = () => {
    setFormAreaId(''); setFormAreaLegado(''); setFormFecha(hoyLocalISO())
    setFormInspector(''); setFormNotas(''); setFormItems([])
    setEditId(null); setShowForm(true); setSelectedId(null)
  }
  const openEdit = (c: ChecklistArea) => {
    setFormAreaId(c.area_id ?? '')
    setFormAreaLegado(c.area_id ? '' : c.area)
    setFormFecha(c.fecha)
    setFormInspector(c.inspector ?? ''); setFormNotas(c.notas ?? '')
    setFormItems(c.items.map(i => ({ ...i })))
    setEditId(c.id); setShowForm(true)
  }

  const addPredefinido = () => {
    if (!predefinidoSel) return
    setFormItems(prev => [...prev, { item: predefinidoSel, ok: false, observacion: '' }])
    setPredefinidoSel('')
  }
  const addBlank = () => setFormItems(prev => [...prev, { ...BLANK_ITEM }])
  const removeItem = (i: number) => setFormItems(prev => prev.filter((_, idx) => idx !== i))
  const setItem = (i: number, field: keyof ChecklistItem, val: string | boolean) =>
    setFormItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: val } : it))

  const handleSave = async () => {
    const areaSel = formAreaId ? areas.find(a => a.id === formAreaId) : undefined
    // Un checklist nuevo SIEMPRE sale del catálogo. Uno legado puede guardarse
    // sin vincular (conservando su texto): así se corrigen ítems sin obligar a
    // resolver ahí mismo un nombre que quizá ni exista todavía en el catálogo.
    if (!areaSel && !formAreaLegado.trim()) {
      return notify({
        variant: 'warning', title: 'Campo requerido',
        text: 'Selecciona el área del catálogo. Si no existe, créala en el tab "Áreas".',
      })
    }
    setSaving(true)
    const estado = calcEstado(formItems)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      // `area` es NOT NULL y es el snapshot del nombre al vincular; el legado
      // sin vincular conserva su texto original intacto.
      area_id: areaSel?.id ?? null,
      area: areaSel ? areaSel.nombre.trim() : formAreaLegado.trim(),
      fecha: formFecha,
      inspector: formInspector || null, notas: formNotas || null,
      items: formItems, estado,
    }
    const { error } = editId
      ? await updateCondominioRow('checklist_areas', editId, payload)
      : await createCondominioRow('checklist_areas', payload)
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); onRefresh()
  }

  const toggleItem = async (c: ChecklistArea, idx: number) => {
    const items = c.items.map((it, i) => i === idx ? { ...it, ok: !it.ok } : it)
    const estado = calcEstado(items)
    const { error } = await updateCondominioRow('checklist_areas', c.id, { items, estado })
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
    const fila = checklists.find(x => x.id === c.id)
    if (fila) setCambioLocal({ fila, cambios: { items, estado } })
  }

  const handleDelete = async (c: ChecklistArea) => {
    // El botón ya se oculta sin permiso; esto cubre cualquier otra vía.
    if (!canDelete) return
    const r = await confirm({ title: '¿Eliminar checklist?', text: `${nombreArea(c)} · ${c.fecha}`, icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRowAfectando('checklist_areas', c.id)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    if (selectedId === c.id) setSelectedId(null)
    onRefresh()
  }

  function cerrarForm() {
    if (saving) return
    setShowForm(false)
  }

  const filtered = checklists.filter(c =>
    (!filterEstado || c.estado === filterEstado) &&
    // 'sin_vincular' agrupa lo legado: tiene texto de área pero no catálogo.
    (!filterArea || (filterArea === 'sin_vincular' ? !c.area_id : c.area_id === filterArea))
  )

  const kpiCounts = Object.keys(ESTADO_STYLE).map(k => ({ key: k, count: checklists.filter(c => c.estado === k).length }))

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Checklist de áreas</h2>
        {canCreate && (
          <button onClick={openNew} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
            + Nuevo checklist
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px', marginBottom: '12px' }}>
        {kpiCounts.map(({ key, count }) => {
          const s = ESTADO_STYLE[key]
          return (
            <div key={key} style={{ background: s.bg, borderRadius: '8px', padding: '6px', textAlign: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: '18px', color: s.color }}>{count}</div>
              <div style={{ fontSize: '10px', color: s.color, fontWeight: 600 }}>{s.icon} {s.label}</div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <select aria-label="Filtrar por área" value={filterArea} onChange={e => setFilterArea(e.target.value)} style={{ ...inputStyle, flex: '1 1 200px', width: 'auto', minWidth: 0 }}>
          <option value="">Todas las áreas</option>
          {areasActivas.map(a => <option key={a.id} value={a.id}>{a.icono} {a.nombre}</option>)}
          {hayLegadas && <option value="sin_vincular">⚠ Sin vincular al catálogo</option>}
        </select>
        <select aria-label="Filtrar por estado" value={filterEstado} onChange={e => setFilterEstado(e.target.value)} style={{ ...inputStyle, flex: '1 1 200px', width: 'auto', minWidth: 0 }}>
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO_STYLE).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
      </div>

      {/* Lista a todo el ancho — cada checklist se abre en ventana. Antes era
          un panel fijo de 340px con el detalle al lado, que en el teléfono ni
          cabía en la pantalla. */}
      {filtered.length === 0 && <EmptyState icon="📋" title="Sin registros" />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {filtered.map(c => {
          const s = ESTADO_STYLE[c.estado]
          const pct = c.items.length > 0 ? Math.round(c.items.filter(i => i.ok).length / c.items.length * 100) : 0
          return (
            <button key={c.id} type="button" onClick={() => { setSelectedId(c.id); setShowForm(false) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit', padding: '12px 14px', border: '1.5px solid var(--at-line)', borderRadius: '10px', cursor: 'pointer', background: 'var(--at-surface)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--at-ink)' }}>{iconoArea(c)} {nombreArea(c)}</div>
                  <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{c.fecha}{c.inspector ? ` · ${c.inspector}` : ''}</div>
                  {c.items.length > 0 && (
                    <div style={{ marginTop: '4px' }}>
                      <div style={{ height: '4px', background: 'var(--at-line)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? 'var(--at-success)' : 'var(--at-primary)', transition: 'width 0.3s' }} />
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{c.items.filter(i => i.ok).length}/{c.items.length} ítems</div>
                    </div>
                  )}
                </div>
                <span title={s.label} style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '10px', fontWeight: 700, background: s.bg, color: s.color, flexShrink: 0, marginLeft: '6px' }}>{s.icon}</span>
              </div>
            </button>
          )
        })}
      </div>

      {/* Form en ventana; al editar reemplaza al detalle, que vuelve al cerrar. */}
      {showForm && (
        <EditModal
          title={editId ? 'Editar checklist' : 'Nuevo checklist de área'}
          maxWidth="720px"
          fullScreenOnMobile
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          onClose={cerrarForm}
          footer={<>
            <Button variant="secondary" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} loading={saving} loadingText="Guardando…">Guardar</Button>
          </>}
        >
          {/* `1 / -1` y no `span 2`: con una sola columna (teléfono) el span
              creaba una columna implícita y el campo se salía de la ventana. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginBottom: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="chk-area" style={labelStyle}>Área *</label>
              <select id="chk-area" aria-label="Área" style={inputStyle} value={formAreaId} onChange={e => setFormAreaId(e.target.value)} autoFocus>
                <option value="">
                  {formAreaLegado ? '— Sin vincular (registro anterior) —' : '— Selecciona un área —'}
                </option>
                {areasActivas.map(a => <option key={a.id} value={a.id}>{a.icono} {a.nombre}</option>)}
              </select>
              {formAreaLegado && !formAreaId && (
                <div style={{ fontSize: '11px', color: 'var(--at-warning-strong)', marginTop: '4px' }}>
                  ⚠ Registro anterior con texto libre: “{formAreaLegado}”. Elegí el área del catálogo para vincularlo.
                </div>
              )}
              {areasActivas.length === 0 && (
                <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '4px' }}>
                  Sin áreas activas.{' '}
                  {puedeConfigurarAreas
                    ? (
                      <button type="button" onClick={() => onIrATab('areas_config')}
                        style={{ background: 'none', border: 'none', padding: 0, color: 'var(--at-accent)', fontWeight: 600, fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}>
                        Crearlas en el tab Áreas
                      </button>
                    )
                    : 'Se dan de alta en el tab Áreas.'}
                </div>
              )}
            </div>
            <div>
              <label htmlFor="chk-fecha" style={labelStyle}>Fecha</label>
              <input id="chk-fecha" style={inputStyle} type="date" value={formFecha} onChange={e => setFormFecha(e.target.value)} />
            </div>
            <div>
              <label htmlFor="chk-inspector" style={labelStyle}>Inspector</label>
              <input id="chk-inspector" style={inputStyle} value={formInspector} onChange={e => setFormInspector(e.target.value)} placeholder="Nombre del inspector" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="chk-notas" style={labelStyle}>Notas generales</label>
              <input id="chk-notas" style={inputStyle} value={formNotas} onChange={e => setFormNotas(e.target.value)} placeholder="Observaciones generales" />
            </div>
          </div>

          {/* Items section — las filas se parten en el teléfono en vez de
              dejar cada campo en unos pocos píxeles. */}
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '8px' }}>Ítems de inspección</div>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
              <select aria-label="Ítem predefinido" value={predefinidoSel} onChange={e => setPredefinidoSel(e.target.value)} style={{ ...inputStyle, flex: '1 1 200px', width: 'auto', minWidth: 0 }}>
                <option value="">— Seleccionar ítem predefinido —</option>
                {ITEMS_PREDEFINIDOS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <button type="button" onClick={addPredefinido} style={{ padding: '7px 12px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}>+ Añadir</button>
              <button type="button" onClick={addBlank} style={{ padding: '7px 12px', background: 'var(--at-chip)', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}>+ Personalizado</button>
            </div>
            {formItems.length === 0 && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', fontStyle: 'italic' }}>Sin ítems añadidos</div>}
            {formItems.map((it, i) => (
              <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginBottom: '6px', background: 'var(--at-surface)', borderRadius: '8px', padding: '8px', border: '1px solid var(--at-line)' }}>
                <input type="checkbox" aria-label="Ítem completado" checked={it.ok} onChange={e => setItem(i, 'ok', e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--at-success)' }} />
                <input value={it.item} onChange={e => setItem(i, 'item', e.target.value)} placeholder="Ítem de inspección" style={{ ...inputStyle, flex: '1 1 140px', width: 'auto', minWidth: 0, background: it.ok ? 'var(--at-success-tint)' : 'var(--at-surface)' }} />
                <input value={it.observacion} onChange={e => setItem(i, 'observacion', e.target.value)} placeholder="Observación" style={{ ...inputStyle, flex: '1 1 140px', width: 'auto', minWidth: 0 }} />
                <button type="button" onClick={() => removeItem(i)} aria-label="Quitar ítem" style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
              </div>
            ))}
          </div>
        </EditModal>
      )}

      {/* Detalle en ventana: a pantalla completa en el teléfono. */}
      {!showForm && selected && (() => {
        const s = ESTADO_STYLE[selected.estado]
        const done = selected.items.filter(i => i.ok).length
        const pct = selected.items.length > 0 ? Math.round(done / selected.items.length * 100) : 0
        return (
          <EditModal
            title={`${iconoArea(selected)} ${nombreArea(selected)}`}
            subtitle={<span style={{ display: 'inline-flex', gap: '6px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: 700, background: s.bg, color: s.color }}>{s.icon} {s.label}</span>
              {!selected.area_id && (
                <span title="Texto libre anterior al catálogo: edita el checklist y elige el área para vincularlo."
                  style={{ color: 'var(--at-warning-strong)', fontWeight: 600 }}>⚠ sin vincular</span>
              )}
              <span>{selected.fecha}{selected.inspector ? ` · Inspector: ${selected.inspector}` : ''}</span>
            </span>}
            maxWidth="680px"
            fullScreenOnMobile
            onClose={() => setSelectedId(null)}
            footer={<>
              {canDelete && <Button variant="outline-danger" onClick={() => handleDelete(selected)}>🗑 Eliminar</Button>}
              {canEdit && <Button variant="secondary" onClick={() => openEdit(selected)}>✏️ Editar</Button>}
            </>}
          >
            {selected.items.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '4px' }}>
                  <span>{done}/{selected.items.length} ítems completados</span>
                  <span style={{ fontWeight: 700, color: pct === 100 ? 'var(--at-success)' : 'var(--at-primary)' }}>{pct}%</span>
                </div>
                <div style={{ height: '8px', background: 'var(--at-line)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? 'var(--at-success)' : 'var(--at-primary)', transition: 'width 0.3s' }} />
                </div>
              </div>
            )}

            {selected.items.length === 0 && <div style={{ fontSize: '13px', color: 'var(--at-ink-3)', fontStyle: 'italic', marginBottom: '16px' }}>Sin ítems registrados.</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
              {selected.items.map((it, i) => (
                <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 12px', borderRadius: '8px', background: it.ok ? 'var(--at-success-tint)' : 'var(--at-surface)', border: `1px solid ${it.ok ? 'var(--at-success-border)' : 'var(--at-line)'}` }}>
                  {canEdit ? (
                    <input type="checkbox" aria-label={it.item} checked={it.ok} onChange={() => toggleItem(selected, i)} style={{ width: '16px', height: '16px', marginTop: '2px', cursor: 'pointer', accentColor: 'var(--at-success)', flexShrink: 0 }} />
                  ) : (
                    <span style={{ fontSize: '16px', flexShrink: 0 }}>{it.ok ? '✅' : '○'}</span>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: it.ok ? 'var(--at-success-strong)' : 'var(--at-ink-2)', textDecoration: it.ok ? 'line-through' : 'none' }}>{it.item}</div>
                    {it.observacion && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{it.observacion}</div>}
                  </div>
                </div>
              ))}
            </div>

            {selected.notas && (
              <div style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '12px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px' }}>Notas</div>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-2)' }}>{selected.notas}</p>
              </div>
            )}
          </EditModal>
        )
      })()}
    </div>
  )
}
