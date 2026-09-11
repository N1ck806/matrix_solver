"""
Контекст-процессоры приложения MatrixLab.

Добавляют глобальные переменные во все шаблоны:
    • app_meta    — название, версия, описание, автор;
    • limits      — лимиты (для интерфейса: max_rows, max_cols);
    • cdn         — URL-адреса CDN-библиотек (MathJax, Chart.js);
    • nav_items   — пункты основной навигации;
    • active_page — текущая активная страница (по request.resolver_match).

Все процессоры тонкие и быстрые — выполняются на каждом запросе,
поэтому обращений к БД здесь нет.
"""
from __future__ import annotations

from typing import Any

from django.conf import settings
from django.http import HttpRequest

from . import __description__, __title__, __version__


# =============================================================================
# Метаданные приложения
# =============================================================================

def app_meta(request: HttpRequest) -> dict[str, Any]:  # noqa: ARG001
    """Название, версия, описание — для футера, шапки, мета-тегов."""
    return {
        "APP_NAME": __title__,
        "APP_VERSION": __version__,
        "APP_DESCRIPTION": __description__,
    }


# =============================================================================
# Лимиты
# =============================================================================

def limits(request: HttpRequest) -> dict[str, Any]:  # noqa: ARG001
    """Лимиты, которые нужны интерфейсу: максимальный размер матриц,
    пределы степени, точность вывода и т.п."""
    return {
        "MAX_MATRIX_ROWS": getattr(settings, "MAX_MATRIX_ROWS", 10),
        "MAX_MATRIX_COLS": getattr(settings, "MAX_MATRIX_COLS", 10),
        "MAX_SYMBOLIC_SIZE": getattr(settings, "MAX_SYMBOLIC_SIZE", 5),
        "MAX_MATRIX_POWER": getattr(settings, "MAX_MATRIX_POWER", 100),
        "DEFAULT_OUTPUT_FORMAT": getattr(settings, "DEFAULT_OUTPUT_FORMAT", "exact"),
        "DECIMAL_PRECISION": getattr(settings, "DECIMAL_PRECISION", 6),
    }


# =============================================================================
# CDN
# =============================================================================

def cdn(request: HttpRequest) -> dict[str, Any]:  # noqa: ARG001
    """Ссылки на внешние ресурсы. Определены в settings.CDN."""
    return {"CDN": getattr(settings, "CDN", {})}


# =============================================================================
# Навигация
# =============================================================================

# Единый источник пунктов меню. Используется в base.html и в футере.
NAV_ITEMS: list[dict[str, str]] = [
    {"url_name": "matrix_app:calculator", "label": "Калькулятор", "icon": "calculator"},
    {"url_name": "matrix_app:operations", "label": "Операции", "icon": "layers"},
    {"url_name": "matrix_app:properties", "label": "Свойства", "icon": "check-badge"},
    {"url_name": "matrix_app:systems", "label": "СЛАУ", "icon": "system"},
    {"url_name": "matrix_app:decompositions", "label": "Разложения", "icon": "grid"},
    {"url_name": "matrix_app:eigen", "label": "Спектр", "icon": "lambda"},
    {"url_name": "matrix_app:theory", "label": "Теория", "icon": "book-open"},
    {"url_name": "matrix_app:types", "label": "Виды матриц", "icon": "matrix-grid"},
]


def navigation(request: HttpRequest) -> dict[str, Any]:
    """Пункты навигации и текущая активная страница."""
    active: str = ""
    if request.resolver_match is not None:
        # Например, 'matrix_app:calculator' — удобно для подсветки.
        active = request.resolver_match.view_name or ""

    return {
        "NAV_ITEMS": NAV_ITEMS,
        "ACTIVE_PAGE": active,
    }


# =============================================================================
# Год для футера (не обязателен, но удобен)
# =============================================================================

def footer_year(request: HttpRequest) -> dict[str, Any]:  # noqa: ARG001
    """Текущий год для копирайта в футере."""
    import datetime

    return {"CURRENT_YEAR": datetime.date.today().year}