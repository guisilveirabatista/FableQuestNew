package main

import (
	"fmt"
	"math"
	"strings"
)

var adminUsers = map[string]bool{}
var adminCheatNames = map[string]string{
	"invulnerable":             "invulnerable",
	"infiniteweight":           "infiniteWeight",
	"infinite_weight":          "infiniteWeight",
	"infinite_weight_capacity": "infiniteWeight",
	"weight":                   "infiniteWeight",
	"infinitehealth":           "infiniteVitals",
	"infinite_health":          "infiniteVitals",
	"infinitehp":               "infiniteVitals",
	"infinite_hp":              "infiniteVitals",
	"infinite_mp":              "infiniteVitals",
	"infinite_mana":            "infiniteVitals",
	"infinitevitals":           "infiniteVitals",
	"infinite_vitals":          "infiniteVitals",
	"infinite_health_and_mp":   "infiniteVitals",
	"hpmp":                     "infiniteVitals",
	"vitals":                   "infiniteVitals",
	"maxattributes":            "maxAttributes",
	"max_attributes":           "maxAttributes",
	"attributes":               "maxAttributes",
	"attrs":                    "maxAttributes",
	"maxstats":                 "maxStats",
	"max_stats":                "maxStats",
	"maxed_out_stats":          "maxStats",
	"stats":                    "maxStats",
	"allskills":                "allSkills",
	"all_skills":               "allSkills",
	"all_skills_available":     "allSkills",
	"skills":                   "allSkills",
	"superspeed":               "superSpeed",
	"super_speed":              "superSpeed",
	"speed":                    "superSpeed",
}

func configureAdmins(csv string) {
	adminUsers = map[string]bool{}
	for _, part := range strings.Split(csv, ",") {
		name := strings.TrimSpace(part)
		if name != "" {
			adminUsers[strings.ToLower(name)] = true
		}
	}
}

func isAdminUser(user string) bool {
	return adminUsers[strings.ToLower(strings.TrimSpace(user))]
}

func (p *Player) isAdmin() bool {
	return p != nil && p.admin && isAdminUser(p.username)
}

func (h *Hub) requireAdmin(p *Player) bool {
	if p != nil && p.isAdmin() {
		return true
	}
	if p != nil {
		h.systemTo(p, "Admin only.")
	}
	return false
}

func normalizeCheatName(name string) string {
	key := strings.ToLower(strings.TrimSpace(name))
	if key == "" {
		return ""
	}
	key = strings.ReplaceAll(key, "-", "_")
	key = strings.Join(strings.Fields(key), "_")
	if v, ok := adminCheatNames[key]; ok {
		return v
	}
	return ""
}

func adminCheatEnabled(p *Player, key string) bool {
	if p == nil {
		return false
	}
	switch key {
	case "invulnerable":
		return p.cheats.Invulnerable
	case "infiniteWeight":
		return p.cheats.InfiniteWeight
	case "infiniteVitals":
		return p.cheats.InfiniteVitals
	case "maxAttributes":
		return p.cheats.MaxAttributes
	case "maxStats":
		return p.cheats.MaxStats
	case "allSkills":
		return p.cheats.AllSkills
	case "superSpeed":
		return p.cheats.SuperSpeed
	default:
		return false
	}
}

func setAdminCheat(p *Player, key string, enabled bool) {
	switch key {
	case "invulnerable":
		p.cheats.Invulnerable = enabled
	case "infiniteWeight":
		p.cheats.InfiniteWeight = enabled
	case "infiniteVitals":
		p.cheats.InfiniteVitals = enabled
	case "maxAttributes":
		p.cheats.MaxAttributes = enabled
	case "maxStats":
		p.cheats.MaxStats = enabled
	case "allSkills":
		p.cheats.AllSkills = enabled
	case "superSpeed":
		p.cheats.SuperSpeed = enabled
	}
}

func writeChat(c netConn, lines ...chatLine) {
	if c == nil || len(lines) == 0 {
		return
	}
	writeJSON(c, chatMsg{T: "chat", Chat: lines})
}

func adminSystemLine(text string) chatLine {
	return chatLine{Scope: "system", Text: text}
}

func announcementLine(text string) chatLine {
	return chatLine{From: "Admin", Scope: "announcement", Text: text}
}

func currentBanLists() *banListView {
	if store == nil {
		return nil
	}
	lists, err := store.ListBans()
	if err != nil {
		return &banListView{}
	}
	return &lists
}

func adminBanListsFor(p *Player) *banListView {
	if p == nil || !p.isAdmin() {
		return nil
	}
	return currentBanLists()
}

func (h *Hub) broadcastAnnouncement(text string) {
	line := announcementLine(text)
	for _, o := range h.players {
		o.pushChat(line)
	}
}

func (h *Hub) adminAnnounce(p *Player, text string) {
	if !h.requireAdmin(p) {
		return
	}
	text = sanitizeChat(text)
	if text == "" {
		h.systemTo(p, "Announcement text is empty.")
		return
	}
	h.broadcastAnnouncement(text)
}

