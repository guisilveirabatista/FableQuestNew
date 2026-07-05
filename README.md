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
| I | Show/hide the inventory panel (body + backpack, docked on the right) |
| E | Focus the inventory panel for keyboard use (cycles backpack → body → off) |
| Esc / X | Open the game menu (Inventory, Skills, Attribs, Status, Quest, Save, Load, Music, Autoloot, To Title) |

The game fills the whole window, whatever its aspect ratio — the viewport is
sized to the window at an integer pixel scale (no stretching, no black bars)
and the camera follows the hero across the 40×25-tile maps. Unarmed attacks
land a punch (impact burst); the slicing streak appears only with a cutting
weapon equipped. You start at the **spawn point** in the city plaza; dying is
not the end: your body stays where you fell and you wake up back at the spawn
with full HP, gear intact.

Skills: **Fire** (4 MP fireball, homes in on your lock), **Heal** (6 MP, +15 HP),
**Spin** (3 MP sword sweep all around you), **Bolt** (6 MP lightning on your lock
or the nearest foe). HP and MP both regenerate slowly on their own.

## The city

The dirt path leads east to a walled city — a safe zone monsters never enter.
The **Blacksmith** (left shop) sells swords, shield and armor; the **Grocer**
(right shop) sells bread, meat, potions and trinkets (boots, ring, amulet).
Talk to a keeper to browse; Enter buys.

## Backpack, equipment & weight

Press **I** (or menu → Inventory) to toggle the always-on inventory panel,
docked to the right edge of the screen: a **paper doll** with body slots —
head, weapon hand, off-hand (shield), torso, legs, boots and two accessory
slots — with your backpack (icon grid, counts in the corner) below it. The
game keeps running while it's open. Equip gear three ways:

- **Drag** an item from the backpack onto a body slot with the mouse (valid
  slots light up green); drag gear off the body to unequip, between the two
  accessory slots to swap fingers, or out onto the map to drop it at your feet.
- **Keyboard**: press E to focus the panel (backpack → body → off), arrows
  move the cursor, Enter snaps gear into its natural slot (or unequips on the
  body side). The hero stands still while the panel has keyboard focus.
- **Double-click** an item to equip it (or a body slot to unequip).

A two-handed weapon (the Claymore) needs both arms: equipping it sends your
shield back to the bag, and vice versa. Gear bonuses (Atk, Def, MDef, Dodge,
Crit) feed straight into your derived stats. Enter also eats food/potions, and
**Q** drops one unit on the floor at your feet. Slain monsters sometimes drop
loot — with **Autoloot: On** (menu toggle) you pick items up just by stepping
on them, otherwise stand on them and press Enter.

Bag contents have weight (worn gear weighs nothing — you're wearing it). Carry
capacity is `15 + 2×level + 2×Strength` kg; go over it and the hero trudges at
half speed (the HUD warns **OVERWEIGHT**).

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

All art, sound and music are from the RPG Maker 2003 Run Time Package (plus
item icons from RPG Maker MZ DLC packs: MV Trinity Resource Pack and the
Weapons Icon Set) and are subject to their licenses: usable in RPG Maker
projects by owners of those products, not for general redistribution. Don't
publish this repo publicly with the `assets/` folder included.
