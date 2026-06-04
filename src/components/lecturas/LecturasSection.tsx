import { useState, useEffect, type CSSProperties, type ChangeEvent} from 'react'
import { notify, confirm } from '../shared/Dialog'
import { openPromptDialog } from '../shared/PromptDialog'
import type { Cliente, Registro, GPS, UserRole, Ruta, Tarifa, Contador, Unidad, Proyecto } from '../../types'
import { supabase } from '../../lib/supabase'
import { calcularTotalPagar } from '../../lib/business'
import { APP_CONFIG } from '../../lib/config'

interface Props {
  clientes: Cliente[]
  unidades: Unidad[]
  contadores: Contador[]
  registros: Registro[]
  tarifas: Tarifa[]
  userRole: UserRole
  proyectos?: Proyecto[]
  moneda?: string
  onRegistroAdded: (registro: Registro) => void
  rutaActiva?: Ruta | null
  onClearRuta?: () => void
  onRutaCompletada?: (rutaId: string) => void
  canCreate?: boolean
}

export function LecturasSection({
  clientes,
  unidades,
  contadores,
  registros,
  tarifas,
  userRole: _userRole,
  proyectos = [],
  moneda = 'Q',
  onRegistroAdded,
  rutaActiva,
  onClearRuta,
  onRutaCompletada,
  canCreate = true,
}: Props) {
  // Derive project_id from selected unidad/contador, then fall back to single-project context
  const defaultProjectId = proyectos.length === 1 ? proyectos[0].id : null
  const [selectedUnidadId, setSelectedUnidadId] = useState('')
  const [selectedContadorId, setSelectedContadorId] = useState('')
  const [lecturaActual, setLecturaActual] = useState('')
  const [estado, setEstado] = useState<Registro['estado']>('pendiente')
  const [fechaLecturaActual, setFechaLecturaActual] = useState(() => new Date().toISOString().split('T')[0])
  const [notas, setNotas] = useState('')
  const [gps, setGps] = useState<GPS | null>(null)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [foto, setFoto] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [rutaModoManual, setRutaModoManual] = useState(false)
  const [rutaIndex, setRutaIndex] = useState(0)
  const [contadoresLeidos, setContadoresLeidos] = useState<Set<string>>(new Set())

  // En modo ruta, derivar unidades según el tipo de ruta
  const unidadesOrdenadas: Unidad[] = rutaActiva
    ? rutaActiva.tipo_ruta === 'contadores'
      ? (rutaActiva.contador_ids ?? [])
          .map(cid => contadores.find(c => c.id === cid))
          .filter((c): c is Contador => !!c && !!c.unidad_id)
          .map(c => unidades.find(u => u.id === c.unidad_id!))
          .filter((u): u is Unidad => !!u)
      : rutaActiva.tipo_ruta === 'unidades'
      ? (rutaActiva.unidad_ids ?? [])
          .map(uid => unidades.find(u => u.id === uid))
          .filter((u): u is Unidad => !!u)
      : (rutaActiva.cliente_ids ?? [])
          .flatMap(cid => unidades.filter(u => u.cliente_id === cid))
    : unidades.filter(u => u.activo)

  const enModoRuta = !!rutaActiva || rutaModoManual

  useEffect(() => {
    if (rutaActiva && unidadesOrdenadas.length > 0) {
      setRutaIndex(0)
      setContadoresLeidos(new Set())
      setSelectedUnidadId(unidadesOrdenadas[0].id)
      // En modo contadores, pre-seleccionar el contador específico de la ruta
      if (rutaActiva.tipo_ruta === 'contadores' && rutaActiva.contador_ids?.length) {
        setSelectedContadorId(rutaActiva.contador_ids[0])
      } else {
        setSelectedContadorId('')
      }
      setLecturaActual('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rutaActiva?.id])

  // Al navegar por la ruta en modo contadores, pre-seleccionar el contador del paso actual
  useEffect(() => {
    if (rutaActiva?.tipo_ruta === 'contadores' && rutaActiva.contador_ids?.length) {
      const cid = rutaActiva.contador_ids[rutaIndex]
      if (cid) setSelectedContadorId(cid)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rutaIndex])

  // Al cambiar de unidad, limpiar contador seleccionado
  useEffect(() => {
    setSelectedContadorId('')
    setLecturaActual('')
  }, [selectedUnidadId])

  // GPS automático con watchPosition
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError('Geolocalización no disponible en este dispositivo')
      return
    }
    setGpsLoading(true)
    setGpsError(null)
    const watchId = navigator.geolocation.watchPosition(
      pos => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setGpsLoading(false)
        setGpsError(null)
      },
      err => {
        setGpsLoading(false)
        setGpsError(err.message)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  // Quién puede registrar lecturas se decide por permiso RBAC (agua.lecturas.create),
  // no por el rol de plataforma: un "Operador Agua" tiene role='viewer' pero sí debe
  // poder guardar. Usar userRole !== 'viewer' ocultaba el botón Guardar para ellos.
  const canEdit = canCreate

  const unidadSeleccionada = unidades.find(u => u.id === selectedUnidadId) ?? null
  const clienteDeUnidad = unidadSeleccionada?.cliente_id
    ? clientes.find(c => c.id === unidadSeleccionada.cliente_id) ?? null
    : null

  // Contadores de la unidad seleccionada
  const contadoresDeUnidad = unidadSeleccionada
    ? contadores.filter(c => c.unidad_id === unidadSeleccionada.id && c.activo)
    : []

  const contadorSeleccionado = contadores.find(c => c.id === selectedContadorId) ?? null

  // Resolve project_id: prefer from selected unidad, then contador, then single-project fallback
  const projectId: string | null =
    unidadSeleccionada?.project_id ??
    contadorSeleccionado?.project_id ??
    defaultProjectId
  const tarifaDelContador = contadorSeleccionado?.tarifa_id
    ? tarifas.find(t => t.id === contadorSeleccionado.tarifa_id) ?? null
    : null
  const tarifaExpirada = tarifaDelContador !== null && !tarifaDelContador.activa
  const sinTarifa = contadorSeleccionado !== null && !tarifaDelContador

  function getUltimaLectura(contadorId: string): { lectura: number; fecha: string | null; esPrimera: boolean } {
    const contador = contadores.find(c => c.id === contadorId)
    const historial = registros
      .filter(r => r.contador_id === contadorId)
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
    if (historial.length > 0) {
      return { lectura: historial[0].lectura_actual, fecha: historial[0].fecha, esPrimera: false }
    }
    return { lectura: contador?.lectura_inicial ?? 0, fecha: contador?.fecha_instalacion ?? null, esPrimera: true }
  }

  const ultimaLecturaInfo = contadorSeleccionado ? getUltimaLectura(contadorSeleccionado.id) : { lectura: 0, fecha: null, esPrimera: true }
  const ultimaLectura = ultimaLecturaInfo.lectura
  const esPrimeraLectura = ultimaLecturaInfo.esPrimera
  const [fechaAnteriorManual, setFechaAnteriorManual] = useState('')
  const fechaLecturaAnterior = esPrimeraLectura && fechaAnteriorManual
    ? fechaAnteriorManual + 'T12:00:00'
    : ultimaLecturaInfo.fecha
  const diasServicio = fechaLecturaAnterior && fechaLecturaActual
    ? Math.max(0, Math.round((new Date(fechaLecturaActual + 'T12:00:00').getTime() - new Date(fechaLecturaAnterior).getTime()) / 86400000))
    : null
  const lecturaNum = parseFloat(lecturaActual)
  const consumo = !isNaN(lecturaNum) ? lecturaNum - ultimaLectura : null
  const calculo =
    consumo !== null && consumo >= 0 && tarifaDelContador
      ? calcularTotalPagar(consumo, tarifaDelContador.precio_m3, tarifaDelContador.canon_fijo, tarifaDelContador.consumo_minimo ?? 0, tarifaDelContador.precio_m3_exceso ?? 0, contadorSeleccionado?.cantidad_derecho_servicio_m3 ?? null)
      : null

  function handlePhoto(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = ev => setFoto(ev.target?.result as string)
    reader.readAsDataURL(f)
  }

  function enviarWhatsApp(registro: Registro) {
    const rawTel = clienteDeUnidad?.whatsapp ?? clienteDeUnidad?.telefono ?? ''
    if (!rawTel) { notify({ variant: 'warning', title: 'Sin Teléfono', text: 'Este cliente no tiene teléfono registrado.' }); return }
    let telefono = rawTel.trim().replace(/[\s\-\.\(\)]/g, '')
    if (telefono.startsWith('+')) telefono = telefono.slice(1)
    else { telefono = telefono.replace(/\D/g, ''); if (telefono.length === 8) telefono = APP_CONFIG.COUNTRY_CODE + telefono }
    const total = registro.monto_calculado
    const periodoStr = registro.fecha_lectura_anterior
      ? `\n📆 Período: ${new Date(registro.fecha_lectura_anterior).toLocaleDateString()} al ${new Date(registro.fecha).toLocaleDateString()} (${registro.dias_servicio ?? '—'} días)`
      : ''
    const msg = `Hola ${registro.cliente_nombre}, su recibo de agua:\n📅 Fecha: ${new Date(registro.fecha).toLocaleDateString()}${periodoStr}\n🔧 Contador: ${contadorSeleccionado?.numero_serie ?? ''}\n💧 Lectura Actual: ${registro.lectura_actual}\n📊 Consumo: ${registro.consumo.toFixed(2)} m³\n💰 Total a Pagar: ${moneda}${total.toFixed(2)}\nℹ️ Estado: ${registro.estado.toUpperCase()}\n\nGracias por su pago puntual.`
    window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  function limpiarFormulario() {
    setSelectedContadorId('')
    setLecturaActual('')
    setEstado('pendiente')
    setFechaLecturaActual(new Date().toISOString().split('T')[0])
    setFechaAnteriorManual('')
    setNotas('')
    setFoto(null)
  }

  // Marca la ocurrencia relevante (hoy / la más cercana pendiente) como completada
  // para rutas recurrentes, en lugar de cerrar la ruta entera.
  async function marcarOcurrenciaCompletada(rutaId: string) {
    const hoyGT = new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10)
    const enRango = await supabase
      .from('ruta_ocurrencias')
      .select('id')
      .eq('ruta_id', rutaId)
      .in('estado', ['pendiente', 'vencida'])
      .lte('fecha', hoyGT)
      .order('fecha', { ascending: false })
      .limit(1)
    let occId = enRango.data?.[0]?.id as string | undefined
    if (!occId) {
      const proxima = await supabase
        .from('ruta_ocurrencias')
        .select('id')
        .eq('ruta_id', rutaId)
        .in('estado', ['pendiente', 'vencida'])
        .gte('fecha', hoyGT)
        .order('fecha', { ascending: true })
        .limit(1)
      occId = proxima.data?.[0]?.id as string | undefined
    }
    if (occId) {
      await supabase
        .from('ruta_ocurrencias')
        .update({ estado: 'completada', completada_at: new Date().toISOString() })
        .eq('id', occId)
    }
  }

  async function handleGuardar() {
    if (!unidadSeleccionada) return notify({ variant: 'warning', title: 'Atención', text: 'Seleccione una unidad primero' })
    if (!contadorSeleccionado) return notify({ variant: 'warning', title: 'Atención', text: 'Seleccione un contador' })
    if (sinTarifa) {
      notify({ variant: 'warning', title: 'Sin Tarifa', text: 'El contador no tiene tarifa asignada. Asigne una tarifa al contador antes de registrar lecturas.' })
      return
    }
    if (tarifaExpirada) {
      notify({
        variant: 'warning',
        title: 'Tarifa No Vigente',
        text: 'La tarifa del contador no está vigente. Por favor actualice la tarifa del contador antes de registrar lecturas.',
      })
      return
    }
    if (consumo === null || isNaN(consumo)) return notify({ variant: 'error', title: 'Error', text: 'Datos de lectura inválidos' })
    if (consumo < 0) return notify({ variant: 'error', title: 'Consumo Negativo', text: 'La lectura actual debe ser mayor o igual a la anterior.' })

    const resultadoCobro = calcularTotalPagar(consumo, tarifaDelContador!.precio_m3, tarifaDelContador!.canon_fijo, tarifaDelContador!.consumo_minimo ?? 0, tarifaDelContador!.precio_m3_exceso ?? 0, contadorSeleccionado.cantidad_derecho_servicio_m3 ?? null)

    if (!projectId) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo determinar el proyecto del usuario' })
      return
    }

    const registro = {
      // El cliente se toma de la unidad (siempre cargada), no de la lista `clientes`
      // en memoria: un operador puede no tenerla por RLS y se perdía el cliente_id.
      cliente_id: unidadSeleccionada.cliente_id ?? null,
      cliente_nombre: clienteDeUnidad?.nombre ?? unidadSeleccionada.nombre,
      contador_id: contadorSeleccionado.id,
      project_id: projectId,
      fecha: new Date(fechaLecturaActual + 'T12:00:00').toISOString(),
      lectura_anterior: ultimaLectura,
      lectura_actual: lecturaNum,
      consumo,
      tarifa_aplicada: tarifaDelContador!.precio_m3,
      tarifa_exceso_aplicada: tarifaDelContador!.precio_m3_exceso ?? 0,
      canon_aplicado: tarifaDelContador!.canon_fijo,
      monto_calculado: resultadoCobro.total,
      tipo_cobro: resultadoCobro.tipo_cobro,
      estado,
      fecha_lectura_anterior: fechaLecturaAnterior,
      dias_servicio: diasServicio,
      notas,
      gps,
      foto,
    }

    setSaving(true)
    const { data, error } = await supabase.from('registros').insert(registro).select()
    setSaving(false)

    if (error || !data) {
      console.error('Error inserting registro:', error)
      notify({ variant: 'error', title: 'Error', text: error?.message || 'No se pudo guardar en la base de datos' })
      return
    }

    const nuevoRegistro = data[0] as Registro
    onRegistroAdded(nuevoRegistro)

    const result = await confirm({ title: 'Lectura Guardada', text: '¿Deseas enviar el recibo por WhatsApp?', icon: 'question', confirmText: 'Enviar WhatsApp', cancelText: 'No, gracias' })

    if (result.isConfirmed) enviarWhatsApp(nuevoRegistro)

    if (enModoRuta) {
      // Marcar este contador como leído en la sesión actual
      const nuevosLeidos = new Set(contadoresLeidos).add(contadorSeleccionado.id)
      setContadoresLeidos(nuevosLeidos)

      // Contadores activos de la unidad actual que aún no se han leído
      const pendientes = contadoresDeUnidad.filter(c => !nuevosLeidos.has(c.id))

      if (pendientes.length > 0) {
        // Hay contadores pendientes en esta misma unidad — preguntar al operador
        const lista = pendientes
          .map(c => `${c.numero_serie}${c.descripcion ? ` — ${c.descripcion}` : ''} (${c.tipo_agua})`)
          .join(', ')

        const pregunta = await confirm({
          icon: 'question',
          title: 'Contadores pendientes',
          text: `Esta unidad tiene ${pendientes.length} contador${pendientes.length > 1 ? 'es' : ''} sin leer: ${lista}. ¿Desea registrarlos antes de continuar?`,
          confirmText: 'Sí, registrar',
          cancelText: 'No, siguiente parada',
        })

        if (pregunta.isConfirmed) {
          // Seleccionar el contador pendiente (auto si solo hay uno, selector si hay varios)
          let contadorElegidoId = pendientes[0].id
          if (pendientes.length > 1) {
            const options = pendientes.map(c => ({
              value: c.id,
              label: `${c.numero_serie}${c.descripcion ? ` — ${c.descripcion}` : ''}`,
            }))
            const seleccion = await openPromptDialog({
              title: 'Seleccione el contador',
              fields: [{
                name: 'contador',
                label: 'Contador',
                control: 'select',
                options,
                initialValue: pendientes[0].id,
                required: true,
                autoFocus: true,
              }],
              submitText: 'Seleccionar',
            })
            if (seleccion?.contador) contadorElegidoId = seleccion.contador
          }
          // Quedarse en la misma unidad con el contador elegido
          setSelectedContadorId(contadorElegidoId)
          setLecturaActual('')
          setNotas('')
          setFoto(null)
          return
        }
      }

      // Sin pendientes (o el operador eligió saltar) → avanzar al siguiente en la ruta
      const nextIndex = rutaIndex + 1
      if (nextIndex < unidadesOrdenadas.length) {
        setRutaIndex(nextIndex)
        setSelectedUnidadId(unidadesOrdenadas[nextIndex].id)
        setSelectedContadorId('')
        setLecturaActual('')
        setNotas('')
        setFoto(null)
      } else {
        if (rutaActiva) {
          const esRecurrente = !!rutaActiva.frecuencia && rutaActiva.frecuencia !== 'unica'
          if (esRecurrente) {
            await marcarOcurrenciaCompletada(rutaActiva.id)
          } else {
            await supabase.from('rutas').update({ completada: true }).eq('id', rutaActiva.id)
          }
          onRutaCompletada?.(rutaActiva.id)
          onClearRuta?.()
        } else {
          setRutaModoManual(false)
        }
        notify({ variant: 'success', title: 'Ruta Finalizada', text: '¡Has completado todas las lecturas de la ruta!' })
        limpiarFormulario()
        setSelectedUnidadId('')
        setRutaIndex(0)
        setContadoresLeidos(new Set())
      }
    } else {
      limpiarFormulario()
    }
  }

  function toggleModoManual() {
    if (rutaModoManual) {
      setRutaModoManual(false)
      setSelectedUnidadId('')
      limpiarFormulario()
      setRutaIndex(0)
      setContadoresLeidos(new Set())
    } else {
      setRutaModoManual(true)
      setRutaIndex(0)
      setContadoresLeidos(new Set())
      if (unidadesOrdenadas.length > 0) setSelectedUnidadId(unidadesOrdenadas[0].id)
    }
  }

  function detenerRuta() {
    if (rutaActiva) {
      onClearRuta?.()
    } else {
      setRutaModoManual(false)
    }
    setSelectedUnidadId('')
    limpiarFormulario()
    setRutaIndex(0)
    setContadoresLeidos(new Set())
  }

  const inputStyle: CSSProperties = { padding: '12px 16px', border: '2px solid var(--at-line)', borderRadius: '10px', fontSize: '15px', width: '100%', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '14px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px', display: 'block' }

  const consumoInvalido = consumo !== null && consumo < 0

  const bannerRuta = rutaActiva
    ? {
        bg: 'var(--at-primary-tint)',
        border: 'var(--at-primary-soft-2)',
        color: 'var(--at-ink-deep)',
        texto: `🗺️ Ruta: ${rutaActiva.nombre} — Unidad ${rutaIndex + 1} de ${unidadesOrdenadas.length}${rutaActiva.fecha_programada ? ` | 📅 ${new Date(rutaActiva.fecha_programada + 'T12:00:00').toLocaleDateString('es-GT')}` : ''}`,
      }
    : rutaModoManual
    ? {
        bg: 'var(--at-success-tint)',
        border: 'var(--at-success-border)',
        color: 'var(--at-success-strong)',
        texto: `Modo Ruta ACTIVO — Unidad ${rutaIndex + 1} de ${unidadesOrdenadas.length}`,
      }
    : { bg: 'var(--at-success-tint)', border: 'var(--at-success-border)', color: 'var(--at-success-strong)', texto: 'Modo Manual' }

  return (
    <div>
      {/* Ruta Control */}
      <div style={{ background: bannerRuta.bg, padding: '15px', borderRadius: '12px', marginBottom: '20px', border: `1px solid ${bannerRuta.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <span style={{ color: bannerRuta.color, fontWeight: 600 }}>
          {bannerRuta.texto}
        </span>
        {canEdit && (
          enModoRuta ? (
            <button
              onClick={detenerRuta}
              style={{ padding: '8px 16px', background: 'var(--at-danger)', color: 'var(--at-on-status)', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
            >
              Detener Ruta
            </button>
          ) : (
            <button
              onClick={toggleModoManual}
              style={{ padding: '8px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
            >
              🚀 Iniciar Ruta Manual
            </button>
          )
        )}
      </div>

      <div style={{ background: 'var(--at-surface)', borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '20px', borderBottom: '2px solid var(--at-line)', paddingBottom: '12px' }}>
          Ingreso de Lectura
        </div>

        {/* Selector de unidad */}
        <div style={{ marginBottom: '20px' }}>
          <label style={labelStyle}>Seleccionar Unidad</label>
          <select
            value={selectedUnidadId}
            onChange={e => setSelectedUnidadId(e.target.value)}
            style={inputStyle}
            disabled={enModoRuta}
          >
            <option value="">-- Seleccionar Unidad --</option>
            {(enModoRuta ? unidadesOrdenadas : unidades.filter(u => u.activo)).map(u => {
              const cli = clientes.find(c => c.id === u.cliente_id)
              return (
                <option key={u.id} value={u.id}>
                  {u.nombre}{cli ? ` — ${cli.nombre}` : ''}
                </option>
              )
            })}
          </select>
        </div>

        {unidadSeleccionada && (
          <>
            {/* Info de unidad y cliente */}
            <div style={{ background: 'var(--at-surface-2)', padding: '15px', borderRadius: '10px', marginBottom: '20px', border: '1px solid var(--at-line)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
              <div><small style={{ color: 'var(--at-ink-3)' }}>Unidad</small><div style={{ fontWeight: 700 }}>{unidadSeleccionada.nombre}</div></div>
              {clienteDeUnidad && (
                <>
                  <div><small style={{ color: 'var(--at-ink-3)' }}>Cliente</small><div style={{ fontWeight: 700 }}>{clienteDeUnidad.nombre}</div></div>
                  <div><small style={{ color: 'var(--at-ink-3)' }}>Código</small><div style={{ fontWeight: 600, fontFamily: 'monospace' }}>{clienteDeUnidad.codigo}</div></div>
                  {clienteDeUnidad.telefono && (
                    <div><small style={{ color: 'var(--at-ink-3)' }}>Teléfono</small><div style={{ fontWeight: 600 }}>{clienteDeUnidad.telefono}</div></div>
                  )}
                </>
              )}
              {!clienteDeUnidad && (
                <div><small style={{ color: 'var(--at-ink-3)' }}>Cliente</small><div style={{ color: 'var(--at-ink-3)', fontSize: '13px' }}>Sin cliente asignado</div></div>
              )}
            </div>

            {/* Selector de contador */}
            {contadoresDeUnidad.length === 0 ? (
              <div style={{ background: 'var(--at-warning-tint)', border: '1px solid #fde047', borderRadius: '10px', padding: '14px 18px', marginBottom: '20px', color: 'var(--at-warning-strong)', fontWeight: 600, fontSize: '14px' }}>
                Esta unidad no tiene contadores activos asignados.
              </div>
            ) : (
              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle}>Seleccionar Contador</label>
                <select
                  value={selectedContadorId}
                  onChange={e => { setSelectedContadorId(e.target.value); setLecturaActual('') }}
                  style={inputStyle}
                >
                  <option value="">-- Seleccionar Contador --</option>
                  {contadoresDeUnidad.map(c => {
                    const t = tarifas.find(t => t.id === c.tarifa_id)
                    return (
                      <option key={c.id} value={c.id}>
                        {c.numero_serie} ({c.tipo_agua}){t ? ` — ${t.nombre}` : ' — Sin tarifa'}
                      </option>
                    )
                  })}
                </select>
              </div>
            )}

            {contadorSeleccionado && (
              <>
                {/* Info del contador y tarifa */}
                <div style={{ background: 'var(--at-surface-2)', padding: '12px 16px', borderRadius: '10px', marginBottom: '20px', border: '1px solid var(--at-line)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', fontSize: '13px' }}>
                  <div><small style={{ color: 'var(--at-ink-3)' }}>N° Serie</small><div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{contadorSeleccionado.numero_serie}</div></div>
                  <div><small style={{ color: 'var(--at-ink-3)' }}>Tipo Agua</small><div style={{ fontWeight: 600 }}>{contadorSeleccionado.tipo_agua}</div></div>
                  <div><small style={{ color: 'var(--at-ink-3)' }}>Última Lectura</small><div style={{ fontWeight: 700 }}>{ultimaLectura}</div>{fechaLecturaAnterior && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{new Date(fechaLecturaAnterior).toLocaleDateString('es-GT')}</div>}</div>
                  {tarifaDelContador && (
                    <>
                      <div><small style={{ color: 'var(--at-ink-3)' }}>Tarifa</small><div style={{ fontWeight: 600 }}>{tarifaDelContador.nombre}</div></div>
                      <div><small style={{ color: 'var(--at-ink-3)' }}>Precio/m³</small><div style={{ fontWeight: 600 }}>{moneda}{tarifaDelContador.precio_m3}</div></div>
                      {Number(tarifaDelContador.precio_m3_exceso ?? 0) > 0 && (
                        <div><small style={{ color: 'var(--at-ink-3)' }}>Precio Exceso/m³</small><div style={{ fontWeight: 600 }}>{moneda}{tarifaDelContador.precio_m3_exceso}</div></div>
                      )}
                      <div><small style={{ color: 'var(--at-ink-3)' }}>Canon Fijo</small><div style={{ fontWeight: 600 }}>{moneda}{tarifaDelContador.canon_fijo}</div></div>
                    </>
                  )}
                </div>

                {sinTarifa && (
                  <div style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '10px', padding: '14px 18px', marginBottom: '12px', color: 'var(--at-danger)', fontWeight: 600, fontSize: '14px' }}>
                    El contador no tiene tarifa asignada. Vaya a Contadores y asigne una tarifa antes de registrar lecturas.
                  </div>
                )}
                {tarifaExpirada && (
                  <div style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '10px', padding: '14px 18px', marginBottom: '12px', color: 'var(--at-danger)', fontWeight: 600, fontSize: '14px' }}>
                    Tarifa no vigente. No es posible registrar lecturas hasta que se actualice la tarifa del contador.
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '20px' }}>
                  <div>
                    <label style={labelStyle}>Lectura Actual</label>
                    <input type="number" step="0.01" value={lecturaActual} onChange={e => setLecturaActual(e.target.value)} placeholder="Ingrese lectura del medidor" style={{ ...inputStyle, borderColor: consumoInvalido ? 'var(--at-danger)' : 'var(--at-line)' }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Consumo Calculado (m³)</label>
                    <input type="text" readOnly value={consumo !== null ? (consumoInvalido ? consumo.toFixed(2) + ' (ERROR)' : consumo.toFixed(2)) : ''} style={{ ...inputStyle, fontWeight: 'bold', color: consumoInvalido ? 'var(--at-danger)' : 'var(--at-primary)', background: 'var(--at-surface-2)' }} />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>Desglose de Cobro</label>
                    {calculo ? (
                      <div style={{ background: 'var(--at-success-tint)', border: '1px solid var(--at-success-border)', borderRadius: '8px', padding: '12px 16px', fontSize: '13px', color: 'var(--at-success-strong)' }}>
                        {calculo.desglose.tramo === 1 && (
                          <>
                            <div>Consumo <strong>{consumo?.toFixed(2)} m³</strong> ≤ mínimo <strong>{tarifaDelContador?.consumo_minimo ?? 0} m³</strong> → Solo canon fijo</div>
                            <div style={{ marginTop: '6px', fontSize: '15px', fontWeight: 700 }}>Total: {moneda}{calculo.total.toFixed(2)} <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--at-success)' }}>({calculo.tipo_cobro})</span></div>
                          </>
                        )}
                        {calculo.desglose.tramo === 2 && (
                          <>
                            <div><strong>{calculo.desglose.consumo_m3?.toFixed(2)} m³</strong> × {moneda}{calculo.desglose.precio_m3?.toFixed(2)}/m³</div>
                            <div style={{ marginTop: '6px', fontSize: '15px', fontWeight: 700 }}>Total: {moneda}{calculo.total.toFixed(2)} <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--at-success)' }}>({calculo.tipo_cobro})</span></div>
                          </>
                        )}
                        {calculo.desglose.tramo === 3 && (
                          <>
                            <div>Derecho: <strong>{calculo.desglose.derecho_m3?.toFixed(2)} m³</strong> × {moneda}{calculo.desglose.precio_m3?.toFixed(2)}/m³ = {moneda}{calculo.desglose.monto_base?.toFixed(2)}</div>
                            <div>+ Exceso: <strong>{calculo.desglose.exceso_m3?.toFixed(2)} m³</strong> × {moneda}{calculo.desglose.precio_exceso?.toFixed(2)}/m³ = {moneda}{calculo.desglose.monto_exceso?.toFixed(2)}</div>
                            <div style={{ marginTop: '6px', fontSize: '15px', fontWeight: 700 }}>Total: {moneda}{calculo.total.toFixed(2)} <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--at-success)' }}>({calculo.tipo_cobro})</span></div>
                          </>
                        )}
                      </div>
                    ) : (
                      <div style={{ ...inputStyle, color: 'var(--at-ink-3)', background: 'var(--at-surface-2)' }}>—</div>
                    )}
                  </div>
                  <div>
                    <label style={labelStyle}>Fecha Lectura Anterior</label>
                    {esPrimeraLectura ? (
                      <>
                        <input type="date" value={fechaAnteriorManual || (ultimaLecturaInfo.fecha ? ultimaLecturaInfo.fecha.split('T')[0] : '')} onChange={e => setFechaAnteriorManual(e.target.value)} style={{ ...inputStyle, borderColor: 'var(--at-warning)' }} />
                        <div style={{ fontSize: '11px', color: 'var(--at-warning-strong)', marginTop: '4px' }}>Primera lectura — puede establecer la fecha de inicio del servicio</div>
                      </>
                    ) : (
                      <input type="date" readOnly value={fechaLecturaAnterior ? fechaLecturaAnterior.split('T')[0] : ''} style={{ ...inputStyle, background: 'var(--at-surface-2)', color: 'var(--at-ink)' }} />
                    )}
                  </div>
                  <div>
                    <label style={labelStyle}>Fecha Lectura Actual</label>
                    <input type="date" value={fechaLecturaActual} onChange={e => setFechaLecturaActual(e.target.value)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Días de Servicio</label>
                    <input type="text" readOnly value={diasServicio !== null ? `${diasServicio} días` : '—'} style={{ ...inputStyle, fontWeight: 'bold', color: diasServicio !== null ? 'var(--at-primary)' : 'var(--at-ink-3)', background: 'var(--at-surface-2)' }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Estado Pago</label>
                    <select value={estado} onChange={e => setEstado(e.target.value as Registro['estado'])} style={inputStyle}>
                      <option value="pendiente">Pendiente</option>
                      <option value="pagado">Pagado</option>
                      <option value="mora">Mora</option>
                    </select>
                  </div>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={labelStyle}>Observaciones</label>
                    <input type="text" value={notas} onChange={e => setNotas(e.target.value)} placeholder="Opcional" style={inputStyle} />
                  </div>
                </div>

                {/* GPS y Foto */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '20px' }}>
                  <div>
                    <label style={labelStyle}>Ubicación GPS</label>
                    {gpsLoading && (
                      <div style={{ padding: '12px', background: 'var(--at-warning-tint)', border: '1px solid #fde047', borderRadius: '10px', fontSize: '13px', color: 'var(--at-warning-strong)' }}>
                        📡 Obteniendo ubicación automáticamente...
                      </div>
                    )}
                    {gps && !gpsLoading && (
                      <div style={{ padding: '12px', background: 'var(--at-success-tint)', border: '1px solid var(--at-success-border)', borderRadius: '10px', fontSize: '13px', color: 'var(--at-success-strong)' }}>
                        ✅ GPS activo: {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
                      </div>
                    )}
                    {gpsError && !gpsLoading && (
                      <div style={{ padding: '12px', background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '10px', fontSize: '13px', color: 'var(--at-danger)' }}>
                        ⚠️ {gpsError} — la lectura se guardará sin coordenadas
                      </div>
                    )}
                  </div>
                  <div>
                    <label style={{ border: '3px dashed var(--at-line-strong)', borderRadius: '12px', padding: '20px', textAlign: 'center', cursor: 'pointer', background: 'var(--at-surface-2)', display: 'block' }}>
                      <input type="file" accept="image/*" capture="environment" hidden onChange={handlePhoto} />
                      {foto ? <img src={foto} style={{ maxWidth: '100%', maxHeight: '150px', borderRadius: '8px' }} alt="foto" /> : <span>📷 Tocar para foto</span>}
                    </label>
                  </div>
                </div>

                {canEdit && (
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button onClick={handleGuardar} disabled={saving || tarifaExpirada || sinTarifa} style={{ padding: '12px 24px', background: (saving || tarifaExpirada || sinTarifa) ? 'var(--at-ink-3)' : 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: (saving || tarifaExpirada || sinTarifa) ? 'not-allowed' : 'pointer' }}>
                      {saving ? 'Guardando...' : enModoRuta ? `💾 Guardar y Avanzar (${rutaIndex + 1}/${unidadesOrdenadas.length})` : '💾 Guardar Lectura'}
                    </button>
                    <button onClick={limpiarFormulario} style={{ padding: '12px 24px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
                      Cancelar
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
