extends RefCounted

const VisitorMotion = preload("res://visitor_motion.gd")

const RECIPES := {
	"cat-bench": ["black-cat", "bench"],
	"dog-song": ["dog", "musician"],
	"flower-hello": ["florist", "flower-cart"],
	"tree-coffee": ["tree", "cafe-table", "cafe-chair"],
}
const DURATIONS := {"cat-bench": 3.05, "dog-song": 3.35, "flower-hello": 2.2, "tree-coffee": 2.65, "market-buy": 5.45}
const SALE_TIME := 0.39

var kind := ""
var actors: Dictionary = {}
var reduced := false
var time := 0.0
var sale_emitted := false
var profile := "market"
var visitor_motion: VisitorMotion

func start(payload: Variant, records: Array, reduce: bool, motion_pairs: Dictionary = {}) -> bool:
	if not payload is Dictionary or not payload.get("id") is String:
		return false
	var source = payload.get("actors")
	if not source is Array: return false
	var market: bool = payload.id == "market-buy"
	var target_role: String = str(payload.get("targetRole", "stall"))
	if market and target_role not in ["stall", "table", "chair"]: return false
	var furniture := market and target_role != "stall"
	if furniture and source.size() != 2: return false
	var required: Array = ["customer","stall"] if market else RECIPES.get(payload.id,[])
	if market and source.size()==4: required.append_array(["table","chair"])
	elif market and source.size()==3: required.append("chair")
	if required.is_empty() or source.size() != required.size():
		return false
	var found := {}
	for actor in source:
		if not actor is Dictionary or not actor.get("asset") is String:
			return false
		for field in ["x", "y", "z"]:
			if typeof(actor.get(field)) not in [TYPE_INT, TYPE_FLOAT] or not is_finite(float(actor[field])):
				return false
		# Confirm the exact current instance; a delayed callback must not animate a different copy.
		for s in records:
			if s.asset == actor.asset and float(s.z) == float(actor.z) and absf(s.anchor[0]-actor.x) <= 0.51 and absf(s.anchor[1]-actor.y) <= 0.51:
				var key: String = str(s.get("role","")) if market else str(s.asset)
				if furniture:
					if key == target_role: key = "stall"
					elif key != "customer": return false
				if not required.has(key) or found.has(key): return false
				found[key] = s
				break
	if found.size() != required.size():
		return false
	var custom_frames: SpriteFrames
	if market:
		if payload.has("customerId") and payload.customerId != found.customer.id: return false
		if payload.has("stallId") and payload.stallId != found.stall.id: return false
		custom_frames = motion_pairs.get(found.customer.asset, {}).get(found.stall.asset)
		if furniture and not custom_frames: return false
	var squid_visit: bool = market and found.customer.asset == VisitorMotion.VISITOR and found.stall.asset == VisitorMotion.SQUID_STALL
	var book_visit: bool = market and found.customer.asset == VisitorMotion.READER and found.stall.asset == VisitorMotion.BOOK_KIOSK
	if market and source.size() == 3 and not squid_visit:
		if not custom_frames or not motion_pairs[found.customer.asset].has(found.chair.asset): return false
	kind = payload.id
	actors = found
	if market:
		profile = str(found.stall.get("profile", ""))
		if profile.is_empty(): profile = str(payload.get("profile", "market"))
	visitor_motion = null
	if squid_visit or book_visit or custom_frames:
		if not custom_frames: profile = "books" if book_visit else "market"
		visitor_motion = VisitorMotion.new()
		visitor_motion.configure(actors, market_stop(), reduce, book_visit, custom_frames)
	reduced = reduce
	time = 0.0
	sale_emitted = false
	return true

func clear() -> void:
	kind = ""
	actors = {}
	visitor_motion = null
	time = 0.0

func duration() -> float:
	if visitor_motion: return visitor_motion.duration
	return 0.88 if reduced else float(DURATIONS[kind])

func sale_time() -> float:
	return visitor_motion.pickup / visitor_motion.duration if visitor_motion else SALE_TIME

func anchor(asset: String) -> Vector2:
	var data: Array = actors[asset].anchor
	return Vector2(data[0], data[1])

func size_of(asset: String) -> Vector2:
	var data: Array = actors[asset].size
	return Vector2(data[0], data[1])

func owns(slot: Dictionary) -> bool:
	if kind == "market-buy" and actors.stall.id == slot.id: return true
	var key: String = str(slot.get("role","")) if kind=="market-buy" else str(slot.asset)
	return actors.has(key) and actors[key].id == slot.id

