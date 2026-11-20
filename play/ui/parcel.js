/* An exported parcel contains its entire game, artwork and rules in a single HTML file. */
(() => {
  "use strict";

  // This function is serialized into the file. Keep it independent of its parent's environment.
  async function playOffline() {
    "use strict";
    const $=id=>document.getElementById(id), board=$("board"), status=$("status");
    try {
      const pack=JSON.parse($("contents").textContent);
      $("contents").remove();
      const night=pack.ambience==="night";
      document.documentElement.classList.toggle("night",night);
      document.title=pack.title+" · 小镇拼图";
      $("title").textContent=pack.title;
      $("original-title").textContent=pack.title;
      const load=async url=>{const img=new Image();img.src=url;await img.decode();return img;};
      const background=await load(pack.ground);
      const sprites=Object.create(null);
      await Promise.all(Object.entries(pack.art).map(async ([id,art])=>{
        const img=await load(art.data);
        const mask=document.createElement("canvas");
        mask.width=Math.max(1,Math.round(art.size[0])); mask.height=Math.max(1,Math.round(art.size[1]));
        const g=mask.getContext("2d",{willReadFrequently:true});
        g.drawImage(img,0,0,mask.width,mask.height);
        const rgba=g.getImageData(0,0,mask.width,mask.height).data;
        g.globalCompositeOperation="source-in";g.fillStyle="#995936";g.fillRect(0,0,mask.width,mask.height);
        sprites[id]={...art,img,mask,rgba};
      }));
      const placed=new Set(), buttons=[], items=pack.items;
      let selected=0,drag=null,cursor=null;
      const paper=night?"#293746":"#f4f0df";
      const at=(e)=>{const b=board.getBoundingClientRect();return [(e.clientX-b.left)*864/b.width,(e.clientY-b.top)*900/b.height];};
      const announce=message=>{status.textContent=message;};
      function render(target=board,original=false) {
        const c=target.getContext("2d");
        c.setTransform(target.width/864,0,0,target.height/900,0,0);
        c.imageSmoothingQuality="high";c.globalAlpha=1;c.fillStyle=paper;c.fillRect(0,0,864,900);c.drawImage(background,0,0,864,900);
        for(const [i,it] of items.entries()) {
          if(!original && !placed.has(i))continue;
          const a=sprites[it.asset],[w,h]=a.size;
          c.globalAlpha=a.opacity;c.drawImage(a.img,it.x-w/2,it.y-h,w,h);
        }
        c.globalAlpha=1;
        if(!original && selected>=0) {
          const it=items[selected],a=sprites[it.asset],[w,h]=a.size;
          c.save();c.globalAlpha=.5;c.shadowColor="#fff8df";c.shadowBlur=6;
          c.drawImage(a.mask,it.x-w/2,it.y-h,w,h);c.restore();
          // Mark the floor anchor as well as the silhouette, including completely overlaid pieces.
          c.save();c.beginPath();c.ellipse(it.x,it.y,12,5,0,0,2*Math.PI);
          c.strokeStyle="#fff9e8";c.lineWidth=4;c.stroke();c.strokeStyle="#9a613a";c.lineWidth=1.5;c.stroke();c.restore();
          if(cursor) {
            c.save();c.lineWidth=3;c.strokeStyle="#315a4a";c.beginPath();
            c.arc(cursor[0],cursor[1],11,0,2*Math.PI);c.moveTo(cursor[0]-15,cursor[1]);c.lineTo(cursor[0]+15,cursor[1]);
            c.moveTo(cursor[0],cursor[1]-15);c.lineTo(cursor[0],cursor[1]+15);c.stroke();c.restore();
          }
        }
      }
      function update() {
        const done=placed.size===items.length;
        $("count").textContent=placed.size+" / "+items.length;
        $("bar").value=placed.size;$("bar").max=items.length;
        $("tray").hidden=done;$("hint").hidden=done;$("finish").hidden=!done;
        buttons.forEach((b,i)=>{b.hidden=placed.has(i);b.setAttribute("aria-pressed",String(i===selected));});
        render();
      }
      function choose(i,say=true) {
        if(placed.has(i))return;
        selected=i;cursor=null;
        if(say)announce("已选中"+sprites[items[i].asset].name+"，轻点场景中的轮廓。");
        update();
      }
      function submit(x,y) {
        if(selected<0)return;
        const it=items[selected],a=sprites[it.asset],[w,h]=a.size;
        const px=Math.floor((x-it.x+w/2)*a.mask.width/w),py=Math.floor((y-it.y+h)*a.mask.height/h);
        const inside=px>=0 && py>=0 && px<a.mask.width && py<a.mask.height && a.rgba[(py*a.mask.width+px)*4+3]>18;
        const view=board.getBoundingClientRect();
        const radius=Math.min(44,Math.max(22,14*864/Math.max(view.width,1)));
        if(!inside && Math.hypot(x-it.x,y-it.y)>radius){
          announce("再靠近一点，贴到暖棕色的轮廓或它脚下的小圆圈。");return;
        }
        placed.add(selected);cursor=null;
        selected=items.findIndex((_,i)=>!placed.has(i));
        if(selected<0){announce("小镇拼好了！可以查看朋友的原作。");}
        else announce(a.name+"已贴好。下一张是"+sprites[items[selected].asset].name+"。");
        update();
        if(selected<0)$("see").focus({preventScroll:true});
      }
      const occurrences=new Map();
      for(const [i,it] of items.entries()) {
        const a=sprites[it.asset],b=document.createElement("button"),icon=document.createElement("img"),label=document.createElement("span");
        const n=(occurrences.get(it.asset)||0)+1;occurrences.set(it.asset,n);
        b.type="button";b.className="piece";b.dataset.index=String(i);
        label.textContent=a.name+(items.filter(v=>v.asset===it.asset).length>1?" · "+n:"");
        icon.src=a.data;icon.alt="";icon.draggable=false;b.append(icon,label);buttons.push(b);$("tray").append(b);
        b.addEventListener("click",()=>choose(i));
        b.addEventListener("pointerdown",e=>{
          if(e.button!==0 || !e.isPrimary)return;
          choose(i,false);drag={pointer:e.pointerId,index:i,x:e.clientX,y:e.clientY,moved:false};
          b.setPointerCapture(e.pointerId);
        });
      }
      window.addEventListener("pointermove",e=>{
        if(!drag || e.pointerId!==drag.pointer)return;
        if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>5)drag.moved=true;
        if(drag.moved){const ghost=$("dragging");ghost.src=sprites[items[drag.index].asset].data;ghost.hidden=false;ghost.style.left=e.clientX+"px";ghost.style.top=e.clientY+"px";}
      });
      function clearDrag(){drag=null;$("dragging").hidden=true;}
      window.addEventListener("pointerup",e=>{
        if(!drag || drag.pointer!==e.pointerId)return;
        if(drag.moved){const [x,y]=at(e);if(x>=0&&x<=864&&y>=0&&y<=900)submit(x,y);}
        clearDrag();
      });
      window.addEventListener("pointercancel",clearDrag);window.addEventListener("blur",clearDrag);
      board.addEventListener("click",e=>{if(e.detail){cursor=null;submit(...at(e));}});
      board.addEventListener("keydown",e=>{
        if(selected<0)return;
        if(e.key==="Enter" || e.key===" "){e.preventDefault();cursor ||= [432,450];submit(...cursor);return;}
        const step=e.shiftKey?66:18, moves={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};
        if(!moves[e.key])return;
        e.preventDefault();cursor ||= [432,450];
        cursor=[Math.min(864,Math.max(0,cursor[0]+moves[e.key][0])),Math.min(900,Math.max(0,cursor[1]+moves[e.key][1]))];render();
      });
      function restart() {
        $("original").close();placed.clear();selected=0;cursor=null;clearDrag();update();
        announce("已经重新摆好贴纸，先贴"+sprites[items[0].asset].name+"。");buttons[0].focus({preventScroll:true});
      }
      $("replay").onclick=restart;$("replay-original").onclick=restart;
      $("see").onclick=()=>{render($("finished-art"),true);$("original").showModal();};
      $("close").onclick=()=>$("original").close();
      $("key-help").textContent="键盘可用 Tab 选贴纸或画布，方向键移光标，Shift 加速，回车贴下。";
      announce("先贴"+sprites[items[0].asset].name+"。");update();
    } catch(e) {
      status.textContent="这封礼物没有读取完整。请重新打开下载好的 HTML 文件，或请朋友再导出一次。";
      $("hint").hidden=true;
    }
  }

  const style=":root{color-scheme:light;--paper:#fcf8eb;--ink:#32483d;--muted:#686a56;--line:#c9bea4;--accent:#385d4b}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;color:var(--ink);background:#f3efdf;font:16px/1.5 system-ui,\"Microsoft YaHei\",sans-serif}main{max-width:1120px;margin:0 auto;padding:clamp(14px,3.4vw,44px)}header{display:flex;align-items:end;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:18px}header p,.overline{margin:0;color:var(--muted);font-size:13px}h1,h2{font-family:\"Songti SC\",SimSun,Georgia,serif;font-weight:600;line-height:1.2;overflow-wrap:anywhere}h1{font-size:clamp(26px,4vw,48px);margin:5px 0 0}#count{font-variant-numeric:tabular-nums;font-size:15px;white-space:nowrap}#bar{display:block;width:86px;height:6px;accent-color:var(--accent);margin-top:7px}.layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,29%);gap:24px;align-items:start}.art{box-shadow:0 3px 14px #594c2a13;border:1px solid var(--line);background:#f4f0df;line-height:0}canvas{width:100%;height:auto;display:block}#board{cursor:crosshair;touch-action:manipulation}button{font:inherit;color:var(--ink);cursor:pointer}button:focus-visible,canvas:focus-visible,summary:focus-visible{outline:3px solid #a95131;outline-offset:2px}aside{min-width:0}h2{font-size:24px;margin:0 0 6px}p{margin:0 0 10px}#status{min-height:2.6em;color:var(--muted);font-size:14px;margin-bottom:12px}#tray{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.piece{border:1px solid var(--line);border-radius:8px;background:var(--paper);padding:5px 3px 6px;min-height:64px;line-height:1.25;touch-action:none}.piece img{display:block;object-fit:contain;width:100%;height:47px;margin-bottom:3px}.piece span{font-size:12px;display:block}.piece[aria-pressed=true]{border:2px solid var(--accent);background:#e1e8d5;padding:4px 2px 5px}.action{border-radius:6px;border:1px solid var(--accent);padding:9px 15px;background:var(--accent);color:#fffdf3;margin:3px 6px 3px 0}.plain{color:var(--ink);background:transparent}details{margin-top:16px;color:var(--muted);font-size:13px}summary{cursor:pointer}#dragging{position:fixed;pointer-events:none;z-index:5;width:62px;height:62px;object-fit:contain;transform:translate(-50%,-80%);filter:drop-shadow(0 3px 3px #453c2c55)}dialog{color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:9px;padding:16px;max-width:min(94vw,660px);max-height:94dvh;overflow:auto}dialog::backdrop{background:#24382f99}dialog header{margin:0 0 8px;padding:0 0 8px;align-items:center}dialog canvas{width:auto;max-width:100%;max-height:66dvh;margin:auto}dialog h2{font-size:22px}#close{border:1px solid var(--line);border-radius:4px;background:transparent;padding:6px 9px;white-space:nowrap}@media(max-width:680px){main{padding:12px}header{margin-bottom:10px;padding-bottom:9px}.layout{grid-template-columns:1fr;gap:12px}.art{max-width:min(100%,60dvh);margin:0 auto;width:100%}#tray{display:flex;gap:6px;flex-wrap:wrap}.piece{width:calc((100% - 24px)/5);min-width:48px}.piece img{height:36px}#status{min-height:0;margin-bottom:8px}h2{font-size:20px}details{margin-top:8px}}";
  const body="<main><header><div><p>小镇邮局 · 拼图来信</p><h1 id=\"title\">正在拆开礼物</h1></div><div><strong id=\"count\" aria-label=\"拼贴进度\"></strong><progress id=\"bar\" aria-label=\"拼贴进度\" max=\"1\" value=\"0\"></progress></div></header><div class=\"layout\"><div class=\"art\"><canvas id=\"board\" width=\"1296\" height=\"1350\" tabindex=\"0\" aria-label=\"拼图画布，按方向键移动光标，回车贴下\"></canvas></div><aside><h2>贴纸盘</h2><p id=\"status\" role=\"status\" aria-live=\"polite\">正在读取贴纸…</p><div id=\"tray\" aria-label=\"可选贴纸\"></div><details id=\"hint\"><summary>怎么玩</summary><p>选一张贴纸，点一下暖棕色轮廓。也可以从贴纸盘直接拖进去。</p><p id=\"key-help\"></p></details><div id=\"finish\" hidden><button type=\"button\" class=\"action\" id=\"see\">查看原作</button><button type=\"button\" class=\"action plain\" id=\"replay\">重新拼</button></div></aside></div></main><img id=\"dragging\" hidden alt=\"\"><dialog id=\"original\" aria-labelledby=\"original-title\"><header><div><p>朋友的原作</p><h2 id=\"original-title\"></h2></div><button id=\"close\" type=\"button\">关闭</button></header><canvas id=\"finished-art\" width=\"1296\" height=\"1350\" aria-label=\"朋友寄来的完整作品\"></canvas><button type=\"button\" class=\"action\" id=\"replay-original\">重新拼</button></dialog>";

  function dataURL(blob) {
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error("无法将贴纸装进礼物文件，请重试。"));reader.readAsDataURL(blob);
    });
  }

  async function download(input) {
    const {work,catalog,ground,images}=await window.TownGift.imageBlobs(input);
    const entries=await Promise.all(Object.values(catalog).map(async a=>[a.id,{name:a.name,size:a.size,opacity:a.opacity,data:await dataURL(images[a.id])}]));
    const payload={title:work.title,items:work.items,ground:await dataURL(ground),art:Object.fromEntries(entries)};
    if (work.ambience==="night") payload.ambience="night";
    // Prevent a title or catalog label from terminating the non-executable JSON island.
    const embedded=JSON.stringify(payload).replace(/[<>&\u2028\u2029]/g,ch=>"\\u"+ch.charCodeAt(0).toString(16).padStart(4,"0"));
    const doc='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; connect-src \'none\'; base-uri \'none\'; form-action \'none\'">'+
      '<title>小镇拼图礼物</title><style>'+style+
      ':root.night{color-scheme:dark;--paper:#35434b;--ink:#f5e8cd;--muted:#d0c0a6;--line:#79756c;--accent:#dcaf78}'+
      '.night body,.night .art{background:#29363f}.night .piece[aria-pressed=true]{background:#514a40}'+
      '.night .action:not(.plain){color:#2c3437}.night dialog::backdrop{background:#18232cbb}'+
      '</style></head><body>'+body+
      '<script type="application/json" id="contents">'+embedded+'</script><script>('+playOffline.toString()+')();</script></body></html>';
    const blob=new Blob([doc],{type:"text/html;charset=utf-8"}),url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=work.title.replace(/[<>:"/\\|?*]/g,"_")+"-离线拼图.html";
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    return blob;
  }
  window.townParcel=Object.freeze({download});
})();
