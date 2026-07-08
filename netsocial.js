'use strict';
// Phase 6 social UI for netplay: a chat feed with an input line + slash commands,
// party frames, a trade window, incoming invite / trade-request prompts, and PvP
// markers over players. None of it decides anything — it reads snapshot data
// (game.chat / game.party / game.trade / …) and sends intents; the server owns
// every outcome, so the UI can't be used to cheat.

const CHAT_COLORS = {
  say: '#e8eef4', world: '#9cf', party: '#8f8',
  tell: '#f6a6ff', system: '#fc6', reward: '#bcd', pvp: '#f88',
};

// ---- chat feed + input ------------------------------------------------------

function pushChatLine(line) {
  if (!game.chat) game.chat = [];
  game.chat.push(line);
  if (game.chat.length > 100) game.chat.shift();
}

function openChat(prefill) {
  game.chatOpen = true;
  game.chatInput = { text: prefill || '' };
  queue = queue.filter(k => k !== 'Enter'); // don't leak the opening Enter into the field
  sfx('Cursor1');
}
function closeChat() { game.chatInput = null; }
function toggleChatWindow() {
  game.chatOpen = game.chatOpen === false;
  if (!game.chatOpen) closeChat();
  sfx(game.chatOpen ? 'Decision1' : 'Cancel1');
}

function sendChat() {
  const t = (game.chatInput.text || '').trim();
  closeChat();
  if (!t) return;
  if (t[0] === '/') { handleSlash(t); return; }
  netSend(game.net, { t: 'chat', scope: 'say', text: t });
}

// slash commands drive every social action that isn't a windowed UI
function handleSlash(t) {
  const net = game.net;
  const sp = t.indexOf(' ');
  const cmd = (sp < 0 ? t : t.slice(0, sp)).toLowerCase();
  const rest = sp < 0 ? '' : t.slice(sp + 1).trim();
  switch (cmd) {
    case '/w': case '/world': if (rest) netSend(net, { t: 'chat', scope: 'world', text: rest }); break;
    case '/tell': case '/msg': {
      const cut = rest.indexOf(' ');
      if (cut > 0) netSend(net, { t: 'chat', scope: 'tell', id: rest.slice(0, cut), text: rest.slice(cut + 1).trim() });
      break;
    }
    case '/p': case '/party': if (rest) netSend(net, { t: 'chat', scope: 'party', text: rest }); break;
    case '/s': case '/say': if (rest) netSend(net, { t: 'chat', scope: 'say', text: rest }); break;
    case '/invite': if (rest) netSend(net, { t: 'partyInvite', id: rest }); break;
    case '/join': case '/accept': netSend(net, { t: 'partyAccept' }); break;
    case '/decline': netSend(net, { t: 'partyDecline' }); break;
    case '/leave': netSend(net, { t: 'partyLeave' }); break;
    case '/kick': if (rest) netSend(net, { t: 'partyKick', id: rest }); break;
    case '/trade': if (rest) netSend(net, { t: 'tradeRequest', id: rest }); break;
    case '/friend': if (rest) netSend(net, { t: 'friendAdd', id: rest }); break;
    case '/unfriend': if (rest) netSend(net, { t: 'friendRemove', id: rest }); break;
    case '/friends': netSend(net, { t: 'friendList' }); break;
    case '/pvp': netSend(net, { t: 'setPvp', v: !game.youPvp }); break;
    case '/help':
      pushChatLine({ scope: 'system', text: 'chat: /w world, /p party, /tell name text, /invite name' });
      pushChatLine({ scope: 'system', text: '/trade name, /friend name, /friends, /pvp; right-click players in combat zones' });
      break;
    default: pushChatLine({ scope: 'system', text: 'Unknown command — try /help' });
  }
}

