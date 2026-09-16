"""
Базовые структуры для контента школ и направлений.

Содержит:
    • реестр CONTENT_REGISTRY — единая точка доступа;
    • get_direction_content() — с fallback на автогенерацию;
    • get_school_content()    — с fallback на дефолт;
    • build_notation_from_formula() — парсит LaTeX и достаёт символы;
    • build_conditions_from_operation() — генерирует условия;
    • build_default_visualization() — выбирает SVG по операции.

Формат контента направления (все поля опциональны):

    DIRECTIONS = {
        "<direction_slug>": {
            "intro": "...",
            "theory": [
                {
                    "slug": "why",
                    "title": "Зачем это нужно",
                    "icon": "sparkles",
                    "blocks": [
                        # см. ТИПЫ БЛОКОВ ниже
                    ],
                },
                ...
            ],
            "notation": [
                {"symbol": "A", "meaning": "...", "example": "..."},
                ...
            ],
            "conditions": [
                {"ok": True,  "text": "..."},
                {"ok": False, "text": "..."},
            ],
            "solved_examples": [
                {
                    "title": "...",
                    "matrix": [[1, 0], [0, 1]],
                    "operation": "determinant",
                    "note": "...",
                    "steps": [
                        {"title": "...", "text": "...", "latex": "..."},
                    ],
                    "result": "...",
                },
            ],
            "visualizations": [
                {
                    "type": "svg",
                    "name": "rotation-3d",
                    "caption": "...",
                    "aria": "...",
                    "placement": "top",
                },
            ],
            "related": [
                {"school": "engineering", "direction": "mechatronics",
                 "title": "Мехатроника", "reason": "..."},
            ],
        },
    }

ТИПЫ БЛОКОВ (поле "type" внутри "blocks"):

    {"type": "text",         "content": "..."}
    {"type": "text",         "content": "...", "lead": True}
    {"type": "formula",      "label": "...",   "latex": "..."}
    {"type": "formula",      "label": "...",   "latex": "...", "note": "..."}
    {"type": "note",         "content": "..."}
    {"type": "warning",      "content": "..."}
    {"type": "list",         "items": ["...", "..."]}
    {"type": "ordered",      "items": ["...", "..."]}
    {"type": "example",      "title": "...",   "latex": "...", "text": "..."}
    {"type": "definition_list", "items": [{"term": "...", "definition": "..."}]}
    {"type": "history",      "content": "..."}
    {"type": "algorithm",    "title": "...",   "steps": ["...", "..."]}
    {"type": "connection",   "title": "...",   "text": "...",
                             "url_name": "matrix_app:theory"}
    {"type": "premium_visual", "visual": {"type": "svg", "name": "...",
                                          "caption": "..."}}
"""
from __future__ import annotations

import json
import re
from typing import Any


# =============================================================================
# Реестр — сюда подключаются школы
# =============================================================================

CONTENT_REGISTRY: dict[str, dict[str, Any]] = {}


def register_school(school_slug: str,
                    directions: dict[str, Any],
                    school_info: dict[str, Any] | None = None) -> None:
    """Зарегистрировать контент школы в реестре."""
    CONTENT_REGISTRY[school_slug] = {
        "directions": directions or {},
        "info": school_info or {},
    }


# =============================================================================
# Обогащение разобранных примеров
# =============================================================================

def _matrix_to_latex(matrix: Any) -> str:
    """Преобразовать матрицу (list[list] или JSON-строку) в LaTeX pmatrix.

    Возвращает строку вида:
        "\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}"

    Если преобразовать не удалось — возвращает "".
    Никогда не бросает исключений.
    """
    if matrix is None:
        return ""

    if isinstance(matrix, str):
        raw = matrix.strip()
        if not raw:
            return ""
        try:
            matrix = json.loads(raw)
        except (ValueError, TypeError):
            return ""

    if not isinstance(matrix, list) or not matrix:
        return ""

    if not isinstance(matrix[0], list):
        matrix = [matrix]

    rows: list[str] = []
    for row in matrix:
        if not isinstance(row, list):
            continue
        rows.append(" & ".join(str(v) for v in row))

    if not rows:
        return ""

    body = r" \\ ".join(rows)
    return r"\begin{pmatrix} " + body + r" \end{pmatrix}"


