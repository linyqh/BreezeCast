# Builds the audio.cpp server (BreezeTTS only) for Windows x64 and stages it as the Tauri sidecar.
# Vulkan needs the Vulkan SDK (VULKAN_SDK set); the build always includes the CPU backend as fallback.
[CmdletBinding()]
param(
    [ValidateSet("vulkan", "cpu")]
    [string]$Backend = "vulkan"
)
$ErrorActionPreference = "Stop"

$Root = (Resolve-Path "$PSScriptRoot\..").Path
$Vendor = Join-Path $Root "vendor\audio.cpp"
$Rev = (Get-Content (Join-Path $PSScriptRoot "audiocpp.rev") -Raw).Trim()

function Invoke-Git {
    git @args
    if ($LASTEXITCODE -ne 0) { throw "git $args failed" }
}

if (-not (Test-Path $Vendor)) {
    New-Item -ItemType Directory -Force $Vendor | Out-Null
    Invoke-Git -C $Vendor init -q
    Invoke-Git -C $Vendor remote add origin https://github.com/0xShug0/audio.cpp.git
    Invoke-Git -C $Vendor fetch -q --depth 1 origin $Rev
    Invoke-Git -C $Vendor checkout -q FETCH_HEAD
    Invoke-Git -C $Vendor submodule update -q --init --recursive --depth 1
}

$Preset = "windows-$Backend-release"
& (Join-Path $Vendor "scripts\build_windows.ps1") -Preset $Preset -Target audiocpp_server `
    -DeploymentBuild -ModelSet custom -Models breeze_tts -Version breezecast

$Bin = Join-Path $Vendor "build\$Preset\bin"
$Triple = ((rustc -vV) | Select-String '^host: (.+)$').Matches[0].Groups[1].Value
$Binaries = Join-Path $Root "src-tauri\binaries"
$Dlls = Join-Path $Binaries "windows"
New-Item -ItemType Directory -Force $Dlls | Out-Null
Get-ChildItem $Dlls | Remove-Item -Force
Copy-Item (Join-Path $Bin "audiocpp_server.exe") (Join-Path $Binaries "audiocpp_server-$Triple.exe") -Force
Get-ChildItem (Join-Path $Bin "*.dll") -ErrorAction SilentlyContinue | Copy-Item -Destination $Dlls

# App-local MSVC runtime (incl. OpenMP) so the app runs without the VC++ Redistributable.
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -products * -property installationPath
$redist = Get-ChildItem "$vs\VC\Redist\MSVC" -Directory |
    Sort-Object { try { [version]$_.Name } catch { [version]"0.0" } } -Descending |
    Select-Object -First 1
foreach ($sub in "x64\Microsoft.VC143.CRT", "x64\Microsoft.VC143.OPENMP") {
    Get-ChildItem (Join-Path $redist.FullName "$sub\*.dll") |
        Where-Object { $_.Name -match '^(vcruntime140|msvcp140|vcomp140)' } |
        Copy-Item -Destination $Dlls
}
if (-not (Test-Path (Join-Path $Dlls "vcomp140.dll"))) { throw "vcomp140.dll not found under $($redist.FullName)" }

# The Vulkan build links vulkan-1.dll; shipping the loader lets machines without a GPU driver start and fall back to CPU.
if ($Backend -eq "vulkan") {
    $loader = @("$env:VULKAN_SDK\Bin\vulkan-1.dll", "$env:SystemRoot\System32\vulkan-1.dll") |
        Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if (-not $loader) { throw "vulkan-1.dll not found (VULKAN_SDK=$env:VULKAN_SDK)" }
    Copy-Item $loader $Dlls
}

Write-Host "sidecar installed: src-tauri\binaries\audiocpp_server-$Triple.exe"
Get-ChildItem $Dlls | ForEach-Object { Write-Host "  + $($_.Name)" }
