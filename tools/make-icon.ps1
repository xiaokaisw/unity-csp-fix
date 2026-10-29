# 生成 extension/icon128.png —— 纯 PowerShell + System.Drawing，无需第三方库
# 用法： powershell -ExecutionPolicy Bypass -File tools/make-icon.ps1
param(
  [int]$Size = 128,
  [string]$Out = (Join-Path (Split-Path $PSScriptRoot -Parent) 'extension\icon128.png')
)

Add-Type -AssemblyName System.Drawing

$bmp = New-Object System.Drawing.Bitmap $Size, $Size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

# 背景透明
$g.Clear([System.Drawing.Color]::Transparent)

# 圆角矩形
$r = [int]($Size * 0.18)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$d = $r * 2
$path.AddArc(0, 0, $d, $d, 180, 90)
$path.AddArc($Size - $d, 0, $d, $d, 270, 90)
$path.AddArc($Size - $d, $Size - $d, $d, $d, 0, 90)
$path.AddArc(0, $Size - $d, $d, $d, 90, 90)
$path.CloseFigure()

$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point 0, 0),
  (New-Object System.Drawing.Point $Size, $Size),
  [System.Drawing.Color]::FromArgb(255, 59, 130, 246),
  [System.Drawing.Color]::FromArgb(255, 29, 78, 216))
$g.FillPath($brush, $path)

# 文字
$font = New-Object System.Drawing.Font 'Segoe UI', ($Size * 0.30), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = [System.Drawing.StringAlignment]::Center
$fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$rect = New-Object System.Drawing.RectangleF 0, 0, $Size, $Size
$g.DrawString('CSP', $font, $white, $rect, $fmt)

New-Item -ItemType Directory -Path (Split-Path $Out -Parent) -Force | Out-Null
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose(); $bmp.Dispose(); $font.Dispose(); $brush.Dispose(); $path.Dispose()
Write-Host "已生成: $Out"
