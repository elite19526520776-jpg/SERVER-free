#!/usr/bin/env python3
"""
程序化生成写实风格的 64x64 方块材质（原版是 16x16）。
Procedurally generates 64x64 realistic block textures (vanilla is 16x16).

不依赖任何第三方库：PNG 直接用 zlib 编码。
No third-party dependencies: PNGs are encoded directly with zlib.

    python3 tools/generate_textures.py

输出到 src/main/resources/resourcepacks/realistic_textures/assets/minecraft/textures/block/
"""

import math
import os
import random
import struct
import zlib

SIZE = 64
OUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "src", "main", "resources", "resourcepacks", "realistic_textures",
    "assets", "minecraft", "textures", "block",
)


# --------------------------------------------------------------------- PNG 输出

def write_png(path, pixels):
    """pixels: SIZE 行，每行 SIZE 个 (r, g, b, a) 元组。"""
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter type 0 (None)
        for r, g, b, a in row:
            raw += bytes((r & 255, g & 255, b & 255, a & 255))

    def chunk(tag, data):
        out = struct.pack(">I", len(data)) + tag + data
        return out + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", header)
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as handle:
        handle.write(png)


# --------------------------------------------------------------------- 噪声

def value_noise(cells, seed):
    """可平铺的值噪声，cells 必须整除 SIZE。Tileable value noise; cells must divide SIZE."""
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
            bottom = grid[y1][x0] * (1 - tx) + grid[y1][x1] * tx
            out[y][x] = top * (1 - ty) + bottom * ty
    return out


def fbm(seed, base=4, octaves=4):
    """分形叠加噪声，给材质自然的粗糙感。Fractal noise for natural-looking grain."""
    acc = [[0.0] * SIZE for _ in range(SIZE)]
    amplitude = 1.0
    total = 0.0
    cells = base
    for i in range(octaves):
        if SIZE % cells:
            break
        layer = value_noise(cells, seed + i * 977)
        for y in range(SIZE):
            row = acc[y]
            src = layer[y]
            for x in range(SIZE):
                row[x] += src[x] * amplitude
        total += amplitude
        amplitude *= 0.5
        cells *= 2
    return [[v / total for v in row] for row in acc]


def speckle(seed, density, strength):
    """随机颗粒，模拟矿物结晶。Random grains that read as mineral crystals."""
    rnd = random.Random(seed)
    out = [[0.0] * SIZE for _ in range(SIZE)]
    for _ in range(int(SIZE * SIZE * density)):
        x = rnd.randrange(SIZE)
        y = rnd.randrange(SIZE)
        out[y][x] += rnd.uniform(-strength, strength)
    return out


def cells_map(count, seed):
    """可平铺的 Voronoi：返回 (格子编号, 到边界的距离)。Tileable Voronoi cells."""
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
                dx = min(dx, SIZE - dx)  # 环绕，保证可平铺
                dy = min(dy, SIZE - dy)
                d = dx * dx + dy * dy
                if d < best:
                    second = best
                    best = d
                    best_i = i
                elif d < second:
                    second = d
            ids[y][x] = best_i
            edge[y][x] = math.sqrt(second) - math.sqrt(best)
    return ids, edge


# --------------------------------------------------------------------- 调色

def ramp(stops, t):
    """按色标插值。stops = [(位置, (r,g,b)), ...]"""
    t = max(0.0, min(1.0, t))
    for i in range(len(stops) - 1):
        p0, c0 = stops[i]
        p1, c1 = stops[i + 1]
        if p0 <= t <= p1:
            k = 0.0 if p1 == p0 else (t - p0) / (p1 - p0)
            return tuple(int(c0[j] + (c1[j] - c0[j]) * k) for j in range(3))
    return stops[-1][1]


def shade(color, factor):
    return tuple(max(0, min(255, int(c * factor))) for c in color)


def blank():
    return [[(0, 0, 0, 0)] * SIZE for _ in range(SIZE)]


# --------------------------------------------------------------------- 材质配方

def grainy(stops, seed, base=4, octaves=4, grain_density=0.55, grain=26, alpha=255):
    """通用配方：分形噪声着色 + 细颗粒。The workhorse: fractal colouring plus fine grain."""
    noise = fbm(seed, base, octaves)
    grains = speckle(seed + 31, grain_density, grain / 255.0)
    out = []
    for y in range(SIZE):
        row = []
        for x in range(SIZE):
            color = ramp(stops, noise[y][x])
            g = grains[y][x]
            row.append(tuple(max(0, min(255, int(c + g * 255))) for c in color) + (alpha,))
        out.append(row)
    return out


