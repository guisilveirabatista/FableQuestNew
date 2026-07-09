package main

import "testing"

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
