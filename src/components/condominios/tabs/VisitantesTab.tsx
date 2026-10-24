import { useState, useEffect, useMemo, useRef } from 'react'
import { useHoyDate } from '../../../hooks/useHoy'
import { notify } from '../../shared/Dialog'
import { createCondominioRow, updateCondominioRow, updateCondominioRowsByIds } from '../../../domain/condominios/tabMutations'
import { fetchHuespedesByReservas } from '../../../domain/condominios/tabQueries'
import { validatedInsert, validatedInsertMany } from '../../../lib/validatedInsert'
import { visitanteInputSchema } from '../../../domain/condominios/schemas'
import type { Visitante, Unidad, ReservaSTR, HuespedSTR, SolicitudMudanzaUnidad, VisitaFrecuente } from '../../../types'
import { rangosDeFecha, kpisVisitantes, sugerenciasVisitantes, filtrarVisitantes, agruparVisitantes, type FiltroFechaVisitas } from '../../../lib/visitantesFiltros'
import {
  autorizacionResidenteVacia, buscarVisitasFrecuentes, describirAutorizacionResidente, evaluarVisitaFrecuente, relacionLabel,
  type AutorizacionResidenteForm,
} from '../../../lib/visitasFrecuentes'
import type { VisitantesCtx } from './visitantes/ctx'
import { defaultAcompForm, type AcompananteForm, type TipoNovedad, type PrioridadNovedad } from './visitantes/ctx'
import { PLATAFORMA_LABEL, TIPO_MUDANZA_LABEL } from './visitantes/ui'
import { StrModal } from './visitantes/StrModal'
import { MudanzaModal } from './visitantes/MudanzaModal'
import { RegistroForm } from './visitantes/RegistroForm'
import { ListaVisitantes } from './visitantes/ListaVisitantes'
import { VisitanteDetalle } from './visitantes/VisitanteDetalle'
import { SalidaPanel } from './visitantes/SalidaPanel'
import { exportarPDFTabla, exportarExcel } from '../exportUtils'
import { diasEntreFechasCalendario } from '../../../lib/format'


interface Props {
  visitantes: Visitante[]
  unidades: Unidad[]
  reservasSTR: ReservaSTR[]
  solicitudesMudanza: SolicitudMudanzaUnidad[]
  /**
   * Pre-autorizaciones del proyecto. Al registrar, el guardia las busca por
   * nombre/DPI/placa y el sistema valida día, horario y vigencia: si cumple el
   * ingreso queda pre-autorizado; si no, hay que confirmar con el residente.
   */
  visitasFrecuentes?: VisitaFrecuente[]
  proyectoId: string
  companyId: string
  userId: string
  proyectoNombre?: string
  canCreate: boolean
  onRefresh: () => void
}

type FiltroFecha = FiltroFechaVisitas

