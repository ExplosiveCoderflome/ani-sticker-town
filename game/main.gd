extends Node2D

const PAPER := Color("#f4f0df")
const INK := Color("#61765b")
const SAVE_PREFIX := "town.stickers.v1."
const MAX_ZOOM := 2.5
const Workshop = preload("res://workshop.gd")
const Encounter = preload("res://encounter.gd")
const NightMarket = preload("res://night_market.gd")

var workshop := Workshop.new()
var encounter := Encounter.new()
var encounter_tween: Tween
var guitar := AudioStreamPlayer.new()
var garden_mode := false
var market_mode := false
var market_kit: Array = []
var market_theme := ""
var market_profile := "market"
var market_backdrop := NightMarket.new()
var mode := "puzzle"
var progress_key := ""
var pending_draft: Dictionary = {}
var draft_title := "我的小镇"
var drag_id := ""
var drag_offset := Vector2.ZERO
var drag_anchor := Vector2.ZERO
var dragging_sticker := false

var board_size := Vector2(864, 900)
var levels: Array = []
var level: Dictionary = {}
var slots: Array = []
var by_id: Dictionary = {}
var textures: Dictionary = {}
var masks: Dictionary = {}
var ground: Texture2D
var placed: Array = []
var selected := ""
var last_landed := ""
var bounce := 1.0
var bounce_tween: Tween
var zoom_factor := 1.0
var pan := Vector2.ZERO
var mouse_down := false
var press_point := Vector2.ZERO
var press_pan := Vector2.ZERO
var did_pan := false
var fingers: Dictionary = {}
var suppress_tap := false
var muted := false
var saved := true
var web_window: JavaScriptObject
var web_action: JavaScriptObject
var web_store: JavaScriptObject
var sound := AudioStreamPlayer.new()

func _ready() -> void:
	var content = JSON.parse_string(FileAccess.get_file_as_string("res://assets/levels.json"))
	if not content is Dictionary or content.get("levels", []).is_empty():
		push_error("The sticker box could not be loaded.")
		return
	board_size = _point(content.canvas)
	levels = content.levels
	workshop.configure(levels)
	ground = load("res://assets/ground.webp")
	get_viewport().size_changed.connect(_resize_board)
	add_child(sound)
	add_child(guitar)
	guitar.volume_db = -16.0
	sound.stream = _make_paper_sound()
	sound.volume_db = -12.0
	var requested := ""
	if OS.has_feature("web"):
		web_window = JavaScriptBridge.get_interface("window")
		web_action = JavaScriptBridge.create_callback(_on_web_action)
		web_window.townGame = web_action
		JavaScriptBridge.eval("""window.townProgressStorage = {
			read(key) { try { return localStorage.getItem(key) || ''; } catch(e) { return ''; } },
			write(key,value) { try { localStorage.setItem(key,value); return true; } catch(e) { return false; } }
		};""", true)
		web_store = JavaScriptBridge.get_interface("townProgressStorage")
		requested = str(JavaScriptBridge.eval("new URLSearchParams(location.search).get('box') || ''", true))
	muted = _read_saved("mute") == "1"
	_open_level(requested)
	_publish(true)

func _point(values: Array) -> Vector2:
	return Vector2(float(values[0]), float(values[1]))

func _open_level(id: String) -> void:
	mode = "puzzle"
	garden_mode = false
	market_mode = false
	pending_draft = {}
	level = levels[0]
	for item in levels:
		if item.id == id:
			level = item
			break
	slots = level.slots.duplicate()
	progress_key = level.id
	_start_puzzle()

func _cache_texture(asset: String) -> void:
	if textures.has(asset):
		return
	var path := "res://assets/stickers/%s.webp" % asset
	if ResourceLoader.exists(path):
		var tex := load(path) as Texture2D
		textures[asset] = tex
		masks[asset] = tex.get_image()

func _reset_view() -> void:
	_stop_encounter()
	last_landed = ""
	drag_id = ""
	dragging_sticker = false
	fingers.clear()
	mouse_down = false
	suppress_tap = false
	pan = Vector2.ZERO
	zoom_factor = 1.0

