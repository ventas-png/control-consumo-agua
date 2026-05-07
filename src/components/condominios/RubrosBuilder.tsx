import { MetodoCalculo, RubroConfig } from '../../types'

interface Props {
  rubros: RubroConfig[]
  onChange: (rubros: RubroConfig[]) => void
  disabled?: boolean
  moneda?: string
}

const METODO_OPTIONS: { value: MetodoCalculo; label: string; hint: string }[] = [
  { value: 'fijo',     label: 'Fijo',      hint: 'Mismo monto para todas las unidades' },
  { value: 'por_m2',  label: 'Por m²',    hint: 'Monto × área de la unidad' },
  { value: 'alicuota',label: 'Alícuota',  hint: '% de participación × total del gasto' },
]

const VALOR_PLACEHOLDER: Record<MetodoCalculo, string> = {
  fijo:     '0.00',
  por_m2:   '0.00 /m²',
  alicuota: '0.00 total',
}

const METODO_BADGE: Record<MetodoCalculo, { bg: string; color: string }> = {
  fijo:     { bg: '#eff6ff', color: '#2563eb' },
  por_m2:   { bg: '#f0fdf4', color: '#16a34a' },
  alicuota: { bg: '#fdf4ff', color: '#7c3aed' },
}

export function RubrosBuilder({ rubros, onChange, disabled, moneda = '' }: Props) {
  function agregar() {
    onChange([...rubros, { nombre: '', metodo: 'fijo', valor: 0 }])
  }

  function actualizar(idx: number, campo: keyof RubroConfig, valor: string | number) {
    onChange(rubros.map((r, i) => (i === idx ? { ...r, [campo]: valor } : r)))
  }

  function eliminar(idx: number) {
    onChange(rubros.filter((_, i) => i !== idx))
  }

  const monedaLabel = moneda ? `${moneda} ` : ''

  return (
    <div>
      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
          Rubros{' '}
          <span style={{ fontSize: 11, fontWeight: 400, color: '#9ca3af' }}>
            ({rubros.length} configurado{rubros.length !== 1 ? 's' : ''})
          </span>
        </span>
        {!disabled && (
          <button
            type="button"
            onClick={agregar}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 12, fontWeight: 600, background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Agregar rubro
          </button>
        )}
      </div>

      {rubros.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 12, color: '#9ca3af', border: '1.5px dashed #e5e7eb', borderRadius: 8 }}>
          Sin rubros. Agrega al menos uno para continuar.
        </div>
      ) : (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          {/* Header de columnas */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 130px 150px 32px', gap: 0, background: '#f8fafc', borderBottom: '1px solid #e5e7eb', padding: '6px 10px' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.04em' }}>Nombre del rubro</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.04em' }}>Método</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.04em' }}>Valor ({monedaLabel.trim() || '—'})</span>
            <span />
          </div>

          {/* Filas */}
          {rubros.map((r, idx) => {
            const badge = METODO_BADGE[r.metodo]
            return (
              <div
                key={idx}
                style={{ display: 'grid', gridTemplateColumns: '2fr 130px 150px 32px', gap: 0, alignItems: 'center', borderBottom: idx < rubros.length - 1 ? '1px solid #f3f4f6' : 'none', padding: '8px 10px', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}
              >
                {/* Nombre */}
                <input
                  type="text"
                  value={r.nombre}
                  onChange={e => actualizar(idx, 'nombre', e.target.value)}
                  disabled={disabled}
                  placeholder="Ej: Mantenimiento, Seguro…"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 6, background: disabled ? '#f9fafb' : '#fff', outline: 'none', marginRight: 8 }}
                />

                {/* Método */}
                <select
                  value={r.metodo}
                  onChange={e => actualizar(idx, 'metodo', e.target.value as MetodoCalculo)}
                  disabled={disabled}
                  style={{ width: '100%', padding: '6px 6px', fontSize: 12, fontWeight: 600, border: '1px solid #e5e7eb', borderRadius: 6, background: disabled ? '#f9fafb' : badge.bg, color: badge.color, cursor: disabled ? 'default' : 'pointer', marginRight: 8 }}
                >
                  {METODO_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>

                {/* Valor */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginRight: 4 }}>
                  {moneda && <span style={{ fontSize: 12, color: '#6b7280', flexShrink: 0 }}>{moneda}</span>}
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={r.valor || ''}
                    onChange={e => actualizar(idx, 'valor', parseFloat(e.target.value) || 0)}
                    disabled={disabled}
                    placeholder={VALOR_PLACEHOLDER[r.metodo]}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '6px 6px', fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 6, background: disabled ? '#f9fafb' : '#fff', textAlign: 'right' }}
                  />
                </div>

                {/* Eliminar */}
                {!disabled ? (
                  <button
                    type="button"
                    onClick={() => eliminar(idx)}
                    style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid #fca5a5', borderRadius: 6, cursor: 'pointer', color: '#ef4444', fontSize: 14, flexShrink: 0 }}
                    title="Eliminar rubro"
                  >
                    ×
                  </button>
                ) : <span />}
              </div>
            )
          })}
        </div>
      )}

      {/* Hints */}
      {rubros.some(r => r.metodo !== 'fijo') && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {rubros.some(r => r.metodo === 'por_m2') && (
            <p style={{ margin: 0, fontSize: 11, color: '#16a34a' }}>
              🟢 <strong>Por m²:</strong> cada unidad paga valor × su área. Sin área = {monedaLabel}0.
            </p>
          )}
          {rubros.some(r => r.metodo === 'alicuota') && (
            <p style={{ margin: 0, fontSize: 11, color: '#7c3aed' }}>
              🟣 <strong>Alícuota:</strong> el valor total se distribuye según el % de participación de cada unidad. Si no tiene alícuota definida, se calcula por proporción de m².
            </p>
          )}
        </div>
      )}
    </div>
  )
}
