package main

// Server-authoritative items (Phase 2d): the bag, the paper-doll, and the rules
// for equipping/using gear. Only the mechanical fields live here — the client
// keeps names/icons/descriptions in sim.js's ITEMS, keyed by the same ids. Equip
// bonuses feed statsOf() in combat.go, so a sharper sword really does hit harder.

type item struct {
	w                           float64 // weight (kg)
	heal                        int     // HP restored when used (0 = not food)
	slot                        string  // body slot: head/main/off/torso/legs/boots/acc ("" = not gear)
	atk, def, mdef, dodge, crit int
	twoH                        bool   // needs both hands (kicks out the shield)
	weaponType                  string // bow, etc
	price                       int    // shop price (used from the shop step)
}

var items = map[string]item{
	"bread":  {w: 0.4, heal: 8, price: 10},
	"meat":   {w: 0.8, heal: 25, price: 35},
	"potion": {w: 0.5, heal: 15, price: 25},
	"sword1": {w: 3, slot: "main", atk: 2, price: 60},
	"sword2": {w: 5, slot: "main", atk: 5, price: 150},
	"sword3": {w: 8, slot: "main", atk: 9, twoH: true, price: 340},
	"bow1":   {w: 2.5, slot: "main", atk: 4, twoH: true, weaponType: "bow", price: 100},
	"shield": {w: 4, slot: "off", def: 2, price: 90},
	"hat":    {w: 0.5, slot: "head", def: 1, price: 40},
	"helm":   {w: 3, slot: "head", def: 3, price: 180},
	"armor":  {w: 7, slot: "torso", def: 4, price: 260},
	"legs":   {w: 4, slot: "legs", def: 2, price: 120},
	"boots":  {w: 1.5, slot: "boots", dodge: 3, price: 110},
	"ring":   {w: 0.1, slot: "acc", crit: 5, price: 200},
	"amulet": {w: 0.2, slot: "acc", mdef: 3, price: 200},
	"arrow1": {w: 0.05, price: 5, slot: "ammo"},
	"arrow2": {w: 0.05, price: 10, slot: "ammo"},
	"arrow3": {w: 0.05, price: 20, slot: "ammo"},
}

var itemNames = map[string]string{
	"bread":  "Bread",
	"meat":   "Meat",
	"potion": "Potion",
	"sword1": "Bronze Sword",
	"sword2": "Iron Sword",
	"sword3": "Claymore",
	"bow1":   "Short Bow",
	"shield": "Buckler",
	"hat":    "Felt Hat",
	"helm":   "Iron Helm",
	"armor":  "Breastplate",
	"legs":   "Greaves",
	"boots":  "Swift Boots",
	"ring":   "Lucky Ring",
	"amulet": "Ward Amulet",
	"arrow1": "Bronze Arrow",
	"arrow2": "Iron Arrow",
	"arrow3": "Steel Arrow",
}

func itemName(id string) string {
	if name, ok := itemNames[id]; ok {
		return name
	}
	return id
}

const carryTooMuchMsg = "You're carrying too much weight already."

func itemStackWeight(id string, n int) (float64, bool) {
	it, ok := items[id]
	if !ok {
		return 0, false
	}
	return it.w * float64(n), true
}

func canCarryItem(p *Player, id string, n int) bool {
	if n <= 0 {
		return true
	}
	if adminCheatEnabled(p, "infiniteWeight") {
		return true
	}
	w, ok := itemStackWeight(id, n)
	return ok && bagWeight(p)+w <= capacity(p)
}

func canCarryStacks(p *Player, stacks map[string]int) bool {
	if adminCheatEnabled(p, "infiniteWeight") {
		return true
	}
	w := bagWeight(p)
	for id, n := range stacks {
		add, ok := itemStackWeight(id, n)
		if !ok {
			return false
		}
		w += add
	}
	return w <= capacity(p)
}

func warnCarryTooMuch(p *Player) {
	p.logMsg(carryTooMuchMsg)
}

var bodySlots = []string{"head", "main", "torso", "off", "legs", "acc1", "boots", "acc2"}

// shop stock (the client opens the shop UI; the server validates the purchase).
var shops = map[string][]string{
	"smith":  {"sword1", "sword2", "sword3", "bow1", "shield", "hat", "helm", "armor", "legs"},
	"grocer": {"bread", "meat", "potion", "boots", "ring", "amulet"},
}

// shopBuy sells item id from shop `who` if the player can afford it and it's
// actually in that shop's stock, so gold and inventory can't be forged.
func shopHasStock(who, id string) bool {
	for _, s := range shops[who] {
		if s == id {
			return true
		}
	}
	return false
}

