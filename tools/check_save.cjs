// Run against the local release with playwright-core and Chromium available.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const box = require("../game/assets/levels.json").levels[0];

async function run() {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const puzzle = new URL(process.argv[2] || "http://127.0.0.1:8765/");
    puzzle.search = new URLSearchParams({box:box.id});
    await page.goto(puzzle.href);
    await page.waitForFunction(() => document.querySelector("#total-count").textContent === "14");
    const board = await page.locator("#canvas").boundingBox();
    const fit = Math.min(board.width / 864, board.height / 900);
    const key = "town.stickers.v1." + box.id;
    const ids = [];
    for (const asset of ["bakery", "bookshop"]) {
      const slot = box.slots.find((item) => item.asset === asset);
      await page.locator('[data-slot="' + slot.id + '"]').click();
      await page.mouse.click(
        board.x + board.width / 2 + (slot.anchor[0] - 432) * fit,
        board.y + board.height / 2 + (slot.anchor[1] - 452) * fit,
      );
      ids.push(slot.id);
      await page.waitForFunction(n => +document.querySelector("#placed-count").textContent === n, ids.length);
      assert.deepEqual(await page.evaluate(k => JSON.parse(localStorage.getItem(k)), key), ids);
    }
    await page.locator("#undo").click();
    ids.pop();
    assert.deepEqual(await page.evaluate(k => JSON.parse(localStorage.getItem(k)), key), ids);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#placed-count").textContent === "1");
    assert.equal(await page.locator("#undo").isEnabled(), true);
    console.log("PASS: each placement and undo is saved before refresh, and the board resumes correctly.");
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
