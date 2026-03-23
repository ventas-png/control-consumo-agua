import { useState, useEffect } from 'react'
import Swal from 'sweetalert2'
import type { Cliente, Registro, GPS, UserRole } from '../../types'
import { supabase } from '../../lib/supabase'
import { calcularTotalPagar } from '../../lib/business'
import { APP_CONFIG } from '../../lib/config'

interface Props {
  clientes: Cliente[]
  registros: Registro[]
  userRole: UserRole
  onRegistroAdded: (registro: Registro) => void
}

export function LecturasSection({ clientes, registros, userRole, onRegistroAdded }: Props) {
  const [selectedClienteId, setSelectedClienteId] = useState('')
  const [lecturaActual, setLecturaActual] = useState('')
  const [estado, setEstado] = useState<Registro['estado']>('pendiente')
  const [mes, setMes] = useState('auto')
  const [notas, setNotas] = useState('')
  const [gps, setGps] = useState<GPS | null>(null)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [foto, setFoto] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [rutaActiva, setRutaActiva] = useState(false)
  const [rutaIndex, setRutaIndex] = useState(0)

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
  const clienteSeleccionado = clientes.find(c => c.id === selectedClienteId) ?? null

  function getUltimaLectura(clienteId: string): number {
    const cliente = clientes.find(c => c.id === clienteId)
    const historial = registros
      .filter(r => r.cliente_id === clienteId)
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
    return historial.length > 0 ? historial[0].lectura_actual : (cliente?.lectura_inicial ?? 0)
  }

  const ultimaLectura = clienteSeleccionado ? getUltimaLectura(clienteSeleccionado.id) : 0
  const lecturaNum = parseFloat(lecturaActual)
  const consumo = !isNaN(lecturaNum) ? lecturaNum - ultimaLectura : null
  const calculo =
    consumo !== null && consumo >= 0 && clienteSeleccionado
      ? calcularTotalPagar(consumo, clienteSeleccionado.tarifa, clienteSeleccionado.canon)
      : null

  function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = ev => setFoto(ev.target?.result as string)
    reader.readAsDataURL(f)
  }

  function enviarWhatsApp(registro: Registro) {
    const cliente = clientes.find(c => c.id === registro.cliente_id)
    let telefono = cliente?.telefono ?? ''
    if (!telefono) { Swal.fire('Sin Teléfono', 'Este cliente no tiene teléfono registrado.', 'warning'); return }
    telefono = telefono.replace(/[^0-9]/g, '')
    if (telefono.length === 8) telefono = APP_CONFIG.COUNTRY_CODE + telefono
    const total = registro.monto_calculado
    const msg = `Hola ${registro.cliente_nombre}, su recibo de agua potable:\n📅 Fecha: ${new Date(registro.fecha).toLocaleDateString()}\n💧 Lectura Actual: ${registro.lectura_actual}\n📊 Consumo: ${registro.consumo.toFixed(2)} m³\n💰 Total a Pagar: Q${total.toFixed(2)}\nℹ️ Estado: ${registro.estado.toUpperCase()}\n\nGracias por su pago puntual.`
    window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  function limpiarFormulario() {
    setSelectedClienteId('')
    setLecturaActual('')
    setEstado('pendiente')
    setNotas('')
    setFoto(null)
    // GPS se mantiene activo y actualizado automáticamente
  }

  async function handleGuardar() {
    if (!clienteSeleccionado) return Swal.fire('Atención', 'Seleccione un cliente primero', 'warning')
    if (consumo === null || isNaN(consumo)) return Swal.fire('Error', 'Datos de lectura inválidos', 'error')
    if (consumo < 0) return Swal.fire('Consumo Negativo', 'La lectura actual debe ser mayor o igual a la anterior.', 'error')

    const resultadoCobro = calcularTotalPagar(consumo, clienteSeleccionado.tarifa, clienteSeleccionado.canon)
    const mesNum = mes === 'auto' ? new Date().getMonth() + 1 : parseInt(mes)

    const registro = {
      cliente_id: clienteSeleccionado.id,
      cliente_nombre: clienteSeleccionado.nombre,
      fecha: new Date().toISOString(),
      lectura_anterior: ultimaLectura,
      lectura_actual: lecturaNum,
      consumo,
      tarifa_aplicada: clienteSeleccionado.tarifa,
      canon_aplicado: clienteSeleccionado.canon,
      monto_calculado: resultadoCobro.total,
      tipo_cobro: resultadoCobro.tipo_cobro,
      estado,
      mes: String(mesNum),
      notas,
      gps,
      foto,
    }

    setSaving(true)
    const { data, error } = await supabase.from('registros').insert(registro).select()
    setSaving(false)

    if (error || !data) {
      Swal.fire('Error', 'No se pudo guardar en la base de datos', 'error')
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

    if (rutaActiva) {
      const nextIndex = rutaIndex + 1
      if (nextIndex < clientes.length) {
        setRutaIndex(nextIndex)
        setSelectedClienteId(clientes[nextIndex].id)
        setLecturaActual('')
      } else {
        Swal.fire('Ruta Finalizada', '¡Has completado todas las lecturas!', 'info')
        setRutaActiva(false)
        limpiarFormulario()
      }
    } else {
      limpiarFormulario()
    }
  }

  function toggleRuta() {
    if (!rutaActiva) {
      setRutaActiva(true)
      setRutaIndex(0)
      if (clientes.length > 0) setSelectedClienteId(clientes[0].id)
    } else {
      setRutaActiva(false)
      limpiarFormulario()
    }
  }

  const inputStyle: React.CSSProperties = { padding: '12px 16px', border: '2px solid #e2e8f0', borderRadius: '10px', fontSize: '15px', width: '100%', boxSizing: 'border-box' }
  const labelStyle: React.CSSProperties = { fontSize: '14px', fontWeight: 600, color: '#4a5568', marginBottom: '6px', display: 'block' }

  const consumoInvalido = consumo !== null && consumo < 0

  return (
    <div>
      {/* Ruta Control */}
      <div style={{ background: '#f0fdf4', padding: '15px', borderRadius: '12px', marginBottom: '20px', border: '1px solid #bbf7d0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#166534', fontWeight: 600 }}>
          {rutaActiva ? `Modo Ruta ACTIVO — Cliente ${rutaIndex + 1} de ${clientes.length}` : 'Modo Manual'}
        </span>
        {canEdit && (
          <button
            onClick={toggleRuta}
            style={{ padding: '8px 16px', background: rutaActiva ? '#ef4444' : '#f1f5f9', color: rutaActiva ? 'white' : '#475569', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
          >
            {rutaActiva ? 'Detener Ruta' : '🚀 Iniciar Ruta'}
          </button>
        )}
      </div>

      <div style={{ background: 'white', borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '20px', borderBottom: '2px solid #e2e8f0', paddingBottom: '12px' }}>
          Ingreso de Lectura
        </div>

        {/* Selector de cliente */}
        <div style={{ marginBottom: '20px' }}>
          <label style={labelStyle}>Seleccionar Cliente</label>
          <select
            value={selectedClienteId}
            onChange={e => { setSelectedClienteId(e.target.value); setLecturaActual('') }}
            style={inputStyle}
          >
            <option value="">-- Buscar Cliente --</option>
            {clientes.map(c => (
              <option key={c.id} value={c.id}>{c.nombre} ({c.codigo})</option>
            ))}
          </select>
        </div>

        {/* Detalles cliente */}
        {clienteSeleccionado && (
          <>
            <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '10px', marginBottom: '20px', border: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px' }}>
              <div><small style={{ color: '#64748b' }}>Cliente</small><div style={{ fontWeight: 700 }}>{clienteSeleccionado.nombre}</div></div>
              <div><small style={{ color: '#64748b' }}>Medidor</small><div style={{ fontWeight: 700 }}>{clienteSeleccionado.medidor}</div></div>
              <div><small style={{ color: '#64748b' }}>Última Lectura</small><div style={{ fontWeight: 700 }}>{ultimaLectura}</div></div>
              <div><small style={{ color: '#64748b' }}>Tarifas</small><div style={{ fontSize: '13px' }}>Q{clienteSeleccionado.tarifa}/m³ | Canon: Q{clienteSeleccionado.canon}</div></div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '20px' }}>
              <div>
                <label style={labelStyle}>Lectura Actual</label>
                <input type="number" step="0.01" value={lecturaActual} onChange={e => setLecturaActual(e.target.value)} placeholder="Ingrese lectura del medidor" style={{ ...inputStyle, borderColor: consumoInvalido ? '#dc2626' : '#e2e8f0' }} />
              </div>
              <div>
                <label style={labelStyle}>Consumo Calculado (m³)</label>
                <input type="text" readOnly value={consumo !== null ? (consumoInvalido ? consumo.toFixed(2) + ' (ERROR)' : consumo.toFixed(2)) : ''} style={{ ...inputStyle, fontWeight: 'bold', color: consumoInvalido ? '#dc2626' : '#0ea5e9', background: '#f7fafc' }} />
              </div>
              <div>
                <label style={labelStyle}>Monto Estimado (Q)</label>
                <input type="text" readOnly value={calculo ? `Q${calculo.total.toFixed(2)} (${calculo.tipo_cobro})` : ''} style={{ ...inputStyle, fontWeight: 'bold', color: '#166534', background: '#f0fdf4' }} />
              </div>
              <div>
                <label style={labelStyle}>Mes Facturación</label>
                <select value={mes} onChange={e => setMes(e.target.value)} style={inputStyle}>
                  <option value="auto">Mes Actual</option>
                  {['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((m, i) => (
                    <option key={i+1} value={String(i+1)}>{m}</option>
                  ))}
                </select>
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
                <button onClick={handleGuardar} disabled={saving} style={{ padding: '12px 24px', background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
                  {saving ? 'Guardando...' : '💾 Guardar Lectura'}
                </button>
                <button onClick={limpiarFormulario} style={{ padding: '12px 24px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
                  Cancelar
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
