import type { CostoCalculo, TarifaTramo } from '../types'

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

/**
 * Cobro por tarifa ESCALONADA (increasing-block tariff). Debajo del mínimo cobra
 * solo el canon fijo (mismo piso que el modelo plano); por encima suma bloque a
 * bloque sobre el consumo completo desde 0. Cada m³ dentro de `(desde_m3, hasta_m3]`
 * se cobra a `precio_m3`; el último bloque tiene `hasta_m3 = null` (∞). Bloques con
 * 0 m³ cubiertos se omiten del desglose. La contigüidad la garantiza la UI (ver
 * `validarTramos`), pero el cálculo es robusto ante huecos/solapes (cobra el
 * volumen recortado de cada bloque, sin doble conteo dentro de un mismo bloque).
 */
export function calcularTotalPagarEscalonado(
  consumo: number,
  tramos: TarifaTramo[],
  canon = 0,
  consumoMinimo = 0,
): CostoCalculo {
  const canonVal = parseFloat(String(canon || 0))
  // Tramo 1: consumo ≤ mínimo → solo canon fijo (piso mínimo, igual al modelo plano).
  if (consumo >= 0 && consumo <= consumoMinimo) {
    return { total: canonVal, tipo_cobro: 'Canon Fijo', desglose: { tramo: 1, canon_fijo: canonVal } }
  }
  const ordenados = [...tramos].sort((a, b) => (Number(a.desde_m3) || 0) - (Number(b.desde_m3) || 0))
  let total = 0
  const detalle: NonNullable<CostoCalculo['desglose']['tramos']> = []
  for (const tr of ordenados) {
    const desde = Number(tr.desde_m3) || 0
    const hasta = tr.hasta_m3 == null ? Infinity : Number(tr.hasta_m3)
    const precio = parseFloat(String(tr.precio_m3 || 0))
    const m3 = Math.max(0, Math.min(consumo, hasta) - desde)
    if (m3 <= 0) continue
    const monto = m3 * precio
    total += monto
    detalle.push({ desde_m3: desde, hasta_m3: tr.hasta_m3 ?? null, precio_m3: precio, m3, monto })
  }
  return { total, tipo_cobro: 'Consumo Escalonado', desglose: { tramo: 'escalonado', tramos: detalle } }
}

/** Entrada mínima de tarifa para resolver el cobro (la satisface `Tarifa`). */
export interface EntradaCostoTarifa {
  precio_m3: number
  precio_m3_exceso?: number | null
  canon_fijo: number
  consumo_minimo?: number | null
  tramos?: TarifaTramo[] | null
}

/**
 * Punto ÚNICO de decisión del cobro de una lectura: si la tarifa tiene bloques
 * (`tramos`), usa el modelo ESCALONADO; si no, el plano de 3 tramos
 * (`calcularTotalPagar`). Lo consume la captura de lecturas.
 */
export function calcularCostoTarifa(
  consumo: number,
  tarifa: EntradaCostoTarifa,
  derechoServicioM3: number | null = null,
): CostoCalculo {
  if (Array.isArray(tarifa.tramos) && tarifa.tramos.length > 0) {
    return calcularTotalPagarEscalonado(consumo, tarifa.tramos, tarifa.canon_fijo, tarifa.consumo_minimo ?? 0)
  }
  return calcularTotalPagar(
    consumo,
    tarifa.precio_m3,
    tarifa.canon_fijo,
    tarifa.consumo_minimo ?? 0,
    tarifa.precio_m3_exceso ?? 0,
    derechoServicioM3,
  )
}

/**
 * Valida un set de bloques escalonados para guardar la tarifa: ≥1 bloque,
 * contiguos desde 0 (sin huecos ni solapes), cada `hasta_m3 > desde_m3`, precios
 * ≥ 0, y solo el ÚLTIMO bloque sin tope (`hasta_m3 = null`). Devuelve el mensaje de
 * error o `null` si es válido.
 */
