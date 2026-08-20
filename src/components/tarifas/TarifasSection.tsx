import { useState, type CSSProperties} from 'react'
import { confirm, notify } from '../shared/Dialog'
import type { Tarifa, Proyecto, TarifaTramo } from '../../types'
import { useSession } from '../shared/SessionContext'
import { usePermissionsContext } from '../shared/PermissionsContext'
import { createTarifa, updateTarifa, setTarifaActiva, deleteTarifa } from '../../domain/tarifas/mutations'
import { sanitizeInput, validateNumber } from '../../lib/validation'
import { validarTramos } from '../../lib/business'
import { EditModal } from '../shared/EditModal'
import { getEditedTagInfo } from '../../lib/timeUtils'
import { FacturacionConfigSection } from './FacturacionConfigSection'
import { diasHastaFechaCalendario } from '../../lib/format'

interface Props {
  tarifas: Tarifa[]
  proyectos: Proyecto[]
  moneda?: string
  onTarifaAdded: (tarifa: Tarifa) => void
  onTarifaUpdated: (id: string, partial: Partial<Tarifa>) => void
  onTarifaDeleted: (id: string) => void
}

const TIPOS_AGUA = [
  { value: 'potable', label: 'Potable' },
  { value: 'rehuso', label: 'Rehúso' },
  { value: 'piscina', label: 'Piscina' },
  { value: 'desalinada', label: 'Desalinada' },
  { value: 'riego', label: 'Riego' },
  { value: 'jacuzzi', label: 'Jacuzzi' },
  { value: 'consumo_humano', label: 'Consumo Humano' },
  { value: 'desmineralizada', label: 'Desmineralizada' },
  { value: 'residuales_tratadas', label: 'Residuales Tratadas' },
  { value: 'otra', label: 'Otra' },
]

const EMPTY_FORM = {
  nombre: '',
  tipo_agua: 'potable',
  precio_m3: '0.00',
  precio_m3_exceso: '0.0000',
  canon_fijo: '0.00',
  consumo_minimo: '0.0000',
  descripcion: '',
  activa: true,
  fecha_revision: '',
  project_id: '',
}

type FormState = typeof EMPTY_FORM