function updateChatInput() {
  const L = game.chatInput;
  for (const k of queue) {
    if (k === 'Enter') { sendChat(); break; }
    else if (k === 'Escape') { closeChat(); break; }
    else if (k === 'Backspace') L.text = L.text.slice(0, -1);
    else if (k.length === 1 && k.charCodeAt(0) >= 32 && k.charCodeAt(0) < 127 && L.text.length < 120) L.text += k;
  }
  queue = [];
}

function chatPanelBox() {
  const rows = 6, lh = 10, w = 320;
  const inputH = game.chatInput ? 16 : 0;
  const h = 14 + rows * lh + inputH + 4;
  return { x: 4, y: H - 30 - h, w, h, rows, lh, inputH };
}

function drawChatPanel() {
  if (game.chatOpen === false && !game.chatInput) return;
  const b = chatPanelBox();
  drawWindow(b.x, b.y, b.w, b.h);
  text('Chat  C:hide', b.x + 8, b.y + 4, '#bcd');
  const lines = (game.chat || []).slice(-b.rows);
  if (lines.length === 0 && !game.chatInput) { // empty: show how to use it
    text('Press Enter to chat  ·  /help for commands', b.x + 8, b.y + 15, '#7f9fb8');
  }
  lines.forEach((c, i) => {
    const y = b.y + 15 + i * b.lh;
    let s = c.text, col = CHAT_COLORS[c.scope] || '#fff';
    if (c.scope === 'say' || c.scope === 'world' || c.scope === 'party' || c.scope === 'tell') {
      const tag = c.scope === 'world' ? '[W] ' : c.scope === 'party' ? '[P] ' : c.scope === 'tell' ? '[T] ' : '';
      s = tag + (c.from ? c.from + ': ' : '') + c.text;
    }
    text(s.length > 58 ? s.slice(0, 58) : s, b.x + 8, y, col);
  });
  if (game.chatInput) {
    const iy = b.y + b.h - 15;
    ctx.fillStyle = 'rgba(10,20,30,.6)';
    ctx.fillRect(b.x + 6, iy - 2, b.w - 12, 14);
    const caret = Math.floor(performance.now() / 400) % 2 ? '_' : '';
    text('> ' + game.chatInput.text + caret, b.x + 10, iy, '#ffe080');
  }
}

// ---- party frames -----------------------------------------------------------

function drawPartyFrames() {
  const pt = game.party;
  if (!pt || !pt.members || pt.members.length === 0) return;
  const w = 120, rowH = 24, x = 4, y = 4 + hudHeight() + 6;
  drawWindow(x, y, w, 12 + pt.members.length * rowH);
  text('Party', x + 8, y + 3, '#bcd');
  pt.members.forEach((m, i) => {
    const ry = y + 12 + i * rowH;
    const self = m.name === heroDisplayName() || m.name === (game.net && game.net.id);
    text((m.leader ? '★' : '') + m.name, x + 8, ry, self ? '#ffe080' : '#cfe');
    drawMeter(x + 8, ry + 10, w - 16, 6, m.hp, m.maxhp || 1, hpColor(m.hp, m.maxhp || 1));
    text('L' + (m.lv || 1), x + w - 24, ry, '#9cf');
  });
}

// ---- trade window -----------------------------------------------------------

function itemLabel(id) { return (typeof ITEMS !== 'undefined' && ITEMS[id] && ITEMS[id].name) || id; }

function tradeBox() {
  const w = 372, h = 208, x = Math.floor((W - w) / 2), y = Math.floor((H - h) / 2);
  return { x, y, w, h };
}

