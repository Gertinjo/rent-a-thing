"""Tiny flat-shaded 3D renderer used only to make demo 360° spins for the seed data.

Each demo object is built from primitives (boxes, cylinders, tori, prisms) and rendered
from 36 angles around the vertical axis, exactly like a real owner walking around it.
"""

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

Face = tuple[np.ndarray, tuple[int, int, int]]  # (k x 3 vertices, rgb)


# ---------- primitives ----------


def box(center, size, color) -> list[Face]:
    cx, cy, cz = center
    sx, sy, sz = (s / 2 for s in size)
    v = np.array([[cx + dx * sx, cy + dy * sy, cz + dz * sz] for dx in (-1, 1) for dy in (-1, 1) for dz in (-1, 1)])
    quads = [(0, 1, 3, 2), (4, 5, 7, 6), (0, 1, 5, 4), (2, 3, 7, 6), (0, 2, 6, 4), (1, 3, 7, 5)]
    return [(v[list(q)], color) for q in quads]


def _basis(axis):
    axis = axis / np.linalg.norm(axis)
    helper = np.array([1.0, 0, 0]) if abs(axis[0]) < 0.9 else np.array([0, 1.0, 0])
    u = np.cross(axis, helper)
    u /= np.linalg.norm(u)
    return u, np.cross(axis, u)


def cylinder(p0, p1, r, color, seg=28, caps=True, r1=None, cap_color=None) -> list[Face]:
    p0, p1 = np.array(p0, float), np.array(p1, float)
    r1 = r if r1 is None else r1
    u, w = _basis(p1 - p0)
    angles = np.linspace(0, 2 * math.pi, seg, endpoint=False)
    ring0 = [p0 + r * (math.cos(a) * u + math.sin(a) * w) for a in angles]
    ring1 = [p1 + r1 * (math.cos(a) * u + math.sin(a) * w) for a in angles]
    faces = [(np.array([ring0[i], ring0[(i + 1) % seg], ring1[(i + 1) % seg], ring1[i]]), color) for i in range(seg)]
    if caps:
        faces.append((np.array(ring0), cap_color or color))
        if r1 > 0:
            faces.append((np.array(ring1), cap_color or color))
    return faces


def torus(center, axis, R, r, color, seg=40, ring=10) -> list[Face]:
    c = np.array(center, float)
    u, w = _basis(np.array(axis, float))
    n = np.array(axis, float) / np.linalg.norm(axis)

    def pt(i, j):
        a, b = 2 * math.pi * i / seg, 2 * math.pi * j / ring
        radial = math.cos(a) * u + math.sin(a) * w
        return c + (R + r * math.cos(b)) * radial + r * math.sin(b) * n

    return [
        (np.array([pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)]), color)
        for i in range(seg)
        for j in range(ring)
    ]


def tube(points, r, color) -> list[Face]:
    faces = []
    for a, b in zip(points, points[1:]):
        faces += cylinder(a, b, r, color, seg=10, caps=False)
    return faces


# ---------- renderer ----------


def render(faces: list[Face], angle_deg: float, size=720, tilt_deg=18, zoom=1.0, bg=((244, 244, 246), (222, 222, 227))):
    ss = 2  # supersample for anti-aliasing
    W = size * ss
    img = Image.new("RGB", (W, W))
    top, bottom = np.array(bg[0]), np.array(bg[1])
    grad = (top + (bottom - top) * np.linspace(0, 1, W)[:, None]).astype(np.uint8)
    img.paste(Image.fromarray(np.repeat(grad[:, None, :], W, axis=1)))

    # soft ground shadow
    shadow = Image.new("L", (W, W), 0)
    ImageDraw.Draw(shadow).ellipse([W * 0.2, W * 0.70, W * 0.8, W * 0.80], fill=90)
    shadow = shadow.filter(ImageFilter.GaussianBlur(W * 0.025))
    img = Image.composite(Image.new("RGB", (W, W), (140, 140, 148)), img, shadow)

    a, t = math.radians(angle_deg), math.radians(tilt_deg)
    ry = np.array([[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]])
    rx = np.array([[1, 0, 0], [0, math.cos(t), -math.sin(t)], [0, math.sin(t), math.cos(t)]])
    rot = rx @ ry
    light = np.array([-0.4, 0.8, 0.55])
    light /= np.linalg.norm(light)
    cam_dist, focal = 6.0, W * 0.95 * zoom

    projected = []
    for verts, color in faces:
        v = verts @ rot.T
        v[:, 2] -= cam_dist  # camera looks down -z
        normal = np.cross(v[1] - v[0], v[2] - v[0])
        nlen = np.linalg.norm(normal)
        if nlen < 1e-9:
            continue
        normal /= nlen
        centroid = v.mean(axis=0)
        if np.dot(normal, -centroid) < 0:  # make every face two-sided
            normal = -normal
        shade = 0.38 + 0.62 * max(0.0, float(np.dot(normal, light)))
        rgb = tuple(int(min(255, c * shade)) for c in color)
        pts = [(W / 2 + focal * x / -z, W * 0.47 - focal * y / -z) for x, y, z in v]
        projected.append((centroid[2], pts, rgb))

    draw = ImageDraw.Draw(img)
    for _, pts, rgb in sorted(projected, key=lambda p: p[0]):  # painter's algorithm: far first
        draw.polygon(pts, fill=rgb, outline=rgb)
    return img.resize((size, size), Image.LANCZOS)


