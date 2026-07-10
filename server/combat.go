package main

// Server-authoritative combat (Phase 2b), ported from sim.js: derived stats from
// attributes, melee resolution (precision/crit), enemies biting players
// (dodge/endurance), enemy death + XP/level-up, and player death/respawn. Every
// roll happens here on the server, so damage, crits, and kills can't be forged.
// Loot drops and corpses arrive in 2d; skills/projectiles in 2c.

import (
	"fmt"
	"math"
	"math/rand"
	"time"
)

// AttrSet holds the 7 primary attributes a player raises on level-up. The lower-
// case json tags match the client's hero.attr keys (sim.js).
type AttrSet struct {
	Agi  int `json:"agi"`
	Int  int `json:"int"`
	Vit  int `json:"vit"`
	Str  int `json:"str"`
	Dex  int `json:"dex"`
	Mag  int `json:"mag"`
	Luck int `json:"luck"`
}

var baseAttr = AttrSet{Agi: 1, Int: 1, Vit: 2, Str: 2, Dex: 1, Mag: 1, Luck: 1}
var characterClasses = []string{"Knight", "Lancer", "Wizard", "Archer", "Vampire", "Holy"}
var skillTree = map[string]string{"bolt": "fire", "spin": "fire"}

const (
	attrPointsPerLevel  = 2
	skillPointsPerLevel = 1
	maxSkillLevel       = 5
)

func expToNextLevel(lv int) int {
	if lv < 1 {
		lv = 1
	}
	return lv * 14
}

func skillAllowedForClass(class, id string) bool {
	return !adminOnlySkills[id] && (id != "heal" || class == "Holy")
}

func playerSkillAllowed(p *Player, id string) bool {
	if adminOnlySkills[id] {
		return p != nil && p.isAdmin()
	}
	return adminCheatEnabled(p, "allSkills") || skillAllowedForClass(p.class, id)
}

func hotbarItem(id string) bool {
	it, ok := items[id]
	return ok && it.heal > 0
}

func hotbarEntryAllowed(p *Player, id string) bool {
	if id == "" {
		return false
	}
	if _, ok := skillMP[id]; ok {
		return playerSkillAllowed(p, id)
	}
	return hotbarItem(id)
}

func defaultSlotsForClass(class string) []string {
	switch class {
	case "Holy":
		return []string{"heal", "bolt", "fire", "spin", ""}
	case "Knight":
		return []string{"spin", "potion", "fire", "bolt", ""}
	case "Lancer":
		return []string{"spin", "bolt", "potion", "fire", ""}
	case "Wizard":
		return []string{"fire", "bolt", "potion", "spin", ""}
	case "Archer":
		return []string{"bolt", "fire", "potion", "spin", ""}
	case "Vampire":
		return []string{"fire", "spin", "potion", "bolt", ""}
	default:
		return []string{"fire", "potion", "spin", "bolt", ""}
	}
}

func normalizeSlots(p *Player) {
	if len(p.slots) == 0 {
		p.slots = defaultSlotsForClass(p.class)
	}
	if len(p.slots) > 5 {
		p.slots = append([]string(nil), p.slots[:5]...)
	}
	for len(p.slots) < 5 {
		p.slots = append(p.slots, "")
	}
	seen := map[string]bool{}
	for i, id := range p.slots {
		if id == "heal" && !playerSkillAllowed(p, id) {
			id = "potion"
		}
		if id == "" || !hotbarEntryAllowed(p, id) || seen[id] {
			p.slots[i] = ""
			continue
		}
		p.slots[i] = id
		seen[id] = true
	}
}

// derived is everything the combat math reads, computed from AttrSet (equipment
// bonuses fold in here from Phase 2d). Go int division floors, matching sim.js.
type derived struct {
	atk, matk, prec, crit, end, mend, dodge int
	aspd                                    float64
}

func statsOf(p *Player) derived {
	a := effectiveAttr(p)
	eq := equipBonus(p) // worn gear bonuses
	return derived{
		atk:   1 + a.Str*2 + a.Dex/2 + eq.atk,
		matk:  2 + a.Mag*2 + a.Int,
		prec:  min(100, 80+a.Dex+a.Luck/2),
		crit:  min(80, 2+a.Luck+a.Dex/2+eq.crit),
		end:   a.Vit + a.Str/4 + eq.end,
		mend:  a.Int + a.Vit/2 + eq.mend,
		dodge: min(60, a.Agi+a.Luck/2+eq.dodge),
		aspd:  1 + float64(a.Agi-1)*0.06,
	}
}

