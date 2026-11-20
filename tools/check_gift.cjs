// Run with Node, playwright-core and Chrome/Chromium. No running game server is required.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {chromium} = require("playwright-core");

const root=path.resolve(__dirname,"..");
const media=path.join(root,"play","media");
const custom="gen-"+"a".repeat(32), missing="gen-"+"b".repeat(32);
const png=fs.readFileSync(path.join(root,"weekend-town","stickers","dog.png"));
const mime={".webp":"image/webp",".json":"application/json",".js":"text/javascript"};
const server=http.createServer((req,res)=>{
  const route=new URL(req.url,"http://localhost").pathname;
  if (route === "/") {
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
    res.end('<meta charset=utf-8><script src="/ui/gift.js"></script><script src="/ui/parcel.js"></script><body></body>');return;
  }
  const api="/api/stickers/"+custom;
  if(route===api){
    res.writeHead(200,{"Content-Type":"application/json"});
    res.end(JSON.stringify({id:custom,name:"小狗",width:png.readUInt32BE(16),height:png.readUInt32BE(20),size:[36,42],image:api+"/image.png"}));return;
  }
  if(route===api+"/image.png"){res.writeHead(200,{"Content-Type":"image/png"});res.end(png);return;}
  const file=["/ui/gift.js","/ui/parcel.js"].includes(route)?path.join(root,"play",route.slice(1)):
    /^\/media\/(?:levels\.json|ground\.webp|preview-1\.webp|stickers\/[a-z-]+\.webp)$/.test(route)?path.join(media,route.slice(7)):null;
  if(file && fs.existsSync(file)){res.writeHead(200,{"Content-Type":mime[path.extname(file)]});fs.createReadStream(file).pipe(res);return;}
  res.writeHead(404);res.end();
});