func phase(low: float, high: float) -> float:
	return clampf((time-low)/(high-low), 0.0, 1.0)

func cat_seat() -> Vector2:
	var bench := anchor("bench")
	var box := size_of("bench")
	return bench + Vector2(-box.x * 0.04, -box.y * 0.47)

func dog_run() -> Vector2:
	var home := anchor("dog")
	var band := anchor("musician")
	var side := -1.0 if home.x <= band.x else 1.0
	var circle_center := Vector2(clampf(band.x+side*21, 44, 820),clampf(band.y+2, 50, 874))
	var start := circle_center + Vector2(side*19,0)
	if time < 0.32:
		return home.lerp(start,smoothstep(0,1,phase(0,0.32)))
	if time < 0.7:
		var turn := phase(0.32,0.7)*TAU
		return circle_center+Vector2(cos(turn)*side*19, sin(turn)*12)
	return start.lerp(home,smoothstep(0,1,phase(0.7,1)))

func pose(slot: Dictionary) -> Transform2D:
	var pos := Vector2(slot.anchor[0],slot.anchor[1])
	var stretch := Vector2.ONE
	var angle := 0.0
	if visitor_motion and owns(slot) and slot.role == "customer":
		return visitor_motion.pose(time * visitor_motion.duration)
	if not reduced and kind == "market-buy" and owns(slot):
		if slot.role == "customer":
			pos = customer_position()
			var walking := market_walking()
			pos.y -= walking*3.0*absf(sin(time*TAU*10))
			angle = walking*.04*sin(time*TAU*10)
			if actors.has("chair"):
				var sit := smoothstep(0,1,phase(.66,.73))*(1.0-smoothstep(0,1,phase(.80,.86)))
				stretch = Vector2(1.0+sit*.04,1.0-sit*.15)
				angle += sit*.045*sin(time*TAU*10)
		elif slot.role == "stall":
			angle = .013*sin(PI*2*phase(.33,.49))*sin(PI*phase(.33,.49))
	elif not reduced and owns(slot):
		match slot.asset:
			"black-cat":
				if time < 0.09:
					stretch += Vector2(0.10,-0.13)*sin(PI*phase(0,0.09))
				elif time < 0.34 or (time >= 0.68 and time < 0.93):
					var forward := time < 0.34
					var f := phase(0.09,0.34) if forward else phase(0.68,0.93)
					var lift := sin(PI*f)
					pos = pos.lerp(cat_seat(),smoothstep(0,1,f) if forward else 1.0-smoothstep(0,1,f))
					pos.y -= lift * 48
					stretch += Vector2(-0.045,0.08)*lift
					angle = (-0.07 if forward else 0.07)*lift
				elif time >= 0.34 and time < 0.68:
					pos = cat_seat()
					stretch += Vector2(0.10,-0.12)*sin(PI*phase(0.34,0.42))
					angle = 0.025*sin(PI*phase(0.42,0.68))
				elif time >= 0.93:
					stretch += Vector2(0.055,-0.075)*sin(PI*phase(0.93,1))
			"dog":
				pos = dog_run()
				var pace := sin(time*TAU*8)
				var envelope := minf(phase(0,0.07),1.0-phase(0.90,1))
				pos.y -= absf(pace)*4*envelope
				angle = .085*pace*envelope
				stretch += Vector2(.04,-.04)*absf(pace)*envelope
				var from_left := anchor("dog").x <= anchor("musician").x
				var right := from_left if time < .32 else (not from_left if time >= .7 else (sin(phase(.32,.7)*TAU)>0)==from_left)
				if right and time > .025 and time < .965:
					stretch.x *= -1
			"musician":
				angle = 0.035*sin(TAU*3*time)*sin(PI*time)
			"florist":
				angle = 0.060*sin(TAU*2*time)*sin(PI*time)
			"flower-cart":
				angle = 0.023*sin(TAU*2*phase(0.38,0.95))*sin(PI*phase(0.38,0.95))
			"tree":
				angle = 0.034*sin(TAU*time)*sin(PI*time)
			"cafe-chair":
				angle = -0.042*sin(TAU*phase(0.45,0.92))*sin(PI*phase(0.45,0.92))
	return Transform2D(angle,stretch,0,pos)

