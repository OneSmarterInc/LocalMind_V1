import tempfile
from pathlib import Path

from django.test import SimpleTestCase

from .services import visuals
from .services import pdf_visual_regions
from .services import pdf_visual_sanitizer
from .services import visual_quality


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
    def test_coloured_texture_is_not_a_navigation_qr_code(self):
        import random
        from PIL import Image
        image = Image.frombytes('RGB', (192, 192), random.Random(42).randbytes(192 * 192 * 3))
        self.assertFalse(visual_quality.looks_like_qr_image(image))

    def test_rejects_near_full_page_region(self):
        page = RectStub(0, 0, 600, 800)
        near_page = RectStub(10, 10, 590, 790)
        self.assertFalse(visuals._valid_region(near_page, page))

    def test_accepts_normal_figure_region(self):
        page = RectStub(0, 0, 600, 800)
        figure = RectStub(80, 120, 430, 390)
        self.assertTrue(visuals._valid_region(figure, page))

    def test_rejects_header_and_footer_furniture(self):
        page = RectStub(0, 0, 600, 800)
        header = RectStub(80, 20, 420, 100)
        body = RectStub(80, 220, 420, 420)
        footer = RectStub(80, 730, 420, 780)
        self.assertTrue(pdf_visual_regions.is_page_furniture(header, page))
        self.assertFalse(pdf_visual_regions.is_page_furniture(body, page))
        self.assertTrue(pdf_visual_regions.is_page_furniture(footer, page))

    def test_activity_and_question_titles_are_not_figure_captions(self):
        self.assertEqual(pdf_visual_regions.source_caption_line("Activity 5.1"), "")
        self.assertEqual(pdf_visual_regions.source_caption_line("QUESTIONS"), "")
        self.assertEqual(pdf_visual_regions.source_caption_line("More to Know!"), "")
        self.assertEqual(pdf_visual_regions.source_caption_line("Example 1.4"), "")

    def test_explicit_textbook_figure_and_table_captions_are_recognised(self):
        self.assertEqual(
            pdf_visual_regions.source_caption_line("Figure 5.9 Human respiratory system"),
            "Figure 5.9 Human respiratory system",
        )
        self.assertEqual(
            pdf_visual_regions.source_caption_line("FIGURE 1.14 Field lines due to charges"),
            "FIGURE 1.14 Field lines due to charges",
        )
        self.assertEqual(
            pdf_visual_regions.source_caption_line("Table 4.2 - What would count as success?"),
            "Table 4.2 - What would count as success?",
        )

    def test_deduplication_prefers_table_over_overlapping_generic_diagram(self):
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

    def test_large_coloured_prose_panel_is_not_emitted_as_visual(self):
        try:
            import pymupdf
        except ImportError:
            self.skipTest("PyMuPDF is not installed")

        doc = pymupdf.open()
        page = doc.new_page(width=600, height=800)
        page.draw_rect(pymupdf.Rect(70, 180, 530, 500), fill=(0.85, 0.9, 1.0), color=(0.2, 0.3, 0.7))
        y = 220
        for line in (
            "Activity 5.1",
            "Take a specimen and observe it carefully.",
            "Record your result and answer the questions.",
            "This is prose content, not an instructional figure.",
        ):
            page.insert_text((95, y), line)
            y += 45
        regions = pdf_visual_regions.pdf_regions(page, 1)
        doc.close()
        self.assertEqual(regions, [])

    def test_why_this_is_happening_callout_is_removed_by_common_sanitizer(self):
        try:
            import pymupdf
        except ImportError:
            self.skipTest("PyMuPDF is not installed")
        doc = pymupdf.open()
        page = doc.new_page(width=600, height=800)
        panel = pymupdf.Rect(80, 210, 520, 410)
        page.draw_rect(panel, fill=(0.92, 0.95, 1.0), color=(0.3, 0.4, 0.8))
        page.insert_text((105, 245), "Why this is happening")
        page.insert_text((105, 285), "This is explanatory prose rather than a chart or figure.")
        rows = pdf_visual_sanitizer.pdf_regions(page, 1)
        doc.close()
        self.assertFalse(any(r["rect"].intersects(panel) for r in rows))

    def test_qr_like_raster_is_rejected(self):
        from PIL import Image, ImageDraw
        image = Image.new("RGB", (210, 210), "white")
        draw = ImageDraw.Draw(image)
        def finder(x, y):
            draw.rectangle((x, y, x+70, y+70), fill="black")
            draw.rectangle((x+10, y+10, x+60, y+60), fill="white")
            draw.rectangle((x+20, y+20, x+50, y+50), fill="black")
        finder(10, 10); finder(130, 10); finder(10, 130)
        # Add a little QR-like data texture so the black ratio is realistic.
        for y in range(90, 200, 12):
            for x in range(90, 200, 12):
                if (x//12 + y//12) % 2:
                    draw.rectangle((x, y, x+7, y+7), fill="black")
        self.assertTrue(visual_quality.looks_like_qr_image(image))

    def test_repeated_position_furniture_is_removed_even_when_bytes_differ(self):
        rows = []
        for page in range(1, 6):
            rows.append({"page": page, "digest": f"different-{page}", "caption_origin": "label",
                         "bbox": [20, 735, 100, 785], "page_size": [600, 800],
                         "layout_furniture_candidate": True, "margin_art": False})
        self.assertEqual(visuals.filter_repeated_furniture(rows), [])


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

    def test_private_parser_uses_same_qr_and_instructional_filters(self):
        repo = Path(__file__).resolve().parents[2]
        parser = (repo / "frontend" / "scripts" / "parser-entry.mjs").read_text(encoding="utf-8")
        self.assertIn("looksLikeQrCanvas", parser)
        self.assertIn("shouldKeepPdfVisual", parser)


class PrivateVectorDetectionContractTests(SimpleTestCase):
    """The private parser must read drawing operators, not page pixels.

    Pixel clustering cannot tell a publisher's watermark stencil or a pale
    banner from line art, which is how page furniture reached the reader.
    """

    def layout(self):
        return (Path(__file__).resolve().parents[2] / "frontend" / "scripts" / "pdf-layout.mjs").read_text(encoding="utf-8")

    def test_layout_module_exposes_the_drawing_operator_detector(self):
        source = self.layout()
        for symbol in ("export function drawingRectangles", "export function visualRegions", "export function captionLines"):
            self.assertIn(symbol, source)

    def test_parser_prefers_vector_regions_and_keeps_raster_only_for_scans(self):
        parser = (Path(__file__).resolve().parents[2] / "frontend" / "scripts" / "parser-entry.mjs").read_text(encoding="utf-8")
        self.assertIn("visualRegions({ops", parser)
        self.assertIn("needsOCR?[]:visualRegions", parser)

    def test_raster_fallback_measures_luminance_so_pale_tints_are_not_ink(self):
        source = self.layout()
        self.assertIn("0.299+", source.replace(" ", ""))
        self.assertNotIn("<720", source.replace(" ", ""))

    def test_policy_rejects_a_text_heavy_crop_even_when_captioned(self):
        policy = (Path(__file__).resolve().parents[2] / "frontend" / "scripts" / "picture-context.mjs").read_text(encoding="utf-8")
        compact = policy.replace(" ", "").replace("\n", "")
        self.assertIn("if(!tableLike&&ratio>=.24&&chars>=260)returnfalse;", compact)
        self.assertIn("if(!tableLike&&ratio>=.14&&chars>=520)returnfalse;", compact)
