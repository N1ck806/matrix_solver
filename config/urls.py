"""
Корневая конфигурация URL проекта MatrixLab.

Здесь только:
    - админка Django;
    - подключение маршрутов приложения matrix_app;
    - раздача статики и медиа в режиме DEBUG;
    - кастомные обработчики ошибок 400/403/404/500.

Все URL приложения matrix_app описаны в matrix_app/urls.py.
"""
from __future__ import annotations

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path


# =============================================================================
# Настройка заголовков админки (косметика)
# =============================================================================

admin.site.site_header = "MatrixLab — администрирование"
admin.site.site_title = "MatrixLab"
admin.site.index_title = "Панель управления MatrixLab"


# =============================================================================
# Основные маршруты
# =============================================================================

urlpatterns = [
    # Админка.
    path("admin/", admin.site.urls),

    # Приложение.
    path("", include(("matrix_app.urls", "matrix_app"), namespace="matrix_app")),
]


# =============================================================================
# Раздача статики и медиа в режиме DEBUG
# =============================================================================
#
# В продакшене этим занимается веб-сервер (nginx) или whitenoise.
# В разработке Django сам отдаёт файлы — это удобно и не требует
# дополнительной настройки.
# =============================================================================

if settings.DEBUG:  # pragma: no cover
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)


# =============================================================================
# Кастомные обработчики ошибок
# =============================================================================
#
# Если в matrix_app есть файлы error_handlers.py с функциями
# bad_request, permission_denied, page_not_found, server_error —
# подключаем их. Иначе Django использует стандартные.
#
# Это позволяет показать красивые страницы ошибок вместо технических.
# =============================================================================

handler400 = "matrix_app.error_handlers.bad_request"
handler403 = "matrix_app.error_handlers.permission_denied"
handler404 = "matrix_app.error_handlers.page_not_found"
handler500 = "matrix_app.error_handlers.server_error"