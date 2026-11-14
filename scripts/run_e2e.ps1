# scripts/run_e2e.ps1
$ErrorActionPreference = "Stop"

Write-Host "=== Starting Anna App Dev Server on Port 5185 ==="
$serverJob = Start-Job -ScriptBlock {
    Set-Location "c:\Users\kathi\Downloads\speakup-ai"
    cmd.exe /c "anna-app dev --port 5185 --no-watch"
}

Write-Host "=== Starting Headless Chrome with Remote Debugging (port 9222) ==="
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$tempDir = Join-Path $env:TEMP "chrome-e2e-$(Get-Random)"
$chromeProc = Start-Process -FilePath $chromePath -ArgumentList "http://localhost:5185/ --headless=new --remote-debugging-port=9222 --disable-gpu --user-data-dir=$tempDir" -PassThru -NoNewWindow

Start-Sleep -Seconds 6

try {
    Write-Host "=== Running Automated Interactive Test ==="
    node scripts/e2e_test.cjs
} finally {
    Write-Host "=== Cleaning Up Processes ==="
    if ($chromeProc -and -not $chromeProc.HasExited) {
        Stop-Process -Id $chromeProc.Id -Force -ErrorAction SilentlyContinue
    }
    Stop-Job -Job $serverJob -ErrorAction SilentlyContinue
    Remove-Job -Job $serverJob -ErrorAction SilentlyContinue
    Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}

