/* =============================================================================
   MatrixLab — history.js
   =============================================================================
   Страница /history/ — история вычислений пользователя.

   Отвечает за:
       • очистку всей серверной истории (POST /history/clear/);
       • удаление одной записи (POST /history/<pk>/delete/);
       • открытие записи в модальном окне с детальной информацией;
       • повтор операции через sessionStorage:
           — матрица A → matrixlab.load_matrix;
           — вектор b → matrixlab.load_vector;
           — опция «повторить операцию» → matrixlab.load_op;
           — переход на нужный раздел по карте OP_PAGE;
       • копирование записи в буфер;
       • экспорт записи (если у записи есть payload — через ML.export);
       • удаление всех записей с подтверждением;
       • корректное пустое состояние без перезагрузки;
       • i18n через ML.i18n.t;
       • эмиты history:* для других модулей;
       • публичный API ML.historyPage.{mount, clear, removeOne, repeat,
         copy, exportOne, openModal, confirm}.

   Публичный API:
       ML.historyPage.mount(root)
       ML.historyPage.clear(root)
       ML.historyPage.removeOne(pk, btn)
       ML.historyPage.repeat(pk)
       ML.historyPage.copy(pk)
       ML.historyPage.exportOne(pk)
       ML.historyPage.openModal(pk)
       ML.historyPage.opPage       — карта операций → URL

   Зависимости: main.js (ML.confirm, ML.copy, ML.export, ML.mathjax,
   ML.api, ML.toast, ML.emit, ML.i18n, ML.escapeHtml), export.js (опционально).
   ============================================================================= */
