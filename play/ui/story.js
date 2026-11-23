(() => {
  "use strict";

  const letters = [
    {
      id:"seaside", title:"海风夜市", subject:"游客的来信", sender:"条纹衫游客", portrait:"seaside-market/customer.png",
      request:"刚下船，就闻到烤鱿鱼的香味了。能帮我找个靠摊的位置，坐着等晚风吗？",
      hint:"点鱿鱼摊旁的空地放下游客。给她留一张摊边的空凳，她接过烤串就能坐下吃。",
      keepsake:"海风摊的夜票", stamp:"seaside-market/stall.png", color:"#99613f",
      reply:"鱿鱼还热着，海风已经到了。把今晚的摊票留给你。",
      wishes:[{id:"supper",text:"让游客在鱿鱼摊买餐，坐下吃完",profile:"market",seated:true}]
    },
    {
      id:"books", title:"雨天书屋", subject:"读者的来信", sender:"红贝雷帽读者", portrait:"bookshop/customer.png",
      request:"雨一时半会儿停不了。我想在书亭借一本书，找把椅子，把最后一章读完。",
      hint:"把阅读椅拖到阅览桌旁，再把读者拖到书亭前。她借到书后，就会去找座位。",
      keepsake:"雨天借书票", stamp:"bookshop/stall.png", color:"#497472",
      reply:"读到最后一页，雨刚好停了。借书票的背面还沾着一颗小小的雨滴。",
      wishes:[{id:"reading",text:"让读者从书亭借书，坐到桌边读完",profile:"books",seated:true}]
    },
    {
      id:"festival", title:"同街两桩心愿", subject:"街坊的联名信", sender:"两位街坊", portrait:"bookshop/customer.png",
      request:"有人还想坐在书亭读一会儿，有人正赶去码头。把这一条街留给两种不同的周末吧。",
      hint:"把桌椅摆到书亭旁，将读者拖到书亭前。让鱿鱼摊周围留空，再把游客拖到摊前。",
      keepsake:"街坊合影", stamp:"seaside-market/customer.png", color:"#a34e42",
      reply:"一人抱着书，一人提着晚餐，约好下个周末还在这里碰面。",
      wishes:[
        {id:"read-here",text:"读者在书亭借书，坐下阅读",profile:"books",seated:true},
        {id:"take-away",text:"游客在鱿鱼摊买餐，打包带走",profile:"market",seated:false}
      ]
    }
  ];
  const numerals = ["一","二","三"];
  const storageKey = "town.story.letters.v1";
  const get = id => document.getElementById(id);
  const path = file => "media/" + file;
  const chapter = id => letters.find(letter => letter.id === id);
  const key = (id,wish) => id + "." + wish.id;
  const blank = () => ({started:[],wishes:[],claimed:[]});
  let saved = read(), scene = "", page = "", loading = false, memoryOnly = false;
  let panelKey = "", albumFrom = "cover", exportURL = "", returnURL = "", hasState = false;

  function read() {
    try {
      const data = JSON.parse(localStorage.getItem(storageKey));
      if (!data || !["started","wishes","claimed"].every(k => Array.isArray(data[k]))) return blank();
      const clean = blank();
      for (const letter of letters) {
        if (!data.started.includes(letter.id)) break;
        clean.started.push(letter.id);
        for (const wish of letter.wishes) if (data.wishes.includes(key(letter.id,wish))) clean.wishes.push(key(letter.id,wish));
        if (!data.claimed.includes(letter.id) || !letter.wishes.every(w => clean.wishes.includes(key(letter.id,w)))) break;
        clean.claimed.push(letter.id);
      }
      return clean;
    } catch { return blank(); }
  }

  function persist() {
    const disk = read();
    for (const field of Object.keys(disk)) saved[field] = [...new Set([...saved[field],...disk[field]])];
    try { localStorage.setItem(storageKey,JSON.stringify(saved)); } catch { memoryOnly = true; }
  }
  const claimed = id => saved.claimed.includes(id);
  const fulfilled = (letter,wish) => saved.wishes.includes(key(letter.id,wish));
  const complete = letter => letter.wishes.every(wish => fulfilled(letter,wish));
  const nextLetter = () => letters.find(letter => !claimed(letter.id));
  const finished = () => letters.every(l => claimed(l.id));
  function canOpen(id) {
    const n = letters.findIndex(letter => letter.id === id);
    return n >= 0 && (n === 0 || claimed(letters[n-1].id));
  }

  function icon(name) {
    return '<svg aria-hidden="true" focusable="false"><use href="#i-' + name + '"/></svg>';
  }
  function media(file,alt = "") {
    return '<img src="' + path(file) + '" alt="' + alt + '" decoding="async" draggable="false">';
  }
  function printStamp(letter, earned) {
    const image = media(letter.stamp) + (letter.id === "festival" ? media("bookshop/customer.png") : "");
    return '<div class="letter-stamp stamp-' + letter.id + (earned ? ' earned' : '') + '" aria-hidden="true"><div class="stamp-picture">' +
      image + '</div><span>' + (earned ? "街角留念" : "等待回信") + '</span></div>';
  }

  function routeList() {
    return '<ol class="letter-route" aria-label="第一章三封来信">' + letters.map((l,i) => {
      const locked = !canOpen(l.id);
      const status = claimed(l.id) ? "已收下" : !locked ? (saved.started.includes(l.id) ? "进行中" : "可拆信") : "未拆封";
      return '<li><button data-open-letter="' + l.id + '"' + (locked ? ' disabled' : '') +
        ' aria-label="第' + numerals[i] + '封，' + l.title + '，' + status + '"><span class="route-number">' + (i+1) +
        '</span><span><b>' + l.title + '</b><small>' + status + '</small></span></button></li>';
    }).join("") + '</ol>';
  }
  function coverMarkup() {
    const next = nextLetter();
    const label = !next ? "翻开纪念册" : saved.started.includes(next.id) ? "继续第" + numerals[letters.indexOf(next)] + "封信" : "拆开第" + numerals[letters.indexOf(next)] + "封信";
    return '<div class="letter-shell"><div class="letter-mast"><div class="letter-brand">' + icon("book") +
      '小镇贴纸簿</div><button id="story-album" class="letter-link">' + icon("postcard") + '收藏册 <span>' + saved.claimed.length +
      '/3</span></button></div><div class="story-spread"><div class="story-cover-art">' +
      media("story/cover.webp","街角的夜市摊与雨篷书亭，街坊正从两边走来") +
      '</div><div class="cover-colophon"><div class="cover-text"><h1 id="story-title" tabindex="-1">街角来信</h1>' +
      '<p>把街坊的心愿贴进小镇，收下三张纪念票。</p></div><div class="cover-actions"><button id="story-start" class="letter-primary">' +
      icon("book") + label + '</button><button id="story-free" class="letter-link">自由造景' + icon("arrow") + '</button></div></div></div>' +
      routeList() + '<nav class="cover-samples" aria-label="自由试玩">' +
      '<a class="letter-link" href="?workshop=1">做一盒动作贴纸' + icon("arrow") + '</a>' +
      '<a class="letter-link" href="?market=books">去书屋借书' + icon("arrow") + '</a>' +
      '<a class="letter-link" href="?market=seaside">去夜市吃串' + icon("arrow") + '</a></nav>' +
      '<p class="letter-status" id="story-status" role="status"></p></div>';
  }
  function albumMarkup() {
    const done = finished();
    const mailbox = '<div class="album-keepsake">' + media("story/postbox.png","街角的蓝邮筒贴纸") +
      '<div><h2>街角的蓝邮筒</h2><p>三封信都到了。街坊送来一只邮筒，让下一封信也有地方可投。</p>' +
      '<button id="story-keepsake" class="letter-primary">' + icon("pin") + '把蓝邮筒摆进街角</button></div></div>';
    return '<div class="letter-shell album-shell"><div class="letter-mast"><button id="story-return" class="letter-link">' +
      icon("arrow") + (albumFrom === "game" ? "回到街角" : "回到封面") + '</button><div class="letter-brand">' + icon("book") +
      '小镇贴纸簿</div></div><div class="album-head"><h1 id="story-title" tabindex="-1">街角收藏册</h1><span class="album-count">' +
      saved.claimed.length + ' / 3 张</span></div><p class="album-intro">' + (done ? "三封来信，都有了回音。" : "收下街坊的回信，就能把纪念票贴在这里。") +
      '</p><ol class="album-leaves">' + letters.map((letter,i) => {
        const earned = claimed(letter.id);
        return '<li class="album-leaf' + (earned ? " is-earned" : "") + '">' + printStamp(letter,earned) +
          '<div><small>第' + numerals[i] + '封 · ' + letter.title + '</small><h2>' + (earned ? letter.keepsake : "尚未收到") +
          '</h2><p>' + (earned ? letter.reply : "完成这封信里的心愿后收取。") + '</p>' +
          (earned ? '<button class="letter-link album-revisit" data-open-letter="' + letter.id + '">再去街角看看' + icon("arrow") + '</button>' : '') +
          '</div></li>';
      }).join("") + '</ol>' + (done ? mailbox + '<div class="album-footer"><button id="story-postcard" class="letter-link">' + icon("postcard") +
      '保存纪念明信片</button><button id="story-free" class="letter-link">再去逛逛 · 自由造景' + icon("arrow") + '</button></div>' : '') +
      '<div id="story-export" hidden></div><p class="letter-status" id="story-status" role="status"></p></div>';
  }

  function renderHome(focus = false) {
    const screen = get("story-home-screen");
    if (!screen) return;
    screen.hidden = !page;
    document.body.classList.toggle("story-home-open",!!page);
    for (const outside of document.querySelectorAll("body > .mast, body > .desk")) outside.inert = !!page;
    if (!page) return;
    screen.setAttribute("aria-labelledby","story-title");
    screen.innerHTML = page === "album" ? albumMarkup() : coverMarkup();
    if (focus) { window.scrollTo(0,0); get("story-title").focus({preventScroll:true}); }
    if (memoryOnly) status("当前浏览器只在本次打开期间保留来信进度。");
  }
  function status(message) {
    const field = page ? get("story-status") : get("story-task-status");
    if (field) field.textContent = message;
  }
  function storyLocation(value) {
    if (location.hash.startsWith("#gift")) return;
    const url = new URL(location.href);
    for (const k of ["box","garden","edit","workshop","market"]) url.searchParams.delete(k);
    url.searchParams.set("story",value);
    history.replaceState(null,"",url);
  }
  function home() {
    if (!page && hasState) returnURL = location.href;
    storyLocation("1"); page = "cover"; renderHome(true); drawTask();
  }
  function album() {
    albumFrom = page ? "cover" : "game";
    if (!page && hasState) returnURL = location.href;
    storyLocation("1"); page = "album"; renderHome(true); drawTask();
  }
  function board() {
    page = ""; renderHome(); panelKey = ""; drawTask();
    if (scene) storyLocation(scene);
    returnURL = "";
    window.TownNightMarket?.resume?.();
    const target = get("story-task-title") || get("canvas");
    target?.focus({preventScroll:true});
  }
  async function openLetter(id) {
    if (loading || !canOpen(id)) return;
    loading = true; busy(true); status("正在拆开来信…");
    try {
      if (typeof window.townUI?.openStory !== "function") throw Error("街角画布还在打开，请稍等片刻再试。");
      await window.townUI.openStory(id);
      if (scene !== id) throw Error("这封来信还没打开，可以再点一次。");
      if (!saved.started.includes(id)) { saved.started.push(id); persist(); }
      board();
    } catch (error) { status(error.message || "来信暂时打不开，请重新再试。"); }
    finally { loading = false; busy(false); }
  }
  function busy(value) {
    const area = page ? get("story-home-screen") : get("story-task");
    if (!area) return;
    area.setAttribute("aria-busy",String(value));
    for (const b of area.querySelectorAll("button")) {
      if (value && !b.disabled) { b.disabled = true; b.dataset.storyPending = "1"; }
      else if (!value && b.dataset.storyPending) { b.disabled = false; delete b.dataset.storyPending; }
    }
  }
  async function freePlay(withKeepsake = false) {
    if (loading) return;
    loading = true; busy(true); status("正在打开街角…");
    try {
      if (withKeepsake && finished()) await window.townUI.placeKeepsake();
      else await window.townUI.freePlay();
      board();
    }
    catch (err) { status(err.message || "街角暂时打不开。"); }
    finally { loading = false; busy(false); }
  }

  function drawTask() {
    const panel = get("story-task");
    if (!panel) return;
    const letter = chapter(scene);
    panel.hidden = !!page || !letter || !canOpen(scene);
    if (panel.hidden) { panelKey = ""; return; }
    const signature = JSON.stringify([scene,saved.wishes,saved.claimed,memoryOnly]);
    if (signature === panelKey) return;
    panelKey = signature; panel.dataset.chapter = scene;
    const n = letters.indexOf(letter), earned = claimed(scene), achieved = complete(letter);
    let action = "";
    if (!earned && achieved) action = '<button id="story-claim" class="letter-primary">' + icon("gift") + "收下「" + letter.keepsake + "」</button>";
    if (earned) action = '<button id="story-next" class="letter-primary">' + icon(n < 2 ? "book" : "postcard") + (n < 2 ? "拆开下一封信" : "翻开纪念册") + '</button>';
    const keepsake = earned || achieved;
    panel.innerHTML = '<div class="task-letter"><div class="letter-portrait">' + media(letter.portrait) +
      (scene === "festival" ? media("seaside-market/customer.png") : '') + '</div><div class="task-body"><div class="task-line"><h2 id="story-task-title" tabindex="-1">' +
      (keepsake ? letter.keepsake : letter.subject) + '</h2><small>第' + numerals[n] + '封 · ' + letter.sender + '</small></div><p class="task-message">' +
      (keepsake ? letter.reply : letter.request) + '</p><ul class="task-wishes" aria-label="来信心愿">' +
      letter.wishes.map(wish => '<li data-wish="' + wish.id + '" class="' + (fulfilled(letter,wish) ? "is-done" : "") +
      '"><span class="wish-mark">' + (fulfilled(letter,wish) ? icon("check") : "") + '</span><span>' + wish.text +
      (fulfilled(letter,wish) ? '<span class="letter-sr">，已完成</span>' : '') + '</span></li>').join("") +
      '</ul></div><div class="task-tools">' + action + (earned ? '<button class="letter-link" id="story-task-album">收藏册</button>' : '') +
      (!achieved ? '<details class="wish-hint"><summary>看个提示</summary><p>' + letter.hint + '</p></details>' : '') +
      '</div></div><p class="letter-status" id="story-task-status" role="status">' + (memoryOnly ? "本次进度仅在当前页面保留。" : "") + '</p>';
  }
  function sync(state) {
    hasState = !!state;
    scene = chapter(state?.storyChapter) ? state.storyChapter : "";
    if (scene && canOpen(scene) && !saved.started.includes(scene)) { saved.started.push(scene); persist(); }
    drawTask();
  }
  function visit(event) {
    if (!event || page || event.chapter !== scene || !canOpen(scene) || claimed(scene) || !saved.started.includes(scene)) return false;
    const letter = chapter(scene);
    const wish = letter.wishes.find(w => w.profile === event.customerProfile && w.profile === event.stallProfile &&
      w.seated === event.seated && !fulfilled(letter,w));
    if (!wish) return false;
    saved.wishes.push(key(scene,wish)); persist(); drawTask();
    status(complete(letter) ? "心愿完成，街坊给你寄来了纪念票。" : "完成一桩心愿，另一位街坊还在等你。");
    return true;
  }
  function claim() {
    const letter = chapter(scene);
    if (page || !letter || !canOpen(scene) || claimed(scene) || !complete(letter)) return;
    saved.claimed.push(scene); persist(); drawTask();
    status("「" + letter.keepsake + "」已收进收藏册。");
    get("story-next")?.focus({preventScroll:true});
  }

  async function loadArt(file) {
    const img = new Image(); img.src = path(file); await img.decode(); return img;
  }
  function drawFit(ctx,img,x,y,w,h) {
    const scale = Math.min(w/img.naturalWidth,h/img.naturalHeight);
    const iw = img.naturalWidth*scale, ih = img.naturalHeight*scale;
    ctx.drawImage(img,x+(w-iw)/2,y+(h-ih)/2,iw,ih);
  }
  async function postcard() {
    if (loading || !letters.every(l => claimed(l.id))) return;
    loading = true; busy(true); status("正在印出纪念明信片…");
    try {
      const art = await Promise.all(["story/cover.webp",...letters.map(l => l.stamp),"bookshop/customer.png"].map(loadArt));
      const canvas = document.createElement("canvas"); canvas.width = 1440; canvas.height = 1050;
      const ctx = canvas.getContext("2d"), serif = '"Noto Serif SC","Songti SC","SimSun",serif', sans = '"Microsoft YaHei",sans-serif';
      ctx.fillStyle = "#faf4e5"; ctx.fillRect(0,0,1440,1050);
      ctx.fillStyle = "#29493b"; ctx.font = "bold 66px "+serif; ctx.fillText("街角来信",70,109);
      ctx.font = "25px "+sans; ctx.textAlign = "right"; ctx.fillText("小镇贴纸簿  /  纪念明信片",1370,101);
      ctx.textAlign = "left";
      const cover = art[0], scale = Math.max(1300/cover.width,515/cover.height);
      ctx.save(); ctx.beginPath(); ctx.rect(70,144,1300,515); ctx.clip();
      ctx.drawImage(cover,70+(1300-cover.width*scale)/2,144+(515-cover.height*scale)/2,cover.width*scale,cover.height*scale); ctx.restore();
      for (const [i,letter] of letters.entries()) {
        const x = 70 + i*445;
        ctx.strokeStyle = letter.color; ctx.lineWidth = 2; ctx.setLineDash([4,6]); ctx.strokeRect(x+1,698,407,270); ctx.setLineDash([]);
        if (i < 2) drawFit(ctx,art[i+1],x+101,712,205,147);
        else { drawFit(ctx,art[3],x+103,715,115,141); drawFit(ctx,art[4],x+193,715,113,141); }
        ctx.textAlign="center"; ctx.fillStyle="#2e4637"; ctx.font="bold 32px "+serif; ctx.fillText(letter.keepsake,x+205,902);
        ctx.fillStyle="#635f50"; ctx.font="21px "+sans; ctx.fillText(letter.title,x+205,939);
      }
      const blob = await new Promise(resolve => canvas.toBlob(resolve,"image/png"));
      if (!blob) throw Error("浏览器暂时未能生成图片。");
      if (exportURL) URL.revokeObjectURL(exportURL);
      exportURL = URL.createObjectURL(blob);
      const box = get("story-export"); if (!box) return;
      box.hidden = false; box.replaceChildren();
      const a = document.createElement("a"), img = new Image();
      a.href = exportURL; a.download = "街角来信-纪念明信片.png"; a.textContent = "下载 PNG 原图";
      img.src = exportURL; img.alt = "收齐三张纪念票的街角明信片，可长按保存";
      box.append(img,a); a.click(); status("明信片印好了。手机也可以长按图片保存。");
    } catch (e) { status(e.message || "明信片暂时未能印出，可以重试。"); }
    finally { loading = false; busy(false); }
  }

  function back() {
    if (loading) return;
    if (page === "album" && albumFrom !== "game") { home(); return; }
    if (returnURL) history.replaceState(null,"",returnURL);
    if (scene || returnURL) board();
  }
  document.addEventListener("click",event => {
    const b = event.target.closest("button");
    if (!b || b.disabled || !b.closest("#story-home-screen,#story-task")) return;
    if (b.dataset.openLetter) { openLetter(b.dataset.openLetter); return; }
    switch (b.id) {
      case "story-start": { const next = nextLetter(); if (next) openLetter(next.id); else album(); break; }
      case "story-free": freePlay(); break;
      case "story-keepsake": if (finished()) freePlay(true); break;
      case "story-return": back(); break;
      case "story-album": case "story-task-album": album(); break;
      case "story-claim": claim(); break;
      case "story-postcard": postcard(); break;
      case "story-next": { const following = letters[letters.findIndex(l => l.id === scene)+1]; if (following) openLetter(following.id); else album(); break; }
    }
  });
  document.addEventListener("keydown",event => {
    if (event.key === "Escape" && page && !document.querySelector("dialog[open]")) { event.preventDefault(); back(); }
  });
  window.addEventListener("storage",event => {
    if (event.key !== storageKey) return;
    saved = read(); drawTask(); if (page) renderHome();
  });
  window.TownStory = {home,album,sync,visit,canOpen,finished,isHome:() => !!page};
})();
