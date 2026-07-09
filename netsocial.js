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

function tradeItemLabel(id) {
  if (typeof itemName === 'function') return itemName(id);
  return (typeof ITEMS !== 'undefined' && ITEMS[id] && ITEMS[id].name) || id;
}

function hitRect(p, rect) {
  return p.x >= rect.x && p.x < rect.x + rect.w && p.y >= rect.y && p.y < rect.y + rect.h;
}

function getTradeBackpackBag() {
  const bag = {};
  for (const [id, qty] of Object.entries(game.hero.bag || {})) {
    bag[id] = qty;
  }
  if (game.trade && game.trade.you && game.trade.you.items) {
    for (const [id, offeredQty] of Object.entries(game.trade.you.items)) {
      if (bag[id] !== undefined) {
        bag[id] = Math.max(0, bag[id] - offeredQty);
      }
    }
  }
  return bag;
}

function tradeBox() {
  const w = 380, h = 260;
  const x = Math.floor((W - w) / 2), y = Math.floor((H - h) / 2);
  return { x, y, w, h };
}

function tradeBoxes(b) {
  return {
    youOffer: { x: b.x + 10, y: b.y + 22, w: 174, h: 90 },
    theirOffer: { x: b.x + 196, y: b.y + 22, w: 174, h: 90 },
    backpack: { x: b.x + 10, y: b.y + 118, w: 196, h: 86 },
    gold: { x: b.x + 214, y: b.y + 118, w: 156, h: 86 }
  };
}

function goldInputLayout(b) {
  const boxes = tradeBoxes(b);
  const gb = boxes.gold;
  return {
    minus: { x: gb.x + 6, y: gb.y + 20, w: 16, h: 18 },
    input: { x: gb.x + 24, y: gb.y + 20, w: 50, h: 18 },
    plus: { x: gb.x + 76, y: gb.y + 20, w: 16, h: 18 },
    max: { x: gb.x + 94, y: gb.y + 20, w: 26, h: 18 }
  };
}

