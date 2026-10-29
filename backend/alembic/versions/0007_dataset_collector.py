"""Dataset collector (admin only): guitars and recorded plucks. The audio is in file storage.

Revision ID: 0007_dataset_collector
Revises: 0006_string_setups
Create Date: 2026-10-30
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0007_dataset_collector"
down_revision = "0006_string_setups"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dataset_guitars",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("guitar_type", sa.String(12), nullable=False),
        sa.Column("string_material", sa.String(10), nullable=False),
        sa.Column("wound_strings", JSONB()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("guitar_type in ('acoustic', 'classical', 'electric', 'other')", name="dataset_guitars_type_valid"),
        sa.CheckConstraint("string_material in ('steel', 'nylon', 'unknown')", name="dataset_guitars_material_valid"),
    )
    op.create_index("dataset_guitars_name_unique", "dataset_guitars", [sa.text("lower(name)")], unique=True)
    op.create_table(
        "dataset_samples",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("guitar_id", sa.Uuid(), sa.ForeignKey("dataset_guitars.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("string_number", sa.Integer(), nullable=False),
        sa.Column("fret", sa.Integer(), nullable=False),
        sa.Column("expected_midi", sa.Integer(), nullable=False),
        sa.Column("expected_note", sa.String(4), nullable=False),
        sa.Column("expected_hz", sa.Float(), nullable=False),
        sa.Column("string_construction", sa.String(8), nullable=False),
        sa.Column("background_noise", sa.String(10), nullable=False),
        sa.Column("pluck_method", sa.String(8), nullable=False),
        sa.Column("pluck_strength", sa.String(8), nullable=False),
        sa.Column("device", sa.String(8)),
        sa.Column("notes", sa.Text()),
        sa.Column("audio_key", sa.String(120), nullable=False, unique=True),
        sa.Column("audio_format", sa.String(20), nullable=False),
        sa.Column("sample_rate", sa.Integer(), nullable=False),
        sa.Column("bit_depth", sa.Integer(), nullable=False),
        sa.Column("channels", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("audio_bytes", sa.Integer(), nullable=False),
        sa.Column("peak", sa.Float(), nullable=False),
        sa.Column("pluck_at_ms", sa.Integer()),
        sa.Column("capture", JSONB()),
        sa.Column("status", sa.String(12), nullable=False, server_default="accepted"),
        sa.Column("recorded_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("string_number between 1 and 6", name="dataset_samples_string_valid"),
        sa.CheckConstraint("fret between 0 and 24", name="dataset_samples_fret_valid"),
        sa.CheckConstraint("string_construction in ('wound', 'unwound', 'unknown')", name="dataset_samples_construction_valid"),
        sa.CheckConstraint("background_noise in ('quiet', 'moderate', 'noisy')", name="dataset_samples_noise_valid"),
        sa.CheckConstraint("pluck_method in ('finger', 'pick')", name="dataset_samples_method_valid"),
        sa.CheckConstraint("pluck_strength in ('soft', 'medium', 'strong')", name="dataset_samples_strength_valid"),
        sa.CheckConstraint("device is null or device in ('phone', 'tablet', 'laptop', 'other')", name="dataset_samples_device_valid"),
        sa.CheckConstraint("status in ('accepted', 'needs_review', 'rejected')", name="dataset_samples_status_valid"),
    )
    op.create_index("ix_dataset_samples_guitar_id", "dataset_samples", ["guitar_id"])
    op.create_index("ix_dataset_samples_position", "dataset_samples", ["guitar_id", "string_number", "fret"])


def downgrade() -> None:
    op.drop_table("dataset_samples")
    op.drop_table("dataset_guitars")
