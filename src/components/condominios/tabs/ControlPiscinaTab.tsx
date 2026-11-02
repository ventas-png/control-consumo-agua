import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { MultiImageUploader } from '../../shared/ImageUploader'
import { ImageGallery } from '../../shared/ImageGallery'
import { nombreAreaDe, vinculoArea } from '../../../domain/condominios/areas'
import { reportanteDe } from '../../../domain/condominios/incidentes'
import {
  NIVEL_COLOR, NIVEL_TEXTO, PARAMETROS_AGUA, PARAMETRO_AGUA, TIPOS_CUERPO_AGUA, claveCuerpoAgua, masRecientePiscina,
  nivelDe, parametrosFueraDeRango, textoRango, tipoCuerpoAgua, type ClaveParametroAgua, type NivelAgua, type ParametroAgua,
} from '../../../domain/condominios/piscina'
import type { AreaCondominio, CargoCatalogo, ControlPiscina, EstadoPiscina, PersonalCondominio, TipoCuerpoAgua, TurbiededadPiscina } from '../../../types'

interface Props {
  registros: ControlPiscina[]
  /** Catálogo compartido: el área de la piscina o el jacuzzi se ELIGE de aquí (tab Áreas). */
  areas: AreaCondominio[]
  /** Expediente del condominio: si el usuario tiene ficha, «Registrado por» lleva su cargo. */
  personal: PersonalCondominio[]
  cargos?: CargoCatalogo[]
  /** Usuario que registra: se propone como «Registrado por». */
  userId?: string
  autorNombre?: string
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  /** Visibilidad del tab Áreas: decide si se ofrece el atajo para configurarlas. */
  puedeConfigurarAreas?: boolean
  onIrATab?: (tabId: 'areas_config') => void
  onRefresh: () => void
}

const ESTADOS: { value: EstadoPiscina; label: string; color: string; bg: string; icon: string }[] = [
  { value: 'abierta',               label: 'Abierta',             color: 'var(--at-success)', bg: 'var(--at-success-tint)', icon: '✅' },
  { value: 'cerrada_mantenimiento', label: 'Cerrada (manto.)',    color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', icon: '🔧' },
  { value: 'cerrada_quimica',       label: 'Cerrada (química)',   color: 'var(--at-accent)', bg: 'var(--at-accent-tint)', icon: '🧪' },
  { value: 'cerrada_incidente',     label: 'Cerrada (incidente)', color: 'var(--at-danger)', bg: 'var(--at-danger-tint)', icon: '🚨' },
]

const TURBIEDAD: { value: TurbiededadPiscina; label: string; color: string }[] = [
  { value: 'cristalina',          label: 'Cristalina',           color: 'var(--at-accent-2)' },
  { value: 'ligeramente_turbia',  label: 'Liger. turbia',        color: 'var(--at-warning)' },
  { value: 'turbia',              label: 'Turbia',               color: 'var(--at-danger)' },
]

const PH = PARAMETRO_AGUA.ph
const CLORO = PARAMETRO_AGUA.cloro

const horaActual = () => new Date().toTimeString().slice(0, 5)

/** Un parámetro con su color de rango y, si no está bien, un aviso que no depende del color. */
function Medida({ value, nivel }: { value: number | null | undefined; nivel: NivelAgua }) {
  if (value == null) return <span style={{ color: 'var(--at-ink-3)' }}>—</span>
  return (
    <span style={{ fontWeight: 700, color: NIVEL_COLOR[nivel], whiteSpace: 'nowrap' }}>
      {value}
      {nivel !== 'ok' && <span role="img" aria-label={NIVEL_TEXTO[nivel]} title={NIVEL_TEXTO[nivel]}> ⚠</span>}
    </span>
  )
}

function GaugeBar({ value, min, max, status }: { value: number | null | undefined; min: number; max: number; status: NivelAgua }) {
  if (value == null) return <span style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>—</span>
  const pct = Math.min(Math.max(((value - (min - 1)) / ((max + 1) - (min - 1))) * 100, 0), 100)
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: NIVEL_COLOR[status] }}>{value}</div>
      <div style={{ height: 4, background: 'var(--at-line)', borderRadius: 2, overflow: 'hidden', marginTop: 2 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: NIVEL_COLOR[status] }} />
      </div>
    </div>
  )
}

