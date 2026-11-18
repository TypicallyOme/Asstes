(function () {
  'use strict';
  const O = window.Orbit;
  const { db, uid, el } = O;

  O.init({ page: 'chat', require: true });
  O.$('#messageTools').replaceWith(O.messageTools());

  const stage = O.$('#omegleStage');
  const status = O.$('#omegleStatus');
  const nextButton = O.$('#omegleNext');
  const searchButton = O.$('#searchBtn');
  searchButton.classList.add('hidden');
  const pool = db.ref('omeglePool');
  const ownQueue = pool.child(uid);
  let conversation = null;
  let activeRoom = null;
  let peerUid = null;
  let waitingCallback = null;
  let peerCallback = null;
  let busy = false;
  let generation = 0;

  function showWait(title, copy) {
    stage.innerHTML = '';
    stage.append(el('div', { class: 'omegle-wait' }, el('div', null,
      el('strong', null, title), el('span', null, copy))));
    searchButton.classList.add('hidden');
  }
  function setStatus(text) { status.textContent = text; }
  function detachWaiting() {
    if (waitingCallback) ownQueue.off('value', waitingCallback);
    waitingCallback = null;
  }
  function detachPeer() {
    if (peerCallback && activeRoom && peerUid) db.ref('omegleSessions/' + activeRoom + '/members/' + peerUid).off('value', peerCallback);
    peerCallback = null;
  }
  async function leaveCurrent() {
    detachWaiting();
    const room = activeRoom, peer = peerUid;
    detachPeer();
    activeRoom = null; peerUid = null;
    if (conversation) { conversation.destroy(); conversation = null; }
    try { await ownQueue.onDisconnect().cancel(); } catch (e) {}
    try { await ownQueue.remove(); } catch (e) {}
    if (room) {
      const member = db.ref('omegleSessions/' + room + '/members/' + uid);
      try { await member.onDisconnect().cancel(); } catch (e) {}
      try { await member.remove(); } catch (e) {}
    }
    return { room, peer };
  }
  async function strangerLeft(room) {
    if (activeRoom !== room) return;
    const oldRoom = activeRoom;
    detachPeer();
    activeRoom = null; peerUid = null;
    if (conversation) { conversation.destroy(); conversation = null; }
    try { await ownQueue.remove(); } catch (e) {}
    try { await db.ref('omegleSessions/' + oldRoom + '/members/' + uid).remove(); } catch (e) {}
    setStatus('Stranger disconnected');
    nextButton.textContent = 'Next stranger';
    nextButton.disabled = false;
    showWait('Stranger disconnected', 'Click Next stranger to meet someone else.');
  }
  async function connect(room, peer, token) {
    if (!room || !peer || token !== generation) return;
    detachWaiting();
    activeRoom = room; peerUid = peer;
    setStatus('Connected to a stranger');
    nextButton.textContent = 'Next';
    nextButton.disabled = false;
    const session = db.ref('omegleSessions/' + room);
    await session.child('members').transaction(members => {
      members = members || {};
      members[uid] = true;
      members[peer] = true;
      return members;
    });
    if (token !== generation || activeRoom !== room) {
      try { await session.child('members/' + uid).remove(); } catch (e) {}
      return;
    }
    await session.child('members/' + uid).onDisconnect().remove();
    const peerRef = session.child('members/' + peer);
    peerCallback = peerRef.on('value', snapshot => {
      if (!snapshot.exists()) strangerLeft(room);
    });
    searchButton.classList.remove('hidden');
    conversation = O.Conversation({
      mount: stage,
      msgPath: 'omegleRooms/' + room,
      typingPath: 'omegleTyping/' + room,
      placeholder: 'Message your stranger',
      emptyText: 'You’re connected. Say hello 👋',
      anonymous: true,
      searchBtn: searchButton,
      onIncoming: (message, key) => {
        const body = String(message.text || (message.attachments ? 'Sent an attachment' : 'Sent a message')).replace(/:gd\d{1,4}:/g, '🙂').replace(/:sticker_[A-Za-z0-9_.-]{1,100}:/g, '[Sticker]').slice(0, 180);
        O.notifyIncoming({ id: 'omegle:' + room + ':' + key, title: 'Omegle stranger', body, href: 'omegle.html' });
      }
    });
  }
  async function startSearch() {
    if (busy) return;
    busy = true;
    const token = ++generation;
    nextButton.disabled = true;
    nextButton.textContent = 'Finding…';
    setStatus('Looking for someone');
    await leaveCurrent();
    if (token !== generation) { busy = false; return; }
    showWait('Finding a stranger…', 'Keep this page open while Orbit looks for another person.');
    const room = db.ref('omegleRooms').push().key;
    try {
      const result = await pool.transaction(entries => {
        const now = O.now();
        entries = entries || {};
        Object.keys(entries).forEach(id => {
          const item = entries[id] || {};
          const age = now - (Number(item.ts) || 0);
          if ((item.status === 'waiting' && age > 120000) || (item.status === 'matched' && age > 7200000)) delete entries[id];
        });
        let other = Object.keys(entries).find(id => id !== uid && entries[id] && entries[id].status === 'waiting' && now - (Number(entries[id].ts) || 0) <= 120000);
        if (other) {
          const created = Number(entries[other].ts) || now;
          entries[other] = { status: 'matched', peer: uid, room, ts: created };
          entries[uid] = { status: 'matched', peer: other, room, ts: now };
        } else {
          entries[uid] = { status: 'waiting', ts: now };
        }
        return entries;
      });
      if (!result.committed || token !== generation) throw new Error('Could not join the stranger queue');
      const mine = result.snapshot.child(uid).val() || {};
      if (mine.status === 'matched') {
        await ownQueue.onDisconnect().remove();
        await connect(mine.room, mine.peer, token);
      } else {
        await ownQueue.onDisconnect().remove();
        setStatus('Waiting for a stranger');
        nextButton.textContent = 'Cancel';
        nextButton.disabled = false;
        waitingCallback = ownQueue.on('value', snapshot => {
          const match = snapshot.val();
          if (match && match.status === 'matched') connect(match.room, match.peer, token).catch(error => {
            console.error('Omegle connection failed:', error);
            O.toast('Could not open that chat', true);
          });
        });
      }
    } catch (error) {
      if (token === generation) {
        console.error('Omegle matching failed:', error);
        setStatus('Could not connect');
        nextButton.textContent = 'Try again';
        nextButton.disabled = false;
        showWait('Could not find a stranger', 'Check your connection, then try again.');
        O.toast('Could not join Omegle: ' + (error.message || 'connection error'), true);
      }
    } finally { busy = false; }
  }
  async function cancelSearch() {
    generation++;
    await leaveCurrent();
    setStatus('Not connected');
    nextButton.textContent = 'Start chatting';
    nextButton.disabled = false;
    showWait('Meet someone new', 'Start chatting to be paired with a random person. Names and profile pictures appear as Anonymous.');
  }
  nextButton.onclick = () => {
    if (busy) return;
    if (activeRoom) return startSearch();
    if (waitingCallback) return cancelSearch();
    startSearch();
  };
  window.addEventListener('beforeunload', () => {
    detachWaiting();
    detachPeer();
    ownQueue.onDisconnect().remove();
    if (activeRoom) db.ref('omegleSessions/' + activeRoom + '/members/' + uid).onDisconnect().remove();
  });
})();
