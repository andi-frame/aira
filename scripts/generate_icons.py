#!/usr/bin/env python3
"""
AIRA - Extension Icon Generator
Generates a single crisp circular button icon with the brand's italic 'A' in Google Sans Bold Italic.
Outputs to icons/icon.png and dist/icons/icon.png (128x128).
"""

from PIL import Image, ImageDraw, ImageFont
import os

def generate_aira_icon(size=128):
    ss = 4
    canvas_size = size * ss
    img = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = 3 * ss
    bbox = [margin, margin, canvas_size - margin, canvas_size - margin]

    # Primary brand active blue: #057FC7 (RGB: 5, 127, 199)
    draw.ellipse(bbox, fill=(5, 127, 199, 255))

    font_path = '/Users/lanaginting/Library/Fonts/GoogleSans-BoldItalic.ttf'
    if not os.path.exists(font_path):
        font_path = '/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf'

    font_size = int(canvas_size * 0.62)
    font = ImageFont.truetype(font_path, font_size)

    text = 'A'
    t_bbox = draw.textbbox((0, 0), text, font=font)
    t_w = t_bbox[2] - t_bbox[0]
    t_h = t_bbox[3] - t_bbox[1]

    # Optical centering for italic letter 'A'
    x = (canvas_size - t_w) / 2 - t_bbox[0] + (1.5 * ss)
    y = (canvas_size - t_h) / 2 - t_bbox[1] - (1 * ss)

    # Crisp white text
    draw.text((x, y), text, font=font, fill=(255, 255, 255, 255))

    return img.resize((size, size), Image.Resampling.LANCZOS)

def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    icons_dir = os.path.join(root_dir, 'icons')
    dist_icons_dir = os.path.join(root_dir, 'dist', 'icons')

    os.makedirs(icons_dir, exist_ok=True)
    os.makedirs(dist_icons_dir, exist_ok=True)

    icon = generate_aira_icon(128)
    path1 = os.path.join(icons_dir, 'icon.png')
    path2 = os.path.join(dist_icons_dir, 'icon.png')
    icon.save(path1, 'PNG')
    icon.save(path2, 'PNG')
    print(f"Generated single icon -> {path1} & {path2}")

if __name__ == '__main__':
    main()
