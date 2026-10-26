"""Songs: global songs (for everyone) and each user's own songs, with search.

Revision ID: 0002_songs
Revises: 0001_accounts
Create Date: 2026-10-26
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0002_songs"
down_revision = "0001_accounts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Trigram index: fast "contains" search on titles, in any script (Sinhala too).
    op.execute("create extension if not exists pg_trgm")
    op.create_table(
        "songs",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("scope", sa.String(10), nullable=False),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("artist", sa.String(120), nullable=True),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("difficulty", sa.String(12), nullable=True),
        sa.Column("tuning_id", sa.String(20), nullable=False),
        sa.Column("source_text", sa.Text(), nullable=True),
        sa.Column("notes", JSONB(), nullable=False),
        sa.Column("note_count", sa.Integer(), nullable=False),
        sa.Column("chord_count", sa.Integer(), nullable=False),
        sa.Column("search_text", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("scope in ('global', 'private')", name="songs_scope_valid"),
        sa.CheckConstraint(
            "(scope = 'global' and owner_id is null) or (scope = 'private' and owner_id is not null)",
            name="songs_owner_matches_scope",
        ),
        sa.CheckConstraint("difficulty is null or difficulty in ('beginner', 'intermediate', 'advanced')", name="songs_difficulty_valid"),
    )
    op.create_index("ix_songs_owner_id", "songs", ["owner_id"])
    op.create_index("ix_songs_scope", "songs", ["scope"])
    op.execute("create index ix_songs_search_trgm on songs using gin (search_text gin_trgm_ops)")
    op.create_table(
        "seed_log",
        sa.Column("song_id", sa.String(64), primary_key=True),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("seed_log")
    op.execute("drop index if exists ix_songs_search_trgm")
    op.drop_index("ix_songs_scope", table_name="songs")
    op.drop_index("ix_songs_owner_id", table_name="songs")
    op.drop_table("songs")