type FormParametros = Record<ClaveParametroAgua, string>
const PARAMETROS_VACIOS = Object.fromEntries(PARAMETROS_AGUA.map(p => [p.key, ''])) as FormParametros

export default function ControlPiscinaTab({ registros, areas, personal, cargos = [], userId, autorNombre, proyectoId, companyId, canCreate, canEdit, puedeConfigurarAreas = false, onIrATab, onRefresh }: Props) {
  const [filtroCuerpo, setFiltroCuerpo] = useState('')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [subiendo, setSubiendo] = useState(0)
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const [cambiandoId, setCambiandoId] = useState<string | null>(null)

  const [form, setForm] = useState({
    tipo: 'piscina' as TipoCuerpoAgua, piscina: 'Principal', area_id: '',
    fecha: hoyLocalISO(), hora: horaActual(),
    ...PARAMETROS_VACIOS, temperatura: '',
    turbiedad: 'cristalina' as TurbiededadPiscina,
    estado: 'abierta' as EstadoPiscina,
    num_usuarios: '', registrado_por: '', observaciones: '',
    fotos_muestra: [] as string[], fotos_resultado: [] as string[], fotos_area: [] as string[],
  })

  // El área es del catálogo (tab Áreas). Solo las activas se ofrecen al
  // registrar; las inactivas siguen nombrando lo ya registrado.
  const areasActivas = [...areas]
    .filter(a => a.activo)
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
  const areaDe = (r: ControlPiscina) => nombreAreaDe(r.area_id, areas, '')
  // El área guardada puede estar inactiva: se sigue ofreciendo para no perderla.
  const areaFueraDeLista = form.area_id && !areasActivas.some(a => a.id === form.area_id) ? form.area_id : null

  // Cuerpos de agua (tipo + nombre) con su último registro: cada tarjeta abre ése.
  const cuerpos = [...new Map(registros.map(r => [claveCuerpoAgua(r), r])).keys()].sort()
  const lista = registros.filter(r => filtroCuerpo === '' || claveCuerpoAgua(r) === filtroCuerpo)
  const ultimo = cuerpos.reduce<Record<string, ControlPiscina>>((acc, c) => {
    const rec = registros.filter(r => claveCuerpoAgua(r) === c).sort(masRecientePiscina)[0]
    if (rec) acc[c] = rec
    return acc
  }, {})
  // El estado de una piscina es el de su último registro: sólo ése se abre o
  // se cierra. Antes cada fila del historial tenía su botón y «Abrir» en un
  // registro viejo no cambiaba la tarjeta de la piscina.
  const esUltimo = (r: ControlPiscina) => ultimo[claveCuerpoAgua(r)]?.id === r.id
  const nombresDe = (tipo: TipoCuerpoAgua) => [...new Set(registros.filter(r => (r.tipo ?? 'piscina') === tipo).map(r => r.piscina))].sort()

  // Quien registra es quien mide, salvo que lo cambie: se propone su nombre
  // (con su cargo si su usuario tiene ficha de empleado).
  const registradorPropio = reportanteDe(userId, autorNombre, personal, cargos)

  /** Área activa del último registro de ese cuerpo de agua, si la tiene. */
  function areaDelCuerpo(tipo: TipoCuerpoAgua, nombre: string): string {
    const previo = ultimo[`${tipo}:${nombre.trim()}`]
    return previo?.area_id && areasActivas.some(a => a.id === previo.area_id) ? previo.area_id : ''
  }

  // Al escribir un cuerpo de agua ya registrado se propone su área, si aún no se eligió.
  function elegirNombre(valor: string, tipo = form.tipo) {
    setForm(p => ({ ...p, piscina: valor, tipo, area_id: p.area_id || areaDelCuerpo(tipo, valor) }))
  }

  // Fecha y hora se toman al abrir: con la pestaña abierta desde la mañana,
  // la hora de montaje ya no era la de la medición.
  function abrirForm() {
    setForm(p => ({ ...p, fecha: hoyLocalISO(), hora: horaActual(), registrado_por: registradorPropio, area_id: p.area_id || areaDelCuerpo(p.tipo, p.piscina) }))
    setMostrarForm(true)
  }

  // No se cierra a mitad del guardado ni de una subida: cerrar ahí escondería el error.
  const ocupado = saving || subiendo > 0
  const cerrarForm = () => { if (!ocupado) setMostrarForm(false) }

  const num = (v: string) => (v.trim() === '' ? null : parseFloat(v))

  async function guardar() {
    if (ocupado) return
    if (!form.piscina.trim()) {
      notify({ variant: 'warning', title: 'Faltan datos', text: `El nombre de ${form.tipo === 'jacuzzi' ? 'el jacuzzi' : 'la piscina'} es obligatorio` }); return
    }
    setSaving(true)
    const area = vinculoArea(form.area_id, areas)
    const parametros = Object.fromEntries(PARAMETROS_AGUA.map(p => [p.key, num(form[p.key])]))
    const { error } = await createCondominioRow('control_piscina', {
      company_id: companyId, project_id: proyectoId,
      fecha: form.fecha, hora: form.hora || null,
      tipo: form.tipo, piscina: form.piscina.trim(), area_id: area.area_id,
      ...parametros,
      temperatura: num(form.temperatura),
      turbiedad: form.turbiedad, estado: form.estado,
      num_usuarios: form.num_usuarios ? parseInt(form.num_usuarios) : null,
      registrado_por: form.registrado_por.trim() || null,
      observaciones: form.observaciones.trim() || null,
      fotos_muestra: form.fotos_muestra, fotos_resultado: form.fotos_resultado, fotos_area: form.fotos_area,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm(p => ({ ...p, ...PARAMETROS_VACIOS, temperatura: '', num_usuarios: '', observaciones: '', fotos_muestra: [], fotos_resultado: [], fotos_area: [] }))
    setMostrarForm(false)
    onRefresh()
  }

  async function cambiarEstado(r: ControlPiscina, estado: EstadoPiscina) {
    if (cambiandoId) return
    setCambiandoId(r.id)
    const { error } = await updateCondominioRow('control_piscina', r.id, { estado })
    setCambiandoId(null)
    // Antes el error se ignoraba: el botón no hacía nada y no decía por qué.
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', minWidth: 0, background: 'var(--at-surface)', color: 'var(--at-ink)' }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }
  const seccion: CSSProperties = { gridColumn: '1 / -1', fontSize: 12, fontWeight: 700, color: 'var(--at-ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 6, paddingBottom: 4, borderBottom: '1px solid var(--at-chip)' }

  const nivelForm = (p: ParametroAgua) => (form[p.key].trim() === '' ? null : nivelDe(p, parseFloat(form[p.key])))
  const ayudaRango = (p: ParametroAgua) => {
    const nivel = nivelForm(p)
    const ideal = textoRango(p)
    return (
      <div style={{ fontSize: 11, marginTop: 3, color: nivel && nivel !== 'ok' ? NIVEL_COLOR[nivel] : 'var(--at-ink-3)', fontWeight: nivel && nivel !== 'ok' ? 600 : 400 }}>
        {ideal ? (nivel && nivel !== 'ok' ? `${NIVEL_TEXTO[nivel]} (ideal ${ideal})` : `Ideal ${ideal}`) : (p.ayuda ?? '')}
      </div>
    )
  }

  // Se lee el registro vigente, no una copia.
  const detalle = detalleId ? registros.find(r => r.id === detalleId) ?? null : null

  /** Abrir / cerrar por mantenimiento (sólo en el último registro del cuerpo de agua), con aviso si falla. */
  const botonEstado = (r: ControlPiscina, size: 'sm' | 'md') => r.estado !== 'abierta' ? (
    <Button size={size} variant="success" onClick={() => void cambiarEstado(r, 'abierta')} loading={cambiandoId === r.id}
      aria-label={size === 'sm' ? `Abrir ${r.piscina}` : undefined}>
      {size === 'sm' ? 'Abrir' : '✅ Marcar abierta'}
    </Button>
  ) : (
    <Button size={size} variant="warning" onClick={() => void cambiarEstado(r, 'cerrada_mantenimiento')} loading={cambiandoId === r.id}
      aria-label={size === 'sm' ? `Cerrar ${r.piscina} por mantenimiento` : undefined}>
      {size === 'sm' ? 'Cerrar' : '🔧 Cerrar por mantenimiento'}
    </Button>
  )

  const tipoForm = TIPOS_CUERPO_AGUA[form.tipo]
  const etiquetaCuerpo = (r: ControlPiscina) => `${tipoCuerpoAgua(r.tipo).icon} ${r.piscina}`

  return (
    <div style={{ padding: 16 }}>
      {/* Estado actual por cuerpo de agua: cada tarjeta abre su último registro */}
      {cuerpos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))', gap: 12, marginBottom: 16 }}>
          {cuerpos.map(c => {
            const r = ultimo[c]
            const est = ESTADOS.find(e => e.value === r?.estado)
            const turb = TURBIEDAD.find(t => t.value === r?.turbiedad)
            const fuera = r ? parametrosFueraDeRango(r) : []
            return (
              <button key={c} type="button" onClick={() => r && setDetalleId(r.id)} aria-label={`Ver último registro de ${r.piscina}${est ? `: ${est.label}` : ''}`}
                className="cond-kpi-link"
                style={{ background: est?.bg ?? 'var(--at-surface-2)', border: `1px solid ${est?.color ?? 'var(--at-line)'}`, borderRadius: 12, padding: '12px 16px', textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer', minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{etiquetaCuerpo(r)}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: est?.color }}>{est?.icon} {est?.label}</span>
                </div>
                {areaDe(r) && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginBottom: 6 }}>📍 {areaDe(r)}</div>}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>pH</div>
                    <GaugeBar value={r.ph} min={PH.ideal![0]} max={PH.ideal![1]} status={nivelDe(PH, r.ph)} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>Cloro libre</div>
                    <GaugeBar value={r.cloro} min={CLORO.ideal![0]} max={CLORO.ideal![1]} status={nivelDe(CLORO, r.cloro)} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>°C</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--at-ink-2)' }}>{r.temperatura ?? '—'}</div>
                  </div>
                  <div style={{ gridColumn: '1 / -1', fontSize: 11, color: turb?.color, marginTop: 2 }}>
                    💧 {turb?.label} · {r.fecha} {r.hora?.slice(0, 5)}
                  </div>
                  {fuera.length > 0 && (
                    <div style={{ gridColumn: '1 / -1', fontSize: 11, fontWeight: 600, color: 'var(--at-danger)' }}>
                      ⚠ Fuera de rango: {fuera.map(p => p.corto).join(', ')}
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flex: '1 1 200px' }}>
          <select aria-label="Filtrar por piscina o jacuzzi" style={{ ...inp, width: 'auto', flex: '1 1 160px', maxWidth: 260 }} value={filtroCuerpo} onChange={e => setFiltroCuerpo(e.target.value)}>
            <option value="">Todas las piscinas y jacuzzis</option>
            {cuerpos.map(c => <option key={c} value={c}>{etiquetaCuerpo(ultimo[c])}</option>)}
          </select>
          <span style={{ fontSize: 13, color: 'var(--at-ink-3)' }}>{lista.length} registros</span>
        </div>
        {canCreate && (
          <Button onClick={abrirForm}>+ Nuevo registro</Button>
        )}
      </div>

      {/* Nuevo registro en ventana (antes, un formulario fijo de tres columnas
          sobre el historial que en el teléfono dejaba campos de ~90px). */}
      {mostrarForm && (
        <EditModal
          title={`${tipoForm.icon} Nuevo registro de ${tipoForm.label.toLowerCase()}`}
          maxWidth="720px"
          fullScreenOnMobile
          onClose={cerrarForm}
          closeOnBackdropClick={!ocupado}
          closeOnEscape={!ocupado}
          footer={
            <>
              <Button variant="secondary" onClick={cerrarForm} disabled={ocupado}>Cancelar</Button>
              <Button type="submit" form="piscina-form" variant="success" loading={saving} disabled={subiendo > 0} loadingText="Guardando…">
                {subiendo > 0 ? 'Subiendo fotos…' : '✅ Registrar'}
              </Button>
            </>
          }
        >
          <form
            id="piscina-form"
            onSubmit={e => { e.preventDefault(); void guardar() }}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: 12, alignItems: 'start' }}
          >
            <div>
              <label htmlFor="piscina-tipo" style={lbl}>Tipo</label>
              <select id="piscina-tipo" style={inp} value={form.tipo} onChange={e => elegirNombre(form.piscina, e.target.value as TipoCuerpoAgua)}>
                {(Object.keys(TIPOS_CUERPO_AGUA) as TipoCuerpoAgua[]).map(t => <option key={t} value={t}>{TIPOS_CUERPO_AGUA[t].icon} {TIPOS_CUERPO_AGUA[t].label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="piscina-nombre" style={lbl}>{tipoForm.label}</label>
              {/* Sugiere los ya registrados: «principal» y «Principal» eran dos tarjetas. */}
              <input id="piscina-nombre" list="piscina-nombres" style={inp} placeholder="Principal, Sur, Infantil…" value={form.piscina} onChange={e => elegirNombre(e.target.value)} />
              <datalist id="piscina-nombres">
                {nombresDe(form.tipo).map(p => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div>
              <label htmlFor="piscina-area" style={lbl}>Área</label>
              <select id="piscina-area" style={inp} value={form.area_id} onChange={e => setForm(p => ({ ...p, area_id: e.target.value }))}>
                <option value="">— Sin área —</option>
                {areasActivas.map(a => <option key={a.id} value={a.id}>{a.icono} {a.nombre}</option>)}
                {areaFueraDeLista && (
                  <option value={areaFueraDeLista}>{nombreAreaDe(areaFueraDeLista, areas, 'Área inactiva')} (inactiva)</option>
                )}
              </select>
              {areasActivas.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 4 }}>
                  Sin áreas activas.{' '}
                  {puedeConfigurarAreas && onIrATab
                    ? (
                      <button type="button" onClick={() => onIrATab('areas_config')}
                        style={{ background: 'none', border: 'none', padding: 0, color: 'var(--at-accent)', fontWeight: 600, fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}>
                        Crearlas en el tab Áreas
                      </button>
                    )
                    : 'Se dan de alta en el tab Áreas.'}
                </div>
              )}
            </div>
            <div>
              <label htmlFor="piscina-fecha" style={lbl}>Fecha</label>
              <input id="piscina-fecha" type="date" style={inp} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="piscina-hora" style={lbl}>Hora</label>
              <input id="piscina-hora" type="time" style={inp} value={form.hora} onChange={e => setForm(p => ({ ...p, hora: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="piscina-registrado-por" style={lbl}>Registrado por</label>
              <input id="piscina-registrado-por" style={inp} value={form.registrado_por} onChange={e => setForm(p => ({ ...p, registrado_por: e.target.value }))} placeholder="Nombre o cargo" />
              {form.registrado_por && form.registrado_por === registradorPropio && (
                <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 4 }}>Con tu usuario. Cámbialo si lo midió otra persona.</div>
              )}
            </div>

            {/* Lo que miden las tiras de prueba (franja OK del frasco). */}
            <div style={seccion}>Parámetros del agua (tiras de prueba)</div>
            {PARAMETROS_AGUA.map(p => {
              const nivel = nivelForm(p)
              return (
                <div key={p.key}>
                  <label htmlFor={`piscina-${p.key}`} style={lbl}>{p.label}</label>
                  {/* pH 0–14: un 72 por 7.2 se guardaba tal cual. */}
                  <input id={`piscina-${p.key}`} type="number" inputMode="decimal" min="0" max={p.max} step={p.step}
                    style={{ ...inp, borderColor: nivel ? NIVEL_COLOR[nivel] : 'var(--at-line-strong)' }}
                    value={form[p.key]} onChange={e => setForm(f => ({ ...f, [p.key]: e.target.value }))} />
                  {ayudaRango(p)}
                </div>
              )
            })}
            <div>
              <label htmlFor="piscina-temperatura" style={lbl}>Temperatura (°C)</label>
              <input id="piscina-temperatura" type="number" inputMode="decimal" step="0.01" style={inp} value={form.temperatura} onChange={e => setForm(p => ({ ...p, temperatura: e.target.value }))} />
            </div>
            <div>
              <label htmlFor="piscina-turbiedad" style={lbl}>Turbiedad</label>
              <select id="piscina-turbiedad" style={inp} value={form.turbiedad} onChange={e => setForm(p => ({ ...p, turbiedad: e.target.value as TurbiededadPiscina }))}>
                {TURBIEDAD.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="piscina-estado" style={lbl}>Estado</label>
              <select id="piscina-estado" style={inp} value={form.estado} onChange={e => setForm(p => ({ ...p, estado: e.target.value as EstadoPiscina }))}>
                {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.icon} {e.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="piscina-usuarios" style={lbl}>N° usuarios en {tipoForm.label.toLowerCase()}</label>
              <input id="piscina-usuarios" type="number" inputMode="numeric" min="0" step="1" style={inp} value={form.num_usuarios} onChange={e => setForm(p => ({ ...p, num_usuarios: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="piscina-observaciones" style={lbl}>Observaciones</label>
              <textarea id="piscina-observaciones" rows={2} style={{ ...inp, fontFamily: 'inherit', resize: 'vertical' }} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
            </div>

            {/* Evidencia: la muestra, la tira con su resultado y el área. */}
            <div style={seccion}>Fotos</div>
            <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 12 }}>
              <MultiImageUploader values={form.fotos_muestra} onChange={fotos_muestra => setForm(p => ({ ...p, fotos_muestra }))} folder="piscina" label="Muestra de agua" maxFiles={2} capture onSubiendo={s => setSubiendo(n => n + (s ? 1 : -1))} />
              <MultiImageUploader values={form.fotos_resultado} onChange={fotos_resultado => setForm(p => ({ ...p, fotos_resultado }))} folder="piscina" label="Resultado (tira de prueba)" maxFiles={2} capture onSubiendo={s => setSubiendo(n => n + (s ? 1 : -1))} />
              <MultiImageUploader values={form.fotos_area} onChange={fotos_area => setForm(p => ({ ...p, fotos_area }))} folder="piscina" label="Área inspeccionada" maxFiles={4} capture onSubiendo={s => setSubiendo(n => n + (s ? 1 : -1))} />
            </div>
          </form>
        </EditModal>
      )}

      {/* Detalle del registro en ventana */}
      {detalle && (
        <EditModal
          title={etiquetaCuerpo(detalle)}
          subtitle={<EstadoSubtitulo registro={detalle} area={areaDe(detalle)} />}
          maxWidth="560px"
          fullScreenOnMobile
          onClose={() => setDetalleId(null)}
          footer={
            <>
              {canEdit && esUltimo(detalle) && botonEstado(detalle, 'md')}
              <Button variant="secondary" onClick={() => setDetalleId(null)}>Cerrar</Button>
            </>
          }
        >
          {!esUltimo(detalle) && ultimo[claveCuerpoAgua(detalle)] && (
            <div style={{ display: 'flex', gap: '6px 10px', alignItems: 'center', flexWrap: 'wrap', background: 'var(--at-surface-2)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: 'var(--at-ink-3)' }}>
              <span style={{ flex: '1 1 200px' }}>Hay un registro más reciente de {detalle.piscina}: el estado actual se cambia desde ése.</span>
              <Button size="sm" variant="secondary" onClick={() => setDetalleId(ultimo[claveCuerpoAgua(detalle)].id)}>Ver el último</Button>
            </div>
          )}
          <RegistroDetalle registro={detalle} area={areaDe(detalle)} />
        </EditModal>
      )}

      {/* Historial: en el teléfono cada registro es una tarjeta; tocarlo abre
          su detalle y «Ver» es el camino de teclado. */}
      <DataTable<ControlPiscina>
        data={lista}
        rowKey="id"
        pageSize={30}
        mobileCardLayout
        defaultSort={{ key: 'fecha', direction: 'desc' }}
        emptyState={{ icon: '🏊', title: 'Sin registros' }}
        onRowClick={(r) => setDetalleId(r.id)}
        columns={[
          { key: 'piscina', header: 'Piscina', sortable: true,
            render: (r) => <span style={{ fontWeight: 600 }}>{etiquetaCuerpo(r)}</span> },
          { key: 'area', header: 'Área', hideOnMobile: true, accessor: (r) => areaDe(r),
            render: (r) => <span style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>{areaDe(r) || '—'}</span> },
          { key: 'fecha', header: 'Fecha', sortable: true,
            accessor: (r) => `${r.fecha} ${r.hora ?? ''}`,
            render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{r.fecha} {r.hora?.slice(0, 5)}</span> },
          { key: 'ph', header: 'pH', align: 'right', render: (r) => <Medida value={r.ph} nivel={nivelDe(PH, r.ph)} /> },
          { key: 'cloro', header: 'Cloro libre', align: 'right', render: (r) => <Medida value={r.cloro} nivel={nivelDe(CLORO, r.cloro)} /> },
          { key: 'temperatura', header: '°C', align: 'right', render: (r) => r.temperatura ?? '—' },
          { key: 'turbiedad', header: 'Turbiedad', hideOnMobile: true,
            render: (r) => {
              const turb = TURBIEDAD.find(t => t.value === r.turbiedad)
              return <span style={{ fontSize: 12, color: turb?.color }}>💧 {turb?.label}</span>
            } },
          { key: 'estado', header: 'Estado', sortable: true,
            render: (r) => {
              const est = ESTADOS.find(e => e.value === r.estado)
              return <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, background: est?.bg, color: est?.color, whiteSpace: 'nowrap' }}>{est?.icon} {est?.label}</span>
            } },
          { key: 'acciones', header: '', align: 'right',
            render: (r) => (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                {r.observaciones && <span aria-hidden="true" style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>📝</span>}
                {((r.fotos_muestra?.length ?? 0) + (r.fotos_resultado?.length ?? 0) + (r.fotos_area?.length ?? 0)) > 0 && <span aria-hidden="true" style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>📷</span>}
                <Button size="sm" variant="secondary" onClick={() => setDetalleId(r.id)} aria-label={`Ver registro de ${r.piscina} del ${r.fecha} ${r.hora?.slice(0, 5) ?? ''}`.trim()}>Ver</Button>
                {canEdit && esUltimo(r) && botonEstado(r, 'sm')}
              </span>
            ) },
        ] satisfies DataTableColumn<ControlPiscina>[]}
      />
    </div>
  )
}

function EstadoSubtitulo({ registro: r, area }: { registro: ControlPiscina; area: string }) {
  const est = ESTADOS.find(e => e.value === r.estado)
  return (
    <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
      <span>{r.fecha}{r.hora ? ` · ${r.hora.slice(0, 5)}` : ''}</span>
      {area && <span>📍 {area}</span>}
      {est && <span style={{ padding: '2px 8px', borderRadius: 10, background: est.bg, color: est.color, fontWeight: 600 }}>{est.icon} {est.label}</span>}
    </span>
  )
}

/** Detalle de solo lectura de un registro de piscina o jacuzzi. */
function RegistroDetalle({ registro: r, area }: { registro: ControlPiscina; area: string }) {
  const fila = (label: string, valor: ReactNode) => (
    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid var(--at-chip)', fontSize: 14 }}>
      <span style={{ color: 'var(--at-ink-3)' }}>{label}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{valor}</span>
    </div>
  )
  const medida = (p: ParametroAgua, value: number | null | undefined) => {
    if (value == null) return '—'
    const nivel = nivelDe(p, value)
    const ideal = textoRango(p)
    return (
      <span>
        <strong style={{ color: NIVEL_COLOR[nivel] }}>{value}</strong>
        <span style={{ display: 'block', fontSize: 12, color: nivel === 'ok' ? 'var(--at-ink-3)' : NIVEL_COLOR[nivel] }}>
          {ideal ? `${NIVEL_TEXTO[nivel]} · ideal ${ideal}` : (p.ayuda ?? '')}
        </span>
      </span>
    )
  }
  const turb = TURBIEDAD.find(t => t.value === r.turbiedad)
  const galeria = (titulo: string, fotos?: string[] | null) => fotos && fotos.length > 0 ? (
    <div key={titulo} style={{ marginTop: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 4 }}>{titulo} ({fotos.length})</div>
      <ImageGallery urls={fotos} maxVisible={4} />
    </div>
  ) : null
  return (
    <div>
      {fila('Tipo', `${tipoCuerpoAgua(r.tipo).icon} ${tipoCuerpoAgua(r.tipo).label}`)}
      {area && fila('Área', `📍 ${area}`)}
      {/* pH y cloro libre siempre; el resto sólo si se midió. */}
      {PARAMETROS_AGUA.filter(p => p.key === 'ph' || p.key === 'cloro' || r[p.key] != null).map(p => fila(p.label, medida(p, r[p.key])))}
      {fila('Temperatura', r.temperatura != null ? `${r.temperatura} °C` : '—')}
      {fila('Turbiedad', <span style={{ color: turb?.color }}>💧 {turb?.label ?? r.turbiedad}</span>)}
      {fila(`Usuarios en ${tipoCuerpoAgua(r.tipo).label.toLowerCase()}`, r.num_usuarios ?? '—')}
      {fila('Registrado por', r.registrado_por || '—')}
      {r.observaciones && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 4 }}>Observaciones</div>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14 }}>{r.observaciones}</p>
        </div>
      )}
      {galeria('Muestra de agua', r.fotos_muestra)}
      {galeria('Resultado (tira de prueba)', r.fotos_resultado)}
      {galeria('Área inspeccionada', r.fotos_area)}
    </div>
  )
}
