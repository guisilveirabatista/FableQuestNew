package main

import "fmt"

const (
	elderQuestID     = "elder_fields"
	elderQuestTarget = 5
	elderRewardGold  = 50
	elderRewardExp   = 20
)

type QuestState struct {
	Active    bool `json:"active,omitempty"`
	Progress  int  `json:"progress,omitempty"`
	Ready     bool `json:"ready,omitempty"`
	Completed bool `json:"completed,omitempty"`
	Rewarded  bool `json:"rewarded,omitempty"`
}

type npcDialogueMsg struct {
	T     string   `json:"t"`
	Pages []string `json:"pages"`
	Id    string   `json:"id,omitempty"`
	Offer bool     `json:"offer,omitempty"`
}

func cloneQuestStates(src map[string]QuestState) map[string]QuestState {
	if len(src) == 0 {
		return nil
	}
	out := make(map[string]QuestState, len(src))
	for k, v := range src {
		out[k] = v
	}
	return out
}

func normalizeQuests(p *Player) {
	if p.quests == nil {
		p.quests = map[string]QuestState{}
	}
	q, exists := p.quests[elderQuestID]
	if !exists {
		return
	}
	// Earlier builds persisted an all-zero placeholder quest for every new
	// character. Treat it as undiscovered and remove it during migration.
	if !q.Active && !q.Ready && !q.Completed && !q.Rewarded && q.Progress == 0 {
		delete(p.quests, elderQuestID)
		return
	}
	if q.Progress < 0 {
		q.Progress = 0
	}
	if q.Progress > elderQuestTarget {
		q.Progress = elderQuestTarget
	}
	if q.Completed {
		q.Active = false
		q.Ready = false
		q.Rewarded = true
		q.Progress = elderQuestTarget
	} else {
		q.Ready = q.Ready || q.Progress >= elderQuestTarget
	}
	p.quests[elderQuestID] = q
}

func elderQuest(p *Player) QuestState {
	normalizeQuests(p)
	return p.quests[elderQuestID]
}

func setElderQuest(p *Player, q QuestState) {
	if p.quests == nil {
		p.quests = map[string]QuestState{}
	}
	p.quests[elderQuestID] = q
	normalizeQuests(p)
}

func sendNpcDialogue(p *Player, pages []string, id string, offer bool) {
	if p == nil || p.conn == nil || len(pages) == 0 {
		return
	}
	writeJSON(p.conn, npcDialogueMsg{T: "npcDialogue", Pages: pages, Id: id, Offer: offer})
}

func (h *Hub) advanceElderQuestKill(p *Player) {
	q := elderQuest(p)
	if !q.Active || q.Ready || q.Completed {
		return
	}
	q.Progress++
	if q.Progress >= elderQuestTarget {
		q.Progress = elderQuestTarget
		q.Ready = true
		p.logMsg("Quest updated: Return to Elder for your reward.")
	}
	setElderQuest(p, q)
}

func (h *Hub) talkElder(p *Player) {
	q := elderQuest(p)
	p.hp = float64(p.maxhp)
	p.mp = float64(p.maxmp)

	if !q.Active && !q.Completed {
		sendNpcDialogue(p, []string{
			"Elder: Monsters have overrun the fields outside the city.",
			fmt.Sprintf("Elder: Defeat %d of them so travelers can use the road safely.", elderQuestTarget),
			"Elder: Will you help us?",
		}, elderQuestID, true)
		return
	}

	if q.Completed {
		if p.bag["potion"] < 3 {
			addItem(p, "potion", 1)
		}
		sendNpcDialogue(p, []string{"Elder: Rest well, hero. The fields are safer because of you."}, "", false)
		return
	}
	if !q.Ready {
		if p.bag["potion"] < 3 {
			addItem(p, "potion", 1)
		}
		sendNpcDialogue(p, []string{
			fmt.Sprintf("Elder: The fields still need your help. Defeat monsters: %d/%d.", q.Progress, elderQuestTarget),
		}, "", false)
		return
	}
	q.Active = false
	q.Ready = false
	q.Completed = true
	q.Rewarded = true
	q.Progress = elderQuestTarget
	setElderQuest(p, q)
	p.gold += elderRewardGold
	grantExp(p, elderRewardExp)
	if canCarryItem(p, "potion", 2) {
		addItem(p, "potion", 2)
	} else {
		h.dropFloor(p.mapID, "potion", 2, p.tx, p.ty)
		p.logMsg("Reward potions dropped at your feet.")
	}
	p.logMsg(fmt.Sprintf("Quest complete: Fields of Trouble: +%d EXP, +%d gold", elderRewardExp, elderRewardGold))
	sendNpcDialogue(p, []string{
		"Elder: The fields are quieter already.",
		fmt.Sprintf("Elder: Take this reward: %d gold, %d EXP, and two potions.", elderRewardGold, elderRewardExp),
	}, "", false)
}

func npcFacing(p *Player) string {
	d := dirVec[p.dir]
	tx, ty := p.tx+d[0], p.ty+d[1]
	switch p.mapID {
	case "field":
		switch {
		case tx == 7 && ty == 20:
			return "elder"
		case tx == 29 && ty == 9:
			return "girl"
		case tx == 14 && ty == 7:
			return "pixel"
		case tx == 20 && ty == 10:
			return "knight"
		}
	case "city":
		switch {
		case tx == 7 && ty == 6:
			return "smith"
		case tx == 27 && ty == 6:
			return "grocer"
		case tx == 15 && ty == 16:
			return "kid"
		case tx == 3 && ty == 12:
			return "guard"
		}
	}
	return ""
}

func (h *Hub) acceptQuest(p *Player, id string) {
	if id == elderQuestID {
		q := elderQuest(p)
		if !q.Active && !q.Completed {
			q.Active = true
			q.Progress = 0
			q.Ready = false
			setElderQuest(p, q)
			p.logMsg("Quest accepted: Fields of Trouble.")
		}
	}
}
