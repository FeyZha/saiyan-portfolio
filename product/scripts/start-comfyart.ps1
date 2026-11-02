param(
    [string]$ComfyUIRoot = $env:SAIYAN_COMFYUI_ROOT,
    [string]$PythonPath = $env:SAIYAN_PYTHON
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runtimeRoot = Join-Path $projectRoot 'workspace\comfyart-runtime'
$sourceRoot = Join-Path $projectRoot 'platform\comfyart'
if (!(Test-Path -LiteralPath (Join-Path $ComfyUIRoot 'main.py')) -or !(Test-Path -LiteralPath $PythonPath)) {
    throw 'ComfyUI 运行环境不存在；请通过参数指定本机已有环境。不会自动下载模型。'
}
if (Get-NetTCPConnection -State Listen -LocalPort 8189 -ErrorAction SilentlyContinue) {
    throw '8189 端口已被占用；已有服务保持不动。'
}
foreach ($folder in @('custom_nodes','user','input','output','temp','logs')) {
    New-Item -ItemType Directory -Path (Join-Path $runtimeRoot $folder) -Force | Out-Null
}
$nodeLink = Join-Path $runtimeRoot 'custom_nodes\ComfyArt'
if (!(Test-Path -LiteralPath $nodeLink)) {
    New-Item -ItemType Junction -Path $nodeLink -Target $sourceRoot | Out-Null
} elseif ((Get-Item -LiteralPath $nodeLink).Target -ne $sourceRoot) {
    throw 'ComfyArt 节点目录已存在且指向不同位置，未覆盖。'
}
$assetDatabase = 'sqlite:///' + (Join-Path $runtimeRoot 'user\comfyui.db').Replace('\', '/')
$argsList = @('"' + (Join-Path $ComfyUIRoot 'main.py') + '"', '--base-directory', '"' + $runtimeRoot + '"',
    '--listen', '127.0.0.1', '--port', '8189', '--cpu', '--enable-assets', '--database-url', '"' + $assetDatabase + '"',
    '--disable-all-custom-nodes', '--whitelist-custom-nodes', 'ComfyArt')
$process = Start-Process -FilePath $PythonPath -ArgumentList $argsList -WorkingDirectory $ComfyUIRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $runtimeRoot 'logs\server.stdout.log') -RedirectStandardError (Join-Path $runtimeRoot 'logs\server.stderr.log')
$process.Id | Set-Content -LiteralPath (Join-Path $runtimeRoot 'server.pid')
Write-Output "ComfyArt 本地服务正在启动，进程 $($process.Id)。独立数据目录：$runtimeRoot"
