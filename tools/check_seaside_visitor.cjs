// Run against a local game server with playwright-core available.
const assert = require("node:assert/strict");
const {chromium} = require("playwright-core");

async function play(browser, origin, reducedMotion, theme) {
  const page = await browser.newPage({viewport:{width:1280,height:900},reducedMotion});
  page.setDefaultTimeout(45000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (/SCRIPT ERROR|Parse Error/.test(message.text())) errors.push(message.text()); });
  const books = theme === "books";
  const box = await (await page.request.get(new URL("/api/stickers/"+(books ? "bookshop" : "seaside-market"),origin).href)).json();
  const assets = Object.fromEntries(box.stickers.map(asset => [asset.role,asset]));
  async function point(x,y) {
    const canvas = page.locator("#canvas");
    await canvas.scrollIntoViewIfNeeded();
    const rect = await canvas.boundingBox(), scale = Math.min(rect.width/864,rect.height/900);
    return [rect.x+rect.width/2+(x-432)*scale, rect.y+rect.height/2+(y-450)*scale];
  }
  async function drag(start,end) {
    await page.mouse.move(...await point(...start)); await page.mouse.down();
    await page.mouse.move(...await point(...end),{steps:12}); await page.mouse.up();
  }
  const count = () => page.locator("#market-sales").textContent();
  const replay = page.locator("#market-reopen");
  const done = () => page.locator("#market-reopen:enabled").waitFor();
  try {
    await page.goto(new URL("/?story=1",origin).href);
    await page.locator('.cover-samples a[href="?market='+theme+'"]').click();
    const visitor = page.locator('[data-slot="kit:' + assets.customer.id + '"]');
    await visitor.click();
    await page.mouse.click(...await point(264,650-assets.customer.size[1]/2));
    await page.locator("#market-step-stay.found").waitFor();
    await done();
    assert.equal(new URL(page.url()).searchParams.get("market"),theme);
    assert.equal(await count(),"1");

    // Move the real stool out of reach and let the new layout trigger the next visit.
    const lift = assets.chair.size[1]/2;
    await drag([525,620-lift],[700,738-lift]);
    await page.locator("#market-step-away.found").waitFor();
    await done();
    assert.equal(await count(),"2");
    assert.equal(await page.locator("#market-found").textContent(),"2 / 2");

    if (!books) {
      // The seaside stool can be used by itself.
      await page.mouse.click(...await point(485,594-assets.table.size[1]*0.70));
      await page.locator("#remove:enabled").click();
      await drag([700,738-lift],[300,592-lift]);
      await page.waitForFunction(() => document.querySelector("#market-status").textContent.includes("小凳上坐下吃"));
      await done();
      assert.equal(await count(),"3");
    }
    await replay.click();
    await page.waitForFunction(() => document.querySelector("#market-sales").textContent === "1");
    await done();
    await page.reload();
    await page.locator("#market-step-stay.found").waitFor();
    await page.locator("#market-step-away.found").waitFor();
    assert.deepEqual(errors,[]);
    console.log("PASS "+theme+" cover shortcut, two endings, one transfer per visit, replay and saved discoveries ("+reducedMotion+").");
  } finally { await page.close(); }
}

(async () => {
  const origin = new URL(process.argv[2] || "http://127.0.0.1:8765/");
  const browser = await chromium.launch({args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
  try {
    for (const theme of ["seaside","books"]) {
      await play(browser,origin,"no-preference",theme);
      await play(browser,origin,"reduce",theme);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