def render_spin(faces, out_dir: Path, frames=36, **kw) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for i in range(frames):
        p = out_dir / f"{i:03d}.jpg"
        render(faces, 360 * i / frames + 30, **kw).save(p, quality=86)
        paths.append(p)
    return paths


# ---------- demo objects ----------

BLACK, GREY, SILVER = (40, 42, 46), (95, 98, 105), (190, 192, 196)


def camera() -> list[Face]:
    f = box((0, 0, 0), (1.7, 1.05, 0.62), BLACK)
    f += box((-0.55, 0.62, 0.02), (0.5, 0.25, 0.45), BLACK)  # viewfinder hump
    f += box((0.62, 0.0, 0.36), (0.36, 0.95, 0.18), (70, 60, 52))  # grip
    f += cylinder((0, -0.02, 0.31), (0, -0.02, 0.85), 0.42, GREY, cap_color=(25, 25, 30))
    f += cylinder((0, -0.02, 0.85), (0, -0.02, 1.0), 0.38, BLACK, cap_color=(60, 90, 140))
    f += cylinder((0.55, 0.53, 0.05), (0.55, 0.62, 0.05), 0.13, SILVER)  # dial
    f += cylinder((0.25, 0.53, 0.15), (0.25, 0.58, 0.15), 0.07, (200, 40, 40))  # shutter
    return f


def tent() -> list[Face]:
    green, dark = (64, 132, 92), (40, 92, 64)
    L, Wd, H = 1.4, 1.2, 1.25
    a, b = np.array([-L, -0.6, -Wd]), np.array([L, -0.6, -Wd])
    c, d = np.array([L, -0.6, Wd]), np.array([-L, -0.6, Wd])
    r0, r1 = np.array([-L, -0.6 + H, 0]), np.array([L, -0.6 + H, 0])
    f = [
        (np.array([a, b, r1, r0]), green),
        (np.array([d, c, r1, r0]), green),
        (np.array([a, d, r0]), dark),
        (np.array([b, c, r1]), dark),
        (np.array([a, b, c, d]), (90, 80, 60)),
    ]
    door = [np.array([L + 0.01, -0.6, -0.45]), np.array([L + 0.01, -0.6, 0.45]), np.array([L + 0.01, 0.25, 0])]
    f.append((np.array(door), (230, 160, 60)))
    f += tube([(-L, -0.6 + H, 0), (-L - 0.5, -0.6, 0)], 0.02, (180, 180, 180))
    f += tube([(L, -0.6 + H, 0), (L + 0.5, -0.6, 0)], 0.02, (180, 180, 180))
    return f


def drill() -> list[Face]:
    yellow = (240, 180, 30)
    f = cylinder((-0.9, 0.35, 0), (0.5, 0.35, 0), 0.32, yellow, cap_color=BLACK)
    f += cylinder((0.5, 0.35, 0), (0.85, 0.35, 0), 0.22, BLACK)
    f += cylinder((0.85, 0.35, 0), (1.55, 0.35, 0), 0.04, SILVER, r1=0.005)
    f += box((-0.35, -0.35, 0), (0.42, 1.1, 0.4), BLACK)  # handle
    f += box((-0.35, -0.98, 0), (0.95, 0.28, 0.6), yellow)  # battery
    f += box((-0.12, 0.0, 0), (0.12, 0.22, 0.18), (200, 40, 40))  # trigger
    return f


