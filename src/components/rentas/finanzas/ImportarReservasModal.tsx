import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ConceptoRenta, PropiedadRenta, ReservaUnificada } from '../../../types'
import { MONEDA_DEFECTO, tieneDesglose, totalesDesglose } from '../../../domain/rentas/finanzas'
import {
  COL, columnaDeConcepto, conceptosDePlantilla, leerFilaReserva, normalizar, type FilaReservaImportada,
} from '../../../domain/rentas/importacion'
import { rentasKeys } from '../../../domain/rentas/keys'
import { mensajeErrorRentas } from '../../../domain/rentas/logica'
import { actualizarReserva, guardarLiquidacion, insertarReserva } from '../../../domain/rentas/mutations'
import { ImportModal, type ImportColumn } from '../../shared/ImportModal'
import { tenue } from '../ui'

interface Props {
  /** Propiedades de corto plazo a las que se puede cargar. */
  propiedades: PropiedadRenta[]
  /** Si viene, todas las filas van a esta propiedad y la hoja no lleva la columna «Propiedad». */
  propiedadFija?: PropiedadRenta
  /** Reservas existentes: una fila con el mismo código en la misma propiedad la ACTUALIZA. */
  reservas: ReservaUnificada[]
  /** id de proyecto → nombre, para la columna «Proyecto». */
  nombreProyecto?: ReadonlyMap<string, string>
  conceptos: ConceptoRenta[]
  hoy: string
  onClose: () => void
}

type Fila = FilaReservaImportada & { destino: PropiedadRenta }

const SIN_PROYECTOS: ReadonlyMap<string, string> = new Map()
/** Lo que se escribe en «Proyecto» para una propiedad que no pertenece a ningún condominio. */
const INDEPENDIENTE = 'independiente'

export type PropiedadResuelta =
  | PropiedadRenta
  | 'ninguna'
  | 'proyecto_desconocido'
  | 'no_en_proyecto'
  | { varias: PropiedadRenta[] }

/**
 * Busca la propiedad por nombre o por código, sin distinguir acentos ni
 * mayúsculas. Si se da el proyecto, sólo cuentan las de ese proyecto
 * («Independiente» = las que no pertenecen a ninguno): así dos condominios
 * pueden tener un «Apto 1A» cada uno.
 */
export function resolverPropiedad(
  texto: string, propiedades: PropiedadRenta[], proyecto = '', nombreProyecto: ReadonlyMap<string, string> = SIN_PROYECTOS,
): PropiedadResuelta {
  const t = normalizar(texto)
  if (!t) return 'ninguna'
  const porNombre = propiedades.filter(p => normalizar(p.nombre) === t || (p.codigo !== null && normalizar(p.codigo) === t))
  if (porNombre.length === 0) return 'ninguna'
  const py = normalizar(proyecto)
  if (!py) return porNombre.length === 1 ? porNombre[0] : { varias: porNombre }
  const esDelProyecto = (p: PropiedadRenta) => p.project_id === null
    ? py === INDEPENDIENTE
    : normalizar(nombreProyecto.get(p.project_id) ?? '') === py
  if (py !== INDEPENDIENTE && !propiedades.some(p => p.project_id !== null && esDelProyecto(p))) return 'proyecto_desconocido'
  const hallazgos = porNombre.filter(esDelProyecto)
  return hallazgos.length === 1 ? hallazgos[0] : hallazgos.length === 0 ? 'no_en_proyecto' : { varias: hallazgos }
}

const esPropiedad = (r: PropiedadResuelta): r is PropiedadRenta => typeof r === 'object' && 'id' in r

/** El porqué de una fila sin propiedad, o null si se resolvió. */
export function errorDePropiedad(
  r: PropiedadResuelta, texto: string, proyecto: string, nombreProyecto: ReadonlyMap<string, string> = SIN_PROYECTOS,
): string | null {
  if (esPropiedad(r)) return null
  const t = texto.trim()
  const py = proyecto.trim()
  if (r === 'ninguna') return t ? `Propiedad «${t}»: no hay una de corto plazo con ese nombre o código` : 'Falta la propiedad'
  if (r === 'proyecto_desconocido') return `Proyecto «${py}»: no hay propiedades de corto plazo en un proyecto con ese nombre`
  if (r === 'no_en_proyecto') return `Propiedad «${t}»: no está en «${py}»`
  const donde = [...new Set(r.varias.map(p => p.project_id ? nombreProyecto.get(p.project_id) ?? 'Condominio' : 'Independiente'))]
  return donde.length > 1
    ? `Propiedad «${t}»: está en ${donde.join(', ')}; indica cuál en la columna Proyecto o usa su código`
    : `Propiedad «${t}»: hay más de una con ese nombre${py ? ` en «${py}»` : ''}; usa su código`
}

/**
 * Carga masiva de reservas desde una hoja (Excel o CSV): una fila por reserva,
 * con su moneda y una columna por cada concepto activo del desglose. Para una
 * sola propiedad o, con la columna «Propiedad», para varias a la vez.
 */
