package main

import (
	"encoding/json"
	"testing"
)

func TestNewCharacterHasNoQuestUntilAcceptance(t *testing.T) {
	p := heroAt("city", 19, 16)
	if len(p.quests) != 0 {
		t.Fatalf("new character should have no quests, got %+v", p.quests)
	}
	view := p.view()
	if len(view.Quests) != 0 {
		t.Fatalf("new character snapshot should not advertise a quest, got %+v", view.Quests)
	}
}

func TestLegacyEmptyQuestPlaceholderIsRemoved(t *testing.T) {
	p := heroAt("city", 19, 16)
	p.quests[elderQuestID] = QuestState{}
	normalizeQuests(p)
	if _, exists := p.quests[elderQuestID]; exists {
		t.Fatalf("empty legacy quest placeholder should be removed, got %+v", p.quests)
	}
}

func TestTalkElderOffersQuestWithoutActivatingIt(t *testing.T) {
	h := newHub()
	p := heroAt("field", 7, 21)
	c := &testConn{}
	p.conn = c

	h.talkElder(p)

	if len(p.quests) != 0 {
		t.Fatalf("talking should not activate the quest before confirmation, got %+v", p.quests)
	}
	var msg npcDialogueMsg
	if err := json.Unmarshal(c.last, &msg); err != nil {
		t.Fatalf("decode NPC dialogue: %v", err)
	}
	if msg.T != "npcDialogue" || !msg.Offer || msg.Id != elderQuestID || len(msg.Pages) < 2 {
		t.Fatalf("expected explanation pages followed by an offer, got %+v", msg)
	}
}

func TestAcceptQuestStartsProgressAtZero(t *testing.T) {
	h := newHub()
	p := heroAt("field", 7, 21)
	p.kills = 20 // kills before accepting must not count toward this quest

	h.acceptQuest(p, elderQuestID)
	q := elderQuest(p)
	if !q.Active || q.Ready || q.Progress != 0 {
		t.Fatalf("accepted quest should begin at its first active objective, got %+v", q)
	}
}

func TestElderQuestStopsCountingAtReturnStep(t *testing.T) {
	h := newHub()
	p := heroAt("field", 15, 10)
	p.quests = map[string]QuestState{elderQuestID: {Active: true, Progress: elderQuestTarget - 1}}
	h.killEnemy(p, slimeAt(1, 16, 10))
	q := elderQuest(p)
	if !q.Ready || q.Progress != elderQuestTarget || q.Completed {
		t.Fatalf("quest should be ready to turn in at %d kills, got %+v", elderQuestTarget, q)
	}
	h.killEnemy(p, slimeAt(2, 17, 10))
	q = elderQuest(p)
	if q.Progress != elderQuestTarget {
		t.Fatalf("quest progress should stop counting after target, got %+v", q)
	}
}

func TestTalkElderCollectsQuestReward(t *testing.T) {
	h := newHub()
	p := heroAt("field", 7, 21)
	p.dir = "up"
	p.gold = 0
	p.exp = 0
	p.bag = map[string]int{"potion": 1}
	p.quests = map[string]QuestState{elderQuestID: {Active: true, Progress: elderQuestTarget, Ready: true}}
	h.talkElder(p)
	q := elderQuest(p)
	if !q.Completed || !q.Rewarded || q.Active || q.Ready {
		t.Fatalf("elder turn-in should archive the quest, got %+v", q)
	}
	if p.gold != elderRewardGold {
		t.Fatalf("elder reward should grant %d gold, got %d", elderRewardGold, p.gold)
	}
	if p.bag["potion"] < 3 {
		t.Fatalf("elder reward should grant potions, got bag %+v", p.bag)
	}
}
