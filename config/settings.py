"""
Настройки Django-проекта MatrixLab.

Все критичные для окружения параметры (SECRET_KEY, DEBUG, ALLOWED_HOSTS,
пути, БД) переопределяются переменными окружения. Локально можно
переопределить через config/local_settings.py (не в репозитории).

Структура:
    1.  Пути проекта
    2.  Хелперы env_*
    3.  Безопасность (SECRET_KEY, DEBUG, ALLOWED_HOSTS, CSRF, cookies)
    4.  Приложения
    5.  Middleware
    6.  URL, WSGI, ASGI
    7.  Шаблоны
    8.  База данных (SQLite / PostgreSQL через DATABASE_URL)
    9.  Пароли
    10. Локализация
    11. Статика и медиа (WhiteNoise)
    12. Сообщения
    13. Сессии
    14. Логирование
    15. Параметры MatrixLab
    16. CDN
    17. Дополнительно
    18. Local settings
"""
from __future__ import annotations

import os
from pathlib import Path

import dj_database_url

# =============================================================================
# 1. ПУТИ ПРОЕКТА
# =============================================================================

BASE_DIR: Path = Path(__file__).resolve().parent.parent

CONFIG_DIR: Path = BASE_DIR / "config"
APPS_DIR: Path = BASE_DIR / "matrix_app"
TEMPLATES_DIR: Path = APPS_DIR / "templates"
STATIC_SRC_DIR: Path = APPS_DIR / "static"
LOCALE_DIR: Path = BASE_DIR / "locale"

LOCAL_SETTINGS_FILE: Path = CONFIG_DIR / "local_settings.py"


# =============================================================================
# 2. ХЕЛПЕРЫ ENV
# =============================================================================

def env_str(key: str, default: str) -> str:
    return os.environ.get(key, default)


def env_bool(key: str, default: bool = False) -> bool:
    raw = os.environ.get(key)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on", "y", "t"}


def env_int(key: str, default: int) -> int:
    raw = os.environ.get(key)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def env_list(key: str, default: list[str]) -> list[str]:
    raw = os.environ.get(key)
    if raw is None:
        return list(default)
    return [item.strip() for item in raw.split(",") if item.strip()]


# =============================================================================
# 3. БЕЗОПАСНОСТЬ
# =============================================================================

SECRET_KEY: str = env_str(
    "DJANGO_SECRET_KEY",
    env_str("SECRET_KEY", "django-insecure-matrixlab-local-dev-key"),
)

DEBUG: bool = env_bool("DJANGO_DEBUG", env_bool("DEBUG", default=True))

# --- ALLOWED_HOSTS ---
_extra_hosts: list[str] = []
_render_host = os.environ.get("RENDER_EXTERNAL_HOSTNAME")
if _render_host:
    _extra_hosts.append(_render_host)

ALLOWED_HOSTS: list[str] = env_list(
    "DJANGO_ALLOWED_HOSTS",
    ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"],
) + _extra_hosts

# --- CSRF ---
CSRF_TRUSTED_ORIGINS: list[str] = env_list(
    "DJANGO_CSRF_TRUSTED_ORIGINS",
    [
        "http://localhost",
        "http://localhost:8000",
        "http://127.0.0.1",
        "http://127.0.0.1:8000",
        "https://*.onrender.com",
    ],
)

# --- Cookies ---
CSRF_COOKIE_HTTPONLY = False
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"

# --- Защита ---
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_BROWSER_XSS_FILTER = True
X_FRAME_OPTIONS = "DENY"

# --- HTTPS (включается только на проде) ---
SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", default=not DEBUG)
SESSION_COOKIE_SECURE = env_bool("DJANGO_SESSION_COOKIE_SECURE", default=not DEBUG)
CSRF_COOKIE_SECURE = env_bool("DJANGO_CSRF_COOKIE_SECURE", default=not DEBUG)

# --- HSTS ---
SECURE_HSTS_SECONDS = env_int("DJANGO_SECURE_HSTS_SECONDS", 0)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool(
    "DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS", default=False
)
SECURE_HSTS_PRELOAD = env_bool("DJANGO_SECURE_HSTS_PRELOAD", default=False)

SECURE_REFERRER_POLICY = "same-origin"

# --- Proxy (Render работает за прокси) ---
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")


# =============================================================================
# 4. ПРИЛОЖЕНИЯ
# =============================================================================

