'use strict';

// Net admin UI. This file only gathers input and sends admin intents; every
// permission check and mutation is enforced on the Go server.

const ADMIN_SECTIONS = [
  { id: 'announce', label: 'Announcement' },
  { id: 'banAccount', label: 'Ban Account' },
  { id: 'unbanAccount', label: 'Unban Account' },
  { id: 'banCharacter', label: 'Ban Character' },
  { id: 'unbanCharacter', label: 'Unban Character' },
  { id: 'teleport', label: 'Teleport' },
  { id: 'item', label: 'Create Item' },
  { id: 'character', label: 'Character' },
  { id: 'cheats', label: 'Cheats' },
  { id: 'monster', label: 'Summon Monster' },
];

const ADMIN_CLASSES = ['Knight', 'Lancer', 'Wizard', 'Archer', 'Vampire', 'Holy'];
const ADMIN_SKILLS = ['fire', 'heal', 'spin', 'bolt', 'nova', 'supernova'];
const ADMIN_CHEATS = [
  { key: 'invulnerable', label: 'Invulnerable' },
  { key: 'infiniteWeight', label: 'Infinite Weight' },
  { key: 'infiniteVitals', label: 'Infinite HP/MP' },
  { key: 'maxAttributes', label: 'Max Attributes' },
  { key: 'maxStats', label: 'Maxed Stats' },
  { key: 'allSkills', label: 'All Skills' },
  { key: 'superSpeed', label: 'Super Speed' },
];

function openAdminMenu(m) {
  m.mode = 'admin';
  m.admin = { section: 'root', cursor: 0, field: 0, scroll: 0 };
  sfx('Decision1');
}

function adminLayout() {
  return { x: subX(252), y: 8, w: 252, h: Math.min(244, H - 16), rowY: 30, rowH: 17 };
}

function adminField(label, key, value, width = 120) {
  return { label, key, value: String(value ?? ''), width };
}

function adminCurrentAttr(key) {
  return (game.hero.attr && Number.isFinite(game.hero.attr[key])) ? game.hero.attr[key] : 1;
}

function adminCurrentSkill(id) {
  return skillUiLevel(id, game.hero);
}

function adminFields(section) {
  const h = game.hero;
  switch (section) {
    case 'announce':
      return [adminField('Text', 'text', '')];
    case 'banAccount':
    case 'unbanAccount':
      return [adminField('Account', 'target', '')];
    case 'banCharacter':
    case 'unbanCharacter':
      return [adminField('Account', 'target', ''), adminField('Character', 'name', '')];
    case 'teleport':
      return [
        adminField('Player', 'target', ''),
        adminField('Map', 'map', game.mapId || 'city'),
        adminField('X', 'tx', h.tx || 0, 44),
        adminField('Y', 'ty', h.ty || 0, 44),
      ];
    case 'item':
      return [adminField('Item', 'id', 'potion'), adminField('Qty', 'n', 1, 54)];
    case 'monster':
      return [
        adminField('Kind', 'id', 'slime'),
        adminField('Qty', 'n', 1, 54),
        adminField('Map', 'map', game.mapId || 'field'),
        adminField('X', 'tx', h.tx || 0, 44),
        adminField('Y', 'ty', h.ty || 0, 44),
      ];
    case 'character': {
      const fields = [
        adminField('Class', 'class', h.class || 'Knight'),
        adminField('Level', 'level', h.lv || 1, 54),
        adminField('Gold', 'gold', h.gold || 0, 70),
        adminField('Attr Pts', 'points', h.points || 0, 54),
        adminField('Skill Pts', 'skillPoints', h.skillPoints || 0, 54),
        adminField('HP', 'hp', Math.floor(h.hp || 1), 54),
        adminField('MP', 'mp', Math.floor(h.mp || 0), 54),
      ];
      ATTRS.forEach(([key, label]) => fields.push(adminField(label, 'attr.' + key, adminCurrentAttr(key), 54)));
      ADMIN_SKILLS.forEach(id => fields.push(adminField((SKILLS[id] && SKILLS[id].name) || id, 'skill.' + id, adminCurrentSkill(id), 54)));
      return fields;
    }
    default:
      return [];
  }
}

function beginAdminForm(m, section) {
  m.admin = section === 'cheats'
    ? { section, cursor: 0, field: 0, scroll: 0 }
    : { section, cursor: 0, field: 0, scroll: 0, listScroll: 0, fields: adminFields(section) };
  sfx('Decision1');
}

function adminSectionLabel(id) {
  const s = ADMIN_SECTIONS.find(section => section.id === id);
  return s ? s.label : 'Admin';
}