(function () {
    'use strict';

    const ML = window.MatrixLab;
    if (!ML) {
        console.error('[history.js] window.MatrixLab не найден — модуль не запущен.');
        return;
    }

    // =========================================================================
    // 1. КАРТА ОПЕРАЦИЙ → СТРАНИЦА ПОВТОРА
    // =========================================================================

    const OP_PAGE = {
        // Калькулятор / основные
        determinant:     '/calculator/',
        rank:            '/calculator/',
        inverse:         '/calculator/',
        transpose:       '/calculator/',
        trace:           '/calculator/',
        rref:            '/calculator/',
        echelon:         '/calculator/',
        power:           '/calculator/',
        scalar_multiply: '/operations/',
        add:             '/operations/',
        subtract:        '/operations/',
        multiply:        '/operations/',
        compare:         '/operations/',
        chain:           '/operations/',

        // Свойства
        properties:      '/properties/',

        // Спектр
        eigenvalues:     '/eigen/',
        eigenvectors:    '/eigen/',
        char_poly:       '/eigen/',
        full:            '/eigen/',

        // Разложения
        lu:              '/decompositions/',
        qr:              '/decompositions/',
        cholesky:        '/decompositions/',
        diagonalize:     '/decompositions/',
        spectral:        '/decompositions/',

        // СЛАУ
        solve_system:       '/systems/',
        solve_gauss:        '/systems/',
        solve_gauss_jordan: '/systems/',
        solve_cramer:       '/systems/',
        solve_inverse:      '/systems/',
        kronecker_capelli:  '/systems/',
        kronecker:          '/systems/'
    };

    // =========================================================================
    // 2. УТИЛИТЫ
    // =========================================================================

    function tr(key, fallback) {
        return ML.i18n.t(key, fallback);
    }

    function textOf(parent, selector) {
        if (!parent) return '';
        const el = parent.querySelector(selector);
        return el ? (el.textContent || '').trim() : '';
    }

    function findItem(pk) {
        return document.querySelector('[data-history-item="' + pk + '"]');
    }

    function readPayload(pk) {
        const item = findItem(pk);
        if (!item) return null;
        const raw = item.dataset.historyPayload;
        if (!raw) return null;
        try { return JSON.parse(raw); }
        catch (e) { return null; }
    }

    // =========================================================================
    // 3. МОДАЛКА ДЕТАЛИ
    // =========================================================================

    function ensureModal() {
        let modal = document.querySelector('[data-history-modal]');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.className = 'modal';
        modal.setAttribute('data-history-modal', '');
        modal.hidden = true;
        modal.innerHTML = ''
            + '<div class="modal-backdrop" data-history-modal-close></div>'
            + '<div class="modal-dialog" role="dialog" '
            + '     aria-labelledby="history-modal-title" aria-modal="true">'
            + '  <header class="modal-head">'
            + '    <h3 id="history-modal-title" data-history-modal-title>'
            +       ML.escapeHtml(tr('history.entry', 'Запись'))
            + '    </h3>'
            + '    <button type="button" class="modal-close" '
            + '            data-history-modal-close aria-label="'
            +       ML.escapeHtml(tr('common.close', 'Закрыть')) + '">'
            + '      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" '
            + '           stroke="currentColor" stroke-width="2" '
            + '           stroke-linecap="round" stroke-linejoin="round">'
            + '        <line x1="18" y1="6" x2="6" y2="18"/>'
            + '        <line x1="6" y1="6" x2="18" y2="18"/>'
            + '      </svg>'
            + '    </button>'
            + '  </header>'
            + '  <div class="modal-body" data-history-modal-body></div>'
            + '</div>';
        document.body.appendChild(modal);
        return modal;
    }

    function openModal(pk) {
        const item = findItem(pk);
        if (!item) return;

        let modal = document.querySelector('[data-history-modal]');
        if (!modal) modal = ensureModal();

        const titleEl = modal.querySelector('[data-history-modal-title]');
        const bodyEl = modal.querySelector('[data-history-modal-body]');

        const opLabel = textOf(item, '.history-op-badge')
            || item.dataset.historyLabel
            || pk;
        const shape = textOf(item, '.history-shape');
        const time = textOf(item, '.history-time-clock');
        const date = textOf(item, '.history-time-date');
        const preview = textOf(item, '.history-item-preview');

        if (titleEl) {
            const stamp = (date + ' ' + time).trim();
            titleEl.textContent = opLabel + (stamp ? ' — ' + stamp : '');
        }

        if (bodyEl) {
            bodyEl.innerHTML = '';

            if (shape) {
                const row = document.createElement('div');
                row.className = 'history-modal-row';
                row.innerHTML = '<span class="history-modal-label">'
                    + ML.escapeHtml(tr('history.size', 'Размер'))
                    + '</span><span class="history-modal-value">'
                    + ML.escapeHtml(shape) + '</span>';
                bodyEl.appendChild(row);
            }

            const previewBox = document.createElement('div');
            previewBox.className = 'history-modal-preview';
            previewBox.textContent = preview
                || tr('history.noPreview', 'Описание недоступно.');
            bodyEl.appendChild(previewBox);

            const payload = readPayload(pk);
            if (payload && payload.latex) {
                const latexBox = document.createElement('div');
                latexBox.className = 'history-modal-latex';
                latexBox.innerHTML = '$$' + payload.latex + '$$';
                bodyEl.appendChild(latexBox);
                ML.mathjax.typeset(latexBox);
            }

            if (time || date) {
                const row = document.createElement('div');
                row.className = 'history-modal-time';
                row.textContent = (date + ' ' + time).trim();
                bodyEl.appendChild(row);
            }
        }

        ML.modal.open(modal);
        ML.emit('history:modal-open', { pk: pk });
    }

    // =========================================================================
    // 4. ДЕЙСТВИЯ
    // =========================================================================

    async function clearAll() {
        const ok = await ML.confirm(
            tr('history.confirmClear',
                'Очистить всю историю вычислений?'),
            {
                title: tr('history.clearTitle', 'Очистка истории'),
                okText: tr('history.clearOk', 'Очистить'),
                cancelText: tr('common.cancel', 'Отмена')
            }
        );
        if (!ok) return false;

        ML.loader.show(tr('history.clearing', 'Очищаем…'));

        try {
            await ML.api.post('/history/clear/', {});
            ML.toast.success(
                tr('history.cleared', 'История очищена'),
                ''
            );
            showEmptyState();
            ML.emit('history:cleared', {});
            return true;
        } catch (err) {
            ML.toast.error(
                tr('common.error', 'Ошибка'),
                err.message || ''
            );
            ML.emit('history:error', { action: 'clear', error: err });
            return false;
        } finally {
            ML.loader.hide();
        }
    }

    async function removeOne(pk, btn) {
        const item = findItem(pk);
        if (!item) return false;

        const ok = await ML.confirm(
            tr('history.confirmDelete', 'Удалить эту запись?'),
            {
                title: tr('history.deleteTitle', 'Удаление'),
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
            await ML.api.post('/history/' + pk + '/delete/', {});
            item.remove();

            ML.toast.success(
                tr('history.deleted', 'Запись удалена'),
                ''
            );

            const remaining = document.querySelectorAll(
                '[data-history-item]'
            ).length;
            if (remaining === 0) {
                showEmptyState();
                ML.emit('history:empty', {});
            }

            ML.emit('history:removed', { pk: pk });
            return true;
        } catch (err) {
            if (btn) {
                btn.disabled = false;
                btn.setAttribute('aria-disabled', 'false');
            }
            ML.toast.error(
                tr('common.error', 'Ошибка'),
                err.message || ''
            );
            ML.emit('history:error', {
                action: 'delete', pk: pk, error: err
            });
            return false;
        }
    }

    function repeat(pk) {
        const item = findItem(pk);
        if (!item) return false;

        const op = item.dataset.historyOperation || '';
        const url = OP_PAGE[op] || '/calculator/';

        const payload = readPayload(pk);
        const matrix = payload && (payload.matrix
            || payload.matrix_a
            || (payload.matrices && payload.matrices[0]));

        if (matrix) {
            try {
                sessionStorage.setItem(
                    'matrixlab.load_matrix',
                    JSON.stringify(matrix)
                );
            } catch (e) { /* noop */ }
        }

        if (payload && payload.vector_b) {
            try {
                sessionStorage.setItem(
                    'matrixlab.load_vector',
                    JSON.stringify(payload.vector_b)
                );
            } catch (e) { /* noop */ }
        }

        if (op) {
            try { sessionStorage.setItem('matrixlab.load_op', op); }
            catch (e) { /* noop */ }
        }

        ML.toast.info(
            tr('history.repeat', 'Повтор операции'),
            tr('history.repeatHint', 'Открываем нужный раздел…')
        );

        ML.emit('history:repeat', { pk: pk, op: op, url: url });

        setTimeout(function () {
            window.location.href = url;
        }, 350);
        return true;
    }

    function copy(pk) {
        const item = findItem(pk);
        if (!item) return;

        const opLabel = textOf(item, '.history-op-badge')
            || item.dataset.historyLabel
            || pk;
        const shape = textOf(item, '.history-shape');
        const date = textOf(item, '.history-time-date');
        const time = textOf(item, '.history-time-clock');
        const preview = textOf(item, '.history-item-preview');

        const payload = readPayload(pk);

        const lines = [];
        lines.push('MatrixLab — '
            + tr('history.entry', 'запись истории'));
        lines.push('');
        lines.push(tr('history.operation', 'Операция') + ': ' + opLabel);
        if (shape) {
            lines.push(tr('history.size', 'Размер') + ': ' + shape);
        }
        const stamp = (date + ' ' + time).trim();
        if (stamp) {
            lines.push(tr('history.when', 'Когда') + ': ' + stamp);
        }
        if (preview) {
            lines.push('');
            lines.push(preview);
        }
        if (payload && payload.latex) {
            lines.push('');
            lines.push('LaTeX: ' + payload.latex);
        }
        if (payload && payload.result !== undefined) {
            lines.push('');
            lines.push('Result:');
            try {
                lines.push(JSON.stringify(payload.result, null, 2));
            } catch (e) {
                lines.push(String(payload.result));
            }
        }

        ML.copy.text(
            lines.join('\n'),
            tr('history.copied', 'Запись скопирована')
        );
        ML.emit('history:copied', { pk: pk });
    }

    function exportOne(pk) {
        const payload = readPayload(pk);
        if (!payload) {
            ML.toast.warning(
                tr('history.noPayload', 'Нет данных'),
                tr('history.noPayloadHint',
                    'Экспорт доступен только для сохранённых записей.')
            );
            return;
        }
        if (ML.export && ML.export.openDialog) {
            ML.export.openDialog(payload);
        } else {
            ML.toast.error(
                tr('common.error', 'Ошибка'),
                tr('history.exportUnavailable',
                    'Модуль экспорта недоступен.')
            );
        }
    }

    function showEmptyState() {
        const list = document.querySelector('[data-history-list]');
        const empty = document.querySelector('[data-history-empty]');

        if (empty) {
            if (list) list.hidden = true;
            empty.hidden = false;
            return;
        }
        if (!list) return;

        list.innerHTML = ''
            + '<div class="history-empty" data-history-empty>'
            + '  <div class="history-empty-icon" aria-hidden="true">'
            + '    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" '
            + '         stroke="currentColor" stroke-width="1.5" '
            + '         stroke-linecap="round" stroke-linejoin="round">'
            + '      <circle cx="12" cy="12" r="9"/>'
            + '      <polyline points="12 7 12 12 15 15"/>'
            + '    </svg>'
            + '  </div>'
            + '  <h3>' + ML.escapeHtml(
                tr('history.empty', 'История пуста')
            ) + '</h3>'
            + '  <p>' + ML.escapeHtml(
                tr('history.emptyHint',
                    'Выполните первую операцию — она появится здесь.')
            ) + '</p>'
            + '</div>';
    }

    // =========================================================================
    // 5. ДЕЛЕГИРОВАНИЕ
    // =========================================================================

    function initDelegation() {
        document.addEventListener('click', function (e) {

            const clearBtn = e.target.closest('[data-history-clear]');
            if (clearBtn) {
                e.preventDefault();
                clearAll();
                return;
            }

            const delBtn = e.target.closest('[data-history-delete]');
            if (delBtn) {
                e.preventDefault();
                const pk = delBtn.dataset.historyDelete;
                if (pk) removeOne(pk, delBtn);
                return;
            }

            const openBtn = e.target.closest('[data-history-open]');
            if (openBtn) {
                e.preventDefault();
                const pk = openBtn.dataset.historyOpen;
                if (pk) openModal(pk);
                return;
            }

            const repeatBtn = e.target.closest('[data-history-repeat]');
            if (repeatBtn) {
                e.preventDefault();
                const pk = repeatBtn.dataset.historyRepeat
                    || (repeatBtn.closest('[data-history-item]') || {}).dataset?.historyItem;
                if (pk) repeat(pk);
                return;
            }

            const copyBtn = e.target.closest('[data-history-copy]');
            if (copyBtn) {
                e.preventDefault();
                const pk = copyBtn.dataset.historyCopy;
                if (pk) copy(pk);
                return;
            }

            const exportBtn = e.target.closest('[data-history-export]');
            if (exportBtn) {
                e.preventDefault();
                const pk = exportBtn.dataset.historyExport;
                if (pk) exportOne(pk);
            }
        });

        // Доступность: Enter / Space на карточке → openModal
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const card = e.target.closest('[data-history-item][tabindex]');
            if (!card) return;
            const pk = card.getAttribute('data-history-item');
            if (!pk) return;
            e.preventDefault();
            openModal(pk);
        });
    }

    // =========================================================================
    // 6. МОНТИРОВАНИЕ
    // =========================================================================

    function mount(root) {
        root = root || document;

        // Готовим модалку заранее, если есть кнопки открытия
        if (root.querySelector('[data-history-open]')) {
            ensureModal();
        }

        ML.emit('history:ready', {});
        return true;
    }

    // =========================================================================
    // 7. ПУБЛИЧНЫЙ API
    // =========================================================================

    ML.historyPage = {
        mount:      mount,
        clear:      clearAll,
        removeOne:  removeOne,
        repeat:     repeat,
        copy:       copy,
        exportOne:  exportOne,
        openModal:  openModal,
        opPage:     OP_PAGE
    };

    // =========================================================================
    // 8. ИНИЦИАЛИЗАЦИЯ
    // =========================================================================

    let _initialized = false;

    function init() {
        if (_initialized) return;
        _initialized = true;

        if (document.querySelector(
            '[data-history-item], [data-history-clear]'
        )) {
            mount(document);
        }

        initDelegation();

        ML.emit('history:module-ready', {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();