function drawScrollableItemsGrid(ids, scrollStateName, itemsCounts, gx, gy, cols, rows, dragSource) {
  const S = 24, G = 2;
  const maxScroll = Math.max(0, Math.ceil(ids.length / cols) - rows);
  game[scrollStateName] = Math.max(0, Math.min(game[scrollStateName] || 0, maxScroll));
  const first = (game[scrollStateName] || 0) * cols;
  const visible = ids.slice(first, first + cols * rows);

  if (!game._tradeGridHit) game._tradeGridHit = [];

  visible.forEach((id, off) => {
    const col = off % cols;
    const row = Math.floor(off / cols);
    const cx = gx + col * (S + G);
    const cy = gy + row * (S + G);

    ctx.fillStyle = 'rgba(10,20,30,.5)';
    ctx.fillRect(cx, cy, S, S);
    ctx.strokeStyle = '#56718a';
    ctx.strokeRect(cx + 0.5, cy + 0.5, S - 1, S - 1);

    if (ITEMS[id] && ITEMS[id].img) {
      ctx.drawImage(img[ITEMS[id].img], cx + 3, cy + 3, 18, 18);
      const count = itemsCounts[id];
      if (count >= 1) {
        text(String(count), cx + 12, cy + 14, '#ffe080');
      }
    }

    game._tradeGridHit.push({
      id,
      x: cx,
      y: cy,
      w: S,
      h: S,
      source: dragSource
    });
  });

  for (let off = visible.length; off < cols * rows; off++) {
    const col = off % cols;
    const row = Math.floor(off / cols);
    const cx = gx + col * (S + G);
    const cy = gy + row * (S + G);
    ctx.fillStyle = 'rgba(10,20,30,.2)';
    ctx.fillRect(cx, cy, S, S);
    ctx.strokeStyle = '#324250';
    ctx.strokeRect(cx + 0.5, cy + 0.5, S - 1, S - 1);
  }

  if (maxScroll > 0) {
    const trackX = gx + cols * (S + G) - G + 4;
    const trackY = gy;
    const trackH = rows * S + (rows - 1) * G;
    ctx.fillStyle = 'rgba(10,20,30,.55)';
    ctx.fillRect(trackX, trackY, 4, trackH);
    const thumbH = Math.max(8, Math.floor(trackH * rows / Math.ceil(ids.length / cols)));
    const thumbY = trackY + Math.round((trackH - thumbH) * (game[scrollStateName] || 0) / maxScroll);
    ctx.fillStyle = '#9fb4c8';
    ctx.fillRect(trackX, thumbY, 4, thumbH);
  }
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

  const boxes = tradeBoxes(b);
  game._tradeGridHit = [];

  // Draw Left Column: You
  drawWindow(boxes.youOffer.x, boxes.youOffer.y, boxes.youOffer.w, boxes.youOffer.h);
  drawTradeSide(tr.you, boxes.youOffer.x, boxes.youOffer.y, boxes.youOffer.w, 'You');
  const youOfferIds = Object.keys(tr.you.items || {}).filter(id => tr.you.items[id] > 0);
  drawScrollableItemsGrid(youOfferIds, 'tradeOfferScroll', tr.you.items, boxes.youOffer.x + 6, boxes.youOffer.y + 28, 6, 2, 'offer');

  // Draw Right Column: Them
  drawWindow(boxes.theirOffer.x, boxes.theirOffer.y, boxes.theirOffer.w, boxes.theirOffer.h);
  drawTradeSide(tr.with, boxes.theirOffer.x, boxes.theirOffer.y, boxes.theirOffer.w, tr.with.name);
  const theirOfferIds = Object.keys(tr.with.items || {}).filter(id => tr.with.items[id] > 0);
  drawScrollableItemsGrid(theirOfferIds, 'tradeTheirOfferScroll', tr.with.items, boxes.theirOffer.x + 6, boxes.theirOffer.y + 28, 6, 2, 'theirOffer');

  // Draw Backpack
  drawWindow(boxes.backpack.x, boxes.backpack.y, boxes.backpack.w, boxes.backpack.h);
  text('Your Bag:', boxes.backpack.x + 6, boxes.backpack.y + 7, '#bcd');
  const bag = getTradeBackpackBag();
  const bagIds = Object.keys(bag).filter(id => bag[id] > 0);
  drawScrollableItemsGrid(bagIds, 'tradeBagScroll', bag, boxes.backpack.x + 6, boxes.backpack.y + 20, 7, 2, 'bag');

  // Draw Gold Offer Input
  drawWindow(boxes.gold.x, boxes.gold.y, boxes.gold.w, boxes.gold.h);
  text('Offer Gold:', boxes.gold.x + 6, boxes.gold.y + 7, '#bcd');
  const lay = goldInputLayout(b);

  // Minus button
  drawWindow(lay.minus.x, lay.minus.y, lay.minus.w, lay.minus.h);
  text('-', lay.minus.x + 5, lay.minus.y + 5, '#bcd');

  // Input Box
  drawWindow(lay.input.x, lay.input.y, lay.input.w, lay.input.h);
  if (game.tradeGoldFocused) {
    ctx.strokeStyle = '#ffe080';
    ctx.strokeRect(lay.input.x + 0.5, lay.input.y + 0.5, lay.input.w - 1, lay.input.h - 1);
  }
  const caret = game.tradeGoldFocused && (Math.floor(performance.now() / 330) % 2) ? '_' : '';
  const valStr = game.tradeGoldInputText + caret;
  text(valStr, lay.input.x + 4, lay.input.y + 5, '#fe8');

  // Plus button
  drawWindow(lay.plus.x, lay.plus.y, lay.plus.w, lay.plus.h);
  text('+', lay.plus.x + 4, lay.plus.y + 5, '#bcd');

  // Max button
  drawWindow(lay.max.x, lay.max.y, lay.max.w, lay.max.h);
  text('Max', lay.max.x + 3, lay.max.y + 5, '#ffe080');

  // Available Gold text
  text(`(Have: ${game.hero.gold || 0}G)`, boxes.gold.x + 6, boxes.gold.y + 46, '#bcd');

  // Draw buttons row
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

  // Hover item tip
  const hoverItem = tradeHoverItem();
  if (hoverItem) drawItemNameTip(hoverItem);

  // Drag ghost icon
  if (game.tradeDrag && ITEMS[game.tradeDrag.id]) {
    ctx.globalAlpha = 0.85;
    ctx.drawImage(img[ITEMS[game.tradeDrag.id].img], mouse.x - 9, mouse.y - 9, 18, 18);
    ctx.globalAlpha = 1;
  }
}