function adminFormValue(a, key) {
  const f = (a.fields || []).find(field => field.key === key);
  return f ? f.value.trim() : '';
}

function adminFormField(a, key) {
  return (a.fields || []).find(field => field.key === key) || null;
}

function adminFormNumber(a, key, fallback = 0) {
  const n = Number(adminFormValue(a, key));
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function adminFormHasNumber(a, key) {
  const raw = adminFormValue(a, key);
  return raw !== '' && Number.isFinite(Number(raw));
}

function adminActionLabel(section) {
  switch (section) {
    case 'announce': return 'Send';
    case 'banAccount':
    case 'banCharacter': return 'Ban';
    case 'unbanAccount':
    case 'unbanCharacter': return 'Unban';
    case 'teleport': return 'Teleport';
    case 'item': return 'Create';
    case 'character': return 'Update';
    case 'monster': return 'Summon';
    default: return 'Apply';
  }
}

function adminCanSubmit(a) {
  if (!a) return false;
  switch (a.section) {
    case 'announce':
      return adminFormValue(a, 'text').length > 0;
    case 'banAccount':
    case 'unbanAccount':
      return adminFormValue(a, 'target').length > 0;
    case 'banCharacter':
    case 'unbanCharacter':
      return adminFormValue(a, 'target').length > 0 && adminFormValue(a, 'name').length > 0;
    case 'teleport':
      return adminFormValue(a, 'target').length > 0 ||
        (adminFormValue(a, 'map').length > 0 && adminFormHasNumber(a, 'tx') && adminFormHasNumber(a, 'ty'));
    case 'item':
      return adminFormValue(a, 'id').length > 0 && adminFormHasNumber(a, 'n') && adminFormNumber(a, 'n', 0) > 0;
    case 'character':
      return true;
    case 'monster':
      return adminFormValue(a, 'id').length > 0 && adminFormValue(a, 'map').length > 0 &&
        adminFormHasNumber(a, 'tx') && adminFormHasNumber(a, 'ty') &&
        adminFormHasNumber(a, 'n') && adminFormNumber(a, 'n', 0) > 0;
    default:
      return false;
  }
}

function adminCheatIsEnabled(key) {
  if (typeof cheatEnabled === 'function') return cheatEnabled(key, game.hero);
  return !!(game.hero && game.hero.cheats && game.hero.cheats[key]);
}

function adminHasBanList(section) {
  return section === 'banAccount' || section === 'unbanAccount' ||
    section === 'banCharacter' || section === 'unbanCharacter';
}

function adminBanRows(section) {
  const lists = game.adminBans || {};
  if (section === 'banAccount' || section === 'unbanAccount') {
    return (lists.accounts || []).map(account => ({ account, label: account }));
  }
  if (section === 'banCharacter' || section === 'unbanCharacter') {
    return (lists.characters || []).map(ch => ({
      account: ch.account || '',
      name: ch.name || '',
      label: `${ch.account || ''}/${ch.name || ''}`,
    }));
  }
  return [];
}

function adminBanListTitle(section) {
  return section === 'banAccount' || section === 'unbanAccount' ? 'Banned Accounts' : 'Banned Characters';
}

function adminVisibleFieldRows(a, l) {
  if (adminHasBanList(a.section)) return Math.max(1, (a.fields || []).length);
  return Math.max(1, Math.floor((l.h - 66) / l.rowH));
}

function adminBanListLayout(a, l, fieldRows) {
  const y = l.rowY + fieldRows * l.rowH + 8;
  const h = Math.max(30, l.y + l.h - 36 - y);
  return { x: l.x + 10, y, w: l.w - 20, h, rowY: y + 15, rowH: 14 };
}

function fillAdminBanFields(a, row) {
  const target = adminFormField(a, 'target');
  const name = adminFormField(a, 'name');
  if (target && row.account) target.value = row.account;
  if (name && row.name) name.value = row.name;
}

function toggleAdminCheat(idx) {
  const ch = ADMIN_CHEATS[idx];
  if (!ch || !game.net) { sfx('Buzzer1'); return; }
  netSend(game.net, { t: 'adminSetCheat', key: ch.key, v: !adminCheatIsEnabled(ch.key) });
  sfx('Decision1');
}

function submitAdminForm(m) {
  const a = m.admin, net = game.net;
  if (!net || !a) return;
  if (!adminCanSubmit(a)) { sfx('Buzzer1'); return; }
  switch (a.section) {
    case 'announce':
      netSend(net, { t: 'adminAnnounce', text: adminFormValue(a, 'text') });
      {
        const f = adminFormField(a, 'text');
        if (f) f.value = '';
      }
      break;
    case 'banAccount':
      netSend(net, { t: 'adminBanAccount', target: adminFormValue(a, 'target') });
      break;
    case 'unbanAccount':
      netSend(net, { t: 'adminUnbanAccount', target: adminFormValue(a, 'target') });
      break;
    case 'banCharacter':
      netSend(net, { t: 'adminBanCharacter', target: adminFormValue(a, 'target'), name: adminFormValue(a, 'name') });
      break;
    case 'unbanCharacter':
      netSend(net, { t: 'adminUnbanCharacter', target: adminFormValue(a, 'target'), name: adminFormValue(a, 'name') });
      break;
    case 'teleport':
      if (adminFormValue(a, 'target')) {
        netSend(net, { t: 'adminTeleport', target: adminFormValue(a, 'target') });
      } else {
        netSend(net, {
          t: 'adminTeleport',
          map: adminFormValue(a, 'map'),
          tx: adminFormNumber(a, 'tx', game.hero.tx || 0),
          ty: adminFormNumber(a, 'ty', game.hero.ty || 0),
        });
      }
      break;
    case 'item':
      netSend(net, { t: 'adminGrantItem', id: adminFormValue(a, 'id'), n: adminFormNumber(a, 'n', 1) });
      break;
    case 'monster':
      netSend(net, {
        t: 'adminSummon',
        id: adminFormValue(a, 'id'),
        n: adminFormNumber(a, 'n', 1),
        map: adminFormValue(a, 'map'),
        tx: adminFormNumber(a, 'tx', game.hero.tx || 0),
        ty: adminFormNumber(a, 'ty', game.hero.ty || 0),
      });
      break;
    case 'character': {
      const attr = {};
      ATTRS.forEach(([key]) => { attr[key] = adminFormNumber(a, 'attr.' + key, adminCurrentAttr(key)); });
      const skillLv = {};
      ADMIN_SKILLS.forEach(id => { skillLv[id] = adminFormNumber(a, 'skill.' + id, adminCurrentSkill(id)); });
      netSend(net, {
        t: 'adminEditSelf',
        class: adminFormValue(a, 'class') || game.hero.class,
        level: adminFormNumber(a, 'level', game.hero.lv || 1),
        gold: adminFormNumber(a, 'gold', game.hero.gold || 0),
        points: adminFormNumber(a, 'points', game.hero.points || 0),
        skillPoints: adminFormNumber(a, 'skillPoints', game.hero.skillPoints || 0),
        hp: adminFormNumber(a, 'hp', game.hero.hp || 1),
        mp: adminFormNumber(a, 'mp', game.hero.mp || 0),
        attr, skillLv,
      });
      break;
    }
  }
  sfx('Decision1');
}

function updateAdminRoot(m, mc) {
  const a = m.admin, l = adminLayout();
  const hov = hoverRow(l.x + 8, l.rowY, l.w - 16, l.rowH, ADMIN_SECTIONS.length);
  if (hov >= 0) a.cursor = hov;
  for (const c of mc) {
    if (!hit(c, l.x, l.y, l.w, l.h)) { m.mode = 'root'; sfx('Cancel1'); return; }
    const row = Math.floor((c.y - l.rowY) / l.rowH);
    if (row >= 0 && row < ADMIN_SECTIONS.length && hit(c, l.x + 8, l.rowY + row * l.rowH, l.w - 16, l.rowH)) {
      beginAdminForm(m, ADMIN_SECTIONS[row].id);
      return;
    }
  }
  if (pressed(CANCEL)) { m.mode = 'root'; sfx('Cancel1'); return; }
  if (pressed(['ArrowUp', 'w'])) { a.cursor = (a.cursor + ADMIN_SECTIONS.length - 1) % ADMIN_SECTIONS.length; sfx('Cursor1'); }
  if (pressed(['ArrowDown', 's'])) { a.cursor = (a.cursor + 1) % ADMIN_SECTIONS.length; sfx('Cursor1'); }
  if (pressed(CONFIRM)) beginAdminForm(m, ADMIN_SECTIONS[a.cursor].id);
}

function updateAdminForm(m, mc) {
  const a = m.admin, fields = a.fields || [], l = adminLayout();
  const visible = adminVisibleFieldRows(a, l);
  a.field = Math.max(0, Math.min(fields.length - 1, a.field || 0));
  if (adminHasBanList(a.section)) a.scroll = 0;
  else {
    if (a.field < a.scroll) a.scroll = a.field;
    if (a.field >= a.scroll + visible) a.scroll = a.field - visible + 1;
  }
  const listBox = adminHasBanList(a.section) ? adminBanListLayout(a, l, visible) : null;
  for (const c of mc) {
    if (!hit(c, l.x, l.y, l.w, l.h)) { a.section = 'root'; sfx('Cancel1'); return; }
    for (let i = 0; i < visible; i++) {
      const idx = a.scroll + i, y = l.rowY + i * l.rowH;
      if (idx < fields.length && hit(c, l.x + 8, y, l.w - 16, l.rowH)) {
        a.field = idx;
        sfx('Cursor1');
      }
    }
    if (listBox && hit(c, listBox.x, listBox.y, listBox.w, listBox.h)) {
      const rows = adminBanRows(a.section);
      const listVisible = Math.max(1, Math.floor((listBox.y + listBox.h - listBox.rowY) / listBox.rowH));
      a.listScroll = Math.max(0, Math.min(Math.max(0, rows.length - listVisible), a.listScroll || 0));
      const idx = (a.listScroll || 0) + Math.floor((c.y - listBox.rowY) / listBox.rowH);
      if (idx >= 0 && idx < rows.length) {
        fillAdminBanFields(a, rows[idx]);
        sfx('Cursor1');
      }
    }
    if (hit(c, l.x + 18, l.y + l.h - 26, 70, 18)) submitAdminForm(m);
    if (hit(c, l.x + 96, l.y + l.h - 26, 52, 18)) { a.section = 'root'; sfx('Cancel1'); }
  }
  for (const k of queue) {
    const f = fields[a.field];
    if (!f) continue;
    if (k === 'Escape') { a.section = 'root'; sfx('Cancel1'); break; }
    if (k === 'Enter') { submitAdminForm(m); break; }
    if (k === 'Tab' || k === 'ArrowDown') { a.field = (a.field + 1) % fields.length; sfx('Cursor1'); continue; }
    if (k === 'ArrowUp') { a.field = (a.field + fields.length - 1) % fields.length; sfx('Cursor1'); continue; }
    if (k === 'Backspace') { f.value = f.value.slice(0, -1); continue; }
    if (k.length === 1 && k.charCodeAt(0) >= 32 && k.charCodeAt(0) < 127 && f.value.length < 120) f.value += k;
  }
  queue = [];
  const wheel = typeof wheelY !== 'undefined' ? wheelY : 0;
  if (wheel !== 0) {
    if (listBox && hit(mouse, listBox.x, listBox.y, listBox.w, listBox.h)) {
      const rows = adminBanRows(a.section);
      const listVisible = Math.max(1, Math.floor((listBox.y + listBox.h - listBox.rowY) / listBox.rowH));
      a.listScroll = Math.max(0, Math.min(Math.max(0, rows.length - listVisible), (a.listScroll || 0) + (wheel > 0 ? 1 : -1)));
    } else if (!adminHasBanList(a.section)) {
      a.scroll = Math.max(0, Math.min(Math.max(0, fields.length - visible), a.scroll + (wheel > 0 ? 1 : -1)));
    }
    wheelY = 0;
  }
}

function updateAdminCheats(m, mc) {
  const a = m.admin, l = adminLayout();
  a.cursor = Math.max(0, Math.min(ADMIN_CHEATS.length - 1, a.cursor || 0));
  const hov = hoverRow(l.x + 8, l.rowY, l.w - 16, l.rowH, ADMIN_CHEATS.length);
  if (hov >= 0) a.cursor = hov;
  for (const c of mc) {
    if (!hit(c, l.x, l.y, l.w, l.h)) { a.section = 'root'; sfx('Cancel1'); return; }
    const row = Math.floor((c.y - l.rowY) / l.rowH);
    if (row >= 0 && row < ADMIN_CHEATS.length && hit(c, l.x + 8, l.rowY + row * l.rowH, l.w - 16, l.rowH)) {
      a.cursor = row;
      toggleAdminCheat(row);
      return;
    }
    if (hit(c, l.x + 18, l.y + l.h - 26, 52, 18)) { a.section = 'root'; sfx('Cancel1'); return; }
  }
  if (pressed(CANCEL)) { a.section = 'root'; sfx('Cancel1'); return; }
  if (pressed(['ArrowUp', 'w'])) { a.cursor = (a.cursor + ADMIN_CHEATS.length - 1) % ADMIN_CHEATS.length; sfx('Cursor1'); }
  if (pressed(['ArrowDown', 's'])) { a.cursor = (a.cursor + 1) % ADMIN_CHEATS.length; sfx('Cursor1'); }
  if (pressed(CONFIRM)) toggleAdminCheat(a.cursor);
}

function updateAdminMenu(m, mc) {
  if (!game.isAdmin) { m.mode = 'root'; return; }
  if (!m.admin) m.admin = { section: 'root', cursor: 0, field: 0, scroll: 0 };
  if (m.admin.section === 'root') updateAdminRoot(m, mc);
  else if (m.admin.section === 'cheats') updateAdminCheats(m, mc);
  else updateAdminForm(m, mc);
}

function drawAdminMenu(m) {
  const a = m.admin || { section: 'root', cursor: 0 }, l = adminLayout();
  drawWindow(l.x, l.y, l.w, l.h);
  text(a.section === 'root' ? 'Admin' : adminSectionLabel(a.section), l.x + 12, l.y + 9, '#ffe080');
  if (a.section === 'root') {
    ADMIN_SECTIONS.forEach((s, i) => {
      const y = l.rowY + i * l.rowH;
      if (a.cursor === i) drawCursor(l.x + 8, y, l.w - 16, l.rowH);
      text(s.label, l.x + 16, y + 4);
    });
    return;
  }
  if (a.section === 'cheats') {
    ADMIN_CHEATS.forEach((ch, i) => {
      const y = l.rowY + i * l.rowH;
      if (a.cursor === i) drawCursor(l.x + 8, y, l.w - 16, l.rowH);
      text(ch.label, l.x + 16, y + 4);
      drawWindow(l.x + l.w - 58, y, 42, 16);
      const on = adminCheatIsEnabled(ch.key);
      text(on ? 'On' : 'Off', l.x + l.w - 45, y + 4, on ? '#8f8' : '#999');
    });
    drawWindow(l.x + 18, l.y + l.h - 26, 52, 18);
    text('Back', l.x + 18 + Math.max(4, Math.floor((52 - textWidth('Back')) / 2)), l.y + l.h - 20);
    return;
  }
  const fields = a.fields || [], visible = adminVisibleFieldRows(a, l);
  for (let i = 0; i < visible; i++) {
    const idx = (a.scroll || 0) + i, f = fields[idx];
    if (!f) break;
    const y = l.rowY + i * l.rowH;
    if (idx === a.field) drawCursor(l.x + 8, y, l.w - 16, l.rowH);
    text(f.label, l.x + 14, y + 4, '#bcd');
    const valueX = l.x + 92;
    const shown = f.value.length > 22 ? f.value.slice(f.value.length - 22) : f.value;
    text(shown + (idx === a.field && Math.floor(performance.now() / 300) % 2 ? '_' : ''), valueX, y + 4, '#fff');
  }
  if (adminHasBanList(a.section)) {
    const box = adminBanListLayout(a, l, visible);
    const rows = adminBanRows(a.section);
    const listVisible = Math.max(1, Math.floor((box.y + box.h - box.rowY) / box.rowH));
    const maxScroll = Math.max(0, rows.length - listVisible);
    a.listScroll = Math.max(0, Math.min(maxScroll, a.listScroll || 0));
    drawWindow(box.x, box.y, box.w, box.h);
    text(adminBanListTitle(a.section), box.x + 6, box.y + 5, '#bcd');
    if (rows.length === 0) {
      text('None', box.x + 8, box.rowY + 2, '#777');
    } else {
      for (let i = 0; i < listVisible; i++) {
        const row = rows[(a.listScroll || 0) + i];
        if (!row) break;
        const y = box.rowY + i * box.rowH;
        text(row.label.length > 30 ? row.label.slice(0, 30) : row.label, box.x + 8, y + 3, '#fff');
      }
      if (maxScroll > 0) {
        text(`${(a.listScroll || 0) + 1}-${Math.min(rows.length, (a.listScroll || 0) + listVisible)}/${rows.length}`,
          box.x + box.w - 58, box.y + 5, '#9cf');
      }
    }
  }
  const label = adminActionLabel(a.section);
  const canSubmit = adminCanSubmit(a);
  drawWindow(l.x + 18, l.y + l.h - 26, 70, 18);
  text(label, l.x + 18 + Math.max(4, Math.floor((70 - textWidth(label)) / 2)), l.y + l.h - 20, canSubmit ? '#fff' : '#777');
  drawWindow(l.x + 96, l.y + l.h - 26, 52, 18);
  text('Back', l.x + 113, l.y + l.h - 20);
}