func _start_puzzle() -> void:
	saved = true
	slots.sort_custom(func(a, b): return a.z < b.z)
	by_id.clear()
	placed.clear()
	_reset_view()
	for slot in slots:
		by_id[slot.id] = slot
		_cache_texture(slot.asset)
	var raw := _read_saved(progress_key)
	if not raw.is_empty():
		var history = JSON.parse_string(raw)
		if history is Array:
			for slot_id in history:
				if slot_id is String and by_id.has(slot_id) and not placed.has(slot_id):
					placed.append(slot_id)
	_select_next()
	queue_redraw()

func _select_next() -> void:
	selected = ""
	for asset in ["bakery", "bookshop", "tree", "flower-cart", "fountain", "bench", "cafe-table", "cafe-chair", "lamp", "musician", "florist", "child", "dog", "paving"]:
		for slot in slots:
			if slot.asset == asset and not placed.has(slot.id):
				selected = slot.id
				return
	for slot in slots:
		if not placed.has(slot.id):
			selected = slot.id
			return

func _read_saved(key: String) -> String:
	if web_store:
		return str(web_store.read(SAVE_PREFIX + key))
	var path := "user://" + SAVE_PREFIX + key
	if FileAccess.file_exists(path):
		return FileAccess.get_file_as_string(path)
	return ""

func _write_saved(key: String, value: String) -> bool:
	if web_store:
		return bool(web_store.write(SAVE_PREFIX + key, value))
	var file := FileAccess.open("user://" + SAVE_PREFIX + key, FileAccess.WRITE)
	if not file:
		return false
	file.store_string(value)
	return file.get_error() == OK

func _save_progress() -> void:
	saved = _write_saved(progress_key, JSON.stringify(placed))

func _level_for(base: String) -> Dictionary:
	for entry in levels:
		if entry.id == base:
			return entry
	return levels[0]

func _open_edit(base: String, garden := false, kit: Array = [], theme := "", profile := "market") -> void:
	mode = "edit"
	garden_mode = garden
	market_mode = not kit.is_empty()
	level = _level_for(base)
	progress_key = "draft.v2." + str(level.id)
	if market_mode:
		market_kit = kit.duplicate()
		market_theme = theme
		market_profile = profile
		progress_key = "market.v2." + ".".join(PackedStringArray(kit))
	selected = ""
	saved = true
	_reset_view()
	var empty := workshop.from_slots(level.id, theme.left(32) if market_mode else "我的小镇", [])
	var raw := _read_saved(progress_key)
	if raw.is_empty() and market_mode and profile == "market":
		raw = _read_saved("market.v1." + str(kit[0]))
	var draft := empty if raw.is_empty() else workshop.normalize(JSON.parse_string(raw), true)
	var seed := garden and raw.is_empty() and str(level.id) == "weekend-town-v1"
	if seed:
		var initial := [["paving",432,790],["bakery",278,517],["bookshop",570,505],["tree",123,613],
			["bench",475,634],["flower-cart",260,679],["musician",615,677]]
		for data in initial:
			draft.items.append({"asset":data[0],"x":data[1],"y":data[2],"z":draft.items.size()})
		selected = "kit:black-cat"
	elif market_mode and raw.is_empty():
		seed = true
		var first := [["paving",432,790],["bookshop",545,450],["tree",102,584],["lamp",737,557],
			[kit[0],275,557],[kit[0],583,560],["lamp",154,665],[kit[1],411,650],[kit[2],447,682],
			[kit[3],289,720],[kit[3],673,681]]
		if profile != "market" or theme != "一个热闹的夜市":
			first = [["paving",432,790], ["tree",133,523], [kit[0],365,510],
				[kit[1],485,594], [kit[2],525,620]]
			if profile == "market": first.insert(2, ["lamp",597,495])
			selected = "kit:" + str(kit[3])
		for data in first:
			var p := workshop.clamp_anchor(Vector2(data[1],data[2]),workshop.catalog[data[0]].size)
			draft.items.append({"asset":data[0],"x":p.x,"y":p.y,"z":draft.items.size()})
	if draft.is_empty():
		draft = empty
	draft_title = draft.title
	var missing := workshop.missing(draft)
	pending_draft = draft if not missing.is_empty() else {}
	workshop.restore(empty if not missing.is_empty() else draft)
	_sync_edit(seed)
	if not missing.is_empty():
		_request_missing.call_deferred()

