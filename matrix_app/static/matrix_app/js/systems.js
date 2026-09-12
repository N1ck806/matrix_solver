/* =============================================================================
   MatrixLab — systems.js
   =============================================================================
   Страница /systems/ — решение СЛАУ и анализ по теореме Кронекера-Капелли.

   Публичный API:
       ML.systems.mount(root)
       ML.systems.solve(root, ctx)
       ML.systems.kronecker(root, ctx)
       ML.systems.updateRunButtonState(root)
       ML.systems.getSelectedMethod(root)
       ML.systems.runOperation(kind, root, ctx)

   Зависимости: main.js, matrix.js, steps.js.
   ============================================================================= */
(function () {
    'use strict';

    const ML = window.MatrixLab;
    if (!ML) {
        console.error('[systems.js] window.MatrixLab не найден — модуль не запущен.');
        return;
    }

    // =========================================================================
    // 1. ENDPOINTS
    // =========================================================================

    const API = {
        solve:     '/api/system/solve/',
        kronecker: '/api/system/kronecker/',
        example:   '/api/example/'
    };

    // =========================================================================
    // 2. УТИЛИТЫ
    // =========================================================================

    function tr(key, fallback) {
        return ML.i18n.t(key, fallback);
    }

    function isEmptyMatrix(m) {
        return ML.validators.isEmptyMatrix(m);
    }

    function isEmptyVector(v) {
        return ML.validators.isEmptyVector(v);
    }

    function findMatrixA(scope) {
        scope = scope || document;
        const grid = scope.querySelector('[data-matrix-card="a"] [data-matrix-input]')
                  || scope.querySelector('[data-matrix-input]');
        if (!grid) return null;
        return (ML.matrixInputs && ML.matrixInputs[grid.id]) || null;
    }

    function findVectorB(scope) {
        scope = scope || document;
        const el = scope.querySelector('[data-vector-input]');
        if (!el) return null;
        return (ML.vectorInputs && ML.vectorInputs[el.id]) || null;
    }

    function getSelectedMethod(root) {
        const scope = root || document;
        const radio = scope.querySelector('[data-system-method]:checked');
        if (radio) return radio.value;
        const sel = scope.querySelector('[data-method-select]');
        if (sel && sel.value) return sel.value;
        return 'auto';
    }

    function getShowSteps(root) {
        const scope = root || document;
        const el = scope.querySelector('[data-system-steps], [data-show-steps]');
        return el ? !!el.checked : true;
    }

    function closeModalIfAny(btn) {
        const modal = btn && btn.closest('.modal');
        if (modal && ML.modal) {
            setTimeout(function () {
                ML.modal.close('#' + modal.id);
            }, 200);
        }
    }

    // =========================================================================
    // 3. СБОРКА PAYLOAD
    // =========================================================================
    // FIX: убрана проверка miA.cols + 1 > MAX_SLAU_COLS.
    //      UI уже ограничивает A через ML.maxCols = MAX_MATRIX_COLS.
    //      Расширенную матрицу [A|b] строит и валидирует сервер
    //      (по MAX_SLAU_COLS), а не клиент. Иначе получаем ложный
    //      запрет "10×11 превышает 10×10".
    // =========================================================================

    function buildPayload(scope, miA, vecB, opts) {
        opts = opts || {};

        if (!miA) {
            throw new Error(tr('systems.matrixANotFound', 'Матрица A не найдена.'));
        }
        if (!vecB) {
            throw new Error(tr('systems.vectorBNotFound', 'Вектор b не найден.'));
        }

        const a = miA.read();
        const b = vecB.read();

        if (isEmptyMatrix(a)) {
            throw new Error(tr('systems.fillA', 'Заполните коэффициенты матрицы A.'));
        }
        if (miA.hasInvalid && miA.hasInvalid()) {
            throw new Error(tr('systems.invalidA', 'Исправьте подсвеченные ячейки в A.'));
        }
        if (isEmptyVector(b)) {
            throw new Error(tr('systems.fillB', 'Заполните свободные члены b.'));
        }
        if (vecB.hasInvalid && vecB.hasInvalid()) {
            throw new Error(tr('systems.invalidB', 'Исправьте подсвеченные ячейки в b.'));
        }
        if (miA.rows !== vecB.rows) {
            throw new Error(
                tr('systems.sizeMismatch',
                    'Размерность вектора b должна совпадать с числом строк A:')
                + ' ' + tr('systems.aRows', 'у A строк') + ' ' + miA.rows
                + ', ' + tr('systems.bRows', 'у b —') + ' ' + vecB.rows + '.'
            );
        }

        const payload = {
            matrix_a: a,
            vector_b: b,
            show_steps: getShowSteps(scope)
        };

        if (opts.withMethod) payload.method = getSelectedMethod(scope);
        return payload;
    }

    // =========================================================================
    // 4. ОБНОВЛЕНИЕ СОСТОЯНИЯ КНОПОК
    // =========================================================================

    function updateRunButtonState(root) {
        const scope = root || document;
        const runBtn  = scope.querySelector('[data-system-run]');
        const kronBtn = scope.querySelector('[data-system-kronecker]');
        if (!runBtn && !kronBtn) return;

        const miA  = findMatrixA(scope);
        const vecB = findVectorB(scope);

        let disabled = false;
        let title = tr('systems.run', 'Выполнить');

        if (!miA || !vecB) {
            disabled = true;
            title = tr('systems.editorsNotFound', 'Редакторы не найдены');
        } else {
            const a = miA.read();
            const b = vecB.read();

            if (isEmptyMatrix(a)) {
                disabled = true;
                title = tr('systems.fillA', 'Заполните коэффициенты матрицы A.');
            } else if (miA.hasInvalid && miA.hasInvalid()) {
                disabled = true;
                title = tr('systems.invalidA', 'Исправьте подсвеченные ячейки в A.');
            } else if (isEmptyVector(b)) {
                disabled = true;
                title = tr('systems.fillB', 'Заполните свободные члены b.');
            } else if (vecB.hasInvalid && vecB.hasInvalid()) {
                disabled = true;
                title = tr('systems.invalidB', 'Исправьте подсвеченные ячейки в b.');
            } else if (vecB.rows !== miA.rows) {
                disabled = true;
                title = tr('systems.sizeMismatchShort',
                    'Размер b ≠ числу строк A') + ' (' + miA.rows + ')';
            }
        }

        [runBtn, kronBtn].forEach(function (btn) {
            if (!btn) return;
            btn.disabled = disabled;
            btn.title = title;
            btn.setAttribute('aria-disabled', String(disabled));
        });
    }

    // =========================================================================
    // 5. ЕДИНЫЙ ДВИЖОК
    // =========================================================================

    async function runOperation(kind, root, ctx) {
        ctx = ctx || {};
        const scope = ctx.root || root || document;
        const resultBlock = ctx.resultBlock
            || scope.querySelector('[data-result-block]');
        const placeholder = ctx.placeholder
            || scope.querySelector('[data-system-placeholder], [data-calc-placeholder]');

        const miA  = ctx.miA  || findMatrixA(scope);
        const vecB = ctx.vecB || findVectorB(scope);

        let payload;
        try {
            payload = buildPayload(scope, miA, vecB, {
                withMethod: kind === 'solve'
            });
        } catch (err) {
            ML.toast.warning(
                tr('systems.cannotRun', 'Нельзя выполнить'),
                err.message
            );
            return null;
        }

        const snapshot = JSON.parse(JSON.stringify(payload));

        const loadingText = kind === 'solve'
            ? tr('systems.solving', 'Решаем систему…')
            : tr('systems.checking', 'Проверяем совместность…');
        ML.loader.show(loadingText);

        if (resultBlock && ML.resultBlock) {
            ML.resultBlock.renderSkeleton(resultBlock);
        }

        try {
            const url = kind === 'solve' ? API.solve : API.kronecker;
            const response = await ML.api.post(url, payload);

            let verification = { ok: true };
            if (kind === 'solve' && ML.verifyResult) {
                verification = ML.verifyResult('solve_system', snapshot, response);
            }

            const finalPayload = kind === 'kronecker'
                ? buildKroneckerPayload(response, payload)
                : response;

            if (resultBlock && ML.resultBlock) {
                const taskText = kind === 'solve'
                    ? tr('systems.taskText', 'Решить систему Ax = b.')
                    : tr('systems.kroneckerTask',
                        'Проверить совместность по теореме Кронекера-Капелли.');

                const taskLatex = 'A = '
                    + ML.format.matrixToLatex(payload.matrix_a)
                    + ', \\quad b = '
                    + ML.format.matrixToLatex(
                        payload.vector_b.map(function (x) { return [x]; })
                    );

                ML.resultBlock.render(resultBlock, finalPayload, {
                    taskText: taskText,
                    taskLatex: taskLatex,
                    verified: verification.ok
                });
            }

            if (placeholder) placeholder.hidden = true;

            const resultKind = (response && response.result
                && response.result.kind) || '';
            const conclusion = (response && response.result
                && response.result.conclusion) || '';

            if (kind === 'solve') {
                showSolveToast(resultKind);
            } else {
                showKroneckerToast(resultKind, conclusion);
            }

            ML.history.push({
                op: kind === 'solve' ? 'solve_system' : 'kronecker_capelli',
                label: kind === 'solve'
                    ? tr('systems.solve', 'Решение СЛАУ')
                    : tr('systems.kronecker', 'Кронекер-Капелли'),
                matrix_a: payload.matrix_a,
                vector_b: payload.vector_b,
                method: payload.method,
                result: response,
                size: miA ? (miA.rows + '×' + miA.cols) : ''
            });

            ML.emit('system:' + kind, { payload: snapshot, result: response });
            return response;

        } catch (err) {
            if (resultBlock && ML.resultBlock) {
                ML.resultBlock.renderError(resultBlock,
                    err.message, err.code);
            }
            if (placeholder) placeholder.hidden = false;
            ML.toast.error(tr('common.error', 'Ошибка'), err.message || '');
            ML.emit('system:error', { kind: kind, error: err });
            return null;
        } finally {
            ML.loader.hide();
        }
    }

    function solve(root, ctx)     { return runOperation('solve', root, ctx); }
    function kronecker(root, ctx) { return runOperation('kronecker', root, ctx); }

    // =========================================================================
    // 6. TOAST-СООБЩЕНИЯ
    // =========================================================================

    function showSolveToast(kind) {
        if (kind === 'unique') {
            ML.toast.success(tr('systems.unique', 'Единственное решение'), '');
        } else if (kind === 'infinite') {
            ML.toast.info(
                tr('systems.infinite', 'Бесконечно много решений'),
                tr('systems.infiniteHint', 'Система совместна, но не определена.')
            );
        } else if (kind === 'none') {
            ML.toast.warning(
                tr('systems.none', 'Решений нет'),
                tr('systems.noneHint', 'Система несовместна.')
            );
        } else {
            ML.toast.success(
                tr('common.ok', 'Готово'),
                tr('systems.solved', 'Система решена.')
            );
        }
    }

    function showKroneckerToast(kind, conclusion) {
        if (kind === 'unique') {
            ML.toast.success(tr('systems.consistent', 'Совместна'), conclusion);
        } else if (kind === 'infinite') {
            ML.toast.info(
                tr('systems.underdetermined', 'Совместна, но не определена'),
                conclusion
            );
        } else if (kind === 'none') {
            ML.toast.warning(tr('systems.inconsistent', 'Несовместна'), conclusion);
        } else {
            ML.toast.info(tr('common.ok', 'Готово'), conclusion || '');
        }
    }

    // =========================================================================
    // 7. КРОНЕКЕР-КАПЕЛЛИ — ОБЪЕДИНЕНИЕ В ЕДИНЫЙ PAYLOAD
    // =========================================================================

    function buildKroneckerPayload(resp, originalPayload) {
        const r     = (resp && resp.result) || {};
        const extra = (resp && resp.extra)  || {};
        const conclusion = r.conclusion || '';

        const steps = [];

        if (extra.augmented_latex) {
            steps.push({
                title: tr('systems.augmented', 'Расширенная матрица [A | b]'),
                text:  tr('systems.augmentedText',
                    'Составляем расширенную матрицу системы.'),
                latex: extra.augmented_latex
            });
        }
        if (extra.rref_latex) {
            steps.push({
                title: tr('systems.rref', 'Приведённая ступенчатая форма'),
                text:  tr('systems.rrefText',
                    'Приводим расширенную матрицу к RREF.'),
                latex: extra.rref_latex
            });
        }
        steps.push({
            title: tr('systems.rankCompare', 'Сравнение рангов'),
            text:  tr('systems.rankCompareText',
                'По теореме Кронекера-Капелли: если rank(A) = rank([A|b]), '
                + 'система совместна; иначе — несовместна.'),
            latex: '\\operatorname{rank}(A) = '
                + (r.rank_a != null ? r.rank_a : '\\text{?}')
                + ', \\quad \\operatorname{rank}([A|b]) = '
                + (r.rank_aug != null ? r.rank_aug : '\\text{?}')
        });
        if (conclusion) {
            steps.push({
                title: tr('systems.conclusion', 'Вывод'),
                text:  conclusion
            });
        }

        const taskLatex = originalPayload
            ? ('A = ' + ML.format.matrixToLatex(originalPayload.matrix_a)
               + ', \\quad b = '
               + ML.format.matrixToLatex(
                   originalPayload.vector_b.map(function (x) { return [x]; })
               ))
            : '';

        return {
            kind: 'system',
            result: r,
            explanation: (resp && resp.explanation) || conclusion || '',
            extra: extra,
            task: {
                text: tr('systems.kroneckerTask',
                    'Проверить совместность по теореме Кронекера-Капелли.'),
                latex: taskLatex
            },
            steps: steps
        };
    }

    // =========================================================================
    // 8. ПРИМЕРЫ СЛАУ
    // =========================================================================

    function initExamples() {
        document.addEventListener('click', async function (e) {
            const btn = e.target.closest('[data-load-system]');
            if (!btn) return;

            const slug = btn.dataset.loadSystem;
            if (!slug) return;

            const scope = btn.closest('section') || document;
            const miA  = findMatrixA(scope);
            const vecB = findVectorB(scope);

            ML.loader.show(tr('systems.loading', 'Загружаем пример…'));

            try {
                const resp = await ML.api.post(API.example + slug + '/', {});
                const data = (resp && resp.result) || {};

                if (data.matrix && miA) {
                    miA.setSize(
                        data.matrix.length,
                        data.matrix[0].length,
                        { preserve: false }
                    );
                    miA.write(data.matrix);
                }
                if (data.vector && vecB) {
                    vecB.write(data.vector);
                }

                closeModalIfAny(btn);
                ML.toast.success(
                    tr('systems.exampleLoaded', 'Пример загружен'),
                    data.title || slug
                );

                updateRunButtonState(scope);
                ML.emit('systems:example-loaded', { slug: slug });
            } catch (err) {
                ML.toast.error(
                    tr('systems.exampleFailed', 'Не удалось загрузить'),
                    err.message || ''
                );
            } finally {
                ML.loader.hide();
            }
        });
    }

    // =========================================================================
    // 9. АВТОСИНХРОНИЗАЦИЯ b ↔ A
    // =========================================================================

    function bindVectorToMatrix(scope) {
        const miA  = findMatrixA(scope);
        const vecB = findVectorB(scope);
        if (!miA || !vecB) return;

        if (typeof vecB.setSize === 'function' && vecB.rows !== miA.rows) {
            vecB.setSize(miA.rows);
        }

        miA.el.addEventListener('matrix:change', function () {
            if (typeof vecB.setSize === 'function' && vecB.rows !== miA.rows) {
                vecB.setSize(miA.rows);
            }
        });
    }

    // =========================================================================
    // 10. МОНТИРОВАНИЕ
    // =========================================================================

    function mount(root) {
        root = root || document;
        const runBtn  = root.querySelector('[data-system-run]');
        const kronBtn = root.querySelector('[data-system-kronecker]');
        if (!runBtn && !kronBtn) return false;

        const section = (runBtn || kronBtn).closest('section') || root;
        const resultBlock = section.querySelector('[data-result-block]');
        const resetBtn    = section.querySelector('[data-system-reset]');
        const placeholder = section.querySelector(
            '[data-system-placeholder], [data-calc-placeholder]'
        );

        const miA  = findMatrixA(section);
        const vecB = findVectorB(section);

        bindVectorToMatrix(section);

        const updateDebounced = ML.debounce(function () {
            updateRunButtonState(section);
        }, 80);

        if (miA)  miA.el.addEventListener('matrix:change', updateDebounced);
        if (vecB) vecB.el.addEventListener('vector:change', updateDebounced);
        ML.on('matrix:change', updateDebounced);
        ML.on('vector:change', updateDebounced);

        updateRunButtonState(section);

        if (runBtn) {
            runBtn.addEventListener('click', function () {
                solve(section, {
                    resultBlock: resultBlock,
                    placeholder: placeholder,
                    miA: miA,
                    vecB: vecB
                });
            });
        }

        if (kronBtn) {
            kronBtn.addEventListener('click', function () {
                kronecker(section, {
                    resultBlock: resultBlock,
                    placeholder: placeholder,
                    miA: miA,
                    vecB: vecB
                });
            });
        }

        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                if (miA)  miA.clear();
                if (vecB) vecB.clear();

                if (resultBlock && ML.resultBlock) {
                    ML.resultBlock.clear(resultBlock);
                } else if (resultBlock) {
                    resultBlock.hidden = true;
                }
                if (placeholder) placeholder.hidden = false;
                updateRunButtonState(section);

                ML.emit('systems:reset', {});
            });
        }

        ML.systems = ML.systems || {};
        ML.systems.mount = mount;
        ML.systems.solve = solve;
        ML.systems.kronecker = kronecker;
        ML.systems.updateRunButtonState = updateRunButtonState;
        ML.systems.getSelectedMethod = getSelectedMethod;
        ML.systems.runOperation = runOperation;

        ML.emit('systems:ready', {});
        return true;
    }

    // =========================================================================
    // 11. ИНИЦИАЛИЗАЦИЯ
    // =========================================================================

    let _initialized = false;

    function init() {
        if (_initialized) return;
        _initialized = true;

        if (document.querySelector('[data-system-run], [data-system-kronecker]')) {
            mount(document);
        }

        initExamples();
        ML.emit('systems:modules-ready', {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();