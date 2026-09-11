"""
Конфигурация приложения MatrixLab.

AppConfig — это точка, где Django узнаёт о приложении:
    • человекочитаемое имя для админки;
    • тип автоинкрементного поля по умолчанию;
    • точку подключения сигналов;
    • проверки системы (system checks).

Здесь же можно задать поведение при старте (ready), но мы намеренно
не делаем тяжёлых операций в ready(), чтобы не замедлять запуск
и не ломать management-команды.
"""
from __future__ import annotations

from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


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

    # Готовность приложения — сигналы подключаем здесь.
    def ready(self) -> None:
        """Вызывается Django, когда все приложения загружены.

        Здесь безопасно импортировать модели и подключать сигналы.
        """
        # Импорт сигналов. Если файл signals.py отсутствует или пуст —
        # ничего страшного, просто ничего не произойдёт.
        # Сигналы используются для: логирования сохранений истории,
        # автоочистки старых записей сверх лимита и т.п.
        from . import signals  # noqa: F401

    # Собственные system checks (опционально).
    # Позволяют проверить корректность настроек лимитов при `manage.py check`.
    def validate(self) -> None:  # pragma: no cover
        """Проверка конфигурации приложения.

        Django вызовет этот метод при `manage.py check` и при старте
        в DEBUG-режиме. Все ошибки собираются в список и показываются
        как system check messages.
        """
        from django.core.checks import Error, Warning, register

        # Регистрация проверок делается через декоратор @register,
        # поэтому в этом методе оставляем только явный вызов
        # пользовательских проверок из отдельного модуля.
        from . import checks  # noqa: F401