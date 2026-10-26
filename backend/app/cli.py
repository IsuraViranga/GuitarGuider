"""Admin tasks from the command line. Admin accounts are never created through the website.

    python -m app.cli create-admin --email you@example.com --name "Melantha"
    python -m app.cli seed-songs        # add built-in songs to the global set list (run on deploy)

The password is asked twice (not shown). For automation, put it in an environment variable and
pass --password-env NAME. An existing account with that email is made admin (password unchanged
unless a new one is given).
"""

import argparse
import getpass
import os
import sys

from pydantic import ValidationError
from sqlalchemy import select

from .db import SessionLocal
from .models import User
from .schemas import SignUpIn
from .security import hash_password
from .seed import seed_global_songs


def create_admin(email: str, name: str, password: str | None) -> str:
    # The same checks as sign-up (valid email, name, password length).
    checked = SignUpIn(name=name, email=email, password=password or "placeholder-ok")
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == checked.email))
        if user is None:
            if not password:
                raise ValueError("A password is needed for a new account.")
            db.add(User(email=checked.email, display_name=checked.name, password_hash=hash_password(password), role="admin"))
            result = f"Created admin account {checked.email}."
        else:
            user.role = "admin"
            if password:
                user.password_hash = hash_password(password)
            result = f"{checked.email} is now an admin."
        db.commit()
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    admin = sub.add_parser("create-admin", help="create an admin account, or make an existing account admin")
    admin.add_argument("--email", required=True)
    admin.add_argument("--name", required=True)
    admin.add_argument("--password-env", help="read the password from this environment variable instead of asking")
    admin.add_argument("--keep-password", action="store_true", help="existing account: keep its password")
    sub.add_parser("seed-songs", help="add built-in songs to the global set list (each only once)")
    args = parser.parse_args(argv)

    if args.command == "seed-songs":
        with SessionLocal() as db:
            added = seed_global_songs(db)
        print(f"Added {len(added)} built-in song(s) to the global set list." if added else "Built-in songs are up to date.")
        return 0

    password: str | None
    if args.keep_password:
        password = None
    elif args.password_env:
        password = os.environ.get(args.password_env)
        if not password:
            print(f"Environment variable {args.password_env} is empty.", file=sys.stderr)
            return 1
    else:
        password = getpass.getpass("New password: ")
        if password != getpass.getpass("Repeat password: "):
            print("The passwords do not match.", file=sys.stderr)
            return 1
    try:
        print(create_admin(args.email, args.name, password))
    except ValidationError as error:
        print(error.errors()[0]["msg"].removeprefix("Value error, "), file=sys.stderr)
        return 1
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
