/* =============================================================================
   MatrixLab — mobile.js
   =============================================================================
   Мобильный UX: bottom-sheet, свайпы, haptic, ripple, tabbar «Ещё»,
   bottom-nav, focus trap, safe-area.

   Возможности:
       • bottom-sheet «Ещё» с backdrop, свайпом вниз (с fling-детекцией),
         закрытием по Esc и по клику на backdrop;
       • focus trap — фокус не уходит за пределы открытого sheet;
       • возврат фокуса на кнопку-открывашку при закрытии;
       • FAB с ripple-эффектом и переходом по data-href;
       • tabbar «Ещё» открывает тот же bottom-sheet;
       • haptic на data-haptic и tabbar-кнопки — через ML.haptic;
       • запрет скролла под открытым sheet;
       • класс is-mobile на <html> — с учётом ширины, pointer: coarse
         и hover: none;
       • авто-закрытие sheet при переходе на десктоп;
       • полная работа через ML.mobile.{mount, openSheet, closeSheet,
         toggleSheet, haptic, isMobile, isOpen};
       • эмиты: mobile:ready, mobile:sheet-open, mobile:sheet-close,
         mobile:breakpoint.

   Публичный API:
       ML.mobile.mount(root)
       ML.mobile.openSheet()
       ML.mobile.closeSheet()
       ML.mobile.toggleSheet()
       ML.mobile.haptic(style)        ← алиас ML.haptic
       ML.mobile.isMobile()
       ML.mobile.isOpen()

   Зависимости: main.js (ML.prefs, ML.emit, ML.debounce, ML.$, ML.$$,
   ML.haptic).
   ============================================================================= */
