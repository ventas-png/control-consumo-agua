import { hoyLocalISO } from '../../../lib/format'
import { useMemo, useState, type CSSProperties} from 'react'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify } from '../../shared/Dialog'
import { tint } from '../../shared/statusTone'
import { openPromptDialog } from '../../shared/PromptDialog'
import { EditModal } from '../../shared/EditModal'
import { EquipoComun, CategoriaEquipo, EstadoEquipo } from '../../../types'

interface Props {
  equipos: EquipoComun[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CATEGORIAS: { value: CategoriaEquipo; label: string; icon: string }[] = [
  { value: 'bomba', label: 'Bomba', icon: '💧' },
  { value: 'ascensor', label: 'Ascensor', icon: '🛗' },
  { value: 'generador', label: 'Generador', icon: '⚡' },
  { value: 'camara', label: 'Cámara', icon: '📷' },
  { value: 'extintor', label: 'Extintor', icon: '🧯' },
  { value: 'planta_electrica', label: 'Planta eléctrica', icon: '🔌' },
  { value: 'otro', label: 'Otro', icon: '🔧' },
]

const ESTADOS: { value: EstadoEquipo; label: string; color: string }[] = [
  { value: 'operativo', label: 'Operativo', color: 'var(--at-success)' },
  { value: 'mantenimiento', label: 'En mantenimiento', color: 'var(--at-warning)' },
  { value: 'fuera_servicio', label: 'Fuera de servicio', color: 'var(--at-danger)' },
  { value: 'baja', label: 'De baja', color: 'var(--at-ink-3)' },
]

function diasParaManto(fecha?: string | null): number | null {
  if (!fecha) return null
  const diff = (new Date(fecha).getTime() - Date.now()) / 86400000
  return Math.round(diff)
}

function alertaManto(equipo: EquipoComun): 'vencido' | 'proximo' | 'ok' | 'sin_fecha' {
  const dias = diasParaManto(equipo.proximo_mantenimiento)
  if (dias === null) return 'sin_fecha'
  if (dias < 0) return 'vencido'
  if (dias <= 30) return 'proximo'
  return 'ok'
}

interface FormEquipo {
  nombre: string
  categoria: CategoriaEquipo
  marca: string
  modelo: string
  serial: string
  ubicacion: string
  fecha_compra: string
  valor_compra: string
  vida_util_anios: string
  estado: EstadoEquipo
  ultimo_mantenimiento: string
  proximo_mantenimiento: string
  notas: string
}

const FORM_VACIO: FormEquipo = {
  nombre: '', categoria: 'otro', marca: '', modelo: '', serial: '', ubicacion: '', fecha_compra: '', valor_compra: '',
  vida_util_anios: '', estado: 'operativo', ultimo_mantenimiento: '', proximo_mantenimiento: '', notas: '',
}

/** La ficha tal como la edita la persona. */
function formDesde(e: EquipoComun): FormEquipo {
  return {
    nombre: e.nombre, categoria: e.categoria,
    marca: e.marca ?? '', modelo: e.modelo ?? '', serial: e.serial ?? '', ubicacion: e.ubicacion ?? '',
    fecha_compra: e.fecha_compra ?? '',
    valor_compra: e.valor_compra != null ? String(e.valor_compra) : '',
    vida_util_anios: e.vida_util_anios != null ? String(e.vida_util_anios) : '',
    estado: e.estado,
    ultimo_mantenimiento: e.ultimo_mantenimiento ?? '', proximo_mantenimiento: e.proximo_mantenimiento ?? '',
    notas: e.notas ?? '',
  }
}

export default function EquiposComunesTab({ equipos, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  // Se guarda el id y no la fila: cuando `equipos` vuelve a cargar tras editar,
  // cambiar el estado o registrar un mantenimiento, el detalle muestra la ficha
  // nueva y no una copia vieja de la que se pulsó.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = useMemo(() => equipos.find(e => e.id === selectedId) ?? null, [equipos, selectedId])
  const [vista, setVista] = useState<'lista' | 'nuevo' | 'editar'>('lista')
  const [saving, setSaving] = useState(false)
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaEquipo | ''>('')
  const [filtroEstado, setFiltroEstado] = useState<EstadoEquipo | ''>('')
  const [form, setForm] = useState<FormEquipo>(FORM_VACIO)

  const lista = equipos.filter(e =>
    (filtroCategoria === '' || e.categoria === filtroCategoria) &&
    (filtroEstado === '' || e.estado === filtroEstado)
  )

  const alertas = equipos.filter(e => ['vencido', 'proximo'].includes(alertaManto(e)))

  function seleccionar(id: string) {
    setSelectedId(id)
    setVista('lista')
  }

  /** Cerrar la ventana de la ficha: el formulario de edición cuelga de ella y se descarta con ella. */
  function cerrarDetalle() {
    setForm(FORM_VACIO)
    setVista('lista')
    setSelectedId(null)
  }

  function abrirNuevo() {
    setForm(FORM_VACIO)
    setVista('nuevo')
  }

  function abrirEdicion(e: EquipoComun) {
    setForm(formDesde(e))
    setVista('editar')
  }

  function cancelarFormulario() {
    setForm(FORM_VACIO)
    setVista('lista')
  }

  /** Lo que la persona puede cambiar de la ficha; el tenant lo añade sólo el alta. */
  function fichaDesdeForm(): { ficha: Record<string, unknown> } | { error: string } {
    if (!form.nombre.trim()) return { error: 'Nombre del equipo obligatorio' }
    return {
      ficha: {
        nombre: form.nombre.trim(), categoria: form.categoria,
        marca: form.marca.trim() || null, modelo: form.modelo.trim() || null,
        serial: form.serial.trim() || null, ubicacion: form.ubicacion.trim() || null,
        fecha_compra: form.fecha_compra || null,
        valor_compra: form.valor_compra ? parseFloat(form.valor_compra) : null,
        vida_util_anios: form.vida_util_anios ? parseInt(form.vida_util_anios) : null,
        estado: form.estado,
        ultimo_mantenimiento: form.ultimo_mantenimiento || null,
        proximo_mantenimiento: form.proximo_mantenimiento || null,
        notas: form.notas.trim() || null,
      },
    }
  }

  async function guardar() {
    const r = fichaDesdeForm()
    if ('error' in r) { notify({ variant: 'warning', title: 'Faltan datos', text: r.error }); return }
    setSaving(true)
    const { error } = vista === 'editar' && selected
      ? await updateCondominioRow('equipos_comunes', selected.id, r.ficha)
      : await createCondominioRow('equipos_comunes', { company_id: companyId, project_id: proyectoId, ...r.ficha })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    if (vista === 'editar') notify({ variant: 'success', title: 'Equipo actualizado', text: r.ficha.nombre as string })
    setForm(FORM_VACIO)
    setVista('lista')
    onRefresh()
  }

  async function actualizarEstado(equipo: EquipoComun, estado: EstadoEquipo) {
    const { error } = await updateCondominioRow('equipos_comunes', equipo.id, { estado })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  async function registrarMantenimiento(equipo: EquipoComun) {
    const result = await openPromptDialog({
      title: 'Registrar mantenimiento',
      fields: [{
        name: 'proxima',
        label: 'Fecha próximo mantenimiento',
        type: 'date',
        autoFocus: true,
      }],
      submitText: 'Guardar',
    })
    if (!result) return
    const proxima = result.proxima || null
    const { error } = await updateCondominioRow('equipos_comunes', equipo.id, {
      ultimo_mantenimiento: hoyLocalISO(),
      proximo_mantenimiento: proxima,
      estado: 'operativo' as EstadoEquipo,
    })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }
  const btnSecundario: CSSProperties = { padding: '8px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }
  const btnPrimario: CSSProperties = { padding: '8px 20px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }
  const editando = vista === 'editar'

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      {/* Cabecera: filtros y alta. La ficha ya no vive en un panel al lado:
          abre en ventana emergente (más abajo), así la lista ocupa todo el
          ancho —en el teléfono antes compartían 320px + lo que sobrara—. */}
      <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid var(--at-line)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
        <span style={{ fontWeight: 600, fontSize: 14, marginRight: 'auto' }}>Equipos ({lista.length})</span>
        <select style={{ ...inp, width: 'auto', minWidth: 170 }} value={filtroCategoria} aria-label="Categoría" onChange={e => setFiltroCategoria(e.target.value as CategoriaEquipo | '')}>
          <option value="">Todas las categorías</option>
          {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
        </select>
        <select style={{ ...inp, width: 'auto', minWidth: 160 }} value={filtroEstado} aria-label="Estado" onChange={e => setFiltroEstado(e.target.value as EstadoEquipo | '')}>
          <option value="">Todos los estados</option>
          {ESTADOS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {canCreate && (
          <button onClick={abrirNuevo}
            style={{ padding: '5px 10px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
            + Nuevo
          </button>
        )}
      </div>

      {/* Alertas */}
      {alertas.length > 0 && (
        <div style={{ padding: '8px 16px', background: 'var(--at-warning-tint)', borderBottom: '1px solid var(--at-warning-border)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-warning-strong)' }}>⚠️ {alertas.length} equipos requieren atención</div>
        </div>
      )}

      {lista.length === 0 && <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '32px 16px', fontSize: 13 }}>Sin equipos</div>}

      {/* Tarjetas: una por equipo, en rejilla que se adapta al ancho (una
          columna en el teléfono). Pulsar una abre la ficha en ventana. */}
      {lista.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10, padding: 16 }}>
          {lista.map(e => {
            const cat = CATEGORIAS.find(c => c.value === e.categoria)
            const est = ESTADOS.find(s => s.value === e.estado)
            const alerta = alertaManto(e)
            const dias = diasParaManto(e.proximo_mantenimiento)
            return (
              <div key={e.id} role="button" tabIndex={0} aria-label={e.nombre}
                onClick={() => seleccionar(e.id)}
                onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); seleccionar(e.id) } }}
                style={{ padding: '10px 12px', borderRadius: 10, cursor: 'pointer', background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderLeft: alerta === 'vencido' ? '4px solid var(--at-danger)' : alerta === 'proximo' ? '4px solid var(--at-warning)' : '4px solid var(--at-line)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{cat?.icon} {e.nombre}</span>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap', background: est && tint(est.color, 12), color: est?.color }}>{est?.label}</span>
                </div>
                {(e.marca || e.ubicacion) && (
                  <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 2 }}>
                    {e.marca && <span>{e.marca} {e.modelo}</span>}
                    {e.marca && e.ubicacion && ' · '}
                    {e.ubicacion && <span>{e.ubicacion}</span>}
                  </div>
                )}
                {dias !== null && (
                  <div style={{ fontSize: 11, color: alerta === 'vencido' ? 'var(--at-danger)' : alerta === 'proximo' ? 'var(--at-warning)' : 'var(--at-ink-3)', marginTop: 2 }}>
                    {alerta === 'vencido' ? `⚠️ Manto vencido hace ${Math.abs(dias)} días` : alerta === 'proximo' ? `⏳ Manto en ${dias} días` : `Próx. manto: ${e.proximo_mantenimiento}`}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Ventana: la ficha del equipo. Va ANTES de la ventana del formulario
          en el árbol: se abre desde aquí y debe quedar encima (EditModal
          apila por orden de montaje y Escape sólo cierra la de arriba). En
          el teléfono ocupa toda la pantalla. */}
      {selected && (() => {
        const cat = CATEGORIAS.find(c => c.value === selected.categoria)
        const est = ESTADOS.find(s => s.value === selected.estado)
        const alerta = alertaManto(selected)
        const dias = diasParaManto(selected.proximo_mantenimiento)
        return (
          <EditModal
            title={`${cat?.icon ?? ''} ${selected.nombre}`.trim()}
            subtitle={
              <span style={{ display: 'inline-flex', gap: '2px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ padding: '2px 10px', borderRadius: 10, background: est && tint(est.color, 12), color: est?.color, fontWeight: 600, fontSize: 12 }}>{est?.label}</span>
                {selected.marca && <span>{selected.marca} {selected.modelo}</span>}
                {selected.ubicacion && <span>📍 {selected.ubicacion}</span>}
              </span>
            }
            size="lg"
            fullScreenOnMobile
            onClose={cerrarDetalle}
            footer={
              <div className="at-ficha-acciones" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', width: '100%' }}>
                <button type="button" onClick={cerrarDetalle} style={btnSecundario}>Cerrar</button>
                {canEdit && (<>
                  <button type="button" onClick={() => abrirEdicion(selected)}
                    style={{ padding: '8px 16px', background: 'var(--at-surface)', color: 'var(--at-ink)', border: '1px solid var(--at-line-strong)', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                    ✏️ Editar
                  </button>
                  <button type="button" onClick={() => registrarMantenimiento(selected)} style={btnPrimario}>
                    🔧 Registrar mantenimiento
                  </button>
                </>)}
              </div>
            }
          >
            {/* Alerta mantenimiento */}
            {alerta !== 'ok' && alerta !== 'sin_fecha' && (
              <div style={{ background: alerta === 'vencido' ? 'var(--at-danger-tint)' : 'var(--at-warning-tint)', border: `1px solid ${alerta === 'vencido' ? 'var(--at-danger-border)' : 'var(--at-warning-border)'}`, borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
                <div style={{ fontWeight: 600, color: alerta === 'vencido' ? 'var(--at-danger)' : 'var(--at-warning-strong)', fontSize: 13 }}>
                  {alerta === 'vencido' ? `⚠️ Mantenimiento vencido hace ${Math.abs(dias!)} días` : `⏳ Mantenimiento en ${dias} días (${selected.proximo_mantenimiento})`}
                </div>
              </div>
            )}

            {/* Datos */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              {[
                { label: 'Categoría', value: `${cat?.icon} ${cat?.label}` },
                { label: 'Serial', value: selected.serial || '—' },
                { label: 'Fecha compra', value: selected.fecha_compra || '—' },
                { label: `Valor compra (${moneda})`, value: selected.valor_compra != null ? selected.valor_compra.toLocaleString() : '—' },
                { label: 'Vida útil', value: selected.vida_util_anios ? `${selected.vida_util_anios} años` : '—' },
                { label: 'Último mantenimiento', value: selected.ultimo_mantenimiento || '—' },
                { label: 'Próximo mantenimiento', value: selected.proximo_mantenimiento || '—' },
              ].map(d => (
                <div key={d.label} style={{ background: 'var(--at-surface-2)', borderRadius: 6, padding: '8px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{d.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{d.value}</div>
                </div>
              ))}
            </div>

            {selected.notas && (
              <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 12px', marginBottom: 16, fontSize: 13, whiteSpace: 'pre-wrap' }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 4 }}>Notas</div>
                {selected.notas}
              </div>
            )}

            {/* Cambio de estado: acciones secundarias, en el cuerpo y no en el
                pie, que ya lleva Editar y Registrar mantenimiento. */}
            {canEdit && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Cambiar estado</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {ESTADOS.filter(s => s.value !== selected.estado).map(s => (
                    <button key={s.value} type="button" onClick={() => actualizarEstado(selected, s.value)}
                      style={{ padding: '7px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line)', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
                      → {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </EditModal>
        )
      })()}

      {/* Ventana: nuevo / editar. Va DESPUÉS de la ficha: queda encima de ella. */}
      {(vista === 'nuevo' || (editando && selected)) && (
        <EditModal
          title={editando ? 'Editar equipo' : 'Nuevo equipo'}
          subtitle={editando && selected ? selected.nombre : undefined}
          size="lg"
          fullScreenOnMobile
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          onClose={cancelarFormulario}
          footer={<>
            <button type="button" onClick={cancelarFormulario} disabled={saving} style={btnSecundario}>
              Cancelar
            </button>
            <button type="button" onClick={() => void guardar()} disabled={saving} style={btnPrimario}>
              {saving ? 'Guardando…' : editando ? '✅ Guardar cambios' : '✅ Guardar equipo'}
            </button>
          </>}
        >
          <div className="at-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl} htmlFor="eq-f-nombre">Nombre *</label>
              <input id="eq-f-nombre" style={inp} placeholder="Bomba de agua principal" value={form.nombre} autoFocus onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
            </div>
            <div>
              <label style={lbl} htmlFor="eq-f-categoria">Categoría</label>
              <select id="eq-f-categoria" style={inp} value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value as CategoriaEquipo }))}>
                {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl} htmlFor="eq-f-marca">Marca</label>
              <input id="eq-f-marca" style={inp} value={form.marca} onChange={e => setForm(p => ({ ...p, marca: e.target.value }))} />
            </div>
            <div>
              <label style={lbl} htmlFor="eq-f-modelo">Modelo</label>
              <input id="eq-f-modelo" style={inp} value={form.modelo} onChange={e => setForm(p => ({ ...p, modelo: e.target.value }))} />
            </div>
            <div>
              <label style={lbl} htmlFor="eq-f-serial">Serial</label>
              <input id="eq-f-serial" style={inp} value={form.serial} onChange={e => setForm(p => ({ ...p, serial: e.target.value }))} />
            </div>
            <div style={{ gridColumn: 'span 3' }}>
              <label style={lbl} htmlFor="eq-f-ubicacion">Ubicación</label>
              <input id="eq-f-ubicacion" style={inp} placeholder="Cuarto de máquinas, Piso 1…" value={form.ubicacion} onChange={e => setForm(p => ({ ...p, ubicacion: e.target.value }))} />
            </div>
            <div>
              <label style={lbl} htmlFor="eq-f-fecha-compra">Fecha de compra</label>
              <input id="eq-f-fecha-compra" type="date" style={inp} value={form.fecha_compra} onChange={e => setForm(p => ({ ...p, fecha_compra: e.target.value }))} />
            </div>
            <div>
              <label style={lbl} htmlFor="eq-f-valor">Valor compra ({moneda})</label>
              <input id="eq-f-valor" type="number" style={inp} value={form.valor_compra} onChange={e => setForm(p => ({ ...p, valor_compra: e.target.value }))} />
            </div>
            <div>
              <label style={lbl} htmlFor="eq-f-vida">Vida útil (años)</label>
              <input id="eq-f-vida" type="number" style={inp} value={form.vida_util_anios} onChange={e => setForm(p => ({ ...p, vida_util_anios: e.target.value }))} />
            </div>
            <div>
              <label style={lbl} htmlFor="eq-f-estado">Estado</label>
              <select id="eq-f-estado" style={inp} value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value as EstadoEquipo }))}>
                {ESTADOS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl} htmlFor="eq-f-ultimo">Último mantenimiento</label>
              <input id="eq-f-ultimo" type="date" style={inp} value={form.ultimo_mantenimiento} onChange={e => setForm(p => ({ ...p, ultimo_mantenimiento: e.target.value }))} />
            </div>
            <div>
              <label style={lbl} htmlFor="eq-f-proximo">Próximo mantenimiento</label>
              <input id="eq-f-proximo" type="date" style={inp} value={form.proximo_mantenimiento} onChange={e => setForm(p => ({ ...p, proximo_mantenimiento: e.target.value }))} />
            </div>
            <div style={{ gridColumn: 'span 3' }}>
              <label style={lbl} htmlFor="eq-f-notas">Notas</label>
              <textarea id="eq-f-notas" style={{ ...inp, height: 60, resize: 'vertical' }} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} />
            </div>
          </div>
        </EditModal>
      )}
    </div>
  )
}
