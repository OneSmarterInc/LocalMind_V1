"""Authoring/review/publication/security integration; real database and Ed25519."""
import base64
import io
import json
import tempfile
import uuid
from pathlib import Path
from unittest.mock import patch
from django.test import TestCase, override_settings
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from PIL import Image
from core.exceptions import Conflict, Forbidden, ValidationFailed
from core.testing import make_admin, make_faculty, make_student, make_subject, assign, make_published_document, client_for
from learning.models import Module
from . import contracts as c, services as s, observations as o
from .models import ContentBlock, BlockRevision, StudyPackage, StudyQuestion, AuthoringState, Observation

class StudyTests(TestCase):
    def setUp(self):
        self.admin=make_admin();self.faculty=make_faculty();self.student=make_student();self.other=make_faculty()
        self.subject=make_subject();assign(self.faculty,self.subject)
        self.doc=make_published_document(self.subject,modules=(("Keys","A primary key uniquely identifies each row.\n\nA foreign key references another table."),))
        self.module=Module.objects.get(chapter__document=self.doc)
        s.sync_source(self.faculty,self.doc)
        self.b=ContentBlock.objects.filter(module=self.module).order_by("position").first()
        self.ref=[{"id":str(self.b.id),"revision":1}]
        self.body={"type":"mcq","prompt":"What does a primary key identify?","options":["Each row","The screen","A file folder","The author"],"answer":0,"explanation":"It uniquely identifies a row.","quote":"uniquely identifies each row"}
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        key=Ed25519PrivateKey.generate();self.keypath=Path(self.tmp.name)/"publisher.pem"
        self.keypath.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
        self.public=base64.b64encode(key.public_key().public_bytes(serialization.Encoding.Raw,serialization.PublicFormat.Raw)).decode()
        cfg=override_settings(STUDY_SIGNING_KEY_PATH=str(self.keypath),STUDY_SIGNING_KEY_ID="test-publisher",MEDIA_ROOT=self.tmp.name)
        cfg.enable();self.addCleanup(cfg.disable)
    def approved(self):
        q=s.save_question(self.faculty,self.doc,self.body,self.ref);s.approve_question(self.faculty,q,s.question_digest(q));return q
    def published(self):
        self.approved();return s.publish_package(self.faculty,self.doc)
    def event(self,p):
        return {"id":str(uuid.uuid4()),"package_id":str(self.doc.id),"version":p.version,"block_id":str(self.b.id),"block_revision":1,"question_id":None,"state":"question","move":"reteach","outcome":"retry_succeeded"}
    def test_source_resync_retains_stable_ids(self):
        before=list(ContentBlock.objects.values_list("id",flat=True));self.assertTrue(s.sync_source(self.faculty,self.doc)["unchanged"])
        self.assertEqual(before,list(ContentBlock.objects.values_list("id",flat=True)))
    def test_reparse_keeps_unchanged_and_retires_changed_block(self):
        unchanged=ContentBlock.objects.get(module=self.module,position=1)
        self.module.source_text="A changed introduction.\n\nA foreign key references another table.";self.module.save()
        report=s.sync_source(self.faculty,self.doc);self.assertEqual(report["retired"],1)
        unchanged.refresh_from_db();self.assertTrue(unchanged.active);self.b.refresh_from_db();self.assertFalse(self.b.active)
    def test_author_edit_creates_immutable_revision(self):
        old=s._revision(self.b).text
        b=s.save_block(self.faculty,self.doc,self.module.id,{"kind":"prose","title":"Keys","text":old+" It cannot be duplicated.","data":{}},self.b.id,1)
        self.assertEqual(b.current_revision,2);self.assertEqual(BlockRevision.objects.get(block=b,revision=1).text,old)
    def test_stale_block_edit_rejected(self):
        with self.assertRaises(Conflict):s.save_block(self.faculty,self.doc,self.module.id,{"kind":"prose","title":"Keys","text":"Changed","data":{}},self.b.id,9)
    def test_source_change_never_overwrites_authored_block(self):
        s.save_block(self.faculty,self.doc,self.module.id,{"kind":"prose","title":"Keys","text":"An authored definition.","data":{}},self.b.id,1)
        self.module.source_text="Changed classroom source";self.module.save()
        with self.assertRaises(Conflict):s.sync_source(self.faculty,self.doc)
    def test_question_requires_reference_quote(self):
        with self.assertRaises(ValidationFailed):s.save_question(self.faculty,self.doc,{**self.body,"quote":"not in this source"},self.ref)
    def test_approval_is_exact_question_digest(self):
        q=s.save_question(self.faculty,self.doc,self.body,self.ref)
        with self.assertRaises(Conflict):s.approve_question(self.faculty,q,"stale")
    def test_changed_block_invalidates_approval(self):
        self.approved();s.save_block(self.faculty,self.doc,self.module.id,{"kind":"prose","title":"Keys","text":"A primary key uniquely identifies each row. Revised.","data":{}},self.b.id,1)
        self.assertFalse(s.authoring_snapshot(self.doc)["questions"][0]["approved"])
        with self.assertRaises(ValueError):s.publish_package(self.faculty,self.doc)
    def test_unapproved_bank_cannot_publish(self):
        s.save_question(self.faculty,self.doc,self.body,self.ref)
        with self.assertRaises(ValueError):s.publish_package(self.faculty,self.doc)
    def test_signing_key_is_explicit(self):
        self.approved()
        with override_settings(STUDY_SIGNING_KEY_PATH=""):
            with self.assertRaises(Conflict):s.publish_package(self.faculty,self.doc)
    def test_package_verifies_and_contains_no_student_records(self):
        p=self.published();payload=c.verify_envelope(json.loads(p.envelope),{"test-publisher":self.public})
        self.assertEqual(payload["blocks"][0]["revision"],1)
        for secret in (self.student.email,"submitted_answers","student_id","password","learner"):
            self.assertNotIn(secret,p.envelope)
    def test_publishing_new_version_does_not_change_old(self):
        first=self.published();raw=first.envelope;second=s.publish_package(self.faculty,self.doc)
        first.refresh_from_db();self.assertEqual(first.envelope,raw);self.assertEqual(second.version,2)
    def test_removed_question_stays_in_published_snapshot(self):
        p=self.published();q=StudyQuestion.objects.get(document=self.doc);s.remove_question(self.doc,q.id)
        self.assertEqual(len(json.loads(json.loads(p.envelope)["payload"])["questions"]),1)
    def test_student_cannot_author(self):
        res=client_for(self.student).get(f"/api/study/authoring/{self.doc.id}/");self.assertEqual(res.status_code,403)
    def test_unassigned_faculty_cannot_author(self):
        res=client_for(self.other).get(f"/api/study/authoring/{self.doc.id}/");self.assertEqual(res.status_code,403)
    def test_publication_is_explicitly_public_content(self):
        p=self.published();res=client_for().get(f"/api/study/packages/{self.doc.id}/{p.version}/")
        self.assertEqual(res.status_code,200);self.assertEqual(res.content.decode(),p.envelope)
    def test_publish_requires_review_confirmation(self):
        self.approved();res=client_for(self.faculty).post(f"/api/study/authoring/{self.doc.id}/",{"action":"publish"},format="json")
        self.assertEqual(res.status_code,400);self.assertFalse(StudyPackage.objects.exists())
    def test_bad_request_shape_is_400(self):
        res=client_for(self.faculty).post(f"/api/study/authoring/{self.doc.id}/",{"action":"save_block","data":None},format="json")
        self.assertEqual(res.status_code,400)
    def test_cross_book_references_refused(self):
        other=make_published_document(self.subject,title="Other");s.sync_source(self.faculty,other)
        b=ContentBlock.objects.filter(module__chapter__document=other).first()
        with self.assertRaises(ValueError):s.save_question(self.faculty,self.doc,self.body,[{"id":str(b.id),"revision":1}])
    def test_cyclic_prerequisites_block_publication(self):
        self.approved();other=ContentBlock.objects.get(module=self.module,position=1)
        for b,target in ((self.b,other),(other,self.b)):
            s.save_aid(self.faculty,self.doc,b.id,{"revision":1,"simpler_text":"","examples":[],"diagnostics":[],"prerequisites":[{"id":str(target.id),"revision":1}]})
        with self.assertRaises(ValueError):s.publish_package(self.faculty,self.doc)
    def test_diagnostic_changes_invalidate_teaching_aid(self):
        q=self.approved();s.save_aid(self.faculty,self.doc,self.b.id,{"revision":1,"simpler_text":"","examples":[],"diagnostics":[str(q.id)],"prerequisites":[]})
        q=s.save_question(self.faculty,self.doc,{**self.body,"prompt":"What is uniquely identified?"},self.ref,q.id)
        s.approve_question(self.faculty,q,s.question_digest(q))
        with self.assertRaises(ValueError):s.publish_package(self.faculty,self.doc)
    def test_figure_bytes_are_embedded_and_hash_checked(self):
        self.approved();out=io.BytesIO();Image.new("RGB",(10,10)).save(out,"PNG")
        a=s.add_asset(self.doc,out.getvalue())
        s.save_block(self.faculty,self.doc,self.module.id,{"kind":"figure","title":"Relation diagram","text":"The arrow links a foreign key to the referenced table.","data":{"asset_id":str(a.id),"alt":"Two related tables"}})
        payload=s.payload_for(self.doc,1);self.assertTrue(any(b["kind"]=="figure" and b["data"]["png_base64"] for b in payload["blocks"]))
        Path(a.file.path).write_bytes(b"altered")
        with self.assertRaises(ValueError):s.payload_for(self.doc,1)
    def test_observations_off_by_default(self):
        with override_settings(STUDY_OBSERVATIONS_ENABLED=False):
            self.assertEqual(client_for().post("/api/study/observations/",{"events":[]},format="json").status_code,404)
    def test_observation_retry_is_idempotent(self):
        p=self.published();e=self.event(p);o.accept_batch([e]);o.accept_batch([e]);self.assertEqual(Observation.objects.count(),1)
    def test_reused_event_id_cannot_change_meaning(self):
        p=self.published();e=self.event(p);o.accept_batch([e])
        with self.assertRaises(ValueError):o.accept_batch([{**e,"outcome":"retry_needed"}])
    def test_observation_rejects_raw_text_and_learner_fields(self):
        p=self.published();e=self.event(p)
        for field in ("student_id","question","answer","score","learner","device_id"):
            with self.assertRaises(ValueError):o.accept_batch([{**e,field:"private"}])
        self.assertFalse(Observation.objects.exists())
    def test_batch_validation_is_atomic(self):
        p=self.published();good=self.event(p);bad={**self.event(p),"version":999}
        with self.assertRaises(ValueError):o.accept_batch([good,bad])
        self.assertFalse(Observation.objects.exists())
    def test_small_aggregates_are_withheld(self):
        p=self.published();o.accept_batch([self.event(p) for _ in range(4)]);self.assertEqual(o.aggregate(self.doc),[])
        o.accept_batch([self.event(p)]);self.assertEqual(o.aggregate(self.doc)[0]["events"],5)
    def test_explicit_source_review_detects_further_changes(self):
        with self.assertRaises(Conflict):s.accept_source_review(self.doc,"old-source-hash")
    def test_retirement_preserves_revision_history(self):
        s.retire_block(self.doc,self.b.id,1);self.assertTrue(BlockRevision.objects.filter(block=self.b).exists());self.b.refresh_from_db();self.assertFalse(self.b.active)
