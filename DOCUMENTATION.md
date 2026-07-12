# Running tests

go test ./...
go test -v ./... // Detailed logs

# Building the project

 To build the project, you only need to build the Go server, as the frontend browser client has no
  build step (no JavaScript package installation or bundling is required).

  Here is how you build the server:

  ### 1. Standard Build

  Navigate to the  server  directory and build the executable:

    cd server
    go build -o server .
    
  This produces a  server  binary in the current directory.
  ──────
  ### 2. Build with PostgreSQL Support (Optional)

  If you want to use a PostgreSQL database instead of the default file-based JSON database, build
  with the  postgres  build tag:

    cd server
    go build -tags postgres -o server .
    ──────
  ### 3. How to Run the Built Server

  Once built, you can run the executable:

    # Run with default JSON database:
    ./server

    # Or with custom options (e.g. specifying admins):
    ./server -admins admin,gm

  Then, open http://localhost:8080 in your browser.


# Adding Items to the Shop

  The game uses a secure client-server architecture, which means shops have to be updated in two places (one for the visual interface, and
  one for backend anti-cheat validation):

  1. Frontend (Visuals): You need to add the item's internal ID to the  SHOPS  object inside  sim.js . You'll find it around line 571 under
  stock: ['sword1', 'sword2', ...]  for the Blacksmith.
  2. Backend (Security): You need to add the same internal ID to the  shops  map in  server/items.go  (around line 110). This ensures the
  server actually authorizes players to buy the item with their gold.


# Drawing and Editing Maps

The game handles maps using a secure client-server architecture. Player movement and collisions are calculated authoritatively on the Go backend server, while visuals are rendered on the JavaScript frontend. Therefore, when editing or adding maps, you must update both the frontend map settings and backend logic to prevent desynchronization.

## Map Properties & Dimensions
All maps in the game share a fixed resolution grid:
- **Map Width (`MW`)**: 40 tiles
- **Map Height (`MH`)**: 25 tiles
- **Tile Size (`TS`)**: 16x16 pixels
- **Visual Asset**: Tiles are drawn from `assets/chipset.png`.

---

## 1. Map Layout & Tile Definitions

The layout is built from a grid of characters, where each character maps to a specific tile in the chipset and possesses distinct walking rules.

