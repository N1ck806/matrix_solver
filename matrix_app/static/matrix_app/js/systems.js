/* =============================================================================
   MatrixLab — systems.js
   =============================================================================
   Страница /systems/ — решение СЛАУ и анализ по теореме Кронекера-Капелли.

   Отвечает за:
       • отправку матрицы A и вектора b на /api/system/solve/;
       • отправку матрицы A и вектора b на /api/system/kronecker/;
       • рендер решения (единственное / бесконечное / отсутствует);
       • рендер анализа совместности (ранги + вывод);
       • показ LaTeX задания: A и b;
       • загрузку предустановленных примеров СЛАУ;
       • обработку ошибок.

   Зависимости: main.js, matrix.js, steps.js.
   ============================================================================= */
(function () {
    'use strict';

    const ML = window.MatrixLab;
    if (!ML) return;

    // =========================================================================
    // URL API
    // =========================================================================
    const API_SOLVE = '/api/system/solve/';
    const API_KRONECKER = '/api/system/kronecker/';

    // =========================================================================
    // Утилиты
    // =========================================================================

    function isEmptyMatrix(m) {
        if (!Array.isArray(m) || m.length === 0) return true;
        return m.every(function (row) {
            return row.every(function (v) { return v === ''; });
        });
    }

    function isEmptyVector(v) {
        if (!Array.isArray(v) || v.length === 0) return true;
        return v.every(function (x) { return x === ''; });
    }

    /** Массив строк → LaTeX-матрица. */
    function matrixToLatex(data) {
        if (!Array.isArray(data) || !data.length) return '';
        const rows = data.map(function (row) {
            return row.map(function (v) { return String(v); }).join(' & ');
        });
        return '\\begin{bmatrix}' + rows.join(' \\\\ ') + '\\end{bmatrix}';
    }

    /** Массив → LaTeX-вектор-столбец. */
    function vectorToLatex(v) {
        if (!Array.isArray(v) || !v.length) return '';
        return '\\begin{bmatrix}'
            + v.map(function (x) { return String(x); }).join(' \\\\ ')
            + '\\end{bmatrix}';
    }

    /** Получить выбранный метод решения. */
    function getSelectedMethod() {
        const radio = document.querySelector('[data-system-method]:checked');
        return radio ? radio.value : 'auto';
    }

    /** Показывать ли пошаговое решение. */
    function getShowSteps() {
        const el = document.querySelector('[data-system-steps]');
        return el ? el.checked : true;
    }

    // =========================================================================
    // Сборка блока анализа Кронекера-Капелли
    // =========================================================================

    /**
     * Преобразовать ответ /api/system/kronecker/ в payload,
     * совместимый с ML.resultBlock.render.
     */
    function buildKroneckerPayload(resp) {
        const r = resp.result || {};
        const extra = resp.extra || {};
        const conclusion = r.conclusion || '';

        const steps = [];

        if (extra.augmented_latex) {
            steps.push({
                title: 'Расширенная матрица [A | b]',
                text: 'Составляем расширенную матрицу системы.',
                latex: extra.augmented_latex,
            });
        }

        if (extra.rref_latex) {
            steps.push({
                title: 'Приведённая ступенчатая форма',
                text: 'Приводим расширенную матрицу к RREF.',
                latex: extra.rref_latex,
            });
        }

        steps.push({
            title: 'Сравнение рангов',
            text: 'По теореме Кронекера-Капелли: если rank(A) = rank([A|b]), '
                + 'система совместна; иначе — несовместна.',
            latex: '\\operatorname{rank}(A) = ' + r.rank_a
                + ', \\quad \\operatorname{rank}([A|b]) = ' + r.rank_aug,
        });

        steps.push({
            title: 'Вывод',
            text: conclusion,
        });

        return {
            success: true,
            kind: 'text',
            result: r,
            explanation: resp.explanation || conclusion,
            extra: extra,
            task: resp.task || {},
            steps: steps,
        };
    }

    // =========================================================================
    // Инициализация
    // =========================================================================
    function init() {
        const runBtn = document.querySelector('[data-system-run]');
        const kronBtn = document.querySelector('[data-system-kronecker]');
        const resetBtn = document.querySelector('[data-system-reset]');
        const resultBlock = document.querySelector('[data-result-block]');
        if (!runBtn || !resultBlock) return;

        const gridA = document.querySelector('[data-matrix-input]');
        const vecEl = document.querySelector('[data-vector-input]');
        const miA = gridA ? ML.matrixInputs[gridA.id] : null;
        const vec = vecEl ? ML.vectorInputs[vecEl.id] : null;

        // =====================================================================
        // Решить систему
        // =====================================================================
        runBtn.addEventListener('click', async function () {
            if (!miA || !vec) return;

            const matrixA = miA.read();
            const vectorB = vec.read();

            if (isEmptyMatrix(matrixA)) {
                ML.toast.warning('Пустая матрица A', 'Заполните коэффициенты.');
                return;
            }
            if (isEmptyVector(vectorB)) {
                ML.toast.warning('Пустой вектор b', 'Заполните свободные члены.');
                return;
            }

            const method = getSelectedMethod();
            const showSteps = getShowSteps();

            ML.loader.show('Решаем систему…');
            try {
                const resp = await ML.api.post(API_SOLVE, {
                    matrix_a: matrixA,
                    vector_b: vectorB,
                    method: method,
                    show_steps: showSteps,
                });

                // Рендер результата через универсальный блок
                ML.resultBlock.render(resultBlock, resp, {
                    taskText: 'Решить систему Ax = b.',
                    taskLatex: 'A = ' + matrixToLatex(matrixA)
                        + ', \\quad b = ' + vectorToLatex(vectorB),
                });

                // Специальные тосты по типу решения
                const kind = resp.result && resp.result.kind;
                if (kind === 'unique') {
                    ML.toast.success('Единственное решение', '');
                } else if (kind === 'infinite') {
                    ML.toast.info('Бесконечно много решений', 'Система совместна, но не определена.');
                } else if (kind === 'none') {
                    ML.toast.warning('Решений нет', 'Система несовместна.');
                }
            } catch (err) {
                ML.resultBlock.renderError(resultBlock, err.message, err.code);
                ML.toast.error('Ошибка', err.message);
            } finally {
                ML.loader.hide();
            }
        });

        // =====================================================================
        // Проверить по Кронекеру-Капелли
        // =====================================================================
        if (kronBtn) {
            kronBtn.addEventListener('click', async function () {
                if (!miA || !vec) return;

                const matrixA = miA.read();
                const vectorB = vec.read();

                if (isEmptyMatrix(matrixA)) {
                    ML.toast.warning('Пустая матрица A', 'Заполните коэффициенты.');
                    return;
                }
                if (isEmptyVector(vectorB)) {
                    ML.toast.warning('Пустой вектор b', 'Заполните свободные члены.');
                    return;
                }

                ML.loader.show('Проверяем совместность…');
                try {
                    const resp = await ML.api.post(API_KRONECKER, {
                        matrix_a: matrixA,
                        vector_b: vectorB,
                    });

                    const payload = buildKroneckerPayload(resp);

                    ML.resultBlock.render(resultBlock, payload, {
                        taskText: 'Проверить совместность по теореме Кронекера-Капелли.',
                        taskLatex: 'A = ' + matrixToLatex(matrixA)
                            + ', \\quad b = ' + vectorToLatex(vectorB),
                    });

                    // Тост с выводом
                    const kind = resp.result && resp.result.kind;
                    const conclusion = resp.result && resp.result.conclusion;
                    if (kind === 'unique') {
                        ML.toast.success('Совместна', conclusion || '');
                    } else if (kind === 'infinite') {
                        ML.toast.info('Совместна, но не определена', conclusion || '');
                    } else {
                        ML.toast.warning('Несовместна', conclusion || '');
                    }
                } catch (err) {
                    ML.resultBlock.renderError(resultBlock, err.message, err.code);
                    ML.toast.error('Ошибка', err.message);
                } finally {
                    ML.loader.hide();
                }
            });
        }

        // =====================================================================
        // Сброс
        // =====================================================================
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                if (miA) miA.clear();
                if (vec) vec.clear();
                if (resultBlock) resultBlock.hidden = true;
            });
        }

        // =====================================================================
        // Загрузка примеров СЛАУ
        // =====================================================================
        document.addEventListener('click', async function (e) {
            const btn = e.target.closest('[data-load-system]');
            if (!btn) return;

            const slug = btn.dataset.loadSystem;
            if (!slug) return;

            ML.loader.show('Загружаем пример…');
            try {
                const resp = await ML.api.post('/api/example/' + slug + '/', {});
                const data = resp.result || {};

                if (data.matrix && miA) {
                    miA.setSize(data.matrix.length, data.matrix[0].length);
                    miA.write(data.matrix);
                }
                if (data.vector && vec) {
                    vec.write(data.vector);
                }

                ML.toast.success('Пример загружен', data.title || slug);
            } catch (err) {
                ML.toast.error('Не удалось загрузить', err.message);
            } finally {
                ML.loader.hide();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();