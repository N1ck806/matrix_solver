"""
Школа бизнеса и финансов — сборка контента.

Собирает направления из отдельных файлов и регистрирует школу
в CONTENT_REGISTRY (см. matrix_app/content/base.py).

Направления:
    tourism                          — Туризм
    business-management              — Управление бизнесом
    international-economic-relations — Международные экономические отношения
    international-marketing          — Международный маркетинг
    accounting                       — Бухгалтерский учёт
    banking                          — Банковское дело
    finance                          — Финансы
    international-relations          — Международные отношения
"""
from __future__ import annotations

from ..base import register_school

from .tourism import DIRECTION as TOURISM
from .business_management import DIRECTION as BUSINESS_MANAGEMENT
from .international_economic_relations import DIRECTION as INTERNATIONAL_ECONOMIC_RELATIONS
from .international_marketing import DIRECTION as INTERNATIONAL_MARKETING
from .accounting import DIRECTION as ACCOUNTING
from .banking import DIRECTION as BANKING
from .finance import DIRECTION as FINANCE
from .international_relations import DIRECTION as INTERNATIONAL_RELATIONS


# =============================================================================
# Реестр направлений школы
# =============================================================================

DIRECTIONS: dict = {
    "tourism":                          TOURISM,
    "business-management":              BUSINESS_MANAGEMENT,
    "international-economic-relations": INTERNATIONAL_ECONOMIC_RELATIONS,
    "international-marketing":          INTERNATIONAL_MARKETING,
    "accounting":                       ACCOUNTING,
    "banking":                          BANKING,
    "finance":                          FINANCE,
    "international-relations":          INTERNATIONAL_RELATIONS,
}


# =============================================================================
# Общая информация о школе
# =============================================================================

SCHOOL_INFO: dict = {
    "intro": (
        "Бизнес и финансы — это работа с данными и связями. "
        "Кто с кем торгует, куда идут деньги, какие риски "
        "связаны между собой. Матрицы превращают эту "
        "многомерную реальность в измеримые величины, "
        "позволяя принимать решения на основе чисел, "
        "а не интуиции."
    ),
    "highlights": [
        "Матрицы «затраты — выпуск» и торговые балансы",
        "Ковариационные матрицы и оптимизация портфеля",
        "Марковские модели потоков клиентов",
        "Сегментация рынка через спектральный анализ",
    ],
}


# =============================================================================
# Регистрация школы в общем реестре
# =============================================================================

register_school(
    school_slug="business",
    directions=DIRECTIONS,
    school_info=SCHOOL_INFO,
)