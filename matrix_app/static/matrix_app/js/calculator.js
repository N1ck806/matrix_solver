/* =============================================================================
   MatrixLab — calculator.js
   =============================================================================
   Универсальный движок операций над матрицами.

   Покрывает:
       • calculator.html      — одна матрица, одна операция
       • operations.html      — N матриц (add, multiply, chain, compare, …)
       • systems.html         — СЛАУ (обрабатывается systems.js)
       • properties.html      — анализ свойств
       • decompositions.html  — LU / QR / Cholesky / diagonalize
       • eigen.html           — собственные значения / векторы / char_poly

   Публичный API:
       ML.calculator.mount(scope, mode)
       ML.calculator.run(op, ctx)
       ML.calculator.getSelectedOperation(scope)
       ML.calculator.updateRunButtonState(scope)
       ML.calculator.opInfo(op)
       ML.calculator.listOperations()
       ML.calculator.registerOperation(op, cfg)
       ML.operations.mount(scope)
       ML.operations.getOperation()
       ML.operations.updateRunButtonState()
       ML.operations.updateMatrixCards()
       ML.operations.autoFit()

   Зависимости: main.js, matrix.js, steps.js.
   ============================================================================= */
(function () {
    'use strict';

    const ML = window.MatrixLab;
    if (!ML) {
        console.error('[calculator.js] window.MatrixLab не найден — модуль не запущен.');
        return;
    }

    // =========================================================================
    // 1. РЕЕСТР ОПЕРАЦИЙ
    // =========================================================================
    //
    // needs: 1 | 2 | 'n'
    // autoFit: 'square' | 'same' | 'chain'
    // payloadMode:
    //   'single'      — payload.matrix
    //   'pair'        — payload.matrix_a + payload.matrix_b
    //   'pair_scalar' — payload.matrix_a + payload.scalar
    //   'pair_power'  — payload.matrix + payload.power
    //   'chain'       — payload.operation + payload.matrices
    // =========================================================================

    const DEFAULT_OPS = {
        // --- Основные (single) ---
        determinant: {
            label: 'Определитель',
            url: '/api/matrix/determinant/',
            kind: 'scalar',
            needs: 1,
            params: ['method'],
            square: true,
            autoSquare: true,
            category: 'basic',
            payloadMode: 'single'
        },
        rank: {
            label: 'Ранг',
            url: '/api/matrix/rank/',
            kind: 'scalar',
            needs: 1,
            category: 'basic',
            payloadMode: 'single'
        },
        inverse: {
            label: 'Обратная матрица',
            url: '/api/matrix/inverse/',
            kind: 'matrix',
            needs: 1,
            params: ['method'],
            square: true,
            autoSquare: true,
            category: 'basic',
            verify: 'inverse',
            payloadMode: 'single'
        },
        transpose: {
            label: 'Транспонирование',
            url: '/api/matrix/transpose/',
            kind: 'matrix',
            needs: 1,
            category: 'basic',
            payloadMode: 'single'
        },
        trace: {
            label: 'След',
            url: '/api/matrix/trace/',
            kind: 'scalar',
            needs: 1,
            square: true,
            autoSquare: true,
            category: 'basic',
            payloadMode: 'single'
        },
        rref: {
            label: 'RREF',
            url: '/api/matrix/rref/',
            kind: 'matrix',
            needs: 1,
            category: 'basic',
            payloadMode: 'single'
        },
        echelon: {
            label: 'Ступенчатая форма',
            url: '/api/matrix/echelon/',
            kind: 'matrix',
            needs: 1,
            category: 'basic',
            payloadMode: 'single'
        },
        properties: {
            label: 'Свойства матрицы',
            url: '/api/matrix/properties/',
            kind: 'properties',
            needs: 1,
            category: 'basic',
            payloadMode: 'single'
        },

        // --- Спектр ---
        eigenvalues: {
            label: 'Собственные значения',
            url: '/api/matrix/eigenvalues/',
            kind: 'eigenvalues',
            needs: 1,
            square: true,
            autoSquare: true,
            category: 'spectrum',
            payloadMode: 'single'
        },
        eigenvectors: {
            label: 'Собственные векторы',
            url: '/api/matrix/eigenvectors/',
            kind: 'text',
            needs: 1,
            square: true,
            autoSquare: true,
            category: 'spectrum',
            payloadMode: 'single'
        },
        char_poly: {
            label: 'Характеристический многочлен',
            url: '/api/matrix/char-poly/',
            kind: 'text',
            needs: 1,
            square: true,
            autoSquare: true,
            category: 'spectrum',
            payloadMode: 'single'
        },

        // --- Разложения ---
        lu: {
            label: 'LU-разложение',
            url: '/api/matrix/lu/',
            kind: 'decomposition',
            needs: 1,
            square: true,
            autoSquare: true,
            category: 'decomp',
            verify: 'lu',
            payloadMode: 'single'
        },
        qr: {
            label: 'QR-разложение',
            url: '/api/matrix/qr/',
            kind: 'decomposition',
            needs: 1,
            category: 'decomp',
            verify: 'qr',
            payloadMode: 'single'
        },
        cholesky: {
            label: 'Разложение Холецкого',
            url: '/api/matrix/cholesky/',
            kind: 'decomposition',
            needs: 1,
            square: true,
            autoSquare: true,
            category: 'decomp',
            verify: 'cholesky',
            payloadMode: 'single'
        },
        diagonalize: {
            label: 'Диагонализация',
            url: '/api/matrix/diagonalize/',
            kind: 'decomposition',
            needs: 1,
            square: true,
            autoSquare: true,
            category: 'decomp',
            payloadMode: 'single'
        },

        // --- Многоматричные ---
        add: {
            label: 'Сложение',
            url: '/api/matrix/chain/',
            kind: 'matrix',
            needs: 'n',
            category: 'basic',
            autoFit: 'same',
            payloadMode: 'chain'
        },
        multiply: {
            label: 'Умножение',
            url: '/api/matrix/chain/',
            kind: 'matrix',
            needs: 'n',
            category: 'basic',
            autoFit: 'chain',
            payloadMode: 'chain'
        },
        subtract: {
            label: 'Вычитание',
            url: '/api/matrix/subtract/',
            kind: 'matrix',
            needs: 2,
            category: 'basic',
            autoFit: 'same',
            payloadMode: 'pair'
        },
        compare: {
            label: 'Сравнение',
            url: '/api/matrix/compare/',
            kind: 'compare',
            needs: 2,
            category: 'basic',
            autoFit: 'same',
            payloadMode: 'pair'
        },
        scalar_multiply: {
            label: 'Умножение на скаляр',
            url: '/api/matrix/scalar/',
            kind: 'matrix',
            needs: 1,
            params: ['scalar'],
            category: 'basic',
            payloadMode: 'pair_scalar'
        },
        power: {
            label: 'Возведение в степень',
            url: '/api/matrix/power/',
            kind: 'matrix',
            needs: 1,
            params: ['power'],
            square: true,
            autoSquare: true,
            category: 'basic',
            autoFit: 'square',
            payloadMode: 'pair_power'
        },

        // --- СЛАУ ---
        solve_system: {
            label: 'Решение СЛАУ',
            url: '/api/system/solve/',
            kind: 'system',
            needs: 1,
            params: ['method'],
            category: 'system',
            usesVector: true
        }
    };

    const OPS = Object.assign({}, DEFAULT_OPS);

    function opInfo(op) {
        return OPS[op] || {
            label: op,
            kind: 'text',
            needs: 1,
            category: 'basic',
            payloadMode: 'single'
        };
    }

    // =========================================================================
    // 2. УТИЛИТЫ
    // =========================================================================

    function isArr(v) { return Array.isArray(v); }

    function isEmptyMatrix(m) {
        return ML.validators.isEmptyMatrix(m);
    }

    function isEmptyVector(v) {
        return ML.validators.isEmptyVector(v);
    }

    function findOne(scope, selector) {
        return (scope || document).querySelector(selector);
    }

    function findAll(scope, selector) {
        return ML.$$(selector, scope);
    }

    function getSelectedOperation(scope) {
        const s = scope || document;
        const radio = s.querySelector('[data-op-select]:checked');
        return radio ? radio.value : null;
    }

    function getShowSteps(scope) {
        const el = (scope || document).querySelector(
            '[data-show-steps], [data-ops-show-steps], [data-system-steps]'
        );
        return el ? !!el.checked : true;
    }

    /**
     * ЖИВОЙ список матриц — вызываем каждый раз, когда он нужен.
     * НЕ хранить в замыкании!
     */
    function liveMatrices() {
        return ML.getAllMatrices();
    }

    function closeModalIfAny(btn) {
        const modal = btn && btn.closest('.modal');
        if (modal && ML.modal) {
            setTimeout(function () {
                ML.modal.close('#' + modal.id);
            }, 200);
        }
    }

    function scrollToResult(resultBlock) {
        if (!resultBlock || resultBlock.hidden) return;
        try {
            const top = resultBlock.getBoundingClientRect().top
                + window.pageYOffset - 80;
            window.scrollTo({ top: top, behavior: 'smooth' });
        } catch (e) { /* noop */ }
    }

    // =========================================================================
    // 3. РЕЖИМ
    // =========================================================================

    function detectMode(root) {
        const scope = root || document;
        const hasSingle = !!findOne(scope, '[data-calc-run]');
        const hasMulti = !!findOne(scope, '[data-ops-run]');
        const hasSystem = !!findOne(scope, '[data-system-run]');

        if (hasSingle && !hasMulti) return 'single';
        if (hasMulti && !hasSingle) return 'multi';
        if (hasSingle && hasMulti) return 'both';
        if (hasSystem) return 'system';
        return null;
    }

    // =========================================================================
    // 4. ЗАПУСК ОПЕРАЦИИ
    // =========================================================================

    async function runOperation(op, ctx) {
        ctx = ctx || {};
        const scope = ctx.root || document;
        const info = opInfo(op);
        const resultBlock = ctx.resultBlock
            || findOne(scope, '[data-result-block]');
        const placeholder = ctx.placeholder;

        if (!info.url) {
            ML.toast.error(
                ML.i18n.t('common.error', 'Ошибка'),
                ML.i18n.t('calculator.opNotSupported',
                    'Операция не поддерживается.') + ' «' + info.label + '»'
            );
            return null;
        }

        // --- Payload
        let payload;
        try {
            payload = buildPayload(op, ctx);
        } catch (err) {
            ML.toast.warning(
                ML.i18n.t('calculator.cannotRun', 'Нельзя выполнить'),
                err.message
            );
            return null;
        }
        if (!payload) return null;

        // --- Валидация
        const validation = ML.validateMatrixFor(op, {
            a: ctx.matrices && ctx.matrices[0],
            b: ctx.matrices && ctx.matrices[1]
        });
        if (!validation.ok) {
            ML.toast.warning(validation.message, validation.hint || '');
            return null;
        }

        const snapshot = JSON.parse(JSON.stringify(payload));

        ML.loader.show(ML.i18n.t('common.computing', 'Вычисляем…'));
        if (resultBlock && ML.resultBlock) {
            ML.resultBlock.renderSkeleton(resultBlock);
        }

        try {
            const response = await ML.api.post(info.url, payload);

            let verification = { ok: true };
            if (ML.verifyResult) {
                verification = ML.verifyResult(op, snapshot, response);
                if (!verification.ok) {
                    ML.toast.warning(
                        ML.i18n.t('calculator.verifyFailed',
                            'Проверка не пройдена'),
                        verification.message || ''
                    );
                }
            }

            if (resultBlock && ML.resultBlock) {
                ML.resultBlock.render(resultBlock, response, {
                    taskText: ML.i18n.t('calculator.taskPrefix',
                        'Операция') + ': ' + info.label + '.',
                    verified: verification.ok
                });
            }

            ML.toast.success(
                ML.i18n.t('common.ok', 'Готово'),
                info.label + ' ' + ML.i18n.t('calculator.done', 'выполнена.')
            );
            if (placeholder) placeholder.hidden = true;
            scrollToResult(resultBlock);

            ML.history.push(buildHistoryEntry(op, snapshot, response, ctx));

            ML.emit('operation:done', {
                op: op,
                payload: snapshot,
                result: response
            });

            return response;
        } catch (err) {
            if (resultBlock && ML.resultBlock) {
                ML.resultBlock.renderError(resultBlock, err.message, err.code);
            }
            ML.toast.error(
                ML.i18n.t('calculator.failed', 'Не удалось выполнить'),
                err.message || ''
            );
            ML.emit('operation:error', { op: op, error: err });
            return null;
        } finally {
            ML.loader.hide();
        }
    }

    /**
     * Собирает payload в зависимости от payloadMode.
     * Ключи соответствуют тому, что читает matrix_app/api.py.
     */
    function buildPayload(op, ctx) {
        const info = opInfo(op);
        const scope = ctx.root || document;
        const params = info.params || [];

        const payload = { show_steps: getShowSteps(scope) };

        // --- Общие параметры
        if (params.indexOf('precision') !== -1) {
            const el = findOne(scope, '[data-precision]');
            if (el && el.value) {
                payload.precision = parseInt(el.value, 10) || 6;
            }
        }
        if (params.indexOf('format') !== -1) {
            const el = findOne(scope, '[data-number-format]');
            if (el && el.value) payload.format = el.value;
        }
        if (params.indexOf('method') !== -1) {
            const el = findOne(scope, '[data-method-select]')
                || findOne(scope, '[data-system-method]:checked');
            if (el) payload.method = el.value;
        }

        const matrices = ctx.matrices || [];
        const vector = ctx.vector;

        // =====================================================================
        // СЛАУ
        // =====================================================================
        if (info.usesVector) {
            if (!matrices[0]) {
                throw new Error(ML.i18n.t('calculator.fillA',
                    'Заполните матрицу A.'));
            }
            if (!vector
                || isEmptyVector(vector.read ? vector.read() : vector)) {
                throw new Error(ML.i18n.t('calculator.fillB',
                    'Заполните вектор b.'));
            }
            payload.matrix_a = matrices[0].read();
            payload.vector_b = vector.read ? vector.read() : vector;
            return payload;
        }

        // =====================================================================
        // В зависимости от payloadMode
        // =====================================================================

        switch (info.payloadMode) {

            // --- Цепочка N матриц: /api/matrix/chain/ ---
            case 'chain': {
                const filled = [];
                matrices.forEach(function (mi) {
                    const data = mi.read();
                    if (!isEmptyMatrix(data)) filled.push(data);
                });
                if (filled.length < 2) {
                    throw new Error(ML.i18n.t('calculator.needTwo',
                        'Нужно минимум 2 заполненные матрицы.'));
                }
                // api.py: payload.operation = 'add' | 'multiply';
                //         payload.matrices  = [ [...], [...], ... ]
                if (op === 'add' || op === 'multiply') {
                    payload.operation = op;
                } else {
                    payload.operation = op;
                }
                payload.matrices = filled;
                return payload;
            }

            // --- Пара A и B: /api/matrix/subtract/ или /api/matrix/compare/ ---
            case 'pair': {
                if (!matrices[0] || !matrices[1]) {
                    throw new Error(ML.i18n.t('calculator.needAB',
                        'Нужны матрицы A и B.'));
                }
                const a = matrices[0].read();
                const b = matrices[1].read();
                if (isEmptyMatrix(a)) {
                    throw new Error(ML.i18n.t('calculator.fillA',
                        'Заполните матрицу A.'));
                }
                if (isEmptyMatrix(b)) {
                    throw new Error(ML.i18n.t('calculator.fillB',
                        'Заполните матрицу B.'));
                }
                // api.py matrix_subtract / matrix_compare читают
                // matrix_a и matrix_b
                payload.matrix_a = a;
                payload.matrix_b = b;
                return payload;
            }

            // --- A + скаляр: /api/matrix/scalar/ ---
            case 'pair_scalar': {
                if (!matrices[0]) {
                    throw new Error(ML.i18n.t('calculator.fillA',
                        'Заполните матрицу A.'));
                }
                const el = findOne(scope, '[data-scalar-input]');
                const s = el ? String(el.value).trim() : '';
                if (!s) {
                    throw new Error(ML.i18n.t('calculator.enterScalar',
                        'Введите значение скаляра k.'));
                }
                const a = matrices[0].read();
                if (isEmptyMatrix(a)) {
                    throw new Error(ML.i18n.t('calculator.fillA',
                        'Заполните матрицу A.'));
                }
                // api.py matrix_scalar читает matrix_a и scalar
                payload.matrix_a = a;
                payload.scalar = s;
                return payload;
            }

            // --- A^n: /api/matrix/power/ ---
            case 'pair_power': {
                if (!matrices[0]) {
                    throw new Error(ML.i18n.t('calculator.fillA',
                        'Заполните матрицу A.'));
                }
                const el = findOne(scope, '[data-power-input]');
                const p = parseInt(el ? el.value : '', 10);
                if (isNaN(p)) {
                    throw new Error(ML.i18n.t('calculator.enterPower',
                        'Введите целое число в поле «Степень».'));
                }
                const a = matrices[0].read();
                if (isEmptyMatrix(a)) {
                    throw new Error(ML.i18n.t('calculator.fillA',
                        'Заполните матрицу A.'));
                }
                // api.py matrix_power читает matrix и power
                payload.matrix = a;
                payload.power = p;
                return payload;
            }

            // --- Одна матрица: /api/matrix/<op>/ ---
            case 'single':
            default: {
                if (!matrices[0]) {
                    throw new Error(ML.i18n.t('calculator.noMatrix',
                        'Матрица не найдена.'));
                }
                const m = matrices[0].read();
                if (isEmptyMatrix(m)) {
                    throw new Error(ML.i18n.t('calculator.fillMatrix',
                        'Заполните матрицу.'));
                }
                // api.py matrix_* (детерминант, ранг, обратная, rref, …)
                // читают поле "matrix"
                payload.matrix = m;
                return payload;
            }
        }
    }

    function buildHistoryEntry(op, payload, response, ctx) {
        const info = opInfo(op);
        const entry = {
            op: op,
            label: info.label,
            result: response
        };
        if (payload.matrix)     entry.matrix = payload.matrix;
        if (payload.matrix_a)   entry.matrix_a = payload.matrix_a;
        if (payload.matrix_b)   entry.matrix_b = payload.matrix_b;
        if (payload.matrices)   entry.matrices = payload.matrices;
        if (payload.vector_b)   entry.vector_b = payload.vector_b;

        if (ctx.matrices && ctx.matrices[0] && ctx.matrices[0].rows) {
            entry.size = ctx.matrices[0].rows + '×' + ctx.matrices[0].cols;
        }
        return entry;
    }

    // =========================================================================
    // 5. АВТОПОДБОР РАЗМЕРОВ
    // =========================================================================

    function applyAutoSize(op, mi) {
        const info = opInfo(op);
        if (info.autoSquare && mi.rows !== mi.cols) {
            const n = Math.max(mi.rows, mi.cols);
            mi.setSize(n, n, { preserve: true });
            ML.toast.info(
                ML.i18n.t('calculator.sizeAdjusted', 'Размер подстроен'),
                ML.i18n.t('calculator.matrix', 'Матрица') + ' '
                    + n + ' × ' + n
            );
        }
    }

    function applyAutoFit(op, items) {
        if (!items || !items.length) return;
        const info = opInfo(op);
        const rule = info.autoFit;

        if (rule === 'square') {
            const a = items[0];
            if (a && a.mi.rows !== a.mi.cols) a.mi.makeSquare();
            return;
        }

        if (rule === 'same') {
            const a = items[0];
            if (!a) return;
            items.forEach(function (item, i) {
                if (i === 0) return;
                if (item.mi.rows !== a.mi.rows || item.mi.cols !== a.mi.cols) {
                    item.mi.setSize(a.mi.rows, a.mi.cols, { preserve: true });
                }
            });
            return;
        }

        if (rule === 'chain') {
            for (let i = 1; i < items.length; i++) {
                const prev = items[i - 1].mi;
                const cur = items[i].mi;
                if (cur.rows !== prev.cols) {
                    cur.setSize(prev.cols, cur.cols, { preserve: true });
                }
            }
        }
    }

    // =========================================================================
    // 6. МОНТИРОВАНИЕ
    // =========================================================================

    function mount(root, mode, opts) {
        opts = opts || {};
        root = root || document;

        const runSelector = mode === 'multi'
            ? '[data-ops-run]'
            : '[data-calc-run]';
        const runBtn = findOne(root, runSelector);
        if (!runBtn) return false;

        const section = runBtn.closest('section') || document;

        const resultBlock = findOne(section, '[data-result-block]');
        const resetBtn = findOne(
            section,
            mode === 'multi' ? '[data-ops-reset]' : '[data-calc-reset]'
        );
        const placeholder = findOne(
            section,
            mode === 'multi'
                ? '[data-ops-placeholder]'
                : '[data-calc-placeholder]'
        );

        // --- Проверка, что матрицы вообще есть
        const initialMatrices = liveMatrices();
        if (!initialMatrices.length) {
            console.warn('[calculator] Матрицы не найдены.');
            return false;
        }

        const firstMatrix = initialMatrices[0].mi;

        // --- Состояние
        let currentOp = getSelectedOperation(section)
            || (mode === 'multi' ? 'add' : 'determinant');

        // =====================================================================
        // Группы операций (calculator.html)
        // =====================================================================
        function bindOpGroups() {
            findAll(section, '[data-op-group]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    findAll(section, '[data-op-group]').forEach(function (b) {
                        const active = b === btn;
                        b.classList.toggle('is-active', active);
                        b.setAttribute('aria-selected', String(active));
                    });
                    findAll(section, '[data-op-list]').forEach(function (list) {
                        list.hidden = (list.dataset.opList
                            !== btn.dataset.opGroup);
                    });
                    const op = getSelectedOperation(section);
                    if (op) onOperationChange(op);
                });
            });
        }

        // =====================================================================
        // Параметры
        // =====================================================================
        function updateParams(info) {
            const extra = findOne(section, '[data-op-extra]');
            if (!extra) return;
            const params = info.params || [];

            ['method', 'power', 'scalar', 'precision'].forEach(function (k) {
                const elSingle = findOne(section, '[data-param="' + k + '"]');
                const elMulti = findOne(section, '[data-ops-param="' + k + '"]');
                const show = params.indexOf(k) !== -1;
                if (elSingle) elSingle.hidden = !show;
                if (elMulti) elMulti.hidden = !show;
            });

            extra.hidden = params.length === 0;
        }

        // =====================================================================
        // Карточки матриц
        // =====================================================================
        function updateMatrixCards() {
            if (mode !== 'multi') return;
            const info = opInfo(currentOp);
            const needed = info.needs;
            const items = liveMatrices();

            items.forEach(function (item, index) {
                const show = (needed === 'n') ? true : index < needed;
                item.card.style.display = show ? '' : 'none';
            });

            const addBtn = findOne(section, '[data-add-matrix]');
            if (addBtn) addBtn.hidden = (needed !== 'n');
        }

        // =====================================================================
        // Кнопка «Вычислить»
        // =====================================================================
        function updateRunButtonState() {
            const info = opInfo(currentOp);
            if (mode === 'multi') {
                updateRunButtonStateMulti(info);
            } else {
                updateRunButtonStateSingle(info);
            }
        }

        function updateRunButtonStateSingle(info) {
            const mi = firstMatrix;
            const matrix = mi.read();
            const empty = isEmptyMatrix(matrix);
            const notSquare = info.square && mi.rows !== mi.cols;
            const invalid = mi.hasInvalid && mi.hasInvalid();

            runBtn.disabled = empty || notSquare || invalid;

            if (invalid) {
                runBtn.title = ML.i18n.t('calculator.invalidValues',
                    'В матрице есть некорректные значения');
            } else if (empty) {
                runBtn.title = ML.i18n.t('calculator.fillMatrix',
                    'Заполните матрицу');
            } else if (notSquare) {
                runBtn.title = ML.i18n.t('calculator.needSquareFor',
                    'Нужна квадратная матрица для') + ' «'
                    + info.label + '»';
            } else {
                runBtn.title = ML.i18n.t('calculator.run',
                    'Выполнить операцию');
            }
            runBtn.setAttribute('aria-disabled', String(runBtn.disabled));
        }

        function updateRunButtonStateMulti(info) {
            const needed = info.needs;
            const items = liveMatrices();

            if (needed === 'n') {
                const filled = items.filter(function (item) {
                    return item.card.style.display !== 'none'
                        && !isEmptyMatrix(item.mi.read());
                });
                runBtn.disabled = filled.length < 2;
                runBtn.title = runBtn.disabled
                    ? ML.i18n.t('calculator.needTwoMin',
                        'Нужно минимум 2 заполненные матрицы')
                    : ML.i18n.t('calculator.run', 'Выполнить');
                runBtn.setAttribute('aria-disabled', String(runBtn.disabled));
                return;
            }

            for (let i = 0; i < needed; i++) {
                const item = items[i];
                if (!item || isEmptyMatrix(item.mi.read())) {
                    runBtn.disabled = true;
                    runBtn.title = ML.i18n.t('calculator.fill',
                        'Заполните матрицу') + ' '
                        + (item ? item.letter.toUpperCase() : '');
                    runBtn.setAttribute('aria-disabled', 'true');
                    return;
                }
                if (item.mi.hasInvalid && item.mi.hasInvalid()) {
                    runBtn.disabled = true;
                    runBtn.title = ML.i18n.t('calculator.invalidIn',
                        'Некорректные значения в') + ' '
                        + item.letter.toUpperCase();
                    runBtn.setAttribute('aria-disabled', 'true');
                    return;
                }
            }
            runBtn.disabled = false;
            runBtn.title = ML.i18n.t('calculator.run', 'Выполнить');
            runBtn.setAttribute('aria-disabled', 'false');
        }

        // =====================================================================
        // Смена операции
        // =====================================================================
        function onOperationChange(op) {
            currentOp = op || (mode === 'multi' ? 'add' : 'determinant');
            const info = opInfo(currentOp);

            if (mode === 'single') {
                applyAutoSize(currentOp, firstMatrix);
            } else {
                applyAutoFit(currentOp, liveMatrices());
            }
            updateParams(info);
            updateMatrixCards();
            updateRunButtonState();

            ML.emit('calculator:operation-change', { op: currentOp });
        }

        // =====================================================================
        // Биндинг
        // =====================================================================
        bindOpGroups();

        findAll(section, '[data-op-select]').forEach(function (radio) {
            radio.addEventListener('change', function () {
                onOperationChange(radio.value);
            });
        });

        const updateStateDebounced = ML.debounce(updateRunButtonState, 80);

        // Подписки на изменения (с живым пересчётом)
        function bindMatrixInputs() {
            liveMatrices().forEach(function (item) {
                // убираем предыдущую привязку, чтобы не дублировать
                if (item.mi.el.dataset.stateBound === '1') return;
                item.mi.el.dataset.stateBound = '1';
                item.mi.el.addEventListener('matrix:change', updateStateDebounced);
            });
        }
        bindMatrixInputs();

        ML.on('matrix:change', updateStateDebounced);
        ML.on('matrix:added', function () {
            bindMatrixInputs();
            updateMatrixCards();
            updateStateDebounced();
        });
        ML.on('matrix:removed', function () {
            updateMatrixCards();
            updateStateDebounced();
        });

        // Начальное состояние
        onOperationChange(currentOp);

        // =====================================================================
        // Запуск
        // =====================================================================
        runBtn.addEventListener('click', async function () {
            const info = opInfo(currentOp);

            if (mode === 'single') {
                if (firstMatrix.hasInvalid && firstMatrix.hasInvalid()) {
                    ML.toast.warning(
                        ML.i18n.t('calculator.invalidInput',
                            'Некорректный ввод'),
                        ML.i18n.t('calculator.fixCells',
                            'Исправьте подсвеченные ячейки.')
                    );
                    return;
                }
                if (info.square && firstMatrix.rows !== firstMatrix.cols) {
                    firstMatrix.makeSquare();
                    updateRunButtonState();
                    return;
                }
            }

            // --- Собираем матрицы из ЖИВОГО списка
            const items = liveMatrices();
            let matrices;
            if (mode === 'multi') {
                const needed = info.needs;
                if (needed === 'n') {
                    matrices = items
                        .filter(function (item) {
                            return item.card.style.display !== 'none'
                                && !isEmptyMatrix(item.mi.read());
                        })
                        .map(function (item) { return item.mi; });
                } else {
                    matrices = items
                        .slice(0, needed)
                        .map(function (item) { return item.mi; });
                }
                if (!matrices.length) {
                    ML.toast.warning(
                        ML.i18n.t('calculator.noMatrices', 'Нет матриц'),
                        ML.i18n.t('calculator.fillAtLeastOne',
                            'Заполните хотя бы одну матрицу.')
                    );
                    return;
                }
            } else {
                matrices = [firstMatrix];
            }

            await runOperation(currentOp, {
                root: section,
                resultBlock: resultBlock,
                placeholder: placeholder,
                matrices: matrices
            });
        });

        // =====================================================================
        // Сброс
        // =====================================================================
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                const items = liveMatrices();
                if (mode === 'multi') {
                    items.forEach(function (item) { item.mi.clear(); });
                } else {
                    firstMatrix.clear();
                }

                if (resultBlock && ML.resultBlock) {
                    ML.resultBlock.clear(resultBlock);
                } else if (resultBlock) {
                    resultBlock.hidden = true;
                }
                if (placeholder) placeholder.hidden = false;
                updateRunButtonState();

                ML.emit('calculator:reset', { mode: mode });
            });
        }

        // =====================================================================
        // Публичный API
        // =====================================================================
        if (mode === 'single') {
            ML.calculator.mount = function (r) { return mount(r, 'single'); };
            ML.calculator.run = runOperation;
            ML.calculator.getSelectedOperation = getSelectedOperation;
            ML.calculator.updateRunButtonState = updateRunButtonState;
            ML.emit('calculator:ready', { mode: 'single' });
        } else {
            ML.operations.mount = function (r) { return mount(r, 'multi'); };
            ML.operations.getOperation = function () { return currentOp; };
            ML.operations.updateRunButtonState = updateRunButtonState;
            ML.operations.updateMatrixCards = updateMatrixCards;
            ML.operations.autoFit = function () {
                applyAutoFit(currentOp, liveMatrices());
            };
            ML.emit('operations:ready', { mode: 'multi' });
        }

        return true;
    }

    // =========================================================================
    // 7. ПРИМЕРЫ
    // =========================================================================

    function initExamples() {
        document.addEventListener('click', async function (e) {
            const singleBtn = e.target.closest('[data-load-example]');
            if (singleBtn) {
                const slug = singleBtn.dataset.loadExample;
                if (slug) await loadExample(singleBtn, slug);
                return;
            }
            const pairBtn = e.target.closest('[data-load-pair]');
            if (pairBtn) {
                const pair = pairBtn.dataset.loadPair;
                if (pair) await loadPair(pairBtn, pair);
            }
        });
    }

    async function loadExample(btn, slug) {
        ML.loader.show(ML.i18n.t('calculator.loadingExample',
            'Загружаем пример…'));
        try {
            const resp = await ML.api.post('/api/example/' + slug + '/', {});
            const data = (resp && resp.result) || {};
            const matrix = data.matrix;

            if (matrix && isArr(matrix)) {
                const mi = ML.getFirstMatrix();
                if (mi) {
                    mi.setSize(matrix.length, matrix[0].length,
                        { preserve: false });
                    mi.write(matrix);
                }
            }

            const vecEl = document.querySelector('[data-vector-input]');
            if (vecEl && data.vector) {
                const vec = ML.vectorInputs[vecEl.id];
                if (vec) vec.write(data.vector);
            }

            closeModalIfAny(btn);
            ML.toast.success(
                ML.i18n.t('calculator.exampleLoaded', 'Пример загружен'),
                data.title || slug
            );
        } catch (err) {
            ML.toast.error(
                ML.i18n.t('calculator.exampleFailed',
                    'Не удалось загрузить'),
                err.message
            );
        } finally {
            ML.loader.hide();
        }
    }

    async function loadPair(btn, pair) {
        const parts = String(pair).split(',');
        const slugA = parts[0];
        const slugB = parts[1] || parts[0];

        ML.loader.show(ML.i18n.t('calculator.loadingPair',
            'Загружаем пару матриц…'));
        try {
            const results = await Promise.all([
                ML.api.post('/api/example/' + slugA + '/', {}),
                ML.api.post('/api/example/' + slugB + '/', {})
            ]);
            const mA = results[0].result && results[0].result.matrix;
            const mB = results[1].result && results[1].result.matrix;

            const all = liveMatrices();
            const a = all.find(function (x) { return x.letter === 'a'; });
            const b = all.find(function (x) { return x.letter === 'b'; });

            if (a && mA) {
                a.mi.setSize(mA.length, mA[0].length, { preserve: false });
                a.mi.write(mA);
            }
            if (b && mB) {
                b.mi.setSize(mB.length, mB[0].length, { preserve: false });
                b.mi.write(mB);
            }
            closeModalIfAny(btn);
            ML.toast.success(
                ML.i18n.t('calculator.matricesLoaded',
                    'Матрицы загружены'),
                ML.i18n.t('calculator.aAndBFilled', 'A и B заполнены.')
            );
        } catch (err) {
            ML.toast.error(
                ML.i18n.t('calculator.exampleFailed',
                    'Не удалось загрузить'),
                err.message
            );
        } finally {
            ML.loader.hide();
        }
    }

    // =========================================================================
    // 8. ГЕНЕРАТОР СЛУЧАЙНЫХ МАТРИЦ
    // =========================================================================

    function initRandomGenerator() {
        const openBtn = document.querySelector('[data-random-open]');
        const modal = document.querySelector('#random-modal');
        if (!openBtn || !modal) return;

        openBtn.addEventListener('click', function () {
            ML.modal.open('#random-modal');
        });

        const genBtn = modal.querySelector('[data-random-generate]');
        if (!genBtn) return;

        genBtn.addEventListener('click', async function () {
            const rowsInp = modal.querySelector('[data-random-rows]');
            const colsInp = modal.querySelector('[data-random-cols]');
            const minInp = modal.querySelector('[data-random-min]');
            const maxInp = modal.querySelector('[data-random-max]');
            const kindInp = modal.querySelector('[data-random-kind]');
            const fracsInp = modal.querySelector('[data-random-fractions]');

            const rows = parseInt(rowsInp ? rowsInp.value : '3', 10) || 3;
            const cols = parseInt(colsInp ? colsInp.value : '3', 10) || 3;
            const minValue = parseInt(minInp ? minInp.value : '-9', 10);
            const maxValue = parseInt(maxInp ? maxInp.value : '9', 10);
            const kind = kindInp ? kindInp.value : 'random';
            const allowFractions = fracsInp ? fracsInp.checked : false;

            ML.loader.show(ML.i18n.t('calculator.generating',
                'Генерируем…'));
            try {
                const resp = await ML.api.post('/api/random-matrix/', {
                    rows: rows,
                    cols: cols,
                    min_value: isNaN(minValue) ? -9 : minValue,
                    max_value: isNaN(maxValue) ? 9 : maxValue,
                    kind: kind,
                    allow_fractions: allowFractions
                });
                const matrix = resp.result;

                if (matrix && isArr(matrix)) {
                    const mi = ML.getFirstMatrix();
                    if (mi) {
                        mi.setSize(matrix.length, matrix[0].length,
                            { preserve: false });
                        mi.write(matrix);
                    }
                }
                ML.modal.close('#random-modal');
                ML.toast.success(
                    ML.i18n.t('calculator.matrixGenerated',
                        'Матрица сгенерирована'),
                    matrix ? (matrix.length + '×' + matrix[0].length) : ''
                );
            } catch (err) {
                ML.toast.error(
                    ML.i18n.t('calculator.generateFailed',
                        'Не удалось сгенерировать'),
                    err.message
                );
            } finally {
                ML.loader.hide();
            }
        });
    }

    // =========================================================================
    // 9. БЫСТРЫЙ / РАСШИРЕННЫЙ РЕЖИМ
    // =========================================================================

    function initModeToggle() {
        const toggle = document.querySelector('[data-calc-mode]');
        if (!toggle) return;

        function applyMode() {
            const mode = toggle.checked ? 'advanced' : 'quick';
            document.body.dataset.calcMode = mode;
            ML.prefs.set('calcMode', mode);
        }
        toggle.addEventListener('change', applyMode);

        const saved = ML.prefs.get('calcMode');
        if (saved === 'advanced') toggle.checked = true;
        applyMode();
    }

    // =========================================================================
    // 10. ПУБЛИЧНЫЙ РЕЕСТР ОПЕРАЦИЙ
    // =========================================================================

    ML.calculator = ML.calculator || {};
    ML.operations = ML.operations || {};

    ML.calculator.registerOperation = function (op, cfg) {
        if (!op || !cfg) return;
        OPS[op] = Object.assign({}, OPS[op] || {}, cfg);
        ML.emit('calculator:register', { op: op, cfg: cfg });
    };

    ML.calculator.listOperations = function () {
        return Object.keys(OPS).map(function (k) {
            return { op: k, info: Object.assign({}, OPS[k]) };
        });
    };

    ML.calculator.opInfo = opInfo;

    // =========================================================================
    // 11. ИНИЦИАЛИЗАЦИЯ
    // =========================================================================

    let _initialized = false;

    function init() {
        if (_initialized) return;
        _initialized = true;

        const mode = detectMode(document);
        if (mode === 'single') {
            mount(document, 'single');
        } else if (mode === 'multi') {
            mount(document, 'multi');
        } else if (mode === 'both') {
            mount(document, 'single');
            mount(document, 'multi');
        }

        initExamples();
        initRandomGenerator();
        initModeToggle();

        ML.emit('calculator:module-ready', { mode: mode });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();