//! The shortcuts, read a second way: the keyboard state.
//!
//! The registered global shortcuts (RegisterHotKey) did not reach the overlay while Star Citizen had the focus,
//! on the desktop they did. So the keyboard state is also read every few milliseconds (GetAsyncKeyState, the
//! same call any overlay or macro tool uses): a combination that goes down fires its action. Nothing is hooked
//! or injected, and nothing reads the game: it only asks Windows which keys are held.

use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

/// Virtual-key code of a key we can watch: letters, digits, F1 to F12. None for the others.
pub fn vk_for(code: Code) -> Option<i32> {
    let name = format!("{code:?}");
    if let Some(letter) = name.strip_prefix("Key").filter(|l| l.len() == 1) {
        return Some(letter.as_bytes()[0] as i32); // 'A'..'Z' are 0x41..0x5A
    }
    if let Some(digit) = name.strip_prefix("Digit").filter(|d| d.len() == 1) {
        return Some(digit.as_bytes()[0] as i32); // '0'..'9' are 0x30..0x39
    }
    if let Some(n) = name.strip_prefix('F').and_then(|n| n.parse::<i32>().ok()).filter(|n| (1..=12).contains(n)) {
        return Some(0x6F + n); // VK_F1 is 0x70
    }
    None
}

fn is_function_key(code: Code) -> bool {
    format!("{code:?}").strip_prefix('F').and_then(|n| n.parse::<i32>().ok()).is_some_and(|n| (1..=12).contains(&n))
}

/// A shortcut the player may choose: one that does not take a key away from typing. It needs a modifier, and Shift
/// alone is not enough, unless it is F1 to F12.
pub fn acceptable(shortcut: &Shortcut) -> Result<(), &'static str> {
    if is_function_key(shortcut.key) {
        return Ok(());
    }
    if shortcut.mods.is_empty() {
        return Err("needs Ctrl, Alt or Win with the key (only F1 to F12 can be alone)");
    }
    if shortcut.mods == Modifiers::SHIFT {
        return Err("Shift alone is not enough: add Ctrl or Alt");
    }
    Ok(())
}

/// Every key that must be down for the shortcut: its modifiers, then its key. None when the key is not watchable.
pub fn chord(shortcut: &Shortcut) -> Option<Vec<i32>> {
    let mut keys = Vec::new();
    for (flag, vk) in [(Modifiers::ALT, 0x12), (Modifiers::CONTROL, 0x11), (Modifiers::SHIFT, 0x10), (Modifiers::SUPER, 0x5B)] {
        if shortcut.mods.contains(flag) {
            keys.push(vk);
        }
    }
    keys.push(vk_for(shortcut.key)?);
    Some(keys)
}

/// Fires once when a combination goes from up to down, not for as long as it is held.
#[derive(Default)]
pub struct Edge {
    was_down: bool,
}

impl Edge {
    pub fn rose(&mut self, down: bool) -> bool {
        let rose = down && !self.was_down;
        self.was_down = down;
        rose
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_and_chords() {
        assert_eq!(vk_for(Code::KeyO), Some(0x4F));
        assert_eq!(vk_for(Code::Digit7), Some(0x37));
        assert_eq!(vk_for(Code::F1), Some(0x70));
        assert_eq!(vk_for(Code::F12), Some(0x7B));
        assert_eq!(vk_for(Code::F13), None);
        assert_eq!(vk_for(Code::Space), None);
        assert_eq!(chord(&Shortcut::new(Some(Modifiers::ALT), Code::KeyO)), Some(vec![0x12, 0x4F]));
        assert_eq!(
            chord(&Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::F9)),
            Some(vec![0x11, 0x10, 0x78])
        );
        assert_eq!(chord(&Shortcut::new(Some(Modifiers::ALT), Code::Space)), None);
    }

    #[test]
    fn a_chosen_shortcut_must_not_take_typing_away() {
        let s = |mods: Option<Modifiers>, code| Shortcut::new(mods, code);
        assert!(acceptable(&s(Some(Modifiers::ALT), Code::KeyO)).is_ok());
        assert!(acceptable(&s(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyO)).is_ok());
        assert!(acceptable(&s(None, Code::F9)).is_ok());
        assert!(acceptable(&s(None, Code::F12)).is_ok());
        assert!(acceptable(&s(None, Code::KeyO)).is_err());
        assert!(acceptable(&s(Some(Modifiers::SHIFT), Code::KeyO)).is_err());
        assert!(acceptable(&s(None, Code::F13)).is_err());
    }

    #[test]
    fn a_held_combination_fires_once() {
        let mut edge = Edge::default();
        let fired: Vec<bool> = [false, true, true, true, false, true].iter().map(|&d| edge.rose(d)).collect();
        assert_eq!(fired, vec![false, true, false, false, false, true]);
    }
}
