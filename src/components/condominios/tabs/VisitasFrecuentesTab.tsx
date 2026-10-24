// Visitas frecuentes = pre-autorizaciones de ingreso.
//
// El residente solicita desde su portal a la persona de confianza (nace
// 'pendiente'); aquí la administración la aprueba o la rechaza, o registra
// directamente una (nace aprobada). En portería, al registrar el ingreso, el
// guardia la busca y el sistema valida día, horario y vigencia: si cumple el
// ingreso queda pre-autorizado; si no, el guardia confirma con el residente.
import { useState, type CSSProperties } from 'react'
import { deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { validatedInsert } from '../../../lib/validatedInsert'
import { visitaFrecuenteInputSchema } from '../../../domain/condominios/schemas'
import { confirm, notify } from '../../shared/Dialog'
import type { VisitaFrecuente, RelacionVisitaFrecuente, Unidad, Visitante } from '../../../types'
import {
  DIAS_SEMANA, DIA_LABEL_CORTO, ETIQUETA_VISITA_LABEL, RELACIONES_VISITA, VIGENCIA_MAXIMA_MESES,
  describirDias, describirHorario, describirVigencia, estadoVisita, etiquetaVisita, evaluarVisitaFrecuente,
  fechaLocalYMD, venceEnDias, vigenciaMaxima, vigenciaValida,
  type DiaSemana, type EtiquetaVisita,
} from '../../../lib/visitasFrecuentes'

interface Props {
  visitas: VisitaFrecuente[]
  /** Para mostrar los ingresos que cada autorización amparó. */
  visitantes?: Visitante[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  /** Quien aprueba o rechaza (sello `autorizado_por`). */
  userId: string
  canCreate: boolean
  canEdit: boolean
  /** Eliminar tiene su propio permiso (condominios.tab.vis_frecuentes.delete): editar no basta. */
  canDelete: boolean
  onRefresh: () => void
}

type FiltroEstado = 'todas' | EtiquetaVisita

const ESTADO_CHIP: Record<EtiquetaVisita, { bg: string; color: string }> = {
  pendiente:  { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  aprobada:   { bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  rechazada:  { bg: 'var(--at-danger-tint)',  color: 'var(--at-danger)' },
  vencida:    { bg: 'var(--at-danger-tint)',  color: 'var(--at-danger)' },
  suspendida: { bg: 'var(--at-chip)',         color: 'var(--at-ink-3)' },
}

/** Aviso de vencimiento próximo en la lista de administración. */
const DIAS_AVISO_VENCIMIENTO = 30

// La vigencia es obligatoria y de 6 meses como máximo: el formulario arranca
// con el máximo desde hoy, que es lo que casi siempre se quiere.
const formVacio = () => {
  const hoy = fechaLocalYMD(new Date())
  return {
    unidad_id: '', nombre: '', identificacion: '',
    relacion: 'familiar' as RelacionVisitaFrecuente,
    telefono: '', placa_vehiculo: '', dias_permitidos: [] as DiaSemana[],
    hora_desde: '', hora_hasta: '', vigente_desde: hoy, vigente_hasta: vigenciaMaxima(hoy), notas: '',
  }
}

export default function VisitasFrecuentesTab({ visitas, visitantes = [], unidades, proyectoId, companyId, userId, canCreate, canEdit, canDelete, onRefresh }: Props) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroUnidad, setFiltroUnidad] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('todas')
  const [soloActivos, setSoloActivos] = useState(true)
  // Rechazo: el motivo se escribe en la propia tarjeta (el residente lo lee en su portal).
  const [rechazando, setRechazando] = useState<{ id: string; motivo: string } | null>(null)
  // Renovación: la fecha nueva se elige en la propia tarjeta.
  const [renovando, setRenovando] = useState<{ id: string; hasta: string } | null>(null)
  const [procesando, setProcesando] = useState<string | null>(null)
  const [form, setForm] = useState(formVacio)
  const hoy = fechaLocalYMD(new Date())

  const pendientes = visitas.filter(v => estadoVisita(v) === 'pendiente')
  const vencidas = visitas.filter(v => etiquetaVisita(v) === 'vencida')
  const porVencer = visitas.filter(v => etiquetaVisita(v) === 'aprobada' && venceEnDias(v, DIAS_AVISO_VENCIMIENTO))

  const lista = visitas.filter(v =>
    (filtroUnidad === '' || v.unidad_id === filtroUnidad) &&
    (filtroEstado === 'todas' || etiquetaVisita(v) === filtroEstado) &&
    // Lo pendiente y lo vencido se muestran siempre: es lo que hay que atender.
    (!soloActivos || v.activo || estadoVisita(v) === 'pendiente' || etiquetaVisita(v) === 'vencida'),
  )

  // Agrupadas por unidad, con lo pendiente primero dentro de cada una.
  const peso = (v: VisitaFrecuente) => (estadoVisita(v) === 'pendiente' ? 0 : estadoVisita(v) === 'aprobada' ? 1 : 2)
  const porUnidad = lista
    .slice()
    .sort((a, b) => peso(a) - peso(b) || a.nombre.localeCompare(b.nombre))
    .reduce<Record<string, VisitaFrecuente[]>>((acc, v) => {
      (acc[v.unidad_id] ??= []).push(v)
      return acc
    }, {})

  // Ingresos amparados por cada autorización (el guardia los liga al registrar).
  const ingresosPor = visitantes.reduce<Record<string, Visitante[]>>((acc, x) => {
    if (x.visita_frecuente_id) (acc[x.visita_frecuente_id] ??= []).push(x)
    return acc
  }, {})

  function toggleDia(dia: DiaSemana) {
    setForm(p => ({
      ...p,
      dias_permitidos: p.dias_permitidos.includes(dia)
        ? p.dias_permitidos.filter(d => d !== dia)
        : [...p.dias_permitidos, dia],
    }))
  }

  async function guardar() {
    if (!form.unidad_id || !form.nombre.trim()) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'Unidad y nombre son obligatorios' }); return
    }
    if (!form.vigente_desde || !form.vigente_hasta) {
      notify({ variant: 'warning', title: 'Falta la vigencia', text: 'Indique desde y hasta cuándo vale la autorización.' }); return
    }
    if (!vigenciaValida(form.vigente_desde, form.vigente_hasta)) {
      notify({ variant: 'warning', title: 'Vigencia fuera de rango', text: `La autorización dura como máximo ${VIGENCIA_MAXIMA_MESES} meses (hasta ${vigenciaMaxima(form.vigente_desde)}).` }); return
    }
    setSaving(true)
    // Lo que registra la administración nace aprobado, con su sello.
    const { error } = await validatedInsert('visitas_frecuentes', visitaFrecuenteInputSchema, {
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id, nombre: form.nombre.trim(),
      identificacion: form.identificacion.trim() || null,
      relacion: form.relacion,
      telefono: form.telefono.trim() || null,
      placa_vehiculo: form.placa_vehiculo.trim() || null,
      dias_permitidos: form.dias_permitidos.length > 0 ? form.dias_permitidos : null,
      hora_desde: form.hora_desde || null,
      hora_hasta: form.hora_hasta || null,
      vigente_desde: form.vigente_desde,
      vigente_hasta: form.vigente_hasta,
      notas: form.notas.trim() || null,
      estado: 'aprobada',
      autorizado_por: userId,
      autorizado_en: new Date().toISOString(),
      activo: true,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm(formVacio())
    setMostrarForm(false)
    onRefresh()
  }

  async function aprobar(v: VisitaFrecuente) {
    if (!canEdit) return
    setProcesando(v.id)
    const { error } = await updateCondominioRow('visitas_frecuentes', v.id, {
      estado: 'aprobada', autorizado_por: userId, autorizado_en: new Date().toISOString(), motivo_rechazo: null, activo: true,
    })
    setProcesando(null)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    notify({ variant: 'success', title: 'Autorización aprobada', text: `${v.nombre} ya puede ingresar como pre-autorizado en los días y horario indicados.`, duration: 2500 })
    onRefresh()
  }

  async function rechazar(v: VisitaFrecuente, motivo: string) {
    if (!canEdit) return
    if (!motivo.trim()) { notify({ variant: 'warning', title: 'Falta el motivo', text: 'Escriba por qué se rechaza: el residente lo verá en su portal.' }); return }
    setProcesando(v.id)
    const { error } = await updateCondominioRow('visitas_frecuentes', v.id, {
      estado: 'rechazada', autorizado_por: userId, autorizado_en: new Date().toISOString(), motivo_rechazo: motivo.trim(),
    })
    setProcesando(null)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setRechazando(null)
    onRefresh()
  }

  /**
   * Renovación por la administración: rango nuevo desde hoy, queda aprobada
   * con sello nuevo. (La que pide el residente desde su portal vuelve a
   * 'pendiente' y pasa por Aprobar como cualquier solicitud.)
   */
  async function renovar(v: VisitaFrecuente, hasta: string) {
    if (!canEdit) return
    if (!hasta || !vigenciaValida(hoy, hasta)) {
      notify({ variant: 'warning', title: 'Vigencia fuera de rango', text: `La renovación va de hoy a como máximo ${vigenciaMaxima(hoy)} (${VIGENCIA_MAXIMA_MESES} meses).` }); return
    }
    setProcesando(v.id)
    const { error } = await updateCondominioRow('visitas_frecuentes', v.id, {
      vigente_desde: hoy, vigente_hasta: hasta,
      estado: 'aprobada', autorizado_por: userId, autorizado_en: new Date().toISOString(), motivo_rechazo: null,
      renovaciones: (v.renovaciones ?? 0) + 1, activo: true,
    })
    setProcesando(null)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setRenovando(null)
    notify({ variant: 'success', title: 'Autorización renovada', text: `${v.nombre} queda autorizado hasta el ${hasta}.`, duration: 2500 })
    onRefresh()
  }

  async function toggleActivo(v: VisitaFrecuente) {
    const { error } = await updateCondominioRow('visitas_frecuentes', v.id, { activo: !v.activo })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  async function eliminar(v: VisitaFrecuente) {
    // El botón ya se oculta sin permiso; esto cubre cualquier otra vía.
    if (!canDelete) return
    const res = await confirm({ title: 'Eliminar visita frecuente', text: `¿Eliminar a ${v.nombre}?`, icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!res.isConfirmed) return
    await deleteCondominioRow('visitas_frecuentes', v.id)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }
  const btnChico = (bg: string, color: string): CSSProperties => ({ padding: '5px 10px', background: bg, color, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 })

  return (
    <div style={{ padding: 16 }}>
      {/* Qué es esto y cómo se usa */}
      <div style={{ background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 12.5, color: 'var(--at-ink-2)', lineHeight: 1.5 }}>
        <strong>Pre-autorizaciones de ingreso.</strong> El residente registra desde su portal a las personas de confianza (empleados, familiares, proveedores) con sus días, horario y vigencia; aquí la administración las aprueba.
        En portería, al registrar el ingreso, el sistema verifica día, horario y vigencia: si cumple, entra como <strong>pre-autorizado</strong>; si no, el guardia confirma con el residente antes de dar el ingreso.
        Toda autorización vale como máximo <strong>{VIGENCIA_MAXIMA_MESES} meses</strong>; al vencer deja de servir en portería y hay que renovarla (el residente la solicita y aquí se aprueba, o se renueva directo).
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {pendientes.length > 0 && (
            <button type="button" onClick={() => setFiltroEstado(filtroEstado === 'pendiente' ? 'todas' : 'pendiente')} aria-pressed={filtroEstado === 'pendiente'}
              style={{ ...btnChico('var(--at-warning-tint)', 'var(--at-warning-strong)'), padding: '7px 12px', border: `1.5px solid ${filtroEstado === 'pendiente' ? 'var(--at-warning)' : 'var(--at-warning-border)'}` }}>
              ⏳ {pendientes.length} pendiente{pendientes.length !== 1 ? 's' : ''} de aprobación
            </button>
          )}
          {vencidas.length > 0 && (
            <button type="button" onClick={() => setFiltroEstado(filtroEstado === 'vencida' ? 'todas' : 'vencida')} aria-pressed={filtroEstado === 'vencida'}
              style={{ ...btnChico('var(--at-danger-tint)', 'var(--at-danger)'), padding: '7px 12px', border: `1.5px solid ${filtroEstado === 'vencida' ? 'var(--at-danger)' : 'var(--at-danger-tint)'}` }}>
              ⌛ {vencidas.length} vencida{vencidas.length !== 1 ? 's' : ''} por renovar
            </button>
          )}
          {porVencer.length > 0 && (
            <span style={{ fontSize: 12, color: 'var(--at-warning-strong)' }}>· {porVencer.length} vence{porVencer.length !== 1 ? 'n' : ''} en {DIAS_AVISO_VENCIMIENTO} días</span>
          )}
          <select aria-label="Filtrar por unidad" style={{ ...inp, width: 'auto', padding: '6px 10px' }} value={filtroUnidad} onChange={e => setFiltroUnidad(e.target.value)}>
            <option value="">Todas las unidades</option>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
          <select aria-label="Filtrar por estado" style={{ ...inp, width: 'auto', padding: '6px 10px' }} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as FiltroEstado)}>
            <option value="todas">Todos los estados</option>
            <option value="pendiente">Pendientes</option>
            <option value="aprobada">Aprobadas y vigentes</option>
            <option value="vencida">Vencidas</option>
            <option value="suspendida">Suspendidas</option>
            <option value="rechazada">Rechazadas</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={soloActivos} onChange={e => setSoloActivos(e.target.checked)} />
            Solo activos
          </label>
          <span style={{ fontSize: 13, color: 'var(--at-ink-3)' }}>{lista.length} visitas frecuentes</span>
        </div>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Agregar visita frecuente'}
          </button>
        )}
      </div>

      {/* Formulario (administración: nace aprobada) */}
      {mostrarForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>Nueva visita frecuente</div>
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 12 }}>Registrada por la administración: queda aprobada de inmediato.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl} htmlFor="vf-unidad">Unidad *</label>
              <select id="vf-unidad" style={inp} value={form.unidad_id} onChange={e => setForm(p => ({ ...p, unidad_id: e.target.value }))}>
                <option value="">— Seleccionar —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl} htmlFor="vf-nombre">Nombre *</label>
              <input id="vf-nombre" style={inp} placeholder="Juan Pérez" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
            </div>
            <div>
              <label style={lbl} htmlFor="vf-relacion">Relación</label>
              <select id="vf-relacion" style={inp} value={form.relacion} onChange={e => setForm(p => ({ ...p, relacion: e.target.value as RelacionVisitaFrecuente }))}>
                {RELACIONES_VISITA.map(r => <option key={r.value} value={r.value}>{r.icon} {r.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl} htmlFor="vf-identificacion">Identificación</label>
              <input id="vf-identificacion" style={inp} placeholder="DPI, Pasaporte…" value={form.identificacion} onChange={e => setForm(p => ({ ...p, identificacion: e.target.value }))} />
            </div>
            <div>
              <label style={lbl} htmlFor="vf-telefono">Teléfono</label>
              <input id="vf-telefono" style={inp} value={form.telefono} onChange={e => setForm(p => ({ ...p, telefono: e.target.value }))} />
            </div>
            <div>
              <label style={lbl} htmlFor="vf-placa">Placa vehículo</label>
              <input id="vf-placa" style={inp} value={form.placa_vehiculo} onChange={e => setForm(p => ({ ...p, placa_vehiculo: e.target.value }))} />
            </div>
            <div>
              <label style={lbl} htmlFor="vf-hora-desde">Hora permitida desde</label>
              <input id="vf-hora-desde" type="time" style={inp} value={form.hora_desde} onChange={e => setForm(p => ({ ...p, hora_desde: e.target.value }))} />
            </div>
            <div>
              <label style={lbl} htmlFor="vf-hora-hasta">Hora permitida hasta</label>
              <input id="vf-hora-hasta" type="time" style={inp} value={form.hora_hasta} onChange={e => setForm(p => ({ ...p, hora_hasta: e.target.value }))} />
            </div>
            <div>
              <label style={lbl} htmlFor="vf-vigente-desde">Vigente desde *</label>
              <input id="vf-vigente-desde" type="date" style={inp} value={form.vigente_desde} required
                onChange={e => {
                  const desde = e.target.value
                  // Si el "hasta" se sale del máximo nuevo, se ajusta al máximo.
                  setForm(p => ({ ...p, vigente_desde: desde, vigente_hasta: desde && p.vigente_hasta && !vigenciaValida(desde, p.vigente_hasta) ? vigenciaMaxima(desde) : p.vigente_hasta }))
                }} />
            </div>
            <div>
              <label style={lbl} htmlFor="vf-vigente-hasta">Vigente hasta * (máx. {VIGENCIA_MAXIMA_MESES} meses)</label>
              <input id="vf-vigente-hasta" type="date" style={inp} required min={form.vigente_desde || undefined} max={form.vigente_desde ? vigenciaMaxima(form.vigente_desde) : undefined}
                value={form.vigente_hasta} onChange={e => setForm(p => ({ ...p, vigente_hasta: e.target.value }))} />
              <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>Al vencer, hay que renovarla.</div>
            </div>
            <div>
              <label style={lbl} htmlFor="vf-notas">Notas</label>
              <input id="vf-notas" style={inp} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} />
            </div>
          </div>
          {/* Días permitidos */}
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Días permitidos (dejar vacío = todos)</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {DIAS_SEMANA.map(d => (
                <button key={d} type="button" onClick={() => toggleDia(d)} aria-pressed={form.dias_permitidos.includes(d)}
                  style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid', fontSize: 12, cursor: 'pointer', background: form.dias_permitidos.includes(d) ? 'var(--at-accent)' : 'var(--at-surface)', color: form.dias_permitidos.includes(d) ? 'white' : 'var(--at-ink-2)', borderColor: form.dias_permitidos.includes(d) ? 'var(--at-accent)' : 'var(--at-line-strong)' }}>
                  {DIA_LABEL_CORTO[d]}
                </button>
              ))}
            </div>
          </div>
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Guardar y aprobar'}
          </button>
        </div>
      )}

      {/* Lista agrupada por unidad */}
      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0', fontSize: 13 }}>
          {filtroEstado === 'pendiente' ? 'No hay solicitudes pendientes de aprobación' : 'Sin visitas frecuentes registradas'}
        </div>
      ) : (
        Object.entries(porUnidad).map(([unidadId, items]) => {
          const unidad = unidades.find(u => u.id === unidadId)
          const aprobadas = items.filter(v => estadoVisita(v) === 'aprobada' && v.activo).length
          return (
            <div key={unidadId} style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--at-ink-2)', marginBottom: 8, paddingBottom: 4, borderBottom: '2px solid var(--at-line)' }}>
                🏠 {unidad?.nombre || 'Unidad desconocida'} — {aprobadas} autorizado(s)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 10 }}>
                {items.map(v => {
                  const rel = RELACIONES_VISITA.find(r => r.value === v.relacion)
                  const estado = estadoVisita(v)
                  const etiqueta = etiquetaVisita(v)
                  const chip = ESTADO_CHIP[etiqueta]
                  const esRenovacion = estado === 'pendiente' && (v.renovaciones ?? 0) > 0
                  const vencePronto = etiqueta === 'aprobada' && venceEnDias(v, DIAS_AVISO_VENCIMIENTO)
                  const ingresos = ingresosPor[v.id] ?? []
                  const ultimo = ingresos.slice().sort((a, b) => b.hora_entrada.localeCompare(a.hora_entrada))[0]
                  const ev = etiqueta === 'aprobada' ? evaluarVisitaFrecuente(v) : null
                  const enRechazo = rechazando?.id === v.id
                  const enRenovacion = renovando?.id === v.id
                  const ocupado = procesando === v.id
                  return (
                    <div key={v.id} style={{ background: v.activo ? 'var(--at-surface)' : 'var(--at-surface-2)', border: `1px solid ${estado === 'pendiente' ? 'var(--at-warning-border)' : etiqueta === 'vencida' ? 'var(--at-danger-tint)' : 'var(--at-line)'}`, borderRadius: 10, padding: '12px 14px', opacity: v.activo || estado === 'pendiente' || etiqueta === 'vencida' ? 1 : 0.6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{rel?.icon} {v.nombre}</span>
                            <span style={{ padding: '2px 7px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, background: chip.bg, color: chip.color }}>
                              {esRenovacion ? 'Renovación pendiente' : ETIQUETA_VISITA_LABEL[etiqueta]}
                            </span>
                            {vencePronto && <span style={{ padding: '2px 7px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' }}>Vence el {v.vigente_hasta?.slice(0, 10)}</span>}
                            {(v.renovaciones ?? 0) > 0 && estado !== 'pendiente' && <span style={{ padding: '2px 7px', borderRadius: 20, fontSize: 10.5, background: 'var(--at-chip)', color: 'var(--at-ink-3)' }}>Renovada {v.renovaciones}×</span>}
                            {ev && (
                              <span title={ev.cumple ? 'Si se presentara ahora, entraría como pre-autorizado' : ev.motivos.join(' · ')}
                                style={{ padding: '2px 7px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, background: ev.cumple ? 'var(--at-success-tint)' : 'var(--at-chip)', color: ev.cumple ? 'var(--at-success)' : 'var(--at-ink-3)' }}>
                                {ev.cumple ? 'En horario ahora' : 'Fuera de horario ahora'}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 2 }}>
                            {rel?.label}
                            {v.identificacion && <span> · {v.identificacion}</span>}
                          </div>
                          {v.telefono && <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>📞 {v.telefono}</div>}
                          {v.placa_vehiculo && <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>🚗 {v.placa_vehiculo}</div>}
                          <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap' }} aria-label={`Días permitidos: ${describirDias(v)}`}>
                            {DIAS_SEMANA.map(d => {
                              const on = !v.dias_permitidos || v.dias_permitidos.length === 0 || v.dias_permitidos.includes(d)
                              return (
                                <span key={d} style={{ padding: '2px 5px', borderRadius: 4, fontSize: 10, background: on ? 'var(--at-accent-tint)' : 'var(--at-chip)', color: on ? 'var(--at-accent)' : 'var(--at-line-strong)', fontWeight: on ? 700 : 400 }}>
                                  {DIA_LABEL_CORTO[d]}
                                </span>
                              )
                            })}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 3 }}>
                            ⏰ {describirHorario(v)}
                            {describirVigencia(v) && <span> · 📅 {describirVigencia(v)}</span>}
                          </div>
                          {estado === 'rechazada' && v.motivo_rechazo && (
                            <div style={{ fontSize: 11.5, color: 'var(--at-danger)', marginTop: 4 }}>Motivo del rechazo: {v.motivo_rechazo}</div>
                          )}
                          {estado === 'aprobada' && v.autorizado_en && (
                            <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 3 }}>
                              Aprobada el {new Date(v.autorizado_en).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                              {v.creado_por && v.autorizado_por && v.creado_por !== v.autorizado_por ? ' · solicitada por el residente' : ''}
                            </div>
                          )}
                          {estado === 'pendiente' && (
                            <div style={{ fontSize: 11, color: 'var(--at-warning-strong)', marginTop: 3 }}>
                              Solicitada por el residente el {new Date(v.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </div>
                          )}
                          {ingresos.length > 0 && ultimo && (
                            <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 3 }}>
                              🚪 {ingresos.length} ingreso{ingresos.length !== 1 ? 's' : ''} · último {new Date(ultimo.hora_entrada).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                              {ultimo.autorizacion_ingreso === 'residente' ? ' (autorizó residente)' : ''}
                            </div>
                          )}
                        </div>
                        {(canEdit || canDelete) && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                            {canEdit && estado !== 'pendiente' && etiqueta !== 'vencida' && (
                              <button onClick={() => toggleActivo(v)} title={v.activo ? 'Suspender' : 'Reactivar'} aria-label={`${v.activo ? 'Suspender' : 'Reactivar'} ${v.nombre}`}
                                style={{ padding: '4px 8px', background: v.activo ? 'var(--at-chip)' : 'var(--at-success-tint)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>
                                {v.activo ? '⏸' : '▶'}
                              </button>
                            )}
                            {canDelete && (
                              <button onClick={() => eliminar(v)} title="Eliminar" aria-label={`Eliminar ${v.nombre}`}
                                style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-danger)' }}>
                                🗑
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {v.notas && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 6, fontStyle: 'italic' }}>{v.notas}</div>}

                      {/* Aprobar / rechazar (administración) */}
                      {canEdit && estado === 'pendiente' && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--at-line)' }}>
                          {enRechazo ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              <label style={lbl} htmlFor={`vf-rechazo-${v.id}`}>Motivo del rechazo (lo verá el residente)</label>
                              <input id={`vf-rechazo-${v.id}`} style={inp} autoFocus value={rechazando.motivo} placeholder="Ej. falta identificación, horario no permitido…"
                                onChange={e => setRechazando({ id: v.id, motivo: e.target.value })} />
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button type="button" disabled={ocupado} onClick={() => rechazar(v, rechazando.motivo)} style={btnChico('var(--at-danger)', 'white')}>Confirmar rechazo</button>
                                <button type="button" disabled={ocupado} onClick={() => setRechazando(null)} style={btnChico('var(--at-chip)', 'var(--at-ink-2)')}>Cancelar</button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button type="button" disabled={ocupado} onClick={() => aprobar(v)} aria-label={`Aprobar ${v.nombre}`} style={btnChico('var(--at-success)', 'var(--at-on-status)')}>
                                {ocupado ? 'Guardando…' : '✅ Aprobar'}
                              </button>
                              <button type="button" disabled={ocupado} onClick={() => setRechazando({ id: v.id, motivo: '' })} aria-label={`Rechazar ${v.nombre}`} style={btnChico('var(--at-danger-tint)', 'var(--at-danger)')}>
                                ✕ Rechazar
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      {canEdit && estado === 'rechazada' && (
                        <div style={{ marginTop: 8 }}>
                          <button type="button" disabled={ocupado} onClick={() => aprobar(v)} aria-label={`Aprobar ${v.nombre}`} style={btnChico('var(--at-success-tint)', 'var(--at-success)')}>
                            ✅ Aprobar de todas formas
                          </button>
                        </div>
                      )}

                      {/* Renovar (vencida o por vencer): rango nuevo desde hoy, máximo 6 meses */}
                      {canEdit && (etiqueta === 'vencida' || vencePronto) && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--at-line)' }}>
                          {enRenovacion ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              <label style={lbl} htmlFor={`vf-renovar-${v.id}`}>Nueva vigencia: de hoy ({hoy}) hasta (máx. {vigenciaMaxima(hoy)})</label>
                              <input id={`vf-renovar-${v.id}`} type="date" style={inp} min={hoy} max={vigenciaMaxima(hoy)} value={renovando.hasta}
                                onChange={e => setRenovando({ id: v.id, hasta: e.target.value })} />
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button type="button" disabled={ocupado} onClick={() => renovar(v, renovando.hasta)} style={btnChico('var(--at-success)', 'var(--at-on-status)')}>{ocupado ? 'Guardando…' : 'Confirmar renovación'}</button>
                                <button type="button" disabled={ocupado} onClick={() => setRenovando(null)} style={btnChico('var(--at-chip)', 'var(--at-ink-2)')}>Cancelar</button>
                              </div>
                            </div>
                          ) : (
                            <button type="button" disabled={ocupado} onClick={() => setRenovando({ id: v.id, hasta: vigenciaMaxima(hoy) })} aria-label={`Renovar ${v.nombre}`} style={btnChico(etiqueta === 'vencida' ? 'var(--at-danger-tint)' : 'var(--at-warning-tint)', etiqueta === 'vencida' ? 'var(--at-danger)' : 'var(--at-warning-strong)')}>
                              🔄 {etiqueta === 'vencida' ? 'Renovar autorización vencida' : 'Renovar antes de que venza'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
