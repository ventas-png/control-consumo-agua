// serv:S11 — Tests del mapeo PURO DTE canónico → DTE FEL (Guatemala). Verifican la
// regla clave de FEL (precios IVA-INCLUIDOS), el mapeo de tipos, la normalización de
// NIT y los defaults/override del emisor. Sin red ni I/O.

import { describe, it, expect } from 'vitest'
import { construirDteCanonico } from '../stateMachine.ts'
import {
  construirFelDte,
  normalizarNitFel,
  tipoDteFel,
} from '../felGtDte.ts'
import type { DteCanonico } from '../types.ts'

function dteFel(overrides?: Partial<Parameters<typeof construirDteCanonico>[0]>): DteCanonico {
  return construirDteCanonico({
    factura: { id: 'reg-1', subtotal: 100, ivaTasa: 0.12, ivaMonto: 12, total: 112, descripcion: 'Consumo de agua — junio 2026' },
    emisor: {
      regimen: 'fel_gt',
      nombre: 'Aguas del Valle SA',
      nit: '1234567-9',
      direccion: { linea1: 'Zona 10', ciudad: 'Guatemala', departamento: 'Guatemala', codigoPostal: '01010', pais: 'GT' },
    },
    receptor: { nombre: 'Juan Pérez', nit: 'CF' },
    fechaEmision: '2026-06-04T12:00:00.000Z',
    ...overrides,
  })
}

describe('normalizarNitFel', () => {
  it('quita guiones/espacios y pasa a mayúsculas', () => {
    expect(normalizarNitFel('1234567-9')).toBe('12345679')
    expect(normalizarNitFel(' 7654321 k ')).toBe('7654321K')
    expect(normalizarNitFel(null)).toBe('')
  })
})

describe('tipoDteFel', () => {
  it('mapea los tipos canónicos al catálogo FEL', () => {
    expect(tipoDteFel('factura')).toBe('FACT')
    expect(tipoDteFel('nota_credito')).toBe('NCRE')
    expect(tipoDteFel('nota_debito')).toBe('NDEB')
    expect(tipoDteFel('recibo')).toBe('RECI')
    expect(tipoDteFel('nota_abono')).toBe('NABN')
  })
})

describe('construirFelDte', () => {
  it('mapea encabezado: tipo, moneda y fecha', () => {
    const fel = construirFelDte(dteFel())
    expect(fel.tipo).toBe('FACT')
    expect(fel.codigoMoneda).toBe('GTQ')
    expect(fel.fechaHoraEmision).toBe('2026-06-04T12:00:00.000Z')
  })

  it('emisor: NIT normalizado + establecimiento default 1 + afiliación GEN', () => {
    const fel = construirFelDte(dteFel())
    expect(fel.emisor.nitEmisor).toBe('12345679')
    expect(fel.emisor.nombreEmisor).toBe('Aguas del Valle SA')
    expect(fel.emisor.codigoEstablecimiento).toBe(1)
    expect(fel.emisor.afiliacionIVA).toBe('GEN')
    // La dirección sale del DTE canónico.
    expect(fel.emisor.direccion.municipio).toBe('Guatemala')
    expect(fel.emisor.direccion.pais).toBe('GT')
  })

  it('receptor CF cuando no hay NIT', () => {
    const fel = construirFelDte(dteFel())
    expect(fel.receptor.idReceptor).toBe('CF')
    expect(fel.receptor.nombreReceptor).toBe('Juan Pérez')
  })

  it('receptor con NIT real lo normaliza', () => {
    const fel = construirFelDte(dteFel({ receptor: { nombre: 'Empresa XYZ', nit: '7654321-K' } }))
    expect(fel.receptor.idReceptor).toBe('7654321K')
  })

  it('REGLA FEL: precios IVA-incluidos (gravable + impuesto = total de la línea)', () => {
    const fel = construirFelDte(dteFel())
    expect(fel.items).toHaveLength(1)
    const item = fel.items[0]
    expect(item.numeroLinea).toBe(1)
    expect(item.bienOServicio).toBe('S') // servicio de agua
    // Precio IVA-incluido = total canónico (112), no el subtotal (100).
    expect(item.precio).toBe(112)
    expect(item.precioUnitario).toBe(112)
    expect(item.total).toBe(112)
    // Impuesto IVA: base 100, monto 12.
    expect(item.impuestos[0]).toMatchObject({ nombreCorto: 'IVA', montoGravable: 100, montoImpuesto: 12 })
    // gravable + impuesto = total de la línea.
    expect(item.impuestos[0].montoGravable + item.impuestos[0].montoImpuesto).toBe(item.total)
  })

  it('totales: total de impuestos y gran total IVA-incluido', () => {
    const fel = construirFelDte(dteFel())
    expect(fel.totalImpuestos).toEqual([{ nombreCorto: 'IVA', totalMontoImpuesto: 12 }])
    expect(fel.granTotal) // 112
      .toBe(112)
  })

  it('frases vacías por defecto; respeta override', () => {
    expect(construirFelDte(dteFel()).frases).toEqual([])
    const fel = construirFelDte(dteFel(), { frases: [{ tipoFrase: 1, codigoEscenario: 1 }] })
    expect(fel.frases).toEqual([{ tipoFrase: 1, codigoEscenario: 1 }])
  })

  it('opciones override: establecimiento, unidad y bien/servicio', () => {
    const fel = construirFelDte(dteFel(), {
      codigoEstablecimiento: '3',
      unidadMedida: 'M3',
      bienOServicio: 'B',
    })
    expect(fel.emisor.codigoEstablecimiento).toBe(3)
    expect(fel.items[0].unidadMedida).toBe('M3')
    expect(fel.items[0].bienOServicio).toBe('B')
  })
})
