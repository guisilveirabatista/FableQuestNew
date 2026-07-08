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
	tx, ty  int
	name    string
	items   map[string]int
	age     float64
	decayed bool
}

const (
	corpseDecaySeconds = 10 * 60
	maxDecayedCorpses  = 24
)

func (h *Hub) dropFloor(mapID, id string, n, tx, ty int) {
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

// pickupAt gathers every floor stack on a tile into the player's bag, if in reach.
func (h *Hub) pickupAt(p *Player, tx, ty int) bool {
	if !near(p, tx, ty) {
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

// dropCorpse turns a dead player's whole bag into a corpse at the fall site.
// Even an empty pack leaves a body, so players can still open it until decay.
func (h *Hub) dropCorpse(mapID string, tx, ty int, name string, bag map[string]int) {
	items := map[string]int{}
	for id, n := range bag {
		if n > 0 {
			items[id] = n
		}
	}
	h.corpses[mapID] = append(h.corpses[mapID], &corpse{tx: tx, ty: ty, name: name, items: items})
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
				addItem(p, want, n)
				p.logMsg(fmt.Sprintf("Looted %s x%d", itemName(want), n))
				delete(c.items, want)
				return true
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
