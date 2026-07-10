# Admin Guide

This guide covers the multiplayer admin tools for Fable Quest. Admin powers are
server-authoritative: the browser only sends requests, and the Go server checks
the account allowlist before changing the world, accounts, characters, items,
stats, or monsters.

## Enabling Admin Accounts

Start the server with a comma-separated list of account names:

```sh
cd server
go run . -admins admin,gm
```

Then log in with one of those account names in netplay:

```text
http://localhost:8080/index.html?net=1
```

Admin names use the same account rules as normal logins: 1-16 characters, using
letters, digits, and underscores.

## Admin Menu

Admins see an **Admin** entry in the in-game menu. Open the menu with `X`, choose
**Admin**, then choose one of these sections.

### Announcement

Broadcasts a public admin message to every online player. It appears in chat in
yellow with the announcement marker.

Fields:
- `Text`: message to broadcast.

### Ban Account

Bans an account from logging in. If the account is online, the server closes the
connection.

Fields:
- `Account`: account username.

Notes:
- You cannot ban your own account from the admin action.
- Account bans persist in the configured store.
- The window shows a scrollable list of currently banned accounts.

### Unban Account

Removes an account ban.

Fields:
- `Account`: account username.

Notes:
- Account unbans persist in the configured store.
- The window shows a scrollable list of currently banned accounts; clicking a
  row fills the account field.

### Ban Character

Bans one character on an account while leaving the rest of the account usable.
If that character is online, the server closes the connection.

Fields:
- `Account`: account username.
- `Character`: character name on that account.

Notes:
- You cannot ban the character you are currently using.
- Character bans persist in the configured store.
- The window shows a scrollable list of currently banned characters.

### Unban Character

Removes a character ban from an account.

Fields:
- `Account`: account username.
- `Character`: character name on that account.

Notes:
- Character unbans persist in the configured store.
- The window shows a scrollable list of currently banned characters; clicking a
  row fills the account and character fields.

### Teleport

Moves your admin character.

Fields:
- `Player`: optional online player to teleport to.
- `Map`: map id, such as `city` or `field`.
- `X`: destination tile x.
- `Y`: destination tile y.

Usage:
- To teleport to coordinates, fill `Map`, `X`, and `Y`.
- To teleport to an online player, fill `Player`; the coordinate fields are
  ignored.

Validation:
- The map must exist.
- The destination tile must be inside the map and unblocked.
- In sharded gateway/zone mode, cross-map teleports hand the admin to the owning
  zone.

### Create Item

Creates items directly in your backpack.

Fields:
- `Item`: item id.
- `Qty`: quantity.

Valid item ids:

```text
bread
meat
potion
sword1
sword2
sword3
shield
hat
helm
armor
legs
boots
ring
amulet
```

Validation:
- Quantity is clamped from `1` to `9999`.
- This bypasses shops and carry-capacity checks.

### Character

Edits your current admin character.

Fields:
- `Class`: class name.
- `Level`
- `Gold`
- `Attr Pts`
- `Skill Pts`
- `HP`
- `MP`
- Primary attributes: `Agility`, `Intelligence`, `Vitality`, `Strength`,
  `Dexterity`, `Magic Power`, `Luck`
- Skill levels: `Fire`, `Heal`, `Spin`, `Bolt`, `Nova`, `Super Nova`

Valid classes:

```text
Knight
Lancer
Wizard
Archer
Vampire
Holy
```

Validation:
- Level is clamped from `1` to `99`.
- Gold is clamped from `0` to `999999`.
- Attribute and skill points are clamped from `0` to `999`.
- Attributes are clamped from `1` to `99`.
- Skill levels are clamped from `1` to `5`.
- HP is clamped from `1` to max HP.
- MP is clamped from `0` to max MP.
- Hotbar slots are normalized after class changes.

### Cheats

Toggles temporary cheats on your current admin character.

