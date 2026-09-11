"""
Конфигурация приложения MatrixLab.

AppConfig — это точка, где Django узнаёт о приложении:
    • человекочитаемое имя для админки;
    • тип автоинкрементного поля по умолчанию;
    • точку подключения сигналов;
    • проверки системы (system checks);
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

    # Значение по умолчанию для автоинкрементных первичных ключей.
    # BigAutoField — 64-битный int, безопасен для истории и сохранённых матриц.
    default_auto_field: str = "django.db.models.BigAutoField"

    # Путь к пакету приложения.
    name: str = "matrix_app"

    # Человекочитаемое имя — видно в админке и в system checks.
    verbose_name = _("MatrixLab — матричные вычисления")

    # Короткое имя для логов и CLI.
    label: str = "matrix_app"

    # -------------------------------------------------------------------------
    # ready(): подключение сигналов и установка Telegram-вебхука
    # -------------------------------------------------------------------------
    def ready(self) -> None:
        """Вызывается Django, когда все приложения загружены.

        Здесь безопасно импортировать модели, подключать сигналы
        и выполнять разовую инициализацию внешних сервисов.
        """
        # --- 1. Сигналы ----------------------------------------------------
        # Импорт регистрирует декораторы @receiver. Если файл пуст —
        # ничего страшного, просто ничего не произойдёт.
        from . import signals  # noqa: F401

        # --- 2. Telegram webhook -------------------------------------------
        # Устанавливаем только если BOT_TOKEN задан в окружении.
        # Пропускаем миграции, collectstatic, shell и прочие management-команды.
        if not getattr(settings, "BOT_TOKEN", ""):
            return

        # Определяем, надо ли ставить webhook:
        #   • RUN_MAIN=true — это reloader runserver'а (локально).
        #   • not DEBUG    — это gunicorn на Render.
        # Во всех остальных случаях (миграции, тесты, management-команды)
        # webhook НЕ трогаем.
        is_runserver_reload = os.environ.get("RUN_MAIN") == "true"
        is_production = not settings.DEBUG

        if not (is_runserver_reload or is_production):
            return

        try:
            from asgiref.sync import async_to_sync

            from .telegram_bot import setup_webhook

            async_to_sync(setup_webhook)()
        except Exception:
            logger.exception(
                "Не удалось установить Telegram webhook. "
                "Проверьте BOT_TOKEN и SITE_URL."
            )

    # -------------------------------------------------------------------------
    # validate(): дополнительные system checks
    # -------------------------------------------------------------------------
    def validate(self) -> None:  # pragma: no cover
        """Проверка конфигурации приложения.

        Django вызовет этот метод при `manage.py check` и при старте
        в DEBUG-режиме. Все ошибки собираются в список и показываются
        как system check messages.
        """
        # Регистрация проверок делается через декоратор @register
        # в модуле checks.py.
        from . import checks  # noqa: F401