func shopBuy(p *Player, who, id string, n int) {
	it, ok := items[id]
	if !ok || !shopHasStock(who, id) {
		return
	}
	if n <= 0 {
		n = 1
	}
	price := it.price * n
	if p.gold < price {
		return
	}
	if !canCarryItem(p, id, n) {
		warnCarryTooMuch(p)
		return
	}
	p.gold -= price
	addItem(p, id, n)
}

func shopSell(p *Player, id string, n int) {
	it, ok := items[id]
	if !ok {
		return
	}
	if n <= 0 {
		n = 1
	}
	if p.bag[id] < n {
		return
	}
	removeItem(p, id, n)
	p.gold += it.price * n
}

func addItem(p *Player, id string, n int) { p.bag[id] += n }

func removeItem(p *Player, id string, n int) {
	p.bag[id] -= n
	if p.bag[id] <= 0 {
		delete(p.bag, id)
	}
}

// canPlace: does item id fit body slot? ('acc' items take either accessory slot)
func canPlace(id, slot string) bool {
	it := items[id]
	want := it.slot
	if want == "" {
		return false
	}
	if want == "acc" {
		return slot == "acc1" || slot == "acc2"
	}
	if want == "main" {
		return slot == "main" || (!it.twoH && slot == "off")
	}
	return want == slot
}

// slotFor: the natural slot for a keyboard/double-click equip.
func slotFor(p *Player, id string) string {
	it := items[id]
	if it.slot == "acc" {
		if p.equip["acc1"] == "" {
			return "acc1"
		}
		return "acc2"
	}
	if it.slot == "main" && !it.twoH && p.equip["main"] != "" {
		return "off"
	}
	return it.slot
}

func unequipSlot(p *Player, slot string) {
	id := p.equip[slot]
	if id == "" {
		return
	}
	delete(p.equip, slot)
	if items[id].slot != "ammo" {
		addItem(p, id, 1)
	}
}

func equipTo(p *Player, id, slot string) bool {
	if !canPlace(id, slot) || p.bag[id] <= 0 {
		return false
	}
	if items[id].twoH { // both hands on a two-hander
		unequipSlot(p, "main")
		unequipSlot(p, "off")
	}
	if slot == "off" && p.equip["main"] != "" && items[p.equip["main"]].twoH {
		unequipSlot(p, "main")
	}
	unequipSlot(p, slot)
	if items[id].slot != "ammo" {
		removeItem(p, id, 1)
	}
	if p.equip == nil {
		p.equip = map[string]string{}
	}
	p.equip[slot] = id
	return true
}

func normalizeEquipment(p *Player) {
	if p.equip == nil {
		p.equip = map[string]string{}
	}
	if p.bag == nil {
		p.bag = map[string]int{}
	}
	for slot, id := range p.equip {
		if id == "" {
			delete(p.equip, slot)
			continue
		}
		if _, ok := items[id]; !ok {
			delete(p.equip, slot)
			continue
		}
		if canPlace(id, slot) {
			continue
		}
		delete(p.equip, slot)
		natural := slotFor(p, id)
		if natural != "" && p.equip[natural] == "" && canPlace(id, natural) {
			p.equip[natural] = id
		} else {
			addItem(p, id, 1)
		}
	}
}

// useItem: eat food or equip gear. Returns true if something happened.
func useItem(p *Player, id string) bool {
	it := items[id]
	if p.bag[id] <= 0 {
		return false
	}
	if it.heal > 0 {
		if p.hp >= float64(p.maxhp) {
			return false
		}
		p.hp = min(p.hp+float64(it.heal), float64(p.maxhp))
		removeItem(p, id, 1)
		return true
	}
	if it.slot != "" {
		return equipTo(p, id, slotFor(p, id))
	}
	return false
}

// carry weight: worn gear is free; over capacity you trudge at half speed.
func bagWeight(p *Player) float64 {
	w := 0.0
	for id, n := range p.bag {
		w += items[id].w * float64(n)
	}
	return w
}

func capacity(p *Player) float64 {
	if adminCheatEnabled(p, "infiniteWeight") {
		return 999999
	}
	return 15 + float64(p.lv*2) + float64(effectiveAttr(p).Str*2)
}

func overloaded(p *Player) bool {
	return !adminCheatEnabled(p, "infiniteWeight") && bagWeight(p) > capacity(p)
}

// equipBonus sums the worn gear's contribution to the derived stats.
func equipBonus(p *Player) derived {
	var b derived
	for _, id := range p.equip {
		if id == "" {
			continue
		}
		it := items[id]
		b.atk += it.atk
		b.end += it.def
		b.mend += it.mdef
		b.dodge += it.dodge
		b.crit += it.crit
	}
	return b
}
