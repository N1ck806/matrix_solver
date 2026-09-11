/* =============================================================================
   MatrixLab — Mobile JS
   Bottom-sheet, свайпы, haptic feedback, ripple, tabbar «Ещё»
   Подключается только при ширине ≤ 992px.
   ============================================================================= */

(function () {
    'use strict';

    if (window.matchMedia('(max-width: 992px)').matches === false) return;

    /* ------------------------------------------------------------------
       1. HAPTIC FEEDBACK (вибрация)
       ------------------------------------------------------------------ */
    function haptic(style) {
        if (!('vibrate' in navigator)) return;
        try {
            if (style === 'light')  navigator.vibrate(8);
            if (style === 'medium') navigator.vibrate(15);
            if (style === 'heavy')  navigator.vibrate(25);
            if (style === 'success') navigator.vibrate([10, 40, 10]);
        } catch (e) { /* noop */ }
    }

    document.addEventListener('click', function (e) {
        var el = e.target.closest('[data-haptic]');
        if (!el) return;
        haptic(el.getAttribute('data-haptic') || 'light');
    }, { passive: true });

    /* ------------------------------------------------------------------
       2. BOTTOM-SHEET МЕНЮ
       ------------------------------------------------------------------ */
    var navToggle    = document.querySelector('[data-nav-toggle]');
    var navSheet     = document.querySelector('[data-mobile-nav]');
    var navBackdrop  = document.querySelector('[data-mobile-nav-backdrop]');
    var navCloseBtns = document.querySelectorAll('[data-mobile-nav-close]');
    var sheetHandle  = document.querySelector('[data-sheet-handle]');

    var isOpen = false;
    var startY = 0;
    var currentY = 0;
    var isDragging = false;

    function openSheet() {
        if (!navSheet || !navBackdrop) return;
        isOpen = true;
        navSheet.hidden = false;
        navBackdrop.hidden = false;
        navSheet.classList.remove('is-closing');
        document.body.style.overflow = 'hidden';
        if (navToggle) navToggle.setAttribute('aria-expanded', 'true');
        haptic('light');
    }

    function closeSheet() {
        if (!navSheet || !navBackdrop) return;
        isOpen = false;
        navSheet.classList.add('is-closing');

        setTimeout(function () {
            navSheet.hidden = true;
            navBackdrop.hidden = true;
            navSheet.classList.remove('is-closing');
            navSheet.style.transform = '';
            document.body.style.overflow = '';
            if (navToggle) navToggle.setAttribute('aria-expanded', 'false');
        }, 280);
        haptic('light');
    }

    if (navToggle) {
        navToggle.addEventListener('click', function () {
            isOpen ? closeSheet() : openSheet();
        });
    }

    if (navBackdrop) {
        navBackdrop.addEventListener('click', closeSheet);
    }

    navCloseBtns.forEach(function (btn) {
        btn.addEventListener('click', closeSheet);
    });

    // ESC для десктопных браузеров с узким окном
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && isOpen) closeSheet();
    });

    /* ------------------------------------------------------------------
       3. СВАЙП ВНИЗ ЧТОБЫ ЗАКРЫТЬ ЛИСТ
       ------------------------------------------------------------------ */
    function onTouchStart(e) {
        if (!isOpen || !sheetHandle) return;
        // Свайп только если тач начался за «ручку» или в зоне < 60px от верха
        var touch = e.touches[0];
        var rect = navSheet.getBoundingClientRect();
        if (touch.clientY - rect.top > 80) return;

        startY = touch.clientY;
        currentY = startY;
        isDragging = true;
        navSheet.style.transition = 'none';
    }

    function onTouchMove(e) {
        if (!isDragging) return;
        currentY = e.touches[0].clientY;
        var delta = Math.max(0, currentY - startY);
        navSheet.style.transform = 'translateY(' + delta + 'px)';
    }

    function onTouchEnd() {
        if (!isDragging) return;
        isDragging = false;
        navSheet.style.transition = '';
        var delta = currentY - startY;
        if (delta > 120) {
            closeSheet();
        } else {
            navSheet.style.transform = '';
        }
    }

    if (navSheet) {
        navSheet.addEventListener('touchstart', onTouchStart, { passive: true });
        navSheet.addEventListener('touchmove',  onTouchMove,  { passive: true });
        navSheet.addEventListener('touchend',   onTouchEnd,   { passive: true });
    }

    /* ------------------------------------------------------------------
       4. FAB — RIPPLE + ПЕРЕХОД
       ------------------------------------------------------------------ */
    var fab = document.querySelector('[data-mobile-fab]');
    if (fab) {
        fab.addEventListener('touchstart', function (e) {
            var touch = e.touches[0];
            var rect = fab.getBoundingClientRect();
            var x = ((touch.clientX - rect.left) / rect.width) * 100;
            var y = ((touch.clientY - rect.top) / rect.height) * 100;
            fab.style.setProperty('--ripple-x', x + '%');
            fab.style.setProperty('--ripple-y', y + '%');
            fab.classList.add('is-rippling');
            setTimeout(function () { fab.classList.remove('is-rippling'); }, 600);
        }, { passive: true });

        fab.addEventListener('click', function () {
            haptic('medium');
            // По умолчанию — на калькулятор
            window.location.href = fab.dataset.href || '/calculator/';
        });
    }

    /* ------------------------------------------------------------------
       5. TABBAR «ЕЩЁ» — открывает тот же bottom-sheet
       ------------------------------------------------------------------ */
    var moreBtn = document.querySelector('[data-mobile-tabbar-more]');
    if (moreBtn) {
        moreBtn.addEventListener('click', function () {
            openSheet();
        });
    }

    /* ------------------------------------------------------------------
       6. ПЕРЕСЧЁТ ПРИ СМЕНЕ ОРИЕНТАЦИИ
       ------------------------------------------------------------------ */
    var resizeTimer;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            if (window.matchMedia('(max-width: 992px)').matches) {
                document.documentElement.classList.add('is-mobile');
            } else {
                document.documentElement.classList.remove('is-mobile');
                if (isOpen) closeSheet();
            }
        }, 150);
    }, { passive: true });

    /* ------------------------------------------------------------------
       7. ЗАПРЕТ СКРОЛЛА ПОД ЛИСТОМ
       ------------------------------------------------------------------ */
    document.addEventListener('touchmove', function (e) {
        if (isOpen && !e.target.closest('[data-mobile-nav]')) {
            e.preventDefault();
        }
    }, { passive: false });

})();