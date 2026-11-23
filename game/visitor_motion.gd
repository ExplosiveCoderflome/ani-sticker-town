extends RefCounted

const VISITOR := "gen-19cd29ce4e7972065fb2288a19cd16c2"
const SQUID_STALL := "gen-b0be9653bc46f3b0c159ae0ea21dbddf"
const READER := "gen-8ec3ea532f9721c7d134c61f61a5c08f"
const BOOK_KIOSK := "gen-cd0842c954f1027b3bb330dac040d66c"
const READING_CHAIR := "gen-0042b884d2f9353c9a957fe54c3b00e8"
const VISITOR_FRAMES: SpriteFrames = preload("res://assets/visitor-motion/visitor.tres")
const READER_FRAMES: SpriteFrames = preload("res://assets/reader-motion/reader.tres")

# All four clips share a foot pivot. Seated hips must line up with the actual stool top.
const FOOT_PIVOT := Vector2(112.0, 218.0) / 224.0
const STANDING_HEIGHT := 192.0 / 224.0
var frames := VISITOR_FRAMES
var custom := false
var seated_action := &"eat"
var return_action := &"walk"
var seated_hip := Vector2(12.0, -51.0) / 192.0
var open_palm := Vector2(-43.0, -128.0) / 192.0

var home: Vector2
var counter: Vector2
var seat: Vector2
var seated := false
var direct_table := false
var seat_slot: Dictionary = {}
var reduced := false
var counter_right := false
var seat_right := false
var guest_height := 0.0
var arrival := 0.0
var pickup := 0.0
var leave_counter := 0.0
var sit_down := 0.0
var stand_up := 0.0
var duration := 0.0

