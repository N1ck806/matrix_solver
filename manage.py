#!/usr/bin/env python
"""
Django-утилита для управления проектом MatrixLab.

Стандартная точка входа Django. Устанавливает переменную окружения
DJANGO_SETTINGS_MODULE и делегирует выполнение django.core.management.

Использование:
    python manage.py runserver
    python manage.py migrate
    python manage.py createsuperuser
    python manage.py collectstatic
"""
from __future__ import annotations

import os
import sys


def main() -> None:
    """Точка входа в управляющую утилиту Django."""
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Не удалось импортировать Django.\n"
            "Проверьте, что Django установлен и доступен в текущем "
            "виртуальном окружении:\n"
            "    python -m pip install -r requirements.txt"
        ) from exc

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()