package main

// Floor loot and corpses (Phase 2d-rest), ported from sim.js. Dropped items and
// the packs of the fallen are shared, server-owned world entities: anyone can
// walk up and take them, and it's the server that decides who gets what.

type floorItem struct {
	id     string
	n      int
	tx, ty int
}

type corpse struct {
	tx, ty int
	items  map[string]int
}

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
			got = true
			continue
		}
		kept = append(kept, f)
	}
	h.floor[p.mapID] = kept
	return got
}

// dropCorpse turns a dead player's whole bag into a corpse at the fall site.
func (h *Hub) dropCorpse(mapID string, tx, ty int, bag map[string]int) {
	items := map[string]int{}
	for id, n := range bag {
		if n > 0 {
			items[id] = n
		}
	}
	if len(items) == 0 {
		return
	}
	h.corpses[mapID] = append(h.corpses[mapID], &corpse{tx, ty, items})
	if len(h.corpses[mapID]) > 8 { // the field tidies itself
		h.corpses[mapID] = h.corpses[mapID][1:]
	}
}

// takeCorpse empties a nearby corpse into the player's bag.
func (h *Hub) takeCorpse(p *Player, tx, ty int) bool {
	list := h.corpses[p.mapID]
	for i, c := range list {
		if c.tx == tx && c.ty == ty && near(p, tx, ty) {
			for id, n := range c.items {
				addItem(p, id, n)
			}
			h.corpses[p.mapID] = append(list[:i], list[i+1:]...)
			return true
		}
	}
	return false
}
