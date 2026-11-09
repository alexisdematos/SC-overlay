pub mod game;
pub mod keyboard;
pub mod modes;
pub mod settings;
pub mod sidecar;

use modes::{overlay_visible, Mode};
use sidecar::{ServiceInfo, Sidecar};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const GAME_CHECK: Duration = Duration::from_millis(400);

/// The site the map widget shows. SC_MAP_URL replaces it (development: the local SC-map server; the CSP lists both).
const DEFAULT_MAP_URL: &str = "https://versetime.ofs.workers.dev";
/// The VerseTime API (shop prices for the buy reminder). SC_API_URL replaces it; the CSP lists the default only.
const DEFAULT_API_URL: &str = "https://versetime-api.ofs.workers.dev";

/// An http(s) address from the environment, else the default.
pub fn resolve_url(env: Option<String>, default: &str) -> String {
    match env.map(|v| v.trim().to_string()) {
        Some(v) if v.starts_with("https://") || v.starts_with("http://") => v,
        _ => default.to_string(),
    }
}

const DEFAULT_TOGGLE_KEY: &str = "Alt+O";
const DEFAULT_PALETTE_KEY: &str = "Alt+P";

/// A shortcut from the environment ("Alt+O", "Ctrl+Shift+F9"), else the default. Returns the shortcut, its label for
/// the screen, and why the environment value was refused (None when it was fine or unset).
pub fn resolve_shortcut(env: Option<String>, default: &str) -> (Shortcut, String, Option<String>) {
    let fallback = Shortcut::from_str(default).expect("the default shortcut parses");
    match env.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) {
        None => (fallback, default.to_string(), None),
        Some(text) => match Shortcut::from_str(&text) {
            Ok(shortcut) => (shortcut, text, None),
            Err(e) => (fallback, default.to_string(), Some(format!("{text:?} is not a shortcut ({e}): using {default}"))),
        },
    }
}

const DEFAULT_PROFILE_KEY: &str = "Alt+I";
const DEFAULT_WIDGETS_KEY: &str = "Alt+U";

/// The three shortcuts [mode toggle, search, next profile]: each from the "hotkeys" of the settings file (what the
/// player set in Settings), else from its environment variable, else its default. A shortcut already taken by an
/// earlier one goes back to its default.
/// Returns them with their labels and the warnings for the screen.
pub fn resolve_keys(envs: [Option<String>; 4], file: &str) -> (Vec<(Shortcut, String)>, Vec<String>) {
    let names = [
        ("toggle", DEFAULT_TOGGLE_KEY),
        ("palette", DEFAULT_PALETTE_KEY),
        ("profile", DEFAULT_PROFILE_KEY),
        ("widgets", DEFAULT_WIDGETS_KEY),
    ];
    let mut keys: Vec<(Shortcut, String)> = Vec::new();
    let mut warnings = Vec::new();
    for (env, (name, default)) in envs.into_iter().zip(names) {
        let wanted = settings::hotkey(file, name).or_else(|| env.filter(|v| !v.trim().is_empty()));
        let (mut shortcut, mut label, error) = resolve_shortcut(wanted, default);
        warnings.extend(error);
        if keys.iter().any(|(s, _)| *s == shortcut) {
            warnings.push(format!("{label} is used twice: {name} goes back to {default}"));
            let (s, l, _) = resolve_shortcut(None, default);
            (shortcut, label) = (s, l);
            if keys.iter().any(|(s, _)| *s == shortcut) {
                warnings.push(format!("{label} ({name}) is also used by another shortcut: change one of them"));
            }
        }
        keys.push((shortcut, label));
    }
    (keys, warnings)
}

