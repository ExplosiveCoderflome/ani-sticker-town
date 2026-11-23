// Run against a served build in a fresh Chromium profile, with playwright-core available.
const assert = require("node:assert/strict");
const {chromium} = require("playwright-core");

async function run() {
  const base = new URL(process.argv[2] || "http://127.0.0.1:8765/");
  const browser = await chromium.launch({args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
  try {
    const page = await browser.newPage({viewport:{width:1280,height:900},reducedMotion:"reduce"});
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on("pageerror",error => errors.push(error.message));
    const canvas = page.locator("#canvas");
    const wish = id => page.locator('[data-wish="' + id + '"].is-done');
    const claimed = () => page.evaluate(() => JSON.parse(localStorage.getItem("town.story.letters.v1")).claimed);
    async function letter(id) {
      await page.locator('#story-task[data-chapter="' + id + '"]').waitFor({state:"visible"});
    }
    async function collect() {
      await page.locator("#story-claim").click();
      await page.locator("#story-next").click();
    }
    async function point(x,y) {
      await canvas.scrollIntoViewIfNeeded();
      const r = await canvas.boundingBox(), scale = Math.min(r.width/864,r.height/900);
      return [r.x+r.width/2+(x-432)*scale,r.y+r.height/2+(y-450)*scale];
    }
    async function move(asset,chapter,x,y) {
      const item = await page.evaluate(([assetId,story]) => {
        const draft = JSON.parse(localStorage.getItem("town.stickers.v1.story.v1." + story));
        return draft.items.find(piece => piece.asset === assetId);
      },[asset.id,chapter]);
      const lift = asset.size[1]*.52;
      const start = await point(item.x,item.y-lift), end = await point(x,y-lift);
      await page.mouse.move(...start); await page.mouse.down();
      await page.mouse.move(...end,{steps:12}); await page.mouse.up();
    }
    async function kit(name) {
      const response = await page.request.get(new URL("/api/stickers/"+name,base).href);
      assert.ok(response.ok());
      return Object.fromEntries((await response.json()).stickers.map(asset => [asset.role,asset]));
    }
    const [market,books] = await Promise.all([kit("seaside-market"),kit("bookshop")]);
    await page.goto(new URL("/?story=festival",base).href);
    await page.locator("#story-start").waitFor();
    assert.ok(await page.locator('[data-open-letter="festival"]').isDisabled());
    await page.locator("#story-start").click(); await letter("seaside");
    await page.mouse.click(...await point(310,636-market.customer.size[1]/2));
    await wish("supper").waitFor(); assert.deepEqual(await claimed(),[]);
    await collect(); await letter("books");
    await move(books.chair,"books",526,627); await move(books.customer,"books",345,650);
    await wish("reading").waitFor(); await collect(); await letter("festival");

    await move(market.customer,"festival",246,654);
    await wish("take-away").waitFor();
    await page.reload(); await letter("festival"); await wish("take-away").waitFor();
    await move(books.customer,"festival",635,655);
    await page.locator("#market-reopen:enabled").waitFor();
    assert.equal(await wish("read-here").count(),0);
    await move(books.table,"festival",600,620);
    await wish("read-here").waitFor(); await collect();
    assert.deepEqual(await claimed(),["seaside","books","festival"]);
    const downloading = page.waitForEvent("download");
    await page.locator("#story-postcard").click();
    assert.equal((await downloading).suggestedFilename(),"街角来信-纪念明信片.png");
    await page.locator("#story-keepsake").click();
    const selected = page.locator('#stickers [aria-pressed="true"]');
    await selected.filter({hasText:"街角蓝邮筒"}).waitFor();
    assert.deepEqual(errors,[]);
    console.log("PASS three playable letters, unfinished and resumed wishes, explicit claims, postcard and garden reward.");
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
