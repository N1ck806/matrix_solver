"""
Telegram-бот MatrixLab, встроенный в Django.

Webhook работает в отдельном фоновом потоке с постоянным event loop —
это критично, потому что aiogram-сессия привязана к loop'у и не может
переживать его закрытие.
"""
from __future__ import annotations

import asyncio
import logging
import threading

from aiogram import Bot, Dispatcher
from aiogram.filters import CommandStart
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    Update,
)
from django.conf import settings

logger = logging.getLogger("matrix_app.telegram_bot")

_bot: Bot | None = None
_dp: Dispatcher | None = None
_loop: asyncio.AbstractEventLoop | None = None
_thread: threading.Thread | None = None
_lock = threading.Lock()


def _ensure_loop() -> asyncio.AbstractEventLoop:
    """Создать (или вернуть существующий) фоновый event loop."""
    global _loop, _thread

    with _lock:
        if _loop is not None and _loop.is_running():
            return _loop

        _loop = asyncio.new_event_loop()

        def _runner() -> None:
            asyncio.set_event_loop(_loop)
            _loop.run_forever()

        _thread = threading.Thread(
            target=_runner,
            name="matrixlab-telegram-bot",
            daemon=True,
        )
        _thread.start()
        logger.info("Telegram: фоновый event loop запущен")

        return _loop


def _ensure_bot() -> tuple[Bot, Dispatcher]:
    """Ленивая инициализация бота и диспетчера."""
    global _bot, _dp

    if _bot is None:
        _bot = Bot(token=settings.BOT_TOKEN)

    if _dp is None:
        _dp = Dispatcher()
        _dp.message.register(cmd_start, CommandStart())

    return _bot, _dp


async def cmd_start(message: Message) -> None:
    """Обработчик /start — кнопка на сайт."""
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Открыть MatrixLab",
                    url=settings.SITE_URL,
                )
            ]
        ]
    )
    await message.answer(
        "Привет! Это бот MatrixLab — сервиса для решения задач по матрицам.\n\n"
        "Нажми на кнопку ниже, чтобы открыть сайт:",
        reply_markup=keyboard,
    )


async def _setup_webhook_async() -> None:
    bot, _ = _ensure_bot()
    url = (
        f"{settings.SITE_URL.rstrip('/')}"
        f"/telegram/webhook/{settings.WEBHOOK_SECRET}/"
    )
    await bot.set_webhook(url)
    logger.info("Telegram webhook установлен: %s", url)


def setup_webhook() -> None:
    """Синхронная обёртка для вызова из apps.py."""
    loop = _ensure_loop()
    future = asyncio.run_coroutine_threadsafe(_setup_webhook_async(), loop)
    future.result(timeout=15)


async def _process_update_async(update_data: dict) -> None:
    bot, dp = _ensure_bot()
    update = Update.model_validate(update_data, context={"bot": bot})
    await dp.feed_update(bot, update)


def process_update(update_data: dict) -> None:
    """Синхронная обёртка для вызова из Django-view."""
    loop = _ensure_loop()
    future = asyncio.run_coroutine_threadsafe(
        _process_update_async(update_data), loop
    )
    future.result(timeout=15)