pub struct AppState {
    mode: Mutex<Mode>,
    /// Show even without the game in front (development: SC_OVERLAY_ALWAYS_SHOW=1).
    always_show: AtomicBool,
    game_in_front: AtomicBool,
    visible: AtomicBool,
    /// Last foreground window of the game: it gets the focus back when we leave interaction mode.
    game_hwnd: AtomicIsize,
    /// Problems found at start, before the page can listen: it asks for them (`get_warnings`).
    warnings: Mutex<Vec<String>>,
    /// The shortcuts [mode toggle, search, next profile] with the label the screen shows. The registered-shortcut
    /// handler and the keyboard poll read them at each event, so a change applies at once.
    keys: Mutex<Vec<(Shortcut, String)>>,
    /// Set while the settings page captures a key: the shortcuts are unregistered (the system would take the
    /// keys before the page) and nothing fires. It ends by itself after PAUSE_MAX.
    paused: Mutex<Option<Instant>>,
    /// Blur the game behind the overlay outside the game mode (Windows acrylic); the settings page sets it.
    blur: AtomicBool,
    /// The last shortcut that fired and when: the registered shortcut and the keyboard poll may both see one press.
    last_fired: Mutex<Option<(Action, Instant)>>,
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Action {
    Toggle,
    Palette,
    Profile,
    Widgets,
}

const DEBOUNCE: Duration = Duration::from_millis(350);
const KEY_POLL: Duration = Duration::from_millis(25);
const PAUSE_MAX: Duration = Duration::from_secs(15);
const ACTIONS: [Action; 4] = [Action::Toggle, Action::Palette, Action::Profile, Action::Widgets];
const KEY_WORDS: [&str; 4] = ["", " (search)", " (profile)", " (widgets)"];

fn register_all(app: &AppHandle, keys: &[(Shortcut, String)]) -> Vec<String> {
    let mut errors = Vec::new();
    for ((shortcut, label), word) in keys.iter().zip(KEY_WORDS) {
        if let Err(e) = app.global_shortcut().register(*shortcut) {
            errors.push(format!("{label}{word} is not available ({e}): another program uses it"));
        }
    }
    errors
}

fn unregister_all(app: &AppHandle, keys: &[(Shortcut, String)]) {
    for (shortcut, _) in keys {
        let _ = app.global_shortcut().unregister(*shortcut);
    }
}

/// Pause (unregister the shortcuts and fire nothing) or resume them. Pausing again renews the time.
fn set_paused(app: &AppHandle, paused: bool) {
    // No lock is held while the system is asked: its handler runs on the main thread and takes the same locks.
    let state = app.state::<AppState>();
    let was_paused = {
        let mut guard = state.paused.lock().unwrap();
        let was = guard.is_some();
        *guard = paused.then(Instant::now);
        was
    };
    let keys = state.keys.lock().unwrap().clone();
    if paused && !was_paused {
        unregister_all(app, &keys);
    } else if !paused && was_paused {
        for error in register_all(app, &keys) {
            warn(app, &error);
        }
    }
}

/// A page that never said "resume" (it closed, reloaded, crashed): the shortcuts come back by themselves.
fn resume_if_stale(app: &AppHandle) {
    let stale = matches!(*app.state::<AppState>().paused.lock().unwrap(), Some(at) if at.elapsed() > PAUSE_MAX);
    if stale {
        set_paused(app, false);
    }
}

/// The shortcuts the player chose, checked: each parses and is acceptable, and the three differ.
fn check_keys(texts: [&str; 4]) -> Result<Vec<(Shortcut, String)>, String> {
    let names = ["mode", "search", "profile", "widgets"];
    let mut keys: Vec<(Shortcut, String)> = Vec::new();
    for (text, name) in texts.into_iter().zip(names) {
        let text = text.trim();
        let shortcut = Shortcut::from_str(text).map_err(|e| format!("{name}: {text:?} is not a shortcut ({e})"))?;
        keyboard::acceptable(&shortcut).map_err(|why| format!("{name}: {text}: {why}"))?;
        if let Some((_, other)) = keys.iter().find(|(s, _)| *s == shortcut) {
            return Err(format!("{name}: {text} is already used by {other}"));
        }
        keys.push((shortcut, text.to_string()));
    }
    Ok(keys)
}

/// What a shortcut does. A press seen twice within DEBOUNCE (both ways of listening) counts once.
fn fire(app: &AppHandle, action: Action) {
    if app.state::<AppState>().paused.lock().unwrap().is_some() {
        return;
    }
    {
        let state = app.state::<AppState>();
        let mut last = state.last_fired.lock().unwrap();
        if matches!(*last, Some((a, at)) if a == action && at.elapsed() < DEBOUNCE) {
            debug_log(&format!("{action:?}: ignored (already fired within {DEBOUNCE:?})"));
            return;
        }
        *last = Some((action, Instant::now()));
    }
    match action {
        Action::Toggle => {
            let next = app.state::<AppState>().mode.lock().unwrap().on_hotkey();
            debug_log(&format!("Toggle: mode becomes {next:?}"));
            apply_mode(app, next);
        }
        Action::Palette => {
            // The search bar needs the keyboard: the mouse mode, then the page opens (or closes) it.
            let mode = *app.state::<AppState>().mode.lock().unwrap();
            if mode.click_through() {
                apply_mode(app, Mode::Interaction);
            }
            let _ = app.emit("palette", ());
        }
        Action::Profile => {
            let _ = app.emit("profile-next", ());
        }
        Action::Widgets => {
            // What the game mode shows (pinned, all of the profile, none): the page keeps the state.
            let _ = app.emit("widgets-cycle", ());
        }
    }
}

/// Watch the keyboard state for the two combinations (see keyboard.rs): they also work while the game has the focus.
fn poll_keyboard(app: AppHandle) {
    let debug = debug_on();
    std::thread::spawn(move || {
        let mut edges: Vec<keyboard::Edge> = ACTIONS.iter().map(|_| keyboard::Edge::default()).collect();
        let mut main_edges: Vec<keyboard::Edge> = ACTIONS.iter().map(|_| keyboard::Edge::default()).collect();
        loop {
            std::thread::sleep(KEY_POLL);
            resume_if_stale(&app);
            // The shortcuts as they are now (the settings page may have changed them).
            let current: Vec<Shortcut> = app.state::<AppState>().keys.lock().unwrap().iter().map(|(s, _)| *s).collect();
            for (i, shortcut) in current.iter().enumerate() {
                let Some(keys) = keyboard::chord(shortcut) else { continue };
                let action = &ACTIONS[i];
                if debug {
                    // Only the main key of each shortcut is logged (never other keys), with the modifiers state.
                    let main = *keys.last().unwrap();
                    if main_edges[i].rose(game::key_down(main)) {
                        let mods: Vec<String> = keys[..keys.len() - 1].iter().map(|&vk| format!("{vk:#x}={}", game::key_down(vk))).collect();
                        let fg = game::foreground().map(|(_, pid, exe)| format!("pid {pid} {exe}")).unwrap_or_default();
                        debug_log(&format!("{action:?}: key {main:#x} down, mods [{}], foreground {fg}", mods.join(" ")));
                    }
                }
                if edges[i].rose(keys.iter().all(|&vk| game::key_down(vk))) {
                    if debug {
                        debug_log(&format!("{action:?}: combination seen by polling, firing"));
                    }
                    fire(&app, *action);
                }
            }
        }
    });
}

fn debug_on() -> bool {
    std::env::var("SC_OVERLAY_DEBUG").is_ok_and(|v| !v.is_empty() && v != "0")
}

/// Append a line to sc-overlay-keys.log in the temp folder (SC_OVERLAY_DEBUG=1 only).
fn debug_log(text: &str) {
    use std::io::Write;
    if !debug_on() {
        return;
    }
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(std::env::temp_dir().join("sc-overlay-keys.log")) {
        let _ = writeln!(f, "{secs} {text}");
    }
}

fn main_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("main")
}