func _open_market(payload: Variant) -> bool:
	if not payload is Dictionary or not payload.get("theme") is String or not payload.get("ids") is Array:
		return false
	var ids: Array = payload.ids
	var label: String = payload.theme.strip_edges()
	if label.is_empty() or label.length()>80 or ids.size()!=workshop.MARKET_ROLES.size(): return false
	for i in ids.size():
		if not ids[i] is String or not workshop.is_generated(ids[i]) or not workshop.catalog.has(ids[i]):
			return false
		if workshop.catalog[ids[i]].role != workshop.MARKET_ROLES[i]: return false
	var profile: String = str(payload.get("profile", "market"))
	if not workshop.PROFILES.has(profile): return false
	if not market_mode or market_kit != ids or market_profile != profile:
		_open_edit("weekend-town-v1",false,ids,label,profile)
	return true

func _request_missing() -> void:
	if mode == "edit" and not pending_draft.is_empty() and web_window and web_window.townUI and web_window.townUI.missingAssets:
		web_window.townUI.missingAssets(JSON.stringify(workshop.missing(pending_draft)))

func _sync_edit(save := false) -> void:
	_stop_encounter()
	slots = workshop.records
	by_id.clear()
	placed.clear()
	for i in slots.size():
		var slot: Dictionary = slots[i]
		slot.z = i
		_cache_texture(slot.asset)
		by_id[slot.id] = slot
		placed.append(slot.id)
	if save and pending_draft.is_empty():
		saved = _write_saved(progress_key, JSON.stringify(workshop.from_slots(level.id, draft_title, slots)))
	queue_redraw()

func _open_gift(work: Dictionary) -> bool:
	if work.is_empty() or not workshop.missing(work).is_empty():
		_notice("这份礼物的素材还未齐全，请重新打开。")
		return false
	mode = "gift"
	garden_mode = false
	market_mode = false
	pending_draft = {}
	level = {"id":work.base, "title":work.title, "ambience":work.get("ambience","")}
	progress_key = "gift.v1." + JSON.stringify(work).sha256_text()
	slots = []
	for i in work.items.size():
		var item: Dictionary = work.items[i]
		slots.append(workshop.make_slot(item.asset, "g" + str(i + 1), item.x, item.y, i))
	_start_puzzle()
	return true

func _night_scene() -> bool:
	return (market_mode and market_profile == "market") or (mode == "gift" and level.get("ambience","") == "night")

func _active_work() -> Dictionary:
	var visible: Array = []
	for slot in slots:
		if placed.has(slot.id):
			visible.append(slot)
	return workshop.from_slots(level.id, draft_title if mode == "edit" else str(level.title), visible, _night_scene())

func _register_asset(input) -> bool:
	if not input is Dictionary or not input.get("id") is String or not workshop.is_generated(input.id):
		return false
	var size = input.get("size")
	var role = input.get("role","")
	var profile = input.get("profile","")
	if not profile is String or (profile != "" and not workshop.PROFILES.has(profile)):
		return false
	if not role is String or (role != "" and not workshop.MARKET_ROLES.has(role)):
		return false
	var uri = input.get("data")
	if not size is Array or size.size() != 2 or not uri is String or uri.length() > 8000000:
		return false
	for i in 2:
		if typeof(size[i]) not in [TYPE_INT, TYPE_FLOAT] or not is_finite(float(size[i])) or size[i] < 1 or size[i] > board_size[i]:
			return false
	var png: bool = uri.begins_with("data:image/png;base64,")
	if not png and not uri.begins_with("data:image/webp;base64,"):
		return false
	var pixels := Marshalls.base64_to_raw(uri.substr(uri.find(",") + 1))
	if pixels.size() < 32:
		return false
	var width: int
	var height: int
	if png:
		width = (pixels[16] << 24) | (pixels[17] << 16) | (pixels[18] << 8) | pixels[19]
		height = (pixels[20] << 24) | (pixels[21] << 16) | (pixels[22] << 8) | pixels[23]
	else:
		match pixels.slice(12,16).get_string_from_ascii():
			"VP8X":
				width = 1 + pixels[24] + (pixels[25] << 8) + (pixels[26] << 16)
				height = 1 + pixels[27] + (pixels[28] << 8) + (pixels[29] << 16)
			"VP8L":
				width = 1 + pixels[21] + ((pixels[22] & 63) << 8)
				height = 1 + (pixels[22] >> 6) + (pixels[23] << 2) + ((pixels[24] & 15) << 10)
			"VP8 ":
				width = pixels.decode_u16(26) & 16383
				height = pixels.decode_u16(28) & 16383
			_:
				return false
	if width < 1 or height < 1 or width > 2048 or height > 2048:
		return false
	var img := Image.new()
	var error := img.load_png_from_buffer(pixels) if png else img.load_webp_from_buffer(pixels)
	if error != OK:
		return false
	var id: String = input.id
	textures[id] = ImageTexture.create_from_image(img)
	masks[id] = img
	workshop.add_asset(id, str(input.get("name", "定制贴纸")).strip_edges().left(60), size,1,role,profile)
	# Existing instances always reflect what this install's current registration actually verified.
	for slot in slots:
		if slot.asset == id:
			if slot.get("role","") != role:
				_stop_encounter()
			slot.role = role
			slot.profile = profile
	if mode == "edit" and not pending_draft.is_empty() and workshop.missing(pending_draft).is_empty():
		workshop.restore(pending_draft)
		pending_draft = {}
		_sync_edit()
	return true