### Ground & Collision Coding
The map grid uses the following tile mapping, defined in [GROUND_T](file:///Users/guilhermesilveirabatista/code/RPG2003/Fable/FableQuest/client.js#L359) on the client side:

| Code | Type | Solid/Blocked | Chipset coordinates `[x, y]` | Description |
|---|---|---|---|---|
| `G` | Grass | No (Walkable) | `[304, 48]` | Standard grass tile. Monsters spawn on grass only. |
| `D` | Dirt | No (Walkable) | `[352, 48]` | Dirt pathways. |
| `P` | Pavement | No (Walkable) | `[192, 80]` | Paved plaza or shop floors. |
| `W` | Water | **Yes (Solid)** | `[0, 64]` | Blocked water tile. |
| `X` | City Wall | **Yes (Solid)** | `[224, 0]` | Blocked stone boundary walls. |
| `R` | Shop Brick | **Yes (Solid)** | `[224, 32]` | Blocked brick tiles for shop buildings. |
| `U` | Shop Stucco | **Yes (Solid)** | `[224, 48]` | Blocked stucco walls for shop structures. |
| `O` | Shop Door | **Yes (Solid)** | `[208, 32]` | Blocked wooden shop doorways. |

Any tile using a character listed in [SOLID_GROUND](file:///Users/guilhermesilveirabatista/code/RPG2003/Fable/FableQuest/sim.js#L220) (`W`, `X`, `R`, `U`, `O`) will automatically register as solid/blocked for movement.

---

## 2. Editing Existing Maps

To edit the layout or elements of the existing maps (`field` or `city`), modify the definitions in both:
1. **Frontend**: The [MAPS](file:///Users/guilhermesilveirabatista/code/RPG2003/Fable/FableQuest/sim.js#L225) object in [sim.js](file:///Users/guilhermesilveirabatista/code/RPG2003/Fable/FableQuest/sim.js)
2. **Backend**: The [buildMaps](file:///Users/guilhermesilveirabatista/code/RPG2003/Fable/FableQuest/server/world.go#L55) function in [server/world.go](file:///Users/guilhermesilveirabatista/code/RPG2003/Fable/FableQuest/server/world.go)

### Modifying the Ground Grid
- **In `sim.js`**: Update the 25-row array returned by `ground: (() => { ... })()` for the map. Each row must be a string of exactly 40 characters.
- **In `server/world.go`**: Update the nested loop in `buildMaps()` assigning characters to `ground[y][x]` (and applying `blocked[y][x] = true` if solid).

### Modifying Decorative Sprites, Trees, and Props
- **Hedge Border**: Setting `hedge: true` in the frontend (or running the corresponding border blocking loop in the backend) blocks the outer boundary tiles of the map, except for those defined as exits.
- **Trees**: Defined in frontend `trees: [[x, y], ...]` and backend `fieldTrees := [][2]int{ ... }`. Trees are 2x2 structures, where the base row is solid.
- **Props**: Predefined 1-tile solid objects (e.g., `well`, `sign`, `palm`, `cactus`, `rock`). Modify `props` in frontend `sim.js` and `fieldProps` in backend `server/world.go`.
- **Deco**: Custom chipset slices defined on the client using `[sx, sy, w, h, x, y, solid]`. If `solid` is true, block the corresponding tile `x,y` in both `sim.js` and `server/world.go`.

---

## 3. Creating a New Map

To draw a completely new map (e.g., `dungeon`), follow these steps:

### Step A: Define the Map in the Frontend
Add your map to the [MAPS](file:///Users/guilhermesilveirabatista/code/RPG2003/Fable/FableQuest/sim.js#L225) object in [sim.js](file:///Users/guilhermesilveirabatista/code/RPG2003/Fable/FableQuest/sim.js):

```javascript
dungeon: {
  ground: (() => {
    const rows = [];
    for (let y = 0; y < MH; y++) {
      let r = '';
      for (let x = 0; x < MW; x++) {
        // Build your character grid
        if (x === 0 || y === 0 || x === MW - 1 || y === MH - 1) r += 'X'; // Walls
        else r += 'P'; // Pavement
      }
      rows.push(r);
    }
    return rows;
  })(),
  trees: [],
  props: [],
  deco: [],
  hedge: false,
  spawn: false,
  exits: {
    '19,0': ['city', 19, 23] // exit back to city
  }
}
```

### Step B: Define the Map in the Backend
Replicate the new map logic inside [buildMaps](file:///Users/guilhermesilveirabatista/code/RPG2003/Fable/FableQuest/server/world.go#L55) in [server/world.go](file:///Users/guilhermesilveirabatista/code/RPG2003/Fable/FableQuest/server/world.go):

```go
dungeon := &gameMap{exits: map[[2]int]exit{{19, 0}: {"city", 19, 23}}}
for y := 0; y < MH; y++ {
	for x := 0; x < MW; x++ {
		var c byte = 'P'
		if x == 0 || y == 0 || x == MW-1 || y == MH-1 {
			c = 'X'
		}
		dungeon.ground[y][x] = c
		if solid(c) {
			dungeon.blocked[y][x] = true
		}
	}
}
maps["dungeon"] = dungeon
```

### Step C: Connect Map Exits
Ensure that players can transition to the new map by adding the corresponding coordinate triggers in the `exits` block of the source map (and adding reciprocal exits to return):
- **Frontend exits format**: `'exitTileX,exitTileY': ['destMapID', destSpawnX, destSpawnY]`
- **Backend exits format**: `{{exitTileX, exitTileY}: {"destMapID", destSpawnX, destSpawnY}}`

### Step D: Register NPCs & Enemies (Optional)
- **NPCs**: Add static NPC coordinates to [npcs](file:///Users/guilhermesilveirabatista/code/RPG2003/Fable/FableQuest/sim.js#L294) in `sim.js` and [npcTiles](file:///Users/guilhermesilveirabatista/code/RPG2003/Fable/FableQuest/server/world.go#L47) in `server/world.go` to block player movement through them.
- **Enemies**: If you want monsters to spawn on the map, add its ID (e.g., `"dungeon"`) to [spawnMaps](file:///Users/guilhermesilveirabatista/code/RPG2003/Fable/FableQuest/server/enemy.go#L36) in [server/enemy.go](file:///Users/guilhermesilveirabatista/code/RPG2003/Fable/FableQuest/server/enemy.go).
- **PvP Rules**: To enable PvP on the map, add its ID to [pvpMaps](file:///Users/guilhermesilveirabatista/code/RPG2003/Fable/FableQuest/server/social.go#L532) in [server/social.go](file:///Users/guilhermesilveirabatista/code/RPG2003/Fable/FableQuest/server/social.go).

### Step E: Configure Zone Sharding (If Applicable)
If starting the server in sharded mode (splitting maps across different process instances), specify which zone-server owns the new map using command-line arguments:
```bash
./server -mode zone -maps dungeon -zaddr :9103 &
./server -mode gateway -addr :8080 -zone city=:9101 -zone field=:9102 -zone dungeon=:9103
```

