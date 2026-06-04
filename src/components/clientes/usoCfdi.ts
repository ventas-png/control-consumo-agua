// serv:S11 — Catálogo (subconjunto) del Uso del CFDI (SAT MX, c_UsoCFDI 4.0).
// Solo aplica al régimen cfdi_mx. Subconjunto de claves de uso común para
// receptores; la lista completa del SAT es follow-up (se cargaría desde un
// catálogo versionado). El `value` es la clave oficial que viaja en el CFDI.
export interface UsoCfdiOpcion {
  value: string
  label: string
}

export const USO_CFDI_OPCIONES: UsoCfdiOpcion[] = [
  { value: 'G01', label: 'G01 — Adquisición de mercancías' },
  { value: 'G02', label: 'G02 — Devoluciones, descuentos o bonificaciones' },
  { value: 'G03', label: 'G03 — Gastos en general' },
  { value: 'I01', label: 'I01 — Construcciones' },
  { value: 'I02', label: 'I02 — Mobiliario y equipo de oficina' },
  { value: 'I04', label: 'I04 — Equipo de cómputo y accesorios' },
  { value: 'I08', label: 'I08 — Otra maquinaria y equipo' },
  { value: 'D01', label: 'D01 — Honorarios médicos, dentales y hospitalarios' },
  { value: 'D04', label: 'D04 — Donativos' },
  { value: 'D10', label: 'D10 — Pagos por servicios educativos (colegiaturas)' },
  { value: 'P01', label: 'P01 — Por definir' },
  { value: 'S01', label: 'S01 — Sin efectos fiscales' },
  { value: 'CP01', label: 'CP01 — Pagos' },
]
