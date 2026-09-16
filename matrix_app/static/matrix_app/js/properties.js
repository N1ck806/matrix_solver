/* =============================================================================
   MatrixLab — properties.js
   =============================================================================
   Страница /properties/ — анализ свойств матрицы.

   Отвечает за:
       • отправку матрицы A на /api/matrix/properties/;
       • флаг with_eigenvalues (data-props-eigen);
       • сохранение предпочтения with_eigenvalues в ML.prefs;
       • СОБСТВЕННЫЙ рендер ответа в разметку страницы:
           [data-props-task-formula]  — задание (LaTeX)
           [data-props-summary]       — сводка свойств (карточки)
           [data-props-spectrum-section] — секция «Спектр» (показывается
                                            только при with_eigenvalues)
           [data-props-spectrum]      — собственные значения
           [data-props-error]         — ошибка
           [data-props-error-message] — текст ошибки
       • skeleton-загрузку (просто текст «Анализируем…»);
       • очистку формы и скрытие результата;
       • запись в ML.history.push;
       • i18n через ML.i18n.t;
       • публичный API ML.properties.{mount, run, runOperation,
         updateRunButtonState}.

   ВАЖНО:
       Раньше здесь вызывался ML.resultBlock.render(), который ищет
       секции по [data-result-section] / [data-result-output]. На странице
       /properties/ таких атрибутов нет — своя разметка. Поэтому
       результат рендерился «в никуда», и пользователь видел пустые
       блоки. Теперь рендер идёт напрямую в разметку страницы.

   Зависимости: main.js, matrix.js, steps.js (для ML.mathjax).
   ============================================================================= */