def stone():
    return grainy([(0.0, (86, 86, 88)), (0.45, (116, 116, 118)), (0.75, (139, 138, 136)),
                   (1.0, (158, 157, 153))], seed=11, base=4, octaves=5, grain=22)


def deepslate():
    base = grainy([(0.0, (52, 52, 56)), (0.5, (70, 70, 76)), (1.0, (92, 92, 98))],
                  seed=17, base=4, octaves=4, grain=16)
    streak = fbm(29, base=2, octaves=3)
    for y in range(SIZE):
        for x in range(SIZE):
            # 板岩有明显的层理。Deepslate is visibly bedded.
            k = 0.85 + 0.3 * streak[(y * 3) % SIZE][x]
            r, g, b, a = base[y][x]
            base[y][x] = shade((r, g, b), k) + (a,)
    return base


def dirt():
    return grainy([(0.0, (74, 51, 32)), (0.4, (98, 68, 42)), (0.75, (118, 84, 52)),
                   (1.0, (134, 99, 63))], seed=23, base=8, octaves=4, grain=30)


def coarse_dirt():
    tex = dirt()
    rnd = random.Random(404)
    for _ in range(70):
        cx, cy = rnd.randrange(SIZE), rnd.randrange(SIZE)
        radius = rnd.randint(1, 3)
        tone = rnd.randint(120, 165)
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                if dx * dx + dy * dy <= radius * radius:
                    x, y = (cx + dx) % SIZE, (cy + dy) % SIZE
                    tex[y][x] = (tone, int(tone * 0.92), int(tone * 0.82), 255)
    return tex


def sand():
    return grainy([(0.0, (198, 176, 126)), (0.45, (219, 200, 152)), (0.8, (233, 218, 176)),
                   (1.0, (243, 231, 197))], seed=41, base=8, octaves=3, grain_density=1.4, grain=18)


def gravel():
    ids, edge = cells_map(46, 57)
    noise = fbm(61, base=8, octaves=3)
    rnd = random.Random(57)
    tones = [rnd.uniform(0.72, 1.12) for _ in range(64)]
    out = []
    for y in range(SIZE):
        row = []
        for x in range(SIZE):
            base_color = ramp([(0.0, (88, 84, 80)), (0.5, (118, 113, 106)), (1.0, (150, 145, 136))],
                              noise[y][x])
            color = shade(base_color, tones[ids[y][x] % 64])
            if edge[y][x] < 1.1:  # 石子之间的缝隙。Gaps between pebbles.
                color = shade(color, 0.55)
            row.append(color + (255,))
        out.append(row)
    return out


def cobblestone():
    ids, edge = cells_map(22, 71)
    noise = fbm(73, base=8, octaves=4)
    rnd = random.Random(71)
    tones = [rnd.uniform(0.74, 1.15) for _ in range(32)]
    out = []
    for y in range(SIZE):
        row = []
        for x in range(SIZE):
            base_color = ramp([(0.0, (92, 92, 94)), (0.5, (124, 124, 126)), (1.0, (156, 155, 151))],
                              noise[y][x])
            color = shade(base_color, tones[ids[y][x] % 32])
            e = edge[y][x]
            if e < 1.4:
                color = shade(color, 0.42)   # 砂浆缝。Mortar joint.
            elif e < 2.6:
                color = shade(color, 0.78)   # 边缘阴影。Edge falloff.
            row.append(color + (255,))
        out.append(row)
    return out


