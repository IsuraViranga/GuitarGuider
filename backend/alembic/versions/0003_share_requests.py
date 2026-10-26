"""Share requests: a user asks for their song to go into the global set list; the admin reviews.

Revision ID: 0003_share_requests
Revises: 0002_songs
Create Date: 2026-10-27
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0003_share_requests"
down_revision = "0002_songs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "share_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("song_id", sa.String(64), sa.ForeignKey("songs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("requester_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="pending"),
        sa.Column("snapshot", JSONB(), nullable=False),
        sa.Column("reason", sa.String(500), nullable=True),
        sa.Column("reviewed_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("global_song_id", sa.String(64), sa.ForeignKey("songs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status in ('pending', 'approved', 'rejected')", name="share_requests_status_valid"),
    )
    op.create_index("ix_share_requests_song_id", "share_requests", ["song_id"])
    op.create_index("ix_share_requests_requester_id", "share_requests", ["requester_id"])
    # At most one waiting request per song.
    op.execute("create unique index ux_share_requests_one_pending on share_requests (song_id) where status = 'pending'")


def downgrade() -> None:
    op.drop_table("share_requests")
