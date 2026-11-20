(() => {
  "use strict";
  const idPattern = /^gen-[0-9a-f]{32}$/;
  const registered = new Map();
  const inks = { "松绿": "#304a36", "砖红": "#994630", "栗棕": "#573823" };
  const roles = [["place","小屋"],["furniture","家具"],["resident","居民"]];
  const marketRoles = [["stall","摊位"],["table","摊桌"],["chair","餐椅"],["customer","食客"]];
  const knownRoles = new Set([...roles, ...marketRoles].map(([role]) => role));
  const sampleTheme = "一个热闹的夜市";
  const isSample = text => /^(?:一个)?热闹的夜市$/u.test(text.trim());
  const editions = new Map();
  let dialog;
  let serviceReady = false;
  let canGenerate = false;
  let paper;
  let busy = false;
  let ink = Object.values(inks)[0];
  const el = id => dialog.querySelector("#" + id);

  async function json(url, payload) {
    const options = {mode:"same-origin", redirect:"error", cache:"no-store"};
    if (payload) Object.assign(options, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload)});
    const res = await fetch(url, options);
    if (!res.headers.get("Content-Type")?.startsWith("application/json")) throw Error("请用「开始试玩」打开带有贴纸工坊的本机版本。");
    const data = await res.json();
    if (!res.ok) throw Error(data.error || "这张贴纸暂时无法读取。");
    return data;
  }

  function checkAsset(row, id) {
    if (!row || !idPattern.test(id) || row.id !== id || row.image !== "/api/stickers/" + id + "/image.png" ||
        typeof row.name !== "string" || !Array.isArray(row.size) || row.size.length !== 2 ||
        (row.role != null && !knownRoles.has(row.role)) ||
        !row.size.every((n,i) => Number.isFinite(n) && n >= 1 && n <= [864,900][i])) throw Error("定制贴纸资料不完整。");
    return row;
  }

  function dataURI(blob) {
    return new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(Error("无法读取贴纸图像。"));
      reader.readAsDataURL(blob);
    });
  }

  async function register(id) {
    const row = checkAsset(await json("/api/stickers/" + id), id);
    const res = await fetch(row.image, {mode:"same-origin",redirect:"error"});
    if (!res.ok || res.headers.get("Content-Type")?.split(";")[0] !== "image/png") throw Error("定制贴纸原图暂时打不开。");
    const blob = await res.blob();
    if (!blob.size || blob.size > 5500000) throw Error("定制贴纸尺寸超出范围。");
    if (typeof window.townGame !== "function") throw Error("贴纸盒还在打开，请稍等片刻再试。");
    window.townGame("registerAsset",JSON.stringify({id,name:row.name,size:row.size,role:row.role || "",data:await dataURI(blob)}));
    return row;
  }

  function ensure(ids) {
    return Promise.all([...new Set(typeof ids === "string" ? [ids] : ids)].map(id => {
      if (!idPattern.test(id)) throw Error("无法识别这张定制贴纸。");
      if (!registered.has(id)) registered.set(id,register(id).catch(error => { registered.delete(id); throw error; }));
      return registered.get(id);
    }));
  }

  function select(id) {
    if (typeof window.townGame !== "function") throw Error("贴纸盒还在打开，请稍等片刻再试。");
    window.townGame("mode", "edit");
    window.townGame("select", "kit:" + id);
    dialog.close();
    document.getElementById("canvas").focus({preventScroll:true});
  }

  function refresh() {
    el("street-create").disabled = busy || !serviceReady || !paper || !el("street-name").value.trim();
    const prompt = el("paint-prompt").value.trim();
    const sample = el("paint-kind").value === "market" && isSample(prompt);
    el("paint-create").disabled = busy || !serviceReady || !prompt || !(canGenerate || sample);
    el("paint-redraw").hidden = !canGenerate || !sample;
    el("paint-redraw").disabled = busy;
    el("paint-sample").disabled = busy;
    el("paint-kind").disabled = busy;
    el("paint-prompt").disabled = busy;
    el("studio-status").setAttribute("aria-busy", String(busy));
  }

  function paintOptions() {
    const kind = el("paint-kind").value;
    const sample = kind === "market" && isSample(el("paint-prompt").value);
    el("paint-label").textContent = kind === "one" ? "画一件你想摆进小镇的东西" : "这一盒是什么主题";
    el("paint-prompt").placeholder = kind === "market" ? "例如：一个热闹的夜市" : kind === "theme" ? "例如：下过雨的海边书市" : "例如：带小铜铃的薄荷绿冰淇淋车";
    const info = el("paint-info");
    if (sample) {
      el("paint-create").textContent = "用预制四件开夜市";
      info.textContent = "样盒里已经备好摊位、桌、椅和食客，可离线开市，消耗 0 点。"
        + (canGenerate ? "也可以用账户额度重新绘制这套主题，最多 4 次生图和 4 次去背景。" : "");
    } else if (kind === "market") {
      el("paint-create").textContent = "绘制 4 件并开市";
      info.textContent = canGenerate ? "摊位、摊桌、餐椅、食客分别绘制，同一主题已完成的件可复用。新做四件最多 4 次生图和 4 次去背景，使用 Recraft 账户额度。"
        : "自选集市主题需要连接 Recraft。也可以试试小镇备好的免费夜市样盒。";
    } else {
      el("paint-create").textContent = kind === "theme" ? "分开生成 3 张贴纸" : "生成 1 张透明贴纸";
      info.textContent = canGenerate
        ? "描述会发给 Recraft。" + (kind === "theme" ? "小屋、家具和居民各绘制并去背景一次，使用 3 件的额度。已完成的可以接着用。" : "绘图和去背景各一次，使用已配置账户的额度。")
        : "本机尚未连接绘图服务。可以打开免费夜市样盒，或从下方街角样盒取一件贴纸。";
    }
    refresh();
  }

  async function enterMarket(rows, theme) {
    if (!Array.isArray(rows) || rows.length !== 4) throw Error("四件集市贴纸尚未齐全。");
    const ordered = marketRoles.map(([role]) => {
      const row = rows.find(item => item?.role === role);
      return checkAsset(row, row?.id);
    });
    if (new Set(ordered.map(row => row.id)).size !== 4) throw Error("集市需要四张各自独立的贴纸。");
    if (typeof window.townUI?.openMarket !== "function") throw Error("集市画布还在准备，请稍后再试。");
    await ensure(ordered.map(row => row.id));
    const opened = await window.townUI.openMarket(ordered, theme);
    if (opened === false) throw Error("暂时无法开市，原来的草稿已保留。");
    if (dialog?.open) dialog.close();
    return ordered;
  }

  async function openNightMarket() {
    const pack = await json("/api/stickers/night-market");
    return enterMarket(pack.stickers, pack.theme || sampleTheme);
  }

  function redrawEdition(theme) {
    const key = "town.market.redraw." + theme;
    let value = editions.get(key);
    try { value ||= sessionStorage.getItem(key); } catch {}
    if (!/^[0-9a-f]{32}$/.test(value || "")) {
      value = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
    }
    editions.set(key,value);
    try { sessionStorage.setItem(key,value); } catch {}
    return {value, finish() { editions.delete(key); try { sessionStorage.removeItem(key); } catch {} }};
  }

  async function paint(redraw = false) {
    const theme = el("paint-prompt").value.trim();
    const kind = el("paint-kind").value;
    if (kind === "market" && isSample(theme) && !redraw) return openNightMarket();
    if (!canGenerate) throw Error("当前未连接绘图账户，请选择免费样盒。");
    if (kind === "one") return create("/api/stickers/generate", {prompt:theme});
    const collectionRoles = kind === "market" ? marketRoles : roles;
    const edition = redraw ? redrawEdition(theme) : null;
    const rows = [];
    for (const [role,label] of collectionRoles) {
      el("studio-status").textContent = "正在制作" + label + "，已完成 " + rows.length + " / " + collectionRoles.length + "。";
      try {
        const input = {theme,role};
        if (edition) input.edition = edition.value;
        const row = await json("/api/stickers/generate",input);
        checkAsset(row,row.id);
        await ensure([row.id]);
        rows.push(row);
      } catch (err) {
        throw Error("已取到 " + rows.length + " / " + collectionRoles.length + " 张。" + err.message + " 用相同主题再次制作可接着完成。");
      }
    }
    if (kind === "market") {
      await enterMarket(rows, theme);
      edition?.finish();
    } else if (dialog.open) {
      select(rows[0].id);
      window.townUI?.notice?.("三张贴纸齐了。先为小屋选个位置吧。");
    }
  }

  function draw() {
    const canvas = el("street-preview");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if (paper) {
      ctx.drawImage(paper,0,0,640,196);
      ctx.fillStyle = ink;
      const label = el("street-name").value.trim();
      ctx.font = 'bold 62px "Noto Serif SC","Songti SC","SimSun",serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label,320,66,520);
    }
    refresh();
  }

  function showPanel(name) {
    for (const button of dialog.querySelectorAll(".atelier-tabs button")) {
      const active = button.dataset.panel === name;
      button.setAttribute("aria-pressed",String(active));
      el(button.dataset.panel).hidden = !active;
    }
    if (!busy) el("studio-status").textContent = "";
    if (name === "library-panel" && serviceReady) {
      json("/api/stickers").then(data => collection(data.stickers)).catch(error => { el("studio-status").textContent = error.message; });
    }
  }

  async function task(message, fn) {
    if (busy) return;
    busy = true; refresh();
    el("studio-status").textContent = message;
    try { await fn(); }
    catch (err) { el("studio-status").textContent = err.message || "制作中断，可以再试一次。"; }
    finally { busy = false; refresh(); }
  }

  async function create(url, payload) {
    const row = await json(url, payload);
    checkAsset(row,row.id);
    await ensure([row.id]);
    if (dialog.open) select(row.id);
  }

  function collection(rows) {
    const list = el("atelier-collection");
    list.replaceChildren();
    for (const row of rows) {
      if (!idPattern.test(row?.id)) continue;
      const button = document.createElement("button");
      const thumb = document.createElement("img"), label = document.createElement("span");
      thumb.src = "/api/stickers/" + row.id + "/image.png";
      thumb.alt = ""; thumb.loading = "lazy"; label.textContent = row.name;
      button.append(thumb,label);
      button.onclick = () => task("正在取出贴纸…", async () => { await ensure([row.id]); if (dialog.open) select(row.id); });
      list.append(button);
    }
    el("atelier-empty").hidden = !!list.childElementCount;
  }

  function build() {
    dialog = document.createElement("dialog");
    dialog.id = "sticker-studio";
    dialog.setAttribute("aria-labelledby","atelier-heading");
    dialog.innerHTML = [
      '<div class="dialog-top"><h2 id="atelier-heading">定制贴纸</h2><button class="icon-button" id="atelier-close" aria-label="关闭定制贴纸"><svg aria-hidden="true"><use href="#i-close"/></svg></button></div>',
      '<div class="atelier-tabs" role="group" aria-label="制作方式"><button data-panel="street-panel" aria-pressed="true">写路牌</button><button data-panel="paint-panel" aria-pressed="false">AI 画贴纸</button><button data-panel="library-panel" aria-pressed="false">我的贴纸</button></div>',
      '<section id="street-panel"><div class="atelier-paper"><canvas id="street-preview" width="640" height="196" aria-label="手绘木路牌预览"></canvas></div>',
      '<label for="street-name">路牌上写什么</label><input id="street-name" maxlength="12" value="等你来" autocomplete="off">',
      '<fieldset id="street-colors"><legend>墨色</legend></fieldset><button class="action atelier-main" id="street-create">做成贴纸</button></section>',
      '<section id="paint-panel" hidden><div class="atelier-kind"><label for="paint-kind">制作规格</label><select id="paint-kind"><option value="theme">场景三件套</option><option value="market">互动集市 · 四件</option><option value="one">单件贴纸</option></select></div><label id="paint-label" for="paint-prompt">这一盒是什么主题</label><textarea id="paint-prompt" maxlength="240" rows="2" placeholder="例如：下过雨的海边书市"></textarea><p id="paint-info"></p><button id="paint-create" class="action atelier-main">分开生成 3 张贴纸</button><button id="paint-redraw" class="secondary" hidden>按主题重新绘制 4 件</button><button id="paint-sample" class="plain">试试「一个热闹的夜市」</button>',
      '<div class="atelier-samples"><h3>现成样盒 · 周末的街角</h3><div id="sample-pieces"></div></div></section>',
      '<section id="library-panel" hidden><p id="atelier-empty">第一张贴纸做好后，就会收藏在这里。</p><div id="atelier-collection"></div></section>',
      '<p id="studio-status" role="status" aria-live="polite"></p>'
    ].join("");
    document.body.append(dialog);
    for (const [name,color] of Object.entries(inks)) {
      const b = document.createElement("button");
      b.textContent = name; b.style.setProperty("--swatch",color); b.setAttribute("aria-pressed",String(color === ink));
      b.onclick = () => { ink = color; for(const v of el("street-colors").querySelectorAll("button")) v.setAttribute("aria-pressed",String(v===b)); draw(); };
      el("street-colors").append(b);
    }
    el("atelier-close").onclick = () => dialog.close();
    for(const b of dialog.querySelectorAll(".atelier-tabs button")) b.onclick = () => showPanel(b.dataset.panel);
    el("street-name").oninput = draw;
    el("paint-prompt").oninput = () => {
      if (el("paint-kind").value === "theme" && /夜市|night\s+market/i.test(el("paint-prompt").value)) {
        el("paint-kind").value = "market";
      }
      paintOptions();
    };
    el("paint-kind").onchange = () => {
      if (el("paint-kind").value === "market" && !el("paint-prompt").value.trim()) el("paint-prompt").value = sampleTheme;
      paintOptions();
    };
    el("paint-sample").onclick = () => {
      el("paint-kind").value = "market";
      el("paint-prompt").value = sampleTheme;
      paintOptions();
      el("paint-create").focus();
    };
    el("street-create").onclick = () => task("正在裁好路牌…", () => {
      draw();
      return create("/api/stickers",{kind:"sign",name:el("street-name").value.trim(),data:el("street-preview").toDataURL("image/png")});
    });
    el("paint-create").onclick = () => task("正在准备这盒贴纸…",() => paint());
    el("paint-redraw").onclick = () => task("正在按主题绘制新的集市贴纸…",() => paint(true));
    for (const [id,name] of [["bookshop","街角书店"],["bench","木长椅"],["black-cat","钥匙黑猫"]]) {
      const b = document.createElement("button"), img = document.createElement("img"), label = document.createElement("span");
      if (id === "black-cat") b.id = "atelier-cat";
      img.src = "media/thumbs/" + id + ".webp"; img.alt = ""; label.textContent = name;
      b.append(img,label); b.onclick = () => task("",() => select(id));
      el("sample-pieces").append(b);
    }
  }

  async function open() {
    if (!dialog) build();
    if (dialog.open) return;
    dialog.showModal();
    if (busy) return;
    showPanel("street-panel"); serviceReady = false; canGenerate = false; refresh();
    el("paint-info").textContent = "正在连接本机工坊…";
    if (!paper) {
      const img = new Image(); img.src = "media/signboard.webp";
      img.decode().then(() => { paper=img; draw(); }).catch(() => { el("studio-status").textContent = "木路牌原画未能加载，重新打开工坊即可重试。"; });
    }
    try {
      const data = await json("/api/stickers");
      serviceReady = true; canGenerate = data.ai === true;
      collection(Array.isArray(data.stickers) ? data.stickers : []);
      paintOptions();
    } catch (err) {
      collection([]);
      el("studio-status").textContent = err.message;
      el("paint-info").textContent = "从下载包启动本机服务后，可在这里连接绘图账户。";
    }
    refresh();
  }
  window.stickerStudio = {open,ensure,openNightMarket};
})();