def bricks():
    noise = fbm(83, base=8, octaves=3)
    mortar = (176, 170, 158)
    rnd = random.Random(83)
    brick_h, brick_w, joint = 16, 32, 3
    tones = {}
    out = []
    for y in range(SIZE):
        row = []
        rowidx = y // brick_h
        offset = (rowidx % 2) * (brick_w // 2)
        for x in range(SIZE):
            bx = (x + offset) % SIZE
            in_joint = (y % brick_h) < joint or (bx % brick_w) < joint
            if in_joint:
                m = int(noise[y][x] * 22) - 8
                row.append((mortar[0] + m, mortar[1] + m, mortar[2] + m, 255))
            else:
                key = (rowidx, bx // brick_w)
                if key not in tones:
                    tones[key] = rnd.uniform(0.86, 1.14)
                color = ramp([(0.0, (122, 56, 40)), (0.5, (152, 74, 52)), (1.0, (178, 96, 70))],
                             noise[y][x])
                row.append(shade(color, tones[key]) + (255,))
        out.append(row)
    return out


def stone_bricks():
    noise = fbm(97, base=8, octaves=4)
    rnd = random.Random(97)
    block_h, block_w, joint = 32, 32, 3
    tones = {}
    out = []
    for y in range(SIZE):
        row = []
        rowidx = y // block_h
        offset = (rowidx % 2) * (block_w // 2)
        for x in range(SIZE):
            bx = (x + offset) % SIZE
            if (y % block_h) < joint or (bx % block_w) < joint:
                color = ramp([(0.0, (72, 72, 74)), (1.0, (96, 96, 96))], noise[y][x])
                row.append(color + (255,))
            else:
                key = (rowidx, bx // block_w)
                if key not in tones:
                    tones[key] = rnd.uniform(0.9, 1.1)
                color = ramp([(0.0, (104, 104, 104)), (0.55, (134, 133, 130)), (1.0, (160, 158, 152))],
                             noise[y][x])
                row.append(shade(color, tones[key]) + (255,))
        out.append(row)
    return out


def oak_planks():
    noise = fbm(103, base=16, octaves=3)
    rnd = random.Random(103)
    plank_h = 16
    out = []
    tones = [rnd.uniform(0.88, 1.12) for _ in range(SIZE // plank_h)]
    for y in range(SIZE):
        row = []
        idx = y // plank_h
        for x in range(SIZE):
            if y % plank_h == 0:  # 木板接缝。Seam between planks.
                row.append((88, 62, 34, 255))
                continue
            # 木纹：沿 x 方向拉长的条纹。Grain: streaks stretched along x.
            grain = 0.5 + 0.5 * math.sin((y * 2.4) + noise[y][x] * 9.0 + math.sin(x * 0.18) * 1.4)
            color = ramp([(0.0, (128, 92, 50)), (0.5, (166, 124, 72)), (1.0, (192, 152, 96))],
                         grain * 0.7 + noise[y][x] * 0.3)
            row.append(shade(color, tones[idx]) + (255,))
        out.append(row)
    return out


def oak_log():
    noise = fbm(109, base=8, octaves=4)
    out = []
    for y in range(SIZE):
        row = []
        for x in range(SIZE):
            # 树皮：竖向撕裂的沟壑。Bark: vertical fissures.
            ridge = 0.5 + 0.5 * math.sin(x * 1.05 + noise[y][x] * 7.0)
            ridge = ridge ** 1.6
            color = ramp([(0.0, (48, 34, 20)), (0.45, (76, 56, 34)), (0.8, (104, 79, 48)),
                          (1.0, (122, 96, 62))], ridge * 0.75 + noise[y][x] * 0.25)
            row.append(color + (255,))
        out.append(row)
    return out


def oak_log_top():
    noise = fbm(113, base=8, octaves=3)
    center = (SIZE - 1) / 2.0
    out = []
    for y in range(SIZE):
        row = []
        for x in range(SIZE):
            dist = math.hypot(x - center, y - center)
            ring = 0.5 + 0.5 * math.sin(dist * 1.35 + noise[y][x] * 3.0)
            color = ramp([(0.0, (150, 112, 66)), (0.5, (182, 142, 90)), (1.0, (206, 170, 116))],
                         ring * 0.8 + noise[y][x] * 0.2)
            if dist > SIZE * 0.47:  # 外圈树皮。Bark rim.
                color = shade(color, 0.55)
            row.append(color + (255,))
        out.append(row)
    return out


def grass_block_top():
    """会被生物群系染色，所以必须是灰阶。Biome-tinted, so it must stay greyscale."""
    noise = fbm(127, base=4, octaves=3)
    rnd = random.Random(127)
    lum = [[132.0 + noise[y][x] * 62.0 for x in range(SIZE)] for y in range(SIZE)]
    # 从上往下看草地就是一丛丛朝向不一的草叶。Grass from above is tufts pointing every which way.
    for _ in range(1100):
        x0 = rnd.randrange(SIZE)
        y0 = rnd.randrange(SIZE)
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
    out = []
    for y in range(SIZE):
        row = []
        for x in range(SIZE):
            v = max(78, min(255, int(lum[y][x] + rnd.randint(-6, 6))))
            row.append((v, v, v, 255))
        out.append(row)
    return out


def grass_block_side_overlay():
    """草皮垂到侧面的边缘，同样是灰阶 + 透明。Tinted greyscale fringe with alpha."""
    top = grass_block_top()
    rnd = random.Random(131)
    out = blank()
    for x in range(SIZE):
        depth = 10 + rnd.randint(0, 12)
        for y in range(depth):
            fade = 1.0 if y < depth - 5 else 0.55
            v = top[y][x][0]
            out[y][x] = (v, v, v, 255 if fade == 1.0 else 190)
    return out


def grass_block_side():
    """侧面底子是泥土，草的部分交给 overlay。Dirt base; the grass comes from the overlay."""
    tex = dirt()
    for x in range(SIZE):
        for y in range(4):
            r, g, b, a = tex[y][x]
            tex[y][x] = shade((r, g, b), 0.88) + (a,)
    return tex


def oak_leaves():
    """同样会被染色，灰阶 + 成簇的叶隙。Also tinted; greyscale with clustered gaps."""
    gaps = fbm(137, base=2, octaves=2)      # 低频 -> 叶隙成片而不是雪花点
    detail = fbm(139, base=8, octaves=3)
    rnd = random.Random(137)
    out = blank()
    for y in range(SIZE):
        for x in range(SIZE):
            if gaps[y][x] < 0.34:
                continue
            v = 96 + int(detail[y][x] * 120)
            out[y][x] = (v, v, v, 255)
    # 叠一层单片叶子，让轮廓不只是噪声。Overlay individual leaves so it is not just noise.
    for _ in range(90):
        cx = rnd.randrange(SIZE)
        cy = rnd.randrange(SIZE)
        if out[cy][cx][3] == 0:
            continue
        rx = rnd.randint(2, 4)
        ry = rnd.randint(3, 6)
        angle = rnd.uniform(0.0, math.tau)
        ca, sa = math.cos(angle), math.sin(angle)
        tone = rnd.randint(118, 232)
        for dy in range(-ry, ry + 1):
            for dx in range(-rx, rx + 1):
                u = (dx * ca + dy * sa) / rx
                v = (-dx * sa + dy * ca) / ry
                if u * u + v * v > 1.0:
                    continue
                x = (cx + dx) % SIZE
                y = (cy + dy) % SIZE
                if out[y][x][3] == 0:
                    continue
                # 中脉压暗一点。Darken the midrib slightly.
                shade_v = tone - 34 if abs(u) < 0.22 else tone
                shade_v = max(70, min(255, shade_v + rnd.randint(-8, 8)))
                out[y][x] = (shade_v, shade_v, shade_v, 255)
    return out


def andesite():
    return grainy([(0.0, (108, 108, 110)), (0.5, (134, 134, 134)), (1.0, (162, 162, 160))],
                  seed=149, base=8, octaves=3, grain_density=1.1, grain=34)


def diorite():
    return grainy([(0.0, (168, 166, 164)), (0.5, (206, 205, 202)), (1.0, (238, 237, 234))],
                  seed=151, base=8, octaves=3, grain_density=1.2, grain=36)


def granite():
    return grainy([(0.0, (128, 84, 68)), (0.5, (158, 108, 88)), (1.0, (186, 138, 116))],
                  seed=157, base=8, octaves=3, grain_density=1.2, grain=34)


def clay():
    return grainy([(0.0, (144, 150, 166)), (0.5, (162, 168, 182)), (1.0, (180, 186, 198))],
                  seed=163, base=4, octaves=4, grain_density=0.4, grain=12)


def snow():
    return grainy([(0.0, (226, 233, 244)), (0.5, (240, 245, 252)), (1.0, (252, 254, 255))],
                  seed=167, base=4, octaves=4, grain_density=0.9, grain=10)


def sandstone():
    """砂岩是层积的，横向条带最像。Sandstone is bedded; horizontal banding sells it."""
    noise = fbm(173, base=8, octaves=3)
    out = []
    for y in range(SIZE):
        band = 0.5 + 0.5 * math.sin(y * 0.55)
        row = []
        for x in range(SIZE):
            color = ramp([(0.0, (196, 176, 128)), (0.5, (218, 200, 152)), (1.0, (236, 222, 182))],
                         band * 0.55 + noise[y][x] * 0.45)
            row.append(color + (255,))
        out.append(row)
    return out


TEXTURES = {
    "stone": stone,
    "deepslate": deepslate,
    "cobblestone": cobblestone,
    "dirt": dirt,
    "coarse_dirt": coarse_dirt,
    "sand": sand,
    "gravel": gravel,
    "bricks": bricks,
    "stone_bricks": stone_bricks,
    "oak_planks": oak_planks,
    "oak_log": oak_log,
    "oak_log_top": oak_log_top,
    "grass_block_top": grass_block_top,
    "grass_block_side": grass_block_side,
    "grass_block_side_overlay": grass_block_side_overlay,
    "oak_leaves": oak_leaves,
    "andesite": andesite,
    "diorite": diorite,
    "granite": granite,
    "clay": clay,
    "snow": snow,
    "sandstone": sandstone,
}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, builder in sorted(TEXTURES.items()):
        write_png(os.path.join(OUT_DIR, name + ".png"), builder())
        print("wrote", name + ".png")
    print("%d textures -> %s" % (len(TEXTURES), OUT_DIR))


if __name__ == "__main__":
    main()