func _viewport_size() -> Vector2:
	return get_viewport_rect().size

func _base_scale() -> float:
	var v := _viewport_size()
	return maxf(0.001, minf(v.x / board_size.x, v.y / board_size.y))

func _scale_value() -> float:
	return _base_scale() * zoom_factor

func _logic_units_per_css_pixel() -> float:
	if web_window:
		var canvas = web_window.document.getElementById("canvas")
		if canvas and float(canvas.clientWidth) > 0:
			return _viewport_size().x / float(canvas.clientWidth)
	return 1.0

func _origin() -> Vector2:
	return (_viewport_size() - board_size * _scale_value()) * 0.5 + pan

func _clamp_pan() -> void:
	var limits := ((board_size * _scale_value() - _viewport_size()) * 0.5).max(Vector2.ZERO)
	pan = pan.clamp(-limits, limits)

func _resize_board() -> void:
	_clamp_pan()
	queue_redraw()

func _zoom_to(value: float, focus: Vector2) -> void:
	var old_world := (focus - _origin()) / _scale_value()
	zoom_factor = clampf(value, 1.0, MAX_ZOOM)
	pan = focus - old_world * _scale_value() - (_viewport_size() - board_size * _scale_value()) * 0.5
	_resize_board()
	_publish()

func _rect(slot: Dictionary) -> Rect2:
	var size := _point(slot.size)
	return Rect2(_point(slot.anchor) - Vector2(size.x * 0.5, size.y), size)

func _sticker_tint(slot: Dictionary, night: bool) -> Color:
	var tint := Color.WHITE
	if night and slot.asset == "paving":
		tint = Color("#b3a699")
	elif night and slot.asset in ["bakery","bookshop","tree","bench"]:
		tint = Color("#dfd0be")
	tint.a = float(slot.get("opacity",1))
	return tint

func _draw() -> void:
	var night := _night_scene()
	draw_rect(Rect2(Vector2.ZERO, _viewport_size()), market_backdrop.SKY if night else PAPER)
	if not ground:
		return
	draw_set_transform(_origin(), 0.0, Vector2.ONE * _scale_value())
	if night:
		market_backdrop.backdrop(self,board_size,slots)
	else:
		draw_texture_rect(ground, Rect2(Vector2.ZERO, board_size), false)
	if mode == "edit":
		var drawing := slots
		var performing := not encounter.kind.is_empty()
		var board_transform := Transform2D(0,Vector2.ONE*_scale_value(),0,_origin())
		if performing and not encounter.reduced:
			drawing = slots.duplicate()
			drawing.sort_custom(func(a,b): return encounter.depth(a) < encounter.depth(b))
		for slot in drawing:
			var tile := _rect(slot)
			var posed: bool = performing and encounter.owns(slot)
			if posed:
				draw_set_transform_matrix(board_transform * encounter.pose(slot))
				tile.position = Vector2(-tile.size.x*.5,-tile.size.y)
			if dragging_sticker and drag_id == slot.id:
				tile.position = drag_anchor - Vector2(tile.size.x / 2, tile.size.y)
			if textures.has(slot.asset):
				draw_texture_rect(textures[slot.asset], tile, false, _sticker_tint(slot, night))
				if posed: encounter.carried(self,slot)
			if not posed and (selected == slot.id or (dragging_sticker and drag_id == slot.id)):
				_draw_guides(tile)
			if posed:
				draw_set_transform_matrix(board_transform)
		if performing:
			encounter.accents(self)
		return
	for slot in slots:
		if placed.has(slot.id):
			continue
		var active: bool = slot.id == selected
		var tint := Color(0.78, 0.78, 0.69, 0.20)
		if active:
			tint = Color(0.78, 0.80, 0.67, 0.48)
		draw_texture_rect(textures[slot.asset], _rect(slot), false, tint)
		if active:
			_draw_guides(_rect(slot))
	for slot in slots:
		if not placed.has(slot.id):
			continue
		var rect := _rect(slot)
		if slot.id == last_landed and bounce != 1.0:
			var anchor := _point(slot.anchor)
			rect = Rect2(anchor + (rect.position - anchor) * bounce, rect.size * bounce)
		draw_texture_rect(textures[slot.asset], rect, false, _sticker_tint(slot, night))

