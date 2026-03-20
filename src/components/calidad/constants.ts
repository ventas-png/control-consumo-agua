import type { Tipologia, TipoAgua } from '../../types'

export const TIPOLOGIAS_CALIDAD: Record<TipoAgua, Tipologia> = {
  potable: {
    label: 'Agua Potable',
    parametros: [
      { key: 'pH', label: 'pH', unidad: '', min: 6.5, max: 8.5 },
      { key: 'turbiedad', label: 'Turbiedad', unidad: 'NTU', min: 0, max: 5 },
      { key: 'cloro_residual', label: 'Cloro Residual', unidad: 'mg/L', min: 0.2, max: 1.0 },
      { key: 'coliformes_totales', label: 'Coliformes Totales', unidad: 'UFC/100mL', min: 0, max: 0 },
      { key: 'coliformes_fecales', label: 'Coliformes Fecales', unidad: 'UFC/100mL', min: 0, max: 0 },
      { key: 'color', label: 'Color', unidad: 'UPC', min: 0, max: 15 },
      { key: 'dureza', label: 'Dureza', unidad: 'mg/L CaCO₃', min: 0, max: 400 },
      { key: 'nitratos', label: 'Nitratos', unidad: 'mg/L', min: 0, max: 50 },
      { key: 'nitritos', label: 'Nitritos', unidad: 'mg/L', min: 0, max: 3 },
      { key: 'sulfatos', label: 'Sulfatos', unidad: 'mg/L', min: 0, max: 250 },
      { key: 'conductividad', label: 'Conductividad', unidad: 'µS/cm', min: 0, max: 1500 },
    ],
  },
  rehuso: {
    label: 'Agua de Rehuso',
    parametros: [
      { key: 'pH', label: 'pH', unidad: '', min: 6.0, max: 9.0 },
      { key: 'DBO', label: 'DBO', unidad: 'mg/L', min: 0, max: 30 },
      { key: 'DQO', label: 'DQO', unidad: 'mg/L', min: 0, max: 100 },
      { key: 'solidos_suspendidos', label: 'Sólidos Suspendidos', unidad: 'mg/L', min: 0, max: 30 },
      { key: 'coliformes_fecales', label: 'Coliformes Fecales', unidad: 'UFC/100mL', min: 0, max: 1000 },
      { key: 'grasas_aceites', label: 'Grasas y Aceites', unidad: 'mg/L', min: 0, max: 10 },
    ],
  },
  piscina: {
    label: 'Agua Piscina',
    parametros: [
      { key: 'pH', label: 'pH', unidad: '', min: 7.2, max: 7.8 },
      { key: 'cloro_libre', label: 'Cloro Libre', unidad: 'mg/L', min: 1.0, max: 3.0 },
      { key: 'cloro_combinado', label: 'Cloro Combinado', unidad: 'mg/L', min: 0, max: 0.5 },
      { key: 'temperatura', label: 'Temperatura', unidad: '°C', min: 0, max: 30 },
      { key: 'turbiedad', label: 'Turbiedad', unidad: 'NTU', min: 0, max: 0.5 },
    ],
  },
  desalinada: {
    label: 'Agua Desalinada',
    parametros: [
      { key: 'conductividad', label: 'Conductividad', unidad: 'µS/cm', min: 0, max: 1000 },
      { key: 'TDS', label: 'TDS', unidad: 'mg/L', min: 0, max: 500 },
      { key: 'pH', label: 'pH', unidad: '', min: 6.5, max: 8.5 },
      { key: 'salinidad', label: 'Salinidad', unidad: 'g/L', min: 0, max: 0.5 },
      { key: 'turbiedad', label: 'Turbiedad', unidad: 'NTU', min: 0, max: 1 },
      { key: 'sulfatos', label: 'Sulfatos', unidad: 'mg/L', min: 0, max: 250 },
    ],
  },
  riego: {
    label: 'Agua de Riego',
    parametros: [
      { key: 'pH', label: 'pH', unidad: '', min: 5.5, max: 8.5 },
      { key: 'conductividad', label: 'Conductividad', unidad: 'µS/cm', min: 0, max: 3000 },
      { key: 'sodio', label: 'Sodio', unidad: 'mg/L', min: 0, max: 200 },
      { key: 'cloruros', label: 'Cloruros', unidad: 'mg/L', min: 0, max: 350 },
      { key: 'bicarbonatos', label: 'Bicarbonatos', unidad: 'mg/L', min: 0, max: 400 },
      { key: 'nitratos', label: 'Nitratos', unidad: 'mg/L', min: 0, max: 50 },
      { key: 'RAS', label: 'RAS', unidad: '', min: 0, max: 18 },
    ],
  },
  jacuzzi: {
    label: 'Agua Jacuzzi',
    parametros: [
      { key: 'pH', label: 'pH', unidad: '', min: 7.2, max: 7.8 },
      { key: 'cloro_libre', label: 'Cloro Libre', unidad: 'mg/L', min: 2.0, max: 5.0 },
      { key: 'cloro_combinado', label: 'Cloro Combinado', unidad: 'mg/L', min: 0, max: 1.0 },
      { key: 'temperatura', label: 'Temperatura', unidad: '°C', min: 0, max: 40 },
      { key: 'alcalinidad_total', label: 'Alcalinidad Total', unidad: 'mg/L', min: 80, max: 120 },
      { key: 'turbiedad', label: 'Turbiedad', unidad: 'NTU', min: 0, max: 0.5 },
    ],
  },
  consumo_humano: {
    label: 'Agua de Consumo Humano',
    parametros: [
      { key: 'pH', label: 'pH', unidad: '', min: 6.5, max: 8.5 },
      { key: 'turbiedad', label: 'Turbiedad', unidad: 'NTU', min: 0, max: 1 },
      { key: 'cloro_residual', label: 'Cloro Residual', unidad: 'mg/L', min: 0.2, max: 1.5 },
      { key: 'coliformes_totales', label: 'Coliformes Totales', unidad: 'UFC/100mL', min: 0, max: 0 },
      { key: 'ecoli', label: 'E. coli', unidad: 'UFC/100mL', min: 0, max: 0 },
      { key: 'color', label: 'Color', unidad: 'UPC', min: 0, max: 15 },
      { key: 'dureza_total', label: 'Dureza Total', unidad: 'mg/L CaCO₃', min: 0, max: 500 },
    ],
  },
  desmineralizada: {
    label: 'Agua Desmineralizada',
    parametros: [
      { key: 'conductividad', label: 'Conductividad', unidad: 'µS/cm', min: 0, max: 10 },
      { key: 'TDS', label: 'TDS', unidad: 'mg/L', min: 0, max: 5 },
      { key: 'pH', label: 'pH', unidad: '', min: 5.5, max: 7.0 },
      { key: 'silice', label: 'Sílice', unidad: 'mg/L', min: 0, max: 0.02 },
      { key: 'dureza', label: 'Dureza', unidad: 'mg/L CaCO₃', min: 0, max: 1 },
    ],
  },
  residuales_tratadas: {
    label: 'Aguas Residuales Tratadas',
    parametros: [
      { key: 'pH', label: 'pH', unidad: '', min: 6.0, max: 9.0 },
      { key: 'DBO', label: 'DBO', unidad: 'mg/L', min: 0, max: 20 },
      { key: 'DQO', label: 'DQO', unidad: 'mg/L', min: 0, max: 60 },
      { key: 'SST', label: 'Sólidos Suspendidos Totales', unidad: 'mg/L', min: 0, max: 20 },
      { key: 'grasas_aceites', label: 'Grasas y Aceites', unidad: 'mg/L', min: 0, max: 5 },
      { key: 'coliformes_fecales', label: 'Coliformes Fecales', unidad: 'UFC/100mL', min: 0, max: 400 },
      { key: 'nitrogeno_total', label: 'Nitrógeno Total', unidad: 'mg/L', min: 0, max: 15 },
      { key: 'fosforo_total', label: 'Fósforo Total', unidad: 'mg/L', min: 0, max: 2 },
    ],
  },
}

export function calcularCumplimiento(
  tipo_agua: TipoAgua,
  parametros: Record<string, number>
): { cumplimiento: Record<string, boolean | null>; cumple_total: boolean } {
  const tipologia = TIPOLOGIAS_CALIDAD[tipo_agua]
  if (!tipologia) return { cumplimiento: {}, cumple_total: false }
  const cumplimiento: Record<string, boolean | null> = {}
  let todosCumplen = true
  tipologia.parametros.forEach(p => {
    const val = parseFloat(String(parametros[p.key]))
    if (isNaN(val)) { cumplimiento[p.key] = null; return }
    const ok =
      p.min === p.max && p.min === 0 ? val === 0 : val >= p.min && val <= p.max
    cumplimiento[p.key] = ok
    if (!ok) todosCumplen = false
  })
  return { cumplimiento, cumple_total: todosCumplen }
}
