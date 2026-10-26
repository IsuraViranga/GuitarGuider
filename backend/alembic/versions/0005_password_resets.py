"""Password reset links ("forgot password").

Revision ID: 0005_password_resets
Revises: 0004_practice_saves
Create Date: 2026-10-27
"""

import sqlalchemy as sa
from alembic import op

revision = "0005_password_resets"
down_revision = "0004_practice_saves"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "password_resets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_password_resets_user_id", "password_resets", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_password_resets_user_id", table_name="password_resets")
    op.drop_table("password_resets")
