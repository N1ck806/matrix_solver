/* =============================================================================
   MatrixLab — main.js
   =============================================================================
   Ядро клиентской части приложения.

   Отвечает за:
       • пространство имён window.MatrixLab;
       • базовые утилиты ($, $$, debounce, throttle, escapeHtml, storage);
       • событийную шину ML.on / off / emit;
       • работу с CSRF-токеном;
       • тему (light / dark / auto) без вспышки при загрузке;
       • предпочтения пользователя (ML.prefs) с миграциями;
       • локализацию (ML.i18n) — ru / en;
       • toast-уведомления (success/error/warning/info);
       • глобальный индикатор загрузки (loader) с реф-каунтером;
       • универсальную fetch-обёрту ML.api с CSRF, таймаутом, retry,
         отменой через AbortController и разбором ошибок;
       • копирование в буфер (ML.copy) — text / latex / markdown / json;
       • MathJax-обёртку (ML.mathjax.typeset);
       • модальные окна (ML.modal.open / close / toggle);
       • подтверждение действия (ML.confirm) — Promise-based;
       • рендер превью матриц (ML.preview);
       • форматирование чисел (ML.format);
       • текстовый отчёт из payload (ML.buildPlainText);
       • реестр рендереров результата (ML.resultRenderers);
       • валидаторы матричных данных (ML.validators);
       • haptic feedback (ML.haptic);
       • горячие клавиши (ML.hotkeys);
       • делегирование копирования по data-атрибутам;
       • реестр модулей (ML.register) и единый boot (ML.boot);
       • error boundary для необработанных ошибок;
       • ML.history — клиентская история;
       • ML.workspace — заготовка рабочего пространства.

   Модуль НЕ зависит от других файлов проекта и подключается первым.

   Публичный контракт:
       ML.$         (selector, root?) → Element | null
       ML.$$        (selector, root?) → Element[]
       ML.on/off/emit(event, handler|payload)
       ML.debounce/throttle(fn, ms)
       ML.escapeHtml(str) / ML.isBlank(v)
       ML.getCsrfToken()
       ML.storage.{get,set,remove,getJSON,setJSON}
       ML.prefs.{get,set,all,reset}
       ML.i18n.{t,setLocale,locale,available}
       ML.theme.{current,preferred,set,toggle,init,followSystem}
       ML.toast.{info,success,warning,error,show}
       ML.loader.{show,hide,reset}
       ML.api.{get,post,put,del}
       ML.copy.{text,latex,markdown,json,from}
       ML.mathjax.typeset(node?)
       ML.modal.{open,close,closeAll,toggle}
       ML.confirm(message, opts?) → Promise<boolean>
       ML.preview.render(container, matrix)
       ML.format.{number,fraction,complex,matrixToLatex,matrixToText}
       ML.buildPlainText(payload) → string
       ML.resultRenderers — реестр
       ML.validators.{classifyInput,isEmptyMatrix,isEmptyVector}
       ML.haptic(style)
       ML.hotkeys.init()
       ML.history.{push,all,clear,remove,load}
       ML.workspace
       ML.register(name, initFn) / ML.boot()
   ============================================================================= */
