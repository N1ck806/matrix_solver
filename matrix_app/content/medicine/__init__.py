"""
Школа медицины — сборка контента.

Собирает направления из отдельных файлов и регистрирует школу
в CONTENT_REGISTRY (см. matrix_app/content/base.py).

Направления:
    general_medicine  — Лечебное дело
    dentistry         — Стоматология
    pediatrics        — Педиатрия
    nursing           — Высшее сестринское дело
    cosmetology       — Косметология
"""
from __future__ import annotations

from ..base import register_school

from .general_medicine import DIRECTION as GENERAL_MEDICINE
from .dentistry import DIRECTION as DENTISTRY
from .pediatrics import DIRECTION as PEDIATRICS
from .nursing import DIRECTION as NURSING
from .cosmetology import DIRECTION as COSMETOLOGY


# =============================================================================
# Реестр направлений школы
# =============================================================================

DIRECTIONS: dict = {
    "general-medicine": GENERAL_MEDICINE,
    "dentistry":        DENTISTRY,
    "pediatrics":       PEDIATRICS,
    "nursing":          NURSING,
    "cosmetology":      COSMETOLOGY,
}


# =============================================================================
# Общая информация о школе
# =============================================================================

SCHOOL_INFO: dict = {
    "intro": (
        "Медицина — одна из самых матричных областей. Диагностика, "
        "биомеханика, эпидемиология и фармакокинетика — всё это "
        "многомерные данные, которые естественным образом укладываются "
        "в матрицы и векторы. Понимание линейной алгебры даёт врачу "
        "инструмент для работы с неопределённостью: от байесовской "
        "диагностики до расчёта напряжений в тканях."
    ),
    "highlights": [
        "Байесовская диагностика по матрице «симптом × диагноз»",
        "Биомеханика тканей через тензор напряжений",
        "Марковские модели течения болезни и ухода",
        "Корреляционные матрицы и факторный анализ в эпидемиологии",
    ],
}


# =============================================================================
# Регистрация школы в общем реестре
# =============================================================================

register_school(
    school_slug="medicine",
    directions=DIRECTIONS,
    school_info=SCHOOL_INFO,
)