(() => {
  "use strict";

  const entries = [
    {
      id: "cat-bench", title: "给猫留个位", icon: "black-cat", actors: ["black-cat", "bench"],
      hint: "让黑猫走到长椅脚边，看看它会挑哪个位置。",
      story: "黑猫伸出一只爪子试了试，轻轻一跳，占了长椅正中间。"
    },
    {
      id: "dog-song", title: "第一排听众", icon: "dog", actors: ["dog", "musician"],
      hint: "给街头乐手找个毛茸茸的听众。",
      story: "乐手刚换了个节拍，小狗就跟着转了一圈。转完，它又摇着尾巴坐回第一排。"
    },
    {
      id: "flower-hello", title: "花醒了", icon: "flower-cart", actors: ["florist", "flower-cart"],
      hint: "让花匠走近花车，伸手就能碰到花束。",
      story: "花匠扶正了挤歪的一枝花。几片花瓣松开，悠悠地飘到车轮旁。"
    },
    {
      id: "tree-coffee", title: "树荫里的下午茶", icon: "cafe-table", actors: ["tree", "cafe-table", "cafe-chair"],
      hint: "在树下摆一张咖啡桌，再给来人留把椅子。",
      story: "椅子刚推到桌边，一片树叶就飘了下来，先占了下午茶的位置。"
    }
  ];

  // All positions are bottom-center anchors in the 864 × 900 artwork.
  function distance(a, b, radiusX, radiusY = radiusX) {
    const value = Math.hypot((a.x - b.x) / radiusX, (a.y - b.y) / radiusY);
    return value <= 1 ? value : Infinity;
  }

  const rules = {
    "cat-bench": {
      score: ([cat, bench]) => distance(cat, bench, 84),
      effect: ([, bench]) => [bench.x, bench.y - 32]
    },
    "dog-song": {
      score: ([dog, musician]) => distance(dog, musician, 82),
      effect: ([dog]) => [dog.x, dog.y - 8]
    },
    "flower-hello": {
      score: ([florist, cart]) => distance(florist, cart, 112),
      effect: ([, cart]) => [cart.x, cart.y - 92]
    },
    "tree-coffee": {
      score: ([tree, table, chair]) => distance(tree, table, 112, 78) + distance(table, chair, 58),
      effect: ([, table]) => [table.x, table.y - 30]
    }
  };

  function discover(work, focus) {
    if (!Array.isArray(work?.items)) return [];
    if (focus !== undefined && (!focus || typeof focus.asset !== "string" || !Number.isFinite(focus.z))) return [];
    const items = work.items
      .filter(item => item && typeof item.asset === "string" && Number.isFinite(item.x) &&
        Number.isFinite(item.y) && Number.isFinite(item.z) &&
        item.x >= 0 && item.x <= 864 && item.y >= 0 && item.y <= 900)
      .map(({asset, x, y, z}) => ({asset, x, y, z}))
      .sort((a, b) => b.z - a.z || a.x - b.x || a.y - b.y);

    const events = [];
    for (const entry of entries) {
      if (focus && !entry.actors.includes(focus.asset)) continue;
      // A kit can use up to 15 stickers. Enumerating these tiny groups lets the café test
      // both relationships against the same table, even when several tables are present.
      let groups = [[]];
      for (const asset of entry.actors) {
        const matches = items.filter(item => item.asset === asset && (focus?.asset !== asset || item.z === focus.z));
        groups = groups.flatMap(group => matches.map(item => [...group, item]));
      }
      let bestScore = Infinity;
      let actors;
      for (const group of groups) {
        const score = rules[entry.id].score(group);
        if (score < bestScore) {
          bestScore = score;
          actors = group;
        }
      }
      if (actors) {
        const [x, y] = rules[entry.id].effect(actors);
        events.push({id: entry.id, actors, point: {x, y: Math.max(0, y)}});
      }
    }
    return events;
  }

  window.TownEncounters = {entries, discover};
})();