DJANGO_APPS: list[str] = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.humanize",
]

LOCAL_APPS: list[str] = [
    "matrix_app",
]

THIRD_PARTY_APPS: list[str] = [
    # Пока не требуется
]

INSTALLED_APPS: list[str] = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS


# =============================================================================
# 5. MIDDLEWARE
# =============================================================================

MIDDLEWARE: list[str] = [
    "django.middleware.security.SecurityMiddleware",
    # WhiteNoise — раздача статики на Render
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "django.middleware.http.ConditionalGetMiddleware",
]


# =============================================================================
# 6. URL, WSGI, ASGI
# =============================================================================

ROOT_URLCONF: str = "config.urls"
WSGI_APPLICATION: str = "config.wsgi.application"
ASGI_APPLICATION: str = "config.asgi.application"

APPEND_SLASH = True


# =============================================================================
# 7. ШАБЛОНЫ
# =============================================================================

TEMPLATES: list[dict] = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [
            TEMPLATES_DIR,
            APPS_DIR / "templates" / "matrix_app",
        ],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.template.context_processors.i18n",
                "django.template.context_processors.static",
                "django.template.context_processors.media",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "matrix_app.context_processors.app_meta",
                "matrix_app.context_processors.limits",
                "matrix_app.context_processors.cdn",
                "matrix_app.context_processors.navigation",
                "matrix_app.context_processors.footer_year",
            ],
            "builtins": [
                "django.templatetags.static",
            ],
            "debug": DEBUG,
            "string_if_invalid": "‹не найдено: %s›",
        },
    },
]


# =============================================================================
# 8. БАЗА ДАННЫХ
# =============================================================================
# Если DATABASE_URL задан (Render + PostgreSQL) — используем его.
# Иначе — SQLite. Для SQLite sslmode НЕ передаём.
# =============================================================================

_DATABASE_URL: str = os.environ.get("DATABASE_URL", "")

if _DATABASE_URL:
    # PostgreSQL (Render) или другая СУБД
    DATABASES: dict = {
        "default": dj_database_url.parse(
            _DATABASE_URL,
            conn_max_age=600,
            conn_health_checks=True,
        )
    }
else:
    # SQLite — локально и как fallback
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": str(BASE_DIR / "db.sqlite3"),
            "OPTIONS": {
                "timeout": 20,
            },
            "ATOMIC_REQUESTS": False,
            "CONN_MAX_AGE": 60,
        }
    }

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# =============================================================================
# 9. ПАРОЛИ
# =============================================================================

AUTH_PASSWORD_VALIDATORS: list[dict] = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 8},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]


# =============================================================================
# 10. ЛОКАЛИЗАЦИЯ
# =============================================================================

LANGUAGE_CODE: str = env_str("DJANGO_LANGUAGE_CODE", "ru-ru")
TIME_ZONE: str = env_str("DJANGO_TIME_ZONE", "Europe/Moscow")
USE_I18N: bool = True
USE_L10N: bool = True
USE_TZ: bool = True

LANGUAGES: list[tuple[str, str]] = [
    ("ru", "Русский"),
    ("en", "English"),
]

LOCALE_PATHS: list[Path] = [LOCALE_DIR]


# =============================================================================
# 11. СТАТИКА И МЕДИА
# =============================================================================

STATIC_URL: str = "/static/"
STATIC_ROOT: Path = BASE_DIR / "staticfiles"

STATICFILES_DIRS: list[Path] = [
    STATIC_SRC_DIR,
]

STATICFILES_FINDERS: list[str] = [
    "django.contrib.staticfiles.finders.FileSystemFinder",
    "django.contrib.staticfiles.finders.AppDirectoriesFinder",
]

# Хранилище статики:
# - DEBUG=True  → обычное
# - DEBUG=False → WhiteNoise CompressedManifest (хеши, gzip)
if DEBUG:
    _static_backend = "django.contrib.staticfiles.storage.StaticFilesStorage"
else:
    _static_backend = "whitenoise.storage.CompressedManifestStaticFilesStorage"

STORAGES: dict[str, dict] = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": _static_backend,
    },
}

MEDIA_URL: str = "/media/"
MEDIA_ROOT: Path = BASE_DIR / "media"

FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024


# =============================================================================
# 12. СООБЩЕНИЯ
# =============================================================================

from django.contrib.messages import constants as messages_constants  # noqa: E402

