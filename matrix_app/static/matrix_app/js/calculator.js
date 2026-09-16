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
       • modules.html         — пресеты по направлениям + вложенное оглавление

   Публичный API:
       ML.calculator.mount(scope, mode)
       ML.calculator.run(op, ctx)
       ML.calculator.runOperation(op, ctx)
       ML.calculator.getSelectedOperation(scope)
       ML.calculator.updateRunButtonState(scope)
       ML.calculator.opInfo(op)
       ML.calculator.listOperations()
       ML.calculator.registerOperation(op, cfg)
       ML.calculator.PRESETS
       ML.calculator.getPresets()

       ML.operations.mount(scope)
       ML.operations.getOperation()
       ML.operations.updateRunButtonState()
       ML.operations.updateMatrixCards()
       ML.operations.autoFit()

       ML.modules.setPreset(code)
       ML.modules.getPreset()
       ML.modules.run()

   Зависимости: main.js, matrix.js, steps.js.
   ============================================================================= */
(function () {
    'use strict';

    var ML = window.MatrixLab;
    if (!ML) {
        console.error('[calculator.js] window.MatrixLab не найден — модуль не запущен.');
        return;
    }

    // =========================================================================
    // 1. РЕЕСТР ОПЕРАЦИЙ
    // =========================================================================

    var DEFAULT_OPS = {
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

    var OPS = Object.assign({}, DEFAULT_OPS);

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
    // 2. ПРЕСЕТЫ ДЛЯ СТРАНИЦЫ /modules/
    // =========================================================================

    var PRESETS = {
        determinant: {
            label: 'Обратимость преобразования',
            subtitle: 'det A ≠ 0 — можно вернуться назад',
            description: (
                'Определитель показывает, во сколько раз преобразование ' +
                'изменяет объём. Если он равен нулю — преобразование ' +
                'необратимо: часть информации теряется. Это фундамент ' +
                'любой задачи устойчивости.'
            ),
            icon: 'math/determinant'
        },
        eigenvalues: {
            label: 'Собственные состояния',
            subtitle: 'λ — устойчивые режимы системы',
            description: (
                'Собственные значения показывают, какие направления ' +
                'система сохраняет, а какие меняет. Это язык устойчивости, ' +
                'резонанса и главных компонент — от вибраций моста до ' +
                'факторов риска в портфеле.'
            ),
            icon: 'math/lambda'
        },
        lu: {
            label: 'Разложение сложной задачи',
            subtitle: 'A = L·U — пошаговое решение',
            description: (
                'Сложную матрицу можно разложить на простые треугольные ' +
                'множители. Тогда решение системы становится быстрым: ' +
                'сначала прямой ход, потом обратный. Это основа ' +
                'численных методов.'
            ),
            icon: 'math/lu'
        },
        rank: {
            label: 'Размерность данных',
            subtitle: 'rank A — сколько независимых измерений',
            description: (
                'Ранг матрицы — это число независимых строк. В данных ' +
                'он показывает, сколько скрытых факторов реально ' +
                'управляет результатом. Низкий ранг — сигнал, что ' +
                'данные избыточны.'
            ),
            icon: 'math/rank'
        },
        inverse: {
            label: 'Обратное преобразование',
            subtitle: 'A⁻¹ — вернуться к исходному состоянию',
            description: (
                'Обратная матрица решает обратную задачу: если мы знаем ' +
                'результат, что было на входе? Это нужно для ' +
                'дешифровки, восстановления сигнала и калибровки ' +
                'измерительных приборов.'
            ),
            icon: 'math/inverse'
        },
        properties: {
            label: 'Полный анализ свойств',
            subtitle: 'Все характеристики матрицы сразу',
            description: (
                'Одна матрица — и сразу полный портрет: квадратная ли, ' +
                'симметричная, ортогональная, вырожденная, ' +
                'положительно определённая, идемпотентная. ' +
                'Плюс определитель, ранг, след и собственные значения.'
            ),
            icon: 'ui/check-badge'
        }
    };

    // =========================================================================
    // 3. УТИЛИТЫ
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

    function toArray(list) {
        if (!list) return [];
        if (Array.isArray(list)) return list;
        return Array.prototype.slice.call(list);
    }

    function getSelectedOperation(scope) {
        var s = scope || document;
        var radio = s.querySelector('[data-op-select]:checked');
        return radio ? radio.value : null;
    }

    function getShowSteps(scope) {
        var el = (scope || document).querySelector(
            '[data-show-steps], [data-ops-show-steps], [data-system-steps]'
        );
        return el ? !!el.checked : true;
    }

    function liveMatrices() {
        return ML.getAllMatrices();
    }

    function closeModalIfAny(btn) {
        var modal = btn && btn.closest('.modal');
        if (modal && ML.modal) {
            setTimeout(function () {
                ML.modal.close('#' + modal.id);
            }, 200);
        }
    }

    function scrollToResult(resultBlock) {
        if (!resultBlock || resultBlock.hidden) return;
        try {
            var top = resultBlock.getBoundingClientRect().top
                + window.pageYOffset - 80;
            window.scrollTo({ top: top, behavior: 'smooth' });
        } catch (e) { /* noop */ }
    }

    function scrollToElement(el) {
        if (!el) return;
        try {
            var top = el.getBoundingClientRect().top
                + window.pageYOffset - 80;
            window.scrollTo({ top: top, behavior: 'smooth' });
        } catch (e) { /* noop */ }
    }

    function safeResult(resp) {
        if (!resp) return {};
        if (typeof resp === 'object' && resp.result !== undefined) {
            return resp.result;
        }
        return resp;
    }

    // =========================================================================
    // 4. РЕЖИМ
    // =========================================================================

    function detectMode(root) {
        var scope = root || document;
        var hasSingle   = !!findOne(scope, '[data-calc-run]');
        var hasMulti    = !!findOne(scope, '[data-ops-run]');
        var hasSystem   = !!findOne(scope, '[data-system-run]');
        var hasModules  = !!findOne(scope, '[data-modules-run]');

        if (hasModules) return 'modules';
        if (hasSingle && !hasMulti) return 'single';
        if (hasMulti && !hasSingle) return 'multi';
        if (hasSingle && hasMulti) return 'both';
        if (hasSystem) return 'system';
        return null;
    }

    // =========================================================================
    // 5. ЗАПУСК ОПЕРАЦИИ
    // =========================================================================

    async function runOperation(op, ctx) {
        ctx = ctx || {};
        var scope = ctx.root || document;
        var info = opInfo(op);
        var resultBlock = ctx.resultBlock
            || findOne(scope, '[data-result-block]');
        var placeholder = ctx.placeholder;

        if (!info.url) {
            ML.toast.error(
                ML.i18n.t('common.error', 'Ошибка'),
                ML.i18n.t('calculator.opNotSupported',
                    'Операция не поддерживается.') + ' «' + info.label + '»'
            );
            return null;
        }

        var payload;
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

        var validation = ML.validateMatrixFor(op, {
            a: ctx.matrices && ctx.matrices[0],
            b: ctx.matrices && ctx.matrices[1]
        });
        if (!validation.ok) {
            ML.toast.warning(validation.message, validation.hint || '');
            return null;
        }

        var snapshot = JSON.parse(JSON.stringify(payload));

        ML.loader.show(ML.i18n.t('common.computing', 'Вычисляем…'));
        if (resultBlock && ML.resultBlock) {
            ML.resultBlock.renderSkeleton(resultBlock);
        }

        try {
            var response = await ML.api.post(info.url, payload);

            var verification = { ok: true };
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

    function buildPayload(op, ctx) {
        var info = opInfo(op);
        var scope = ctx.root || document;
        var params = info.params || [];

        var payload = { show_steps: getShowSteps(scope) };

        if (params.indexOf('precision') !== -1) {
            var elP = findOne(scope, '[data-precision]');
            if (elP && elP.value) {
                payload.precision = parseInt(elP.value, 10) || 6;
            }
        }
        if (params.indexOf('format') !== -1) {
            var elF = findOne(scope, '[data-number-format]');
            if (elF && elF.value) payload.format = elF.value;
        }
        if (params.indexOf('method') !== -1) {
            var elM = findOne(scope, '[data-method-select]')
                || findOne(scope, '[data-system-method]:checked');
            if (elM) payload.method = elM.value;
        }

        var matrices = ctx.matrices || [];
        var vector = ctx.vector;

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

        switch (info.payloadMode) {
            case 'chain': {
                var filled = [];
                matrices.forEach(function (mi) {
                    var data = mi.read();
                    if (!isEmptyMatrix(data)) filled.push(data);
                });
                if (filled.length < 2) {
                    throw new Error(ML.i18n.t('calculator.needTwo',
                        'Нужно минимум 2 заполненные матрицы.'));
                }
                payload.operation = op;
                payload.matrices = filled;
                return payload;
            }

            case 'pair': {
                if (!matrices[0] || !matrices[1]) {
                    throw new Error(ML.i18n.t('calculator.needAB',
                        'Нужны матрицы A и B.'));
                }
                var a = matrices[0].read();
                var b = matrices[1].read();
                if (isEmptyMatrix(a)) {
                    throw new Error(ML.i18n.t('calculator.fillA',
                        'Заполните матрицу A.'));
                }
                if (isEmptyMatrix(b)) {
                    throw new Error(ML.i18n.t('calculator.fillB',
                        'Заполните матрицу B.'));
                }
                payload.matrix_a = a;
                payload.matrix_b = b;
                return payload;
            }

            case 'pair_scalar': {
                if (!matrices[0]) {
                    throw new Error(ML.i18n.t('calculator.fillA',
                        'Заполните матрицу A.'));
                }
                var elS = findOne(scope, '[data-scalar-input]');
                var s = elS ? String(elS.value).trim() : '';
                if (!s) {
                    throw new Error(ML.i18n.t('calculator.enterScalar',
                        'Введите значение скаляра k.'));
                }
                var aS = matrices[0].read();
                if (isEmptyMatrix(aS)) {
                    throw new Error(ML.i18n.t('calculator.fillA',
                        'Заполните матрицу A.'));
                }
                payload.matrix_a = aS;
                payload.scalar = s;
                return payload;
            }

            case 'pair_power': {
                if (!matrices[0]) {
                    throw new Error(ML.i18n.t('calculator.fillA',
                        'Заполните матрицу A.'));
                }
                var elPw = findOne(scope, '[data-power-input]');
                var p = parseInt(elPw ? elPw.value : '', 10);
                if (isNaN(p)) {
                    throw new Error(ML.i18n.t('calculator.enterPower',
                        'Введите целое число в поле «Степень».'));
                }
                var aP = matrices[0].read();
                if (isEmptyMatrix(aP)) {
                    throw new Error(ML.i18n.t('calculator.fillA',
                        'Заполните матрицу A.'));
                }
                payload.matrix = aP;
                payload.power = p;
                return payload;
            }

            case 'single':
            default: {
                if (!matrices[0]) {
                    throw new Error(ML.i18n.t('calculator.noMatrix',
                        'Матрица не найдена.'));
                }
                var m = matrices[0].read();
                if (isEmptyMatrix(m)) {
                    throw new Error(ML.i18n.t('calculator.fillMatrix',
                        'Заполните матрицу.'));
                }
                payload.matrix = m;
                return payload;
            }
        }
    }

    function buildHistoryEntry(op, payload, response, ctx) {
        var info = opInfo(op);
        var entry = {
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
    // 6. АВТОПОДБОР РАЗМЕРОВ
    // =========================================================================

    function applyAutoSize(op, mi) {
        var info = opInfo(op);
        if (!mi) return;
        if (info.autoSquare && mi.rows !== mi.cols) {
            var n = Math.max(mi.rows, mi.cols);
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
        var info = opInfo(op);
        var rule = info.autoFit;

        if (rule === 'square') {
            var a = items[0];
            if (a && a.mi.rows !== a.mi.cols) a.mi.makeSquare();
            return;
        }

        if (rule === 'same') {
            var first = items[0];
            if (!first) return;
            items.forEach(function (item, i) {
                if (i === 0) return;
                if (item.mi.rows !== first.mi.rows
                    || item.mi.cols !== first.mi.cols) {
                    item.mi.setSize(first.mi.rows, first.mi.cols,
                        { preserve: true });
                }
            });
            return;
        }

        if (rule === 'chain') {
            for (var i = 1; i < items.length; i++) {
                var prev = items[i - 1].mi;
                var cur = items[i].mi;
                if (cur.rows !== prev.cols) {
                    cur.setSize(prev.cols, cur.cols, { preserve: true });
                }
            }
        }
    }

    // =========================================================================
    // 7. МОНТИРОВАНИЕ (single / multi)
    // =========================================================================

    function mount(root, mode, opts) {
        opts = opts || {};
        root = root || document;

        var runSelector = mode === 'multi'
            ? '[data-ops-run]'
            : '[data-calc-run]';
        var runBtn = findOne(root, runSelector);
        if (!runBtn) return false;

        var section = runBtn.closest('section') || document;

        var resultBlock = findOne(section, '[data-result-block]');
        var resetBtn = findOne(
            section,
            mode === 'multi' ? '[data-ops-reset]' : '[data-calc-reset]'
        );
        var placeholder = findOne(
            section,
            mode === 'multi'
                ? '[data-ops-placeholder]'
                : '[data-calc-placeholder]'
        );

        var initialMatrices = liveMatrices();
        if (!initialMatrices.length) {
            console.warn('[calculator] Матрицы не найдены.');
            return false;
        }

        var firstMatrix = initialMatrices[0].mi;

        var currentOp = getSelectedOperation(section)
            || (mode === 'multi' ? 'add' : 'determinant');

        function bindOpGroups() {
            toArray(section.querySelectorAll('[data-op-group]'))
                .forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        toArray(section.querySelectorAll('[data-op-group]'))
                            .forEach(function (b) {
                                var active = b === btn;
                                b.classList.toggle('is-active', active);
                                b.setAttribute('aria-selected',
                                    String(active));
                            });
                        toArray(section.querySelectorAll('[data-op-list]'))
                            .forEach(function (list) {
                                list.hidden = (list.dataset.opList
                                    !== btn.dataset.opGroup);
                            });
                        var op = getSelectedOperation(section);
                        if (op) onOperationChange(op);
                    });
                });
        }

        function updateParams(info) {
            var extra = findOne(section, '[data-op-extra]');
            if (!extra) return;
            var params = info.params || [];

            ['method', 'power', 'scalar', 'precision'].forEach(function (k) {
                var elSingle = findOne(section, '[data-param="' + k + '"]');
                var elMulti = findOne(section, '[data-ops-param="' + k + '"]');
                var show = params.indexOf(k) !== -1;
                if (elSingle) elSingle.hidden = !show;
                if (elMulti) elMulti.hidden = !show;
            });

            extra.hidden = params.length === 0;
        }

        function updateMatrixCards() {
            if (mode !== 'multi') return;
            var info = opInfo(currentOp);
            var needed = info.needs;
            var items = liveMatrices();

            items.forEach(function (item, index) {
                var show = (needed === 'n') ? true : index < needed;
                item.card.style.display = show ? '' : 'none';
            });

            var addBtn = findOne(section, '[data-add-matrix]');
            if (addBtn) addBtn.hidden = (needed !== 'n');
        }

        function updateRunButtonState() {
            var info = opInfo(currentOp);
            if (mode === 'multi') {
                updateRunButtonStateMulti(info);
            } else {
                updateRunButtonStateSingle(info);
            }
        }

        function updateRunButtonStateSingle(info) {
            var mi = firstMatrix;
            var matrix = mi.read();
            var empty = isEmptyMatrix(matrix);
            var notSquare = info.square && mi.rows !== mi.cols;
            var invalid = mi.hasInvalid && mi.hasInvalid();

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
            var needed = info.needs;
            var items = liveMatrices();

            if (needed === 'n') {
                var filled = items.filter(function (item) {
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

            for (var i = 0; i < needed; i++) {
                var item = items[i];
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

        function onOperationChange(op) {
            currentOp = op || (mode === 'multi' ? 'add' : 'determinant');
            var info = opInfo(currentOp);

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

        bindOpGroups();

        toArray(section.querySelectorAll('[data-op-select]'))
            .forEach(function (radio) {
                radio.addEventListener('change', function () {
                    onOperationChange(radio.value);
                });
            });

        var updateStateDebounced = ML.debounce(updateRunButtonState, 80);

        function bindMatrixInputs() {
            liveMatrices().forEach(function (item) {
                if (item.mi.el.dataset.stateBound === '1') return;
                item.mi.el.dataset.stateBound = '1';
                item.mi.el.addEventListener('matrix:change',
                    updateStateDebounced);
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

        onOperationChange(currentOp);

        runBtn.addEventListener('click', async function () {
            var info = opInfo(currentOp);

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

            var items = liveMatrices();
            var matrices;
            if (mode === 'multi') {
                var needed = info.needs;
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

        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                var items = liveMatrices();
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
    // 8. ПОИСК МАТРИЦЫ ДЛЯ /modules/
    // =========================================================================

    function findModulesMatrix(root) {
        var items = liveMatrices();
        if (items.length) return items[0].mi;

        var host = findOne(root || document, '[data-matrix-input]');
        if (!host) return null;

        console.warn(
            '[calculator] /modules/: матрица есть в DOM, ' +
            'но ML.getAllMatrices() её не видит. ' +
            'Проверьте, что matrix.js подключён и инициализирует [data-matrix-input].'
        );
        return null;
    }

    // =========================================================================
    // 9. МОНТИРОВАНИЕ МОДУЛЕЙ (/modules/)
    // =========================================================================

    function mountModules(root) {
        root = root || document;

        var runBtn = findOne(root, '[data-modules-run]');
        if (!runBtn) {
            console.warn('[calculator] modules: кнопка [data-modules-run] не найдена.');
            return false;
        }

        var section = runBtn.closest('section') || document;
        var resultBlock = findOne(section, '[data-result-block]')
            || document.getElementById('modules-result');
        var resetBtn = findOne(section, '[data-modules-reset]');

        // --- Матрица
        var firstMatrix = findModulesMatrix(root);
        if (!firstMatrix) {
            console.warn('[calculator] modules: матрица не найдена — модуль не запущен.');
            return false;
        }

        // --- Текущий пресет
        var currentPreset = 'determinant';
        var presetBtns = toArray(section.querySelectorAll('[data-preset-choice]'));
        if (presetBtns.length) {
            var activeBtn = null;
            for (var i = 0; i < presetBtns.length; i++) {
                if (presetBtns[i].classList.contains('is-active')) {
                    activeBtn = presetBtns[i];
                    break;
                }
            }
            if (activeBtn) currentPreset = activeBtn.dataset.presetChoice;
        }

        var presetHint = findOne(section, '[data-preset-hint-text]');
        var presetMeta = buildPresetMeta();

        // =====================================================================
        // setPreset
        // =====================================================================
        function setPreset(code) {
            if (!code) return;
            currentPreset = code;

            presetBtns.forEach(function (b) {
                var isActive = b.dataset.presetChoice === code;
                b.classList.toggle('is-active', isActive);
                b.setAttribute('aria-selected', isActive ? 'true' : 'false');
            });

            if (presetHint && presetMeta[code]) {
                presetHint.textContent = presetMeta[code];
            }

            var hintBox = findOne(section, '.preset-hint');
            if (hintBox) {
                hintBox.classList.add('is-flash');
                setTimeout(function () {
                    hintBox.classList.remove('is-flash');
                }, 700);
            }

            if (PRESETS[code]) {
                applyAutoSize(code, firstMatrix);
            }
            updateRunButtonState();

            ML.emit('modules:preset-change', { preset: code });
        }

        // =====================================================================
        // Кнопка «Вычислить»
        //
        // Кнопка ВСЕГДА активна. Состояние только меняет подсказку (title),
        // чтобы пользователь понимал, чего не хватает.
        // =====================================================================
        function updateRunButtonState() {
            var matrix = firstMatrix.read();
            var empty = isEmptyMatrix(matrix);
            var invalid = firstMatrix.hasInvalid && firstMatrix.hasInvalid();

            // Принудительно разблокируем кнопку — она всегда кликабельна.
            if (runBtn.disabled) runBtn.disabled = false;
            runBtn.removeAttribute('disabled');
            runBtn.setAttribute('aria-disabled', 'false');

            if (invalid) {
                runBtn.title = ML.i18n.t('calculator.invalidValues',
                    'Некорректные значения в матрице');
            } else if (empty) {
                runBtn.title = ML.i18n.t('calculator.fillMatrix',
                    'Заполните матрицу');
            } else {
                runBtn.title = ML.i18n.t('calculator.run', 'Выполнить');
            }
        }

        // =====================================================================
        // Пресеты внизу страницы
        // =====================================================================
        presetBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                setPreset(btn.dataset.presetChoice);
            });
        });

        // =====================================================================
        // Кнопки «Попробовать» в карточках направлений
        // =====================================================================
        var tryButtons = toArray(document.querySelectorAll('[data-modules-try]'));

        tryButtons.forEach(function (btn) {
            btn.addEventListener('click', function (ev) {
                ev.preventDefault();

                var preset = btn.dataset.preset || 'determinant';
                var exampleSlug = btn.dataset.example;

                var calc = document.getElementById('calculator');
                scrollToElement(calc || runBtn);

                var start = function () {
                    setPreset(preset);

                    if (runBtn.disabled) {
                        ML.toast.info(
                            'Матрица пуста',
                            'Заполните матрицу или выберите пример.'
                        );
                    } else {
                        ML.toast.info(
                            'Можно считать',
                            'Нажмите «Вычислить», когда будете готовы.'
                        );
                    }
                };

                if (exampleSlug) {
                    loadExampleInto(firstMatrix, exampleSlug).then(start);
                } else {
                    start();
                }
            });
        });

        // Чипы примеров внутри калькулятора
        toArray(section.querySelectorAll('[data-modules-example]'))
            .forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var slug = btn.dataset.modulesExample;
                    if (slug) loadExampleInto(firstMatrix, slug);
                });
            });

        // =====================================================================
        // Размеры матрицы — поля «Строк / Столбцов»
        // =====================================================================
        var rowsInput = findOne(section, '[data-a-rows]')
            || findOne(section, '[data-matrix-rows]');
        var colsInput = findOne(section, '[data-a-cols]')
            || findOne(section, '[data-matrix-cols]');

        function onSizeChange() {
            var r = parseInt(rowsInput ? rowsInput.value : '3', 10) || 3;
            var c = parseInt(colsInput ? colsInput.value : '3', 10) || 3;
            firstMatrix.setSize(r, c, { preserve: true });
            updateRunButtonState();
        }
        if (rowsInput) rowsInput.addEventListener('change', onSizeChange);
        if (colsInput) colsInput.addEventListener('change', onSizeChange);

        // =====================================================================
        // Запуск — по клику
        // =====================================================================
        runBtn.addEventListener('click', async function () {
            if (firstMatrix.hasInvalid && firstMatrix.hasInvalid()) {
                ML.toast.warning(
                    ML.i18n.t('calculator.invalidInput', 'Некорректный ввод'),
                    ML.i18n.t('calculator.fixCells',
                        'Исправьте подсвеченные ячейки.')
                );
                return;
            }

            try {
                await runOperation(currentPreset, {
                    root: section,
                    resultBlock: resultBlock,
                    matrices: [firstMatrix]
                });
            } catch (err) {
                console.error('[modules] run error:', err);
                ML.toast.error(
                    ML.i18n.t('calculator.failed', 'Не удалось выполнить'),
                    err && err.message ? err.message : ''
                );
            }
        });

        // =====================================================================
        // Сброс
        // =====================================================================
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                firstMatrix.clear();
                if (resultBlock && ML.resultBlock) {
                    ML.resultBlock.clear(resultBlock);
                } else if (resultBlock) {
                    resultBlock.hidden = true;
                }
                updateRunButtonState();
                ML.emit('modules:reset', {});
            });
        }

        // =====================================================================
        // Начальное состояние
        // =====================================================================
        setPreset(currentPreset);
        updateRunButtonState();

        // ---------------------------------------------------------------------
        // Страховки: кнопка не должна «зависать» в disabled,
        // даже если matrix:change не приходит (fallback-ячейки и т.п.)
        // ---------------------------------------------------------------------
        var updateDebounced = ML.debounce(updateRunButtonState, 80);

        if (firstMatrix && firstMatrix.el) {
            firstMatrix.el.addEventListener('matrix:change', updateDebounced);

            // Ловим нативные события в capture-фазе — на случай,
            // если matrix.js не эмитит matrix:change.
            firstMatrix.el.addEventListener('input',  updateDebounced, true);
            firstMatrix.el.addEventListener('change', updateDebounced, true);
            firstMatrix.el.addEventListener('keyup',  updateDebounced, true);

            // MutationObserver — на случай, если ячейки перестраиваются
            // программно (например, из примера/random).
            if (typeof MutationObserver !== 'undefined') {
                try {
                    var mo = new MutationObserver(function () {
                        updateDebounced();
                    });
                    mo.observe(firstMatrix.el, {
                        childList: true,
                        subtree: true,
                        attributes: true,
                        attributeFilter: ['data-value', 'class']
                    });
                } catch (e) { /* noop */ }
            }
        }

        // Периодическая синхронизация состояния — раз в 400 мс.
        // Дешёвая операция, но гарантирует, что кнопка не «залипнет».
        var unlockTimer = setInterval(function () {
            if (firstMatrix && typeof firstMatrix.read === 'function') {
                updateRunButtonState();
            }
        }, 400);

        // Останавливаем таймер при уходе со страницы.
        window.addEventListener('beforeunload', function () {
            if (unlockTimer) clearInterval(unlockTimer);
        });

        // =====================================================================
        // Публичное
        // =====================================================================
        ML.modules = ML.modules || {};
        ML.modules.setPreset = setPreset;
        ML.modules.getPreset = function () { return currentPreset; };
        ML.modules.run = function () { runBtn.click(); };

        ML.emit('modules:ready', {});
        return true;
    }

    function buildPresetMeta() {
        var meta = {};
        Object.keys(PRESETS).forEach(function (code) {
            meta[code] = PRESETS[code].description;
        });
        return meta;
    }

    function loadExampleInto(mi, slug) {
        ML.loader.show(ML.i18n.t('calculator.loadingExample',
            'Загружаем пример…'));

        return ML.api.post('/api/example/' + slug + '/', {})
            .then(function (resp) {
                var data = safeResult(resp);
                var matrix = data.matrix;

                var target = mi;
                if (!target && ML.getFirstMatrix) {
                    target = ML.getFirstMatrix();
                }

                if (matrix && isArr(matrix) && target) {
                    target.setSize(matrix.length, matrix[0].length,
                        { preserve: false });
                    target.write(matrix);
                }

                if (data.vector) {
                    var vecEl = document.querySelector('[data-vector-input]');
                    if (vecEl) {
                        var vec = ML.vectorInputs && ML.vectorInputs[vecEl.id];
                        if (vec && vec.write) vec.write(data.vector);
                    }
                }

                if (data.title) {
                    ML.toast.info('Пример загружен', data.title);
                }
                return data;
            })
            .catch(function (err) {
                ML.toast.error('Не удалось загрузить', err.message || '');
                return null;
            })
            .finally(function () {
                ML.loader.hide();
            });
    }

    // =========================================================================
    // 10. ОГЛАВЛЕНИЕ МОДУЛЕЙ (/modules/)
    // =========================================================================

    function initModulesToc(root) {
        root = root || document;

        var toc = findOne(root, '[data-modules-toc]')
            || findOne(root, '.modules-toc');
        if (!toc) return false;

        var linksBySlug = {};
        toArray(toc.querySelectorAll('[data-modules-link]'))
            .forEach(function (link) {
                var slug = link.dataset.modulesLink;
                if (slug) linksBySlug[slug] = link;
            });

        var schoolSections = toArray(
            document.querySelectorAll('[data-modules-school]')
        );
        var directionCards = toArray(
            document.querySelectorAll('[data-direction-card]')
        );

        function setActiveLink(slug) {
            Object.keys(linksBySlug).forEach(function (s) {
                linksBySlug[s].classList.toggle('is-active', s === slug);
            });
        }

        if (schoolSections.length && 'IntersectionObserver' in window) {
            var visible = new Map();

            var observer = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        visible.set(entry.target,
                            entry.target.getBoundingClientRect().top);
                    } else {
                        visible.delete(entry.target);
                    }
                });

                if (!visible.size) return;

                var topEl = null;
                var topY = Infinity;
                visible.forEach(function (y, el) {
                    if (y < topY) { topY = y; topEl = el; }
                });
                if (!topEl) return;

                if (topEl.dataset && topEl.dataset.modulesSchool) {
                    setActiveLink(topEl.dataset.modulesSchool);
                    return;
                }
                if (topEl.id) {
                    setActiveLink(topEl.id);
                }
            }, { rootMargin: '-20% 0px -60% 0px', threshold: 0 });

            schoolSections.forEach(function (s) { observer.observe(s); });
            directionCards.forEach(function (c) { observer.observe(c); });
        }

        toArray(toc.querySelectorAll('[data-modules-link]'))
            .forEach(function (link) {
                link.addEventListener('click', function (e) {
                    var href = link.getAttribute('href');
                    if (!href || href.charAt(0) !== '#') return;
                    var target = document.querySelector(href);
                    if (!target) return;
                    e.preventDefault();
                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                    history.replaceState(null, '', href);
                });
            });

        var searchInput = findOne(toc, '[data-modules-search]');
        var emptyState = findOne(toc, '[data-modules-empty]');
        var schoolGroups = toArray(
            toc.querySelectorAll('[data-modules-school-item]')
        );
        var directionItems = toArray(
            toc.querySelectorAll('[data-modules-direction-item]')
        );

        if (searchInput) {
            var filter = ML.debounce(function () {
                var q = (searchInput.value || '').toLowerCase().trim();
                var visibleSchools = {};
                var totalVisible = 0;

                directionCards.forEach(function (card) {
                    var title = card.dataset.directionTitle || '';
                    var match = !q || title.indexOf(q) !== -1;
                    card.style.display = match ? '' : 'none';
                    if (match) {
                        visibleSchools[card.dataset.directionSchool] = true;
                        totalVisible += 1;
                    }
                });

                schoolSections.forEach(function (section) {
                    var slug = section.dataset.modulesSchool;
                    section.hidden = q ? !visibleSchools[slug] : false;
                });

                directionItems.forEach(function (li) {
                    var title = li.dataset.directionTitle || '';
                    li.hidden = q ? title.indexOf(q) === -1 : false;
                });

                schoolGroups.forEach(function (group) {
                    if (!q) { group.hidden = false; return; }
                    var anyVisible = toArray(
                        group.querySelectorAll('[data-modules-direction-item]')
                    ).some(function (li) { return !li.hidden; });
                    group.hidden = !anyVisible;
                });

                if (emptyState) emptyState.hidden = totalVisible > 0;
            }, 150);

            searchInput.addEventListener('input', filter);
        }

        return true;
    }

    // =========================================================================
    // 11. ПРИМЕРЫ
    // =========================================================================

    function initExamples() {
        document.addEventListener('click', async function (e) {
            var singleBtn = e.target.closest('[data-load-example]');
            if (singleBtn) {
                var slug = singleBtn.dataset.loadExample;
                if (slug) await loadExample(singleBtn, slug);
                return;
            }
            var pairBtn = e.target.closest('[data-load-pair]');
            if (pairBtn) {
                var pair = pairBtn.dataset.loadPair;
                if (pair) await loadPair(pairBtn, pair);
            }
        });
    }

    async function loadExample(btn, slug) {
        ML.loader.show(ML.i18n.t('calculator.loadingExample',
            'Загружаем пример…'));
        try {
            var resp = await ML.api.post('/api/example/' + slug + '/', {});
            var data = safeResult(resp);
            var matrix = data.matrix;

            if (matrix && isArr(matrix)) {
                var mi = ML.getFirstMatrix ? ML.getFirstMatrix() : null;
                if (mi) {
                    mi.setSize(matrix.length, matrix[0].length,
                        { preserve: false });
                    mi.write(matrix);
                }
            }

            var vecEl = document.querySelector('[data-vector-input]');
            if (vecEl && data.vector) {
                var vec = ML.vectorInputs && ML.vectorInputs[vecEl.id];
                if (vec && vec.write) vec.write(data.vector);
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
        var parts = String(pair).split(',');
        var slugA = parts[0];
        var slugB = parts[1] || parts[0];

        ML.loader.show(ML.i18n.t('calculator.loadingPair',
            'Загружаем пару матриц…'));
        try {
            var responses = await Promise.all([
                ML.api.post('/api/example/' + slugA + '/', {}),
                ML.api.post('/api/example/' + slugB + '/', {})
            ]);
            var dataA = safeResult(responses[0]);
            var dataB = safeResult(responses[1]);
            var mA = dataA.matrix;
            var mB = dataB.matrix;

            var all = liveMatrices();
            var a = all.find(function (x) { return x.letter === 'a'; });
            var b = all.find(function (x) { return x.letter === 'b'; });

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
    // 12. ГЕНЕРАТОР СЛУЧАЙНЫХ МАТРИЦ
    // =========================================================================

    function initRandomGenerator() {
        var openBtn = document.querySelector('[data-random-open]');
        var modal = document.querySelector('#random-modal');
        if (!openBtn || !modal) return;

        openBtn.addEventListener('click', function () {
            ML.modal.open('#random-modal');
        });

        var genBtn = modal.querySelector('[data-random-generate]');
        if (!genBtn) return;

        genBtn.addEventListener('click', async function () {
            var rowsInp = modal.querySelector('[data-random-rows]');
            var colsInp = modal.querySelector('[data-random-cols]');
            var minInp = modal.querySelector('[data-random-min]');
            var maxInp = modal.querySelector('[data-random-max]');
            var kindInp = modal.querySelector('[data-random-kind]');
            var fracsInp = modal.querySelector('[data-random-fractions]');

            var rows = parseInt(rowsInp ? rowsInp.value : '3', 10) || 3;
            var cols = parseInt(colsInp ? colsInp.value : '3', 10) || 3;
            var minValue = parseInt(minInp ? minInp.value : '-9', 10);
            var maxValue = parseInt(maxInp ? maxInp.value : '9', 10);
            var kind = kindInp ? kindInp.value : 'random';
            var allowFractions = fracsInp ? fracsInp.checked : false;

            ML.loader.show(ML.i18n.t('calculator.generating',
                'Генерируем…'));
            try {
                var resp = await ML.api.post('/api/random-matrix/', {
                    rows: rows,
                    cols: cols,
                    min_value: isNaN(minValue) ? -9 : minValue,
                    max_value: isNaN(maxValue) ? 9 : maxValue,
                    kind: kind,
                    allow_fractions: allowFractions
                });
                var matrix = safeResult(resp);

                if (matrix && isArr(matrix)) {
                    var mi = ML.getFirstMatrix ? ML.getFirstMatrix() : null;
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
    // 13. БЫСТРЫЙ / РАСШИРЕННЫЙ РЕЖИМ
    // =========================================================================

    function initModeToggle() {
        var toggle = document.querySelector('[data-calc-mode]');
        if (!toggle) return;

        function applyMode() {
            var mode = toggle.checked ? 'advanced' : 'quick';
            document.body.dataset.calcMode = mode;
            ML.prefs.set('calcMode', mode);
        }
        toggle.addEventListener('change', applyMode);

        var saved = ML.prefs.get('calcMode');
        if (saved === 'advanced') toggle.checked = true;
        applyMode();
    }

    // =========================================================================
    // 14. ПУБЛИЧНЫЙ РЕЕСТР ОПЕРАЦИЙ
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

    ML.calculator.runOperation = runOperation;
    ML.calculator.run = runOperation;

    ML.calculator.PRESETS = PRESETS;
    ML.calculator.getPresets = function () {
        return Object.keys(PRESETS).map(function (code) {
            return Object.assign({ code: code }, PRESETS[code]);
        });
    };

    // =========================================================================
    // 15. ИНИЦИАЛИЗАЦИЯ
    // =========================================================================

    var _initialized = false;

    function init() {
        if (_initialized) return;
        _initialized = true;

        var mode = detectMode(document);

        if (mode === 'modules') {
            mountModules(document);
            initModulesToc(document);
        } else if (mode === 'single') {
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