"""Create the first administrator. Idempotent: exits quietly if the email
already exists. The account is created with must_change_password=True so the
first login forces a real password, exactly like any user created through
the admin API."""
from django.core.management.base import BaseCommand

from accounts.models import User
from accounts.services.users import NewUser, create_user


class Command(BaseCommand):
    help = "Create the initial admin account (idempotent)."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--full-name", default="Administrator")
        parser.add_argument("--password", help="Optional explicit password; if omitted the configured INITIAL_USER_PASSWORD is used and a change is forced at first login.")

    def handle(self, *args, **opts):
        email = opts["email"].strip().lower()
        if User.objects.filter(email=email).exists():
            self.stdout.write(f"Admin {email} already exists; nothing to do.")
            return
        user = create_user(None, NewUser(email=email, full_name=opts["full_name"], role="admin"))
        if opts.get("password"):
            user.set_password(opts["password"])
            user.must_change_password = False
            user.save(update_fields=["password", "must_change_password"])
        self.stdout.write(self.style.SUCCESS(f"Created admin {email} (must_change_password={user.must_change_password})."))
        issued = getattr(user, "issued_password", None)
        if issued and not opts.get("password"):
            # Unique mode: this is the only place the first admin's password
            # appears. It works once and must be changed at first login.
            self.stdout.write(f"One-time password for {email}: {issued}")
