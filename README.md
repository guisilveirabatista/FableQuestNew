# Fable Quest

A mini action RPG built with HTML5/JavaScript on top of the RPG Maker 2003 RTP
assets. No build step, no server, no dependencies — everything (including
music) is self-contained.

## Play

Open `index.html` in a browser (double-click it, or `open index.html`).

## Controls

| Key | Action |
| --- | --- |
| Arrows / WASD | Move / navigate menus |
| Left click | Walk to the clicked tile (the hero finds his own way around obstacles) |
| Right click | Lock on to the enemy under the cursor (right-click empty ground to unlock) |
| Enter / Space / Z | Talk or read when facing someone, otherwise swing your sword |
| 1–5 | Cast the skill equipped in that hotbar slot (equip via menu → Skills) |
| Tab | Lock on to the nearest enemy (press again to cycle). While locked, your sword strikes by itself when the target is in reach, and fireballs home in on it — even diagonally |
| Esc / X | Open the game menu (Items, Skills, Status, Quest, Save, Load, Music, To Title) |

Skills: **Fire** (4 MP fireball, homes in on your lock), **Heal** (6 MP, +15 HP),
**Spin** (3 MP sword sweep all around you), **Bolt** (6 MP lightning on your lock
or the nearest foe). HP and MP both regenerate slowly on their own.

Attributes: each level-up grants **3 points** to spend (menu → Attribs) on
Agility, Intelligence, Vitality, Strength, Dexterity, Magic Power and Luck.
These drive the derived stats shown alongside: Attack (Str, Dex), Magic Attack
(Magic Power, Int), Precision (Dex, Luck — melee hit chance), Crit % (Luck,
Dex), Endurance (Vit, Str — softens physical hits), Magic Endurance (Int, Vit —
ghosts hit with magic), Dodge (Agi, Luck) and Attack Speed (Agi). Vitality and
Intelligence also raise max HP/MP.

Quest: monsters roam the grass in real time and chase you on sight — touching
one hurts (the dirt path is safe: they won't step on it). Slay 5 of them and
report to the Elder by the well. He also heals you and tops up your potions.

## How it works

- `game.js` — the engine: tile map, sprites, dialogue, real-time combat
  (roaming enemies, sword slashes, fireballs, damage popups), menus, save/load
  (localStorage).
- `midi.js` — a tiny Standard MIDI File parser + WebAudio synth (oscillator
  voices per GM instrument family, synthesized drums), so the RTP's `.mid`
  soundtrack plays without a soundfont.
- `assets/` — preprocessed RTP assets: sprites with the palette-0 transparent
  color converted to real alpha, sound effects as-is, and four MIDI tracks
  base64-embedded in `music.js` so the game works from `file://`. The monster
  walk sprites and the slash/flame effects are ripped from the RTP by
  `tools/rip.js` (it injects a tRNS chunk so palette 0 becomes transparent).

## Asset license

All art, sound and music are from the RPG Maker 2003 Run Time Package and are
subject to its license: usable in RPG Maker projects by owners of RPG Maker
2003, not for general redistribution. Don't publish this repo publicly with the
`assets/` folder included.
