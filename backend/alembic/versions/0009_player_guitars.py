"""Guitar recordings for every signed-in player: each guitar has an owner, one guitar can be the
default for players, and each sample keeps its own sound-match fingerprint (made in the browser
when it is recorded), moved here from the guitar.

Revision ID: 0009_player_guitars
Revises: 0008_dataset_fingerprints
Create Date: 2026-11-02
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0009_player_guitars"
down_revision = "0008_dataset_fingerprints"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("dataset_guitars", sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")))
    op.add_column("dataset_guitars", sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("dataset_samples", sa.Column("fingerprint", JSONB()))
    # Existing guitars belong to whoever recorded them (the admin).
    op.execute("update dataset_guitars g set owner_id = (select s.recorded_by from dataset_samples s where s.guitar_id = g.id and s.recorded_by is not null limit 1)")
    # Each prepared fingerprint moves to its sample.
    op.execute(
        "update dataset_samples s set fingerprint = f.item -> 'v' "
        "from dataset_guitars g, jsonb_array_elements(g.fingerprints) as f(item) "
        "where g.fingerprints is not null and s.guitar_id = g.id and s.id = (f.item ->> 'sampleId')::uuid"
    )
    op.drop_column("dataset_guitars", "fingerprints_at")
    op.drop_column("dataset_guitars", "fingerprints")
    # Names are unique per owner now (every player names their own guitars).
    op.drop_index("dataset_guitars_name_unique", table_name="dataset_guitars")
    op.create_index("dataset_guitars_owner_name_unique", "dataset_guitars", ["owner_id", sa.text("lower(name)")], unique=True)
    op.create_index("dataset_guitars_one_default", "dataset_guitars", ["is_default"], unique=True, postgresql_where=sa.text("is_default"))
    op.create_index("ix_dataset_guitars_owner_id", "dataset_guitars", ["owner_id"])


def downgrade() -> None:
    op.drop_index("ix_dataset_guitars_owner_id", table_name="dataset_guitars")
    op.drop_index("dataset_guitars_one_default", table_name="dataset_guitars")
    op.drop_index("dataset_guitars_owner_name_unique", table_name="dataset_guitars")
    op.create_index("dataset_guitars_name_unique", "dataset_guitars", [sa.text("lower(name)")], unique=True)
    op.add_column("dataset_guitars", sa.Column("fingerprints", JSONB()))
    op.add_column("dataset_guitars", sa.Column("fingerprints_at", sa.DateTime(timezone=True)))
    op.execute(
        "update dataset_guitars g set fingerprints = f.items, fingerprints_at = now() from ("
        "select guitar_id, jsonb_agg(jsonb_build_object('sampleId', id, 'stringNumber', string_number, 'fret', fret, 'v', fingerprint)) as items "
        "from dataset_samples where fingerprint is not null group by guitar_id) f where f.guitar_id = g.id"
    )
    op.drop_column("dataset_samples", "fingerprint")
    op.drop_column("dataset_guitars", "is_default")
    op.drop_column("dataset_guitars", "owner_id")
