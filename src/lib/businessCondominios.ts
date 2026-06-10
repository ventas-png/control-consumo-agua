// ════════════════════════════════════════════════════════════════════════════
// T4 · Facturación de dominio — Condominios (cond:C4 / cond:C6)
//
// Funciones PURAS (sin I/O) del agregado Cuota de condominio. Espejo de la
// migración 20260604180000_cuota_condominio_state_machine_mora.sql.
//
// PRINCIPIO RECTOR — REUSAR, NO DUPLICAR: la máquina de estados y el cálculo de
// IVA/mora/total ya existen y están testeados en src/lib/business.ts (agua:C4,
// #383). Este módulo NO los reimplementa: los reutiliza y sólo añade lo
// específico de la cuota de condominio (normalización del legacy 'moroso',
// detección de vencimiento por fecha, y el cálculo de mora/total ATADO a la
// cuota — la lógica que hoy vive dispersa en el cliente: RecargosTab y CuotasTab).
//
// LÓGICA DE CLIENTE EXTRAÍDA AQUÍ (cond:C4):
//   - RecargosTab.calcularMonto() / aplicarMasivo(): el recargo de mora se
//     calculaba como `base * pct / 100` a mano, sin reglas_mora_config ni
//     periodo de gracia/vencimiento. Aquí → calcularMoraCuota(), que delega en
//     calcularMora (business.ts) con la regla completa.
//   - CuotasTab.aplicarMoraMasiva() / render de "vencida": la condición
//     `estado === 'pendiente' && fecha_vencimiento < hoy` se decidía en el
//     componente. Aquí → cuotaVencida() (pura, testeable, sin `new Date()`
//     oculto).
//
// La capa de datos (src/domain/condominios) y la UI (round 2) orquestan estas
// funciones; el cron de mora (cond:C6, SQL) replica calcularMora en PL/pgSQL con
// paridad documentada.
// ════════════════════════════════════════════════════════════════════════════

import {
  calcularMora,
  calcularTotalFactura,
  redondear2,
  puedeTransicionarFactura,
} from './business'
import type {
  CalculoMora,
  DesgloseFactura,
  EstadoFactura,
  AccionFactura,
  ResultadoTransicion,
  ReglaMora,
} from './business'

// ────────────────────────────────────────────────────────────────────────────
// Re-export de los tipos/funciones compartidas de la máquina de estados para
// que los consumidores de condominios importen desde un único módulo de
// dominio si lo prefieren (sin tener que conocer business.ts).
// ────────────────────────────────────────────────────────────────────────────
export {
  calcularMora,
  calcularTotalFactura,
  calcularIVA,
  redondear2,
  puedeTransicionarFactura,
  aplicarTransicionFactura,
  esEstadoTerminalFactura,
} from './business'
export type {
  EstadoFactura,
  AccionFactura,
  ResultadoTransicion,
  ParcheTransicionFactura,
  ReglaMora,
  CalculoMora,
  DesgloseFactura,
  TipoMora,
  AplicarSobreMora,
} from './business'

// El estado canónico de una cuota es el MISMO conjunto que la Factura de agua
// (la máquina de estados es compartida). Alias semántico para la UI/dominio de
// condominios.
export type EstadoCuotaCanonico = EstadoFactura
export type AccionCuota = AccionFactura

