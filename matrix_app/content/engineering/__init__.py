"""
Инженерная школа — сборка контента.

Собирает направления из отдельных файлов и регистрирует школу
в CONTENT_REGISTRY (см. matrix_app/content/base.py).

Направления:
    architecture                 — Архитектура и градостроительство
    construction                 — Строительство
    engineering-communications   — Строительство и монтаж инженерных коммуникаций
    alternative-energy           — Альтернативная энергетика
    space-technology             — Космические технологии
    elevator-engineering         — Лифтовое машиностроение
    road-traffic                 — Управление дорожным движением
    sustainable-transport        — Устойчивый транспорт
    electrical-engineering       — Электротехника
    mechatronics                 — Мехатроника
    mechanical-engineering       — Технология машиностроения
    industrial-engineering       — Промышленная инженерия и менеджмент
    biotechnology                — Биотехнология
    information-systems          — Инженерия информационных систем
    information-technology       — Информационные системы и технологии
    software-engineering         — Программная инженерия
    computer-engineering         — Компьютерная инженерия
    applied-mathematics          — Прикладная математика
    artificial-intelligence      — Искусственный интеллект

ВАЖНО: пока не созданы все файлы, закомментированные импорты
и записи в DIRECTIONS должны оставаться закомментированными.
По мере создания файлов — раскомментируй их.
"""
from __future__ import annotations

from ..base import register_school

from .architecture import DIRECTION as ARCHITECTURE
from .construction import DIRECTION as CONSTRUCTION
from .engineering_communications import DIRECTION as ENGINEERING_COMMUNICATIONS
from .alternative_energy import DIRECTION as ALTERNATIVE_ENERGY
from .space_technology import DIRECTION as SPACE_TECHNOLOGY
from .elevator_engineering import DIRECTION as ELEVATOR_ENGINEERING
from .road_traffic import DIRECTION as ROAD_TRAFFIC
from .sustainable_transport import DIRECTION as SUSTAINABLE_TRANSPORT
from .electrical_engineering import DIRECTION as ELECTRICAL_ENGINEERING
from .mechatronics import DIRECTION as MECHATRONICS
from .mechanical_engineering import DIRECTION as MECHANICAL_ENGINEERING
from .industrial_engineering import DIRECTION as INDUSTRIAL_ENGINEERING
from .biotechnology import DIRECTION as BIOTECHNOLOGY
from .information_systems import DIRECTION as INFORMATION_SYSTEMS
from .information_technology import DIRECTION as INFORMATION_TECHNOLOGY
from .software_engineering import DIRECTION as SOFTWARE_ENGINEERING
from .computer_engineering import DIRECTION as COMPUTER_ENGINEERING
from .applied_mathematics import DIRECTION as APPLIED_MATHEMATICS
from .artificial_intelligence import DIRECTION as ARTIFICIAL_INTELLIGENCE


# =============================================================================
# Реестр направлений школы
# =============================================================================

DIRECTIONS: dict = {
    "architecture": ARCHITECTURE,
    "construction":                CONSTRUCTION,
    "engineering-communications":  ENGINEERING_COMMUNICATIONS,
    "alternative-energy":          ALTERNATIVE_ENERGY,
    "space-technology":            SPACE_TECHNOLOGY,
    "elevator-engineering":        ELEVATOR_ENGINEERING,
    "road-traffic":                ROAD_TRAFFIC,
    "sustainable-transport":       SUSTAINABLE_TRANSPORT,
    "electrical-engineering":      ELECTRICAL_ENGINEERING,
    "mechatronics":                MECHATRONICS,
    "mechanical-engineering":      MECHANICAL_ENGINEERING,
    "industrial-engineering":      INDUSTRIAL_ENGINEERING,
    "biotechnology":               BIOTECHNOLOGY,
    "information-systems":         INFORMATION_SYSTEMS,
    "information-technology":      INFORMATION_TECHNOLOGY,
    "software-engineering":        SOFTWARE_ENGINEERING,
    "computer-engineering":        COMPUTER_ENGINEERING,
    "applied-mathematics":         APPLIED_MATHEMATICS,
    "artificial-intelligence":     ARTIFICIAL_INTELLIGENCE,
}


# =============================================================================
# Общая информация о школе
# =============================================================================

SCHOOL_INFO: dict = {
    "intro": (
        "Инженерия — это язык матриц. Напряжения в конструкциях, "
        "потоки в сетях, устойчивость систем, обработка сигналов — "
        "всё это многомерные задачи, которые естественно "
        "укладываются в матрицы и векторы. Понимание линейной "
        "алгебры даёт инженеру инструмент для расчёта и "
        "проектирования."
    ),
    "highlights": [
        "Матрицы жёсткости и метод конечных элементов",
        "Матрицы потоков в энергетике и транспорте",
        "Собственные значения для анализа устойчивости",
        "Эмбеддинги и нейросети в современной инженерии",
    ],
}


# =============================================================================
# Регистрация школы в общем реестре
# =============================================================================

register_school(
    school_slug="engineering",
    directions=DIRECTIONS,
    school_info=SCHOOL_INFO,
)