async function run(){
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin="http://127.0.0.1:"+server.address().port;
  const executable=process.env.CHROME_BIN ||
    (process.platform==="win32" ? path.join(process.env.ProgramFiles,"Google","Chrome","Application","chrome.exe") : undefined);
  const browser=await chromium.launch({executablePath:executable});
  try{
    const page=await browser.newPage();
    const urls=[];page.on("request",r=>urls.push(r.url()));
    await page.goto(origin+"/?box=afternoon-v1");
    const result=await page.evaluate(async({custom,missing})=>{
      const g=window.TownGift, cfg=await (await fetch("/media/levels.json")).json();
      const base=cfg.levels[0];
      const work={version:1,title:"广场的面包香",base:base.id,items:base.slots.map(s=>({asset:s.asset,x:s.anchor[0],y:s.anchor[1],z:s.z}))};
      const tag=g.encode(work);
      function check(condition,msg){if(!condition) throw new Error(msg);}
      function raises(fn){try { fn();return false; } catch{return true;}}
      const broken=location.origin+"/collect?private=1";
      check(JSON.stringify(g.normalize(work))===JSON.stringify(g.decode(tag)),"round-trip");
      check(g.encode(g.decode(tag))===tag && g.link(work)===location.origin+"/"+tag,"canonical URL");
      check(g.decode("#section")===null && raises(()=>g.decode("#gift=$$")),"bad link");
      check(raises(()=>g.decode("#gift="+"A".repeat(2500))) && raises(()=>g.encode({...work,version:2})),"size and version");
      check(raises(()=>g.encode({...work,title:"x".repeat(33)})) && raises(()=>g.encode({...work,title:"x\u0000"})),"titles");
      const altered=(patch)=>({...work,items:[{...work.items[0],...patch}]});
      check(raises(()=>g.encode(altered({asset:broken}))) && raises(()=>g.encode(altered({x:865}))) && raises(()=>g.encode({...work,items:[]})),"whitelist and bounds");
      const repeated={...work,items:Array.from({length:15},(_,i)=>({asset:"dog",x:i+.25,y:200,z:16-i}))};
      check(g.decode(g.encode(repeated)).items.length===15 && raises(()=>g.encode({...repeated,items:[...repeated.items,repeated.items[0]]})),"duplicate pieces");
      const withCustom=altered({asset:custom});
      check((await g.resolve(withCustom)).catalog[custom].image==="/api/stickers/"+custom+"/image.png","generated lookup");
      let failed=false;try{await g.resolve(altered({asset:missing}));}catch(e){failed=e.message.includes("当前站点");}
      check(failed,"missing server fallback");
      const blob=await g.postcard(work);window.giftTestBlob=blob;
      const rendered=await createImageBitmap(blob);
      check(rendered.width===1800 && rendered.height===2112 && blob.type==="image/png","output format");
      const ref=await createImageBitmap(await (await fetch("/media/preview-1.webp")).blob());
      function pixels(image,crop) {
        const c=document.createElement("canvas");c.width=216;c.height=225;
        const ctx=c.getContext("2d",{willReadFrequently:true});ctx.imageSmoothingQuality="high";ctx.drawImage(image,...crop,0,0,216,225);return ctx.getImageData(0,0,216,225).data;
      }
      const scene=pixels(rendered,[60,60,1680,1750]),target=pixels(ref,[0,0,864,900]);
      let error=0;for(let i=0;i<target.length;i++) if(i%4!==3) error+=Math.abs(target[i]-scene[i]);
      error/=target.length*.75;check(error<3.5,"artwork pixels "+error);
      const frame=pixels(rendered,[0,0,25,25]);check(frame[0]===252 && frame[1]===247 && frame[2]===232,"paper");
      const stamp=pixels(rendered,[1520,1895,140,115]);
      let green=0;for(let i=0;i<stamp.length;i+=4) if(stamp[i+1]>stamp[i]+15 && stamp[i+1]<160)green++;
      check(green>1000,"postmark");
      const button=document.createElement("button");button.textContent="下载";button.onclick=()=>g.save(blob,work.title);document.body.append(button);
      const packed=window.parcelWork={...work,title:"</script>小镇 <b>夏</b>",items:[
        ...work.items.slice(0,11),{asset:"dog",x:420,y:732,z:125},{asset:"dog",x:420,y:732,z:126},
        {asset:"black-cat",x:550,y:750,z:127},{asset:custom,x:320,y:706,z:128},
      ]};
      const parcelButton=document.createElement("button");parcelButton.textContent="寄给朋友";parcelButton.onclick=()=>window.townParcel.download(packed);
      document.body.append(parcelButton);
      rendered.close();ref.close();
      return {hashCharacters:tag.length,postcardBytes:blob.size,sceneRgbMeanError:+error.toFixed(2)};
    },{custom,missing});
    const downloading=page.waitForEvent("download");
    await page.getByRole("button",{name:"下载"}).click();
    const download=await downloading;
    assert.match(download.suggestedFilename(),/广场的面包香.*\.png$/);
    if(process.argv[2]) await download.saveAs(process.argv[2]);
    assert.ok(urls.every(u=>u.startsWith(origin+"/")||u.startsWith("blob:")),"external request");
    const nextDownload=page.waitForEvent("download");
    await page.getByRole("button",{name:"寄给朋友"}).click();
    const parcel=await nextDownload;
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),"town-parcel-test-"));
    try{
      const file=path.join(temp,"offline.html");
      await parcel.saveAs(file);
      const work=await page.evaluate(()=>TownGift.normalize(window.parcelWork));
      const context=await browser.newContext({offline:true,viewport:{width:390,height:844},hasTouch:true,isMobile:true});
      const offline=await context.newPage(),requests=[];
      offline.on("request",r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
      await offline.goto(pathToFileURL(file).href);
      await offline.locator(".piece").first().waitFor();
      assert.equal(await offline.locator("#title").textContent(),work.title);
      assert.equal(await offline.locator("#title b").count(),0);
      const board=offline.locator("#board");
      await board.focus();
      for(let i=0;i<5;i++)await board.press("Shift+ArrowDown");
      await board.press("Enter");
      await offline.waitForFunction(()=>document.querySelector("#count").textContent==="1 / 15");
      // Use pointer drag for the second item. Switch to a wide viewport to keep tray and board together.
      await offline.setViewportSize({width:1100,height:850});
      const second=work.items[1],btn=offline.locator('.piece[data-index="1"]');
      const tray=await btn.boundingBox(),wide=await board.boundingBox();
      await offline.mouse.move(tray.x+tray.width/2,tray.y+tray.height/2);
      await offline.mouse.down();
      await offline.mouse.move(wide.x+wide.width*second.x/864,wide.y+wide.height*second.y/900,{steps:12});
      await offline.mouse.up();
      await offline.waitForFunction(()=>document.querySelector("#count").textContent==="2 / 15");
      await offline.setViewportSize({width:390,height:844});
      for(let i=2;i<work.items.length;i++){
        const item=work.items[i],r=await board.boundingBox();
        await offline.locator('.piece[data-index="'+i+'"]').tap();
        await board.tap({position:{x:r.width*item.x/864,y:r.height*item.y/900}});
        await offline.waitForFunction(n=>document.querySelector("#count").textContent===n+" / 15",i+1);
      }
      await offline.getByRole("button",{name:"查看原作"}).tap();
      assert.equal(await offline.locator("#original").isVisible(),true);
      await offline.locator("#replay-original").tap();
      assert.equal(await offline.locator("#count").textContent(),"0 / 15");
      assert.equal(await offline.locator(".piece:visible").count(),15);
      assert.deepEqual(requests,[]);
      await context.close();
      result.offlineHtmlBytes=fs.statSync(file).size;
      result.offlinePieces=15;
      result.offlineNetworkRequests=requests.length;
    } finally {fs.rmSync(temp,{force:true,recursive:true});}
    console.log(JSON.stringify(result));
  } finally {await browser.close();server.close();}
}
run().catch(error=>{console.error(error);server.close();process.exitCode=1;});

