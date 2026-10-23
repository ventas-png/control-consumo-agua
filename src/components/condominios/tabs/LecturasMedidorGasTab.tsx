import { hoyLocalISO, mesLocalISO } from '../../../lib/format'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { createCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { LecturaMedidorGas, Unidad } from '../../../types'

interface Props {
  lecturas: LecturaMedidorGas[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

export default function LecturasMedidorGasTab({ lecturas, unidades, proyectoId, companyId, moneda, canCreate, onRefresh }: Props) {
  const [filtroUnidad, setFiltroUnidad] = useState('')
  const [filtroPeriodo, setFiltroPeriodo] = useState('')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detalleId, setDetalleId] = useState<string | null>(null)
  // La lectura anterior se propone con la última de esa unidad mientras el
  // usuario no la escriba él; si cambia de unidad, se vuelve a proponer.
  const [anteriorPropuesta, setAnteriorPropuesta] = useState(false)

  const periodos = [...new Set(lecturas.map(l => l.periodo).filter(Boolean))].sort().reverse() as string[]

  const [form, setForm] = useState({
    unidad_id: '', area: '',
    fecha: hoyLocalISO(),
    lectura_anterior: '', lectura_actual: '',
    costo_unitario: '', alerta_fuga: false,
    periodo: mesLocalISO(),
    leido_por: '', observaciones: '',
  })

  const lista = lecturas.filter(l =>
    (filtroUnidad === '' || l.unidad_id === filtroUnidad || (!l.unidad_id && filtroUnidad === 'area')) &&
    (filtroPeriodo === '' || l.periodo === filtroPeriodo)
  )

  const totalConsumo = lista.reduce((s, l) => s + (l.consumo ?? 0), 0)
  const totalCosto = lista.reduce((s, l) => s + (l.costo_total ?? 0), 0)
  const alertasFuga = lecturas.filter(l => l.alerta_fuga).length

  const consumoCalculado = form.lectura_actual && form.lectura_anterior
    ? Math.max(0, parseFloat(form.lectura_actual) - parseFloat(form.lectura_anterior))
    : null
  const actualMenor = form.lectura_actual !== '' && form.lectura_anterior !== ''
    && parseFloat(form.lectura_actual) < parseFloat(form.lectura_anterior)

  const nombreDe = (l: LecturaMedidorGas) => unidades.find(u => u.id === l.unidad_id)?.nombre ?? l.area ?? 'Área común'

  /** Última lectura registrada de una unidad (la más reciente por fecha). */
  function ultimaDe(unidadId: string): LecturaMedidorGas | undefined {
    if (!unidadId) return undefined
    return lecturas
      .filter(l => l.unidad_id === unidadId)
      .sort((a, b) => (b.fecha.localeCompare(a.fecha)) || (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
  }
  const ultima = ultimaDe(form.unidad_id)

  function elegirUnidad(unidadId: string) {
    const previa = ultimaDe(unidadId)
    setForm(p => {
      const proponer = p.lectura_anterior === '' || anteriorPropuesta
      return {
        ...p,
        unidad_id: unidadId,
        lectura_anterior: proponer ? (previa ? String(previa.lectura_actual) : '') : p.lectura_anterior,
      }
    })
    if (form.lectura_anterior === '' || anteriorPropuesta) setAnteriorPropuesta(!!previa)
  }

  // No se cierra a mitad del guardado: cerrar ahí escondería el error.
  const cerrarForm = () => { if (!saving) setMostrarForm(false) }

  async function guardar() {
    if (saving) return
    if (!form.lectura_actual) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'La lectura actual es obligatoria' }); return
    }
    if (!form.unidad_id && !form.area.trim()) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'Selecciona una unidad o especifica un área' }); return
    }
    const consumo = consumoCalculado
    const costo_total = consumo != null && form.costo_unitario ? consumo * parseFloat(form.costo_unitario) : null
    setSaving(true)
    const { error } = await createCondominioRow('lecturas_medidor_gas', {
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id || null,
      area: form.area.trim() || null,
      fecha: form.fecha,
      lectura_anterior: form.lectura_anterior ? parseFloat(form.lectura_anterior) : null,
      lectura_actual: parseFloat(form.lectura_actual),
      consumo,
      alerta_fuga: form.alerta_fuga,
      costo_unitario: form.costo_unitario ? parseFloat(form.costo_unitario) : null,
      costo_total,
      periodo: form.periodo || null,
      leido_por: form.leido_por.trim() || null,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm(p => ({ ...p, lectura_anterior: '', lectura_actual: '', alerta_fuga: false, observaciones: '' }))
    setAnteriorPropuesta(false)
    setMostrarForm(false)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', minWidth: 0, background: 'var(--at-surface)', color: 'var(--at-ink)' }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }
  const ayuda: CSSProperties = { fontSize: 11, color: 'var(--at-ink-3)', marginTop: 3 }

  // Se lee la fila vigente, no una copia.
  const detalle = detalleId ? lecturas.find(l => l.id === detalleId) ?? null : null

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs (dos por fila en el teléfono, por las reglas de .cond-panel) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <div style={{ background: 'var(--at-accent-tint)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--at-accent)' }}>{totalConsumo.toFixed(2)}</div>
          <div style={{ fontSize: 11, color: 'var(--at-accent)' }}>m³ consumo total</div>
        </div>
        <div style={{ background: 'var(--at-success-tint)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--at-success)', overflowWrap: 'anywhere' }}>{moneda}{' '}{totalCosto.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 11, color: 'var(--at-success)' }}>Costo total</div>
        </div>
        <div style={{ background: alertasFuga > 0 ? 'var(--at-danger-tint)' : 'var(--at-chip)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: alertasFuga > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>{alertasFuga}</div>
          <div style={{ fontSize: 11, color: alertasFuga > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>Alertas de fuga</div>
        </div>
        <div style={{ background: 'var(--at-surface-2)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--at-ink-2)' }}>{lecturas.length}</div>
          <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Lecturas registradas</div>
        </div>
      </div>

      {/* Alerta fugas */}
      {alertasFuga > 0 && (
        <div style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--at-danger)' }}>
          🚨 <strong>{alertasFuga} alerta{alertasFuga > 1 ? 's' : ''} de fuga detectada{alertasFuga > 1 ? 's' : ''}</strong> — revisar con urgencia
        </div>
      )}

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flex: '1 1 260px' }}>
          <select aria-label="Filtrar por unidad" style={{ ...inp, width: 'auto', flex: '1 1 140px' }} value={filtroUnidad} onChange={e => setFiltroUnidad(e.target.value)}>
            <option value="">Todas las unidades</option>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            <option value="area">Áreas comunes</option>
          </select>
          <select aria-label="Filtrar por período" style={{ ...inp, width: 'auto', flex: '1 1 140px' }} value={filtroPeriodo} onChange={e => setFiltroPeriodo(e.target.value)}>
            <option value="">Todos los períodos</option>
            {periodos.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <span style={{ fontSize: 13, color: 'var(--at-ink-3)' }}>{lista.length} lecturas</span>
        </div>
        {canCreate && (
          <Button variant="warning" onClick={() => setMostrarForm(true)}>+ Nueva lectura</Button>
        )}
      </div>

      {/* Nueva lectura en ventana (antes, un formulario fijo de tres columnas
          sobre la lista que en el teléfono dejaba campos de ~90px). */}
      {mostrarForm && (
        <EditModal
          title="🔥 Nueva lectura de gas"
          maxWidth="620px"
          fullScreenOnMobile
          onClose={cerrarForm}
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          footer={
            <>
              <Button variant="secondary" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
              <Button type="submit" form="gas-lectura-form" variant="success" loading={saving} loadingText="Guardando…">✅ Registrar</Button>
            </>
          }
        >
          <form
            id="gas-lectura-form"
            onSubmit={e => { e.preventDefault(); void guardar() }}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: 12, alignItems: 'start' }}
          >
            <div>
              <label htmlFor="gas-unidad" style={lbl}>Unidad</label>
              <select id="gas-unidad" style={inp} value={form.unidad_id} onChange={e => elegirUnidad(e.target.value)}>
                <option value="">— Área común —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            {!form.unidad_id && (
              <div>
                <label htmlFor="gas-area" style={lbl}>Área</label>
                <input id="gas-area" style={inp} placeholder="Cocina comunitaria…" value={form.area} onChange={e => setForm(p => ({ ...p, area: e.target.value }))} />
              </div>
            )}
            <div>
              <label htmlFor="gas-fecha" style={lbl}>Fecha</label>
              <input id="gas-fecha" type="date" style={inp} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="gas-periodo" style={lbl}>Período</label>
              <input id="gas-periodo" type="month" style={inp} placeholder="2026-04" value={form.periodo} onChange={e => setForm(p => ({ ...p, periodo: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="gas-anterior" style={lbl}>Lectura anterior (m³)</label>
              <input id="gas-anterior" type="number" inputMode="decimal" step="0.001" style={inp} value={form.lectura_anterior}
                onChange={e => { setAnteriorPropuesta(false); setForm(p => ({ ...p, lectura_anterior: e.target.value })) }} />
              {ultima && (
                <div style={ayuda}>Última: {ultima.lectura_actual.toFixed(3)} m³ ({ultima.fecha})</div>
              )}
            </div>
            <div>
              <label htmlFor="gas-actual" style={lbl}>Lectura actual (m³) *</label>
              <input id="gas-actual" type="number" inputMode="decimal" step="0.001" style={inp} value={form.lectura_actual} onChange={e => setForm(p => ({ ...p, lectura_actual: e.target.value }))} />
              {/* Junto al campo, para verlo mientras se escribe (en el teléfono
                  el final del formulario queda fuera de la pantalla). */}
              {actualMenor && (
                <div role="alert" style={{ fontSize: 11, color: 'var(--at-warning-strong, var(--at-warning))', background: 'var(--at-warning-tint)', borderRadius: 6, padding: '4px 8px', marginTop: 4 }}>
                  Es menor que la anterior: el consumo queda en 0. ¿Cambio de medidor?
                </div>
              )}
            </div>
            <div>
              <div style={lbl}>Consumo (m³)</div>
              <output aria-label="Consumo calculado" style={{ ...inp, display: 'block', background: 'var(--at-chip)', color: consumoCalculado != null ? 'var(--at-ink-2)' : 'var(--at-ink-3)' }}>
                {consumoCalculado != null ? `${consumoCalculado.toFixed(3)} m³` : 'Auto-calculado'}
              </output>
            </div>
            <div>
              <label htmlFor="gas-costo-unitario" style={lbl}>Costo unitario ({moneda}/m³)</label>
              <input id="gas-costo-unitario" type="number" inputMode="decimal" step="0.0001" style={inp} value={form.costo_unitario} onChange={e => setForm(p => ({ ...p, costo_unitario: e.target.value }))} />
            </div>
            {consumoCalculado != null && form.costo_unitario && (
              <div>
                <div style={lbl}>Costo total estimado</div>
                <div style={{ ...inp, background: 'var(--at-success-tint)', color: 'var(--at-success)', fontWeight: 600 }}>
                  {moneda} {(consumoCalculado * parseFloat(form.costo_unitario)).toFixed(2)}
                </div>
              </div>
            )}
            <div>
              <label htmlFor="gas-leido-por" style={lbl}>Leído por</label>
              <input id="gas-leido-por" style={inp} value={form.leido_por} onChange={e => setForm(p => ({ ...p, leido_por: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" id="fuga_check" checked={form.alerta_fuga} onChange={e => setForm(p => ({ ...p, alerta_fuga: e.target.checked }))} />
              <label htmlFor="fuga_check" style={{ fontSize: 13, cursor: 'pointer', color: form.alerta_fuga ? 'var(--at-danger)' : 'var(--at-ink-2)' }}>
                🚨 Alerta de fuga
              </label>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="gas-observaciones" style={lbl}>Observaciones</label>
              <textarea id="gas-observaciones" rows={2} style={{ ...inp, fontFamily: 'inherit', resize: 'vertical' }} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
            </div>
          </form>
        </EditModal>
      )}

      {/* Detalle de la lectura en ventana: antes las observaciones solo se
          veían como tooltip del 📝, que en el teléfono no existe. */}
      {detalle && (
        <EditModal
          title={`🔥 ${nombreDe(detalle)}`}
          subtitle={
            <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span>{detalle.fecha}{detalle.periodo ? ` · ${detalle.periodo}` : ''}</span>
              {detalle.alerta_fuga && (
                <span style={{ padding: '2px 8px', borderRadius: 10, background: 'var(--at-danger-tint)', color: 'var(--at-danger)', fontWeight: 600 }}>🚨 Alerta de fuga</span>
              )}
            </span>
          }
          maxWidth="480px"
          fullScreenOnMobile
          onClose={() => setDetalleId(null)}
          footer={<Button variant="secondary" onClick={() => setDetalleId(null)}>Cerrar</Button>}
        >
          <LecturaDetalle lectura={detalle} moneda={moneda} />
        </EditModal>
      )}

      {/* Tabla de lecturas — F3.9: migrado a <DataTable> shared. En el
          teléfono cada lectura es una tarjeta; tocarla abre su detalle y el
          botón «Ver» es el camino de teclado. */}
      <DataTable<LecturaMedidorGas>
        data={lista}
        rowKey="id"
        pageSize={30}
        mobileCardLayout
        searchableKeys={['area']}
        searchPlaceholder="Buscar área..."
        emptyState={{ icon: '🔥', title: 'Sin lecturas para los filtros seleccionados' }}
        defaultSort={{ key: 'fecha', direction: 'desc' }}
        rowStyle={(l) => l.alerta_fuga ? { background: 'var(--at-danger-tint)' } : {}}
        onRowClick={(l) => setDetalleId(l.id)}
        columns={[
          { key: 'unidad', header: 'Unidad/Área', sortable: true,
            accessor: (l) => unidades.find(u => u.id === l.unidad_id)?.nombre ?? l.area ?? '',
            render: (l) => (
              <span style={{ fontWeight: 600 }}>
                {l.alerta_fuga && <span style={{ color: 'var(--at-danger)', marginRight: 4 }}>🚨</span>}
                {nombreDe(l)}
              </span>
            ),
          },
          { key: 'periodo', header: 'Período', sortable: true, hideOnMobile: true, render: (l) => l.periodo ?? '—' },
          { key: 'fecha', header: 'Fecha', sortable: true },
          { key: 'lectura_anterior', header: 'Lect. ant.', align: 'right', hideOnMobile: true,
            render: (l) => l.lectura_anterior?.toFixed(3) ?? '—' },
          { key: 'lectura_actual', header: 'Lect. act.', align: 'right', render: (l) => l.lectura_actual.toFixed(3) },
          { key: 'consumo', header: 'Consumo', align: 'right', sortable: true,
            render: (l) => l.consumo != null
              ? <span style={{ color: 'var(--at-accent)', fontWeight: 600 }}>{l.consumo.toFixed(3)} m³</span>
              : '—' },
          { key: 'costo_total', header: 'Costo', align: 'right', sortable: true,
            render: (l) => l.costo_total != null
              ? <span style={{ color: 'var(--at-success)', fontWeight: 600 }}>{moneda} {l.costo_total.toFixed(2)}</span>
              : '—' },
          { key: 'ver', header: '', align: 'center',
            render: (l) => (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
                {l.observaciones && <span style={{ fontSize: 11, color: 'var(--at-ink-3)' }} aria-hidden="true">📝</span>}
                <Button size="sm" variant="secondary" onClick={() => setDetalleId(l.id)} aria-label={`Ver lectura de ${nombreDe(l)} del ${l.fecha}`}>Ver</Button>
              </span>
            ),
          },
        ] satisfies DataTableColumn<LecturaMedidorGas>[]}
      />
    </div>
  )
}

/** Detalle de solo lectura de una lectura de gas. */
function LecturaDetalle({ lectura: l, moneda }: { lectura: LecturaMedidorGas; moneda: string }) {
  const fila = (label: string, valor: ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid var(--at-chip)', fontSize: 14 }}>
      <span style={{ color: 'var(--at-ink-3)' }}>{label}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{valor}</span>
    </div>
  )
  return (
    <div>
      {l.alerta_fuga && (
        <div style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: 'var(--at-danger)' }}>
          🚨 Esta lectura se registró con alerta de fuga.
        </div>
      )}
      {fila('Fecha', l.fecha)}
      {fila('Período', l.periodo ?? '—')}
      {fila('Lectura anterior', l.lectura_anterior != null ? `${l.lectura_anterior.toFixed(3)} m³` : '—')}
      {fila('Lectura actual', `${l.lectura_actual.toFixed(3)} m³`)}
      {fila('Consumo', l.consumo != null ? <strong style={{ color: 'var(--at-accent)' }}>{l.consumo.toFixed(3)} m³</strong> : '—')}
      {fila('Costo unitario', l.costo_unitario != null ? `${moneda} ${l.costo_unitario}` : '—')}
      {fila('Costo total', l.costo_total != null ? <strong style={{ color: 'var(--at-success)' }}>{moneda} {l.costo_total.toFixed(2)}</strong> : '—')}
      {fila('Leído por', l.leido_por || '—')}
      {l.observaciones && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 4 }}>Observaciones</div>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>{l.observaciones}</p>
        </div>
      )}
    </div>
  )
}