fn warn(app: &AppHandle, text: &str) {
    eprintln!("overlay: {text}");
    app.state::<AppState>().warnings.lock().unwrap().push(text.to_string());
    let _ = app.emit("warning", text);
}

/// Show or hide the window to match the mode and the game; tell the front when the game state changed.
fn refresh_visibility(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mode = *state.mode.lock().unwrap();
    let want = overlay_visible(mode, state.game_in_front.load(Ordering::Relaxed), state.always_show.load(Ordering::Relaxed));
    if state.visible.swap(want, Ordering::Relaxed) != want {
        if let Some(w) = main_window(app) {
            let _ = if want { w.show() } else { w.hide() };
        }
    }
}

/// Blur what is behind the window while it is not in game mode (and the player wants it).
#[cfg(windows)]
fn set_blur(w: &tauri::WebviewWindow, on: bool) {
    use tauri::window::{Color, Effect, EffectsBuilder};
    let effects = on.then(|| EffectsBuilder::new().effect(Effect::Acrylic).color(Color(8, 12, 20, 60)).build());
    if let Err(e) = w.set_effects(effects) {
        debug_log(&format!("blur {on}: {e}"));
    }
}

#[cfg(not(windows))]
fn set_blur(_w: &tauri::WebviewWindow, _on: bool) {}

