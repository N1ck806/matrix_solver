/* =============================================================================
   MatrixLab — eigen.js
   =============================================================================
   Страница /eigen/ — спектр матрицы: собственные значения и векторы,
   характеристический многочлен, диагонализируемость.

   Отвечает за:
       • выбор операции через табы (eigenvalues / eigenvectors /
         char_poly / full);
       • отправку матрицы на соответствующий endpoint;
       • рендер 5 секций: Задание / Характеристический многочлен /
         Собственные значения / Собственные векторы / Диагонализируемость;
       • отображение инвариантов: сумма λᵢ = tr, произведение λᵢ = det;
       • обработку ошибок.

   Зависимости: main.js, matrix.js, steps.js.
   ============================================================================= */
(function () {
    'use strict';

    var ML = window.MatrixLab;
    if (!ML) return;

    var API = {
        eigenvalues:  '/api/matrix/eigenvalues/',
        eigenvectors: '/api/matrix/eigenvectors/',
        char_poly:    '/api/matrix/char-poly/',
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

    function resetResult(block) {
        // Показать все секции, скрыть ошибку
        block.hidden = false;
        block.classList.remove('is-error');

        block.querySelectorAll('[data-result-section]').forEach(function (el) {
            el.style.display = '';
            el.hidden = true; // Скрываем до заполнения
        });

        var errorEl = block.querySelector('[data-eigen-error]');
        if (errorEl) {
            errorEl.hidden = true;
            errorEl.style.display = 'none';
        }
    }

    function renderEigen(block, payload, op) {
        resetResult(block);

        var result = payload.result || {};
        var extra = payload.extra || {};
        var task = payload.task || {};

        // --- Секция 1. Задание ---
        var taskTextEl = block.querySelector('[data-eigen-task-text]');
        var taskFormulaEl = block.querySelector('[data-eigen-task-formula]');

        if (taskTextEl) {
            var opText = {
                eigenvalues: 'Найти собственные значения матрицы A.',
                eigenvectors: 'Найти собственные векторы матрицы A.',
                char_poly: 'Найти характеристический многочлен матрицы A.',
                full: 'Полный спектральный анализ матрицы A.',
            }[op] || 'Спектральный анализ матрицы A.';

            taskTextEl.textContent = opText;
        }
        if (taskFormulaEl && task.matrix_latex) {
            taskFormulaEl.innerHTML = '$$A = ' + task.matrix_latex + '$$';
        }

        var taskSection = block.querySelector('[data-result-section].result-section--task');
        if (taskSection) {
            taskSection.hidden = false;
            taskSection.style.display = '';
        }

        // --- Секция 2. Характеристический многочлен ---
        var charpolySection = block.querySelector('[data-eigen-charpoly]');
        var charpolyBody = block.querySelector('[data-eigen-charpoly-body]');
        var showCharpoly = (op === 'char_poly' || op === 'full' || op === 'eigenvalues');

        if (charpolySection && charpolyBody && showCharpoly) {
            var charLatex = extra.char_poly_latex || payload.latex || '';
            var factoredLatex = extra.char_poly_factored_latex || '';

            var html = '';
            if (charLatex) {
                html += '<div style="text-align:center;padding:12px 0;">'
                    + '$$p(\\lambda) = ' + charLatex + '$$'
                    + '</div>';
            }
            if (factoredLatex && factoredLatex !== charLatex) {
                html += '<div style="text-align:center;padding:12px 0;color:var(--text-secondary);">'
                    + 'Разложение на множители:'
                    + '</div>'
                    + '<div style="text-align:center;">'
                    + '$$p(\\lambda) = ' + factoredLatex + '$$'
                    + '</div>';
            }

            charpolyBody.innerHTML = html || '<p class="muted">Характеристический многочлен не был вычислен.</p>';
            charpolySection.hidden = false;
            charpolySection.style.display = '';
        }

        // --- Секция 3. Собственные значения ---
        var valuesSection = block.querySelector('[data-eigen-values]');
        var valuesBody = block.querySelector('[data-eigen-values-body]');
        var traceEl = block.querySelector('[data-eigen-trace]');
        var detEl = block.querySelector('[data-eigen-det]');

        if (valuesSection && valuesBody && Array.isArray(result) && result.length > 0
            && result[0].value_latex !== undefined) {

            valuesBody.innerHTML = '';
            result.forEach(function (item) {
                var div = document.createElement('div');
                div.className = 'eigen-value-item';
                div.innerHTML = '<span class="eigen-value">$$'
                    + item.latex
                    + '$$</span>'
                    + '<span class="eigen-value-mults">'
                    + '<span>алг. кратность: <b>' + item.algebraic_multiplicity + '</b></span>'
                    + '<span>геом. кратность: <b>' + item.geometric_multiplicity + '</b></span>'
                    + '</span>';
                valuesBody.appendChild(div);
            });

            if (traceEl) traceEl.textContent = extra.trace_check || '—';
            if (detEl) detEl.textContent = extra.det_check || '—';

            valuesSection.hidden = false;
            valuesSection.style.display = '';
        }

        // --- Секция 4. Собственные векторы ---
        var vecSection = block.querySelector('[data-eigen-vectors]');
        var vecBody = block.querySelector('[data-eigen-vectors-body]');

        if (vecSection && vecBody && Array.isArray(result) && result.length > 0
            && result[0].eigenvectors_latex !== undefined) {

            vecBody.innerHTML = '';
            result.forEach(function (item) {
                var group = document.createElement('div');
                group.className = 'eigen-vector-group';

                var head = '<div class="eigen-vector-group-head">'
                    + '<span class="eigen-vector-lambda">$$\\lambda = ' + item.value_latex + '$$</span>'
                    + '<span class="eigen-mult-badge">алг. кр.: ' + item.algebraic_multiplicity + '</span>'
                    + '<span class="eigen-mult-badge">геом. кр.: ' + item.geometric_multiplicity + '</span>'
                    + '</div>';

                var equations = '';
                if (Array.isArray(item.nullspace_equations) && item.nullspace_equations.length) {
                    equations = '<div class="eigen-vector-equations">'
                        + item.nullspace_equations.map(function (eq) {
                            return '<div>' + eq + '</div>';
                        }).join('')
                        + '</div>';
                }

                var basis = '<div class="eigen-vector-basis">';
                if (Array.isArray(item.eigenvectors_latex) && item.eigenvectors_latex.length) {
                    item.eigenvectors_latex.forEach(function (v) {
                        basis += '<div class="eigen-vector-item">$$v = ' + v + '$$</div>';
                    });
                } else {
                    basis += '<div class="eigen-vector-item muted">Собственные векторы не найдены.</div>';
                }
                basis += '</div>';

                group.innerHTML = head + equations + basis;
                vecBody.appendChild(group);
            });

            vecSection.hidden = false;
            vecSection.style.display = '';
        }

        // --- Секция 5. Диагонализируемость ---
        var diagSection = block.querySelector('[data-eigen-diagonalizable]');
        var diagBody = block.querySelector('[data-eigen-diag-body]');

        if (diagSection && diagBody && op === 'full' && extra.is_diagonalizable !== undefined) {
            var isDiag = extra.is_diagonalizable;
            var reason = extra.diagonalization_reason || '';

            diagBody.className = 'eigen-diag ' + (isDiag ? 'is-yes' : 'is-no');
            diagBody.innerHTML = '<strong>' + (isDiag ? 'Матрица диагонализируема' : 'Матрица не диагонализируема') + '</strong><br>'
                + ML.escapeHtml(reason);

            diagSection.hidden = false;
            diagSection.style.display = '';
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

        var errorEl = block.querySelector('[data-eigen-error]');
        var errMsg = block.querySelector('[data-eigen-error-message]');
        if (errorEl) {
            errorEl.hidden = false;
            errorEl.style.display = '';
        }
        if (errMsg) errMsg.textContent = message || 'Не удалось выполнить операцию.';
    }

    // =========================================================================
    // Инициализация
    // =========================================================================
    function init() {
        var runBtn = document.querySelector('[data-eigen-run]');
        var resetBtn = document.querySelector('[data-eigen-reset]');
        var resultBlock = document.querySelector('[data-eigen-result]');
        if (!runBtn || !resultBlock) return;

        var grid = document.querySelector('[data-matrix-input]');
        var matrixInput = grid ? ML.matrixInputs[grid.id] : null;

        var currentOp = 'eigenvalues';

        // Переключение табов
        ML.$$('[data-eigen-op]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                ML.$$('[data-eigen-op]').forEach(function (b) {
                    b.classList.toggle('is-active', b === btn);
                    b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
                });
                currentOp = btn.dataset.eigenOp;
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

            if (matrixInput.rows !== matrixInput.cols) {
                matrixInput.makeSquare();
                ML.toast.info('Размер подстроен', 'Матрица приведена к квадратной.');
            }

            // Для полного анализа: объединяем данные eigenvalues + eigenvectors
            if (currentOp === 'full') {
                ML.loader.show('Анализируем спектр…');
                try {
                    var results = await Promise.all([
                        ML.api.post(API.eigenvalues, { matrix: matrix }),
                        ML.api.post(API.eigenvectors, { matrix: matrix }),
                    ]);
                    var eigResp = results[0];
                    var vecResp = results[1];

                    // Объединяем результат
                    var merged = {
                        success: true,
                        kind: 'text',
                        result: vecResp.result,       // массив с eigenvectors
                        latex: eigResp.latex,
                        explanation: eigResp.explanation || '',
                        extra: Object.assign({}, eigResp.extra, vecResp.extra),
                        task: eigResp.task || vecResp.task,
                    };

                    renderEigen(resultBlock, merged, 'full');
                    ML.toast.success('Готово', 'Полный спектр найден.');
                } catch (err) {
                    renderError(resultBlock, err.message);
                    ML.toast.error('Ошибка', err.message);
                } finally {
                    ML.loader.hide();
                }
                return;
            }

            var url = API[currentOp];
            if (!url) {
                ML.toast.error('Ошибка', 'Операция «' + currentOp + '» не поддерживается.');
                return;
            }

            ML.loader.show('Вычисляем…');
            try {
                var resp = await ML.api.post(url, { matrix: matrix });
                renderEigen(resultBlock, resp, currentOp);
                ML.toast.success('Готово', 'Операция выполнена.');
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
                var placeholder = document.querySelector('[data-eigen-placeholder]');
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