export function ImportarReservasModal({ propiedades, propiedadFija, reservas, nombreProyecto = SIN_PROYECTOS, conceptos, hoy, onClose }: Props) {
  const qc = useQueryClient()
  const columnas = useMemo<ImportColumn[]>(() => [
    ...(propiedadFija ? [] : [
      { key: COL.propiedad, width: 24, exampleValues: [propiedades[0]?.nombre ?? 'Apto 1A'] },
      { key: COL.proyecto, width: 22, exampleValues: [propiedades[0]?.project_id ? nombreProyecto.get(propiedades[0].project_id) ?? '' : 'Independiente'] },
    ]),
    { key: COL.codigo, width: 18, exampleValues: ['HM34NRSTRH'] },
    { key: COL.huesped, width: 24, exampleValues: ['Ana Pérez'] },
    { key: COL.pais, width: 16, exampleValues: ['Guatemala'] },
    { key: COL.entrada, width: 12, exampleValues: ['2026-02-02'] },
    { key: COL.salida, width: 12, exampleValues: ['2026-02-03'] },
    { key: COL.huespedes, width: 10, exampleValues: [1] },
    { key: COL.plataforma, width: 12, exampleValues: ['airbnb'] },
    { key: COL.politica, width: 22, exampleValues: ['No reembolsable'] },
    { key: COL.mascotas, width: 10, exampleValues: [0] },
    { key: COL.moneda, width: 10, exampleValues: [MONEDA_DEFECTO] },
    ...conceptosDePlantilla(conceptos).map(c => ({ key: columnaDeConcepto(c), width: 22, exampleValues: [0] })),
  ], [conceptos, propiedadFija, propiedades, nombreProyecto])

  /** `<propiedad>|<CÓDIGO>` → reserva existente. */
  const porCodigo = useMemo(() => {
    const m = new Map<string, ReservaUnificada>()
    for (const r of reservas) if (r.codigo_confirmacion) m.set(`${r.propiedad_id}|${r.codigo_confirmacion.trim().toUpperCase()}`, r)
    return m
  }, [reservas])

  const validar = (fila: Record<string, unknown>) => {
    const leida = leerFilaReserva(fila, conceptos, hoy)
    if (propiedadFija) return leida.ok ? { ok: true as const, data: { ...leida.data, destino: propiedadFija } } : leida
    const cruda = (col: string) => String(Object.entries(fila).find(([k]) => normalizar(k) === normalizar(col))?.[1] ?? '')
    const texto = leida.ok ? leida.data.propiedad : cruda(COL.propiedad)
    const proyecto = leida.ok ? leida.data.proyecto : cruda(COL.proyecto)
    const destino = resolverPropiedad(texto, propiedades, proyecto, nombreProyecto)
    const errorPropiedad = errorDePropiedad(destino, texto, proyecto, nombreProyecto)
    if (!leida.ok) return { ok: false as const, errors: errorPropiedad ? [errorPropiedad, ...leida.errors] : leida.errors }
    if (errorPropiedad || !esPropiedad(destino)) return { ok: false as const, errors: [errorPropiedad ?? 'Falta la propiedad'] }
    return { ok: true as const, data: { ...leida.data, destino } }
  }

  const importar = async (lote: Fila[]) => {
    let ok = 0
    try {
      for (const { datos, importes, moneda, destino } of lote) {
        const conDesglose = tieneDesglose(importes)
        const completos = { ...datos, monto_total: conDesglose ? totalesDesglose(conceptos, importes).anfitrion : null }
        const conFicha = conDesglose || moneda !== MONEDA_DEFECTO
        const existente = datos.codigo_confirmacion ? porCodigo.get(`${destino.id}|${datos.codigo_confirmacion.toUpperCase()}`) : undefined
        if (existente) {
          // No se pisa el total ya capturado si la fila viene sin desglose.
          const { monto_total, monto_noche: _n, estado: _e, ...resto } = completos
          await actualizarReserva(existente, conDesglose ? { ...resto, monto_total } : resto)
          if (conDesglose) await guardarLiquidacion(destino, existente, importes, moneda)
        } else {
          const ref = await insertarReserva(destino, completos)
          if (conFicha) await guardarLiquidacion(destino, ref, importes, moneda)
        }
        ok += 1
      }
      return { ok }
    } catch (e) {
      return { ok, error: mensajeErrorRentas(e, 'No se pudo guardar la fila.') }
    } finally {
      void qc.invalidateQueries({ queryKey: rentasKeys.all })
    }
  }

  const sufijo = propiedadFija ? propiedadFija.nombre.replace(/[^\p{L}\p{N}]+/gu, '_').toLowerCase() : 'cartera'
  return (
    <ImportModal<Fila>
      entityLabel="reserva" entityLabelPlural="reservas"
      columns={columnas} sheetName="Reservas" templateFilename={`plantilla_reservas_${sufijo}`}
      validateRow={validar} onInsertBatch={importar} batchSize={25}
      onClose={onClose} onImportado={() => undefined}
      optionsPanel={
        <p style={{ ...tenue, margin: 0, fontSize: '13px' }}>
          {propiedadFija
            ? <>Se cargan en <strong>{propiedadFija.nombre}</strong>.</>
            : <>La columna <strong>Propiedad</strong> lleva el nombre o el código de cada propiedad de corto plazo; así se cargan varias a la vez.
              Si dos condominios tienen una propiedad con el mismo nombre, la columna <strong>Proyecto</strong> (opcional) dice de cuál es;
              escribe «Independiente» para las que no pertenecen a ninguno.</>}
          {' '}Una fila cuyo código de reserva ya existe en su propiedad actualiza esa reserva y su desglose; las demás se crean.
          La moneda es {MONEDA_DEFECTO} si la columna queda vacía. La plantilla trae una columna por cada concepto configurado.
        </p>
      }
    />
  )
}
