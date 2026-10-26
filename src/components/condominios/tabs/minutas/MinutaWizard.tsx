// Asistente de una minuta de reunión, en ventana y en tres pasos:
//
//   1 · Participantes  título, fecha y objetivo; quiénes participan —empleados,
//                      propietarios/inquilinos, proveedores u otro por nombre—
//                      y quién la gestiona (quien la abre queda de gestor).
//   2 · Puntos         los puntos a abordar, numerados, con detalle opcional.
//   3 · Acuerdos       por cada punto, lo acordado y los compromisos (quién y
//                      para cuándo); cierre: categoría, prioridad, próximo
//                      seguimiento y fijar.
//
// Las listas salen de lo que la sección ya carga (personal, unidades,
// contratos) y de dos lecturas propias: residentes de unidad (con rol) y el
// catálogo compartido de proveedores. Todo lo que no es pantalla —validar cada
// paso, depurar y armar candidatos— vive en domain/condominios/minutas.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { EditModal } from '../../../shared/EditModal'
import { Button } from '../../../shared/Button'
import { FilterChips } from '../../../shared/FilterChips'
import { notify } from '../../../shared/Dialog'
import { createCondominioRow, updateCondominioRow } from '../../../../domain/condominios/tabMutations'
import { useProveedoresQuery } from '../../../../domain/cxp/queries'
import {
  PASOS_MINUTA, TIPOS_PARTICIPANTE, TIPO_ACUERDO_INFO, TIPO_PARTICIPANTE_INFO,
  borradorDesde, candidatosEmpleados, candidatosProveedores, candidatosResidentes, depurarBorrador, designarGestor,
  fetchResidentesProyecto, filtrarCandidatos, nuevoIdMinuta, participanteDesdeCandidato, quitarParticipante, validarPasoMinuta, yaParticipa,
  type BorradorMinuta, type CandidatoParticipante, type PasoMinuta, type ResidenteProyecto,
} from '../../../../domain/condominios/minutas'
import { hoyLocalISO } from '../../../../lib/format'
import type {
  AcuerdoMinuta, CargoCatalogo, CategoriaNota, ContratoArrendamiento, ContratoProveedor, NotaAdmin, PersonalCondominio,
  PrioridadNota, PuntoMinuta, TipoAcuerdoMinuta, TipoParticipanteMinuta, Unidad,
} from '../../../../types'
import type { ProveedorCatalogo } from '../../../../types/proveedores'
import { Avatar, CATEGORIAS, PRIORIDADES, ParticipanteCard, btnIcono, inp, lbl } from './comun'

interface Props {
  /** null = nueva minuta. */
  nota: NotaAdmin | null
  proyectoId: string
  companyId: string
  autorNombre: string
  personal: readonly PersonalCondominio[]
  cargos: readonly CargoCatalogo[]
  unidades: readonly Unidad[]
  contratos: readonly ContratoArrendamiento[]
  contratosProveedores: readonly ContratoProveedor[]
  onClose: () => void
  /** Ya quedó guardada: la sección recarga y cierra. */
  onGuardado: () => void
}

const MAX_CANDIDATOS = 30

const tarjeta: CSSProperties = { border: '1px solid var(--at-line)', borderRadius: 12, padding: 14, background: 'var(--at-surface)' }
const seccionTitulo: CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--at-ink)', margin: '0 0 8px' }
const ayuda: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', margin: '0 0 10px', lineHeight: 1.5 }