fn apply_blur(app: &AppHandle) {
    let state = app.state::<AppState>();
    let on = state.blur.load(Ordering::Relaxed) && !state.mode.lock().unwrap().click_through();
    if let Some(w) = main_window(app) {
        set_blur(&w, on);
    }
}

fn apply_mode(app: &AppHandle, mode: Mode) {
    let state = app.state::<AppState>();
    let previous = std::mem::replace(&mut *state.mode.lock().unwrap(), mode);
    apply_blur(app);
    if let Some(w) = main_window(app) {
        let _ = w.set_ignore_cursor_events(mode.click_through());
        if !mode.click_through() {
            let _ = w.show();
            let _ = w.set_focus();
        } else if !previous.click_through() && game::restore_focus(state.game_hwnd.load(Ordering::Relaxed)) {
            // the game has the focus again: do not hide for a tick until the watcher notices
            state.game_in_front.store(true, Ordering::Relaxed);
        }
    }
    let _ = app.emit("mode", mode);
    refresh_visibility(app);
}

/// Mode change that does not touch the focus (someone else already has it).
fn apply_mode_without_focus(app: &AppHandle, mode: Mode) {
    let state = app.state::<AppState>();
    *state.mode.lock().unwrap() = mode;
    apply_blur(app);
    if let Some(w) = main_window(app) {
        let _ = w.set_ignore_cursor_events(mode.click_through());
    }
    let _ = app.emit("mode", mode);
    refresh_visibility(app);
}

fn watch_game(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last = None;
        let mut stray_ticks = 0u32;
        loop {
            let state = app.state::<AppState>();
            let front = game::foreground();
            let in_front = match &front {
                Some((hwnd, _, path)) if game::is_game_exe(path) => {
                    state.game_hwnd.store(*hwnd, Ordering::Relaxed);
                    true
                }
                _ => false,
            };
            // Interaction mode while another program is in front (alt-tab, game crash): the overlay
            // would sit on the desktop and catch clicks. Back to game mode after a short grace.
            let ours = matches!(&front, Some((_, pid, _)) if *pid == std::process::id());
            let mode = *state.mode.lock().unwrap();
            if mode != Mode::Game && !ours && front.is_some() {
                stray_ticks += 1;
                if stray_ticks >= 3 {
                    stray_ticks = 0;
                    state.game_in_front.store(in_front, Ordering::Relaxed);
                    apply_mode_without_focus(&app, Mode::Game);
                }
            } else {
                stray_ticks = 0;
            }
            state.game_in_front.store(in_front, Ordering::Relaxed);
            if last != Some(in_front) {
                last = Some(in_front);
                let _ = app.emit("game", in_front);
            }
            refresh_visibility(&app);
            std::thread::sleep(GAME_CHECK);
        }
    });
}

#[tauri::command]
fn service_info(app: AppHandle) -> ServiceInfo {
    // Managed in setup: a page that asks before that gets an error it can show, not a panic.
    let Some(sidecar) = app.try_state::<Sidecar>() else {
        return ServiceInfo { port: 0, token: String::new(), error: Some("starting".into()) };
    };
    let mut info = sidecar.info.clone();
    if info.error.is_none() {
        info.error = sidecar.exited();
    }
    info
}