def _enrich_solved_examples(examples: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Добавить к каждому примеру поля matrix_latex и matrix_json.

    Идемпотентно: если поля уже есть — перезаписываются.
    Примеры без matrix остаются без изменений.
    """
    if not examples:
        return []

    enriched: list[dict[str, Any]] = []
    for ex in examples:
        item = dict(ex)
        matrix = item.get("matrix")
        if matrix is not None:
            item["matrix_latex"] = _matrix_to_latex(matrix)
            try:
                item["matrix_json"] = json.dumps(matrix, ensure_ascii=False)
            except (TypeError, ValueError):
                item["matrix_json"] = ""
        enriched.append(item)
    return enriched


# =============================================================================
# Доступ к контенту
# =============================================================================

def get_direction_content(school_slug: str,
                          direction: dict[str, Any]) -> dict[str, Any]:
    """Вернуть контент направления: явный из реестра или сгенерированный.

    Всегда возвращает словарь со всеми ключами:
        intro, theory, notation, conditions,
        solved_examples, visualizations, related

    solved_examples дополнительно обогащаются полями
    matrix_latex и matrix_json — их использует direction.html.
    """
    direction_slug = direction.get("slug", "")
    school = CONTENT_REGISTRY.get(school_slug, {})
    explicit = (school.get("directions") or {}).get(direction_slug, {})

    raw_examples = (
        explicit.get("solved_examples")
        or _default_solved_examples(direction)
    )

    return {
        "intro":            explicit.get("intro") or "",
        "theory":           explicit.get("theory")
                              or _default_theory(direction),
        "notation":         explicit.get("notation")
                              or build_notation_from_formula(direction),
        "conditions":       explicit.get("conditions")
                              or build_conditions_from_operation(direction),
        "solved_examples":  _enrich_solved_examples(raw_examples),
        "visualizations":   explicit.get("visualizations")
                              or build_default_visualization(direction),
        "related":          explicit.get("related") or [],
    }


def get_school_content(school_slug: str,
                       school: dict[str, Any]) -> dict[str, Any]:
    """Вернуть контент школы: явный из реестра или сгенерированный."""
    school_reg = CONTENT_REGISTRY.get(school_slug, {})
    explicit = school_reg.get("info") or {}

    directions = school.get("directions") or []
    return {
        "intro":      explicit.get("intro")
                        or school.get("subtitle", ""),
        "highlights": explicit.get("highlights")
                        or _default_school_highlights(school),
        "stats":      explicit.get("stats")
                        or {
                            "directions_count": len(directions),
                            "formulas_count": len(directions),
                            "examples_count": len(directions),
                        },
    }


# =============================================================================
# Автогенерация: теория
# =============================================================================

def _default_theory(direction: dict[str, Any]) -> list[dict[str, Any]]:
    """Базовый блок теории — из того, что уже есть в direction."""
    blocks: list[dict[str, Any]] = []

    intro_paragraphs = []
    if direction.get("tagline"):
        intro_paragraphs.append({
            "type": "text",
            "content": direction["tagline"],
            "lead": True,
        })
    if direction.get("description"):
        intro_paragraphs.append({
            "type": "text",
            "content": direction["description"],
        })

    if intro_paragraphs:
        blocks.append({
            "slug": "introduction",
            "title": "Зачем это нужно",
            "icon": "sparkles",
            "blocks": intro_paragraphs,
        })

    if direction.get("formula"):
        formula_blocks: list[dict[str, Any]] = [
            {"type": "text", "content": "Ключевая формула этого направления:"},
            {
                "type": "formula",
                "label": "Ключевая формула",
                "latex": direction["formula"],
            },
        ]
        if direction.get("formula_note"):
            formula_blocks.append({
                "type": "note",
                "content": direction["formula_note"],
            })
        blocks.append({
            "slug": "key-formula",
            "title": "Ключевая формула",
            "icon": "sigma",
            "blocks": formula_blocks,
        })

    if direction.get("uses"):
        blocks.append({
            "slug": "applications",
            "title": "Конкретные применения",
            "icon": "check-badge",
            "blocks": [
                {"type": "list", "items": list(direction["uses"])},
            ],
        })

    return blocks


# =============================================================================
# Автогенерация: обозначения
# =============================================================================

_LATEX_SYMBOLS = {
    r"\lambda":     ("λ", "собственное значение", "скаляр, при котором Av = λv"),
    r"\theta":      ("θ", "угол поворота", "измеряется в радианах"),
    r"\alpha":      ("α", "угол вокруг оси X", "первый угол Эйлера"),
    r"\beta":       ("β", "угол вокруг оси Y", "второй угол Эйлера"),
    r"\gamma":      ("γ", "угол вокруг оси Z", "третий угол Эйлера"),
    r"\Sigma":      ("Σ", "матрица сингулярных чисел или ковариации",
                     "диагональная или симметричная"),
    r"\sigma":      ("σ", "напряжение или сингулярное число",
                     "скаляр или вектор"),
    r"\varepsilon": ("ε", "деформация", "относительное удлинение"),
    r"\mu":         ("μ", "среднее значение или вязкость", "скаляр"),
    r"\rho":        ("ρ", "плотность или корреляция", "скаляр"),
    r"\det":        ("det", "определитель",
                     "число, характеризующее объём"),
    r"\operatorname{tr}": ("tr", "след матрицы",
                           "сумма диагональных элементов"),
    r"\operatorname{rank}": ("rank", "ранг матрицы",
                             "число линейно независимых строк"),
    r"\mathbf{1}":  ("1", "вектор из единиц", "вектор-столбец из 1"),
    r"\mid":        ("|", "условная вероятность", "P(A|B)"),
}


def build_notation_from_formula(direction: dict[str, Any]) -> list[dict[str, str]]:
    """Извлечь обозначения из LaTeX-формулы + добавить базовые."""
    formula = direction.get("formula", "") or ""
    used_symbols: list[dict[str, str]] = []
    seen: set[str] = set()

    for latex, (sym, meaning, example) in _LATEX_SYMBOLS.items():
        if latex in formula and sym not in seen:
            used_symbols.append({
                "symbol":  sym,
                "meaning": meaning,
                "example": example,
            })
            seen.add(sym)

    matrix_letters = {
        "A": "матрица системы или преобразования",
        "B": "матрица связей или инцидентности",
        "C": "матрица связности или выходная матрица",
        "D": "диагональная матрица или матрица выравнивания",
        "E": "матрица ошибок или единичная",
        "F": "матрица потоков или частот",
        "K": "матрица жёсткости",
        "M": "матрица масс или метрика",
        "P": "матрица переходов или проекции",
        "R": "матрица поворота или ковариации",
        "S": "матрица состояний или баллов",
        "T": "матрица переходов",
        "W": "матрица весов",
        "X": "матрица данных",
        "Y": "матрица результатов",
    }

    for letter, meaning in matrix_letters.items():
        pattern = r"\b" + letter + r"\b"
        if re.search(pattern, formula) and letter not in seen:
            used_symbols.append({
                "symbol":  letter,
                "meaning": meaning,
                "example": "матрица",
            })
            seen.add(letter)

    if not used_symbols:
        used_symbols = [
            {"symbol": "A", "meaning": "основная матрица задачи",
             "example": "квадратная n × n"},
            {"symbol": "x", "meaning": "вектор неизвестных или входных данных",
             "example": "вектор-столбец"},
            {"symbol": "b", "meaning": "вектор правой части или результат",
             "example": "вектор-столбец"},
        ]

    return used_symbols


# =============================================================================
# Автогенерация: условия применимости
# =============================================================================

_CONDITIONS_BY_OPERATION = {
    "determinant": [
        {"ok": True,  "text": "Матрица должна быть квадратной: m = n"},
        {"ok": True,  "text": "Определитель может быть любым числом"},
        {"ok": False, "text": "Для прямоугольных матриц не определён"},
    ],
    "inverse": [
        {"ok": True,  "text": "Матрица должна быть квадратной: m = n"},
        {"ok": True,  "text": "det A ≠ 0 — матрица невырожденная"},
        {"ok": False, "text": "Вырожденные матрицы не имеют обратной"},
    ],
    "rank": [
        {"ok": True,  "text": "Матрица любой формы: m × n"},
        {"ok": True,  "text": "Подходит и для прямоугольных, и для квадратных"},
        {"ok": False, "text": "Ранг не превосходит min(m, n)"},
    ],
    "transpose": [
        {"ok": True,  "text": "Матрица любой формы: m × n"},
        {"ok": True,  "text": "Результат — матрица n × m"},
    ],
    "trace": [
        {"ok": True,  "text": "Матрица должна быть квадратной: m = n"},
        {"ok": True,  "text": "След — сумма диагональных элементов"},
        {"ok": False, "text": "Для прямоугольных матриц не определён"},
    ],
    "lu": [
        {"ok": True,  "text": "Матрица должна быть квадратной: m = n"},
        {"ok": True,  "text": "det A ≠ 0 — иначе возможны перестановки (LUP)"},
        {"ok": True,  "text": "Результат: A = L · U"},
    ],
    "qr": [
        {"ok": True,  "text": "Матрица любой формы: m ≥ n"},
        {"ok": True,  "text": "Столбцы должны быть линейно независимы"},
        {"ok": True,  "text": "Результат: A = Q · R"},
    ],
    "cholesky": [
        {"ok": True,  "text": "Матрица должна быть квадратной и симметричной"},
        {"ok": True,  "text": "Все собственные значения положительны"},
        {"ok": False, "text": "Не подходит для несимметричных матриц"},
    ],
    "eigenvalues": [
        {"ok": True,  "text": "Матрица должна быть квадратной: m = n"},
        {"ok": True,  "text": "Работает для вещественных и комплексных матриц"},
    ],
    "eigenvectors": [
        {"ok": True,  "text": "Матрица должна быть квадратной: m = n"},
        {"ok": True,  "text": "Для кратных λ может быть несколько векторов"},
    ],
    "char_poly": [
        {"ok": True,  "text": "Матрица должна быть квадратной: m = n"},
        {"ok": True,  "text": "Степень многочлена равна размеру матрицы"},
    ],
    "diagonalize": [
        {"ok": True,  "text": "Матрица должна быть квадратной: m = n"},
        {"ok": True,  "text": "Все λ должны иметь полный набор векторов"},
        {"ok": False, "text": "Дефектные матрицы не диагонализируются"},
    ],
    "properties": [
        {"ok": True,  "text": "Матрица любой формы"},
        {"ok": True,  "text": "Определитель и обратная — только для квадратных"},
        {"ok": True,  "text": "Ранг и транспонирование — для любых"},
    ],
    "add": [
        {"ok": True,  "text": "Обе матрицы должны быть одного размера: m × n"},
    ],
    "multiply": [
        {"ok": True,  "text": "cols(A) должно равняться rows(B)"},
        {"ok": True,  "text": "Порядок важен: A·B ≠ B·A"},
    ],
    "subtract": [
        {"ok": True,  "text": "Обе матрицы должны быть одного размера: m × n"},
    ],
}


def build_conditions_from_operation(direction: dict[str, Any]) -> list[dict[str, Any]]:
    """Вернуть условия применимости по коду операции."""
    op = direction.get("operation", "")
    return _CONDITIONS_BY_OPERATION.get(op, [
        {"ok": True,  "text": "Матрица должна быть корректно заполнена"},
        {"ok": True,  "text": "Значения могут быть числами, дробями, выражениями"},
        {"ok": False, "text": "Пустые ячейки не допускаются"},
    ])


# =============================================================================
# Автогенерация: разобранные примеры
# =============================================================================

def _default_solved_examples(direction: dict[str, Any]) -> list[dict[str, Any]]:
    """Базовый разобранный пример — из example_slug.

    Если у направления есть example_slug и operation, но нет
    собственных solved_examples, генерируем один общий пример.
    Матрицу для него подставит сам контент направления через matrix
    (если она есть), иначе пример отрисуется без блока «Исходные данные».
    """
    example_slug = direction.get("example_slug", "")
    if not example_slug:
        return []

    return [
        {
            "title": f"Пример: {direction.get('title', '')}",
            "example_slug": example_slug,
            "operation": direction.get("operation", "determinant"),
            "note": direction.get("formula_note", ""),
        }
    ]


# =============================================================================
# Автогенерация: визуализация
# =============================================================================

_VISUALIZATION_BY_OPERATION = {
    "determinant":      "determinant-volume",
    "inverse":          "inverse-mapping",
    "rank":             "rank-deficiency",
    "transpose":        "transpose-mirror",
    "trace":            "trace-diagonal",
    "eigenvalues":      "eigen-directions",
    "eigenvectors":     "eigen-directions",
    "char_poly":        "char-poly-curve",
    "lu":               "lu-triangular",
    "qr":               "qr-orthogonal",
    "cholesky":         "cholesky-llt",
    "diagonalize":      "diagonalization",
    "properties":       "matrix-properties",
    "add":              "matrix-addition",
    "multiply":         "matrix-multiplication",
    "subtract":         "matrix-subtraction",
    "scalar_multiply":  "scalar-multiplication",
    "power":            "matrix-power",
    "compare":          "matrix-compare",
}


def build_default_visualization(direction: dict[str, Any]) -> list[dict[str, Any]]:
    """Выбрать подходящую SVG-визуализацию по операции."""
    op = direction.get("operation", "")
    slug = _VISUALIZATION_BY_OPERATION.get(op)
    if not slug:
        return []

    return [
        {
            "type":      "svg",
            "name":      slug,
            "caption":   direction.get("formula_note", ""),
            "aria":      f"Схема: {direction.get('title', '')}",
            "placement": "top",
        }
    ]


# =============================================================================
# Дефолты для школы
# =============================================================================

def _default_school_highlights(school: dict[str, Any]) -> list[str]:
    """Ключевые особенности школы — из направлений."""
    directions = school.get("directions") or []
    highlights: list[str] = []
    for d in directions[:4]:
        if d.get("tagline"):
            highlights.append(d["tagline"])
    return highlights


# =============================================================================
# Публичный API пакета
# =============================================================================

__all__ = [
    "CONTENT_REGISTRY",
    "register_school",
    "get_direction_content",
    "get_school_content",
    "build_notation_from_formula",
    "build_conditions_from_operation",
    "build_default_visualization",
]