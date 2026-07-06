# Fable Quest

A mini action RPG built with HTML5/JavaScript on top of the RPG Maker 2003 RTP
assets. No build step, no server, no dependencies — everything (including
music) is self-contained.

## Play

Open `index.html` in a browser (double-click it, or `open index.html`).

## Controls

| Key | Action |
| --- | --- |
| Arrows / WASD | Move (the most recently pressed direction wins; release it and the other held direction takes back over) / navigate menus |
| Left click | Walk to the clicked tile (the hero finds his own way around obstacles). Clicking to move cancels Follow |
| Alt/Option + left click | Lock the enemy under the cursor and **Follow** it — the hero walks after it (blue marker) until it's in reach |
| Right click | Lock the enemy under the cursor for attack (no follow), or open your corpse if you're next to it (right-click empty ground to unlock) |
| F | Toggle **Follow** on the current lock (shown by a blue marker outside the yellow lock) |
| Enter / Space / Z | Talk or read when facing someone, otherwise swing your sword |
| 1–5 | Cast the skill equipped in that hotbar slot (equip via menu → Skills) |
| Tab | Lock on to the nearest enemy (press again to cycle) |
| I | Show/hide the inventory panel (body + backpack, docked on the right) |
| E | Focus the inventory panel for keyboard use (cycles backpack → body → off) |
| Esc / X | Open the game menu (Inventory, Skills, Attribs, Status, Quest, Save, Load, Music, Autoloot, Log, To Title) |

While a target is **locked** (yellow marker) your sword strikes by itself when
the enemy is in reach and fireballs home in on it, but the hero holds position.
Press **F** to add **Follow** (blue marker) so he chases the target too. Every
menu and shop is fully mouse-driven — click a row to select, click again (or
double-click, for shop items) to act, and click outside the window to close it.

Kills toward the quest are tracked in the Status and Quest screens (not the
HUD). A toggleable **Log** window (bottom-left, menu → Log) records combat
rewards — EXP, gold, loot and level-ups.

The game fills the whole window, whatever its aspect ratio — the viewport is
sized to the window at an integer pixel scale (no stretching, no black bars)
and the camera follows the hero across the 40×25-tile maps. Unarmed attacks
land a punch (impact burst); the slicing streak appears only with a cutting
weapon equipped. You start at the **spawn point** in the city plaza; dying is
not the end: your body stays where you fell and you wake up back at the spawn
with full HP and your equipment — but **your backpack stays with the body**.
Walk up to your remains and press Enter (or double-click them) to open a loot
window: double-click an item to take it, Enter to take everything. Wounded
imps and ghosts turn tail once their health drops below their courage
threshold (about 20–25%) and try to escape.

**The world never pauses.** Dialogue, menus, shops and popups only capture
your input — NPCs wander, monsters chase and hit, projectiles fly, regen ticks
and click-to-move keeps walking underneath (groundwork for the planned
multiplayer/MMORPG mode, where the world can't wait for any one player).
Auto-melee on a locked target keeps swinging even while you read.

Skills: **Fire** (4 MP fireball, homes in on your lock), **Heal** (6 MP, +15 HP),
**Spin** (3 MP sword sweep all around you), **Bolt** (6 MP lightning on your lock
or the nearest foe). HP and MP both regenerate slowly on their own.

## The city

The dirt path leads east to a walled city — a safe zone monsters never enter.
The **Blacksmith** (left shop) sells swords, shield and armor; the **Grocer**
(right shop) sells bread, meat, potions and trinkets (boots, ring, amulet).
Talk to a keeper to browse; Enter buys.

## Backpack, equipment & weight

Press **I** (or menu → Inventory) to toggle the always-on inventory, docked to
the right edge as two windows: a **Body** paper doll on top — head, weapon
hand, off-hand (shield), torso, legs, boots and two accessory slots — and the
**Backpack** below it (icon grid, counts in the corner). Hovering an item
shows its name in a tooltip; click the tooltip's **[?]** button for a popup
with the item's stats, description, weight and value. Equip gear three ways:

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
**Q** drops one unit on the floor at your feet.

Loot on the ground is picked up by hand — walking over it does nothing. Stand
next to (or on) an item and **double-click** it, or **drag it into the
backpack window**. With **Autoloot: On** (menu toggle), monster drops skip the
floor entirely and land straight in your bag.

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

The engine is split into an authoritative **simulation** and a thin **client**
(step one of the road to server-authoritative multiplayer — see "MMORPG plan"):

- `sim.js` — the world model and all the *rules*: tile maps, enemy AI, real-time
  combat (damage, crit, loot, XP), movement, inventory/equipment, shops. It
  touches no DOM, canvas, input or audio, so it runs headless (`node
  tools/simtest.js`) — the same rules will later run on the server. The client
  never mutates the world directly: it pushes **intents** (`move`, `attack`,
  `cast`, `equip`, `buy`, …) that the sim drains each tick in `stepWorld()`.
  `applyIntent()` is the single entry point for player actions.
- `client.js` — the browser front end: canvas + camera, input capture, all
  rendering, the UI panels/menus, `localStorage` save/load, and the main loop.
  It reads the world to draw it and turns raw input into intents.
- `midi.js` — a tiny Standard MIDI File parser + WebAudio synth (oscillator
  voices per GM instrument family, synthesized drums), so the RTP's `.mid`
  soundtrack plays without a soundfont.
- `assets/` — preprocessed RTP assets: sprites with the palette-0 transparent
  color converted to real alpha, sound effects as-is, and four MIDI tracks
  base64-embedded in `music.js` so the game works from `file://`. The monster
  walk sprites and the slash/flame effects are ripped from the RTP by
  `tools/rip.js` (it injects a tRNS chunk so palette 0 becomes transparent).

## Multiplayer server (MMORPG)

An **authoritative Go server** (`server/`) owns the entire world for many clients
sharing it — movement, enemies, combat, skills, inventory, loot, shops, and
character progression. Clients send only *intents* (never positions or damage),
so nothing can be spoofed; the server ticks at 20 Hz and streams each client just
the entities inside its viewport (area-of-interest). Accounts and character state
(level, gold, gear, inventory, position) persist across restarts.

```
cd server
go run .            # serves the game + WebSocket on http://localhost:8080
go test ./...       # world / combat / items / persistence tests
```

Open **http://localhost:8080/index.html?net=1** in one or more browser windows.
You'll get a **login screen** — pick any name and password (new names are
registered automatically), and you're in. Two windows = two players who see each
other. The client predicts your own hero with the same rules the server runs
(`sim.js`'s `stepHero`) and interpolates everyone else. `netclient.js` is the
netplay layer; `?net=1` opts into it (plain `index.html` still runs the full
single-player game).

Persistence defaults to a JSON file (`-db file:PATH`, zero setup). For
PostgreSQL, build with the tag and point `-db` at your database:

```
go build -tags postgres && ./server -db postgres://user:pass@localhost/fablequest
```

## Asset license

All art, sound and music are from the RPG Maker 2003 Run Time Package (plus
item icons from RPG Maker MZ DLC packs: MV Trinity Resource Pack and the
Weapons Icon Set) and are subject to their licenses: usable in RPG Maker
projects by owners of those products, not for general redistribution. Don't
publish this repo publicly with the `assets/` folder included.