export function TarifasSection({
  tarifas,
  proyectos,
  moneda = 'Q',
  onTarifaAdded,
  onTarifaUpdated,
  onTarifaDeleted,
}: Props) {
  const currentUser = useSession()
  const perms = usePermissionsContext()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  // Tarifa escalonada (P1): bloques por m³. `bloques` guarda los inputs como
  // strings; el `desde` se deriva (0, o el `hasta` del bloque previo) y el ÚLTIMO
  // bloque llega a ∞ (hasta = null). Si `escalonada` está off → tramos = null.
  const [escalonada, setEscalonada] = useState(false)
  const [bloques, setBloques] = useState<{ hasta: string; precio: string }[]>([{ hasta: '', precio: '0.0000' }])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  // Sub-vista: tabla de tarifas vs. configuración de facturación (IVA/mora, T4).
  const [view, setView] = useState<'tarifas' | 'facturacion'>('tarifas')

  const canCreate = perms.canCreate('tarifas') && currentUser.role !== 'viewer'
  const canEdit = perms.canEdit('tarifas') && currentUser.role !== 'viewer'
  const canDelete = perms.canDelete('tarifas') && currentUser.role !== 'viewer'

  const EMPTY_BLOQUES = [{ hasta: '', precio: '0.0000' }]

  /** Construye los tramos canónicos desde los inputs: `desde` derivado, último ∞. */
  function construirTramos(): TarifaTramo[] {
    let desde = 0
    return bloques.map((b, i) => {
      const esUltimo = i === bloques.length - 1
      const hasta = esUltimo ? null : (parseFloat(b.hasta) || 0)
      const tramo: TarifaTramo = { desde_m3: desde, hasta_m3: hasta, precio_m3: parseFloat(b.precio) || 0 }
      if (hasta != null) desde = hasta
      return tramo
    })
  }

  function startCreate() {
    setForm(EMPTY_FORM)
    setEscalonada(false)
    setBloques(EMPTY_BLOQUES)
    setEditingId(null)
    setIsModalOpen(true)
  }

  function startEdit(t: Tarifa) {
    setForm({
      nombre: t.nombre,
      tipo_agua: t.tipo_agua,
      precio_m3: String(t.precio_m3),
      precio_m3_exceso: String(t.precio_m3_exceso ?? 0),
      canon_fijo: String(t.canon_fijo),
      consumo_minimo: String(t.consumo_minimo ?? 0),
      descripcion: t.descripcion ?? '',
      activa: t.activa,
      fecha_revision: t.fecha_revision ?? '',
      project_id: t.project_id ?? '',
    })
    const tr = t.tramos ?? []
    setEscalonada(tr.length > 0)
    setBloques(tr.length > 0
      ? tr.map(b => ({ hasta: b.hasta_m3 == null ? '' : String(b.hasta_m3), precio: String(b.precio_m3) }))
      : EMPTY_BLOQUES)
    setEditingId(t.id)
    setIsModalOpen(true)
  }

  function cancelForm() {
    setIsModalOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setEscalonada(false)
    setBloques(EMPTY_BLOQUES)
  }

  async function handleGuardar() {
    const nombre = sanitizeInput(form.nombre)
    const precio_m3 = parseFloat(form.precio_m3)
    const precio_m3_exceso = parseFloat(form.precio_m3_exceso)
    const canon_fijo = parseFloat(form.canon_fijo)
    const consumo_minimo = parseFloat(form.consumo_minimo)

    const errors: string[] = []
    if (!nombre || nombre.length < 2) errors.push('Nombre debe tener al menos 2 caracteres')
    if (!validateNumber(precio_m3, 0, 99999)) errors.push('Precio por m³ debe ser un valor entre 0 y 99999')
    if (!validateNumber(precio_m3_exceso, 0, 99999)) errors.push('Precio por m³ exceso debe ser un valor entre 0 y 99999')
    if (!validateNumber(canon_fijo, 0, 99999)) errors.push('Canon fijo debe ser un valor entre 0 y 99999')
    if (!validateNumber(consumo_minimo, 0, 99999)) errors.push('Consumo mínimo debe ser un valor entre 0 y 99999')

    // Tarifa escalonada: valida los bloques (contiguos desde 0, último ∞). Si está
    // apagada, tramos = null → se guarda/limpia y el cobro usa el modelo plano.
    let tramosPayload: TarifaTramo[] | null = null
    if (escalonada) {
      const tramos = construirTramos()
      const errTramos = validarTramos(tramos)
      if (errTramos) errors.push(errTramos)
      else tramosPayload = tramos
    }

    if (errors.length > 0) {
      notify({ variant: 'error', title: 'Error de validación', text: errors.join('<br>') })
      return
    }

    setLoading(true)

    if (editingId) {
      const { data, error } = await updateTarifa(editingId, {
        nombre,
        tipo_agua: form.tipo_agua,
        precio_m3,
        precio_m3_exceso,
        canon_fijo,
        consumo_minimo,
        tramos: tramosPayload,
        descripcion: form.descripcion || null,
        activa: true,
        fecha_revision: form.fecha_revision || null,
        updated_at: new Date().toISOString(),
        updated_by: currentUser.user_id,
        updated_by_name: currentUser.name || currentUser.email,
      })

      if (!error && data) {
        onTarifaUpdated(editingId, data as Tarifa)
        cancelForm()
        notify({ variant: 'success', title: 'Tarifa actualizada', duration: 1800 })
      } else {
        notify({ variant: 'error', title: 'Error', text: error ?? 'No se pudo actualizar la tarifa.' })
      }
    } else {
      // Derive project_id from the explicitly selected project in the form.
      const selectedProyecto = proyectos.find(p => p.id === form.project_id)
      const projectId: string | null = selectedProyecto?.id ?? null
      const companyId: string | null = currentUser.company_id ?? null

      if (!projectId || !companyId) {
        notify({ variant: 'error', title: 'Error', text: 'Debes seleccionar un proyecto para la tarifa.' })
        setLoading(false)
        return
      }

      const { data, error } = await createTarifa({
        nombre,
        tipo_agua: form.tipo_agua,
        precio_m3,
        precio_m3_exceso,
        canon_fijo,
        consumo_minimo,
        tramos: tramosPayload,
        descripcion: form.descripcion || null,
        activa: form.activa,
        fecha_revision: form.fecha_revision || null,
        project_id: projectId,
        company_id: companyId,
      })

      if (!error && data) {
        onTarifaAdded(data as Tarifa)
        cancelForm()
        notify({ variant: 'success', title: 'Tarifa creada', duration: 1800 })
      } else {
        notify({ variant: 'error', title: 'Error', text: error ?? 'No se pudo guardar la tarifa.' })
      }
    }

    setLoading(false)
  }

  async function handleToggleActiva(t: Tarifa) {
    const { error } = await setTarifaActiva(t.id, !t.activa)

    if (!error) {
      onTarifaUpdated(t.id, { activa: !t.activa })
    } else {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo cambiar el estado.' })
    }
  }

  async function handleEliminar(t: Tarifa) {
    const result = await confirm({
      title: '¿Eliminar tarifa?',
      text: `${t.nombre} será eliminada permanentemente.`,
      icon: 'warning',
      variant: 'danger',
      confirmText: 'Sí, eliminar',
    })

    if (!result.isConfirmed) return

    const { error } = await deleteTarifa(t.id)
    if (!error) {
      onTarifaDeleted(t.id)
      notify({ variant: 'success', title: 'Tarifa eliminada', duration: 1500 })
    } else {
      notify({ variant: 'error', title: 'Error', text: error ?? 'No se pudo eliminar la tarifa.' })
    }
  }

  const filtered = tarifas.filter(t =>
    t.nombre.toLowerCase().includes(search.toLowerCase()) ||
    t.tipo_agua.toLowerCase().includes(search.toLowerCase())
  )

  const tipoLabel = (value: string) =>
    TIPOS_AGUA.find(t => t.value === value)?.label ?? value

  function getRevisionStatus(t: Tarifa): 'expired' | 'soon' | 'ok' | 'none' {
    const diff = diasHastaFechaCalendario(t.fecha_revision)
    if (diff === null) return 'none'
    if (diff < 0) return 'expired'
    if (diff <= 30) return 'soon'
    return 'ok'
  }

  const inputStyle: CSSProperties = {
    padding: '10px 14px',
    border: '2px solid var(--at-line)',
    borderRadius: '8px',
    fontSize: '14px',
    width: '100%',
    boxSizing: 'border-box',
    outline: 'none',
  }
  const labelStyle: CSSProperties = {
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--at-ink-2)',
    marginBottom: '5px',
    display: 'block',
  }

  return (
    <div>
      {/* Sub-tabs: tarifas vs. configuración de facturación (IVA / mora). */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '2px solid var(--at-line)', marginBottom: '24px' }}>
        {([['tarifas', '💧 Tarifas'], ['facturacion', '🧾 Facturación (IVA / Mora)']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setView(id)}
            style={{
              padding: '10px 20px', fontSize: '14px', fontWeight: view === id ? 700 : 500,
              color: view === id ? 'var(--at-primary)' : 'var(--at-ink-3)',
              background: 'transparent', border: 'none',
              borderBottom: view === id ? '3px solid var(--at-primary)' : '3px solid transparent',
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'facturacion' ? (
        <FacturacionConfigSection proyectos={proyectos} moneda={moneda} />
      ) : (
      <>
      {/* Header + search */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--at-ink)' }}>Tarifas Vigentes</h2>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--at-ink-3)' }}>
            Gestiona las tarifas de consumo por tipo de agua
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Buscar tarifa..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, width: '220px' }}
          />
          {canCreate && (
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
              + Nueva Tarifa
            </button>
          )}
        </div>
      </div>

      {/* Form Modal */}
      {isModalOpen && canEdit && (
        <EditModal title={editingId ? 'Editar Tarifa' : 'Nueva Tarifa'} onClose={cancelForm}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            <div>
              <label style={labelStyle}>Nombre *</label>
              <input
                style={inputStyle}
                value={form.nombre}
                onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej: Tarifa Residencial"
                maxLength={100}
              />
            </div>
            {!editingId && (
              <div>
                <label style={labelStyle}>Proyecto *</label>
                <select
                  style={inputStyle}
                  value={form.project_id}
                  onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}
                >
                  <option value="">-- Seleccionar proyecto --</option>
                  {proyectos.map(p => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label style={labelStyle}>Tipo de Agua *</label>
              <select
                style={inputStyle}
                value={form.tipo_agua}
                onChange={e => setForm(f => ({ ...f, tipo_agua: e.target.value }))}
              >
                {TIPOS_AGUA.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Precio por m³ *</label>
              <input
                style={inputStyle}
                type="number"
                min="0"
                step="0.0001"
                value={form.precio_m3}
                onChange={e => setForm(f => ({ ...f, precio_m3: e.target.value }))}
                placeholder="0.0000"
              />
            </div>
            <div>
              <label style={labelStyle}>Precio por m³ exceso</label>
              <input
                style={inputStyle}
                type="number"
                min="0"
                step="0.0001"
                value={form.precio_m3_exceso}
                onChange={e => setForm(f => ({ ...f, precio_m3_exceso: e.target.value }))}
                placeholder="0.0000"
              />
              <span style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '4px', display: 'block' }}>
                Precio diferenciado para consumo que exceda el mínimo
              </span>
            </div>
            <div>
              <label style={labelStyle}>Canon Fijo (mensual)</label>
              <input
                style={inputStyle}
                type="number"
                min="0"
                step="0.01"
                value={form.canon_fijo}
                onChange={e => setForm(f => ({ ...f, canon_fijo: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div>
              <label style={labelStyle}>Consumo Mínimo (m³)</label>
              <input
                style={inputStyle}
                type="number"
                min="0"
                step="0.0001"
                value={form.consumo_minimo}
                onChange={e => setForm(f => ({ ...f, consumo_minimo: e.target.value }))}
                placeholder="0.0000"
              />
              <span style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '4px', display: 'block' }}>
                Si consumo ≤ este valor, se cobra solo el canon fijo
              </span>
            </div>
            <div style={{ gridColumn: '1 / -1', background: 'var(--at-surface-2)', borderRadius: '8px', padding: '14px 16px', border: '1px solid var(--at-line)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600, color: 'var(--at-ink)', fontSize: '13px' }}>
                <input type="checkbox" checked={escalonada} onChange={e => setEscalonada(e.target.checked)} />
                Tarifa escalonada por bloques
              </label>
              {escalonada && (
                <div style={{ marginTop: '12px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--at-ink-3)', display: 'block', marginBottom: '10px' }}>
                    Reemplaza el precio por m³ y el exceso. Cada bloque cobra el consumo dentro de su rango; el último llega a ∞. El canon fijo y el consumo mínimo siguen aplicando como piso.
                  </span>
                  {bloques.map((b, i) => {
                    const desde = i === 0 ? 0 : (parseFloat(bloques[i - 1].hasta) || 0)
                    const esUltimo = i === bloques.length - 1
                    return (
                      <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12px', color: 'var(--at-ink-2)', minWidth: '58px' }}>De {desde} m³</span>
                        {esUltimo ? (
                          <span style={{ fontSize: '13px', color: 'var(--at-ink-2)', minWidth: '92px' }}>a ∞</span>
                        ) : (
                          <input
                            style={{ ...inputStyle, width: '92px' }}
                            type="number"
                            min="0"
                            step="0.0001"
                            value={b.hasta}
                            placeholder="hasta"
                            onChange={e => setBloques(bs => bs.map((x, j) => (j === i ? { ...x, hasta: e.target.value } : x)))}
                          />
                        )}
                        <input
                          style={{ ...inputStyle, width: '110px' }}
                          type="number"
                          min="0"
                          step="0.0001"
                          value={b.precio}
                          placeholder="precio"
                          onChange={e => setBloques(bs => bs.map((x, j) => (j === i ? { ...x, precio: e.target.value } : x)))}
                        />
                        <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{moneda}/m³</span>
                        {bloques.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setBloques(bs => bs.filter((_, j) => j !== i))}
                            style={{ background: 'none', border: 'none', color: 'var(--at-danger)', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}
                            aria-label="Quitar bloque"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    )
                  })}
                  <button
                    type="button"
                    onClick={() => setBloques(bs => {
                      const ultimoIdx = bs.length - 1
                      const desdeUltimo = ultimoIdx === 0 ? 0 : (parseFloat(bs[ultimoIdx - 1].hasta) || 0)
                      // El bloque que era ∞ toma un tope por defecto (desde + 10) para que
                      // el nuevo bloque quede después; el usuario puede ajustarlo.
                      const conTope = bs.map((x, j) => (j === ultimoIdx && !x.hasta ? { ...x, hasta: String(desdeUltimo + 10) } : x))
                      return [...conTope, { hasta: '', precio: bs[ultimoIdx]?.precio ?? '0.0000' }]
                    })}
                    style={{ marginTop: '4px', fontSize: '13px', color: 'var(--at-primary)', background: 'none', border: '1px dashed var(--at-primary)', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
                  >
                    + Agregar bloque
                  </button>
                </div>
              )}
            </div>
            <div style={{ gridColumn: '1 / -1', background: 'var(--at-surface-2)', borderRadius: '8px', padding: '14px 16px', border: '1px solid var(--at-line)' }}>
              <label style={{ ...labelStyle, color: 'var(--at-ink)' }}>Fecha de Revisión</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <input
                  style={{ ...inputStyle, width: 'auto', minWidth: '180px', background: 'var(--at-surface)' }}
                  type="date"
                  value={form.fecha_revision}
                  onChange={e => setForm(f => ({ ...f, fecha_revision: e.target.value }))}
                />
                {form.fecha_revision && (
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, fecha_revision: '' }))}
                    style={{ fontSize: '12px', color: 'var(--at-ink-3)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Quitar fecha
                  </button>
                )}
                <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>
                  Si la fecha pasa sin renovar, la tarifa se desactivará automáticamente
                </span>
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Descripción</label>
              <textarea
                style={{ ...inputStyle, minHeight: '70px', resize: 'vertical' }}
                value={form.descripcion}
                onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                placeholder="Descripción opcional de la tarifa..."
                maxLength={500}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Estado:</label>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, activa: !f.activa }))}
                style={{
                  padding: '6px 16px',
                  borderRadius: '20px',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '13px',
                  background: form.activa ? 'var(--at-success-tint)' : 'var(--at-danger-tint)',
                  color: form.activa ? 'var(--at-success-strong)' : 'var(--at-danger-strong)',
                }}
              >
                {form.activa ? 'Activa' : 'Inactiva'}
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={handleGuardar}
              disabled={loading}
              style={{
                padding: '10px 24px',
                background: loading ? 'var(--at-ink-3)' : 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
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
                background: 'var(--at-chip)',
                color: 'var(--at-ink-2)',
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
        </EditModal>
      )}

      {/* Table */}
      <div style={{ background: 'var(--at-surface)', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: 'var(--at-ink-3)' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>💰</div>
            <div style={{ fontWeight: 600, fontSize: '16px', marginBottom: '6px' }}>
              {search ? 'Sin resultados' : 'No hay tarifas registradas'}
            </div>
            <div style={{ fontSize: '14px' }}>
              {search ? 'Intenta con otro término de búsqueda' : canCreate ? 'Crea la primera tarifa con el botón "+  Nueva Tarifa"' : 'No hay tarifas configuradas aún'}
            </div>
          </div>
        ) : (
          <div className="table-scroll-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ background: 'var(--at-surface-2)', borderBottom: '2px solid var(--at-line)' }}>
                  <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: 'var(--at-ink-2)' }}>Nombre</th>
                  <th scope="col" style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 700, color: 'var(--at-ink-2)' }}>Tipo de Agua</th>
                  <th scope="col" style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--at-ink-2)' }}>Precio/m³</th>
                  <th scope="col" style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--at-ink-2)' }}>Precio Exceso/m³</th>
                  <th scope="col" style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--at-ink-2)' }}>Canon Fijo</th>
                  <th scope="col" style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--at-ink-2)' }}>Cons. Mínimo</th>
                  <th scope="col" style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: 'var(--at-ink-2)' }}>Estado</th>
                  <th scope="col" style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: 'var(--at-ink-2)' }}>Revisión</th>
                  {(canEdit || canDelete) && (
                    <th scope="col" style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: 'var(--at-ink-2)' }}>Acciones</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t, idx) => (
                  <tr
                    key={t.id}
                    style={{ borderBottom: '1px solid var(--at-chip)', background: idx % 2 === 0 ? 'var(--at-surface)' : 'var(--at-surface-2)' }}
                  >
                    <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--at-ink)' }}>
                      {t.nombre}
                      {t.descripcion && (
                        <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', fontWeight: 400, marginTop: '2px' }}>
                          {t.descripcion}
                        </div>
                      )}
                      {(() => {
                        const tag = getEditedTagInfo(t.updated_at, t.updated_by_name)
                        if (!tag) return null
                        return (
                          <span
                            title={tag.tooltip}
                            style={{
                              display: 'inline-block',
                              marginTop: '4px',
                              padding: '2px 8px',
                              borderRadius: '10px',
                              fontSize: '11px',
                              fontWeight: 500,
                              color: tag.color,
                              background: tag.bg,
                              cursor: 'default',
                            }}
                          >
                            {tag.label}
                          </span>
                        )
                      })()}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        padding: '3px 10px',
                        borderRadius: '12px',
                        background: 'var(--at-primary-soft)',
                        color: 'var(--at-primary-hover)',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}>
                        {tipoLabel(t.tipo_agua)}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: 'var(--at-ink)' }}>
                      {moneda} {Number(t.precio_m3).toFixed(4)}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--at-ink-2)' }}>
                      {Number(t.precio_m3_exceso ?? 0) > 0
                        ? `${moneda} ${Number(t.precio_m3_exceso).toFixed(4)}`
                        : '—'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--at-ink-2)' }}>
                      {moneda} {Number(t.canon_fijo).toFixed(2)}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--at-ink-2)' }}>
                      {Number(t.consumo_minimo ?? 0).toFixed(4)} m³
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      {canEdit ? (
                        <button
                          onClick={() => handleToggleActiva(t)}
                          title="Clic para cambiar estado"
                          style={{
                            padding: '4px 14px',
                            borderRadius: '20px',
                            border: 'none',
                            cursor: 'pointer',
                            fontWeight: 600,
                            fontSize: '12px',
                            background: t.activa ? 'var(--at-success-tint)' : 'var(--at-danger-tint)',
                            color: t.activa ? 'var(--at-success-strong)' : 'var(--at-danger-strong)',
                          }}
                        >
                          {t.activa ? 'Activa' : 'Inactiva'}
                        </button>
                      ) : (
                        <span style={{
                          padding: '4px 14px',
                          borderRadius: '20px',
                          fontWeight: 600,
                          fontSize: '12px',
                          background: t.activa ? 'var(--at-success-tint)' : 'var(--at-danger-tint)',
                          color: t.activa ? 'var(--at-success-strong)' : 'var(--at-danger-strong)',
                        }}>
                          {t.activa ? 'Activa' : 'Inactiva'}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      {(() => {
                        const status = getRevisionStatus(t)
                        if (status === 'none') return <span style={{ color: 'var(--at-ink-3)', fontSize: '12px' }}>—</span>
                        const cfg = {
                          expired: { bg: 'var(--at-danger-tint)', color: 'var(--at-danger-strong)', prefix: 'Vencida: ' },
                          soon:    { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', prefix: 'Próxima: ' },
                          ok:      { bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)', prefix: '' },
                        }[status]
                        return (
                          <span style={{
                            padding: '3px 8px', borderRadius: '10px', fontSize: '11px',
                            fontWeight: 600, background: cfg.bg, color: cfg.color,
                            whiteSpace: 'nowrap',
                          }}>
                            {cfg.prefix}{t.fecha_revision}
                          </span>
                        )
                      })()}
                    </td>
                    {(canEdit || canDelete) && (
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          {canEdit && (
                            <button
                              onClick={() => startEdit(t)}
                              style={{
                                padding: '5px 12px',
                                background: 'var(--at-primary-tint)',
                                color: 'var(--at-primary-hover)',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: '12px',
                              }}
                            >
                              Editar
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => handleEliminar(t)}
                              style={{
                                padding: '5px 12px',
                                background: 'var(--at-danger-tint)',
                                color: 'var(--at-danger)',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: '12px',
                              }}
                            >
                              Eliminar
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--at-chip)', color: 'var(--at-ink-3)', fontSize: '12px' }}>
          {filtered.length} tarifa{filtered.length !== 1 ? 's' : ''} {search ? 'encontradas' : 'registradas'}
        </div>
      </div>
      </>
      )}
    </div>
  )
}
