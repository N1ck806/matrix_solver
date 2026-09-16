"""
Конфигурация приложения MatrixLab.

AppConfig — точка, где Django узнаёт о приложении:
    • человекочитаемое имя для админки;
    • тип автоинкрементного поля по умолчанию;
    • подключение сигналов;
    • system checks;
    • установку Telegram-вебхука при старте сервера.

Структура:
    1.  Импорты
    2.  Класс MatrixAppConfig
    3.  ready() — сигналы + Telegram webhook
    4.  validate() — system checks
"""
from __future__ import annotations

import logging
import os

from django.apps import AppConfig
from django.conf import settings
from django.utils.translation import gettext_lazy as _

logger = logging.getLogger("matrix_app.apps")


class MatrixAppConfig(AppConfig):
    """Конфигурация приложения matrix_app."""

    default_auto_field: str = "django.db.models.BigAutoField"
    name: str = "matrix_app"
    verbose_name = _("MatrixLab — матричные вычисления")
    label: str = "matrix_app"

    def ready(self) -> None:
        """Вызывается Django, когда все приложения загружены."""
        # --- 1. Сигналы ---
        from . import signals  # noqa: F401

        # --- 2. Telegram webhook ---
        if not getattr(settings, "BOT_TOKEN", ""):
            return

        is_runserver_reload = os.environ.get("RUN_MAIN") == "true"
        is_production = not settings.DEBUG

        if not (is_runserver_reload or is_production):
            return

        # Защита от повторного вызова в нескольких gunicorn-воркерах.
        if os.environ.get("MATRIXLAB_WEBHOOK_READY") == "1":
            return

        try:
            from .telegram_bot import setup_webhook

            # setup_webhook — СИНХРОННАЯ функция.
            setup_webhook()
            os.environ["MATRIXLAB_WEBHOOK_READY"] = "1"
        except Exception:
            logger.exception(
                "Не удалось установить Telegram webhook. "
                "Проверьте BOT_TOKEN и SITE_URL."
            )

    def validate(self) -> None:  # pragma: no cover
        from . import checks  # noqa: F401