def bike() -> list[Face]:
    red = (200, 55, 50)
    f = torus((-1.05, -0.45, 0), (0, 0, 1), 0.62, 0.06, BLACK)
    f += torus((1.05, -0.45, 0), (0, 0, 1), 0.62, 0.06, BLACK)
    for x in (-1.05, 1.05):
        for k in range(8):
            ang = k * math.pi / 4
            f += tube([(x, -0.45, 0), (x + 0.58 * math.cos(ang), -0.45 + 0.58 * math.sin(ang), 0)], 0.008, SILVER)
    bb, seat, head = (0.0, -0.45, 0), (-0.3, 0.45, 0), (0.75, 0.42, 0)
    f += tube([(-1.05, -0.45, 0.06), bb], 0.035, red)
    f += tube([bb, seat], 0.045, red)
    f += tube([seat, head], 0.045, red)
    f += tube([bb, head], 0.05, red)
    f += tube([seat, (-1.05, -0.45, 0.06)], 0.03, red)
    f += tube([head, (1.05, -0.45, 0)], 0.04, SILVER)
    f += tube([seat, (-0.36, 0.62, 0)], 0.025, SILVER)
    f += box((-0.38, 0.66, 0), (0.42, 0.08, 0.18), BLACK)  # saddle
    f += tube([head, (0.68, 0.7, 0)], 0.025, SILVER)
    f += tube([(0.68, 0.7, -0.35), (0.68, 0.7, 0.35)], 0.03, BLACK)  # handlebar
    f += cylinder((0, -0.45, -0.08), (0, -0.45, 0.08), 0.16, SILVER)  # chainring
    return f


def ladder() -> list[Face]:
    alu = (185, 190, 198)
    f = []
    for z in (-0.45, 0.45):
        f += box((0, 0, z), (0.12, 2.6, 0.08), alu)
    for k in range(8):
        f += box((0, -1.1 + k * 0.32, 0), (0.1, 0.06, 0.9), (150, 155, 165))
    return f


def projector() -> list[Face]:
    shell, dark = (225, 226, 230), (60, 62, 68)
    f = box((0, 0, 0), (1.8, 0.62, 1.3), shell)
    f += box((0, 0.33, 0), (1.6, 0.04, 1.1), (205, 206, 212))  # top panel
    f += cylinder((0.45, 0.0, 0.65), (0.45, 0.0, 0.95), 0.27, dark, cap_color=(40, 70, 120))  # lens
    f += cylinder((0.45, 0.0, 0.95), (0.45, 0.0, 1.0), 0.2, (25, 35, 60))
    for x in (-0.75, -0.55, -0.35):  # vent slots
        f += box((x, 0.0, 0.66), (0.08, 0.38, 0.02), dark)
    f += cylinder((-0.3, 0.36, -0.2), (-0.3, 0.4, -0.2), 0.09, (90, 160, 255))  # power button
    for x in (-0.7, 0.7):
        for z in (-0.5, 0.5):
            f += cylinder((x, -0.31, z), (x, -0.42, z), 0.07, dark)
    return f


def speaker() -> list[Face]:
    body, grille = (35, 36, 40), (55, 57, 63)
    f = box((0, 0.05, 0), (1.0, 1.9, 0.85), body)
    f += cylinder((0, -0.35, 0.43), (0, -0.35, 0.5), 0.36, grille, cap_color=(20, 20, 24))  # woofer
    f += cylinder((0, -0.35, 0.5), (0, -0.35, 0.56), 0.12, (80, 82, 90))
    f += cylinder((0, 0.5, 0.43), (0, 0.5, 0.5), 0.16, grille, cap_color=(20, 20, 24))  # tweeter
    f += box((0, 0.85, 0.43), (0.7, 0.06, 0.02), (255, 120, 60))  # light strip
    f += tube([(-0.25, 1.0, 0), (-0.25, 1.22, 0), (0.25, 1.22, 0), (0.25, 1.0, 0)], 0.045, (90, 92, 98))  # handle
    for x in (-0.4, 0.4):
        f += cylinder((x, -0.9, 0), (x, -1.0, 0), 0.09, (60, 60, 66))  # wheels
    return f


DEMO_OBJECTS = {"camera": (camera, 1.75), "tent": (tent, 1.45), "drill": (drill, 1.7), "bike": (bike, 1.5), "ladder": (ladder, 1.3), "projector": (projector, 1.6), "speaker": (speaker, 1.3)}
