/* =============================================================================
   MatrixLab — main.js
   =============================================================================
   Ядро клиентской части приложения.

   Отвечает за:
       • пространство имён window.MatrixLab;
       • базовые утилиты ($, $$, debounce, escapeHtml, storage);
       • работу с CSRF-токеном;
       • переключение светлой/тёмной темы с сохранением в localStorage;
       • систему toast-уведомлений (success/error/warning/info);
       • глобальный индикатор загрузки (loader) с реф-каунтером;
       • универсальную fetch-обёртку ML.api.post с CSRF;
       • копирование в буфер обмена (ML.copy);
       • ленивую интеграцию с MathJax (ML.mathjax.typeset);
       • мобильную навигацию;
       • модальные окна (ML.modal.open / close);
       • делегированные обработчики копирования по data-атрибутам.

   Модуль НЕ зависит от других файлов проекта и должен подключаться
   первым, чтобы к моменту инициализации остальных модулей
   window.MatrixLab уже существовал.
   ============================================================================= */
(function () {
    'use strict';

    // =========================================================================
    // Пространство имён
    // =========================================================================
    const ML = window.MatrixLab = window.MatrixLab || {};

    // =========================================================================
    // Утилиты
    // =========================================================================

    /** Обёртка над document.querySelector */
    ML.$ = function (selector, root) {
        return (root || document).querySelector(selector);
    };

    /** Возвращает массив из querySelectorAll */
    ML.$$ = function (selector, root) {
        return Array.from((root || document).querySelectorAll(selector));
    };

    /** Дебаунс: откладывает вызов fn до истечения wait мс с последнего вызова */
    ML.debounce = function (fn, wait) {
        wait = wait || 200;
        let timer = null;
        return function () {
            const ctx = this;
            const args = arguments;
            clearTimeout(timer);
            timer = setTimeout(function () {
                fn.apply(ctx, args);
            }, wait);
        };
    };

    /** Экранирование HTML-спецсимволов */
    ML.escapeHtml = function (str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    /** Получить CSRF-токен из мета-тега или формы */
    ML.getCsrfToken = function () {
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) {
            const content = meta.getAttribute('content');
            if (content) return content;
        }
        const input = document.querySelector('input[name="csrfmiddlewaretoken"]');
        if (input && input.value) return input.value;
        const cookieMatch = document.cookie.match(/csrftoken=([^;]+)/);
        if (cookieMatch) return cookieMatch[1];
        return '';
    };

    // =========================================================================
    // Работа с localStorage
    // =========================================================================

    ML.storage = {
        get(key, fallback) {
            try {
                const v = localStorage.getItem(key);
                return v === null ? (fallback === undefined ? null : fallback) : v;
            } catch (e) {
                return fallback === undefined ? null : fallback;
            }
        },
        set(key, value) {
            try {
                localStorage.setItem(key, String(value));
                return true;
            } catch (e) {
                return false;
            }
        },
        remove(key) {
            try {
                localStorage.removeItem(key);
                return true;
            } catch (e) {
                return false;
            }
        },
    };

    // =========================================================================
    // Тема
    // =========================================================================

    ML.theme = {
        STORAGE_KEY: 'matrixlab.theme',
        LIGHT: 'light',
        DARK: 'dark',

        current() {
            return document.documentElement.getAttribute('data-theme') || this.LIGHT;
        },

        set(theme) {
            document.documentElement.setAttribute('data-theme', theme);
            ML.storage.set(this.STORAGE_KEY, theme);
            // Синхронизируем цвет темы для мобильных браузеров
            const meta = document.querySelector('meta[name="theme-color"]');
            if (meta) {
                meta.setAttribute('content', theme === this.DARK ? '#0F1115' : '#F7F8FC');
            }
        },

        toggle() {
            const next = this.current() === this.DARK ? this.LIGHT : this.DARK;
            this.set(next);
            return next;
        },

        init() {
            const self = this;
            ML.$$('[data-theme-toggle]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    const theme = self.toggle();
                    ML.toast.info(
                        theme === self.DARK ? 'Тёмная тема' : 'Светлая тема'
                    );
                });
            });
        },
    };

    // =========================================================================
    // Toast-уведомления
    // =========================================================================

    ML.toast = (function () {
        const CONTAINER_SELECTOR = '[data-toast-container]';
        const DEFAULT_DURATION = 4000;

        // SVG-иконки для каждого типа
        const ICONS = {
            success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
            error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
            warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        };

        const CLOSE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

        function getContainer() {
            let container = document.querySelector(CONTAINER_SELECTOR);
            if (!container) {
                container = document.createElement('div');
                container.className = 'toast-container';
                container.setAttribute('data-toast-container', '');
                container.setAttribute('aria-live', 'polite');
                document.body.appendChild(container);
            }
            return container;
        }

        function show(type, title, message, duration) {
            if (ICONS[type] === undefined) type = 'info';
            if (duration === undefined) duration = DEFAULT_DURATION;

            const container = getContainer();

            const toast = document.createElement('div');
            toast.className = 'toast toast--' + type;
            toast.setAttribute('role', 'status');
            toast.setAttribute('aria-live', 'polite');

            const iconWrap = document.createElement('div');
            iconWrap.className = 'toast-icon';
            iconWrap.innerHTML = ICONS[type];

            const body = document.createElement('div');
            body.className = 'toast-body';

            const titleEl = document.createElement('p');
            titleEl.className = 'toast-title';
            titleEl.textContent = title || '';

            const msgEl = document.createElement('p');
            msgEl.className = 'toast-message';
            msgEl.textContent = message || '';

            body.appendChild(titleEl);
            if (message) body.appendChild(msgEl);

            const closeBtn = document.createElement('button');
            closeBtn.className = 'toast-close';
            closeBtn.type = 'button';
            closeBtn.setAttribute('aria-label', 'Закрыть уведомление');
            closeBtn.innerHTML = CLOSE_ICON;

            const progress = document.createElement('div');
            progress.className = 'toast-progress';

            toast.appendChild(iconWrap);
            toast.appendChild(body);
            toast.appendChild(closeBtn);
            toast.appendChild(progress);

            let timer = null;
            let closed = false;

            function close() {
                if (closed) return;
                closed = true;
                if (timer) clearTimeout(timer);
                toast.classList.add('is-leaving');
                setTimeout(function () {
                    if (toast.parentNode) toast.parentNode.removeChild(toast);
                }, 200);
            }

            closeBtn.addEventListener('click', close);
            toast.addEventListener('mouseenter', function () {
                if (timer) clearTimeout(timer);
            });
            toast.addEventListener('mouseleave', function () {
                if (!closed) timer = setTimeout(close, 1200);
            });

            container.appendChild(toast);

            progress.style.animationDuration = duration + 'ms';
            timer = setTimeout(close, duration);

            return { close: close, element: toast };
        }

        return {
            success: function (title, message, d) { return show('success', title, message, d); },
            error: function (title, message, d) { return show('error', title, message, d); },
            warning: function (title, message, d) { return show('warning', title, message, d); },
            info: function (title, message, d) { return show('info', title, message, d); },
            show: show,
        };
    })();

    // =========================================================================
    // Глобальный loader (счётчик активных операций)
    // =========================================================================

    ML.loader = (function () {
        let node = null;
        let counter = 0;

        function getNode() {
            if (!node) node = document.querySelector('[data-global-loader]');
            return node;
        }

        return {
            show(text) {
                const el = getNode();
                if (!el) return;
                counter += 1;
                if (text) {
                    const textEl = el.querySelector('.loader-text');
                    if (textEl) textEl.textContent = text;
                }
                el.hidden = false;
                el.classList.add('is-visible');
            },
            hide() {
                const el = getNode();
                if (!el) return;
                counter = Math.max(0, counter - 1);
                if (counter === 0) {
                    el.classList.remove('is-visible');
                    el.hidden = true;
                }
            },
            reset() {
                const el = getNode();
                counter = 0;
                if (!el) return;
                el.classList.remove('is-visible');
                el.hidden = true;
            },
        };
    })();

    // =========================================================================
    // API — fetch-обёртка с CSRF
    // =========================================================================

    ML.api = {
        /**
         * POST JSON на указанный URL.
         *
         * @param {string} url  — endpoint
         * @param {object} data — тело запроса
         * @returns {Promise<object>} — ответ сервера (JSON)
         * @throws {Error} с полями .code, .status, .payload при ошибке
         */
        async post(url, data) {
            const token = ML.getCsrfToken();
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': token,
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': 'application/json',
                },
                body: JSON.stringify(data || {}),
                credentials: 'same-origin',
            });

            let payload;
            try {
                payload = await response.json();
            } catch (e) {
                const err = new Error('Сервер вернул некорректный ответ.');
                err.status = response.status;
                throw err;
            }

            if (!response.ok || payload.success === false) {
                const msg = payload.error || ('Ошибка ' + response.status);
                const err = new Error(msg);
                err.code = payload.code;
                err.status = response.status;
                err.payload = payload;
                throw err;
            }

            return payload;
        },
    };

    // =========================================================================
    // Копирование в буфер обмена
    // =========================================================================

    ML.copy = {
        /**
         * Скопировать текст в буфер с fallback для небезопасного контекста.
         */
        async text(text, successMessage) {
            if (text === null || text === undefined) text = '';
            text = String(text);

            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(text);
                } else {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.setAttribute('readonly', '');
                    ta.style.position = 'fixed';
                    ta.style.left = '-9999px';
                    ta.style.top = '0';
                    document.body.appendChild(ta);
                    ta.select();
                    ta.setSelectionRange(0, ta.value.length);
                    const ok = document.execCommand('copy');
                    document.body.removeChild(ta);
                    if (!ok) throw new Error('execCommand copy failed');
                }
                ML.toast.success('Готово', successMessage || 'Скопировано');
                return true;
            } catch (e) {
                ML.toast.error('Не удалось скопировать', 'Выделите текст вручную.');
                return false;
            }
        },

        /**
         * Скопировать содержимое элемента из data-атрибутов.
         */
        from(el, successMessage) {
            if (!el) return Promise.resolve(false);
            const text = el.getAttribute('data-copy-text')
                || el.getAttribute('data-copy-latex')
                || el.textContent
                || '';
            return this.text(text, successMessage);
        },
    };

    // =========================================================================
    // MathJax — обёртка
    // =========================================================================

    ML.mathjax = {
        /**
         * Перерендерить формулы в узле (по умолчанию — весь body).
         */
        typeset(node) {
            if (!window.MathJax) return Promise.resolve();
            const target = node || document.body;

            if (window.MathJax.typesetPromise) {
                return window.MathJax.typesetPromise([target]).catch(function () {});
            }
            if (window.MathJax.typeset) {
                try { window.MathJax.typeset([target]); } catch (e) { /* noop */ }
            }
            return Promise.resolve();
        },
    };

    // =========================================================================
    // Мобильная навигация
    // =========================================================================

    ML.mobileNav = {
        init() {
            const toggle = document.querySelector('[data-nav-toggle]');
            const menu = document.querySelector('[data-mobile-nav]');
            if (!toggle || !menu) return;

            toggle.addEventListener('click', function () {
                const expanded = toggle.getAttribute('aria-expanded') === 'true';
                toggle.setAttribute('aria-expanded', String(!expanded));
                menu.hidden = expanded;
            });

            menu.querySelectorAll('a').forEach(function (link) {
                link.addEventListener('click', function () {
                    toggle.setAttribute('aria-expanded', 'false');
                    menu.hidden = true;
                });
            });

            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && !menu.hidden) {
                    toggle.setAttribute('aria-expanded', 'false');
                    menu.hidden = true;
                }
            });
        },
    };

    // =========================================================================
    // Модальные окна
    // =========================================================================

    ML.modal = {
        CLOSE_SELECTOR: '[data-modal-close], [data-random-close], [data-history-modal-close], [data-saved-modal-close], [data-examples-close], [data-export-close]',

        open(selector) {
            const modal = document.querySelector(selector);
            if (!modal) return;
            modal.hidden = false;
            document.body.style.overflow = 'hidden';

            const self = this;
            const closeBtns = modal.querySelectorAll(this.CLOSE_SELECTOR);
            closeBtns.forEach(function (btn) {
                if (btn.dataset.modalBound === '1') return;
                btn.dataset.modalBound = '1';
                btn.addEventListener('click', function () {
                    self.close(selector);
                });
            });

            const onKey = function (e) {
                if (e.key === 'Escape') {
                    self.close(selector);
                    document.removeEventListener('keydown', onKey);
                }
            };
            document.addEventListener('keydown', onKey);

            setTimeout(function () {
                const firstInput = modal.querySelector('input, textarea, select');
                if (firstInput && typeof firstInput.focus === 'function') {
                    firstInput.focus();
                }
            }, 50);
        },

        close(selector) {
            const modal = document.querySelector(selector);
            if (!modal) return;
            modal.hidden = true;
            document.body.style.overflow = '';
        },
    };

    // =========================================================================
    // Делегирование копирования
    // =========================================================================

    function flashCopied(el) {
        el.classList.add('is-copied');
        setTimeout(function () {
            el.classList.remove('is-copied');
        }, 900);
    }

    function initCopyDelegation() {
        document.addEventListener('click', function (e) {
            const latexBtn = e.target.closest('[data-copy-latex]');
            if (latexBtn) {
                e.preventDefault();
                const text = latexBtn.getAttribute('data-copy-latex') || '';
                ML.copy.text(text, 'LaTeX скопирован');
                flashCopied(latexBtn);
                return;
            }

            const textBtn = e.target.closest('[data-copy-text]');
            if (textBtn) {
                e.preventDefault();
                const text = textBtn.getAttribute('data-copy-text') || '';
                ML.copy.text(text, 'Текст скопирован');
                flashCopied(textBtn);
            }
        });
    }

    // =========================================================================
    // Инициализация
    // =========================================================================

    function init() {
        ML.theme.init();
        ML.mobileNav.init();
        initCopyDelegation();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();