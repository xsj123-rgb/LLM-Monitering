from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import APIModel


ChannelType = Literal["openai", "ollama", "huggingface", "custom"]
ChannelStatus = Literal["active", "degraded", "offline"]
TaskStatus = Literal["running", "paused"]
AlertType = Literal["feishu", "dingtalk", "webhook", "email"]
AlertStatus = Literal["enabled", "disabled"]
NotificationStatus = Literal["firing", "resolved"]
DeploymentMode = Literal["k8s", "docker", "bare_metal", "other"]


class SLAThresholds(BaseModel):
    maxTtftMs: int
    minTps: float
    maxTotalLatencyMs: int
    minSuccessRate: float


class ModelChannelBase(BaseModel):
    name: str
    apiEndpoint: str
    apiKey: str = ""
    modelIdentifier: str
    type: ChannelType
    status: ChannelStatus = "active"
    tags: list[str] = Field(default_factory=list)
    description: str | None = None
    deploymentMode: DeploymentMode | None = None
    deploymentConfig: str | None = None
    deploymentEnv: str | None = None
    deploymentArgs: str | None = None
    aiDiagnosticEnabled: bool = False


class ModelChannelCreate(ModelChannelBase):
    pass


class ModelChannelUpdate(BaseModel):
    name: str | None = None
    apiEndpoint: str | None = None
    apiKey: str | None = None
    modelIdentifier: str | None = None
    type: ChannelType | None = None
    status: ChannelStatus | None = None
    tags: list[str] | None = None
    description: str | None = None
    deploymentMode: DeploymentMode | None = None
    deploymentConfig: str | None = None
    deploymentEnv: str | None = None
    deploymentArgs: str | None = None
    aiDiagnosticEnabled: bool | None = None


class ModelChannelResponse(APIModel):
    id: str
    name: str
    apiEndpoint: str
    apiKey: str
    modelIdentifier: str
    type: ChannelType
    status: ChannelStatus
    tags: list[str]
    createdAt: datetime
    updatedAt: datetime
    lastProbeAt: datetime | None = None
    lastOkAt: datetime | None = None
    description: str | None = None
    deploymentMode: DeploymentMode | None = None
    deploymentConfig: str | None = None
    deploymentEnv: str | None = None
    deploymentArgs: str | None = None
    aiDiagnosticEnabled: bool = False


class ModelDiscoveryRequest(BaseModel):
    apiEndpoint: str
    apiKey: str = ""
    type: ChannelType


class ModelDiscoveryResponse(BaseModel):
    models: list[str] = Field(default_factory=list)
    sourceUrl: str | None = None


class AlertConfigBase(BaseModel):
    name: str
    type: AlertType
    webhookUrl: str
    secret: str | None = None
    status: AlertStatus = "enabled"


class AlertConfigCreate(AlertConfigBase):
    pass


class AlertConfigUpdate(BaseModel):
    name: str | None = None
    type: AlertType | None = None
    webhookUrl: str | None = None
    secret: str | None = None
    status: AlertStatus | None = None


class AlertConfigResponse(APIModel):
    id: str
    name: str
    type: AlertType
    webhookUrl: str
    secret: str | None = None
    status: AlertStatus
    createdAt: datetime
    updatedAt: datetime


class DialTaskBase(BaseModel):
    name: str
    channelId: str
    prompt: str
    intervalMinutes: int = Field(ge=1)
    concurrency: int = Field(ge=1, le=10)
    status: TaskStatus = "running"
    thresholds: SLAThresholds
    alertChannels: list[str] = Field(default_factory=list)


class DialTaskCreate(DialTaskBase):
    pass


class DialTaskUpdate(BaseModel):
    name: str | None = None
    channelId: str | None = None
    prompt: str | None = None
    intervalMinutes: int | None = Field(default=None, ge=1)
    concurrency: int | None = Field(default=None, ge=1, le=10)
    status: TaskStatus | None = None
    thresholds: SLAThresholds | None = None
    alertChannels: list[str] | None = None


class DialTaskResponse(APIModel):
    id: str
    name: str
    channelId: str
    prompt: str
    intervalMinutes: int
    concurrency: int
    status: TaskStatus
    thresholds: SLAThresholds
    alertChannels: list[str]
    createdAt: datetime
    updatedAt: datetime
    nextRunAt: datetime | None = None
    lastRunAt: datetime | None = None


class MetricLogResponse(APIModel):
    id: str
    taskId: str
    taskName: str
    channelId: str
    channelName: str
    timestamp: datetime
    prompt: str
    responseText: str
    dnsTimeMs: float
    tcpTimeMs: float
    ttftMs: int
    totalLatencyMs: int
    tokensCount: int
    tps: float
    statusCode: int
    success: bool
    errorMsg: str | None = None
    violatedTtft: bool
    violatedTps: bool
    violatedExtLatency: bool
    requestPayloadJson: dict = Field(default_factory=dict)
    responseExcerpt: str | None = None
    tokenCountSource: str = "estimated"
    trigger: str
    sampleNo: int
    errorType: str | None = None


class AlertNotificationResponse(APIModel):
    id: str
    timestamp: datetime
    channelName: str
    taskName: str
    metricName: str
    metricValue: str
    thresholdValue: str
    status: NotificationStatus
    alertChannelName: str


class DashboardSummaryResponse(BaseModel):
    totalChannels: int
    totalTasks: int
    totalLogs24h: int
    totalFiringNotifications: int
    averageSuccessRate24h: float


class DashboardSeriesPoint(BaseModel):
    timestamp: datetime
    ttftMs: int
    totalLatencyMs: int
    tps: float
    success: bool
    channelId: str


class ReportChannelSummary(BaseModel):
    channelId: str
    channelName: str
    total: int
    successRate: float
    complianceRate: float
    avgTtft: int
    avgTps: float
    avgItl: float
    worstTtft: int


class AuditAdviceRequest(BaseModel):
    period: Literal["daily", "weekly", "monthly"] = "weekly"


class AuditAdviceChannelResponse(BaseModel):
    channelId: str
    advice: str
    source: Literal["ai", "disabled", "error"]


class AuditAdviceResponse(BaseModel):
    period: Literal["daily", "weekly", "monthly"]
    items: list[AuditAdviceChannelResponse]


class ReportSummaryResponse(BaseModel):
    period: Literal["daily", "weekly", "monthly"]
    totalDials: int
    successRate: float
    overallSlaScore: float
    channels: list[ReportChannelSummary]


class ReportPushResponse(BaseModel):
    period: Literal["daily", "weekly", "monthly"]
    deliveredCount: int
    failedCount: int
    endpointNames: list[str]
    errors: list[str] = Field(default_factory=list)
    attachmentSent: bool = False
    attachmentMessage: str | None = None
