# Release Checklist

- Run `npm run build`.
- Run the headless smoke test in `docs/BUILD_WINDOWS.md`.
- Run `python .\build_windows.py --skip-frontend`.
- Launch `dist\WorldMediaWindows.exe` normally.
- Confirm Library, Tuner, Grid, Discovery, About, playback, settings, and shutdown.
- Confirm `%LOCALAPPDATA%\WorldMediaWindows\logs\native.log` is created.
- Confirm `dist/`, `build/`, `node_modules/`, and runtime state are ignored by Git.
- Tag and upload `dist\WorldMediaWindows.exe` as the release asset.
