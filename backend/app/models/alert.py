from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class AlertEndpoint(Base):
    __tablename__ = "alert_endpoints"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    webhook_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    secret_encrypted: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="enabled", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    deliveries: Mapped[list["AlertDelivery"]] = relationship(
        "AlertDelivery", back_populates="alert_endpoint", cascade="all, delete-orphan"
    )


class AlertIncident(Base):
    __tablename__ = "alert_incidents"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid4()))
    task_id: Mapped[str] = mapped_column(String(64), index=True)
    channel_id: Mapped[str] = mapped_column(String(64), index=True)
    task_name: Mapped[str] = mapped_column(String(255), nullable=False)
    channel_name: Mapped[str] = mapped_column(String(255), nullable=False)
    metric_type: Mapped[str] = mapped_column(String(32), index=True)
    metric_name: Mapped[str] = mapped_column(String(255), nullable=False)
    metric_value: Mapped[str] = mapped_column(String(255), nullable=False)
    threshold_value: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="firing", nullable=False, index=True)
    alert_channel_name: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    opened_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    deliveries: Mapped[list["AlertDelivery"]] = relationship(
        "AlertDelivery", back_populates="incident", cascade="all, delete-orphan"
    )


class AlertDelivery(Base):
    __tablename__ = "alert_deliveries"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid4()))
    incident_id: Mapped[str] = mapped_column(ForeignKey("alert_incidents.id", ondelete="CASCADE"), index=True)
    alert_endpoint_id: Mapped[str | None] = mapped_column(
        ForeignKey("alert_endpoints.id", ondelete="SET NULL"), nullable=True
    )
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    response_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_msg: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    incident: Mapped[AlertIncident] = relationship("AlertIncident", back_populates="deliveries")
    alert_endpoint: Mapped[AlertEndpoint | None] = relationship("AlertEndpoint", back_populates="deliveries")
