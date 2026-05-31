import { useState, type ChangeEvent, type FormEvent} from 'react'
import { notify } from '../shared/Dialog'
import { supabase } from '../../lib/supabase'
import type { Cliente, Contador, Tarifa } from '../../types'
import { calcularTotalPagar } from '../../lib/business'

interface Props {
  clientes: Cliente[]
  contadores: Contador[]
  tarifas: Tarifa[]
  onReadingAdded: () => void
  proyectoId: string
}

export function AdminNewReading({ clientes, tarifas, onReadingAdded, proyectoId }: Props) {
  const [selectedClienteId, setSelectedClienteId] = useState('')
  const [lecturaAnterior, setLecturaAnterior] = useState('')
  const [lecturaActual, setLecturaActual] = useState('')
  const [tariffId, setTariffId] = useState('')
  const [canon, setCanon] = useState('20')
  const [notas, setNotas] = useState('')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<{ image: File; preview: string } | null>(null)

  const selectedCliente = clientes.find(c => c.id === selectedClienteId)
  const proyectoTarifas = proyectoId
    ? tarifas.filter(t => t.project_id === proyectoId)
    : tarifas
  const selectedTariff = proyectoTarifas.find(t => t.id === tariffId)

  // Calcular consumo y costo
  const consumo = Math.max(0, parseFloat(lecturaActual) - parseFloat(lecturaAnterior) || 0)
  const tariffPrice = selectedTariff?.precio_m3 ?? 0
  const canolFixed = parseFloat(canon) || 0
  const calculation = consumo > 0
    ? calcularTotalPagar(consumo, tariffPrice, canolFixed)
    : { total: 0, tipo_cobro: 'Sin datos' as const, desglose: {} }

  const handleSelectImage = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        setPreview({
          image: file,
          preview: event.target?.result as string,
        })
      }
      reader.readAsDataURL(file)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    if (!selectedClienteId || !lecturaAnterior || !lecturaActual) {
      notify({
        variant: 'warning',
        title: 'Campos requeridos',
        text: 'Complete los datos de cliente y lecturas',
      })
      return
    }

    setLoading(true)

    try {
      // Subir foto si existe — guardamos el path bare; el display site
      // (CustomerPortal, etc.) firma vía useSignedUrl en cada render.
      let fotoPath: string | null = null
      if (preview) {
        const timestamp = Date.now()
        const path = `registros/${selectedClienteId}_${timestamp}`
        const { error: uploadError } = await supabase.storage
          .from('registro-fotos')
          .upload(path, preview.image, { contentType: preview.image.type })

        if (!uploadError) {
          fotoPath = path
        }
      }

      // Crear registro
      const { error } = await supabase.from('registros').insert({
        cliente_id: selectedClienteId,
        cliente_nombre: selectedCliente?.nombre,
        fecha: new Date().toISOString().split('T')[0],
        lectura_anterior: parseFloat(lecturaAnterior),
        lectura_actual: parseFloat(lecturaActual),
        consumo,
        tarifa_aplicada: tariffPrice,
        canon_aplicado: canolFixed,
        monto_calculado: calculation.total,
        tipo_cobro: calculation.tipo_cobro,
        estado: 'pendiente',
        notas,
        foto: fotoPath,
      })

      if (error) throw error

      notify({
        variant: 'success',
        title: 'Lectura registrada',
        text: `Se registró la lectura para ${selectedCliente?.nombre}`,
        duration: 1500,
      })

      // Reset form
      setSelectedClienteId('')
      setLecturaAnterior('')
      setLecturaActual('')
      setTariffId('')
      setCanon('20')
      setNotas('')
      setPreview(null)

      onReadingAdded()
    } catch (err) {
      console.error(err)
      notify({
        variant: 'error',
        title: 'Error',
        text: 'No se pudo guardar la lectura',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: '800px' }}>
      <form onSubmit={handleSubmit} style={{
        background: 'var(--at-surface)',
        padding: '32px',
        borderRadius: '16px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
      }}>
        <h2 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '24px', color: 'var(--at-ink)' }}>
          Registrar Nueva Lectura
        </h2>

        {/* Cliente */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: 'var(--at-ink-2)', marginBottom: '8px' }}>
            Cliente *
          </label>
          <select
            value={selectedClienteId}
            onChange={(e) => setSelectedClienteId(e.target.value)}
            required
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              border: '2px solid var(--at-line)',
              fontSize: '14px',
              fontFamily: 'inherit',
            }}
          >
            <option value="">-- Seleccionar cliente --</option>
            {clientes.map(c => (
              <option key={c.id} value={c.id}>{c.nombre} ({c.codigo})</option>
            ))}
          </select>
        </div>

        {/* Lectura Anterior y Actual */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: 'var(--at-ink-2)', marginBottom: '8px' }}>
              Lectura Anterior (m³) *
            </label>
            <input
              type="number"
              step="0.01"
              value={lecturaAnterior}
              onChange={(e) => setLecturaAnterior(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                border: '2px solid var(--at-line)',
                fontSize: '14px',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: 'var(--at-ink-2)', marginBottom: '8px' }}>
              Lectura Actual (m³) *
            </label>
            <input
              type="number"
              step="0.01"
              value={lecturaActual}
              onChange={(e) => setLecturaActual(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                border: '2px solid var(--at-line)',
                fontSize: '14px',
                fontFamily: 'inherit',
              }}
            />
          </div>
        </div>

        {/* Consumo calculado */}
        {consumo > 0 && (
          <div style={{
            padding: '12px',
            background: 'var(--at-primary-tint)',
            border: '1px solid var(--at-primary-soft-2)',
            borderRadius: '8px',
            fontSize: '14px',
            color: 'var(--at-primary-hover)',
            marginBottom: '20px',
            fontWeight: '600',
          }}>
            💧 Consumo: {consumo.toFixed(2)} m³
          </div>
        )}

        {/* Tarifa y Canon */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: 'var(--at-ink-2)', marginBottom: '8px' }}>
              Tarifa (Q/m³)
            </label>
            <input
              type="number"
              step="0.01"
              value={tariffPrice}
              readOnly
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                border: '2px solid var(--at-line)',
                fontSize: '14px',
                fontFamily: 'inherit',
                background: 'var(--at-surface-2)',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: 'var(--at-ink-2)', marginBottom: '8px' }}>
              Canon Fijo (Q)
            </label>
            <input
              type="number"
              step="0.01"
              value={canon}
              onChange={(e) => setCanon(e.target.value)}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                border: '2px solid var(--at-line)',
                fontSize: '14px',
                fontFamily: 'inherit',
              }}
            />
          </div>
        </div>

        {/* Total a pagar */}
        {calculation.total > 0 && (
          <div style={{
            padding: '12px',
            background: 'var(--at-success-tint)',
            border: '1px solid var(--at-success-border)',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: '700',
            color: 'var(--at-success-strong)',
            marginBottom: '20px',
          }}>
            💰 Total a Pagar: Q {calculation.total.toFixed(2)}
          </div>
        )}

        {/* Notas */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: 'var(--at-ink-2)', marginBottom: '8px' }}>
            Notas
          </label>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              border: '2px solid var(--at-line)',
              fontSize: '14px',
              fontFamily: 'inherit',
              minHeight: '80px',
              resize: 'vertical',
            }}
            placeholder="Observaciones sobre la lectura..."
          />
        </div>

        {/* Subir foto */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: 'var(--at-ink-2)', marginBottom: '8px' }}>
            Foto del Medidor (opcional)
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={handleSelectImage}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              border: '2px solid var(--at-line)',
              fontSize: '14px',
              fontFamily: 'inherit',
            }}
          />
          {preview && (
            <div style={{ marginTop: '12px' }}>
              <img
                src={preview.preview}
                alt="Vista previa"
                style={{
                  maxWidth: '100%',
                  maxHeight: '200px',
                  borderRadius: '8px',
                  border: '1px solid var(--at-line)',
                }}
              />
            </div>
          )}
        </div>

        {/* Botón Submit */}
        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: '14px',
            background: loading ? 'var(--at-line-strong)' : 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-primary-hover) 100%)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: '700',
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
          }}
        >
          {loading ? '⏳ Guardando...' : '✓ Guardar Lectura'}
        </button>
      </form>
    </div>
  )
}
