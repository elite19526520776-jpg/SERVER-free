#!/usr/bin/env python3
"""
程序化生成写实材质包，含 LabPBR 1.3 法线图与高光图。
Procedurally generates a realistic resource pack with LabPBR 1.3 normal and specular maps.

每个方块产出三张 64x64（原版 16x16）：
Three 64x64 files per block (vanilla is 16x16):

    <name>.png      反照率 / albedo
    <name>_n.png    RG = 切线空间法线, B = 环境光遮蔽, A = 高度
                    RG = tangent normal, B = ambient occlusion, A = height
    <name>_s.png    R = 感知光滑度, G = F0/金属度, B = 孔隙/次表面, A = 自发光
                    R = perceptual smoothness, G = F0/metalness, B = porosity/SSS, A = emission

不依赖第三方库。No third-party dependencies.

    python3 tools/generate_pack.py [--mod-pack <目录>]

--mod-pack 会顺带把反照率同步到 Realistic Blocks 模组的内置材质包，
保证两边永远是同一套图。Keeps the mod's built-in pack in sync from the same source.
"""

import argparse
import math
import os
import random
import struct
import sys
import zlib

SIZE = 64
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(HERE, "assets", "minecraft", "textures", "block")

# LabPBR 里 F0 通道 230-237 是预定义金属，238-255 是"用反照率当 F0"的通用金属。
# In LabPBR the F0 channel uses 230-237 for named metals and 238-255 for generic ones.
METAL_IRON = 230
METAL_GOLD = 231
METAL_COPPER = 234
METAL_GENERIC = 255

# 高光图 alpha 写 255 表示"这块没有自发光"，不是"自发光为 0"。
# An emission alpha of 255 means "no emission data", which is not the same as zero.
NO_EMISSION = 255


# ============================================================================ PNG

def write_png(path, pixels):
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for r, g, b, a in row:
            raw += bytes((int(r) & 255, int(g) & 255, int(b) & 255, int(a) & 255))

    def chunk(tag, data):
        out = struct.pack(">I", len(data)) + tag + data
        return out + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as handle:
        handle.write(png)


# ========================================================================== 噪声

_noise_cache = {}


def value_noise(cells, seed):
    key = (cells, seed)
    if key in _noise_cache:
        return _noise_cache[key]
    rnd = random.Random(seed)
    grid = [[rnd.random() for _ in range(cells)] for _ in range(cells)]
    out = [[0.0] * SIZE for _ in range(SIZE)]
    scale = cells / SIZE
    for y in range(SIZE):
        fy = y * scale
        y0 = int(fy) % cells
        y1 = (y0 + 1) % cells
        ty = fy - int(fy)
        ty = ty * ty * (3 - 2 * ty)
        for x in range(SIZE):
            fx = x * scale
            x0 = int(fx) % cells
            x1 = (x0 + 1) % cells
            tx = fx - int(fx)
            tx = tx * tx * (3 - 2 * tx)
            top = grid[y0][x0] * (1 - tx) + grid[y0][x1] * tx
            bot = grid[y1][x0] * (1 - tx) + grid[y1][x1] * tx
            out[y][x] = top * (1 - ty) + bot * ty
    _noise_cache[key] = out
    return out


def fbm(seed, base=4, octaves=4):
    """
    分形叠加噪声。base 必须整除 SIZE，否则噪声不可平铺 —— 与其悄悄降级，不如直接报错。
    Fractal noise. base must divide SIZE or the result will not tile; fail loudly rather
    than silently degrade.
    """
    if SIZE % base:
        raise ValueError("fbm base %d does not divide SIZE %d" % (base, SIZE))
    acc = [[0.0] * SIZE for _ in range(SIZE)]
    amp = 1.0
    total = 0.0
    cells = base
    for i in range(octaves):
        if SIZE % cells:
            break   # 频率翻倍到超出网格就停，此时 total 已经 > 0
        layer = value_noise(cells, seed + i * 977)
        for y in range(SIZE):
            row = acc[y]
            src = layer[y]
            for x in range(SIZE):
                row[x] += src[x] * amp
        total += amp
        amp *= 0.5
        cells *= 2
    return [[v / total for v in row] for row in acc]


_cells_cache = {}


def cells_map(count, seed):
    """可平铺 Voronoi，返回 (格子编号, 到边界距离)。Tileable Voronoi: (cell id, edge distance)."""
    key = (count, seed)
    if key in _cells_cache:
        return _cells_cache[key]
    rnd = random.Random(seed)
    sites = [(rnd.uniform(0, SIZE), rnd.uniform(0, SIZE)) for _ in range(count)]
    ids = [[0] * SIZE for _ in range(SIZE)]
    edge = [[0.0] * SIZE for _ in range(SIZE)]
    for y in range(SIZE):
        for x in range(SIZE):
            best = second = 1e9
            best_i = 0
            for i, (sx, sy) in enumerate(sites):
                dx = abs(x - sx)
                dy = abs(y - sy)
                dx = min(dx, SIZE - dx)
                dy = min(dy, SIZE - dy)
                d = dx * dx + dy * dy
                if d < best:
                    second, best, best_i = best, d, i
                elif d < second:
                    second = d
            ids[y][x] = best_i
            edge[y][x] = math.sqrt(second) - math.sqrt(best)
    _cells_cache[key] = (ids, edge)
    return ids, edge


def speckle(seed, density, strength):
    rnd = random.Random(seed)
    out = [[0.0] * SIZE for _ in range(SIZE)]
    for _ in range(int(SIZE * SIZE * density)):
        out[rnd.randrange(SIZE)][rnd.randrange(SIZE)] += rnd.uniform(-strength, strength)
    return out


# ========================================================================== 调色

def ramp(stops, t):
    t = max(0.0, min(1.0, t))
    for i in range(len(stops) - 1):
        p0, c0 = stops[i]
        p1, c1 = stops[i + 1]
        if p0 <= t <= p1:
            k = 0.0 if p1 == p0 else (t - p0) / (p1 - p0)
            return tuple(c0[j] + (c1[j] - c0[j]) * k for j in range(3))
    return stops[-1][1]


def shade(color, factor):
    return tuple(max(0.0, min(255.0, c * factor)) for c in color)


def clamp8(v):
    return max(0, min(255, int(round(v))))


# ================================================================ 材质数据结构

class Material:
    """一张材质的全部信息：颜色 + 高度 + PBR 参数。Everything one texture needs."""

    def __init__(self, color, height, smoothness=0.04, f0=0.04,
                 porosity=0.0, emission=None, normal_strength=2.4):
        self.color = color                    # [[ (r,g,b,a) ]]
        self.height = height                  # [[ 0..1 ]]
        self.smoothness = smoothness          # float 或 [[0..1]]
        self.f0 = f0                          # float(0..1) 或 int(230-255 金属)
        self.porosity = porosity              # float 0..1，写进 0-64 区间
        self.emission = emission              # None = 无自发光；float 或 [[0..1]]
        self.normal_strength = normal_strength