MESSAGE_STORAGE = "django.contrib.messages.storage.session.SessionStorage"

MESSAGE_TAGS: dict[int, str] = {
    messages_constants.DEBUG: "debug",
    messages_constants.INFO: "info",
    messages_constants.SUCCESS: "success",
    messages_constants.WARNING: "warning",
    messages_constants.ERROR: "danger",
}

MESSAGE_LEVEL = messages_constants.DEBUG if DEBUG else messages_constants.INFO


# =============================================================================
# 13. СЕССИИ
# =============================================================================

SESSION_ENGINE = "django.contrib.sessions.backends.db"
SESSION_COOKIE_NAME = "matrixlab_sessionid"
SESSION_COOKIE_AGE = 60 * 60 * 24 * 30
SESSION_SAVE_EVERY_REQUEST = False
SESSION_EXPIRE_AT_BROWSER_CLOSE = False


# =============================================================================
# 14. ЛОГИРОВАНИЕ
# =============================================================================

LOG_LEVEL: str = env_str("DJANGO_LOG_LEVEL", "INFO")

LOGGING: dict = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "[{asctime}] {levelname:8s} {name}:{lineno} — {message}",
            "style": "{",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        },
        "simple": {
            "format": "{levelname:8s} {message}",
            "style": "{",
        },
    },
    "filters": {
        "require_debug_true": {
            "()": "django.utils.log.RequireDebugTrue",
        },
        "require_debug_false": {
            "()": "django.utils.log.RequireDebugFalse",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
            "level": LOG_LEVEL,
        },
        "console_debug": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
            "level": "DEBUG",
            "filters": ["require_debug_true"],
        },
    },
    "root": {
        "handlers": ["console"],
        "level": LOG_LEVEL,
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
        "django.request": {
            "handlers": ["console"],
            "level": "WARNING",
            "propagate": False,
        },
        "matrix_app": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
        "matrix_app.services": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
    },
}


# =============================================================================
# 15. ПАРАМЕТРЫ MATRIXLAB
# =============================================================================

MAX_MATRIX_ROWS: int = env_int("MATRIXLAB_MAX_ROWS", 10)
MAX_MATRIX_COLS: int = env_int("MATRIXLAB_MAX_COLS", 10)

MAX_SYMBOLIC_SIZE: int = env_int("MATRIXLAB_MAX_SYMBOLIC", 5)
MAX_PARAMETERS_SLAU: int = env_int("MATRIXLAB_MAX_PARAMETERS", 20)
MAX_MATRIX_POWER: int = env_int("MATRIXLAB_MAX_POWER", 100)

HISTORY_LIMIT: int = env_int("MATRIXLAB_HISTORY_LIMIT", 200)
SAVED_MATRICES_LIMIT: int = env_int("MATRIXLAB_SAVED_LIMIT", 100)

DEFAULT_OUTPUT_FORMAT: str = env_str("MATRIXLAB_OUTPUT_FORMAT", "exact")
DECIMAL_PRECISION: int = env_int("MATRIXLAB_DECIMAL_PRECISION", 6)
SYMBOLIC_TERM_LIMIT: int = env_int("MATRIXLAB_SYMBOLIC_LIMIT", 500)


# =============================================================================
# 16. CDN
# =============================================================================

CDN: dict[str, str] = {
    "mathjax": "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js",
    "chartjs": "https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js",
}


# =============================================================================
# 17. ДОПОЛНИТЕЛЬНО
# =============================================================================

APPEND_SLASH = True
DATA_UPLOAD_MAX_NUMBER_FIELDS = 5000
DEFAULT_CHARSET = "utf-8"
INTERNAL_IPS: list[str] = ["127.0.0.1", "localhost"]
TEST_RUNNER = "django.test.runner.DiscoverRunner"


# =============================================================================
# 18. LOCAL SETTINGS
# =============================================================================

if LOCAL_SETTINGS_FILE.exists():  # pragma: no cover
    import importlib.util as _ilu

    _spec = _ilu.spec_from_file_location(
        "config.local_settings", str(LOCAL_SETTINGS_FILE)
    )
    if _spec is not None and _spec.loader is not None:
        _module = _ilu.module_from_spec(_spec)
        _spec.loader.exec_module(_module)
        for _name in dir(_module):
            if _name.isupper():
                globals()[_name] = getattr(_module, _name)