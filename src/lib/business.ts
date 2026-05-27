import type { CostoCalculo } from '../types'

export function calcularTotalPagar(
  consumo: number,
  tarifa: number,
  canon: number,
  consumoMinimo = 0,
  tarifaExceso = 0,
  derechoServicioM3: number | null = null,
): CostoCalculo {
  const t = parseFloat(String(tarifa || 0))
  const tExceso = parseFloat(String(tarifaExceso || 0))
  const canonVal = parseFloat(String(canon || 0))

  // Tramo 1: consumo ≤ mínimo → solo canon fijo
  if (consumo >= 0 && consumo <= consumoMinimo) {
    return {
      total: canonVal,
      tipo_cobro: 'Canon Fijo',
      desglose: { tramo: 1, canon_fijo: canonVal },
    }
  }

  // Tramo 3: consumo > derecho de servicio → base a precio normal + exceso a precio exceso
  if (derechoServicioM3 && derechoServicioM3 > 0 && tExceso > 0 && consumo > derechoServicioM3) {
    const monto_base = derechoServicioM3 * t
    const exceso_m3 = consumo - derechoServicioM3
    const monto_exceso = exceso_m3 * tExceso
    return {
      total: monto_base + monto_exceso,
      tipo_cobro: 'Consumo con Exceso',
      desglose: { tramo: 3, derecho_m3: derechoServicioM3, precio_m3: t, exceso_m3, precio_exceso: tExceso, monto_base, monto_exceso },
    }
  }

  // Tramo 2: consumo > mínimo y dentro del derecho de servicio (o sin derecho configurado)
  return {
    total: consumo * t,
    tipo_cobro: 'Consumo Normal',
    desglose: { tramo: 2, consumo_m3: consumo, precio_m3: t },
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Validación de lectura del medidor (agua:C1, F2.3)
// ────────────────────────────────────────────────────────────────────────────
// Reglas de negocio que el cliente debe verificar ANTES de invocar
// calcularTotalPagar / guardar el registro. Si la lectura no es válida y el
// operador no marcó explícitamente un reset del medidor, hay que pedirle que
// la corrija (foto del medidor a la vista, normalmente).
//
// Por qué validar acá y no solo en DB: el CHECK constraint en `registros`
// (migración 20260524000000_business_check_constraints.sql) solo verifica
// `consumo >= 0`. Eso permite el caso legítimo de "reseteo del medidor" donde
// el operador captura una lectura menor pero deja `consumo = 0` con una nota.
// La validación rica (con detección de salto anómalo y motivo del reset)
// vive aquí.

export interface ValidacionLecturaOpciones {
  // True si el operador confirma que el medidor fue reemplazado/reseteado y
  // por eso la lectura actual es menor que la anterior. Debe ir acompañado de
  // una nota explicativa que el caller incluye en `registros.notas`.
  resetContador?: boolean
  // Promedio histórico de consumo del cliente (m³). Usado para detección de
  // salto anómalo. Si no se provee, no se evalúa "consumo sospechoso".
  promedioHistorico?: number
  // Múltiplo del promedio considerado "anormal". Default: 3× (un salto >3×
  // el promedio histórico es probablemente fuga, fraude o error de captura).
  factorAnormal?: number
}

export interface ValidacionLecturaResultado {
  valid: boolean
  // Texto a mostrar al operador cuando `valid === false`.
  error?: string
  // Cuando `valid === true` pero el consumo es sospechoso. La captura no se
  // bloquea; el caller decide cómo presentarlo (modal de confirmación, badge
  // ámbar, etc.).
  warning?: string
  // Consumo calculado (= lecturaActual - lecturaAnterior) si la lectura es
  // válida y no hubo reset. En caso de reset se reporta 0.
  consumo?: number
}

const FACTOR_ANORMAL_DEFAULT = 3

export function validarLectura(
  lecturaAnterior: number | null | undefined,
  lecturaActual: number | null | undefined,
  opciones: ValidacionLecturaOpciones = {},
): ValidacionLecturaResultado {
  const ant = Number(lecturaAnterior ?? 0)
  const act = Number(lecturaActual ?? 0)

  if (!Number.isFinite(ant) || !Number.isFinite(act)) {
    return { valid: false, error: 'Las lecturas deben ser números válidos.' }
  }
  if (act < 0) {
    return { valid: false, error: 'La lectura actual no puede ser negativa.' }
  }
  if (ant < 0) {
    return { valid: false, error: 'La lectura anterior no puede ser negativa.' }
  }

  // Caso 1: lectura actual menor que la anterior.
  // Solo válido si el operador marcó explícitamente reset del medidor.
  if (act < ant) {
    if (opciones.resetContador) {
      return {
        valid: true,
        consumo: 0,
        warning: 'Marcaste reset del medidor. Asegúrate de incluir el motivo en las notas del registro.',
      }
    }
    return {
      valid: false,
      error: `La lectura actual (${act}) es menor que la anterior (${ant}). ` +
             `Si el medidor fue reemplazado o reseteado, marca esa opción y agrega notas explicando el cambio físico.`,
    }
  }

  const consumo = act - ant

  // Caso 2: detección de salto anómalo.
  // Si el caller provee `promedioHistorico`, comparamos contra él. Esto NO
  // bloquea la captura, solo emite un warning.
  if (typeof opciones.promedioHistorico === 'number' && opciones.promedioHistorico > 0) {
    const factor = opciones.factorAnormal ?? FACTOR_ANORMAL_DEFAULT
    const umbral = opciones.promedioHistorico * factor
    if (consumo > umbral) {
      return {
        valid: true,
        consumo,
        warning:
          `El consumo (${consumo}) es ${factor}× mayor que el promedio histórico ` +
          `(${opciones.promedioHistorico.toFixed(1)}). Revisa la foto del medidor, ` +
          `posible fuga o error de captura.`,
      }
    }
  }

  return { valid: true, consumo }
}
