package main

// Floor loot and corpses (Phase 2d-rest), ported from sim.js. Dropped items and
// the packs of the fallen are shared, server-owned world entities: anyone can
// walk up and take them, and it's the server that decides who gets what.

import "fmt"

type floorItem struct {
	id     string
	n      int
	tx, ty int
}

type corpse struct {
	tx, ty             int
	name               string
	class, hair, cloth, gender string
	items              map[string]int
	age                float64
	decayed            bool
}

const (
	corpseDecaySeconds = 10 * 60
	maxDecayedCorpses  = 24
)

func (h *Hub) dropFloor(mapID, id string, n, tx, ty int) {
	if waterTile(mapID, tx, ty) && isConsumable(id) {
		return
	}
	for _, f := range h.floor[mapID] {
		if f.id == id && f.tx == tx && f.ty == ty {
			f.n += n
			return
		}
	}
	h.floor[mapID] = append(h.floor[mapID], &floorItem{id, n, tx, ty})
}

// near: same tile or one step away (loot reach), matching sim.js nearHero.
func near(p *Player, tx, ty int) bool {
	return abs(tx-p.tx) <= 1 && abs(ty-p.ty) <= 1
}

func lootDropTileAllowed(mapID string, tx, ty int) bool {
	return !blocked(mapID, tx, ty)
}

func waterTile(mapID string, tx, ty int) bool {
	if tx < 0 || ty < 0 || tx >= MW || ty >= MH {
		return false
	}
	m := maps[mapID]
	return m != nil && m.ground[ty][tx] == 'W'
}

func corpseDropTileAllowed(mapID string, tx, ty int) bool {
	return !blocked(mapID, tx, ty) || waterTile(mapID, tx, ty)
}

func inPlayerView(p *Player, tx, ty int) bool {
	if p.aoiW <= 0 || p.aoiH <= 0 {
		return true
	}
	return abs(tx-p.tx) <= p.aoiW && abs(ty-p.ty) <= p.aoiH
}

// pickupAt gathers every floor stack on a tile into the player's bag, if in reach.
func (h *Hub) pickupAt(p *Player, tx, ty int) bool {
	if !near(p, tx, ty) {
		return false
	}
	stacks := map[string]int{}
	for _, f := range h.floor[p.mapID] {
		if f.tx == tx && f.ty == ty {
			stacks[f.id] += f.n
		}
	}
	if len(stacks) == 0 {
		return false
	}
	if !canCarryStacks(p, stacks) {
		warnCarryTooMuch(p)
		return false
	}
	got := false
	kept := h.floor[p.mapID][:0]
	for _, f := range h.floor[p.mapID] {
		if f.tx == tx && f.ty == ty {
			addItem(p, f.id, f.n)
			p.logMsg(fmt.Sprintf("Looted %s x%d", itemName(f.id), f.n))
			got = true
			continue
		}
		kept = append(kept, f)
	}
	h.floor[p.mapID] = kept
	return got
}

func (h *Hub) moveFloorItem(p *Player, fromTx, fromTy, toTx, toTy int, want string) bool {
	if !near(p, fromTx, fromTy) || !inPlayerView(p, toTx, toTy) {
		return false
	}
	list := h.floor[p.mapID]
	for i, f := range list {
		if f.tx != fromTx || f.ty != fromTy || (want != "" && f.id != want) || f.n <= 0 {
			continue
		}
		if fromTx == toTx && fromTy == toTy {
			return true
		}
		isWater := waterTile(p.mapID, toTx, toTy)
		isConsumable := isConsumable(f.id)
		if !lootDropTileAllowed(p.mapID, toTx, toTy) && !(isWater && isConsumable) {
			return false
		}
		id, n := f.id, f.n
		h.floor[p.mapID] = append(list[:i], list[i+1:]...)
		if !(isWater && isConsumable) {
			h.dropFloor(p.mapID, id, n, toTx, toTy)
		}
		return true
	}
	return false
}

// dropCorpse turns a dead player's whole bag into a corpse at the fall site.
// Even an empty pack leaves a body, so players can still open it until decay.
func (h *Hub) dropCorpse(mapID string, tx, ty int, owner *Player, bag map[string]int) {
	items := map[string]int{}
	for id, n := range bag {
		if n > 0 {
			items[id] = n
		}
	}
	name, class, hair, cloth, gender := "Hero", "Knight", defaultHair, defaultCloth, "male"
	if owner != nil {
		name = owner.displayName()
		if owner.class != "" {
			class = owner.class
		}
		if owner.hair != "" {
			hair = owner.hair
		}
		if owner.cloth != "" {
			cloth = owner.cloth
		}
		if owner.gender != "" {
			gender = owner.gender
		}
	}
	h.corpses[mapID] = append(h.corpses[mapID], &corpse{
		tx: tx, ty: ty, name: name, class: class, hair: hair, cloth: cloth, gender: gender, items: items,
	})
}

func (h *Hub) moveCorpse(p *Player, fromTx, fromTy, toTx, toTy int) bool {
	if !near(p, fromTx, fromTy) || !corpseDropTileAllowed(p.mapID, toTx, toTy) || !inPlayerView(p, toTx, toTy) {
		return false
	}
	list := h.corpses[p.mapID]
	for i, c := range list {
		if c.tx == fromTx && c.ty == fromTy {
			if waterTile(p.mapID, toTx, toTy) {
				h.corpses[p.mapID] = append(list[:i], list[i+1:]...)
				return true
			}
			c.tx = toTx
			c.ty = toTy
			return true
		}
	}
	return false
}

func (h *Hub) updateCorpses(dt float64) {
	for mapID, list := range h.corpses {
		decayed := 0
		for _, c := range list {
			c.age += dt
			if !c.decayed && c.age >= corpseDecaySeconds {
				c.decayed = true
				c.items = map[string]int{}
			}
			if c.decayed {
				decayed++
			}
		}
		if decayed <= maxDecayedCorpses {
			continue
		}
		kept := list[:0]
		drop := decayed - maxDecayedCorpses
		for _, c := range list {
			if c.decayed && drop > 0 {
				drop--
				continue
			}
			kept = append(kept, c)
		}
		h.corpses[mapID] = kept
	}
}

// takeCorpse moves a nearby, undecayed corpse's whole pack or one requested item
// into the player's bag.
func (h *Hub) takeCorpse(p *Player, tx, ty int, want string) bool {
	list := h.corpses[p.mapID]
	for _, c := range list {
		if c.tx == tx && c.ty == ty && !c.decayed && near(p, tx, ty) {
			if want != "" && want != "*" {
				n := c.items[want]
				if n <= 0 {
					return false
				}
				if !canCarryItem(p, want, n) {
					warnCarryTooMuch(p)
					return false
				}
				addItem(p, want, n)
				p.logMsg(fmt.Sprintf("Looted %s x%d", itemName(want), n))
				delete(c.items, want)
				return true
			}
			if !canCarryStacks(p, c.items) {
				warnCarryTooMuch(p)
				return false
			}
			for id, n := range c.items {
				addItem(p, id, n)
				p.logMsg(fmt.Sprintf("Looted %s x%d", itemName(id), n))
			}
			c.items = map[string]int{}
			return true
		}
	}
	return false
}
