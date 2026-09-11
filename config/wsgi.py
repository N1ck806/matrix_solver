"""
WSGI-конфигурация проекта MatrixLab.

Используется синхронными веб-серверами:
    - gunicorn      (рекомендуется для продакшена)
    - uWSGI
    - mod_wsgi
    - waitress      (кроссплатформенный, чистый Python)

Запуск в продакшене (пример для gunicorn):
    gunicorn config.wsgi:application \\
        --bind 0.0.0.0:8000 \\
        --workers 4 \\
        --threads 2 \\
        --timeout 120 \\
        --access-logfile - \\
        --error-logfile -

Разработка:
    python manage.py runserver

Модуль не выполняет никаких вычислений при импорте, кроме установки
переменной окружения DJANGO_SETTINGS_MODULE и получения callable
`application` — это требование спецификации WSGI (PEP 3333).
"""
from __future__ import annotations

import logging
import os
import sys
from typing import Any

# =============================================================================
# Настройка окружения
# =============================================================================

# По умолчанию — основной settings. Переопределяется через переменную
# окружения DJANGO_SETTINGS_MODULE (например, config.settings_production).
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

# Гарантируем, что корень проекта в sys.path (важно при запуске через
# gunicorn с systemd, когда рабочая директория может отличаться).
_PROJECT_ROOT: str = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)


# =============================================================================
# Получение WSGI-приложения
# =============================================================================

try:
    from django.core.wsgi import get_wsgi_application
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "Не удалось импортировать Django.\n"
        "Убедитесь, что виртуальное окружение активировано и зависимости "
        "установлены:\n"
        "    python -m pip install -r requirements.txt"
    ) from exc

# WSGI callable — то, что передаётся серверу.
application: Any = get_wsgi_application()


# =============================================================================
# Диагностическое логирование (только при прямом запуске)
# =============================================================================
#
# Если файл запущен напрямую (python config/wsgi.py), выводим полезную
# информацию для отладки. При импорте из gunicorn/uWSGI — ничего не пишем,
# чтобы не засорять логи.

if __name__ == "__main__":  # pragma: no cover
    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] %(levelname)s %(message)s",
    )
    logger = logging.getLogger("matrixlab.wsgi")

    logger.info("MatrixLab WSGI application loaded")
    logger.info("Settings module: %s", os.environ["DJANGO_SETTINGS_MODULE"])
    logger.info("Project root: %s", _PROJECT_ROOT)
    logger.info("Python: %s", sys.version.split()[0])

    try:
        from django.conf import settings as _settings

        logger.info("DEBUG: %s", _settings.DEBUG)
        logger.info("ALLOWED_HOSTS: %s", ", ".join(_settings.ALLOWED_HOSTS) or "(empty)")
        logger.info("DATABASES['default']['ENGINE']: %s",
                    _settings.DATABASES["default"]["ENGINE"])
        logger.info("LANGUAGE_CODE: %s", _settings.LANGUAGE_CODE)
        logger.info("TIME_ZONE: %s", _settings.TIME_ZONE)
    except Exception as exc:  # noqa: BLE001
        logger.error("Не удалось прочитать настройки: %s", exc)
        raise

    logger.info(
        "Для запуска используйте: python manage.py runserver "
        "или gunicorn config.wsgi:application"
    )