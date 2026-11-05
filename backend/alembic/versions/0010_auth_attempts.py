"""Sign-in and reset limits kept in the database (shared by every server process).

Revision ID: 0010_auth_attempts
Revises: 0009_player_guitars
Create Date: 2026-11-05
"""

import sqlalchemy as sa
from alembic import op

revision = "0010_auth_attempts"
down_revision = "0009_player_guitars"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "auth_attempts",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("key", sa.String(320), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_auth_attempts_key_at", "auth_attempts", ["key", "at"])


def downgrade() -> None:
    op.drop_index("ix_auth_attempts_key_at", table_name="auth_attempts")
    op.drop_table("auth_attempts")
