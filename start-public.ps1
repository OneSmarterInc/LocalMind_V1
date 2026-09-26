$LM = "C:\LocalMind_V1"
Set-Location $LM
tailscale funnel --bg 8000 | Out-Null
Write-Host ""
Write-Host "Public link: https://localmind.taild0af72.ts.net" -ForegroundColor Green
Write-Host "Keep this window open. Ctrl+C stops LocalMind." -ForegroundColor Yellow
Write-Host ""
& "$LM\backend\.venv\Scripts\python.exe" "$LM\run_localmind.py" --host 127.0.0.1 --port 8000 --no-browser
