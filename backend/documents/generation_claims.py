"""One device per login generates a book's lessons and quizzes.

The problem this solves: a faculty member signed in on a laptop and a phone at
the same time, opened the same book on both, and each device's local model
wrote its own lessons and quizzes. Both sets were then synchronized, so the
module ended up with two quizzes and whichever lesson happened to land first.

The rule is "the first device the server hears from owns the book":

- Online, a device asks for the claim before it generates. If another device of
  the same login already holds it, the answer is 409
  GENERATION_CLAIMED_ELSEWHERE and the screen says generation already started
  on that device.
- Offline, a device cannot ask, so it generates anyway and asks as soon as it
  reconnects. Whichever device reconnects first wins. The other is refused and
  keeps its drafts on the device without sending them.
- Every device-authored write (lesson, quiz, book) re-checks the claim, so
  nothing from a losing device reaches the institution even if its client is
  old or its reconnect ordering is wrong.

The claim is not released when a run ends: the owner may still hold drafts
waiting for review. It ends when the owner releases it, when the person takes
over from another device, or when the owner has not been heard from for
GENERATION_CLAIM_STALE_HOURS.
"""
import re
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.response import Response
from rest_framework.views import APIView

from core.exceptions import Conflict, ValidationFailed
from core.permissions import IsAdminOrFaculty
from core.utils import get_or_404

from .models import Document, GenerationClaim

DEVICE_HEADER = 'HTTP_X_LOCALMIND_DEVICE'
_DEVICE = re.compile(r'^[A-Za-z0-9-]{8,64}$')


def device_from(request):
    """The caller's stable install ID, or None for clients that do not send one."""
    value = (request.META.get(DEVICE_HEADER) or '').strip()
    return value if _DEVICE.fullmatch(value) else None


def _stale_after():
    hours = settings.LOCALMIND.get('GENERATION_CLAIM_STALE_HOURS', 24)
    return timedelta(hours=hours) if hours and hours > 0 else None


def is_stale(claim, now=None):
    window = _stale_after()
    return bool(window) and (now or timezone.now()) - claim.heartbeat_at > window


def describe(claim, device_id=None):
    if claim is None:
        return None
    return {'device_label': claim.device_label or 'Another device',
            'started_at': claim.started_at.isoformat(),
            'claimed_at': claim.created_at.isoformat(),
            'last_seen': claim.heartbeat_at.isoformat(),
            'mine': bool(device_id) and claim.device_id == device_id,
            'stale': is_stale(claim)}


def _started(value, now):
    """Client-reported start time: never in the future, never absurdly old."""
    if not value:
        return now
    parsed = parse_datetime(str(value)) if isinstance(value, str) else None
    if parsed is None:
        raise ValidationFailed('Invalid generation start time.')
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.utc)
    return min(max(parsed, now - timedelta(days=30)), now)


def _label(value):
    return value.strip()[:120] if isinstance(value, str) else ''


def label_from(request):
    """A name a person recognises, from the User-Agent: "Chrome on Windows", "Android app"."""
    agent = request.META.get('HTTP_USER_AGENT', '') if request is not None else ''
    if re.search(r'okhttp', agent, re.I):
        return 'Android app'
    if re.search(r'CFNetwork|Darwin', agent) and 'Mozilla' not in agent:
        return 'iPhone or iPad app'
    system = next((name for pattern, name in [(r'Android', 'Android'), (r'iPhone|iPad|iPod', 'iPhone or iPad'),
                                               (r'Windows', 'Windows'), (r'Mac OS X|Macintosh', 'Mac'),
                                               (r'CrOS', 'Chromebook'), (r'Linux', 'Linux')]
                   if re.search(pattern, agent)), '')
    browser = next((name for pattern, name in [(r'Edg/', 'Edge'), (r'Chrome/', 'Chrome'), (r'Firefox/', 'Firefox'),
                                                (r'Safari/', 'Safari')] if re.search(pattern, agent)), 'Browser')
    return f'{browser} on {system}' if system else ('Another device' if not agent else browser)


