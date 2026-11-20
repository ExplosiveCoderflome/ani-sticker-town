"use strict";
const assert = require("node:assert/strict");
global.window = {};
require("../play/ui/encounters.js");
const {entries, discover} = window.TownEncounters;
const piece = (asset, x, y, z = 0) => ({asset, x, y, z});
const find = (...items) => discover({items});
assert.deepEqual(discover(), []);
assert.deepEqual(find(piece("black-cat", 10, 100), piece("bench", 200, 100)), []);
for (const [id, a, b, limit] of [
  ["cat-bench", "black-cat", "bench", 84],
  ["dog-song", "dog", "musician", 82],
  ["flower-hello", "florist", "flower-cart", 112]
]) {
  const source = piece(a, 300, 350), edge = piece(b, 300 + limit, 350);
  assert.equal(find(source, edge)[0].id, id);
  assert.deepEqual(find(source, piece(b, edge.x + 1, edge.y)), []);
  assert.equal(find(source, edge, piece(b, 300, 350, 3))[0].actors[1].z, 3);
}
const tree = piece("tree", 300, 400);
const table = piece("cafe-table", 390, 400);
const chair = piece("cafe-chair", 430, 400);
const cat = piece("black-cat", 300, 300), left = piece("bench", 280, 300, 1), right = piece("bench", 320, 300, 2);
assert.deepEqual(find(cat, left, right)[0].actors, [cat, right]);
assert.deepEqual(find(cat, left, right), find(right, cat, left));
const otherCat = piece("black-cat", 580, 440, 5), otherBench = piece("bench", 626, 440, 6);
const alone = piece("black-cat", 800, 650, 8);
const pairs = {items: [cat, left, otherCat, otherBench, alone]};
assert.deepEqual(discover(pairs)[0].actors, [cat, left]);
assert.deepEqual(discover(pairs, {asset: "black-cat", z: 5})[0].actors, [otherCat, otherBench]);
assert.deepEqual(discover(pairs, {asset: "bench", z: 6})[0].actors, [otherCat, otherBench]);
assert.deepEqual(discover(pairs, {asset: "black-cat", z: 8}), []);
assert.deepEqual(discover(pairs, {asset: "black-cat", z: 6}), []);
assert.deepEqual(discover(pairs, {asset: "dog", z: 5}), []);
assert.deepEqual(find(tree, table), []);
assert.deepEqual(find(tree, piece("cafe-table", 300, 479), piece("cafe-chair", 310, 482)), []);
assert.deepEqual(find(tree, table, piece("cafe-table", 530, 400), piece("cafe-chair", 550, 400)), []);
assert.deepEqual(find(tree, table, chair)[0], {
  id: "tree-coffee", actors: [tree, table, chair], point: {x: 390, y: 370}
});
const cast = entries.flatMap((entry, i) => entry.actors.map((a, j) => piece(a, 100 + 180*i, 400, j)));
assert.deepEqual(find(...cast).map(e => e.id), entries.map(e => e.id));
assert.deepEqual(find(...cast), find(...cast.slice().reverse()));
console.log("All four street encounters, distances, overlaps, duplicates and shared-table cases passed.");
