//! Which window is in front (read-only), and the capture exclusion of our own window.
//!
//! Only looks at windows: nothing here opens, reads or writes the game process
//! beyond asking for its image name (PROCESS_QUERY_LIMITED_INFORMATION).

pub const GAME_EXE: &str = "starcitizen.exe";

/// Lower-case file name of a path, with either kind of separator.
pub fn exe_name(path: &str) -> String {
    path.rsplit(['\\', '/']).next().unwrap_or("").to_lowercase()
}

pub fn is_game_exe(path: &str) -> bool {
    exe_name(path) == GAME_EXE
}

#[cfg(windows)]
mod ffi {
    #[link(name = "user32")]
    extern "system" {
        pub fn GetForegroundWindow() -> isize;
        pub fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
        pub fn SetForegroundWindow(hwnd: isize) -> i32;
        pub fn IsWindow(hwnd: isize) -> i32;
        pub fn SetWindowDisplayAffinity(hwnd: isize, affinity: u32) -> i32;
        pub fn GetAsyncKeyState(vk: i32) -> i16;
    }
    #[link(name = "kernel32")]
    extern "system" {
        pub fn OpenProcess(access: u32, inherit: i32, pid: u32) -> isize;
        pub fn CloseHandle(handle: isize) -> i32;
        pub fn QueryFullProcessImageNameW(handle: isize, flags: u32, name: *mut u16, size: *mut u32) -> i32;
    }
}

#[cfg(windows)]
const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
#[cfg(windows)]
const WDA_EXCLUDEFROMCAPTURE: u32 = 0x11;

/// The foreground window, its process id and the path of its executable (empty when unreadable).
#[cfg(windows)]
pub fn foreground() -> Option<(isize, u32, String)> {
    unsafe {
        let hwnd = ffi::GetForegroundWindow();
        if hwnd == 0 {
            return None;
        }
        let mut pid = 0u32;
        ffi::GetWindowThreadProcessId(hwnd, &mut pid);
        let handle = ffi::OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle == 0 {
            return Some((hwnd, pid, String::new()));
        }
        let mut buf = [0u16; 1024];
        let mut size = buf.len() as u32;
        let ok = ffi::QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
        ffi::CloseHandle(handle);
        let path = if ok != 0 { String::from_utf16_lossy(&buf[..size as usize]) } else { String::new() };
        Some((hwnd, pid, path))
    }
}

/// Hand the focus back to a window (the game, when we leave interaction mode).
#[cfg(windows)]
pub fn restore_focus(hwnd: isize) -> bool {
    unsafe { hwnd != 0 && ffi::IsWindow(hwnd) != 0 && ffi::SetForegroundWindow(hwnd) != 0 }
}

/// Keep our window out of screenshots, so the service's OCR never sees the overlay.
#[cfg(windows)]
pub fn exclude_from_capture(hwnd: isize) -> bool {
    unsafe { hwnd != 0 && ffi::SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) != 0 }
}

/// Is this key held right now (virtual-key code)? The keyboard state, whichever window has the focus.
#[cfg(windows)]
pub fn key_down(vk: i32) -> bool {
    unsafe { (ffi::GetAsyncKeyState(vk) as u16) & 0x8000 != 0 }
}

#[cfg(not(windows))]
pub fn key_down(_vk: i32) -> bool {
    false
}

#[cfg(not(windows))]
pub fn foreground() -> Option<(isize, u32, String)> {
    None
}
#[cfg(not(windows))]
pub fn restore_focus(_hwnd: isize) -> bool {
    false
}
#[cfg(not(windows))]
pub fn exclude_from_capture(_hwnd: isize) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_from_paths() {
        assert_eq!(exe_name(r"C:\Games\RSI\StarCitizen\LIVE\Bin64\StarCitizen.exe"), "starcitizen.exe");
        assert_eq!(exe_name("D:/x/StarCitizen.EXE"), "starcitizen.exe");
        assert_eq!(exe_name(""), "");
    }

    #[test]
    fn only_the_game_counts() {
        assert!(is_game_exe(r"C:\x\StarCitizen.exe"));
        assert!(!is_game_exe(r"C:\x\RSI Launcher.exe"));
        assert!(!is_game_exe(r"C:\x\StarCitizen.exe.bak"));
        assert!(!is_game_exe(""));
    }
}
