/* =============================================================================
   MatrixLab — saved.js
   =============================================================================
   Страница /saved/ — сохранённые пользователем матрицы.

   Возможности:
       • рендер превью каждой сохранённой матрицы через ML.preview;
       • открытие сохранённой матрицы в калькуляторе (sessionStorage + переход);
       • удаление матрицы с подтверждением через ML.confirm;
       • корректная обработка пустого состояния без перезагрузки;
       • аккуратные ошибки в превью (некорректные / пустые данные);
       • поддержка необязательной формы сохранения
         (модалка save-modal — если размечена на странице);
       • i18n через ML.i18n.t;
       • запись в ML.history и эмиты saved:*;
       • публичный API ML.saved.{mount, refresh, open, remove}.

   Публичный API:
       ML.saved.mount(root)
       ML.saved.refresh(root)
       ML.saved.open(pk)
       ML.saved.remove(pk, btn)

   Зависимости: main.js (ML.confirm, ML.preview, ML.format,
   ML.escapeHtml, ML.i18n, ML.mathjax, ML.api, ML.toast, ML.emit).
   ============================================================================= */
(function () {
    'use strict';

    const ML = window.MatrixLab;
    if (!ML) {
        console.error('[saved.js] window.MatrixLab не найден — модуль не запущен.');
        return;
    }

    // =========================================================================
    // 1. УТИЛИТЫ
    // =========================================================================

    function tr(key, fallback) {
        return ML.i18n.t(key, fallback);
    }

    function isArr(v) { return Array.isArray(v); }

    function findItem(pk) {
        return document.querySelector('[data-saved-item="' + pk + '"]');
    }

    function findPreview(pk) {
        return document.querySelector('[data-saved-preview="' + pk + '"]');
    }

    function findDataScript(pk) {
        return document.querySelector(
            'script[data-saved-data="' + pk + '"]'
        );
    }

    function readMatrixData(pk) {
        const script = findDataScript(pk);
        if (!script) return null;
        try {
            const data = JSON.parse(script.textContent);
            return isArr(data) && data.length ? data : null;
        } catch (e) {
            return null;
        }
    }

    // =========================================================================
    // 2. ПРЕВЬЮ (через ML.preview)
    // =========================================================================

    function renderPreview(pk) {
        const preview = findPreview(pk);
        if (!preview) return;

        const data = readMatrixData(pk);

        if (!data) {
            preview.classList.remove('is-loading');
            preview.classList.add('is-error');
            preview.innerHTML = '<span class="saved-card-preview-error">'
                + ML.escapeHtml(
                    tr('saved.invalidData', 'Некорректные данные')
                )
                + '</span>';
            return;
        }

        preview.classList.remove('is-error');

        // ML.preview сам управляет is-loading и MathJax
        ML.preview.render(preview, data, { brackets: 'b' });
    }

    function refresh(root) {
        const scope = root || document;
        ML.$$('[data-saved-preview]', scope).forEach(function (el) {
            const pk = el.getAttribute('data-saved-preview');
            if (pk) renderPreview(pk);
        });
    }

    // =========================================================================
    // 3. ОТКРЫТИЕ В КАЛЬКУЛЯТОРЕ
    // =========================================================================

    function open(pk) {
        const item = findItem(pk);
        if (!item) {
            ML.toast.warning(
                tr('common.error', 'Ошибка'),
                tr('saved.notOnPage', 'Матрица не найдена на странице.')
            );
            return false;
        }

        const data = readMatrixData(pk);
        if (!data) {
            ML.toast.error(
                tr('common.error', 'Ошибка'),
                tr('saved.invalidData',
                    'Не удалось прочитать матрицу.')
            );
            return false;
        }

        try {
            sessionStorage.setItem(
                'matrixlab.load_matrix',
                JSON.stringify(data)
            );
        } catch (e) {
            ML.toast.error(
                tr('common.error', 'Ошибка'),
                tr('saved.sessionError',
                    'Не удалось сохранить данные в сессию.')
            );
            return false;
        }

        ML.toast.info(
            tr('saved.opening', 'Открываем матрицу'),
            tr('saved.openingHint', 'Переходим в калькулятор…')
        );

        ML.emit('saved:open', { pk: pk });

        setTimeout(function () {
            window.location.href = '/calculator/';
        }, 300);
        return true;
    }

    // =========================================================================
    // 4. УДАЛЕНИЕ
    // =========================================================================

    async function remove(pk, btn) {
        const item = findItem(pk);
        if (!item) return false;

        const ok = await ML.confirm(
            tr('saved.confirmDelete', 'Удалить эту матрицу?'),
            {
                title: tr('saved.confirmTitle', 'Удаление'),
                okText: tr('common.delete', 'Удалить'),
                cancelText: tr('common.cancel', 'Отмена')
            }
        );
        if (!ok) return false;

        if (btn) {
            btn.disabled = true;
            btn.setAttribute('aria-disabled', 'true');
        }

        try {
            await ML.api.post('/saved/' + pk + '/delete/', {});

            // Убираем карточку
            item.remove();

            // Убираем скрипт с данными
            const script = findDataScript(pk);
            if (script) script.remove();

            ML.toast.success(
                tr('saved.deleted', 'Удалено'),
                tr('saved.deletedHint',
                    'Матрица удалена из сохранённых.')
            );

            ML.emit('saved:removed', { pk: pk });

            // Пустое состояние
            const remaining = document.querySelectorAll(
                '[data-saved-item]'
            ).length;
            if (remaining === 0) {
                showEmptyState();
                ML.emit('saved:empty', {});
            }
            return true;
        } catch (err) {
            if (btn) {
                btn.disabled = false;
                btn.setAttribute('aria-disabled', 'false');
            }
            ML.toast.error(
                tr('common.error', 'Ошибка'),
                err.message
                    || tr('saved.deleteFailed', 'Не удалось удалить.')
            );
            ML.emit('saved:error', { pk: pk, error: err });
            return false;
        }
    }

    // =========================================================================
    // 5. ПУСТОЕ СОСТОЯНИЕ
    // =========================================================================

    function showEmptyState() {
        const container = document.querySelector('[data-saved-list]');
        const empty = document.querySelector('[data-saved-empty]');

        // Если в разметке уже есть empty-блок — показываем его
        if (empty) {
            empty.hidden = false;
            return;
        }
        if (!container) return;

        // Fallback — рисуем простое пустое состояние
        const div = document.createElement('div');
        div.className = 'saved-empty';
        div.setAttribute('data-saved-empty', '');
        div.innerHTML = ''
            + '<div class="saved-empty-icon" aria-hidden="true">'
            + '  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" '
            + '       stroke="currentColor" stroke-width="1.5" '
            + '       stroke-linecap="round" stroke-linejoin="round">'
            + '    <rect x="3" y="3" width="7" height="7"/>'
            + '    <rect x="14" y="3" width="7" height="7"/>'
            + '    <rect x="14" y="14" width="7" height="7"/>'
            + '    <rect x="3" y="14" width="7" height="7"/>'
            + '  </svg>'
            + '</div>'
            + '<h3>' + ML.escapeHtml(
                tr('saved.empty', 'Нет сохранённых матриц')
            ) + '</h3>'
            + '<p>' + ML.escapeHtml(
                tr('saved.emptyHint',
                    'Сохраняйте матрицы в калькуляторе — они появятся здесь.')
            ) + '</p>';

        container.appendChild(div);
    }

    // =========================================================================
    // 6. ДЕЛЕГИРОВАННЫЕ ОБРАБОТЧИКИ
    // =========================================================================

    function initDelegation() {
        document.addEventListener('click', function (e) {
            const useBtn = e.target.closest('[data-saved-use]');
            if (useBtn) {
                e.preventDefault();
                const pk = useBtn.dataset.savedUse;
                if (pk) open(pk);
                return;
            }

            const delBtn = e.target.closest('[data-saved-delete]');
            if (delBtn) {
                e.preventDefault();
                const pk = delBtn.dataset.savedDelete;
                if (pk) remove(pk, delBtn);
                return;
            }
        });

        // Доступность: Enter / Space на карточке → open
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const card = e.target.closest('[data-saved-item][tabindex]');
            if (!card) return;
            const pk = card.getAttribute('data-saved-item');
            if (!pk) return;
            e.preventDefault();
            open(pk);
        });
    }

    // =========================================================================
    // 7. МОНТИРОВАНИЕ
    // =========================================================================

    function mount(root) {
        root = root || document;
        refresh(root);
        ML.emit('saved:ready', {});
        return true;
    }

    // =========================================================================
    // 8. ПУБЛИЧНЫЙ API
    // =========================================================================

    ML.saved = ML.saved || {};
    ML.saved.mount = mount;
    ML.saved.refresh = refresh;
    ML.saved.open = open;
    ML.saved.remove = remove;

    // =========================================================================
    // 9. ИНИЦИАЛИЗАЦИЯ
    // =========================================================================

    let _initialized = false;

    function init() {
        if (_initialized) return;
        _initialized = true;

        if (document.querySelector(
            '[data-saved-item], [data-saved-preview]'
        )) {
            mount(document);
        }

        initDelegation();

        ML.emit('saved:module-ready', {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();