from __future__ import annotations

from app.services.notifier import _build_feishu_card, _build_webhook_body, build_report_pdf_bytes


def test_build_feishu_card_for_incident_payload() -> None:
    payload = {
        "id": "incident-1",
        "status": "firing",
        "timestamp": "2026-06-12 21:54:27",
        "taskName": "本机 qwen2.5-0.5b模型性能监测",
        "channelName": "Local qwen2.5-0.5b-instruct-mlx",
        "metricName": "吞吐速率 (TPS)",
        "metricValue": "224.8 Tok/s",
        "thresholdValue": ">= 300.0 Tok/s",
        "alertChannelName": "飞书 LLM 质量运维群",
    }

    body = _build_feishu_card(payload)

    assert body["msg_type"] == "interactive"
    assert body["card"]["header"]["template"] == "red"
    assert body["card"]["header"]["title"]["content"] == "LLM-Guardian SLA 告警"
    first_block = body["card"]["elements"][0]["text"]["content"]
    assert "吞吐速率 (TPS)" in first_block
    assert "Local qwen2.5-0.5b-instruct-mlx" in first_block
    fields = body["card"]["elements"][1]["fields"]
    assert fields[1]["text"]["content"] == "**触发时间**\n2026-06-12 21:54:27"


def test_build_feishu_card_for_test_payload() -> None:
    payload = {
        "kind": "test",
        "message": "LLM-Guardian alert channel connectivity test",
        "timestamp": "2026-06-12T22:10:00+08:00",
    }

    body = _build_webhook_body("feishu", payload)

    assert body["msg_type"] == "interactive"
    assert body["card"]["header"]["template"] == "blue"
    assert body["card"]["header"]["title"]["content"] == "LLM-Guardian 联通性测试"


def test_build_feishu_card_for_resolved_payload_includes_recovery_duration() -> None:
    payload = {
        "id": "incident-2",
        "status": "resolved",
        "timestamp": "2026-06-12 22:31:25",
        "openedAt": "2026-06-12 22:29:25",
        "resolvedAt": "2026-06-12 22:31:25",
        "recoveryDuration": "2分0秒",
        "taskName": "本机 qwen2.5-0.5b模型性能监测",
        "channelName": "Local qwen2.5-0.5b-instruct-mlx",
        "metricName": "吞吐速率 (TPS)",
        "metricValue": "320.4 Tok/s",
        "thresholdValue": ">= 300.0 Tok/s",
        "alertChannelName": "飞书 LLM 质量运维群",
    }

    body = _build_feishu_card(payload)

    assert body["card"]["header"]["template"] == "green"
    fields = body["card"]["elements"][1]["fields"]
    assert fields[1]["text"]["content"] == "**恢复时间**\n2026-06-12 22:31:25"
    recovery_fields = body["card"]["elements"][2]["fields"]
    assert recovery_fields[0]["text"]["content"] == "**告警开始**\n2026-06-12 22:29:25"
    assert recovery_fields[1]["text"]["content"] == "**恢复耗时**\n2分0秒"


def test_build_dingtalk_body_remains_text() -> None:
    payload = {"status": "firing", "metricName": "TTFT"}

    body = _build_webhook_body("dingtalk", payload)

    assert body["msgtype"] == "text"
    assert "TTFT" in body["text"]["content"]


def test_build_feishu_card_for_report_payload() -> None:
    payload = {
        "kind": "report",
        "periodLabel": "周报",
        "timestamp": "2026-06-13 12:30:00",
        "summary": "本期 SLA 周报已生成。",
        "totalDials": 236,
        "successRate": 97.9,
        "overallSlaScore": 32.25,
        "channelCount": 2,
        "weakestChannels": [
            {"channelName": "fde-deepseek", "complianceRate": 0.0, "successRate": 80.0},
        ],
    }

    body = _build_feishu_card(payload)

    assert body["msg_type"] == "interactive"
    assert body["card"]["header"]["template"] == "blue"
    assert body["card"]["header"]["title"]["content"] == "LLM-Guardian SLA 周报"
    assert body["card"]["elements"][0]["text"]["content"] == "本期 SLA 周报已生成。"
    weakest_block = body["card"]["elements"][3]["text"]["content"]
    assert "fde-deepseek" in weakest_block


def test_build_report_pdf_bytes_returns_pdf_document() -> None:
    payload = {
        "periodLabel": "周报",
        "timestamp": "2026-06-13 12:30:00",
        "summary": "本期 SLA 周报已生成。",
        "totalDials": 236,
        "successRate": 97.9,
        "overallSlaScore": 32.25,
        "channelCount": 2,
        "weakestChannels": [{"channelName": "fde-deepseek", "complianceRate": 0.0, "successRate": 80.0}],
    }

    pdf_bytes = build_report_pdf_bytes(payload)

    assert pdf_bytes.startswith(b"%PDF-1.4")
    assert b"LLM-Guardian SLA Report" in pdf_bytes