func depth(slot: Dictionary) -> float:
	var z := float(slot.z)
	if (reduced and not visitor_motion) or not owns(slot):
		return z
	if visitor_motion and slot.role == "table" and actors.has("table") and actors.has("chair") and anchor("table").y > anchor("chair").y:
		var t := time * visitor_motion.duration
		if reduced: return maxf(z, float(actors.chair.z) + 0.60) if t >= visitor_motion.pickup else z
		var seated := smoothstep(visitor_motion.leave_counter, visitor_motion.sit_down, t) * (1.0 - smoothstep(visitor_motion.stand_up, visitor_motion.duration, t))
		return lerpf(z, maxf(z, float(actors.chair.z) + 0.60), seated)
	if kind == "market-buy" and slot.role == "customer":
		if visitor_motion: return visitor_motion.guest_depth(z, actors, time * visitor_motion.duration)
		var stall_z := float(actors.stall.z)+.4
		var leave := .47 if actors.has("chair") else .61
		if time<leave: return lerpf(z,stall_z,smoothstep(0,1,phase(.03,.29)))
		if not actors.has("chair"): return lerpf(stall_z,z,smoothstep(0,1,phase(.61,.97)))
		var chair_z := float(actors.chair.z)+.35
		if time<.82: return lerpf(stall_z,chair_z,smoothstep(0,1,phase(.47,.69)))
		return lerpf(chair_z,z,smoothstep(0,1,phase(.82,.97)))
	if slot.asset == "black-cat":
		var height := smoothstep(0,1,phase(0.09,0.27))*(1.0-smoothstep(0,1,phase(0.77,0.93)))
		return lerpf(z,float(actors.bench.z)+0.4,height)
	if slot.asset == "dog":
		var near := smoothstep(0,1,phase(0.08,0.30))*(1.0-smoothstep(0,1,phase(0.76,0.96)))
		var side := 0.4 if dog_run().y >= anchor("musician").y else -0.4
		return lerpf(z,float(actors.musician.z)+side,near)
	return z

func market_stop() -> Vector2:
	var stall := anchor("stall")
	var customer := anchor("customer")
	var guest_size := size_of("customer")
	var side := -1.0 if customer.x<stall.x else 1.0
	var p := stall+Vector2(side*size_of("stall").x*.25,clampf(size_of("stall").y*.075,5,14))
	return p.clamp(Vector2(guest_size.x*.5,guest_size.y),Vector2(864-guest_size.x*.5,900))

func market_seat() -> Vector2:
	var chair := anchor("chair")
	var table := anchor("table")
	var guest_size := size_of("customer")
	var p := chair+Vector2(signf(table.x-chair.x)*size_of("chair").x*.09,-size_of("chair").y*.18)
	return p.clamp(Vector2(guest_size.x*.5,guest_size.y),Vector2(864-guest_size.x*.5,900))

func customer_position() -> Vector2:
	var home := anchor("customer")
	var counter := market_stop()
	if time < .31: return home.lerp(counter,smoothstep(0,1,phase(0,.31)))
	if not actors.has("chair"):
		return counter.lerp(home,smoothstep(0,1,phase(.61,1)))
	if time < .71: return counter.lerp(market_seat(),smoothstep(0,1,phase(.47,.71)))
	return market_seat().lerp(home,smoothstep(0,1,phase(.82,1)))

func market_walking() -> float:
	if time<.31: return sin(PI*phase(0,.31))
	if not actors.has("chair"): return sin(PI*phase(.61,1))
	if time<.71: return sin(PI*phase(.47,.71))
	return sin(PI*phase(.82,1))

func bowl(board: Node2D, p: Vector2) -> void:
	var rim := Color("#805a3a")
	board.draw_colored_polygon(PackedVector2Array([p+Vector2(-6,0),p+Vector2(6,0),p+Vector2(4.5,3.5),
		p+Vector2(2.5,5),p+Vector2(-2.5,5),p+Vector2(-4.5,3.5)]),Color("#dc9761"))
	board.draw_line(p+Vector2(-6,0),p+Vector2(6,0),rim,1.4,true)
	board.draw_line(p+Vector2(1.5,.4),p+Vector2(5.5,-6),Color("#796345"),1.1,true)

