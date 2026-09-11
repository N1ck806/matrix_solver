"""
ASGI-конфигурация проекта MatrixLab.

Используется асинхронными веб-серверами:
    - uvicorn   (рекомендуется, быстрый, на uvloop)
    - daphne    (референсная реализация ASGI от Django)
    - hypercorn (кроссплатформенный)

Запуск в продакшене (пример для uvicorn):
    uvicorn config.asgi:application \\
        --host 0.0.0.0 \\
        --port 8000 \\
        --workers 4 \\
        --log-level info \\
        --access-log

Разработка (async-режим):
    uvicorn config.asgi:application --reload
    # или
    daphne config.asgi:application

Зачем ASGI, если сейчас всё синхронное?
    - Матричные операции выполняются в синхронных воркерах, но ASGI
      позволяет в будущем добавить:
        • Server-Sent Events для очень длинных пошаговых решений;
        • WebSocket для интерактивного редактирования матриц;
        • асинхронные вызовы API параллельно (например, для сравнения
          нескольких разложений одной матрицы).
    - Наличие asgi.py не мешает синхронной работе: Django корректно
      оборачивает синхронные view в thread pool.

Модуль не выполняет никаких вычислений при импорте, кроме установки
переменной окружения DJANGO_SETTINGS_MODULE и получения callable
`application` — это требование спецификации ASGI.
"""
from __future__ import annotations

import logging
import os
import sys
from typing import Any

# =============================================================================
# Настройка окружения
# =============================================================================

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

_PROJECT_ROOT: str = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)


# =============================================================================
# Получение ASGI-приложения
# =============================================================================

try:
    from django.core.asgi import get_asgi_application
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "Не удалось импортировать Django ASGI.\n"
        "Убедитесь, что виртуальное окружение активировано и зависимости "
        "установлены:\n"
        "    python -m pip install -r requirements.txt"
    ) from exc


# Получаем ASGI callable. По умолчанию Django возвращает обёртку,
# которая корректно обрабатывает и HTTP, и lifespan-события.
django_asgi_app: Any = get_asgi_application()


# =============================================================================
# Точка сборки ASGI-приложения
# =============================================================================
#
# Сейчас используем чистый Django ASGI. Если в будущем появится
# WebSocket-роутинг (например, через channels), здесь будет:
#
#     from channels.routing import ProtocolTypeRouter, URLRouter
#     from matrix_app.routing import websocket_urlpatterns
#
#     application = ProtocolTypeRouter({
#         "http": django_asgi_app,
#         "websocket": URLRouter(websocket_urlpatterns),
#     })
#
# Пока оставляем как есть — расширять легко, ничего не сломается.
# =============================================================================

application: Any = django_asgi_app


# =============================================================================
# Диагностическое логирование (только при прямом запуске)
# =============================================================================

if __name__ == "__main__":  # pragma: no cover
    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] %(levelname)s %(message)s",
    )
    logger = logging.getLogger("matrixlab.asgi")

    logger.info("MatrixLab ASGI application loaded")
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
        "Для запуска используйте: uvicorn config.asgi:application --reload"
    )