export function VisitantesTab({ visitantes, unidades, reservasSTR, solicitudesMudanza, visitasFrecuentes = [], proyectoId, companyId, userId, proyectoNombre = 'Condominio', canCreate, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [soloActivos, setSoloActivos] = useState(false)
  const [filtroFecha, setFiltroFecha] = useState<FiltroFecha>('hoy')
  const [salidaPendiente, setSalidaPendiente] = useState<Visitante | null>(null)
  const [modoSalida, setModoSalida] = useState<'idle' | 'sin_novedad' | 'con_novedad'>('idle')
  const [guardandoSalida, setGuardandoSalida] = useState(false)
  const [novedadForm, setNovedadForm] = useState({ tipo: 'incidente' as TipoNovedad, comentarios: '', ubicacion: '', prioridad: 'normal' as PrioridadNovedad })
  const [fotosNovedad, setFotosNovedad] = useState<string[]>([])
  // El detalle lee el registro vigente de la lista (antes guardaba una copia:
  // tras registrar la salida seguía diciendo «En premisas»).
  const [visitanteDetalleId, setVisitanteDetalleId] = useState<string | null>(null)
  const visitanteDetalle = visitanteDetalleId ? visitantes.find(v => v.id === visitanteDetalleId) ?? null : null
  const setVisitanteDetalle = (v: Visitante | null) => setVisitanteDetalleId(v?.id ?? null)
  /**
   * La salida ya guardada de `salidaPendiente`, si lo que falló fue la novedad:
   * reintentar sólo crea la novedad, sin volver a escribir la hora de salida.
   */
  const salidaYaRegistrada = useRef<{ id: string; hora: string } | null>(null)
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [fotoDocumentoUrl, setFotoDocumentoUrl] = useState<string | null>(null)
  const [fotoVehiculoUrl, setFotoVehiculoUrl] = useState<string | null>(null)
  const [fotosExpiradas, setFotosExpiradas] = useState<{ foto: boolean; documento: boolean; vehiculo: boolean }>({ foto: false, documento: false, vehiculo: false })
  const [showStrModal, setShowStrModal] = useState(false)
  const [strSearch, setStrSearch] = useState('')
  const [strHuespedes, setStrHuespedes] = useState<Record<string, HuespedSTR[]>>({})
  const [strCtx, setStrCtx] = useState<{ reservaId: string; huespedId?: string } | null>(null)
  const [showMudanzaModal, setShowMudanzaModal] = useState(false)
  const [mudanzaSearch, setMudanzaSearch] = useState('')
  const [mudanzaCtx, setMudanzaCtx] = useState<{ solicitudId: string } | null>(null)
  const [form, setForm] = useState({ unidad_id: '', nombre: '', identificacion: '', placa_vehiculo: '', motivo: '', notas: '' })
  // Pre-autorización: la visita frecuente elegida para este ingreso y, si no
  // cumple día/horario/vigencia, lo que respondió el residente.
  const [visitaFrecuenteSel, setVisitaFrecuenteSel] = useState<VisitaFrecuente | null>(null)
  const [autorizacionResidente, setAutorizacionResidente] = useState<AutorizacionResidenteForm>(autorizacionResidenteVacia)

  // Minor & companions state
  const [formEsMenor, setFormEsMenor] = useState(false)
  const [formFechaNacimiento, setFormFechaNacimiento] = useState('')
  const [acompanantes, setAcompanantes] = useState<AcompananteForm[]>([])
  const [showAcompForm, setShowAcompForm] = useState(false)
  const [acompForm, setAcompForm] = useState(defaultAcompForm())
  const [salidaConAcomp, setSalidaConAcomp] = useState(true)

  // `rangosDeFecha()` sin argumento devolvía un objeto nuevo por render, así
  // que `hoy` no podía declararse como dependencia del efecto de abajo sin
  // dispararlo en cada render. Anclado al día (estable hasta la medianoche).
  const ahora = useHoyDate()
  const rangos = useMemo(() => rangosDeFecha(ahora), [ahora])
  const { hoy, inicioSemana } = rangos

  // Fetch pre-registered guests when STR modal opens
  useEffect(() => {
    if (!showStrModal) return
    const activas = reservasSTR.filter(r => (r.estado === 'confirmada' || r.estado === 'en_curso') && r.fecha_salida >= hoy)
    if (activas.length === 0) return
    // Respuesta fuera de orden: si el modal se cierra (o cambian las reservas)
    // antes de que resuelva el fetch, el resultado viejo no pisa el estado.
    let cancelado = false
    void fetchHuespedesByReservas<HuespedSTR>(activas.map(r => r.id)).then(data => {
      const grouped: Record<string, HuespedSTR[]> = {}
      data.forEach(h => {
        if (!grouped[h.reserva_str_id]) grouped[h.reserva_str_id] = []
        grouped[h.reserva_str_id].push(h)
      })
      if (cancelado) return
      setStrHuespedes(grouped)
    })
    return () => { cancelado = true }
  }, [showStrModal, reservasSTR, hoy])

  // Derivados puros (lib/visitantesFiltros, con tests): KPIs sin doble conteo
  // de acompañantes, sugerencias dedup, filtro combinado y agrupación.
  const { visitasHoy, enPremisas, estaSemana, totalHistorico } = kpisVisitantes(visitantes, rangos)
  const sugerencias = sugerenciasVisitantes(visitantes, form.nombre, form.identificacion)
  const acompSugerencias = sugerenciasVisitantes(
    visitantes, acompForm.nombre, acompForm.identificacion, acompanantes.map(a => a.nombre),
  )
  const filtrados = filtrarVisitantes(visitantes, { busqueda, soloActivos, filtroFecha, rangos })
  const { strGruposMap, mudanzaGruposMap, regulares } = agruparVisitantes(filtrados, reservasSTR, solicitudesMudanza)

  // Pre-autorizados que coinciden con lo tecleado (sólo mientras no haya uno
  // elegido). La evaluación se hace al render con la hora actual del
  // dispositivo del guardia y se repite al guardar, que es la que vale.
  const frecuentesSugeridas = visitaFrecuenteSel
    ? []
    : buscarVisitasFrecuentes(visitasFrecuentes, { nombre: form.nombre, identificacion: form.identificacion, placa: form.placa_vehiculo })
  const evaluacionFrecuente = visitaFrecuenteSel ? evaluarVisitaFrecuente(visitaFrecuenteSel) : null
  const requiereAutorizacionResidente = !!evaluacionFrecuente && !evaluacionFrecuente.cumple

  // Eligible mudanzas for guard check-in: aprobada / programada / en_curso
  const mudanzasElegibles = solicitudesMudanza.filter(s =>
    s.estado === 'aprobada' || s.estado === 'programada' || s.estado === 'en_curso'
  )


  function resetForm() {
    setForm({ unidad_id: '', nombre: '', identificacion: '', placa_vehiculo: '', motivo: '', notas: '' })
    setFotoUrl(null)
    setFotoDocumentoUrl(null)
    setFotoVehiculoUrl(null)
    setFotosExpiradas({ foto: false, documento: false, vehiculo: false })
    setFormEsMenor(false)
    setFormFechaNacimiento('')
    setAcompanantes([])
    setShowAcompForm(false)
    setAcompForm(defaultAcompForm())
    setStrCtx(null)
    setMudanzaCtx(null)
    setVisitaFrecuenteSel(null)
    setAutorizacionResidente(autorizacionResidenteVacia())
    setShowForm(false)
  }

  function seleccionarFrecuente(vf: VisitaFrecuente) {
    setForm(f => ({
      ...f,
      nombre: vf.nombre,
      identificacion: vf.identificacion ?? '',
      placa_vehiculo: vf.placa_vehiculo ?? f.placa_vehiculo,
      unidad_id: vf.unidad_id,
      motivo: f.motivo || `Visita frecuente · ${relacionLabel(vf.relacion)}`,
    }))
    if (vf.foto_url) setFotoUrl(vf.foto_url)
    setFotosExpiradas({ foto: false, documento: false, vehiculo: false })
    setStrCtx(null)
    setMudanzaCtx(null)
    setVisitaFrecuenteSel(vf)
    setAutorizacionResidente(autorizacionResidenteVacia())
  }

  function quitarFrecuente() {
    setVisitaFrecuenteSel(null)
    setAutorizacionResidente(autorizacionResidenteVacia())
  }

  function abrirRegistroMudanza(s: SolicitudMudanzaUnidad) {
    const fechaEfectiva = s.fecha_autorizada ?? s.fecha_solicitada ?? ''
    const horaEfectiva = s.hora_autorizada ?? s.hora_solicitada ?? ''
    const notasPartes: string[] = []
    notasPartes.push(`Mudanza autorizada · ${fechaEfectiva}${horaEfectiva ? ` ${horaEfectiva}` : ''}`)
    if (s.empresa_mudanza) notasPartes.push(`Empresa: ${s.empresa_mudanza}`)
    if (s.telefono) notasPartes.push(`Tel: ${s.telefono}`)
    if (s.hora_fin) notasPartes.push(`Hora fin: ${s.hora_fin}`)
    if (s.ascensor_reservado) notasPartes.push('Ascensor reservado')
    setForm({
      nombre: s.empresa_mudanza ? `Personal mudanza (${s.empresa_mudanza})` : 'Personal de mudanza',
      unidad_id: s.unidad_id,
      placa_vehiculo: '',
      motivo: `Mudanza · ${TIPO_MUDANZA_LABEL[s.tipo_mudanza] ?? s.tipo_mudanza}`,
      notas: notasPartes.join(' · '),
      identificacion: '',
    })
    setFotoUrl(null)
    setFotoDocumentoUrl(null)
    setFotoVehiculoUrl(null)
    setFotosExpiradas({ foto: false, documento: false, vehiculo: false })
    setFormEsMenor(false)
    setFormFechaNacimiento('')
    setAcompanantes([])
    setShowAcompForm(false)
    setStrCtx(null)
    setMudanzaCtx({ solicitudId: s.id })
    setVisitaFrecuenteSel(null)
    setAutorizacionResidente(autorizacionResidenteVacia())
    setShowMudanzaModal(false)
    setMudanzaSearch('')
    setShowForm(true)
  }

  function abrirRegistroSTR(r: ReservaSTR, huesped?: HuespedSTR) {
    const noches = Math.max(0, diasEntreFechasCalendario(r.fecha_entrada, r.fecha_salida) ?? 0)
    setForm({
      nombre: huesped ? huesped.nombre : r.huesped_nombre,
      unidad_id: r.unidad_id ?? '',
      placa_vehiculo: '',
      motivo: `Renta corta · ${PLATAFORMA_LABEL[r.plataforma] ?? r.plataforma}`,
      notas: `Entrada: ${r.fecha_entrada} · Salida: ${r.fecha_salida} (${noches} noche${noches !== 1 ? 's' : ''})`,
      identificacion: huesped ? (huesped.identificacion ?? '') : '',
    })
    setFotoUrl(huesped?.foto_url ?? r.foto_url ?? null)
    setFotoDocumentoUrl(huesped?.foto_documento_url ?? r.foto_documento_url ?? null)
    setFormEsMenor(huesped?.es_menor ?? false)
    setFormFechaNacimiento(huesped?.fecha_nacimiento ?? '')
    setFotoVehiculoUrl(null)
    setFotosExpiradas({ foto: false, documento: false, vehiculo: false })
    setAcompanantes([])
    setShowAcompForm(false)
    setStrCtx({ reservaId: r.id, huespedId: huesped?.id })
    setMudanzaCtx(null)
    setVisitaFrecuenteSel(null)
    setAutorizacionResidente(autorizacionResidenteVacia())
    setShowStrModal(false)
    setStrSearch('')
    setShowForm(true)
  }

  function autocompletar(v: Visitante) {
    const mismoVisitante = [...visitantes]
      .filter(r => r.nombre === v.nombre && r.identificacion === v.identificacion)
      .sort((a, b) => b.hora_entrada.localeCompare(a.hora_entrada))
    const registroFoto     = mismoVisitante.find(r => r.foto_url)
    const registroDoc      = mismoVisitante.find(r => r.foto_documento_url)
    const registroVehiculo = mismoVisitante.find(r => r.foto_vehiculo_url)
    const DIAS_90 = 90 * 24 * 60 * 60 * 1000
    const ahora = Date.now()
    const esVencida = (r: Visitante | undefined) => !!r && (ahora - new Date(r.hora_entrada).getTime()) > DIAS_90
    setFotosExpiradas({
      foto:      esVencida(registroFoto),
      documento: esVencida(registroDoc),
      vehiculo:  esVencida(registroVehiculo),
    })
    setForm(f => ({
      ...f,
      nombre: v.nombre,
      identificacion: v.identificacion ?? '',
      placa_vehiculo: v.placa_vehiculo ?? '',
      unidad_id: v.unidad_id,
      motivo: v.motivo ?? '',
    }))
    setFotoUrl(registroFoto?.foto_url ?? null)
    setFotoDocumentoUrl(registroDoc?.foto_documento_url ?? null)
    setFotoVehiculoUrl(registroVehiculo?.foto_vehiculo_url ?? null)
  }

  function autocompletarAcompanante(v: Visitante) {
    setAcompForm(f => ({
      ...f,
      nombre: v.nombre,
      identificacion: v.identificacion ?? '',
      es_menor: v.es_menor ?? false,
      fecha_nacimiento: v.fecha_nacimiento ?? '',
      foto_url: v.foto_url ?? null,
      foto_documento_url: v.foto_documento_url ?? null,
    }))
  }

  function agregarAcompanante() {
    if (!acompForm.nombre.trim()) {
      notify({ variant: 'error', title: 'Error', text: 'Ingrese el nombre del acompañante.' })
      return
    }
    setAcompanantes(prev => [...prev, {
      ...acompForm,
      nombre: acompForm.nombre.trim(),
      tempId: crypto.randomUUID(),
    }])
    setAcompForm(defaultAcompForm())
    setShowAcompForm(false)
  }

  function quitarAcompanante(tempId: string) {
    setAcompanantes(prev => prev.filter(a => a.tempId !== tempId))
  }

  /**
   * El residente NO autorizó a quien se presentó fuera de lo pre-autorizado:
   * la persona no entra, así que no hay fila en `visitantes`. Queda como
   * novedad de seguridad (tipo acceso) con todo el detalle para que la
   * administración lo vea en la misma bitácora que las demás novedades.
   */
  async function registrarIngresoDenegado(vf: VisitaFrecuente, detalle: string) {
    setSaving(true)
    const unidadNombre = unidades.find(u => u.id === form.unidad_id)?.nombre ?? null
    const partes: string[] = [`Ingreso denegado: ${form.nombre.trim()}`]
    if (form.identificacion.trim()) partes.push(`DPI: ${form.identificacion.trim()}`)
    if (unidadNombre) partes.push(`Unidad: ${unidadNombre}`)
    if (form.placa_vehiculo.trim()) partes.push(`Vehículo: ${form.placa_vehiculo.trim()}`)
    partes.push(`Visita frecuente: ${vf.nombre} (${relacionLabel(vf.relacion)})`)
    if (acompanantes.length > 0) partes.push(`Acompañantes: ${acompanantes.map(a => a.nombre).join(', ')}`)
    const { error } = await createCondominioRow('novedades_seguridad', {
      company_id: companyId,
      project_id: proyectoId,
      ronda_id: null,
      tipo: 'acceso',
      descripcion: `${partes.join(' | ')}\n\n${detalle}`,
      ubicacion: unidadNombre,
      prioridad: 'normal',
      reportado_por: userId,
      foto_url: fotoUrl,
      fotos: fotoUrl ? [fotoUrl] : null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    notify({ variant: 'warning', title: 'Ingreso denegado registrado', text: 'Quedó en la bitácora de novedades de seguridad. La persona no se registra como visitante.' })
    resetForm()
    onRefresh()
  }

  async function handleRegistrar() {
    if (saving) return
    if (!form.nombre.trim()) { notify({ variant: 'error', title: 'Error', text: 'Ingrese el nombre del visitante.' }); return }
    if (!form.unidad_id) { notify({ variant: 'error', title: 'Error', text: 'Seleccione la unidad a visitar.' }); return }

    // Pre-autorización: se vuelve a evaluar AQUÍ, con la hora de este instante
    // (la del render pudo quedarse vieja con la ventana abierta un rato).
    const ev = visitaFrecuenteSel ? evaluarVisitaFrecuente(visitaFrecuenteSel) : null
    if (visitaFrecuenteSel && form.unidad_id !== visitaFrecuenteSel.unidad_id) {
      // La autorización es DE UNA UNIDAD: ligarla a otra sería dar por
      // pre-autorizado un ingreso que nadie autorizó.
      const unidadVf = unidades.find(u => u.id === visitaFrecuenteSel.unidad_id)?.nombre ?? 'otra unidad'
      notify({ variant: 'warning', title: 'La unidad no coincide', text: `${visitaFrecuenteSel.nombre} está pre-autorizado para ${unidadVf}. Corrija la unidad o quite la visita frecuente.` })
      return
    }
    let autorizacion: { visita_frecuente_id: string; autorizacion_ingreso: 'pre_autorizado' | 'residente'; autorizacion_detalle: string; pre_autorizado_por: string | null } | null = null
    if (visitaFrecuenteSel && ev) {
      if (ev.cumple) {
        autorizacion = {
          visita_frecuente_id: visitaFrecuenteSel.id,
          autorizacion_ingreso: 'pre_autorizado',
          autorizacion_detalle: `Pre-autorizado por administración · ${ev.autorizado}`,
          pre_autorizado_por: visitaFrecuenteSel.autorizado_por ?? null,
        }
      } else {
        if (autorizacionResidente.decision === '') {
          notify({ variant: 'warning', title: 'Falta la respuesta del residente', text: `${visitaFrecuenteSel.nombre} no cumple la pre-autorización. Confirme con el residente si autoriza o no el ingreso.` })
          return
        }
        const detalle = describirAutorizacionResidente(ev, autorizacionResidente)
        if (autorizacionResidente.decision === 'deniega') {
          await registrarIngresoDenegado(visitaFrecuenteSel, detalle)
          return
        }
        autorizacion = {
          visita_frecuente_id: visitaFrecuenteSel.id,
          autorizacion_ingreso: 'residente',
          autorizacion_detalle: detalle,
          pre_autorizado_por: null,
        }
      }
    }

    setSaving(true)
    const horaEntrada = new Date().toISOString()
    // cond:C2 — pre-validación Zod en boundary de persistencia. El schema
    // ya viene con `.passthrough()` para preservar campos system-side
    // (foto_*, registrado_por, qr_token, etc.).
    const { data, error } = await validatedInsert('visitantes', visitanteInputSchema, {
      company_id: companyId,
      project_id: proyectoId,
      unidad_id: form.unidad_id,
      nombre: form.nombre.trim(),
      identificacion: form.identificacion.trim() || null,
      placa_vehiculo: form.placa_vehiculo.trim() || null,
      motivo: form.motivo.trim() || null,
      notas: form.notas.trim() || null,
      foto_url: fotoUrl,
      foto_documento_url: fotoDocumentoUrl,
      foto_vehiculo_url: fotoVehiculoUrl,
      registrado_por: userId,
      hora_entrada: horaEntrada,
      es_menor: formEsMenor,
      fecha_nacimiento: formEsMenor && formFechaNacimiento ? formFechaNacimiento : null,
      reserva_str_id: strCtx?.reservaId ?? null,
      solicitud_mudanza_id: mudanzaCtx?.solicitudId ?? null,
      visita_frecuente_id: autorizacion?.visita_frecuente_id ?? null,
      autorizacion_ingreso: autorizacion?.autorizacion_ingreso ?? null,
      autorizacion_detalle: autorizacion?.autorizacion_detalle ?? null,
      pre_autorizado_por: autorizacion?.pre_autorizado_por ?? null,
    }, { returning: true })

    if (error) { setSaving(false); notify({ variant: 'error', title: 'Error', text: error.message }); return }

    // `validatedInsert` con returning retorna array; antes `.single()` daba objeto.
    const insertedVisitante = data?.[0] as { id?: string } | undefined

    // Lo que sigue acompaña a la entrada ya guardada: si falla, se avisa (antes
    // se ignoraba y el huésped seguía «sin ingresar» o la mudanza «aprobada»).
    const pendientes: string[] = []

    // Link pre-registered guest slot to this entry
    if (strCtx?.huespedId && insertedVisitante?.id) {
      const { error: he } = await updateCondominioRow('huespedes_str', strCtx.huespedId, { visitante_id: insertedVisitante.id })
      if (he) pendientes.push(`no se vinculó al huésped pre-registrado (${he.message})`)
    }

    // First ingress of an approved/scheduled mudanza moves it to "en_curso"
    if (mudanzaCtx?.solicitudId) {
      const sol = solicitudesMudanza.find(s => s.id === mudanzaCtx.solicitudId)
      if (sol && (sol.estado === 'aprobada' || sol.estado === 'programada')) {
        const { error: me } = await updateCondominioRow('solicitud_mudanza_unidad', mudanzaCtx.solicitudId, { estado: 'en_curso' })
        if (me) pendientes.push(`la mudanza no pasó a «en curso» (${me.message})`)
      }
    }
    if (pendientes.length > 0) {
      notify({ variant: 'warning', title: 'Entrada registrada con pendientes', text: `La entrada quedó guardada, pero ${pendientes.join(' y ')}.` })
    }

    if (acompanantes.length > 0 && data) {
      const acompRows = acompanantes.map(a => ({
        company_id: companyId,
        project_id: proyectoId,
        unidad_id: form.unidad_id,
        nombre: a.nombre,
        identificacion: a.es_menor ? null : (a.identificacion.trim() || null),
        placa_vehiculo: form.placa_vehiculo.trim() || null,
        motivo: form.motivo.trim() || null,
        notas: a.notas.trim() || null,
        foto_url: a.foto_url,
        foto_documento_url: a.es_menor ? null : (a.foto_documento_url ?? null),
        registrado_por: userId,
        hora_entrada: horaEntrada,
        es_menor: a.es_menor,
        fecha_nacimiento: a.es_menor && a.fecha_nacimiento ? a.fecha_nacimiento : null,
        visitante_principal_id: insertedVisitante?.id,
        reserva_str_id: strCtx?.reservaId ?? null,
        solicitud_mudanza_id: mudanzaCtx?.solicitudId ?? null,
      }))
      // cond:C2 — batch insert (acompañantes) con pre-validación Zod por fila.
      const { error: ae } = await validatedInsertMany('visitantes', visitanteInputSchema, acompRows)
      if (ae) {
        setSaving(false)
        notify({ variant: 'warning', title: 'Visitante registrado', text: `Acompañantes no guardados: ${ae.message}` })
        resetForm()
        onRefresh()
        return
      }
    }

    setSaving(false)
    const base = autorizacion?.autorizacion_ingreso === 'pre_autorizado'
      ? 'Ingreso pre-autorizado registrado'
      : autorizacion?.autorizacion_ingreso === 'residente'
        ? 'Ingreso registrado con autorización del residente'
        : 'Visita registrada'
    const msg = acompanantes.length > 0
      ? `${base} con ${acompanantes.length} acompañante${acompanantes.length > 1 ? 's' : ''}`
      : base
    notify({ variant: 'success', title: msg, duration: 1500 })
    resetForm()
    onRefresh()
  }

  function iniciarSalida(v: Visitante) {
    // Registrar la salida (y su novedad) escribe: exige canCreate, como registrar la entrada.
    if (!canCreate) return
    salidaYaRegistrada.current = null
    setSalidaPendiente(v)
    setModoSalida('idle')
    setNovedadForm({ tipo: 'incidente', comentarios: '', ubicacion: v.unidad_nombre ?? '', prioridad: 'normal' })
    setFotosNovedad([])
    setSalidaConAcomp(true)
  }

  function cancelarSalida() {
    if (guardandoSalida) return
    salidaYaRegistrada.current = null
    setSalidaPendiente(null)
    setModoSalida('idle')
    setFotosNovedad([])
  }

  async function confirmarSalida() {
    if (!salidaPendiente || !canCreate || guardandoSalida) return
    if (modoSalida === 'con_novedad' && !novedadForm.comentarios.trim()) {
      notify({ variant: 'error', title: 'Error', text: 'Ingrese los comentarios de la novedad.' }); return
    }
    setGuardandoSalida(true)
    const yaGuardada = salidaYaRegistrada.current?.id === salidaPendiente.id ? salidaYaRegistrada.current : null
    const horaSalida = yaGuardada?.hora ?? new Date().toISOString()
    if (!yaGuardada) {
      const { error } = await updateCondominioRow('visitantes', salidaPendiente.id, { hora_salida: horaSalida })
      if (error) { setGuardandoSalida(false); notify({ variant: 'error', title: 'Error', text: error.message }); return }
      salidaYaRegistrada.current = { id: salidaPendiente.id, hora: horaSalida }

      if (salidaConAcomp) {
        const acompsActivos = visitantes.filter(v => v.visitante_principal_id === salidaPendiente.id && !v.hora_salida)
        if (acompsActivos.length > 0) {
          const { error: ae } = await updateCondominioRowsByIds('visitantes', acompsActivos.map(a => a.id), { hora_salida: horaSalida })
          // Antes se ignoraba: los acompañantes seguían «en premisas» sin aviso.
          if (ae) notify({ variant: 'warning', title: 'Salida registrada', text: `Los acompañantes siguen en premisas: ${ae.message}` })
        }
      }
    }

    if (modoSalida === 'con_novedad') {
      const partes: string[] = []
      partes.push(`Visitante: ${salidaPendiente.nombre}`)
      if (salidaPendiente.identificacion) partes.push(`DPI: ${salidaPendiente.identificacion}`)
      if (salidaPendiente.unidad_nombre) partes.push(`Unidad: ${salidaPendiente.unidad_nombre}`)
      if (salidaPendiente.placa_vehiculo) partes.push(`Vehículo: ${salidaPendiente.placa_vehiculo}`)
      if (salidaPendiente.motivo) partes.push(`Motivo visita: ${salidaPendiente.motivo}`)
      partes.push(`Entrada: ${new Date(salidaPendiente.hora_entrada).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`)
      partes.push(`Salida: ${new Date(horaSalida).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`)
      const descripcion = `${partes.join(' | ')}\n\n${novedadForm.comentarios.trim()}`
      const ubicacion = novedadForm.ubicacion.trim() || salidaPendiente.unidad_nombre || null
      const { error: ne } = await createCondominioRow('novedades_seguridad', {
        company_id: companyId,
        project_id: proyectoId,
        ronda_id: null,
        tipo: novedadForm.tipo,
        descripcion,
        ubicacion,
        prioridad: novedadForm.prioridad,
        reportado_por: userId,
        foto_url: fotosNovedad[0] ?? null,
        fotos: fotosNovedad.length > 0 ? fotosNovedad : null,
      })
      if (ne) {
        // La salida ya quedó: la ventana sigue abierta con la novedad, y
        // reintentar sólo la crea (antes también reescribía la hora de salida).
        setGuardandoSalida(false)
        notify({ variant: 'error', title: 'Error al registrar novedad', text: `La salida quedó registrada, pero la novedad no: ${ne.message}` })
        onRefresh()
        return
      }
    }
    salidaYaRegistrada.current = null
    setGuardandoSalida(false)
    setSalidaPendiente(null)
    setModoSalida('idle')
    setFotosNovedad([])
    onRefresh()
  }

  function exportarPDF() {
    const subtitulo = filtroFecha === 'hoy' ? `Hoy: ${hoy}`
      : filtroFecha === 'semana' ? `Semana desde ${inicioSemana}`
      : filtroFecha === 'mes' ? `Mes: ${hoy.slice(0, 7)}`
      : 'Todos los registros'
    exportarPDFTabla({
      titulo: 'Registro de Visitantes',
      subtitulo,
      proyectoNombre,
      headers: ['Nombre', 'Unidad', 'Entrada', 'Salida', 'Motivo', 'ID/DPI', 'Placa'],
      rows: filtrados.map(v => [
        v.nombre + (v.es_menor ? ' (Menor)' : '') + (v.visitante_principal_id ? ' [Acomp.]' : ''),
        v.unidad_nombre ?? '—',
        new Date(v.hora_entrada).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
        v.hora_salida ? new Date(v.hora_salida).toLocaleString('es', { hour: '2-digit', minute: '2-digit' }) : 'En premisas',
        v.motivo ?? '—',
        v.es_menor ? 'Menor de edad' : (v.identificacion ?? '—'),
        v.placa_vehiculo ?? '—',
      ]),
      filename: `visitantes-${hoy}`,
      landscape: true,
    })
  }

  function exportarXlsx() {
    exportarExcel(`visitantes-${hoy}`, [{
      name: 'Visitantes',
      headers: ['Nombre', 'Tipo', 'Unidad', 'Hora entrada', 'Hora salida', 'Motivo', 'Identificación', 'Placa'],
      rows: filtrados.map(v => [
        v.nombre,
        v.visitante_principal_id ? 'Acompañante' : (v.es_menor ? 'Menor' : 'Principal'),
        v.unidad_nombre ?? '',
        v.hora_entrada,
        v.hora_salida ?? '',
        v.motivo ?? '',
        v.es_menor ? 'Menor de edad' : (v.identificacion ?? ''),
        v.placa_vehiculo ?? '',
      ]),
    }])
  }

  const ctx: VisitantesCtx = {
    visitantes, unidades, reservasSTR, solicitudesMudanza, visitasFrecuentes, proyectoId, companyId, userId, proyectoNombre, canCreate, onRefresh, showForm, setShowForm,
    saving, busqueda, setBusqueda, soloActivos, setSoloActivos, filtroFecha, setFiltroFecha, salidaPendiente, setSalidaPendiente, modoSalida, setModoSalida, guardandoSalida,
    novedadForm, setNovedadForm, fotosNovedad, setFotosNovedad, visitanteDetalle, setVisitanteDetalle, fotoUrl, setFotoUrl, fotoDocumentoUrl, setFotoDocumentoUrl, fotoVehiculoUrl, setFotoVehiculoUrl,
    fotosExpiradas, setFotosExpiradas, showStrModal, setShowStrModal, strSearch, setStrSearch, strHuespedes, strCtx, setStrCtx, showMudanzaModal, setShowMudanzaModal, mudanzaSearch,
    setMudanzaSearch, mudanzaCtx, setMudanzaCtx, form, setForm, formEsMenor, setFormEsMenor, formFechaNacimiento, setFormFechaNacimiento, acompanantes, setAcompanantes, showAcompForm,
    setShowAcompForm, acompForm, setAcompForm, salidaConAcomp, setSalidaConAcomp, hoy, filtrados, strGruposMap, mudanzaGruposMap, regulares, sugerencias, acompSugerencias,
    frecuentesSugeridas, visitaFrecuenteSel, evaluacionFrecuente, requiereAutorizacionResidente, autorizacionResidente, setAutorizacionResidente, seleccionarFrecuente, quitarFrecuente,
    mudanzasElegibles, resetForm, abrirRegistroMudanza, abrirRegistroSTR, autocompletar, autocompletarAcompanante, agregarAcompanante, quitarAcompanante, handleRegistrar, iniciarSalida, cancelarSalida, confirmarSalida,
  }

  return (
    <div style={{ padding: '16px', maxWidth: '1100px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>Control de Visitantes</h2>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={exportarPDF} disabled={filtrados.length === 0}
            style={{ padding: '9px 14px', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', border: '1.5px solid var(--at-primary-soft-2)', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
            📄 PDF
          </button>
          <button onClick={exportarXlsx} disabled={filtrados.length === 0}
            style={{ padding: '9px 14px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: '1.5px solid var(--at-success-border)', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
            📊 Excel
          </button>
          {canCreate && reservasSTR.some(r => (r.estado === 'confirmada' || r.estado === 'en_curso') && r.fecha_salida >= hoy) && (
            <button onClick={() => setShowStrModal(true)}
              style={{ padding: '10px 16px', background: 'linear-gradient(135deg,var(--at-accent-hover),var(--at-accent-dark))', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
              🏠 Renta corta
            </button>
          )}
          {canCreate && mudanzasElegibles.length > 0 && (
            <button onClick={() => setShowMudanzaModal(true)}
              style={{ padding: '10px 16px', background: 'linear-gradient(135deg,var(--at-warning),var(--at-warning))', color: 'var(--at-on-status)', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
              🚛 Mudanza
            </button>
          )}
          {canCreate && (
            <button onClick={() => setShowForm(true)}
              style={{ padding: '10px 20px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
              + Registrar visita
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards: los separadores son el hueco de la grilla, así no queda una
          raya suelta al borde cuando en el teléfono van de dos en dos. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))', gap: '1px', background: 'var(--at-chip)', borderRadius: '12px', border: '1px solid var(--at-line)', overflow: 'hidden', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        {([
          { label: 'Hoy', value: visitasHoy, icon: '📅', color: 'var(--at-primary)' },
          { label: 'En premisas', value: enPremisas, icon: '🟢', color: 'var(--at-success)' },
          { label: 'Esta semana', value: estaSemana, icon: '📆', color: 'var(--at-accent-hover)' },
          { label: 'Total histórico', value: totalHistorico, icon: '📊', color: 'var(--at-ink-2)' },
        ] as const).map(kpi => (
          <div key={kpi.label} style={{ background: 'var(--at-surface)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <span style={{ fontSize: '18px' }}>{kpi.icon}</span>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: kpi.color, lineHeight: 1.1 }}>{kpi.value}</div>
              <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{kpi.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar visitante o DPI..." aria-label="Buscar visitante o DPI"
          style={{ flex: '1 1 180px', minWidth: 0, boxSizing: 'border-box', padding: '9px 14px', border: '1.5px solid var(--at-line)', borderRadius: '10px', fontSize: '14px', background: 'var(--at-surface-2)', color: 'var(--at-ink)' }} />
        {(['hoy', 'semana', 'mes', 'todos'] as FiltroFecha[]).map(f => (
          <button key={f} onClick={() => setFiltroFecha(f)} aria-pressed={filtroFecha === f}
            style={{
              padding: '6px 12px', borderRadius: '10px', border: '1.5px solid', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600,
              background: filtroFecha === f ? 'var(--at-ink)' : 'var(--at-surface-2)',
              color: filtroFecha === f ? 'white' : 'var(--at-ink-2)',
              borderColor: filtroFecha === f ? 'var(--at-ink)' : 'var(--at-line)',
            }}>
            {f === 'hoy' ? 'Hoy' : f === 'semana' ? 'Semana' : f === 'mes' ? 'Mes' : 'Todos'}
          </button>
        ))}
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', color: 'var(--at-ink-2)', cursor: 'pointer', padding: '9px 14px', border: '1.5px solid var(--at-line)', borderRadius: '10px', background: soloActivos ? 'var(--at-success-tint)' : 'var(--at-surface-2)', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={soloActivos} onChange={e => setSoloActivos(e.target.checked)} />
          Solo en premisas
        </label>
      </div>

      {/* STR group entry modal */}
      {showStrModal && <StrModal ctx={ctx} />}
      {/* Mudanza authorization selection modal */}
      {showMudanzaModal && <MudanzaModal ctx={ctx} />}
      {/* Registration form modal */}
      {showForm && <RegistroForm ctx={ctx} />}

      {/* Visitor list */}
      <ListaVisitantes ctx={ctx} />

      {/* Detail modal */}
      {visitanteDetalle && <VisitanteDetalle ctx={ctx} />}

      {/* Exit modal */}
      <SalidaPanel ctx={ctx} />
    </div>
  )
}
