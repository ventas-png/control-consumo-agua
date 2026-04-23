import { useState, useEffect } from 'react'
import Swal from 'sweetalert2'
import type { Cliente, Registro, GPS, UserRole, Ruta, Tarifa, Contador, Unidad, Proyecto, UserSession } from '../../types'
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
  currentUser?: UserSession | null
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
  userRole,
  currentUser: _currentUser,
  proyectos = [],
  moneda = 'Q',
  onRegistroAdded,
  rutaActiva,
  onClearRuta,
  onRutaCompletada,
  canCreate: _canCreate = true,
}: Props) {
  // Derive project_id from current user's context
  const defaultProjectId = proyectos.length === 1 ? proyectos[0].id : null
  const projectId = defaultProjectId
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

  const canEdit = userRole !== 'viewer'

  const unidadSeleccionada = unidades.find(u => u.id === selectedUnidadId) ?? null
  const clienteDeUnidad = unidadSeleccionada?.cliente_id
    ? clientes.find(c => c.id === unidadSeleccionada.cliente_id) ?? null
    : null

  // Contadores de la unidad seleccionada
  const contadoresDeUnidad = unidadSeleccionada
    ? contadores.filter(c => c.unidad_id === unidadSeleccionada.id && c.activo)
    : []

  const contadorSeleccionado = contadores.find(c => c.id === selectedContadorId) ?? null
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

  function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = ev => setFoto(ev.target?.result as string)
    reader.readAsDataURL(f)
  }

  function enviarWhatsApp(registro: Registro) {
    const rawTel = clienteDeUnidad?.whatsapp ?? clienteDeUnidad?.telefono ?? ''
    if (!rawTel) { Swal.fire('Sin Teléfono', 'Este cliente no tiene teléfono registrado.', 'warning'); return }
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

  async function handleGuardar() {
    if (!unidadSeleccionada) return Swal.fire('Atención', 'Seleccione una unidad primero', 'warning')
    if (!contadorSeleccionado) return Swal.fire('Atención', 'Seleccione un contador', 'warning')
    if (sinTarifa) {
      Swal.fire('Sin Tarifa', 'El contador no tiene tarifa asignada. Asigne una tarifa al contador antes de registrar lecturas.', 'warning')
      return
    }
    if (tarifaExpirada) {
      Swal.fire({
        icon: 'warning',
        title: 'Tarifa No Vigente',
        text: 'La tarifa del contador no está vigente. Por favor actualice la tarifa del contador antes de registrar lecturas.',
        confirmButtonColor: '#0ea5e9',
      })
      return
    }
    if (consumo === null || isNaN(consumo)) return Swal.fire('Error', 'Datos de lectura inválidos', 'error')
    if (consumo < 0) return Swal.fire('Consumo Negativo', 'La lectura actual debe ser mayor o igual a la anterior.', 'error')

    const resultadoCobro = calcularTotalPagar(consumo, tarifaDelContador!.precio_m3, tarifaDelContador!.canon_fijo, tarifaDelContador!.consumo_minimo ?? 0, tarifaDelContador!.precio_m3_exceso ?? 0, contadorSeleccionado.cantidad_derecho_servicio_m3 ?? null)

    if (!projectId) {
      Swal.fire('Error', 'No se pudo determinar el proyecto del usuario', 'error')
      return
    }

    const registro = {
      cliente_id: clienteDeUnidad?.id ?? null,
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
      Swal.fire('Error', error?.message || 'No se pudo guardar en la base de datos', 'error')
      return
    }

    const nuevoRegistro = data[0] as Registro
    onRegistroAdded(nuevoRegistro)

    const result = await Swal.fire({
      icon: 'success',
      title: 'Lectura Guardada',
      text: '¿Deseas enviar el recibo por WhatsApp?',
      showCancelButton: true,
      confirmButtonColor: '#25D366',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Enviar WhatsApp',
      cancelButtonText: 'No, gracias',
    })

    if (result.isConfirmed) enviarWhatsApp(nuevoRegistro)

    if (enModoRuta) {
      // Marcar este contador como leído en la sesión actual
      const nuevosLeidos = new Set(contadoresLeidos).add(contadorSeleccionado.id)
      setContadoresLeidos(nuevosLeidos)

      // Contadores activos de la unidad actual que aún no se han leído
      const pendientes = contadoresDeUnidad.filter(c => !nuevosLeidos.has(c.id))

      if (pendientes.length > 0) {
        // Hay contadores pendientes en esta misma unidad — preguntar al operador
        const listaHtml = pendientes
          .map(c => `<li style="text-align:left;margin:4px 0"><b>${c.numero_serie}</b>${c.descripcion ? ` — ${c.descripcion}` : ''} <span style="color:#64748b;font-size:12px">(${c.tipo_agua})</span></li>`)
          .join('')

        const pregunta = await Swal.fire({
          icon: 'question',
          title: 'Contadores pendientes',
          html: `<div style="font-size:14px;margin-bottom:8px">Esta unidad tiene <b>${pendientes.length}</b> contador${pendientes.length > 1 ? 'es' : ''} sin leer:</div><ul style="list-style:none;padding:0">${listaHtml}</ul><div style="margin-top:10px;font-size:13px;color:#475569">¿Desea registrarlos antes de continuar?</div>`,
          showCancelButton: true,
          confirmButtonColor: '#0ea5e9',
          cancelButtonColor: '#64748b',
          confirmButtonText: 'Sí, registrar',
          cancelButtonText: 'No, siguiente parada',
        })

        if (pregunta.isConfirmed) {
          // Seleccionar el contador pendiente (auto si solo hay uno, selector si hay varios)
          let contadorElegidoId = pendientes[0].id
          if (pendientes.length > 1) {
            const opciones = Object.fromEntries(
              pendientes.map(c => [c.id, `${c.numero_serie}${c.descripcion ? ` — ${c.descripcion}` : ''}`])
            )
            const seleccion = await Swal.fire({
              title: 'Seleccione el contador',
              input: 'select',
              inputOptions: opciones,
              inputValue: pendientes[0].id,
              confirmButtonText: 'Seleccionar',
              showCancelButton: false,
            })
            if (seleccion.value) contadorElegidoId = seleccion.value
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
          await supabase.from('rutas').update({ completada: true }).eq('id', rutaActiva.id)
          onRutaCompletada?.(rutaActiva.id)
          onClearRuta?.()
        } else {
          setRutaModoManual(false)
        }
        Swal.fire('Ruta Finalizada', '¡Has completado todas las lecturas de la ruta!', 'success')
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

  const inputStyle: React.CSSProperties = { padding: '12px 16px', border: '2px solid #e2e8f0', borderRadius: '10px', fontSize: '15px', width: '100%', boxSizing: 'border-box' }
  const labelStyle: React.CSSProperties = { fontSize: '14px', fontWeight: 600, color: '#4a5568', marginBottom: '6px', display: 'block' }

  const consumoInvalido = consumo !== null && consumo < 0

  const bannerRuta = rutaActiva
    ? {
        bg: '#eff6ff',
        border: '#bfdbfe',
        color: '#1e40af',
        texto: `🗺️ Ruta: ${rutaActiva.nombre} — Unidad ${rutaIndex + 1} de ${unidadesOrdenadas.length}${rutaActiva.fecha_programada ? ` | 📅 ${new Date(rutaActiva.fecha_programada + 'T12:00:00').toLocaleDateString('es-GT')}` : ''}`,
      }
    : rutaModoManual
    ? {
        bg: '#f0fdf4',
        border: '#bbf7d0',
        color: '#166534',
        texto: `Modo Ruta ACTIVO — Unidad ${rutaIndex + 1} de ${unidadesOrdenadas.length}`,
      }
    : { bg: '#f0fdf4', border: '#bbf7d0', color: '#166534', texto: 'Modo Manual' }

  return (
    <div>
      {/* Ruta Control */}
      <div style={{ background: bannerRuta.bg, padding: '15px', borderRadius: '12px', marginBottom: '20px', border: `1px solid ${bannerRuta.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: bannerRuta.color, fontWeight: 600 }}>
          {bannerRuta.texto}
        </span>
        {canEdit && (
          enModoRuta ? (
            <button
              onClick={detenerRuta}
              style={{ padding: '8px 16px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
            >
              Detener Ruta
            </button>
          ) : (
            <button
              onClick={toggleModoManual}
              style={{ padding: '8px 16px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
            >
              🚀 Iniciar Ruta Manual
            </button>
          )
        )}
      </div>

      <div style={{ background: 'white', borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '20px', borderBottom: '2px solid #e2e8f0', paddingBottom: '12px' }}>
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
            <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '10px', marginBottom: '20px', border: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
              <div><small style={{ color: '#64748b' }}>Unidad</small><div style={{ fontWeight: 700 }}>{unidadSeleccionada.nombre}</div></div>
              {clienteDeUnidad && (
                <>
                  <div><small style={{ color: '#64748b' }}>Cliente</small><div style={{ fontWeight: 700 }}>{clienteDeUnidad.nombre}</div></div>
                  <div><small style={{ color: '#64748b' }}>Código</small><div style={{ fontWeight: 600, fontFamily: 'monospace' }}>{clienteDeUnidad.codigo}</div></div>
                  {clienteDeUnidad.telefono && (
                    <div><small style={{ color: '#64748b' }}>Teléfono</small><div style={{ fontWeight: 600 }}>{clienteDeUnidad.telefono}</div></div>
                  )}
                </>
              )}
              {!clienteDeUnidad && (
                <div><small style={{ color: '#64748b' }}>Cliente</small><div style={{ color: '#94a3b8', fontSize: '13px' }}>Sin cliente asignado</div></div>
              )}
            </div>

            {/* Selector de contador */}
            {contadoresDeUnidad.length === 0 ? (
              <div style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: '10px', padding: '14px 18px', marginBottom: '20px', color: '#854d0e', fontWeight: 600, fontSize: '14px' }}>
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
                <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '10px', marginBottom: '20px', border: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', fontSize: '13px' }}>
                  <div><small style={{ color: '#64748b' }}>N° Serie</small><div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{contadorSeleccionado.numero_serie}</div></div>
                  <div><small style={{ color: '#64748b' }}>Tipo Agua</small><div style={{ fontWeight: 600 }}>{contadorSeleccionado.tipo_agua}</div></div>
                  <div><small style={{ color: '#64748b' }}>Última Lectura</small><div style={{ fontWeight: 700 }}>{ultimaLectura}</div>{fechaLecturaAnterior && <div style={{ fontSize: '11px', color: '#94a3b8' }}>{new Date(fechaLecturaAnterior).toLocaleDateString('es-GT')}</div>}</div>
                  {tarifaDelContador && (
                    <>
                      <div><small style={{ color: '#64748b' }}>Tarifa</small><div style={{ fontWeight: 600 }}>{tarifaDelContador.nombre}</div></div>
                      <div><small style={{ color: '#64748b' }}>Precio/m³</small><div style={{ fontWeight: 600 }}>{moneda}{tarifaDelContador.precio_m3}</div></div>
                      {Number(tarifaDelContador.precio_m3_exceso ?? 0) > 0 && (
                        <div><small style={{ color: '#64748b' }}>Precio Exceso/m³</small><div style={{ fontWeight: 600 }}>{moneda}{tarifaDelContador.precio_m3_exceso}</div></div>
                      )}
                      <div><small style={{ color: '#64748b' }}>Canon Fijo</small><div style={{ fontWeight: 600 }}>{moneda}{tarifaDelContador.canon_fijo}</div></div>
                    </>
                  )}
                </div>

                {sinTarifa && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '10px', padding: '14px 18px', marginBottom: '12px', color: '#dc2626', fontWeight: 600, fontSize: '14px' }}>
                    El contador no tiene tarifa asignada. Vaya a Contadores y asigne una tarifa antes de registrar lecturas.
                  </div>
                )}
                {tarifaExpirada && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '10px', padding: '14px 18px', marginBottom: '12px', color: '#dc2626', fontWeight: 600, fontSize: '14px' }}>
                    Tarifa no vigente. No es posible registrar lecturas hasta que se actualice la tarifa del contador.
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '20px' }}>
                  <div>
                    <label style={labelStyle}>Lectura Actual</label>
                    <input type="number" step="0.01" value={lecturaActual} onChange={e => setLecturaActual(e.target.value)} placeholder="Ingrese lectura del medidor" style={{ ...inputStyle, borderColor: consumoInvalido ? '#dc2626' : '#e2e8f0' }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Consumo Calculado (m³)</label>
                    <input type="text" readOnly value={consumo !== null ? (consumoInvalido ? consumo.toFixed(2) + ' (ERROR)' : consumo.toFixed(2)) : ''} style={{ ...inputStyle, fontWeight: 'bold', color: consumoInvalido ? '#dc2626' : '#0ea5e9', background: '#f7fafc' }} />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>Desglose de Cobro</label>
                    {calculo ? (
                      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px 16px', fontSize: '13px', color: '#166534' }}>
                        {calculo.desglose.tramo === 1 && (
                          <>
                            <div>Consumo <strong>{consumo?.toFixed(2)} m³</strong> ≤ mínimo <strong>{tarifaDelContador?.consumo_minimo ?? 0} m³</strong> → Solo canon fijo</div>
                            <div style={{ marginTop: '6px', fontSize: '15px', fontWeight: 700 }}>Total: {moneda}{calculo.total.toFixed(2)} <span style={{ fontSize: '11px', fontWeight: 400, color: '#4ade80' }}>({calculo.tipo_cobro})</span></div>
                          </>
                        )}
                        {calculo.desglose.tramo === 2 && (
                          <>
                            <div><strong>{calculo.desglose.consumo_m3?.toFixed(2)} m³</strong> × {moneda}{calculo.desglose.precio_m3?.toFixed(2)}/m³</div>
                            <div style={{ marginTop: '6px', fontSize: '15px', fontWeight: 700 }}>Total: {moneda}{calculo.total.toFixed(2)} <span style={{ fontSize: '11px', fontWeight: 400, color: '#4ade80' }}>({calculo.tipo_cobro})</span></div>
                          </>
                        )}
                        {calculo.desglose.tramo === 3 && (
                          <>
                            <div>Derecho: <strong>{calculo.desglose.derecho_m3?.toFixed(2)} m³</strong> × {moneda}{calculo.desglose.precio_m3?.toFixed(2)}/m³ = {moneda}{calculo.desglose.monto_base?.toFixed(2)}</div>
                            <div>+ Exceso: <strong>{calculo.desglose.exceso_m3?.toFixed(2)} m³</strong> × {moneda}{calculo.desglose.precio_exceso?.toFixed(2)}/m³ = {moneda}{calculo.desglose.monto_exceso?.toFixed(2)}</div>
                            <div style={{ marginTop: '6px', fontSize: '15px', fontWeight: 700 }}>Total: {moneda}{calculo.total.toFixed(2)} <span style={{ fontSize: '11px', fontWeight: 400, color: '#4ade80' }}>({calculo.tipo_cobro})</span></div>
                          </>
                        )}
                      </div>
                    ) : (
                      <div style={{ ...inputStyle, color: '#94a3b8', background: '#f7fafc' }}>—</div>
                    )}
                  </div>
                  <div>
                    <label style={labelStyle}>Fecha Lectura Anterior</label>
                    {esPrimeraLectura ? (
                      <>
                        <input type="date" value={fechaAnteriorManual || (ultimaLecturaInfo.fecha ? ultimaLecturaInfo.fecha.split('T')[0] : '')} onChange={e => setFechaAnteriorManual(e.target.value)} style={{ ...inputStyle, borderColor: '#f59e0b' }} />
                        <div style={{ fontSize: '11px', color: '#b45309', marginTop: '4px' }}>Primera lectura — puede establecer la fecha de inicio del servicio</div>
                      </>
                    ) : (
                      <input type="date" readOnly value={fechaLecturaAnterior ? fechaLecturaAnterior.split('T')[0] : ''} style={{ ...inputStyle, background: '#f7fafc', color: '#1e293b' }} />
                    )}
                  </div>
                  <div>
                    <label style={labelStyle}>Fecha Lectura Actual</label>
                    <input type="date" value={fechaLecturaActual} onChange={e => setFechaLecturaActual(e.target.value)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Días de Servicio</label>
                    <input type="text" readOnly value={diasServicio !== null ? `${diasServicio} días` : '—'} style={{ ...inputStyle, fontWeight: 'bold', color: diasServicio !== null ? '#0ea5e9' : '#94a3b8', background: '#f7fafc' }} />
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
                      <div style={{ padding: '12px', background: '#fef9c3', border: '1px solid #fde047', borderRadius: '10px', fontSize: '13px', color: '#854d0e' }}>
                        📡 Obteniendo ubicación automáticamente...
                      </div>
                    )}
                    {gps && !gpsLoading && (
                      <div style={{ padding: '12px', background: '#dcfce7', border: '1px solid #86efac', borderRadius: '10px', fontSize: '13px', color: '#166534' }}>
                        ✅ GPS activo: {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
                      </div>
                    )}
                    {gpsError && !gpsLoading && (
                      <div style={{ padding: '12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '10px', fontSize: '13px', color: '#dc2626' }}>
                        ⚠️ {gpsError} — la lectura se guardará sin coordenadas
                      </div>
                    )}
                  </div>
                  <div>
                    <label style={{ border: '3px dashed #cbd5e0', borderRadius: '12px', padding: '20px', textAlign: 'center', cursor: 'pointer', background: '#f7fafc', display: 'block' }}>
                      <input type="file" accept="image/*" capture="environment" hidden onChange={handlePhoto} />
                      {foto ? <img src={foto} style={{ maxWidth: '100%', maxHeight: '150px', borderRadius: '8px' }} alt="foto" /> : <span>📷 Tocar para foto</span>}
                    </label>
                  </div>
                </div>

                {canEdit && (
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button onClick={handleGuardar} disabled={saving || tarifaExpirada || sinTarifa} style={{ padding: '12px 24px', background: (saving || tarifaExpirada || sinTarifa) ? '#94a3b8' : 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: (saving || tarifaExpirada || sinTarifa) ? 'not-allowed' : 'pointer' }}>
                      {saving ? 'Guardando...' : enModoRuta ? `💾 Guardar y Avanzar (${rutaIndex + 1}/${unidadesOrdenadas.length})` : '💾 Guardar Lectura'}
                    </button>
                    <button onClick={limpiarFormulario} style={{ padding: '12px 24px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
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
