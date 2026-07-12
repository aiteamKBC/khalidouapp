[CmdletBinding()]
param(
    [ValidateSet("CurrentUser", "LocalMachine")]
    [string] $Scope = "LocalMachine",

    [string] $CertificateDirectory
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($CertificateDirectory)) {
    $CertificateDirectory = $PSScriptRoot
}

if ($Scope -eq "LocalMachine") {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Run PowerShell as Administrator to install Khaliduo trust for this computer."
    }
}

$rootCertificatePath = Join-Path $CertificateDirectory "KentConsultancy-Internal-Root-CA.cer"
$publisherCertificatePath = Join-Path $CertificateDirectory "KentConsultancy-Code-Signing-Publisher.cer"

if (-not (Test-Path -LiteralPath $rootCertificatePath)) {
    throw "Kent Consultancy root certificate was not found: $rootCertificatePath"
}
if (-not (Test-Path -LiteralPath $publisherCertificatePath)) {
    throw "Kent Consultancy publisher certificate was not found: $publisherCertificatePath"
}

$rootCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($rootCertificatePath)
$publisherCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($publisherCertificatePath)

if ($rootCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -ne "Kent Consultancy Internal Root CA") {
    throw "The supplied root certificate is not the expected Kent Consultancy certificate."
}
if ($publisherCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -ne "Kent Consultancy Internal Code Signing") {
    throw "The supplied publisher certificate is not the expected Kent Consultancy certificate."
}

$rootStore = "Cert:\$Scope\Root"
$publisherStore = "Cert:\$Scope\TrustedPublisher"
Import-Certificate -FilePath $rootCertificatePath -CertStoreLocation $rootStore | Out-Null
Import-Certificate -FilePath $publisherCertificatePath -CertStoreLocation $publisherStore | Out-Null

Write-Host "Khaliduo trust was installed for: $Scope"
Write-Host "Root thumbprint: $($rootCertificate.Thumbprint)"
Write-Host "Publisher thumbprint: $($publisherCertificate.Thumbprint)"
