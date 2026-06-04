// serv:S11 — Tipos del núcleo de Facturación Electrónica Fiscal FEL/CFDI.
//
// PROVIDER-AGNOSTIC: estos tipos modelan el comprobante fiscal y el "DTE
// canónico" (forma intermedia neutral) sin acoplarse a ningún PAC/Certificador
// concreto. El mapeo al formato de un proveedor real (Infile/GuateFactura para
// GT, Facturama/Finkok para MX) es follow-up y vive en el adapter
// (supabase/functions/_shared/fiscal/), no aquí.
//
// Estos tipos los comparten:
//   - la lógica pura del front (src/lib/businessFiscal.ts) y
//   - la capa de datos (src/domain/fiscal/*).
// El edge (Deno) NO importa src/ — su lógica pura ESPEJA estos contratos en
// supabase/functions/_shared/fiscal/ (igual que el cron de mora espejó
// calcularMora). Mantener ambos lados en sintonía es responsabilidad del PR.

// ── Régimen fiscal ───────────────────────────────────────────────────────────
// El motor de comprobante que aplica según el país del tenant.
//   fel_gt  → Factura Electrónica en Línea (Guatemala, SAT).
//   cfdi_mx → CFDI 4.0 (México, SAT MX).
export type RegimenFiscal = 'fel_gt' | 'cfdi_mx'

// Régimen tal como se guarda en companies.regimen_fiscal (incluye 'ninguno'
// para tenants que no emiten comprobante fiscal).
export type RegimenFiscalConfig = RegimenFiscal | 'ninguno'

// ── Config fiscal por nivel (empresa / locación) y config efectiva ───────────
// serv:S11 (habilitación "selecciona y conecta"). La config fiscal del EMISOR
// vive a nivel EMPRESA (companies) y puede SOBREESCRIBIRSE por LOCACIÓN
// (projects). resolverConfigFiscalEfectiva combina ambas:
//     efectiva.campo = locacion.campo ?? empresa.campo
// (cada columna nullable de la locación, si no es null, gana; si es null, hereda
//  de la empresa). Espejado en supabase/functions/_shared/fiscal/.

/** Config fiscal del EMISOR a nivel EMPRESA (fila companies, campos fiscales). */
export interface ConfigFiscalEmpresa {
  /** companies.regimen_fiscal: 'fel_gt' | 'cfdi_mx' | 'ninguno'. */
  regimenFiscal?: RegimenFiscalConfig | null
  /** companies.nombre (comercial; fallback de nombre fiscal). */
  nombre?: string | null
  /** companies.nombre_fiscal (razón social). */
  nombreFiscal?: string | null
  /** companies.nit (Guatemala). */
  nit?: string | null
  /** companies.tax_id (fallback del NIT en GT). */
  taxId?: string | null
  /** companies.rfc (México). */
  rfc?: string | null
  /** companies.proveedor_timbrado (PAC/Certificador). */
  proveedorTimbrado?: string | null
  /** companies.address_postal_code (fallback de lugar de expedición MX). */
  codigoPostal?: string | null
}

/** Override fiscal por LOCACIÓN (fila projects, columnas fiscales nullable). */
export interface ConfigFiscalLocacion {
  /** projects.regimen_fiscal (null = hereda empresa). */
  regimenFiscal?: RegimenFiscalConfig | null
  /** projects.nombre (comercial de la locación; fallback de nombre fiscal). */
  nombre?: string | null
  /** projects.nombre_fiscal. */
  nombreFiscal?: string | null
  /** projects.nit (Guatemala). */
  nit?: string | null
  /** projects.rfc (México). */
  rfc?: string | null
  /** projects.proveedor_timbrado. */
  proveedorTimbrado?: string | null
  /** projects.establecimiento (Guatemala/FEL). */
  establecimiento?: string | null
  /** projects.lugar_expedicion (México/CFDI). */
  lugarExpedicion?: string | null
  /** projects.serie_fiscal (México/CFDI). */
  serieFiscal?: string | null
}

