# Установка Blocnot: копирует приложение в LocalAppData, регистрирует
# его как обработчик .txt и создаёт ярлыки. Админ-права не нужны.
$ErrorActionPreference = 'Stop'

$src = Join-Path $PSScriptRoot 'dist\win-unpacked'
$dest = Join-Path $env:LOCALAPPDATA 'Programs\Blocnot'
$exe = Join-Path $dest 'Blocnot.exe'

if (-not (Test-Path $src)) { throw "Сначала соберите приложение: npm run dist" }

Write-Host "Копирую приложение в $dest ..."
Get-Process Blocnot -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item "$src\*" $dest -Recurse -Force

Write-Host "Регистрирую обработчик .txt ..."
$classes = 'HKCU:\Software\Classes'

# ProgID
New-Item -Force -Path "$classes\Blocnot.txt\DefaultIcon" | Out-Null
New-Item -Force -Path "$classes\Blocnot.txt\shell\open\command" | Out-Null
Set-ItemProperty -Path "$classes\Blocnot.txt" -Name '(Default)' -Value 'Текстовый документ'
Set-ItemProperty -Path "$classes\Blocnot.txt\DefaultIcon" -Name '(Default)' -Value "`"$exe`",0"
Set-ItemProperty -Path "$classes\Blocnot.txt\shell\open\command" -Name '(Default)' -Value "`"$exe`" `"%1`""

# предлагаем Blocnot в "Открыть с помощью" для популярных текстовых расширений
foreach ($ext in '.txt', '.log', '.ini', '.cfg', '.md') {
  New-Item -Force -Path "$classes\$ext\OpenWithProgids" | Out-Null
  New-ItemProperty -Force -Path "$classes\$ext\OpenWithProgids" -Name 'Blocnot.txt' -PropertyType String -Value '' | Out-Null
}

# регистрация приложения (Default Apps)
New-Item -Force -Path "$classes\Applications\Blocnot.exe\shell\open\command" | Out-Null
Set-ItemProperty -Path "$classes\Applications\Blocnot.exe\shell\open\command" -Name '(Default)' -Value "`"$exe`" `"%1`""
New-Item -Force -Path 'HKCU:\Software\Blocnot\Capabilities\FileAssociations' | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Blocnot\Capabilities' -Name 'ApplicationName' -Value 'Blocnot'
Set-ItemProperty -Path 'HKCU:\Software\Blocnot\Capabilities' -Name 'ApplicationDescription' -Value 'Минималистичный современный блокнот'
foreach ($ext in '.txt', '.log', '.ini', '.cfg', '.md') {
  Set-ItemProperty -Path 'HKCU:\Software\Blocnot\Capabilities\FileAssociations' -Name $ext -Value 'Blocnot.txt'
}
New-Item -Force -Path 'HKCU:\Software\RegisteredApplications' -ErrorAction SilentlyContinue | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\RegisteredApplications' -Name 'Blocnot' -Value 'Software\Blocnot\Capabilities'

Write-Host "Создаю ярлыки ..."
$ws = New-Object -ComObject WScript.Shell
foreach ($lnkPath in @(
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Blocnot.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Blocnot.lnk')
)) {
  $lnk = $ws.CreateShortcut($lnkPath)
  $lnk.TargetPath = $exe
  $lnk.WorkingDirectory = $dest
  $lnk.Description = 'Blocnot — современный блокнот'
  $lnk.Save()
}

Write-Host ""
Write-Host "Готово! Blocnot установлен: $exe"
Write-Host "Чтобы .txt открывались в нём по двойному клику:"
Write-Host "  ПКМ по .txt файлу → Открыть с помощью → Выбрать другое приложение →"
Write-Host "  Blocnot → поставить галочку 'Всегда использовать это приложение'."