def field(value, x, y):
    if isinstance(value, list):
        return value[y][x]
    return value


# ------------------------------------------------------------ 法线 / AO 推导

def box_blur(grid, radius):
    tmp = [[0.0] * SIZE for _ in range(SIZE)]
    span = radius * 2 + 1
    for y in range(SIZE):
        row = grid[y]
        for x in range(SIZE):
            s = 0.0
            for dx in range(-radius, radius + 1):
                s += row[(x + dx) % SIZE]
            tmp[y][x] = s / span
    out = [[0.0] * SIZE for _ in range(SIZE)]
    for y in range(SIZE):
        for x in range(SIZE):
            s = 0.0
            for dy in range(-radius, radius + 1):
                s += tmp[(y + dy) % SIZE][x]
            out[y][x] = s / span
    return out


def build_normal_map(material):
    """
    从高度场求法线，同时用"高度 - 模糊高度"当作缝隙遮蔽。
    Normals from the height field; cavity AO from height minus its blur.
    """
    h = material.height
    strength = material.normal_strength
    blurred = box_blur(h, 3)
    out = []
    for y in range(SIZE):
        row = []
        for x in range(SIZE):
            # 环绕采样保证材质可平铺。Wrapped sampling keeps the texture tileable.
            dhdu = (h[y][(x + 1) % SIZE] - h[y][(x - 1) % SIZE]) * 0.5
            dhdv = (h[(y + 1) % SIZE][x] - h[(y - 1) % SIZE][x]) * 0.5
            nx = -dhdu * strength
            ny = dhdv * strength          # OpenGL 约定：绿通道朝上
            nz = 1.0
            inv = 1.0 / math.sqrt(nx * nx + ny * ny + nz * nz)
            nx *= inv
            ny *= inv

            cavity = (h[y][x] - blurred[y][x]) * 2.6 + 0.5
            ao = max(0.0, min(1.0, 0.45 + cavity * 0.55))

            row.append((
                clamp8(nx * 0.5 * 255 + 127.5),
                clamp8(ny * 0.5 * 255 + 127.5),
                clamp8(ao * 255),
                clamp8(h[y][x] * 255),
            ))
        out.append(row)
    return out


def build_specular_map(material):
    out = []
    for y in range(SIZE):
        row = []
        for x in range(SIZE):
            smooth = clamp8(field(material.smoothness, x, y) * 255)

            f0 = material.f0
            if isinstance(f0, int) and f0 >= 230:
                f0_enc = f0                       # 金属索引直接写
            else:
                f0_enc = clamp8(field(f0, x, y) * 255)

            porosity = clamp8(field(material.porosity, x, y) * 64)

            if material.emission is None:
                emission = NO_EMISSION
            else:
                emission = min(254, clamp8(field(material.emission, x, y) * 254))

            row.append((smooth, f0_enc, porosity, emission))
        out.append(row)
    return out


# ============================================================== 通用材质配方

def grainy(stops, seed, base=4, octaves=4, grain_density=0.55, grain=26,
           smoothness=0.04, f0=0.04, porosity=0.05, height_scale=1.0,
           normal_strength=2.4):
    """噪声着色 + 细颗粒，石头泥土沙子都从这里出。The workhorse for stone, dirt and sand."""
    noise = fbm(seed, base, octaves)
    grains = speckle(seed + 31, grain_density, grain / 255.0)
    color = []
    height = []
    for y in range(SIZE):
        crow = []
        hrow = []
        for x in range(SIZE):
            c = ramp(stops, noise[y][x])
            g = grains[y][x]
            crow.append(tuple(clamp8(v + g * 255) for v in c) + (255,))
            hrow.append(max(0.0, min(1.0, (noise[y][x] * 0.85 + g * 2.0 + 0.08) * height_scale)))
        color.append(crow)
        height.append(hrow)
    return Material(color, height, smoothness, f0, porosity,
                    normal_strength=normal_strength)


def rubble(stops, count, seed, joint_depth=0.42, tone_range=(0.74, 1.15),
           smoothness=0.05, f0=0.04, porosity=0.08, normal_strength=3.4):
    """碎石块：Voronoi 分块 + 缝隙压暗。Broken stone: Voronoi cells with dark joints."""
    ids, edge = cells_map(count, seed)
    noise = fbm(seed + 7, base=8, octaves=3)
    rnd = random.Random(seed)
    tones = [rnd.uniform(*tone_range) for _ in range(max(count, 8))]
    color = []
    height = []
    for y in range(SIZE):
        crow = []
        hrow = []
        for x in range(SIZE):
            base_color = ramp(stops, noise[y][x])
            c = shade(base_color, tones[ids[y][x] % len(tones)])
            e = edge[y][x]
            h = 0.35 + noise[y][x] * 0.25
            if e < 1.4:
                c = shade(c, joint_depth)
                h = 0.04
            elif e < 2.6:
                c = shade(c, 0.78)
                h = 0.5 + noise[y][x] * 0.2
            else:
                h = 0.7 + noise[y][x] * 0.3
            crow.append(tuple(clamp8(v) for v in c) + (255,))
            hrow.append(h)
        color.append(crow)
        height.append(hrow)
    return Material(color, height, smoothness, f0, porosity,
                    normal_strength=normal_strength)