/**
 * Config fiscal EFECTIVA de una locación: el override de la locación resuelto
 * contra los defaults de la empresa. Lo que el builder/adapter realmente usa.
 */
export interface ConfigFiscalEfectiva {
  /** Régimen efectivo (locación ?? empresa). 'ninguno' = no factura. */
  regimenFiscal: RegimenFiscalConfig
  /** Razón social efectiva (nombreFiscal ?? nombre, locación antes que empresa). */
  nombreFiscal: string | null
  /** NIT efectivo (Guatemala): locación ?? empresa.nit ?? empresa.tax_id. */
  nit: string | null
  /** RFC efectivo (México): locación ?? empresa. */
  rfc: string | null
  /** PAC/Certificador efectivo (locación ?? empresa ?? 'sandbox'). */
  proveedorTimbrado: string
  /** Establecimiento efectivo (Guatemala/FEL): solo de la locación. */
  establecimiento: string | null
  /** Lugar de expedición efectivo (México): locación.lugarExpedicion ?? empresa.codigoPostal. */
  lugarExpedicion: string | null
  /** Serie fiscal efectiva (México): solo de la locación. */
  serieFiscal: string | null
  /** true si el origen del régimen/PAC fue el override de la locación. */
  desdeLocacion: boolean
}

// ── Estatus (NO sensible) de credenciales del PAC ────────────────────────────
// Lo que la capa de datos del cliente puede leer de la bóveda fiscal_pac_secrets
// SIN el secreto: proveedor + estado de conexión + flags de presencia. NUNCA
// incluye `credenciales`. Espeja la RPC public.fiscal_pac_estatus (SECURITY
// DEFINER acotada a admin/owner del tenant, migración 20260604230000).
export type EstadoConexionPac = 'desconocido' | 'ok' | 'error'

export interface EstatusCredencialesPac {
  id: string
  company_id: string
  /** Locación de las credenciales; null = nivel empresa. */
  project_id: string | null
  /** PAC/Certificador de estas credenciales. */
  proveedor: string
  /** Resultado del último "probar conexión". */
  estado_conexion: EstadoConexionPac
  /** Mensaje legible del último ping (null si nunca/ok sin nota). */
  estado_mensaje: string | null
  /** Cuándo se probó por última vez (null = nunca). */
  estado_probado_en: string | null
  /** ¿Hay credenciales cargadas para sandbox? (flag, NO el secreto). */
  tiene_sandbox: boolean
  /** ¿Hay credenciales cargadas para prod? (flag, NO el secreto). */
  tiene_prod: boolean
  created_at: string
  updated_at: string
}

// ── Tipo de comprobante ──────────────────────────────────────────────────────
export type TipoDocumentoFiscal =
  | 'factura'
  | 'nota_credito'
  | 'nota_debito'
  | 'recibo'
  | 'nota_abono'

// ── Estado del ciclo de vida fiscal ──────────────────────────────────────────
// Máquina:
//   borrador ─emitir→ por_timbrar ─timbrar→ timbrado ─cancelar→ cancelado
//                          ▲   └────rechazar→ rechazado ─reintentar┘
//   (rechazado puede reintentar: vuelve a por_timbrar)
// Terminal: cancelado.
export type EstadoFiscal =
  | 'borrador'
  | 'por_timbrar'
  | 'timbrado'
  | 'rechazado'
  | 'cancelado'

// Acciones que disparan transiciones de estado fiscal.
export type AccionFiscal =
  | 'emitir' // borrador → por_timbrar (queda lista para mandar al PAC)
  | 'timbrar' // por_timbrar → timbrado (el PAC certificó OK)
  | 'rechazar' // por_timbrar → rechazado (el PAC rechazó)
  | 'reintentar' // rechazado → por_timbrar (corregir y reenviar)
  | 'cancelar' // timbrado → cancelado (cancelación fiscal)