// ────────────────────────────────────────────────────────────────────────────
// Normalización de estado de cuota (cond:C4).
// Mapea el estado legacy de `cuotas_condominio.estado` (3 valores:
// 'pendiente' | 'pagado' | 'moroso') y el canónico nuevo `cuota_estado` al
// conjunto canónico de la máquina. Difiere de normalizarEstadoFactura (agua) en
// el legacy: agua usa 'mora', condominios usa 'moroso'. Espeja la tolerancia
// legacy del CHECK de la migración 180000.
//   'pagado' → 'pagada'   'moroso' → 'vencida'
//   null/desconocido → 'pendiente' (estado inicial seguro).
// ────────────────────────────────────────────────────────────────────────────
export function normalizarEstadoCuota(estado?: string | null): EstadoCuotaCanonico {
  switch (estado) {
    case 'pendiente':
    case 'emitida':
    case 'pagada':
    case 'vencida':
    case 'anulada':
      return estado
    case 'pagado':
      return 'pagada'
    case 'moroso':
      return 'vencida'
    default:
      return 'pendiente'
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Transición de cuota (cond:C4). Reusa la máquina canónica de business.ts pero
// normalizando primero el legacy de condominios ('moroso'). Devuelve el parche
// a persistir sobre la fila de `cuotas_condominio` (cuota_estado + timestamp).
//
// Por qué un wrapper y no usar aplicarTransicionFactura directo: el normalizador
// de agua no conoce 'moroso'. Aquí normalizamos con normalizarEstadoCuota y
// luego aplicamos la MISMA tabla de transiciones (vía puedeTransicionarFactura),
// sin reimplementarla.
// ────────────────────────────────────────────────────────────────────────────

/** Campos que la transición setea sobre la fila de `cuotas_condominio`. */
export interface ParcheTransicionCuota {
  cuota_estado: EstadoCuotaCanonico
  emitida_at?: string
  pagada_at?: string
  vencida_at?: string
  anulada_at?: string
}

/**
 * Valida si una acción es aplicable al estado actual de la cuota SIN mutar.
 * Acepta estados legacy de condominios (los normaliza primero). Devuelve el
 * estado destino. Reusa puedeTransicionarFactura tras normalizar.
 */
export function puedeTransicionarCuota(
  estadoActual: string | null | undefined,
  accion: AccionCuota,
): ResultadoTransicion {
  // Normalizamos el legacy de condominios ('moroso'/'pagado') al canónico y
  // delegamos en la máquina compartida (single source of truth).
  return puedeTransicionarFactura(normalizarEstadoCuota(estadoActual), accion)
}

/**
 * Aplica una transición a una cuota y devuelve el parche a persistir
 * (cuota_estado + timestamp de la transición). Fail-fast: lanza si la
 * transición es inválida.
 *
 * @param ahora ISO timestamp a estampar (default new Date().toISOString()).
 *              Parametrizado para tests deterministas.
 */
export function aplicarTransicionCuota(
  estadoActual: string | null | undefined,
  accion: AccionCuota,
  ahora: string = new Date().toISOString(),
): ParcheTransicionCuota {
  const res = puedeTransicionarCuota(estadoActual, accion)
  if (!res.ok || !res.estado) {
    throw new Error(res.error ?? 'Transición de cuota inválida.')
  }
  const parche: ParcheTransicionCuota = { cuota_estado: res.estado }
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

// ────────────────────────────────────────────────────────────────────────────
// Vencimiento de una cuota (cond:C4) — extraído de CuotasTab.aplicarMoraMasiva /
// render de "vencida". Pura: la fecha "hoy" se inyecta (default = hoy en local,
// YYYY-MM-DD) para que sea testeable sin mockear Date.
//
// Una cuota está vencida si tiene fecha de vencimiento, esa fecha YA pasó, y la
// cuota NO está pagada ni anulada (no tiene sentido "vencer" algo ya saldado o
// cancelado). Trabaja sobre el estado normalizado, así que tolera tanto el
// legacy ('pagado'/'moroso') como el canónico.
// ────────────────────────────────────────────────────────────────────────────

/** Fecha local en formato YYYY-MM-DD (mismo formato que usa la UI hoy). */
function hoyISO(): string {
  // Componentes LOCALES, no UTC: toISOString() da la fecha en UTC y en husos
  // negativos (GT/MX, UTC-6) salta al día siguiente desde las 18:00, corriendo
  // un día la mora y las fechas de pago. Construir desde get*() locales lo evita.
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function cuotaVencida(
  fechaVencimiento: string | null | undefined,
  estado: string | null | undefined,
  hoy: string = hoyISO(),
): boolean {
  if (!fechaVencimiento) return false
  const e = normalizarEstadoCuota(estado)
  if (e === 'pagada' || e === 'anulada') return false
  // Comparación lexicográfica de fechas ISO (YYYY-MM-DD), igual que el cliente.
  return fechaVencimiento < hoy
}

// ────────────────────────────────────────────────────────────────────────────
// Mora de una cuota (cond:C4 / cond:C6) — delega en calcularMora (business.ts).
//
// Una cuota de condominio no lleva pago parcial (el pago es all-or-nothing vía
// estado), así que su saldo vencido == monto de cuota == `monto`. Por eso aquí
// pasamos `monto` tanto como saldoVencido como montoCuota: sea cual sea
// regla.aplicar_sobre, la base es el monto. Esto es PARIDAD EXACTA con lo que
// hace el cron SQL (aplicar_mora_cuotas_vencidas) — la misma fórmula.
//
// diasTranscurridos lo provee el caller (días desde la emisión / fecha base de
// la cuota). La capa de datos lo deriva de emitida_at; el cron, de
// COALESCE(emitida_at, created_at).
// ────────────────────────────────────────────────────────────────────────────
export function calcularMoraCuota(
  regla: ReglaMora,
  diasTranscurridos: number,
  montoCuota: number,
): CalculoMora {
  const monto = Number.isFinite(montoCuota) && montoCuota > 0 ? montoCuota : 0
  // saldoVencido === montoCuota === monto (cuota impaga, sin pago parcial).
  return calcularMora(regla, diasTranscurridos, monto, monto)
}

// ────────────────────────────────────────────────────────────────────────────
// Total a pagar de una cuota (cond:C4) — monto + mora, SIN IVA.
//
// La cuota de mantenimiento de condominio NO es factura comercial gravada (ver
// cabecera de la migración 180000), así que el IVA es 0. Reusamos
// calcularTotalFactura (business.ts) con tasa 0 para no duplicar la
// composición/redondeo; el resultado tiene iva_monto=0 y total = subtotal+mora.
// ────────────────────────────────────────────────────────────────────────────

export interface DesgloseCuota {
  /** Monto base de la cuota (sin recargo). */
  subtotal: number
  /** Recargo por mora (0 si no aplica). */
  mora_monto: number
  /** Total a pagar = subtotal + mora (sin IVA). */
  total_a_pagar: number
}

export function calcularTotalCuota(montoCuota: number, moraMonto = 0): DesgloseCuota {
  // tasa IVA = 0 → calcularTotalFactura no añade IVA; total = base + mora.
  const d: DesgloseFactura = calcularTotalFactura(montoCuota, 0, moraMonto)
  return {
    subtotal: d.subtotal,
    mora_monto: d.mora_monto,
    total_a_pagar: redondear2(d.subtotal + d.mora_monto),
  }
}