export function validarTramos(tramos: TarifaTramo[]): string | null {
  if (!Array.isArray(tramos) || tramos.length === 0) return 'Agregá al menos un bloque.'
  const ord = [...tramos].sort((a, b) => (Number(a.desde_m3) || 0) - (Number(b.desde_m3) || 0))
  let esperadoDesde = 0
  for (let i = 0; i < ord.length; i++) {
    const t = ord[i]
    const esUltimo = i === ord.length - 1
    const desde = Number(t.desde_m3)
    const precio = Number(t.precio_m3)
    if (!Number.isFinite(desde) || desde < 0) return 'Los límites deben ser números ≥ 0.'
    if (Math.abs(desde - esperadoDesde) > 1e-9) return 'Los bloques deben ser contiguos desde 0 (sin huecos ni solapes).'
    if (!Number.isFinite(precio) || precio < 0) return 'Los precios por m³ deben ser ≥ 0.'
    if (esUltimo) {
      if (t.hasta_m3 != null && Number(t.hasta_m3) <= desde) return 'El límite superior del último bloque debe ser mayor a su inicio (o vacío = ∞).'
    } else {
      if (t.hasta_m3 == null) return 'Solo el último bloque puede quedar sin tope.'
      const hasta = Number(t.hasta_m3)
      if (!Number.isFinite(hasta) || hasta <= desde) return 'Cada bloque debe terminar por encima de su inicio.'
      esperadoDesde = hasta
    }
  }
  return null
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

// ════════════════════════════════════════════════════════════════════════════
// T4 · Facturación de dominio (agua:C4) — Agregado Factura: IVA + mora + máquina
// de estados. Funciones PURAS (sin I/O), espejo de la migración
// 20260604160000_factura_state_machine_mora_iva.sql. ADITIVO: no modifica las
// firmas existentes (calcularTotalPagar / validarLectura) que consume App.tsx.
//
// La capa de datos las orquesta; la edge fn de mora (cron) y la UI de
// cobros/tarifas reutilizan estas funciones (follow-ups del track).
// ════════════════════════════════════════════════════════════════════════════

// ── Redondeo monetario ──────────────────────────────────────────────────────
// La DB guarda numeric(12,2). Redondeamos a 2 decimales con "round half away
// from zero" para casar con el comportamiento de numeric de Postgres y evitar
// drift de centavos entre el cálculo en TS y la columna persistida.
export function redondear2(n: number): number {
  if (!Number.isFinite(n)) return 0
  // Epsilon para neutralizar el error de coma flotante (0.1+0.2) antes de
  // redondear: 1.005 debe dar 1.01, no 1.00.
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// ────────────────────────────────────────────────────────────────────────────
// IVA (agua:C4) — tasa configurable por tenant (companies.iva_tasa_default).
// GT = 0.12 (12%). La tasa se expresa como FRACCIÓN [0,1].
// ────────────────────────────────────────────────────────────────────────────

/** Tasa de IVA por defecto de Guatemala (12%). Fallback cuando el tenant no la define. */
export const IVA_TASA_GT = 0.12

export interface CalculoIVA {
  /** Base imponible (subtotal sin IVA) ya redondeada. */
  base: number
  /** Tasa aplicada (fracción [0,1]). */
  tasa: number
  /** Monto de IVA = base * tasa, redondeado a 2 decimales. */
  iva: number
  /** Total con IVA = base + iva, redondeado. */
  total: number
}

/**
 * Calcula el IVA sobre una base imponible.
 *
 * @param base  Subtotal sin IVA (p.ej. `monto_calculado` de la factura de agua).
 * @param tasa  Fracción [0,1]. Si es null/undefined usa IVA_TASA_GT (12%).
 *              Una tasa de 0 es válida (exento) y NO cae al default.
 *
 * Defensa: base/tasa negativas o no finitas se normalizan a 0; tasa > 1 se
 * recorta a 1 (un 120% sería un error de captura, no un IVA real).
 */
export function calcularIVA(base: number, tasa?: number | null): CalculoIVA {
  const baseNum = Number.isFinite(base) && base > 0 ? base : 0
  let t = tasa === null || tasa === undefined ? IVA_TASA_GT : Number(tasa)
  if (!Number.isFinite(t) || t < 0) t = 0
  if (t > 1) t = 1

  const baseR = redondear2(baseNum)
  const iva = redondear2(baseR * t)
  return { base: baseR, tasa: t, iva, total: redondear2(baseR + iva) }
}

// ────────────────────────────────────────────────────────────────────────────
// Mora / recargo (agua:C4) — según reglas_mora_config.
//   tipo: 'porcentaje' | 'monto_fijo'
//   valor: % (cuando porcentaje) o monto (cuando monto_fijo)
//   aplicar_sobre: 'saldo_vencido' | 'monto_cuota'
//   dias_vencimiento: días tras emisión para considerar la factura vencida
//   periodo_gracia: días extra de tolerancia ANTES de aplicar mora
// El recargo en porcentaje se interpreta como porcentaje ENTERO (valor=5 → 5%),
// coherente con la UI de condominios que captura "5" para 5% en reglas_mora_config.
// ────────────────────────────────────────────────────────────────────────────

export type TipoMora = 'porcentaje' | 'monto_fijo'
export type AplicarSobreMora = 'saldo_vencido' | 'monto_cuota'

/** Subconjunto de reglas_mora_config que necesita el cálculo puro de mora. */
export interface ReglaMora {
  tipo: TipoMora
  valor: number
  aplicar_sobre?: AplicarSobreMora
  dias_vencimiento?: number
  periodo_gracia?: number
}

export interface CalculoMora {
  /** True si corresponde aplicar recargo (ya venció + pasó el periodo de gracia). */
  aplica: boolean
  /** Días de atraso = días transcurridos - dias_vencimiento (0 si no ha vencido). */
  diasAtraso: number
  /** Monto del recargo, redondeado a 2 decimales (0 si no aplica). */
  monto: number
  /** Base sobre la que se calculó (saldo vencido o monto de cuota). */
  base: number
  /** Motivo legible cuando no aplica (para logs/UI). */
  motivo?: string
}

/**
 * Calcula el recargo por mora de una factura.
 *
 * @param regla        Configuración de mora del proyecto (reglas_mora_config).
 * @param diasTranscurridos  Días desde la emisión/fecha base de la factura.
 * @param saldoVencido Saldo pendiente (monto_calculado - monto_pagado). Base
 *                     cuando aplicar_sobre = 'saldo_vencido' (default).
 * @param montoCuota   Monto total de la cuota/factura. Base cuando
 *                     aplicar_sobre = 'monto_cuota'.
 *
 * Regla de aplicación: hay mora cuando
 *   diasTranscurridos > dias_vencimiento + periodo_gracia
 * El % se aplica sobre la base elegida; monto_fijo ignora la base.
 */
export function calcularMora(
  regla: ReglaMora,
  diasTranscurridos: number,
  saldoVencido: number,
  montoCuota?: number,
): CalculoMora {
  const dias = Number.isFinite(diasTranscurridos) ? Math.floor(diasTranscurridos) : 0
  const diasVenc = Number.isFinite(regla?.dias_vencimiento) ? Number(regla.dias_vencimiento) : 0
  const gracia = Number.isFinite(regla?.periodo_gracia) ? Number(regla.periodo_gracia) : 0

  const saldo = Number.isFinite(saldoVencido) && saldoVencido > 0 ? saldoVencido : 0
  const cuota = Number.isFinite(montoCuota as number) && (montoCuota as number) > 0 ? (montoCuota as number) : 0
  const base = regla?.aplicar_sobre === 'monto_cuota' ? cuota : saldo

  const diasAtraso = dias - diasVenc

  // No vencida todavía (o exactamente en el día de vencimiento).
  if (diasAtraso <= 0) {
    return { aplica: false, diasAtraso: 0, monto: 0, base, motivo: 'La factura no ha vencido.' }
  }
  // Vencida pero dentro del periodo de gracia.
  if (diasAtraso <= gracia) {
    return { aplica: false, diasAtraso, monto: 0, base, motivo: 'Dentro del periodo de gracia.' }
  }
  // Sin base sobre la que cobrar (saldo 0): nada que recargar en %.
  if (regla?.tipo === 'porcentaje' && base <= 0) {
    return { aplica: false, diasAtraso, monto: 0, base, motivo: 'Sin saldo vencido sobre el que aplicar mora.' }
  }

  const valor = Number.isFinite(regla?.valor) && regla.valor > 0 ? Number(regla.valor) : 0
  if (valor <= 0) {
    return { aplica: false, diasAtraso, monto: 0, base, motivo: 'La regla de mora tiene valor 0.' }
  }

  // monto_fijo: recargo plano. porcentaje: valor es % entero (5 → 5%).
  const monto =
    regla.tipo === 'monto_fijo' ? redondear2(valor) : redondear2(base * (valor / 100))

  return { aplica: monto > 0, diasAtraso, monto, base }
}

// ────────────────────────────────────────────────────────────────────────────
// Total de la Factura = subtotal + IVA + mora (agua:C4).
// Espeja registros.total_a_pagar. El IVA se calcula sobre el subtotal (base
// imponible); la mora es un recargo financiero que se suma DESPUÉS y no genera
// IVA (criterio conservador para servicios públicos / cuotas).
// ────────────────────────────────────────────────────────────────────────────

export interface DesgloseFactura {
  /** Base imponible (consumo/canon) sin IVA. */
  subtotal: number
  /** Tasa de IVA aplicada (fracción). */
  iva_tasa: number
  /** Monto de IVA sobre el subtotal. */
  iva_monto: number
  /** Subtotal + IVA. */
  monto_con_iva: number
  /** Recargo por mora (0 si no aplica). */
  mora_monto: number
  /** Total final a pagar = monto_con_iva + mora_monto. */
  total_a_pagar: number
}

/**
 * Compone el total de una factura a partir del subtotal, una tasa de IVA y un
 * recargo de mora ya calculado (con calcularMora). Función pura de agregación;
 * la usa la capa de datos para persistir iva_monto/monto_con_iva/mora_monto/
 * total_a_pagar de forma consistente con la migración.
 */
export function calcularTotalFactura(
  subtotal: number,
  ivaTasa?: number | null,
  moraMonto = 0,
): DesgloseFactura {
  const iva = calcularIVA(subtotal, ivaTasa)
  const mora = Number.isFinite(moraMonto) && moraMonto > 0 ? redondear2(moraMonto) : 0
  return {
    subtotal: iva.base,
    iva_tasa: iva.tasa,
    iva_monto: iva.iva,
    monto_con_iva: iva.total,
    mora_monto: mora,
    total_a_pagar: redondear2(iva.total + mora),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Máquina de estados de la Factura (agua:C4).
// Estados canónicos: pendiente → emitida → {pagada | vencida}; anulada terminal.
// vencida → pagada permitido (se puede pagar una factura vencida).
// vencida → anulada permitido. pagada y anulada son terminales.
// ────────────────────────────────────────────────────────────────────────────

export type EstadoFactura = 'pendiente' | 'emitida' | 'pagada' | 'vencida' | 'anulada'

/** Acciones de transición de la máquina de estados. */
export type AccionFactura = 'emitir' | 'pagar' | 'vencer' | 'anular'

/**
 * Mapa de transiciones permitidas: estado actual → acción → estado destino.
 * Es la fuente de verdad de la máquina; tanto la validación como la aplicación
 * la consultan. Mantener sincronizado con el CHECK de la migración.
 */
const TRANSICIONES_FACTURA: Record<EstadoFactura, Partial<Record<AccionFactura, EstadoFactura>>> = {
  pendiente: { emitir: 'emitida', anular: 'anulada' },
  emitida: { pagar: 'pagada', vencer: 'vencida', anular: 'anulada' },
  vencida: { pagar: 'pagada', anular: 'anulada' },
  pagada: {}, // terminal
  anulada: {}, // terminal
}

/**
 * Normaliza un estado (incluidos los legacy de `registros.estado`) al conjunto
 * canónico. 'pagado' → 'pagada', 'mora' → 'vencida'. null/desconocido →
 * 'pendiente' (estado inicial seguro). Espeja la tolerancia legacy del CHECK.
 */
export function normalizarEstadoFactura(estado?: string | null): EstadoFactura {
  switch (estado) {
    case 'pendiente':
    case 'emitida':
    case 'pagada':
    case 'vencida':
    case 'anulada':
      return estado
    case 'pagado':
      return 'pagada'
    case 'mora':
      return 'vencida'
    default:
      return 'pendiente'
  }
}

/** Estados terminales: ya no admiten ninguna transición. */
export function esEstadoTerminalFactura(estado?: string | null): boolean {
  const e = normalizarEstadoFactura(estado)
  return e === 'pagada' || e === 'anulada'
}

export interface ResultadoTransicion {
  ok: boolean
  /** Estado resultante si la transición es válida. */
  estado?: EstadoFactura
  /** Mensaje de error cuando la transición es inválida. */
  error?: string
}

/**
 * Valida si una acción es aplicable al estado actual de la factura SIN mutar.
 * Acepta estados legacy (los normaliza primero). Devuelve el estado destino.
 */
export function puedeTransicionarFactura(
  estadoActual: string | null | undefined,
  accion: AccionFactura,
): ResultadoTransicion {
  const actual = normalizarEstadoFactura(estadoActual)
  const destino = TRANSICIONES_FACTURA[actual]?.[accion]
  if (!destino) {
    return {
      ok: false,
      error: `Transición inválida: no se puede "${accion}" una factura en estado "${actual}".`,
    }
  }
  return { ok: true, estado: destino }
}

/** Campos que la transición setea sobre la fila de `registros` (parche parcial). */
export interface ParcheTransicionFactura {
  factura_estado: EstadoFactura
  emitida_at?: string
  pagada_at?: string
  vencida_at?: string
  anulada_at?: string
}

/**
 * Aplica una transición y devuelve el parche a persistir (estado + timestamp de
 * la transición). Fail-fast: lanza si la transición es inválida — el caller debe
 * validar antes con puedeTransicionarFactura si quiere manejar el error sin throw.
 *
 * @param ahora  ISO timestamp a estampar (default new Date().toISOString()).
 *               Parametrizado para tests deterministas.
 */
export function aplicarTransicionFactura(
  estadoActual: string | null | undefined,
  accion: AccionFactura,
  ahora: string = new Date().toISOString(),
): ParcheTransicionFactura {
  const res = puedeTransicionarFactura(estadoActual, accion)
  if (!res.ok || !res.estado) {
    throw new Error(res.error ?? 'Transición de factura inválida.')
  }
  const parche: ParcheTransicionFactura = { factura_estado: res.estado }
  switch (accion) {
    case 'emitir':
      parche.emitida_at = ahora
      break
    case 'pagar':
      parche.pagada_at = ahora
      break
    case 'vencer':
      parche.vencida_at = ahora
      break
    case 'anular':
      parche.anulada_at = ahora
      break
  }
  return parche
}
