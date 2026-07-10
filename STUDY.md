Fixed the player collision / "walk over then warp back" bug.

Root cause
• Server (authoritative): occupied() / playerAt() treats other living players as solid (like enemies/walls) in stepPlayer(), findPath(), etc. However, all players are stepped in a single pass over h.players (random map iteration order). Positions are mutated in place, so later-processed players can see updated positions from earlier ones in the same tick. This allows order-dependent "crossing" into what was a pre-tick occupied tile (or contested free tiles).
• Client prediction (in sim.js stepHero() + findPath() + startPathTo()): Only blocked on map isBlocked() + enemyAt(). No playerAt(). Hero could predict/commit a tile step onto another player's last-known position. Server would reject (different view of "occupied players"), causing tile drift. Reconcile (tileDrift > 1 || pixelDrift > TS) would snap/warp you back.
• Why monsters worked (and players didn't): Enemy positions are fixed during the entire player step phase (updateEnemies() runs after all player steps, using pre-tick player positions for their own checks). Client's last-known enemy tx/ty (from snapshots) matches what the server uses for decisions in that tick. No view mismatch. Players are dynamic (other clients' moves processed in the same pass), so stale snapshot positions in client didn't match server's in-tick view.
• Result: You could "walk over" (prediction allowed it), server corrected, visual warp 1 step back. (Overlaps were also possible in some orderings, though server tried to prevent landing on pre positions.)

Fix
1. Client prediction now blocks players exactly like enemies (in sim.js):
   • Added playerAt(x, y) (parallels enemyAt() and uses remote players from server snapshots).
   • Updated all hero tile commit sites: stepHero() (dir moves, path following, follow chasing) + findPath() + startPathTo().
   • Added tx/ty population for remote players in netclient.js (from snapshots; previously missing or incomplete, so playerAt would have been ineffective).

2. Server now makes all player collision decisions against a frozen pre-tick snapshot of player positions (in main.go + world.go):
   • Before the player step/regen loop: snapshot frozenPlayerPos (pre-tick tx/ty for every living player).
   • Modified playerAt(): if frozen snapshot is active, use the pre positions for blocker checks (instead of live/mutated o.tx/ty).
   • All move decisions (stepPlayer() occupied checks for dir/path/follow) now see the exact same pre-tick player positions that the client saw in its last snapshot.
   • Clear the frozen map after the player step phase (normal live positions used for enemies/loot/etc. afterward).
   • This eliminates order-dependent crossing during the tick + makes server "allowed move?" decisions match client's pre-tick view exactly. (No more "I thought it was free, server said occupied.")

3. Other consistency:
   • Server occupied() / walkable() / findPath() etc. continue to treat players + living enemies as solid (no behavior change for monsters/NPCs).
   • No overlaps from pre-occupied tiles (decisions are now conservative + snapshot-based).
   • Contested free tiles (rare simultaneous moves to same empty tile) may still resolve by loop order (or end up overlapping); this is pre-existing and low-impact (next tick will separate them). The reported warp/crossing of occupied tiles is gone.
   • playerAt() / occupied() still correctly exclude self.
   • Prediction/reconcile, moveDir/path/follow, click-to-move, etc. all updated.
   • Tests (TestPlayersAreSolid, etc.) still pass (they rely on pre positions).

Players are now hard obstacles (like walls) from both client prediction and server decision views. You can't initiate (or succeed) a cross; no warp. Monsters were already correct due to update ordering; now players match.

Run go test ./server (or the full suite) to verify. If you see any remaining desync in heavy contention, we can add post-step conflict resolution or sort players by ID for determinism.
