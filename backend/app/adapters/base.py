from __future__ import annotations

from abc import ABC, abstractmethod

from app.models.monitoring import ModelChannel
from app.services.probe_types import ProbeExecutionResult


class ProbeAdapter(ABC):
    @abstractmethod
    async def execute(self, channel: ModelChannel, prompt: str) -> ProbeExecutionResult:
        raise NotImplementedError
