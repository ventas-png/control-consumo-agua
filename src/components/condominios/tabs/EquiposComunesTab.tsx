// Equipos (Operaciones, junto a Suministros): el catálogo de equipos y
// herramientas del condominio —bombas, generadores, hidrolavadoras, pulidoras—
// con la misma visual y funcionalidad que Suministros: cabecera con filtros,
// «Solo alertas», carga masiva y alta; aviso de equipos que piden mantenimiento;
// tarjetas en rejilla; y la ficha en ventana emergente (pantalla completa en el
// teléfono) con foto, cantidad, datos, cambio de estado y registro de
// mantenimiento. Desde 20261122000000 de aquí salen también las herramientas y
// el equipo de las actividades del catálogo (antes, de Inventario).
import { hoyLocalISO } from '../../../lib/format'
import { useMemo, useState, type CSSProperties } from 'react'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { removeCondominiosMedia } from '../../../domain/shared/storage'
import { notify } from '../../shared/Dialog'
import { tint } from '../../shared/statusTone'
import { openPromptDialog } from '../../shared/PromptDialog'
import { EditModal } from '../../shared/EditModal'
import { SecureImage } from '../../shared/SecureImage'
import { FotoSuministroModal } from './suministros/FotoSuministroModal'
import { ImportEquiposModal } from '../ImportEquiposModal'
import { CATEGORIAS_EQUIPO, ESTADOS_EQUIPO, alertaManto, categoriaEquipo, diasParaManto, estadoEquipo, requiereAtencion } from '../../../lib/equiposComunes'
import type { EquipoComun, CategoriaEquipo, EstadoEquipo } from '../../../types'

interface Props {
  equipos: EquipoComun[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

interface FormEquipo {
  nombre: string
  categoria: CategoriaEquipo
  cantidad: string
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
  foto_url: string
  notas: string
}

const FORM_VACIO: FormEquipo = {
  nombre: '', categoria: 'otro', cantidad: '1', marca: '', modelo: '', serial: '', ubicacion: '', fecha_compra: '', valor_compra: '',
  vida_util_anios: '', estado: 'operativo', ultimo_mantenimiento: '', proximo_mantenimiento: '', foto_url: '', notas: '',
}

/** La ficha tal como la edita la persona. */
function formDesde(e: EquipoComun): FormEquipo {
  return {
    nombre: e.nombre, categoria: e.categoria,
    cantidad: String(e.cantidad ?? 1),
    marca: e.marca ?? '', modelo: e.modelo ?? '', serial: e.serial ?? '', ubicacion: e.ubicacion ?? '',
    fecha_compra: e.fecha_compra ?? '',
    valor_compra: e.valor_compra != null ? String(e.valor_compra) : '',
    vida_util_anios: e.vida_util_anios != null ? String(e.vida_util_anios) : '',
    estado: e.estado,
    ultimo_mantenimiento: e.ultimo_mantenimiento ?? '', proximo_mantenimiento: e.proximo_mantenimiento ?? '',
    foto_url: e.foto_url ?? '',
    notas: e.notas ?? '',
  }
}

const FOTO_TITULO = 'Foto del equipo'
const FOTO_FOLDER = 'equipos'
const FOTO_VACIA = 'Este equipo no tiene foto.'

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
  const [soloAlertas, setSoloAlertas] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  /** Qué ventana de foto está abierta: la de la ficha (guarda ya) o la del formulario (guarda con la ficha). */
  const [fotoAbierta, setFotoAbierta] = useState<'detalle' | 'form' | null>(null)
  const [form, setForm] = useState<FormEquipo>(FORM_VACIO)

  const lista = equipos.filter(e =>
    (filtroCategoria === '' || e.categoria === filtroCategoria) &&
    (filtroEstado === '' || e.estado === filtroEstado) &&
    (!soloAlertas || requiereAtencion(e)),
  )

  const alertas = equipos.filter(e => requiereAtencion(e))

  /** La foto que la fila en edición tiene guardada (en «nuevo» no hay fila). */
  const fotoGuardada = vista === 'editar' ? selected?.foto_url ?? null : null

  /**
   * Una foto subida en el formulario que no llegó a guardarse no la referencia
   * ninguna fila: al salir sin guardar se borra del bucket. La guardada no se
   * toca: la fila todavía apunta a ella.
   */
  function descartarFotoPendiente() {
    if (vista !== 'nuevo' && vista !== 'editar') return
    if (form.foto_url && form.foto_url !== fotoGuardada) void removeCondominiosMedia([form.foto_url])
  }

  function seleccionar(id: string) {
    descartarFotoPendiente()
    setSelectedId(id)
    setVista('lista')
  }

  /** Cerrar la ventana de la ficha: el formulario y la foto cuelgan de ella y se descartan con ella. */
  function cerrarDetalle() {
    descartarFotoPendiente()
    setForm(FORM_VACIO)
    setFotoAbierta(null)
    setVista('lista')
    setSelectedId(null)
  }

  function abrirNuevo() {
    descartarFotoPendiente()
    setForm(FORM_VACIO)
    setVista('nuevo')
  }

  function abrirEdicion(e: EquipoComun) {
    setForm(formDesde(e))
    setVista('editar')
  }

  function cancelarFormulario() {
    descartarFotoPendiente()
    setForm(FORM_VACIO)
    setVista('lista')
  }

  /** La foto elegida en la ventana viaja con la ficha; la pendiente que reemplaza ya no sirve. */
  function elegirFotoForm(foto: string | null) {
    if (form.foto_url && form.foto_url !== foto && form.foto_url !== fotoGuardada) void removeCondominiosMedia([form.foto_url])
    setForm(p => ({ ...p, foto_url: foto ?? '' }))
  }

  /** Desde la ficha la foto se guarda en el acto, sin pasar por el formulario. */
  async function guardarFoto(e: EquipoComun, foto: string | null): Promise<boolean> {
    const { error } = await updateCondominioRow('equipos_comunes', e.id, { foto_url: foto })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return false }
    // La fila ya no apunta a la anterior: ahora sí se puede borrar.
    if (e.foto_url && e.foto_url !== foto) void removeCondominiosMedia([e.foto_url])
    notify({ variant: 'success', title: foto ? 'Foto guardada' : 'Foto quitada', text: e.nombre })
    onRefresh()
    return true
  }