func _draw_guides(rect: Rect2) -> void:
	var box := rect.grow(4)
	var leg := minf(16.0, minf(box.size.x, box.size.y) * 0.24)
	var line := Color(INK, 0.85)
	for side_x in [-1, 1]:
		for side_y in [-1, 1]:
			var corner := Vector2(box.position.x if side_x == 1 else box.end.x, box.position.y if side_y == 1 else box.end.y)
			draw_line(corner, corner + Vector2(side_x * leg, 0), line, 1.8, true)
			draw_line(corner, corner + Vector2(0, side_y * leg), line, 1.8, true)

func _attempt(id: String, position: Vector2) -> void:
	if mode == "edit":
		_drop_edit(id, (position - _origin()) / _scale_value())
		return
	if not by_id.has(id) or placed.has(id):
		return
	var slot: Dictionary = by_id[id]
	var world := (position - _origin()) / _scale_value()
	var rect := _rect(slot)
	var anchor := _point(slot.anchor)
	var radius := maxf(float(slot.radius), 16.0 * _logic_units_per_css_pixel() / _scale_value())
	var matches := world.distance_to(anchor) <= radius
	if not matches and rect.has_point(world):
		matches = _opaque_at(slot, world)
	if not matches:
		_notice("试试带角标的轮廓，贴近后松手")
		return
	placed.append(id)
	last_landed = id
	if bounce_tween:
		bounce_tween.kill()
	bounce = 0.92
	bounce_tween = create_tween()
	bounce_tween.tween_method(_set_bounce, 0.92, 1.035, 0.10)
	bounce_tween.tween_method(_set_bounce, 1.035, 1.0, 0.10)
	if not muted:
		sound.play()
	_select_next()
	_save_progress()
	queue_redraw()
	_publish()

func _set_bounce(value: float) -> void:
	bounce = value
	queue_redraw()

func _opaque_at(slot: Dictionary, world: Vector2) -> bool:
	var rect := _rect(slot)
	if not rect.has_point(world) or not masks.has(slot.asset):
		return false
	var mask: Image = masks[slot.asset]
	var uv := (world - rect.position) / rect.size
	var pixel := Vector2i(uv * Vector2(mask.get_size())).clamp(Vector2i.ZERO, mask.get_size() - Vector2i.ONE)
	return mask.get_pixelv(pixel).a > 0.13

func _hit_edit(world: Vector2) -> String:
	for i in range(slots.size() - 1, -1, -1):
		if _opaque_at(slots[i], world):
			return slots[i].id
	return ""

func _drop_edit(id: String, world: Vector2) -> void:
	if not pending_draft.is_empty() or not Rect2(Vector2.ZERO, board_size).has_point(world):
		return
	var kit := id.begins_with("kit:")
	var asset := id.substr(4) if kit else str(by_id.get(id, {}).get("asset", ""))
	if not workshop.catalog.has(asset):
		return
	var anchor := world + Vector2(0, float(workshop.catalog[asset].size[1]) * 0.5)
	if kit:
		var added := workshop.add(asset, anchor)
		if added.is_empty():
			_notice("每盒最多放 15 张，先收起一张再试试。")
			return
		selected = added
	else:
		workshop.move(id, anchor)
		selected = id
	_sync_edit(true)
	if not muted:
		sound.play()
	_publish()

