"""Saved practice: one saved practice per user and song.

Revision ID: 0004_practice_saves
Revises: 0003_share_requests
Create Date: 2026-10-27
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0004_practice_saves"
down_revision = "0003_share_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "practice_saves",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("song_id", sa.String(64), sa.ForeignKey("songs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mode", sa.String(10), nullable=False),
        sa.Column("completed", sa.Boolean(), nullable=False),
        sa.Column("right_count", sa.Integer(), nullable=False),
        sa.Column("wrong_count", sa.Integer(), nullable=False),
        sa.Column("best_streak", sa.Integer(), nullable=False),
        sa.Column("skipped_count", sa.Integer(), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=True),
        sa.Column("record", JSONB(), nullable=False),
        sa.Column("saved_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "song_id", name="practice_saves_one_per_song"),
        sa.CheckConstraint("mode in ('strict', 'flow')", name="practice_saves_mode_valid"),
        sa.CheckConstraint("rating is null or rating between 1 and 3", name="practice_saves_rating_valid"),
    )
    op.create_index("ix_practice_saves_user_id", "practice_saves", ["user_id"])
    op.create_index("ix_practice_saves_song_id", "practice_saves", ["song_id"])


def downgrade() -> None:
    op.drop_table("practice_saves")
