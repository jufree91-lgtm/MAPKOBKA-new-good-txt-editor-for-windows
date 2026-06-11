# Запускает официальный установщик Blocnot (NSIS).
# Собери его перед запуском: npm run dist
$ErrorActionPreference = 'Stop'

$setup = Get-ChildItem -Path (Join-Path $PSScriptRoot 'dist') -Filter 'Blocnot-Setup-*.exe' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $setup) {
  Write-Host 'Установщик не найден. Сначала собери его:'
  Write-Host '  npm run dist'
  exit 1
}

Write-Host "Запускаю $($setup.Name) ..."
Start-Process -FilePath $setup.FullName -Wait
Write-Host 'Готово.'
