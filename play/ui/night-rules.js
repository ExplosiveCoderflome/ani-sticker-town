(() => {
  "use strict";

  function distance(a, b) {
    return Math.hypot(a.anchor[0] - b.anchor[0], a.anchor[1] - b.anchor[1]);
  }

  function isSkewerPair(customer, stall) {
    return customer === "gen-19cd29ce4e7972065fb2288a19cd16c2" &&
      stall === "gen-b0be9653bc46f3b0c159ae0ea21dbddf";
  }

  function visitActors(pieces) {
    return pieces.map(slot => ({asset:slot.asset,x:slot.anchor[0],y:slot.anchor[1],z:slot.z}));
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
      const matched = state.motionBindings?.[customer.asset];
      const targets = Array.isArray(matched) && matched.length ? new Set(matched) : null;
      let stall, walk = Infinity;
      for (const candidate of roles.stall) {
        if (targets && !targets.has(candidate.asset)) continue;
        const step = distance(customer, candidate);
        if (step <= 245 && step < walk) { stall = candidate; walk = step; }
      }
      const group = stall && state.motionSets?.[customer.asset]?.[stall.asset];
      const furniture = Array.isArray(group) ? new Set(group) : targets;
      const skewer = stall && isSkewerPair(customer.asset, stall.asset);
      // A guest parked on a seat occupies it while another visitor is walking.
      const needsFreeChair = targets || skewer || (customer.profile === "books" && stall?.profile === "books");
      const chairs = roles.chair.filter(chair => (!furniture || furniture.has(chair.asset)) &&
        (!needsFreeChair || !roles.customer.some(other => other.id !== customer.id && distance(other, chair) <= 18)));
      const tables = furniture ? roles.table.filter(table => furniture.has(table.asset)) : roles.table;
      if (!stall) {
        if (!targets) continue;
        let nearest, span = Infinity;
        for (const piece of [...chairs,...tables]) {
          const step = distance(customer,piece);
          if (step <= 190 && step < span) { nearest = piece; span = step; }
        }
        if (nearest) visits.push({id:"market-buy",customerId:customer.id,stallId:nearest.id,targetRole:nearest.role,
          profile:customer.profile || state.marketProfile,actors:visitActors([customer,nearest])});
        continue;
      }
      let seat, seatTable, shortest = Infinity;
      for (const chair of chairs) {
        let tableForChair, viaTable = Infinity;
        for (const table of tables) {
          const toTable = distance(stall,table), toChair = distance(table,chair);
          if (toTable <= 215 && toChair <= 85 && toTable + toChair < viaTable) {
            tableForChair = table;
            viaTable = toTable + toChair;
          }
        }
        const direct = distance(stall,chair);
        const canUseStool = skewer || targets;
        if (!tableForChair && !(canUseStool && direct <= 215)) continue;
        const cost = canUseStool ? direct : viaTable;
        // Older themed boxes break equal routes by table first, then chair.
        if (cost < shortest || (!canUseStool && cost === shortest && tableForChair.id < seatTable.id)) {
          seat = chair; seatTable = tableForChair; shortest = cost;
        }
      }
      const participants = [customer, stall];
      if (seatTable) participants.push(seatTable);
      if (seat) participants.push(seat);
      const visit = {id: "market-buy", customerId: customer.id, stallId: stall.id,
        actors: visitActors(participants)};
      const profile = stall.profile || state.marketProfile;
      if (profile) visit.profile = profile;
      if (seatTable) visit.tableId = seatTable.id;
      if (seat) visit.chairId = seat.id;
      visits.push(visit);
    }
    return visits;
  }

  window.NightMarketRules = {plan, isSkewerPair};
})();