func (h *Hub) adminBanAccount(p *Player, target string) {
	if !h.requireAdmin(p) {
		return
	}
	target = strings.TrimSpace(target)
	if !validName(target) {
		h.systemTo(p, "Choose a valid account name.")
		return
	}
	if strings.EqualFold(target, p.username) {
		h.systemTo(p, "You cannot ban your own account.")
		return
	}
	if store == nil {
		h.systemTo(p, "No store is available for bans.")
		return
	}
	if err := store.SetAccountBan(target, true); err != nil {
		h.systemTo(p, "Could not ban account.")
		return
	}
	if o := h.players[target]; o != nil {
		h.systemTo(o, "Your account has been banned.")
		if o.conn != nil {
			o.conn.Close()
		}
	}
	h.systemTo(p, "Banned account "+target+".")
}

func (h *Hub) adminUnbanAccount(p *Player, target string) {
	if !h.requireAdmin(p) {
		return
	}
	target = strings.TrimSpace(target)
	if !validName(target) {
		h.systemTo(p, "Choose a valid account name.")
		return
	}
	if store == nil {
		h.systemTo(p, "No store is available for bans.")
		return
	}
	if err := store.SetAccountBan(target, false); err != nil {
		h.systemTo(p, "Could not unban account.")
		return
	}
	h.systemTo(p, "Unbanned account "+target+".")
}

func (h *Hub) adminBanCharacter(p *Player, target, name string) {
	if !h.requireAdmin(p) {
		return
	}
	target, name = strings.TrimSpace(target), strings.TrimSpace(name)
	if !validName(target) || !validName(name) {
		h.systemTo(p, "Choose a valid account and character name.")
		return
	}
	if strings.EqualFold(target, p.username) && strings.EqualFold(name, p.name) {
		h.systemTo(p, "You cannot ban the character you are using.")
		return
	}
	if store == nil {
		h.systemTo(p, "No store is available for bans.")
		return
	}
	if err := store.SetCharacterBan(target, name, true); err != nil {
		h.systemTo(p, "Could not ban character.")
		return
	}
	if o := h.players[target]; o != nil && strings.EqualFold(o.name, name) {
		h.systemTo(o, "This character has been banned.")
		if o.conn != nil {
			o.conn.Close()
		}
	}
	h.systemTo(p, "Banned character "+target+"/"+name+".")
}

func (h *Hub) adminUnbanCharacter(p *Player, target, name string) {
	if !h.requireAdmin(p) {
		return
	}
	target, name = strings.TrimSpace(target), strings.TrimSpace(name)
	if !validName(target) || !validName(name) {
		h.systemTo(p, "Choose a valid account and character name.")
		return
	}
	if store == nil {
		h.systemTo(p, "No store is available for bans.")
		return
	}
	if err := store.SetCharacterBan(target, name, false); err != nil {
		h.systemTo(p, "Could not unban character.")
		return
	}
	h.systemTo(p, "Unbanned character "+target+"/"+name+".")
}

func validTeleportTile(mapID string, tx, ty int) bool {
	return maps[mapID] != nil && tx >= 0 && tx < MW && ty >= 0 && ty < MH && !blocked(mapID, tx, ty)
}

func (h *Hub) adminPlacePlayer(p *Player, mapID string, tx, ty int) {
	p.moveDir = ""
	p.lockID = 0
	p.pvpTarget = ""
	p.followTarget = ""
	p.follow, p.followEngaged = false, false
	clearPath(p)
	if h.ownedMaps != nil && !h.ownsMap(mapID) {
		p.pendingHandoff = &exit{to: mapID, tx: tx, ty: ty}
		return
	}
	p.mapID, p.tx, p.ty = mapID, tx, ty
	p.px, p.py = float64(tx*TS), float64(ty*TS)
	p.moving = false
}

func (h *Hub) adminTeleport(p *Player, m inMsg) {
	if !h.requireAdmin(p) {
		return
	}
	target := strings.TrimSpace(m.Target)
	if target != "" && strings.TrimSpace(m.Map) == "" {
		if o := h.findPlayerByName(target); o != nil {
			h.adminPlacePlayer(p, o.mapID, o.tx, o.ty)
			h.systemTo(p, "Teleported to "+o.displayName()+".")
			return
		}
		h.systemTo(p, "Player not found.")
		return
	}
	mapID := strings.TrimSpace(m.Map)
	if mapID == "" {
		mapID = p.mapID
	}
	tx, ty := m.Tx, m.Ty
	if !validTeleportTile(mapID, tx, ty) {
		h.systemTo(p, "That teleport tile is blocked or invalid.")
		return
	}
	h.adminPlacePlayer(p, mapID, tx, ty)
	h.systemTo(p, fmt.Sprintf("Teleported to %s (%d,%d).", mapID, tx, ty))
}

func (h *Hub) adminGrantItem(p *Player, id string, n int) {
	if !h.requireAdmin(p) {
		return
	}
	id = strings.TrimSpace(id)
	if _, ok := items[id]; !ok {
		lowerId := strings.ToLower(id)
		found := false
		for k, v := range itemNames {
			if strings.ToLower(v) == lowerId {
				id = k
				found = true
				break
			}
		}
		if !found {
			h.systemTo(p, "Unknown item.")
			return
		}
	}
	n = clampInt(n, 1, 9999)
	addItem(p, id, n)
	h.systemTo(p, fmt.Sprintf("Created %s x%d.", itemName(id), n))
}

