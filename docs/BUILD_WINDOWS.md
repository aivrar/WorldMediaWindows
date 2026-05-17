# Build Windows EXE

The release artifact is:

```text
dist\WorldMediaWindows.exe
```

The exe bundles:

- Python runtime
- World Media local HTTP/proxy server
- Built Vite frontend
- pywebview desktop shell
- WebView/pythonnet bridge files collected by PyInstaller
- World Media icon

## Developer Requirements

- Windows 10/11
- Python 3.13+
- Node.js 20+
- npm 10+
- Build dependencies from `requirements-build.txt`

Install Python build dependencies:

```powershell
python -m pip install -r requirements-build.txt
```

## Build

```powershell
npm install
npm run build
python .\build_windows.py --skip-frontend
```

Or let the build script install/build the frontend first:

```powershell
python .\build_windows.py
```

## Smoke Test

Headless server mode:

```powershell
$env:WORLDMEDIA_NO_BROWSER = "1"
$env:WORLDMEDIA_WINDOWS_PORT = "19824"
$p = Start-Process -FilePath "python" -ArgumentList ".\worldmedia_native.py" -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 2
Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:19824/api/health"
Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://127.0.0.1:19824/api/shutdown"
Wait-Process -Id $p.Id -Timeout 5
Remove-Item Env:WORLDMEDIA_NO_BROWSER
Remove-Item Env:WORLDMEDIA_WINDOWS_PORT
```

Normal desktop launch:

```powershell
.\dist\WorldMediaWindows.exe
```

Expected behavior:

- Native desktop window opens.
- Local server responds on `127.0.0.1`.
- Runtime logs appear under `%LOCALAPPDATA%\WorldMediaWindows\logs\`.