#[tauri::command]
fn map_url() -> String {
    resolve_url(std::env::var("SC_MAP_URL").ok(), DEFAULT_MAP_URL)
}

#[tauri::command]
fn api_url() -> String {
    resolve_url(std::env::var("SC_API_URL").ok(), DEFAULT_API_URL)
}

#[tauri::command]
fn get_warnings(state: tauri::State<AppState>) -> Vec<String> {
    state.warnings.lock().unwrap().clone()
}

#[tauri::command]
fn get_mode(state: tauri::State<AppState>) -> Mode {
    *state.mode.lock().unwrap()
}

#[tauri::command]
fn set_mode(app: AppHandle, mode: String) -> Result<(), String> {
    let mode = Mode::parse(&mode).ok_or_else(|| format!("unknown mode: {mode}"))?;
    apply_mode(&app, mode);
    Ok(())
}

#[tauri::command]
fn shortcut_labels(state: tauri::State<AppState>) -> Vec<String> {
    state.keys.lock().unwrap().iter().map(|(_, label)| label.clone()).collect()
}

/// The player turns the blur behind the overlay on or off (Settings).
#[tauri::command]
fn set_blur_enabled(app: AppHandle, enabled: bool) {
    app.state::<AppState>().blur.store(enabled, Ordering::Relaxed);
    apply_blur(&app);
}

#[tauri::command]
fn pause_hotkeys(app: AppHandle, paused: bool) {
    debug_log(&format!("pause_hotkeys({paused})"));
    set_paused(&app, paused);
}

/// Use these three shortcuts now. On an error the previous ones stay (their labels come from `shortcut_labels`).
/// The page writes them in the settings file when this succeeds.
#[tauri::command]
fn set_hotkeys(app: AppHandle, toggle: String, palette: String, profile: String, widgets: String) -> Result<Vec<String>, String> {
    debug_log(&format!("set_hotkeys({toggle:?}, {palette:?}, {profile:?}, {widgets:?})"));
    let new = check_keys([&toggle, &palette, &profile, &widgets]).inspect_err(|e| debug_log(&format!("set_hotkeys refused: {e}")))?;
    let state = app.state::<AppState>();
    let paused = state.paused.lock().unwrap().is_some();
    let old = state.keys.lock().unwrap().clone();
    // While paused nothing is registered: the new ones are when the pause ends. No lock is held while the system is asked.
    if !paused {
        unregister_all(&app, &old);
        let failed = register_all(&app, &new);
        if !failed.is_empty() {
            unregister_all(&app, &new);
            let back = register_all(&app, &old);
            let mut message = failed.join("; ");
            if !back.is_empty() {
                message.push_str(&format!("; the previous shortcuts could not be restored: {}", back.join("; ")));
            }
            return Err(message);
        }
    }
    let labels = new.iter().map(|(_, label)| label.clone()).collect();
    *state.keys.lock().unwrap() = new;
    Ok(labels)
}

#[tauri::command]
fn load_settings() -> String {
    settings::read()
}

#[tauri::command]
fn save_settings(text: String) -> Result<(), String> {
    settings::write(&text)
}

#[tauri::command]
fn backup_settings() -> Result<String, String> {
    settings::backup()
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Updates need a `plugins.updater` block (signing public key, endpoints) in tauri.conf.json: a build without one has none.
fn updater_configured(app: &AppHandle) -> bool {
    app.config().plugins.0.contains_key("updater")
}

#[derive(serde::Serialize)]
struct UpdateInfo {
    current: String,
    version: String,
    notes: Option<String>,
}

#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// Asks the release feed for a newer version. Nothing is downloaded.
#[tauri::command]
async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    use tauri_plugin_updater::UpdaterExt;
    if !updater_configured(&app) {
        return Err("Updates are not set up in this build".into());
    }
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|u| UpdateInfo { current: u.current_version.clone(), version: u.version.clone(), notes: u.body.clone() }))
}