(function () {
    'use strict';

    const ML = window.MatrixLab;
    if (!ML) {
        console.error('[properties.js] window.MatrixLab не найден — модуль не запущен.');
        return;
    }

    // =========================================================================
    // 1. ENDPOINTS
    // =========================================================================

    const API = {
        properties: '/api/matrix/properties/',
        example:    '/api/example/'
    };

    // =========================================================================
    // 2. УТИЛИТЫ
    // =========================================================================

    function tr(key, fallback) {
        return ML.i18n.t(key, fallback);
    }

    function isArr(v) { return Array.isArray(v); }

    function isEmptyMatrix(m) {
        return ML.validators.isEmptyMatrix(m);
    }

    function esc(v) {
        return ML.escapeHtml(v === null || v === undefined ? '' : String(v));
    }

    function findMatrixInput(root) {
        const scope = root || document;
        const grid = scope.querySelector('[data-matrix-input]');
        if (!grid) return null;
        return ML.matrixInputs[grid.id] || null;
    }

    function findResultBlock(root) {
        const scope = root || document;
        return scope.querySelector('[data-props-result]')
            || scope.querySelector('[data-result-block]');
    }

    function findRunBtn(root) {
        const scope = root || document;
        return scope.querySelector('[data-props-run]');
    }

    function findResetBtn(root) {
        const scope = root || document;
        return scope.querySelector('[data-props-reset]');
    }

    function closeModalIfAny(btn) {
        const modal = btn && btn.closest('.modal');
        if (modal && ML.modal) {
            setTimeout(function () {
                ML.modal.close('#' + modal.id);
            }, 200);
        }
    }

    function getWithEigen(root) {
        const scope = root || document;
        const el = scope.querySelector('[data-props-eigen]');
        return el ? !!el.checked : true;
    }

    function getShowSteps(root) {
        const scope = root || document;
        const el = scope.querySelector(
            '[data-props-steps], [data-show-steps]'
        );
        return el ? !!el.checked : true;
    }

    // =========================================================================
    // 3. ОБНОВЛЕНИЕ СОСТОЯНИЯ КНОПКИ
    // =========================================================================

    function updateRunButtonState(root) {
        const scope = root || document;
        const runBtn = findRunBtn(scope);
        if (!runBtn) return;

        const mi = findMatrixInput(scope);
        if (!mi) {
            runBtn.disabled = true;
            runBtn.title = tr('props.editorNotFound',
                'Редактор матрицы не найден');
            runBtn.setAttribute('aria-disabled', 'true');
            return;
        }

        const matrix = mi.read();
        const empty = isEmptyMatrix(matrix);
        const invalid = mi.hasInvalid && mi.hasInvalid();

        runBtn.disabled = empty || invalid;

        if (invalid) {
            runBtn.title = tr('props.invalidValues',
                'Некорректные значения в матрице');
        } else if (empty) {
            runBtn.title = tr('props.fillMatrix', 'Заполните матрицу');
        } else {
            runBtn.title = tr('props.run', 'Проанализировать матрицу');
        }

        runBtn.setAttribute('aria-disabled', String(runBtn.disabled));
    }

    // =========================================================================
    // 4. РЕНДЕР РЕЗУЛЬТАТА
    // =========================================================================

    /**
     * Скрыть все секции и ошибку.
     */
    function clearRendered(root) {
        const scope = root || document;
        const block = findResultBlock(scope);
        if (!block) return;

        block.hidden = true;

        const task = block.querySelector('[data-props-task-formula]');
        if (task) task.innerHTML = '';

        const summary = block.querySelector('[data-props-summary]');
        if (summary) summary.innerHTML = '';

        const spectrumSection = block.querySelector(
            '[data-props-spectrum-section]'
        );
        if (spectrumSection) spectrumSection.hidden = true;

        const spectrum = block.querySelector('[data-props-spectrum]');
        if (spectrum) spectrum.innerHTML = '';

        const error = block.querySelector('[data-props-error]');
        if (error) error.hidden = true;

        const errorMsg = block.querySelector('[data-props-error-message]');
        if (errorMsg) errorMsg.textContent = '';
    }

    /**
     * Отрисовать ошибку.
     */
    function renderError(root, message, code) {
        const scope = root || document;
        const block = findResultBlock(scope);
        if (!block) return;

        block.hidden = false;

        const error = block.querySelector('[data-props-error]');
        const errorMsg = block.querySelector('[data-props-error-message]');

        // Скрываем нормальные секции — оставляем только ошибку.
        const task = block.querySelector('.result-section--task');
        if (task) task.hidden = true;

        const sections = block.querySelectorAll('.result-section');
        sections.forEach(function (s) {
            if (!s.classList.contains('result-section--task')) {
                s.hidden = true;
            }
        });

        if (error) error.hidden = false;
        if (errorMsg) {
            let text = message || tr('props.failed',
                'Не удалось выполнить анализ.');
            if (code) text += ' (' + code + ')';
            errorMsg.textContent = text;
        }
    }

    /**
     * Отрисовать карточку сводки свойств.
     */
    function buildSummaryItem(item) {
        const label = item.label || '';
        const value = item.value === undefined || item.value === null
            ? '—'
            : String(item.value);
        const kind = item.kind || 'info';

        let valueClass = 'prop-item-value';
        if (kind === 'bool') {
            if (value === 'Да') valueClass += ' prop-item-value--yes';
            else if (value === 'Не применимо') valueClass += ' prop-item-value--na';
            else valueClass += ' prop-item-value--no';
        } else if (kind === 'number') {
            valueClass += ' prop-item-value--number';
        }

        const valueHtml = item.value_latex
            ? '<span class="' + valueClass + '">$$' + item.value_latex + '$$</span>'
            : '<span class="' + valueClass + '">' + esc(value) + '</span>';

        return ''
            + '<div class="prop-item">'
            +   '<span class="prop-item-label">' + esc(label) + '</span>'
            +   valueHtml
            + '</div>';
    }

    /**
     * Отрисовать одно собственное значение.
     */
    function buildEigenvalueItem(ev) {
        const valueLatex = ev.latex || esc(ev.value);
        const algMult = ev.algebraic_multiplicity;
        const geoMult = ev.geometric_multiplicity;

        let mults = '<span>' + esc(tr('props.algMult', 'алг. кратность'))
            + ': <b>' + esc(algMult) + '</b></span>';
        if (geoMult !== undefined && geoMult !== null) {
            mults += '<span>' + esc(tr('props.geoMult', 'геом. кратность'))
                + ': <b>' + esc(geoMult) + '</b></span>';
        }

        return ''
            + '<div class="eigen-value-item">'
            +   '<span class="eigen-value-lambda">$$\\lambda = '
            +     valueLatex + '$$</span>'
            +   '<span class="eigen-value-detail">'
            +     '<span class="eigen-value-detail-title">'
            +       esc(tr('props.eigenvalue', 'Собственное значение'))
            +     '</span>'
            +     '<span class="eigen-value-detail-sub">' + mults + '</span>'
            +   '</span>'
            + '</div>';
    }

    /**
     * Основной рендер успешного ответа.
     */
    function renderResult(root, payload, options) {
        options = options || {};
        const scope = root || document;
        const block = findResultBlock(scope);
        if (!block || !payload) return;

        block.hidden = false;

        // Показываем все секции (кроме spectrum — по условию).
        const task = block.querySelector('.result-section--task');
        if (task) task.hidden = false;

        const sections = block.querySelectorAll('.result-section');
        sections.forEach(function (s) {
            if (!s.classList.contains('result-section--task')
                && !s.hasAttribute('data-props-spectrum-section')) {
                s.hidden = false;
            }
        });

        const error = block.querySelector('[data-props-error]');
        if (error) error.hidden = true;

        // --- Задание
        const taskFormula = block.querySelector('[data-props-task-formula]');
        if (taskFormula) {
            const latex = options.taskLatex || '';
            taskFormula.innerHTML = latex ? ('$$' + latex + '$$') : '';
        }

        // --- Сводка
        const summaryEl = block.querySelector('[data-props-summary]');
        const result = payload.result || {};
        const summary = isArr(result.summary) ? result.summary : [];

        if (summaryEl) {
            if (!summary.length) {
                summaryEl.innerHTML = '<div class="props-empty">'
                    + esc(tr('props.emptySummary', 'Сводка недоступна.'))
                    + '</div>';
            } else {
                summaryEl.innerHTML = summary.map(buildSummaryItem).join('');
            }
        }

        // --- Спектр (только при with_eigenvalues)
        const spectrumSection = block.querySelector(
            '[data-props-spectrum-section]'
        );
        const spectrumEl = block.querySelector('[data-props-spectrum]');
        const eigenvalues = isArr(result.eigenvalues) ? result.eigenvalues : [];

        if (spectrumSection && spectrumEl) {
            if (options.withEigen && eigenvalues.length) {
                spectrumSection.hidden = false;
                spectrumEl.innerHTML = eigenvalues
                    .map(buildEigenvalueItem)
                    .join('');
            } else {
                spectrumSection.hidden = true;
                spectrumEl.innerHTML = '';
            }
        }

        // --- MathJax
        if (ML.mathjax && typeof ML.mathjax.typeset === 'function') {
            ML.mathjax.typeset(block);
        }

        // --- Скролл
        try {
            block.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) { /* noop */ }
    }

    // =========================================================================
    // 5. ЗАПУСК АНАЛИЗА
    // =========================================================================

    /**
     * @param {object} ctx — { root, resultBlock, placeholder, mi }
     * @returns {Promise<object|null>}
     */
    async function runOperation(ctx) {
        ctx = ctx || {};
        const scope = ctx.root || document;
        const resultBlock = ctx.resultBlock || findResultBlock(scope);
        const placeholder = ctx.placeholder
            || scope.querySelector(
                '[data-props-placeholder], [data-calc-placeholder]'
            );

        const mi = ctx.mi || findMatrixInput(scope);
        if (!mi) {
            ML.toast.warning(
                tr('props.noMatrix', 'Нет матрицы'),
                tr('props.editorNotFound',
                    'Редактор матрицы не найден.')
            );
            return null;
        }

        const matrix = mi.read();

        if (isEmptyMatrix(matrix)) {
            ML.toast.warning(
                tr('props.emptyMatrix', 'Пустая матрица'),
                tr('props.fillMatrix', 'Заполните матрицу.')
            );
            return null;
        }
        if (mi.hasInvalid && mi.hasInvalid()) {
            ML.toast.warning(
                tr('props.invalidInput', 'Некорректный ввод'),
                tr('props.fixCells', 'Исправьте подсвеченные ячейки.')
            );
            return null;
        }

        const validation = ML.validateMatrixFor('properties', { a: mi });
        if (!validation.ok) {
            ML.toast.warning(validation.message, validation.hint || '');
            return null;
        }

        const withEigen = getWithEigen(scope);

        const payload = {
            matrix: matrix,
            with_eigenvalues: withEigen,
            show_steps: getShowSteps(scope)
        };

        const snapshot = JSON.parse(JSON.stringify(payload));

        // --- Loading
        ML.loader.show(
            tr('common.computing', 'Анализируем…')
        );
        if (resultBlock) {
            resultBlock.hidden = false;
            const summaryEl = resultBlock.querySelector('[data-props-summary]');
            if (summaryEl) {
                summaryEl.innerHTML = '<div class="props-skeleton">'
                    + '<div class="skeleton skeleton-line"></div>'
                    + '<div class="skeleton skeleton-line"></div>'
                    + '<div class="skeleton skeleton-line short"></div>'
                    + '</div>';
            }
        }

        try {
            const response = await ML.api.post(API.properties, payload);

            // --- Backend-ошибка (success: false) — не должна доходить сюда,
            //     ML.api превращает её в throw, но подстрахуемся.
            if (response && response.success === false) {
                throw Object.assign(
                    new Error(response.error || 'Backend error'),
                    { code: response.code || 'backend_error' }
                );
            }

            // --- Рендер результата
            renderResult(scope, response, {
                taskLatex: 'A = ' + ML.format.matrixToLatex(matrix),
                withEigen: withEigen
            });

            if (placeholder) placeholder.hidden = true;

            ML.toast.success(
                tr('common.ok', 'Готово'),
                tr('props.done', 'Свойства определены.')
            );

            ML.history.push({
                op: 'properties',
                label: tr('props.label', 'Свойства матрицы'),
                matrix: payload.matrix,
                result: response,
                size: mi.rows + '×' + mi.cols
            });

            ML.emit('properties:done', {
                payload: snapshot,
                result: response
            });

            return response;
        } catch (err) {
            renderError(scope, err.message, err.code);
            if (placeholder) placeholder.hidden = true;

            ML.toast.error(
                tr('props.failed', 'Не удалось выполнить'),
                err.message || ''
            );
            ML.emit('properties:error', { error: err });
            return null;
        } finally {
            ML.loader.hide();
        }
    }

    function run(root, ctx) {
        return runOperation(Object.assign({}, ctx, {
            root: (ctx && ctx.root) || root || document
        }));
    }

    // =========================================================================
    // 6. ПРИМЕРЫ
    // =========================================================================

    function initExamples() {
        document.addEventListener('click', async function (e) {
            const btn = e.target.closest('[data-load-properties-example]');
            if (!btn) return;

            const slug = btn.dataset.loadPropertiesExample;
            if (!slug) return;

            const mi = findMatrixInput(btn.closest('section'))
                || findMatrixInput(document);

            ML.loader.show(
                tr('props.loadingExample', 'Загружаем пример…')
            );

            try {
                const resp = await ML.api.post(
                    API.example + slug + '/', {}
                );
                const data = (resp && resp.result) || {};

                if (data.matrix && mi) {
                    mi.setSize(
                        data.matrix.length,
                        data.matrix[0].length,
                        { preserve: false }
                    );
                    mi.write(data.matrix);
                }

                closeModalIfAny(btn);
                ML.toast.success(
                    tr('props.exampleLoaded', 'Пример загружен'),
                    data.title || slug
                );

                ML.emit('properties:example-loaded', { slug: slug });
            } catch (err) {
                ML.toast.error(
                    tr('props.exampleFailed', 'Не удалось загрузить'),
                    err.message
                );
            } finally {
                ML.loader.hide();
            }
        });
    }

    // =========================================================================
    // 7. МОНТИРОВАНИЕ
    // =========================================================================

    function mount(root) {
        root = root || document;
        const runBtn = findRunBtn(root);
        if (!runBtn) return false;

        const section = runBtn.closest('section') || document;
        const resultBlock = findResultBlock(section);
        const resetBtn = findResetBtn(section);
        const placeholder = section.querySelector(
            '[data-props-placeholder], [data-calc-placeholder]'
        );

        const mi = findMatrixInput(section);

        // --- Debounce обновления
        const updateDebounced = ML.debounce(function () {
            updateRunButtonState(section);
        }, 80);

        if (mi) mi.el.addEventListener('matrix:change', updateDebounced);
        ML.on('matrix:change', updateDebounced);

        updateRunButtonState(section);

        // --- Запуск
        runBtn.addEventListener('click', function () {
            runOperation({
                root: section,
                resultBlock: resultBlock,
                placeholder: placeholder,
                mi: mi
            });
        });

        // --- Сброс
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                if (mi) mi.clear();
                clearRendered(section);
                if (placeholder) placeholder.hidden = false;
                updateRunButtonState(section);

                ML.emit('properties:reset', {});
            });
        }

        // --- Переключатель with_eigenvalues
        const eigenToggle = section.querySelector('[data-props-eigen]');
        if (eigenToggle) {
            const saved = ML.prefs.get('properties.withEigen');
            if (saved === false) eigenToggle.checked = false;

            eigenToggle.addEventListener('change', function () {
                ML.prefs.set(
                    'properties.withEigen',
                    !!eigenToggle.checked
                );
                ML.emit('properties:with-eigen-toggle', {
                    value: !!eigenToggle.checked
                });
            });
        }

        // --- Публичный API
        ML.properties = ML.properties || {};
        ML.properties.mount = mount;
        ML.properties.run = run;
        ML.properties.runOperation = runOperation;
        ML.properties.updateRunButtonState = updateRunButtonState;
        ML.properties.clear = function (r) { clearRendered(r || section); };
        ML.properties.render = renderResult;
        ML.properties.renderError = renderError;

        ML.emit('properties:ready', {});
        return true;
    }

    // =========================================================================
    // 8. ИНИЦИАЛИЗАЦИЯ
    // =========================================================================

    let _initialized = false;

    function init() {
        if (_initialized) return;
        _initialized = true;

        if (document.querySelector('[data-props-run]')) {
            mount(document);
        }

        initExamples();

        ML.emit('properties:module-ready', {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();