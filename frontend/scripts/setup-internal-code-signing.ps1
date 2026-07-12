$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$trustOutput = Join-Path $root "desktop-agent\release-khaliduo\trust"
$rootSubject = "CN=Kent Consultancy Internal Root CA, O=Kent Consultancy"
$signingSubject = "CN=Kent Consultancy Internal Code Signing, O=Kent Consultancy"
$rootFriendlyName = "Kent Consultancy Internal Root CA"
$signingFriendlyName = "Kent Consultancy Internal Code Signing"

New-Item -ItemType Directory -Force -Path $trustOutput | Out-Null

$rootCertificate = Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Subject -eq $rootSubject -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date).AddYears(1) } |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1

if (-not $rootCertificate) {
    $rootCertificate = New-SelfSignedCertificate `
        -Type Custom `
        -Subject $rootSubject `
        -FriendlyName $rootFriendlyName `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -HashAlgorithm SHA256 `
        -KeyAlgorithm RSA `
        -KeyLength 4096 `
        -KeyExportPolicy NonExportable `
        -KeyUsage CertSign, CRLSign, DigitalSignature `
        -TextExtension @("2.5.29.19={critical}{text}ca=1&pathlength=1") `
        -NotAfter (Get-Date).AddYears(10)
}

$signingCertificate = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
    Where-Object {
        $_.Subject -eq $signingSubject -and
        $_.Issuer -eq $rootCertificate.Subject -and
        $_.HasPrivateKey -and
        $_.NotAfter -gt (Get-Date).AddMonths(3)
    } |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1

if (-not $signingCertificate) {
    $signingCertificate = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $signingSubject `
        -FriendlyName $signingFriendlyName `
        -Signer $rootCertificate `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -HashAlgorithm SHA256 `
        -KeyAlgorithm RSA `
        -KeyLength 3072 `
        -KeyExportPolicy NonExportable `
        -NotAfter (Get-Date).AddYears(3)
}

$rootPublicPath = Join-Path $trustOutput "KentConsultancy-Internal-Root-CA.cer"
$publisherPublicPath = Join-Path $trustOutput "KentConsultancy-Code-Signing-Publisher.cer"

Export-Certificate -Cert $rootCertificate -FilePath $rootPublicPath -Force | Out-Null
Export-Certificate -Cert $signingCertificate -FilePath $publisherPublicPath -Force | Out-Null

Import-Certificate -FilePath $rootPublicPath -CertStoreLocation "Cert:\CurrentUser\Root" | Out-Null
Import-Certificate -FilePath $publisherPublicPath -CertStoreLocation "Cert:\CurrentUser\TrustedPublisher" | Out-Null

Copy-Item `
    -LiteralPath (Join-Path $PSScriptRoot "install-khaliduo-trust.ps1") `
    -Destination (Join-Path $trustOutput "Install-Khaliduo-Trust.ps1") `
    -Force

Write-Host "Internal code-signing certificates are ready."
Write-Host "Root certificate: $rootPublicPath"
Write-Host "Publisher certificate: $publisherPublicPath"
Write-Host "Signing subject: $signingFriendlyName"
Write-Host "Signing thumbprint: $($signingCertificate.Thumbprint)"