func effectiveAttr(p *Player) AttrSet {
	if adminCheatEnabled(p, "maxStats") || adminCheatEnabled(p, "maxAttributes") {
		return AttrSet{Agi: 99, Int: 99, Vit: 99, Str: 99, Dex: 99, Mag: 99, Luck: 99}
	}
	return p.attr
}

// spendAttr raises one primary attribute if the player has a point to spend.
func spendAttr(p *Player, key string) {
	if p.points <= 0 {
		return
	}
	switch key {
	case "agi":
		p.attr.Agi++
	case "int":
		p.attr.Int++
	case "vit":
		p.attr.Vit++
	case "str":
		p.attr.Str++
	case "dex":
		p.attr.Dex++
	case "mag":
		p.attr.Mag++
	case "luck":
		p.attr.Luck++
	default:
		return
	}
	p.points--
	recalcMax(p)
}

// assignSkill moves a skill or usable item onto hotbar slot i (or clears it if it's already there).
func assignSkill(p *Player, id string, i int) {
	normalizeSlots(p)
	if i < 0 || i >= len(p.slots) {
		return
	}
	if id == "" {
		p.slots[i] = ""
		return
	}
	if !hotbarEntryAllowed(p, id) {
		return
	}
	old := -1
	for s := range p.slots {
		if p.slots[s] == id {
			old = s
		}
	}
	if old == i {
		p.slots[i] = "" // same slot again: unequip
		return
	}
	if old >= 0 {
		p.slots[old] = ""
	}
	p.slots[i] = id
}

func normalizeSkillProgress(p *Player) {
	if p.skillLevels == nil {
		p.skillLevels = map[string]int{}
	}
	for id := range skillMP {
		if p.skillLevels[id] <= 0 {
			p.skillLevels[id] = 1
		}
		if p.skillLevels[id] > skillMaxLevel(id) {
			p.skillLevels[id] = skillMaxLevel(id)
		}
	}
	if p.skillPoints < 0 {
		p.skillPoints = 0
	}
}

func skillMaxLevel(id string) int {
	if adminOnlySkills[id] {
		return 1
	}
	return maxSkillLevel
}

func skillLevel(p *Player, id string) int {
	normalizeSkillProgress(p)
	return p.skillLevels[id]
}

func upgradeSkill(p *Player, id string) bool {
	normalizeSkillProgress(p)
	if _, ok := skillMP[id]; !ok || !playerSkillAllowed(p, id) || p.skillPoints <= 0 || p.skillLevels[id] >= skillMaxLevel(id) {
		return false
	}
	if req := skillTree[id]; req != "" && p.skillLevels[req] < 2 {
		return false
	}
	p.skillLevels[id]++
	p.skillPoints--
	return true
}

func recalcMax(p *Player) {
	a := effectiveAttr(p)
	p.maxhp = 18 + p.lv*4 + a.Vit*4
	p.maxmp = 6 + p.lv*2 + a.Int*2
	if adminCheatEnabled(p, "infiniteVitals") {
		p.hp = float64(p.maxhp)
		p.mp = float64(p.maxmp)
		return
	}
	p.hp = math.Min(p.hp, float64(p.maxhp))
	p.mp = math.Min(p.mp, float64(p.maxmp))
}

func initHero(p *Player) {
	p.lv = 1
	p.attr = baseAttr
	if p.class == "" {
		p.class = "Knight"
	}
	if p.hair == "" {
		p.hair = defaultHair
	}
	if p.cloth == "" {
		p.cloth = defaultCloth
	}
	p.slots = defaultSlotsForClass("") // skill/item hotbar (keys 1-5)
	p.skillLevels = map[string]int{"fire": 1, "heal": 1, "spin": 1, "bolt": 1, "nova": 1, "supernova": 1}
	p.skillPoints = 0
	p.quests = map[string]QuestState{}
	p.bag = map[string]int{"potion": 3}
	p.equip = map[string]string{}
	p.autoloot = true
	recalcMax(p)
	p.hp = float64(p.maxhp)
	p.mp = float64(p.maxmp)
	normalizeQuests(p)
}

func validClass(class string) bool {
	for _, c := range characterClasses {
		if class == c {
			return true
		}
	}
	return false
}

func applyClassTemplate(p *Player, class string) {
	p.class = class
	p.attr = baseAttr
	p.slots = defaultSlotsForClass(class)
	switch class {
	case "Knight":
		p.attr.Str, p.attr.Vit = 4, 3
	case "Lancer":
		p.attr.Str, p.attr.Dex, p.attr.Agi = 3, 3, 2
	case "Wizard":
		p.attr.Mag, p.attr.Int = 4, 4
	case "Archer":
		p.attr.Dex, p.attr.Agi, p.attr.Luck = 4, 3, 2
	case "Vampire":
		p.attr.Str, p.attr.Mag, p.attr.Agi = 3, 3, 2
	case "Holy":
		p.attr.Int, p.attr.Vit, p.attr.Mag = 3, 3, 2
	}
	recalcMax(p)
	p.hp = float64(p.maxhp)
	p.mp = float64(p.maxmp)
}

