/* =============================================================================
   MatrixLab — properties.js
   =============================================================================
   Страница /properties/ — анализ свойств матрицы.

   Отвечает за:
       • отправку матрицы на /api/matrix/properties/;
       • рендер ответа в блоке [data-props-result];
       • отображение задания (сама матрица в LaTeX);
       • сводку свойств (карточки «Название — Значение»);
       • спектр (собственные значения с кратностями);
       • опциональное вычисление собственных значений
         (флаг data-props-eigen);
       • обработку ошибок с показом блока [data-props-error];
       • очистку формы и скрытие результата.

   Зависимости: main.js, matrix.js, steps.js (для ML.mathjax).
   ============================================================================= */
(function () {
    'use strict';

    const ML = window.MatrixLab;
    if (!ML) return;

    const API_PROPERTIES = '/api/matrix/properties/';

    // =========================================================================
    // Утилиты
    // =========================================================================

    /** Проверка, что матрица пуста (все ячейки пустые). */
    function isEmptyMatrix(m) {
        if (!Array.isArray(m) || m.length === 0) return true;
        return m.every(function (row) {
            return row.every(function (v) { return v === ''; });
        });
    }

    /** Fallback: массив строк → LaTeX-матрица. */
    function matrixToLatex(data) {
        if (!Array.isArray(data) || !data.length) return '';
        const rows = data.map(function (row) {
            return row.map(function (v) { return String(v); }).join(' & ');
        });
        return '\\begin{bmatrix}' + rows.join(' \\\\ ') + '\\end{bmatrix}';
    }

    // =========================================================================
    // Отрисовка результата
    // =========================================================================

    /**
     * Отрисовать ответ анализа свойств в блоке result.
     *
     * @param {HTMLElement} block
     * @param {object} payload — ответ API
     * @param {Array} matrix — матрица в виде массива строк (для fallback LaTeX)
     */
    function renderPropertiesResult(block, payload, matrix) {
        if (!block) return;
        if (!payload) payload = {};

        block.hidden = false;
        block.classList.remove('is-error');

        const result = payload.result || {};

        // --- Задание: показать матрицу ---
        const taskFormula = block.querySelector('[data-props-task-formula]');
        if (taskFormula) {
            const latex = (payload.task && payload.task.matrix_latex)
                || matrixToLatex(matrix);
            taskFormula.innerHTML = '$$A = ' + latex + '$$';
        }

        // --- Сводка: карточки свойств ---
        const summaryEl = block.querySelector('[data-props-summary]');
        if (summaryEl) {
            summaryEl.innerHTML = '';

            const items = Array.isArray(result.summary) ? result.summary : [];

            items.forEach(function (item) {
                const div = document.createElement('div');
                div.className = 'prop-item';

                // Название
                const label = document.createElement('span');
                label.className = 'prop-item-label';
                label.textContent = item.label || '';

                // Значение
                const value = document.createElement('span');
                let valClass = 'prop-item-value';

                if (item.kind === 'bool') {
                    if (item.value === 'Да') {
                        valClass += ' prop-item-value--yes';
                    } else if (item.value === 'Не применимо') {
                        valClass += ' prop-item-value--na';
                    } else {
                        valClass += ' prop-item-value--no';
                    }
                } else {
                    valClass += ' prop-item-value--number';
                }
                value.className = valClass;

                if (item.value_latex) {
                    value.innerHTML = '$$' + item.value_latex + '$$';
                } else {
                    value.textContent = item.value;
                }

                div.appendChild(label);
                div.appendChild(value);
                summaryEl.appendChild(div);
            });
        }

        // --- Спектр ---
        const spectrumSection = block.querySelector('[data-props-spectrum-section]');
        const spectrumEl = block.querySelector('[data-props-spectrum]');
        const eigs = Array.isArray(result.eigenvalues) ? result.eigenvalues : [];

        if (spectrumSection && spectrumEl) {
            if (eigs.length > 0) {
                spectrumSection.hidden = false;
                spectrumEl.innerHTML = '';

                eigs.forEach(function (e) {
                    const div = document.createElement('div');
                    div.className = 'spectrum-item';

                    const value = document.createElement('span');
                    value.className = 'spectrum-value';
                    value.innerHTML = '$$' + (e.latex || '') + '$$';

                    const mults = document.createElement('span');
                    mults.className = 'spectrum-mults';

                    const multEl = document.createElement('span');
                    multEl.innerHTML = 'алг. кратность: <b>' + (e.mult || 1) + '</b>';

                    mults.appendChild(multEl);

                    div.appendChild(value);
                    div.appendChild(mults);
                    spectrumEl.appendChild(div);
                });
            } else {
                spectrumSection.hidden = true;
            }
        }

        // --- Скрыть блок ошибки ---
        const errorEl = block.querySelector('[data-props-error]');
        if (errorEl) errorEl.hidden = true;

        // --- Перерендерить MathJax и проскроллить ---
        ML.mathjax.typeset(block).then(function () {
            try {
                block.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (e) { /* noop */ }
        });
    }

    /** Показать блок ошибки в result. */
    function renderPropertiesError(block, message) {
        if (!block) return;
        block.hidden = false;
        block.classList.add('is-error');

        const errorEl = block.querySelector('[data-props-error]');
        const errMsgEl = block.querySelector('[data-props-error-message]');

        // Скрыть секции
        block.querySelectorAll('[data-result-section]').forEach(function (el) {
            el.style.display = 'none';
        });

        if (errorEl) {
            errorEl.hidden = false;
            errorEl.style.display = '';
        }
        if (errMsgEl) {
            errMsgEl.textContent = message || 'Не удалось выполнить анализ.';
        }
    }

    // =========================================================================
    // Инициализация
    // =========================================================================
    function init() {
        const runBtn = document.querySelector('[data-props-run]');
        const resetBtn = document.querySelector('[data-props-reset]');
        const resultBlock = document.querySelector('[data-props-result]');
        if (!runBtn || !resultBlock) return;

        const grid = document.querySelector('[data-matrix-input]');
        const matrixInput = grid ? ML.matrixInputs[grid.id] : null;

        // --- Запуск анализа ------------------------------------------------
        runBtn.addEventListener('click', async function () {
            if (!matrixInput) return;

            const matrix = matrixInput.read();
            if (isEmptyMatrix(matrix)) {
                ML.toast.warning('Пустая матрица', 'Заполните матрицу.');
                return;
            }

            // Считаем ли собственные значения
            const eigenToggle = document.querySelector('[data-props-eigen]');
            const withEigen = eigenToggle ? eigenToggle.checked : true;

            ML.loader.show('Анализируем…');
            try {
                const resp = await ML.api.post(API_PROPERTIES, {
                    matrix: matrix,
                    with_eigenvalues: withEigen,
                });

                // Сброс прежнего состояния ошибки
                const errorEl = resultBlock.querySelector('[data-props-error]');
                if (errorEl) {
                    errorEl.hidden = true;
                    errorEl.style.display = 'none';
                }
                resultBlock.querySelectorAll('[data-result-section]').forEach(function (el) {
                    el.style.display = '';
                    el.hidden = false;
                });

                renderPropertiesResult(resultBlock, resp, matrix);
                ML.toast.success('Готово', 'Свойства определены.');
            } catch (err) {
                renderPropertiesError(resultBlock, err.message);
                ML.toast.error('Ошибка', err.message);
            } finally {
                ML.loader.hide();
            }
        });

        // --- Сброс --------------------------------------------------------
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                if (matrixInput) matrixInput.clear();
                if (resultBlock) resultBlock.hidden = true;
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();