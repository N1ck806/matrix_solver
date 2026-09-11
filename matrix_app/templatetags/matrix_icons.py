"""
Template tags для SVG-иконок MatrixLab.

Использование:
    {% load matrix_icons %}
    {% icon "calculator" %}
    {% icon "matrix" size=32 class="my-class" %}
"""
from __future__ import annotations

from django import template
from django.utils.safestring import mark_safe

register = template.Library()


_ICONS: dict[str, str] = {
    # Навигация
    "home": '<path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"/>',
    "calculator": '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8"/><path d="M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/>',
    "layers": '<path d="M12 2L2 7l10 5 10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
    "check": '<path d="M20 6L9 17l-5-5"/>',
    "check-circle": '<circle cx="12" cy="12" r="9"/><path d="M9 12l2 2 4-4"/>',
    "list": '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="4" cy="18" r="1.5"/>',
    "grid": '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    "activity": '<polyline points="3 12 7 12 10 4 14 20 17 12 21 12"/>',
    "book": '<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 0-4 4z"/><path d="M4 4v16"/>',
    "book-open": '<path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z"/><path d="M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z"/>',
    "hash": '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
    "history": '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><polyline points="3 3 3 8 8 8"/><polyline points="12 7 12 12 15 14"/>',
    "info": '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    "clock": '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    "menu": '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
    "close": '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',

    # Тема
    "sun": '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
    "moon": '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',

    # Действия
    "arrow-right": '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/>',
    "arrow-left": '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="11 6 5 12 11 18"/>',
    "arrow-down": '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="6 13 12 19 18 13"/>',
    "copy": '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    "clipboard": '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
    "download": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    "upload": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    "trash": '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
    "edit": '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/>',
    "refresh": '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    "search": '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    "plus": '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    "minus": '<line x1="5" y1="12" x2="19" y2="12"/>',
    "settings": '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',

    # Математика — матрицы
    "matrix": '<path d="M3 4h3v16H3zM21 4h-3v16h3z"/><circle cx="10" cy="9" r="1"/><circle cx="14" cy="9" r="1"/><circle cx="10" cy="15" r="1"/><circle cx="14" cy="15" r="1"/>',
    "matrix-grid": '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>',
    "brackets": '<path d="M7 4H4v16h3M17 4h3v16h-3"/>',

    # Математика — операции
    "determinant": '<path d="M4 3v18M20 3v18"/><path d="M8 7l8 10M8 17l8-10"/>',
    "rank": '<rect x="4" y="4" width="16" height="4" rx="0.5"/><rect x="4" y="10" width="10" height="4" rx="0.5"/><rect x="4" y="16" width="6" height="4" rx="0.5"/>',
    "inverse": '<path d="M4 3v18M20 3v18"/><text x="12" y="17" font-size="13" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">-1</text>',
    "transpose": '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M11 11l2 2"/>',
    "trace": '<path d="M4 3v18M20 3v18"/><line x1="7" y1="7" x2="17" y2="17" stroke-dasharray="2 2"/>',
    "lambda": '<path d="M8 20L14 4M14 4l6 16M9 15h6"/>',
    "vector": '<line x1="4" y1="20" x2="20" y2="4"/><polyline points="14 4 20 4 20 10"/>',
    "sigma": '<path d="M19 4H5l8 8-8 8h14"/>',
    "system": '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="20" cy="6" r="0.6"/><circle cx="20" cy="12" r="0.6"/><circle cx="20" cy="18" r="0.6"/>',
    "equation": '<path d="M4 8h16M4 16h16"/><path d="M9 4v4M9 16v4M15 4v4M15 16v4"/>',

    # Разложения
    "lu": '<path d="M3 3h4v18H3z"/><path d="M3 3h18v4H3z"/><circle cx="12" cy="12" r="1"/><circle cx="17" cy="12" r="1"/><circle cx="12" cy="17" r="1"/><circle cx="17" cy="17" r="1"/>',
    "qr": '<circle cx="8" cy="8" r="5"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
    "diagonalize": '<path d="M4 20V4l16 16V4"/>',

    # Свойства
    "zero-matrix": '<path d="M3 4h2v16H3zM21 4h-2v16h2z"/><circle cx="12" cy="12" r="3.5"/>',
    "identity": '<path d="M3 4h2v16H3zM21 4h-2v16h2z"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/>',
    "diagonal": '<path d="M3 4h2v16H3zM21 4h-2v16h2z"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/>',
    "symmetric": '<path d="M12 3v18M3 12h18"/><circle cx="7" cy="7" r="1.5"/><circle cx="17" cy="17" r="1.5"/>',
    "orthogonal": '<rect x="4" y="4" width="16" height="16" rx="2"/><line x1="4" y1="4" x2="20" y2="20"/><line x1="20" y1="4" x2="4" y2="20"/>',

    # Статусы
    "check-badge": '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
    "alert-circle": '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    "alert-triangle": '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    "x-circle": '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    "sparkles": '<path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M19 15l.7 2.1L22 18l-2.3.9L19 21l-.7-2.1L16 18l2.3-.9z"/>',

    # Прочее
    "users": '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    "graduation": '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/>',
    "code": '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    "rocket": '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>',
    "shield": '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    "eye": '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    "repeat": '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    "file-text": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    "file-tex": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><text x="12" y="17" font-size="9" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">TeX</text>',
    "file-json": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><text x="12" y="17" font-size="8" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">{}</text>',
}


@register.simple_tag
def icon(name: str, size: int = 24, stroke: float = 2.0, css_class: str = "", title: str = "") -> str:
    """Встроить SVG-иконку."""
    content = _ICONS.get(name)
    if content is None:
        content = '<circle cx="12" cy="12" r="9"/>'

    classes = f"icon icon--{name}"
    if css_class:
        classes += f" {css_class}"

    title_el = f'<title>{title}</title>' if title else ""
    aria = 'aria-hidden="true"' if not title else 'role="img"'

    return mark_safe(
        f'<svg class="{classes}" width="{size}" height="{size}" '
        f'viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        f'stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round" '
        f'{aria}>{title_el}{content}</svg>'
    )


@register.simple_tag
def icon_names() -> list[str]:
    """Список всех иконок."""
    return sorted(_ICONS.keys())