export function MinutaWizard({ nota, proyectoId, companyId, autorNombre, personal, cargos, unidades, contratos, contratosProveedores, onClose, onGuardado }: Props) {
  const uid = useId()
  const [borrador, setBorrador] = useState<BorradorMinuta>(() => borradorDesde(nota, autorNombre, hoyLocalISO()))
  const [paso, setPaso] = useState<PasoMinuta>(1)
  const [saving, setSaving] = useState(false)

  // Paso 1: de qué lista se agrega y qué se busca.
  const [tipoLista, setTipoLista] = useState<TipoParticipanteMinuta>('empleado')
  const [busqueda, setBusqueda] = useState('')
  const [otro, setOtro] = useState({ nombre: '', detalle: '' })

  // Residentes de unidad: lectura propia (no viene con la sección).
  const [residentes, setResidentes] = useState<ResidenteProyecto[] | null>(null)
  useEffect(() => {
    let vigente = true
    void fetchResidentesProyecto(proyectoId).then(r => { if (vigente) setResidentes(r) })
    return () => { vigente = false }
  }, [proyectoId])
  const { data: catalogo, isLoading: cargandoProveedores } = useProveedoresQuery(companyId)

  const nombreCargo = useMemo(() => {
    const mapa = new Map(cargos.map(c => [c.codigo, c.nombre]))
    return (codigo: string) => mapa.get(codigo)
  }, [cargos])
  const candidatos = useMemo<Record<TipoParticipanteMinuta, CandidatoParticipante[]>>(() => ({
    empleado: candidatosEmpleados(personal, nombreCargo),
    residente: candidatosResidentes(residentes ?? [], unidades, contratos),
    proveedor: candidatosProveedores((catalogo ?? []) as ProveedorCatalogo[], contratosProveedores),
    otro: [],
  }), [personal, nombreCargo, residentes, unidades, contratos, catalogo, contratosProveedores])
  const visibles = useMemo(() => filtrarCandidatos(candidatos[tipoLista], busqueda), [candidatos, tipoLista, busqueda])
  const cargandoLista = (tipoLista === 'residente' && residentes === null) || (tipoLista === 'proveedor' && cargandoProveedores)

  // Foco al punto o acuerdo recién agregado.
  const enfocarRef = useRef<string | null>(null)
  useEffect(() => {
    if (!enfocarRef.current) return
    const el = document.getElementById(enfocarRef.current)
    enfocarRef.current = null
    el?.focus()
  })

  const set = (patch: Partial<BorradorMinuta>) => setBorrador(b => ({ ...b, ...patch }))

  // ── Participantes ──
  function agregarCandidato(c: CandidatoParticipante) {
    setBorrador(b => yaParticipa(b.participantes, c) ? b : { ...b, participantes: [...b.participantes, participanteDesdeCandidato(c, b.participantes.length === 0)] })
  }
  function agregarOtro() {
    const nombre = otro.nombre.trim()
    if (!nombre) { notify({ variant: 'warning', title: 'Falta el nombre', text: 'Escribe el nombre de la persona.' }); return }
    const c: CandidatoParticipante = { clave: `otro:${nombre}`, tipo: 'otro', ref_id: null, nombre, detalle: otro.detalle.trim() || null }
    if (yaParticipa(borrador.participantes, c)) { notify({ variant: 'info', title: 'Ya está en la minuta', text: nombre }); return }
    agregarCandidato(c)
    setOtro({ nombre: '', detalle: '' })
  }

  // ── Puntos ──
  function agregarPunto() {
    const id = nuevoIdMinuta()
    enfocarRef.current = `${uid}-punto-${id}`
    set({ puntos: [...borrador.puntos, { id, titulo: '', descripcion: '', acuerdos: [] }] })
  }
  const patchPunto = (id: string, patch: Partial<PuntoMinuta>) => set({ puntos: borrador.puntos.map(p => p.id === id ? { ...p, ...patch } : p) })

  // ── Acuerdos ──
  function agregarAcuerdo(puntoId: string, tipo: TipoAcuerdoMinuta) {
    const id = nuevoIdMinuta()
    enfocarRef.current = `${uid}-acuerdo-${id}`
    const nuevo: AcuerdoMinuta = { id, tipo, texto: '', responsable_id: null, fecha_limite: null, cumplido: false }
    set({ puntos: borrador.puntos.map(p => p.id === puntoId ? { ...p, acuerdos: [...p.acuerdos, nuevo] } : p) })
  }
  function patchAcuerdo(puntoId: string, id: string, patch: Partial<AcuerdoMinuta>) {
    set({ puntos: borrador.puntos.map(p => p.id === puntoId ? { ...p, acuerdos: p.acuerdos.map(a => a.id === id ? { ...a, ...patch } : a) } : p) })
  }
  function quitarAcuerdo(puntoId: string, id: string) {
    set({ puntos: borrador.puntos.map(p => p.id === puntoId ? { ...p, acuerdos: p.acuerdos.filter(a => a.id !== id) } : p) })
  }

  // ── Navegación ──
  /** Para llegar a `destino` deben estar completos los pasos anteriores. */
  function irA(destino: PasoMinuta) {
    for (const p of PASOS_MINUTA) {
      if (p.n >= destino) break
      const falta = validarPasoMinuta(borrador, p.n)
      if (falta) { setPaso(p.n); notify({ variant: 'warning', title: `Paso ${p.n} · ${p.label}`, text: falta }); return }
    }
    setPaso(destino)
  }

  async function guardar() {
    if (saving) return
    for (const p of PASOS_MINUTA) {
      const falta = validarPasoMinuta(borrador, p.n)
      if (falta) { setPaso(p.n); notify({ variant: 'warning', title: `Paso ${p.n} · ${p.label}`, text: falta }); return }
    }
    const { participantes, puntos } = depurarBorrador(borrador)
    const campos = {
      titulo: borrador.titulo.trim(),
      contenido: borrador.contenido.trim(),
      categoria: borrador.categoria,
      prioridad: borrador.prioridad,
      fijada: borrador.fijada,
      fecha_recordatorio: borrador.fecha_recordatorio || null,
      fecha_reunion: borrador.fecha_reunion,
      participantes,
      puntos,
    }
    setSaving(true)
    const { error } = nota
      ? await updateCondominioRow('notas_admin', nota.id, campos)
      : await createCondominioRow('notas_admin', { company_id: companyId, project_id: proyectoId, autor: autorNombre || null, ...campos })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'No se pudo guardar la minuta', text: error.message }); return }
    notify({ variant: 'success', title: nota ? 'Minuta actualizada' : 'Minuta guardada' })
    onGuardado()
  }

  // No se cierra a mitad del guardado: cerrar ahí escondería el error.
  const cerrar = () => { if (!saving) onClose() }
  const pasoInfo = PASOS_MINUTA.find(p => p.n === paso)!

  return (
    <EditModal
      title={nota ? '✏️ Editar minuta' : '📝 Nueva minuta'}
      subtitle={`Paso ${paso} de ${PASOS_MINUTA.length} · ${pasoInfo.titulo}`}
      size="lg"
      fullScreenOnMobile
      onClose={cerrar}
      closeOnBackdropClick={!saving}
      closeOnEscape={!saving}
      footer={<>
        <Button variant="secondary" onClick={cerrar} disabled={saving}>Cancelar</Button>
        <span style={{ flex: 1 }} />
        {paso > 1 && <Button variant="secondary" onClick={() => setPaso((paso - 1) as PasoMinuta)} disabled={saving}>← Anterior</Button>}
        {paso < 3 && <Button variant="primary" onClick={() => irA((paso + 1) as PasoMinuta)} disabled={saving}>Siguiente →</Button>}
        {(paso === 3 || nota) && (
          <Button variant={paso === 3 ? 'success' : 'outline-primary'} onClick={() => void guardar()} loading={saving} loadingText="Guardando…">
            {nota ? 'Guardar cambios' : '✅ Guardar minuta'}
          </Button>
        )}
      </>}
    >
      {/* Indicador de pasos */}
      <div role="tablist" aria-label="Pasos de la minuta" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {PASOS_MINUTA.map((p, i) => {
          const activo = paso === p.n
          const hecho = p.n < paso
          return (
            <div key={p.n} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button type="button" role="tab" aria-selected={activo} aria-label={`Paso ${p.n} · ${p.label}`} onClick={() => irA(p.n)}
                style={{ display: 'flex', alignItems: 'center', gap: 7, border: 'none', background: 'none', cursor: 'pointer', padding: '6px 4px', minHeight: 40 }}>
                <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800,
                  background: hecho ? 'var(--at-success)' : activo ? 'var(--at-primary)' : 'var(--at-chip)',
                  color: hecho || activo ? 'var(--at-on-status)' : 'var(--at-ink-3)' }}>{hecho ? '✓' : p.n}</span>
                <span style={{ fontSize: 13, fontWeight: activo ? 700 : 500, color: activo ? 'var(--at-ink)' : 'var(--at-ink-3)' }}>{p.label}</span>
              </button>
              {i < PASOS_MINUTA.length - 1 && <div aria-hidden="true" style={{ width: 22, height: 2, background: hecho ? 'var(--at-success)' : 'var(--at-line)', borderRadius: 1 }} />}
            </div>
          )
        })}
      </div>

      {paso === 1 && (
        <div role="tabpanel" aria-label="Paso 1 · Participantes" style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor={`${uid}-titulo`} style={lbl}>Título de la minuta *</label>
              <input id={`${uid}-titulo`} style={inp} placeholder="Ej. Reunión con el guardia del turno nocturno" value={borrador.titulo}
                onChange={e => set({ titulo: e.target.value })} autoFocus />
            </div>
            <div>
              <label htmlFor={`${uid}-fecha`} style={lbl}>Fecha de la reunión *</label>
              <input id={`${uid}-fecha`} type="date" style={inp} value={borrador.fecha_reunion} onChange={e => set({ fecha_reunion: e.target.value })} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor={`${uid}-objetivo`} style={lbl}>Objetivo de la reunión (opcional)</label>
              <textarea id={`${uid}-objetivo`} style={{ ...inp, minHeight: 64, resize: 'vertical' }} placeholder="Para qué se reunieron"
                value={borrador.contenido} onChange={e => set({ contenido: e.target.value })} />
            </div>
          </div>

          <div style={tarjeta}>
            <h3 style={seccionTitulo}>Participantes ({borrador.participantes.length})</h3>
            <p style={ayuda}>Quien gestiona la minuta es responsable de darle seguimiento. Puedes cambiarlo con «Hacer gestor».</p>
            {borrador.participantes.length === 0 && <p style={{ ...ayuda, fontStyle: 'italic' }}>Aún no hay participantes: agrégalos abajo.</p>}
            <div style={{ display: 'grid', gap: 8 }}>
              {borrador.participantes.map(p => (
                <ParticipanteCard key={p.id} p={p} acciones={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                    {!p.gestiona && (
                      <button type="button" onClick={() => set({ participantes: designarGestor(borrador.participantes, p.id) })}
                        style={{ ...btnIcono, fontSize: 12, fontWeight: 600, color: 'var(--at-primary)', padding: '0 8px' }}>Hacer gestor</button>
                    )}
                    <button type="button" aria-label={`Quitar a ${p.nombre}`} title="Quitar" onClick={() => set({ participantes: quitarParticipante(borrador.participantes, p.id) })} style={btnIcono}>✕</button>
                  </div>
                } />
              ))}
            </div>
          </div>

          <div style={tarjeta}>
            <h3 style={seccionTitulo}>Agregar participante</h3>
            <FilterChips ariaLabel="Tipo de participante" value={tipoLista} onChange={t => { setTipoLista(t); setBusqueda('') }}
              options={TIPOS_PARTICIPANTE.map(t => ({ value: t, label: TIPO_PARTICIPANTE_INFO[t].label, icon: TIPO_PARTICIPANTE_INFO[t].icon, count: t === 'otro' ? undefined : candidatos[t].length }))} />
            {tipoLista !== 'otro' ? (
              <div style={{ marginTop: 10 }}>
                <label htmlFor={`${uid}-buscar`} style={lbl}>Buscar {TIPO_PARTICIPANTE_INFO[tipoLista].plural.toLowerCase()}</label>
                <input id={`${uid}-buscar`} type="search" style={inp} placeholder="Nombre, cargo, unidad…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
                <div role="list" aria-label={TIPO_PARTICIPANTE_INFO[tipoLista].plural} style={{ marginTop: 8, maxHeight: 260, overflowY: 'auto', display: 'grid', gap: 4 }}>
                  {cargandoLista && <p style={ayuda}>Cargando {TIPO_PARTICIPANTE_INFO[tipoLista].plural.toLowerCase()}…</p>}
                  {!cargandoLista && visibles.length === 0 && (
                    <p style={{ ...ayuda, fontStyle: 'italic' }}>
                      {candidatos[tipoLista].length === 0 ? mensajeSinLista(tipoLista) : 'Nadie coincide con la búsqueda.'}
                    </p>
                  )}
                  {visibles.slice(0, MAX_CANDIDATOS).map(c => {
                    const agregado = yaParticipa(borrador.participantes, c)
                    return (
                      <div key={c.clave} role="listitem" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, background: agregado ? 'var(--at-success-tint)' : 'transparent' }}>
                        <Avatar nombre={c.nombre} tipo={c.tipo} size={28} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--at-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nombre}</div>
                          {c.detalle && <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>{c.detalle}</div>}
                        </div>
                        <Button size="sm" variant={agregado ? 'ghost' : 'outline-primary'} disabled={agregado} aria-label={agregado ? `${c.nombre} ya está en la minuta` : `Agregar a ${c.nombre}`}
                          onClick={() => agregarCandidato(c)}>{agregado ? '✓ Agregado' : '+ Agregar'}</Button>
                      </div>
                    )
                  })}
                  {visibles.length > MAX_CANDIDATOS && <p style={ayuda}>Hay más resultados: afina la búsqueda.</p>}
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 10, alignItems: 'end' }}>
                <div>
                  <label htmlFor={`${uid}-otro-nombre`} style={lbl}>Nombre *</label>
                  <input id={`${uid}-otro-nombre`} style={inp} placeholder="Ej. Lic. Rodríguez" value={otro.nombre}
                    onChange={e => setOtro(o => ({ ...o, nombre: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregarOtro() } }} />
                </div>
                <div>
                  <label htmlFor={`${uid}-otro-detalle`} style={lbl}>Detalle</label>
                  <input id={`${uid}-otro-detalle`} style={inp} placeholder="Ej. Abogado externo" value={otro.detalle}
                    onChange={e => setOtro(o => ({ ...o, detalle: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregarOtro() } }} />
                </div>
                <Button variant="outline-primary" onClick={agregarOtro}>+ Agregar</Button>
              </div>
            )}
          </div>
        </div>
      )}

      {paso === 2 && (
        <div role="tabpanel" aria-label="Paso 2 · Puntos" style={{ display: 'grid', gap: 12 }}>
          <p style={ayuda}>Anota cada tema que se trató o se va a tratar con {borrador.participantes.filter(p => !p.gestiona).map(p => p.nombre).join(', ') || 'los participantes'}. En el siguiente paso registras lo acordado en cada uno.</p>
          {borrador.puntos.length === 0 && (
            <div style={{ ...tarjeta, textAlign: 'center', padding: 24, color: 'var(--at-ink-3)', fontSize: 14 }}>Todavía no hay puntos.</div>
          )}
          {borrador.puntos.map((p, i) => (
            <div key={p.id} style={{ ...tarjeta, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', fontWeight: 800, fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 6 }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 8 }}>
                <input id={`${uid}-punto-${p.id}`} aria-label={`Punto ${i + 1}`} style={{ ...inp, fontWeight: 600 }} placeholder="Punto a abordar" value={p.titulo}
                  onChange={e => patchPunto(p.id, { titulo: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregarPunto() } }} />
                <textarea aria-label={`Detalle del punto ${i + 1}`} style={{ ...inp, minHeight: 48, fontSize: 13, resize: 'vertical' }} placeholder="Contexto o detalle (opcional)"
                  value={p.descripcion ?? ''} onChange={e => patchPunto(p.id, { descripcion: e.target.value })} />
              </div>
              <button type="button" aria-label={`Quitar punto ${i + 1}`} title="Quitar punto" style={btnIcono} onClick={() => set({ puntos: borrador.puntos.filter(x => x.id !== p.id) })}>✕</button>
            </div>
          ))}
          <div><Button variant="outline-primary" onClick={agregarPunto}>+ Agregar punto</Button></div>
        </div>
      )}

      {paso === 3 && (
        <div role="tabpanel" aria-label="Paso 3 · Acuerdos" style={{ display: 'grid', gap: 14 }}>
          <p style={ayuda}>Un <strong>acuerdo</strong> es lo que se decidió; un <strong>compromiso</strong> lo asume alguien y tiene fecha límite para darle seguimiento.</p>
          {borrador.puntos.filter(p => p.titulo.trim()).map((p, i) => (
            <div key={p.id} style={tarjeta}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
                <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', fontWeight: 800, fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)' }}>{p.titulo}</div>
                  {p.descripcion?.trim() && <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 2 }}>{p.descripcion}</div>}
                </div>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {p.acuerdos.length === 0 && <p style={{ ...ayuda, margin: 0, fontStyle: 'italic' }}>Sin acuerdos ni compromisos en este punto.</p>}
                {p.acuerdos.map(a => (
                  <div key={a.id} style={{ display: 'grid', gap: 8, padding: 10, borderRadius: 10, background: 'var(--at-surface-2)', border: '1px solid var(--at-line)' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div role="group" aria-label="Tipo" style={{ display: 'inline-flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--at-line-strong)' }}>
                        {(['acuerdo', 'compromiso'] as const).map(t => (
                          <button key={t} type="button" aria-pressed={a.tipo === t} onClick={() => patchAcuerdo(p.id, a.id, { tipo: t })}
                            style={{ border: 'none', cursor: 'pointer', padding: '6px 10px', fontSize: 12, fontWeight: 700, minHeight: 36,
                              background: a.tipo === t ? 'var(--at-primary)' : 'var(--at-surface)', color: a.tipo === t ? 'var(--at-on-status)' : 'var(--at-ink-2)' }}>
                            {TIPO_ACUERDO_INFO[t].icon} {TIPO_ACUERDO_INFO[t].label}
                          </button>
                        ))}
                      </div>
                      <input id={`${uid}-acuerdo-${a.id}`} aria-label={a.tipo === 'compromiso' ? 'Compromiso' : 'Acuerdo'} style={{ ...inp, flex: 1, minWidth: 180 }}
                        placeholder={a.tipo === 'compromiso' ? 'Qué se compromete a hacer' : 'Qué se acordó'} value={a.texto}
                        onChange={e => patchAcuerdo(p.id, a.id, { texto: e.target.value })} />
                      <button type="button" aria-label="Quitar acuerdo" title="Quitar" style={btnIcono} onClick={() => quitarAcuerdo(p.id, a.id)}>✕</button>
                    </div>
                    {a.tipo === 'compromiso' && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 8 }}>
                        <div>
                          <label htmlFor={`${uid}-resp-${a.id}`} style={lbl}>Responsable</label>
                          <select id={`${uid}-resp-${a.id}`} style={inp} value={a.responsable_id ?? ''} onChange={e => patchAcuerdo(p.id, a.id, { responsable_id: e.target.value || null })}>
                            <option value="">Sin asignar</option>
                            {borrador.participantes.map(x => <option key={x.id} value={x.id}>{x.nombre}{x.detalle ? ` · ${x.detalle}` : ''}</option>)}
                          </select>
                        </div>
                        <div>
                          <label htmlFor={`${uid}-limite-${a.id}`} style={lbl}>Fecha límite</label>
                          <input id={`${uid}-limite-${a.id}`} type="date" style={inp} value={a.fecha_limite ?? ''} onChange={e => patchAcuerdo(p.id, a.id, { fecha_limite: e.target.value || null })} />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <Button size="sm" variant="outline-primary" onClick={() => agregarAcuerdo(p.id, 'acuerdo')} aria-label={`Agregar acuerdo al punto ${i + 1}`}>🤝 + Acuerdo</Button>
                <Button size="sm" variant="outline-primary" onClick={() => agregarAcuerdo(p.id, 'compromiso')} aria-label={`Agregar compromiso al punto ${i + 1}`}>📌 + Compromiso</Button>
              </div>
            </div>
          ))}

          <div style={tarjeta}>
            <h3 style={seccionTitulo}>Cierre y seguimiento</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: 10, alignItems: 'end' }}>
              <div>
                <label htmlFor={`${uid}-categoria`} style={lbl}>Categoría</label>
                <select id={`${uid}-categoria`} style={inp} value={borrador.categoria} onChange={e => set({ categoria: e.target.value as CategoriaNota })}>
                  {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`${uid}-prioridad`} style={lbl}>Prioridad</label>
                <select id={`${uid}-prioridad`} style={inp} value={borrador.prioridad} onChange={e => set({ prioridad: e.target.value as PrioridadNota })}>
                  {PRIORIDADES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`${uid}-seguimiento`} style={lbl}>Próximo seguimiento</label>
                <input id={`${uid}-seguimiento`} type="date" style={inp} value={borrador.fecha_recordatorio} onChange={e => set({ fecha_recordatorio: e.target.value })} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer', minHeight: 40 }}>
                <input type="checkbox" checked={borrador.fijada} onChange={e => set({ fijada: e.target.checked })} /> 📌 Fijar arriba
              </label>
            </div>
          </div>
        </div>
      )}
    </EditModal>
  )
}

function mensajeSinLista(tipo: TipoParticipanteMinuta): string {
  switch (tipo) {
    case 'empleado': return 'Este condominio no tiene personal registrado (Recursos Humanos › Personal).'
    case 'residente': return 'No hay propietarios ni inquilinos registrados: asígnalos en las unidades o registra el contrato de arrendamiento.'
    case 'proveedor': return 'No hay proveedores en el catálogo de la empresa ni contratos de proveedor en este condominio.'
    default: return ''
  }
}
