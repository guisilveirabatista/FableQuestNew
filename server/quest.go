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
	q := p.quests[elderQuestID]
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
	p.quests[elderQuestID] = q
	normalizeQuests(p)
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
		type questPromptMsg struct {
			T    string `json:"t"`
			Id   string `json:"id"`
			Text string `json:"text"`
		}
		writeJSON(p.conn, questPromptMsg{
			T:    "questPrompt",
			Id:   elderQuestID,
			Text: "Will you help me clear the fields of slimes?",
		})
		return
	}

	if q.Completed {
		if p.bag["potion"] < 3 {
			addItem(p, "potion", 1)
		}
		return
	}
	if !q.Ready {
		if p.bag["potion"] < 3 {
			addItem(p, "potion", 1)
		}
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
			q.Progress = min(p.kills, elderQuestTarget)
			q.Ready = p.kills >= elderQuestTarget
			setElderQuest(p, q)
			p.logMsg("Quest accepted: Fields of Trouble.")
		}
	}
}
