"""initial schema

Revision ID: 0001_initial_schema
Revises: None
Create Date: 2026-06-11 00:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("username", sa.String(length=128), nullable=False),
        sa.Column("password_hash", sa.String(length=512), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    op.create_table(
        "sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_token_hash", sa.String(length=128), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False),
        sa.Column("ip_address", sa.String(length=128), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
    )
    op.create_index("ix_sessions_session_token_hash", "sessions", ["session_token_hash"], unique=True)
    op.create_index("ix_sessions_expires_at", "sessions", ["expires_at"], unique=False)
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"], unique=False)

    op.create_table(
        "model_channels",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("api_endpoint", sa.String(length=1024), nullable=False),
        sa.Column("api_key_encrypted", sa.Text(), nullable=False),
        sa.Column("model_identifier", sa.String(length=255), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("last_probe_at", sa.DateTime(), nullable=True),
        sa.Column("last_ok_at", sa.DateTime(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
    )
    op.create_index("ix_model_channels_name", "model_channels", ["name"], unique=False)

    op.create_table(
        "probe_tasks",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("channel_id", sa.String(length=64), sa.ForeignKey("model_channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("interval_minutes", sa.Integer(), nullable=False),
        sa.Column("concurrency", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("max_ttft_ms", sa.Integer(), nullable=False),
        sa.Column("min_tps", sa.Float(), nullable=False),
        sa.Column("max_total_latency_ms", sa.Integer(), nullable=False),
        sa.Column("min_success_rate", sa.Float(), nullable=False),
        sa.Column("alert_channel_ids", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("next_run_at", sa.DateTime(), nullable=True),
        sa.Column("last_run_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_probe_tasks_channel_id", "probe_tasks", ["channel_id"], unique=False)

    op.create_table(
        "probe_batches",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("task_id", sa.String(length=64), sa.ForeignKey("probe_tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("trigger", sa.String(length=32), nullable=False),
        sa.Column("planned_concurrency", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
    )

    op.create_table(
        "probe_runs",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("batch_id", sa.String(length=64), sa.ForeignKey("probe_batches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id", sa.String(length=64), nullable=False),
        sa.Column("task_name", sa.String(length=255), nullable=False),
        sa.Column("channel_id", sa.String(length=64), nullable=False),
        sa.Column("channel_name", sa.String(length=255), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("response_text", sa.Text(), nullable=False),
        sa.Column("dns_time_ms", sa.Float(), nullable=False),
        sa.Column("tcp_time_ms", sa.Float(), nullable=False),
        sa.Column("ttft_ms", sa.Integer(), nullable=False),
        sa.Column("total_latency_ms", sa.Integer(), nullable=False),
        sa.Column("tokens_count", sa.Integer(), nullable=False),
        sa.Column("tps", sa.Float(), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("error_msg", sa.Text(), nullable=True),
        sa.Column("violated_ttft", sa.Boolean(), nullable=False),
        sa.Column("violated_tps", sa.Boolean(), nullable=False),
        sa.Column("violated_ext_latency", sa.Boolean(), nullable=False),
        sa.Column("sample_no", sa.Integer(), nullable=False),
        sa.Column("trigger", sa.String(length=32), nullable=False),
        sa.Column("request_payload_json", sa.JSON(), nullable=False),
        sa.Column("response_excerpt", sa.Text(), nullable=True),
        sa.Column("token_count_source", sa.String(length=32), nullable=False),
        sa.Column("error_type", sa.String(length=128), nullable=True),
    )
    op.create_index("ix_probe_runs_batch_id", "probe_runs", ["batch_id"], unique=False)
    op.create_index("ix_probe_runs_task_id", "probe_runs", ["task_id"], unique=False)
    op.create_index("ix_probe_runs_channel_id", "probe_runs", ["channel_id"], unique=False)
    op.create_index("ix_probe_runs_timestamp", "probe_runs", ["timestamp"], unique=False)

    op.create_table(
        "alert_endpoints",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("webhook_url", sa.String(length=1024), nullable=False),
        sa.Column("secret_encrypted", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "alert_incidents",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("task_id", sa.String(length=64), nullable=False),
        sa.Column("channel_id", sa.String(length=64), nullable=False),
        sa.Column("task_name", sa.String(length=255), nullable=False),
        sa.Column("channel_name", sa.String(length=255), nullable=False),
        sa.Column("metric_type", sa.String(length=32), nullable=False),
        sa.Column("metric_name", sa.String(length=255), nullable=False),
        sa.Column("metric_value", sa.String(length=255), nullable=False),
        sa.Column("threshold_value", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("alert_channel_name", sa.String(length=255), nullable=False),
        sa.Column("opened_at", sa.DateTime(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("last_notified_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_alert_incidents_task_id", "alert_incidents", ["task_id"], unique=False)
    op.create_index("ix_alert_incidents_channel_id", "alert_incidents", ["channel_id"], unique=False)
    op.create_index("ix_alert_incidents_metric_type", "alert_incidents", ["metric_type"], unique=False)
    op.create_index("ix_alert_incidents_status", "alert_incidents", ["status"], unique=False)
    op.create_index("ix_alert_incidents_opened_at", "alert_incidents", ["opened_at"], unique=False)

    op.create_table(
        "alert_deliveries",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("incident_id", sa.String(length=64), sa.ForeignKey("alert_incidents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("alert_endpoint_id", sa.String(length=64), sa.ForeignKey("alert_endpoints.id", ondelete="SET NULL"), nullable=True),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("response_excerpt", sa.Text(), nullable=True),
        sa.Column("error_msg", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_alert_deliveries_incident_id", "alert_deliveries", ["incident_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_alert_deliveries_incident_id", table_name="alert_deliveries")
    op.drop_table("alert_deliveries")
    op.drop_index("ix_alert_incidents_opened_at", table_name="alert_incidents")
    op.drop_index("ix_alert_incidents_status", table_name="alert_incidents")
    op.drop_index("ix_alert_incidents_metric_type", table_name="alert_incidents")
    op.drop_index("ix_alert_incidents_channel_id", table_name="alert_incidents")
    op.drop_index("ix_alert_incidents_task_id", table_name="alert_incidents")
    op.drop_table("alert_incidents")
    op.drop_table("alert_endpoints")
    op.drop_index("ix_probe_runs_timestamp", table_name="probe_runs")
    op.drop_index("ix_probe_runs_channel_id", table_name="probe_runs")
    op.drop_index("ix_probe_runs_task_id", table_name="probe_runs")
    op.drop_index("ix_probe_runs_batch_id", table_name="probe_runs")
    op.drop_table("probe_runs")
    op.drop_table("probe_batches")
    op.drop_index("ix_probe_tasks_channel_id", table_name="probe_tasks")
    op.drop_table("probe_tasks")
    op.drop_index("ix_model_channels_name", table_name="model_channels")
    op.drop_table("model_channels")
    op.drop_index("ix_sessions_user_id", table_name="sessions")
    op.drop_index("ix_sessions_expires_at", table_name="sessions")
    op.drop_index("ix_sessions_session_token_hash", table_name="sessions")
    op.drop_table("sessions")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")
