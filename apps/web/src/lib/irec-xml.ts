/**
 * I-REC XML export for SolarProof certificates.
 * Generates I-REC compliant XML including the on-chain anchor proof.
 */

export interface IRecCertificateData {
  id: string
  kwh: number
  issued_at: string
  holder_address: string
  mint_tx_hash: string | null
  meter_id: string | null
  retired?: boolean
  retired_at?: string | null
  retired_by?: string | null
  cooperative_id?: string | null
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Map SolarProof certificate data to I-REC XML.
 * Includes on-chain anchor proof in <AnchorProof> extension element.
 */
export function buildIRecXml(cert: IRecCertificateData): string {
  const volumeWh = cert.kwh * 1000
  const vintageDate = cert.issued_at.slice(0, 10)

  const retirementBlock = cert.retired && cert.retired_at
    ? `\n  <Retirement>\n    <RetiredAt>${escapeXml(cert.retired_at)}</RetiredAt>\n    <RetiredBy>${escapeXml(cert.retired_by ?? '')}</RetiredBy>\n  </Retirement>`
    : ''

  const anchorProof = cert.mint_tx_hash
    ? `\n  <AnchorProof>\n    <Network>Stellar Testnet</Network>\n    <TxHash>${escapeXml(cert.mint_tx_hash)}</TxHash>\n    <VerifierUrl>https://solarproof.vercel.app/verify/${escapeXml(cert.id)}</VerifierUrl>\n  </AnchorProof>`
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<IRECCertificate xmlns="https://www.irecstandard.org/schema/v3">
  <CertificateId>${escapeXml(cert.id)}</CertificateId>
  <Issuer>SolarProof</Issuer>
  <IssuanceDate>${escapeXml(cert.issued_at)}</IssuanceDate>
  <Device>
    <DeviceId>${escapeXml(cert.meter_id ?? 'unknown')}</DeviceId>
    <FuelType>Solar</FuelType>
  </Device>
  <Production>
    <VolumeWh>${volumeWh}</VolumeWh>
    <VintageStart>${vintageDate}</VintageStart>
    <VintageEnd>${vintageDate}</VintageEnd>
  </Production>
  <Holder>${escapeXml(cert.holder_address)}</Holder>${retirementBlock}${anchorProof}
</IRECCertificate>`
}
