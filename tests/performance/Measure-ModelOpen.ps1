<#
.SYNOPSIS
    설치본으로 IFC 하나를 열어 시간과 메모리를 잰다.

.DESCRIPTION
    창을 띄워야 하는 측정이라 자동 시험에 넣지 않는다. 사람이 필요할 때 돌린다.

    셸이 `--open`으로 뜨면 기록에 두 줄을 남긴다. 그 사이가 여는 데 걸린 시간이다.

        info  모델을 넘겼다        셸이 웹에 경로를 넘겼다
        info  모델을 열었다: …     웹이 실제로 뷰어에 올렸다

    메모리는 **셸의 프로세스 트리만** 센다. WebView2는 자식 프로세스를 여럿 만들고,
    이 PC의 다른 앱도 `msedgewebview2`를 띄우고 있다. 이름으로 세면 남의 것까지 합산된다.

.PARAMETER Ifc
    열 IFC. 실프로젝트 모델은 저장소에 없다 (`packages/test-fixtures/README.md`).

.PARAMETER Shell
    설치본의 셸. 기본값은 `pnpm shell:publish`가 만든 자리다.

.EXAMPLE
    .\Measure-ModelOpen.ps1 -Ifc C:\models\a.ifc
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Ifc,

    [string]$Shell = "$PSScriptRoot\..\..\apps\desktop\artifacts\publish\Bim4d.Desktop.exe",

    # 여는 데 이보다 오래 걸리면 포기한다.
    [int]$TimeoutSeconds = 600,

    # 창을 얼마나 열어 둘지. 여는 것이 끝난 뒤의 안정 상태를 보려면 넉넉히 준다.
    [int]$HoldSeconds = 75
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Shell)) {
    throw "셸이 없다: $Shell`n  저장소 뿌리에서 `pnpm shell:publish`를 먼저 돌린다."
}
if (-not (Test-Path $Ifc)) {
    throw "IFC가 없다: $Ifc"
}

$logDirectory = "$env:APPDATA\Bim4dViewer\logs"

function Get-LatestLog {
    Get-ChildItem "$logDirectory\shell-*.log" -ErrorAction SilentlyContinue |
        Sort-Object Name | Select-Object -Last 1
}

# 이미 있던 줄은 세지 않는다. 이번 실행이 남긴 것만 본다.
$log = Get-LatestLog
$skip = if ($log) { (Get-Content -LiteralPath $log.FullName -Encoding UTF8).Count } else { 0 }

<#
    셸과 그 자손 전부의 작업 집합을 MB로 돌려준다.

    부모-자식 관계를 따라 내려간다. WebView2의 렌더러와 GPU 프로세스가 여기 걸린다.
#>
function Get-ProcessTreeMB([int]$RootId) {
    $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
    $ids = @($RootId)
    $grew = $true
    while ($grew) {
        $grew = $false
        foreach ($process in $all) {
            if ($ids -contains $process.ParentProcessId -and $ids -notcontains $process.ProcessId) {
                $ids += $process.ProcessId
                $grew = $true
            }
        }
    }

    $bytes = 0
    foreach ($id in $ids) {
        $found = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($found) { $bytes += $found.WorkingSet64 }
    }
    [math]::Round($bytes / 1MB)
}

Write-Host "여는 중: $Ifc"
$shellProcess = Start-Process $Shell -ArgumentList '--open', $Ifc, '--exit-after', $HoldSeconds -PassThru

$peak = 0
$samples = @()
$startedAt = Get-Date

while (((Get-Date) - $startedAt).TotalSeconds -lt $TimeoutSeconds) {
    Start-Sleep -Seconds 3
    if ($shellProcess.HasExited) { break }

    $mb = Get-ProcessTreeMB $shellProcess.Id
    $samples += $mb
    if ($mb -gt $peak) { $peak = $mb }
}

if (-not $shellProcess.HasExited) {
    Stop-Process -Id $shellProcess.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

# 기록에서 이번 실행의 줄만 읽어 두 시각의 차를 낸다.
$log = Get-LatestLog
$lines = Get-Content -LiteralPath $log.FullName -Encoding UTF8 | Select-Object -Skip $skip
$records = $lines | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json }

$handed = $records | Where-Object { $_.message -like '모델을 넘겼다*' } | Select-Object -First 1
$opened = $records | Where-Object { $_.message -like '모델을 열었다*' } | Select-Object -First 1
$errors = $records | Where-Object { $_.level -eq 'error' }

""
"파일        : {0}  ({1:N1} MB)" -f (Split-Path $Ifc -Leaf), ((Get-Item $Ifc).Length / 1MB)
if ($handed -and $opened) {
    $seconds = ([datetime]$opened.at - [datetime]$handed.at).TotalSeconds
    "여는 시간  : {0:N1}초" -f $seconds
} else {
    "여는 시간  : 열리지 않았다"
}
"최대 메모리: {0:N0} MB   (셸 프로세스 트리)" -f $peak
if ($samples.Count -gt 3) {
    # 마지막 몇 표본이 안정 상태다. 변환이 끝나면 내려간다.
    $settled = ($samples | Select-Object -Last 3 | Measure-Object -Average).Average
    "안정 메모리: {0:N0} MB" -f $settled
}
"표본        : {0}" -f ($samples -join ' ')

if ($errors) {
    ""
    "오류:"
    $errors | ForEach-Object { "  [{0}] {1}" -f $_.code, $_.message }
}