func _input(event: InputEvent) -> void:
	if level.is_empty() or not pending_draft.is_empty():
		return
	if event is InputEventScreenTouch:
		if event.pressed:
			fingers[event.index] = event.position
			if fingers.size() == 1:
				_begin_press(event.position)
			else:
				suppress_tap = true
				mouse_down = false
				dragging_sticker = false
				drag_id = ""
				queue_redraw()
		else:
			fingers.erase(event.index)
			if fingers.is_empty():
				if not event.canceled and not suppress_tap:
					_end_press(event.position)
				dragging_sticker = false
				drag_id = ""
				queue_redraw()
				mouse_down = false
				suppress_tap = false
		return
	if event is InputEventScreenDrag:
		if not fingers.has(event.index):
			return
		if fingers.size() == 2:
			var other: Vector2 = fingers.values()[0] if fingers.keys()[1] == event.index else fingers.values()[1]
			var before: Vector2 = fingers[event.index]
			var old_distance := before.distance_to(other)
			if old_distance > 2:
				_zoom_to(zoom_factor * event.position.distance_to(other) / old_distance, (other + event.position) * 0.5)
		elif not suppress_tap:
			_move_press(event.position)
		fingers[event.index] = event.position
		return
	if event.device == InputEvent.DEVICE_ID_EMULATION or not fingers.is_empty():
		return
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_LEFT:
			if event.pressed:
				_begin_press(event.position)
			else:
				_end_press(event.position)
		elif event.pressed:
			if event.button_index == MOUSE_BUTTON_WHEEL_UP:
				_zoom_to(zoom_factor * 1.2, event.position)
			elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
				_zoom_to(zoom_factor / 1.2, event.position)
	elif event is InputEventMouseMotion:
		_move_press(event.position)

func _begin_press(point: Vector2) -> void:
	if mode == "edit":
		_stop_encounter()
	mouse_down = true
	did_pan = false
	press_point = point
	press_pan = pan
	drag_id = ""
	dragging_sticker = false
	if mode == "edit":
		var world := (point - _origin()) / _scale_value()
		drag_id = _hit_edit(world)
		if not drag_id.is_empty():
			drag_offset = _point(by_id[drag_id].anchor) - world

func _move_press(point: Vector2) -> void:
	if not mouse_down or (not dragging_sticker and not did_pan and point.distance_to(press_point) <= 6 * _logic_units_per_css_pixel()):
		return
	if mode == "edit" and not drag_id.is_empty():
		dragging_sticker = true
		drag_anchor = workshop.clamp_anchor((point - _origin()) / _scale_value() + drag_offset, by_id[drag_id].size)
		queue_redraw()
	elif zoom_factor > 1:
		did_pan = true
		pan = press_pan + point - press_point
		_resize_board()

func _end_press(point: Vector2) -> void:
	if not mouse_down:
		return
	if mode == "edit" and dragging_sticker:
		drag_anchor = (point - _origin()) / _scale_value() + drag_offset
		workshop.move(drag_id, drag_anchor)
		selected = drag_id
		_sync_edit(true)
		_publish()
	elif mode == "edit" and not did_pan and not selected.begins_with("kit:") and not drag_id.is_empty():
		selected = drag_id
		_publish()
		queue_redraw()
		if web_window and web_window.townUI and web_window.townUI.actorTap:
			web_window.townUI.actorTap(selected)
	elif not did_pan:
		_attempt(selected, point)
	dragging_sticker = false
	drag_id = ""
	mouse_down = false

