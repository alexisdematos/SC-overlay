//! The three modes of the window, and when it shows. Pure logic: no window here.

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Click-through: the game gets every click.
    Game,
    /// The overlay takes the mouse (Alt+O).
    Interaction,
    /// Interaction, and the widgets can be moved.
    Edit,
}

impl Mode {
    pub fn click_through(self) -> bool {
        self == Mode::Game
    }

    /// What Alt+O does: Game <-> Interaction; from Edit, back to Game.
    pub fn on_hotkey(self) -> Mode {
        match self {
            Mode::Game => Mode::Interaction,
            Mode::Interaction | Mode::Edit => Mode::Game,
        }
    }

    pub fn parse(text: &str) -> Option<Mode> {
        match text {
            "game" => Some(Mode::Game),
            "interaction" => Some(Mode::Interaction),
            "edit" => Some(Mode::Edit),
            _ => None,
        }
    }
}

/// The window shows while the game is in front, or while we hold the mouse.
pub fn overlay_visible(mode: Mode, game_in_front: bool, always_show: bool) -> bool {
    mode != Mode::Game || game_in_front || always_show
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_game_mode_lets_clicks_through() {
        assert!(Mode::Game.click_through());
        assert!(!Mode::Interaction.click_through());
        assert!(!Mode::Edit.click_through());
    }

    #[test]
    fn hotkey_cycle() {
        assert_eq!(Mode::Game.on_hotkey(), Mode::Interaction);
        assert_eq!(Mode::Interaction.on_hotkey(), Mode::Game);
        assert_eq!(Mode::Edit.on_hotkey(), Mode::Game);
    }

    #[test]
    fn parse_names() {
        assert_eq!(Mode::parse("edit"), Some(Mode::Edit));
        assert_eq!(Mode::parse("Game"), None);
        assert_eq!(Mode::parse(""), None);
    }

    #[test]
    fn visibility() {
        assert!(!overlay_visible(Mode::Game, false, false));
        assert!(overlay_visible(Mode::Game, true, false));
        assert!(overlay_visible(Mode::Game, false, true));
        assert!(overlay_visible(Mode::Interaction, false, false));
        assert!(overlay_visible(Mode::Edit, false, false));
    }

    #[test]
    fn serializes_lowercase() {
        assert_eq!(serde_json::to_string(&Mode::Interaction).unwrap(), "\"interaction\"");
    }
}
