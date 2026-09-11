/* =============================================================================
   MatrixLab — decompositions.js
   =============================================================================
   Страница /decompositions/ — LU, QR, Холецкий, диагонализация, спектральное.

   Отвечает за:
       • выбор типа разложения (5 кнопок);
       • отправку матрицы на соответствующий endpoint;
       • рендер 3 секций: Задание / Построение / Результат;
       • отображение частей разложения (L, U, Q, R, P, D…);
       • проверку восстановления исходной матрицы;
       • обработку случая, когда разложение неприменимо
         (не тот тип матрицы, отсутствие симметрии и т.п.).

   Зависимости: main.js, matrix.js, steps.js.
   ============================================================================= */
(function () {
    'use strict';

    var ML = window.MatrixLab;
    if (!ML) return;

    var API = {
        lu:          '/api/matrix/lu/',
        qr:          '/api/matrix/qr/',
        cholesky:    '/api/matrix/cholesky/',
        diagonalize: '/api/matrix/diagonalize/',
        spectral:    '/api/matrix/spectral/',
    };

    var DECOMP_TITLES = {
        lu:          'LU-разложение',
        qr:          'QR-разложение',
        cholesky:    'Разложение Холецкого',
        diagonalize: 'Диагонализация',
        spectral:    'Спектральное разложение',
    };

    var DECOMP_EQUATIONS = {
        lu:          'A = L \\cdot U',
        qr:          'A = Q \\cdot R',
        cholesky:    'A = L \\cdot L^{T}',
        diagonalize: 'A = P \\cdot D \\cdot P^{-1}',
        spectral:    'A = Q \\cdot D \\cdot Q^{T}',
    };

    function isEmptyMatrix(m) {
        if (!Array.isArray(m) || m.length === 0) return true;
        return m.every(function (row) {
            return row.every(function (v) { return v === ''; });
        });
    }

    function matrixToLatex(data) {
        if (!Array.isArray(data) || !data.length) return '';
        var rows = data.map(function (row) {
            return row.map(function (v) { return String(v); }).join(' & ');
        });
        return '\\begin{bmatrix}' + rows.join(' \\\\ ') + '\\end{bmatrix}';
    }

    // =========================================================================
    // Рендер результата
    // =========================================================================

    function renderDecomposition(block, payload, op, matrix) {
        if (!block) return;

        // Показать блок, скрыть ошибку
        block.hidden = false;
        block.classList.remove('is-error');

        block.querySelectorAll('[data-result-section]').forEach(function (el) {
            el.style.display = '';
            el.hidden = false;
        });

        var errorEl = block.querySelector('[data-decomp-error]');
        if (errorEl) {
            errorEl.hidden = true;
            errorEl.style.display = 'none';
        }

        var result = payload.result || {};
        var extra = payload.extra || {};
        var task = payload.task || {};

        // --- Секция 1. Задание ---
        var taskText = block.querySelector('[data-decomp-task-text]');
        var taskFormula = block.querySelector('[data-decomp-task-formula]');

        if (taskText) {
            taskText.textContent = 'Выполнить ' + (DECOMP_TITLES[op] || op)
                + ' для матрицы A.';
        }
        if (taskFormula) {
            var matrixLatex = task.matrix_latex || matrixToLatex(matrix);
            var equation = DECOMP_EQUATIONS[op] || '';
            taskFormula.innerHTML = '$$A = ' + matrixLatex + ',\\quad ' + equation + '$$';
        }

        // --- Секция 2. Построение (если есть steps) ---
        var stepsContainer = block.querySelector('[data-decomp-steps]');
        if (stepsContainer) {
            stepsContainer.innerHTML = '';

            var steps = Array.isArray(payload.steps) ? payload.steps : [];
            if (steps.length > 0) {
                steps.forEach(function (step, idx) {
                    var stepEl = document.createElement('article');
                    stepEl.className = 'step';
                    stepEl.innerHTML = ''
                        + '<div class="step-marker"><span class="step-number">' + (idx + 1) + '</span></div>'
                        + '<div class="step-content">'
                        + (step.title ? '<h4 class="step-title">' + ML.escapeHtml(step.title) + '</h4>' : '')
                        + (step.text ? '<p class="step-text">' + ML.escapeHtml(step.text) + '</p>' : '')
                        + (step.latex ? '<div class="step-formula">$$' + step.latex + '$$</div>' : '')
                        + '</div>';
                    stepsContainer.appendChild(stepEl);
                });
            } else {
                stepsContainer.innerHTML = '<p class="result-empty-note">Пошаговое построение не предусмотрено для этой операции.</p>';
            }
        }

        // --- Секция 3. Результат ---
        var partsContainer = block.querySelector('[data-decomp-parts]');
        var checksBlock = block.querySelector('[data-decomp-checks]');
        var checksList = block.querySelector('[data-decomp-checks-list]');
        var reasonBlock = block.querySelector('[data-decomp-reason]');

        // Если разложение неприменимо
        if (extra.valid === false) {
            if (partsContainer) partsContainer.innerHTML = '';
            if (checksBlock) checksBlock.hidden = true;
            if (reasonBlock) {
                reasonBlock.hidden = false;
                reasonBlock.textContent = extra.reason || 'Разложение неприменимо для этой матрицы.';
            }
        } else {
            if (reasonBlock) reasonBlock.hidden = true;

            // Части разложения
            if (partsContainer) {
                partsContainer.innerHTML = '';
                var partsLatex = extra.parts_latex || {};

                Object.keys(result).forEach(function (name) {
                    var latex = partsLatex[name] || matrixToLatex(result[name]);

                    var part = document.createElement('div');
                    part.className = 'decomp-part';
                    part.innerHTML = ''
                        + '<div class="decomp-part-label">' + ML.escapeHtml(name) + ' =</div>'
                        + '<div class="decomp-part-body">$$' + latex + '$$</div>';
                    partsContainer.appendChild(part);
                });
            }

            // Проверки
            if (checksBlock && checksList) {
                checksList.innerHTML = '';
                var checks = [];

                if (extra.checks && typeof extra.checks === 'object') {
                    Object.keys(extra.checks).forEach(function (key) {
                        var val = extra.checks[key];
                        if (typeof val === 'boolean') {
                            checks.push({
                                name: key === 'reconstruction_ok'
                                    ? 'A восстановлена из частей'
                                    : (key === 'determinant_ok'
                                        ? 'Определитель совпадает'
                                        : (key === 'orthogonality_ok'
                                            ? 'Q ортогональна'
                                            : key)),
                                ok: val,
                            });
                        }
                    });
                }

                if (checks.length > 0) {
                    checks.forEach(function (c) {
                        var li = document.createElement('li');
                        li.innerHTML = '<span style="color:'
                            + (c.ok ? 'var(--success)' : 'var(--danger)')
                            + ';font-weight:700;">'
                            + (c.ok ? '✓' : '✗')
                            + '</span> <span>'
                            + ML.escapeHtml(c.name)
                            + '</span>';
                        checksList.appendChild(li);
                    });
                    checksBlock.hidden = false;
                } else {
                    checksBlock.hidden = true;
                }
            }
        }

        // MathJax + скролл
        ML.mathjax.typeset(block).then(function () {
            try {
                block.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (e) { /* noop */ }
        });
    }

    function renderError(block, message) {
        if (!block) return;
        block.hidden = false;
        block.classList.add('is-error');

        block.querySelectorAll('[data-result-section]').forEach(function (el) {
            el.style.display = 'none';
        });

        var errorEl = block.querySelector('[data-decomp-error]');
        var errMsg = block.querySelector('[data-decomp-error-message]');
        if (errorEl) {
            errorEl.hidden = false;
            errorEl.style.display = '';
        }
        if (errMsg) errMsg.textContent = message || 'Не удалось выполнить разложение.';
    }

    // =========================================================================
    // Инициализация
    // =========================================================================
    function init() {
        var runBtn = document.querySelector('[data-decomp-run]');
        var resetBtn = document.querySelector('[data-decomp-reset]');
        var resultBlock = document.querySelector('[data-decomp-result]');
        if (!runBtn || !resultBlock) return;

        var grid = document.querySelector('[data-matrix-input]');
        var matrixInput = grid ? ML.matrixInputs[grid.id] : null;

        var currentOp = 'lu';

        // Переключение кнопок выбора разложения
        ML.$$('[data-decomp]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                ML.$$('[data-decomp]').forEach(function (b) {
                    b.classList.toggle('is-active', b === btn);
                });
                currentOp = btn.dataset.decomp;
            });
        });

        // Запуск
        runBtn.addEventListener('click', async function () {
            if (!matrixInput) return;

            var matrix = matrixInput.read();
            if (isEmptyMatrix(matrix)) {
                ML.toast.warning('Пустая матрица', 'Заполните матрицу.');
                return;
            }

            var url = API[currentOp];
            if (!url) {
                ML.toast.error('Ошибка', 'Разложение «' + currentOp + '» не поддерживается.');
                return;
            }

            ML.loader.show('Разлагаем…');
            try {
                var resp = await ML.api.post(url, { matrix: matrix });
                renderDecomposition(resultBlock, resp, currentOp, matrix);

                if (resp.extra && resp.extra.valid === false) {
                    ML.toast.warning('Разложение неприменимо', resp.extra.reason || '');
                } else {
                    ML.toast.success('Готово', DECOMP_TITLES[currentOp] + ' выполнено.');
                }
            } catch (err) {
                renderError(resultBlock, err.message);
                ML.toast.error('Ошибка', err.message);
            } finally {
                ML.loader.hide();
            }
        });

        // Сброс
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                if (matrixInput) matrixInput.clear();
                if (resultBlock) resultBlock.hidden = true;
                var placeholder = document.querySelector('[data-decomp-placeholder]');
                if (placeholder) placeholder.hidden = false;
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();