function drawTradeWindow() {
  const tr = game.trade;
  if (!tr) return;
  const b = tradeBox();
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  drawWindow(b.x, b.y, b.w, b.h);
  text('TRADE with ' + tr.with.name, b.x + 12, b.y + 8, '#ffe080');
  const colW = (b.w - 24) / 2;
  drawTradeSide(tr.you, b.x + 12, b.y + 26, colW, 'You');
  drawTradeSide(tr.with, b.x + 12 + colW, b.y + 26, colW, tr.with.name);

  // your backpack (click an item to add it to your offer)
  const by = b.y + 96;
  text('Your bag (click to offer):', b.x + 12, by, '#bcd');
  const bag = Object.keys(game.hero.bag || {}).filter(id => game.hero.bag[id] > 0);
  game._tradeBagHit = [];
  bag.slice(0, 8).forEach((id, i) => {
    const rx = b.x + 12 + (i % 2) * (colW), ry = by + 12 + Math.floor(i / 2) * 11;
    const label = itemLabel(id) + ' x' + game.hero.bag[id];
    text(label.length > 20 ? label.slice(0, 20) : label, rx, ry, '#cfe');
    game._tradeBagHit.push({ id, x: rx, y: ry, w: colW - 4, h: 10 });
  });

  // buttons row
  const btns = tradeButtons(b);
  for (const k in btns) {
    const t = btns[k];
    const on = (k === 'confirm') ? (tr.you.lock && tr.with.lock) : true;
    drawWindow(t.x, t.y, t.w, t.h);
    let lbl = t.label;
    if (k === 'lock') lbl = tr.you.lock ? 'Unlock' : 'Lock';
    if (k === 'confirm') lbl = tr.you.ok ? 'Waiting…' : 'Confirm';
    text(lbl, t.x + Math.max(4, Math.floor((t.w - textWidth(lbl)) / 2)), t.y + 5, on ? '#fff' : '#889');
  }
}

function drawTradeSide(side, x, y, w, title) {
  text(title, x, y, side === game.trade.you ? '#ffe080' : '#9cf');
  const status = side.ok ? '✓ OK' : side.lock ? 'locked' : '';
  if (status) text(status, x + w - textWidth(status) - 6, y, side.ok ? '#8f8' : '#fc6');
  let ry = y + 11;
  text('gold: ' + (side.gold || 0), x, ry, '#fe8'); ry += 10;
  const items = side.items || {};
  for (const id of Object.keys(items)) {
    text('· ' + itemLabel(id) + ' x' + items[id], x, ry, '#cfe'); ry += 10;
    if (ry > y + 62) break;
  }
}

function tradeButtons(b) {
  const y = b.y + b.h - 24, g = 4;
  const specs = [
    ['gold10', '+10g', 42], ['gold100', '+100g', 50], ['clear', 'Clear', 46],
    ['lock', 'Lock', 58], ['confirm', 'Confirm', 64], ['cancel', 'Cancel', 56],
  ];
  const totalW = specs.reduce((sum, spec) => sum + spec[2], 0) + g * (specs.length - 1);
  let x = b.x + Math.floor((b.w - totalW) / 2);
  const out = {};
  for (const [id, label, w] of specs) {
    out[id] = { x, y, w, h: 18, label };
    x += w + g;
  }
  return out;
}

