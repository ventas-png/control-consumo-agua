import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ConceptoRenta, PropiedadRenta, ReservaUnificada } from '../../../types'
import { tieneDesglose, totalesDesglose } from '../../../domain/rentas/finanzas'
import {
  COL, columnaDeConcepto, conceptosDePlantilla, leerFilaReserva, type FilaReservaImportada,
} from '../../../domain/rentas/importacion'
import { rentasKeys } from '../../../domain/rentas/keys'
import { mensajeErrorRentas } from '../../../domain/rentas/logica'
import { actualizarReserva, guardarLiquidacion, insertarReserva } from '../../../domain/rentas/mutations'
import { ImportModal, type ImportColumn } from '../../shared/ImportModal'
import { tenue } from '../ui'

interface Props {
  propiedad: PropiedadRenta
  /** Reservas que la propiedad ya tiene: una fila con el mismo código la ACTUALIZA. */
  reservas: ReservaUnificada[]
  conceptos: ConceptoRenta[]
  hoy: string
  onClose: () => void
}

/**
 * Carga la hoja de un apartamento: una fila por reserva, con una columna por
 * cada concepto activo del desglose. La plantilla se arma con los conceptos de
 * la empresa, así que cambia cuando se configuran.
 */
export function ImportarReservasModal({ propiedad, reservas, conceptos, hoy, onClose }: Props) {
  const qc = useQueryClient()
  const columnas = useMemo<ImportColumn[]>(() => [
    { key: COL.codigo, width: 18, exampleValues: ['HM34NRSTRH'] },
    { key: COL.huesped, width: 24, exampleValues: ['Ana Pérez'] },
    { key: COL.entrada, width: 12, exampleValues: ['2026-02-02'] },
    { key: COL.salida, width: 12, exampleValues: ['2026-02-03'] },
    { key: COL.huespedes, width: 10, exampleValues: [1] },
    { key: COL.plataforma, width: 12, exampleValues: ['airbnb'] },
    { key: COL.politica, width: 22, exampleValues: ['No reembolsable'] },
    { key: COL.mascotas, width: 10, exampleValues: [0] },
    ...conceptosDePlantilla(conceptos).map(c => ({ key: columnaDeConcepto(c), width: 22, exampleValues: [0] })),
  ], [conceptos])

  const porCodigo = useMemo(() => {
    const m = new Map<string, ReservaUnificada>()
    for (const r of reservas) if (r.codigo_confirmacion) m.set(r.codigo_confirmacion.trim().toUpperCase(), r)
    return m
  }, [reservas])

  const importar = async (lote: FilaReservaImportada[]) => {
    let ok = 0
    try {
      for (const { datos, importes } of lote) {
        const conDesglose = tieneDesglose(importes)
        const completos = { ...datos, monto_total: conDesglose ? totalesDesglose(conceptos, importes).anfitrion : null }
        const existente = datos.codigo_confirmacion ? porCodigo.get(datos.codigo_confirmacion.toUpperCase()) : undefined
        if (existente) {
          // No se pisa el total ya capturado si la fila viene sin desglose.
          const { monto_total, monto_noche: _n, estado: _e, ...resto } = completos
          await actualizarReserva(existente, conDesglose ? { ...resto, monto_total } : resto)
          if (conDesglose) await guardarLiquidacion(propiedad, existente, importes)
        } else {
          const ref = await insertarReserva(propiedad, completos)
          if (conDesglose) await guardarLiquidacion(propiedad, ref, importes)
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

  return (
    <ImportModal<FilaReservaImportada>
      entityLabel="reserva" entityLabelPlural="reservas"
      columns={columnas} sheetName="Reservas"
      templateFilename={`plantilla_reservas_${propiedad.nombre.replace(/[^\p{L}\p{N}]+/gu, '_').toLowerCase()}`}
      validateRow={fila => leerFilaReserva(fila, conceptos, hoy)}
      onInsertBatch={importar} batchSize={25}
      onClose={onClose} onImportado={() => undefined}
      optionsPanel={
        <p style={{ ...tenue, margin: 0, fontSize: '13px' }}>
          Se cargan en <strong>{propiedad.nombre}</strong>. Una fila cuyo código de reserva ya existe en la propiedad actualiza esa reserva
          y su desglose; las demás se crean. Descarga la plantilla: trae una columna por cada concepto configurado.
        </p>
      }
    />
  )
}