/// Downloads and checks the signature with the service still running, then stops the service (whole process tree,
/// its exe would be locked) and starts the installer, which closes the app. On a failure the app restarts.
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    if !updater_configured(&app) {
        return Err("Updates are not set up in this build".into());
    }
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Already up to date".to_string())?;
    let bytes = update.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    if let Some(sidecar) = app.try_state::<Sidecar>() {
        sidecar.kill();
    }
    if update.install(&bytes).is_err() {
        app.restart(); // a new service starts with the app
    }
    Ok(())
}

/// An icon in the notification area: the overlay has no taskbar button, this shows it is running.
/// Left click switches game / interaction (like the hotkey), the menu has the same and Quit.
fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let toggle = MenuItem::with_id(app, "toggle", "Switch game / interaction", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit SC-overlay", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("SC-overlay")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" => fire(app, Action::Toggle),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                fire(tray.app_handle(), Action::Toggle);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn setup_window(app: &AppHandle) {
    let Some(w) = main_window(app) else { return };
    // Cover the primary monitor (the game runs borderless on it).
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let size = monitor.size();
        let pos = monitor.position();
        let _ = w.set_size(PhysicalSize::new(size.width, size.height));
        let _ = w.set_position(PhysicalPosition::new(pos.x, pos.y));
    }
    let _ = w.set_ignore_cursor_events(true);
    match w.hwnd() {
        Ok(hwnd) => {
            if !game::exclude_from_capture(hwnd.0 as isize) {
                warn(app, "Overlay may appear in screenshots (capture exclusion refused)");
            }
        }
        Err(e) => warn(app, &format!("no window handle: {e}")),
    }
}

