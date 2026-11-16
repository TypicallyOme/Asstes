(function () {
  'use strict';
  const O = window.Orbit;
  const { db, el, I } = O;
  O.init({ page: 'archive' });

  const grid = O.$('#moreGrid');
  const empty = O.$('#moreEmpty');
  const searchInput = O.$('#archiveSearch');
  const sortSelect = O.$('#archiveSort');
  const addBtn = O.$('#addMoreCard');
  const viewer = O.$('#moreViewer');
  const viewerPanel = O.$('#moreViewerPanel');
  const viewerClose = O.$('#moreViewerClose');
  const viewerTitle = O.$('#moreViewerTitle');
  const viewerFrame = O.$('#moreViewerFrame');
  let cards = {};
  let currentCard = null;
  let pageOverflow = '';
  const imageCache = new Map();

  addBtn.onclick = () => openCardEditor();
  searchInput.addEventListener('input', renderCards);
  sortSelect.addEventListener('change', renderCards);
  viewerClose.innerHTML = I.x;
  viewerClose.onclick = closeViewer;
  O.$('#moreRefresh').onclick = refreshViewer;
  O.$('#moreBlank').onclick = openInBlank;
  O.$('#moreFullscreen').onclick = toggleFullscreen;
  viewer.addEventListener('pointerdown', e => { if (e.target === viewer) closeViewer(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !viewer.classList.contains('hidden')) closeViewer(); });
  document.addEventListener('fullscreenchange', () => {
    O.$('#moreFullscreen').textContent = document.fullscreenElement === viewerPanel ? 'Exit fullscreen' : 'Fullscreen';
  });

  O.ready.then(() => {
    renderCards();
    openHashBox();
  });

  db.ref('moreCards').on('value', snap => {
    cards = snap.val() || {};
    renderCards();
    openHashBox();
  }, err => {
    console.error('Orbit: cannot read /moreCards', err);
    O.toast('Could not load Archive boxes', true);
  });

  function webUrl(value) {
    let raw = String(value || '').trim();
    if (!raw) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith('/') && !raw.startsWith('./') && !raw.startsWith('../')) raw = 'https://' + raw;
    try {
      const url = new URL(raw, location.href);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      return url.href;
    } catch (e) { return null; }
  }

  const ratios = [
    ['Square · 1:1', '1 / 1'],
    ['Compact · 5:4', '5 / 4'],
    ['Classic · 4:3', '4 / 3'],
    ['Landscape · 3:2', '3 / 2'],
    ['Portrait · 4:5', '4 / 5']
  ];
  const canManageCard = card => !!card && (O.isAdmin() || card.createdBy === O.uid);

  function getImageSource(image) {
    if (!image) return Promise.resolve('');
    if (typeof image === 'string') return Promise.resolve(webUrl(image) || '');
    if (image.url) return Promise.resolve(webUrl(image.url) || '');
    if (!image.fid) return Promise.resolve('');
    const fid = String(image.fid);
    if (!imageCache.has(fid)) {
      imageCache.set(fid, db.ref('files/' + fid + '/data').once('value').then(s => {
        const data = s.val();
        return typeof data === 'string' && /^data:image\//i.test(data) ? data : '';
      }).catch(() => ''));
    }
    return imageCache.get(fid);
  }

  function renderCards() {
    if (!grid) return;
    grid.innerHTML = '';
    const query = searchInput.value.trim().toLocaleLowerCase();
    const sortBy = sortSelect.value || 'newest';
    const items = Object.entries(cards).filter(([, card]) => card && typeof card === 'object')
      .filter(([, card]) => !query || [card.title, card.text, card.url].some(value => String(value || '').toLocaleLowerCase().includes(query)));
    const created = card => Number(card.createdAt) || Number(card.order) || 0;
    items.sort((a, b) => {
      if (sortBy === 'name') return String(a[1].title || '').localeCompare(String(b[1].title || ''), undefined, { sensitivity: 'base' });
      const delta = created(a[1]) - created(b[1]);
      return sortBy === 'oldest' ? delta : -delta;
    });
    empty.textContent = query ? 'No boxes match your search.' : 'No boxes yet.';
    empty.classList.toggle('hidden', items.length > 0);
    items.forEach(([id, card]) => {
      const shell = el('article', { class: 'more-card-shell no-image' });
      const ratio = ratios.some(([, value]) => value === card.ratio) ? card.ratio : '4 / 3';
      shell.style.aspectRatio = ratio;
      const image = el('img', { alt: '', loading: 'lazy', draggable: 'false' });
      image.onerror = () => { image.remove(); shell.classList.add('no-image'); };
      const titleNode = O.richEl(String(card.title || 'Untitled').slice(0, 60), 'span');
      titleNode.classList.add('more-card-title');
      const descriptionNode = card.text ? O.richEl(String(card.text).slice(0, 180), 'span') : null;
      if (descriptionNode) descriptionNode.classList.add('more-card-description');
      const open = el('button', { type: 'button', class: 'more-card-open', 'aria-label': 'Open ' + (card.title || 'link') + ' in preview' },
        image, el('span', { class: 'more-card-copy' }, titleNode, descriptionNode));
      open.onclick = () => openViewer(card);
      shell.append(open);
      const actions = el('div', { class: 'more-card-actions' },
        el('button', { type: 'button', title: 'Share box', 'aria-label': 'Share box', html: I.share, onclick: e => { e.stopPropagation(); shareBox(id, card); } }));
      if (canManageCard(card)) {
        actions.append(
          el('button', { type: 'button', title: 'Edit box', 'aria-label': 'Edit box', html: I.edit, onclick: e => { e.stopPropagation(); openCardEditor(id, card); } }),
          el('button', { type: 'button', title: 'Delete box', 'aria-label': 'Delete box', html: I.trash, onclick: e => { e.stopPropagation(); deleteCard(id, card); } }));
      }
      shell.append(actions);
      grid.append(shell);
      getImageSource(card.image).then(src => {
        if (!shell.isConnected) return;
        if (src) { image.src = src; shell.classList.remove('no-image'); }
      });
    });
  }

  function insertEmoji(input, button) {
    O.openPicker(button, id => {
      const token = ':gd' + id + ':';
      const start = input.selectionStart == null ? input.value.length : input.selectionStart;
      const end = input.selectionEnd == null ? start : input.selectionEnd;
      input.value = input.value.slice(0, start) + token + input.value.slice(end);
      input.selectionStart = input.selectionEnd = start + token.length;
      input.focus();
    }, { keepOpen: true });
  }

  function openCardEditor(id, card = {}) {
    if (!O.canAct()) return;
    if (id && !canManageCard(card)) return O.toast('You can only edit your own boxes', true);
    const titleIn = el('input', { class: 'input', maxlength: 60, placeholder: 'Box title', value: card.title || '' });
    const titleEmoji = el('button', { type: 'button', class: 'icon-btn more-emoji-btn', title: 'Add emoji', html: I.smile });
    titleEmoji.onclick = () => insertEmoji(titleIn, titleEmoji);
    const ratioIn = el('select', { class: 'input', 'aria-label': 'Box shape' });
    ratios.forEach(([label, value]) => ratioIn.append(el('option', { value }, label)));
    ratioIn.value = ratios.some(([, value]) => value === card.ratio) ? card.ratio : '4 / 3';
    const textIn = el('textarea', { class: 'textarea', maxlength: 180, rows: 3, placeholder: 'Text revealed when someone hovers over the box' });
    textIn.value = card.text || '';
    const textEmoji = el('button', { type: 'button', class: 'icon-btn more-emoji-btn', title: 'Add emoji', html: I.smile });
    textEmoji.onclick = () => insertEmoji(textIn, textEmoji);
    const urlIn = el('input', { class: 'input', maxlength: 2048, type: 'url', placeholder: 'https://example.com', value: card.url || '' });
    const imageUrl = typeof card.image === 'string' ? card.image : (card.image && card.image.url) || '';
    const imageUrlIn = el('input', { class: 'input', maxlength: 2048, type: 'url', placeholder: 'Optional image URL', value: imageUrl });
    const fileIn = el('input', { type: 'file', accept: 'image/*', class: 'hidden' });
    const uploadBtn = el('button', { type: 'button', class: 'btn sm', onclick: () => fileIn.click() }, 'Choose image');
    const clearImageBtn = el('button', { type: 'button', class: 'btn sm ghost', onclick: () => {
      if (uploadedImage) { O.deleteFiles([uploadedImage]); uploadedImage = null; }
      imageUrlIn.value = ''; removeExistingImage = true; imageStatus.textContent = 'Image cleared';
    } }, 'Clear image');
    const imageStatus = el('span', { class: 'muted more-image-status' }, card.image ? 'Current image selected' : 'No image selected');
    let uploadedImage = null;
    let uploadBusy = false;
    let removeExistingImage = false;
    let editorClosed = false;
    let saved = false;
    const oldImage = card.image || null;
    const saveBtn = el('button', { type: 'button', class: 'btn primary', onclick: saveCard }, id ? 'Save box' : 'Create box');
    const cancelBtn = el('button', { type: 'button', class: 'btn ghost', onclick: () => dialog.close() }, 'Cancel');
    const imageControls = el('div', { class: 'more-image-controls' }, uploadBtn, clearImageBtn, fileIn, imageStatus);
    const body = el('div', { class: 'more-editor-form' },
      el('label', { class: 'label' }, 'Title'), el('div', { class: 'more-emoji-input' }, titleIn, titleEmoji),
      el('label', { class: 'label' }, 'Hover text'), el('div', { class: 'more-emoji-input' }, textIn, textEmoji),
      el('label', { class: 'label' }, 'Box shape'), ratioIn,
      el('label', { class: 'label' }, 'Hyperlink'), urlIn,
      el('label', { class: 'label' }, 'Image URL or upload'), imageUrlIn, imageControls);
    const dialog = O.modal({ title: id ? 'Edit Archive box' : 'Create Archive box', body, foot: [cancelBtn, saveBtn], wide: true, onClose: () => {
      editorClosed = true;
      if (!saved && uploadedImage) O.deleteFiles([uploadedImage]);
    } });

    imageUrlIn.addEventListener('input', () => {
      if (imageUrlIn.value.trim()) {
        removeExistingImage = true;
        if (uploadedImage) { O.deleteFiles([uploadedImage]); uploadedImage = null; }
        imageStatus.textContent = 'Image URL selected';
      }
    });
    fileIn.onchange = async () => {
      const file = fileIn.files && fileIn.files[0];
      fileIn.value = '';
      if (!file) return;
      if (O.kindOf(file) !== 'image') return O.toast('Choose an image file', true);
      if (uploadedImage) { O.deleteFiles([uploadedImage]); uploadedImage = null; }
      uploadBusy = true; uploadBtn.disabled = true; saveBtn.disabled = true;
      imageStatus.textContent = 'Uploading image…';
      try {
        const uploaded = await O.upload(file, progress => {
          if (progress >= 0) imageStatus.textContent = 'Uploading image · ' + Math.round(progress * 100) + '%';
        });
        if (editorClosed) { O.deleteFiles([uploaded]); return; }
        uploadedImage = uploaded; removeExistingImage = true;
        imageUrlIn.value = '';
        imageStatus.textContent = 'Image ready · ' + file.name;
      } catch (e) { imageStatus.textContent = 'Image upload failed'; O.toast(e.message || 'Image upload failed', true); }
      finally { uploadBusy = false; uploadBtn.disabled = false; saveBtn.disabled = false; }
    };

    async function saveCard() {
      if (uploadBusy) return O.toast('Wait for the image upload to finish');
      const title = titleIn.value.trim();
      const url = webUrl(urlIn.value);
      if (!title) { O.toast('Enter a title for the box', true); titleIn.focus(); return; }
      if (!url) { O.toast('Enter a valid http or https hyperlink', true); urlIn.focus(); return; }
      const imageValue = imageUrlIn.value.trim();
      let image = uploadedImage || (removeExistingImage ? null : oldImage);
      if (imageValue) {
        const normalizedImageUrl = webUrl(imageValue);
        if (!normalizedImageUrl) { O.toast('Enter a valid image URL', true); imageUrlIn.focus(); return; }
        image = oldImage && typeof oldImage === 'object' && oldImage.url === normalizedImageUrl ? oldImage : normalizedImageUrl;
      }
      const record = {
        title: title.slice(0, 60), text: textIn.value.trim().slice(0, 180), url,
        image: image || null, ratio: ratioIn.value, order: Number(card.order) || Date.now(),
        createdBy: card.createdBy || O.uid, createdAt: card.createdAt || O.TS, updatedAt: O.TS
      };
      const ref = id ? db.ref('moreCards/' + id) : db.ref('moreCards').push();
      saveBtn.disabled = true;
      try {
        await ref.set(record);
        saved = true;
        dialog.close();
        if (oldImage && removeExistingImage && (!image || JSON.stringify(oldImage) !== JSON.stringify(image))) O.deleteFiles([oldImage]);
        O.toast(id ? 'Archive box saved' : 'Archive box created');
      } catch (e) { saveBtn.disabled = false; O.toast('Could not save box: ' + e.message, true); }
    }
  }

  async function deleteCard(id, card) {
    if (!canManageCard(card)) return O.toast('You can only delete your own boxes', true);
    if (!await O.confirmBox('Delete “' + String(card.title || 'this box') + '”?', 'Delete box', true)) return;
    try {
      await db.ref('moreCards/' + id).remove();
      if (card.image && typeof card.image === 'object') O.deleteFiles([card.image]);
      O.toast('Box deleted');
    } catch (e) { O.toast('Could not delete box', true); }
  }

  let openedHashBox = '';
  function openHashBox() {
    const match = location.hash.match(/(?:^#|&)box=([A-Za-z0-9_-]+)/);
    if (!match || openedHashBox === match[1]) return;
    const card = cards[match[1]];
    if (!card) return;
    openedHashBox = match[1];
    openViewer(card);
  }

  function shareBox(id, card) {
    if (!O.canAct()) return;
    const note = el('textarea', { class: 'textarea', rows: 2, placeholder: 'Add a message (optional)', maxlength: 1000, style: 'min-height:60px' });
    const preview = el('div', { class: 'share-preview' }, O.nameTag(card.createdBy || O.uid),
      el('div', { class: 't-title', style: 'font-size:14px;margin-top:6px' }, card.title || 'Untitled'),
      card.text ? O.richEl(card.text) : el('div', { class: 'muted' }, card.url || 'Archive box'));
    const search = el('input', { class: 'input', placeholder: 'Search chats or people' });
    const listEl = el('div', { class: 'pick-list' });
    const go = el('button', { class: 'btn primary' }, 'Send');
    let convs = [];
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
      convs.forEach(([cid, meta]) => {
        if (meta.type !== 'group') dmWith.add(O.dm.other(meta));
        const title = O.dm.title(meta);
        if (q && !title.toLowerCase().includes(q)) return;
        if (meta.type === 'group') row({ type: 'conv', id: cid }, O.avatarFrom({ name: meta.name || 'G' }, 32), el('b', null, title), 'Group · ' + Object.keys(meta.members || {}).length + ' members');
        else row({ type: 'conv', id: cid }, O.avatar(O.dm.other(meta), 32, false), O.nameTag(O.dm.other(meta)), 'DM');
      });
      Object.keys(O.S.users).filter(u => u !== O.uid && O.user(u) && !dmWith.has(u) && (!q || O.user(u).name.toLowerCase().includes(q)))
        .sort((a, b) => O.user(a).name.localeCompare(O.user(b).name)).slice(0, 40)
        .forEach(u => row({ type: 'person', id: u }, O.avatar(u, 32, false), O.nameTag(u), 'Start a DM'));
      if (!listEl.children.length) listEl.append(el('div', { class: 'muted', style: 'padding:10px;font-size:13px' }, 'Nothing matches'));
    };
    search.oninput = draw;
    const modal = O.modal({ title: 'Share Archive box', body: el('div', null, preview, note, el('label', { class: 'label' }, 'Send to'), search, listEl), foot: [go] });
    draw();
    O.dm.listMine().then(list => { convs = list; draw(); }).catch(() => {});
    go.onclick = async () => {
      if (!O.canAct()) return;
      go.disabled = true;
      const share = { id, type: 'archive', uid: card.createdBy || O.uid, title: String(card.title || 'Untitled').slice(0, 60), text: String(card.text || '').slice(0, 180), url: webUrl(card.url) || '' };
      const msg = { uid: O.uid, text: note.value.trim().slice(0, 1000), ts: O.TS, share };
      try {
        let where = 'main chat';
        if (dest.type === 'main') await db.ref('messages').push(msg);
        else {
          const cid = dest.type === 'person' ? await O.dm.ensure(dest.id) : dest.id;
          await O.dm.send(cid, msg);
          where = dest.type === 'person' ? O.user(dest.id).name : (convs.find(c => c[0] === cid) ? O.dm.title(convs.find(c => c[0] === cid)[1]) : 'DM');
        }
        modal.close();
        O.toast('Sent to ' + where);
      } catch (e) { O.toast(e.message || 'Could not share box', true); go.disabled = false; }
    };
  }

  function openViewer(card) {
    const url = webUrl(card && card.url);
    if (!url) return O.toast('This box has an invalid hyperlink', true);
    currentCard = { title: String(card.title || 'Link preview'), url };
    viewerTitle.textContent = currentCard.title;
    viewerFrame.src = url;
    viewer.classList.remove('hidden');
    pageOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    viewerClose.focus();
  }

  function closeViewer() {
    if (viewer.classList.contains('hidden')) return;
    if (document.fullscreenElement === viewerPanel && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    viewer.classList.add('hidden');
    viewerFrame.src = 'about:blank';
    document.body.style.overflow = pageOverflow;
    currentCard = null;
    if (location.hash.startsWith('#box=')) history.replaceState(null, '', location.pathname + location.search);
  }

  function refreshViewer() {
    if (!currentCard) return;
    const url = currentCard.url;
    viewerFrame.src = 'about:blank';
    requestAnimationFrame(() => { if (currentCard && currentCard.url === url) viewerFrame.src = url; });
  }

  function openInBlank() {
    if (!currentCard) return;
    const win = window.open('about:blank', '_blank');
    if (!win) return O.toast('Your browser blocked the new window', true);
    const doc = win.document;
    doc.title = currentCard.title;
    doc.body.style.cssText = 'margin:0;background:#111;overflow:hidden;';
    const frame = doc.createElement('iframe');
    frame.title = currentCard.title;
    frame.src = currentCard.url;
    frame.allow = 'fullscreen; autoplay; encrypted-media';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'no-referrer';
    frame.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;background:#111;';
    doc.body.append(frame);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === viewerPanel) await document.exitFullscreen();
      else if (viewerPanel.requestFullscreen) await viewerPanel.requestFullscreen();
      else O.toast('Fullscreen is not supported here', true);
    } catch (e) { O.toast('Could not enter fullscreen', true); }
  }
})();
