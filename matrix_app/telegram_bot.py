"""
Telegram-бот MatrixLab, встроенный в Django.

Один сервис, один домен. Webhook принимает Django-view.
"""
from __future__ import annotations

import logging

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


def get_bot() -> Bot:
    """Ленивая инициализация бота."""
    global _bot
    if _bot is None:
        _bot = Bot(token=settings.BOT_TOKEN)
    return _bot


def get_dispatcher() -> Dispatcher:
    """Ленивая инициализация диспетчера."""
    global _dp
    if _dp is None:
        _dp = Dispatcher()
        _dp.message.register(cmd_start, CommandStart())
    return _dp


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


async def setup_webhook() -> None:
    """Установить webhook на URL сайта."""
    bot = get_bot()
    url = (
        f"{settings.SITE_URL.rstrip('/')}"
        f"/telegram/webhook/{settings.WEBHOOK_SECRET}/"
    )
    await bot.set_webhook(url)
    logger.info("Telegram webhook установлен: %s", url)


async def process_update(update_data: dict) -> None:
    """Обработать один апдейт от Telegram."""
    bot = get_bot()
    dp = get_dispatcher()
    update = Update.model_validate(update_data, context={"bot": bot})
    await dp.feed_update(bot, update)