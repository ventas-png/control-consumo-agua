import { hoyLocalISO, esFechaCalendarioVencida, formatNumber } from '../../../lib/format'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { MantenimientoJardineria, TipoJardineria, EstadoJardineria } from '../../../types'

interface Props {
  registros: MantenimientoJardineria[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPOS: { value: TipoJardineria; label: string; icon: string; color: string }[] = [
  { value: 'mantenimiento_general', label: 'Mant. general', icon: '🌿', color: 'var(--at-success)' },
  { value: 'poda',                  label: 'Poda',          icon: '✂️', color: 'var(--at-accent)' },
  { value: 'fumigacion',            label: 'Fumigación',    icon: '🧪', color: 'var(--at-warning)' },
  { value: 'siembra',               label: 'Siembra',       icon: '🌱', color: 'var(--at-success)' },
  { value: 'riego',                 label: 'Riego',         icon: '💧', color: 'var(--at-accent-2)' },
  { value: 'limpieza',              label: 'Limpieza',      icon: '🧹', color: 'var(--at-accent)' },
  { value: 'otro',                  label: 'Otro',          icon: '📋', color: 'var(--at-ink-3)' },
]

const ESTADOS: { value: EstadoJardineria; label: string; color: string; bg: string }[] = [
  { value: 'programado',  label: 'Programado', color: 'var(--at-accent)', bg: 'var(--at-accent-tint)' },
  { value: 'en_proceso',  label: 'En proceso', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  { value: 'completado',  label: 'Completado', color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  { value: 'cancelado',   label: 'Cancelado',  color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
]

const AREAS_COMUNES = ['Jardín principal', 'Jardín lateral', 'Área de piscina', 'Acceso vehicular', 'Acceso peatonal', 'Área de juegos', 'Área BBQ', 'Estacionamiento', 'Perímetro', 'Terraza']

const formVacio = () => ({
  fecha: hoyLocalISO(),
  tipo: 'mantenimiento_general' as TipoJardineria,
  areas: [] as string[],
  proveedor: '', trabajadores: '', horas_trabajo: '',
  insumos: '', costo: '', estado: 'completado' as EstadoJardineria,
  proxima_visita: '', observaciones: '',
})

const tipoDe = (t: TipoJardineria) => TIPOS.find(x => x.value === t)
const estadoDe = (e: EstadoJardineria) => ESTADOS.find(x => x.value === e)

function EstadoBadge({ estado }: { estado: EstadoJardineria }) {
  const est = estadoDe(estado)
  return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: est?.bg, color: est?.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{est?.label ?? estado}</span>
}

export default function MantenimientoJardineriaTab({ registros, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cambiando, setCambiando] = useState(false)
  const [filtroTipo, setFiltroTipo] = useState<TipoJardineria | ''>('')
  const [filtroEstado, setFiltroEstado] = useState<EstadoJardineria | ''>('')
  const [areaCustom, setAreaCustom] = useState('')

  const [form, setForm] = useState(formVacio)

  const lista = registros.filter(r =>
    (filtroTipo === '' || r.tipo === filtroTipo) &&
    (filtroEstado === '' || r.estado === filtroEstado)
  )

  const totalCosto = registros.filter(r => r.estado === 'completado' && r.costo).reduce((s, r) => s + (r.costo ?? 0), 0)
  const proximos = registros.filter(r => r.proxima_visita && !esFechaCalendarioVencida(r.proxima_visita)).sort((a, b) => a.proxima_visita!.localeCompare(b.proxima_visita!))

  // Montos con el formato regional de la app (antes, el del navegador y sin decimales fijos).
  const dinero = (v: number) => `${moneda}\u00a0${formatNumber(v, 2)}`

  function toggleArea(area: string) {
    setForm(p => ({
      ...p,
      areas: p.areas.includes(area) ? p.areas.filter(a => a !== area) : [...p.areas, area],
    }))
  }

  function agregarAreaCustom() {
    const a = areaCustom.trim()
    if (!a || form.areas.includes(a)) return
    setForm(p => ({ ...p, areas: [...p.areas, a] }))
    setAreaCustom('')
  }

  // Las áreas propias se agregaban pero no se veían: ni para confirmar ni para quitarlas.
  const areasOfrecidas = [...AREAS_COMUNES, ...form.areas.filter(a => !AREAS_COMUNES.includes(a))]

  function abrirForm() {
    setDetalleId(null)
    setMostrarForm(true)
  }

  // No se cierra a mitad del guardado: cerrar ahí escondería el error.
  const cerrarForm = () => { if (!saving) setMostrarForm(false) }

  async function guardar() {
    if (saving) return
    if (!form.fecha || form.areas.length === 0) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'Fecha y al menos un área son obligatorios' }); return
    }
    setSaving(true)
    const { error } = await createCondominioRow('mantenimiento_jardineria', {
      company_id: companyId, project_id: proyectoId,
      fecha: form.fecha, tipo: form.tipo, areas: form.areas,
      proveedor: form.proveedor.trim() || null,
      trabajadores: form.trabajadores ? parseInt(form.trabajadores) : null,
      horas_trabajo: form.horas_trabajo ? parseFloat(form.horas_trabajo) : null,
      insumos: form.insumos.trim() || null,
      costo: form.costo ? parseFloat(form.costo) : null,
      estado: form.estado,
      proxima_visita: form.proxima_visita || null,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm(formVacio())
    setAreaCustom('')
    setMostrarForm(false)
    onRefresh()
  }

  async function cambiarEstado(r: MantenimientoJardineria, estado: EstadoJardineria) {
    if (cambiando) return
    setCambiando(true)
    const { error } = await updateCondominioRow('mantenimiento_jardineria', r.id, { estado })
    setCambiando(false)
    // Antes el error se ignoraba: el botón no hacía nada y no decía por qué.
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', minWidth: 0, background: 'var(--at-surface)', color: 'var(--at-ink)' }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  // Se lee el registro vigente, no una copia (antes el panel guardaba la fila
  // y había que parcharla a mano al cambiar el estado).
  const detalle = detalleId ? registros.find(r => r.id === detalleId) ?? null : null

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs: dos por fila en el teléfono */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: 12, marginBottom: 16 }}>
        <div style={{ background: 'var(--at-success-tint)', borderRadius: 10, padding: '12px 16px', minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--at-success)' }}>Costo total (completados)</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--at-success)', overflowWrap: 'anywhere' }}>{dinero(totalCosto)}</div>
        </div>
        <div style={{ background: 'var(--at-accent-tint)', borderRadius: 10, padding: '12px 16px', minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--at-accent)' }}>Total registros</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--at-accent)' }}>{registros.length}</div>
        </div>
      </div>

      {/* Próximas visitas: cada una abre su registro */}
      {proximos.length > 0 && (
        <div style={{ background: 'var(--at-success-tint)', border: '1px solid var(--at-success-border)', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--at-success)', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase' }}>📅 Próximas visitas</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
            {proximos.slice(0, 3).map(r => {
              const tipo = tipoDe(r.tipo)
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => setDetalleId(r.id)} className="cond-barra-fila"
                    style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', borderRadius: 6, padding: '4px 6px', font: 'inherit', fontSize: 13, color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                    {tipo?.icon} <strong>{r.proxima_visita}</strong> · {tipo?.label}
                    {r.proveedor && <span style={{ color: 'var(--at-ink-3)' }}> · {r.proveedor}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flex: '1 1 260px' }}>
          <select aria-label="Filtrar por tipo" style={{ ...inp, width: 'auto', flex: '1 1 170px' }} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as TipoJardineria | '')}>
            <option value="">Todos los tipos</option>
            {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
          </select>
          <select aria-label="Filtrar por estado" style={{ ...inp, width: 'auto', flex: '1 1 170px' }} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as EstadoJardineria | '')}>
            <option value="">Todos los estados</option>
            {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
          <span style={{ fontSize: 13, color: 'var(--at-ink-3)' }}>{lista.length} registros</span>
        </div>
        {canCreate && (
          <Button variant="success" onClick={abrirForm}>+ Nuevo servicio</Button>
        )}
      </div>

      {/* Nuevo servicio en ventana (antes, en un panel al lado de una lista de
          300px fijos: en el teléfono no cabían los dos). */}
      {mostrarForm && (
        <EditModal
          title="🌿 Nuevo servicio de jardinería"
          maxWidth="640px"
          fullScreenOnMobile
          onClose={cerrarForm}
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          footer={
            <>
              <Button variant="secondary" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
              <Button type="submit" form="jardineria-form" variant="success" loading={saving} loadingText="Guardando…">✅ Registrar</Button>
            </>
          }
        >
          <form
            id="jardineria-form"
            onSubmit={e => { e.preventDefault(); void guardar() }}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 12, alignItems: 'start' }}
          >
            <div>
              <label htmlFor="jardineria-fecha" style={lbl}>Fecha *</label>
              <input id="jardineria-fecha" type="date" style={inp} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="jardineria-tipo" style={lbl}>Tipo</label>
              <select id="jardineria-tipo" style={inp} value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value as TipoJardineria }))}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="jardineria-estado" style={lbl}>Estado</label>
              <select id="jardineria-estado" style={inp} value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value as EstadoJardineria }))}>
                {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="jardineria-proveedor" style={lbl}>Proveedor</label>
              <input id="jardineria-proveedor" style={inp} placeholder="Empresa o persona" value={form.proveedor} onChange={e => setForm(p => ({ ...p, proveedor: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="jardineria-trabajadores" style={lbl}>Trabajadores</label>
              <input id="jardineria-trabajadores" type="number" inputMode="numeric" min="0" step="1" style={inp} value={form.trabajadores} onChange={e => setForm(p => ({ ...p, trabajadores: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="jardineria-horas" style={lbl}>Horas trabajo</label>
              {/* Un decimal, como la columna (numeric(5,1)). */}
              <input id="jardineria-horas" type="number" inputMode="decimal" min="0" step="0.1" style={inp} value={form.horas_trabajo} onChange={e => setForm(p => ({ ...p, horas_trabajo: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="jardineria-costo" style={lbl}>Costo ({moneda})</label>
              <input id="jardineria-costo" type="number" inputMode="decimal" min="0" step="0.01" style={inp} value={form.costo} onChange={e => setForm(p => ({ ...p, costo: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="jardineria-proxima" style={lbl}>Próxima visita</label>
              <input id="jardineria-proxima" type="date" min={form.fecha || undefined} style={inp} value={form.proxima_visita} onChange={e => setForm(p => ({ ...p, proxima_visita: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="jardineria-insumos" style={lbl}>Insumos usados</label>
              <input id="jardineria-insumos" style={inp} placeholder="Fertilizante, herbicida…" value={form.insumos} onChange={e => setForm(p => ({ ...p, insumos: e.target.value }))} />
            </div>
            <fieldset style={{ gridColumn: '1 / -1', border: 'none', margin: 0, padding: 0, minWidth: 0 }}>
              <legend style={{ ...lbl, padding: 0 }}>Áreas tratadas *</legend>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {areasOfrecidas.map(a => {
                  const activa = form.areas.includes(a)
                  return (
                    <button key={a} type="button" aria-pressed={activa} onClick={() => toggleArea(a)}
                      style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid', fontSize: 12, cursor: 'pointer', background: activa ? 'var(--at-success)' : 'var(--at-surface)', color: activa ? 'var(--at-on-status)' : 'var(--at-ink-2)', borderColor: activa ? 'var(--at-success)' : 'var(--at-line-strong)' }}>
                      {activa ? '✓ ' : ''}{a}
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input aria-label="Agregar área personalizada" style={{ ...inp, flex: 1 }} placeholder="Agregar área personalizada" value={areaCustom} onChange={e => setAreaCustom(e.target.value)}
                  // Enter agrega el área (sin esto, dentro del formulario lo registraría).
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregarAreaCustom() } }} />
                <Button type="button" variant="secondary" onClick={agregarAreaCustom} disabled={!areaCustom.trim()}>Agregar</Button>
              </div>
            </fieldset>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="jardineria-observaciones" style={lbl}>Observaciones</label>
              <textarea id="jardineria-observaciones" rows={2} style={{ ...inp, fontFamily: 'inherit', resize: 'vertical' }} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
            </div>
          </form>
        </EditModal>
      )}

      {/* Detalle del servicio en ventana */}
      {detalle && (
        <EditModal
          title={`${tipoDe(detalle.tipo)?.icon ?? '🌿'} ${tipoDe(detalle.tipo)?.label ?? detalle.tipo}`}
          subtitle={
            <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span>{detalle.fecha}</span>
              <EstadoBadge estado={detalle.estado} />
            </span>
          }
          maxWidth="500px"
          fullScreenOnMobile
          onClose={() => setDetalleId(null)}
          footer={
            <>
              {canEdit && detalle.estado !== 'completado' && (
                <Button variant="success" onClick={() => void cambiarEstado(detalle, 'completado')} loading={cambiando}>✓ Marcar completado</Button>
              )}
              <Button variant="secondary" onClick={() => setDetalleId(null)}>Cerrar</Button>
            </>
          }
        >
          <ServicioDetalle registro={detalle} dinero={dinero} />
        </EditModal>
      )}

      {/* Historial: en el teléfono cada servicio es una tarjeta; tocarlo abre
          su detalle y «Ver» es el camino de teclado. */}
      <DataTable<MantenimientoJardineria>
        data={lista}
        rowKey="id"
        pageSize={30}
        mobileCardLayout
        defaultSort={{ key: 'fecha', direction: 'desc' }}
        emptyState={{ icon: '🌿', title: 'Sin registros' }}
        onRowClick={(r) => setDetalleId(r.id)}
        columns={[
          { key: 'tipo', header: 'Tipo', sortable: true,
            accessor: (r) => tipoDe(r.tipo)?.label ?? r.tipo,
            render: (r) => {
              const tipo = tipoDe(r.tipo)
              return <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{tipo?.icon} {tipo?.label ?? r.tipo}</span>
            } },
          { key: 'fecha', header: 'Fecha', sortable: true },
          { key: 'areas', header: 'Áreas',
            render: (r) => <span style={{ color: 'var(--at-ink-2)' }}>{r.areas.slice(0, 2).join(', ')}{r.areas.length > 2 ? ` +${r.areas.length - 2}` : ''}</span> },
          { key: 'proveedor', header: 'Proveedor', sortable: true, hideOnMobile: true,
            accessor: (r) => r.proveedor ?? '',
            render: (r) => <span style={{ color: 'var(--at-ink-3)' }}>{r.proveedor || '—'}</span> },
          { key: 'costo', header: 'Costo', align: 'right', sortable: true,
            accessor: (r) => r.costo ?? 0,
            render: (r) => r.costo != null ? <span style={{ whiteSpace: 'nowrap' }}>{dinero(r.costo)}</span> : '—' },
          { key: 'estado', header: 'Estado', sortable: true,
            accessor: (r) => estadoDe(r.estado)?.label ?? r.estado,
            render: (r) => <EstadoBadge estado={r.estado} /> },
          { key: 'ver', header: '', align: 'right',
            render: (r) => (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                {r.observaciones && <span aria-hidden="true" style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>📝</span>}
                <Button size="sm" variant="secondary" onClick={() => setDetalleId(r.id)} aria-label={`Ver ${tipoDe(r.tipo)?.label ?? r.tipo} del ${r.fecha}`}>Ver</Button>
              </span>
            ) },
        ] satisfies DataTableColumn<MantenimientoJardineria>[]}
      />
    </div>
  )
}

/** Detalle de solo lectura de un servicio de jardinería. */
function ServicioDetalle({ registro: r, dinero }: { registro: MantenimientoJardineria; dinero: (v: number) => string }) {
  const fila = (label: string, valor: ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid var(--at-chip)', fontSize: 14 }}>
      <span style={{ color: 'var(--at-ink-3)' }}>{label}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{valor}</span>
    </div>
  )
  return (
    <div>
      {fila('Proveedor', r.proveedor || '—')}
      {fila('Trabajadores', r.trabajadores ?? '—')}
      {fila('Horas de trabajo', r.horas_trabajo != null ? `${r.horas_trabajo} h` : '—')}
      {fila('Costo', r.costo != null ? <strong style={{ color: 'var(--at-success)' }}>{dinero(r.costo)}</strong> : '—')}
      {fila('Próxima visita', r.proxima_visita ? <strong style={{ color: 'var(--at-accent)' }}>📅 {r.proxima_visita}</strong> : '—')}

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 6 }}>Áreas tratadas</div>
        {r.areas.length === 0 ? <span style={{ color: 'var(--at-ink-3)', fontSize: 13 }}>—</span> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {r.areas.map(a => (
              <span key={a} style={{ padding: '3px 10px', background: 'var(--at-success-tint)', color: 'var(--at-success)', borderRadius: 6, fontSize: 12, border: '1px solid var(--at-success-border)' }}>{a}</span>
            ))}
          </div>
        )}
      </div>

      {r.insumos && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 4 }}>Insumos</div>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>{r.insumos}</p>
        </div>
      )}
      {r.observaciones && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 4 }}>Observaciones</div>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>{r.observaciones}</p>
        </div>
      )}
    </div>
  )
}
