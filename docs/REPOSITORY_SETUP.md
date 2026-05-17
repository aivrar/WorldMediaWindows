# Repository Setup

This directory is prepared for a new GitHub repository.

Suggested repository name:

```text
WorldMediaWindows
```

Suggested repository description:

```text
Lighter Windows-native single-exe build of World Media. Open radio, live TV, and public media archives with no WSL, Docker, Node, or Python required for users.
```

Suggested topics:

```text
windows desktop-app portable webview2 pyinstaller python vite media-player internet-radio iptv public-domain open-media local-first no-install no-telemetry
```

## Manual GitHub Creation

Create an empty GitHub repo, then run:

```powershell
git remote add origin https://github.com/aivrar/WorldMediaWindows.git
git push -u origin main
```

## Release

```powershell
python .\build_windows.py
git tag v0.1.0
git push origin v0.1.0
gh release create v0.1.0 .\dist\WorldMediaWindows.exe#WorldMediaWindows.exe `
  --title "World Media Windows v0.1.0" `
  --notes "Single portable Windows exe. No WSL, Docker, Node, Git, Rust, or system Python required for users."
```
