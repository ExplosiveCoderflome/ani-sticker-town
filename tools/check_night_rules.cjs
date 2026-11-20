// Run with node tools/check_night_rules.cjs. The rules have no browser dependencies.
const assert = require('node:assert/strict');
global.window = {};
require('../play/ui/night-rules.js');
const {plan} = window.NightMarketRules;

function slot(role, id, x, y, z) {
  return {id, role, asset: 'custom-' + role, anchor: [x, y], z};
}
const customer = slot('customer', 'visitor-a', 100, 240, 0);
const stall = slot('stall', 'stand-1', 345, 240, 1);
const table = slot('table', 'desk-1', 560, 240, 2);
const chair = slot('chair', 'seat-1', 645, 240, 3);
const scene = Object.freeze([customer, stall, table, chair]);
const visit = plan({slots: scene})[0];
assert.deepEqual(visit, {
  id: 'market-buy', customerId: customer.id, stallId: stall.id, tableId: table.id, chairId: chair.id,
  actors: scene.map(s => ({asset: s.asset, x: s.anchor[0], y: s.anchor[1], z: s.z})),
});
assert.deepEqual(plan({slots: [...scene].reverse()}), [visit]);
assert.deepEqual(plan({slots: scene}, 'absent'), []);
assert.deepEqual(plan({slots: [customer, {...stall, anchor: [345, 241]}]}), []);
assert.equal(plan({slots: [customer, stall, {...table, anchor: [560, 241]}, chair]})[0].actors.length, 2);
assert.equal(plan({slots: [customer, stall, table, {...chair, anchor: [645, 241]}]})[0].actors.length, 2);
assert.equal(plan({slots: [customer, stall, chair]})[0].chairId, undefined);

const middle = slot('customer', 'visitor-b', 400, 340, 4);
const left = slot('stall', 'stand-a', 375, 340, 5);
const right = slot('stall', 'stand-b', 425, 340, 6);
const next = slot('customer', 'visitor-c', 424, 340, 7);
const desk = slot('table', 'desk-2', 390, 340, 8);
const seatA = slot('chair', 'seat-a', 400, 340, 9);
const seatB = slot('chair', 'seat-b', 380, 340, 10);
const otherDesk = slot('table', 'desk-0', 372, 340, 11);
const otherSeat = slot('chair', 'seat-0', 319, 340, 12);
const grouped = [next, right, middle, left, seatB, otherDesk, seatA, desk, otherSeat];
const visits = plan({slots: grouped});
assert.deepEqual(visits.map(v => [v.customerId, v.stallId]), [[middle.id, left.id], [next.id, right.id]]);
assert.deepEqual(plan({slots: grouped}, next.id), [visits[1]]);
assert.equal(visits[1].tableId, desk.id);
assert.equal(visits[1].chairId, seatA.id);
assert.deepEqual(visits, plan({slots: [...grouped].reverse()}));

// Both tables reach the same chair, but the nearer table would require a detour.
const routes = [customer, {...stall, anchor: [100, 100]}, {...table, anchor: [100, 80]},
  {...otherDesk, anchor: [135, 100]}, {...chair, anchor: [151, 100]}];
assert.equal(plan({slots: routes})[0].tableId, otherDesk.id);

assert.deepEqual(plan(null), []);
assert.deepEqual(plan({slots: [customer, {...stall, id: customer.id}]}), []);
assert.deepEqual(plan({slots: [customer, {...stall, anchor: [-1, 240]}, {...stall, anchor: [100, NaN]}]}), []);
assert.deepEqual(plan({slots: [customer, {...stall, role: 'prop'}]}), []);
console.log('PASS night market proximity, optional seating, independent roles/instances, ties, bounds and input validation.');