Available cheats:
- `Invulnerable`: blocks PvE and PvP damage to your admin character.
- `Infinite Weight`: ignores carry-capacity limits and overweight slowdown.
- `Infinite HP/MP`: keeps HP and MP full and lets skills cast without spending
  MP.
- `Max Attributes`: treats every primary attribute as `99`.
- `Maxed Stats`: treats every primary attribute as `99`, then recalculates max
  HP and MP.
- `All Skills`: allows every class to use every skill.
- `Super Speed`: doubles movement speed unless another rule explicitly slows
  the character.

Admin-only skill:
- `Super Nova`: a free hotbar skill for admins that defeats every monster on
  the current map while leaving players untouched.

Notes:
- Cheats are per-character runtime state from the current server session.
- Cheat changes are validated by the server like every other admin action.
- Turning off `Maxed Stats` recalculates max HP and MP from the character's real
  attributes.

### Summon Monster

Summons monsters on any map.

Fields:
- `Kind`: monster id.
- `Qty`: quantity.
- `Map`: map id.
- `X`: target tile x.
- `Y`: target tile y.

Valid monster ids:

```text
slime
imp
ghost
```

Validation:
- Quantity is clamped from `1` to `50`.
- The map must exist.
- Monsters are placed on the target tile or nearby open tiles.
- Blocked tiles and already-occupied monster tiles are skipped.
- Summoned monsters can exist outside natural monster spawn maps.

## Player Context Menu

Admins get extra right-click actions on other players:

- `Teleport To`: teleport your admin character to that player.
- `Ban Account`: ban that player's account.
- `Ban Character`: ban that player's current character.

The normal player actions are still available:

- `Trade`
- `Message`
- `Follow`

## Slash Commands

Slash commands are available from chat. Press `Enter`, type the command, and
press `Enter` again.

### `/announce <message>`

Broadcasts a yellow public admin announcement.

Example:

```text
/announce Server restart in 5 minutes.
```

### `/ban <account>`

Bans an account.

Example:

```text
/ban BadUser
```

### `/unban <account>`

Removes an account ban.

Example:

```text
/unban BadUser
```

### `/banchar <account> <character>`

Bans one character on an account.

Example:

```text
/banchar BadUser BadHero
```

### `/unbanchar <account> <character>`

Removes a character ban.

Example:

```text
/unbanchar BadUser BadHero
```

### `/item <item-id> [quantity]`

Creates items in your backpack.

Examples:

```text
/item potion
/item sword3 2
```

### `/summon <monster-id> [quantity] [map] [x] [y]`

Summons monsters. If map and coordinates are omitted, the command uses your
current map and tile.

Examples:

```text
/summon slime
/summon ghost 3
/summon imp 5 field 15 10
```

### `/cheat <name> [on|off|toggle]`

Toggles a cheat on your current admin character. If the final argument is
omitted, the command flips the current state.

Accepted names:
- `invulnerable`
- `infinite weight`
- `infinite health and mp`
- `max attributes`
- `max stats`
- `all skills`
- `super speed`

Examples:

```text
/cheat invulnerable on
/cheat infinite health and mp on
/cheat infinite weight
/cheat max attributes
/cheat maxed out stats off
/cheat speed toggle
```

## Gateway And Zone Mode

In gateway/zone mode:

- The gateway authenticates accounts and checks persistent bans.
- Account bans, character bans, and announcements are handled at the gateway so
  they work across zones.
- Local world actions, such as teleporting, creating items, character edits, and
  summoning monsters, are handled by the authoritative zone that owns the admin
  character.

## Persistence

Account bans and character bans are stored in the active persistence backend.

Supported backends:

- JSON file store, configured with `-db file:PATH`.
- PostgreSQL store, when built with `-tags postgres`.

## Safety Notes

- Admin status is not trusted from the browser.
- Non-admin requests are rejected server-side.
- Admin actions validate known item ids, monster ids, classes, stats, maps, and
  tiles before applying changes.
- Admin cheats only affect the admin character that enabled them.
- The server blocks admins from banning their own account or current character
  through the in-game admin actions.
