// Carga masiva de EQUIPOS (equipos_comunes) desde Excel/CSV: el gemelo de
// ImportSuministrosModal para el catálogo que ahora vive junto a Suministros y
// del que salen las herramientas y el equipo de las actividades.
import type { CategoriaEquipo, EstadoEquipo } from '../../types'
import { createEquiposComunes } from '../../domain/condominios/mutations'
import { sanitizeInput } from '../../lib/validation'
import { CATEGORIAS_EQUIPO, ESTADOS_EQUIPO } from '../../lib/equiposComunes'
import { ImportModal, type ImportColumn, type RowValidationResult } from '../shared'

const CATEGORIAS_VALIDAS = CATEGORIAS_EQUIPO.map(c => c.value)
const ESTADOS_VALIDOS = ESTADOS_EQUIPO.map(e => e.value)

export interface EquipoRow {
  nombre: string
  categoria: CategoriaEquipo
  cantidad: number
  marca?: string
  modelo?: string
  serial?: string
  ubicacion?: string
  fecha_compra?: string
  valor_compra?: number
  vida_util_anios?: number
  estado: EstadoEquipo
  ultimo_mantenimiento?: string
  proximo_mantenimiento?: string
  notas?: string
}

const COLUMNS: ImportColumn[] = [
  { key: 'nombre',                width: 26, exampleValues: ['Hidrolavadora', 'Bomba de agua principal', 'Extintor PQS 10 lb'] },
  { key: 'categoria',             width: 16, exampleValues: ['herramienta', 'bomba', 'extintor'] },
  { key: 'cantidad',              width: 10, exampleValues: [2, 1, 6] },
  { key: 'marca',                 width: 14, exampleValues: ['Kärcher', 'Pedrollo', ''] },
  { key: 'modelo',                width: 14, exampleValues: ['K5', 'CP 200', ''] },
  { key: 'serial',                width: 16, exampleValues: ['', 'SN-001', ''] },
  { key: 'ubicacion',             width: 22, exampleValues: ['Bodega de limpieza', 'Cuarto de máquinas', 'Pasillos'] },
  { key: 'fecha_compra',          width: 14, exampleValues: ['2025-03-10', '2024-01-15', ''] },
  { key: 'valor_compra',          width: 14, exampleValues: [3500, 12000, ''] },
  { key: 'vida_util_anios',       width: 14, exampleValues: [5, 10, ''] },
  { key: 'estado',                width: 16, exampleValues: ['operativo', 'operativo', 'operativo'] },
  { key: 'ultimo_mantenimiento',  width: 18, exampleValues: ['', '2026-06-01', ''] },
  { key: 'proximo_mantenimiento', width: 18, exampleValues: ['', '2026-12-01', '2027-03-01'] },
  { key: 'notas',                 width: 28, exampleValues: ['', 'Revisar presostato', ''] },
]

/** Una celda de fecha: texto `YYYY-MM-DD` o la fecha que trae el lector de Excel. */
function fechaDe(valor: unknown, campo: string, errors: string[]): string | undefined {
  if (valor == null || valor === '') return undefined
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor.toISOString().slice(0, 10)
  const texto = String(valor).trim()
  if (!texto) return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto) || Number.isNaN(new Date(`${texto}T00:00:00Z`).getTime())) {
    errors.push(`${campo} debe ser una fecha AAAA-MM-DD`)
    return undefined
  }
  return texto
}

export function validateEquipoRow(row: Record<string, unknown>): RowValidationResult<EquipoRow> {
  const errors: string[] = []

  const nombre = sanitizeInput(String(row['nombre'] ?? '').trim())
  if (!nombre) errors.push('nombre es obligatorio')

  // categoria es opcional → default 'otro'.
  const rawCategoria = String(row['categoria'] ?? '').trim().toLowerCase()
  let categoria: CategoriaEquipo = 'otro'
  if (rawCategoria) {
    if (!CATEGORIAS_VALIDAS.includes(rawCategoria as CategoriaEquipo))
      errors.push(`categoria inválida: "${row['categoria']}" — use: ${CATEGORIAS_VALIDAS.join(', ')}`)
    else categoria = rawCategoria as CategoriaEquipo
  }

  // cantidad → default 1; entero ≥ 0.
  let cantidad = 1
  const rawCantidad = String(row['cantidad'] ?? '').trim()
  if (rawCantidad) {
    cantidad = Number(rawCantidad)
    if (!Number.isInteger(cantidad) || cantidad < 0) errors.push('cantidad debe ser un entero ≥ 0')
  }

  // estado es opcional → default 'operativo'.
  const rawEstado = String(row['estado'] ?? '').trim().toLowerCase()
  let estado: EstadoEquipo = 'operativo'
  if (rawEstado) {
    if (!ESTADOS_VALIDOS.includes(rawEstado as EstadoEquipo))
      errors.push(`estado inválido: "${row['estado']}" — use: ${ESTADOS_VALIDOS.join(', ')}`)
    else estado = rawEstado as EstadoEquipo
  }

  let valor_compra: number | undefined
  const rawValor = String(row['valor_compra'] ?? '').trim()
  if (rawValor) {
    valor_compra = Number(rawValor)
    if (!Number.isFinite(valor_compra) || valor_compra < 0) errors.push('valor_compra debe ser un número ≥ 0')
  }

  let vida_util_anios: number | undefined
  const rawVida = String(row['vida_util_anios'] ?? '').trim()
  if (rawVida) {
    vida_util_anios = Number(rawVida)
    if (!Number.isInteger(vida_util_anios) || vida_util_anios <= 0) errors.push('vida_util_anios debe ser un entero > 0')
  }

  const fecha_compra = fechaDe(row['fecha_compra'], 'fecha_compra', errors)
  const ultimo_mantenimiento = fechaDe(row['ultimo_mantenimiento'], 'ultimo_mantenimiento', errors)
  const proximo_mantenimiento = fechaDe(row['proximo_mantenimiento'], 'proximo_mantenimiento', errors)

  if (errors.length > 0) return { ok: false, errors }

  const texto = (k: string) => sanitizeInput(String(row[k] ?? '').trim()) || undefined
  return {
    ok: true,
    data: {
      nombre,
      categoria,
      cantidad,
      marca: texto('marca'),
      modelo: texto('modelo'),
      serial: texto('serial'),
      ubicacion: texto('ubicacion'),
      fecha_compra,
      valor_compra,
      vida_util_anios,
      estado,
      ultimo_mantenimiento,
      proximo_mantenimiento,
      notas: texto('notas'),
    },
  }
}

interface Props {
  proyectoId: string
  companyId: string
  onClose: () => void
  onImportado: () => void
}

export function ImportEquiposModal({ proyectoId, companyId, onClose, onImportado }: Props) {
  return (
    <ImportModal<EquipoRow>
      entityLabel="equipo"
      entityLabelPlural="equipos"
      sheetName="Equipos"
      templateFilename="plantilla_equipos"
      columns={COLUMNS}
      validateRow={validateEquipoRow}
      onInsertBatch={async (batch) => {
        const payload = batch.map(e => ({
          ...e,
          project_id: proyectoId,
          company_id: companyId,
        }))
        const { error } = await createEquiposComunes(payload)
        return error
          ? { ok: 0, error }
          : { ok: batch.length }
      }}
      onClose={onClose}
      onImportado={() => onImportado()}
    />
  )
}