func _on_web_action(args: Array) -> void:
	if args.is_empty():
		return
	var action := str(args[0])
	var payload := str(args[1]) if args.size() > 1 else ""
	match action:
		"encounter":
			if mode == "edit" and pending_draft.is_empty() and payload.length() <= 3500:
				_play_encounter(JSON.parse_string(payload))
			return
		"stopEncounter":
			_stop_encounter()
			return
		"mode":
			if payload == "market" and not market_mode and not market_kit.is_empty():
				_open_market({"ids":market_kit,"theme":market_theme,"profile":market_profile})
			elif payload == "garden" and (mode != "edit" or not garden_mode):
				_open_edit(level.id, true)
			elif payload == "edit" and mode != "edit":
				_open_edit(level.id)
			elif payload == "puzzle" and mode != "puzzle":
				_open_level(level.id)
		"base":
			if mode == "edit" and not market_mode and workshop.bases.has(payload) and level.id != payload:
				_open_edit(payload, garden_mode)
		"marketOpen":
			if payload.length()>2500 or not _open_market(JSON.parse_string(payload)):
				_notice("夜市的摊位、桌椅或顾客还没备齐，请重新打开这套素材。")
				return
		"gift":
			if payload.length() > 16000 or not _open_gift(workshop.normalize(JSON.parse_string(payload))):
				return
		"pack":
			if mode != "edit" or records_unavailable():
				return
			if not payload.strip_edges().is_empty():
				draft_title = payload.strip_edges().left(32)
				_sync_edit(true)
			if web_window and web_window.townUI and web_window.townUI.giftReady:
				web_window.townUI.giftReady(JSON.stringify(_active_work()))
		"postcard":
			if not placed.is_empty() and pending_draft.is_empty() and web_window and web_window.townUI and web_window.townUI.postcardReady:
				web_window.townUI.postcardReady(JSON.stringify(_active_work()))
		"registerAsset":
			if payload.length() > 8100000 or not _register_asset(JSON.parse_string(payload)):
				_notice("这张定制贴纸未能载入。")
				return
		"remove":
			if mode == "edit" and pending_draft.is_empty() and workshop.remove(selected if payload.is_empty() else payload):
				selected = ""
				_sync_edit(true)
		"select":
			_stop_encounter()
			if mode == "edit" and (by_id.has(payload) or (payload.begins_with("kit:") and workshop.catalog.has(payload.substr(4)))):
				selected = payload
			elif by_id.has(payload) and not placed.has(payload):
				selected = payload
		"drop":
			var data = JSON.parse_string(payload)
			if data is Dictionary and data.get("id") is String:
				if typeof(data.get("x")) in [TYPE_INT, TYPE_FLOAT] and typeof(data.get("y")) in [TYPE_INT, TYPE_FLOAT]:
					_attempt(data.id, Vector2(float(data.x), float(data.y)) * _viewport_size())
			return
		"undo":
			if mode == "edit":
				if pending_draft.is_empty() and not workshop.history.is_empty():
					workshop.records = workshop.history.pop_back()
					if not selected.begins_with("kit:") and workshop.item_at(selected).is_empty():
						selected = ""
					_sync_edit(true)
			elif not placed.is_empty():
				selected = str(placed.pop_back())
				last_landed = ""
				_save_progress()
		"reset":
			if mode == "edit":
				if not pending_draft.is_empty():
					return
				if not slots.is_empty():
					workshop.remember()
				workshop.records.clear()
				selected = ""
				_sync_edit(true)
			else:
				placed.clear()
				last_landed = ""
				_select_next()
				_save_progress()
			_zoom_to(1.0, _viewport_size() * 0.5)
		"level":
			_open_level(payload)
		"zoomIn":
			_zoom_to(zoom_factor * 1.35, _viewport_size() * 0.5)
			return
		"zoomOut":
			_zoom_to(zoom_factor / 1.35, _viewport_size() * 0.5)
			return
		"mute":
			muted = not muted
			if muted:
				guitar.stop()
			_write_saved("mute", "1" if muted else "0")
	queue_redraw()
	_publish()

func records_unavailable() -> bool:
	return placed.is_empty() or not pending_draft.is_empty()

func _publish(initial := false) -> void:
	if not web_window or not web_window.townUI or level.is_empty():
		return
	var state := JSON.stringify({"mode":mode, "levelId":level.id, "title":draft_title if mode == "edit" else level.title,
		"marketMode":market_mode, "marketKit":market_kit if market_mode else [], "marketTheme":market_theme if market_mode else "",
		"marketProfile":market_profile if market_mode else "",
		"slots":slots, "catalog":workshop.catalog.values(), "total":slots.size(), "placed":placed, "selected":selected,
		"canUndo":not workshop.history.is_empty() if mode == "edit" else not placed.is_empty(),
		"complete":mode != "edit" and not slots.is_empty() and placed.size() == slots.size(),
		"canPack":mode == "edit" and not records_unavailable(),"canPostcard":not records_unavailable(),
		"work":_active_work(),"targetWork":workshop.from_slots(level.id, str(level.title), slots, _night_scene()),
		"missingAssets":workshop.missing(pending_draft) if not pending_draft.is_empty() else [],
		"zoom":zoom_factor, "saved":saved, "muted":muted})
	if initial:
		web_window.townUI.ready(state)
	else:
		web_window.townUI.sync(state)

