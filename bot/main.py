"""
Простой Telegram-бот MatrixLab.
Даёт кнопку со ссылкой на сайт.
"""
import asyncio
import os

from aiogram import Bot, Dispatcher
from aiogram.filters import CommandStart
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)

BOT_TOKEN = os.environ["BOT_TOKEN"]
SITE_URL = "https://matrix-solver-qa4g.onrender.com"

dp = Dispatcher()


@dp.message(CommandStart())
async def cmd_start(message: Message) -> None:
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Открыть MatrixLab",
                    url=SITE_URL,
                )
            ]
        ]
    )
    await message.answer(
        "Привет! Это бот MatrixLab — сервиса для решения задач по матрицам.\n\n"
        "Нажми на кнопку ниже, чтобы открыть сайт:",
        reply_markup=keyboard,
    )


async def main() -> None:
    bot = Bot(token=BOT_TOKEN)
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())