func handover_item(board: Node2D, p: Vector2, seated := false) -> void:
	var ink := Color("#504b3e")
	match profile:
		"market":
			if visitor_motion or "鱿鱼" in str(actors.stall.name):
				var wood := Color("#d9b57e")
				board.draw_line(p+Vector2(-4,6), p+Vector2(5,-9), wood, 2.1, true)
				var tip := p+Vector2(2,-4)
				board.draw_colored_polygon(PackedVector2Array([tip+Vector2(-4,1),tip+Vector2(1,-6),tip+Vector2(5,-3),tip+Vector2(2,3)]),Color("#c56349"))
				for i in 3:
					board.draw_line(tip+Vector2(-2+i*1.6,1),tip+Vector2(-4+i*1.6,4+i%2),Color("#dc9871"),1.3,true)
			else: bowl(board,p)
		"books":
			# The pages open in the reader's hands when a reading place is available.
			var spread := 9.0 if seated else 5.0
			for side in [-1.0, 1.0]:
				var edge := Vector2(side*spread, -2)
				var pages := PackedVector2Array([p, p+edge, p+edge+Vector2(0,-8), p+Vector2(0,-7)])
				board.draw_colored_polygon(pages, Color("#ffedbd") if side < 0 else Color("#edcc8c"))
				board.draw_line(p,p+edge,Color("#925047"),2.2,true)
				if seated:
					var turn := sin(phase(.70,.82)*PI)*2.5
					board.draw_line(p+Vector2(side*2,-4),p+Vector2(side*(spread-2),-5-turn),ink,.8,true)
		"garden":
			board.draw_colored_polygon(PackedVector2Array([p+Vector2(-6,-2),p+Vector2(6,-2),p+Vector2(4,5),p+Vector2(-4,5)]),Color("#b87854"))
			var shoot := p+Vector2(0,-8-(3.0*sin(phase(.70,.82)*PI) if seated else 0.0))
			board.draw_line(p+Vector2(0,-2),shoot,Color("#57734e"),1.5,true)
			draw_leaf(board,shoot+Vector2(-2,-1),.6,Color("#819559"))
			draw_leaf(board,shoot+Vector2(2,-3),-.6,Color("#58794c"))
		"studio":
			board.draw_circle(p,5.2,Color("#daae77"),true,-1,true)
			for i in 3:
				board.draw_circle(p+Vector2.from_angle(-2.7+i*1.2)*3,1.5,[Color("#9b5342"),Color("#587d79"),Color("#c9973b")][i],true,-1,true)
			var tip := p+Vector2(6,-8)
			if seated: tip.x += sin(time*TAU*9)*3.0
			board.draw_line(p+Vector2(2,2),tip,ink,1.6,true)
		"general":
			board.draw_rect(Rect2(p-Vector2(5,6),Vector2(11,10)),Color("#d8af77"))
			board.draw_line(p+Vector2(0,-6),p+Vector2(0,4),Color("#8a6248"),1.5,true)
		_:
			bowl(board,p)

func carried(board: Node2D, slot: Dictionary) -> void:
	if visitor_motion: return # The held object is already inked into these frames.
	if kind != "market-buy" or reduced or slot.get("role") != "customer" or not owns(slot) or time < .44 or time>.91: return
	var size := size_of("customer")
	var p := Vector2(-size.x*.22,-size.y*.46)
	var seated := actors.has("chair") and time>.70 and time<.82
	if seated:
		p.y -= 5.0*absf(sin(phase(.70,.82)*TAU))
	handover_item(board,p,seated)

func market_props(board: Node2D) -> void:
	if visitor_motion and visitor_motion.custom: return # The workshop artist supplies all held props in the atlas.
	var stall := anchor("stall")
	var shop := size_of("stall")
	var side := -1.0 if market_stop().x<stall.x else 1.0
	var counter := stall+Vector2(side*shop.x*.22,-shop.y*.35)
	if visitor_motion and profile == "books":
		# The reader presents the book she carries. Stamp the loan on the counter.
		var now := time * visitor_motion.duration
		if now >= visitor_motion.arrival and now < visitor_motion.leave_counter + 0.28:
			if visitor_motion.book_is_on_counter(now):
				var cover := PackedVector2Array([counter+Vector2(-6,-2), counter+Vector2(3,-5),
					counter+Vector2(7,1), counter+Vector2(-2,4)])
				board.draw_colored_polygon(cover, Color("#38574a"))
				board.draw_line(cover[2],cover[3],Color("#d9c38b"),1.3,true)
			var lift := 0.0 if reduced else 7.0 * smoothstep(0, 0.22, absf(now - visitor_motion.pickup))
			var stamp := counter - Vector2(0, lift)
			board.draw_circle(stamp - Vector2(0, 6), 3.3, Color("#875a38"), true, -1, true)
			board.draw_rect(Rect2(stamp - Vector2(5, 4), Vector2(10, 3.5)), Color("#a43b2e"))
			if now >= visitor_motion.pickup:
				board.draw_line(counter - Vector2(4,0), counter + Vector2(4,0), Color("#ac5240"), 1.6, true)
		return
	if reduced:
		if not visitor_motion or time < sale_time(): handover_item(board,counter)
		return
	if visitor_motion:
		var now := time * visitor_motion.duration
		# End the transfer as the second extended hand frame gives way to the held skewer.
		if now >= visitor_motion.arrival and now < visitor_motion.pickup:
			var f := smoothstep(visitor_motion.arrival, visitor_motion.pickup, now)
			var palm := visitor_motion.palm_at_counter()
			handover_item(board, counter.lerp(palm,f) - Vector2(0, sin(PI*f)*4))
		return
	var guest := customer_position()
	var hand := guest+Vector2(-side*size_of("customer").x*.25,-size_of("customer").y*.43)
	for i in 3:
		if profile != "market": break
		var f := phase(.29+i*.03,.37+i*.03)
		if f<=0 or f>=1: continue
		var p := hand.lerp(counter,f)+Vector2(0,-sin(PI*f)*13)
		board.draw_circle(p,4.4,Color("#965d2e"),true,-1,true)
		board.draw_circle(p,3.4,Color("#f4cb65"),true,-1,true)
		board.draw_line(p+Vector2(0,-1.7),p+Vector2(0,1.7),Color("#b88037"),1,true)
	var serve := phase(.385,.445)
	if serve>0 and serve<1: handover_item(board,counter.lerp(hand,serve)+Vector2(0,-sin(PI*serve)*4))

