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
  conceptos: ConceptoRenta[]
  hoy: string
  onClose: () => void
}

type Fila = FilaReservaImportada & { destino: PropiedadRenta }

/** Busca la propiedad por nombre o por código, sin distinguir acentos ni mayúsculas. */
export function resolverPropiedad(texto: string, propiedades: PropiedadRenta[]): PropiedadRenta | 'ninguna' | 'varias' {
  const t = normalizar(texto)
  if (!t) return 'ninguna'
  const hallazgos = propiedades.filter(p => normalizar(p.nombre) === t || (p.codigo !== null && normalizar(p.codigo) === t))
  return hallazgos.length === 1 ? hallazgos[0] : hallazgos.length === 0 ? 'ninguna' : 'varias'
}

/**
 * Carga masiva de reservas desde una hoja (Excel o CSV): una fila por reserva,
 * con su moneda y una columna por cada concepto activo del desglose. Para una
 * sola propiedad o, con la columna «Propiedad», para varias a la vez.
 */
export function ImportarReservasModal({ propiedades, propiedadFija, reservas, conceptos, hoy, onClose }: Props) {
  const qc = useQueryClient()
  const columnas = useMemo<ImportColumn[]>(() => [
    ...(propiedadFija ? [] : [{ key: COL.propiedad, width: 24, exampleValues: [propiedades[0]?.nombre ?? 'Apto 1A'] }]),
    { key: COL.codigo, width: 18, exampleValues: ['HM34NRSTRH'] },
    { key: COL.huesped, width: 24, exampleValues: ['Ana Pérez'] },
    { key: COL.entrada, width: 12, exampleValues: ['2026-02-02'] },
    { key: COL.salida, width: 12, exampleValues: ['2026-02-03'] },
    { key: COL.huespedes, width: 10, exampleValues: [1] },
    { key: COL.plataforma, width: 12, exampleValues: ['airbnb'] },
    { key: COL.politica, width: 22, exampleValues: ['No reembolsable'] },
    { key: COL.mascotas, width: 10, exampleValues: [0] },
    { key: COL.moneda, width: 10, exampleValues: [MONEDA_DEFECTO] },
    ...conceptosDePlantilla(conceptos).map(c => ({ key: columnaDeConcepto(c), width: 22, exampleValues: [0] })),
  ], [conceptos, propiedadFija, propiedades])

  /** `<propiedad>|<CÓDIGO>` → reserva existente. */
  const porCodigo = useMemo(() => {
    const m = new Map<string, ReservaUnificada>()
    for (const r of reservas) if (r.codigo_confirmacion) m.set(`${r.propiedad_id}|${r.codigo_confirmacion.trim().toUpperCase()}`, r)
    return m
  }, [reservas])

  const validar = (fila: Record<string, unknown>) => {
    const leida = leerFilaReserva(fila, conceptos, hoy)
    if (propiedadFija) return leida.ok ? { ok: true as const, data: { ...leida.data, destino: propiedadFija } } : leida
    const texto = leida.ok ? leida.data.propiedad : String(Object.entries(fila).find(([k]) => normalizar(k) === normalizar(COL.propiedad))?.[1] ?? '')
    const destino = resolverPropiedad(texto, propiedades)
    const errorPropiedad = destino === 'ninguna'
      ? (texto.trim() ? `Propiedad «${texto.trim()}»: no hay una de corto plazo con ese nombre o código` : 'Falta la propiedad')
      : destino === 'varias' ? `Propiedad «${texto.trim()}»: hay más de una con ese nombre; usa su código` : null
    if (!leida.ok) return { ok: false as const, errors: errorPropiedad ? [errorPropiedad, ...leida.errors] : leida.errors }
    if (errorPropiedad || typeof destino === 'string') return { ok: false as const, errors: [errorPropiedad ?? 'Falta la propiedad'] }
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
            : <>La columna <strong>Propiedad</strong> lleva el nombre o el código de cada propiedad de corto plazo; así se cargan varias a la vez.</>}
          {' '}Una fila cuyo código de reserva ya existe en su propiedad actualiza esa reserva y su desglose; las demás se crean.
          La moneda es {MONEDA_DEFECTO} si la columna queda vacía. La plantilla trae una columna por cada concepto configurado.
        </p>
      }
    />
  )
}
