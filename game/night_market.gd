extends RefCounted

# All coordinates are in the town's 864 × 900 logical canvas.
const SKY := Color("#293746")
const BACKGROUND := preload("res://assets/ground-night.webp")

var glow := GradientTexture2D.new()

func _init() -> void:
	var soft := Gradient.new()
	soft.offsets = PackedFloat32Array([0,0.32,0.70,1])
	soft.colors = PackedColorArray([Color(1,0.77,0.40,.73),Color(1,0.68,0.31,.36),Color(1,0.62,0.25,.09),Color(1,0.6,0.22,0)])
	glow.gradient = soft
	glow.fill = GradientTexture2D.FILL_RADIAL
	glow.fill_from = Vector2(.5,.5)
	glow.fill_to = Vector2(1,.5)
	glow.width = 128
	glow.height = 128

func backdrop(board: Node2D, board_size: Vector2, slots: Array) -> void:
	board.draw_texture_rect(BACKGROUND,Rect2(Vector2.ZERO,board_size),false)
	for slot in slots:
		var base := Vector2(slot.anchor[0],slot.anchor[1])
		var size := Vector2(slot.size[0],slot.size[1])
		if slot.asset == "lamp":
			var lamp := base-Vector2(0,size.y*.875)
			board.draw_texture_rect(glow,Rect2(lamp-Vector2(32,32),Vector2(64,64)),false)
		if slot.get("role","") != "stall": continue
		var pool := Vector2(size.x*1.7,maxf(55,size.y*.46))
		board.draw_texture_rect(glow,Rect2(base-pool*.5,pool),false)
		var halo := Vector2(maxf(125,size.x*1.27),maxf(120,size.y*1.15))
		board.draw_texture_rect(glow,Rect2(base-Vector2(0,size.y*.62)-halo*.5,halo),false,Color(1,1,1,.72))

