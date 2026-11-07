//! The hauling engine as a child process: free port, random token, killed with the window.
//!
//! The token goes to the child by environment variable (SC_OVERLAY_TOKEN), never on the
//! command line, so it does not show in the process list.

use serde::Serialize;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

pub const SERVICE_EXE: &str = "schauling-service.exe";

/// What the front needs to talk to the service.
#[derive(Clone, Serialize, Debug)]
pub struct ServiceInfo {
    pub port: u16,
    pub token: String,
    pub error: Option<String>,
}

pub struct Sidecar {
    pub info: ServiceInfo,
    child: Mutex<Option<Child>>,
}

impl Sidecar {
    pub fn failed(message: String) -> Sidecar {
        Sidecar { info: ServiceInfo { port: 0, token: String::new(), error: Some(message) }, child: Mutex::new(None) }
    }

    pub fn kill(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            // The PyInstaller onefile exe is two processes (bootloader, then the real service):
            // killing the first alone leaves the second running, with the exe locked and the port taken.
            kill_tree(child.id());
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// Some(message) when the service already stopped (crash, port taken).
    pub fn exited(&self) -> Option<String> {
        let mut guard = self.child.lock().unwrap();
        let child = guard.as_mut()?;
        match child.try_wait() {
            Ok(Some(status)) => Some(format!("service stopped ({status})")),
            _ => None,
        }
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        self.kill();
    }
}

/// A port nobody listens on right now (the service binds it a moment later).
pub fn free_port() -> std::io::Result<u16> {
    Ok(TcpListener::bind(("127.0.0.1", 0))?.local_addr()?.port())
}

#[cfg(windows)]
#[link(name = "bcrypt")]
extern "system" {
    fn BCryptGenRandom(algorithm: *mut core::ffi::c_void, buffer: *mut u8, len: u32, flags: u32) -> i32;
}

/// 32 random bytes from the system generator, as 64 hex digits.
#[cfg(windows)]
pub fn random_token() -> Result<String, String> {
    const USE_SYSTEM_PREFERRED_RNG: u32 = 2;
    let mut bytes = [0u8; 32];
    let status = unsafe { BCryptGenRandom(std::ptr::null_mut(), bytes.as_mut_ptr(), 32, USE_SYSTEM_PREFERRED_RNG) };
    if status != 0 {
        return Err(format!("no random numbers (BCryptGenRandom {status:#x})"));
    }
    Ok(hex(&bytes))
}

#[cfg(not(windows))]
pub fn random_token() -> Result<String, String> {
    Err("random token: Windows only".into())
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Arguments after the program: the optional prefix (a script for the fake service), then the options.
/// No token here.
pub fn service_args(prefix: &[String], port: u16, parent_pid: u32) -> Vec<String> {
    let mut args = prefix.to_vec();
    args.extend(["--service".into(), "--port".into(), port.to_string(), "--parent-pid".into(), parent_pid.to_string()]);
    args
}

/// SC_SERVICE_EXE (+ SC_SERVICE_ARGS, split on spaces) for development, else next to our exe.
pub fn locate(env_exe: Option<String>, env_args: Option<String>, own_dir: Option<&Path>) -> Result<(PathBuf, Vec<String>), String> {
    if let Some(exe) = env_exe.filter(|e| !e.trim().is_empty()) {
        let prefix = env_args.map(|a| a.split_whitespace().map(String::from).collect()).unwrap_or_default();
        return Ok((PathBuf::from(exe), prefix));
    }
    if let Some(dir) = own_dir {
        let beside = dir.join(SERVICE_EXE);
        if beside.is_file() {
            return Ok((beside, Vec::new()));
        }
    }
    Err(format!("{SERVICE_EXE} not found next to the overlay (dev: set SC_SERVICE_EXE)"))
}

#[cfg(windows)]
fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}
#[cfg(not(windows))]
fn hide_console(_cmd: &mut Command) {}

#[cfg(windows)]
fn kill_tree(pid: u32) {
    let mut cmd = Command::new("taskkill");
    cmd.args(["/T", "/F", "/PID", &pid.to_string()]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    hide_console(&mut cmd);
    let _ = cmd.status();
}
#[cfg(not(windows))]
fn kill_tree(_pid: u32) {}

pub fn start() -> Sidecar {
    match try_start() {
        Ok(s) => s,
        Err(message) => Sidecar::failed(message),
    }
}

fn try_start() -> Result<Sidecar, String> {
    let own_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf));
    let (exe, prefix) = locate(std::env::var("SC_SERVICE_EXE").ok(), std::env::var("SC_SERVICE_ARGS").ok(), own_dir.as_deref())?;
    let port = free_port().map_err(|e| format!("no free port: {e}"))?;
    let token = random_token()?;
    let mut cmd = Command::new(&exe);
    cmd.args(service_args(&prefix, port, std::process::id()))
        .env("SC_OVERLAY_TOKEN", &token)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_console(&mut cmd);
    let child = cmd.spawn().map_err(|e| format!("cannot start {}: {e}", exe.display()))?;
    Ok(Sidecar { info: ServiceInfo { port, token, error: None }, child: Mutex::new(Some(child)) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_hold_no_token() {
        let args = service_args(&["fake.py".into()], 4242, 99);
        assert_eq!(args, ["fake.py", "--service", "--port", "4242", "--parent-pid", "99"]);
    }

    #[test]
    fn a_free_port_can_be_bound() {
        let port = free_port().unwrap();
        assert!(port > 0);
        TcpListener::bind(("127.0.0.1", port)).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn tokens_are_64_hex_and_differ() {
        let a = random_token().unwrap();
        let b = random_token().unwrap();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn hex_pads() {
        assert_eq!(hex(&[0, 15, 255]), "000fff");
    }

    #[test]
    fn locate_prefers_the_environment() {
        let (exe, prefix) = locate(Some("python".into()), Some("a.py  --x".into()), None).unwrap();
        assert_eq!(exe, PathBuf::from("python"));
        assert_eq!(prefix, ["a.py", "--x"]);
    }

    #[test]
    fn locate_fails_with_a_message() {
        let err = locate(None, None, Some(Path::new("Z:/nowhere"))).unwrap_err();
        assert!(err.contains(SERVICE_EXE));
        assert!(locate(Some("  ".into()), None, None).is_err());
    }

    #[test]
    fn a_failed_sidecar_carries_its_error() {
        let s = Sidecar::failed("boom".into());
        assert_eq!(s.info.error.as_deref(), Some("boom"));
        s.kill(); // nothing to kill, no panic
    }
}
