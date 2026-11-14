# Compiles the map's HLSL to the bytecode embedded in StuDev, with the Windows SDK's fxc; run after changing a shader.
$ErrorActionPreference = 'Stop'
$fxc = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\fxc.exe' | Sort-Object FullName | Select-Object -Last 1
$folder = Join-Path $PSScriptRoot 'StuDev\Map\Shaders'
& $fxc.FullName /nologo /T vs_5_0 /E Vertices /O3 /Fo (Join-Path $folder 'ModelsVertex.cso') (Join-Path $folder 'Models.hlsl')
if ($LASTEXITCODE -ne 0) { throw 'vertex shader failed' }
& $fxc.FullName /nologo /T ps_5_0 /E Pixels /O3 /Fo (Join-Path $folder 'ModelsPixel.cso') (Join-Path $folder 'Models.hlsl')
if ($LASTEXITCODE -ne 0) { throw 'pixel shader failed' }
