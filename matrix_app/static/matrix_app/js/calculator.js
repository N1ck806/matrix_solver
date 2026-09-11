/* =============================================================================
   MatrixLab — calculator.js
   =============================================================================
   Полностью переписанная версия.

   Отвечает за:
       • Калькулятор (одна матрица) — calculator.html
       • Операции над N матрицами — operations.html
       • Загрузку примеров
       • Генератор случайных матриц
       • Сохранённую матрицу из sessionStorage

   НЕ зависит от data-matrix-card="a" — использует ML.getFirstMatrix().
   ============================================================================= */
(function () {
    'use strict';

    var ML = window.MatrixLab;
    if (!ML) return;

    // =========================================================================
    // 1. API ENDPOINTS
    // =========================================================================
    var API = {
        determinant:  '/api/matrix/determinant/',
        rank:         '/api/matrix/rank/',
        inverse:      '/api/matrix/inverse/',
        transpose:    '/api/matrix/transpose/',
        trace:        '/api/matrix/trace/',
        rref:         '/api/matrix/rref/',
        echelon:      '/api/matrix/echelon/',
        properties:   '/api/matrix/properties/',
        eigenvalues:  '/api/matrix/eigenvalues/',
        eigenvectors: '/api/matrix/eigenvectors/',
        char_poly:    '/api/matrix/char-poly/',
        lu:           '/api/matrix/lu/',
        qr:           '/api/matrix/qr/',
        cholesky:     '/api/matrix/cholesky/',
        diagonalize:  '/api/matrix/diagonalize/',

        add:      '/api/matrix/add/',
        subtract: '/api/matrix/subtract/',
        multiply: '/api/matrix/multiply/',
        scalar:   '/api/matrix/scalar/',
        power:    '/api/matrix/power/',
        compare:  '/api/matrix/compare/',
        chain:    '/api/matrix/chain/',

        random: '/api/random-matrix/',
    };

    // Какие операции требуют квадратной матрицы
    var OP_REQUIREMENTS = {
        determinant:  { square: true,  autoSquare: true },
        inverse:      { square: true,  autoSquare: true },
        trace:        { square: true,  autoSquare: true },
        eigenvalues:  { square: true,  autoSquare: true },
        eigenvectors: { square: true,  autoSquare: true },
        char_poly:    { square: true,  autoSquare: true },
        lu:           { square: true,  autoSquare: true },
        cholesky:     { square: true,  autoSquare: true },
        diagonalize:  { square: true,  autoSquare: true },
        power:        { square: true,  autoSquare: true },
        rank:         { square: false },
        transpose:    { square: false },
        rref:         { square: false },
        echelon:      { square: false },
        properties:   { square: false },
        qr:           { square: false },
    };

    // Операции-цепочки (N матриц)
    var CHAIN_OPS = ['add', 'multiply'];

    // =========================================================================
    // 2. УТИЛИТЫ
    // =========================================================================

    function getSelectedOperation() {
        var radio = document.querySelector('[data-op-select]:checked');
        return radio ? radio.value : null;
    }

    function opLabel(op) {
        var labels = {
            determinant: 'определитель',
            rank: 'ранг',
            inverse: 'обратная матрица',
            transpose: 'транспонирование',
            trace: 'след',
            rref: 'RREF',
            echelon: 'ступенчатая форма',
            properties: 'свойства',
            eigenvalues: 'собственные значения',
            eigenvectors: 'собственные векторы',
            char_poly: 'характеристический многочлен',
            lu: 'LU-разложение',
            qr: 'QR-разложение',
            cholesky: 'разложение Холецкого',
            diagonalize: 'диагонализация',
            add: 'сложение',
            subtract: 'вычитание',
            multiply: 'умножение',
            scalar_multiply: 'умножение на скаляр',
            power: 'возведение в степень',
            compare: 'сравнение',
        };
        return labels[op] || op;
    }

    function isEmptyMatrix(m) {
        if (!Array.isArray(m) || !m.length) return true;
        return m.every(function (row) {
            return row.every(function (v) { return v === ''; });
        });
    }

    function matricesNeeded(op) {
        if (op === 'transpose' || op === 'scalar_multiply' || op === 'power') {
            return 1;
        }
        return 2;
    }

    // =========================================================================
    // 3. ЗАГРУЗКА СОХРАНЁННОЙ МАТРИЦЫ
    // =========================================================================

    function loadSavedMatrixFromSession() {
        var saved;
        try {
            saved = sessionStorage.getItem('matrixlab.load_matrix');
        } catch (e) { return; }
        if (!saved) return;

        try {
            var data = JSON.parse(saved);
            if (Array.isArray(data) && data.length && Array.isArray(data[0])) {
                var mi = ML.getFirstMatrix();
                if (mi) {
                    mi.setSize(data.length, data[0].length, { preserve: false });
                    mi.write(data);
                    if (ML.toast) ML.toast.success('Матрица загружена', 'Из сохранённых');
                }
            }
            sessionStorage.removeItem('matrixlab.load_matrix');
        } catch (e) {
            sessionStorage.removeItem('matrixlab.load_matrix');
        }
    }

    // =========================================================================
    // 4. КАЛЬКУЛЯТОР (одна матрица) — calculator.html
    // =========================================================================

    function initCalculator() {
        var runBtn = document.querySelector('[data-calc-run]');
        if (!runBtn) return;

        var resultBlock = document.querySelector('[data-result-block]');
        var resetBtn = document.querySelector('[data-calc-reset]');
        var placeholder = document.querySelector('[data-calc-placeholder]');

        var matrixInput = ML.getFirstMatrix();
        if (!matrixInput) {
            console.warn('[calculator.js] Матрица не найдена.');
            return;
        }

        loadSavedMatrixFromSession();

        // --- Группы операций ---
        ML.$$('[data-op-group]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                ML.$$('[data-op-group]').forEach(function (b) {
                    b.classList.toggle('is-active', b === btn);
                    b.setAttribute('aria-selected', String(b === btn));
                });
                ML.$$('[data-op-list]').forEach(function (list) {
                    list.hidden = (list.dataset.opList !== btn.dataset.opGroup);
                });
            });
        });

        // --- Смена операции ---
        function onOperationChange() {
            var op = getSelectedOperation();
            var req = OP_REQUIREMENTS[op] || {};

            if (req.autoSquare && matrixInput.rows !== matrixInput.cols) {
                var n = Math.max(matrixInput.rows, matrixInput.cols);
                matrixInput.setSize(n, n, { preserve: true });
                if (ML.toast) ML.toast.info('Размер подстроен', 'Матрица ' + n + ' × ' + n);
            }

            updateParams();
            updateRunButtonState();
        }

        function updateParams() {
            var op = getSelectedOperation();
            var extra = document.querySelector('[data-op-extra]');
            var methodRow = document.querySelector('[data-param="method"]');
            var powerRow = document.querySelector('[data-param="power"]');

            if (!extra) return;
            var show = false;

            if (methodRow) {
                var needsMethod = ['determinant', 'inverse'].indexOf(op) !== -1;
                methodRow.hidden = !needsMethod;
                if (needsMethod) show = true;
            }
            if (powerRow) {
                var needsPower = (op === 'power');
                powerRow.hidden = !needsPower;
                if (needsPower) show = true;
            }
            extra.hidden = !show;
        }

        function updateRunButtonState() {
            var op = getSelectedOperation();
            var req = OP_REQUIREMENTS[op] || {};
            var matrix = matrixInput.read();
            var empty = isEmptyMatrix(matrix);
            var notSquare = req.square && matrixInput.rows !== matrixInput.cols;

            runBtn.disabled = empty || notSquare;

            if (empty) runBtn.title = 'Заполните матрицу';
            else if (notSquare) runBtn.title = 'Нужна квадратная матрица для «' + opLabel(op) + '»';
            else runBtn.title = 'Выполнить операцию';
        }

        ML.$$('[data-op-select]').forEach(function (radio) {
            radio.addEventListener('change', onOperationChange);
        });

        // Слушаем событие изменения матрицы
        matrixInput.el.addEventListener('matrix:change', updateRunButtonState);

        onOperationChange();

        // --- Запуск ---
        runBtn.addEventListener('click', async function () {
            var matrix = matrixInput.read();
            if (isEmptyMatrix(matrix)) {
                ML.toast.warning('Пустая матрица', 'Заполните хотя бы одну ячейку.');
                return;
            }

            var op = getSelectedOperation();
            var req = OP_REQUIREMENTS[op] || {};

            if (req.square && matrixInput.rows !== matrixInput.cols) {
                matrixInput.makeSquare();
                updateRunButtonState();
                return;
            }

            var showStepsEl = document.querySelector('[data-show-steps]');
            var showSteps = showStepsEl ? showStepsEl.checked : true;

            var requestData = { matrix: matrix, show_steps: showSteps };

            var methodSel = document.querySelector('[data-method-select]');
            if (methodSel && !methodSel.closest('[hidden]')) {
                requestData.method = methodSel.value;
            }

            var powerInp = document.querySelector('[data-power-input]');
            if (powerInp && !powerInp.closest('[hidden]')) {
                requestData.power = parseInt(powerInp.value, 10);
            }

            var url = API[op];
            if (!url) {
                ML.toast.error('Ошибка', 'Операция «' + op + '» не поддерживается.');
                return;
            }

            ML.loader.show('Вычисляем…');
            try {
                var response = await ML.api.post(url, requestData);
                ML.resultBlock.render(resultBlock, response, {
                    taskText: 'Операция: ' + opLabel(op) + '.',
                });
                ML.toast.success('Готово', 'Операция выполнена.');
                if (placeholder) placeholder.hidden = true;
            } catch (err) {
                ML.resultBlock.renderError(resultBlock, err.message, err.code);
                ML.toast.error('Не удалось выполнить', err.message);
            } finally {
                ML.loader.hide();
            }
        });

        // --- Сброс ---
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                matrixInput.clear();
                if (resultBlock) resultBlock.hidden = true;
                if (placeholder) placeholder.hidden = false;
                updateRunButtonState();
            });
        }
    }

    // =========================================================================
    // 5. ОПЕРАЦИИ НАД N МАТРИЦАМИ — operations.html
    // =========================================================================

    function initOperations() {
        var runBtn = document.querySelector('[data-ops-run]');
        if (!runBtn) return;

        var resultBlock = document.querySelector('[data-result-block]');
        var resetBtn = document.querySelector('[data-ops-reset]');
        var placeholder = document.querySelector('[data-ops-placeholder]');

        var currentOp = 'add';

        function getAllMatrixInputs() {
            return ML.getAllMatrices();
        }

        function updateMatrixCards() {
            var all = getAllMatrixInputs();
            var needed = matricesNeeded(currentOp);

            all.forEach(function (item, index) {
                item.card.style.display = (index >= needed) ? 'none' : '';
            });

            var addBtn = document.querySelector('[data-add-matrix]');
            if (addBtn) {
                addBtn.hidden = (CHAIN_OPS.indexOf(currentOp) === -1);
            }
        }

        function updateExtraParams() {
            var extra = document.querySelector('[data-op-extra]');
            if (!extra) return;

            var scalarParam = document.querySelector('[data-ops-param="scalar"]');
            var powerParam = document.querySelector('[data-ops-param="power"]');

            var needsScalar = (currentOp === 'scalar_multiply');
            var needsPower = (currentOp === 'power');

            if (scalarParam) scalarParam.hidden = !needsScalar;
            if (powerParam) powerParam.hidden = !needsPower;

            extra.hidden = !(needsScalar || needsPower);
        }

        function autoFitSizes() {
            var all = getAllMatrixInputs();
            var a = all.find(function (x) { return x.letter === 'a'; });
            if (!a) return;

            if (currentOp === 'multiply') {
                for (var i = 1; i < all.length; i++) {
                    var prev = all[i - 1].mi;
                    var cur = all[i].mi;
                    if (cur.rows !== prev.cols) {
                        cur.setSize(prev.cols, cur.cols, { preserve: true });
                    }
                }
            } else if (currentOp === 'add' || currentOp === 'subtract' || currentOp === 'compare') {
                all.forEach(function (item) {
                    if (item.letter === 'a') return;
                    if (item.mi.rows !== a.mi.rows || item.mi.cols !== a.mi.cols) {
                        item.mi.setSize(a.mi.rows, a.mi.cols, { preserve: true });
                    }
                });
            } else if (currentOp === 'power') {
                if (a.mi.rows !== a.mi.cols) a.mi.makeSquare();
            }
        }

        function updateOpsRunButtonState() {
            var all = getAllMatrixInputs();
            var needed = matricesNeeded(currentOp);

            for (var i = 0; i < needed; i++) {
                var item = all[i];
                if (!item || isEmptyMatrix(item.mi.read())) {
                    runBtn.disabled = true;
                    return;
                }
            }
            runBtn.disabled = false;
        }

        ML.updateOpsButtonState = updateOpsRunButtonState;

        function onOperationChange(op) {
            currentOp = op || 'add';
            updateExtraParams();
            updateMatrixCards();
            autoFitSizes();
            updateOpsRunButtonState();
        }

        // Радиокнопки выбора операции
        ML.$$('[data-op-select]').forEach(function (radio) {
            radio.addEventListener('change', function () {
                onOperationChange(radio.value);
            });
        });

        // Слушаем изменения матриц
        document.addEventListener('matrix:change', function () {
            updateOpsRunButtonState();
        });

        onOperationChange(getSelectedOperation() || 'add');

        // --- ЗАПУСК ---
        runBtn.addEventListener('click', async function () {
            var all = getAllMatrixInputs();
            var needed = matricesNeeded(currentOp);
            var matrices = [];

            if (CHAIN_OPS.indexOf(currentOp) !== -1) {
                all.forEach(function (item) {
                    if (item.card.style.display === 'none') return;
                    var data = item.mi.read();
                    if (!isEmptyMatrix(data)) matrices.push(data);
                });

                if (matrices.length < 2) {
                    ML.toast.warning('Мало матриц', 'Нужно минимум 2 заполненные матрицы.');
                    return;
                }
            } else {
                for (var i = 0; i < needed; i++) {
                    var item = all[i];
                    if (!item) {
                        ML.toast.warning('Матрица не найдена', '');
                        return;
                    }
                    var data = item.mi.read();
                    if (isEmptyMatrix(data)) {
                        ML.toast.warning('Пустая матрица ' + item.letter.toUpperCase(), 'Заполните матрицу.');
                        return;
                    }
                    matrices.push(data);
                }
            }

            var showStepsEl = document.querySelector('[data-ops-show-steps]');
            var showSteps = showStepsEl ? showStepsEl.checked : true;

            var requestData;
            var url;

            if (CHAIN_OPS.indexOf(currentOp) !== -1) {
                url = API.chain;
                requestData = {
                    operation: currentOp,
                    matrices: matrices,
                    show_steps: showSteps,
                };
            } else {
                requestData = { show_steps: showSteps };

                if (currentOp === 'transpose') {
                    requestData.matrix = matrices[0];
                    url = API.transpose;
                } else if (currentOp === 'scalar_multiply') {
                    requestData.matrix_a = matrices[0];
                    var scalarInp = document.querySelector('[data-scalar-input]');
                    var scalar = scalarInp ? scalarInp.value.trim() : '';
                    if (!scalar) {
                        ML.toast.warning('Пустой скаляр', 'Введите значение k.');
                        return;
                    }
                    requestData.scalar = scalar;
                    url = API.scalar;
                } else if (currentOp === 'power') {
                    requestData.matrix = matrices[0];
                    var powerInp = document.querySelector('[data-power-input]');
                    var power = parseInt(powerInp ? powerInp.value : '', 10);
                    if (isNaN(power)) {
                        ML.toast.warning('Пустая степень', 'Введите целое число.');
                        return;
                    }
                    requestData.power = power;
                    url = API.power;
                } else {
                    requestData.matrix_a = matrices[0];
                    requestData.matrix_b = matrices[1];
                    url = API[currentOp];
                }
            }

            if (!url) {
                ML.toast.error('Ошибка', 'Операция «' + currentOp + '» не поддерживается.');
                return;
            }

            ML.loader.show('Вычисляем…');
            try {
                var response = await ML.api.post(url, requestData);
                ML.resultBlock.render(resultBlock, response);
                ML.toast.success('Готово', 'Операция выполнена.');
                if (placeholder) placeholder.hidden = true;
            } catch (err) {
                ML.resultBlock.renderError(resultBlock, err.message, err.code);
                ML.toast.error('Не удалось выполнить', err.message);
            } finally {
                ML.loader.hide();
            }
        });

        // --- Сброс ---
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                getAllMatrixInputs().forEach(function (item) {
                    item.mi.clear();
                });
                if (resultBlock) resultBlock.hidden = true;
                if (placeholder) placeholder.hidden = false;
                updateOpsRunButtonState();
            });
        }
    }

    // =========================================================================
    // 6. ЗАГРУЗКА ПРИМЕРОВ
    // =========================================================================

    function initExamples() {
        document.addEventListener('click', async function (e) {
            var btn = e.target.closest('[data-load-example]');
            if (btn) {
                var slug = btn.dataset.loadExample;
                if (slug) await loadExample(btn, slug);
                return;
            }

            var pairBtn = e.target.closest('[data-load-pair]');
            if (pairBtn) {
                var pair = pairBtn.dataset.loadPair;
                if (pair) await loadPair(pairBtn, pair);
                return;
            }
        });
    }

    async function loadExample(btn, slug) {
        ML.loader.show('Загружаем пример…');
        try {
            var resp = await ML.api.post('/api/example/' + slug + '/', {});
            var data = resp.result || {};
            var matrix = data.matrix;

            if (matrix && Array.isArray(matrix)) {
                var mi = ML.getFirstMatrix();
                if (mi) {
                    mi.setSize(matrix.length, matrix[0].length, { preserve: false });
                    mi.write(matrix);
                }
            }

            var vecEl = document.querySelector('[data-vector-input]');
            if (vecEl && data.vector) {
                var vec = ML.vectorInputs[vecEl.id];
                if (vec) vec.write(data.vector);
            }

            closeModalIfAny(btn);
            ML.toast.success('Пример загружен', data.title || slug);
        } catch (err) {
            ML.toast.error('Не удалось загрузить', err.message);
        } finally {
            ML.loader.hide();
        }
    }

    async function loadPair(btn, pair) {
        var parts = pair.split(',');
        var slugA = parts[0];
        var slugB = parts[1] || parts[0];

        ML.loader.show('Загружаем пару матриц…');
        try {
            var results = await Promise.all([
                ML.api.post('/api/example/' + slugA + '/', {}),
                ML.api.post('/api/example/' + slugB + '/', {}),
            ]);

            var mA = results[0].result && results[0].result.matrix;
            var mB = results[1].result && results[1].result.matrix;

            var all = ML.getAllMatrices();
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
            ML.toast.success('Матрицы загружены', 'A и B заполнены.');
        } catch (err) {
            ML.toast.error('Не удалось загрузить', err.message);
        } finally {
            ML.loader.hide();
        }
    }

    function closeModalIfAny(btn) {
        var modal = btn.closest('.modal');
        if (modal && ML.modal) {
            setTimeout(function () {
                ML.modal.close('#' + modal.id);
            }, 200);
        }
    }

    // =========================================================================
    // 7. ГЕНЕРАТОР СЛУЧАЙНЫХ МАТРИЦ
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

            ML.loader.show('Генерируем…');
            try {
                var resp = await ML.api.post(API.random, {
                    rows: rows,
                    cols: cols,
                    min_value: isNaN(minValue) ? -9 : minValue,
                    max_value: isNaN(maxValue) ? 9 : maxValue,
                    kind: kind,
                    allow_fractions: allowFractions,
                });
                var matrix = resp.result;

                if (matrix && Array.isArray(matrix)) {
                    var mi = ML.getFirstMatrix();
                    if (mi) {
                        mi.setSize(matrix.length, matrix[0].length, { preserve: false });
                        mi.write(matrix);
                    }
                }

                ML.modal.close('#random-modal');
                ML.toast.success(
                    'Матрица сгенерирована',
                    matrix.length + '×' + matrix[0].length
                );
            } catch (err) {
                ML.toast.error('Не удалось сгенерировать', err.message);
            } finally {
                ML.loader.hide();
            }
        });
    }

    // =========================================================================
    // 8. ИНИЦИАЛИЗАЦИЯ
    // =========================================================================

    function init() {
        initCalculator();
        initOperations();
        initExamples();
        initRandomGenerator();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();