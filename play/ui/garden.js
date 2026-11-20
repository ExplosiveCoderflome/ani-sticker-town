(() => {
  "use strict";
  const {entries, discover} = window.TownEncounters;
  const entryFor = new Map(entries.map(entry => [entry.id, entry]));
  const storeKey = "town.encounters.v1";
  const journal = document.getElementById("journal-button");
  const count = document.getElementById("journal-count");
  const note = document.getElementById("scene-note");
  let state, layout, nearby = [], queue = [], timer, hintIndex = 0;
  let canSave = true;

  function load() {
    try {
      const ids = JSON.parse(localStorage.getItem(storeKey) || "[]");
      return Array.isArray(ids) ? ids.filter(id => entryFor.has(id)) : [];
    } catch { return []; }
  }
  const seen = new Set(load());
  function showCount() { count.textContent = seen.size ? seen.size + " 则" : ""; }
  function remember(id) {
    load().forEach(saved => seen.add(saved));
    if (seen.has(id)) return false;
    seen.add(id);
    try { localStorage.setItem(storeKey, JSON.stringify([...seen])); } catch { canSave = false; }
    showCount();
    return true;
  }
  window.addEventListener("storage", event => {
    if (event.key !== storeKey && event.key !== null) return;
    seen.clear(); load().forEach(id => seen.add(id)); showCount();
  });

  function caption(tag, value) {
    const item = document.createElement(tag);
    item.textContent = value;
    return item;
  }
  function perform(match) {
    const entry = entryFor.get(match.id);
    const fresh = remember(match.id);
    window.townGame("encounter", JSON.stringify(match));
    note.replaceChildren(caption("strong", entry.title), caption("span", fresh ? "记进了街角手记" : "街角的小事又发生了"));
    note.hidden = false;
  }
  function advance() {
    clearTimeout(timer);
    const match = queue.shift();
    if (!match) { note.hidden = true; return; }
    perform(match);
    timer = setTimeout(advance, 3800);
  }
  function stop() {
    clearTimeout(timer); queue = []; note.hidden = true;
  }
  function replay(match) {
    if (!match) return;
    stop(); queue.push(match); advance();
  }

  function sync(next) {
    const last = state;
    const switched = !last || last.mode !== next.mode || last.levelId !== next.levelId || last.marketMode !== next.marketMode;
    state = next;
    journal.hidden = next.mode !== "edit" || !!next.marketMode;
    if (journal.hidden) { if (switched) stop(); layout = null; nearby = []; return; }
    const signature = JSON.stringify(next.work.items);
    if (!switched && signature === layout) return;
    const waiting = queue.map(match => match.id);
    stop(); layout = signature; nearby = discover(next.work);
    if (switched) { showCount(); return; }
    queue = nearby.filter(match => waiting.includes(match.id));
    // Compare the edited instance, even when other cats and benches already form a pair.
    const changes = next.slots.filter(slot => {
      const old = last.slots.find(other => other.id === slot.id);
      return !old || old.anchor[0] !== slot.anchor[0] || old.anchor[1] !== slot.anchor[1];
    });
    if (changes.length === 1) {
      const slot = changes[0], old = last.slots.find(other => other.id === slot.id);
      const before = old ? discover(last.work, old) : [];
      for (const match of discover(next.work, slot)) {
        const partners = event => event.actors.map(actor => actor.z).join(",");
        if (!before.some(event => event.id === match.id && partners(event) === partners(match)) &&
            !queue.some(event => event.id === match.id)) queue.push(match);
      }
    }
    if (queue.length) timer = setTimeout(advance, 160);
  }
  function tap(instanceId) {
    if (state?.mode !== "edit" || state.marketMode) return;
    const slot = state.slots.find(item => item.id === instanceId);
    if (!slot) return;
    replay(discover(state.work, slot)[0]);
  }

  function open(openDialog, closeDialog) {
    const content = document.createElement("div");
    content.className = "journal-pages";
    if (!seen.size) {
      const intro = document.createElement("div");
      intro.className = "journal-empty";
      const sketch = document.createElement("img");
      sketch.src = "media/stickers/black-cat.webp"; sketch.alt = "";
      intro.append(sketch, caption("p","今天的手记还是空的。把贴纸摆近一点，看看街角会发生什么。"));
      content.append(intro);
    }
    for (const id of [...seen].reverse()) {
      const entry = entryFor.get(id), match = nearby.find(item => item.id === id);
      const row = document.createElement("article"), body = document.createElement("div"), sketch = document.createElement("img");
      row.className = "journal-entry"; sketch.src = "media/stickers/" + entry.icon + ".webp"; sketch.alt = "";
      body.append(caption("h3",entry.title),caption("p",entry.story));
      if (match) {
        const button = caption("button","回街角再看一次");
        button.className = "journal-replay";
        button.onclick = () => { closeDialog(); replay(match); };
        body.append(button);
      }
      row.append(sketch,body); content.append(row);
    }
    if (!canSave) content.append(caption("p","这次的手记只能留在当前页面。"));
    const hints = entries.filter(entry => !seen.has(entry.id));
    const buttons = [];
    if (hints.length) {
      const whisper = caption("p","");
      whisper.className = "journal-hint"; whisper.hidden = true; whisper.setAttribute("aria-live","polite");
      const button = caption("button","听个小道消息"); button.className = "plain";
      button.onclick = () => { whisper.textContent = hints[hintIndex++ % hints.length].hint; whisper.hidden = false; };
      content.append(whisper); buttons.push(button);
    }
    const back = caption("button","回到街角"); back.className = "action"; back.onclick = closeDialog;
    buttons.push(back); openDialog("街角手记",[content],buttons,"journal-dialog");
  }
  window.TownGarden = {sync,tap,open};
})();