func draw_note(board: Node2D,p: Vector2,color: Color) -> void:
	board.draw_circle(p,2.7,color,true,-1,true)
	board.draw_line(p+Vector2(1.8,0),p+Vector2(1.8,-11),color,1.8,true)
	board.draw_polyline(PackedVector2Array([p+Vector2(1.8,-11),p+Vector2(5.5,-9),p+Vector2(6.5,-6.5)]),color,1.6,true)

func draw_leaf(board: Node2D,p: Vector2,a: float,color: Color) -> void:
	var along := Vector2.from_angle(a)
	var across := along.orthogonal()
	board.draw_colored_polygon(PackedVector2Array([p-along*5,p-along*2+across*2.3,p+along*3+across*1.6,p+along*5,p+along*2-across*2.3,p-along*2-across*1.5]),color)

func accents(board: Node2D) -> void:
	if kind.is_empty(): return
	if kind=="market-buy":
		market_props(board)
		return
	if reduced:
		# No positional animation: briefly print a stationary handwritten accent beside both actors.
		for id in actors:
			var p := anchor(id) - Vector2(0,size_of(id).y+4)
			var ink := Color("#a1663d")
			if kind == "dog-song": draw_note(board,p,ink)
			else:
				for i in [-1,0,1]:
					var d := Vector2(i*.58,-1).normalized()
					board.draw_line(p+d*3,p+d*8,ink,1.8,true)
		return
	if kind == "cat-bench" and time > 0.36 and time < 0.68:
		var p := cat_seat()-Vector2(0,size_of("black-cat").y+4)
		for i in [-1,0,1]:
			var d := Vector2(i*.65,-1).normalized()
			board.draw_line(p+d*2.5,p+d*7,Color(Color("#b1844c"),sin(PI*phase(.36,.68))),1.7,true)
	elif kind == "dog-song":
		for i in 5:
			var f := phase(0.05+i*.115,0.36+i*.115)
			if f<=0 or f>=1: continue
			var start := anchor("musician")-Vector2(0,size_of("musician").y*.73)
			var p := start+Vector2(13+sin(i*2.1+f*PI)*9,-f*27)
			draw_note(board,p,Color(Color("#446458"),sin(PI*f)))
	elif kind == "flower-hello" or kind == "tree-coffee":
		for i in 7:
			var f := phase(0.03+i*.055,0.60+i*.055)
			if f<=0 or f>=1: continue
			var floral := kind == "flower-hello"
			var start_id := "florist" if floral else "tree"
			var end_id := "flower-cart" if floral else ("cafe-table" if i%2==0 else "cafe-chair")
			var start := anchor(start_id)+Vector2(9,-size_of(start_id).y*(.64 if floral else .7))
			var end := anchor(end_id)-Vector2(0,size_of(end_id).y*(.51 if floral else .83))
			var oscillation := sin(f*TAU+i)*sin(f*PI)
			var p := start.lerp(end,f)+Vector2(oscillation*13,sin(PI*f)*(-26 if floral else -6)+oscillation*5)
			var paint := ["#c86a53","#e4a257","#cb8165"] if floral else ["#939c52","#b6a657","#879059"]
			draw_leaf(board,p,f*4+i,Color(Color(paint[i%3]),minf(1,sin(PI*f)*2)))

