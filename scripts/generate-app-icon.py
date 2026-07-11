#!/usr/bin/env python3
"""Pixiv Novel Readerのアプリアイコン一式を再現可能に生成する。"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "assets" / "images"
SCALE = 3
SIZE = 1024
HI = SIZE * SCALE


def sc(value: float) -> int:
    return round(value * SCALE)


def points(values: Iterable[tuple[float, float]]) -> list[tuple[int, int]]:
    return [(sc(x), sc(y)) for x, y in values]


def cubic(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
    steps: int = 48,
) -> list[tuple[float, float]]:
    result: list[tuple[float, float]] = []
    for index in range(steps + 1):
        t = index / steps
        u = 1 - t
        x = (
            u**3 * p0[0]
            + 3 * u**2 * t * p1[0]
            + 3 * u * t**2 * p2[0]
            + t**3 * p3[0]
        )
        y = (
            u**3 * p0[1]
            + 3 * u**2 * t * p1[1]
            + 3 * u * t**2 * p2[1]
            + t**3 * p3[1]
        )
        result.append((x, y))
    return result


def vertical_gradient(
    top: tuple[int, int, int, int],
    bottom: tuple[int, int, int, int],
    size: tuple[int, int] = (HI, HI),
) -> Image.Image:
    image = Image.new("RGBA", size)
    draw = ImageDraw.Draw(image)
    width, height = size
    for y in range(height):
        ratio = y / max(1, height - 1)
        color = tuple(
            round(top[channel] * (1 - ratio) + bottom[channel] * ratio)
            for channel in range(4)
        )
        draw.line((0, y, width, y), fill=color)
    return image


def masked_gradient(mask: Image.Image, top: tuple[int, int, int, int], bottom: tuple[int, int, int, int]) -> Image.Image:
    gradient = vertical_gradient(top, bottom, mask.size)
    gradient.putalpha(mask)
    return gradient


def polygon_mask(coords: list[tuple[float, float]]) -> Image.Image:
    mask = Image.new("L", (HI, HI), 0)
    ImageDraw.Draw(mask).polygon(points(coords), fill=255)
    return mask


def shadow_from_mask(mask: Image.Image, blur: float, offset: tuple[float, float], opacity: int) -> Image.Image:
    shifted = Image.new("L", mask.size, 0)
    shifted.paste(mask, (sc(offset[0]), sc(offset[1])))
    shifted = shifted.filter(ImageFilter.GaussianBlur(sc(blur)))
    color = Image.new("RGBA", mask.size, (0, 28, 92, opacity))
    color.putalpha(Image.eval(shifted, lambda value: value * opacity // 255))
    return color


def build_background() -> Image.Image:
    background = vertical_gradient((48, 220, 251, 255), (0, 112, 245, 255))

    # 左上のやわらかいハイライト。
    highlight = Image.new("RGBA", (HI, HI), (0, 0, 0, 0))
    highlight_mask = Image.new("L", (HI, HI), 0)
    ImageDraw.Draw(highlight_mask).ellipse(
        (sc(-210), sc(-220), sc(860), sc(640)),
        fill=150,
    )
    highlight_mask = highlight_mask.filter(ImageFilter.GaussianBlur(sc(130)))
    highlight.putalpha(highlight_mask)
    highlight_color = Image.new("RGBA", (HI, HI), (150, 252, 255, 0))
    highlight_color.putalpha(highlight_mask)
    background.alpha_composite(highlight_color)

    # 下部に深みを足す。
    depth = Image.new("RGBA", (HI, HI), (0, 0, 0, 0))
    depth_mask = Image.new("L", (HI, HI), 0)
    ImageDraw.Draw(depth_mask).ellipse(
        (sc(80), sc(610), sc(950), sc(1150)),
        fill=100,
    )
    depth_mask = depth_mask.filter(ImageFilter.GaussianBlur(sc(110)))
    depth_color = Image.new("RGBA", (HI, HI), (0, 43, 160, 0))
    depth_color.putalpha(depth_mask)
    depth.alpha_composite(depth_color)
    background.alpha_composite(depth)
    return background


def page_shape(left: bool, layer: int = 0) -> list[tuple[float, float]]:
    center_x = 512
    side = -1 if left else 1
    outer_x = 165 - layer * 22 if left else 859 + layer * 22
    top_outer = 292 + layer * 32
    bottom_outer = 716 + layer * 22
    top_center = 356 + layer * 12
    bottom_center = 800 + layer * 15

    path: list[tuple[float, float]] = [(center_x, bottom_center)]
    path += cubic(
        (center_x, bottom_center),
        (center_x + side * 90, 738 + layer * 12),
        (center_x + side * 218, 685 + layer * 16),
        (outer_x, bottom_outer),
    )[1:]
    path += cubic(
        (outer_x, bottom_outer),
        (outer_x - side * 8, 560),
        (outer_x - side * 2, 390),
        (outer_x, top_outer),
    )[1:]
    path += cubic(
        (outer_x, top_outer),
        (center_x + side * 228, 225 + layer * 12),
        (center_x + side * 92, 242 + layer * 10),
        (center_x, top_center),
    )[1:]
    path += cubic(
        (center_x, top_center),
        (center_x + side * 10, 480),
        (center_x + side * 4, 660),
        (center_x, bottom_center),
    )[1:]
    return path


def build_book_foreground() -> Image.Image:
    foreground = Image.new("RGBA", (HI, HI), (0, 0, 0, 0))

    # 本全体の落ち影。
    shadow_mask = Image.new("L", (HI, HI), 0)
    shadow_draw = ImageDraw.Draw(shadow_mask)
    shadow_draw.ellipse((sc(120), sc(650), sc(900), sc(910)), fill=210)
    shadow_mask = shadow_mask.filter(ImageFilter.GaussianBlur(sc(42)))
    shadow = Image.new("RGBA", (HI, HI), (0, 28, 110, 0))
    shadow.putalpha(shadow_mask)
    foreground.alpha_composite(shadow)

    # 青い表紙／ページ下端。
    cover_coords = (
        cubic((512, 832), (400, 775), (275, 735), (132, 760))
        + [(132, 825)]
        + cubic((132, 825), (290, 790), (407, 835), (512, 890))[1:]
        + cubic((512, 890), (620, 835), (742, 790), (892, 825))[1:]
        + [(892, 760)]
        + cubic((892, 760), (746, 735), (625, 775), (512, 832))[1:]
    )
    cover_mask = polygon_mask(cover_coords)
    foreground.alpha_composite(shadow_from_mask(cover_mask, 18, (0, 18), 120))
    foreground.alpha_composite(
        masked_gradient(cover_mask, (34, 183, 255, 255), (0, 65, 218, 255))
    )

    # 奥のページを複数重ねる。
    for layer, colors in [
        (2, ((225, 244, 255, 255), (184, 219, 250, 255))),
        (1, ((246, 252, 255, 255), (214, 234, 252, 255))),
    ]:
        for left in (True, False):
            mask = polygon_mask(page_shape(left, layer))
            foreground.alpha_composite(shadow_from_mask(mask, 9, (0, 8), 75))
            foreground.alpha_composite(masked_gradient(mask, *colors))

    # メインページ。
    main_masks: list[Image.Image] = []
    for left in (True, False):
        mask = polygon_mask(page_shape(left, 0))
        main_masks.append(mask)
        foreground.alpha_composite(shadow_from_mask(mask, 11, (0, 10), 90))
        colors = (
            ((255, 255, 255, 255), (231, 242, 253, 255))
            if left
            else ((255, 255, 255, 255), (235, 246, 255, 255))
        )
        foreground.alpha_composite(masked_gradient(mask, *colors))

    # 中央の綴じ目。
    crease = Image.new("L", (HI, HI), 0)
    ImageDraw.Draw(crease).polygon(
        points([(493, 356), (512, 800), (531, 356), (516, 736), (512, 783), (508, 736)]),
        fill=95,
    )
    crease = crease.filter(ImageFilter.GaussianBlur(sc(7)))
    crease_color = Image.new("RGBA", (HI, HI), (90, 145, 205, 0))
    crease_color.putalpha(crease)
    foreground.alpha_composite(crease_color)

    # オレンジのしおり。ループと垂れ部分をひとつのマスクとして描く。
    ribbon_mask = Image.new("L", (HI, HI), 0)
    ribbon_draw = ImageDraw.Draw(ribbon_mask)
    ribbon_draw.arc(
        (sc(568), sc(260), sc(792), sc(486)),
        start=205,
        end=510,
        fill=255,
        width=sc(62),
    )
    ribbon_draw.polygon(
        points(
            [
                (592, 318),
                (670, 318),
                (670, 666),
                (631, 627),
                (592, 666),
            ]
        ),
        fill=255,
    )
    # ページの外にはみ出しすぎないよう右ページ内へ制限。
    ribbon_mask = ImageChops.multiply(ribbon_mask, main_masks[1])
    foreground.alpha_composite(shadow_from_mask(ribbon_mask, 7, (5, 8), 105))
    foreground.alpha_composite(
        masked_gradient(ribbon_mask, (255, 208, 35, 255), (255, 128, 0, 255))
    )

    # 紙面の薄いハイライト。
    gloss = Image.new("RGBA", (HI, HI), (0, 0, 0, 0))
    gloss_mask = Image.new("L", (HI, HI), 0)
    ImageDraw.Draw(gloss_mask).ellipse(
        (sc(230), sc(255), sc(780), sc(560)),
        fill=40,
    )
    gloss_mask = gloss_mask.filter(ImageFilter.GaussianBlur(sc(55)))
    gloss_color = Image.new("RGBA", (HI, HI), (255, 255, 255, 0))
    gloss_color.putalpha(gloss_mask)
    foreground.alpha_composite(gloss_color)

    return foreground


def resize_rgba(image: Image.Image, size: int) -> Image.Image:
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    background = build_background()
    foreground = build_book_foreground()

    standard = background.copy()
    standard.alpha_composite(foreground)
    resize_rgba(standard, SIZE).convert("RGB").save(
        ASSET_DIR / "icon.png",
        optimize=True,
    )

    # Android adaptive iconは安全領域内へ少し縮小した前景を置く。
    foreground_small = resize_rgba(foreground, 760 * SCALE)
    adaptive = Image.new("RGBA", (HI, HI), (0, 0, 0, 0))
    adaptive.alpha_composite(
        foreground_small,
        ((HI - foreground_small.width) // 2, (HI - foreground_small.height) // 2),
    )
    resize_rgba(adaptive, SIZE).save(
        ASSET_DIR / "android-icon-foreground.png",
        optimize=True,
    )

    resize_rgba(background, SIZE).convert("RGB").save(
        ASSET_DIR / "android-icon-background.png",
        optimize=True,
    )

    mono = Image.new("RGBA", adaptive.size, (0, 0, 0, 0))
    mono.putalpha(adaptive.getchannel("A"))
    resize_rgba(mono, SIZE).save(
        ASSET_DIR / "android-icon-monochrome.png",
        optimize=True,
    )

    splash = Image.new("RGBA", (HI, HI), (0, 0, 0, 0))
    splash_symbol = resize_rgba(foreground, 680 * SCALE)
    splash.alpha_composite(
        splash_symbol,
        ((HI - splash_symbol.width) // 2, (HI - splash_symbol.height) // 2),
    )
    resize_rgba(splash, SIZE).save(
        ASSET_DIR / "splash-icon.png",
        optimize=True,
    )

    resize_rgba(standard, 128).convert("RGB").save(
        ASSET_DIR / "favicon.png",
        optimize=True,
    )

    for name in [
        "icon.png",
        "android-icon-background.png",
        "android-icon-foreground.png",
        "android-icon-monochrome.png",
        "splash-icon.png",
        "favicon.png",
    ]:
        path = ASSET_DIR / name
        with Image.open(path) as image:
            print(f"{name}: {image.size[0]}x{image.size[1]} {image.mode} {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
