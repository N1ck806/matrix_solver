/* =============================================================================
   MatrixLab — decompositions.js
   =============================================================================
   Страница /decompositions/ — LU, QR, Холецкий, диагонализация, спектральное.

   Публичный API:
       ML.decompositions.mount(root)
       ML.decompositions.run(root, ctx)
       ML.decompositions.runOperation(op, ctx)
       ML.decompositions.updateRunButtonState(root)
       ML.decompositions.setOperation(op, root)
       ML.decompositions.getOperation()
       ML.decompositions.list()

   Зависимости: main.js, matrix.js, steps.js.
   ============================================================================= */
(function () {
    'use strict';

    const ML = window.MatrixLab;
    if (!ML) {
        console.error('[decompositions.js] window.MatrixLab не найден — модуль не запущен.');
        return;
    }

    // =========================================================================
    // 1. РЕЕСТР РАЗЛОЖЕНИЙ
    // =========================================================================

    const DECOMPS = {
        lu: {
            url: '/api/matrix/lu/',
            label: 'LU-разложение',
            equation: 'A = L \\cdot U',
            square: true,
            autoSquare: true
        },
        qr: {
            url: '/api/matrix/qr/',
            label: 'QR-разложение',
            equation: 'A = Q \\cdot R',
            square: false,
            autoSquare: false
        },
        cholesky: {
            url: '/api/matrix/cholesky/',
            label: 'Разложение Холецкого',
            equation: 'A = L \\cdot L^{T}',
            square: true,
            autoSquare: true,
            symmetric: true
        },
        diagonalize: {
            url: '/api/matrix/diagonalize/',
            label: 'Диагонализация',
            equation: 'A = P \\cdot D \\cdot P^{-1}',
            square: true,
            autoSquare: true
        },
        spectral: {
            url: '/api/matrix/spectral/',
            label: 'Спектральное разложение',
            equation: 'A = Q \\cdot D \\cdot Q^{T}',
            square: true,
            autoSquare: true,
            symmetric: true
        }
    };

    function decompInfo(op) {
        return DECOMPS[op] || { url: null, label: op };
    }

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

    /**
     * Проверка симметричности матрицы на фронте.
     * Сравнивает как строки (без вычислений), с trim и регистром.
     * Возвращает true, если матрица квадратная и симметрична.
     */
    function isSymmetric(matrix) {
        if (!isArr(matrix) || !matrix.length) return false;
        const n = matrix.length;
        for (let i = 0; i < n; i++) {
            if (!isArr(matrix[i]) || matrix[i].length !== n) return false;
        }
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const a = String(matrix[i][j] || '').trim();
                const b = String(matrix[j][i] || '').trim();
                if (a !== b) return false;
            }
        }
        return true;
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
            || scope.querySelector('[data-decomp-result]');
    }

    function findRunBtn(root) {
        const scope = root || document;
        return scope.querySelector('[data-decomp-run]');
    }

    function findResetBtn(root) {
        const scope = root || document;
        return scope.querySelector('[data-decomp-reset]');
    }

    function closeModalIfAny(btn) {
        const modal = btn && btn.closest('.modal');
        if (modal && ML.modal) {
            setTimeout(function () {
                ML.modal.close('#' + modal.id);
            }, 200);
        }
    }

    /**
     * FIX: убираем "сырой HTML" вида &lt;span class="ml-icon--missing"&gt;
     * и сами пустые .ml-icon--missing. Если иконки нет — она просто исчезает.
     * Плюс — ищем текст, который похож на "утекший" HTML, и удаляем его.
     */
    function cleanupMissingIcons(scope) {
        const s = scope || document;

        // 1. Удаляем все .ml-icon--missing
        ML.$$('.ml-icon--missing', s).forEach(function (el) {
            el.remove();
        });

        // 2. Ищем текстовые узлы, которые содержат "<span class=\"ml-icon"
        //    или "ml-icon--missing" — это "утекший" HTML. Удаляем.
        const walker = document.createTreeWalker(
            s.body || s,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function (node) {
                    const t = node.nodeValue || '';
                    if (t.indexOf('ml-icon--missing') !== -1
                        || t.indexOf('ml-icon ml-icon--') !== -1) {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_SKIP;
                }
            }
        );

        const toRemove = [];
        while (walker.nextNode()) toRemove.push(walker.currentNode);
        toRemove.forEach(function (node) {
            node.nodeValue = (node.nodeValue || '')
                .replace(/<span[^>]*ml-icon[^>]*><\/span>/g, '')
                .replace(/&lt;span[^&]*ml-icon[^&]*&gt;&lt;\/span&gt;/g, '')
                .trim();
        });
    }

    // =========================================================================
    // 3. ТЕКУЩАЯ ОПЕРАЦИЯ
    // =========================================================================

    let currentOp = 'lu';

    function setOperation(op, root) {
        if (!DECOMPS[op]) return;
        currentOp = op;
        const scope = root || document;

        ML.$$('[data-decomp]', scope).forEach(function (b) {
            const active = b.dataset.decomp === op;
            b.classList.toggle('is-active', active);
            b.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        // При смене разложения — авто-подгонка размера
        autoResizeForCurrent(scope);

        updateRunButtonState(scope);
        ML.emit('decomposition:operation', { op: op });
    }

    function getOperation() { return currentOp; }

    function listOperations() { return Object.keys(DECOMPS); }

    // =========================================================================
    // 4. АВТО-ПОДГОНКА РАЗМЕРА
    // =========================================================================

    /**
     * Если текущее разложение требует квадратной матрицы, а матрица не
     * квадратная — приводим к n × n (n = max(rows, cols)).
     * Сохраняем данные, где можно.
     */
    function autoResizeForCurrent(scope) {
        const info = decompInfo(currentOp);
        if (!info.autoSquare) return;

        const mi = findMatrixInput(scope);
        if (!mi) return;

        if (mi.rows !== mi.cols) {
            const n = Math.max(mi.rows, mi.cols);
            mi.setSize(n, n, { preserve: true });

            ML.toast.info(
                tr('decomp.sizeAdjusted', 'Размер подстроен'),
                tr('decomp.matrix', 'Матрица') + ' ' + n + ' × ' + n
            );
        }
    }

    // =========================================================================
    // 5. ОБНОВЛЕНИЕ КНОПКИ
    // =========================================================================

    function updateRunButtonState(root) {
        const scope = root || document;
        const runBtn = findRunBtn(scope);
        if (!runBtn) return;

        const mi = findMatrixInput(scope);
        if (!mi) {
            runBtn.disabled = true;
            runBtn.title = tr('decomp.editorNotFound',
                'Редактор матрицы не найден');
            runBtn.setAttribute('aria-disabled', 'true');
            return;
        }

        const info = decompInfo(currentOp);
        const matrix = mi.read();
        const empty = isEmptyMatrix(matrix);
        const invalid = mi.hasInvalid && mi.hasInvalid();
        const notSquare = info.square && mi.rows !== mi.cols;
        const notSymmetric = info.symmetric && !empty && !isSymmetric(matrix);

        runBtn.disabled = empty || invalid || notSquare || notSymmetric;

        if (invalid) {
            runBtn.title = tr('decomp.invalidValues',
                'Некорректные значения в матрице');
        } else if (empty) {
            runBtn.title = tr('decomp.fillMatrix', 'Заполните матрицу');
        } else if (notSquare) {
            runBtn.title = tr('decomp.needSquareFor',
                'Нужна квадратная матрица для') + ' «'
                + info.label + '»';
        } else if (notSymmetric) {
            runBtn.title = tr('decomp.needSymmetric',
                'Нужна симметричная матрица (A = Aᵀ)');
        } else {
            runBtn.title = tr('decomp.run', 'Выполнить') + ' ' + info.label;
        }

        runBtn.setAttribute('aria-disabled', String(runBtn.disabled));
    }

    // =========================================================================
    // 6. ЗАПУСК РАЗЛОЖЕНИЯ
    // =========================================================================

    async function runOperation(op, ctx) {
        ctx = ctx || {};
        const scope = ctx.root || document;
        const resultBlock = ctx.resultBlock || findResultBlock(scope);
        const placeholder = ctx.placeholder
            || scope.querySelector(
                '[data-decomp-placeholder], [data-calc-placeholder]'
            );

        const mi = ctx.mi || findMatrixInput(scope);
        if (!mi) {
            ML.toast.warning(
                tr('decomp.noMatrix', 'Нет матрицы'),
                tr('decomp.editorNotFound',
                    'Редактор матрицы не найден.')
            );
            return null;
        }

        const info = decompInfo(op);
        if (!info.url) {
            ML.toast.error(
                tr('common.error', 'Ошибка'),
                tr('decomp.notSupported', 'Разложение не поддерживается.')
                    + ' «' + info.label + '»'
            );
            return null;
        }

        // --- Проверки
        if (isEmptyMatrix(mi.read())) {
            ML.toast.warning(
                tr('decomp.emptyMatrix', 'Пустая матрица'),
                tr('decomp.fillMatrix', 'Заполните матрицу.')
            );
            return null;
        }
        if (mi.hasInvalid && mi.hasInvalid()) {
            ML.toast.warning(
                tr('decomp.invalidInput', 'Некорректный ввод'),
                tr('decomp.fixCells', 'Исправьте подсвеченные ячейки.')
            );
            return null;
        }

        // --- AutoSquare
        if (info.autoSquare && mi.rows !== mi.cols) {
            const n = Math.max(mi.rows, mi.cols);
            mi.setSize(n, n, { preserve: true });
            ML.toast.info(
                tr('decomp.sizeAdjusted', 'Размер подстроен'),
                tr('decomp.matrix', 'Матрица') + ' ' + n + ' × ' + n
            );
        }

        if (info.square && mi.rows !== mi.cols) {
            ML.toast.warning(
                tr('decomp.needSquare', 'Нужна квадратная матрица'),
                tr('decomp.needSquareHint', 'Для') + ' «' + info.label
                    + '» ' + tr('decomp.needSquareHint2',
                        'требуется матрица n × n.')
            );
            return null;
        }

        // --- Симметрия
        const matrix = mi.read();
        if (info.symmetric && !isSymmetric(matrix)) {
            ML.toast.warning(
                tr('decomp.needSymmetric', 'Нужна симметричная матрица'),
                tr('decomp.needSymmetricHint',
                    'Выбранное разложение требует симметричной матрицы '
                    + '(A = Aᵀ).')
            );
            return null;
        }

        // --- Валидация через ядро
        const validation = ML.validateMatrixFor(op, { a: mi });
        if (!validation.ok) {
            ML.toast.warning(validation.message, validation.hint || '');
            return null;
        }

        const payload = {
            matrix: matrix,
            show_steps: true
        };
        const snapshot = JSON.parse(JSON.stringify(payload));

        // --- Loading
        ML.loader.show(
            tr('common.computing', 'Разлагаем…')
        );
        if (resultBlock && ML.resultBlock) {
            ML.resultBlock.renderSkeleton(resultBlock);
        }

        try {
            const response = await ML.api.post(info.url, payload);

            let verification = { ok: true };
            if (ML.verifyResult) {
                verification = ML.verifyResult(op, snapshot, response);
            }

            const valid = !(response && response.extra
                && response.extra.valid === false);

            if (resultBlock && ML.resultBlock) {
                ML.resultBlock.render(resultBlock, response, {
                    taskText: tr('decomp.taskText',
                        'Выполнить разложение для матрицы A.')
                        + ' ' + info.label + '.',
                    taskLatex: 'A = ' + ML.format.matrixToLatex(matrix)
                        + ', \\quad ' + (info.equation || ''),
                    verified: verification.ok
                });
            }
            if (placeholder) placeholder.hidden = true;

            // --- Toast по применимости
            if (!valid) {
                const reason = (response.extra && response.extra.reason) || '';
                ML.toast.warning(
                    tr('decomp.notApplicable', 'Разложение неприменимо'),
                    reason || tr('decomp.notApplicableHint',
                        'Матрица не подходит для выбранного разложения.')
                );
                ML.emit('decomposition:not-applicable', {
                    op: op,
                    reason: reason
                });
            } else {
                ML.toast.success(
                    tr('common.ok', 'Готово'),
                    info.label + ' ' + tr('decomp.done', 'выполнено.')
                );
            }

            // --- История
            ML.history.push({
                op: op,
                label: info.label,
                matrix: snapshot.matrix,
                result: response,
                size: mi.rows + '×' + mi.cols
            });

            ML.emit('decomposition:done', {
                op: op,
                payload: snapshot,
                result: response,
                valid: valid
            });

            return response;
        } catch (err) {
            if (resultBlock && ML.resultBlock) {
                ML.resultBlock.renderError(
                    resultBlock, err.message, err.code
                );
            }
            ML.toast.error(
                tr('decomp.failed', 'Не удалось выполнить'),
                err.message || ''
            );
            ML.emit('decomposition:error', { op: op, error: err });
            return null;
        } finally {
            ML.loader.hide();
        }
    }

    function run(root, ctx) {
        return runOperation(currentOp, Object.assign({}, ctx, {
            root: (ctx && ctx.root) || root || document
        }));
    }

    // =========================================================================
    // 7. ПРИМЕРЫ
    // =========================================================================

    function initExamples() {
        document.addEventListener('click', async function (e) {
            const btn = e.target.closest('[data-load-decomp]');
            if (!btn) return;

            const slug = btn.dataset.loadDecomp;
            if (!slug) return;

            const mi = findMatrixInput(btn.closest('section'))
                || findMatrixInput(document);

            ML.loader.show(
                tr('decomp.loadingExample', 'Загружаем пример…')
            );

            try {
                const resp = await ML.api.post(
                    '/api/example/' + slug + '/', {}
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
                if (data.op && DECOMPS[data.op]) {
                    setOperation(data.op, document);
                }

                closeModalIfAny(btn);
                ML.toast.success(
                    tr('decomp.exampleLoaded', 'Пример загружен'),
                    data.title || slug
                );

                ML.emit('decompositions:example-loaded', { slug: slug });
            } catch (err) {
                ML.toast.error(
                    tr('decomp.exampleFailed', 'Не удалось загрузить'),
                    err.message
                );
            } finally {
                ML.loader.hide();
            }
        });
    }

    // =========================================================================
    // 8. МОНТИРОВАНИЕ
    // =========================================================================

    function mount(root) {
        root = root || document;
        const runBtn = findRunBtn(root);
        if (!runBtn) return false;

        const section = runBtn.closest('section') || document;
        const resultBlock = findResultBlock(section);
        const resetBtn = findResetBtn(section);
        const placeholder = section.querySelector(
            '[data-decomp-placeholder], [data-calc-placeholder]'
        );

        const mi = findMatrixInput(section);

        // FIX: убираем битые/пустые ml-icon--missing и "утекший" HTML
        cleanupMissingIcons(document);

        // --- Debounce
        const updateDebounced = ML.debounce(function () {
            updateRunButtonState(section);
        }, 80);

        if (mi) {
            mi.el.addEventListener('matrix:change', function () {
                // На лету: авто-подгонка под текущее разложение
                autoResizeForCurrent(section);
                updateDebounced();
            });
        }
        ML.on('matrix:change', updateDebounced);

        // --- Переключение разложений
        ML.$$('[data-decomp]', section).forEach(function (btn) {
            btn.addEventListener('click', function () {
                setOperation(btn.dataset.decomp, section);
            });
        });

        // --- Начальная операция
        const initialBtn = section.querySelector('[data-decomp].is-active')
            || section.querySelector('[data-decomp]');
        if (initialBtn && initialBtn.dataset.decomp) {
            currentOp = initialBtn.dataset.decomp;
        }
        setOperation(currentOp, section);

        // --- Запуск
        runBtn.addEventListener('click', function () {
            runOperation(currentOp, {
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

                ML.emit('decompositions:reset', {});
            });
        }

        // --- Публичный API
        ML.decompositions = ML.decompositions || {};
        ML.decompositions.mount = mount;
        ML.decompositions.run = run;
        ML.decompositions.runOperation = runOperation;
        ML.decompositions.updateRunButtonState = updateRunButtonState;
        ML.decompositions.setOperation = setOperation;
        ML.decompositions.getOperation = getOperation;
        ML.decompositions.list = listOperations;
        ML.decompositions.cleanupMissingIcons = cleanupMissingIcons;

        ML.emit('decompositions:ready', {});
        return true;
    }

    // =========================================================================
    // 9. ИНИЦИАЛИЗАЦИЯ
    // =========================================================================

    let _initialized = false;

    function init() {
        if (_initialized) return;
        _initialized = true;

        // FIX: чистим DOM от "сырого HTML" сразу после загрузки
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () {
                cleanupMissingIcons(document);
            });
        } else {
            cleanupMissingIcons(document);
        }

        if (document.querySelector('[data-decomp-run]')) {
            mount(document);
        }

        initExamples();

        ML.emit('decompositions:module-ready', {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();