(function () {
    'use strict';

    // =========================================================================
    // 0. ПРОСТРАНСТВО ИМЁН
    // =========================================================================

    const ML = window.MatrixLab = window.MatrixLab || {};

    // Версия ядра — для миграций prefs и отладки
    ML.VERSION = '2.0.0';

    // =========================================================================
    // 1. БАЗОВЫЕ УТИЛИТЫ
    // =========================================================================

    ML.$ = function (selector, root) {
        return (root || document).querySelector(selector);
    };

    ML.$$ = function (selector, root) {
        return Array.prototype.slice.call(
            (root || document).querySelectorAll(selector)
        );
    };

    ML.debounce = function (fn, wait) {
        wait = wait == null ? 200 : wait;
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

    ML.throttle = function (fn, wait) {
        wait = wait == null ? 100 : wait;
        let last = 0;
        let timer = null;
        return function () {
            const ctx = this;
            const args = arguments;
            const now = Date.now();
            const remaining = wait - (now - last);
            if (remaining <= 0) {
                last = now;
                fn.apply(ctx, args);
            } else if (!timer) {
                timer = setTimeout(function () {
                    last = Date.now();
                    timer = null;
                    fn.apply(ctx, args);
                }, remaining);
            }
        };
    };

    ML.escapeHtml = function (str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    ML.isBlank = function (v) {
        return v === null || v === undefined || String(v).trim() === '';
    };

    ML.getCsrfToken = function () {
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta && meta.content) return meta.content;

        const input = document.querySelector('input[name="csrfmiddlewaretoken"]');
        if (input && input.value) return input.value;

        const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
        if (m) return decodeURIComponent(m[1]);

        return '';
    };

    // =========================================================================
    // 2. СОБЫТИЙНАЯ ШИНА
    // =========================================================================

    const _bus = {};

    ML.on = function (event, handler) {
        if (typeof handler !== 'function') return ML;
        (_bus[event] = _bus[event] || []).push(handler);
        return ML;
    };

    ML.off = function (event, handler) {
        if (!_bus[event]) return ML;
        if (!handler) { delete _bus[event]; return ML; }
        _bus[event] = _bus[event].filter(function (h) { return h !== handler; });
        return ML;
    };

    ML.emit = function (event, payload) {
        const list = _bus[event];
        if (!list) return ML;
        for (let i = 0; i < list.length; i++) {
            try { list[i](payload); } catch (e) {
                console.error('[MatrixLab][event:' + event + ']', e);
            }
        }
        return ML;
    };

    // =========================================================================
    // 3. STORAGE
    // =========================================================================

    ML.storage = {
        prefix: 'matrixlab.',
        get(key, fallback) {
            try {
                const v = localStorage.getItem(this.prefix + key);
                return v === null ? (fallback === undefined ? null : fallback) : v;
            } catch (e) { return fallback === undefined ? null : fallback; }
        },
        set(key, value) {
            try {
                localStorage.setItem(this.prefix + key, String(value));
                return true;
            } catch (e) { return false; }
        },
        remove(key) {
            try { localStorage.removeItem(this.prefix + key); return true; }
            catch (e) { return false; }
        },
        getJSON(key, fallback) {
            try {
                const raw = this.get(key);
                if (raw === null || raw === undefined) return fallback;
                return JSON.parse(raw);
            } catch (e) { return fallback; }
        },
        setJSON(key, value) {
            try { return this.set(key, JSON.stringify(value)); }
            catch (e) { return false; }
        }
    };

    // =========================================================================
    // 4. ПРЕДПОЧТЕНИЯ
    // =========================================================================

    const PREFS_SCHEMA_VERSION = 1;

    const PREF_DEFAULTS = {
        theme: 'auto',
        locale: 'ru',
        precision: 6,
        numberFormat: 'auto',
        autoSteps: true,
        defaultRows: 3,
        defaultCols: 3,
        editorPersist: true,
        calcMode: 'quick',
        haptic: true
    };

    ML.prefs = {
        get(key) {
            if (Object.prototype.hasOwnProperty.call(PREF_DEFAULTS, key)) {
                const v = ML.storage.get('prefs.' + key);
                return v === null ? PREF_DEFAULTS[key] : this._parse(v);
            }
            return ML.storage.get('prefs.' + key);
        },
        set(key, value) {
            ML.storage.set('prefs.' + key, this._stringify(value));
            ML.emit('prefs:change', { key: key, value: value });
            return value;
        },
        all() {
            const out = {};
            Object.keys(PREF_DEFAULTS).forEach(function (k) {
                out[k] = ML.prefs.get(k);
            });
            return out;
        },
        reset() {
            Object.keys(PREF_DEFAULTS).forEach(function (k) {
                ML.storage.remove('prefs.' + k);
            });
            ML.storage.remove('prefs.schema');
            ML.emit('prefs:reset', {});
        },
        _parse(v) {
            if (v === 'true') return true;
            if (v === 'false') return false;
            if (v === 'null') return null;
            if (/^-?\d+$/.test(v)) return parseInt(v, 10);
            if (/^-?\d*\.\d+$/.test(v)) return parseFloat(v);
            return v;
        },
        _stringify(v) {
            if (typeof v === 'object' && v !== null) return JSON.stringify(v);
            return String(v);
        },
        /**
         * Проверяет версию схемы prefs. Если она меньше текущей —
         * сбрасывает старые значения (миграция).
         */
        migrate() {
            const saved = parseInt(ML.storage.get('prefs.schema', '0'), 10) || 0;
            if (saved === PREFS_SCHEMA_VERSION) return;
            if (saved < PREFS_SCHEMA_VERSION) {
                Object.keys(PREF_DEFAULTS).forEach(function (k) {
                    ML.storage.remove('prefs.' + k);
                });
            }
            ML.storage.set('prefs.schema', String(PREFS_SCHEMA_VERSION));
        }
    };

    // =========================================================================
    // 5. ЛОКАЛИЗАЦИЯ
    // =========================================================================

    const I18N = {
        ru: {
            'common.ok': 'ОК',
            'common.cancel': 'Отмена',
            'common.close': 'Закрыть',
            'common.copy': 'Скопировать',
            'common.copied': 'Скопировано',
            'common.error': 'Ошибка',
            'common.warning': 'Внимание',
            'common.loading': 'Загрузка…',
            'common.computing': 'Вычисляем…',
            'common.save': 'Сохранить',
            'common.delete': 'Удалить',
            'common.confirm': 'Подтвердить',
            'common.yes': 'Да',
            'common.no': 'Нет',
            'theme.light': 'Светлая тема',
            'theme.dark': 'Тёмная тема',
            'theme.auto': 'Системная тема'
        },
        en: {
            'common.ok': 'OK',
            'common.cancel': 'Cancel',
            'common.close': 'Close',
            'common.copy': 'Copy',
            'common.copied': 'Copied',
            'common.error': 'Error',
            'common.warning': 'Warning',
            'common.loading': 'Loading…',
            'common.computing': 'Computing…',
            'common.save': 'Save',
            'common.delete': 'Delete',
            'common.confirm': 'Confirm',
            'common.yes': 'Yes',
            'common.no': 'No',
            'theme.light': 'Light theme',
            'theme.dark': 'Dark theme',
            'theme.auto': 'System theme'
        }
    };

    ML.i18n = {
        available: Object.keys(I18N),
        locale() { return ML.prefs.get('locale') || 'ru'; },
        setLocale(loc) {
            if (!I18N[loc]) return;
            ML.prefs.set('locale', loc);
            document.documentElement.lang = loc;
            ML.emit('i18n:change', { locale: loc });
        },
        t(key, fallback) {
            const loc = ML.i18n.locale();
            return (I18N[loc] && I18N[loc][key]) || fallback || key;
        }
    };

    // =========================================================================
    // 6. ТЕМА
    // =========================================================================

    ML.theme = {
        STORAGE_KEY: 'theme',

        current() {
            return document.documentElement.getAttribute('data-theme') || 'light';
        },

        preferred() {
            const pref = ML.prefs.get('theme') || 'auto';
            if (pref === 'auto') {
                try {
                    return window.matchMedia('(prefers-color-scheme: dark)').matches
                        ? 'dark' : 'light';
                } catch (e) { return 'light'; }
            }
            return pref;
        },

        apply(theme) {
            document.documentElement.setAttribute('data-theme', theme);

            // Обновляем оба meta[name="theme-color"] (light + dark)
            const metas = document.querySelectorAll('meta[name="theme-color"]');
            if (metas.length > 0) {
                metas.forEach(function (meta) {
                    const media = meta.getAttribute('media') || '';
                    if (media.indexOf('light') !== -1) {
                        meta.setAttribute('content', '#F7F8FC');
                    } else if (media.indexOf('dark') !== -1) {
                        meta.setAttribute('content', '#0B0E1A');
                    }
                });
            }

            ML.emit('theme:change', { theme: theme });
        },

        set(pref) {
            ML.prefs.set('theme', pref);
            this.apply(this.preferred());
        },

        toggle() {
            const next = this.current() === 'dark' ? 'light' : 'dark';
            this.set(next);
            ML.toast.info(
                next === 'dark'
                    ? ML.i18n.t('theme.dark')
                    : ML.i18n.t('theme.light')
            );
            return next;
        },

        /**
         * Возвращает true, если тема сейчас следует системной.
         */
        followSystem() {
            return (ML.prefs.get('theme') || 'auto') === 'auto';
        },

        init() {
            const self = this;
            this.apply(this.preferred());

            try {
                const mq = window.matchMedia('(prefers-color-scheme: dark)');
                if (mq.addEventListener) {
                    mq.addEventListener('change', function (e) {
                        ML.emit('theme:system-change', { dark: e.matches });
                        if (self.followSystem()) self.apply(self.preferred());
                    });
                }
            } catch (e) { /* noop */ }

            ML.$$('[data-theme-toggle]').forEach(function (btn) {
                if (btn.dataset.themeBound === '1') return;
                btn.dataset.themeBound = '1';
                btn.addEventListener('click', function (e) {
                    e.preventDefault();
                    self.toggle();
                });
            });
        }
    };

    // =========================================================================
    // 7. TOAST
    // =========================================================================

    ML.toast = (function () {
        const CONTAINER_SELECTOR = '[data-toast-container]';
        const DEFAULT_DURATION = 4000;

        const ICONS = {
            success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
            error:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
            warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            info:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
        };

        const CLOSE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

        function getContainer() {
            let c = document.querySelector(CONTAINER_SELECTOR);
            if (!c) {
                c = document.createElement('div');
                c.className = 'toast-container';
                c.setAttribute('data-toast-container', '');
                c.setAttribute('aria-live', 'polite');
                document.body.appendChild(c);
            }
            return c;
        }

        function show(type, title, message, duration) {
            if (!ICONS[type]) type = 'info';
            if (duration === undefined) duration = DEFAULT_DURATION;

            const container = getContainer();

            const toast = document.createElement('div');
            toast.className = 'toast toast--' + type;
            toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

            const iconWrap = document.createElement('div');
            iconWrap.className = 'toast-icon';
            iconWrap.innerHTML = ICONS[type];

            const body = document.createElement('div');
            body.className = 'toast-body';

            if (title) {
                const titleEl = document.createElement('p');
                titleEl.className = 'toast-title';
                titleEl.textContent = title;
                body.appendChild(titleEl);
            }
            if (message) {
                const msgEl = document.createElement('p');
                msgEl.className = 'toast-message';
                msgEl.textContent = message;
                body.appendChild(msgEl);
            }

            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'toast-close';
            closeBtn.setAttribute('aria-label', 'Close');
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
            show: show,
            success: function (t, m, d) { return show('success', t, m, d); },
            error:   function (t, m, d) { return show('error', t, m, d); },
            warning: function (t, m, d) { return show('warning', t, m, d); },
            info:    function (t, m, d) { return show('info', t, m, d); }
        };
    })();

    // =========================================================================
    // 8. LOADER
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
                    const t = el.querySelector('.loader-text');
                    if (t) t.textContent = text;
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
                counter = 0;
                const el = getNode();
                if (!el) return;
                el.classList.remove('is-visible');
                el.hidden = true;
            }
        };
    })();

    // =========================================================================
    // 9. API
    // =========================================================================

    const API_DEFAULT_TIMEOUT = 30000;

    function parseError(response, payload) {
        let msg = (payload && (payload.error || payload.message)) || '';
        let code = (payload && payload.code) || '';

        if (!msg) {
            if (response.status === 0) msg = 'Сеть недоступна.';
            else if (response.status === 400) msg = 'Некорректный запрос.';
            else if (response.status === 401) msg = 'Требуется авторизация.';
            else if (response.status === 403) msg = 'Доступ запрещён.';
            else if (response.status === 404) msg = 'Ресурс не найден.';
            else if (response.status === 413) msg = 'Слишком большой запрос.';
            else if (response.status === 429) msg = 'Слишком много запросов.';
            else if (response.status >= 500) msg = 'Ошибка сервера.';
            else msg = 'Ошибка ' + response.status;
        }

        const err = new Error(msg);
        err.status = response.status;
        err.code = code;
        err.payload = payload;
        return err;
    }

    function shouldRetry(error) {
        if (!error) return false;
        if (error.code === 'NETWORK') return true;
        if (error.code === 'TIMEOUT') return true;
        if (error.status >= 500) return true;
        if (error.status === 429) return true;
        return false;
    }

    async function requestOnce(method, url, data, options) {
        const timeout = (options && options.timeout) || API_DEFAULT_TIMEOUT;
        const headers = Object.assign({
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        }, (options && options.headers) || {});

        const init = {
            method: method,
            headers: headers,
            credentials: 'same-origin'
        };

        if (method !== 'GET' && method !== 'HEAD') {
            headers['Content-Type'] = 'application/json';
            headers['X-CSRFToken'] = ML.getCsrfToken();
            init.body = JSON.stringify(data || {});
        }

        let controller = null;
        if (typeof AbortController !== 'undefined') {
            controller = new AbortController();
            init.signal = controller.signal;
        }

        const timer = timeout > 0 ? setTimeout(function () {
            if (controller) controller.abort();
        }, timeout) : null;

        let response;
        try {
            response = await fetch(url, init);
        } catch (e) {
            if (timer) clearTimeout(timer);
            if (e.name === 'AbortError') {
                const err = new Error('Превышено время ожидания.');
                err.code = 'TIMEOUT';
                throw err;
            }
            const err = new Error('Не удалось соединиться с сервером.');
            err.code = 'NETWORK';
            throw err;
        }

        if (timer) clearTimeout(timer);

        let payload = null;
        const ct = response.headers.get('content-type') || '';
        try {
            if (ct.indexOf('application/json') !== -1) {
                payload = await response.json();
            } else {
                const text = await response.text();
                try { payload = JSON.parse(text); }
                catch (e) { payload = { raw: text }; }
            }
        } catch (e) {
            payload = null;
        }

        if (!response.ok || (payload && payload.success === false)) {
            throw parseError(response, payload);
        }

        return payload || {};
    }

    async function request(method, url, data, options) {
        options = options || {};
        const retries = options.retries == null ? 1 : options.retries;
        const retryDelay = options.retryDelay == null ? 500 : options.retryDelay;

        let lastError = null;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                return await requestOnce(method, url, data, options);
            } catch (err) {
                lastError = err;

                // 401 — просим перезагрузить страницу (CSRF истёк)
                if (err.status === 401 || err.status === 403) {
                    ML.emit('api:auth-error', { error: err });
                    throw err;
                }

                if (attempt < retries && shouldRetry(err)) {
                    await new Promise(function (res) {
                        setTimeout(res, retryDelay * (attempt + 1));
                    });
                    continue;
                }
                throw err;
            }
        }

        throw lastError || new Error('Request failed');
    }

    ML.api = {
        get(url, options) { return request('GET', url, null, options); },
        post(url, data, options) { return request('POST', url, data, options); },
        put(url, data, options) { return request('PUT', url, data, options); },
        del(url, options) { return request('DELETE', url, null, options); }
    };

    // =========================================================================
    // 10. КОПИРОВАНИЕ
    // =========================================================================

    function copyToClipboard(text) {
        text = text == null ? '' : String(text);
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text);
        }
        return new Promise(function (resolve, reject) {
            try {
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
                ok ? resolve() : reject(new Error('execCommand copy failed'));
            } catch (e) { reject(e); }
        });
    }

    ML.copy = {
        async text(text, successMessage) {
            try {
                await copyToClipboard(text);
                ML.toast.success(successMessage || ML.i18n.t('common.copied'));
                return true;
            } catch (e) {
                ML.toast.error('Не удалось скопировать', 'Выделите текст вручную.');
                return false;
            }
        },
        latex(text, msg) {
            return this.text(text, msg || 'LaTeX скопирован');
        },
        markdown(text, msg) {
            return this.text(text, msg || 'Markdown скопирован');
        },
        json(data, msg) {
            const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
            return this.text(text, msg || 'JSON скопирован');
        },
        from(el, msg) {
            if (!el) return Promise.resolve(false);
            const text = el.getAttribute('data-copy-text')
                || el.getAttribute('data-copy-latex')
                || el.textContent
                || '';
            return this.text(text, msg);
        }
    };

    // =========================================================================
    // 11. MATHJAX
    // =========================================================================

    ML.mathjax = {
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
        }
    };

    // =========================================================================
    // 12. ФОРМАТИРОВАНИЕ ЧИСЕЛ
    // =========================================================================

    ML.format = {
        number(v, precision) {
            if (v === null || v === undefined || v === '') return '';
            const n = typeof v === 'number' ? v : parseFloat(v);
            if (isNaN(n)) return String(v);
            if (Number.isInteger(n)) return String(n);
            const p = precision == null ? ML.prefs.get('precision') : precision;
            return n.toFixed(p).replace(/\.?0+$/, '');
        },
        fraction(num, den) {
            if (den === 0) return '\\text{∞}';
            if (num === 0) return '0';
            if (den === 1) return String(num);
            const sign = (num < 0) !== (den < 0) ? '-' : '';
            return sign + '\\dfrac{' + Math.abs(num) + '}{' + Math.abs(den) + '}';
        },
        complex(re, im) {
            if (im === 0) return String(re);
            if (re === 0) return (im === 1 ? '' : im === -1 ? '-' : im) + 'i';
            const sign = im > 0 ? '+' : '-';
            const absIm = Math.abs(im);
            return re + sign + (absIm === 1 ? '' : absIm) + 'i';
        },
        matrixToLatex(matrix, brackets) {
            if (!Array.isArray(matrix) || !matrix.length) return '';
            const open  = brackets === 'p' ? '\\begin{pmatrix}' : '\\begin{bmatrix}';
            const close = brackets === 'p' ? '\\end{pmatrix}'   : '\\end{bmatrix}';
            const rows = matrix.map(function (row) {
                return (Array.isArray(row) ? row : [row]).map(function (v) {
                    return String(v == null ? '' : v);
                }).join(' & ');
            }).join(' \\\\ ');
            return open + ' ' + rows + ' ' + close;
        },
        matrixToText(matrix) {
            if (!Array.isArray(matrix)) return '';
            return matrix.map(function (row) {
                return Array.isArray(row) ? row.join('\t') : String(row);
            }).join('\n');
        }
    };

    // =========================================================================
    // 13. МОДАЛЬНЫЕ ОКНА
    // =========================================================================

    const MODAL_CLOSE_SELECTOR = [
        '[data-modal-close]',
        '[data-random-close]',
        '[data-history-modal-close]',
        '[data-saved-modal-close]',
        '[data-examples-close]',
        '[data-export-close]',
        '[data-mobile-nav-close]'
    ].join(', ');

    ML.modal = {
        _openStack: [],

        open(selector) {
            const modal = typeof selector === 'string'
                ? document.querySelector(selector)
                : selector;
            if (!modal) return;

            modal.hidden = false;
            document.body.style.overflow = 'hidden';
            this._openStack.push(modal);

            if (modal.dataset.modalBound !== '1') {
                modal.dataset.modalBound = '1';
                const self = this;
                modal.querySelectorAll(MODAL_CLOSE_SELECTOR).forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        self.close(modal);
                    });
                });
                modal.addEventListener('click', function (e) {
                    if (e.target === modal || e.target.classList.contains('modal-backdrop')) {
                        self.close(modal);
                    }
                });
            }

            setTimeout(function () {
                const firstInput = modal.querySelector('input:not([type=hidden]), textarea, select');
                if (firstInput && typeof firstInput.focus === 'function') {
                    try { firstInput.focus(); } catch (e) { /* noop */ }
                }
            }, 50);

            ML.emit('modal:open', { modal: modal });
        },

        close(selector) {
            const modal = typeof selector === 'string'
                ? document.querySelector(selector)
                : selector;
            if (!modal) return;

            modal.hidden = true;
            this._openStack = this._openStack.filter(function (m) { return m !== modal; });

            if (this._openStack.length === 0) {
                document.body.style.overflow = '';
            }

            ML.emit('modal:close', { modal: modal });
        },

        closeAll() {
            const self = this;
            this._openStack.slice().forEach(function (m) { self.close(m); });
        },

        toggle(selector) {
            const modal = typeof selector === 'string'
                ? document.querySelector(selector)
                : selector;
            if (!modal) return;
            if (modal.hidden) this.open(modal);
            else this.close(modal);
        }
    };

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && ML.modal._openStack.length > 0) {
            ML.modal.close(ML.modal._openStack[ML.modal._openStack.length - 1]);
        }
    });

    // =========================================================================
    // 14. ПОДТВЕРЖДЕНИЕ (Promise-based)
    // =========================================================================

    /**
     * Подтверждение действия.
     *
     * Ищет модалку [data-confirm-modal] с:
     *   [data-confirm-message] — текст
     *   [data-confirm-ok]      — кнопка «ОК»
     *   [data-confirm-cancel]  — кнопка «Отмена»
     *   [data-confirm-backdrop]— backdrop
     *
     * Если модалки нет — использует window.confirm.
     *
     * @param {string} message
     * @param {{okText?: string, cancelText?: string, title?: string}} [opts]
     * @returns {Promise<boolean>}
     */
    ML.confirm = function (message, opts) {
        opts = opts || {};

        const modal = document.querySelector('[data-confirm-modal]');
        if (!modal) {
            return Promise.resolve(window.confirm(message));
        }

        return new Promise(function (resolve) {
            const msgEl = modal.querySelector('[data-confirm-message]');
            const titleEl = modal.querySelector('[data-confirm-title]');
            const okBtn = modal.querySelector('[data-confirm-ok]');
            const cancelBtn = modal.querySelector('[data-confirm-cancel]');
            const backdrop = modal.querySelector('[data-confirm-backdrop]');

            if (msgEl) msgEl.textContent = message || '';
            if (titleEl && opts.title) titleEl.textContent = opts.title;
            if (okBtn && opts.okText) okBtn.textContent = opts.okText;
            if (cancelBtn && opts.cancelText) cancelBtn.textContent = opts.cancelText;

            function cleanup(result) {
                if (okBtn) okBtn.removeEventListener('click', onOk);
                if (cancelBtn) cancelBtn.removeEventListener('click', onCancel);
                if (backdrop) backdrop.removeEventListener('click', onCancel);
                document.removeEventListener('keydown', onKey);
                ML.modal.close(modal);
                resolve(result);
            }
            function onOk() { cleanup(true); }
            function onCancel() { cleanup(false); }
            function onKey(e) {
                if (e.key === 'Enter') { e.preventDefault(); onOk(); }
            }

            if (okBtn) okBtn.addEventListener('click', onOk);
            if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
            if (backdrop) backdrop.addEventListener('click', onCancel);
            document.addEventListener('keydown', onKey);

            ML.modal.open(modal);

            setTimeout(function () {
                if (okBtn && typeof okBtn.focus === 'function') {
                    try { okBtn.focus(); } catch (e) { /* noop */ }
                }
            }, 60);
        });
    };

    // =========================================================================
    // 15. ПРЕВЬЮ МАТРИЦ
    // =========================================================================

    ML.preview = {
        /**
         * Рендерит превью матрицы в контейнер через MathJax.
         * @param {HTMLElement} container
         * @param {Array<Array>} matrix
         * @param {{brackets?: 'p'|'b'}} [opts]
         */
        render(container, matrix, opts) {
            if (!container) return Promise.resolve();
            opts = opts || {};

            container.classList.add('is-loading');

            if (!Array.isArray(matrix) || !matrix.length) {
                container.classList.remove('is-loading');
                container.classList.add('is-error');
                container.innerHTML = '<span class="saved-card-preview-error">'
                    + ML.escapeHtml(ML.i18n.t('saved.invalidData', 'Некорректные данные'))
                    + '</span>';
                return Promise.resolve();
            }

            container.classList.remove('is-error');
            container.innerHTML = '';

            const wrap = document.createElement('div');
            wrap.className = 'ml-preview-matrix';
            wrap.innerHTML = '$$' + ML.format.matrixToLatex(matrix, opts.brackets) + '$$';
            container.appendChild(wrap);

            const done = ML.mathjax.typeset(container);
            return Promise.resolve(done).then(function () {
                container.classList.remove('is-loading');
            }).catch(function () {
                container.classList.remove('is-loading');
            });
        }
    };

    // =========================================================================
    // 16. ТЕКСТОВЫЙ ОТЧЁТ ИЗ PAYLOAD
    // =========================================================================

    /**
     * Собирает плоский текстовый отчёт из payload результата.
     * Используется в export.js и steps.js.
     * @param {object} payload
     * @returns {string}
     */
    ML.buildPlainText = function (payload) {
        if (!payload) return '';

        const lines = [];
        const t = function (k, d) { return ML.i18n.t(k, d); };

        lines.push('========================================');
        lines.push('            MatrixLab — ' + t('export.report', 'отчёт'));
        lines.push('========================================');
        lines.push('');

        // --- Задание
        const task = payload.task || {};
        if (task.operation_latex || task.matrix_latex
            || task.matrix_a_latex || task.vector_latex
            || (Array.isArray(task.matrices_latex) && task.matrices_latex.length)) {
            lines.push('--- ' + t('export.task', 'ЗАДАНИЕ') + ' ---');

            if (task.operation_latex) {
                lines.push('Операция: ' + String(task.operation_latex));
            }
            if (Array.isArray(task.matrices_latex) && task.matrices_latex.length) {
                task.matrices_latex.forEach(function (m, i) {
                    lines.push('M' + (i + 1) + ' = ' + String(m));
                });
            } else if (task.matrix_a_latex && task.matrix_b_latex) {
                lines.push('A = ' + String(task.matrix_a_latex));
                lines.push('B = ' + String(task.matrix_b_latex));
            } else if (task.matrix_latex && task.vector_latex) {
                lines.push('A = ' + String(task.matrix_latex));
                lines.push('b = ' + String(task.vector_latex));
            } else if (task.matrix_latex) {
                lines.push('A = ' + String(task.matrix_latex));
            }
            lines.push('');
        }

        // --- Решение
        if (Array.isArray(payload.steps) && payload.steps.length) {
            lines.push('--- ' + t('export.solution', 'РЕШЕНИЕ') + ' ---');
            payload.steps.forEach(function (step, i) {
                lines.push('');
                lines.push('Шаг ' + (i + 1)
                    + (step.title ? '. ' + String(step.title) : ''));
                if (step.text) lines.push(String(step.text));
                if (step.latex) lines.push('  LaTeX: ' + String(step.latex));
            });
            lines.push('');
        }

        // --- Результат
        lines.push('--- ' + t('export.result', 'РЕЗУЛЬТАТ') + ' ---');
        if (payload.latex) lines.push('LaTeX: ' + String(payload.latex));
        if (payload.plain) lines.push(String(payload.plain));
        if (typeof payload.result !== 'undefined') {
            if (Array.isArray(payload.result)
                || (payload.result && typeof payload.result === 'object')) {
                try { lines.push(JSON.stringify(payload.result, null, 2)); }
                catch (e) { lines.push(String(payload.result)); }
            } else {
                lines.push(String(payload.result));
            }
        }

        // --- Проверки
        if (Array.isArray(payload.checks) && payload.checks.length) {
            lines.push('');
            lines.push('--- ' + t('export.checks', 'ПРОВЕРКИ') + ' ---');
            payload.checks.forEach(function (c) {
                lines.push((c.ok === false ? '[FAIL] ' : '[OK]   ')
                    + String(c.name || ''));
            });
        }

        // --- Пояснение
        if (payload.explanation) {
            lines.push('');
            lines.push('--- ' + t('export.explanation', 'ПОЯСНЕНИЕ') + ' ---');
            lines.push(String(payload.explanation));
        }

        return lines.join('\n');
    };

    // =========================================================================
    // 17. РЕЕСТР РЕНДЕРЕРОВ РЕЗУЛЬТАТА
    // =========================================================================

    /**
     * Реестр рендереров для steps.js.
     * Каждый рендерер получает payload и возвращает HTML-строку.
     *
     * steps.js регистрирует свои рендереры здесь:
     *   ML.resultRenderers.register('scalar', fn)
     *
     * Рендерер имеет подпись (payload) => string.
     */
    ML.resultRenderers = {
        _map: {},

        register(kind, renderer) {
            if (typeof renderer !== 'function') return;
            this._map[kind] = renderer;
        },

        get(kind) {
            return this._map[kind] || null;
        },

        render(kind, payload) {
            const fn = this.get(kind);
            if (!fn) return null;
            try {
                return fn(payload);
            } catch (e) {
                console.error('[MatrixLab][renderer:' + kind + ']', e);
                return null;
            }
        },

        list() {
            return Object.keys(this._map);
        }
    };

    // =========================================================================
    // 18. ВАЛИДАТОРЫ
    // =========================================================================

    const VALIDATORS = {
        integer:    /^-?\d+$/,
        decimal:    /^-?\d*\.\d+$|^-?\d+\.\d*$/,
        fraction:   /^-?\d+\s*\/\s*-?\d+$/,
        complex:    /^-?\d*\.?\d*\s*[+-]\s*\d*\.?\d*i$|^-?\d*\.?\d*i$/,
        sqrt:       /^sqrt\s*\(\s*[^()]+\s*\)$/,
        constant:   /^(pi|e)$/,
        expression: /^[0-9a-zA-Z+\-*/^().,\s]+$/
    };

    const ALLOWED_TOKENS = /^(sqrt|pi|e|i|\d+|\+|\-|\*|\/|\^|\(|\)|\.|,|\s)+$/;

    ML.validators = {
        /**
         * Классифицирует ввод ячейки матрицы.
         * @returns {{valid: boolean, kind: string, message: string}}
         */
        classifyInput(raw) {
            const s = String(raw == null ? '' : raw).trim();

            if (s === '') return { valid: true, kind: 'empty', message: '' };

            if (VALIDATORS.integer.test(s))
                return { valid: true, kind: 'integer', message: '' };
            if (VALIDATORS.decimal.test(s))
                return { valid: true, kind: 'decimal', message: '' };
            if (VALIDATORS.fraction.test(s))
                return { valid: true, kind: 'fraction', message: '' };
            if (VALIDATORS.complex.test(s))
                return { valid: true, kind: 'complex', message: '' };
            if (VALIDATORS.sqrt.test(s))
                return { valid: true, kind: 'sqrt', message: '' };
            if (VALIDATORS.constant.test(s))
                return { valid: true, kind: 'constant', message: '' };

            if (ALLOWED_TOKENS.test(s) && /[+\-*/^()]/.test(s))
                return { valid: true, kind: 'expression', message: '' };

            if (/\/\s*0($|[^\d.])/.test(s))
                return { valid: false, kind: 'invalid', message: 'Деление на ноль' };
            if (/[+\-*/^]{2,}/.test(s) && !/^[+-]/.test(s))
                return { valid: false, kind: 'invalid', message: 'Двойной оператор' };
            if (/[a-zA-Z]+/.test(s.replace(/sqrt|pi|e|i/g, '')))
                return { valid: false, kind: 'invalid',
                         message: 'Неизвестная функция или переменная' };

            return { valid: false, kind: 'invalid', message: 'Некорректное выражение' };
        },

        isEmptyMatrix(m) {
            if (!Array.isArray(m) || !m.length) return true;
            return m.every(function (row) {
                return row.every(function (v) { return v === ''; });
            });
        },

        isEmptyVector(v) {
            if (!Array.isArray(v) || !v.length) return true;
            return v.every(function (x) { return x === ''; });
        }
    };

    // =========================================================================
    // 19. HAPTIC FEEDBACK
    // =========================================================================

    ML.haptic = function (style) {
        style = style || 'light';

        if (ML.prefs && ML.prefs.get('haptic') === false) return;
        if (!navigator.vibrate) return;

        try {
            switch (style) {
                case 'light':   navigator.vibrate(8); break;
                case 'medium':  navigator.vibrate(15); break;
                case 'heavy':   navigator.vibrate(25); break;
                case 'success': navigator.vibrate([10, 40, 10]); break;
                case 'error':   navigator.vibrate([25, 50, 25]); break;
                default:        navigator.vibrate(8);
            }
            ML.emit('haptic', { style: style });
        } catch (e) { /* noop */ }
    };

    // =========================================================================
    // 20. ДЕЛЕГИРОВАНИЕ КОПИРОВАНИЯ
    // =========================================================================

    document.addEventListener('click', function (e) {
        const latexBtn = e.target.closest('[data-copy-latex]');
        if (latexBtn) {
            e.preventDefault();
            ML.copy.latex(latexBtn.getAttribute('data-copy-latex') || '');
            return;
        }
        const jsonBtn = e.target.closest('[data-copy-json]');
        if (jsonBtn) {
            e.preventDefault();
            ML.copy.json(jsonBtn.getAttribute('data-copy-json') || '');
            return;
        }
        const mdBtn = e.target.closest('[data-copy-markdown]');
        if (mdBtn) {
            e.preventDefault();
            ML.copy.markdown(mdBtn.getAttribute('data-copy-markdown') || '');
            return;
        }
        const textBtn = e.target.closest('[data-copy-text]');
        if (textBtn) {
            e.preventDefault();
            ML.copy.text(textBtn.getAttribute('data-copy-text') || '');
            return;
        }
    });

    // =========================================================================
    // 21. ГОРЯЧИЕ КЛАВИШИ
    // =========================================================================

    ML.hotkeys = {
        init() {
            document.addEventListener('keydown', function (e) {
                const tag = (e.target && e.target.tagName) || '';
                const inField = /INPUT|TEXTAREA|SELECT/.test(tag)
                    || (e.target && e.target.isContentEditable);

                // Ctrl/Cmd + K — поиск
                if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
                    e.preventDefault();
                    ML.search && ML.search.open && ML.search.open();
                    return;
                }

                // Ctrl/Cmd + / — горячая справка
                if ((e.ctrlKey || e.metaKey) && e.key === '/') {
                    e.preventDefault();
                    ML.emit('hotkeys:help', {});
                    return;
                }

                // Esc в поле — снять фокус
                if (e.key === 'Escape' && inField) {
                    e.target.blur();
                }
            });
        }
    };

    // =========================================================================
    // 22. КЛИЕНТСКАЯ ИСТОРИЯ
    // =========================================================================

    ML.history = ML.history || {
        _items: [],
        push(entry) {
            if (!entry) return;
            entry.ts = entry.ts || Date.now();
            entry.id = entry.id
                || (entry.ts + '-' + Math.random().toString(36).slice(2, 8));
            this._items.unshift(entry);
            if (this._items.length > 200) this._items.pop();
            ML.storage.setJSON('history', this._items.slice(0, 50));
            ML.emit('history:change', {});
            return entry;
        },
        all() { return this._items.slice(); },
        clear() {
            this._items = [];
            ML.storage.remove('history');
            ML.emit('history:change', {});
        },
        remove(id) {
            this._items = this._items.filter(function (x) { return x.id !== id; });
            ML.storage.setJSON('history', this._items.slice(0, 50));
            ML.emit('history:change', {});
        },
        load() {
            const saved = ML.storage.getJSON('history', []);
            if (Array.isArray(saved)) this._items = saved;
        }
    };

    // =========================================================================
    // 23. РАБОЧЕЕ ПРОСТРАНСТВО
    // =========================================================================

    ML.workspace = ML.workspace || {
        _items: {},
        set(name, mi) {
            this._items[name] = mi;
            ML.emit('workspace:change', { name: name });
        },
        get(name) { return this._items[name] || null; },
        remove(name) {
            delete this._items[name];
            ML.emit('workspace:change', { name: name });
        },
        list() {
            const self = this;
            return Object.keys(this._items).map(function (k) {
                return { name: k, mi: self._items[k] };
            });
        },
        clear() { this._items = {}; }
    };

    // =========================================================================
    // 24. РЕЕСТР МОДУЛЕЙ И BOOT
    // =========================================================================

    const _modules = [];
    let _booted = false;

    ML.register = function (name, initFn) {
        _modules.push({ name: name, init: initFn });
    };

    ML.boot = function () {
        if (_booted) return;
        _booted = true;

        // Миграция prefs перед первым чтением
        ML.prefs.migrate();

        // Ядро
        ML.theme.init();
        ML.hotkeys.init();
        ML.history.load();

        document.documentElement.lang = ML.i18n.locale();

        // Модули — устойчиво, чтобы падение одного не роняло остальные
        _modules.forEach(function (m) {
            try {
                m.init();
                ML.emit('module:ready', { name: m.name });
            } catch (e) {
                console.error('[MatrixLab][module:' + m.name + ']', e);
            }
        });

        ML.emit('boot', {});
    };

    // =========================================================================
    // 25. ERROR BOUNDARY
    // =========================================================================

    window.addEventListener('error', function (e) {
        if (!e || !e.message) return;
        if (/ResizeObserver/.test(e.message)) return;
        console.error('[MatrixLab] Unhandled error:', e.message);
    });

    window.addEventListener('unhandledrejection', function (e) {
        const reason = e && e.reason;
        if (!reason) return;
        if (reason.code === 'TIMEOUT' || reason.code === 'NETWORK') return;
        if (reason.code === 'ABORTED') return;
        console.error('[MatrixLab] Unhandled rejection:', reason);
    });

    // =========================================================================
    // 26. ЗАПУСК
    // =========================================================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { ML.boot(); });
    } else {
        ML.boot();
    }

})();