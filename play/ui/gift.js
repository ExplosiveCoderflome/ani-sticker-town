/* Shared artwork format v1. An item is anchored at the bottom center of its visible sprite. */
(() => {
  "use strict";

  const bases = ["weekend-town-v1", "afternoon-v1"];
  // Stable wire indices, independent of display order or translated names.
  const assets = ["bakery","bookshop","flower-cart","fountain","bench","cafe-table","cafe-chair",
    "tree","lamp","musician","child","florist","dog","paving","black-cat"];
  const generated = /^gen-[a-f0-9]{32}$/;
  const hashPrefix = "#gift=";
  const malformed = "这封贴纸礼物的链接不完整，请让朋友重新发送。";
  const limit = 15;
  let manifestPromise;

  function check(value, message = malformed) {
    if (!value) throw new Error(message);
  }

  function cleanText(value, max, message) {
    check(typeof value === "string", message);
    const clean = value.normalize("NFC").trim();
    check(clean.length && [...clean].length <= max &&
      !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(clean) &&
      !/[\uD800-\uDFFF]/u.test(clean), message);
    return clean;
  }

  function coord(value, max) {
    check(Number.isFinite(value) && value >= 0 && value <= max, "有一张贴纸的位置超出了小镇画布。");
    return Math.round(value * 2) / 2;
  }

  function normalize(work) {
    check(work && work.version === 1, "这封礼物使用了其他素材盒版本，请打开原链接或更新游戏。");
    check(bases.includes(work.base), "找不到这片小镇的底板，请重新选择贴纸盒。");
    check(work.ambience === undefined || work.ambience === "night");
    const title = cleanText(work.title, 32, "作品名需要填写 1 至 32 个字。");
    check(Array.isArray(work.items) && work.items.length > 0 && work.items.length <= limit, "每封贴纸礼物需要 1 至 15 张贴纸。");
    const items = work.items.map(item => {
      check(item && typeof item.asset === "string" && (assets.includes(item.asset) || generated.test(item.asset)),
        "这封礼物含有无法识别的贴纸。");
      check(Number.isSafeInteger(item.z) && Math.abs(item.z) <= 32767, "有一张贴纸的前后顺序无效。");
      return {asset:item.asset,x:coord(item.x,864),y:coord(item.y,900),z:item.z};
    }).sort((a,b) => a.z - b.z);
    items.forEach((item,index) => { item.z=index; });
    const result = {version:1,base:work.base,title,items};
    if (work.ambience === "night") result.ambience = "night";
    return result;
  }

  function encode(work) {
    const w = normalize(work);
    const pieces = w.items.map(({asset,x,y}) => [assets.includes(asset) ? assets.indexOf(asset) : asset,x*2,y*2]);
    const wire = [1,bases.indexOf(w.base),w.title,pieces];
    if (w.ambience === "night") wire.push(1);
    const raw = new TextEncoder().encode(JSON.stringify(wire));
    const token = btoa(String.fromCharCode(...raw)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    return hashPrefix + token;
  }

  function decode(hash = location.hash) {
    if (typeof hash !== "string" || !/^#gift(?:=|$)/.test(hash)) return null;
    check(hash.startsWith(hashPrefix) && hash.length <= 2048);
    const token = hash.slice(hashPrefix.length);
    check(token.length && /^[\w-]+$/.test(token));
    let value;
    try {
      const binary = atob(token.replace(/-/g,"+").replace(/_/g,"/"));
      const text = new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(binary,c => c.charCodeAt(0)));
      value = JSON.parse(text);
    } catch { throw new Error(malformed); }
    check(Array.isArray(value) && (value.length === 4 || (value.length === 5 && value[4] === 1)));
    const [version,base,title,pieces] = value;
    check(version === 1, "这封礼物使用了其他素材盒版本，请打开原链接或更新游戏。");
    check(Number.isInteger(base) && bases[base] && Array.isArray(pieces) && pieces.length > 0 && pieces.length <= limit);
    const items = pieces.map((p,z) => {
      check(Array.isArray(p) && p.length === 3 && Number.isInteger(p[1]) && Number.isInteger(p[2]));
      const asset = Number.isInteger(p[0]) ? assets[p[0]] : p[0];
      check(typeof asset === "string" && (Number.isInteger(p[0]) || generated.test(asset)));
      return {asset,x:p[1]/2,y:p[2]/2,z};
    });
    const work = {version,base:bases[base],title,items};
    if (value.length === 5) work.ambience = "night";
    return normalize(work);
  }

  function homeURL() { return new URL("./", location.href).href; }
  function link(work) { return homeURL() + encode(work); }

  async function read(relative, type, message, maxBytes) {
    const url = new URL(relative, homeURL());
    check(url.origin === location.origin, message);
    const timer = new AbortController();
    const timeout = setTimeout(() => timer.abort(), 12000);
    try {
      // Never follow even a same-origin redirect onto a third-party image host.
      const res = await fetch(url, {mode:"same-origin", credentials:"same-origin",redirect:"error",signal:timer.signal});
      const mime = (res.headers.get("Content-Type") || "").split(";")[0].trim();
      check(res.ok && (type === "json" ? mime === "application/json" : /^image\/(webp|png)$/.test(mime)), message);
      check(Number(res.headers.get("Content-Length") || 0) <= maxBytes, message);
      const blob = await res.blob();
      check(blob.size > 0 && blob.size <= maxBytes, message);
      return type === "json" ? JSON.parse(await blob.text()) : blob;
    } catch { throw new Error(message); }
    finally { clearTimeout(timeout); }
  }

  function manifest() {
    if (!manifestPromise) {
      manifestPromise=read("media/levels.json","json","小镇素材清单暂时打不开，请稍后重试。",200000)
        .catch(error => {manifestPromise=null; throw error;});
    }
    return manifestPromise;
  }

  async function customAsset(id) {
    const endpoint = "/api/stickers/" + id;
    const why = "这枚定制贴纸在当前站点暂不可用。请用制作它的小镇地址打开，或请朋友发送 PNG 明信片。";
    const row = await read(endpoint,"json",why,16000);
    check(row && row.id === id && row.image === endpoint+"/image.png",why);
    const name = cleanText(row.name,40,why);
    const validPixels = n => Number.isInteger(n) && n>=1 && n<=4096;
    check(validPixels(row.width) && validPixels(row.height) && Array.isArray(row.size) && row.size.length === 2,why);
    check(row.size.every((n,i) => Number.isFinite(n) && n>=1 && n<=[864,900][i]),why);
    const role = ["stall","table","chair","customer"].includes(row.role) ? row.role : "";
    return {id,name,width:row.width,height:row.height,size:[...row.size],image:endpoint+"/image.png",opacity:1,role};
  }

  async function resolve(input) {
    const work = normalize(input), config=await manifest();
    const box = config.levels.find(row => row.id === work.base);
    check(box, "小镇底板暂不可用，请回到首页重新选择。");
    const catalog = Object.create(null);
    await Promise.all([...new Set(work.items.map(v => v.asset))].map(async id => {
      if (generated.test(id)) { catalog[id]=await customAsset(id); return; }
      const s=box.slots.find(slot=>slot.asset===id);
      check(s || id==="black-cat", "有一枚内置贴纸暂时缺失，请更新素材盒后重试。");
      catalog[id] = {id,name:s?.name || "黑猫",size:s?.size || [52,62],opacity:s?.opacity ?? 1,image:"media/stickers/"+id+".webp"};
    }));
    return {work,catalog};
  }

  async function imageBlobs(input) {
    const {work,catalog}=await resolve(input);
    const load=path=>read(path,"image","这张贴纸的图片暂时打不开，请稍后重试。",16*1024*1024);
    const night=work.ambience==="night";
    const [ground, entries]=await Promise.all([
      load(night?"media/ground-night.webp":"media/ground.webp"),
      Promise.all(Object.values(catalog).map(async a=>{
        const blob=await load(a.image);
        return [a.id,night?await shadeSprite(a.id,blob):blob];
      })),
    ]);
    return {work,catalog,ground:night?await lightGround(ground,work.items,catalog):ground,images:Object.fromEntries(entries)};
  }

  async function bitmap(blob) {
    if (window.createImageBitmap) return createImageBitmap(blob);
    const img = new Image(), url=URL.createObjectURL(blob);
    try { img.src=url; await img.decode(); return img; }
    finally { URL.revokeObjectURL(url); }
  }

  async function editBitmap(blob,paint,type) {
    const image=await bitmap(blob);
    try {
      const canvas=document.createElement("canvas");
      canvas.width=image.width; canvas.height=image.height;
      const ctx=canvas.getContext("2d",{willReadFrequently:type==="image/png"});
      ctx.drawImage(image,0,0);
      paint(ctx,canvas.width,canvas.height);
      return await new Promise((ok,fail)=>canvas.toBlob(result=>result?ok(result):fail(new Error("夜色画面暂时无法导出，请再试一次。")),type,.96));
    } finally { image.close?.(); }
  }

  function shadeSprite(id,blob) {
    const rgb=id==="paving"?[179,166,153]:["bakery","bookshop","tree","bench"].includes(id)?[223,208,190]:null;
    if (!rgb) return blob;
    return editBitmap(blob,(ctx,w,h)=>{
      const pixels=ctx.getImageData(0,0,w,h);
      for(let i=0;i<pixels.data.length;i+=4) {
        pixels.data[i]*=rgb[0]/255;
        pixels.data[i+1]*=rgb[1]/255;
        pixels.data[i+2]*=rgb[2]/255;
      }
      ctx.putImageData(pixels,0,0);
    },"image/png");
  }

  function lightGround(blob,items,catalog) {
    const lights=items.filter(it=>it.asset==="lamp" || catalog[it.asset].role==="stall");
    if (!lights.length) return blob;
    return editBitmap(blob,(ctx,w,h)=>{
      ctx.scale(w/864,h/900);
      function glow(x,y,width,height,alpha=1) {
        ctx.save();ctx.translate(x,y);ctx.scale(width/2,height/2);
        const halo=ctx.createRadialGradient(0,0,0,0,0,1);
        halo.addColorStop(0,"rgba(255,196,102,.73)");halo.addColorStop(.32,"rgba(255,173,79,.36)");
        halo.addColorStop(.7,"rgba(255,158,64,.09)");halo.addColorStop(1,"rgba(255,153,56,0)");
        ctx.globalAlpha=alpha;ctx.fillStyle=halo;ctx.fillRect(-1,-1,2,2);ctx.restore();
      }
      for(const it of lights) {
        const [sw,sh]=catalog[it.asset].size;
        if (it.asset==="lamp") glow(it.x,it.y-sh*.875,64,64);
        else {
          glow(it.x,it.y,sw*1.7,Math.max(55,sh*.46));
          glow(it.x,it.y-sh*.62,Math.max(125,sw*1.27),Math.max(120,sh*1.15),.72);
        }
      }
    },"image/webp");
  }

  function stamp(c,x,y,paper) {
    c.save();
    c.translate(x,y);
    c.rotate(-0.055);
    c.fillStyle="#efe4c9"; c.fillRect(-4,-4,112,108);
    c.strokeStyle="#9a8c70";c.lineWidth=1;
    c.strokeRect(0,0,104,100);
    c.fillStyle=paper;
    for(let i=4;i<104;i+=8) {
      for(const [px,py] of [[i,-3],[i,103],[-3,i],[107,i]]) {
        c.beginPath(); c.arc(px,py,3.2,0,Math.PI*2); c.fill();
      }
    }
    c.fillStyle="#416757"; c.fillRect(6,6,92,88);
    c.strokeStyle="#f1deb5"; c.lineWidth=1; c.strokeRect(10,10,84,80);
    c.fillStyle="#efbb76"; c.beginPath(); c.arc(68,31,10,0,Math.PI*2); c.fill();
    c.strokeStyle="#f1deb5"; c.lineWidth=2;
    c.beginPath(); c.moveTo(16,61); c.lineTo(16,49); c.lineTo(29,39); c.lineTo(42,49); c.lineTo(42,61);
    c.moveTo(38,46); c.lineTo(49,37); c.lineTo(61,48); c.lineTo(61,61);
    c.moveTo(60,54); c.lineTo(71,44); c.lineTo(83,54); c.lineTo(83,61);
    c.moveTo(14,64); c.lineTo(90,64); c.stroke();
    c.fillStyle="#f1deb5"; c.font="bold 10px Georgia, serif"; c.textAlign="center";
    c.fillText("T O W N   P O S T",52,80);
    c.restore();
    c.save(); c.strokeStyle="rgba(120,85,64,0.55)"; c.lineWidth=1.15;
    for (const dy of [0,5,10]) {
      c.beginPath();
      for(let i=0;i<=70;i++) {
        const px=x-42+i, py=y+69+dy+2*Math.sin(i/7); i ? c.lineTo(px,py):c.moveTo(px,py);
      }
      c.stroke();
    }
    c.restore();
  }

  function titleLines(c,text,width) {
    const chars = Array.from(text);
    for(const size of [43,39,35,30,26]) {
      c.font="600 "+size+"px 'Noto Serif SC','Songti SC','SimSun',serif";
      let current="", lines=[];
      for(const ch of chars) {
        if(current && c.measureText(current+ch).width>width) {lines.push(current);current="";}
        current+=ch;
      }
      lines.push(current);
      if(lines.length<=2 || size===26) return {size,lines};
    }
  }

  async function postcard(input) {
    const {work,catalog,ground,images:blobs}=await imageBlobs(input);
    const images=new Map();
    try {
      const loads=await Promise.allSettled(Object.entries({ground,...blobs}).map(async ([id,blob])=>images.set(id,await bitmap(blob))));
      const failed=loads.find(result=>result.status==="rejected");
      if(failed) throw failed.reason;
      const canvas=document.createElement("canvas");
      // Keep the artwork's original 864:900 aspect ratio at twice logical resolution.
      canvas.width=1800; canvas.height=2112;
      const c=canvas.getContext("2d",{alpha:false});
      c.scale(2,2); c.imageSmoothingEnabled=true;c.imageSmoothingQuality="high";
      const night=work.ambience==="night",paper=night?"#2c3941":"#fcf7e8";
      c.fillStyle=paper;c.fillRect(0,0,900,1056);
      const left=30,top=30,width=840,scale=width/864,height=900*scale;
      c.save();c.translate(left,top);c.scale(scale,scale);
      c.beginPath();c.rect(0,0,864,900);c.clip();
      c.drawImage(images.get("ground"),0,0,864,900);
      for(const item of work.items) {
        const a=catalog[item.asset],[w,h]=a.size;
        c.globalAlpha=a.opacity;
        c.drawImage(images.get(item.asset),item.x-w/2,item.y-h,w,h);
      }
      c.restore();
      c.strokeStyle=night?"#978572":"#c9bfa3";c.lineWidth=1;c.strokeRect(left-.5,top-.5,width+1,height+1);
      c.fillStyle=night?"#e7bd82":"#51705e";c.textAlign="left";c.font="600 14px 'Microsoft YaHei',sans-serif";
      c.fillText("小镇邮局",43,936);
      c.fillStyle=night?"#c8b99d":"#85785e";c.font="12px Georgia,serif";c.fillText("T O W N   P O S T",117,936);
      c.fillStyle=night?"#f7e8c9":"#344a3d";
      const title=titleLines(c,work.title,635);
      const baseY=title.lines.length===1?1003:972;
      title.lines.forEach((line,i)=>c.fillText(line,43,baseY+i*(title.size+3)));
      stamp(c,747,931,paper);
      return await new Promise((ok,fail)=>canvas.toBlob(blob=>blob?ok(blob):fail(new Error("明信片暂时无法导出，请再试一次。")),"image/png"));
    } finally { for (const image of images.values()) image.close?.(); }
  }

  function save(blob,title) {
    check(blob instanceof Blob && blob.type==="image/png","没有可保存的明信片。");
    const filename=cleanText(title,32,"作品名无效。").replace(/[<>:"/\\|?*]/g,"_");
    const url=URL.createObjectURL(blob), a=document.createElement("a");
    a.href=url; a.download=filename+"-小镇明信片.png";
    document.body.append(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }

  window.TownGift = Object.freeze({normalize,encode,decode,resolve,imageBlobs,postcard,save,link,homeURL});
})();