func (h *Hub) setCharacter(p *Player, name, class string) {
	if !validName(name) || !validClass(class) {
		h.systemTo(p, "Choose a 1-16 character name and a valid class.")
		return
	}
	isFresh := p.name == "" && p.class == "" && p.lv <= 1 && p.exp == 0 && p.gold == 0 && p.kills == 0
	p.name = name
	if isFresh {
		applyClassTemplate(p, class)
	}
	p.class = class
	normalizeSlots(p)
	h.systemTo(p, "Character ready: "+p.displayName()+" the "+p.class+".")
}

// ---- melee (player -> enemy) ----------------------------------------------

// slashReaches: is the enemy inside the ~1-tile arc in front of the player?
func slashReaches(p *Player, dir string, en *enemy) bool {
	d := dirVec[dir]
	cx := float64((p.tx+d[0])*TS) + 8
	cy := float64((p.ty+d[1])*TS) + 8
	return math.Abs(en.px+8-cx) <= 13 && math.Abs(en.py+8-cy) <= 13
}

func faceToward(p *Player, en *enemy) string {
	dx, dy := en.px-p.px, en.py-p.py
	if math.Abs(dx) > math.Abs(dy) {
		if dx > 0 {
			return "right"
		}
		return "left"
	}
	if dy > 0 {
		return "down"
	}
	return "up"
}

// doSlash swings the sword: sets the attack cooldown and hits every enemy in the
// arc in front of the player.
func (h *Hub) doSlash(p *Player) {
	st := statsOf(p)
	p.atkCool = 1.0 / st.aspd
	for _, en := range h.enemies[p.mapID] {
		if en.dying > 0 || en.dead {
			continue
		}
		if slashReaches(p, p.dir, en) {
			h.meleeHit(p, en)
		}
	}
	h.pvpMeleeSweep(p, false) // also strike any hostile players in the arc
}

func (h *Hub) meleeHit(p *Player, en *enemy) {
	st := statsOf(p)
	if rand.Intn(100) >= st.prec {
		return // miss
	}
	dmg := st.atk + rand.Intn(4) - enemyKinds[en.kind].def
	if dmg < 1 {
		dmg = 1
	}
	h.hitEnemy(p, en, dmg, rand.Intn(100) < st.crit)
}

func (h *Hub) hitEnemy(p *Player, en *enemy, dmg int, crit bool) {
	if crit {
		dmg *= 2
	}
	en.hp -= dmg
	h.markCombat(p)
	en.flash = 0.3
	en.stun = 0.45
	en.hurtT = 0
	if en.hp <= 0 {
		h.killEnemy(p, en)
	}
}

func (h *Hub) killEnemy(p *Player, en *enemy) {
	en.dying = 0.45
	k := enemyKinds[en.kind]
	p.kills++
	h.advanceElderQuestKill(p)
	p.gold += k.gold
	p.logMsg(fmt.Sprintf("Defeated %s: +%d EXP, +%d gold", k.name, k.exp, k.gold))
	if rand.Float64() < 0.25 { // loot: autoloot pockets it, else it falls where it died
		id := "bread"
		if rand.Float64() >= 0.7 {
			id = "potion"
		}
		if p.autoloot && canCarryItem(p, id, 1) {
			addItem(p, id, 1)
			p.logMsg(fmt.Sprintf("Looted %s x1", itemName(id)))
		} else {
			if p.autoloot {
				warnCarryTooMuch(p)
			}
			h.dropFloor(p.mapID, id, 1, en.tx, en.ty)
		}
	}
	grantExp(p, k.exp)
	h.sharePartyExp(p, k.exp)
}

// grantExp adds experience and applies any level-ups it triggers.
func grantExp(p *Player, exp int) {
	p.exp += exp
	for p.exp >= expToNextLevel(p.lv) {
		p.exp -= expToNextLevel(p.lv)
		p.lv++
		p.points += attrPointsPerLevel
		p.skillPoints += skillPointsPerLevel
		normalizeSkillProgress(p)
		recalcMax(p)
		p.hp = float64(p.maxhp)
		p.mp = float64(p.maxmp)
		p.logMsg(fmt.Sprintf("LEVEL UP! Now Lv.%d  (+%d attribute points, +%d skill point)", p.lv, attrPointsPerLevel, skillPointsPerLevel))
	}
}

