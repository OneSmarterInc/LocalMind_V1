import tempfile
from pathlib import Path

from django.test import SimpleTestCase

from .services import visuals


class RectStub:
    def __init__(self, x0, y0, x1, y1):
        self.x0, self.y0, self.x1, self.y1 = x0, y0, x1, y1

    @property
    def width(self):
        return self.x1 - self.x0

    @property
    def height(self):
        return self.y1 - self.y0


class VisualRegionPolicyTests(SimpleTestCase):
    def test_rejects_near_full_page_region(self):
        page = RectStub(0, 0, 600, 800)
        near_page = RectStub(10, 10, 590, 790)
        self.assertFalse(visuals._valid_region(near_page, page))

    def test_accepts_normal_figure_region(self):
        page = RectStub(0, 0, 600, 800)
        figure = RectStub(80, 120, 430, 390)
        self.assertTrue(visuals._valid_region(figure, page))

    def test_deduplication_prefers_table_over_overlapping_diagram(self):
        table = {"kind": "table", "page": 2, "rect": RectStub(50, 60, 350, 260)}
        diagram = {"kind": "diagram", "page": 2, "rect": RectStub(55, 65, 345, 255)}
        result = visuals._dedupe([diagram, table])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["kind"], "table")

    def test_real_pdf_vector_chart_is_cropped_not_page_sized(self):
        try:
            import pymupdf
        except ImportError:
            self.skipTest("PyMuPDF is not installed")

        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "chart.pdf"
            doc = pymupdf.open()
            page = doc.new_page(width=600, height=800)
            # A compact chart-like cluster in the middle of a text page.
            page.draw_rect(pymupdf.Rect(110, 180, 410, 430), width=2)
            for x, height in ((150, 90), (220, 150), (290, 120), (360, 180)):
                page.draw_rect(pymupdf.Rect(x, 410 - height, x + 32, 410), fill=(0.6, 0.6, 0.6))
            page.insert_text((72, 90), "This paragraph must not become part of the chart image.")
            doc.save(str(pdf_path))
            doc.close()

            output = Path(tmp) / "processed"
            found = visuals._save_pdf_visuals(pdf_path, output)
            self.assertTrue(found, "Expected a cropped vector diagram/chart region")
            for item in found:
                x0, y0, x1, y1 = item["bbox"]
                self.assertLess(((x1 - x0) * (y1 - y0)) / (600 * 800), visuals.MAX_REGION_PAGE_RATIO)
                self.assertNotEqual((round(x0), round(y0), round(x1), round(y1)), (0, 0, 600, 800))


class PrivateParserContractTests(SimpleTestCase):
    def test_private_parser_never_saves_original_pdf_page(self):
        repo = Path(__file__).resolve().parents[2]
        parser = (repo / "frontend" / "scripts" / "parser-entry.mjs").read_text(encoding="utf-8")
        self.assertNotIn("capture(canvas,`Original page", parser)
        self.assertIn("Never save the rendered page itself", parser)

    def test_private_ui_never_offers_full_page_visual(self):
        repo = Path(__file__).resolve().parents[2]
        component = (repo / "frontend" / "src" / "private" / "SourceVisuals.tsx").read_text(encoding="utf-8")
        self.assertNotIn("View original page", component)
        self.assertIn("v.kind!=='page'", component)