func _notice(message: String) -> void:
	if web_window and web_window.townUI:
		web_window.townUI.notice(message)

func _play_encounter(payload: Variant) -> void:
	var reduced := bool(web_window.matchMedia("(prefers-reduced-motion: reduce)").matches) if web_window else false
	var next := Encounter.new()
	if not next.start(payload,slots,reduced):
		return
	_stop_encounter()
	encounter = next
	if encounter.kind == "dog-song" and not muted and not reduced:
		if not guitar.stream:
			guitar.stream = _make_guitar_phrase()
		guitar.play()
	queue_redraw()
	encounter_tween = create_tween()
	encounter_tween.tween_method(_pose_encounter.bind(next),0.0,1.0,encounter.duration())
	encounter_tween.tween_callback(_finish_encounter.bind(next))

func _pose_encounter(progress: float, performance: RefCounted) -> void:
	if encounter != performance: return
	encounter.time = progress
	queue_redraw()
	if encounter.kind == "market-buy" and not encounter.sale_emitted and progress >= encounter.SALE_TIME:
		encounter.sale_emitted = true
		if web_window and web_window.townUI and web_window.townUI.marketSale:
			web_window.townUI.marketSale(str(encounter.actors.customer.id),str(encounter.actors.stall.id))

func _finish_encounter(performance: RefCounted) -> void:
	if performance == encounter:
		_stop_encounter(true)

func _stop_encounter(completed := false) -> void:
	if encounter.kind.is_empty():
		return
	var customer := ""
	var stall := ""
	if encounter.kind == "market-buy":
		customer = str(encounter.actors.customer.id)
		stall = str(encounter.actors.stall.id)
	if encounter_tween:
		encounter_tween.kill()
		encounter_tween = null
	guitar.stop()
	encounter.clear()
	queue_redraw()
	if not customer.is_empty() and web_window and web_window.townUI and web_window.townUI.marketDone:
		web_window.townUI.marketDone(customer,stall,completed)

func _make_guitar_phrase() -> AudioStreamWAV:
	var clip := AudioStreamWAV.new()
	clip.mix_rate = 22050
	clip.format = AudioStreamWAV.FORMAT_16_BITS
	var notes := [261.63,329.63,392.00,523.25]
	var starts := [0.0,0.30,0.62,1.03]
	var samples := PackedFloat32Array()
	samples.resize(clip.mix_rate*2)
	for index in notes.size():
		var start := roundi(float(starts[index])*clip.mix_rate)
		for i in mini(roundi(.95*clip.mix_rate),samples.size()-start):
			var t := float(i)/clip.mix_rate
			var phase := TAU*float(notes[index])*t
			var pluck := sin(phase) + .42*sin(phase*2)*exp(-4*t) + .22*sin(phase*3)*exp(-10*t)
			samples[start+i] += .48*minf(t*160,1)*exp(-5.9*t)*pluck
	var bytes := PackedByteArray()
	bytes.resize(samples.size()*2)
	for i in samples.size():
		bytes.encode_s16(i*2,clampi(roundi(samples[i]*32767),-32768,32767))
	clip.data = bytes
	return clip

func _make_paper_sound() -> AudioStreamWAV:
	var clip := AudioStreamWAV.new()
	clip.mix_rate = 22050
	clip.format = AudioStreamWAV.FORMAT_16_BITS
	var bytes := PackedByteArray()
	bytes.resize(3600 * 2)
	var rng := RandomNumberGenerator.new()
	rng.seed = 449
	var previous := 0.0
	for i in 3600:
		var t := float(i) / clip.mix_rate
		previous = lerpf(previous, rng.randf_range(-1, 1), 0.34)
		var paper := previous * exp(-t * 65.0)
		var tap := sin(TAU * 370.0 * t) * exp(-t * 55.0) * 0.22
		bytes.encode_s16(i * 2, int((paper + tap) * minf(t * 900.0, 1.0) * 22000))
	clip.data = bytes
	return clip
