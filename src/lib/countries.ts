// LATAM-first country list with associated Stripe Tax ID types.
// `taxIdTypes` se alinea con el campo `type` del Stripe Tax IDs API
// (https://docs.stripe.com/api/customer_tax_ids/object#tax_id_object-type).

export interface Country {
  code: string
  name: string
  taxIdTypes: { value: string; label: string }[]
}

export const COUNTRIES: Country[] = [
  { code: 'MX', name: 'México',                taxIdTypes: [{ value: 'mx_rfc',  label: 'RFC' }] },
  { code: 'GT', name: 'Guatemala',             taxIdTypes: [{ value: 'gt_nit',  label: 'NIT' }] },
  { code: 'CR', name: 'Costa Rica',            taxIdTypes: [{ value: 'cr_tin',  label: 'Cédula jurídica' }] },
  { code: 'HN', name: 'Honduras',              taxIdTypes: [{ value: 'other',   label: 'RTN' }] },
  { code: 'SV', name: 'El Salvador',           taxIdTypes: [{ value: 'sv_nit',  label: 'NIT' }] },
  { code: 'NI', name: 'Nicaragua',             taxIdTypes: [{ value: 'other',   label: 'RUC' }] },
  { code: 'PA', name: 'Panamá',                taxIdTypes: [{ value: 'pa_ruc',  label: 'RUC' }] },
  { code: 'DO', name: 'República Dominicana',  taxIdTypes: [{ value: 'do_rcn',  label: 'RCN' }] },
  { code: 'CO', name: 'Colombia',              taxIdTypes: [{ value: 'co_nit',  label: 'NIT' }] },
  { code: 'EC', name: 'Ecuador',               taxIdTypes: [{ value: 'ec_ruc',  label: 'RUC' }] },
  { code: 'PE', name: 'Perú',                  taxIdTypes: [{ value: 'pe_ruc',  label: 'RUC' }] },
  { code: 'BO', name: 'Bolivia',               taxIdTypes: [{ value: 'other',   label: 'NIT' }] },
  { code: 'CL', name: 'Chile',                 taxIdTypes: [{ value: 'cl_tin',  label: 'RUT' }] },
  { code: 'AR', name: 'Argentina',             taxIdTypes: [{ value: 'ar_cuit', label: 'CUIT' }] },
  { code: 'UY', name: 'Uruguay',               taxIdTypes: [{ value: 'uy_rut',  label: 'RUT' }] },
  { code: 'PY', name: 'Paraguay',              taxIdTypes: [{ value: 'other',   label: 'RUC' }] },
  { code: 'BR', name: 'Brasil',                taxIdTypes: [
    { value: 'br_cnpj', label: 'CNPJ (empresa)' },
    { value: 'br_cpf',  label: 'CPF (persona)' },
  ] },
  { code: 'VE', name: 'Venezuela',             taxIdTypes: [{ value: 'other',   label: 'RIF' }] },
  { code: 'US', name: 'Estados Unidos',        taxIdTypes: [{ value: 'us_ein',  label: 'EIN' }] },
  { code: 'ES', name: 'España',                taxIdTypes: [{ value: 'eu_vat',  label: 'VAT' }] },
  { code: 'GB', name: 'Reino Unido',           taxIdTypes: [{ value: 'gb_vat',  label: 'VAT' }] },
]

export function countryByCode(code: string | null | undefined): Country | undefined {
  if (!code) return undefined
  return COUNTRIES.find(c => c.code === code)
}

export function countryName(code: string | null | undefined): string {
  return countryByCode(code)?.name ?? code ?? '—'
}
