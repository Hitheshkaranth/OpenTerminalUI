from __future__ import annotations

import os
import smtplib
import uuid
from dataclasses import dataclass, field
from email.message import EmailMessage
from typing import Callable

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger


@dataclass
class ScheduledReportConfig:
    id: str
    report_type: str
    frequency: str
    email: str
    enabled: bool = True
    data_type: str = "positions"


class ScheduledReportsService:
    def __init__(self) -> None:
        self._scheduler = BackgroundScheduler(timezone="UTC")
        self._started = False
        self._configs: dict[str, ScheduledReportConfig] = {}

    def start(self) -> None:
        if not self._started:
            self._scheduler.start()
            self._started = True

    def stop(self) -> None:
        if self._started:
            self._scheduler.shutdown(wait=False)
            self._started = False

    def list(self) -> list[ScheduledReportConfig]:
        return sorted(self._configs.values(), key=lambda x: x.id)

    def upsert(self, report_type: str, frequency: str, email: str, data_type: str = "positions") -> ScheduledReportConfig:
        self.start()
        cfg = ScheduledReportConfig(
            id=str(uuid.uuid4()),
            report_type=report_type,
            frequency=frequency,
            email=email,
            data_type=data_type,
        )
        self._configs[cfg.id] = cfg
        trigger = self._trigger_for_frequency(frequency)
        self._scheduler.add_job(
            self._noop_delivery,
            trigger=trigger,
            id=cfg.id,
            replace_existing=True,
            kwargs={"config_id": cfg.id},
        )
        return cfg

    def delete(self, config_id: str) -> bool:
        existed = config_id in self._configs
        self._configs.pop(config_id, None)
        try:
            self._scheduler.remove_job(config_id)
        except Exception:
            pass
        return existed

    def _trigger_for_frequency(self, frequency: str) -> CronTrigger:
        low = frequency.strip().lower()
        if low == "daily":
            return CronTrigger(hour=18, minute=0)
        if low == "weekly":
            return CronTrigger(day_of_week="fri", hour=18, minute=0)
        return CronTrigger(hour="*/12")

    def _noop_delivery(self, config_id: str) -> None:
        # Execution hook; actual API-triggered delivery can call send_email directly.
        _ = config_id

    def send_email(self, to_email: str, subject: str, body: str, attachment_name: str, attachment_bytes: bytes) -> None:
        host = os.getenv("SMTP_HOST")
        port = int(os.getenv("SMTP_PORT", "587"))
        user = os.getenv("SMTP_USER")
        password = os.getenv("SMTP_PASSWORD")
        if not host or not user or not password:
            raise RuntimeError("SMTP configuration missing")

        msg = EmailMessage()
        msg["From"] = user
        msg["To"] = to_email
        msg["Subject"] = subject
        msg.set_content(body)
        msg.add_attachment(attachment_bytes, maintype="application", subtype="octet-stream", filename=attachment_name)

        with smtplib.SMTP(host, port) as smtp:
            smtp.starttls()
            smtp.login(user, password)
            smtp.send_message(msg)


scheduled_reports_service = ScheduledReportsService()
