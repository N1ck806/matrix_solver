/* =============================================================================
   MatrixLab — properties.js
   =============================================================================
   Страница /properties/ — анализ свойств матрицы.

   Отвечает за:
       • отправку матрицы A на /api/matrix/properties/;
       • флаг with_eigenvalues (data-props-eigen) — считать ли собственные
         значения вместе со свойствами;
       • сохранение предпочтения with_eigenvalues в ML.prefs;
       • корректный рендер ответа через ML.resultBlock (kind: 'properties');
       • fallback: если структура ответа не сводится к properties —
         отрисовать как text-результат (steps.js умеет сам);
       • skeleton + render + renderError — единый контракт с steps.js;
       • валидацию через ML.validateMatrixFor('properties', { a });
       • проверку hasInvalid перед отправкой;
       • запись в ML.history.push;
       • i18n через ML.i18n.t;
       • очистку формы и скрытие результата;
       • публичный API ML.properties.{mount, run, runOperation,
         updateRunButtonState}.

   Публичный API:
       ML.properties.mount(root)
       ML.properties.run(root, ctx)
       ML.properties.runOperation(ctx)
       ML.properties.updateRunButtonState(root)

   Зависимости: main.js, matrix.js, steps.js.
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

    function findMatrixInput(root) {
        const scope = root || document;
        const grid = scope.querySelector('[data-matrix-input]');
        if (!grid) return null;
        return ML.matrixInputs[grid.id] || null;
    }

    function findResultBlock(root) {
        const scope = root || document;
        return scope.querySelector('[data-result-block]')
            || scope.querySelector('[data-props-result]');
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
    // 4. ЗАПУСК АНАЛИЗА
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

        const payload = {
            matrix: matrix,
            with_eigenvalues: getWithEigen(scope),
            show_steps: getShowSteps(scope)
        };

        const snapshot = JSON.parse(JSON.stringify(payload));

        // --- Loading
        ML.loader.show(
            tr('common.computing', 'Анализируем…')
        );
        if (resultBlock && ML.resultBlock) {
            ML.resultBlock.renderSkeleton(resultBlock);
        }

        try {
            const response = await ML.api.post(API.properties, payload);

            let verification = { ok: true };
            if (ML.verifyResult) {
                verification = ML.verifyResult(
                    'properties', snapshot, response
                );
            }

            if (resultBlock && ML.resultBlock) {
                ML.resultBlock.render(resultBlock, response, {
                    taskText: tr('props.taskText',
                        'Проанализировать свойства матрицы.'),
                    taskLatex: 'A = '
                        + ML.format.matrixToLatex(matrix),
                    verified: verification.ok
                });
            }
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
            if (resultBlock && ML.resultBlock) {
                ML.resultBlock.renderError(
                    resultBlock, err.message, err.code
                );
            }
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
    // 5. ПРИМЕРЫ
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
    // 6. МОНТИРОВАНИЕ
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
                if (resultBlock && ML.resultBlock) {
                    ML.resultBlock.clear(resultBlock);
                } else if (resultBlock) {
                    resultBlock.hidden = true;
                }
                if (placeholder) placeholder.hidden = false;
                updateRunButtonState(section);

                ML.emit('properties:reset', {});
            });
        }

        // --- Переключатель with_eigenvalues
        const eigenToggle = section.querySelector('[data-props-eigen]');
        if (eigenToggle) {
            // Восстанавливаем сохранённое предпочтение
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

        ML.emit('properties:ready', {});
        return true;
    }

    // =========================================================================
    // 7. ИНИЦИАЛИЗАЦИЯ
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