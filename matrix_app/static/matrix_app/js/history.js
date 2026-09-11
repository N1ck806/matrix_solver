/* =============================================================================
   MatrixLab — history.js
   =============================================================================
   Страница /history/ — история вычислений пользователя.

   Отвечает за:
       • очистку всей истории (POST /history/clear/);
       • удаление одной записи (POST /history/<pk>/delete/);
       • открытие записи в модальном окне с детальной информацией;
       • переход к соответствующей странице для повтора операции;
       • визуальную обратную связь через тосты.

   Все запросы идут через ML.api.post — единая обработка CSRF и ошибок.

   Зависимости: main.js.
   ============================================================================= */
(function () {
    'use strict';

    const ML = window.MatrixLab;
    if (!ML) return;

    // =========================================================================
    // Карта операций → страница для повтора
    // =========================================================================
    const OP_PAGE = {
        // Калькулятор
        determinant: '/calculator/',
        rank: '/calculator/',
        inverse: '/calculator/',
        transpose: '/calculator/',
        trace: '/calculator/',
        rref: '/calculator/',
        echelon: '/calculator/',
        properties: '/calculator/',
        add: '/operations/',
        subtract: '/operations/',
        multiply: '/operations/',
        scalar_multiply: '/operations/',
        power: '/operations/',
        compare: '/operations/',

        // Спектр
        eigenvalues: '/eigen/',
        eigenvectors: '/eigen/',
        char_poly: '/eigen/',

        // Разложения
        lu: '/decompositions/',
        qr: '/decompositions/',
        cholesky: '/decompositions/',
        diagonalize: '/decompositions/',

        // СЛАУ
        solve_gauss: '/systems/',
        solve_gauss_jordan: '/systems/',
        solve_cramer: '/systems/',
        solve_inverse: '/systems/',
        kronecker_capelli: '/systems/',
    };

    // =========================================================================
    // Утилиты
    // =========================================================================

    /**
     * Извлечь текстовое содержимое элемента внутри контейнера.
     * Возвращает '' при отсутствии.
     */
    function textOf(parent, selector) {
        if (!parent) return '';
        const el = parent.querySelector(selector);
        return el ? (el.textContent || '').trim() : '';
    }

    /**
     * Открыть модальное окно с информацией о записи.
     */
    function openHistoryModal(item) {
        const modal = document.querySelector('[data-history-modal]');
        if (!modal) return;

        const titleEl = modal.querySelector('[data-history-modal-title]');
        const bodyEl = modal.querySelector('[data-history-modal-body]');

        const opLabel = textOf(item, '.history-op-badge');
        const shape = textOf(item, '.history-shape');
        const time = textOf(item, '.history-time-clock');
        const date = textOf(item, '.history-time-date');
        const preview = textOf(item, '.history-item-preview');

        if (titleEl) {
            titleEl.textContent = opLabel + (date || time ? ' — ' + date + ' ' + time : '');
        }

        if (bodyEl) {
            bodyEl.innerHTML = '';

            if (shape) {
                const shapeRow = document.createElement('div');
                shapeRow.style.fontSize = 'var(--text-sm)';
                shapeRow.style.color = 'var(--text-secondary)';
                shapeRow.style.marginBottom = 'var(--space-4)';
                shapeRow.textContent = 'Размер: ' + shape;
                bodyEl.appendChild(shapeRow);
            }

            const previewBox = document.createElement('div');
            previewBox.style.padding = 'var(--space-4)';
            previewBox.style.background = 'var(--bg-card-alt)';
            previewBox.style.borderRadius = 'var(--radius-md)';
            previewBox.style.fontFamily = 'var(--font-mono)';
            previewBox.style.fontSize = 'var(--text-sm)';
            previewBox.style.whiteSpace = 'pre-wrap';
            previewBox.style.wordBreak = 'break-all';
            previewBox.textContent = preview || 'Описание недоступно.';
            bodyEl.appendChild(previewBox);

            if (time || date) {
                const timeRow = document.createElement('div');
                timeRow.style.fontSize = 'var(--text-xs)';
                timeRow.style.color = 'var(--text-tertiary)';
                timeRow.style.marginTop = 'var(--space-4)';
                timeRow.textContent = (date + ' ' + time).trim();
                bodyEl.appendChild(timeRow);
            }
        }

        ML.modal.open('[data-history-modal]');
    }

    // =========================================================================
    // Инициализация
    // =========================================================================
    function init() {
        // ---------------------------------------------------------------------
        // Очистить всю историю
        // ---------------------------------------------------------------------
        const clearBtn = document.querySelector('[data-history-clear]');
        if (clearBtn) {
            clearBtn.addEventListener('click', async function () {
                if (!confirm('Очистить всю историю вычислений?')) return;

                ML.loader.show('Очищаем…');
                try {
                    await ML.api.post('/history/clear/', {});
                    ML.toast.success('История очищена', '');
                    setTimeout(function () {
                        location.reload();
                    }, 400);
                } catch (err) {
                    ML.toast.error('Ошибка', err.message);
                } finally {
                    ML.loader.hide();
                }
            });
        }

        // ---------------------------------------------------------------------
        // Делегированные обработчики действий на записях
        // ---------------------------------------------------------------------
        document.addEventListener('click', async function (e) {
            // --- Удалить одну запись ---------------------------------------
            const delBtn = e.target.closest('[data-history-delete]');
            if (delBtn) {
                e.preventDefault();
                const pk = delBtn.dataset.historyDelete;
                if (!pk) return;
                if (!confirm('Удалить эту запись?')) return;

                try {
                    await ML.api.post('/history/' + pk + '/delete/', {});
                    const item = delBtn.closest('[data-history-item]');
                    if (item) item.remove();
                    ML.toast.success('Запись удалена', '');

                    // Если больше записей нет — перезагружаем (показать пустое состояние)
                    const remaining = document.querySelectorAll('[data-history-item]').length;
                    if (remaining === 0) {
                        setTimeout(function () { location.reload(); }, 400);
                    }
                } catch (err) {
                    ML.toast.error('Ошибка', err.message);
                }
                return;
            }

            // --- Открыть запись в модальном окне ---------------------------
            const openBtn = e.target.closest('[data-history-open]');
            if (openBtn) {
                e.preventDefault();
                const pk = openBtn.dataset.historyOpen;
                if (!pk) return;
                const item = document.querySelector('[data-history-item="' + pk + '"]');
                if (!item) return;
                openHistoryModal(item);
                return;
            }

            // --- Повторить операцию ----------------------------------------
            const repeatBtn = e.target.closest('[data-history-repeat]');
            if (repeatBtn) {
                e.preventDefault();

                const item = repeatBtn.closest('[data-history-item]');
                if (!item) return;

                const op = item.dataset.historyOperation || '';
                const url = OP_PAGE[op] || '/calculator/';
                const label = op || 'операция';

                ML.toast.info(
                    'Повтор операции',
                    'Откроется страница «' + label + '» — введите данные заново.'
                );

                setTimeout(function () {
                    location.href = url;
                }, 400);
                return;
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();