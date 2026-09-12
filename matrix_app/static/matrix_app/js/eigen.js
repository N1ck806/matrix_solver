/* =============================================================================
   MatrixLab — eigen.js
   =============================================================================
   Страница /eigen/ — спектр матрицы: собственные значения и векторы,
   характеристический многочлен, полный спектральный анализ.

   Публичный API:
       ML.eigen.mount(root)
       ML.eigen.run(root, ctx)
       ML.eigen.runOperation(op, ctx)
       ML.eigen.updateRunButtonState(root)
       ML.eigen.setOperation(op, root)
       ML.eigen.getOperation()
       ML.eigen.list()

   Зависимости: main.js, matrix.js, steps.js.
   ============================================================================= */
(function () {
    'use strict';

    const ML = window.MatrixLab;
    if (!ML) {
        console.error('[eigen.js] window.MatrixLab не найден — модуль не запущен.');
        return;
    }

    // =========================================================================
    // 1. РЕЕСТР ОПЕРАЦИЙ
    // =========================================================================

    const OPS = {
        eigenvalues: {
            url: '/api/matrix/eigenvalues/',
            label: 'Собственные значения',
            taskText: 'Найти собственные значения матрицы A.',
            kind: 'eigenvalues',
            square: true,
            autoSquare: true
        },
        eigenvectors: {
            url: '/api/matrix/eigenvectors/',
            label: 'Собственные векторы',
            taskText: 'Найти собственные векторы матрицы A.',
            kind: 'text',
            square: true,
            autoSquare: true
        },
        char_poly: {
            url: '/api/matrix/char-poly/',
            label: 'Характеристический многочлен',
            taskText: 'Найти характеристический многочлен матрицы A.',
            kind: 'text',
            square: true,
            autoSquare: true
        },
        full: {
            url: null,
            label: 'Полный спектральный анализ',
            taskText: 'Полный спектральный анализ матрицы A.',
            kind: 'text',
            square: true,
            autoSquare: true,
            composite: true
        }
    };

    function opInfo(op) {
        return OPS[op] || {
            url: null,
            label: op,
            taskText: '',
            kind: 'text',
            square: true,
            autoSquare: true
        };
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

    function findMatrixInput(root) {
        const scope = root || document;
        const grid = scope.querySelector('[data-matrix-input]');
        if (!grid) return null;
        return ML.matrixInputs[grid.id] || null;
    }

    function findResultBlock(root) {
        const scope = root || document;
        return scope.querySelector('[data-eigen-result]')
            || scope.querySelector('[data-result-block]');
    }

    function findRunBtn(root) {
        const scope = root || document;
        return scope.querySelector('[data-eigen-run]');
    }

    function findResetBtn(root) {
        const scope = root || document;
        return scope.querySelector('[data-eigen-reset]');
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
     * FIX: убираем "сырой HTML" ml-icon--missing и пустые иконки.
     * Если SVG нет — тег возвращает <span class="ml-icon--missing">…</span>,
     * который печатается как текст, если попадает в text node.
     * Здесь мы это вычищаем.
     */
    function cleanupMissingIcons(scope) {
        const s = scope || document;

        // 1. Удаляем все .ml-icon--missing
        ML.$$('.ml-icon--missing', s).forEach(function (el) {
            el.remove();
        });

        // 2. Ищем текстовые узлы с "ml-icon--missing" — это "утекший" HTML.
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
                .replace(/<span[^>]*ml-icon[^>]*>[\s\S]*?<\/span>/g, '')
                .replace(/&lt;span[^&]*ml-icon[\s\S]*?&lt;\/span&gt;/g, '')
                .trim();
        });
    }

    // =========================================================================
    // 3. ТЕКУЩАЯ ОПЕРАЦИЯ
    // =========================================================================

    let currentOp = 'eigenvalues';

    function setOperation(op, root) {
        if (!OPS[op]) return;
        currentOp = op;
        const scope = root || document;

        ML.$$('[data-eigen-op]', scope).forEach(function (b) {
            const active = b.dataset.eigenOp === op;
            b.classList.toggle('is-active', active);
            b.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        // Авто-подгонка размера
        autoResizeForCurrent(scope);

        updateRunButtonState(scope);
        ML.emit('eigen:operation', { op: op });
    }

    function getOperation() { return currentOp; }

    function listOperations() { return Object.keys(OPS); }

    // =========================================================================
    // 4. АВТО-ПОДГОНКА РАЗМЕРА
    // =========================================================================

    function autoResizeForCurrent(scope) {
        const info = opInfo(currentOp);
        if (!info.autoSquare) return;

        const mi = findMatrixInput(scope);
        if (!mi) return;

        if (mi.rows !== mi.cols) {
            const n = Math.max(mi.rows, mi.cols);
            mi.setSize(n, n, { preserve: true });

            ML.toast.info(
                tr('eigen.sizeAdjusted', 'Размер подстроен'),
                tr('eigen.matrix', 'Матрица') + ' ' + n + ' × ' + n
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
            runBtn.title = tr('eigen.editorNotFound',
                'Редактор матрицы не найден');
            runBtn.setAttribute('aria-disabled', 'true');
            return;
        }

        const info = opInfo(currentOp);
        const matrix = mi.read();
        const empty = isEmptyMatrix(matrix);
        const invalid = mi.hasInvalid && mi.hasInvalid();
        const notSquare = info.square && mi.rows !== mi.cols;

        runBtn.disabled = empty || invalid || notSquare;

        if (invalid) {
            runBtn.title = tr('eigen.invalidValues',
                'Некорректные значения в матрице');
        } else if (empty) {
            runBtn.title = tr('eigen.fillMatrix', 'Заполните матрицу');
        } else if (notSquare) {
            runBtn.title = tr('eigen.needSquareFor',
                'Нужна квадратная матрица для') + ' «'
                + info.label + '»';
        } else {
            runBtn.title = tr('eigen.run', 'Выполнить') + ' '
                + info.label;
        }

        runBtn.setAttribute('aria-disabled', String(runBtn.disabled));
    }

    // =========================================================================
    // 6. ЗАПУСК ОПЕРАЦИИ
    // =========================================================================

    async function runOperation(op, ctx) {
        ctx = ctx || {};
        const scope = ctx.root || document;
        const resultBlock = ctx.resultBlock || findResultBlock(scope);
        const placeholder = ctx.placeholder
            || scope.querySelector(
                '[data-eigen-placeholder], [data-calc-placeholder]'
            );

        const mi = ctx.mi || findMatrixInput(scope);
        if (!mi) {
            ML.toast.warning(
                tr('eigen.noMatrix', 'Нет матрицы'),
                tr('eigen.editorNotFound',
                    'Редактор матрицы не найден.')
            );
            return null;
        }

        const info = opInfo(op);

        // --- Проверки
        if (isEmptyMatrix(mi.read())) {
            ML.toast.warning(
                tr('eigen.emptyMatrix', 'Пустая матрица'),
                tr('eigen.fillMatrix', 'Заполните матрицу.')
            );
            return null;
        }
        if (mi.hasInvalid && mi.hasInvalid()) {
            ML.toast.warning(
                tr('eigen.invalidInput', 'Некорректный ввод'),
                tr('eigen.fixCells', 'Исправьте подсвеченные ячейки.')
            );
            return null;
        }

        // --- AutoSquare
        if (info.autoSquare && mi.rows !== mi.cols) {
            const n = Math.max(mi.rows, mi.cols);
            mi.setSize(n, n, { preserve: true });
            ML.toast.info(
                tr('eigen.sizeAdjusted', 'Размер подстроен'),
                tr('eigen.matrix', 'Матрица') + ' ' + n + ' × ' + n
            );
        }

        if (info.square && mi.rows !== mi.cols) {
            ML.toast.warning(
                tr('eigen.needSquare', 'Нужна квадратная матрица'),
                tr('eigen.needSquareHint', 'Для') + ' «' + info.label
                    + '» ' + tr('eigen.needSquareHint2',
                        'требуется матрица n × n.')
            );
            return null;
        }

        // --- Валидация через ядро
        const validation = ML.validateMatrixFor(op, { a: mi });
        if (!validation.ok) {
            ML.toast.warning(validation.message, validation.hint || '');
            return null;
        }

        const matrix = mi.read();
        const payload = { matrix: matrix, show_steps: true };
        const snapshot = JSON.parse(JSON.stringify(payload));

        // --- Loading
        ML.loader.show(
            tr('common.computing', 'Анализируем спектр…')
        );
        // FIX: скелетон перекрывает предыдущий результат — если пришла ошибка,
        // не будет путаницы "успех + ошибка"
        if (resultBlock && ML.resultBlock) {
            ML.resultBlock.renderSkeleton(resultBlock);
        }

        try {
            let response;

            if (info.composite) {
                response = await runComposite(op, snapshot);
            } else {
                response = await ML.api.post(info.url, payload);
            }

            // FIX: проверяем success: false от бэкенда
            if (response && response.success === false) {
                const backendMsg = response.error
                    || response.message
                    || tr('eigen.backendError',
                        'Бэкенд вернул ошибку.');
                const backendCode = response.code || 'backend_error';
                throw Object.assign(
                    new Error(backendMsg),
                    { code: backendCode }
                );
            }

            let verification = { ok: true };
            if (ML.verifyResult) {
                verification = ML.verifyResult(op, snapshot, response);
            }

            if (resultBlock && ML.resultBlock) {
                ML.resultBlock.render(resultBlock, response, {
                    taskText: info.taskText,
                    taskLatex: 'A = '
                        + ML.format.matrixToLatex(matrix),
                    verified: verification.ok
                });
            }
            if (placeholder) placeholder.hidden = true;

            ML.toast.success(
                tr('common.ok', 'Готово'),
                info.label + ' ' + tr('eigen.done', 'выполнено.')
            );

            ML.history.push({
                op: op,
                label: info.label,
                matrix: snapshot.matrix,
                result: response,
                size: mi.rows + '×' + mi.cols
            });

            ML.emit('eigen:done', {
                op: op,
                payload: snapshot,
                result: response
            });

            return response;
        } catch (err) {
            if (resultBlock && ML.resultBlock) {
                ML.resultBlock.renderError(
                    resultBlock, err.message, err.code
                );
            } else if (resultBlock) {
                // Fallback — просто скрываем результат
                resultBlock.hidden = true;
                if (placeholder) placeholder.hidden = false;
            }

            ML.toast.error(
                tr('eigen.failed', 'Не удалось выполнить'),
                err.message || ''
            );
            ML.emit('eigen:error', { op: op, error: err });
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
    // 7. СОСТАВНАЯ ОПЕРАЦИЯ 'full'
    // =========================================================================

    async function runComposite(op, snapshot) {
        const [eigRes, vecRes] = await Promise.allSettled([
            ML.api.post(OPS.eigenvalues.url, snapshot),
            ML.api.post(OPS.eigenvectors.url, snapshot)
        ]);

        const eigResp = eigRes.status === 'fulfilled' ? eigRes.value : null;
        const vecResp = vecRes.status === 'fulfilled' ? vecRes.value : null;

        // FIX: если оба упали — это ошибка, не "частичный результат"
        if (!eigResp && !vecResp) {
            const firstError = eigRes.status === 'rejected' ? eigRes.reason
                : vecRes.reason;
            const err = firstError instanceof Error
                ? firstError
                : new Error(tr('eigen.compositeFailed',
                    'Не удалось получить данные спектра.'));
            throw err;
        }

        // FIX: если один упал — предупреждаем, но показываем второй
        if (!eigResp || !vecResp) {
            const partial = !eigResp
                ? tr('eigen.partialNoEigen',
                    'Не удалось получить собственные значения')
                : tr('eigen.partialNoVec',
                    'Не удалось получить собственные векторы');
            ML.toast.warning(
                tr('eigen.partial', 'Частичный результат'),
                partial
            );
        }

        const safeEig = eigResp || {};
        const safeVec = vecResp || {};

        // FIX: проверяем success на каждом
        if (safeEig.success === false && safeVec.success === false) {
            throw new Error(
                safeEig.error || safeVec.error
                || tr('eigen.compositeFailed',
                    'Не удалось получить данные спектра.')
            );
        }

        const mergedSteps = []
            .concat(isArr(safeEig.steps) ? safeEig.steps : [])
            .concat(isArr(safeVec.steps) ? safeVec.steps : []);

        const mergedChecks = []
            .concat(isArr(safeEig.checks) ? safeEig.checks : [])
            .concat(isArr(safeVec.checks) ? safeVec.checks : []);

        // FIX: result объединяем так, чтобы было видно и значения, и векторы.
        // Если у eigenvectors есть result (массив), берём его;
        // иначе — eigenvalues.result (массив значений).
        let result;
        if (isArr(safeVec.result) && safeVec.result.length) {
            result = safeVec.result;
        } else if (isArr(safeEig.result) && safeEig.result.length) {
            result = safeEig.result;
        } else if (safeVec.result != null) {
            result = safeVec.result;
        } else if (safeEig.result != null) {
            result = safeEig.result;
        } else {
            result = [];
        }

        return {
            success: true,
            kind: 'text',
            result: result,
            latex: safeEig.latex || safeVec.latex || '',
            explanation: safeEig.explanation
                || safeVec.explanation
                || '',
            extra: Object.assign({},
                safeEig.extra || {},
                safeVec.extra || {}
            ),
            task: safeEig.task || safeVec.task || {},
            steps: mergedSteps,
            checks: mergedChecks
        };
    }

    // =========================================================================
    // 8. ПРИМЕРЫ
    // =========================================================================

    function initExamples() {
        document.addEventListener('click', async function (e) {
            const btn = e.target.closest('[data-load-example], [data-load-eigen]');
            if (!btn) return;

            const slug = btn.dataset.loadExample
                || btn.dataset.loadEigen;
            if (!slug) return;

            const mi = findMatrixInput(btn.closest('section'))
                || findMatrixInput(document);

            ML.loader.show(
                tr('eigen.loadingExample', 'Загружаем пример…')
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
                if (data.op && OPS[data.op]) {
                    setOperation(data.op, document);
                }

                closeModalIfAny(btn);
                ML.toast.success(
                    tr('eigen.exampleLoaded', 'Пример загружен'),
                    data.title || slug
                );

                ML.emit('eigen:example-loaded', { slug: slug });
            } catch (err) {
                ML.toast.error(
                    tr('eigen.exampleFailed', 'Не удалось загрузить'),
                    err.message
                );
            } finally {
                ML.loader.hide();
            }
        });
    }

    // =========================================================================
    // 9. МОНТИРОВАНИЕ
    // =========================================================================

    function mount(root) {
        root = root || document;
        const runBtn = findRunBtn(root);
        if (!runBtn) return false;

        const section = runBtn.closest('section') || document;
        const resultBlock = findResultBlock(section);
        const resetBtn = findResetBtn(section);
        const placeholder = section.querySelector(
            '[data-eigen-placeholder], [data-calc-placeholder]'
        );

        const mi = findMatrixInput(section);

        // FIX: чистим "сырой HTML" от битых иконок
        cleanupMissingIcons(document);

        // --- Debounce
        const updateDebounced = ML.debounce(function () {
            updateRunButtonState(section);
        }, 80);

        if (mi) {
            mi.el.addEventListener('matrix:change', function () {
                autoResizeForCurrent(section);
                updateDebounced();
            });
        }
        ML.on('matrix:change', updateDebounced);

        // --- Переключение операций
        ML.$$('[data-eigen-op]', section).forEach(function (btn) {
            btn.addEventListener('click', function () {
                setOperation(btn.dataset.eigenOp, section);
            });
        });

        // --- Начальная операция
        const initialBtn = section.querySelector('[data-eigen-op].is-active')
            || section.querySelector('[data-eigen-op]');
        if (initialBtn && initialBtn.dataset.eigenOp) {
            currentOp = initialBtn.dataset.eigenOp;
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

                ML.emit('eigen:reset', {});
            });
        }

        // --- Публичный API
        ML.eigen = ML.eigen || {};
        ML.eigen.mount = mount;
        ML.eigen.run = run;
        ML.eigen.runOperation = runOperation;
        ML.eigen.updateRunButtonState = updateRunButtonState;
        ML.eigen.setOperation = setOperation;
        ML.eigen.getOperation = getOperation;
        ML.eigen.list = listOperations;
        ML.eigen.cleanupMissingIcons = cleanupMissingIcons;

        ML.emit('eigen:ready', {});
        return true;
    }

    // =========================================================================
    // 10. ИНИЦИАЛИЗАЦИЯ
    // =========================================================================

    let _initialized = false;

    function init() {
        if (_initialized) return;
        _initialized = true;

        // FIX: чистим DOM сразу после загрузки
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () {
                cleanupMissingIcons(document);
            });
        } else {
            cleanupMissingIcons(document);
        }

        if (document.querySelector('[data-eigen-run]')) {
            mount(document);
        }

        initExamples();

        ML.emit('eigen:module-ready', {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();