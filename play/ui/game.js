(() => {
  "use strict";

  const get = (id) => document.getElementById(id);
  const canvas = get("canvas");
  const board = get("board");
  const tray = get("stickers");
  const modal = get("dialog");
  const compact = window.matchMedia("(max-width:790px)");
  const levels = ["weekend-town-v1", "afternoon-v1"];
  const assetOrder = ["bakery", "bookshop", "tree", "flower-cart", "fountain", "bench", "cafe-table", "cafe-chair", "lamp", "musician", "florist", "child", "dog", "paving"];
  const gardenOrder = ["black-cat","bench","dog","musician","florist","flower-cart","tree","cafe-table","cafe-chair","bakery","bookshop","lamp","fountain","child","paving"];
  const initialURL = new URL(location.href);
  const requested = initialURL.searchParams.get("box");
  let state = null;
  let page = 0;
  let renderKey = "";
  let drag = null;
  let ignoreClickUntil = 0;
  let toastTimer;
  let stallTimer;
  let keyboardPoint = {x: .5, y: .5};
  let ready = false;
  let giftWork = null;
  let giftReference = "";
  let giftRequest = 0;
  let marketLoading = false;
  let postcardPreview = "";

  function isEditing() { return state?.mode === "edit"; }
  function isGift() { return state?.mode === "gift"; }
  function stickerSource(asset) {
    return /^gen-[a-f0-9]{32}$/.test(asset)
      ? "/api/stickers/" + asset + "/image.png"
      : "media/thumbs/" + encodeURIComponent(asset) + ".webp";
  }

  function action(name, payload = "") {
    if (state && typeof window.townGame === "function") window.townGame(name, payload);
  }

  function showNotice(message) {
    const toast = get("toast");
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2700);
  }

  function updatePreview(levelId) {
    const preview = "media/preview-" + (levelId === levels[1] ? 2 : 1) + ".webp";
    get("reference-thumb").src = preview;
    get("load-layer").style.setProperty("--preview", "url(" + JSON.stringify(new URL(preview, document.baseURI).href) + ")");
    return preview;
  }

  function visibleSlots() {
    if (isEditing()) return [...(state.catalog || [])].sort((a, b) => {
      const priority = (asset) => {
        const kitIndex = state.marketMode ? state.marketKit.indexOf(asset) : -1;
        return kitIndex >= 0 ? kitIndex - 8 : asset.startsWith("gen-") ? -1 : gardenOrder.indexOf(asset);
      };
      return priority(a.asset) - priority(b.asset);
    });
    const placed = new Set(state.placed);
    const rank = (s) => { const n = assetOrder.indexOf(s.asset); return n < 0 ? assetOrder.length : n; };
    return state.slots.filter((s) => !placed.has(s.id)).sort((a, b) => rank(a) - rank(b));
  }

  function makeSticker(slot) {
    const button = document.createElement("button");
    const img = document.createElement("img");
    const label = document.createElement("span");
    button.type = "button";
    button.className = "sticker";
    button.dataset.slot = slot.id;
    button.setAttribute("aria-pressed", String(slot.id === state.selected));
    img.src = stickerSource(slot.asset);
    img.alt = "";
    img.draggable = false;
    label.textContent = slot.name;
    button.append(img, label);
    return button;
  }

  function drawTray(followSelection = false) {
    if (!state) return;
    const slots = visibleSlots();
    const pageSize = compact.matches ? 4 : 6;
    const pageTotal = Math.ceil(slots.length / pageSize);
    if (followSelection) {
      const idx = slots.findIndex((slot) => slot.id === state.selected);
      if (idx >= 0) page = Math.floor(idx / pageSize);
    }
    page = Math.max(0, Math.min(page, pageTotal - 1));
    const shown = slots.slice(page * pageSize, (page + 1) * pageSize);
    const key = JSON.stringify([state.mode, state.levelId, shown.map((s) => [s.id,s.name])]);
    if (key !== renderKey) {
      tray.replaceChildren(...shown.map(makeSticker));
      renderKey = key;
    } else {
      for (const button of tray.children) button.setAttribute("aria-pressed", String(button.dataset.slot === state.selected));
    }
    get("page-count").textContent = slots.length ? (page + 1) + " / " + pageTotal : "";
    get("previous").disabled = page <= 0;
    get("following").disabled = page + 1 >= pageTotal;
    document.querySelector(".tray-nav").hidden = !isEditing() && state.complete;
    get("finished").hidden = isEditing() || !state.complete;
  }

  function sync(json) {
    const data = typeof json === "string" ? JSON.parse(json) : json;
    const last = state;
    const levelChanged = !last || last.levelId !== data.levelId || last.mode !== data.mode || last.title !== data.title ||
      last.marketMode !== data.marketMode || last.marketKit?.[0] !== data.marketKit?.[0];
    state = data;
    if (levelChanged || (last && data.placed.length < last.placed.length)) {
      clearTimeout(toastTimer);
      get("toast").hidden = true;
    }
    const second = data.levelId === levels[1];
    if (levelChanged) {
      page = 0;
      const heading = data.marketMode ? (data.marketTheme === "一个热闹的夜市" ? "灯火夜市" : data.marketTheme) :
        isEditing() ? (second ? "广场午后" : "我的街角") : data.title;
      get("level-title").textContent = heading;
      get("box-number").textContent = data.marketMode ? "夜市造景" : isEditing() ? "自由造景" : isGift() ? "朋友的贴纸盒" : "第 " + (second ? 2 : 1) + " 盒 / 共 2 盒";
      document.title = heading + " · 小镇贴纸簿";
      get("next-level").textContent = isGift() ? "做一盒回礼" : second ? "回到第一盒" : "打开下一盒";
      document.body.dataset.mode = data.mode || "puzzle";
      document.body.classList.toggle("night-market",!!data.marketMode);
      updatePreview(data.levelId);
      if (isGift() && giftReference) get("reference-thumb").src = giftReference;
      if (last && !isGift()) {
        const url = new URL(location.href);
        url.searchParams.set("box", data.levelId);
        url.hash = "";
        if (isEditing()) url.searchParams.set("edit", "1");
        else url.searchParams.delete("edit");
        if (!isEditing()) url.searchParams.delete("garden");
        if (data.marketMode) {
          url.searchParams.set("market","1");
          for (const param of ["edit","garden","box"]) url.searchParams.delete(param);
        } else url.searchParams.delete("market");
        history.replaceState(null, "", url);
      }
      keyboardPoint = {x: .5, y: .5};
    }
    const placed = data.placed.length;
    const edit = isEditing();
    get("mode-puzzle").disabled = false;
    get("mode-edit").disabled = false;
    get("market-enter").disabled = marketLoading;
    get("market-enter").setAttribute("aria-pressed", String(!!data.marketMode));
    get("mode-puzzle").setAttribute("aria-pressed", String(!edit));
    get("mode-edit").setAttribute("aria-pressed", String(edit && !data.marketMode));
    get("cat-invite").disabled = false;
    get("cat-invite").hidden = edit || isGift();
    get("studio-actions").hidden = !edit;
    get("reference-button").hidden = edit;
    get("share-button").hidden = edit;
    get("remove").hidden = !edit;
    get("remove").disabled = !data.placed.includes(data.selected);
    get("reset").hidden = edit && !data.marketMode;
    get("reset").querySelector("span").textContent = data.marketMode ? "收起全部" : "重拼";
    get("base").value = data.levelId;
    get("base").parentElement.hidden = !!data.marketMode;
    get("wrap").disabled = !data.canPack;
    get("postcard").disabled = !data.canPostcard;
    get("finish-save").disabled = !(data.canPostcard ?? data.complete);
    get("tray-label").textContent = edit ? "可用贴纸" : "待贴的贴纸";
    document.querySelector(".counter").classList.toggle("edit-count", edit);
    get("count-label").textContent = edit ? (placed >= 15 ? "件 · 街角已摆满" : "件已摆放") : "已贴";
    get("placed-count").textContent = placed;
    get("total-count").textContent = edit ? 15 : data.total;
    const progress = get("progress");
    progress.hidden = edit;
    progress.setAttribute("aria-valuemax", data.total);
    progress.setAttribute("aria-valuenow", placed);
    progress.firstElementChild.style.width = (data.total ? placed / data.total * 100 : 0) + "%";
    get("undo").disabled = !data.canUndo;
    get("reset").disabled = !placed;
    get("zoom-out").disabled = data.zoom <= 1.001;
    get("zoom-in").disabled = data.zoom >= 2.499;
    get("zoom-value").textContent = Math.round(data.zoom * 100) + "%";
    const sound = get("sound");
    sound.disabled = false;
    sound.title = data.muted ? "开启音效" : "关闭音效";
    sound.setAttribute("aria-label", sound.title);
    sound.querySelector("use").setAttribute("href", data.muted ? "#i-mute" : "#i-volume");
    const selected = data.slots.find((s) => s.id === data.selected) || data.catalog?.find((s) => s.id === data.selected);
    const catTip = data.selected === "kit:black-cat" && data.slots.some(slot => slot.asset === "bench") && !data.slots.some(slot => slot.asset === "black-cat");
    get("instruction").textContent = edit ? (catTip ? "点一下长椅旁的石板，把小黑猫放下来。" : selected ? (data.placed.includes(data.selected) ? "点一下「" + selected.name + "」，或拖动它换个位置。" : "点击画布，放下「" + selected.name + "」。") : "挑张贴纸放进街角，看看谁会凑到一起。") :
      data.complete ? "全部贴好了。保存这张明信片，或送出一盒自己的小镇。" :
      selected ? "选中了「" + selected.name + "」，拖到轮廓上或点一下对应位置。" : "从贴纸盘选一张，贴到场景中对应的位置。";
    if (data.marketMode) get("instruction").textContent = selected
      ? (data.placed.includes(data.selected) ? "拖动「" + selected.name + "」调整夜市的摆法。" : "点夜市的空地，放下「" + selected.name + "」。")
      : "把客人、摊位和桌椅分别摆好，看看客人往哪儿走。";
    get("finish-title").textContent = isGift() ? "礼物拼好了" : "这一盒贴好了";
    get("finish-copy").textContent = isGift() ? "把朋友为你布置的小镇，收进一张明信片。" : "把刚拼好的小镇收成一张明信片吧。";
    const saved = get("save-status");
    saved.hidden = !edit && !placed && data.saved;
    saved.querySelector("span").textContent = data.saved ? (edit ? "草稿保存在本机" : "进度已保存在本机") : "此浏览器暂时无法保存进度";
    drawTray(levelChanged || (last && last.selected !== data.selected));
    window.TownGarden.sync(data);
    window.TownNightMarket.sync(data);
    if (!edit && last && !levelChanged && placed > last.placed.length) {
      const piece = data.slots.find((s) => s.id === data.placed[placed - 1]);
      showNotice(data.complete ? "这一盒的贴纸全部就位！" : (piece?.name || "贴纸") + "已贴好");
    }
  }

  window.townUI = {
    ready(json) {
      sync(json);
      ready = true;
      clearTimeout(stallTimer);
      get("load-layer").hidden = true;
      if (/^#gift(?:=|$)/.test(initialURL.hash)) openGift(initialURL.hash);
      else if (initialURL.searchParams.has("market")) enterMarket(initialURL.searchParams.get("market") === "sample");
      else if (initialURL.searchParams.get("garden") === "1" || (!requested && !initialURL.searchParams.has("edit"))) action("mode", "garden");
      else if (initialURL.searchParams.get("edit") === "1") action("mode", "edit");
      else if (requested && !levels.includes(requested)) showNotice("没有找到这盒贴纸，已打开周末小镇。");
    },
    sync,
    actorTap(id) { if (!window.TownNightMarket.tap(id)) window.TownGarden.tap(id); },
    openMarket(rows, theme) { return window.TownNightMarket.fromRows(rows,theme); },
    marketSale(customer,stall) { window.TownNightMarket.sale(customer,stall); },
    marketDone(customer,stall) { window.TownNightMarket.done(customer,stall); },
    notice: showNotice,
    giftReady(json) { shareWork(JSON.parse(json)); },
    postcardReady(json) { savePostcard(JSON.parse(json)); },
    missingAssets(json) {
      const ids = typeof json === "string" ? JSON.parse(json) : json;
      ensureCustom(ids).catch(() => showNotice("草稿里的定制贴纸暂时未能载入，请刷新重试。"));
    },
  };

  function refreshCanvasSize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }
  new ResizeObserver(refreshCanvasSize).observe(board);
  window.addEventListener("resize", refreshCanvasSize);
  compact.addEventListener("change", () => drawTray(true));
  get("previous").onclick = () => { page--; drawTray(); };
  get("following").onclick = () => { page++; drawTray(); };
  get("undo").onclick = () => action("undo");
  get("zoom-in").onclick = () => action("zoomIn");
  get("zoom-out").onclick = () => action("zoomOut");
  get("sound").onclick = () => action("mute");
  async function enterMarket(sampleOnly = false) {
    if (marketLoading || state?.marketMode) return;
    marketLoading = true;
    const button = get("market-enter"); button.disabled = true; button.setAttribute("aria-busy","true");
    showNotice("正在打开夜市贴纸盒…");
    try {
      await window.TownNightMarket.launch(sampleOnly);
      if (state?.marketMode) get("toast").hidden = true;
    } catch (err) { showError("夜市暂未打开",err); }
    finally { marketLoading = false; button.disabled = false; button.removeAttribute("aria-busy"); }
  }
  get("market-enter").onclick = () => enterMarket();
  get("mode-puzzle").onclick = () => { window.TownNightMarket.cancelLoad(); if (isEditing() || isGift()) action("mode", "puzzle"); };
  get("mode-edit").onclick = () => { window.TownNightMarket.cancelLoad(); if (!isEditing() || state.marketMode) action("mode", "garden"); };
  get("cat-invite").onclick = () => { action("mode", "garden"); action("select", "kit:black-cat"); };
  get("journal-button").onclick = () => window.TownGarden.open(openDialog, () => modal.close());
  get("remove").onclick = () => action("remove", state.selected);
  get("base").onchange = (e) => action("base", e.target.value);
  get("postcard").onclick = get("finish-save").onclick = () => action("postcard");
  get("wrap").onclick = nameGift;
  get("next-level").onclick = () => isGift() ? action("mode", "edit") :
    action("level", state.levelId === levels[0] ? levels[1] : levels[0]);
  get("custom-button").onclick = () => {
    if (window.stickerStudio?.open) window.stickerStudio.open();
    else showNotice("定制工具未能加载，请刷新页面重试。");
  };

  function dialogButton(text, callback, primary = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = primary ? "action" : "plain";
    button.textContent = text;
    button.onclick = callback;
    return button;
  }
  function paragraph(text) {
    const p = document.createElement("p");
    p.textContent = text;
    return p;
  }
  function openDialog(title, content, buttons = [], className = "") {
    get("dialog-title").textContent = title;
    get("dialog-body").replaceChildren(...content);
    get("dialog-actions").replaceChildren(...buttons);
    modal.className = className;
    if (!modal.open) modal.showModal();
  }
  function confirmReset() {
    if (state?.marketMode) {
      openDialog("从空场摆夜市？", [paragraph("场上的 " + state.placed.length + " 件贴纸会一起收起。可以点「撤销」恢复原来的摆法。")], [
        dialogButton("继续逛", () => modal.close()), dialogButton("收起全部", () => {
          modal.close(); action("reset"); action("select","kit:" + state.marketKit[0]);
        }, true),
      ]);
      return;
    }
    openDialog("重新拼这一盒？", [paragraph("这盒已贴好的贴纸会回到贴纸盘。")], [
      dialogButton("继续拼", () => modal.close()),
      dialogButton("重新开始", () => { modal.close(); action("reset"); }, true),
    ]);
  }
  get("reset").onclick = confirmReset;
  get("finish-replay").onclick = confirmReset;
  get("close-dialog").onclick = () => modal.close();
  modal.addEventListener("close", () => {
    if (postcardPreview) { URL.revokeObjectURL(postcardPreview); postcardPreview = ""; }
  });
  modal.addEventListener("click", (e) => {
    if (e.target !== modal) return;
    const b = modal.getBoundingClientRect();
    if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) modal.close();
  });
  get("help-button").onclick = () => {
    const steps = document.createElement("ol");
    const tips = state?.marketMode ? ["把摊位、桌、凳和客人分别摆在石板上。同一种贴纸可以取好几张。","客人会走到附近最近的摊位，下单后接过餐点。摊边有成套的桌椅就去落座，桌椅挪远后会把餐点带走。","轻点客人可以再招呼他一次。「再逛一轮」会请附近的客人依次出发。"] :
      isEditing() ? ["选一张贴纸，再点街景把它放下来。每件都能挪走，也可以放好几件一样的。", "把角色和物件摆近一点。遇见过的小事会记进「街角手记」；轻点凑在一起的角色还能再看一次。", "喜欢现在的摆法，就存一张明信片，或把这片街景封成礼物让朋友重拼。"] :
      ["从贴纸盘挑一张。带角标的轮廓就是它的位置。", "把贴纸拖进去，或先选贴纸再点对应位置。", "用双指或加减按钮放大；放大后可以拖动画布。"];
    for (const text of tips) {
      const li = document.createElement("li"); li.textContent = text; steps.append(li);
    }
    const actions = [];
    if (!isEditing()) {
      const letter = document.createElement("a");
      letter.className = "plain";
      letter.href = "/weekend-letter.html";
      letter.target = "_blank";
      letter.rel = "noopener";
      letter.textContent = "拆开黑猫的来信";
      letter.setAttribute("aria-label", "拆开黑猫的来信（在新标签页打开）");
      actions.push(letter);
    }
    actions.push(dialogButton("知道了", () => modal.close(), true));
    openDialog(state?.marketMode ? "夜市怎样开张" : isEditing() ? "怎样逛街角" : "怎样贴贴纸", [steps, paragraph("键盘也能玩。用 Tab 选中贴纸，按回车进入画布，方向键移动落点，Shift 加大步幅，回车放置。")],
      actions);
  };
  get("reference-button").onclick = () => {
    const img = document.createElement("img");
    img.alt = (state?.title || "周末小镇") + "完成后的场景";
    img.src = get("reference-thumb").src;
    openDialog("成品参考", [img], [], "reference-dialog");
  };

  function nameGift() {
    const label = document.createElement("label");
    label.className = "field-label";
    label.htmlFor = "gift-name";
    label.textContent = "礼物名字";
    const field = document.createElement("input");
    field.id = "gift-name";
    field.maxLength = 24;
    field.value = state.work?.title || "送你一座小镇";
    const send = () => action("pack", field.value.trim() || "送你一座小镇");
    field.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); send(); } });
    openDialog("封装成礼物", [label, field, paragraph("收件人会拿到你挑好的贴纸，照着你的摆法重新拼一遍。")],
      [dialogButton("再改改", () => modal.close()), dialogButton("封装", send, true)]);
    field.focus(); field.select();
  }

  function shareWork(work) {
    try {
      const url = new URL(window.TownGift.link(work), location.href);
      showDelivery(url, work);
    } catch (error) { showError("礼物未能封装", error); }
  }

  function showError(title, error) {
    openDialog(title, [paragraph(error?.message || "请关闭后重新试一次。")], [dialogButton("知道了", () => modal.close(), true)]);
  }

  function showDelivery(url, work = null) {
    const field = document.createElement("input");
    field.value = url.href;
    field.readOnly = true;
    field.setAttribute("aria-label", "贴纸盒链接");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const tip = paragraph(local ? "这是本机试玩地址，可在这台电脑上重开这一盒。" : "朋友打开链接后，可以在自己的设备上拼这一盒。");
    const copy = dialogButton("复制链接", async () => {
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url.href);
        else { field.select(); if (!document.execCommand("copy")) throw new Error(); }
        tip.textContent = local ? "本机试玩链接已复制。" : "链接已复制，可以发给朋友了。";
        copy.textContent = "已复制";
      } catch {
        field.focus(); field.select();
        tip.textContent = "已选中链接，请用系统的复制操作。";
      }
    }, !work);
    tip.setAttribute("aria-live", "polite");
    if (!work) { openDialog("分享这盒贴纸", [tip, field], [copy]); return; }
    const filename = paragraph("把礼物文件发给朋友，对方打开 HTML 就能离线重拼。");
    const download = dialogButton("下载可玩的礼物", async () => {
      download.disabled = true;
      download.textContent = "正在打包…";
      try {
        await window.townParcel.download(work);
        filename.textContent = "礼物已下载。把 HTML 文件发给朋友，对方用浏览器打开就能离线重拼。";
      } catch (error) {
        filename.textContent = error?.message || "礼物文件未能生成，请再试一次。";
      } finally { download.disabled = false; download.textContent = "下载可玩的礼物"; }
    }, true);
    const preview = document.createElement("a");
    preview.href = url.href; preview.target = "_blank"; preview.rel = "noopener";
    preview.className = "plain"; preview.textContent = "试拼礼物";
    const meta = document.createElement("div");
    meta.className = "delivery-note";
    const giftName = document.createElement("strong"); giftName.textContent = work.title;
    const quantity = document.createElement("span"); quantity.textContent = work.items.length + " 件贴纸";
    meta.append(giftName, quantity);
    openDialog("礼物封好了", [meta, filename, download, tip, field], [preview, copy], "delivery-dialog");
  }
  get("share-button").onclick = () => {
    if (isGift() && giftWork) { shareWork(giftWork); return; }
    const url = new URL(location.href); url.search = ""; url.hash = "";
    url.searchParams.set("box", state?.levelId || (requested === levels[1] ? levels[1] : levels[0]));
    showDelivery(url);
  };

  async function savePostcard(work) {
    try {
      const blob = await window.TownGift.postcard(work);
      window.TownGift.save(blob, work.title);
      if (postcardPreview) URL.revokeObjectURL(postcardPreview);
      postcardPreview = URL.createObjectURL(blob);
      const img = document.createElement("img");
      img.src = postcardPreview; img.alt = work.title + "的明信片";
      openDialog("明信片已生成", [img, paragraph("可查看浏览器下载记录，手机也可以长按图片保存。")],
        [dialogButton("再下载一份", () => window.TownGift.save(blob, work.title)), dialogButton("收好", () => modal.close(), true)], "reference-dialog");
    } catch (error) { showError("明信片未能保存", error); }
  }

  function ensureCustom(ids) {
    if (!ids.length) return Promise.resolve();
    if (!window.stickerStudio?.ensure) return Promise.reject(new Error("定制贴纸没有载入，请检查资源后重新打开礼物。"));
    return window.stickerStudio.ensure(ids);
  }
  async function openGift(hash) {
    const token = ++giftRequest;
    if (!/^#gift(?:=|$)/.test(hash)) return;
    get("load-message").textContent = "正在打开送给你的贴纸盒…";
    get("load-layer").hidden = false;
    try {
      const raw = window.TownGift.decode(hash);
      const {work} = await window.TownGift.resolve(raw);
      await ensureCustom([...new Set(work.items.map((item) => item.asset).filter((id) => id.startsWith("gen-")))]);
      if (token !== giftRequest) return;
      const image = await window.TownGift.postcard(work);
      if (token !== giftRequest) return;
      if (giftReference) URL.revokeObjectURL(giftReference);
      giftReference = URL.createObjectURL(image);
      giftWork = work;
      action("gift", JSON.stringify(work));
      if (!isGift()) throw new Error("礼物数据未被游戏接受。");
      get("reference-thumb").src = giftReference;
      const seal = document.createElement("div");
      seal.className = "gift-seal";
      const title = document.createElement("strong"); title.textContent = work.title;
      const rest = document.createElement("span"); rest.textContent = work.items.length + " 件贴纸";
      seal.append(title, rest);
      openDialog("收到一盒小镇", [seal, paragraph(state.complete ? "这盒礼物已经拼好了，还可以再拼一次。" : "贴纸的位置由送礼人亲手摆好，打开就能开始拼。")],
        [dialogButton(state.complete ? "看看小镇" : "拆开礼物", () => modal.close(), true)], "gift-dialog");
    } catch (error) {
      if (token !== giftRequest) return;
      action("mode", "puzzle");
      if (location.hash) { const url = new URL(location.href); url.hash = ""; history.replaceState(null, "", url); }
      openDialog("这盒礼物暂时打不开", [paragraph(error?.message || "链接可能不完整，请让送礼人再发一次。")],
        [dialogButton("回到小镇", () => modal.close(), true)]);
    } finally { if (token === giftRequest) get("load-layer").hidden = true; }
  }
  window.addEventListener("hashchange", () => {
    if (!ready) return;
    if (/^#gift(?:=|$)/.test(location.hash)) openGift(location.hash);
    else if (isGift()) action("mode", "puzzle");
  });

  function finishDrag() {
    drag?.ghost?.remove();
    drag = null;
  }
  tray.addEventListener("pointerdown", (e) => {
    const button = e.target.closest(".sticker");
    if (!button || e.button !== 0 || !e.isPrimary) return;
    ignoreClickUntil = 0;
    drag = {pointer: e.pointerId, id: button.dataset.slot, img: button.querySelector("img").src, x: e.clientX, y: e.clientY, ghost: null};
    button.setPointerCapture(e.pointerId);
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag || drag.pointer !== e.pointerId) return;
    if (!drag.ghost) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.ghost = document.createElement("img");
      drag.ghost.src = drag.img; drag.ghost.alt = ""; drag.ghost.className = "drag-ghost";
      document.body.append(drag.ghost);
      action("select", drag.id);
    }
    drag.ghost.style.left = e.clientX + "px";
    drag.ghost.style.top = e.clientY + "px";
  });
  window.addEventListener("pointerup", (e) => {
    if (!drag || drag.pointer !== e.pointerId) return;
    if (drag.ghost) {
      ignoreClickUntil = performance.now() + 400;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) action("drop", JSON.stringify({id: drag.id, x, y}));
    }
    finishDrag();
  });
  window.addEventListener("pointercancel", (e) => { if (e.pointerId === drag?.pointer) finishDrag(); });
  window.addEventListener("blur", finishDrag);
  tray.addEventListener("click", (e) => {
    const button = e.target.closest(".sticker");
    if (!button || (e.detail && performance.now() < ignoreClickUntil)) return;
    action("select", button.dataset.slot);
    if (e.detail === 0) { canvas.focus(); showKeyboardPoint(); }
  });
  function showKeyboardPoint() {
    const marker = get("keyboard-marker");
    marker.hidden = false;
    marker.style.left = (100 * keyboardPoint.x) + "%";
    marker.style.top = (100 * keyboardPoint.y) + "%";
  }
  canvas.addEventListener("keydown", (e) => {
    if (!state?.selected) return;
    const delta = e.shiftKey ? .12 : .027;
    const moves = {ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta]};
    const shift = moves[e.key];
    if (shift) {
      keyboardPoint.x = Math.max(0, Math.min(1, keyboardPoint.x + shift[0]));
      keyboardPoint.y = Math.max(0, Math.min(1, keyboardPoint.y + shift[1]));
    } else if (e.key === "Enter" || e.key === " ") {
      action("drop", JSON.stringify({id: state.selected, ...keyboardPoint}));
    } else return;
    e.preventDefault(); e.stopImmediatePropagation();
    showKeyboardPoint();
  }, true);
  canvas.addEventListener("blur", () => { get("keyboard-marker").hidden = true; });
  canvas.addEventListener("pointerdown", () => { get("keyboard-marker").hidden = true; });

  function failed(message) {
    clearTimeout(stallTimer);
    const layer = get("load-layer");
    layer.hidden = false; layer.classList.add("failed");
    get("load-message").textContent = message;
    get("retry").hidden = false;
  }
  function watchLoading() {
    clearTimeout(stallTimer);
    if (!ready) stallTimer = setTimeout(() => failed("打开贴纸盒超时了。请检查网络后重试。"), 90000);
  }
  async function start() {
    if (typeof Engine !== "function") { failed("游戏引擎未能加载。请检查网络后重试。"); return; }
    if (typeof Engine.isWebGLAvailable === "function" && !Engine.isWebGLAvailable(2)) {
      failed("这个浏览器未开启 WebGL 2。请开启硬件加速，或换个浏览器再打开。");
      return;
    }
    const config = {
      executable: "town", canvas, canvasResizePolicy: 0, focusCanvas: false,
      onProgress(current, total) {
        if (ready) return;
        watchLoading();
        if (total > 0) get("load-message").textContent = "正在打开贴纸盒… " + Math.floor(100 * current / total) + "%";
      },
      onExit: () => failed("游戏已结束运行，可以重新打开这一盒。"),
    };
    refreshCanvasSize();
    try { await new Engine(config).startGame(); }
    catch (error) { console.error(error); failed("贴纸盒没有加载完整。请检查网络后重试。"); }
  }
  updatePreview(requested);
  get("retry").onclick = () => location.reload();
  const loader = document.createElement("script");
  loader.src = "town.js";
  loader.onload = start;
  loader.onerror = () => failed("游戏引擎未能加载。请检查网络后重试。");
  watchLoading();
  document.head.append(loader);
})();
