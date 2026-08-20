import { useState, useEffect, useMemo } from 'react'
import { useHoyDate } from '../../../hooks/useHoy'
import { notify } from '../../shared/Dialog'
import { createCondominioRow, updateCondominioRow, updateCondominioRowsByIds } from '../../../domain/condominios/tabMutations'
import { fetchHuespedesByReservas } from '../../../domain/condominios/tabQueries'
import { validatedInsert, validatedInsertMany } from '../../../lib/validatedInsert'
import { visitanteInputSchema } from '../../../domain/condominios/schemas'
import type { Visitante, Unidad, ReservaSTR, HuespedSTR, SolicitudMudanzaUnidad } from '../../../types'
import { rangosDeFecha, kpisVisitantes, sugerenciasVisitantes, filtrarVisitantes, agruparVisitantes, type FiltroFechaVisitas } from '../../../lib/visitantesFiltros'
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
  proyectoId: string
  companyId: string
  userId: string
  proyectoNombre?: string
  canCreate: boolean
  onRefresh: () => void
}

type FiltroFecha = FiltroFechaVisitas

export function VisitantesTab({ visitantes, unidades, reservasSTR, solicitudesMudanza, proyectoId, companyId, userId, proyectoNombre = 'Condominio', canCreate, onRefresh }: Props) {
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
  const [visitanteDetalle, setVisitanteDetalle] = useState<Visitante | null>(null)
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
    setShowForm(false)
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

  async function handleRegistrar() {
    if (!form.nombre.trim()) { notify({ variant: 'error', title: 'Error', text: 'Ingrese el nombre del visitante.' }); return }
    if (!form.unidad_id) { notify({ variant: 'error', title: 'Error', text: 'Seleccione la unidad a visitar.' }); return }
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
    }, { returning: true })

    if (error) { setSaving(false); notify({ variant: 'error', title: 'Error', text: error.message }); return }

    // `validatedInsert` con returning retorna array; antes `.single()` daba objeto.
    const insertedVisitante = data?.[0] as { id?: string } | undefined

    // Link pre-registered guest slot to this entry
    if (strCtx?.huespedId && insertedVisitante?.id) {
      await updateCondominioRow('huespedes_str', strCtx.huespedId, { visitante_id: insertedVisitante.id })
    }

    // First ingress of an approved/scheduled mudanza moves it to "en_curso"
    if (mudanzaCtx?.solicitudId) {
      const sol = solicitudesMudanza.find(s => s.id === mudanzaCtx.solicitudId)
      if (sol && (sol.estado === 'aprobada' || sol.estado === 'programada')) {
        await updateCondominioRow('solicitud_mudanza_unidad', mudanzaCtx.solicitudId, { estado: 'en_curso' })
      }
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
    const msg = acompanantes.length > 0
      ? `Visita registrada con ${acompanantes.length} acompañante${acompanantes.length > 1 ? 's' : ''}`
      : 'Visita registrada'
    notify({ variant: 'success', title: msg, duration: 1500 })
    resetForm()
    onRefresh()
  }

  function iniciarSalida(v: Visitante) {
    setSalidaPendiente(v)
    setModoSalida('idle')
    setNovedadForm({ tipo: 'incidente', comentarios: '', ubicacion: v.unidad_nombre ?? '', prioridad: 'normal' })
    setFotosNovedad([])
    setSalidaConAcomp(true)
  }

  function cancelarSalida() {
    setSalidaPendiente(null)
    setModoSalida('idle')
    setFotosNovedad([])
  }

  async function confirmarSalida() {
    if (!salidaPendiente) return
    if (modoSalida === 'con_novedad' && !novedadForm.comentarios.trim()) {
      notify({ variant: 'error', title: 'Error', text: 'Ingrese los comentarios de la novedad.' }); return
    }
    setGuardandoSalida(true)
    const horaSalida = new Date().toISOString()
    const { error } = await updateCondominioRow('visitantes', salidaPendiente.id, { hora_salida: horaSalida })
    if (error) { setGuardandoSalida(false); notify({ variant: 'error', title: 'Error', text: error.message }); return }

    if (salidaConAcomp) {
      const acompsActivos = visitantes.filter(v => v.visitante_principal_id === salidaPendiente.id && !v.hora_salida)
      await updateCondominioRowsByIds('visitantes', acompsActivos.map(a => a.id), { hora_salida: horaSalida })
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
      if (ne) { setGuardandoSalida(false); notify({ variant: 'error', title: 'Error al registrar novedad', text: ne.message }); return }
    }
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
    visitantes, unidades, reservasSTR, solicitudesMudanza, proyectoId, companyId, userId, proyectoNombre, canCreate, onRefresh, showForm, setShowForm,
    saving, busqueda, setBusqueda, soloActivos, setSoloActivos, filtroFecha, setFiltroFecha, salidaPendiente, setSalidaPendiente, modoSalida, setModoSalida, guardandoSalida,
    novedadForm, setNovedadForm, fotosNovedad, setFotosNovedad, visitanteDetalle, setVisitanteDetalle, fotoUrl, setFotoUrl, fotoDocumentoUrl, setFotoDocumentoUrl, fotoVehiculoUrl, setFotoVehiculoUrl,
    fotosExpiradas, setFotosExpiradas, showStrModal, setShowStrModal, strSearch, setStrSearch, strHuespedes, strCtx, setStrCtx, showMudanzaModal, setShowMudanzaModal, mudanzaSearch,
    setMudanzaSearch, mudanzaCtx, setMudanzaCtx, form, setForm, formEsMenor, setFormEsMenor, formFechaNacimiento, setFormFechaNacimiento, acompanantes, setAcompanantes, showAcompForm,
    setShowAcompForm, acompForm, setAcompForm, salidaConAcomp, setSalidaConAcomp, hoy, filtrados, strGruposMap, mudanzaGruposMap, regulares, sugerencias, acompSugerencias,
    mudanzasElegibles, resetForm, abrirRegistroMudanza, abrirRegistroSTR, autocompletar, autocompletarAcompanante, agregarAcompanante, quitarAcompanante, handleRegistrar, iniciarSalida, cancelarSalida, confirmarSalida,
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
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

      {/* KPI Cards */}
      <div style={{ display: 'flex', background: 'var(--at-surface)', borderRadius: '12px', border: '1px solid var(--at-line)', overflow: 'hidden', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', flexWrap: 'wrap' }}>
        {([
          { label: 'Hoy', value: visitasHoy, icon: '📅', color: 'var(--at-primary)' },
          { label: 'En premisas', value: enPremisas, icon: '🟢', color: 'var(--at-success)' },
          { label: 'Esta semana', value: estaSemana, icon: '📆', color: 'var(--at-accent-hover)' },
          { label: 'Total histórico', value: totalHistorico, icon: '📊', color: 'var(--at-ink-2)' },
        ] as const).map((kpi, i) => (
          <div key={kpi.label} style={{ flex: '1 1 120px', padding: '10px 16px', borderRight: i < 3 ? '1px solid var(--at-chip)' : undefined, display: 'flex', alignItems: 'center', gap: '10px' }}>
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
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar visitante o DPI..."
          style={{ flex: 1, minWidth: '180px', padding: '9px 14px', border: '1.5px solid var(--at-line)', borderRadius: '10px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
        {(['hoy', 'semana', 'mes', 'todos'] as FiltroFecha[]).map(f => (
          <button key={f} onClick={() => setFiltroFecha(f)}
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
