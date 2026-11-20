extends RefCounted

const MAX_ITEMS := 15
const BOARD := Vector2(864, 900)
const MARKET_ROLES := ["stall","table","chair","customer"]
var catalog: Dictionary = {}
var bases: Array = []
var records: Array = []
var history: Array = []
var next_id := 0

func configure(levels: Array) -> void:
	for level in levels:
		bases.append(level.id)
		for slot in level.slots:
			if not catalog.has(slot.asset):
				add_asset(slot.asset, slot.name, slot.size, float(slot.get("opacity", 1.0)))
	add_asset("black-cat", "小黑猫", [52, 62])

func add_asset(id: String, title: String, size: Array, opacity := 1.0, role := "") -> void:
	catalog[id] = {"id": "kit:" + id, "asset": id, "name": title, "size": size, "opacity": opacity,
		"role":role if MARKET_ROLES.has(role) and is_generated(id) else ""}

func is_generated(id: String) -> bool:
	if not id.begins_with("gen-") or id.length() != 36:
		return false
	for digit in id.substr(4):
		if not "0123456789abcdef".contains(digit):
			return false
	return true

func make_slot(asset: String, id: String, x: float, y: float, z: int) -> Dictionary:
	var item: Dictionary = catalog[asset]
	return {"id": id, "asset": asset, "name": item.name, "size": item.size,
		"anchor":[x, y],"z":z,"opacity":item.opacity,"role":item.role,"radius":clampf(minf(item.size[0], item.size[1]) * 0.35, 12, 30)}

func item_at(id: String) -> Dictionary:
	for record in records:
		if record.id == id:
			return record
	return {}

func clamp_anchor(point: Vector2, size: Array) -> Vector2:
	var anchor := point.clamp(Vector2(size[0] / 2.0, size[1]), BOARD - Vector2(size[0] / 2.0, 0))
	return anchor.snapped(Vector2(0.5, 0.5))

func remember() -> void:
	history.append(records.duplicate(true))
	if history.size() > 40:
		history.pop_front()

func add(asset: String, anchor: Vector2) -> String:
	if not catalog.has(asset) or records.size() >= MAX_ITEMS:
		return ""
	remember()
	next_id += 1
	var id := "i" + str(next_id)
	var p := clamp_anchor(anchor, catalog[asset].size)
	records.append(make_slot(asset, id, p.x, p.y, records.size()))
	return id

func move(id: String, anchor: Vector2) -> bool:
	var record := item_at(id)
	if record.is_empty():
		return false
	var p := clamp_anchor(anchor, record.size)
	if is_equal_approx(float(record.anchor[0]), p.x) and is_equal_approx(float(record.anchor[1]), p.y):
		return false
	remember()
	record.anchor = [p.x, p.y]
	return true

func remove(id: String) -> bool:
	var index := records.find(item_at(id))
	if index == -1:
		return false
	remember()
	records.remove_at(index)
	return true

func restore(work: Dictionary) -> void:
	records.clear()
	history.clear()
	next_id = 0
	for item in work.items:
		next_id += 1
		records.append(make_slot(item.asset, "i" + str(next_id), item.x, item.y, records.size()))

func from_slots(base: String, title: String, slots: Array, night := false) -> Dictionary:
	var items: Array = []
	for slot in slots:
		items.append({"asset":slot.asset,"x":slot.anchor[0],"y":slot.anchor[1],"z":items.size()})
	var work := {"version":1, "base":base, "title":title, "items":items}
	if night: work.ambience = "night"
	return work

func normalize(input, allow_empty := false) -> Dictionary:
	if not input is Dictionary or input.get("version") != 1 or not bases.has(input.get("base")):
		return {}
	if input.has("ambience") and input.ambience != "night":
		return {}
	var items = input.get("items")
	var title = input.get("title", "我的小镇")
	if not title is String or not items is Array or items.size() > MAX_ITEMS or (items.is_empty() and not allow_empty):
		return {}
	var order: Dictionary = {}
	var result: Array = []
	for item in items:
		if not item is Dictionary or not item.get("asset") is String:
			return {}
		var asset: String = item.asset
		if not catalog.has(asset) and not is_generated(asset):
			return {}
		for key in ["x", "y", "z"]:
			if typeof(item.get(key)) not in [TYPE_INT, TYPE_FLOAT] or not is_finite(float(item[key])):
				return {}
		var z := int(item.z)
		if item.x < 0 or item.x > BOARD.x or item.y < 0 or item.y > BOARD.y or z != item.z or absi(z) > 32767 or order.has(z):
			return {}
		order[z] = true
		result.append({"asset":asset,"x":snappedf(float(item.x), 0.5),"y":snappedf(float(item.y), 0.5),"z":z})
	result.sort_custom(func(a, b): return a.z < b.z)
	for i in result.size():
		result[i].z = i
	var label: String = title.strip_edges().left(32)
	var work := {"version":1,"base":input.base,"title":label if not label.is_empty() else "我的小镇","items":result}
	if input.has("ambience"): work.ambience = "night"
	return work

func missing(work: Dictionary) -> Array:
	var unavailable: Array = []
	for item in work.items:
		if not catalog.has(item.asset) and not unavailable.has(item.asset):
			unavailable.append(item.asset)
	return unavailable
