import { MetodoCalculo, RubroConfig } from '../../types'

interface Props {
  rubros: RubroConfig[]
  onChange: (rubros: RubroConfig[]) => void
  disabled?: boolean
}

const METODO_LABELS: Record<MetodoCalculo, string> = {
  fijo: 'Fijo (mismo para todos)',
  por_m2: 'Por m² (monto × área)',
  alicuota: 'Alícuota % (% de participación)',
}

const VALOR_LABEL: Record<MetodoCalculo, string> = {
  fijo: 'Monto fijo (₡)',
  por_m2: 'Precio por m² (₡)',
  alicuota: 'Monto total del gasto (₡)',
}

export function RubrosBuilder({ rubros, onChange, disabled }: Props) {
  function agregar() {
    onChange([...rubros, { nombre: '', metodo: 'fijo', valor: 0 }])
  }

  function actualizar(idx: number, campo: keyof RubroConfig, valor: string | number) {
    const copia = rubros.map((r, i) => (i === idx ? { ...r, [campo]: valor } : r))
    onChange(copia)
  }

  function eliminar(idx: number) {
    onChange(rubros.filter((_, i) => i !== idx))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">Rubros de la cuota</span>
        {!disabled && (
          <button
            type="button"
            onClick={agregar}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Agregar rubro
          </button>
        )}
      </div>

      {rubros.length === 0 && (
        <div className="text-center py-6 text-sm text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
          Sin rubros. Agrega al menos un rubro para continuar.
        </div>
      )}

      <div className="space-y-2">
        {rubros.map((r, idx) => (
          <div
            key={idx}
            className="grid grid-cols-12 gap-2 items-start bg-gray-50 border border-gray-200 rounded-lg p-3"
          >
            {/* Nombre */}
            <div className="col-span-4">
              <label className="block text-xs text-gray-500 mb-1">Nombre del rubro</label>
              <input
                type="text"
                value={r.nombre}
                onChange={e => actualizar(idx, 'nombre', e.target.value)}
                disabled={disabled}
                placeholder="Ej: Mantenimiento, Seguro…"
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100"
              />
            </div>

            {/* Método */}
            <div className="col-span-4">
              <label className="block text-xs text-gray-500 mb-1">Método de cálculo</label>
              <select
                value={r.metodo}
                onChange={e => actualizar(idx, 'metodo', e.target.value as MetodoCalculo)}
                disabled={disabled}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100"
              >
                {(Object.keys(METODO_LABELS) as MetodoCalculo[]).map(m => (
                  <option key={m} value={m}>{METODO_LABELS[m]}</option>
                ))}
              </select>
            </div>

            {/* Valor */}
            <div className="col-span-3">
              <label className="block text-xs text-gray-500 mb-1">{VALOR_LABEL[r.metodo]}</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={r.valor || ''}
                onChange={e => actualizar(idx, 'valor', parseFloat(e.target.value) || 0)}
                disabled={disabled}
                placeholder="0.00"
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100"
              />
            </div>

            {/* Eliminar */}
            <div className="col-span-1 flex justify-end pt-5">
              {!disabled && (
                <button
                  type="button"
                  onClick={() => eliminar(idx)}
                  className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                  title="Eliminar rubro"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>

            {/* Hint contextual */}
            {r.metodo !== 'fijo' && (
              <div className="col-span-12 -mt-1">
                <p className="text-xs text-indigo-600">
                  {r.metodo === 'por_m2'
                    ? '↑ Cada unidad pagará este precio × su área en m². Unidades sin área quedan en ₡0.'
                    : '↑ Se distribuirá este total entre las unidades según su % de alícuota. Si no tiene alícuota, se usa la proporción de m².'}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {rubros.length > 0 && (
        <div className="flex justify-end">
          <span className="text-xs text-gray-500">
            {rubros.length} rubro{rubros.length !== 1 ? 's' : ''} configurado{rubros.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  )
}
