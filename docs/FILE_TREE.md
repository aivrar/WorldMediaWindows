# File Tree

```text
WorldMediaWindows/
|-- .github/
|   |-- ISSUE_TEMPLATE/
|   `-- pull_request_template.md
|-- assets/
|   |-- worldmedia.ico
|   `-- worldmedia-icon.png
|-- docs/
|   |-- screenshots/
|   |-- BUILD_WINDOWS.md
|   |-- FILE_TREE.md
|   |-- RELEASE_CHECKLIST.md
|   `-- REPOSITORY_SETUP.md
|-- frontend/
|   |-- assets/
|   `-- index.html
|-- src/
|   |-- adapters/
|   |-- lib/
|   |-- modes/
|   |-- styles/
|   |-- vendor/
|   `-- index.html
|-- build_windows.py
|-- package.json
|-- requirements-build.txt
|-- vite.config.js
|-- worldmedia_native.py
|-- worldmedia_native.spec
|-- worldmedia_server.py
`-- README.md
```

## Important Files

| Path | Purpose |
|---|---|
| `worldmedia_native.py` | Windows desktop entry point. Starts the local server and opens WebView2. |
| `worldmedia_server.py` | Local HTTP server, static frontend host, allowlisted CORS proxy, shutdown API. |
| `src/` | Vite frontend source. |
| `frontend/` | Built frontend bundled into the exe. |
| `build_windows.py` | Builds frontend, writes PyInstaller spec, creates the one-file exe. |
| `assets/` | App icon assets. |
