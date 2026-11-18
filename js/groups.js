(function () {
  'use strict';
  const O = window.Orbit;
  const { db, el, I, uid } = O;
  O.init({ page: 'groups' });

  const grid = O.$('#communityGrid');
  const empty = O.$('#communityEmpty');
  const loadMore = O.$('#groupsLoadMore');
  const search = O.$('#communitySearch');
  const addButton = O.$('#addCommunity');
  const tabs = [...document.querySelectorAll('.groups-tab')];
  let communities = {};
  let mode = 'discover';
  let displayLimit = 100;
  let openedHash = '';
  let orbitReady = false;
  const imageLoads = new Map();
  const cardIO = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(entry => {
      entry.target._imageVisible = entry.isIntersecting;
      if (entry.isIntersecting) entry.target._loadImages && entry.target._loadImages();
      else entry.target._unloadImages && entry.target._unloadImages();
    });
  }, { rootMargin: '400px 0px' }) : null;

  addButton.onclick = () => openEditor();
  search.addEventListener('input', () => { displayLimit = 100; render(); });
  loadMore.onclick = () => { displayLimit += 100; render(); };
  tabs.forEach(tab => tab.onclick = () => {
    mode = tab.dataset.mode;
    displayLimit = 100;
    tabs.forEach(item => {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
    });
    render();
  });

  let renderQueued = false;
  const scheduleRender = () => {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
      if (orbitReady) openHashCommunity();
    });
  };
  const communityError = err => {
    console.error('Orbit: cannot load communities', err);
    O.toast('Could not load communities', true);
  };
  const communitiesRef = db.ref('communities');
  communitiesRef.on('child_added', snap => { communities[snap.key] = snap.val(); scheduleRender(); }, communityError);
  communitiesRef.on('child_changed', snap => { communities[snap.key] = snap.val(); scheduleRender(); }, communityError);
  communitiesRef.on('child_removed', snap => { delete communities[snap.key]; scheduleRender(); }, communityError);
  O.ready.then(() => { orbitReady = true; render(); openHashCommunity(); });
  O.on('change', render);

  function safeUrl(value) {
    let raw = String(value || '').trim();
    if (!raw) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = 'https://' + raw;
    try {
      const url = new URL(raw, location.href);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch (e) { return ''; }
  }

  function getImageSource(value) {
    if (!value) return Promise.resolve('');
    if (typeof value === 'string') return Promise.resolve(safeUrl(value));
    if (value.url) return Promise.resolve(safeUrl(value.url));
    if (!value.fid) return Promise.resolve('');
    const fid = String(value.fid);
    if (!imageLoads.has(fid)) {
      const request = db.ref('files/' + fid + '/data').once('value')
        .then(s => typeof s.val() === 'string' && /^data:image\//i.test(s.val()) ? s.val() : '')
        .catch(() => '');
      imageLoads.set(fid, request);
      const forget = () => { if (imageLoads.get(fid) === request) imageLoads.delete(fid); };
      request.then(forget, forget);
    }
    return imageLoads.get(fid);
  }

  const isMember = community => !!(community && community.members && community.members[uid]);
  const canManage = community => !!community && (community.owner === uid || O.isAdmin());
  const memberCount = community => Object.keys((community && community.members) || {}).length;
  const initial = community => Array.from(String((community && community.name) || 'C').trim())[0] || 'C';

  function render() {
    if (!grid) return;
    if (cardIO) cardIO.disconnect();
    grid.innerHTML = '';
    const query = search.value.trim().toLowerCase();
    const joinedCount = Object.values(communities).filter(isMember).length;
    O.$('#joinedTab').textContent = 'Your communities (' + joinedCount + ')';
    const items = Object.entries(communities)
      .filter(([, community]) => community && typeof community === 'object')
      .filter(([, community]) => mode === 'joined' ? isMember(community) : true)
      .filter(([, community]) => !query || (String(community.name || '') + ' ' + String(community.description || '')).toLowerCase().includes(query))
      .sort((a, b) => Number((b[1].last || {}).ts || b[1].createdAt || 0) - Number((a[1].last || {}).ts || a[1].createdAt || 0));
    empty.classList.toggle('hidden', items.length > 0);
    empty.textContent = mode === 'joined' ? 'You have not joined any communities yet.' : 'No communities found. Start one with Add Community.';
    loadMore.classList.toggle('hidden', items.length <= displayLimit);
    items.slice(0, displayLimit).forEach(([id, community]) => grid.append(communityCard(id, community)));
  }

  function communityCard(id, community) {
    const card = el('button', { type: 'button', class: 'community-card', 'aria-label': 'Open ' + String(community.name || 'community') });
    const cover = el('div', { class: 'community-cover' });
    const coverImage = el('img', { alt: '', loading: 'lazy', draggable: 'false' });
    coverImage.onerror = () => coverImage.remove();
    cover.append(coverImage);
    const logo = el('div', { class: 'community-logo' }, initial(community));
    const title = O.richEl(String(community.name || 'Untitled community'), 'span');
    title.classList.add('community-card-title');
    const description = O.richEl(String(community.description || 'No description yet.').slice(0, 200), 'span');
    description.classList.add('community-card-desc');
    const copy = el('span', { class: 'community-card-copy' }, title, description,
      el('span', { class: 'community-card-meta' },
        el('span', { class: 'member-dot' }), memberCount(community) + (memberCount(community) === 1 ? ' member' : ' members'),
        isMember(community) ? el('span', { class: 'member-joined' }, ' · Joined') : null));
    card.append(el('div', { class: 'community-art' }, cover, logo), copy);
    card._imageLoaded = false; card._imageLoading = false;
    card._loadImages = () => {
      if (card._imageLoading || card._imageLoaded || !card.isConnected) return;
      card._imageLoading = true;
      Promise.all([getImageSource(community.cover), getImageSource(community.logo)]).then(([coverSrc, logoSrc]) => {
        if (!card.isConnected || !card._imageVisible) return;
        if (coverSrc) coverImage.src = coverSrc;
        if (logoSrc) {
          logo.replaceChildren(el('img', { src: logoSrc, alt: '', loading: 'lazy' }));
        }
        card._imageLoaded = true;
      }).finally(() => { card._imageLoading = false; });
    };
    card._unloadImages = () => {
      coverImage.removeAttribute('src');
      logo.replaceChildren(document.createTextNode(initial(community)));
      card._imageLoaded = false;
    };
    card.onclick = () => openCommunity(id, community);
    if (cardIO) cardIO.observe(card); else { card._imageVisible = true; card._loadImages(); }
    return card;
  }

  function openCommunity(id, initialCommunity) {
    let community = initialCommunity;
    let conversation = null;
    const body = el('div', { class: 'community-detail' });
    let foot;
    const modal = O.modal({
      title: community.name || 'Community', body, foot: [], wide: true,
      cls: 'community-modal',
      onClose: () => {
        if (conversation) { conversation.destroy(); conversation = null; }
        if (location.hash === '#community=' + encodeURIComponent(id)) history.replaceState(null, '', location.pathname + location.search);
      }
    });
    foot = modal.foot;

    function renderDetail() {
      body.innerHTML = '';
      foot.innerHTML = '';
      modal.head.querySelector('h3').innerHTML = O.richHTML(community.name || 'Community');
      const cover = el('div', { class: 'community-detail-cover' });
      const coverImg = el('img', { alt: String(community.name || '') + ' cover', loading: 'lazy' });
      coverImg.onerror = () => coverImg.remove();
      cover.append(coverImg);
      getImageSource(community.cover).then(src => { if (src && cover.isConnected) coverImg.src = src; });
      const logo = el('div', { class: 'community-detail-logo' }, initial(community));
      getImageSource(community.logo).then(src => {
        if (!src || !logo.isConnected) return;
        logo.innerHTML = '';
        logo.append(el('img', { src, alt: '', loading: 'lazy' }));
      });
      const detailName = O.richEl(String(community.name || 'Untitled community'), 'h2');
      detailName.classList.add('community-detail-name');
      const description = O.richEl(String(community.description || 'No description yet.'), 'div');
      description.classList.add('community-detail-description');
      const head = el('div', { class: 'community-detail-head' }, logo,
        el('div', { class: 'grow' }, detailName,
          el('div', { class: 'community-detail-count' }, memberCount(community) + (memberCount(community) === 1 ? ' member' : ' members'))));
      body.append(cover, head, description,
        el('div', { class: 'community-detail-owner' }, 'Created by ', O.nameFrom(O.user(community.owner) || { name: 'unknown' })));
      buildDetailActions();
    }

    function buildDetailActions() {
      foot.innerHTML = '';
      const share = el('button', { type: 'button', class: 'btn', onclick: () => shareCommunity(id, community) }, 'Share community');
      foot.append(share);
      if (isMember(community)) {
        foot.append(el('button', { type: 'button', class: 'btn primary', onclick: openChat }, 'Open community chat'));
        if (community.owner !== uid) foot.append(el('button', { type: 'button', class: 'btn ghost', onclick: leaveCommunity }, 'Leave'));
      } else {
        foot.append(el('button', { type: 'button', class: 'btn primary', onclick: joinCommunity }, 'Join community'));
      }
      if (canManage(community)) {
        foot.append(el('button', { type: 'button', class: 'btn', onclick: () => openEditor(id, community, updated => { community = updated; renderDetail(); }) }, 'Edit'));
        foot.append(el('button', { type: 'button', class: 'btn danger', onclick: deleteCommunity }, 'Delete'));
      }
    }

    async function joinCommunity() {
      if (!O.canAct()) return;
      try {
        await db.ref('communities/' + id + '/members/' + uid).set(true);
        community = Object.assign({}, community, { members: Object.assign({}, community.members || {}, { [uid]: true }) });
        renderDetail(); render(); O.toast('Joined ' + (community.name || 'community'));
      } catch (e) { O.toast(e.message || 'Could not join community', true); }
    }
    async function leaveCommunity() {
      if (community.owner === uid) return O.toast('The community owner cannot leave their own community', true);
      if (!await O.confirmBox('Leave ' + (community.name || 'this community') + '?', 'Leave community', true)) return;
      try {
        await db.ref('communities/' + id + '/members/' + uid).remove();
        if (conversation) { conversation.destroy(); conversation = null; }
        modal.backdrop.classList.remove('community-chat-modal');
        const members = Object.assign({}, community.members || {}); delete members[uid];
        community = Object.assign({}, community, { members });
        renderDetail(); render(); O.toast('Left community');
      } catch (e) { O.toast(e.message || 'Could not leave community', true); }
    }
    async function deleteCommunity() {
      if (!canManage(community)) return O.toast('You cannot manage this community', true);
      if (!await O.confirmBox('Delete ' + (community.name || 'this community') + ' and its chat?', 'Delete community', true)) return;
      try {
        const update = {};
        update['communities/' + id] = null;
        update['communityMsgs/' + id] = null;
        update['communityTyping/' + id] = null;
        await db.ref().update(update);
        O.deleteFiles([community.cover, community.logo]);
        modal.close(); render(); O.toast('Community deleted');
      } catch (e) { O.toast(e.message || 'Could not delete community', true); }
    }

    function openChat() {
      if (!isMember(community)) return O.toast('Join this community to open its chat', true);
      modal.backdrop.classList.add('community-chat-modal');
      if (conversation) { conversation.destroy(); conversation = null; }
      body.innerHTML = '';
      foot.innerHTML = '';
      const logo = el('div', { class: 'community-detail-logo' }, initial(community));
      getImageSource(community.logo).then(src => {
        if (!src || !logo.isConnected) return;
        logo.innerHTML = ''; logo.append(el('img', { src, alt: '', loading: 'lazy' }));
      });
      const communityTitle = O.richEl(community.name || 'Community', 'div');
      communityTitle.classList.add('community-chat-title');
      const mount = el('div', { class: 'community-chat-mount' });
      const layout = el('div', { class: 'community-chat-layout' },
        el('div', { class: 'community-chat-banner' }, logo,
          el('div', { class: 'grow' }, communityTitle,
            el('div', { class: 'muted', style: 'font-size:12px' }, memberCount(community) + ' members')),
          el('button', { type: 'button', class: 'btn sm community-chat-back', onclick: () => {
            if (conversation) conversation.destroy(); conversation = null;
            modal.backdrop.classList.remove('community-chat-modal'); renderDetail();
          } }, 'Community info')),
        mount);
      body.append(layout);
      modal.head.querySelector('h3').innerHTML = O.richHTML((community.name || 'Community') + ' chat');
      const leave = el('button', { type: 'button', class: 'btn ghost', onclick: leaveCommunity }, 'Leave');
      if (community.owner !== uid) foot.append(leave);
      foot.append(el('button', { type: 'button', class: 'btn', onclick: () => shareCommunity(id, community) }, 'Share'),
        el('button', { type: 'button', class: 'btn', onclick: () => modal.close() }, 'Close'));
      conversation = O.Conversation({
        mount,
        msgPath: 'communityMsgs/' + id,
        typingPath: 'communityTyping/' + id,
        placeholder: 'Message ' + (community.name || 'the community'),
        emptyText: 'This is the start of ' + (community.name || 'this community') + '.',
        members: () => Object.keys((communities[id] || community).members || {}),
        send: async message => {
          const member = await db.ref('communities/' + id + '/members/' + uid).once('value');
          if (!member.val()) throw new Error('Join this community to send messages');
          const ref = db.ref('communityMsgs/' + id).push();
          const preview = String(message.text || (message.attachments ? '📎 Attachment' : message.share ? '📝 Shared item' : message.forward ? '↪ Forwarded message' : '')).replace(/:gd\d{1,4}:/g, '🙂').replace(/:sticker_[A-Za-z0-9_.-]{1,100}:/g, '[Sticker]').slice(0, 120);
          const update = {};
          update['communityMsgs/' + id + '/' + ref.key] = message;
          update['communities/' + id + '/last'] = { uid, text: preview, ts: O.TS };
          await db.ref().update(update);
          return ref.key;
        }
      });
    }

    renderDetail();
    return modal;
  }

  function shareCommunity(id, community) {
    if (!O.canAct()) return;
    const note = el('textarea', { class: 'textarea', rows: 2, placeholder: 'Add a message (optional)', maxlength: 1000, style: 'min-height:60px' });
    const preview = el('div', { class: 'share-preview' },
      O.nameTag(community.owner || uid),
      el('div', { class: 't-title', style: 'font-size:14px;margin-top:6px' }, O.richEl(community.name || 'Community', 'span')),
      community.description ? O.richEl(community.description) : el('div', { class: 'muted' }, 'Public Orbit community'));
    const search = el('input', { class: 'input', placeholder: 'Search chats or people' });
    const listEl = el('div', { class: 'pick-list' });
    const send = el('button', { class: 'btn primary' }, 'Send');
    let convs = [];
    let dest = { type: 'main' };
    const same = target => target.type === dest.type && target.id === dest.id;
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      listEl.innerHTML = '';
      const row = (target, avatar, label, sub) => listEl.append(el('button', { type: 'button', class: 'pick' + (same(target) ? ' on' : ''), onclick: () => { dest = target; draw(); } },
        avatar, el('div', { class: 'grow' }, el('div', null, label), sub ? el('div', { class: 'muted', style: 'font-size:12px' }, sub) : null), el('span', { class: 'check round' })));
      if (!q || 'everyone main chat'.includes(q)) {
        row({ type: 'main' }, el('div', { class: 'av', style: '--s:32px' }, el('div', { class: 'ph', html: I.chat.replace('<svg', '<svg width="16" height="16"') })), el('b', null, 'Everyone'), 'Main chat');
      }
      const dmWith = new Set();
      convs.forEach(([cid, meta]) => {
        if (meta.type !== 'group') dmWith.add(O.dm.other(meta));
        const title = O.dm.title(meta);
        if (q && !title.toLowerCase().includes(q)) return;
        if (meta.type === 'group') row({ type: 'conv', id: cid }, O.avatarFrom({ name: meta.name || 'G' }, 32), el('b', null, title), 'Group · ' + Object.keys(meta.members || {}).length + ' members');
        else row({ type: 'conv', id: cid }, O.avatar(O.dm.other(meta), 32, false), O.nameTag(O.dm.other(meta)), 'DM');
      });
      Object.keys(O.S.users).filter(other => other !== uid && O.user(other) && !dmWith.has(other) && (!q || O.user(other).name.toLowerCase().includes(q)))
        .sort((a, b) => O.user(a).name.localeCompare(O.user(b).name)).slice(0, 40)
        .forEach(other => row({ type: 'person', id: other }, O.avatar(other, 32, false), O.nameTag(other), 'Start a DM'));
      if (!listEl.children.length) listEl.append(el('div', { class: 'muted', style: 'padding:10px;font-size:13px' }, 'Nothing matches'));
    };
    search.oninput = draw;
    const modal = O.modal({ title: 'Share community', body: el('div', null, preview, note, el('label', { class: 'label' }, 'Send to'), search, listEl), foot: [send] });
    draw();
    O.dm.listMine().then(list => { convs = list; draw(); }).catch(() => {});
    send.onclick = async () => {
      if (!O.canAct()) return;
      const authUid = O.authUid();
      if (dest.type === 'main' && !authUid) return O.toast('Secure chat sign-in is unavailable. Enable Anonymous sign-in in Firebase Authentication.', true);
      send.disabled = true;
      const share = { id, type: 'community', uid: community.owner || uid, title: String(community.name || 'Community').slice(0, 100), text: String(community.description || '').slice(0, 500) };
      const message = { uid, text: note.value.trim().slice(0, 1000), ts: O.TS, share };
      if (authUid) message.authUid = authUid;
      try {
        let where = 'main chat';
        if (dest.type === 'main') await db.ref('messages').push(message);
        else {
          const cid = dest.type === 'person' ? await O.dm.ensure(dest.id) : dest.id;
          await O.dm.send(cid, message);
          const conversation = convs.find(item => item[0] === cid);
          where = dest.type === 'person' ? O.user(dest.id).name : (conversation ? O.dm.title(conversation[1]) : 'DM');
        }
        modal.close();
        O.toast('Sent to ' + where);
      } catch (e) { send.disabled = false; O.toast(e.message || 'Could not share community', true); }
    };
  }

  function openHashCommunity() {
    const match = location.hash.match(/(?:^#|&)community=([A-Za-z0-9_-]+)/);
    if (!match || openedHash === match[1] || !communities[match[1]]) return;
    openedHash = match[1];
    openCommunity(match[1], communities[match[1]]);
  }

  function emojiButton(input) {
    const button = el('button', { type: 'button', class: 'icon-btn emoji-trigger', title: 'Add emoji', html: I.smile });
    button.onclick = () => O.openPicker(button, (id, kind) => {
      const token = O.emojiToken(id, kind);
      const start = input.selectionStart == null ? input.value.length : input.selectionStart;
      const end = input.selectionEnd == null ? start : input.selectionEnd;
      input.value = input.value.slice(0, start) + token + input.value.slice(end);
      input.selectionStart = input.selectionEnd = start + token.length;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    }, { keepOpen: true });
    return button;
  }

  function imageControl(label, oldValue) {
    const file = el('input', { type: 'file', accept: 'image/*', class: 'hidden' });
    const url = el('input', { class: 'input', type: 'url', placeholder: 'Optional image URL' });
    url.value = typeof oldValue === 'string' ? oldValue : (oldValue && oldValue.url) || '';
    const choose = el('button', { type: 'button', class: 'btn sm', onclick: () => file.click() }, 'Upload image');
    const clear = el('button', { type: 'button', class: 'btn sm ghost' }, 'Clear');
    const status = el('span', { class: 'community-image-status muted' }, oldValue ? 'Image selected' : 'Optional');
    const initialUrl = url.value.trim();
    const elNode = el('div', { class: 'community-image-field' },
      el('label', { class: 'label' }, label), url,
      el('div', { class: 'community-image-buttons' }, choose, clear, file, status));
    let uploaded = null, removed = false, urlDirty = false, busy = false, closed = false;
    const cleanup = () => { closed = true; if (uploaded) { O.deleteFiles([uploaded]); uploaded = null; } };
    url.addEventListener('input', () => {
      if (url.value.trim() === initialUrl) { urlDirty = false; removed = false; return; }
      removed = true;
      urlDirty = !!url.value.trim();
      if (uploaded) { O.deleteFiles([uploaded]); uploaded = null; }
      status.textContent = urlDirty ? 'Image URL selected' : 'Image cleared';
    });
    clear.onclick = () => {
      if (uploaded) { O.deleteFiles([uploaded]); uploaded = null; }
      url.value = ''; removed = true; status.textContent = 'Image cleared';
    };
    file.onchange = async () => {
      const selected = file.files && file.files[0]; file.value = '';
      if (!selected) return;
      if (O.kindOf(selected) !== 'image') return O.toast('Choose an image file', true);
      if (uploaded) { O.deleteFiles([uploaded]); uploaded = null; }
      busy = true; choose.disabled = true; status.textContent = 'Uploading…';
      try {
        const result = await O.upload(selected, progress => { if (progress >= 0) status.textContent = 'Uploading · ' + Math.round(progress * 100) + '%'; });
        if (closed) { O.deleteFiles([result]); return; }
        uploaded = result; removed = true; url.value = ''; status.textContent = 'Ready · ' + selected.name;
      } catch (e) { status.textContent = 'Upload failed'; O.toast(e.message || 'Image upload failed', true); }
      finally { busy = false; choose.disabled = false; }
    };
    return {
      el: elNode,
      busy: () => busy,
      value: () => {
        if (uploaded) return uploaded;
        if (urlDirty && url.value.trim()) {
          const normalized = safeUrl(url.value);
          if (!normalized) throw new Error('Enter a valid image URL');
          return normalized;
        }
        return removed ? null : oldValue || null;
      },
      cleanup
    };
  }

  function openEditor(id, community = {}, onSaved) {
    if (!O.canAct()) return;
    if (id && !canManage(community)) return O.toast('You cannot edit this community', true);
    const name = el('input', { class: 'input', maxlength: 50, placeholder: 'Community name' });
    name.value = community.name || '';
    const nameEmoji = emojiButton(name);
    const description = el('textarea', { class: 'textarea', maxlength: 800, rows: 5, placeholder: 'What is this community about?' });
    description.value = community.description || '';
    const descriptionEmoji = emojiButton(description);
    const cover = imageControl('Community image', community.cover);
    const logo = imageControl('Community logo', community.logo);
    let saved = false;
    const save = el('button', { type: 'button', class: 'btn primary' }, id ? 'Save changes' : 'Create community');
    const cancel = el('button', { type: 'button', class: 'btn ghost', onclick: () => modal.close() }, 'Cancel');
    const form = el('div', { class: 'community-form' },
      el('label', { class: 'label' }, 'Name'), el('div', { class: 'community-emoji-field' }, name, nameEmoji),
      el('label', { class: 'label' }, 'Description'), el('div', { class: 'community-emoji-field' }, description, descriptionEmoji),
      el('p', { class: 'community-shortcode-note' }, 'Emoji shortcodes work in the name and description.'),
      cover.el, logo.el);
    const modal = O.modal({ title: id ? 'Edit community' : 'Add Community', body: form, foot: [cancel, save], wide: true,
      onClose: () => { if (!saved) { cover.cleanup(); logo.cleanup(); } }
    });
    save.onclick = async () => {
      if (!O.canAct()) return;
      if (cover.busy() || logo.busy()) return O.toast('Wait for the image uploads to finish');
      const title = name.value.trim();
      if (!title) { O.toast('Enter a community name', true); name.focus(); return; }
      let coverValue, logoValue;
      try { coverValue = cover.value(); logoValue = logo.value(); }
      catch (e) { O.toast(e.message, true); return; }
      save.disabled = true;
      const fields = { name: title.slice(0, 50), description: description.value.trim().slice(0, 800), cover: coverValue, logo: logoValue, updatedAt: O.TS };
      try {
        let communityId = id;
        let updated;
        if (id) {
          await db.ref('communities/' + id).update(fields);
          updated = Object.assign({}, community, fields, { updatedAt: Date.now() });
        } else {
          const ref = db.ref('communities').push();
          communityId = ref.key;
          updated = Object.assign({}, fields, { owner: uid, createdAt: Date.now(), members: { [uid]: true } });
          await ref.set(Object.assign({}, updated, { createdAt: O.TS }));
        }
        saved = true;
        if (community.cover && typeof community.cover === 'object' && JSON.stringify(community.cover) !== JSON.stringify(coverValue)) O.deleteFiles([community.cover]);
        if (community.logo && typeof community.logo === 'object' && JSON.stringify(community.logo) !== JSON.stringify(logoValue)) O.deleteFiles([community.logo]);
        modal.close();
        communities[communityId] = updated;
        render(); O.toast(id ? 'Community updated' : 'Community created');
        if (onSaved) onSaved(updated);
        else openCommunity(communityId, updated);
      } catch (e) { save.disabled = false; O.toast(e.message || 'Could not save community', true); }
    };
  }
})();