pub fn run() {
    // The shortcuts the player set in Settings ("hotkeys" in the settings file) win; without one, SC_OVERLAY_HOTKEY,
    // SC_OVERLAY_PALETTE_KEY and SC_OVERLAY_PROFILE_KEY (a game may keep Alt+letter for itself). Read once, at start.
    let (keys, key_warnings) = resolve_keys(
        [
            std::env::var("SC_OVERLAY_HOTKEY").ok(),
            std::env::var("SC_OVERLAY_PALETTE_KEY").ok(),
            std::env::var("SC_OVERLAY_PROFILE_KEY").ok(),
            std::env::var("SC_OVERLAY_WIDGETS_KEY").ok(),
        ],
        &settings::read(),
    );
    let state = AppState {
        mode: Mutex::new(Mode::Game),
        always_show: AtomicBool::new(std::env::var("SC_OVERLAY_ALWAYS_SHOW").map(|v| v == "1").unwrap_or(false)),
        game_in_front: AtomicBool::new(false),
        visible: AtomicBool::new(true),
        game_hwnd: AtomicIsize::new(0),
        warnings: Mutex::new(key_warnings),
        keys: Mutex::new(keys),
        paused: Mutex::new(None),
        blur: AtomicBool::new(true),
        last_fired: Mutex::new(None),
    };

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = main_window(app) {
                let _ = w.show();
                app.state::<AppState>().visible.store(true, Ordering::Relaxed);
            }
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    debug_log(&format!("registered shortcut received: {shortcut:?}"));
                    let index = app.state::<AppState>().keys.lock().unwrap().iter().position(|(s, _)| s == shortcut);
                    if let Some(i) = index {
                        fire(app, ACTIONS[i]);
                    }
                })
                .build(),
        )
        .manage(state)
        .invoke_handler(tauri::generate_handler![service_info, map_url, api_url, get_warnings, get_mode, set_mode, shortcut_labels, set_blur_enabled, pause_hotkeys, set_hotkeys, load_settings, save_settings, backup_settings, quit_app, app_version, check_update, install_update])
        .setup(move |app| {
            let handle = app.handle().clone();
            // The plugin fails to start without its config block: only add it when the build has one.
            if updater_configured(&handle) {
                handle.plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            // After the single-instance check: a second launch must not leave a service behind.
            app.manage(sidecar::start());
            setup_window(&handle);
            if let Err(e) = setup_tray(&handle) {
                warn(&handle, &format!("no tray icon: {e}"));
            }
            let keys = app.state::<AppState>().keys.lock().unwrap().clone();
            for error in register_all(&handle, &keys) {
                warn(&handle, &error);
            }
            poll_keyboard(handle.clone());
            watch_game(handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the overlay");

    app.run(|app, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(sidecar) = app.try_state::<Sidecar>() {
                sidecar.kill();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_default_and_override() {
        assert_eq!(resolve_url(None, DEFAULT_MAP_URL), DEFAULT_MAP_URL);
        assert_eq!(resolve_url(Some("".into()), DEFAULT_API_URL), DEFAULT_API_URL);
        assert_eq!(resolve_url(Some("javascript:alert(1)".into()), DEFAULT_MAP_URL), DEFAULT_MAP_URL);
        assert_eq!(resolve_url(Some(" http://127.0.0.1:8093 ".into()), DEFAULT_MAP_URL), "http://127.0.0.1:8093");
    }

    #[test]
    fn shortcuts_default_and_override() {
        use tauri_plugin_global_shortcut::{Code, Modifiers};
        let (s, label, error) = resolve_shortcut(None, DEFAULT_TOGGLE_KEY);
        assert_eq!((s, label.as_str(), error), (Shortcut::new(Some(Modifiers::ALT), Code::KeyO), "Alt+O", None));
        let (s, label, error) = resolve_shortcut(Some(" Ctrl+Shift+F9 ".into()), DEFAULT_PALETTE_KEY);
        assert_eq!((s, label.as_str(), error), (Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::F9), "Ctrl+Shift+F9", None));
        // Empty: the default, no complaint. Nonsense: the default, and the reason.
        assert!(resolve_shortcut(Some("  ".into()), DEFAULT_PALETTE_KEY).2.is_none());
        let (s, label, error) = resolve_shortcut(Some("Alt+Banana".into()), DEFAULT_PALETTE_KEY);
        assert_eq!((s, label.as_str()), (Shortcut::new(Some(Modifiers::ALT), Code::KeyP), "Alt+P"));
        assert!(error.unwrap().contains("Alt+Banana"));
    }

    #[test]
    fn keys_come_from_the_file_then_the_environment_then_the_defaults() {
        let labels = |(keys, _): &(Vec<(Shortcut, String)>, Vec<String>)| keys.iter().map(|(_, l)| l.clone()).collect::<Vec<_>>();
        let none = || [None, None, None, None];
        let file = r#"{"hotkeys":{"toggle":"Ctrl+F9","profile":"Alt+L"}}"#;
        assert_eq!(labels(&resolve_keys(none(), "")), ["Alt+O", "Alt+P", "Alt+I", "Alt+U"]);
        let from_file = resolve_keys(none(), file);
        assert_eq!(labels(&from_file), ["Ctrl+F9", "Alt+P", "Alt+L", "Alt+U"]);
        assert!(from_file.1.is_empty());
        // What the player set in Settings wins over a variable left in the session; the variable fills the gaps.
        let env = resolve_keys([Some("Ctrl+F10".into()), Some("Alt+K".into()), None, Some("Alt+J".into())], file);
        assert_eq!(labels(&env), ["Ctrl+F9", "Alt+K", "Alt+L", "Alt+J"]);
        assert_eq!(labels(&resolve_keys([Some("Ctrl+F10".into()), None, None, None], "")), ["Ctrl+F10", "Alt+P", "Alt+I", "Alt+U"]);
    }

    #[test]
    fn a_shortcut_used_twice_goes_back_to_its_default_with_a_warning() {
        let file = r#"{"hotkeys":{"toggle":"Alt+L","profile":"Alt+L"}}"#;
        let (keys, warnings) = resolve_keys([None, None, None, None], file);
        let labels: Vec<_> = keys.iter().map(|(_, l)| l.as_str()).collect();
        assert_eq!(labels, ["Alt+L", "Alt+P", "Alt+I", "Alt+U"]);
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("profile"));
    }
}