func clampStat(v int) int { return clampInt(v, 1, 99) }

func (h *Hub) adminEditSelf(p *Player, m inMsg) {
	if !h.requireAdmin(p) {
		return
	}
	if m.Class != "" {
		if !validClass(m.Class) {
			h.systemTo(p, "Unknown class.")
			return
		}
		p.class = m.Class
	}
	if m.Level != nil {
		p.lv = clampInt(*m.Level, 1, 99)
	}
	if m.GoldSet != nil {
		p.gold = clampInt(*m.GoldSet, 0, 999999)
	}
	if m.PointsSet != nil {
		p.points = clampInt(*m.PointsSet, 0, 999)
	}
	if m.SkillPointsSet != nil {
		p.skillPoints = clampInt(*m.SkillPointsSet, 0, 999)
	}
	if m.Attr != nil {
		p.attr = AttrSet{
			Agi: clampStat(m.Attr.Agi), Int: clampStat(m.Attr.Int), Vit: clampStat(m.Attr.Vit),
			Str: clampStat(m.Attr.Str), Dex: clampStat(m.Attr.Dex), Mag: clampStat(m.Attr.Mag), Luck: clampStat(m.Attr.Luck),
		}
	}
	normalizeSkillProgress(p)
	for id, lv := range m.SkillLv {
		if _, ok := skillMP[id]; ok {
			p.skillLevels[id] = clampInt(lv, 1, skillMaxLevel(id))
		}
	}
	normalizeSlots(p)
	recalcMax(p)
	if m.HPSet != nil {
		p.hp = math.Max(1, math.Min(float64(p.maxhp), *m.HPSet))
	} else if p.hp <= 0 {
		p.hp = float64(p.maxhp)
	}
	if m.MPSet != nil {
		p.mp = math.Max(0, math.Min(float64(p.maxmp), *m.MPSet))
	}
	h.systemTo(p, "Character updated.")
}

func (h *Hub) adminSummon(p *Player, m inMsg) {
	if !h.requireAdmin(p) {
		return
	}
	kind := strings.TrimSpace(m.Id)
	k, ok := enemyKinds[kind]
	if !ok {
		h.systemTo(p, "Unknown monster.")
		return
	}
	mapID := strings.TrimSpace(m.Map)
	if mapID == "" {
		mapID = p.mapID
	}
	tx, ty := m.Tx, m.Ty
	if tx == 0 && ty == 0 {
		tx, ty = p.tx, p.ty
	}
	if maps[mapID] == nil {
		h.systemTo(p, "Unknown map.")
		return
	}
	n := clampInt(m.N, 1, 50)
	spawned := 0
	for _, t := range nearbyTiles(tx, ty, n) {
		if blocked(mapID, t.x, t.y) || enemyAt(h.enemies[mapID], t.x, t.y, nil) {
			continue
		}
		h.nextEID++
		h.enemies[mapID] = append(h.enemies[mapID], &enemy{
			id: h.nextEID, kind: kind, tx: t.x, ty: t.y, px: float64(t.x * TS), py: float64(t.y * TS),
			dir: "down", anim: 1, wait: 0.1, hp: k.hp, maxhp: k.hp, hurtT: 9, summoned: true,
		})
		spawned++
		if spawned >= n {
			break
		}
	}
	h.systemTo(p, fmt.Sprintf("Summoned %d %s.", spawned, k.name))
}

func (h *Hub) adminSetCheat(p *Player, name string, enabled bool) {
	if !h.requireAdmin(p) {
		return
	}
	key := normalizeCheatName(name)
	if key == "" {
		h.systemTo(p, "Unknown cheat.")
		return
	}
	setAdminCheat(p, key, enabled)
	if key == "maxStats" || key == "maxAttributes" {
		recalcMax(p)
		if enabled || adminCheatEnabled(p, "infiniteVitals") {
			p.hp = float64(p.maxhp)
			p.mp = float64(p.maxmp)
		}
	}
	if key == "infiniteVitals" && enabled {
		p.hp = float64(p.maxhp)
		p.mp = float64(p.maxmp)
	}
	if key == "allSkills" {
		normalizeSlots(p)
		normalizeSkillProgress(p)
	}
	state := "disabled"
	if enabled {
		state = "enabled"
	}
	h.systemTo(p, "Cheat "+key+" "+state+".")
}

func nearbyTiles(cx, cy, limit int) []tile {
	out := []tile{{cx, cy}}
	for r := 1; len(out) < limit*4+16 && r < MW+MH; r++ {
		for y := cy - r; y <= cy+r; y++ {
			for x := cx - r; x <= cx+r; x++ {
				if x < 0 || x >= MW || y < 0 || y >= MH {
					continue
				}
				if abs(x-cx)+abs(y-cy) == r {
					out = append(out, tile{x, y})
				}
			}
		}
	}
	return out
}
