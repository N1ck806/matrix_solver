"""
Шаблонные теги для вставки SVG-иконок и иллюстраций MatrixLab.

Использование:
    {% load matrix_icons %}

    {# Иконка — плоская (ищется во всех папках) #}
    {% icon "plus" size=18 %}
    {% icon "lambda" size=22 variant="cyan" %}
    {% icon "refresh" size=16 extra_class="ml-icon--spin" %}
    {% icon "determinant" size=20 label="Определитель" %}

    {# Логотип из brand/ #}
    {% icon "logo-mark" size=40 %}
    {% icon "logo" size=160 %}
    {% icon "favicon" size=32 %}

    {# Иконка с явным путём (подпапка внутри icons/) #}
    {% icon "features/determinant" size=96 %}
    {% icon "math/lambda" size=22 %}
    {% icon "ui/arrow-right" size=14 %}
    {% icon "hero/hero-transform" size=320 %}
    {% icon "schools/school-engineering" size=180 %}
    {% icon "visuals/pipeline-flow" size=260 %}

    {# Большая иллюстрация #}
    {% illustration "hero-matrix" width=480 height=360 %}
    {% illustration "determinant" width=480 height=360 label="Определитель как площадь" %}
    {% illustration "pipeline-flow" width=800 height=600 %}

    {# Сохранить результат в переменную #}
    {% icon "plus" size=18 as plus_icon %}
    {{ plus_icon }}

    {# Преобразовать матрицу в LaTeX #}
    {{ ex.matrix|matrix_to_latex }}

Поиск {% icon "name" %}:
    1) icons/<name>.svg
    2) icons/brand/<name>.svg
    3) icons/math/<name>.svg
    4) icons/ui/<name>.svg
    5) icons/features/<name>.svg
    6) icons/hero/<name>.svg
    7) icons/steps/<name>.svg
    8) icons/theory/<name>.svg
    9) icons/cta/<name>.svg
    10) icons/schools/<name>.svg
    11) icons/visuals/<name>.svg

Поиск {% icon "sub/name" %}:
    icons/sub/name.svg  — ровно по указанному пути,
    без перебора папок (чтобы не было неоднозначностей).

Поиск {% illustration "name" %}:
    1) illustrations/<name>.svg
    2) icons/visuals/<name>.svg
    3) icons/hero/<name>.svg

Особенности:
    • SVG вставляется inline — работает currentColor, темы, CSS-анимации.
    • Все id внутри SVG получают уникальный префикс (чтобы не конфликтовали
      градиенты при нескольких копиях на странице).
    • Файлы кэшируются в памяти процесса после первого чтения.
    • Имена валидируются: разрешены буквы, цифры, дефис, подчёркивание
      и один уровень вложенности через слэш. Никаких ../, абсолютных путей,
      пробелов, точек.
    • Если name не передан или пустой — тег возвращает пустую строку,
      НЕ роняя всю страницу TemplateSyntaxError'ом.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from django import template
from django.utils.safestring import mark_safe

register = template.Library()


# =============================================================================
# Пути
# =============================================================================

# .../matrix_app/templatetags/matrix_icons.py
# → .../matrix_app/
_APP_DIR = Path(__file__).resolve().parent.parent

# → .../matrix_app/static/matrix_app/
_STATIC_DIR = _APP_DIR / "static" / "matrix_app"

_ICONS_DIR         = _STATIC_DIR / "icons"
_ILLUSTRATIONS_DIR = _STATIC_DIR / "illustrations"

# Известные подпапки icons/ (используются для «плоского» поиска по имени).
_ICON_SUBDIRS = (
    "brand",
    "math",
    "ui",
    "features",
    "hero",
    "steps",
    "theory",
    "cta",
    "schools",
    "visuals",
)

# Порядок поиска для {% icon "name" %} (без слэша):
# сначала корень icons/, затем известные подпапки.
_ICON_SEARCH_PATHS: tuple[Path, ...] = (
    _ICONS_DIR,
    *(_ICONS_DIR / sub for sub in _ICON_SUBDIRS),
)

# Куда искать иллюстрации ({% illustration "name" %}):
# сначала отдельная папка illustrations/, потом visuals/ и hero/.
_ILLUSTRATION_SEARCH_PATHS: tuple[Path, ...] = (
    _ILLUSTRATIONS_DIR,
    _ICONS_DIR / "visuals",
    _ICONS_DIR / "hero",
)


# =============================================================================
# Валидация имён
# =============================================================================

# Разрешено:
#   name          — буквы, цифры, дефис, подчёркивание
#   sub/name      — один уровень вложенности через слэш
# Запрещено: .., / в начале/конце, //, точки, пробелы.
_NAME_RE = re.compile(
    r"""
    ^
    [a-z0-9][a-z0-9_-]*              # первый сегмент
    (?: / [a-z0-9][a-z0-9_-]* )?     # опционально: /второй_сегмент
    $
    """,
    re.IGNORECASE | re.VERBOSE,
)


def _is_safe_name(name: str) -> bool:
    if not name or not _NAME_RE.match(name):
        return False
    if ".." in name or "//" in name:
        return False
    if name.startswith("/") or name.endswith("/"):
        return False
    return True


# =============================================================================
# Чтение файлов (с кэшем)
# =============================================================================

@lru_cache(maxsize=1024)
def _read_svg(path_str: str) -> str | None:
    """Читает SVG-файл и кэширует содержимое. None — если файла нет."""
    path = Path(path_str)
    if not path.is_file():
        return None
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def _read_svg_at(base: Path, name: str) -> tuple[str, str] | None:
    """
    Пробует прочитать <base>/<name>.svg.
    Возвращает (содержимое, путь) или None.
    """
    path = base / f"{name}.svg"
    content = _read_svg(str(path))
    if content is None:
        return None
    return content, str(path)


def _find_svg(
    name: str,
    search_paths: tuple[Path, ...],
) -> tuple[str, str] | None:
    """
    Ищет SVG по имени в указанных директориях.

    • Если name содержит слэш ('hero/hero-transform') — ищет ровно
      по пути icons/hero/hero-transform.svg (первая и единственная попытка).
    • Иначе перебирает search_paths по очереди.

    Возвращает (содержимое, путь) или None.
    """
    if not _is_safe_name(name):
        return None

    if "/" in name:
        root = search_paths[0] if search_paths else None
        if root is None:
            return None
        return _read_svg_at(root, name)

    for base in search_paths:
        found = _read_svg_at(base, name)
        if found is not None:
            return found

    return None


def _find_icon(name: str) -> tuple[str, str] | None:
    """Ищет иконку в icons/ и известных подпапках."""
    return _find_svg(name, _ICON_SEARCH_PATHS)


def _find_illustration(name: str) -> tuple[str, str] | None:
    """
    Ищет иллюстрацию:
        1) illustrations/<name>.svg
        2) icons/visuals/<name>.svg
        3) icons/hero/<name>.svg

    Слэш в имени не поддерживаем — только имя файла.
    """
    if "/" in name:
        return None
    return _find_svg(name, _ILLUSTRATION_SEARCH_PATHS)


# =============================================================================
# Постобработка SVG
# =============================================================================

_ID_ATTR_RE    = re.compile(r'\bid="([^"]+)"')
_URL_REF_RE    = re.compile(r'url\(#([^)]+)\)')
_HREF_REF_RE   = re.compile(r'\bxlink:href="#([^"]+)"')
_HREF_PLAIN_RE = re.compile(r'\bhref="#([^"]+)"')


def _prefix_svg_ids(svg: str, prefix: str) -> str:
    """
    Добавляет префикс ко всем id и ссылкам на них (url(#id), href="#id").

    Нужно, чтобы несколько копий одной иконки на странице
    не конфликтовали за градиенты и маски.

    Пример:
        id="ml-plus-bg"  →  id="i7-plus-ml-plus-bg"
        url(#ml-plus-bg) →  url(#i7-plus-ml-plus-bg)
    """
    if not prefix:
        return svg

    ids = set(_ID_ATTR_RE.findall(svg))
    if not ids:
        return svg

    def _sub_url(m: re.Match) -> str:
        ref = m.group(1)
        return f"url(#{prefix}{ref})" if ref in ids else m.group(0)

    def _sub_href(m: re.Match) -> str:
        ref = m.group(1)
        if ref in ids:
            return m.group(0).replace(f"#{ref}", f"#{prefix}{ref}")
        return m.group(0)

    svg = _URL_REF_RE.sub(_sub_url, svg)
    svg = _HREF_REF_RE.sub(_sub_href, svg)
    svg = _HREF_PLAIN_RE.sub(_sub_href, svg)

    def _sub_id(m: re.Match) -> str:
        return f'id="{prefix}{m.group(1)}"'

    return _ID_ATTR_RE.sub(_sub_id, svg)


def _strip_xml_declaration(svg: str) -> str:
    """Убирает <?xml ...?> и <!DOCTYPE ...> — они ломают inline SVG."""
    svg = svg.lstrip()

    if svg.startswith("<?xml"):
        end = svg.find("?>")
        if end != -1:
            svg = svg[end + 2:].lstrip()

    if svg.startswith("<!DOCTYPE"):
        end = svg.find(">")
        if end != -1:
            svg = svg[end + 1:].lstrip()

    return svg


def _inject_title(svg: str, label: str) -> str:
    """Вставляет <title> сразу после открывающего тега <svg>."""
    if not label:
        return svg

    open_end = svg.find(">")
    if open_end == -1:
        return svg

    title = f"<title>{label}</title>"
    return svg[: open_end + 1] + title + svg[open_end + 1:]


def _escape_attr(value: str) -> str:
    """Минимальное экранирование для значений HTML-атрибутов."""
    return (
        value.replace("&", "&amp;")
             .replace('"', "&quot;")
             .replace("<", "&lt;")
             .replace(">", "&gt;")
    )


# =============================================================================
# Сборка HTML
# =============================================================================

def _build_icon_html(
    svg: str,
    *,
    name: str,
    size: int,
    variant: str,
    extra_class: str,
    label: str,
    prefix: str,
) -> str:
    svg = _strip_xml_declaration(svg)
    svg = _prefix_svg_ids(svg, prefix)

    classes = ["ml-icon"]
    if variant:
        classes.append(f"ml-icon--{variant}")
    if extra_class:
        classes.extend(extra_class.split())

    style = f"--icon-size:{size}px;font-size:{size}px;"

    if label:
        safe_label = _escape_attr(label)
        a11y = f'role="img" aria-label="{safe_label}"'
        svg = _inject_title(svg, safe_label)
    else:
        a11y = 'aria-hidden="true"'

    return (
        f'<span class="{" ".join(classes)}" '
        f'style="{style}" '
        f'data-icon="{_escape_attr(name)}" {a11y}>'
        f"{svg}"
        f"</span>"
    )


def _build_illustration_html(
    svg: str,
    *,
    name: str,
    width: int,
    height: int,
    extra_class: str,
    label: str,
    prefix: str,
) -> str:
    svg = _strip_xml_declaration(svg)
    svg = _prefix_svg_ids(svg, prefix)

    classes = ["ml-illustration"]
    if extra_class:
        classes.extend(extra_class.split())

    if label:
        safe_label = _escape_attr(label)
        a11y = f'role="img" aria-label="{safe_label}"'
        svg = _inject_title(svg, safe_label)
    else:
        a11y = 'aria-hidden="true"'

    style = f"max-width:{width}px;width:100%;height:auto;"

    return (
        f'<div class="{" ".join(classes)}" '
        f'style="{style}" '
        f'data-illustration="{_escape_attr(name)}" {a11y}>'
        f"{svg}"
        f"</div>"
    )


# =============================================================================
# Уникальный префикс для id
# =============================================================================

_icon_counter = {"n": 0}


def _next_prefix(name: str) -> str:
    """
    Уникальный префикс для id внутри SVG.

    Формат: 'i<N>-<name>-', например 'i7-plus-'.
    Слэши и прочие небезопасные символы из имени удаляются.
    """
    _icon_counter["n"] += 1
    safe_name = re.sub(r"[^a-z0-9]", "", name.lower()) or "icon"
    return f"i{_icon_counter['n']}-{safe_name}-"


# =============================================================================
# Публичные теги
# =============================================================================

@register.simple_tag(name="icon")
def icon(
    name: str = "",
    size: int = 20,
    variant: str = "",
    extra_class: str = "",
    label: str = "",
) -> str:
    """
    Вставляет SVG-иконку inline.

    Если name пустой или невалидный — возвращает пустую строку.
    Если иконка не найдена — возвращает невидимую заглушку с
    data-icon="<name>" (удобно ловить в DevTools).
    """
    if not name or not _is_safe_name(str(name)):
        return ""

    found = _find_icon(str(name))
    if found is None:
        return mark_safe(
            f'<span class="ml-icon ml-icon--missing" '
            f'data-icon="{_escape_attr(str(name))}" aria-hidden="true"></span>'
        )

    svg, _path = found
    prefix = _next_prefix(str(name))

    return mark_safe(
        _build_icon_html(
            svg,
            name=str(name),
            size=int(size),
            variant=variant or "",
            extra_class=extra_class or "",
            label=label or "",
            prefix=prefix,
        )
    )


@register.simple_tag(name="illustration")
def illustration(
    name: str = "",
    width: int = 480,
    height: int = 360,
    extra_class: str = "",
    label: str = "",
) -> str:
    """
    Вставляет большую SVG-иллюстрацию inline.

    Ищет по путям:
        1) illustrations/<name>.svg
        2) icons/visuals/<name>.svg
        3) icons/hero/<name>.svg
    """
    if not name or not _is_safe_name(str(name)):
        return ""

    found = _find_illustration(str(name))
    if found is None:
        return mark_safe(
            f'<div class="ml-illustration ml-illustration--missing" '
            f'data-illustration="{_escape_attr(str(name))}" '
            f'aria-hidden="true"></div>'
        )

    svg, _path = found
    prefix = _next_prefix(str(name))

    return mark_safe(
        _build_illustration_html(
            svg,
            name=str(name),
            width=int(width),
            height=int(height),
            extra_class=extra_class or "",
            label=label or "",
            prefix=prefix,
        )
    )


@register.simple_tag(name="icon_exists")
def icon_exists(name: str = "") -> bool:
    """Проверяет, существует ли иконка (с учётом подпапок)."""
    if not name or not _is_safe_name(str(name)):
        return False
    return _find_icon(str(name)) is not None


@register.simple_tag(name="illustration_exists")
def illustration_exists(name: str = "") -> bool:
    """Проверяет, существует ли иллюстрация."""
    if not name or not _is_safe_name(str(name)):
        return False
    return _find_illustration(str(name)) is not None


@register.simple_tag(name="clear_icon_cache")
def clear_icon_cache() -> str:
    """
    Сбрасывает кэш прочитанных SVG.
    Полезно в dev: {% clear_icon_cache %} после добавления новых иконок.
    """
    _read_svg.cache_clear()
    return ""


# =============================================================================
# Фильтры
# =============================================================================

@register.filter(name="matrix_to_latex")
def matrix_to_latex(value) -> str:
    """
    Преобразовать матрицу (list[list] или JSON-строку) в LaTeX pmatrix.

    Поддерживает:
        • list[list]  — возвращает готовый LaTeX;
        • строку JSON — предварительно парсит;
        • None / []   — возвращает пустую строку.

    Пример:
        {{ ex.matrix|matrix_to_latex }}
        → \\begin{pmatrix} 100 & 0 & 0 \\\\ 0 & 200 & 0 \\\\ 0 & 0 & 300 \\end{pmatrix}
    """
    if value is None:
        return ""

    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return ""
        try:
            value = json.loads(raw)
        except (ValueError, TypeError):
            return ""

    if not isinstance(value, list) or not value:
        return ""

    if not isinstance(value[0], list):
        value = [value]

    rows: list[str] = []
    for row in value:
        if not isinstance(row, list):
            continue
        cells = [str(v) for v in row]
        rows.append(" & ".join(cells))

    if not rows:
        return ""

    body = r" \\ ".join(rows)
    return r"\begin{pmatrix} " + body + r" \end{pmatrix}"