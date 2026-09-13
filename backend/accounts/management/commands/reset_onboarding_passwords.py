"""Put accounts that have not set their own password back on the shared initial password.

    python manage.py reset_onboarding_passwords --dry-run        # list who would change
    python manage.py reset_onboarding_passwords                  # every account still on an onboarding password
    python manage.py reset_onboarding_passwords --email a@b.edu  # one account

For accounts created or imported while INITIAL_PASSWORD_MODE=unique was in
effect, whose one-time passwords were never handed out. Only accounts that
still have to change their password at first login are touched: nobody who has
chosen a password of their own is affected. Each reset is audited and signs the
account out everywhere.
"""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from accounts.models import User
from accounts.services.users import _revoke_all_tokens
from audit import services as audit


class Command(BaseCommand):
    help = "Reset accounts still on an onboarding password to INITIAL_USER_PASSWORD."

    def add_arguments(self, parser):
        parser.add_argument("--email", help="Only this account.")
        parser.add_argument("--dry-run", action="store_true", help="List the accounts without changing anything.")

    def handle(self, *args, **opts):
        shared = settings.LOCALMIND["INITIAL_USER_PASSWORD"]
        accounts = User.objects.filter(must_change_password=True).order_by("role", "email")
        if opts["email"]:
            accounts = accounts.filter(email=opts["email"].strip().lower())
            if not accounts.exists():
                raise CommandError("No account with that email still has to change its password.")
        changed = already = 0
        for user in accounts:
            if user.check_password(shared):
                already += 1
                continue
            self.stdout.write(f"{'would reset' if opts['dry_run'] else 'reset'}: {user.email} ({user.role})")
            if opts["dry_run"]:
                changed += 1
                continue
            user.set_password(shared)
            user.save(update_fields=["password", "updated_at"])
            _revoke_all_tokens(user)
            audit.record(None, "user.password_reset_to_shared", user, {"source": "reset_onboarding_passwords"})
            changed += 1
        verb = "Would reset" if opts["dry_run"] else "Reset"
        self.stdout.write(self.style.SUCCESS(f"{verb} {changed} account(s); {already} already on the initial password."))
