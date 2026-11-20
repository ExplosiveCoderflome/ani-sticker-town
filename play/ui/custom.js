(() => {
  "use strict";
  const idPattern = /^gen-[0-9a-f]{32}$/;
  const registered = new Map();
  const inks = { "松绿": "#304a36", "砖红": "#994630", "栗棕": "#573823" };
  const roles = [["place","小屋"],["furniture","家具"],["resident","居民"]];
  const marketRoles = [["stall","摊位"],["table","摊桌"],["chair","餐椅"],["customer","食客"]];
  const knownRoles = new Set([...roles, ...marketRoles].map(([role]) => role));
  const samples = [
    {slug:"seaside-market",theme:"海风夜市",profile:"market",caption:"烤鱿鱼摊、折叠桌、矮凳和游客"},
    {slug:"bookshop",theme:"雨天的街角书屋",profile:"books",caption:"雨棚书屋、阅览桌、木椅和读者"},
    {slug:"night-market",theme:"一个热闹的夜市",profile:"market",caption:"馄饨摊、方桌、小凳和食客"}
  ];
  const sampleFor = text => samples.find(s => s.theme === text.trim() || (s.slug === "night-market" && text.trim() === "热闹的夜市"));
  const shelfKey = "town.workshop.kits.v1";
  const roleIDs = marketRoles.map(([id]) => id);
  let profiles = [
    {id:"books",terms:["书","阅读","book","librar"],labels:{stall:"书屋",table:"阅览桌",chair:"阅读椅",customer:"读者"}},
    {id:"market",terms:["夜市","night market"],labels:Object.fromEntries(marketRoles)},
    {id:"general",terms:[],labels:{stall:"主体场所",table:"桌子",chair:"座椅",customer:"来客"}}
  ];
  let mayImport = false;
  let preparedSheet;
  let inputEpoch = 0;
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
    await window.townUI?.whenReady?.();
    if (typeof window.townGame !== "function") throw Error("贴纸盒还在打开，请稍等片刻再试。");
    const role = roleIDs.includes(row.role) ? row.role : "";
    window.townGame("registerAsset",JSON.stringify({id,name:row.name,size:row.size,role,profile:role ? row.profile || "" : "",data:await dataURI(blob)}));
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

  function profileFor(theme) {
    const text = theme.normalize("NFKC").toLowerCase();
    return profiles.find(p => p.terms.some(term => text.includes(term))) || profiles.find(p => p.id === "general");
  }

  function refresh() {
    el("street-create").disabled = busy || !serviceReady || !paper || !el("street-name").value.trim();
    const prompt = el("paint-prompt").value.trim();
    const sample = el("paint-kind").value === "market" && sampleFor(prompt);
    el("paint-create").disabled = busy || !serviceReady || !prompt || !(canGenerate || sample);
    el("paint-redraw").hidden = !canGenerate || !sample;
    el("paint-redraw").disabled = busy;
    for (const b of dialog.querySelectorAll(".sample-box, .atelier-tabs button, #atelier-recent button")) b.disabled = busy;
    el("paint-kind").disabled = busy;
    el("paint-prompt").disabled = busy;
    el("sheet-copy").disabled = busy || !prompt;
    el("sheet-file").disabled = busy || !prompt || !mayImport;
    el("sheet-submit").disabled = busy || !prompt || !mayImport || !preparedSheet;
    el("studio-status").setAttribute("aria-busy", String(busy));
  }

  function paintOptions() {
    const kind = el("paint-kind").value;
    const theme = el("paint-prompt").value.trim();
    const sample = kind === "market" && sampleFor(theme);
    const profile = profileFor(theme);
    el("paint-label").textContent = kind === "one" ? "想画哪一件贴纸？" : "想做一盒什么主题？";
    el("paint-prompt").placeholder = kind === "one" ? "例如，带小铜铃的薄荷绿冰淇淋车" : "例如，海边的旧唱片店";
    el("paint-recipe").textContent = kind === "market" ? roleIDs.map(r => profile.labels[r]).join("  ·  ") : kind === "theme" ? "小屋  ·  家具  ·  居民" : "";
    el("sheet-tools").hidden = kind !== "market";
    el("paint-create").hidden = !sample && !canGenerate;
    el("paint-role-options").hidden = !canGenerate;
    el("studio-connect").hidden = canGenerate;
    const info = el("paint-info");
    if (sample) {
      el("paint-create").textContent = "打开这盒现成贴纸";
      info.textContent = canGenerate ? "打开样盒免费。另画一版会使用 Recraft 额度，最多绘图、去背景各 4 次。" : "盒里的四张现成贴纸可直接试玩。你也可以导入自己画的另一版。";
    } else if (kind === "market") {
      el("paint-create").textContent = "用 Recraft 绘制 4 张";
      info.textContent = canGenerate ? "按张使用 Recraft 额度，最多绘图、去背景各 4 次。相同主题可接着上次进度绘制。" : "可把绘图单交给你常用的画图工具，再将四张贴纸一起带回来。";
    } else {
      el("paint-create").textContent = kind === "theme" ? "分开生成 3 张贴纸" : "生成 1 张透明贴纸";
      info.textContent = canGenerate
        ? "描述会发给 Recraft。" + (kind === "theme" ? "小屋、家具和居民各绘制并去背景一次，使用 3 件的额度。已完成的可以接着用。" : "绘图和去背景各一次，使用已配置账户的额度。")
        : "本机尚未连接 Recraft 绘图账户。";
    }
    refresh();
  }

  function recentKits() {
    try {
      const kits = JSON.parse(localStorage.getItem(shelfKey) || "[]");
      return Array.isArray(kits) ? kits.filter(k => typeof k?.theme === "string" && k.ids?.length === 4 && Array.isArray(k.ids) && k.ids.every(id => idPattern.test(id))) : [];
    } catch { return []; }
  }

  async function enterMarket(rows, theme, profile) {
    if (!Array.isArray(rows) || rows.length !== 4) throw Error("这盒的四张贴纸还没齐。");
    const ordered = marketRoles.map(([role]) => {
      const row = rows.find(item => item?.role === role);
      return checkAsset(row, row?.id);
    });
    const ids = ordered.map(row => row.id);
    if (new Set(ids).size !== 4) throw Error("主题盒需要四张独立的贴纸。");
    if (typeof window.townUI?.openMarket !== "function") throw Error("画布还在准备，请稍后再试。");
    await ensure(ids);
    profile ||= ordered[0].profile || profileFor(theme).id;
    const opened = await window.townUI.openMarket(ordered, theme, profile);
    if (opened === false) throw Error("暂时无法打开这盒贴纸，可以再试一次。");
    try {
      const others = recentKits().filter(kit => kit.ids.some((id,i) => id !== ids[i]));
      localStorage.setItem(shelfKey,JSON.stringify([{theme,ids,profile},...others]));
    } catch {}
    if (dialog?.open) dialog.close();
    return ordered;
  }

  async function openSample(sample) {
    const pack = await json("/api/stickers/" + sample.slug);
    return enterMarket(pack.stickers, pack.theme || sample.theme, pack.profile || sample.profile);
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
    const sample = sampleFor(theme);
    if (kind === "market" && sample && !redraw) return openSample(sample);
    if (!canGenerate) throw Error("当前未连接绘图账户，请选择免费样盒。");
    if (kind === "one") return create("/api/stickers/generate", {prompt:theme});
    const collectionRoles = kind === "market" ? roleIDs.map(r => [r,profileFor(theme).labels[r]]) : roles;
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
      await enterMarket(rows, theme, rows[0].profile);
      edition?.finish();
    } else if (dialog.open) {
      select(rows[0].id);
      window.townUI?.notice?.("三张贴纸齐了。先为小屋选个位置吧。");
    }
  }

  function drawingBrief() {
    const theme = el("paint-prompt").value.trim();
    const labels = profileFor(theme).labels;
    return [
      "请为主题「" + theme + "」画一张四格透明 PNG 贴纸原图，用于一款等距视角的手绘造景游戏。",
      "正方形画布，均分成 2×2 四个象限。左上：" + labels.stall + "，一处完整且空着的场所；右上：" + labels.table + "，一件独立家具；左下：" + labels.chair + "，一把空座椅；右下：" + labels.customer + "，一名独立的全身角色。",
      "每件居中，四边留出至少 8% 的透明余量；同一视角、光源和配色。请隐藏地面、格线、文字、白底和棋盘格，导出带真实透明通道的 PNG。"
    ].join("\n");
  }

  async function copyBrief() {
    const brief = drawingBrief();
    try {
      await navigator.clipboard.writeText(brief);
      el("studio-status").textContent = "绘图单已复制。画好后，把四格透明 PNG 导入这里。";
    } catch {
      const text = el("sheet-brief");
      text.hidden = false; text.value = brief; text.focus(); text.select();
      el("studio-status").textContent = "绘图单已选中，可以直接复制。";
    }
  }

  async function sliceSheet(file) {
    if (!file || file.size > 12 * 1024 * 1024) throw Error("请选择一张小于 12 MB 的四格透明 PNG。");
    const header = new Uint8Array(await file.slice(0,24).arrayBuffer());
    if (header.length < 24 || ![137,80,78,71,13,10,26,10].every((n,i) => header[i] === n)) throw Error("需要带透明背景的 PNG 原图。");
    const dims = new DataView(header.buffer);
    const width = dims.getUint32(16), height = dims.getUint32(20);
    if (Math.min(width,height) < 32 || Math.max(width,height) > 4096) throw Error("四格原图的宽和高应在 32 到 4096 像素之间。");
    const url = URL.createObjectURL(file), img = new Image();
    try {
      img.src = url; await img.decode();
      const cutouts = [];
      for (let i = 0; i < 4; i++) {
        const left = i % 2 * Math.floor(width/2), top = Math.floor(i/2) * Math.floor(height/2);
        const w = i % 2 ? width-left : Math.floor(width/2), h = i < 2 ? Math.floor(height/2) : height-top;
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d",{willReadFrequently:true});
        ctx.drawImage(img,left,top,w,h,0,0,w,h);
        const pixels = ctx.getImageData(0,0,w,h).data;
        let x0 = w, y0 = h, x1 = -1, y1 = -1, clear = 0, solid = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const alpha = pixels[4*(y*w+x)+3];
          if (alpha < 16) { clear++; continue; }
          if (alpha < 32) continue;
          solid++; x0=Math.min(x0,x); y0=Math.min(y0,y); x1=Math.max(x1,x); y1=Math.max(y1,y);
        }
        const corner = ["左上","右上","左下","右下"][i];
        if (solid < 40 || x1-x0 < 4 || y1-y0 < 4) throw Error(corner + "格没有足够可见的图像，检查四件贴纸的位置。");
        if (clear < w*h*.03) throw Error(corner + "格缺少透明背景。请移除底色后重新导出 PNG。");
        if (x0 === 0 || y0 === 0 || x1 === w-1 || y1 === h-1) throw Error(corner + "格的图碰到了边缘，给贴纸四周留一点透明余量再试。");
        x0--; y0--; x1++; y1++;
        const cropW = x1-x0+1, cropH = y1-y0+1, scale = Math.min(1,768/Math.max(cropW,cropH));
        const output = document.createElement("canvas");
        output.width = Math.max(1,Math.round(cropW*scale)); output.height = Math.max(1,Math.round(cropH*scale));
        output.getContext("2d").drawImage(canvas,x0,y0,cropW,cropH,0,0,output.width,output.height);
        cutouts.push(output.toDataURL("image/png"));
      }
      return cutouts;
    } finally { URL.revokeObjectURL(url); }
  }

  function previewSheet() {
    const preview = el("sheet-preview");
    preview.replaceChildren();
    const labels = profileFor(el("paint-prompt").value.trim()).labels;
    for (const [i,src] of (preparedSheet || []).entries()) {
      const piece = document.createElement("figure"), img = new Image(), name = document.createElement("figcaption");
      img.src = src; img.alt = ""; name.textContent = labels[roleIDs[i]];
      piece.append(img,name); preview.append(piece);
    }
    el("sheet-submit").hidden = !preparedSheet;
  }

  async function readSheet(file) {
    const epoch = ++inputEpoch;
    preparedSheet = undefined; previewSheet(); refresh();
    if (!file) return;
    el("studio-status").textContent = "正在分开四格贴纸…";
    try {
      const pieces = await sliceSheet(file);
      if (epoch !== inputEpoch) return;
      preparedSheet = pieces; previewSheet();
      el("studio-status").textContent = "四张贴纸已经分好。确认顺序，就可以打开场景。";
    } catch (error) {
      if (epoch === inputEpoch) { el("sheet-file").value = ""; el("studio-status").textContent = error.message || "PNG 原图无法读取。"; }
    } finally { refresh(); }
  }

  async function importSheet() {
    const theme = el("paint-prompt").value.trim(), profile = profileFor(theme).id;
    const rows = [];
    for (const [i,role] of roleIDs.entries()) {
      el("studio-status").textContent = "正在收好第 " + (i+1) + " / 4 张贴纸…";
      rows.push(await json("/api/stickers",{kind:"interactive",theme,profile,role,data:preparedSheet[i]}));
    }
    await enterMarket(rows,theme,profile);
    preparedSheet = undefined; el("sheet-file").value = ""; previewSheet();
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
      showRecent();
      json("/api/stickers").then(data => collection(data.stickers)).catch(error => { el("studio-status").textContent = error.message; });
    }
  }

  function showRecent() {
    const list = el("atelier-recent");
    list.replaceChildren();
    for (const kit of recentKits()) {
      const b = document.createElement("button"), img = new Image(), span = document.createElement("span");
      img.src = "/api/stickers/" + kit.ids[0] + "/image.png"; img.alt = ""; img.loading = "lazy";
      span.textContent = kit.theme; b.append(img,span);
      b.onclick = () => task("正在翻开这一盒…",async () => enterMarket(await ensure(kit.ids),kit.theme,kit.profile));
      list.append(b);
    }
    el("recent-heading").hidden = !list.childElementCount;
  }

  async function task(message, fn) {
    if (busy) return;
    busy = true; refresh();
    el("studio-status").textContent = message;
    try {
      if (!document.getElementById("load-layer")?.hidden) el("studio-status").textContent = "正在打开游戏画布，贴纸准备好后会自动继续…";
      await window.townUI?.whenReady?.();
      if (dialog.open) { el("studio-status").textContent = message; await fn(); }
    }
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
      '<div class="dialog-top"><div class="atelier-title"><svg aria-hidden="true"><use href="#i-magic"/></svg><h2 id="atelier-heading">主题工坊</h2></div><button class="icon-button" id="atelier-close" aria-label="关闭主题工坊"><svg aria-hidden="true"><use href="#i-close"/></svg></button></div>',
      '<div class="atelier-tabs" role="group" aria-label="工坊工作台"><button data-panel="paint-panel" aria-pressed="true">主题贴纸盒</button><button data-panel="street-panel" aria-pressed="false">写路牌</button><button data-panel="library-panel" aria-pressed="false">我的收藏</button></div>',
      '<section id="street-panel" hidden><div class="atelier-paper"><canvas id="street-preview" width="640" height="196" aria-label="手绘木路牌预览"></canvas></div>',
      '<label for="street-name">路牌上写什么</label><input id="street-name" maxlength="12" value="等你来" autocomplete="off">',
      '<fieldset id="street-colors"><legend>墨色</legend></fieldset><button class="action atelier-main" id="street-create">做成贴纸</button></section>',
      '<section id="paint-panel"><div class="atelier-section-title"><h3>打开样盒</h3><span>现成四件套 · 免费试玩</span></div><div id="atelier-samples"></div>',
      '<div class="atelier-compose"><div class="atelier-kind"><label id="paint-label" for="paint-prompt">想做一盒什么主题？</label><span id="paint-role-options" hidden><label class="sr-only" for="paint-kind">制作规格</label><select id="paint-kind"><option value="market">互动四件套</option><option value="theme">场景三件套</option><option value="one">单件贴纸</option></select></span></div>',
      '<input id="paint-prompt" type="text" maxlength="240" value="海风夜市" autocomplete="off"><div id="paint-recipe"></div><p id="paint-info"></p><div class="paint-actions"><button id="paint-create" class="action">打开这盒现成贴纸</button><button id="paint-redraw" class="secondary" hidden>用 Recraft 重绘 4 张</button></div>',
      '<div id="sheet-tools"><div class="sheet-buttons"><button id="sheet-copy" class="secondary"><svg aria-hidden="true"><use href="#i-book"/></svg>复制四格绘图单</button><label class="sheet-pick" for="sheet-file"><svg aria-hidden="true"><use href="#i-plus"/></svg>导入四格 PNG<input id="sheet-file" type="file" accept="image/png,.png"></label></div><textarea id="sheet-brief" rows="5" readonly hidden aria-label="四格绘图单"></textarea><div id="sheet-preview" aria-label="四张裁好的贴纸预览"></div><button class="action atelier-main" id="sheet-submit" hidden>把四张贴纸放进场景</button></div><details id="studio-connect"><summary>连接 Recraft，在工坊直接画</summary><p>在运行小镇的电脑安装 Pillow，把 RECRAFT_API_TOKEN 设为游戏服务的环境变量，再重启本机服务。连接后可按张绘图，消耗该 Recraft 账户的额度。</p></details></div></section>',
      '<section id="library-panel" hidden><h3 id="recent-heading" hidden>再打开一盒</h3><div id="atelier-recent"></div><h3>我的贴纸</h3><p id="atelier-empty">做一张路牌，或把自己的图带回来，贴纸就会收在这里。</p><div id="atelier-collection"></div><div class="atelier-samples"><h3>街角常用贴纸</h3><div id="sample-pieces"></div></div></section>',
      '<p id="studio-status" role="status" aria-live="polite"></p>'
    ].join("");
    document.body.append(dialog);
    dialog.addEventListener("close",() => {
      const url = new URL(location.href);
      if (url.searchParams.has("workshop")) { url.searchParams.delete("workshop"); history.replaceState(null,"",url); }
    });
    for (const sample of samples) {
      const b = document.createElement("button"), scene = document.createElement("span");
      b.id = sample.slug === "bookshop" ? "sample-bookshop" : sample.slug === "night-market" ? "paint-sample" : "sample-seaside";
      b.className = "sample-box " + sample.slug; scene.className = "sample-art";
      for (const role of ["stall","table","chair","customer"]) {
        const img = new Image(); img.src = "media/" + sample.slug + "/" + role + ".png"; img.alt = ""; img.className = "sample-" + role; scene.append(img);
      }
      const title = document.createElement("strong"), caption = document.createElement("small"), arrow = document.createElement("span");
      title.textContent = sample.slug === "night-market" ? "灯火夜市" : sample.slug === "bookshop" ? "雨天书屋" : sample.theme;
      caption.textContent = sample.caption; arrow.className = "sample-open"; arrow.textContent = "↗"; arrow.setAttribute("aria-hidden","true");
      b.append(scene,title,caption,arrow); b.setAttribute("aria-label","打开" + sample.theme + "样盒");
      b.onclick = () => task("正在打开「" + sample.theme + "」…",() => openSample(sample));
      el("atelier-samples").append(b);
    }
    for (const [name,color] of Object.entries(inks)) {
      const b = document.createElement("button");
      b.textContent = name; b.style.setProperty("--swatch",color); b.setAttribute("aria-pressed",String(color === ink));
      b.onclick = () => { ink = color; for(const v of el("street-colors").querySelectorAll("button")) v.setAttribute("aria-pressed",String(v===b)); draw(); };
      el("street-colors").append(b);
    }
    el("atelier-close").onclick = () => dialog.close();
    for(const b of dialog.querySelectorAll(".atelier-tabs button")) b.onclick = () => showPanel(b.dataset.panel);
    el("street-name").oninput = draw;
    try { const themeDraft = sessionStorage.getItem("town.workshop.prompt"); if (themeDraft !== null) el("paint-prompt").value = themeDraft; } catch {}
    el("paint-prompt").oninput = () => {
      try { sessionStorage.setItem("town.workshop.prompt",el("paint-prompt").value); } catch {}
      el("sheet-brief").hidden = true; el("studio-status").textContent = ""; paintOptions(); if (preparedSheet) previewSheet();
    };
    el("paint-kind").onchange = paintOptions;
    el("sheet-copy").onclick = copyBrief;
    el("sheet-file").onchange = () => readSheet(el("sheet-file").files[0]);
    el("sheet-submit").onclick = () => task("正在收好四张贴纸…",importSheet);
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

  async function open(panel = "paint-panel") {
    if (!dialog) build();
    if (dialog.open) return;
    dialog.showModal();
    if (busy) return;
    showPanel(panel); serviceReady = false; canGenerate = false; mayImport = false; refresh();
    el("paint-info").textContent = "正在连接本机工坊…";
    if (!paper) {
      const img = new Image(); img.src = "media/signboard.webp";
      img.decode().then(() => { paper=img; draw(); }).catch(() => { el("studio-status").textContent = "木路牌原画未能加载，重新打开工坊即可重试。"; });
    }
    try {
      const [data,presets] = await Promise.all([json("/api/stickers"),json("/api/stickers/profiles").catch(() => null)]);
      if (Array.isArray(presets?.profiles) && presets.profiles.some(p => p.id === "general") &&
          presets.profiles.every(p => Array.isArray(p.terms) && roleIDs.every(role => typeof p.labels?.[role] === "string"))) profiles = presets.profiles;
      serviceReady = true; canGenerate = data.ai === true; mayImport = data.interactiveImport === true;
      collection(Array.isArray(data.stickers) ? data.stickers : []);
      showRecent();
      paintOptions();
    } catch (err) {
      collection([]);
      el("studio-status").textContent = err.message;
      el("paint-info").textContent = "从下载包启动本机服务后，可在这里连接绘图账户。";
    }
    refresh();
  }
  window.stickerStudio = {open,ensure,openNightMarket:() => openSample(samples[2]),openBookshop:() => openSample(samples[1]),openSeaside:() => openSample(samples[0])};
})();