def claimed_elsewhere(claim, device_id):
    return Conflict(
        f'Generation for this book already started on another device ({claim.device_label or "another device"}). '
        'Continue there, or take over from this device.',
        code='GENERATION_CLAIMED_ELSEWHERE', details={'claim': describe(claim, device_id)})


def acquire(actor, document, device_id, *, label='', started_at=None, take_over=False, request=None):
    """Claim (or renew) generation for this device, or raise GENERATION_CLAIMED_ELSEWHERE.

    Callers must already hold a row lock that serializes writers for this
    document (the Document row); the view below takes it. Everything here runs
    in the caller's transaction.
    """
    if not device_id:
        raise ValidationFailed('This app version does not identify its device. Update LocalMind and try again.',
                               code='DEVICE_ID_REQUIRED')
    now = timezone.now()
    label = _label(label) or label_from(request)
    claim = GenerationClaim.objects.select_for_update().filter(actor=actor, document=document).first()
    if claim is None:
        claim = GenerationClaim.objects.create(actor=actor, document=document, device_id=device_id,
                                               device_label=_label(label), started_at=_started(started_at, now),
                                               heartbeat_at=now)
        return claim
    if claim.device_id == device_id:
        claim.heartbeat_at = now
        if _label(label):
            claim.device_label = _label(label)
        claim.save(update_fields=['heartbeat_at', 'device_label', 'updated_at'])
        return claim
    if not (take_over or is_stale(claim, now)):
        raise claimed_elsewhere(claim, device_id)
    previous = claim.device_label
    claim.device_id, claim.device_label = device_id, _label(label)
    claim.started_at, claim.heartbeat_at = _started(started_at, now), now
    claim.save()
    from audit import services as audit
    audit.record(actor, 'authoring.generation_taken_over', document,
                 {'from': previous, 'to': claim.device_label, 'stale': not take_over}, request)
    return claim


def enforce(request, document):
    """Gate for every device-authored write about ``document``.

    The first device to deliver work becomes the owner if nobody owns the book
    yet, which is how two devices that both generated offline are settled.
    """
    device = device_from(request)
    if device is None:
        # An app build from before claims existed. It may write while nobody
        # owns the book (nothing changes for single-device use), but it can
        # never write over a device that does.
        claim = GenerationClaim.objects.select_for_update().filter(actor=request.user, document=document).first()
        if claim and not is_stale(claim):
            raise claimed_elsewhere(claim, None)
        return claim
    return acquire(request.user, document, device, request=request)


class GenerationClaimView(APIView):
    """GET who owns generation for a book; POST to claim or renew; DELETE to release."""
    permission_classes = [IsAdminOrFaculty]

    def document(self, request, document_id, lock=False):
        rows = Document.objects.visible_to(request.user)
        doc = get_or_404(rows, pk=document_id)
        if lock:
            # Same lock single-module authoring takes, so a claim and a write
            # for the same book never interleave.
            Document.objects.select_for_update().get(pk=doc.pk)
        return doc

    def get(self, request, document_id):
        doc = self.document(request, document_id)
        claim = GenerationClaim.objects.filter(actor=request.user, document=doc).first()
        return Response({'claim': describe(claim, device_from(request))})

    @transaction.atomic
    def post(self, request, document_id):
        data = request.data if isinstance(request.data, dict) else {}
        doc = self.document(request, document_id, lock=True)
        device = device_from(request)
        claim = acquire(request.user, doc, device, label=data.get('device_label'),
                        started_at=data.get('started_at'), take_over=data.get('take_over') is True,
                        request=request)
        return Response({'claim': describe(claim, device)})

    @transaction.atomic
    def delete(self, request, document_id):
        doc = self.document(request, document_id, lock=True)
        device = device_from(request)
        claim = GenerationClaim.objects.select_for_update().filter(actor=request.user, document=doc).first()
        if claim and claim.device_id != device:
            raise claimed_elsewhere(claim, device)
        if claim:
            claim.delete()
        return Response(status=204)