// ---- enemy -> player -------------------------------------------------------

func (h *Hub) attackHero(en *enemy, p *Player) {
	if p.dead {
		return
	}
	en.lunge = 0.22
	en.wait = 0.8 + rand.Float64()*0.4
	if adminCheatEnabled(p, "invulnerable") {
		return
	}
	if adminCheatEnabled(p, "infiniteVitals") {
		p.hp = float64(p.maxhp)
		p.mp = float64(p.maxmp)
		return
	}
	if p.iframes > 0 {
		return
	}
	st := statsOf(p)
	if rand.Intn(100) < st.dodge {
		return // dodged
	}
	guard := st.end
	if en.kind == "ghost" { // ghosts strike with magic
		guard = st.mend
	}
	dmg := enemyKinds[en.kind].atk + rand.Intn(3) - 1 - guard/2
	if dmg < 1 {
		dmg = 1
	}
	p.hp -= float64(dmg)
	h.markCombat(p)
	p.iframes = 1
	if p.hp <= 0 {
		h.playerDie(p, enemyKinds[en.kind].name)
	}
}

// Death leaves your pack where you fell and waits for an explicit respawn.
func (h *Hub) playerDie(p *Player, cause string) {
	if p.dead {
		return
	}
	fellMap, fellTx, fellTy := p.mapID, p.tx, p.ty
	p.logMsg(fmt.Sprintf("You died at %s on %s (%d,%d). Killed by %s.",
		time.Now().Format("15:04:05"), fellMap, fellTx, fellTy, cause))
	h.dropCorpse(fellMap, fellTx, fellTy, p, p.bag)
	p.bag = map[string]int{}
	p.moving = false
	p.hp = 0
	p.dead = true
	p.deathCause = cause
	p.moveDir = ""
	clearPath(p)
	p.lockID = 0
	p.pvpTarget = ""
	p.followTarget = ""
	p.follow, p.followEngaged = false, false
	p.combatLogoutT = 0
}

func (h *Hub) respawnPlayer(p *Player) {
	if !p.dead {
		return
	}
	p.mapID = spawn.mapID
	p.tx, p.ty = spawn.tx, spawn.ty
	p.px, p.py = float64(p.tx*TS), float64(p.ty*TS)
	p.moving = false
	p.hp = float64(p.maxhp)
	p.mp = float64(p.maxmp)
	p.dir = "down"
	p.iframes = 2
	p.dead = false
	p.deathCause = ""
	p.moveDir = ""
	clearPath(p)
	p.lockID = 0
	p.pvpTarget = ""
	p.followTarget = ""
	p.follow, p.followEngaged = false, false
	p.combatLogoutT = 0
}

// ---- lock-on ---------------------------------------------------------------

func (h *Hub) enemyByID(mapID string, id int) *enemy {
	if id == 0 {
		return nil
	}
	for _, en := range h.enemies[mapID] {
		if en.id == id {
			return en
		}
	}
	return nil
}

// enemyAtPoint: the enemy whose 24x32 sprite box contains a world point.
func (h *Hub) enemyAtPoint(mapID string, x, y float64) int {
	for _, en := range h.enemies[mapID] {
		if en.dying > 0 || en.dead {
			continue
		}
		if x >= en.px-4 && x < en.px+20 && y >= en.py-16 && y < en.py+16 {
			return en.id
		}
	}
	return 0
}

// cycleLock targets the nearest living enemy, then the next-nearest on repeat.
func (h *Hub) cycleLock(p *Player) {
	list := h.enemies[p.mapID]
	best, bestD := 0, math.Inf(1)
	var second int
	secondD := math.Inf(1)
	for _, en := range list {
		if en.dying > 0 || en.dead {
			continue
		}
		d := math.Hypot(en.px-p.px, en.py-p.py)
		if d < bestD {
			secondD, second = bestD, best
			bestD, best = d, en.id
		} else if d < secondD {
			secondD, second = d, en.id
		}
	}
	if p.lockID == best && second != 0 {
		p.lockID = second
	} else {
		p.lockID = best
	}
	p.pvpTarget = ""
	p.followTarget = ""
	p.follow, p.followEngaged = false, false
}

// autoMelee: while locked on and off cooldown, the sword strikes by itself when
// the target is in reach (ported from advanceWorld's auto-melee).
func (h *Hub) autoMelee(p *Player) {
	en := h.enemyByID(p.mapID, p.lockID)
	if en == nil || en.dead || en.dying > 0 {
		p.lockID = 0
		return
	}
	if p.atkCool <= 0 {
		dir := faceToward(p, en)
		if slashReaches(p, dir, en) {
			p.dir = dir
			h.doSlash(p)
		}
	}
}