static func frames_from_png(uri: String) -> SpriteFrames:
	const PREFIX := "data:image/png;base64,"
	if uri.length() > 8000000 or not uri.begins_with(PREFIX): return null
	var bytes := Marshalls.base64_to_raw(uri.substr(PREFIX.length()))
	var png_header := PackedByteArray([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
	if bytes.size() < 33 or bytes.slice(0, 16) != png_header: return null
	var width := (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]
	var height := (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]
	if width < 4 or width > 2048 or width % 4 != 0 or height != width: return null
	var image := Image.new()
	if image.load_png_from_buffer(bytes) != OK or image.detect_alpha() == Image.ALPHA_NONE: return null
	var cell := width >> 2
	var texture := ImageTexture.create_from_image(image)
	var clips := SpriteFrames.new()
	clips.remove_animation(&"default")
	var actions := [&"walk", &"receive", &"use", &"carry"]
	for row in 4:
		var action: StringName = actions[row]
		clips.add_animation(action)
		clips.set_animation_speed(action, [6.0, 5.0, 4.0, 6.0][row])
		clips.set_animation_loop(action, action != &"receive")
		for column in 4:
			var rect := Rect2i(column * cell, row * cell, cell, cell)
			if not image.get_region(rect).get_used_rect().has_area(): return null
			var frame := AtlasTexture.new()
			frame.atlas = texture
			frame.region = Rect2(rect)
			frame.filter_clip = true
			clips.add_frame(action, frame)
	return clips

func _clip_seconds(action: StringName, count: int) -> float:
	var seconds := 0.0
	for index in count:
		seconds += frames.get_frame_duration(action, index) / frames.get_animation_speed(action)
	return seconds

func _travel(from: Vector2, to: Vector2) -> float:
	return clampf(from.distance_to(to) / 118.0, 0.62, 2.3)

func _anchor(slot: Dictionary) -> Vector2:
	return Vector2(slot.anchor[0], slot.anchor[1])

func configure(actors: Dictionary, stop: Vector2, reduce: bool, reader: bool, custom_frames: SpriteFrames = null) -> void:
	if custom_frames:
		custom = true
		frames = custom_frames
		seated_action = &"use"
		return_action = &"carry"
	elif reader:
		frames = READER_FRAMES
		seated_action = &"read"
		return_action = &"carry" # The book still belongs in the reader's hands after the last page.
		seated_hip = Vector2(10.0, -53.0) / 192.0
		open_palm = Vector2(-57.0, -131.0) / 192.0
	reduced = reduce
	home = _anchor(actors.customer)
	guest_height = float(actors.customer.size[1])
	counter = stop
	counter_right = _anchor(actors.stall).x > stop.x
	arrival = _travel(home, counter)
	pickup = arrival + _clip_seconds(&"receive", 2)
	leave_counter = arrival + _clip_seconds(&"receive", frames.get_frame_count(&"receive"))
	if reduced:
		arrival = 0.0
		pickup = 0.58
		leave_counter = pickup
	seat_slot = actors.get("chair", {})
	var target: Dictionary = actors.stall
	direct_table = custom and target.role == "table"
	if custom and target.role in ["chair", "table"]: seat_slot = target
	seated = not seat_slot.is_empty()
	if not seated:
		duration = 1.8 if reduced else leave_counter + _travel(counter, home)
		return
	if direct_table:
		seat = _anchor(target) + Vector2(-0.12 if counter_right else 0.12, -0.12) * Vector2(target.size[0], target.size[1])
		seat_right = counter_right
	else:
		var surface := Vector2(-0.09, -0.52) if seat_slot.asset == READING_CHAIR else Vector2(0.0, -0.75)
		var top := _anchor(seat_slot) + Vector2(seat_slot.size[0], seat_slot.size[1]) * surface
		var facing_target := _anchor(actors.table) if actors.has("table") else counter
		seat_right = facing_target.x > top.x
		var hip := Vector2(-seated_hip.x if seat_right else seated_hip.x, seated_hip.y)
		seat = top - hip * guest_height
	sit_down = leave_counter + _travel(counter, seat)
	stand_up = sit_down + 2.0 * _clip_seconds(seated_action, frames.get_frame_count(seated_action))
	duration = 1.8 if reduced else stand_up + _travel(seat, home)

func visit_position(t: float) -> Vector2:
	if reduced:
		if t < pickup: return counter
		return seat if seated else home
	if t < arrival: return home.lerp(counter, smoothstep(0.0, arrival, t))
	if t < leave_counter: return counter
	if not seated: return counter.lerp(home, smoothstep(leave_counter, duration, t))
	if t < sit_down: return counter.lerp(seat, smoothstep(leave_counter, sit_down, t))
	if t < stand_up: return seat
	return seat.lerp(home, smoothstep(stand_up, duration, t))

func _toward(from: Vector2, to: Vector2, fallback: bool) -> bool:
	return fallback if absf(from.x - to.x) < 1.0 else to.x > from.x

func palm_at_counter() -> Vector2:
	var offset := Vector2(-open_palm.x if counter_right else open_palm.x, open_palm.y)
	return counter + offset * guest_height

func book_is_on_counter(t: float) -> bool:
	# The other three receive frames already contain the reader's green book.
	return t < pickup and (reduced or t >= arrival + _clip_seconds(&"receive", 1))

func pose(t: float) -> Transform2D:
	var right := counter_right
	if reduced:
		if t >= pickup: right = seat_right if seated else _toward(counter, home, not counter_right)
	elif t < arrival: right = _toward(home, counter, counter_right)
	elif t >= leave_counter:
		if not seated: right = _toward(counter, home, not counter_right)
		elif t < sit_down: right = _toward(counter, seat, seat_right)
		elif t < stand_up: right = seat_right
		else: right = _toward(seat, home, not seat_right)
	return Transform2D(0.0, Vector2(-1.0 if right else 1.0, 1.0), 0.0, visit_position(t))

func draw(board: Node2D, t: float) -> void:
	var action := &"walk"
	var elapsed := t
	if reduced:
		action = &"receive" if t < pickup else (seated_action if seated else &"carry")
		_draw_frame(board, action, 1 if t < pickup else 2)
		return
	if t >= arrival and t < leave_counter:
		action = &"receive"
		elapsed -= arrival
	elif t >= leave_counter:
		if not seated or t < sit_down:
			action = &"carry"
			elapsed -= leave_counter
		elif t < stand_up:
			action = seated_action
			elapsed -= sit_down
		else:
			action = return_action
			elapsed -= stand_up
	var count := frames.get_frame_count(action)
	var cycle := _clip_seconds(action, count)
	var remaining := minf(elapsed, cycle) if action == &"receive" else fposmod(elapsed, cycle)
	var index := 0
	while index < count - 1:
		var frame_time := frames.get_frame_duration(action, index) / frames.get_animation_speed(action)
		if remaining < frame_time: break
		remaining -= frame_time
		index += 1
	_draw_frame(board, action, index)

func _draw_frame(board: Node2D, action: StringName, index: int) -> void:
	var texture := frames.get_frame_texture(action, index)
	var size := texture.get_size() * (guest_height / (texture.get_height() * STANDING_HEIGHT))
	board.draw_texture_rect(texture, Rect2(-size * FOOT_PIVOT, size), false)

func guest_depth(z: float, actors: Dictionary, t: float) -> float:
	var counter_z := float(actors.stall.z) + 0.4
	if reduced and t < pickup: return counter_z
	if t < arrival: return lerpf(z, counter_z, smoothstep(0.0, arrival, t))
	if t < leave_counter: return counter_z
	if not seated: return z if reduced else lerpf(counter_z, z, smoothstep(leave_counter, duration, t))
	var seat_z := float(seat_slot.z) + (-0.25 if direct_table else 0.25)
	if actors.has("table") and _anchor(actors.table).y <= _anchor(seat_slot).y:
		seat_z = maxf(seat_z, float(actors.table.z) + 0.25)
	if reduced: return seat_z
	if t < sit_down: return lerpf(counter_z, seat_z, smoothstep(leave_counter, sit_down, t))
	if t < stand_up: return seat_z
	return lerpf(seat_z, z, smoothstep(stand_up, duration, t))
