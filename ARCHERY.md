The best first version is weapon-based archery, integrated into the existing lock/follow combat system—not an “Arrow” spell.
Recommended gameplay
Add a two-handed Short Bow sold by the Blacksmith.
New Archer characters begin with one equipped.
Any class may use bows, but Archer attributes make them substantially stronger.
Standard arrows are unlimited initially; ammunition management can come later.
Locking and attacking use the existing controls:Ctrl + left-click or Tab locks a target.
The bow automatically fires when the target is within range.
Follow approaches to a sensible firing distance instead of running into melee range.

Equipping a sword restores the existing melee behavior.
Arrows travel in a straight line, can hit walls, and do not home like fireballs.
Implementation plan
Add bow equipment and ranged stats.
Add bow1 to server and client item definitions.
Mark it as two-handed and weaponType: bow.
Add a small inventory/equipment icon and Blacksmith stock entry.
Calculate ranged attack primarily from Dexterity and Agility, with bow attack bonuses.
Apply starter equipment only during Archer character creation so admin class changes cannot duplicate bows.

Generalize the projectile protocol.
The current projectile snapshot only carries position, time, and explosion state. Extend it with:
Stable projectile ID
kind: fire or arrow
Owner ID
Direction/velocity
Impact state
Fireballs retain homing behavior; arrows use a fixed launch direction.

Add server-authoritative ranged attacks.
Replace autoMelee() with an equipment-aware automatic attack:
Melee weapon → current one-tile slash.
Bow → shoot when the target is within approximately seven tiles.
Arrow damage, precision, critical hits, range, walls, enemy collision, and PvP eligibility are all resolved by the server.
Damage happens when the arrow reaches a target, not when it is launched.
The first hostile target in its path can be hit; friendly players are ignored.

Make following range-aware.
Bow users stop around five tiles from their target.
They resume approaching if the target moves beyond bow range.
Use a preferred range and a larger maximum range to avoid movement jitter.
Mirror the same rule in client prediction so reconciliation does not pull the Archer forward or backward.

Render a visibly flying arrow.
Maintain projectiles by stable ID instead of replacing the whole list every snapshot.
Smooth or extrapolate arrow movement between the server’s 20 Hz snapshots.
Draw a 10–12 pixel shaft, arrowhead, and fletching rotated using atan2(dy, dx).
Add a subtle motion streak so it remains visible against grass and city tiles.
Show a short impact spark instead of the fireball explosion.
Keep the arrow on screen briefly after impact so close-range shots remain readable.
Add a small bow-release effect at the shooter’s hands when a new arrow appears.

Add appropriate audio and UI details.
Bow-release and arrow-impact sounds.
Item description explaining range and two-handed behavior.
Archer character-selection text mentioning ranged combat.
README control and equipment documentation.

Test the complete path.
Server tests should cover:
Archer starter bow
Bow persistence and two-handed equipment rules
Range and cooldown
Wall collision
Enemy and PvP damage
Friendly-player immunity
Target movement and straight-flight misses
Fireball behavior remaining unchanged
Range-aware follow behavior
Browser verification should confirm:
The arrow visibly crosses several tiles smoothly.
Its angle matches every firing direction.
Impact visuals differ from fireballs.
Another connected player sees the same arrow.
Switching between bow and sword changes attack behavior correctly.
Solo-server and gateway modes receive the same projectile data.

I would deliberately leave consumable ammunition, Power Shot, Volley, elemental arrows, and additional bows for a later pass. The first version should make the normal Archer attack feel complete and visually readable.

I think even if the enemy is up close, the attack with the arrow should work. otherwise this would make the archer class to weak.maybe make distance attacks slightly stronger.