/* ============================================================
   ORBIT — conversation view
   One engine for the main chat, DMs and group chats:
   messages, replies, reactions, attachments, emojis,
   mentions, typing indicator, search and moderation.
   ============================================================ */
(function () {
  'use strict';
  const O = window.Orbit;
  const { db, TS, el, I, uid } = O;
  const SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  const SEARCH_LIMIT = 1000;

  /**
   * Orbit.Conversation({
   *   mount,          // element to render into
   *   msgPath,        // e.g. 'messages' or 'convMsgs/<id>'
   *   typingPath,     // e.g. 'typing' or 'convTyping/<id>'
   *   send(msg),      // optional custom sender (DMs fan out); default pushes to msgPath
   *   members(),      // optional: uids allowed in @mention suggestions
   *   placeholder, emptyText,
   *   searchBtn,      // optional button that opens message search
   *   onActivity()    // optional: called when new messages arrive (mark as read)
   * }) -> { destroy(), focus(), openSearch() }
   */
  O.Conversation = function (opts) {
    const msgPath = opts.msgPath;
    const placeholder = opts.placeholder || 'Message';
    const cleanups = [];
    const listen = (evt, fn) => { O.on(evt, fn); cleanups.push(() => O.off(evt, fn)); };
    const every = (fn, ms) => { const t = setInterval(fn, ms); cleanups.push(() => clearInterval(t)); };
    const docOn = (type, fn, cap) => { document.addEventListener(type, fn, cap); cleanups.push(() => document.removeEventListener(type, fn, cap)); };

    // ---------- DOM ----------
    const list = el('div');
    const olderBtn = el('button', { class: 'btn sm', type: 'button' }, 'Load earlier messages');
    const olderWrap = el('div', { class: 'older hidden' }, olderBtn);
    const feed = el('section', { class: 'feed' }, el('div', { class: 'feed-inner' }, olderWrap, list));
    const newPill = el('button', { class: 'btn sm newpill hidden', type: 'button' }, 'New messages ↓');
    const typingEl = el('div', { class: 'typing' });
    const mentionPop = el('div', { class: 'mention-pop hidden' });
    const replyBar = el('div', { class: 'replybar hidden' });
    const pendingEl = el('div', { class: 'pending' });
    const timeoutNote = el('div', { class: 'timeout-note hidden' });
    const attachBtn = el('button', { class: 'icon-btn', type: 'button', title: 'Attach image, audio or video', html: I.clip });
    const fileIn = el('input', { type: 'file', class: 'hidden', multiple: true, accept: O.ACCEPT });
    const input = el('textarea', { rows: 1, placeholder, maxlength: 4000 });
    const emojiBtn = el('button', { class: 'icon-btn', type: 'button', title: 'Emojis', html: I.smile });
    const sendBtn = el('button', { class: 'send', type: 'button', title: 'Send', disabled: true, html: I.send });
    const composer = el('div', { class: 'composer' }, replyBar, pendingEl, timeoutNote,
      el('div', { class: 'crow' }, attachBtn, fileIn, input, emojiBtn, sendBtn));
    const area = el('section', { class: 'composer-area' },
      el('div', { class: 'composer-wrap' }, newPill, typingEl, mentionPop, composer));
    opts.mount.innerHTML = '';
    opts.mount.append(feed, area);

    // ---------- state ----------
    const msgs = new Map();
    const nodes = new Map();
    let limit = 200, query = null, initialLoaded = false, stick = true;
    let replyTo = null, pending = [], pendingJump = null, pendingScrollTo = null, destroyed = false;

    function subscribe() {
      if (query) query.off();
      msgs.clear();
      initialLoaded = false;
      const q = db.ref(msgPath).limitToLast(limit);
      query = q;
      q.on('child_added', s => {
        const m = s.val(); if (!m) return;
        msgs.set(s.key, m);
        if (initialLoaded && m.uid !== uid) {
          if (O.mentionsMe(m.text)) { const n = O.user(m.uid); O.toast((n ? n.name : 'Someone') + ' mentioned you'); }
          opts.onActivity && opts.onActivity();
        }
        schedule();
      });
      q.on('child_changed', s => { msgs.set(s.key, s.val()); schedule(); });
      q.on('child_removed', s => { msgs.delete(s.key); schedule(); });
      q.once('value', s => {
        if (query !== q) return;
        initialLoaded = true;
        olderWrap.classList.toggle('hidden', s.numChildren() < limit);
        schedule(true);
        opts.onActivity && opts.onActivity();
      });
    }
    cleanups.push(() => { if (query) query.off(); });
    olderBtn.onclick = () => { pendingScrollTo = [...msgs.keys()][0]; limit += 200; subscribe(); };

    // ---------- render ----------
    let scheduled = false, forceBottom = false;
    function schedule(bottom) {
      if (bottom) forceBottom = true;
      if (scheduled || destroyed) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; if (!destroyed) render(); });
    }
    listen('change', () => schedule());

    function render() {
      const wasBottom = stick || forceBottom;
      const ids = [...msgs.keys()].sort((a, b) => (msgs.get(a).ts || 0) - (msgs.get(b).ts || 0) || (a < b ? -1 : 1));
      const ns = Object.keys(O.S.byName).join(',');
      const out = [];
      let prev = null;
      ids.forEach(id => {
        const m = msgs.get(id);
        const grouped = !!(prev && prev.uid === m.uid && !prev.forward && !m.replyTo && !m.share && !m.forward && (m.ts - prev.ts) < 5 * 60e3);
        const sig = JSON.stringify(m) + '§' + O.userSig(m.uid) + '§' + grouped + '§' + O.canModerate(m.uid) + '§' +
          (m.replyTo ? O.userSig(m.replyTo.uid) : '') + '§' + (m.forward ? O.userSig(m.forward.uid) : '') + '§' + (/@/.test(m.text || '') ? ns + (O.me() || {}).name : '');
        const cached = nodes.get(id);
        if (cached && cached.sig === sig) out.push(cached.node);
        else { const node = buildMsg(id, m, grouped); nodes.set(id, { node, sig }); out.push(node); }
        prev = m;
      });
      let ref = list.firstChild;
      out.forEach(node => { if (node === ref) ref = ref.nextSibling; else list.insertBefore(node, ref); });
      while (ref) { const next = ref.nextSibling; ref.remove(); ref = next; }
      for (const id of [...nodes.keys()]) if (!msgs.has(id)) nodes.delete(id);
      if (!ids.length && initialLoaded) list.append(el('div', { class: 'empty' }, opts.emptyText || 'No messages yet — say hi 👋'));

      if (pendingJump && nodes.get(pendingJump)) {
        const id = pendingJump; pendingJump = null; stick = false;
        setTimeout(() => jumpTo(id), 30);
      } else if (pendingScrollTo && nodes.get(pendingScrollTo)) {
        nodes.get(pendingScrollTo).node.scrollIntoView({ block: 'start' });
        pendingScrollTo = null;
      } else if (wasBottom) {
        feed.scrollTop = feed.scrollHeight;
      } else if (initialLoaded) {
        newPill.classList.remove('hidden');
      }
      forceBottom = false;
    }

    function buildMsg(id, m, grouped) {
      const mentioned = m.uid !== uid && O.mentionsMe(m.text);
      const node = el('div', { class: 'msg' + (grouped ? ' grouped' : '') + (mentioned ? ' mentioned' : ''), 'data-id': id });
      const gutter = el('div', { class: 'gutter' });
      if (grouped) gutter.append(el('span', { class: 'gt' }, new Date(m.ts || 0).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })));
      else gutter.append(O.avatar(m.uid, 40));
      const body = el('div', { class: 'mbody' });
      if (m.replyTo && m.replyTo.id) {
        const ru = O.user(m.replyTo.uid);
        body.append(el('div', { class: 'reply-ref', onclick: () => jumpTo(m.replyTo.id) },
          O.avatar(m.replyTo.uid, 16, false), O.nameFrom(ru || { name: 'unknown' }),
          el('span', { class: 'rt' }, (m.replyTo.text || '').replace(/:gd\d+:/g, '🙂') || '[attachment]')));
      }
      if (!grouped) body.append(el('div', { class: 'mhead' }, O.nameTag(m.uid),
        el('span', { class: 'time', title: new Date(m.ts || 0).toLocaleString() }, O.clock(m.ts || 0))));
      if (m.text) {
        const t = O.richEl(m.text);
        if (m.edited) t.append(el('span', { class: 'edited' }, m.editedBy && m.editedBy !== m.uid ? '(edited by mod)' : '(edited)'));
        body.append(t);
      }
      if (m.forward) body.append(forwardCard(m.forward));
      else {
        const atts = O.attachmentsEl(m.attachments); if (atts) body.append(atts);
        if (m.share && m.share.id) body.append(shareCard(m.share));
      }
      const rpath = msgPath + '/' + id + '/reactions';
      const r = O.reactionsEl(m.reactions, rpath); if (r) body.append(r);

      const acts = el('div', { class: 'mactions' });
      const act = (icon, title, fn, cls) => acts.append(el('button', { type: 'button', title, class: cls || '', html: icon, onclick: e => { e.stopPropagation(); fn(e); } }));
      act(I.react, 'React', e => O.openPicker(e.currentTarget, eid => O.toggleReaction(rpath, eid), { title: 'React' }));
      act(I.reply, 'Reply', () => setReply(id, m));
      act(I.share, 'Forward to DM', () => forwardToDM(m));
      const own = m.uid === uid;
      const canMod = !own && O.canModerate(m.uid);
      if (own || canMod) {
        act(I.edit, own ? 'Edit' : 'Edit (mod)', () => O.mod.editMessage(id, m, msgPath));
        act(I.trash, own ? 'Delete' : 'Delete (mod)', e => O.mod.deleteMessage(id, m, e.shiftKey, msgPath), 'danger');
      }
      if (canMod) act(I.clock, 'Time out user', async () => {
        if (O.timeoutLeft(m.uid) > 0) return O.mod.untimeout(m.uid);
        const ms = await O.chooseDuration((O.user(m.uid) || {}).name); if (ms) O.mod.timeout(m.uid, ms);
      });
      node.append(gutter, body, acts);
      node.addEventListener('click', e => {
        if (e.target.closest('a,button,video,audio,img,.uname,.mention,.av')) return;
        if (matchMedia('(hover: none)').matches) {
          list.querySelectorAll('.msg.sel').forEach(x => x !== node && x.classList.remove('sel'));
          node.classList.toggle('sel');
        }
      });
      return node;
    }

    function shareCard(sh) {
      const archive = sh.type === 'archive';
      const community = sh.type === 'community';
      const href = community ? 'groups.html#community=' + encodeURIComponent(sh.id) : archive ? 'archive.html#box=' + encodeURIComponent(sh.id) : 'post.html#p=' + encodeURIComponent(sh.id);
      const icon = community ? I.group : archive ? I.archive : I.posts;
      const kind = community ? 'Community' : archive ? 'Archive box' : 'Post';
      const copy = sh.text || (archive ? sh.url || '' : community ? 'Public Orbit community' : sh.title ? '' : sh.media ? '[' + sh.media + ']' : '');
      const card = el('a', { class: 'share-card', href },
        el('div', { class: 'sc-head', html: icon.replace('<svg', '<svg width="14" height="14"') + ' ' + kind + ' by ' }),
        sh.title ? el('div', { class: 'sc-title' }, sh.title) : null,
        el('div', { class: 'sc-text' }, O.richEl(copy, 'span')),
        el('div', { class: 'sc-open' }, community ? 'Open community →' : archive ? 'Open Archive box →' : 'Open post →'));
      card.querySelector('.sc-head').append(O.nameFrom(O.user(sh.uid) || { name: 'unknown' }));
      return card;
    }

    function forwardCard(forward) {
      const box = el('div', { class: 'forward-card' },
        el('div', { class: 'forward-label' }, 'Forwarded from ', O.nameTag(forward.uid || '')));
      if (forward.text) box.append(O.richEl(forward.text));
      const atts = O.attachmentsEl(forward.attachments); if (atts) box.append(atts);
      if (forward.share && forward.share.id) box.append(shareCard(forward.share));
      if (!forward.text && !atts && !forward.share) box.append(el('span', { class: 'muted' }, '[message]'));
      return box;
    }

    function forwardToDM(message) {
      if (!O.canAct()) return;
      const note = el('textarea', { class: 'textarea', rows: 2, placeholder: 'Add a message (optional)', maxlength: 1000, style: 'min-height:60px' });
      const original = message.forward || message;
      const preview = el('div', { class: 'forward-preview' },
        el('div', { class: 'forward-label' }, 'Forward from ', O.nameTag(original.uid || message.uid)),
        original.text ? O.richEl(original.text) : null,
        original.attachments ? el('div', { class: 'muted' }, 'Message includes attachments') : null,
        original.share ? el('div', { class: 'muted' }, 'Message includes a shared item') : null);
      const search = el('input', { class: 'input', placeholder: 'Search DMs or people' });
      const listEl = el('div', { class: 'pick-list' });
      const sendBtn = el('button', { class: 'btn primary' }, 'Forward');
      let convs = [];
      let dest = null;
      const same = d => !!dest && d.type === dest.type && d.id === dest.id;
      const draw = () => {
        const q = search.value.trim().toLowerCase();
        listEl.innerHTML = '';
        const row = (d, avatar, label, sub) => listEl.append(el('button', { type: 'button', class: 'pick' + (same(d) ? ' on' : ''), onclick: () => { dest = d; draw(); } },
          avatar, el('div', { class: 'grow' }, el('div', null, label), el('div', { class: 'muted', style: 'font-size:12px' }, sub)), el('span', { class: 'check round' })));
        const dmWith = new Set();
        convs.filter(([, meta]) => meta && meta.type === 'dm').forEach(([cid, meta]) => {
          const other = O.dm.other(meta); dmWith.add(other);
          const title = O.dm.title(meta);
          if (!q || title.toLowerCase().includes(q)) row({ type: 'conv', id: cid }, O.avatar(other, 32, false), O.nameTag(other), 'DM');
        });
        Object.keys(O.S.users).filter(id => id !== uid && O.user(id) && !dmWith.has(id) && (!q || O.user(id).name.toLowerCase().includes(q)))
          .sort((a, b) => O.user(a).name.localeCompare(O.user(b).name)).slice(0, 40)
          .forEach(id => row({ type: 'person', id }, O.avatar(id, 32, false), O.nameTag(id), 'Start a DM'));
        if (!listEl.children.length) listEl.append(el('div', { class: 'muted', style: 'padding:10px;font-size:13px' }, 'No DMs or people match'));
      };
      search.oninput = draw;
      const modal = O.modal({ title: 'Forward message to a DM', body: el('div', null, preview, note, el('label', { class: 'label' }, 'Send to'), search, listEl), foot: [sendBtn] });
      draw();
      O.dm.listMine().then(list => { convs = list; draw(); }).catch(() => {});
      sendBtn.onclick = async () => {
        if (!O.canAct()) return;
        if (!dest) return O.toast('Choose a DM first', true);
        sendBtn.disabled = true;
        const forwarded = { uid: original.uid || message.uid, text: String(original.text || '').slice(0, 4000), ts: Number(original.ts || message.ts) || O.TS };
        if (original.attachments) forwarded.attachments = original.attachments;
        if (original.share) forwarded.share = original.share;
        const outgoing = { uid, text: note.value.trim().slice(0, 1000), ts: O.TS, forward: forwarded };
        try {
          const cid = dest.type === 'person' ? await O.dm.ensure(dest.id) : dest.id;
          await O.dm.send(cid, outgoing);
          modal.close();
          O.toast('Message forwarded to ' + (dest.type === 'person' ? O.user(dest.id).name : O.dm.title(convs.find(c => c[0] === cid)?.[1])));
        } catch (e) { sendBtn.disabled = false; O.toast(e.message || 'Could not forward message', true); }
      };
    }

    function jumpTo(id) {
      const n = nodes.get(id);
      if (!n) return O.toast('That message is too old to show');
      n.node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      n.node.classList.remove('flash'); void n.node.offsetWidth; n.node.classList.add('flash');
    }

    feed.addEventListener('scroll', () => {
      stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 140;
      if (stick) newPill.classList.add('hidden');
    });
    newPill.onclick = () => { feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' }); newPill.classList.add('hidden'); };
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(() => { if (stick) feed.scrollTop = feed.scrollHeight; });
      ro.observe(list); cleanups.push(() => ro.disconnect());
    }

    // ---------- search ----------
    let searchPanel = null, searchCache = null, searchCacheAt = 0;
    async function searchSource() {
      if (searchCache && Date.now() - searchCacheAt < 15000) return searchCache;
      const s = await db.ref(msgPath).limitToLast(SEARCH_LIMIT).once('value');
      const arr = []; s.forEach(c => { arr.push([c.key, c.val()]); });
      searchCache = arr; searchCacheAt = Date.now();
      return arr;
    }
    const sTerms = q => q.toLowerCase().split(/\s+/).filter(Boolean);
    function msgMatches(m, ts) {
      const author = ((O.user(m.uid) || {}).name || '').toLowerCase();
      const hay = ((m.text || '') + '\n' + (m.forward ? (m.forward.text || '') : '') + '\n' + (m.share ? (m.share.title || '') + ' ' + (m.share.text || '') : '') + '\n' +
        (m.attachments ? Object.values(m.attachments).map(a => (a && a.name) || '').join(' ') : '') + '\n' +
        (m.forward && m.forward.attachments ? Object.values(m.forward.attachments).map(a => (a && a.name) || '').join(' ') : '')).toLowerCase();
      return ts.every(t => (t.startsWith('@') && t.length > 1) ? author.startsWith(t.slice(1)) : (hay.includes(t) || author.includes(t)));
    }
    function markText(text, ts) {
      const words = ts.filter(t => !t.startsWith('@'));
      const plain = String(text || '').replace(/:gd\d+:/g, '🙂');
      if (!words.length) return O.esc(plain);
      const re = new RegExp('(' + words.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
      return plain.split(re).map((p, i) => i % 2 ? '<mark>' + O.esc(p) + '</mark>' : O.esc(p)).join('');
    }
    function closeSearch() { if (searchPanel) { searchPanel.remove(); searchPanel = null; } }
    cleanups.push(closeSearch);
    function openSearch() {
      if (searchPanel) { searchPanel.querySelector('input').focus(); return; }
      const sIn = el('input', { type: 'search', placeholder: 'Search messages, people or @name', autocomplete: 'off', spellcheck: 'false' });
      const close = el('button', { class: 'icon-btn', type: 'button', title: 'Close search', html: I.x, onclick: closeSearch });
      const info = el('div', { class: 'search-info' }, 'Type to search this conversation');
      const results = el('div', { class: 'search-results' });
      searchPanel = el('div', { class: 'search-panel' }, el('div', { class: 'search-box', html: SEARCH_ICON }), info, results);
      searchPanel.querySelector('.search-box').append(sIn, close);
      document.body.append(searchPanel);
      let timer = null, seq = 0;
      const run = async () => {
        const q = sIn.value.trim().slice(0, 100);
        const my = ++seq;
        results.innerHTML = '';
        if (!q) { info.textContent = 'Type to search this conversation'; return; }
        info.textContent = 'Searching…';
        const ts = sTerms(q);
        const all = await searchSource();
        if (my !== seq) return;
        const hits = all.filter(([, m]) => m && msgMatches(m, ts)).reverse();
        info.textContent = hits.length ? hits.length + (hits.length === 1 ? ' result' : ' results') + (hits.length > 60 ? ' — showing newest 60' : '') : 'No messages match “' + q + '”';
        hits.slice(0, 60).forEach(([id, m]) => {
          const txt = m.text || (m.forward ? m.forward.text || '[forwarded message]' : m.share ? (m.share.title || m.share.text || '[shared post]') : m.attachments ? '[attachment] ' + Object.values(m.attachments).map(a => (a && a.name) || '').join(', ') : '');
          results.append(el('button', { type: 'button', class: 'sresult', onclick: () => { closeSearch(); goToMessage(id, all); } },
            O.avatar(m.uid, 32, false),
            el('div', { class: 'grow' },
              el('div', { class: 'sh' }, O.nameTag(m.uid), el('span', { class: 'time' }, O.clock(m.ts || 0))),
              el('div', { class: 'st', html: markText(txt, ts) }))));
        });
      };
      sIn.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 160); });
      sIn.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); }
        if (e.key === 'Enter') { const first = results.querySelector('.sresult'); if (first) first.click(); }
      });
      setTimeout(() => sIn.focus(), 20);
    }
    function goToMessage(id, all) {
      if (nodes.get(id)) return jumpTo(id);
      const fromEnd = all.length - all.findIndex(([k]) => k === id);
      limit = Math.max(limit, fromEnd + 30);
      pendingJump = id;
      subscribe();
    }
    if (opts.searchBtn) {
      opts.searchBtn.innerHTML = SEARCH_ICON;
      opts.searchBtn.onclick = openSearch;
      cleanups.push(() => { opts.searchBtn.onclick = null; });
    }
    docOn('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); openSearch(); } });
    docOn('pointerdown', e => {
      if (searchPanel && !searchPanel.contains(e.target) && !(opts.searchBtn && opts.searchBtn.contains(e.target))) closeSearch();
    });

    // ---------- reply ----------
    function setReply(id, m) {
      replyTo = { id, uid: m.uid, text: (m.text || (m.attachments ? '[attachment]' : '')).slice(0, 140) };
      replyBar.innerHTML = '';
      replyBar.append(el('span', { html: I.reply.replace('<svg', '<svg width="15" height="15"') }),
        el('span', { class: 'grow' }, 'Replying to ', O.nameFrom(O.user(m.uid) || { name: 'unknown' }), el('span', { class: 'muted' }, ' — ' + (replyTo.text || ''))),
        el('button', { class: 'icon-btn', type: 'button', title: 'Cancel reply', html: I.x, onclick: clearReply }));
      replyBar.classList.remove('hidden');
      input.focus();
    }
    function clearReply() { replyTo = null; replyBar.classList.add('hidden'); replyBar.innerHTML = ''; }

    // ---------- attachments ----------
    attachBtn.onclick = () => { if (O.canAct()) fileIn.click(); };
    fileIn.onchange = () => { addFiles([...fileIn.files]); fileIn.value = ''; };
    input.addEventListener('paste', e => {
      const files = [...((e.clipboardData && e.clipboardData.files) || [])];
      if (files.length) { e.preventDefault(); addFiles(files); }
    });
    feed.addEventListener('dragover', e => e.preventDefault());
    feed.addEventListener('drop', e => { e.preventDefault(); addFiles([...(e.dataTransfer.files || [])]); });
    function addFiles(files) {
      if (!O.canAct()) return;
      files.forEach(file => {
        if (pending.length >= 6) return O.toast('Up to 6 attachments per message', true);
        if (!O.kindOf(file)) return O.toast(file.name + ': only images, audio and video', true);
        const p = { file, status: 'uploading', att: null, progress: 0 };
        pending.push(p);
        O.upload(file, pr => { p.progress = pr; drawPending(); })
          .then(att => { p.att = att; p.status = 'done'; })
          .catch(err => { p.status = 'error'; p.error = err.message; O.toast(err.message, true); })
          .finally(() => { drawPending(); updateSend(); });
      });
      drawPending(); updateSend();
    }
    function drawPending() {
      pendingEl.innerHTML = '';
      pending.forEach(p => {
        const pct = p.status === 'done' ? '✓' : p.status === 'error' ? 'failed' : p.progress < 0 ? '…' : Math.round(p.progress * 100) + '%';
        pendingEl.append(el('div', { class: 'pchip' + (p.status === 'error' ? ' err' : ''), title: p.error || p.file.name },
          el('span', { html: O.kindOf(p.file) === 'audio' ? I.music : I.clip }),
          el('span', { class: 'pn' }, p.file.name), el('span', { class: 'pp' }, pct),
          el('button', { type: 'button', title: 'Remove', html: I.x, onclick: () => { pending = pending.filter(x => x !== p); if (p.att) O.deleteFiles([p.att]); drawPending(); updateSend(); } })));
      });
    }

    // ---------- emoji / mention event ----------
    emojiBtn.onclick = () => O.openPicker(emojiBtn, id => insertText(':gd' + id + ':'), { keepOpen: true });
    function insertText(t) {
      const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? input.value.length;
      input.value = input.value.slice(0, s) + t + input.value.slice(e);
      input.selectionStart = input.selectionEnd = s + t.length;
      input.focus(); autosize(); updateSend(); typingPing();
    }
    listen('mention', name => { const v = input.value; insertText((v && !/\s$/.test(v) ? ' ' : '') + '@' + name + ' '); });

    // ---------- composer ----------
    function autosize() { input.style.height = 'auto'; input.style.height = Math.min(160, input.scrollHeight) + 'px'; }
    function updateSend() {
      const uploading = pending.some(p => p.status === 'uploading');
      sendBtn.disabled = uploading || !(input.value.trim() || pending.some(p => p.att));
    }
    let lastSend = 0;
    async function send() {
      if (!O.canAct()) return;
      if (pending.some(p => p.status === 'uploading')) return O.toast('Wait for uploads to finish');
      const text = input.value.trim().slice(0, 4000);
      const atts = pending.filter(p => p.att).map(p => p.att);
      if (!text && !atts.length) return;
      if (Date.now() - lastSend < 700) return;
      lastSend = Date.now();
      const msg = { uid, text, ts: TS };
      if (atts.length) msg.attachments = atts;
      if (replyTo) msg.replyTo = replyTo;
      input.value = ''; pending = []; drawPending(); clearReply(); autosize(); updateSend(); stopTyping();
      stick = true;
      try {
        if (opts.send) await opts.send(msg);
        else await db.ref(msgPath).push(msg);
      } catch (e) { O.toast('Could not send: ' + e.message, true); }
    }
    sendBtn.onclick = send;
    input.addEventListener('keydown', e => {
      if (mentionKeys(e)) return;
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
      if (e.key === 'Escape' && replyTo) clearReply();
    });
    input.addEventListener('input', () => { autosize(); updateSend(); typingPing(); mentionCheck(); });
    input.addEventListener('blur', () => setTimeout(() => mentionPop.classList.add('hidden'), 150));

    function composerState() {
      const left = O.timeoutLeft();
      const blocked = left > 0 || O.isBanned();
      timeoutNote.classList.toggle('hidden', !blocked);
      if (blocked) timeoutNote.textContent = O.isBanned() ? 'You are banned.' : 'You are timed out — you can chat again in ' + O.fmtDur(left) + '.';
      input.disabled = blocked; attachBtn.disabled = blocked; emojiBtn.disabled = blocked;
      input.placeholder = blocked ? 'You can’t send messages right now' : placeholder;
    }
    listen('change', composerState);
    every(composerState, 1000);
    composerState();

    // ---------- typing indicator ----------
    const typingRef = db.ref(opts.typingPath + '/' + uid);
    typingRef.onDisconnect().remove();
    let lastPing = 0, typingStopTimer = null;
    function typingPing() {
      if (!O.me() || !input.value.trim()) return stopTyping();
      if (Date.now() - lastPing > 2500) { lastPing = Date.now(); typingRef.set(TS); }
      clearTimeout(typingStopTimer);
      typingStopTimer = setTimeout(stopTyping, 5000);
    }
    function stopTyping() { if (lastPing) { lastPing = 0; typingRef.remove(); } clearTimeout(typingStopTimer); }
    let typingState = {};
    const typingQ = db.ref(opts.typingPath);
    const typingCb = typingQ.on('value', s => { typingState = s.val() || {}; drawTyping(); });
    cleanups.push(() => { typingQ.off('value', typingCb); stopTyping(); typingRef.onDisconnect().cancel(); });
    every(drawTyping, 2000);
    function drawTyping() {
      const cutoff = O.now() - 7000;
      const names = Object.keys(typingState).filter(id => id !== uid && typingState[id] > cutoff && O.user(id)).map(id => O.user(id).name);
      typingEl.innerHTML = '';
      if (!names.length) return;
      let label;
      if (names.length === 1) label = [el('b', null, names[0]), ' is typing'];
      else if (names.length === 2) label = [el('b', null, names[0]), ' and ', el('b', null, names[1]), ' are typing'];
      else if (names.length === 3) label = [el('b', null, names[0]), ', ', el('b', null, names[1]), ' and ', el('b', null, names[2]), ' are typing'];
      else label = ['Several people are typing'];
      typingEl.append(el('span', { class: 'dots' }, el('i'), el('i'), el('i')), el('span', null, ...label));
    }
    const onUnload = () => stopTyping();
    window.addEventListener('beforeunload', onUnload);
    cleanups.push(() => window.removeEventListener('beforeunload', onUnload));

    // ---------- mention autocomplete ----------
    let mentionItems = [], mentionIdx = 0, mentionStart = -1;
    function mentionCheck() {
      const pos = input.selectionStart;
      const m = input.value.slice(0, pos).match(/(^|\s)@([A-Za-z0-9_.-]{0,20})$/);
      if (!m) { mentionPop.classList.add('hidden'); mentionItems = []; return; }
      const q = m[2].toLowerCase();
      mentionStart = pos - m[2].length - 1;
      const pool = opts.members ? opts.members() : Object.keys(O.S.users);
      mentionItems = pool.filter(id => O.user(id) && id !== uid && O.user(id).name.toLowerCase().startsWith(q))
        .sort((a, b) => (O.isOnline(b) - O.isOnline(a)) || O.user(a).name.localeCompare(O.user(b).name)).slice(0, 6);
      if (!mentionItems.length) { mentionPop.classList.add('hidden'); return; }
      mentionIdx = 0; drawMentions();
    }
    function drawMentions() {
      mentionPop.innerHTML = '';
      mentionItems.forEach((id, i) => mentionPop.append(el('button', {
        type: 'button', class: i === mentionIdx ? 'on' : '',
        onmousedown: e => { e.preventDefault(); pickMention(id); }
      }, O.avatar(id, 24, false), O.nameTag(id))));
      mentionPop.classList.remove('hidden');
    }
    function pickMention(id) {
      const name = O.user(id).name;
      const pos = input.selectionStart;
      input.value = input.value.slice(0, mentionStart) + '@' + name + ' ' + input.value.slice(pos);
      input.selectionStart = input.selectionEnd = mentionStart + name.length + 2;
      mentionPop.classList.add('hidden'); mentionItems = [];
      input.focus(); updateSend();
    }
    function mentionKeys(e) {
      if (mentionPop.classList.contains('hidden') || !mentionItems.length) return false;
      if (e.key === 'ArrowDown') { mentionIdx = (mentionIdx + 1) % mentionItems.length; drawMentions(); e.preventDefault(); return true; }
      if (e.key === 'ArrowUp') { mentionIdx = (mentionIdx - 1 + mentionItems.length) % mentionItems.length; drawMentions(); e.preventDefault(); return true; }
      if (e.key === 'Enter' || e.key === 'Tab') { pickMention(mentionItems[mentionIdx]); e.preventDefault(); return true; }
      if (e.key === 'Escape') { mentionPop.classList.add('hidden'); e.preventDefault(); return true; }
      return false;
    }

    subscribe();
    return {
      focus: () => input.focus(),
      openSearch,
      destroy() { destroyed = true; cleanups.splice(0).forEach(fn => { try { fn(); } catch (e) {} }); opts.mount.innerHTML = ''; }
    };
  };
})();
