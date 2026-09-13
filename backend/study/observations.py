"""Strict flag-only research payload. No raw answers, prompts, grades, user or device ids."""
import json
from django.conf import settings
from django.db import transaction
from django.db.models import Count
from core.exceptions import Conflict, ValidationFailed
from . import contracts as c
from .models import Observation, StudyPackage

FIELDS = {"id", "package_id", "version", "block_id", "block_revision", "question_id", "state", "move", "outcome"}


@transaction.atomic
def accept_batch(items):
    c.require(isinstance(items, list) and 1 <= len(items) <= 50, "Send 1-50 observation events")
    prepared = []
    for item in items:
        c.require(isinstance(item, dict) and set(item) == FIELDS, "Only the documented flag-only event fields are accepted")
        for field in ("id", "package_id", "block_id"): c.identifier(item[field])
        if item["question_id"] is not None: c.identifier(item["question_id"])
        c.require(type(item["version"]) is int and item["version"] > 0 and type(item["block_revision"]) is int and item["block_revision"] > 0, "Invalid package/block version")
        c.require(item["state"] in c.STATES and item["move"] in c.MOVES and item["outcome"] in c.OUTCOMES, "Unknown observation category")
        package = StudyPackage.objects.filter(document_id=item["package_id"], version=item["version"]).first()
        c.require(package is not None, "Unknown published package")
        payload = json.loads(json.loads(package.envelope)["payload"])
        block = next((b for b in payload["blocks"] if b["id"] == item["block_id"] and b["revision"] == item["block_revision"]), None)
        c.require(block is not None, "Block does not belong to this package revision")
        if item["question_id"]:
            question = next((q for q in payload["questions"] if q["id"] == item["question_id"]), None)
            c.require(question is not None and any(r["id"] == block["id"] for r in question["references"]), "Question is not associated with the block")
        data = {k: item[k] for k in ("block_id", "block_revision", "question_id", "state", "move", "outcome")}
        prepared.append((item["id"], package, data))
    accepted = []
    for event_id, package, data in prepared:
        existing = Observation.objects.filter(pk=event_id).first()
        if existing:
            c.require(existing.package_id == package.id and all(str(getattr(existing, k)) == str(v) for k, v in data.items()), "Event id reused with different content")
        else:
            Observation.objects.create(id=event_id, package=package, **data)
        accepted.append(event_id)
    return accepted


def aggregate(document):
    # Counts are events, not distinct people. Small cells are withheld, which is
    # an additional disclosure precaution, not a proof of anonymity.
    minimum = max(5, int(getattr(settings, "STUDY_MIN_AGGREGATE_EVENTS", 5)))
    rows = Observation.objects.filter(package__document=document).values("package__version", "block_id", "state", "move", "outcome").annotate(events=Count("id")).filter(events__gte=minimum).order_by("-events", "package__version", "block_id", "state", "move", "outcome")[:100]
    return [{"version": r["package__version"], "block_id": str(r["block_id"]), "state": r["state"], "move": r["move"], "outcome": r["outcome"], "events": r["events"]} for r in rows]