function updateTradeWindow() {
  const tr = game.trade, net = game.net;
  const b = tradeBox();
  const btns = tradeButtons(b);
  clicks = clicks.filter(c => {
    if (!hit(c, b.x, b.y, b.w, b.h)) return false;
    if (c.b !== 0) return false;
    // offer an item from the bag
    for (const bh of (game._tradeBagHit || [])) {
      if (hit(c, bh.x, bh.y, bh.w, bh.h)) { netSend(net, { t: 'tradeOffer', id: bh.id, n: 1 }); sfx('Cursor1'); return false; }
    }
    // buttons and empty panel space are modal: handle known controls, eat the rest.
    if (hit(c, btns.gold10.x, btns.gold10.y, btns.gold10.w, btns.gold10.h)) { netSend(net, { t: 'tradeGold', n: (tr.you.gold || 0) + 10 }); return false; }
    if (hit(c, btns.gold100.x, btns.gold100.y, btns.gold100.w, btns.gold100.h)) { netSend(net, { t: 'tradeGold', n: (tr.you.gold || 0) + 100 }); return false; }
    if (hit(c, btns.clear.x, btns.clear.y, btns.clear.w, btns.clear.h)) { clearMyOffer(); return false; }
    if (hit(c, btns.lock.x, btns.lock.y, btns.lock.w, btns.lock.h)) { netSend(net, { t: 'tradeLock', v: !tr.you.lock }); sfx('Decision1'); return false; }
    if (hit(c, btns.confirm.x, btns.confirm.y, btns.confirm.w, btns.confirm.h)) {
      if (tr.you.lock && tr.with.lock) { netSend(net, { t: 'tradeConfirm' }); sfx('Decision1'); } return false;
    }
    if (hit(c, btns.cancel.x, btns.cancel.y, btns.cancel.w, btns.cancel.h)) { netSend(net, { t: 'tradeCancel' }); sfx('Cancel1'); return false; }
    return false;
  });
  for (const k of queue) if (k === 'Escape') netSend(net, { t: 'tradeCancel' });
  queue = [];
}

function clearMyOffer() {
  const tr = game.trade, net = game.net;
  netSend(net, { t: 'tradeGold', n: 0 });
  for (const id of Object.keys(tr.you.items || {})) netSend(net, { t: 'tradeOffer', id, n: -tr.you.items[id] });
}

// ---- incoming invite / trade-request prompt ---------------------------------

function drawSocialPrompt() {
  const p = game.socialPrompt;
  if (!p) return;
  const w = 236, h = 52, x = Math.floor((W - w) / 2), y = 40;
  drawWindow(x, y, w, h);
  const msg = p.kind === 'trade' ? p.from + ' wants to trade.' : 'You have a party invite.';
  text(msg, x + 12, y + 8, '#ffe080');
  const yes = { x: x + 24, y: y + 26, w: 80, h: 18 }, no = { x: x + w - 104, y: y + 26, w: 80, h: 18 };
  drawWindow(yes.x, yes.y, yes.w, yes.h); text('Accept', yes.x + 20, yes.y + 5);
  drawWindow(no.x, no.y, no.w, no.h); text('Decline', no.x + 18, no.y + 5);
  game._promptHit = { yes, no };
}

function updateSocialPrompt() {
  const p = game.socialPrompt, net = game.net, hb = game._promptHit;
  if (!p || !hb) return;
  clicks = clicks.filter(c => {
    if (c.b !== 0) return true;
    if (hit(c, hb.yes.x, hb.yes.y, hb.yes.w, hb.yes.h)) {
      netSend(net, { t: p.kind === 'trade' ? 'tradeAccept' : 'partyAccept' }); sfx('Decision1'); game.socialPrompt = null; return false;
    }
    if (hit(c, hb.no.x, hb.no.y, hb.no.w, hb.no.h)) {
      netSend(net, { t: p.kind === 'trade' ? 'tradeDecline' : 'partyDecline' }); sfx('Cancel1'); game.socialPrompt = null; return false;
    }
    return true;
  });
}

// ---- PvP markers over heads --------------------------------------------------

function drawNameTags() {
  const cam = camPos();
  const tag = (px, py, pvp) => {
    const sx = Math.round(px + 8 - cam.x), sy = Math.round(py - 14 - cam.y);
    if (pvp) text('⚔', sx - 3, sy - 9, '#f66');
  };
  for (const pl of (game.players || [])) if (!pl.dead) tag(pl.px, pl.py, pl.pvp);
  const h = game.hero;
  if (!h.dead) tag(h.px, h.py, game.youPvp);
}

// ---- the one entry point called from netFrame after drawMap -----------------

function drawNetSocial() {
  drawChatPanel();
  drawPartyFrames();
  drawNameTags();
  if (game.youPvp) text('PvP ON', W - 60, 6, '#f88');
  if (game.trade) drawTradeWindow();
  drawSocialPrompt();
}
