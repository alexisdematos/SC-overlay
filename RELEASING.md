# Releasing

Updates come from the GitHub releases. The installer is signed with a key kept outside the repository.

1. Raise the version in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` (they must match).
2. Run `powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Notes "What changed."`. It asks for the key password.
3. Create a release tagged `v<version>` and upload `SC-overlay_<version>_x64-setup.exe`, its `.sig` file and `latest.json`.

The key file is never committed (`*.key` is ignored). If you lose it, installed copies cannot update any more.
