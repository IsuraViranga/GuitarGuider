"""Guitar setup for the string check: one per user.

Revision ID: 0006_string_setups
Revises: 0005_password_resets
Create Date: 2026-10-29
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0006_string_setups"
down_revision = "0005_password_resets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "string_setups",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("open", JSONB(), nullable=False),
        sa.Column("misfit", JSONB(), nullable=False),
        sa.Column("saved_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("string_setups")
