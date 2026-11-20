(() => {
  "use strict";

  function distance(a, b) {
    return Math.hypot(a.anchor[0] - b.anchor[0], a.anchor[1] - b.anchor[1]);
  }

  function plan(state, customerId) {
    if (!Array.isArray(state?.slots)) return [];
    const roles = {customer: [], stall: [], table: [], chair: []};
    const slots = state.slots.filter(slot => slot && Object.hasOwn(roles, slot.role) &&
      typeof slot.id === "string" && slot.id && typeof slot.asset === "string" && slot.asset &&
      Number.isFinite(slot.z) && Array.isArray(slot.anchor) && slot.anchor.length === 2 &&
      slot.anchor.every(Number.isFinite) && slot.anchor[0] >= 0 && slot.anchor[0] <= 864 &&
      slot.anchor[1] >= 0 && slot.anchor[1] <= 900);
    slots.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const [index, slot] of slots.entries()) {
      if (slots[index - 1]?.id !== slot.id && slots[index + 1]?.id !== slot.id) {
        roles[slot.role].push(slot);
      }
    }

    const visits = [];
    for (const customer of roles.customer) {
      if (customerId !== undefined && customer.id !== customerId) continue;
      let stall, walk = Infinity;
      for (const candidate of roles.stall) {
        const step = distance(customer, candidate);
        if (step <= 245 && step < walk) { stall = candidate; walk = step; }
      }
      if (!stall) continue;

      let seating, shortest = Infinity;
      for (const table of roles.table) {
        const toTable = distance(stall, table);
        if (toTable > 215) continue;
        for (const chair of roles.chair) {
          const toChair = distance(table, chair);
          const total = toTable + toChair;
          if (toChair <= 85 && total < shortest) { seating = [table, chair]; shortest = total; }
        }
      }
      const participants = [customer, stall, ...(seating || [])];
      const visit = {id: "market-buy", customerId: customer.id, stallId: stall.id,
        actors: participants.map(slot => ({asset: slot.asset, x: slot.anchor[0], y: slot.anchor[1], z: slot.z}))};
      const profile = stall.profile || state.marketProfile;
      if (profile) visit.profile = profile;
      if (seating) [visit.tableId, visit.chairId] = seating.map(slot => slot.id);
      visits.push(visit);
    }
    return visits;
  }

  window.NightMarketRules = {plan};
})();
