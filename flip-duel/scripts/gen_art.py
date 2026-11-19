"""
生成卡面像素素材 → public/art/
  - 复用 ninja-battle 的 Ninja Adventure 素材（CC0）：人物、特效、武器、马
  - 其余图标用 Pillow 按 16x16 现画
运行：python scripts/gen_art.py
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'art'
NINJA = ROOT.parent / 'ninja-battle' / 'public' / 'assets' / 'ninja-adventure'
OUT.mkdir(parents=True, exist_ok=True)

K = (27, 24, 40, 255)        # 描边
W = (245, 245, 250, 255)
G = (138, 143, 158, 255)
GL = (196, 201, 213, 255)
B = (138, 90, 43, 255)
BL = (192, 128, 64, 255)
Y = (255, 210, 63, 255)
YD = (201, 154, 28, 255)
R = (224, 64, 64, 255)
RD = (144, 32, 48, 255)
O = (255, 140, 42, 255)
C = (71, 227, 255, 255)
CD = (26, 143, 168, 255)
P = (160, 96, 255, 255)
N = (92, 207, 92, 255)
ND = (42, 122, 58, 255)
L = (74, 140, 255, 255)
LD = (35, 74, 153, 255)
PAPER = (232, 215, 168, 255)
COAL = (58, 58, 70, 255)


def canvas(size=16):
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def save(im, name):
    im.save(OUT / f'{name}.png')


# ---------------- 自绘图标 ----------------

def coin():
    im, d = canvas()
    d.ellipse((2, 2, 13, 13), fill=Y, outline=K)
    d.ellipse((5, 5, 10, 10), outline=YD)
    d.point([(5, 4), (4, 5)], fill=W)
    return im


def rock(fill=G, light=GL, spots=None, spot=None):
    im, d = canvas()
    d.polygon([(2, 13), (1, 9), (4, 4), (9, 2), (13, 5), (14, 11), (11, 14), (4, 14)], fill=fill, outline=K)
    d.line([(4, 6), (7, 4)], fill=light)
    d.point([(10, 5), (12, 8)], fill=light)
    for (x, y) in spots or []:
        d.rectangle((x, y, x + 1, y + 1), fill=spot)
    return im


def gem(fill, dark, light=W):
    im, d = canvas()
    d.polygon([(4, 3), (11, 3), (14, 7), (8, 14), (1, 7)], fill=fill, outline=K)
    d.line([(1, 7), (14, 7)], fill=dark)
    d.line([(6, 3), (5, 7), (8, 13)], fill=dark)
    d.line([(9, 3), (10, 7), (8, 13)], fill=dark)
    d.point([(5, 4), (4, 5)], fill=light)
    return im


def crown(jewel=R):
    im, d = canvas()
    d.polygon([(2, 12), (2, 5), (5, 8), (8, 3), (11, 8), (14, 5), (14, 12)], fill=Y, outline=K)
    d.rectangle((2, 11, 14, 13), fill=YD, outline=K)
    d.point([(8, 7), (5, 10), (11, 10)], fill=jewel)
    return im


def flame(outer=O, inner=Y):
    im, d = canvas()
    d.polygon([(8, 1), (12, 6), (13, 10), (11, 14), (5, 14), (3, 10), (4, 6), (6, 7)], fill=outer, outline=K)
    d.polygon([(8, 6), (10, 10), (9, 13), (7, 13), (6, 10)], fill=inner)
    return im


def star(fill=Y):
    im, d = canvas()
    pts = []
    for i in range(10):
        r = 7 if i % 2 == 0 else 3
        a = -math.pi / 2 + i * math.pi / 5
        pts.append((7.5 + r * math.cos(a), 8 + r * math.sin(a)))
    d.polygon(pts, fill=fill, outline=K)
    return im


def shield(fill=L, mark=W):
    im, d = canvas()
    d.polygon([(2, 2), (13, 2), (13, 8), (8, 14), (7, 14), (2, 8)], fill=fill, outline=K)
    d.line([(7, 4), (7, 11)], fill=mark)
    d.line([(4, 6), (11, 6)], fill=mark)
    return im


def sword():
    im, d = canvas()
    d.line([(4, 11), (13, 2)], fill=GL, width=2)
    d.line([(4, 12), (13, 3)], fill=G)
    d.line([(2, 9), (6, 13)], fill=YD, width=2)
    d.line([(1, 14), (4, 11)], fill=B, width=2)
    return im


def sprout():
    im, d = canvas()
    d.rectangle((3, 12, 12, 14), fill=B, outline=K)
    d.line([(8, 12), (8, 6)], fill=ND, width=1)
    d.ellipse((2, 5, 8, 9), fill=N, outline=K)
    d.ellipse((8, 2, 14, 7), fill=N, outline=K)
    return im


def flag(color=R):
    im, d = canvas()
    d.line([(3, 1), (3, 15)], fill=B, width=1)
    d.polygon([(4, 2), (14, 4), (4, 8)], fill=color, outline=K)
    return im


def drum():
    im, d = canvas()
    d.rectangle((2, 5, 13, 12), fill=R, outline=K)
    d.ellipse((2, 2, 13, 7), fill=W, outline=K)
    for x in range(3, 13, 3):
        d.line([(x, 7), (x + 2, 11)], fill=Y)
    d.line([(11, 0), (14, 4)], fill=B)
    return im


def chest():
    im, d = canvas()
    d.rectangle((2, 7, 13, 14), fill=B, outline=K)
    d.rectangle((2, 3, 13, 7), fill=BL, outline=K)
    d.rectangle((7, 6, 8, 9), fill=Y, outline=K)
    return im


def pickaxe(head=GL):
    im, d = canvas()
    d.line([(3, 14), (11, 5)], fill=B, width=2)
    d.arc((1, 0, 15, 12), 200, 340, fill=K, width=3)
    d.arc((1, 1, 15, 12), 205, 335, fill=head, width=1)
    return im


def helmet(fill=Y):
    im, d = canvas()
    d.pieslice((2, 3, 13, 16), 180, 360, fill=fill, outline=K)
    d.rectangle((1, 9, 14, 11), fill=fill, outline=K)
    d.ellipse((6, 4, 9, 7), fill=W, outline=K)
    return im


def minecart():
    im, d = canvas()
    d.ellipse((4, 3, 7, 6), fill=O)
    d.ellipse((7, 2, 11, 6), fill=Y)
    d.polygon([(1, 5), (14, 5), (12, 11), (3, 11)], fill=G, outline=K)
    d.line([(3, 7), (12, 7)], fill=GL)
    d.ellipse((3, 11, 6, 14), fill=K)
    d.ellipse((9, 11, 12, 14), fill=K)
    return im


def dynamite(color=R):
    im, d = canvas()
    for x in (3, 7, 11):
        d.rectangle((x - 1, 6, x + 1, 14), fill=color, outline=K)
    d.line([(2, 9), (13, 9)], fill=B)
    d.line([(7, 6), (9, 2)], fill=K)
    d.point([(10, 1), (9, 1), (10, 2)], fill=Y)
    return im


def lamp():
    im, d = canvas()
    d.arc((4, 0, 11, 7), 180, 360, fill=K)
    d.rectangle((4, 4, 11, 13), fill=YD, outline=K)
    d.rectangle((5, 6, 10, 11), fill=Y)
    d.point([(6, 7), (7, 8)], fill=W)
    return im


def drill(body=O):
    im, d = canvas()
    d.polygon([(1, 8), (9, 3), (9, 13)], fill=GL, outline=K)
    d.line([(4, 7), (6, 10)], fill=G)
    d.line([(6, 5), (8, 9)], fill=G)
    d.rectangle((9, 4, 14, 12), fill=body, outline=K)
    return im


def rail():
    im, d = canvas()
    for x in (2, 6, 10, 14):
        d.rectangle((x - 1, 3, x, 13), fill=B)
    d.line([(0, 5), (15, 5)], fill=GL, width=2)
    d.line([(0, 11), (15, 11)], fill=GL, width=2)
    return im


def treasure_map():
    im, d = canvas()
    d.rectangle((2, 3, 13, 13), fill=PAPER, outline=K)
    for x in (4, 6, 8):
        d.point((x, 11 - (x - 4)), fill=B)
    d.line([(9, 5), (12, 8)], fill=R)
    d.line([(12, 5), (9, 8)], fill=R)
    return im


def laptop():
    im, d = canvas()
    d.rectangle((3, 2, 12, 10), fill=K)
    d.rectangle((4, 3, 11, 9), fill=CD)
    d.line([(5, 5), (8, 5)], fill=C)
    d.line([(5, 7), (10, 7)], fill=N)
    d.polygon([(1, 11), (14, 11), (15, 13), (0, 13)], fill=G, outline=K)
    return im


def bug(fill=N):
    im, d = canvas()
    for y in (6, 9, 12):
        d.line([(2, y - 1), (13, y + 1)], fill=K)
        d.line([(13, y - 1), (2, y + 1)], fill=K)
    d.ellipse((5, 5, 10, 14), fill=fill, outline=K)
    d.ellipse((5, 1, 10, 6), fill=ND, outline=K)
    d.point([(6, 3), (9, 3)], fill=R)
    return im


def loop():
    im, d = canvas()
    d.ellipse((1, 4, 8, 11), outline=C, width=2)
    d.ellipse((7, 4, 14, 11), outline=C, width=2)
    return im


def envelope(fill=W):
    im, d = canvas()
    d.rectangle((1, 4, 14, 12), fill=fill, outline=K)
    d.line([(1, 4), (7, 9), (14, 4)], fill=K)
    d.point((12, 6), fill=R)
    return im


def chip(core=C):
    im, d = canvas()
    for i in range(5, 11, 2):
        d.line([(i, 1), (i, 14)], fill=GL)
        d.line([(1, i), (14, i)], fill=GL)
    d.rectangle((3, 3, 12, 12), fill=COAL, outline=K)
    d.rectangle((6, 6, 9, 9), fill=core)
    return im


def robot(fill=GL, eye=C):
    im, d = canvas()
    d.line([(8, 0), (8, 3)], fill=K)
    d.point((8, 0), fill=R)
    d.rectangle((3, 3, 12, 10), fill=fill, outline=K)
    d.rectangle((5, 5, 6, 6), fill=eye)
    d.rectangle((9, 5, 10, 6), fill=eye)
    d.line([(6, 8), (9, 8)], fill=K)
    d.rectangle((5, 11, 10, 15), fill=G, outline=K)
    return im


def gear(fill=G):
    im, d = canvas()
    for a in range(0, 360, 45):
        x = 7.5 + 6 * math.cos(math.radians(a))
        y = 7.5 + 6 * math.sin(math.radians(a))
        d.rectangle((x - 1, y - 1, x + 1, y + 1), fill=K)
    d.ellipse((2, 2, 13, 13), fill=fill, outline=K)
    d.ellipse((6, 6, 9, 9), fill=K)
    return im


def database():
    im, d = canvas()
    for y in (9, 5, 1):
        d.rectangle((2, y + 2, 13, y + 5), fill=L, outline=K)
        d.ellipse((2, y, 13, y + 4), fill=LD if y != 1 else C, outline=K)
    return im


def key():
    im, d = canvas()
    d.ellipse((1, 1, 7, 7), fill=Y, outline=K)
    d.ellipse((3, 3, 5, 5), fill=(0, 0, 0, 0))
    d.line([(6, 6), (14, 14)], fill=Y, width=2)
    d.line([(11, 13), (13, 11)], fill=YD)
    return im


def cloud(fill=W):
    im, d = canvas()
    d.ellipse((1, 6, 8, 13), fill=fill, outline=K)
    d.ellipse((5, 3, 12, 11), fill=fill, outline=K)
    d.ellipse((8, 6, 15, 13), fill=fill, outline=K)
    d.rectangle((4, 9, 12, 12), fill=fill)
    d.line([(4, 13), (12, 13)], fill=K)
    return im


def lock():
    im, d = canvas()
    d.arc((4, 1, 11, 10), 180, 360, fill=G, width=2)
    d.line([(4, 5), (4, 7)], fill=G, width=2)
    d.line([(11, 5), (11, 7)], fill=G, width=2)
    d.rectangle((2, 7, 13, 14), fill=Y, outline=K)
    d.rectangle((7, 9, 8, 12), fill=K)
    return im


def skull(fill=W):
    im, d = canvas()
    d.ellipse((2, 1, 13, 11), fill=fill, outline=K)
    d.rectangle((5, 10, 10, 14), fill=fill, outline=K)
    d.rectangle((4, 5, 6, 7), fill=K)
    d.rectangle((9, 5, 11, 7), fill=K)
    d.point([(7, 12), (8, 12)], fill=K)
    return im


def docs():
    im, d = canvas()
    d.rectangle((5, 1, 13, 11), fill=GL, outline=K)
    d.rectangle((2, 4, 10, 14), fill=W, outline=K)
    for y in (7, 9, 11):
        d.line([(4, y), (8, y)], fill=G)
    return im


def snowball():
    im, d = canvas()
    d.ellipse((2, 2, 13, 13), fill=W, outline=K)
    d.arc((3, 3, 12, 12), 20, 160, fill=(170, 200, 255, 255))
    d.point([(5, 5)], fill=(255, 255, 255, 255))
    return im


def mirror():
    im, d = canvas()
    d.line([(8, 11), (8, 15)], fill=B, width=2)
    d.ellipse((3, 1, 12, 12), fill=YD, outline=K)
    d.ellipse((5, 3, 10, 10), fill=C)
    d.line([(6, 5), (7, 4)], fill=W)
    return im


def door():
    im, d = canvas()
    d.rectangle((3, 1, 12, 15), fill=B, outline=K)
    d.rectangle((5, 3, 10, 7), outline=BL)
    d.point((10, 9), fill=Y)
    return im


def eye():
    im, d = canvas()
    d.ellipse((1, 4, 14, 11), fill=W, outline=K)
    d.ellipse((5, 4, 10, 11), fill=P, outline=K)
    d.rectangle((7, 7, 8, 8), fill=K)
    return im


ICONS = {
    'coin': coin, 'rock': rock, 'coal': lambda: rock(COAL, G),
    'ore-copper': lambda: rock(spots=[(4, 7), (9, 5), (10, 10)], spot=O),
    'ore-silver': lambda: rock(spots=[(4, 7), (9, 5), (10, 10)], spot=W),
    'ore-gold': lambda: rock(spots=[(4, 7), (9, 5), (10, 10), (6, 11)], spot=Y),
    'gem-red': lambda: gem(R, RD), 'gem-blue': lambda: gem(L, LD), 'gem-cyan': lambda: gem(C, CD),
    'gem-white': lambda: gem(W, GL, C), 'gem-purple': lambda: gem(P, (90, 47, 154, 255)),
    'crown': crown, 'crown-pink': lambda: crown(P), 'flame': flame, 'flame-blue': lambda: flame(L, C),
    'star': star, 'shield': shield, 'shield-green': lambda: shield(N, W), 'sword': sword, 'sprout': sprout,
    'flag': flag, 'flag-blue': lambda: flag(L), 'drum': drum, 'chest': chest,
    'pickaxe': pickaxe, 'pickaxe-gold': lambda: pickaxe(Y), 'helmet': helmet, 'helmet-red': lambda: helmet(R),
    'minecart': minecart, 'dynamite': dynamite, 'dynamite-blue': lambda: dynamite(L), 'lamp': lamp,
    'drill': drill, 'drill-red': lambda: drill(R), 'rail': rail, 'map': treasure_map,
    'laptop': laptop, 'bug': bug, 'bug-red': lambda: bug(R), 'loop': loop, 'envelope': envelope,
    'chip': chip, 'chip-red': lambda: chip(R), 'chip-gold': lambda: chip(Y), 'robot': robot,
    'robot-gold': lambda: robot(Y, R), 'gear': gear, 'database': database, 'key': key, 'cloud': cloud,
    'lock': lock, 'skull': skull, 'skull-red': lambda: skull((255, 170, 170, 255)), 'docs': docs,
    'snowball': snowball, 'mirror': mirror, 'door': door, 'eye': eye,
}

for name, fn in ICONS.items():
    save(fn(), name)


# ---------------- 复用 ninja-battle 素材（CC0） ----------------

def crop_pad(src, box, size):
    im = Image.open(src).convert('RGBA').crop(box)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(im, ((size - im.width) // 2, (size - im.height) // 2))
    return out


for ch in ['NinjaBlue', 'NinjaRed', 'NinjaFire', 'NinjaWater', 'GladiatorBlue', 'RedGladiator']:
    walk = NINJA / 'chars' / ch / 'Walk.png'
    atk = NINJA / 'chars' / ch / 'Attack.png'
    save(crop_pad(walk, (0, 0, 16, 16), 16), f'char-{ch.lower()}')
    save(crop_pad(atk, (0, 0, 16, 16), 16), f'char-{ch.lower()}-attack')

save(crop_pad(NINJA / 'fx' / 'explosion.png', (160, 0, 200, 40), 40), 'fx-explosion')
save(crop_pad(NINJA / 'fx' / 'smoke.png', (64, 0, 96, 32), 32), 'fx-smoke')
save(crop_pad(NINJA / 'fx' / 'heal.png', (64, 0, 96, 32), 32), 'fx-heal')
save(crop_pad(NINJA / 'weapons' / 'katana.png', (0, 0, 6, 10), 12), 'w-katana')
save(crop_pad(NINJA / 'weapons' / 'bow.png', (0, 0, 15, 7), 16), 'w-bow')
save(crop_pad(NINJA / 'weapons' / 'lance.png', (0, 0, 6, 16), 16), 'w-lance')
save(crop_pad(NINJA / 'horse' / 'brown.png', (0, 0, 23, 16), 24), 'horse-brown')
save(crop_pad(NINJA / 'horse' / 'black.png', (0, 0, 23, 16), 24), 'horse-black')

print('生成', len(list(OUT.glob('*.png'))), '张 →', OUT)
