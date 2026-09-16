"""Regression tests for textbook visual fallbacks used by NCERT-style PDFs."""
import io
from PIL import Image

from django.test import SimpleTestCase

from .services.textbook_visual_fallbacks import textbook_fallback_regions


# 1x1 opaque PNG, scaled by PyMuPDF into the requested rectangles.
_buffer = io.BytesIO()
Image.new('RGB', (1, 1), 'white').save(_buffer, format='PNG')
_PNG = _buffer.getvalue()


class TextbookVisualFallbackTests(SimpleTestCase):
    def setUp(self):
        try:
            import pymupdf  # noqa: F401
        except ImportError:
            self.skipTest("PyMuPDF is not installed")

    def test_captioned_multipart_figure_ignores_chapter_banner(self):
        import pymupdf

        doc = pymupdf.open()
        page = doc.new_page(width=600, height=800)
        # Decorative wide banner: this is the kind of Physics header that must
        # not become a source image.
        page.insert_image(pymupdf.Rect(20, 20, 580, 70), stream=_PNG)
        # Three pieces of one NCERT-style labelled figure.
        page.insert_image(pymupdf.Rect(120, 190, 210, 280), stream=_PNG)
        page.insert_image(pymupdf.Rect(255, 190, 345, 280), stream=_PNG)
        page.insert_image(pymupdf.Rect(390, 190, 480, 280), stream=_PNG)
        page.insert_text((125, 310), "FIGURE 1.1 Glass rods repel and unlike charges attract", fontsize=10)
        page.insert_text((75, 380), "This paragraph is ordinary textbook prose and must not be included.", fontsize=10)

        regions = textbook_fallback_regions(page, 1)
        figures = [r for r in regions if r["origin"] == "captioned_raster_group"]
        self.assertEqual(len(figures), 1)
        rect = figures[0]["rect"]
        self.assertGreater(rect.y0, 150)
        self.assertLess(rect.y1, 300)
        self.assertGreater(rect.width, 300)
        self.assertTrue(figures[0]["caption"].startswith("FIGURE 1.1"))
        doc.close()

    def test_uncaptioned_banner_and_page_number_are_not_rescued(self):
        import pymupdf

        doc = pymupdf.open()
        page = doc.new_page(width=600, height=800)
        page.insert_image(pymupdf.Rect(20, 20, 580, 70), stream=_PNG)
        page.insert_image(pymupdf.Rect(260, 710, 330, 770), stream=_PNG)
        page.insert_text((75, 350), "Ordinary prose without a Figure caption.", fontsize=10)
        regions = textbook_fallback_regions(page, 1)
        self.assertFalse([r for r in regions if r["origin"] == "captioned_raster_group"])
        doc.close()

    def test_borderless_three_column_table_is_detectable(self):
        import pymupdf

        doc = pymupdf.open()
        page = doc.new_page(width=600, height=800)
        page.insert_text((70, 150), "Table 4.2 Results by condition", fontsize=10)
        rows = [
            ("Measure", "Calculation", "Decision"),
            ("Quality", "90 / 100", "Expand"),
            ("Cost", "$800 / 80", "Review"),
            ("Escalation", "18 / 20", "Improve"),
        ]
        y = 190
        for row in rows:
            for x, value in zip((70, 235, 405), row):
                page.insert_text((x, y), value, fontsize=10)
            y += 28
        regions = textbook_fallback_regions(page, 1)
        tables = [r for r in regions if r["origin"] == "borderless_text_table"]
        self.assertTrue(tables, "Expected a borderless aligned-text table")
        self.assertTrue(any(r.get("caption", "").startswith("Table 4.2") for r in tables))
        doc.close()


class ProseIsNotATableTests(SimpleTestCase):
    """Text-strategy table inference will happily carve running prose into
    cells. A caption beside it used to be treated as permission to keep it,
    which is how a column of body text arrived as a "table" crop of the page."""

    def test_a_prose_column_beside_a_figure_caption_is_not_a_table(self):
        import pymupdf

        doc = pymupdf.open()
        page = doc.new_page(width=600, height=800)
        page.insert_text((70, 120), "FIGURE 2.1 Rods repel and attract", fontsize=10)
        sentences = [
            "Charges acquired after rubbing are lost when the",
            "charged bodies are brought into contact again, which",
            "tells us that unlike charges neutralise each other.",
            "Therefore the charges were named positive and",
            "negative by the American scientist Benjamin Franklin,",
            "and by convention the charge on a glass rod is",
            "called positive while that on a plastic rod is termed",
            "negative. An object that possesses an electric charge",
            "is said to be electrified; with no charge it is neutral.",
        ]
        y = 150
        for index in range(4):
            for line in sentences:
                page.insert_text((70, y), line, fontsize=9)
                y += 15
        regions = textbook_fallback_regions(page, 1)
        self.assertEqual([r for r in regions if r["origin"] == "borderless_text_table"], [])
        doc.close()