// ── Fila de documentos_fiscales (lectura) ────────────────────────────────────
// Espeja la tabla `documentos_fiscales` (migración 20260604220000).
export interface DocumentoFiscal {
  id: string
  company_id: string
  registro_id: string | null
  regimen: RegimenFiscal
  tipo: TipoDocumentoFiscal
  estado: EstadoFiscal
  proveedor: string | null
  request_payload: DteCanonico | Record<string, unknown> | null
  response_payload: Record<string, unknown> | null
  uuid_fiscal: string | null
  serie: string | null
  numero: string | null
  numero_autorizacion: string | null
  fecha_certificacion: string | null
  error: string | null
  created_at: string
  updated_at: string
}

// ── DTE canónico (forma intermedia provider-agnostic) ────────────────────────
// Representación neutral de un comprobante, derivada de la Factura (registro) +
// la config fiscal del emisor (companies) y del receptor (clientes). El adapter
// la traduce al formato del PAC concreto. NO incluye sellos/UUID: esos son la
// RESPUESTA del certificador.

/** Datos fiscales del emisor (desde companies). */
export interface EmisorFiscal {
  /** NIT (Guatemala) — companies.nit / tax_id. */
  nit?: string | null
  /** RFC (México) — companies.rfc. */
  rfc?: string | null
  /** Razón social fiscal (companies.nombre_fiscal ?? companies.nombre). */
  nombre: string
  /** Dirección fiscal (companies.address_line1, city, state, postal_code). */
  direccion?: DireccionFiscal | null
}

/** Datos fiscales del receptor (desde clientes). */
export interface ReceptorFiscal {
  /** NIT (Guatemala). 'CF' = Consumidor Final. */
  nit?: string | null
  /** RFC (México). */
  rfc?: string | null
  /** Razón social fiscal (clientes.nombre_fiscal ?? clientes.nombre). */
  nombre: string
  /** Uso del CFDI (México, catálogo c_UsoCFDI). */
  usoCfdi?: string | null
}

/** Dirección fiscal estructurada. */
export interface DireccionFiscal {
  linea1?: string | null
  ciudad?: string | null
  departamento?: string | null
  codigoPostal?: string | null
  pais?: string | null
}

/** Una línea de detalle del comprobante. */
export interface LineaDte {
  descripcion: string
  cantidad: number
  /** Precio unitario sin IVA. */
  precioUnitario: number
  /** Subtotal de la línea (cantidad * precioUnitario), sin IVA. */
  subtotal: number
  /** Monto de IVA de la línea. */
  ivaMonto: number
  /** Total de la línea (subtotal + ivaMonto). */
  total: number
}

/** El DTE canónico completo: lo que se envía a timbrar. */
export interface DteCanonico {
  regimen: RegimenFiscal
  tipo: TipoDocumentoFiscal
  /** Moneda ISO 4217 (ej. 'GTQ', 'MXN'). */
  moneda: string
  /** Fecha de emisión (ISO 8601). */
  fechaEmision: string
  emisor: EmisorFiscal
  receptor: ReceptorFiscal
  lineas: LineaDte[]
  /** Suma de subtotales (sin IVA). */
  subtotal: number
  /** Tasa de IVA aplicada como fracción [0,1] (GT=0.12, MX=0.16). */
  ivaTasa: number
  /** Monto total de IVA. */
  ivaMonto: number
  /** Gran total (subtotal + ivaMonto). */
  total: number
  /** Referencia a la Factura origen (registros.id), para trazabilidad. */
  registroId?: string | null
}

// ── Resultado del timbrado (respuesta normalizada del adapter) ───────────────
// Lo que devuelve cualquier FiscalProvider tras timbrar, ya normalizado a una
// forma neutral. El edge lo persiste en documentos_fiscales.
export interface ResultadoTimbrado {
  ok: boolean
  uuidFiscal?: string | null
  serie?: string | null
  numero?: string | null
  numeroAutorizacion?: string | null
  fechaCertificacion?: string | null
  /** Payload crudo del proveedor (para auditoría). */
  raw?: Record<string, unknown> | null
  /** Mensaje de error si ok=false. */
  error?: string | null
}
