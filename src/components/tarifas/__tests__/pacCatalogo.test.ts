import { describe, it, expect } from 'vitest'
import {
  pacsParaRegimen,
  etiquetaPac,
  regimenReal,
  origenCampos,
  mostrarHerencia,
  estadoConexionStyle,
  regimenDeConfig,
  PAC_SANDBOX,
  PACS_FEL_GT,
  PACS_CFDI_MX,
  REGIMEN_OPCIONES,
} from '../pacCatalogo'

// serv:S11 (UI parte 2). Lógica PURA del selector de PAC + de la herencia
// mostrada. No renderiza la UI: verifica el catálogo por régimen (gating), las
// etiquetas y el criterio heredado/override que dibuja los chips.

describe('pacsParaRegimen — gating del selector por régimen', () => {
  it('GT/FEL ofrece Sandbox + Infile, Guatefacturas (G4S) y Megaprint, con Sandbox primero', () => {
    const opts = pacsParaRegimen('fel_gt')
    expect(opts[0]).toEqual(PAC_SANDBOX)
    const values = opts.map((o) => o.value)
    expect(values).toEqual(['sandbox', 'infile', 'guatefacturas', 'megaprint'])
    // No se cuelan PACs de México.
    expect(values).not.toContain('facturama')
  })

  it('MX/CFDI ofrece Sandbox + Facturama, Finkok y SW sapien, con Sandbox primero', () => {
    const opts = pacsParaRegimen('cfdi_mx')
    expect(opts[0]).toEqual(PAC_SANDBOX)
    const values = opts.map((o) => o.value)
    expect(values).toEqual(['sandbox', 'facturama', 'finkok', 'sw_sapien'])
    expect(values).not.toContain('infile')
  })

  it("régimen 'ninguno' solo ofrece Sandbox (no hay PAC real que conectar)", () => {
    expect(pacsParaRegimen('ninguno')).toEqual([PAC_SANDBOX])
  })

  it('los catálogos por país son disjuntos entre sí', () => {
    const gt = new Set(PACS_FEL_GT.map((p) => p.value))
    const mx = new Set(PACS_CFDI_MX.map((p) => p.value))
    for (const v of gt) expect(mx.has(v)).toBe(false)
  })
})

describe('etiquetaPac', () => {
  it('devuelve la etiqueta legible de un PAC conocido', () => {
    expect(etiquetaPac('guatefacturas')).toBe('Guatefacturas (G4S)')
    expect(etiquetaPac('finkok')).toBe('Finkok')
  })
  it('cae a la etiqueta de Sandbox cuando no hay valor', () => {
    expect(etiquetaPac(null)).toBe(PAC_SANDBOX.label)
    expect(etiquetaPac(undefined)).toBe(PAC_SANDBOX.label)
  })
  it('un proveedor desconocido devuelve su propio value', () => {
    expect(etiquetaPac('otro-pac')).toBe('otro-pac')
  })
})

describe('regimenReal / regimenDeConfig / REGIMEN_OPCIONES', () => {
  it('regimenReal devuelve el régimen con PAC o null para ninguno', () => {
    expect(regimenReal('fel_gt')).toBe('fel_gt')
    expect(regimenReal('cfdi_mx')).toBe('cfdi_mx')
    expect(regimenReal('ninguno')).toBeNull()
    expect(regimenReal(null)).toBeNull()
  })
  it('regimenDeConfig lee el régimen efectivo de la config', () => {
    expect(regimenDeConfig({ regimenFiscal: 'fel_gt' })).toBe('fel_gt')
    expect(regimenDeConfig({ regimenFiscal: 'ninguno' })).toBeNull()
    expect(regimenDeConfig(null)).toBeNull()
  })
  it('REGIMEN_OPCIONES cubre los tres regímenes', () => {
    expect(REGIMEN_OPCIONES.map((r) => r.value).sort()).toEqual(['cfdi_mx', 'fel_gt', 'ninguno'])
  })
})

describe('origenCampos — herencia mostrada (heredado vs override de locación)', () => {
  it('a nivel EMPRESA todos los campos son del propio nivel (no heredan)', () => {
    const o = origenCampos('empresa', null)
    expect(Object.values(o).every((v) => v === 'locacion')).toBe(true)
  })

  it('a nivel LOCACIÓN, un campo VACÍO hereda de la empresa', () => {
    const o = origenCampos('locacion', { nit: null, nombreFiscal: '' })
    expect(o.nit).toBe('heredado')
    expect(o.nombreFiscal).toBe('heredado')
    expect(o.rfc).toBe('heredado')
    expect(o.proveedorTimbrado).toBe('heredado')
  })

  it('a nivel LOCACIÓN, un campo CON VALOR es override propio de la locación', () => {
    const o = origenCampos('locacion', { nit: '1234567-8', proveedorTimbrado: 'infile' })
    expect(o.nit).toBe('locacion')
    expect(o.proveedorTimbrado).toBe('locacion')
    // los no provistos siguen heredando
    expect(o.rfc).toBe('heredado')
  })

  it('nombreFiscal hereda si tanto nombreFiscal como nombre están vacíos', () => {
    expect(origenCampos('locacion', { nombreFiscal: '', nombre: '' }).nombreFiscal).toBe('heredado')
    expect(origenCampos('locacion', { nombre: 'Sucursal Centro' }).nombreFiscal).toBe('locacion')
  })

  it('establecimiento/serie (solo-locación) nunca se marcan como heredados', () => {
    const o = origenCampos('locacion', {})
    expect(o.establecimiento).toBe('locacion')
    expect(o.serieFiscal).toBe('locacion')
  })

  it('whitespace puro cuenta como vacío (hereda)', () => {
    expect(origenCampos('locacion', { nit: '   ' }).nit).toBe('heredado')
  })
})

describe('mostrarHerencia', () => {
  it('solo muestra chips de herencia en ámbito locación', () => {
    expect(mostrarHerencia('empresa')).toBe(false)
    expect(mostrarHerencia('locacion')).toBe(true)
  })
})

describe('estadoConexionStyle — badge', () => {
  it('ok → Conectado', () => {
    expect(estadoConexionStyle('ok').label).toBe('Conectado')
  })
  it('error → Error de conexión', () => {
    expect(estadoConexionStyle('error').label).toBe('Error de conexión')
  })
  it('desconocido/ausente → Sin probar', () => {
    expect(estadoConexionStyle('desconocido').label).toBe('Sin probar')
    expect(estadoConexionStyle(null).label).toBe('Sin probar')
    expect(estadoConexionStyle(undefined).label).toBe('Sin probar')
    expect(estadoConexionStyle('basura').label).toBe('Sin probar')
  })
})
