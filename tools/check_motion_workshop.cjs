// Browser half of check_motion_workshop.py. The Python runner supplies an isolated server.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const {chromium} = require("playwright-core");

async function run(page, origin, captureDir, theme) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (/SCRIPT ERROR|Parse Error/.test(message.text())) errors.push(message.text());
  });
  // Observe state and real engine callbacks without issuing any game commands.
  await page.addInitScript(() => {
    let ui;
    window.observed = {sales:[], done:[]};
    Object.defineProperty(window, "townUI", {configurable:true, get:() => ui, set(value) {
      for (const key of ["ready","sync","marketSale","marketDone"]) {
        const original = value[key];
        value[key] = function(...args) {
          if (key === "ready" || key === "sync") window.observed.state = JSON.parse(args[0]);
          else window.observed[key === "marketSale" ? "sales" : "done"].push(args);
          return original.apply(this,args);
        };
      }
      ui = value;
    }});
  });
  const requests = [];
  page.on("response", response => {
    if (new URL(response.url()).pathname.endsWith("/motions/generate")) {
      requests.push([response.request().postDataJSON().action,response.status()]);
    }
  });
  const create = page.locator("#paint-create");
  const waitBox = () => page.waitForFunction(name => {
    const s = window.observed.state;
    return s?.marketMode && s.marketTheme === name && s.motionBindings[s.marketKit[3]]?.length === 3;
  }, theme);
  await page.goto(new URL("/?workshop=1",origin).href);
  await page.locator("#paint-prompt").fill(theme);
  await page.locator("#motion-plan:checked").waitFor();
  await create.click();
  await page.waitForFunction(() => /2\s*\/\s*4\s*组/.test(document.getElementById("studio-status").textContent) &&
    !document.getElementById("paint-create").disabled);
  assert.deepEqual(requests,[["walk",201],["receive",201],["use",502]]);
  const partial = await (await page.request.get(new URL("/api/stickers",origin).href)).json();
  const actor = partial.stickers.find(s => s.role === "customer").id;
  const motionsURL = new URL("/api/stickers/"+actor+"/motions",origin).href;
  const partialMotion = (await (await page.request.get(motionsURL)).json()).motions[0];
  assert.deepEqual(partialMotion.actions,["walk","receive"]);
  assert.equal(partialMotion.ready,false);

  await page.reload();
  await page.locator("#paint-prompt").waitFor();
  assert.equal(await page.locator("#paint-prompt").inputValue(),theme);
  await create.click();
  await waitBox();
  assert.deepEqual(requests.slice(3),[["use",201],["carry",201]]);
  const state = await page.evaluate(() => window.observed.state);
  const ids = state.marketKit;
  assert.equal(state.marketProfile,"studio");
  assert.equal(new Set(ids).size,4);
  assert.deepEqual(ids.map(id=>state.catalog.find(entry=>entry.asset===id).role),["stall","table","chair","customer"]);
  assert.deepEqual(state.motionBindings[actor],ids.slice(0,3));
  const finished = (await (await page.request.get(motionsURL)).json()).motions[0];
  assert.deepEqual(finished.actions,["walk","receive","use","carry"]);
  assert.equal(finished.source,"recraft");

  await page.locator('[data-slot="kit:'+actor+'"]').click();
  const canvas = page.locator("#canvas");
  await canvas.scrollIntoViewIfNeeded();
  const rect = await canvas.boundingBox();
  const scale = Math.min(rect.width/864,rect.height/900);
  const screen = (x,y) => [rect.x+rect.width/2+(x-432)*scale,rect.y+rect.height/2+(y-450)*scale];
  const height = state.catalog.find(entry=>entry.asset===actor).size[1];
  await page.mouse.click(...screen(262,639-height/2));
  const clipStart = screen(190,395), clipEnd = screen(580,675);
  const clip = {x:Math.floor(clipStart[0]),y:Math.floor(clipStart[1]),
    width:Math.ceil(clipEnd[0]-clipStart[0]),height:Math.ceil(clipEnd[1]-clipStart[1])};
  const deadline = Date.now()+25000;
  let index = 0;
  while (Date.now()<deadline && !await page.evaluate(() => window.observed.done.length)) {
    await page.screenshot({clip,path:path.join(captureDir,String(index++).padStart(3,"0")+".png")});
    await page.waitForTimeout(55);
  }
  await page.locator("#market-step-stay.found").waitFor();
  const events = await page.evaluate(()=>window.observed);
  assert.deepEqual(events.sales,[[events.state.slots.find(s=>s.asset===actor).id,events.state.slots.find(s=>s.asset===ids[0]).id]]);
  assert.deepEqual(events.done,[[...events.sales[0],true]]);
  await fs.writeFile(path.join(captureDir,"geometry.json"),JSON.stringify({scale,height}));
  await page.locator("#market-reopen").click();
  await page.waitForFunction(()=>window.observed.done.length===2);
  assert.deepEqual(await page.evaluate(()=>window.observed.sales),[events.sales[0],events.sales[0]]);

  await page.reload();
  await page.waitForFunction(() => !!window.observed.state);
  if (!await page.locator("#sticker-studio[open]").count()) await page.locator("#workshop-enter").click();
  await page.locator('[data-panel="library-panel"]').click();
  const saved = page.locator("#atelier-recent button").filter({hasText:theme});
  assert.match(await saved.innerText(),/含角色动作/);
  await saved.click();
  await waitBox();
  const restored = await page.evaluate(()=>window.observed.state);
  assert.deepEqual(restored.marketKit,ids);
  assert.deepEqual(restored.motionBindings[actor],ids.slice(0,3));
  const geometry = s => s.slots.map(({asset,anchor}) => [asset,anchor]);
  assert.deepEqual(geometry(restored),geometry(events.state));
  await page.locator("#market-step-stay.found").waitFor();
  await page.waitForFunction(()=>window.observed.done.length>0);
  assert.equal(requests.length,5);
  assert.deepEqual(errors,[]);
  console.log("PASS browser: interrupted at 2/4, resumed after reload, real sale and replay, restored animated kit and layout from collection.");
}

(async () => {
  const [origin, captureDir, theme] = process.argv.slice(2);
  const browser = await chromium.launch({args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
  try {
    const page = await browser.newPage({viewport:{width:1320,height:900},reducedMotion:"no-preference"});
    page.setDefaultTimeout(45000);
    await run(page,origin,captureDir,theme);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
