"""Page images and crops via pypdfium2 (Apache-2.0/BSD)."""

from __future__ import annotations

import io

import pypdfium2 as pdfium
from PIL import Image

from .types import Bbox


class Renderer:
    def __init__(self, data: bytes):
        self.doc = pdfium.PdfDocument(data)
        self._cache: dict[tuple[int, float], Image.Image] = {}

    def close(self) -> None:
        self.doc.close()

    def page_size(self, number: int) -> tuple[float, float]:
        w, h = self.doc[number - 1].get_size()
        return float(w), float(h)

    def page_image(self, number: int, scale: float) -> Image.Image:
        key = (number, scale)
        if key not in self._cache:
            if len(self._cache) > 3:
                self._cache.clear()
            self._cache[key] = self.doc[number - 1].render(scale=scale).to_pil().convert("RGB")
        return self._cache[key]

    def page_jpeg(self, number: int, scale: float, quality: int = 78) -> tuple[bytes, int, int]:
        img = self.page_image(number, scale)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        return buf.getvalue(), img.width, img.height

    def crop_png(self, number: int, bbox: Bbox, scale: float = 3.0, pad: float = 2.0,
                 transparent: bool = False, max_width: int = 1800) -> tuple[bytes, int, int, Bbox]:
        img = self.page_image(number, scale)
        pw, ph = self.page_size(number)
        x0, top, x1, bottom = max(0.0, bbox[0] - pad), max(0.0, bbox[1] - pad), min(pw, bbox[2] + pad), min(ph, bbox[3] + pad)
        box = (int(x0 * scale), int(top * scale), max(int(x1 * scale), int(x0 * scale) + 1),
               max(int(bottom * scale), int(top * scale) + 1))
        crop = img.crop(box)
        if crop.width > max_width:
            ratio = max_width / crop.width
            crop = crop.resize((max_width, max(1, int(crop.height * ratio))), Image.LANCZOS)
        if transparent:
            gray = crop.convert("L")
            alpha = gray.point(lambda v: 255 - v)
            out = Image.new("RGBA", crop.size, (0, 0, 0, 0))
            out.putalpha(alpha)
            crop = out
        buf = io.BytesIO()
        crop.save(buf, format="PNG", optimize=True)
        return buf.getvalue(), crop.width, crop.height, (x0, top, x1, bottom)
