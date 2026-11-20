(() => {
  "use strict";
  const get = id => document.getElementById(id);
  const roles = ["stall","table","chair","customer"];
  const kitKey = "town.night-market.last-kit.v1";
  const genId = /^gen-[a-f0-9]{32}$/;
  const served = new Map();
  let state, sceneKey = "", layout = "", visits = [], active = null, sales = 0;
  let timer, holding = false, loading = 0, enabled = false;

  function validate(ids) {
    if (!Array.isArray(ids) || ids.length !== 4 || new Set(ids).size !== 4 || !ids.every(id => typeof id === "string" && genId.test(id))) {
      throw Error("夜市需要各一张独立的摊位、桌子、椅子和客人贴纸。");
    }
  }
  async function enter(ids, theme, ticket) {
    validate(ids);
    if (typeof theme !== "string" || !theme.trim()) theme = "一个热闹的夜市";
    await window.stickerStudio.ensure(ids);
    if (ticket !== loading) return;
    if (typeof window.townGame !== "function") throw Error("贴纸盒还在打开，请稍等一下再进夜市。");
    // The full prompt stays in the atelier. Use a compact display title for the scene.
    const kit = {ids,theme:[...theme.trim()].slice(0,32).join("")};
    window.townGame("marketOpen", JSON.stringify(kit));
    if (!state?.marketMode || state.marketKit?.[0] !== ids[0]) throw Error("这套贴纸没能开市，请重新打开夜市盒。");
    try { localStorage.setItem(kitKey,JSON.stringify(kit)); } catch {}
  }
  function fromRows(rows, theme, ticket = ++loading) {
    if (!Array.isArray(rows)) throw Error("夜市贴纸清单没有读完整。");
    const ids = roles.map(role => rows.find(row => row.role === role)?.id);
    return enter(ids,theme,ticket);
  }
  async function launch(sampleOnly = false) {
    const ticket = ++loading;
    if (!sampleOnly) {
      let last;
      try { last = JSON.parse(localStorage.getItem(kitKey)); } catch {}
      if (last) {
        try { await enter(last.ids,last.theme,ticket); return; }
        catch { if (ticket === loading) window.townUI.notice("上一次的夜市素材暂时不可用，正在打开内置样盒。"); }
      }
    }
    const res = await fetch("/api/stickers/night-market",{mode:"same-origin",redirect:"error"});
    if (!res.ok) throw Error("夜市贴纸还没取到，请用 v0.4 下载包的「开始试玩」打开。");
    const kit = await res.json();
    if (ticket === loading) await fromRows(kit.stickers,kit.theme,ticket);
  }
  function visitKey(visit) {
    return JSON.stringify([visit.stallId, visit.tableId, visit.chairId, visit.actors.map(a => [a.asset,a.x,a.y])]);
  }
  function waiting() { return visits.filter(visit => served.get(visit.customerId) !== visitKey(visit)); }
  function show() {
    get("market-ledger").hidden = !enabled;
    if (!enabled) return;
    get("market-sales").textContent = String(sales);
    get("market-reopen").disabled = !visits.length || !!active || !!waiting().length;
    let text;
    if (active) {
      const name = state.slots.find(s => s.id === active.visit.stallId)?.name || "摊位";
      text = active.sold ? (active.visit.chairId ? "餐点到手，客人要去桌边坐一会儿。" : "客人接过打包好的餐点。")
        : "客人正在走向「" + name + "」。";
    } else if (!state.slots.some(s => s.role === "stall" || s.role === "customer")) text = "先选个位置放摊位，再请一位客人来。";
    else if (!state.slots.some(s => s.role === "customer")) text = "摆一位客人到摊前的石板上。";
    else if (!state.slots.some(s => s.role === "stall")) text = "客人到了，给街边添个摊位吧。";
    else if (!visits.length) text = "客人离摊位太远，挪近一点就能点单。";
    else if (waiting().length) text = "摊位开张了，客人准备出发。";
    else text = "这一轮逛完了。换个摆法，或再招呼一轮客人。";
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
    const key = next.mode === "edit" ? (next.marketMode ? next.marketKit?.[0] : next.levelId) : "";
    const changedScene = key !== sceneKey;
    const interactive = !!key && (next.marketMode || next.slots.some(s => roles.includes(s.role)));
    if (changedScene || enabled !== interactive) {
      clearTimeout(timer); active = null; sales = 0; served.clear(); layout = ""; sceneKey = key;
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
  function done(c,s) {
    if (!same(c,s)) return;
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