  /** Lo que la persona puede cambiar de la ficha; el tenant lo añade sólo el alta. */
  function fichaDesdeForm(): { ficha: Record<string, unknown> } | { error: string } {
    if (!form.nombre.trim()) return { error: 'Nombre del equipo obligatorio' }
    const cantidad = form.cantidad.trim() === '' ? 1 : Number(form.cantidad)
    if (!Number.isInteger(cantidad) || cantidad < 0) return { error: 'La cantidad debe ser un entero mayor o igual a 0' }
    return {
      ficha: {
        nombre: form.nombre.trim(), categoria: form.categoria, cantidad,
        marca: form.marca.trim() || null, modelo: form.modelo.trim() || null,
        serial: form.serial.trim() || null, ubicacion: form.ubicacion.trim() || null,
        fecha_compra: form.fecha_compra || null,
        valor_compra: form.valor_compra ? parseFloat(form.valor_compra) : null,
        vida_util_anios: form.vida_util_anios ? parseInt(form.vida_util_anios) : null,
        estado: form.estado,
        ultimo_mantenimiento: form.ultimo_mantenimiento || null,
        proximo_mantenimiento: form.proximo_mantenimiento || null,
        foto_url: form.foto_url || null,
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
    // Se reemplazó o se quitó la foto: la fila ya no apunta a la anterior.
    if (fotoGuardada && fotoGuardada !== r.ficha.foto_url) void removeCondominiosMedia([fotoGuardada])
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
  const btnPrimario: CSSProperties = { padding: '8px 20px', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }
  const editando = vista === 'editar'
  const fmtMoneda = (n: number) => `${moneda} ${n.toFixed(2)}`
  const colorAlerta = (a: ReturnType<typeof alertaManto>) =>
    a === 'vencido' ? 'var(--at-danger)' : a === 'proximo' ? 'var(--at-warning)' : 'var(--at-ink-3)'

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      {/* Cabecera: filtros y altas, igual que Suministros. La ficha abre en
          ventana emergente (más abajo), así la lista ocupa todo el ancho. */}
      <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid var(--at-line)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
        <span style={{ fontWeight: 600, fontSize: 14, marginRight: 'auto' }}>Equipos</span>
        <select style={{ ...inp, width: 'auto', minWidth: 170 }} value={filtroCategoria} aria-label="Categoría" onChange={e => setFiltroCategoria(e.target.value as CategoriaEquipo | '')}>
          <option value="">Todas las categorías</option>
          {CATEGORIAS_EQUIPO.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
        </select>
        <select style={{ ...inp, width: 'auto', minWidth: 160 }} value={filtroEstado} aria-label="Estado" onChange={e => setFiltroEstado(e.target.value as EstadoEquipo | '')}>
          <option value="">Todos los estados</option>
          {ESTADOS_EQUIPO.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={soloAlertas} onChange={e => setSoloAlertas(e.target.checked)} />
          Solo alertas de mantenimiento ({alertas.length})
        </label>
        {canCreate && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setShowImportModal(true)} title="Carga masiva desde Excel/CSV"
              style={{ padding: '5px 10px', background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)', border: '1px solid var(--at-primary-soft-2)', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              ⬆ Masiva
            </button>
            <button onClick={abrirNuevo}
              style={{ padding: '5px 10px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
              + Nuevo
            </button>
          </div>
        )}
      </div>

      {alertas.length > 0 && !soloAlertas && (
        <div style={{ padding: '6px 16px', background: 'var(--at-warning-tint)', borderBottom: '1px solid var(--at-warning-border)', fontSize: 12, color: 'var(--at-warning-strong)' }}>
          ⚠️ {alertas.length} {alertas.length === 1 ? 'equipo requiere' : 'equipos requieren'} mantenimiento
        </div>
      )}

      {lista.length === 0 && <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '32px 16px', fontSize: 13 }}>Sin equipos</div>}

      {/* Tarjetas: una por equipo, en rejilla que se adapta al ancho (una
          columna en el teléfono). Pulsar una abre la ficha en ventana. */}
      {lista.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10, padding: 16 }}>
          {lista.map(e => {
            const cat = categoriaEquipo(e.categoria)
            const est = estadoEquipo(e.estado)
            const alerta = alertaManto(e)
            const dias = diasParaManto(e.proximo_mantenimiento)
            return (
              <div key={e.id} role="button" tabIndex={0} aria-label={e.nombre}
                onClick={() => seleccionar(e.id)}
                onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); seleccionar(e.id) } }}
                style={{ padding: '10px 12px', borderRadius: 10, cursor: 'pointer', background: 'var(--at-surface)', opacity: e.estado === 'baja' ? 0.5 : 1, border: '1px solid var(--at-line)', borderLeft: alerta === 'vencido' ? '4px solid var(--at-danger)' : alerta === 'proximo' ? '4px solid var(--at-warning)' : '4px solid var(--at-line)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{cat.icon} {e.nombre}</span>
                  <span style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', color: est.color }} title="Unidades">
                    ×{e.cantidad ?? 1}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '2px 8px', flexWrap: 'wrap', marginTop: 3 }}>
                  <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 10, whiteSpace: 'nowrap', background: tint(est.color, 12), color: est.color }}>{est.label}</span>
                  {(e.marca || e.ubicacion) && (
                    <span style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>
                      {e.marca && <span>{e.marca} {e.modelo}</span>}
                      {e.marca && e.ubicacion && ' · '}
                      {e.ubicacion && <span>{e.ubicacion}</span>}
                    </span>
                  )}
                </div>
                {dias !== null && e.estado !== 'baja' && (
                  <div style={{ fontSize: 11, color: colorAlerta(alerta), marginTop: 2 }}>
                    {alerta === 'vencido' ? `⚠️ Manto vencido hace ${Math.abs(dias)} días` : alerta === 'proximo' ? `⏳ Manto en ${dias} días` : `Próx. manto: ${e.proximo_mantenimiento}`}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Ventana: la ficha del equipo. Va ANTES de las ventanas de formulario y
          de foto en el árbol: se abren desde aquí y deben quedar encima
          (EditModal apila por orden de montaje y Escape sólo cierra la de
          arriba). En el teléfono ocupa toda la pantalla. */}
      {selected && (() => {
        const cat = categoriaEquipo(selected.categoria)
        const est = estadoEquipo(selected.estado)
        const alerta = alertaManto(selected)
        const dias = diasParaManto(selected.proximo_mantenimiento)
        return (
          <EditModal
            title={`${cat.icon} ${selected.nombre}`.trim()}
            subtitle={
              <span style={{ display: 'inline-flex', gap: '2px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ padding: '2px 10px', borderRadius: 10, background: tint(est.color, 12), color: est.color, fontWeight: 600, fontSize: 12 }}>{est.label}</span>
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
                    style={{ ...btnPrimario, background: 'var(--at-surface)', color: 'var(--at-ink)', border: '1px solid var(--at-line-strong)' }}>
                    ✏️ Editar
                  </button>
                  <button type="button" onClick={() => registrarMantenimiento(selected)}
                    style={{ ...btnPrimario, background: 'var(--at-accent)', color: 'white' }}>
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

            {/* Foto + resumen, como en Suministros */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 16 }}>
              {(selected.foto_url || canEdit) && (
                <button type="button" onClick={() => setFotoAbierta('detalle')}
                  aria-label={selected.foto_url ? `Ver foto de ${selected.nombre}` : `Agregar foto de ${selected.nombre}`}
                  title={selected.foto_url ? 'Ver foto' : 'Agregar foto'}
                  style={{ width: 76, height: 76, flexShrink: 0, padding: 0, overflow: 'hidden', borderRadius: 10, cursor: 'pointer', background: 'var(--at-surface-2)', color: 'var(--at-ink-3)', border: selected.foto_url ? '1px solid var(--at-line)' : '2px dashed var(--at-line-strong)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                  {selected.foto_url
                    ? <SecureImage src={selected.foto_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    : <><span aria-hidden="true" style={{ fontSize: 22 }}>📷</span><span style={{ fontSize: 10 }}>Agregar foto</span></>}
                </button>
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--at-ink-2)' }}>{cat.icon} {cat.label}</div>
                {selected.serial && <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 2 }}>Serial: <span style={{ fontWeight: 600, color: 'var(--at-ink-2)' }}>{selected.serial}</span></div>}
                {selected.notas && (
                  <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{selected.notas}</div>
                )}
              </div>
            </div>

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 16 }}>
              {[
                { label: 'Unidades', value: `×${selected.cantidad ?? 1}`, color: (selected.cantidad ?? 1) > 0 ? 'var(--at-success)' : 'var(--at-danger)' },
                { label: 'Próximo mantenimiento', value: dias === null ? '—' : dias < 0 ? `hace ${Math.abs(dias)} d` : `en ${dias} d`, color: colorAlerta(alerta) },
                { label: `Valor compra (${moneda})`, value: selected.valor_compra != null ? selected.valor_compra.toFixed(2) : '—', color: 'var(--at-accent)' },
                { label: 'Vida útil', value: selected.vida_util_anios ? `${selected.vida_util_anios} años` : '—', color: 'var(--at-ink-2)' },
              ].map(k => (
                <div key={k.label} style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{k.label}</div>
                </div>
              ))}
            </div>

            {/* Datos */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
              {[
                { label: 'Fecha de compra', value: selected.fecha_compra || '—' },
                { label: 'Último mantenimiento', value: selected.ultimo_mantenimiento || '—' },
                { label: 'Próximo mantenimiento', value: selected.proximo_mantenimiento || '—' },
                { label: 'Valor total', value: selected.valor_compra != null ? fmtMoneda(selected.valor_compra * (selected.cantidad ?? 1)) : '—' },
              ].map(d => (
                <div key={d.label} style={{ background: 'var(--at-surface-2)', borderRadius: 6, padding: '8px 12px' }}>
                  <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{d.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{d.value}</div>
                </div>
              ))}
            </div>

            {/* Cambio de estado: acciones secundarias, en el cuerpo y no en el
                pie, que ya lleva Editar y Registrar mantenimiento. */}
            {canEdit && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Cambiar estado</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {ESTADOS_EQUIPO.filter(s => s.value !== selected.estado).map(s => (
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
            <button type="button" onClick={() => void guardar()} disabled={saving} style={{ ...btnPrimario, background: 'var(--at-success)', color: 'var(--at-on-status)' }}>
              {saving ? 'Guardando…' : editando ? '✅ Guardar cambios' : '✅ Guardar equipo'}
            </button>
          </>}
        >
          <div className="at-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl} htmlFor="eq-f-nombre">Nombre *</label>
              <input id="eq-f-nombre" style={inp} placeholder="Hidrolavadora, bomba de agua principal…" value={form.nombre} autoFocus onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
            </div>
            <div>
              <label style={lbl} htmlFor="eq-f-categoria">Categoría</label>
              <select id="eq-f-categoria" style={inp} value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value as CategoriaEquipo }))}>
                {CATEGORIAS_EQUIPO.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl} htmlFor="eq-f-cantidad">Cantidad</label>
              <input id="eq-f-cantidad" type="number" min={0} step={1} style={inp} value={form.cantidad} onChange={e => setForm(p => ({ ...p, cantidad: e.target.value }))} />
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
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl} htmlFor="eq-f-ubicacion">Ubicación</label>
              <input id="eq-f-ubicacion" style={inp} placeholder="Cuarto de máquinas, bodega de limpieza…" value={form.ubicacion} onChange={e => setForm(p => ({ ...p, ubicacion: e.target.value }))} />
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
                {ESTADOS_EQUIPO.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
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
              <div style={lbl}>Foto</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {form.foto_url && (
                  <SecureImage src={form.foto_url} alt={`Foto de ${form.nombre || 'el equipo'}`}
                    style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--at-line)', display: 'block' }} />
                )}
                <button type="button" onClick={() => setFotoAbierta('form')}
                  style={{ padding: '7px 14px', background: 'var(--at-surface)', color: 'var(--at-ink)', border: '1px solid var(--at-line-strong)', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                  📷 {form.foto_url ? 'Cambiar foto' : 'Agregar foto'}
                </button>
                {(form.foto_url || null) !== fotoGuardada && (
                  <span style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Se guarda con la ficha</span>
                )}
              </div>
            </div>
            <div style={{ gridColumn: 'span 3' }}>
              <label style={lbl} htmlFor="eq-f-notas">Notas</label>
              <textarea id="eq-f-notas" style={{ ...inp, height: 60, resize: 'vertical' }} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} />
            </div>
          </div>
        </EditModal>
      )}

      {fotoAbierta === 'detalle' && selected && (
        <FotoSuministroModal titulo={FOTO_TITULO} folder={FOTO_FOLDER} sinFoto={FOTO_VACIA}
          nombre={selected.nombre} valor={selected.foto_url ?? null} editable={canEdit}
          onGuardar={foto => guardarFoto(selected, foto)} onClose={() => setFotoAbierta(null)} />
      )}
      {fotoAbierta === 'form' && (
        <FotoSuministroModal titulo={FOTO_TITULO} folder={FOTO_FOLDER} sinFoto={FOTO_VACIA}
          nombre={form.nombre.trim() || 'Nuevo equipo'} valor={form.foto_url || null} editable
          accion="Usar esta foto" onGuardar={foto => { elegirFotoForm(foto); return true }} onClose={() => setFotoAbierta(null)} />
      )}

      {showImportModal && (
        <ImportEquiposModal
          proyectoId={proyectoId}
          companyId={companyId}
          onClose={() => setShowImportModal(false)}
          onImportado={() => { setShowImportModal(false); onRefresh() }}
        />
      )}
    </div>
  )
}
