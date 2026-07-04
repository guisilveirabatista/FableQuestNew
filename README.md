# Fable Quest

A mini RPG built with HTML5/JavaScript on top of the RPG Maker 2003 RTP assets.
No build step, no server, no dependencies — everything (including music) is
self-contained.

## Play

Open `index.html` in a browser (double-click it, or `open index.html`).

## Controls

| Key | Action |
| --- | --- |
| Arrows / WASD | Move / navigate menus |
| Enter / Space / Z | Talk, read, confirm |
| Esc / X | Open the game menu (Items, Status, Quest, Save, Load, Music, To Title) |

Quest: monsters attack on grass (the dirt path is safe). Slay 5 of them and
report to the Elder by the well. He also heals you and tops up your potions.

## How it works

- `game.js` — the engine: tile map, sprites, dialogue, battles, menus, save/load
  (localStorage).
- `midi.js` — a tiny Standard MIDI File parser + WebAudio synth (oscillator
  voices per GM instrument family, synthesized drums), so the RTP's `.mid`
  soundtrack plays without a soundfont.
- `assets/` — preprocessed RTP assets: sprites with the palette-0 transparent
  color converted to real alpha, sound effects as-is, and four MIDI tracks
  base64-embedded in `music.js` so the game works from `file://`.

## Asset license

All art, sound and music are from the RPG Maker 2003 Run Time Package and are
subject to its license: usable in RPG Maker projects by owners of RPG Maker
2003, not for general redistribution. Don't publish this repo publicly with the
`assets/` folder included.
