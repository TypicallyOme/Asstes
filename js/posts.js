(function () {
  'use strict';
  const O = window.Orbit;
  const { db, TS, el, I, uid } = O;

  O.init({ page: 'posts', require: true });
  O.$('#onlinePill').onclick = O.openMembers;
  O.on('change', () => { O.$('#onlineCount').textContent = O.onlineCount(); });

  const ntText = O.$('#ntText'), ntPost = O.$('#ntPost'), ntAttach = O.$('#ntAttach'), ntEmoji = O.$('#ntEmoji');
  const ntTitle = O.$('#ntTitle');
  const ntEmbedEditor = O.$('#ntEmbedEditor'), ntEmbedUrlPane = O.$('#ntEmbedUrlPane');
  const ntEmbedUrl = O.$('#ntEmbedUrl');
  const ntEmbedUrlBtn = O.$('#ntEmbedUrlBtn'), ntEmbedClear = O.$('#ntEmbedClear');
  const ntFile = O.$('#ntFile'), ntPending = O.$('#ntPending'), ntCount = O.$('#ntCount'), ntBlocked = O.$('#ntBlocked');
  ntAttach.innerHTML = I.clip; ntEmoji.innerHTML = I.smile; ntEmbedUrlBtn.innerHTML = I.share; ntFile.accept = O.ACCEPT;
  let pending = [];
  let embedMode = null;

  function paintComposer() {
    const a = O.$('#ntAvatar'); a.innerHTML = '';
    a.append(O.me() ? O.avatar(uid, 40) : O.avatarFrom({ name: '?' }, 40));
    const n = O.$('#ntName'); n.innerHTML = '';
    if (O.me()) n.append(O.nameTag(uid));
    else n.append(O.el('span', { class: 'muted' }, 'Create a profile to post'));
    const left = O.timeoutLeft();
    const paused = O.S.postSettings && O.S.postSettings.paused === true && !O.ownerUnlocked();
    const blocked = left > 0 || O.isBanned() || paused;
    ntBlocked.classList.toggle('hidden', !blocked);
    if (blocked) ntBlocked.textContent = O.isBanned() ? 'You are banned.' : paused ? 'Posting is paused by the owner. Only the owner can post right now.' : 'You are timed out — you can post again in ' + O.fmtDur(left) + '.';
    ntText.disabled = blocked; ntTitle.disabled = blocked; ntAttach.disabled = blocked; ntEmoji.disabled = blocked;
    ntEmbedUrlBtn.disabled = blocked; ntEmbedClear.disabled = blocked;
    ntEmbedUrl.disabled = blocked;
    updatePostBtn();
  }
  O.on('change', paintComposer);
  setInterval(() => { if (O.timeoutLeft() > 0) paintComposer(); }, 1000);

  function autosize(t) { t.style.height = 'auto'; t.style.height = Math.min(320, t.scrollHeight) + 'px'; }
  function updatePostBtn() {
    const uploading = pending.some(p => p.status === 'uploading');
    const hasEmbed = embedMode === 'url' && ntEmbedUrl.value.trim();
    const has = ntText.value.trim() || pending.some(p => p.att) || hasEmbed;
    ntPost.disabled = uploading || !has || ntText.disabled;
    const len = ntText.value.length;
    ntCount.textContent = len > 4500 ? (5000 - len) : '';
  }
  function setEmbedMode(mode) {
    embedMode = mode;
    ntEmbedEditor.classList.toggle('hidden', !mode);
    ntEmbedUrlPane.classList.toggle('hidden', mode !== 'url');
    ntEmbedUrlBtn.classList.toggle('on', mode === 'url');
    ntEmbedClear.classList.toggle('hidden', !mode);
    updatePostBtn();
  }
  ntEmbedUrlBtn.onclick = () => setEmbedMode(embedMode === 'url' ? null : 'url');
  ntEmbedClear.onclick = () => { ntEmbedUrl.value = ''; setEmbedMode(null); };
  ntEmbedUrl.addEventListener('input', updatePostBtn);

  ntText.addEventListener('input', () => { autosize(ntText); updatePostBtn(); });
  ntText.addEventListener('focus', () => { if (!O.me()) O.openProfile({ setup: true }); });
  ntTitle.addEventListener('focus', () => { if (!O.me()) O.openProfile({ setup: true }); });
  ntTitle.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ntText.focus(); } });
  ntText.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) createPost(); });
  ntText.addEventListener('paste', e => { const f = [...(e.clipboardData && e.clipboardData.files || [])]; if (f.length) { e.preventDefault(); addFiles(f); } });
  ntAttach.onclick = () => { if (O.canAct()) ntFile.click(); };
  ntFile.onchange = () => { addFiles([...ntFile.files]); ntFile.value = ''; };
  ntEmoji.onclick = () => O.openPicker(ntEmoji, id => insertAt(ntText, ':gd' + id + ':'), { keepOpen: true });

  function insertAt(t, s) {
    const a = t.selectionStart ?? t.value.length, b = t.selectionEnd ?? t.value.length;
    t.value = t.value.slice(0, a) + s + t.value.slice(b);
    t.selectionStart = t.selectionEnd = a + s.length;
    t.focus(); t.dispatchEvent(new Event('input'));
  }

  function addFiles(files) {
    if (!O.canAct()) return;
    files.forEach(file => {
      if (pending.length >= 10) return O.toast('Up to 10 files per post', true);
      const kind = O.kindOf(file);
      if (!kind) return O.toast(file.name + ': only images, audio and video', true);
      const p = { file, kind, status: 'uploading', progress: 0, att: null, preview: URL.createObjectURL(file) };
      pending.push(p);
      O.upload(file, pr => { p.progress = pr; drawPending(); })
        .then(att => { p.att = att; p.status = 'done'; })
        .catch(err => { p.status = 'error'; O.toast(err.message, true); })
        .finally(() => { drawPending(); updatePostBtn(); });
    });
    drawPending(); updatePostBtn();
  }
  function drawPending() {
    ntPending.innerHTML = '';
    pending.forEach(p => {
      const box = el('div', { class: 'ntp' + (p.status === 'error' ? ' err' : ''), title: p.file.name });
      if (p.kind === 'image') box.append(el('img', { src: p.preview, alt: '' }));
      else if (p.kind === 'video') box.append(el('video', { src: p.preview, muted: true }));
      else box.append(el('span', { class: 'lbl', html: I.music.replace('<svg', '<svg width="22" height="22" style="display:block;margin:0 auto 6px"') + O.esc(p.file.name) }));
      if (p.status === 'uploading') box.append(el('div', { class: 'prog', style: 'width:' + (p.progress < 0 ? 60 : Math.round(p.progress * 100)) + '%' }));
      if (p.status === 'error') box.append(el('span', { class: 'lbl' }, 'Upload failed'));
      box.append(el('button', { class: 'x', type: 'button', html: I.x, onclick: () => {
        pending = pending.filter(x => x !== p); URL.revokeObjectURL(p.preview); if (p.att) O.deleteFiles([p.att]); drawPending(); updatePostBtn();
      } }));
      ntPending.append(box);
    });
  }

  let lastPost = 0;
  async function createPost() {
    if (O.S.postSettings && O.S.postSettings.paused === true && !O.ownerUnlocked()) return O.toast('Posting is paused by the owner', true);
    if (!O.canAct()) return;
    if (pending.some(p => p.status === 'uploading')) return O.toast('Wait for uploads to finish');
    const text = ntText.value.trim().slice(0, 5000);
    const atts = pending.filter(p => p.att).map(p => p.att);
    let embed = null;
    if (embedMode === 'url') {
      try {
        let raw = ntEmbedUrl.value.trim();
        if (!raw) throw new Error('empty');
        if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith('/') && !raw.startsWith('./') && !raw.startsWith('../')) raw = 'https://' + raw;
        const url = new URL(raw, location.href);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid');
        embed = { type: 'url', url: url.href };
      } catch (e) { O.toast('Enter a valid http or https URL to embed', true); ntEmbedUrl.focus(); return; }
    }
    if (!text && !atts.length && !embed) return;
    if (Date.now() - lastPost < 3000) return O.toast('Slow down a little');
    lastPost = Date.now();
    const title = ntTitle.value.trim().slice(0, 100);
    const post = { uid, text, ts: TS, commentCount: 0 };
    if (title) post.title = title;
    if (atts.length) post.attachments = atts;
    if (embed) post.embed = embed;
    ntPost.disabled = true;
    try {
      await db.ref('posts').push(post);
      pending.forEach(p => URL.revokeObjectURL(p.preview));
      ntText.value = ''; ntTitle.value = ''; ntEmbedUrl.value = ''; setEmbedMode(null); pending = []; drawPending(); autosize(ntText);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { O.toast('Could not post: ' + e.message, true); }
    updatePostBtn();
  }
  ntPost.onclick = createPost;

  const feed = O.$('#feed');
  const posts = new Map();
  const nodes = new Map();       // id -> {node, sig}
  const commentBoxes = new Map(); // id -> comments controller
  const open = new Set();
  let limit = 30, query = null, loadedOnce = false, focusAfter = null;
  const SEARCH_LIMIT = 1000;
  let searchQ = '', subLimit = 0;

  function subscribe() {
    if (query) query.off();
    const eff = searchQ ? Math.max(limit, SEARCH_LIMIT) : limit;
    subLimit = eff;
    posts.clear();
    query = db.ref('posts').limitToLast(eff);
    query.on('child_added', s => { posts.set(s.key, s.val()); schedule(); });
    query.on('child_changed', s => { posts.set(s.key, s.val()); schedule(); });
    query.on('child_removed', s => { posts.delete(s.key); schedule(); });
    query.once('value', s => {
      loadedOnce = true;
      O.$('#moreWrap').classList.toggle('hidden', !!searchQ || s.numChildren() < eff);
      schedule();
      handleHash();
    });
  }
  O.$('#moreBtn').onclick = () => { limit += 30; subscribe(); };

  let scheduled = false;
  function schedule() {
    if (scheduled) return; scheduled = true;
    requestAnimationFrame(() => { scheduled = false; render(); });
  }
  O.on('change', schedule);

  function render() {
    let ids = [...posts.keys()].sort((a, b) => (posts.get(b).ts || 0) - (posts.get(a).ts || 0));
    if (searchQ) ids = ids.filter(id => matches(posts.get(id), searchQ));
    drawSearchMeta(ids.length);
    const ns = Object.keys(O.S.byName).join(',') + '§' + searchQ;
    const out = ids.map(id => {
      const p = posts.get(id);
      const sig = JSON.stringify(p) + '§' + O.userSig(p.uid) + '§' + O.canModerate(p.uid) + '§' + (/@/.test(p.text || '') ? ns : '');
      const c = nodes.get(id);
      if (c && c.sig === sig) return c.node;
      const node = buildPost(id, p);
      nodes.set(id, { node, sig });
      return node;
    });
    let ref = feed.firstChild;
    out.forEach(n => { if (n === ref) ref = ref.nextSibling; else feed.insertBefore(n, ref); });
    while (ref) { const nx = ref.nextSibling; ref.remove(); ref = nx; }
    for (const id of [...nodes.keys()]) if (!posts.has(id)) {
      nodes.delete(id);
      const cb = commentBoxes.get(id); if (cb) { cb.destroy(); commentBoxes.delete(id); }
    }
    if (focusAfter) { const c = commentBoxes.get(focusAfter); focusAfter = null; if (c) c.focus(); }
    if (loadedOnce && !ids.length) feed.append(el('div', { class: 'empty' }, searchQ ? 'No posts match “' + searchQ + '”' : 'No posts yet — start the first thread.'));
  }
  // refresh relative times in place (rebuilding would restart playing media)
  setInterval(() => document.querySelectorAll('.time[data-ts]').forEach(t => { t.textContent = O.timeAgo(+t.dataset.ts); }), 30000);

  function buildPost(id, p) {
    const node = el('article', { class: 'thread' + (open.has(id) ? ' open' : ''), id: 'p-' + id });
    const left = el('div', { class: 't-left' }, O.avatar(p.uid, 40), el('div', { class: 't-line' }));
    const main = el('div', { class: 't-main' });

    const menuBtn = el('button', { class: 'icon-btn', type: 'button', title: 'More', html: I.more });
    main.append(el('div', { class: 't-head' }, O.nameTag(p.uid),
      el('span', { class: 'time', 'data-ts': p.ts || 0, title: new Date(p.ts || 0).toLocaleString() }, O.timeAgo(p.ts || 0)),
      el('span', { class: 'grow' }), menuBtn));
    menuBtn.onclick = (e) => { e.stopPropagation(); openMenu(node, id, p); };

    if (p.title) main.append(highlight(el('div', { class: 't-title' }, p.title)));
    if (p.text) {
      const t = O.richEl(p.text); t.classList.add('t-text');
      highlight(t);
      if (p.edited) t.append(el('span', { class: 'edited' }, p.editedBy && p.editedBy !== p.uid ? '(edited by mod)' : '(edited)'));
      main.append(t);
    }
    const atts = O.attachmentsEl(p.attachments); if (atts) main.append(atts);
    const embed = postEmbed(p.embed); if (embed) main.append(embed);
    const r = O.reactionsEl(p.reactions, 'posts/' + id + '/reactions'); if (r) main.append(r);

    const reactBtn = el('button', { type: 'button', title: 'React', html: I.react });
    reactBtn.onclick = () => O.openPicker(reactBtn, eid => O.toggleReaction('posts/' + id + '/reactions', eid), { title: 'React' });
    const cCount = p.commentCount || 0;
    const commentBtn = el('button', { type: 'button', title: 'Comments', html: I.comment + (cCount ? '<span>' + cCount + '</span>' : '') });
    commentBtn.onclick = () => toggleComments(id);
    const shareBtn = el('button', { type: 'button', title: 'Send to chat or a DM', html: I.share });
    shareBtn.onclick = () => shareToChat(id, p);
    main.append(el('div', { class: 't-acts' }, reactBtn, commentBtn, shareBtn));

    if (open.has(id)) main.append(commentsFor(id).el);
    node.append(left, main);
    return node;
  }

  function postEmbed(embed) {
    if (!embed || typeof embed !== 'object') return null;
    const frame = el('iframe', { title: 'Embedded post content', loading: 'lazy', allow: 'fullscreen; autoplay; encrypted-media', allowfullscreen: true, referrerpolicy: 'no-referrer' });
    if (embed.type === 'url' && typeof embed.url === 'string') {
      try {
        const url = new URL(embed.url, location.href);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        frame.src = url.href;
      } catch (e) { return null; }
    } else if (embed.type === 'html' && typeof embed.html === 'string' && embed.html.length <= 20000) {
      frame.setAttribute('sandbox', 'allow-scripts allow-forms');
      frame.srcdoc = embed.html;
    } else return null;
    return el('div', { class: 'post-embed' }, frame);
  }

  const searchIn = O.$('#search'), searchClear = O.$('#searchClear'), searchMeta = O.$('#searchMeta');
  searchClear.innerHTML = I.x;
  function terms(q) { return q.toLowerCase().split(/\s+/).filter(Boolean); }
  function matches(p, q) {
    const author = ((O.user(p.uid) || {}).name || '').toLowerCase();
    const hay = ((p.title || '') + '\n' + (p.text || '')).toLowerCase();
    return terms(q).every(t => {
      if (t.startsWith('@') && t.length > 1) return author.startsWith(t.slice(1));
      return hay.includes(t) || author.includes(t);
    });
  }
  function highlight(node) {
    const ts = terms(searchQ).filter(t => !t.startsWith('@'));
    if (!ts.length) return node;
    const re = new RegExp('(' + ts.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const texts = []; while (walker.nextNode()) texts.push(walker.currentNode);
    texts.forEach(tn => {
      const parts = tn.nodeValue.split(re);
      if (parts.length < 2) return;
      const frag = document.createDocumentFragment();
      parts.forEach((part, i) => { if (part) frag.append(i % 2 ? el('mark', null, part) : document.createTextNode(part)); });
      tn.replaceWith(frag);
    });
    return node;
  }
  function drawSearchMeta(count) {
    searchMeta.innerHTML = '';
    if (!searchQ) return;
    const plain = terms(searchQ).filter(t => !t.startsWith('@')).join(' ');
    const at = (terms(searchQ).find(t => t.startsWith('@')) || '').slice(1);
    const people = Object.keys(O.S.users).filter(id => {
      const n = (O.user(id) || {}).name; if (!n) return false;
      const ln = n.toLowerCase();
      return at ? ln.startsWith(at) : (plain && ln.includes(plain));
    }).slice(0, 6);
    searchMeta.append(el('span', null, count + (count === 1 ? ' post' : ' posts')));
    if (people.length) {
      searchMeta.append(el('span', { class: 'muted' }, '· people:'));
      people.forEach(id => {
        const name = O.user(id).name;
        const on = at && at === name.toLowerCase();
        searchMeta.append(el('button', { type: 'button', class: 'ppl' + (on ? ' on' : ''), title: 'Show posts by ' + name,
          onclick: () => { searchIn.value = '@' + name; runSearch(); } }, O.avatar(id, 22, false), O.nameTag(id)));
      });
    }
  }
  let searchTimer = null;
  function runSearch() {
    const q = searchIn.value.trim().slice(0, 100);
    searchClear.classList.toggle('hidden', !searchIn.value);
    O.$('#column').classList.toggle('searching', !!q);
    const needMore = q && subLimit < SEARCH_LIMIT;
    const backToNormal = !q && subLimit !== limit;
    searchQ = q;
    for (const n of nodes.values()) n.sig = ''; // rebuild so highlights update
    if (needMore || backToNormal) subscribe(); else schedule();
  }
  searchIn.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 180); });
  searchIn.addEventListener('keydown', e => { if (e.key === 'Escape') { searchIn.value = ''; runSearch(); } });
  searchClear.onclick = () => { searchIn.value = ''; runSearch(); searchIn.focus(); };

  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  document.addEventListener('pointerdown', e => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
  function openMenu(node, id, p) {
    closeMenu();
    const items = [];
    const add = (icon, label, fn, cls) => items.push(el('button', { type: 'button', class: cls || '', html: icon + O.esc(label), onclick: () => { closeMenu(); fn(); } }));
    add(I.share, 'Send to…', () => shareToChat(id, p));
    add(I.posts, 'Copy link', () => {
      const url = location.href.split('#')[0] + '#p=' + id;
      navigator.clipboard && navigator.clipboard.writeText(url).then(() => O.toast('Link copied'));
    });
    const own = p.uid === uid, canMod = !own && O.canModerate(p.uid);
    if (own || canMod) {
      add(I.edit, own ? 'Edit' : 'Edit (mod)', () => O.mod.editPost(id, p));
      add(I.trash, own ? 'Delete' : 'Delete (mod)', () => O.mod.deletePost(id, p), 'danger');
    }
    if (canMod) add(I.clock, O.timeoutLeft(p.uid) > 0 ? 'Remove timeout' : 'Time out user', async () => {
      if (O.timeoutLeft(p.uid) > 0) return O.mod.untimeout(p.uid);
      const ms = await O.chooseDuration((O.user(p.uid) || {}).name); if (ms) O.mod.timeout(p.uid, ms);
    });
    menuEl = el('div', { class: 'menu' }, items);
    node.append(menuEl);
  }

  function shareToChat(id, p) {
    if (!O.canAct()) return;
    const note = el('textarea', { class: 'textarea', rows: 2, placeholder: 'Add a message (optional)', maxlength: 1000, style: 'min-height:60px' });
    const preview = el('div', { class: 'share-preview' }, O.nameTag(p.uid), p.title ? el('div', { class: 't-title', style: 'font-size:14px;margin-top:6px' }, p.title) : null, O.richEl(p.text || (p.title ? '' : '[media]')));
    const search = el('input', { class: 'input', placeholder: 'Search chats or people' });
    const listEl = el('div', { class: 'pick-list' });
    const go = el('button', { class: 'btn primary' }, 'Send');
    let convs = [];          // [[cid, meta]]
    let dest = { type: 'main' };
    const same = d => d.type === dest.type && d.id === dest.id;

    const draw = () => {
      const q = search.value.trim().toLowerCase();
      listEl.innerHTML = '';
      const row = (d, avatarEl, label, sub) => listEl.append(el('button', { type: 'button', class: 'pick' + (same(d) ? ' on' : ''), onclick: () => { dest = d; draw(); } },
        avatarEl, el('div', { class: 'grow' }, el('div', null, label), sub ? el('div', { class: 'muted', style: 'font-size:12px' }, sub) : null), el('span', { class: 'check round' })));
      if (!q || 'everyone main chat'.includes(q)) {
        row({ type: 'main' }, el('div', { class: 'av', style: '--s:32px' }, el('div', { class: 'ph', html: I.chat.replace('<svg', '<svg width="16" height="16"') })), el('b', null, 'Everyone'), 'Main chat');
      }
      const dmWith = new Set();
      convs.forEach(([cid, m]) => {
        if (m.type !== 'group') dmWith.add(O.dm.other(m));
        const title = O.dm.title(m);
        if (q && !title.toLowerCase().includes(q)) return;
        if (m.type === 'group') {
          row({ type: 'conv', id: cid }, O.avatarFrom({ name: m.name || 'G' }, 32), el('b', null, title), 'Group · ' + Object.keys(m.members || {}).length + ' members');
        } else {
          const other = O.dm.other(m);
          row({ type: 'conv', id: cid }, O.avatar(other, 32, false), O.nameTag(other), 'DM');
        }
      });
      Object.keys(O.S.users).filter(u => u !== uid && O.user(u) && !dmWith.has(u) && (!q || O.user(u).name.toLowerCase().includes(q)))
        .sort((a, b) => O.user(a).name.localeCompare(O.user(b).name)).slice(0, 40)
        .forEach(u => row({ type: 'person', id: u }, O.avatar(u, 32, false), O.nameTag(u), 'Start a DM'));
      if (!listEl.children.length) listEl.append(el('div', { class: 'muted', style: 'padding:10px;font-size:13px' }, 'Nothing matches'));
    };
    search.oninput = draw;
    const m = O.modal({ title: 'Send post', body: el('div', null, preview, note, el('label', { class: 'label' }, 'Send to'), search, listEl), foot: [go] });
    draw();
    O.dm.listMine().then(list => { convs = list; draw(); }).catch(() => {});

    go.onclick = async () => {
      if (!O.canAct()) return;
      go.disabled = true;
      const atts = p.attachments ? (Array.isArray(p.attachments) ? p.attachments : Object.values(p.attachments)) : [];
      const share = { id, uid: p.uid, text: (p.text || '').slice(0, 300) };
      if (p.title) share.title = p.title.slice(0, 100);
      if (atts[0]) share.media = atts[0].kind;
      const msg = { uid, text: note.value.trim().slice(0, 1000), ts: TS, share };
      try {
        let where = 'chat';
        if (dest.type === 'main') await db.ref('messages').push(msg);
        else {
          const cid = dest.type === 'person' ? await O.dm.ensure(dest.id) : dest.id;
          await O.dm.send(cid, msg);
          where = dest.type === 'person' ? O.user(dest.id).name : (convs.find(c => c[0] === cid) ? O.dm.title(convs.find(c => c[0] === cid)[1]) : 'DM');
        }
        m.close();
        O.toast('Sent to ' + where);
      } catch (e) { O.toast(e.message, true); go.disabled = false; }
    };
  }

  function toggleComments(id) {
    if (open.has(id)) open.delete(id); else open.add(id);
    const n = nodes.get(id);
    if (n) n.sig = ''; // force rebuild
    schedule();
    if (open.has(id)) focusAfter = id;
  }
  function commentsFor(postId) {
    if (commentBoxes.has(postId)) return commentBoxes.get(postId);
    const box = el('div', { class: 'comments' });
    const listEl = el('div');
    const input = el('input', { placeholder: 'Reply…', maxlength: 1000 });
    const emo = el('button', { class: 'icon-btn', type: 'button', title: 'Emojis', html: I.smile });
    const send = el('button', { class: 'icon-btn', type: 'button', title: 'Reply', html: I.send });
    box.append(listEl, el('div', { class: 'c-compose' }, input, emo, send));
    emo.onclick = () => O.openPicker(emo, id => { input.value += ':gd' + id + ':'; input.focus(); }, { keepOpen: true });
    input.addEventListener('focus', () => { if (!O.me()) O.openProfile({ setup: true }); });
    let last = 0;
    const submit = async () => {
      if (!O.canAct()) return;
      const text = input.value.trim().slice(0, 1000);
      if (!text || Date.now() - last < 800) return;
      last = Date.now();
      input.value = '';
      try {
        await db.ref('comments/' + postId).push({ uid, text, ts: TS });
        db.ref('posts/' + postId + '/commentCount').transaction(n => (n || 0) + 1);
      } catch (e) { O.toast(e.message, true); }
    };
    send.onclick = submit;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });

    let data = {};
    const draw = () => {
      listEl.innerHTML = '';
      const ids = Object.keys(data).sort((a, b) => (data[a].ts || 0) - (data[b].ts || 0));
      if (!ids.length) listEl.append(el('div', { class: 'c-empty' }, 'No replies yet'));
      ids.forEach(cid => {
        const c = data[cid];
        const tools = el('div', { class: 'c-tools' });
        const rb = el('button', { type: 'button', title: 'React', html: I.react });
        rb.onclick = () => O.openPicker(rb, eid => O.toggleReaction('comments/' + postId + '/' + cid + '/reactions', eid), { title: 'React' });
        tools.append(rb);
        tools.append(el('button', { type: 'button', title: 'Mention', html: I.reply, onclick: () => { const u = O.user(c.uid); if (u) { input.value = '@' + u.name + ' ' + input.value; input.focus(); } } }));
        if (c.uid === uid || O.canModerate(c.uid)) tools.append(el('button', { type: 'button', title: 'Delete', html: I.trash, onclick: () => O.mod.deleteComment(postId, cid, c) }));
        const r = O.reactionsEl(c.reactions, 'comments/' + postId + '/' + cid + '/reactions');
        listEl.append(el('div', { class: 'comment' }, O.avatar(c.uid, 30),
          el('div', { class: 'c-main' },
            el('div', { class: 'c-head' }, O.nameTag(c.uid), el('span', { class: 'time', 'data-ts': c.ts || 0 }, O.timeAgo(c.ts || 0)), el('span', { class: 'grow' }), tools),
            O.richEl(c.text), r)));
      });
    };
    const ref = db.ref('comments/' + postId).limitToLast(200);
    const cb = ref.on('value', s => { data = s.val() || {}; draw(); });
    const offChange = () => draw();
    O.on('change', offChange);
    const ctrl = {
      el: box,
      focus: () => input.focus(),
      destroy: () => { ref.off('value', cb); }
    };
    commentBoxes.set(postId, ctrl);
    return ctrl;
  }

  function handleHash() {
    const m = location.hash.match(/p=([A-Za-z0-9_-]+)/);
    if (!m) return;
    const id = m[1];
    if (!posts.has(id)) {
      db.ref('posts/' + id).once('value').then(s => {
        if (!s.exists()) return O.toast('That post no longer exists', true);
        posts.set(id, s.val()); open.add(id); schedule();
        setTimeout(() => focusPost(id), 120);
      });
      return;
    }
    open.add(id); const n = nodes.get(id); if (n) n.sig = '';
    schedule();
    setTimeout(() => focusPost(id), 120);
  }
  function focusPost(id) {
    const n = document.getElementById('p-' + id);
    if (!n) return;
    n.scrollIntoView({ block: 'center', behavior: 'smooth' });
    n.classList.remove('flash'); void n.offsetWidth; n.classList.add('flash');
  }
  window.addEventListener('hashchange', handleHash);

  paintComposer();
  subscribe();
})();
