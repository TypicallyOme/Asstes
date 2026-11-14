/* ============================================================
   ORBIT — DMs and group chats
   ============================================================ */
(function () {
  'use strict';
  const O = window.Orbit;
  const { db, TS, el, I, uid } = O;

  O.init({ page: 'dms', require: true });

  const layout = O.$('#layout'), convList = O.$('#convList'), peopleList = O.$('#peopleList');
  const sideSearch = O.$('#sideSearch'), head = O.$('#dmHead'), convoEl = O.$('#convo'), emptyEl = O.$('#dmEmpty');
  O.$('#newGroupBtn').innerHTML = I.group;
  O.$('#emptyIcon').innerHTML = I.dm;
  O.$('#newGroupBtn').onclick = () => groupPicker();
  O.$('#emptyGroupBtn').onclick = () => groupPicker();

  // ---------- my conversations (live) ----------
  const metas = new Map();     // cid -> meta
  const metaRefs = new Map();  // cid -> unsubscribe
  let userConvs = {}, reads = {};
  let activeCid = null, convo = null;

  db.ref('userConvs/' + uid).on('value', s => {
    userConvs = s.val() || {};
    Object.keys(userConvs).forEach(cid => {
      if (metaRefs.has(cid)) return;
      const ref = db.ref('convs/' + cid);
      const cb = ref.on('value', ms => {
        const m = ms.val();
        if (m && m.members && m.members[uid]) metas.set(cid, m); else metas.delete(cid);
        if (cid === activeCid) { if (!metas.has(cid)) closeConv('You are no longer in this chat'); else drawHead(); }
        schedule();
      });
      metaRefs.set(cid, () => ref.off('value', cb));
    });
    for (const [cid, offFn] of metaRefs) if (!userConvs[cid]) { offFn(); metaRefs.delete(cid); metas.delete(cid); }
    schedule();
  });
  O.on('unread', d => { reads = d.reads || {}; schedule(); });
  O.on('change', () => { schedule(); if (activeCid) drawHead(); });
  sideSearch.addEventListener('input', () => schedule());

  let queued = false;
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; drawSide(); }); }

  const lastTs = m => ((m.last && m.last.ts) || m.createdAt || 0);
  const isUnread = cid => cid !== activeCid && (userConvs[cid] || 0) > (reads[cid] || 0);
  const memberNames = m => Object.keys(m.members || {}).map(id => (O.user(id) || {}).name || '').join(' ').toLowerCase();

  function convAvatar(m, size = 40) {
    if (m.type !== 'group') {
      const wrap = el('div', { class: 'stack single' }, O.avatar(O.dm.other(m), size, false));
      return wrap;
    }
    const others = Object.keys(m.members || {}).filter(id => id !== uid && O.user(id)).slice(0, 2);
    const wrap = el('div', { class: 'stack' + (others.length < 2 ? ' single' : '') });
    if (!others.length) wrap.append(O.avatarFrom({ name: m.name || 'G' }, size));
    else if (others.length === 1) wrap.append(O.avatar(others[0], size, false));
    else others.forEach(id => wrap.append(O.avatar(id, 28, false)));
    return wrap;
  }
  function convName(m) {
    if (m.type === 'group') return el('span', { class: 'gname' }, m.name || 'Group chat');
    const other = O.dm.other(m);
    return O.user(other) ? O.nameTag(other) : el('span', { class: 'gname' }, 'Deleted user');
  }

  function drawSide() {
    const q = sideSearch.value.trim().toLowerCase();
    // chats
    const convs = [...metas.entries()]
      .filter(([cid, m]) => !q || O.dm.title(m).toLowerCase().includes(q) || memberNames(m).includes(q))
      .sort((a, b) => lastTs(b[1]) - lastTs(a[1]));
    convList.innerHTML = '';
    if (!convs.length) convList.append(el('div', { class: 'side-empty' }, q ? 'No chats match' : 'No chats yet'));
    convs.forEach(([cid, m]) => {
      const unread = isUnread(cid);
      const last = m.last || {};
      const who = last.uid === uid ? 'You: ' : (m.type === 'group' && O.user(last.uid) ? O.user(last.uid).name + ': ' : '');
      const row = el('button', { type: 'button', class: 'row' + (cid === activeCid ? ' on' : '') + (unread ? ' unread' : ''), onclick: () => openConv(cid) },
        convAvatar(m),
        el('div', { class: 'grow' },
          el('div', { class: 'line1' }, convName(m), el('span', { class: 'when' }, lastTs(m) ? O.timeAgo(lastTs(m)) : '')),
          el('div', { class: 'line2' }, last.text ? who + last.text : (m.type === 'group' ? Object.keys(m.members || {}).length + ' members' : 'Say hi 👋'))),
        unread ? el('span', { class: 'udot' }) : null);
      if (m.type !== 'group' && O.isOnline(O.dm.other(m))) row.append(el('span', { class: 'online' }));
      convList.append(row);
    });
    // people
    const people = Object.keys(O.S.users)
      .filter(id => id !== uid && O.user(id) && (!q || O.user(id).name.toLowerCase().includes(q)))
      .sort((a, b) => (O.isOnline(b) - O.isOnline(a)) || O.user(a).name.localeCompare(O.user(b).name));
    peopleList.innerHTML = '';
    if (!people.length) peopleList.append(el('div', { class: 'side-empty' }, q ? 'Nobody matches “' + sideSearch.value.trim() + '”' : 'No one else here yet'));
    people.forEach(id => {
      const u = O.user(id);
      const row = el('button', { type: 'button', class: 'row' + (activeCid === O.dm.id(uid, id) ? ' on' : ''), onclick: () => openDM(id) },
        O.avatar(id, 40, false),
        el('div', { class: 'grow' }, el('div', { class: 'line1' }, O.nameTag(id)),
          el('div', { class: 'line2' }, O.isOnline(id) ? 'Online' : (u.bio || 'Offline'))));
      if (O.isOnline(id)) row.append(el('span', { class: 'online' }));
      peopleList.append(row);
    });
  }

  // ---------- open / close ----------
  async function openDM(other) {
    if (!O.me()) return O.openProfile({ setup: true });
    if (other === uid || !O.user(other)) return O.toast('That person was not found', true);
    try { openConv(await O.dm.ensure(other)); } catch (e) { O.toast(e.message, true); }
  }

  async function openConv(cid) {
    let meta = metas.get(cid);
    if (!meta) {
      const s = await db.ref('convs/' + cid).once('value');
      meta = s.val();
      if (!meta || !meta.members || !meta.members[uid]) return O.toast('You are not in that chat', true);
      metas.set(cid, meta);
    }
    if (convo) { convo.destroy(); convo = null; }
    activeCid = cid;
    history.replaceState(null, '', '#c=' + encodeURIComponent(cid));
    layout.classList.add('open');
    emptyEl.classList.add('hidden');
    head.classList.remove('hidden');
    convoEl.classList.remove('hidden');
    drawHead();
    const searchBtn = head.querySelector('.hsearch');
    convo = O.Conversation({
      mount: convoEl,
      msgPath: 'convMsgs/' + cid,
      typingPath: 'convTyping/' + cid,
      placeholder: meta.type === 'group' ? 'Message ' + (meta.name || 'the group') : 'Message ' + O.dm.title(meta),
      emptyText: meta.type === 'group' ? 'This is the start of ' + (meta.name || 'the group') + '.' : 'This is the start of your DM with ' + O.dm.title(meta) + '.',
      members: () => Object.keys((metas.get(cid) || {}).members || {}),
      send: msg => O.dm.send(cid, msg),
      onActivity: () => { if (activeCid === cid && document.visibilityState === 'visible') O.dm.markRead(cid); },
      searchBtn
    });
    O.dm.markRead(cid);
    schedule();
    setTimeout(() => convo && convo.focus(), 50);
  }
  document.addEventListener('visibilitychange', () => { if (activeCid && document.visibilityState === 'visible') O.dm.markRead(activeCid); });

  function closeConv(msg) {
    if (convo) { convo.destroy(); convo = null; }
    activeCid = null;
    history.replaceState(null, '', location.pathname);
    layout.classList.remove('open');
    head.classList.add('hidden'); convoEl.classList.add('hidden'); emptyEl.classList.remove('hidden');
    if (msg) O.toast(msg);
    schedule();
  }

  // ---------- header ----------
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  document.addEventListener('pointerdown', e => { if (menuEl && !menuEl.contains(e.target) && !e.target.closest('.hmenu')) closeMenu(); });

  function drawHead() {
    const meta = metas.get(activeCid);
    if (!meta) return;
    const oldSearch = head.querySelector('.hsearch');
    const back = el('button', { class: 'icon-btn back', type: 'button', title: 'Back', html: I.back, onclick: () => closeConv() });
    const av = convAvatar(meta, 38);
    let sub;
    if (meta.type === 'group') {
      const names = Object.keys(meta.members).filter(id => O.user(id)).map(id => id === uid ? 'You' : O.user(id).name);
      sub = names.length + ' members · ' + names.slice(0, 5).join(', ') + (names.length > 5 ? '…' : '');
    } else {
      const other = O.dm.other(meta);
      sub = O.isOnline(other) ? '● Online' : 'Offline';
      av.style.cursor = 'pointer';
      av.onclick = () => O.openUserCard(other);
    }
    const searchBtn = oldSearch || el('button', { class: 'icon-btn hsearch', type: 'button', title: 'Search this chat (Ctrl+F)' });
    const menuBtn = el('button', { class: 'icon-btn hmenu', type: 'button', title: 'Options', html: I.more, onclick: () => openMenu(meta) });
    head.innerHTML = '';
    head.append(back, av, el('div', { class: 'grow' }, el('div', null, convName(meta)), el('div', { class: 'sub' }, sub)), searchBtn, menuBtn);
  }

  function openMenu(meta) {
    if (menuEl) return closeMenu();
    const cid = activeCid;
    const items = [];
    const add = (icon, label, fn, cls) => items.push(el('button', { type: 'button', class: cls || '', html: icon + O.esc(label), onclick: () => { closeMenu(); fn(); } }));
    if (meta.type === 'group') {
      add(I.users, 'Members', () => showMembers(cid));
      add(I.plus, 'Add people', () => groupPicker(cid));
      add(I.edit, 'Rename group', async () => {
        const n = await O.promptText({ title: 'Rename group', value: meta.name || '', multiline: false });
        if (n && n.trim()) db.ref('convs/' + cid + '/name').set(n.trim().slice(0, 40));
      });
      add(I.x, 'Leave group', async () => {
        if (!(await O.confirmBox('Leave ' + (meta.name || 'this group') + '? You can be added back later.', 'Leave', true))) return;
        await db.ref().update({ ['convs/' + cid + '/members/' + uid]: null, ['userConvs/' + uid + '/' + cid]: null });
        closeConv('You left the group');
      }, 'danger');
    } else {
      const other = O.dm.other(meta);
      add(I.user, 'View profile', () => O.openUserCard(other));
      add(I.x, 'Hide this chat', async () => {
        await db.ref('userConvs/' + uid + '/' + cid).remove();
        closeConv('Chat hidden — it comes back if they message you');
      });
    }
    menuEl = el('div', { class: 'menu' }, items);
    head.parentElement.append(menuEl);
  }

  function showMembers(cid) {
    const meta = metas.get(cid); if (!meta) return;
    const list = el('div');
    Object.keys(meta.members).filter(id => O.user(id)).sort((a, b) => O.user(a).name.localeCompare(O.user(b).name)).forEach(id => {
      list.append(el('div', { class: 'mrow' }, O.avatar(id, 34),
        el('div', { class: 'grow' }, O.nameTag(id), el('div', { class: 'sub' }, (id === meta.createdBy ? 'Group creator · ' : '') + (O.isOnline(id) ? 'online' : 'offline'))),
        id !== uid ? el('button', { class: 'btn sm', onclick: () => { m.close(); openDM(id); } }, 'Message') : el('span', { class: 'sub' }, 'You')));
    });
    const m = O.modal({ title: (meta.name || 'Group') + ' · members', body: list });
  }

  // ---------- new group / add people ----------
  function groupPicker(addToCid) {
    if (!O.me()) return O.openProfile({ setup: true });
    const existing = addToCid ? Object.keys((metas.get(addToCid) || {}).members || {}) : [];
    const chosen = new Set();
    const nameIn = el('input', { class: 'input', maxlength: 40, placeholder: 'Group name' });
    const search = el('input', { class: 'input', placeholder: 'Search people', style: 'margin-top:10px' });
    const picked = el('div', { class: 'picked' });
    const listEl = el('div', { class: 'pick-list' });
    const go = el('button', { class: 'btn primary', disabled: true }, addToCid ? 'Add' : 'Create group');
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      listEl.innerHTML = '';
      const ids = Object.keys(O.S.users).filter(id => id !== uid && O.user(id) && !existing.includes(id) && (!q || O.user(id).name.toLowerCase().includes(q)))
        .sort((a, b) => (O.isOnline(b) - O.isOnline(a)) || O.user(a).name.localeCompare(O.user(b).name));
      if (!ids.length) listEl.append(el('div', { class: 'side-empty' }, q ? 'Nobody matches' : 'No one to add'));
      ids.forEach(id => listEl.append(el('button', { type: 'button', class: 'pick' + (chosen.has(id) ? ' on' : ''),
        onclick: () => { chosen.has(id) ? chosen.delete(id) : chosen.add(id); draw(); } },
        O.avatar(id, 32, false), el('div', { class: 'grow' }, O.nameTag(id)), el('span', { class: 'check' }))));
      picked.innerHTML = '';
      chosen.forEach(id => picked.append(el('button', { type: 'button', class: 'chip on', title: 'Remove', onclick: () => { chosen.delete(id); draw(); } }, O.avatar(id, 20, false), O.user(id).name, ' ×')));
      go.disabled = !chosen.size;
      go.textContent = addToCid ? 'Add ' + (chosen.size || '') : 'Create group' + (chosen.size ? ' (' + (chosen.size + 1) + ')' : '');
    };
    search.oninput = draw;
    const body = el('div', null, addToCid ? null : nameIn, search, picked, listEl);
    const m = O.modal({ title: addToCid ? 'Add people' : 'New group chat', body, foot: [go] });
    go.onclick = async () => {
      if (!chosen.size) return;
      go.disabled = true;
      try {
        if (addToCid) {
          const upd = {};
          chosen.forEach(id => { upd['convs/' + addToCid + '/members/' + id] = true; upd['userConvs/' + id + '/' + addToCid] = TS; });
          await db.ref().update(upd);
          m.close(); O.toast('Added ' + chosen.size + (chosen.size === 1 ? ' person' : ' people'));
        } else {
          const fallback = [O.me().name, ...[...chosen].map(id => O.user(id).name)].slice(0, 3).join(', ');
          const cid = await O.dm.createGroup(nameIn.value.trim() || fallback, [...chosen]);
          m.close(); openConv(cid);
        }
      } catch (e) { O.toast(e.message, true); go.disabled = false; }
    };
    draw();
    setTimeout(() => (addToCid ? search : nameIn).focus(), 40);
  }

  // ---------- deep links: #u=<uid> opens a DM, #c=<cid> opens a chat ----------
  async function handleHash() {
    await O.ready;
    const u = location.hash.match(/u=([A-Za-z0-9_-]+)/);
    const c = location.hash.match(/c=([A-Za-z0-9_-]+)/);
    if (u) openDM(decodeURIComponent(u[1]));
    else if (c && c[1] !== activeCid) openConv(decodeURIComponent(c[1]));
  }
  window.addEventListener('hashchange', handleHash);
  handleHash();
  drawSide();
})();