def masonry(stops, mortar_color, block_h, block_w, joint, seed,
            tone_range=(0.88, 1.12), smoothness=0.06, f0=0.04, porosity=0.12,
            cracked=False, normal_strength=3.6):
    """砖石砌体：错缝排布 + 砂浆凹陷。Coursed masonry with recessed mortar."""
    noise = fbm(seed, base=8, octaves=3)
    rnd = random.Random(seed)
    tones = {}
    cracks = fbm(seed + 501, base=4, octaves=3) if cracked else None
    color = []
    height = []
    for y in range(SIZE):
        crow = []
        hrow = []
        rowidx = y // block_h
        offset = (rowidx % 2) * (block_w // 2)
        for x in range(SIZE):
            bx = (x + offset) % SIZE
            in_joint = (y % block_h) < joint or (bx % block_w) < joint
            if in_joint:
                m = noise[y][x] * 22 - 8
                crow.append(tuple(clamp8(mortar_color[i] + m) for i in range(3)) + (255,))
                hrow.append(0.06 + noise[y][x] * 0.06)
            else:
                key = (rowidx, bx // block_w)
                if key not in tones:
                    tones[key] = rnd.uniform(*tone_range)
                c = shade(ramp(stops, noise[y][x]), tones[key])
                h = 0.68 + noise[y][x] * 0.28
                if cracked and cracks[y][x] > 0.68:
                    c = shade(c, 0.55)
                    h = 0.2
                crow.append(tuple(clamp8(v) for v in c) + (255,))
                hrow.append(h)
        color.append(crow)
        height.append(hrow)
    return Material(color, height, smoothness, f0, porosity,
                    normal_strength=normal_strength)


def planks(stops, seed, plank_h=16, seam_color=(88, 62, 34), smoothness=0.16,
           tone_range=(0.88, 1.12)):
    """木板：横向木纹 + 板间缝。Planks: lengthwise grain with seams between boards."""
    noise = fbm(seed, base=16, octaves=3)
    rnd = random.Random(seed)
    tones = [rnd.uniform(*tone_range) for _ in range(SIZE // plank_h + 1)]
    color = []
    height = []
    for y in range(SIZE):
        crow = []
        hrow = []
        idx = y // plank_h
        for x in range(SIZE):
            if y % plank_h == 0:
                crow.append(seam_color + (255,))
                hrow.append(0.05)
                continue
            grain = 0.5 + 0.5 * math.sin((y * 2.4) + noise[y][x] * 9.0 + math.sin(x * 0.18) * 1.4)
            t = grain * 0.7 + noise[y][x] * 0.3
            c = shade(ramp(stops, t), tones[idx])
            crow.append(tuple(clamp8(v) for v in c) + (255,))
            # 木纹的硬材部分略微凸起。Harder grain stands slightly proud.
            hrow.append(0.55 + t * 0.4)
        color.append(crow)
        height.append(hrow)
    return Material(color, height, smoothness, 0.04, 0.35, normal_strength=2.0)


def bark(stops, seed, ridge_freq=1.05, smoothness=0.05):
    """树皮：竖向沟壑。Bark: vertical fissures."""
    noise = fbm(seed, base=8, octaves=4)
    color = []
    height = []
    for y in range(SIZE):
        crow = []
        hrow = []
        for x in range(SIZE):
            ridge = 0.5 + 0.5 * math.sin(x * ridge_freq + noise[y][x] * 7.0)
            ridge = ridge ** 1.6
            t = ridge * 0.75 + noise[y][x] * 0.25
            crow.append(tuple(clamp8(v) for v in ramp(stops, t)) + (255,))
            hrow.append(t)
        color.append(crow)
        height.append(hrow)
    return Material(color, height, smoothness, 0.04, 0.4, normal_strength=3.8)


def log_top(stops, seed, rim_shade=0.55):
    """年轮。Growth rings."""
    noise = fbm(seed, base=8, octaves=3)
    center = (SIZE - 1) / 2.0
    color = []
    height = []
    for y in range(SIZE):
        crow = []
        hrow = []
        for x in range(SIZE):
            dist = math.hypot(x - center, y - center)
            ring = 0.5 + 0.5 * math.sin(dist * 1.35 + noise[y][x] * 3.0)
            t = ring * 0.8 + noise[y][x] * 0.2
            c = ramp(stops, t)
            h = 0.5 + t * 0.4
            if dist > SIZE * 0.47:
                c = shade(c, rim_shade)
                h = 0.3
            crow.append(tuple(clamp8(v) for v in c) + (255,))
            hrow.append(h)
        color.append(crow)
        height.append(hrow)
    return Material(color, height, 0.12, 0.04, 0.35, normal_strength=2.2)


def leaves(seed, tone=(1.0, 1.0, 1.0), gap_threshold=0.34):
    """树叶：灰阶（游戏会按群系染色）+ 成簇叶隙。Greyscale (biome-tinted) with clustered gaps."""
    # base=2 会开出整块的大洞；4 对应 16 像素，正好是"叶片之间"的尺度。
    # base=2 punches block-sized holes; 4 lands at 16px, the scale of gaps between leaves.
    gaps = fbm(seed, base=4, octaves=2)
    detail = fbm(seed + 3, base=8, octaves=3)
    rnd = random.Random(seed)
    color = [[(0, 0, 0, 0)] * SIZE for _ in range(SIZE)]
    height = [[0.0] * SIZE for _ in range(SIZE)]
    for y in range(SIZE):
        for x in range(SIZE):
            if gaps[y][x] < gap_threshold:
                continue
            v = 96 + detail[y][x] * 120
            color[y][x] = (clamp8(v * tone[0]), clamp8(v * tone[1]), clamp8(v * tone[2]), 255)
            height[y][x] = 0.4 + detail[y][x] * 0.4
    for _ in range(90):
        cx, cy = rnd.randrange(SIZE), rnd.randrange(SIZE)
        if color[cy][cx][3] == 0:
            continue
        rx, ry = rnd.randint(2, 4), rnd.randint(3, 6)
        angle = rnd.uniform(0.0, math.tau)
        ca, sa = math.cos(angle), math.sin(angle)
        base_tone = rnd.randint(118, 232)
        for dy in range(-ry, ry + 1):
            for dx in range(-rx, rx + 1):
                u = (dx * ca + dy * sa) / rx
                v = (-dx * sa + dy * ca) / ry
                if u * u + v * v > 1.0:
                    continue
                x, y = (cx + dx) % SIZE, (cy + dy) % SIZE
                if color[y][x][3] == 0:
                    continue
                lv = base_tone - 34 if abs(u) < 0.22 else base_tone
                lv = max(70, min(255, lv + rnd.randint(-8, 8)))
                color[y][x] = (clamp8(lv * tone[0]), clamp8(lv * tone[1]), clamp8(lv * tone[2]), 255)
                height[y][x] = 0.75 - abs(u) * 0.3
    # 叶片自带一点次表面散射，阳光能透过去。Leaves scatter light; sun shines through them.
    return Material(color, height, 0.22, 0.04, 0.85, normal_strength=2.0)


def ore(base_material, mineral_stops, seed, count=12, emission=None,
        smoothness=0.35, f0=0.04, sparkle=True):
    """矿石：在母岩上嵌矿物结核。Ore: mineral nodules embedded in the host rock."""
    color = [row[:] for row in base_material.color]
    height = [row[:] for row in base_material.height]
    smooth_field = [[base_material.smoothness if not isinstance(base_material.smoothness, list)
                     else base_material.smoothness[y][x] for x in range(SIZE)] for y in range(SIZE)]
    f0_field = [[0.04] * SIZE for _ in range(SIZE)]
    emit_field = [[0.0] * SIZE for _ in range(SIZE)] if emission is not None else None

    rnd = random.Random(seed)
    detail = fbm(seed + 11, base=16, octaves=2)
    for _ in range(count):
        cx, cy = rnd.randrange(SIZE), rnd.randrange(SIZE)
        radius = rnd.randint(4, 8)
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                d = math.hypot(dx, dy) / radius
                # 边缘用噪声打碎，矿脉才不会是一堆圆点。
                # Noise-broken edges keep the veins from looking like polka dots.
                x, y = (cx + dx) % SIZE, (cy + dy) % SIZE
                if d > 0.55 + detail[y][x] * 0.5:
                    continue
                t = detail[y][x] * 0.6 + (1.0 - d) * 0.4
                c = ramp(mineral_stops, t)
                if sparkle and rnd.random() < 0.10:
                    c = shade(c, 1.35)
                color[y][x] = tuple(clamp8(v) for v in c) + (255,)
                height[y][x] = 0.72 + t * 0.28
                smooth_field[y][x] = smoothness
                f0_field[y][x] = f0
                if emit_field is not None:
                    emit_field[y][x] = emission * (0.6 + t * 0.4)

    return Material(color, height, smooth_field, f0_field, 0.03,
                    emission=emit_field, normal_strength=3.0)


def metal(base_color, seed, f0_index, smoothness=0.72, brushed=True):
    """金属块：拉丝纹理 + 轻微氧化斑。Metal block: brushed grain with slight tarnish."""
    noise = fbm(seed, base=8, octaves=3)
    fine = fbm(seed + 5, base=32, octaves=1)
    color = []
    height = []
    smooth_field = []
    for y in range(SIZE):
        crow, hrow, srow = [], [], []
        for x in range(SIZE):
            streak = fine[y][x] if brushed else 0.5
            tone = 0.88 + noise[y][x] * 0.20 + (streak - 0.5) * 0.17
            c = shade(base_color, tone)
            crow.append(tuple(clamp8(v) for v in c) + (255,))
            hrow.append(0.5 + (streak - 0.5) * 0.6 + noise[y][x] * 0.15)
            # 氧化的地方不那么亮。Tarnished patches are less glossy.
            srow.append(max(0.0, min(1.0, smoothness - (1.0 - noise[y][x]) * 0.22)))
        color.append(crow)
        height.append(hrow)
        smooth_field.append(srow)
    return Material(color, height, smooth_field, f0_index, 0.0, normal_strength=1.2)


def wool(base_color, seed):
    """羊毛：经纬交织。Wool: an interlaced weave."""
    noise = fbm(seed, base=16, octaves=2)
    color = []
    height = []
    for y in range(SIZE):
        crow, hrow = [], []
        for x in range(SIZE):
            # 4 像素一个织格，横竖线交替在上。A 4px weave with alternating over/under.
            over = ((x // 4) + (y // 4)) % 2 == 0
            thread = math.sin((y if over else x) * 1.57) * 0.5 + 0.5
            tone = 0.86 + thread * 0.22 + (noise[y][x] - 0.5) * 0.14
            crow.append(tuple(clamp8(v) for v in shade(base_color, tone)) + (255,))
            hrow.append(0.35 + thread * 0.5 + noise[y][x] * 0.15)
        color.append(crow)
        height.append(hrow)
    return Material(color, height, 0.02, 0.04, 0.95, normal_strength=2.6)


def emissive_block(stops, seed, emission, smoothness=0.2, base=8, octaves=3,
                   hot_stops=None, hot_threshold=0.62):
    """发光方块：亮的地方才发光，整块均匀发光会很假。Only the hot parts glow."""
    noise = fbm(seed, base, octaves)
    color, height, emit = [], [], []
    for y in range(SIZE):
        crow, hrow, erow = [], [], []
        for x in range(SIZE):
            n = noise[y][x]
            if hot_stops is not None and n > hot_threshold:
                k = (n - hot_threshold) / max(1.0 - hot_threshold, 1e-6)
                c = ramp(hot_stops, k)
                erow.append(emission * (0.35 + k * 0.65))
                hrow.append(0.25 + k * 0.2)
            else:
                c = ramp(stops, n)
                erow.append(emission * 0.35 * n)
                hrow.append(0.55 + n * 0.4)
            crow.append(tuple(clamp8(v) for v in c) + (255,))
        color.append(crow)
        height.append(hrow)
        emit.append(erow)
    return Material(color, height, smoothness, 0.04, 0.05,
                    emission=emit, normal_strength=2.2)


def translucent(tint, seed, alpha, smoothness=0.94, f0=0.04, edge=True,
                normal_strength=1.0):
    """玻璃 / 冰：大部分透明，靠边缘和瑕疵显形。Glass and ice: read through edges and flaws."""
    noise = fbm(seed, base=8, octaves=3)
    color, height = [], []
    for y in range(SIZE):
        crow, hrow = [], []
        for x in range(SIZE):
            a = alpha
            c = shade(tint, 0.92 + noise[y][x] * 0.18)
            on_edge = edge and (x < 2 or y < 2 or x >= SIZE - 2 or y >= SIZE - 2)
            if on_edge:
                a = min(255, alpha + 105)
                c = shade(c, 1.12)
            elif noise[y][x] > 0.74:
                a = min(255, alpha + 40)          # 划痕和气泡
            crow.append(tuple(clamp8(v) for v in c) + (clamp8(a),))
            hrow.append(0.45 + noise[y][x] * 0.25 + (0.3 if on_edge else 0.0))
        color.append(crow)
        height.append(hrow)
    return Material(color, height, smoothness, f0, 0.0, normal_strength=normal_strength)


# ================================================================ 具体材质表

STONE_STOPS = [(0.0, (86, 86, 88)), (0.45, (116, 116, 118)), (0.75, (139, 138, 136)),
               (1.0, (158, 157, 153))]
DEEPSLATE_STOPS = [(0.0, (52, 52, 56)), (0.5, (70, 70, 76)), (1.0, (92, 92, 98))]
DIRT_STOPS = [(0.0, (74, 51, 32)), (0.4, (98, 68, 42)), (0.75, (118, 84, 52)),
              (1.0, (134, 99, 63))]

WOOL_COLORS = {
    "white": (233, 236, 236), "orange": (222, 116, 36), "magenta": (183, 76, 174),
    "light_blue": (68, 168, 212), "yellow": (238, 195, 62), "lime": (118, 182, 48),
    "pink": (228, 148, 176), "gray": (64, 69, 73), "light_gray": (144, 144, 138),
    "cyan": (40, 133, 141), "purple": (120, 55, 164), "blue": (58, 63, 152),
    "brown": (112, 74, 44), "green": (88, 110, 40), "red": (154, 52, 46),
    "black": (26, 27, 31),
}


def build_registry():
    reg = {}

    # ------------------------------------------------------------------ 石材
    reg["stone"] = lambda: grainy(STONE_STOPS, 11, base=4, octaves=5, grain=22,
                                  smoothness=0.05, porosity=0.10)
    reg["smooth_stone"] = lambda: grainy(
        [(0.0, (118, 118, 120)), (0.5, (140, 140, 140)), (1.0, (158, 158, 156))],
        13, base=4, octaves=3, grain_density=0.2, grain=10,
        smoothness=0.22, porosity=0.05, height_scale=0.35, normal_strength=1.0)
    reg["cobblestone"] = lambda: rubble(
        [(0.0, (92, 92, 94)), (0.5, (124, 124, 126)), (1.0, (156, 155, 151))], 22, 71)
    reg["mossy_cobblestone"] = lambda: _mossify(reg["cobblestone"](), 301)
    reg["stone_bricks"] = lambda: masonry(
        [(0.0, (104, 104, 104)), (0.55, (134, 133, 130)), (1.0, (160, 158, 152))],
        (84, 84, 86), 32, 32, 3, 97)
    reg["cracked_stone_bricks"] = lambda: masonry(
        [(0.0, (104, 104, 104)), (0.55, (134, 133, 130)), (1.0, (160, 158, 152))],
        (84, 84, 86), 32, 32, 3, 98, cracked=True)
    reg["mossy_stone_bricks"] = lambda: _mossify(reg["stone_bricks"](), 302)
    reg["chiseled_stone_bricks"] = lambda: masonry(
        [(0.0, (100, 100, 100)), (0.55, (130, 129, 126)), (1.0, (154, 152, 148))],
        (80, 80, 82), 64, 64, 4, 99)
    reg["andesite"] = lambda: grainy(
        [(0.0, (108, 108, 110)), (0.5, (134, 134, 134)), (1.0, (162, 162, 160))],
        149, base=8, octaves=3, grain_density=1.1, grain=34, smoothness=0.06)
    reg["polished_andesite"] = lambda: grainy(
        [(0.0, (126, 126, 128)), (0.5, (150, 150, 150)), (1.0, (172, 172, 170))],
        150, base=8, octaves=2, grain_density=0.3, grain=14,
        smoothness=0.42, height_scale=0.3, normal_strength=0.8)
    reg["diorite"] = lambda: grainy(
        [(0.0, (168, 166, 164)), (0.5, (206, 205, 202)), (1.0, (238, 237, 234))],
        151, base=8, octaves=3, grain_density=1.2, grain=36, smoothness=0.08)
    reg["polished_diorite"] = lambda: grainy(
        [(0.0, (192, 190, 188)), (0.5, (216, 215, 212)), (1.0, (238, 237, 234))],
        152, base=8, octaves=2, grain_density=0.35, grain=16,
        smoothness=0.46, height_scale=0.3, normal_strength=0.8)
    reg["granite"] = lambda: grainy(
        [(0.0, (128, 84, 68)), (0.5, (158, 108, 88)), (1.0, (186, 138, 116))],
        157, base=8, octaves=3, grain_density=1.2, grain=34, smoothness=0.08)
    reg["polished_granite"] = lambda: grainy(
        [(0.0, (146, 100, 82)), (0.5, (172, 124, 102)), (1.0, (196, 152, 130))],
        158, base=8, octaves=2, grain_density=0.35, grain=16,
        smoothness=0.5, height_scale=0.3, normal_strength=0.8)
    reg["tuff"] = lambda: grainy(
        [(0.0, (88, 90, 84)), (0.5, (108, 110, 103)), (1.0, (130, 132, 124))],
        159, base=8, octaves=4, grain_density=1.4, grain=28, smoothness=0.03, porosity=0.4)
    reg["calcite"] = lambda: grainy(
        [(0.0, (206, 205, 198)), (0.5, (226, 225, 219)), (1.0, (242, 241, 236))],
        161, base=4, octaves=3, grain_density=0.5, grain=14, smoothness=0.3)
    reg["bedrock"] = lambda: grainy(
        [(0.0, (38, 38, 40)), (0.35, (72, 72, 74)), (0.7, (108, 108, 108)),
         (1.0, (142, 142, 140))], 163, base=8, octaves=4, grain_density=1.6, grain=40,
        smoothness=0.02)

    # ---------------------------------------------------------------- 深板岩
    reg["deepslate"] = lambda: _bedded(grainy(DEEPSLATE_STOPS, 17, base=4, octaves=4,
                                              grain=16, smoothness=0.06), 29)
    reg["deepslate_top"] = lambda: grainy(DEEPSLATE_STOPS, 19, base=8, octaves=4,
                                          grain=18, smoothness=0.06)
    reg["cobbled_deepslate"] = lambda: rubble(DEEPSLATE_STOPS, 24, 21)
    reg["deepslate_bricks"] = lambda: masonry(
        [(0.0, (58, 58, 62)), (0.55, (76, 76, 82)), (1.0, (96, 96, 102))],
        (44, 44, 48), 32, 32, 3, 22)
    reg["deepslate_tiles"] = lambda: masonry(
        [(0.0, (52, 52, 56)), (0.55, (68, 68, 74)), (1.0, (86, 86, 92))],
        (38, 38, 42), 16, 16, 2, 23)

    # ------------------------------------------------------------------ 地面
    reg["dirt"] = lambda: grainy(DIRT_STOPS, 23, base=8, octaves=4, grain=30,
                                 smoothness=0.02, porosity=0.55)
    reg["coarse_dirt"] = lambda: _pebbled(reg["dirt"](), 404)
    reg["rooted_dirt"] = lambda: _rooted(reg["dirt"](), 405)
    reg["grass_block_side"] = lambda: _darken_top(reg["dirt"](), 4, 0.88)
    reg["podzol_top"] = lambda: grainy(
        [(0.0, (60, 40, 20)), (0.4, (96, 62, 26)), (0.75, (128, 86, 36)),
         (1.0, (150, 110, 52))], 407, base=8, octaves=4, grain=34,
        smoothness=0.02, porosity=0.6)
    reg["sand"] = lambda: grainy(
        [(0.0, (198, 176, 126)), (0.45, (219, 200, 152)), (0.8, (233, 218, 176)),
         (1.0, (243, 231, 197))], 41, base=8, octaves=3, grain_density=1.4, grain=18,
        smoothness=0.05, porosity=0.7, normal_strength=1.6)
    reg["red_sand"] = lambda: grainy(
        [(0.0, (156, 84, 32)), (0.45, (182, 104, 44)), (0.8, (202, 124, 60)),
         (1.0, (218, 146, 82))], 42, base=8, octaves=3, grain_density=1.4, grain=18,
        smoothness=0.05, porosity=0.7, normal_strength=1.6)
    reg["gravel"] = lambda: rubble(
        [(0.0, (88, 84, 80)), (0.5, (118, 113, 106)), (1.0, (150, 145, 136))],
        46, 57, joint_depth=0.55, smoothness=0.04, porosity=0.3)
    reg["clay"] = lambda: grainy(
        [(0.0, (144, 150, 166)), (0.5, (162, 168, 182)), (1.0, (180, 186, 198))],
        163, base=4, octaves=4, grain_density=0.4, grain=12,
        smoothness=0.12, porosity=0.5, height_scale=0.5, normal_strength=1.2)
    reg["mud"] = lambda: grainy(
        [(0.0, (48, 42, 40)), (0.5, (66, 58, 54)), (1.0, (84, 74, 68))],
        164, base=8, octaves=3, grain_density=0.5, grain=14,
        smoothness=0.45, porosity=0.95, normal_strength=1.4)
    reg["snow"] = lambda: grainy(
        [(0.0, (226, 233, 244)), (0.5, (240, 245, 252)), (1.0, (252, 254, 255))],
        167, base=4, octaves=4, grain_density=0.9, grain=10,
        smoothness=0.16, porosity=0.8, normal_strength=1.4)
    reg["grass_block_top"] = _grass_top
    reg["grass_block_side_overlay"] = _grass_overlay
    reg["farmland"] = lambda: _furrowed(reg["dirt"](), 409)
    reg["dirt_path_top"] = lambda: _darken_top(
        grainy([(0.0, (96, 78, 48)), (0.5, (124, 102, 62)), (1.0, (146, 122, 78))],
               410, base=8, octaves=4, grain=24, smoothness=0.06, porosity=0.5), 0, 1.0)

    # ------------------------------------------------------------------ 木材
    wood_palettes = {
        "oak": ([(0.0, (128, 92, 50)), (0.5, (166, 124, 72)), (1.0, (192, 152, 96))],
                (88, 62, 34)),
        "spruce": ([(0.0, (86, 60, 32)), (0.5, (114, 82, 46)), (1.0, (138, 104, 64))],
                   (58, 40, 22)),
        "birch": ([(0.0, (176, 152, 104)), (0.5, (204, 182, 134)), (1.0, (226, 208, 166))],
                  (132, 112, 76)),
        "dark_oak": ([(0.0, (62, 42, 22)), (0.5, (84, 58, 32)), (1.0, (104, 74, 44))],
                     (42, 28, 15)),
        "jungle": ([(0.0, (132, 92, 62)), (0.5, (162, 118, 82)), (1.0, (186, 144, 106))],
                   (92, 62, 40)),
        "acacia": ([(0.0, (150, 82, 42)), (0.5, (182, 108, 56)), (1.0, (206, 136, 78))],
                   (104, 56, 28)),
    }
    for i, (wood, (stops, seam)) in enumerate(wood_palettes.items()):
        reg[wood + "_planks"] = (lambda s=stops, sm=seam, n=i: planks(s, 103 + n * 17, seam_color=sm))

    reg["oak_log"] = lambda: bark(
        [(0.0, (48, 34, 20)), (0.45, (76, 56, 34)), (0.8, (104, 79, 48)), (1.0, (122, 96, 62))],
        109)
    reg["spruce_log"] = lambda: bark(
        [(0.0, (34, 24, 14)), (0.45, (56, 40, 24)), (0.8, (78, 58, 36)), (1.0, (96, 74, 48))],
        110)
    reg["birch_log"] = lambda: _birch_bark(111)
    reg["oak_log_top"] = lambda: log_top(
        [(0.0, (150, 112, 66)), (0.5, (182, 142, 90)), (1.0, (206, 170, 116))], 113)
    reg["spruce_log_top"] = lambda: log_top(
        [(0.0, (110, 78, 44)), (0.5, (142, 104, 62)), (1.0, (166, 130, 84))], 114)
    reg["birch_log_top"] = lambda: log_top(
        [(0.0, (188, 166, 118)), (0.5, (212, 192, 148)), (1.0, (232, 216, 180))], 115,
        rim_shade=0.9)

    reg["oak_leaves"] = lambda: leaves(137)
    reg["spruce_leaves"] = lambda: leaves(138, gap_threshold=0.30)
    reg["birch_leaves"] = lambda: leaves(139, gap_threshold=0.34)
    reg["jungle_leaves"] = lambda: leaves(140, gap_threshold=0.28)
    reg["acacia_leaves"] = lambda: leaves(141, gap_threshold=0.36)
    reg["dark_oak_leaves"] = lambda: leaves(142, gap_threshold=0.26)

    # ------------------------------------------------------------------ 矿石
    stone_base = grainy(STONE_STOPS, 11, base=4, octaves=5, grain=22,
                        smoothness=0.05, porosity=0.10)
    deep_base = _bedded(grainy(DEEPSLATE_STOPS, 17, base=4, octaves=4, grain=16,
                               smoothness=0.06), 29)

    ore_defs = {
        "coal": ([(0.0, (18, 18, 20)), (0.6, (34, 34, 38)), (1.0, (56, 56, 60))],
                 0.18, 0.04, None),
        "iron": ([(0.0, (150, 116, 92)), (0.6, (196, 158, 126)), (1.0, (222, 190, 158))],
                 0.55, METAL_IRON, None),
        "copper": ([(0.0, (152, 88, 52)), (0.6, (196, 122, 74)), (1.0, (224, 154, 104))],
                   0.5, METAL_COPPER, None),
        "gold": ([(0.0, (176, 132, 32)), (0.6, (226, 182, 56)), (1.0, (246, 214, 110))],
                 0.72, METAL_GOLD, None),
        "diamond": ([(0.0, (58, 168, 172)), (0.6, (108, 220, 220)), (1.0, (168, 244, 240))],
                    0.88, 0.17, None),
        "emerald": ([(0.0, (24, 132, 66)), (0.6, (56, 188, 100)), (1.0, (110, 226, 148))],
                    0.85, 0.17, None),
        "lapis": ([(0.0, (24, 52, 130)), (0.6, (42, 82, 178)), (1.0, (82, 124, 216))],
                  0.6, 0.12, None),
        "redstone": ([(0.0, (128, 16, 16)), (0.6, (186, 28, 28)), (1.0, (226, 62, 52))],
                     0.5, 0.1, 0.35),
    }
    for name, (stops, smooth, f0v, emit) in ore_defs.items():
        reg[name + "_ore"] = (lambda s=stops, sm=smooth, f=f0v, e=emit, n=name:
                              ore(stone_base, s, hash(n) % 9973, emission=e,
                                  smoothness=sm, f0=f))
        reg["deepslate_" + name + "_ore"] = (lambda s=stops, sm=smooth, f=f0v, e=emit, n=name:
                                             ore(deep_base, s, hash(n) % 9973 + 5,
                                                 emission=e, smoothness=sm, f0=f))

    # -------------------------------------------------------------- 金属方块
    reg["iron_block"] = lambda: metal((202, 202, 202), 201, METAL_IRON, 0.76)
    reg["gold_block"] = lambda: metal((238, 198, 62), 202, METAL_GOLD, 0.84)
    reg["copper_block"] = lambda: metal((196, 108, 68), 203, METAL_COPPER, 0.7)
    reg["netherite_block"] = lambda: metal((72, 62, 64), 204, METAL_GENERIC, 0.6)
    reg["diamond_block"] = lambda: metal((104, 226, 220), 205, 0.17, 0.9, brushed=False)
    reg["emerald_block"] = lambda: metal((52, 192, 96), 206, 0.17, 0.88, brushed=False)
    reg["lapis_block"] = lambda: metal((40, 80, 174), 207, 0.12, 0.55, brushed=False)
    reg["coal_block"] = lambda: grainy(
        [(0.0, (14, 14, 16)), (0.5, (26, 26, 30)), (1.0, (42, 42, 46))],
        208, base=8, octaves=4, grain_density=1.0, grain=18, smoothness=0.2)
    reg["redstone_block"] = lambda: grainy(
        [(0.0, (128, 18, 16)), (0.5, (170, 28, 24)), (1.0, (204, 46, 38))],
        209, base=8, octaves=3, grain_density=0.9, grain=22, smoothness=0.35)

    # -------------------------------------------------------------- 建筑材料
    reg["bricks"] = lambda: masonry(
        [(0.0, (122, 56, 40)), (0.5, (152, 74, 52)), (1.0, (178, 96, 70))],
        (176, 170, 158), 16, 32, 3, 83, porosity=0.35)
    reg["sandstone"] = _sandstone
    reg["sandstone_top"] = lambda: grainy(
        [(0.0, (206, 188, 140)), (0.5, (224, 208, 162)), (1.0, (238, 226, 190))],
        174, base=8, octaves=3, grain_density=1.0, grain=16, smoothness=0.06, porosity=0.5)
    reg["red_sandstone"] = lambda: _banded(
        [(0.0, (150, 78, 30)), (0.5, (176, 100, 42)), (1.0, (198, 126, 62))], 175)
    reg["terracotta"] = lambda: grainy(
        [(0.0, (132, 82, 62)), (0.5, (156, 100, 76)), (1.0, (176, 122, 96))],
        176, base=8, octaves=3, grain_density=0.5, grain=14,
        smoothness=0.2, porosity=0.3, height_scale=0.5, normal_strength=1.2)
    reg["obsidian"] = lambda: grainy(
        [(0.0, (10, 6, 18)), (0.5, (22, 14, 36)), (1.0, (42, 28, 62))],
        177, base=4, octaves=4, grain_density=0.6, grain=16,
        smoothness=0.82, f0=0.09, height_scale=0.5, normal_strength=1.6)
    reg["quartz_block_side"] = lambda: grainy(
        [(0.0, (226, 220, 212)), (0.5, (238, 234, 228)), (1.0, (250, 248, 244))],
        178, base=8, octaves=3, grain_density=0.6, grain=12, smoothness=0.4)
    reg["quartz_block_top"] = lambda: grainy(
        [(0.0, (230, 224, 216)), (0.5, (242, 238, 232)), (1.0, (252, 250, 248))],
        179, base=8, octaves=2, grain_density=0.4, grain=10, smoothness=0.45)
    reg["netherrack"] = lambda: grainy(
        [(0.0, (78, 26, 26)), (0.5, (108, 38, 38)), (1.0, (136, 56, 52))],
        180, base=8, octaves=4, grain_density=1.3, grain=30, smoothness=0.03, porosity=0.7)
    reg["glass"] = lambda: translucent((222, 236, 242), 181, alpha=26, smoothness=0.96)
    reg["ice"] = lambda: translucent((168, 202, 244), 182, alpha=118, smoothness=0.9,
                                     normal_strength=1.6)
    reg["packed_ice"] = lambda: grainy(
        [(0.0, (140, 178, 226)), (0.5, (166, 200, 238)), (1.0, (192, 220, 248))],
        183, base=4, octaves=3, grain_density=0.4, grain=12,
        smoothness=0.8, height_scale=0.5, normal_strength=1.2)
    reg["blue_ice"] = lambda: grainy(
        [(0.0, (94, 146, 220)), (0.5, (122, 172, 236)), (1.0, (152, 198, 246))],
        184, base=4, octaves=3, grain_density=0.3, grain=10,
        smoothness=0.92, height_scale=0.4, normal_strength=1.0)

    # ------------------------------------------------------------ 发光方块
    reg["glowstone"] = lambda: emissive_block(
        [(0.0, (128, 96, 44)), (0.5, (164, 126, 58)), (1.0, (196, 156, 76))], 185,
        emission=0.95,
        hot_stops=[(0.0, (226, 190, 106)), (1.0, (255, 240, 190))], hot_threshold=0.55)
    reg["magma"] = lambda: emissive_block(
        [(0.0, (52, 20, 12)), (0.5, (78, 30, 16)), (1.0, (104, 42, 20))], 186,
        emission=0.85,
        hot_stops=[(0.0, (196, 70, 20)), (1.0, (255, 190, 70))], hot_threshold=0.58)
    reg["sea_lantern"] = lambda: emissive_block(
        [(0.0, (150, 196, 190)), (0.5, (178, 216, 210)), (1.0, (202, 232, 226))], 187,
        emission=0.9, smoothness=0.55,
        hot_stops=[(0.0, (222, 244, 240)), (1.0, (255, 255, 255))], hot_threshold=0.66)
    reg["shroomlight"] = lambda: emissive_block(
        [(0.0, (176, 88, 30)), (0.5, (206, 118, 40)), (1.0, (230, 150, 56))], 188,
        emission=0.8,
        hot_stops=[(0.0, (246, 190, 92)), (1.0, (255, 232, 160))], hot_threshold=0.6)

    # ------------------------------------------------------------------ 羊毛
    for i, (name, rgb) in enumerate(sorted(WOOL_COLORS.items())):
        reg[name + "_wool"] = (lambda c=rgb, n=i: wool(c, 600 + n * 13))

    return reg


# ------------------------------------------------------------ 变体辅助函数

def _bedded(material, seed):
    """给材质加上水平层理，深板岩靠这个才有辨识度。Horizontal bedding — deepslate's tell."""
    streak = fbm(seed, base=2, octaves=3)
    for y in range(SIZE):
        for x in range(SIZE):
            k = 0.85 + 0.3 * streak[(y * 3) % SIZE][x]
            r, g, b, a = material.color[y][x]
            material.color[y][x] = tuple(clamp8(v) for v in shade((r, g, b), k)) + (a,)
            material.height[y][x] = max(0.0, min(1.0, material.height[y][x] * 0.7 + (k - 0.85) * 0.9))
    return material


def _mossify(material, seed):
    """长苔藓：只长在缝隙和背光面，均匀铺一层会很假。Moss grows in the joints, not everywhere."""
    moss = fbm(seed, base=4, octaves=3)
    for y in range(SIZE):
        for x in range(SIZE):
            h = material.height[y][x]
            # 低洼处（缝里）更容易积水长苔。Moss takes hold where water collects.
            chance = moss[y][x] * 0.75 + (1.0 - h) * 0.45
            if chance > 0.62:
                k = min(1.0, (chance - 0.62) / 0.3)
                r, g, b, a = material.color[y][x]
                green = (58 + moss[y][x] * 40, 82 + moss[y][x] * 52, 34 + moss[y][x] * 26)
                material.color[y][x] = tuple(
                    clamp8(material.color[y][x][i] * (1 - k) + green[i] * k) for i in range(3)
                ) + (a,)
                material.height[y][x] = min(1.0, h + k * 0.12)
    material.porosity = 0.6
    return material


def _pebbled(material, seed):
    rnd = random.Random(seed)
    for _ in range(70):
        cx, cy = rnd.randrange(SIZE), rnd.randrange(SIZE)
        radius = rnd.randint(1, 3)
        tone = rnd.randint(120, 165)
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                if dx * dx + dy * dy <= radius * radius:
                    x, y = (cx + dx) % SIZE, (cy + dy) % SIZE
                    material.color[y][x] = (tone, int(tone * 0.92), int(tone * 0.82), 255)
                    material.height[y][x] = 0.85
    return material


def _rooted(material, seed):
    rnd = random.Random(seed)
    for _ in range(26):
        x = rnd.randrange(SIZE)
        y = rnd.randrange(SIZE)
        angle = rnd.uniform(0, math.tau)
        for i in range(rnd.randint(8, 20)):
            angle += rnd.uniform(-0.35, 0.35)
            x = int(x + math.cos(angle)) % SIZE
            y = int(y + math.sin(angle)) % SIZE
            tone = rnd.randint(178, 220)
            material.color[y][x] = (tone, int(tone * 0.86), int(tone * 0.62), 255)
            material.height[y][x] = 0.9
    return material


def _furrowed(material, seed):
    """耕地的犁沟。Plough furrows on farmland."""
    for y in range(SIZE):
        band = 0.5 + 0.5 * math.sin(y * 0.49)
        for x in range(SIZE):
            r, g, b, a = material.color[y][x]
            material.color[y][x] = tuple(clamp8(v) for v in shade((r, g, b), 0.82 + band * 0.3)) + (a,)
            material.height[y][x] = material.height[y][x] * 0.4 + band * 0.6
    material.normal_strength = 3.2
    return material


def _darken_top(material, rows, factor):
    for x in range(SIZE):
        for y in range(rows):
            r, g, b, a = material.color[y][x]
            material.color[y][x] = tuple(clamp8(v) for v in shade((r, g, b), factor)) + (a,)
    return material


def _grass_top():
    """必须是灰阶 —— 游戏会按生物群系染色。Must stay greyscale; the game tints it per biome."""
    noise = fbm(127, base=4, octaves=3)
    rnd = random.Random(127)
    lum = [[132.0 + noise[y][x] * 62.0 for x in range(SIZE)] for y in range(SIZE)]
    for _ in range(1100):
        x0, y0 = rnd.randrange(SIZE), rnd.randrange(SIZE)
        angle = rnd.uniform(0.0, math.tau)
        dx, dy = math.cos(angle), math.sin(angle)
        tip = rnd.uniform(178.0, 248.0)
        root = rnd.uniform(96.0, 138.0)
        length = rnd.randint(4, 8)
        for i in range(length):
            x = int(round(x0 + dx * i)) % SIZE
            y = int(round(y0 + dy * i)) % SIZE
            k = i / float(length - 1)
            lum[y][x] = root + (tip - root) * (1.0 - k)
    color, height = [], []
    for y in range(SIZE):
        crow, hrow = [], []
        for x in range(SIZE):
            v = clamp8(lum[y][x] + rnd.randint(-6, 6))
            crow.append((v, v, v, 255))
            hrow.append(v / 255.0)
        color.append(crow)
        height.append(hrow)
    return Material(color, height, 0.05, 0.04, 0.8, normal_strength=1.8)


def _grass_overlay():
    top = _grass_top()
    rnd = random.Random(131)
    color = [[(0, 0, 0, 0)] * SIZE for _ in range(SIZE)]
    height = [[0.0] * SIZE for _ in range(SIZE)]
    for x in range(SIZE):
        depth = 10 + rnd.randint(0, 12)
        for y in range(depth):
            v = top.color[y][x][0]
            color[y][x] = (v, v, v, 255 if y < depth - 5 else 190)
            height[y][x] = v / 255.0
    return Material(color, height, 0.05, 0.04, 0.8, normal_strength=1.8)


def _birch_bark(seed):
    """白桦的横向黑斑是它最好认的特征。Birch is all about the horizontal black lenticels."""
    material = bark([(0.0, (198, 194, 178)), (0.5, (222, 219, 206)), (1.0, (240, 238, 230))],
                    seed, ridge_freq=0.4)
    rnd = random.Random(seed)
    for _ in range(40):
        cx, cy = rnd.randrange(SIZE), rnd.randrange(SIZE)
        w = rnd.randint(3, 11)
        h = rnd.randint(1, 3)
        tone = rnd.randint(28, 70)
        for dy in range(h):
            for dx in range(w):
                x, y = (cx + dx) % SIZE, (cy + dy) % SIZE
                material.color[y][x] = (tone, tone - 4, tone - 8, 255)
                material.height[y][x] = 0.25
    return material


def _banded(stops, seed):
    """层积岩的水平条带。Horizontal bedding of a sedimentary rock."""
    noise = fbm(seed, base=8, octaves=3)
    color, height = [], []
    for y in range(SIZE):
        band = 0.5 + 0.5 * math.sin(y * 0.55)
        crow, hrow = [], []
        for x in range(SIZE):
            t = band * 0.55 + noise[y][x] * 0.45
            crow.append(tuple(clamp8(v) for v in ramp(stops, t)) + (255,))
            hrow.append(0.35 + t * 0.5)
        color.append(crow)
        height.append(hrow)
    return Material(color, height, 0.06, 0.04, 0.5, normal_strength=2.0)


def _sandstone():
    return _banded([(0.0, (196, 176, 128)), (0.5, (218, 200, 152)), (1.0, (236, 222, 182))], 173)


# ============================================================================ 主流程

def emit(name, material, out_dir):
    write_png(os.path.join(out_dir, name + ".png"), material.color)
    write_png(os.path.join(out_dir, name + "_n.png"), build_normal_map(material))
    write_png(os.path.join(out_dir, name + "_s.png"), build_specular_map(material))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mod-pack", default=None,
                        help="同步反照率到模组内置材质包的 block 目录 / "
                             "also copy albedo into the mod's built-in pack")
    parser.add_argument("--only", default=None,
                        help="只生成名字包含该子串的材质 / generate only matching names")
    args = parser.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    registry = build_registry()
    names = sorted(registry)
    if args.only:
        names = [n for n in names if args.only in n]

    for index, name in enumerate(names, 1):
        material = registry[name]()
        emit(name, material, OUT_DIR)
        if args.mod_pack:
            os.makedirs(args.mod_pack, exist_ok=True)
            write_png(os.path.join(args.mod_pack, name + ".png"), material.color)
        sys.stdout.write("\r  [%3d/%3d] %-34s" % (index, len(names), name))
        sys.stdout.flush()

    print("\n%d 个方块 x 3 张贴图 = %d 个文件 -> %s"
          % (len(names), len(names) * 3, OUT_DIR))


if __name__ == "__main__":
    main()
