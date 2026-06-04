import { useSession } from './SessionContext'
import { SecureImage } from './SecureImage'
import { BrandLogo } from './BrandLogo'
import { useCompanyLogoQuery } from '../../domain/branding/queries'

// plat:P20 — Marca del shell (white-label): muestra el logo de la empresa si está
// configurado; si no, cae al BrandLogo de AdministraTodo (que además ya se temiza
// con el color de marca vía --at-primary). El logo vive en el bucket privado
// company-logos, así que SecureImage lo firma. Lee la empresa de la sesión.
export function CompanyBrandMark({ size = 38 }: { size?: number }) {
  const session = useSession()
  const { data } = useCompanyLogoQuery(session.company_id ?? undefined)
  const logoUrl = data?.logo_url

  if (logoUrl) {
    return (
      <div style={{ width: size, height: size, borderRadius: '11px', overflow: 'hidden', background: '#fff', flexShrink: 0 }}>
        <SecureImage
          bucket="company-logos"
          src={logoUrl}
          alt={data?.nombre ? `Logo de ${data.nombre}` : 'Logo de la empresa'}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>
    )
  }
  return <BrandLogo size={size} />
}
