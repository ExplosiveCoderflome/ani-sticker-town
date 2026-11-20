(() => {
  "use strict";
  const get = id => document.getElementById(id);
  const roles = ["stall","table","chair","customer"];
  const kitKey = "town.night-market.last-kit.v1";
  const genId = /^gen-[a-f0-9]{32}$/;
  const served = new Map();
  const scenes = {
    market: {actor:"客人", place:"摊位", tally:"本轮成交", unit:"单", near:"点单", stay:"坐下来吃", away:"打包带走", got:"接过餐点", sitting:"去桌边坐下吃", leaving:"把餐点打包带走"},
    books: {actor:"读者", place:"书亭", tally:"本轮借阅", unit:"本", near:"挑书", stay:"坐下读书", away:"借书回家", got:"拿到一本书", sitting:"去阅读桌翻一翻", leaving:"把书借回家读"},
    garden: {actor:"园艺客", place:"花草铺", tally:"本轮领苗", unit:"盆", near:"挑花苗", stay:"桌边栽苗", away:"带苗回家", got:"领到一株小苗", sitting:"去工作台栽苗", leaving:"把花苗带回家"},
    studio: {actor:"画客", place:"画材铺", tally:"本轮取色", unit:"次", near:"选颜料", stay:"坐下写生", away:"带走画材", got:"拿到调色盘", sitting:"去画桌坐下写生", leaving:"带着画材去找风景"},
    general: {actor:"访客", place:"主题站", tally:"本轮来访", unit:"次", near:"取物", stay:"桌边体验", away:"带走小物", got:"接过一件小物", sitting:"去桌边坐下体验", leaving:"把小物带走"}
  };
  let discoveries = new Set();
  let state, sceneKey = "", layout = "", visits = [], active = null, sales = 0;
  let timer, holding = false, loading = 0, enabled = false;

  function validate(ids) {
    if (!Array.isArray(ids) || ids.length !== 4 || new Set(ids).size !== 4 || !ids.every(id => typeof id === "string" && genId.test(id))) {
      throw Error("互动盒需要四个不同的组件。请检查地点、桌子、座椅和角色是否齐全。");
    }
  }
  async function enter(ids, theme, profile, ticket) {
    validate(ids);
    if (typeof theme !== "string" || !theme.trim()) theme = "一个热闹的夜市";
    const rows = await window.stickerStudio.ensure(ids);
    if (ticket !== loading) return;
    if (typeof window.townGame !== "function") throw Error("贴纸盒还在打开，请稍等一下再进夜市。");
    // The full prompt stays in the atelier. Use a compact display title for the scene.
    const resolved = rows.find(row => row?.role === "stall")?.profile || profile;
    const kit = {ids,theme:[...theme.trim()].slice(0,32).join(""),profile:Object.hasOwn(scenes,resolved) ? resolved : "market"};
    window.townGame("marketOpen", JSON.stringify(kit));
    if (!state?.marketMode || !ids.every((id,i) => state.marketKit?.[i] === id)) throw Error("这套贴纸没能打开，请重新取出这盒。");
    try { localStorage.setItem(kitKey,JSON.stringify(kit)); } catch {}
  }
  function fromRows(rows, theme, profile, ticket = ++loading) {
    if (!Array.isArray(rows)) throw Error("主题贴纸清单没有读完整。");
    const ids = roles.map(role => rows.find(row => row.role === role)?.id);
    return enter(ids,theme,profile,ticket);
  }
  async function launch(sampleOnly = false) {
    const ticket = ++loading;
    if (!sampleOnly) {
      let last;
      try { last = JSON.parse(localStorage.getItem(kitKey)); } catch {}
      if (last) {
        try { await enter(last.ids,last.theme,last.profile,ticket); return; }
        catch { if (ticket === loading) window.townUI.notice("上一次的夜市素材暂时不可用，正在打开内置样盒。"); }
      }
    }
    const route = sampleOnly === "seaside" ? "seaside-market" : sampleOnly === "books" ? "bookshop" : "night-market";
    const res = await fetch("/api/stickers/"+route,{mode:"same-origin",redirect:"error"});
    if (!res.ok) throw Error("样盒还没取到，请用下载包里的「开始试玩」打开。");
    const kit = await res.json();
    if (ticket === loading) await fromRows(kit.stickers,kit.theme,kit.profile,ticket);
  }
  function visitKey(visit) {
    return JSON.stringify([visit.stallId, visit.tableId, visit.chairId, visit.actors.map(a => [a.asset,a.x,a.y])]);
  }
  function waiting() { return visits.filter(visit => served.get(visit.customerId) !== visitKey(visit)); }
  function show() {
    get("market-ledger").hidden = !enabled;
    if (!enabled) return;
    const profile = active?.visit.profile || state.marketProfile || visits[0]?.profile || "market";
    const story = scenes[profile] || scenes.market;
    get("market-tally-label").textContent = story.tally;
    get("market-unit").textContent = story.unit;
    get("market-discoveries").hidden = !state.marketMode;
    get("market-found").textContent = discoveries.size + " / 2";
    for (const outcome of ["away","stay"]) {
      const stamp = get("market-step-" + outcome);
      const found = discoveries.has(outcome);
      stamp.textContent = story[outcome];
      stamp.classList.toggle("found",found);
      stamp.setAttribute("aria-label", story[outcome] + (found ? "，已发现" : "，待发现"));
    }
    get("market-sales").textContent = String(sales);
    get("market-reopen").disabled = !visits.length || !!active || !!waiting().length;
    let text;
    if (active) {
      const name = state.slots.find(s => s.id === active.visit.stallId)?.name || story.place;
      text = active.sold ? story.actor + story.got + "，" + (active.visit.chairId ? story.sitting : story.leaving) + "。"
        : story.actor + "正在走向「" + name + "」。";
    } else if (!state.slots.some(s => s.role === "stall" || s.role === "customer")) text = "先放一张" + story.place + "贴纸，再摆一位" + story.actor + "。";
    else if (!state.slots.some(s => s.role === "customer")) text = "把" + story.actor + "放在" + story.place + "旁边，他就会走过去" + story.near + "。";
    else if (!state.slots.some(s => s.role === "stall")) text = story.actor + "到了，给街边添个" + story.place + "吧。";
    else if (!visits.length) text = story.actor + "离" + story.place + "太远了。试着把两张贴近一些。";
    else if (waiting().length) text = story.actor + "准备出发了。";
    else if (state.marketMode && discoveries.size === 1) text = discoveries.has("stay") ? "把座椅挪远，再看看会发生什么。" : "把桌子放到" + story.place + "旁，再把椅子贴近桌边。";
    else text = "这一轮结束了。换个摆法，或再招呼一轮。";
    get("market-status").textContent = text;
  }
  function schedule(delay = 500) {
    clearTimeout(timer);
    if (enabled && !active && !holding && !document.hidden && waiting().length) timer = setTimeout(start, delay);
  }
  function start() {
    if (!enabled || active || holding || document.hidden) return;
    if (!state.marketMode && !get("scene-note").hidden) { schedule(500); return; }
    const visit = waiting()[0];
    if (!visit) return;
    active = {visit, key:visitKey(visit), sold:false};
    show();
    window.townGame("encounter",JSON.stringify(visit));
  }
  function sync(next) {
    state = next;
    const key = next.mode === "edit" ? (next.marketMode ? next.marketKit.join(".") : next.levelId) : "";
    const changedScene = key !== sceneKey;
    const interactive = !!key && (next.marketMode || next.slots.some(s => roles.includes(s.role)));
    if (changedScene || enabled !== interactive) {
      clearTimeout(timer); active = null; sales = 0; served.clear(); layout = ""; sceneKey = key;
      discoveries = new Set();
      if (next.marketMode) {
        try {
          const found = JSON.parse(localStorage.getItem("town.theme.finds." + key));
          if (Array.isArray(found)) discoveries = new Set(found.filter(item => item === "stay" || item === "away"));
        } catch {}
      }
    }
    enabled = interactive;
    if (!enabled) { show(); return; }
    const fingerprint = JSON.stringify(next.slots.map(s => [s.id,s.asset,s.role,s.anchor]));
    if (layout === fingerprint && !changedScene) return;
    layout = fingerprint;
    visits = window.NightMarketRules.plan(next);
    for (const [id,key] of served) {
      if (!visits.some(v => v.customerId === id && visitKey(v) === key)) served.delete(id);
    }
    show(); schedule(changedScene ? 850 : 400);
  }
  function same(c,s) { return active && active.visit.customerId === c && active.visit.stallId === s; }
  function sale(c,s) {
    if (!same(c,s) || active.sold) return;
    active.sold = true; sales++; served.set(c,active.key); show();
  }
  function done(c,s,completed = true) {
    if (!same(c,s)) return;
    if (state.marketMode && active.sold && completed) {
      discoveries.add(active.visit.chairId ? "stay" : "away");
      try { localStorage.setItem("town.theme.finds." + sceneKey, JSON.stringify([...discoveries])); } catch {}
    }
    active = null; show(); schedule(700);
  }
  function tap(id) {
    if (!enabled) return false;
    const match = visits.find(v => v.customerId === id) || visits.find(v => v.stallId === id);
    if (!match) return false;
    served.delete(match.customerId);
    visits = [match, ...visits.filter(v => v !== match)];
    show(); schedule(220); return true;
  }
  get("market-reopen").onclick = () => { served.clear(); sales = 0; show(); schedule(150); };
  for (const target of [get("canvas"),get("stickers")]) {
    target.addEventListener("pointerdown",() => { holding = true; clearTimeout(timer); },true);
  }
  function release() { if (holding) { holding = false; schedule(450); } }
  window.addEventListener("pointerup",release); window.addEventListener("pointercancel",release); window.addEventListener("blur",release);
  document.addEventListener("visibilitychange",() => { if (document.hidden) clearTimeout(timer); else schedule(); });
  window.TownNightMarket = {sync,sale,done,tap,launch,fromRows,cancelLoad() { ++loading; }};
})();
