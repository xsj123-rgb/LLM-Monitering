from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ModelChannel(Base):
    __tablename__ = "model_channels"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    api_endpoint: Mapped[str] = mapped_column(String(1024), nullable=False)
    api_key_encrypted: Mapped[str] = mapped_column(Text, default="", nullable=False)
    model_identifier: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
    last_probe_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_ok_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    deployment_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    deployment_config: Mapped[str | None] = mapped_column(Text, nullable=True)
    deployment_env: Mapped[str | None] = mapped_column(Text, nullable=True)
    deployment_args: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_diagnostic_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    tasks: Mapped[list["ProbeTask"]] = relationship(
        "ProbeTask", back_populates="channel", cascade="all, delete-orphan"
    )


class ProbeTask(Base):
    __tablename__ = "probe_tasks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    channel_id: Mapped[str] = mapped_column(ForeignKey("model_channels.id", ondelete="CASCADE"), index=True)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    interval_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    concurrency: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(32), default="running", nullable=False)
    max_ttft_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    min_tps: Mapped[float] = mapped_column(Float, nullable=False)
    max_total_latency_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    min_success_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0.95)
    alert_channel_ids: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    channel: Mapped[ModelChannel] = relationship("ModelChannel", back_populates="tasks")
    batches: Mapped[list["ProbeBatch"]] = relationship(
        "ProbeBatch", back_populates="task", cascade="all, delete-orphan"
    )


class ProbeBatch(Base):
    __tablename__ = "probe_batches"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid4()))
    task_id: Mapped[str] = mapped_column(ForeignKey("probe_tasks.id", ondelete="CASCADE"), index=True)
    trigger: Mapped[str] = mapped_column(String(32), nullable=False)
    planned_concurrency: Mapped[int] = mapped_column(Integer, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="running")

    task: Mapped[ProbeTask] = relationship("ProbeTask", back_populates="batches")
    runs: Mapped[list["ProbeRun"]] = relationship(
        "ProbeRun", back_populates="batch", cascade="all, delete-orphan"
    )


class ProbeRun(Base):
    __tablename__ = "probe_runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid4()))
    batch_id: Mapped[str] = mapped_column(ForeignKey("probe_batches.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[str] = mapped_column(String(64), index=True)
    task_name: Mapped[str] = mapped_column(String(255), nullable=False)
    channel_id: Mapped[str] = mapped_column(String(64), index=True)
    channel_name: Mapped[str] = mapped_column(String(255), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    response_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    dns_time_ms: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    tcp_time_ms: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    ttft_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_latency_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tokens_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tps: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    status_code: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    success: Mapped[bool] = mapped_column(default=False, nullable=False)
    error_msg: Mapped[str | None] = mapped_column(Text, nullable=True)
    violated_ttft: Mapped[bool] = mapped_column(default=False, nullable=False)
    violated_tps: Mapped[bool] = mapped_column(default=False, nullable=False)
    violated_ext_latency: Mapped[bool] = mapped_column(default=False, nullable=False)
    sample_no: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    trigger: Mapped[str] = mapped_column(String(32), nullable=False)
    request_payload_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    response_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_count_source: Mapped[str] = mapped_column(String(32), default="estimated", nullable=False)
    error_type: Mapped[str | None] = mapped_column(String(128), nullable=True)

    batch: Mapped[ProbeBatch] = relationship("ProbeBatch", back_populates="runs")


class AIAnalysisConfig(Base):
    __tablename__ = "ai_analysis_configs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid4()))
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    provider_type: Mapped[str] = mapped_column(String(32), default="openai-compatible", nullable=False)
    api_endpoint: Mapped[str] = mapped_column(String(1024), default="", nullable=False)
    api_key_encrypted: Mapped[str] = mapped_column(Text, default="", nullable=False)
    model_identifier: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    schedule_mode: Mapped[str] = mapped_column(String(16), default="weekly", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="idle", nullable=False)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class AuditAdviceSnapshot(Base):
    __tablename__ = "audit_advice_snapshots"
    __table_args__ = (UniqueConstraint("channel_id", "period", name="uq_audit_advice_channel_period"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid4()))
    channel_id: Mapped[str] = mapped_column(ForeignKey("model_channels.id", ondelete="CASCADE"), index=True)
    period: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    advice: Mapped[str] = mapped_column(Text, default="", nullable=False)
    source: Mapped[str] = mapped_column(String(16), default="disabled", nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    analysis_model_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    analysis_window_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    analysis_window_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
