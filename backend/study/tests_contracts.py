"""Real cryptographic and raster checks; no Django, server or language model."""
import base64
import io
import unittest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from PIL import Image, PngImagePlugin
from . import contracts as c

class ContractTests(unittest.TestCase):
    def setUp(self):
        self.key = Ed25519PrivateKey.generate()
        self.public = base64.b64encode(self.key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
        self.payload = {"format": c.FORMAT, "title": "Logic → café", "version": 1}
    def test_real_signature_round_trip(self):
        e = c.sign_payload(self.payload, self.key, "publisher")
        self.assertEqual(c.verify_envelope(e, {"publisher": self.public}), self.payload)
    def test_tampering_rejected(self):
        e = c.sign_payload(self.payload, self.key, "publisher"); e["payload"] += " "
        with self.assertRaises(InvalidSignature): c.verify_envelope(e, {"publisher": self.public})
    def test_unknown_key_rejected(self):
        with self.assertRaises(ValueError): c.verify_envelope(c.sign_payload(self.payload, self.key, "unknown"), {"publisher": self.public})
    def test_wrong_key_rejected(self):
        other = Ed25519PrivateKey.generate()
        with self.assertRaises(InvalidSignature): c.verify_envelope(c.sign_payload(self.payload, other, "publisher"), {"publisher": self.public})
    def test_unsigned_additional_fields_rejected(self):
        e=c.sign_payload(self.payload,self.key,"publisher");e["public_key"]=self.public
        with self.assertRaises(ValueError):c.verify_envelope(e,{"publisher":self.public})
    def test_policy_has_exact_moves(self):
        self.assertEqual(c.policy(c.default_policy()),c.default_policy())
        p=c.default_policy();p["question"][0]="invent_strategy"
        with self.assertRaises(ValueError):c.policy(p)
    def test_policy_duplicate_move_rejected(self):
        p=c.default_policy();p["question"][0]=p["question"][1]
        with self.assertRaises(ValueError):c.policy(p)
    def test_prose_splits_without_word_loss(self):
        text="A bounded source sentence. "*600
        parts=c.split_text(text)
        self.assertTrue(all(len(p)<=3500 for p in parts))
        self.assertEqual(" ".join(" ".join(parts).split())," ".join(text.split()))
    def test_table_preserved_as_typed_rows(self):
        blocks=c.blocks_from_markdown("| Term | Meaning |\n| --- | --- |\n| Key | Identifier |","Data")
        self.assertEqual(blocks[0]["kind"],"table")
        self.assertEqual(blocks[0]["data"]["rows"][1],["Key","Identifier"])
    def test_unequal_table_rejected(self):
        with self.assertRaises(ValueError):c.blocks_from_markdown("| A | B |\n| One |", "Bad table")
    def test_oversized_table_not_truncated(self):
        with self.assertRaises(ValueError):c.blocks_from_markdown("| "+("a"*4000)+" |\n| b |","Large")
    def test_image_is_normalized_without_metadata(self):
        src=io.BytesIO();meta=PngImagePlugin.PngInfo();meta.add_text("Author","private metadata")
        Image.new("RGB",(12,8)).save(src,"PNG",pnginfo=meta)
        clean=c.png_bytes(src.getvalue())
        im=Image.open(io.BytesIO(clean));self.assertNotIn("Author",im.info);self.assertEqual(im.size,(12,8))
    def test_svg_is_not_accepted(self):
        with self.assertRaises((ValueError,OSError)):c.png_bytes(b'<svg><script>bad()</script></svg>')
    def test_dimension_limit(self):
        src=io.BytesIO();Image.new("RGB",(4097,1)).save(src,"PNG")
        with self.assertRaises(ValueError):c.png_bytes(src.getvalue())
    def test_question_requires_real_option_key(self):
        q={"type":"mcq","prompt":"What is a key?","quote":"An identifier","options":["Identifier","Table","Row","Query"],"answer":True}
        with self.assertRaises(ValueError):c.validate_question(q)
    def test_question_rejects_empty_rubric(self):
        with self.assertRaises(ValueError):c.validate_question({"type":"short","prompt":"Explain a key","quote":"An identifier","rubric":[]})
    def test_question_cannot_carry_user_metadata(self):
        with self.assertRaises(ValueError):c.validate_question({"type":"short","prompt":"Explain a key","quote":"An identifier","rubric":["Identifier"],"student_id":"abc"})
    def test_nan_is_not_canonical_json(self):
        with self.assertRaises(ValueError):c.canonical({"value":float("nan")})
