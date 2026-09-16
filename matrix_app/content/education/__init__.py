"""
Школа образования — сборка контента.

Собирает направления из отдельных файлов и регистрирует школу
в CONTENT_REGISTRY (см. matrix_app/content/base.py).

Направления:
    preschool-education          — Дошкольное образование
    primary-education            — Начальное образование
    korean-philology             — Корейская филология
    english-teaching             — Преподавание английского языка
    history                      — История
    special-pedagogy             — Специальная педагогика
    translation-studies-cn       — Переводоведение (китайский и английский)
    psychology                   — Психология
    philology-russian            — Филология и преподавание языков (русский)
    uzbek-language               — Узбекский язык и литература
    translation-turkish          — Теория и практика перевода (турецкий)
    japanese-philology           — Филология и преподавание языков (японский)
    physical-education           — Физическая культура
"""
from __future__ import annotations

from ..base import register_school

from .preschool_education import DIRECTION as PRESCHOOL_EDUCATION
from .primary_education import DIRECTION as PRIMARY_EDUCATION
from .korean_philology import DIRECTION as KOREAN_PHILOLOGY
from .english_teaching import DIRECTION as ENGLISH_TEACHING
from .history import DIRECTION as HISTORY
from .special_pedagogy import DIRECTION as SPECIAL_PEDAGOGY
from .translation_studies_cn import DIRECTION as TRANSLATION_STUDIES_CN
from .psychology import DIRECTION as PSYCHOLOGY
from .philology_russian import DIRECTION as PHILOLOGY_RUSSIAN
from .uzbek_language import DIRECTION as UZBEK_LANGUAGE
from .translation_turkish import DIRECTION as TRANSLATION_TURKISH
from .japanese_philology import DIRECTION as JAPANESE_PHILOLOGY
from .physical_education import DIRECTION as PHYSICAL_EDUCATION


# =============================================================================
# Реестр направлений школы
# =============================================================================

DIRECTIONS: dict = {
    "preschool-education":      PRESCHOOL_EDUCATION,
    "primary-education":        PRIMARY_EDUCATION,
    "korean-philology":         KOREAN_PHILOLOGY,
    "english-teaching":         ENGLISH_TEACHING,
    "history":                  HISTORY,
    "special-pedagogy":         SPECIAL_PEDAGOGY,
    "translation-studies-cn":   TRANSLATION_STUDIES_CN,
    "psychology":               PSYCHOLOGY,
    "philology-russian":        PHILOLOGY_RUSSIAN,
    "uzbek-language":           UZBEK_LANGUAGE,
    "translation-turkish":      TRANSLATION_TURKISH,
    "japanese-philology":       JAPANESE_PHILOLOGY,
    "physical-education":       PHYSICAL_EDUCATION,
}


# =============================================================================
# Общая информация о школе
# =============================================================================

SCHOOL_INFO: dict = {
    "intro": (
        "Образование — это работа со структурой знаний: как ученики "
        "усваивают материал, какие навыки развиваются вместе, "
        "как организовать обучение. Матрицы помогают увидеть "
        "закономерности в данных, которые не видны при обычном "
        "анализе."
    ),
    "highlights": [
        "Матрицы «ученик × задание» и критериальное оценивание",
        "Семантические матрицы и анализ текстов",
        "Корреляционные матрицы и факторный анализ",
        "Матрицы смежности в исторических исследованиях",
    ],
}


# =============================================================================
# Регистрация школы в общем реестре
# =============================================================================

register_school(
    school_slug="education",
    directions=DIRECTIONS,
    school_info=SCHOOL_INFO,
)