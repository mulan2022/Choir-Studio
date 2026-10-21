"""Combine rendered PDF pages into a grayscale TIFF for Audiveris."""

import sys
from PIL import Image


def main() -> None:
    output, *pages = sys.argv[1:]
    if not output or not pages:
        raise SystemExit("usage: make-multipage-tiff.py output.tif page-1.png ...")
    images = []
    for page in pages:
        with Image.open(page) as source:
            images.append(source.convert("L"))
    try:
        images[0].save(
            output,
            format="TIFF",
            save_all=True,
            append_images=images[1:],
            compression="tiff_lzw",
        )
    finally:
        for image in images:
            image.close()


if __name__ == "__main__":
    main()
