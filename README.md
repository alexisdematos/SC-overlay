# SC-overlay

A Star Citizen overlay for Windows 10/11. It shows your hauling route, your position and your team on top of the game.

It does not read the game's memory or inject anything. The data comes from the [SC-hauling](https://github.com/alexisdematos/SC-hauling) service (game log, contracts, routes) and the [SC-map](https://github.com/alexisdematos/SC-map) site and API.

## Install

1. Download `SC-overlay_<version>_x64-setup.exe` from the [releases](https://github.com/alexisdematos/SC-overlay/releases).
2. Run it. It installs for your account only, no admin rights needed.
3. SmartScreen may warn you: the exe has no publisher signature. Click "More info", then "Run anyway".
4. Run the game in borderless window mode. An exclusive fullscreen game hides the overlay.

The SC-hauling service is bundled in the installer. Your settings stay in `%APPDATA%\SC-overlay` when you update or uninstall.

## Use

Three modes:

| Mode | What it does |
| --- | --- |
| Game | Clicks go to the game. Only pinned widgets show. |
| Interaction | The game is dimmed and blurred. You click the widgets and the search bar. |
| Edit | You move and resize widgets, pin them, change their opacity. |

Default hotkeys (change them in Settings):

| Keys | Action |
| --- | --- |
| Alt+O | Switch between game and interaction |
| Alt+P | Focus the search bar |
| Alt+I | Next layout profile |
| Alt+U | In game mode: pinned widgets, all widgets of the profile, none |

Widgets: route, here, cargo, quantum heading, team, alerts, map, trade suggestions.

Settings (button in the top bar):
- Hotkeys: click a field, press the keys, click Apply. No restart needed.
- Background: dim level and blur.
- Layout profiles: add, rename, use, delete. One layout per use (transport, team, ...).
- Updates: shows the version, checks for a new one. Nothing installs without your click.

The settings file is `%APPDATA%\SC-overlay\layouts.json`. A broken file is copied to a `.bak` file before it is replaced.

## Environment variables

| Variable | Effect |
| --- | --- |
| `SC_OVERLAY_HOTKEY`, `SC_OVERLAY_PALETTE_KEY`, `SC_OVERLAY_PROFILE_KEY`, `SC_OVERLAY_WIDGETS_KEY` | Default hotkeys, for example `Alt+K`. A hotkey set in Settings wins. |
| `SC_OVERLAY_ALWAYS_SHOW` | `1`: show the overlay even when the game is not in front. |
| `SC_OVERLAY_DEBUG` | `1`: write a key log to `%TEMP%\sc-overlay-keys.log`. |
| `SC_SERVICE_EXE`, `SC_SERVICE_ARGS` | Use another service executable (development). |

## Build

You need Rust, Node.js and the Python build environment of SC-hauling (`.venv-build`, see its README). SC-hauling sits next to this folder.

1. Build the service and copy it where Tauri expects it:

   ```
   powershell -ExecutionPolicy Bypass -File scripts/prepare-sidecar.ps1
   ```

2. Build the installer:

   ```
   cd src-tauri
   npx --yes @tauri-apps/cli@2 build
   ```

   The installer is in `src-tauri/target/release/bundle/nsis`.

Tests:

```
cd src-tauri && cargo test
node --test tests/*.test.mjs
```

## Release

Updates come from the GitHub releases. The installer is signed with a key you keep outside the repository.

1. Raise the version in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` (they must match).
2. Run `powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Notes "What changed."`. It asks for the key password.
3. Create a release tagged `v<version>` and upload `SC-overlay_<version>_x64-setup.exe`, its `.sig` file and `latest.json`.

The key file is never committed (`*.key` is ignored). If you lose it, installed copies cannot update any more.

## Project layout

- `ui/`: the interface (plain ES modules, no build step).
- `src-tauri/`: the Tauri 2 shell: window, hotkeys, service launch, settings file, updater.
- `scripts/`: sidecar preparation and release.
- `tests/`: JavaScript tests.
- `fake-sidecar/`: a fake service for working on the interface without the game.
- `PLAN.md`, `PLAN-6.md`: roadmap and packaging notes.

## Limits

- Windows only.
- The exe is not signed by a publisher, so SmartScreen warns.
- A PyInstaller service can trigger antivirus false positives.
