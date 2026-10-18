param([switch]$SkipChecks)
$ErrorActionPreference = 'Stop'
$glimpseRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location -LiteralPath $glimpseRoot
try {
  if (-not $SkipChecks) {
    npm run check
    if ($LASTEXITCODE -ne 0) { throw 'Checks failed; package not created.' }
  }
  node scripts/verify-build.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Build verification failed.' }
  $glimpsePackage = Get-Content -LiteralPath (Join-Path $glimpseRoot 'package.json') -Encoding UTF8 -Raw | ConvertFrom-Json
  $glimpseDist = [IO.Path]::GetFullPath((Join-Path $glimpseRoot 'dist'))
  if ($glimpseDist -ne (Join-Path $glimpseRoot 'dist')) { throw 'Unexpected build path.' }
  $glimpseZip = Join-Path $glimpseRoot ('glimpse-' + $glimpsePackage.version + '.zip')
  Compress-Archive -Path (Join-Path $glimpseDist '*') -DestinationPath $glimpseZip -Force
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $glimpseArchive = [IO.Compression.ZipFile]::OpenRead($glimpseZip)
  try {
    $glimpseManifest = $glimpseArchive.GetEntry('manifest.json')
    if ($null -eq $glimpseManifest) { throw 'Archive missing root manifest.' }
    $glimpseReader = [IO.StreamReader]::new($glimpseManifest.Open())
    try { $glimpseVersion = ($glimpseReader.ReadToEnd() | ConvertFrom-Json).version } finally { $glimpseReader.Dispose() }
    if ($glimpseVersion -ne $glimpsePackage.version) { throw 'Archive version mismatch.' }
  } finally { $glimpseArchive.Dispose() }
  Get-Item -LiteralPath $glimpseZip | Select-Object FullName, Length
} finally { Pop-Location }