(function () {
    'use strict';

    const ML = window.MatrixLab;
    if (!ML) {
        console.error('[mobile.js] window.MatrixLab не найден — модуль не запущен.');
        return;
    }

    // =========================================================================
    // 1. КОНСТАНТЫ
    // =========================================================================

    const BREAKPOINT = 992;
    const ANIM_MS = 280;
    const SWIPE_CLOSE_DISTANCE = 100;   // px — минимальное расстояние
    const SWIPE_CLOSE_VELOCITY = 0.5;   // px/ms — минимальная скорость для fling
    const HANDLE_ZONE = 90;             // px — зона захвата у верхней кромки

    // =========================================================================
    // 2. СОСТОЯНИЕ
    // =========================================================================

    const state = {
        sheetEl: null,
        backdropEl: null,
        toggleEl: null,
        handleEl: null,
        fabEl: null,
        moreBtnEl: null,
        lastFocusedEl: null,

        isOpen: false,
        dragging: false,

        startY: 0,
        currentY: 0,
        startTime: 0,
        lastY: 0,
        lastTime: 0,
        velocity: 0,

        rafId: 0,
        _bound: false,
        _mounted: false
    };

    // =========================================================================
    // 3. ПРОВЕРКА «МОБИЛЬНОСТИ»
    // =========================================================================

    function mqWidth() {
        return window.matchMedia('(max-width: ' + BREAKPOINT + 'px)');
    }

    function isCoarse() {
        try {
            return window.matchMedia('(pointer: coarse)').matches;
        } catch (e) { return false; }
    }

    function isMobile() {
        // Основной критерий — ширина. Дополнительно: если pointer: coarse,
        // считаем мобильным даже на широком экране (планшет).
        return mqWidth().matches || isCoarse();
    }

    function isOpen() {
        return state.isOpen;
    }

    // =========================================================================
    // 4. HAPTIC (алиас на ML.haptic)
    // =========================================================================

    function haptic(style) {
        if (typeof ML.haptic === 'function') {
            ML.haptic(style);
        }
    }

    // =========================================================================
    // 5. BOTTOM-SHEET — ОТКРЫТИЕ / ЗАКРЫТИЕ
    // =========================================================================

    function openSheet() {
        if (!state.sheetEl || !state.backdropEl) return;
        if (state.isOpen) return;

        state.isOpen = true;
        state.lastFocusedEl = document.activeElement;

        state.sheetEl.hidden = false;
        state.sheetEl.setAttribute('aria-hidden', 'false');
        state.backdropEl.hidden = false;

        state.sheetEl.classList.remove('is-closing');
        state.sheetEl.style.transform = '';

        document.body.style.overflow = 'hidden';
        document.body.classList.add('has-sheet-open');

        if (state.toggleEl) {
            state.toggleEl.setAttribute('aria-expanded', 'true');
        }

        haptic('light');
        ML.emit('mobile:sheet-open', {});

        // Фокус — на первую интерактивную кнопку внутри sheet
        setTimeout(function () {
            if (!state.sheetEl) return;
            const firstBtn = state.sheetEl.querySelector(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            if (firstBtn && typeof firstBtn.focus === 'function') {
                try { firstBtn.focus({ preventScroll: true }); }
                catch (e) { /* noop */ }
            }
        }, 60);
    }

    function closeSheet() {
        if (!state.sheetEl || !state.backdropEl) return;
        if (!state.isOpen) return;

        state.isOpen = false;
        state.sheetEl.classList.add('is-closing');

        setTimeout(function () {
            if (!state.sheetEl) return;
            state.sheetEl.hidden = true;
            state.sheetEl.setAttribute('aria-hidden', 'true');
            state.backdropEl.hidden = true;
            state.sheetEl.classList.remove('is-closing');
            state.sheetEl.style.transform = '';
            document.body.style.overflow = '';
            document.body.classList.remove('has-sheet-open');
        }, ANIM_MS);

        if (state.toggleEl) {
            state.toggleEl.setAttribute('aria-expanded', 'false');
        }

        // Возврат фокуса
        if (state.lastFocusedEl
            && typeof state.lastFocusedEl.focus === 'function') {
            try { state.lastFocusedEl.focus({ preventScroll: true }); }
            catch (e) { /* noop */ }
        }
        state.lastFocusedEl = null;

        haptic('light');
        ML.emit('mobile:sheet-close', {});
    }

    function toggleSheet() {
        state.isOpen ? closeSheet() : openSheet();
    }

    // =========================================================================
    // 6. СВАЙП ВНИЗ
    // =========================================================================

    function applyDragTransform() {
        if (!state.sheetEl) return;
        const delta = Math.max(0, state.currentY - state.startY);
        state.sheetEl.style.transform = 'translateY(' + delta + 'px)';
    }

    function onTouchStart(e) {
        if (!state.isOpen || !state.sheetEl) return;
        const touch = e.touches && e.touches[0];
        if (!touch) return;

        const rect = state.sheetEl.getBoundingClientRect();
        if (touch.clientY - rect.top > HANDLE_ZONE) return;

        state.startY = touch.clientY;
        state.currentY = touch.clientY;
        state.startTime = Date.now();
        state.lastY = touch.clientY;
        state.lastTime = state.startTime;
        state.velocity = 0;
        state.dragging = true;

        state.sheetEl.style.transition = 'none';
        state.sheetEl.style.willChange = 'transform';
    }

    function onTouchMove(e) {
        if (!state.dragging) return;
        const touch = e.touches && e.touches[0];
        if (!touch) return;

        state.currentY = touch.clientY;

        // Скорость — сглаженная
        const now = Date.now();
        const dt = now - state.lastTime;
        if (dt > 0) {
            const dy = touch.clientY - state.lastY;
            state.velocity = dy / dt;
            state.lastY = touch.clientY;
            state.lastTime = now;
        }

        if (state.rafId) return;
        state.rafId = requestAnimationFrame(function () {
            state.rafId = 0;
            applyDragTransform();
        });
    }

    function onTouchEnd() {
        if (!state.dragging) return;
        state.dragging = false;
        if (!state.sheetEl) return;

        if (state.rafId) {
            cancelAnimationFrame(state.rafId);
            state.rafId = 0;
        }

        state.sheetEl.style.transition = '';
        state.sheetEl.style.willChange = '';

        const delta = state.currentY - state.startY;

        // Fling: быстрый свайп вниз — закрываем даже при малом смещении
        const flingClose = state.velocity > SWIPE_CLOSE_VELOCITY
            && delta > 30;

        if (delta > SWIPE_CLOSE_DISTANCE || flingClose) {
            closeSheet();
        } else {
            state.sheetEl.style.transform = '';
        }
    }

    // =========================================================================
    // 7. FAB RIPPLE
    // =========================================================================

    function initFabRipple(fab) {
        if (!fab || fab.dataset.fabBound === '1') return;
        fab.dataset.fabBound = '1';

        fab.addEventListener('touchstart', function (e) {
            const touch = e.touches && e.touches[0];
            if (!touch) return;
            const rect = fab.getBoundingClientRect();
            const x = ((touch.clientX - rect.left) / rect.width) * 100;
            const y = ((touch.clientY - rect.top) / rect.height) * 100;
            fab.style.setProperty('--ripple-x', x + '%');
            fab.style.setProperty('--ripple-y', y + '%');
            fab.classList.add('is-rippling');
            setTimeout(function () {
                fab.classList.remove('is-rippling');
            }, 600);
        }, { passive: true });

        fab.addEventListener('click', function (e) {
            haptic('medium');
            const href = fab.dataset.href;
            if (href) {
                e.preventDefault();
                window.location.href = href;
            }
        });
    }

    // =========================================================================
    // 8. FOCUS TRAP
    // =========================================================================

    function trapFocus(e) {
        if (!state.isOpen || !state.sheetEl) return;
        if (e.key !== 'Tab') return;

        const focusables = state.sheetEl.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), '
            + 'select:not([disabled]), textarea:not([disabled]), '
            + '[tabindex]:not([tabindex="-1"])'
        );
        if (!focusables.length) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    // =========================================================================
    // 9. ГЛОБАЛЬНЫЕ ДЕЛЕГАТЫ
    // =========================================================================

    function bindGlobalDelegates() {
        if (state._bound) return;
        state._bound = true;

        // Haptic на data-haptic
        document.addEventListener('click', function (e) {
            const el = e.target.closest('[data-haptic]');
            if (!el) return;
            haptic(el.getAttribute('data-haptic') || 'light');
        }, { passive: true });

        // Haptic на tabbar
        document.addEventListener('click', function (e) {
            const tab = e.target.closest('[data-mobile-tab]');
            if (!tab) return;
            haptic('light');
        }, { passive: true });

        // Esc — закрыть sheet
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && state.isOpen) {
                closeSheet();
                return;
            }
            trapFocus(e);
        });

        // Запрет скролла под sheet
        document.addEventListener('touchmove', function (e) {
            if (state.isOpen && !e.target.closest('[data-mobile-nav]')) {
                e.preventDefault();
            }
        }, { passive: false });

        // Ресайз
        const onResize = ML.debounce(function () {
            applyMobileClass();
            if (!mqWidth().matches && state.isOpen) closeSheet();
        }, 120);
        window.addEventListener('resize', onResize, { passive: true });

        // Слежение за медиа-запросом ширины
        const m = mqWidth();
        if (m.addEventListener) {
            m.addEventListener('change', function (ev) {
                applyMobileClass();
                if (!ev.matches && state.isOpen) closeSheet();
            });
        }
    }

    // =========================================================================
    // 10. КЛАСС is-mobile
    // =========================================================================

    let _lastMobileState = null;

    function applyMobileClass(force) {
        const isM = typeof force === 'boolean' ? force : isMobile();
        if (_lastMobileState === isM) return;
        _lastMobileState = isM;

        document.documentElement.classList.toggle('is-mobile', isM);
        ML.emit('mobile:breakpoint', { isMobile: isM });
    }

    // =========================================================================
    // 11. КЭШ ЭЛЕМЕНТОВ
    // =========================================================================

    function cacheElements(root) {
        state.sheetEl    = root.querySelector('[data-mobile-nav]');
        state.backdropEl = root.querySelector('[data-mobile-nav-backdrop]');
        state.toggleEl   = root.querySelector('[data-nav-toggle]');
        state.handleEl   = root.querySelector('[data-sheet-handle]');
        state.fabEl      = root.querySelector('[data-mobile-fab]');
        state.moreBtnEl  = root.querySelector('[data-mobile-tabbar-more]');

        // Начальное состояние a11y
        if (state.sheetEl) {
            state.sheetEl.setAttribute('aria-hidden', 'true');
        }
    }

    // =========================================================================
    // 12. МОНТИРОВАНИЕ
    // =========================================================================

    function mount(root) {
        root = root || document;

        if (state._mounted) {
            cacheElements(root);
            return;
        }
        state._mounted = true;

        cacheElements(root);
        applyMobileClass();
        bindGlobalDelegates();

        // Кнопка-тоггл (гамбургер)
        if (state.toggleEl) {
            state.toggleEl.addEventListener('click', function (e) {
                e.preventDefault();
                toggleSheet();
            });
        }

        // Backdrop
        if (state.backdropEl) {
            state.backdropEl.addEventListener('click', closeSheet);
        }

        // Кнопки закрытия внутри sheet
        ML.$$('[data-mobile-nav-close]', root).forEach(function (btn) {
            btn.addEventListener('click', closeSheet);
        });

        // Ссылки внутри sheet — закрывают после клика
        if (state.sheetEl) {
            ML.$$('a[href]', state.sheetEl).forEach(function (a) {
                a.addEventListener('click', function () {
                    setTimeout(closeSheet, 60);
                });
            });

            // Свайп
            state.sheetEl.addEventListener('touchstart', onTouchStart, { passive: true });
            state.sheetEl.addEventListener('touchmove', onTouchMove, { passive: true });
            state.sheetEl.addEventListener('touchend', onTouchEnd, { passive: true });
            state.sheetEl.addEventListener('touchcancel', onTouchEnd, { passive: true });
        }

        // FAB
        if (state.fabEl) initFabRipple(state.fabEl);

        // Tabbar «Ещё»
        if (state.moreBtnEl) {
            state.moreBtnEl.addEventListener('click', function (e) {
                e.preventDefault();
                openSheet();
            });
        }

        ML.emit('mobile:ready', { isMobile: isMobile() });
    }

    // =========================================================================
    // 13. ПУБЛИЧНЫЙ API
    // =========================================================================

    ML.mobile = {
        mount: mount,
        openSheet: openSheet,
        closeSheet: closeSheet,
        toggleSheet: toggleSheet,
        haptic: haptic,
        isMobile: isMobile,
        isOpen: isOpen,
        breakpoint: BREAKPOINT
    };

    // Совместимость с main.js
    ML.mobileNav = ML.mobileNav || {};
    ML.mobileNav.init = function (root) { mount(root || document); };

    // =========================================================================
    // 14. АВТОЗАПУСК
    // =========================================================================

    function init() {
        // Всегда обновляем класс и делегаты — haptic, breakpoint нужны везде
        applyMobileClass();
        bindGlobalDelegates();

        // Полный mount — только если есть мобильная разметка
        if (document.querySelector(
            '[data-mobile-nav], [data-mobile-fab], [data-mobile-tabbar-more]'
        )) {
            mount(document);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();