function drawTradeSide(side, x, y, w, title) {
  text(title, x + 6, y + 8, side === game.trade.you ? '#ffe080' : '#9cf');
  const status = side.ok ? '✓ OK' : side.lock ? 'locked' : '';
  if (status) text(status, x + w - textWidth(status) - 6, y + 8, side.ok ? '#8f8' : '#fc6');
  text('gold: ' + (side.gold || 0), x + 6, y + 20, '#fe8');
}

function tradeHoverItem() {
  if (game.tradeDrag) return null;
  if (!game._tradeGridHit) return null;
  const hitArea = game._tradeGridHit.find(h => hit(mouse, h.x, h.y, h.w, h.h));
  return hitArea ? hitArea.id : null;
}

function tradeButtons(b) {
  const y = b.y + b.h - 26, g = 6;
  const specs = [
    ['clear', 'Clear Offer', 74],
    ['lock', 'Lock', 58],
    ['confirm', 'Confirm', 64],
    ['cancel', 'Cancel', 56],
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
  if (!tr) return;
  if (updateTradePrompt()) return;
  const b = tradeBox();
  const boxes = tradeBoxes(b);
  const lay = goldInputLayout(b);
  const btns = tradeButtons(b);

  // Wheel scrolling
  if (wheelY) {
    if (hitRect(mouse, boxes.backpack)) {
      const bag = getTradeBackpackBag();
      const bagIds = Object.keys(bag).filter(id => bag[id] > 0);
      const maxScroll = Math.max(0, Math.ceil(bagIds.length / 7) - 2);
      const old = game.tradeBagScroll || 0;
      game.tradeBagScroll = Math.max(0, Math.min(old + (wheelY > 0 ? 1 : -1), maxScroll));
      if (game.tradeBagScroll !== old) sfx('Cursor1');
      wheelY = 0;
    } else if (hitRect(mouse, boxes.youOffer)) {
      const youOfferIds = Object.keys(tr.you.items || {}).filter(id => tr.you.items[id] > 0);
      const maxScroll = Math.max(0, Math.ceil(youOfferIds.length / 6) - 2);
      const old = game.tradeOfferScroll || 0;
      game.tradeOfferScroll = Math.max(0, Math.min(old + (wheelY > 0 ? 1 : -1), maxScroll));
      if (game.tradeOfferScroll !== old) sfx('Cursor1');
      wheelY = 0;
    } else if (hitRect(mouse, boxes.theirOffer)) {
      const theirOfferIds = Object.keys(tr.with.items || {}).filter(id => tr.with.items[id] > 0);
      const maxScroll = Math.max(0, Math.ceil(theirOfferIds.length / 6) - 2);
      const old = game.tradeTheirOfferScroll || 0;
      game.tradeTheirOfferScroll = Math.max(0, Math.min(old + (wheelY > 0 ? 1 : -1), maxScroll));
      if (game.tradeTheirOfferScroll !== old) sfx('Cursor1');
      wheelY = 0;
    }
  }

  // Keyboard typing when gold input is focused
  if (game.tradeGoldFocused) {
    for (const k of queue) {
      if (k === 'Enter') {
        game.tradeGoldFocused = false;
        sfx('Decision1');
        break;
      } else if (k === 'Escape') {
        game.tradeGoldFocused = false;
        sfx('Cancel1');
        break;
      } else if (k === 'Backspace') {
        game.tradeGoldInputText = game.tradeGoldInputText.slice(0, -1);
        const val = parseInt(game.tradeGoldInputText) || 0;
        netSend(net, { t: 'tradeGold', n: val });
        sfx('Cursor1');
      } else if (k.length === 1 && k >= '0' && k <= '9') {
        if (game.tradeGoldInputText === '0') game.tradeGoldInputText = '';
        if (game.tradeGoldInputText.length < 9) {
          game.tradeGoldInputText += k;
          let val = parseInt(game.tradeGoldInputText) || 0;
          if (val > game.hero.gold) {
            val = game.hero.gold;
            game.tradeGoldInputText = String(val);
          }
          netSend(net, { t: 'tradeGold', n: val });
          sfx('Cursor1');
        }
      }
    }
    queue = [];
  }

  // Drag Release handling
  for (const r of releases) {
    if (r.b !== 0 || !game.tradeDrag) continue;
    const d = game.tradeDrag;
    const dx = Math.abs(r.x - d.startX);
    const dy = Math.abs(r.y - d.startY);
    const wasDrag = dx > 4 || dy > 4;

    if (wasDrag) {
      if (d.from === 'bag') {
        if (hitRect(r, boxes.youOffer)) {
          const max = game.hero.bag[d.id] || 0;
          if (max > 1) {
            const currentOffer = tr.you.items[d.id] || 0;
            game.tradePrompt = { id: d.id, n: Math.min(max, currentOffer + 1), max };
            sfx('Cursor1');
          } else {
            netSend(net, { t: 'tradeOffer', id: d.id, n: 1 });
            sfx('Cursor1');
          }
        }
      } else if (d.from === 'offer') {
        if (!hitRect(r, boxes.youOffer)) {
          netSend(net, { t: 'tradeOffer', id: d.id, n: -1 });
          sfx('Cursor1');
        }
      }
    } else {
      // Click-to-add / click-to-remove
      if (d.from === 'bag') {
        const max = game.hero.bag[d.id] || 0;
        if (max > 1) {
          const currentOffer = tr.you.items[d.id] || 0;
          game.tradePrompt = { id: d.id, n: Math.min(max, currentOffer + 1), max };
          sfx('Cursor1');
        } else {
          netSend(net, { t: 'tradeOffer', id: d.id, n: 1 });
          sfx('Cursor1');
        }
      } else if (d.from === 'offer') {
        netSend(net, { t: 'tradeOffer', id: d.id, n: -1 });
        sfx('Cursor1');
      }
    }
    game.tradeDrag = null;
  }
  if (game.tradeDrag && !mouse.down) game.tradeDrag = null;

  clicks = clicks.filter(c => {
    // Check if clicked/dragged grid item
    if (game._tradeGridHit) {
      const hitArea = game._tradeGridHit.find(h => hit(c, h.x, h.y, h.w, h.h));
      if (hitArea) {
        if (hitArea.source === 'bag') {
          game.tradeDrag = { id: hitArea.id, from: 'bag', startX: c.x, startY: c.y };
          return false;
        } else if (hitArea.source === 'offer') {
          game.tradeDrag = { id: hitArea.id, from: 'offer', startX: c.x, startY: c.y };
          return false;
        }
      }
    }

    if (!hit(c, b.x, b.y, b.w, b.h)) {
      if (!hit(c, lay.input.x, lay.input.y, lay.input.w, lay.input.h)) {
        game.tradeGoldFocused = false;
      }
      return true;
    }
    if (c.b !== 0) return false;

    // gold input focus
    if (hit(c, lay.input.x, lay.input.y, lay.input.w, lay.input.h)) {
      game.tradeGoldFocused = true;
      sfx('Cursor1');
      return false;
    } else {
      game.tradeGoldFocused = false;
    }

    // minus
    if (hit(c, lay.minus.x, lay.minus.y, lay.minus.w, lay.minus.h)) {
      let val = (tr.you.gold || 0) - 10;
      if (val < 0) val = 0;
      game.tradeGoldInputText = String(val);
      netSend(net, { t: 'tradeGold', n: val });
      sfx('Cursor1');
      return false;
    }

    // plus
    if (hit(c, lay.plus.x, lay.plus.y, lay.plus.w, lay.plus.h)) {
      let val = (tr.you.gold || 0) + 10;
      if (val > game.hero.gold) val = game.hero.gold;
      game.tradeGoldInputText = String(val);
      netSend(net, { t: 'tradeGold', n: val });
      sfx('Cursor1');
      return false;
    }

    // max
    if (hit(c, lay.max.x, lay.max.y, lay.max.w, lay.max.h)) {
      let val = game.hero.gold || 0;
      game.tradeGoldInputText = String(val);
      netSend(net, { t: 'tradeGold', n: val });
      sfx('Decision1');
      return false;
    }

    // buttons
    if (hit(c, btns.clear.x, btns.clear.y, btns.clear.w, btns.clear.h)) {
      clearMyOffer();
      game.tradeGoldInputText = "0";
      return false;
    }
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
  if (game.tradePrompt) drawTradePrompt();
  drawSocialPrompt();
}

// ---- trade quantity prompt --------------------------------------------------

function tradePromptLayout() {
  const w = 168, h = 76, x = Math.floor((W - w) / 2), y = Math.floor((H - h) / 2);
  return {
    x, y, w, h,
    minus: { x: x + 12, y: y + 35, w: 24, h: 18 },
    plus: { x: x + 42, y: y + 35, w: 24, h: 18 },
    all: { x: x + 72, y: y + 35, w: 34, h: 18 },
    ok: { x: x + 112, y: y + 35, w: 44, h: 18 },
    cancel: { x: x + 112, y: y + 56, w: 44, h: 14 }
  };
}

function clampTradePrompt() {
  const p = game.tradePrompt;
  if (!p) return;
  p.n = Math.max(1, Math.min(p.max, Math.floor(p.n || 1)));
}

function confirmTradePrompt() {
  const p = game.tradePrompt, tr = game.trade;
  if (!p || !tr) return;
  clampTradePrompt();
  const currentOffer = tr.you.items[p.id] || 0;
  const delta = p.n - currentOffer;
  netSend(game.net, { t: 'tradeOffer', id: p.id, n: delta });
  game.tradePrompt = null;
  sfx('Decision1');
}

function updateTradePrompt() {
  const p = game.tradePrompt;
  if (!p) return false;
  clampTradePrompt();
  const l = tradePromptLayout();
  
  for (const k of queue) {
    if (k === 'Enter') {
      confirmTradePrompt();
      break;
    } else if (k === 'Escape') {
      game.tradePrompt = null;
      sfx('Cancel1');
      break;
    }
  }
  queue = [];

  clicks = clicks.filter(c => {
    if (c.b !== 0) return false;
    if (hit(c, l.minus.x, l.minus.y, l.minus.w, l.minus.h)) { p.n--; clampTradePrompt(); sfx('Cursor1'); return false; }
    if (hit(c, l.plus.x, l.plus.y, l.plus.w, l.plus.h)) { p.n++; clampTradePrompt(); sfx('Cursor1'); return false; }
    if (hit(c, l.all.x, l.all.y, l.all.w, l.all.h)) { p.n = p.max; sfx('Cursor1'); return false; }
    if (hit(c, l.ok.x, l.ok.y, l.ok.w, l.ok.h)) { confirmTradePrompt(); return false; }
    if (hit(c, l.cancel.x, l.cancel.y, l.cancel.w, l.cancel.h) || !hit(c, l.x, l.y, l.w, l.h)) {
      game.tradePrompt = null; sfx('Cancel1'); return false;
    }
    return false;
  });

  if (pressed(['ArrowLeft', 'a'])) { p.n--; clampTradePrompt(); sfx('Cursor1'); }
  if (pressed(['ArrowRight', 'd'])) { p.n++; clampTradePrompt(); sfx('Cursor1'); }
  if (pressed(CONFIRM)) { confirmTradePrompt(); }
  if (pressed(CANCEL)) { game.tradePrompt = null; sfx('Cancel1'); }
  
  return true;
}

function drawTradePrompt() {
  const p = game.tradePrompt;
  if (!p) return;
  clampTradePrompt();
  if (!game.tradePrompt) return;
  const l = tradePromptLayout(), it = ITEMS[p.id];
  
  // draw semi-dark overlay on top of trade window
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fillRect(l.x - 10, l.y - 10, l.w + 20, l.h + 20);
  ctx.restore();

  drawWindow(l.x, l.y, l.w, l.h);
  text('Offer Quantity', l.x + 12, l.y + 8, '#ffe080');
  if (it) {
    ctx.drawImage(img[it.img], l.x + 12, l.y + 17, 14, 14);
    text(it.name.length > 10 ? it.name.slice(0, 10) + '…' : it.name, l.x + 32, l.y + 19, '#fff');
  }
  text(`${p.n}/${p.max}`, l.x + 116, l.y + 19, '#bcd');
  
  drawWindow(l.minus.x, l.minus.y, l.minus.w, l.minus.h); text('-', l.minus.x + 9, l.minus.y + 6);
  drawWindow(l.plus.x, l.plus.y, l.plus.w, l.plus.h); text('+', l.plus.x + 8, l.plus.y + 6);
  drawWindow(l.all.x, l.all.y, l.all.w, l.all.h); text('All', l.all.x + 8, l.all.y + 6);
  drawWindow(l.ok.x, l.ok.y, l.ok.w, l.ok.h); text('OK', l.ok.x + 14, l.ok.y + 6, '#9f9');
  drawWindow(l.cancel.x, l.cancel.y, l.cancel.w, l.cancel.h); text('Cancel', l.cancel.x + 4, l.cancel.y + 3, '#bcd');
}
