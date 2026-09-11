/* =============================================================================
   MatrixLab — steps.js
   =============================================================================
   Рендер универсального блока результата.

   Отвечает за:
       • ML.resultBlock — публичный API рендера результата;
       • отображение трёх секций: Задание / Решение / Результат;
       • пошаговые решения (шаги с формулами MathJax);
       • проверки результата (A·A⁻¹ = I, A·x = b и т.п.);
       • переключатель «Подробное решение / Краткий ответ»;
       • пояснение «Что это значит?» с markdown-разметкой;
       • рендер результатов всех типов:
           - scalar     (det, rank, trace);
           - matrix     (A+B, A·B, inverse, RREF, LU-части);
           - system     (СЛАУ: unique / infinite / none);
           - compare    (A ? B: equal, similar);
           - text       (спектр, разложения, общие объекты);
           - properties (анализ свойств матрицы).

   Публичный API:
       ML.resultBlock.render(block, payload, options)
       ML.resultBlock.renderError(block, message, code)
       ML.resultBlock.buildOutput(payload)

   Структура файла:
       1.  Локальные утилиты
       2.  Публичный рендер результата
       3.  Один шаг решения
       4.  buildOutput — роутер
       5.  buildSystemOutput — СЛАУ
       6.  buildCompareOutput — сравнение
       7.  buildEigenvaluesOutput — спектр
       8.  buildDecompositionOutput — разложения
       9.  buildPropertiesOutput — свойства
       10. renderError
       11. Переключатель вида
       12. Кнопка «Что это значит?»
       13. Мини-markdown
       14. Инициализация

   Зависимости: main.js.
   ============================================================================= */
(function () {
    'use strict';

    const ML = window.MatrixLab;
    if (!ML) return;

    // =========================================================================
    // 1. ЛОКАЛЬНЫЕ УТИЛИТЫ
    // =========================================================================

    /** Массив чисел/строк → LaTeX-матрица (fallback, если сервер не прислал latex). */
    function matrixToLatex(data) {
        if (!Array.isArray(data) || !data.length) return '';
        const rows = data.map(function (row) {
            if (!Array.isArray(row)) return '';
            return row.map(function (v) { return String(v); }).join(' & ');
        });
        return '\\begin{bmatrix}' + rows.join(' \\\\ ') + '\\end{bmatrix}';
    }

    /**
     * Собрать LaTeX-строку для секции «Задание» из payload.task.
     * Поддерживает: одну матрицу, две матрицы (A и B), СЛАУ (A и b),
     * цепочку N матриц.
     */
    function combineTaskLatex(payload, options) {
        if (options && options.taskLatex) return options.taskLatex;

        const task = payload.task || {};

        // Цепочка N матриц
        if (Array.isArray(task.matrices_latex) && task.matrices_latex.length > 0) {
            const op = task.operation_latex || '\\circ';
            return task.matrices_latex.join(' \\quad ' + op + ' \\quad ');
        }

        // Операции с двумя матрицами
        if (task.matrix_a_latex && task.matrix_b_latex) {
            const op = task.operation_latex || '\\circ';
            return task.matrix_a_latex + ' \\quad ' + op + ' \\quad ' + task.matrix_b_latex;
        }

        // СЛАУ: A и b
        if (task.matrix_latex && task.vector_latex) {
            return task.matrix_latex + ', \\quad b = ' + task.vector_latex;
        }

        // Одна матрица
        if (task.matrix_latex) {
            const op = task.operation_latex;
            if (op) return op + ' \\; : \\quad ' + task.matrix_latex;
            return task.matrix_latex;
        }

        return '';
    }

    // =========================================================================
    // 2. ПУБЛИЧНЫЙ РЕНДЕР РЕЗУЛЬТАТА
    // =========================================================================

    /**
     * Показать результат в блоке [data-result-block].
     *
     * @param {HTMLElement} block — контейнер [data-result-block]
     * @param {object} payload   — ответ API
     * @param {object} options   — { taskText, taskLatex }
     */
    function renderResult(block, payload, options) {
        if (!block) return;
        if (!payload) payload = {};
        if (!options) options = {};

        // --- Показать блок, снять класс ошибки
        block.hidden = false;
        block.classList.remove('is-error');

        // --- Скрыть блок ошибки
        const errorEl = block.querySelector('[data-result-error]');
        if (errorEl) {
            errorEl.hidden = true;
            errorEl.style.display = 'none';
        }

        // --- Восстановить все секции
        block.querySelectorAll('[data-result-section]').forEach(function (el) {
            el.style.display = '';
            el.hidden = false;
        });

        // --- Скрыть блок объяснения
        const explainBlock = block.querySelector('[data-result-explain-block]');
        if (explainBlock) explainBlock.hidden = true;

        // =====================================================================
        // Секция 1. Задание
        // =====================================================================
        const taskTextEl = block.querySelector('[data-result-task-text]');
        const taskFormulaEl = block.querySelector('[data-result-task-formula]');

        if (taskTextEl) {
            taskTextEl.textContent = options.taskText
                || (payload.extra && payload.extra.task_text)
                || 'Выполнить операцию.';
        }
        if (taskFormulaEl) {
            const taskLatex = combineTaskLatex(payload, options);
            taskFormulaEl.innerHTML = taskLatex ? ('$$' + taskLatex + '$$') : '';
        }

        // =====================================================================
        // Секция 2. Решение (пошагово)
        // =====================================================================
        const stepsEl = block.querySelector('[data-result-steps]');
        const stepsEmptyEl = block.querySelector('[data-result-steps-empty]');

        if (stepsEl) {
            Array.from(stepsEl.querySelectorAll('[data-step]')).forEach(function (n) {
                n.remove();
            });

            const steps = Array.isArray(payload.steps) ? payload.steps : [];
            if (steps.length > 0) {
                if (stepsEmptyEl) stepsEmptyEl.style.display = 'none';
                steps.forEach(function (step, idx) {
                    stepsEl.appendChild(renderStep(step, idx));
                });
            } else {
                if (stepsEmptyEl) stepsEmptyEl.style.display = '';
            }
        }

        // =====================================================================
        // Секция 3. Результат
        // =====================================================================
        const outputEl = block.querySelector('[data-result-output]');
        if (outputEl) {
            try {
                outputEl.innerHTML = buildOutput(payload);
            } catch (e) {
                console.error('Ошибка рендера результата:', e);
                outputEl.innerHTML = '<div style="color:var(--danger);">'
                    + 'Не удалось отобразить результат.</div>';
            }
        }

        // --- Проверки
        const checksEl = block.querySelector('[data-result-checks]');
        const checksListEl = block.querySelector('[data-result-checks-list]');
        if (checksEl && checksListEl) {
            checksListEl.innerHTML = '';
            const checks = Array.isArray(payload.checks) ? payload.checks : [];

            if (checks.length > 0) {
                checks.forEach(function (c) {
                    const li = document.createElement('li');
                    const ok = c.ok !== false;

                    const markSpan = document.createElement('span');
                    markSpan.style.color = ok ? 'var(--success)' : 'var(--danger)';
                    markSpan.style.fontWeight = '700';
                    markSpan.textContent = ok ? '✓' : '✗';

                    const nameSpan = document.createElement('span');
                    nameSpan.textContent = c.name || 'Проверка';

                    li.appendChild(markSpan);
                    li.appendChild(nameSpan);

                    if (c.latex) {
                        const formula = document.createElement('div');
                        formula.style.marginLeft = '24px';
                        formula.style.marginTop = '6px';
                        formula.innerHTML = '$$' + c.latex + '$$';
                        li.appendChild(formula);
                    }
                    checksListEl.appendChild(li);
                });
                checksEl.hidden = false;
            } else {
                checksEl.hidden = true;
            }
        }

        // --- Сохранить payload для кнопок копирования/экспорта
        const actionsEl = block.querySelector('[data-result-actions]');
        if (actionsEl) {
            try {
                actionsEl.dataset.payload = JSON.stringify(payload);
            } catch (e) {
                actionsEl.dataset.payload = '{}';
            }
        }

        // --- Объяснение «Что это значит?»
        const explainBody = block.querySelector('[data-result-explain-body]');
        if (explainBody) {
            explainBody.dataset.text = payload.explanation || '';
        }

        // --- Перерендерить формулы MathJax и плавно прокрутить
        ML.mathjax.typeset(block).then(function () {
            try {
                block.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (e) { /* noop */ }
        });
    }

    // =========================================================================
    // 3. ОДИН ШАГ РЕШЕНИЯ
    // =========================================================================

    function renderStep(step, idx) {
        const wrapper = document.createElement('article');
        wrapper.className = 'step';
        wrapper.setAttribute('data-step', '');

        const marker = document.createElement('div');
        marker.className = 'step-marker';

        const number = document.createElement('span');
        number.className = 'step-number';
        number.textContent = String(idx + 1);
        marker.appendChild(number);

        const content = document.createElement('div');
        content.className = 'step-content';

        if (step.title) {
            const title = document.createElement('h4');
            title.className = 'step-title';
            title.textContent = step.title;
            content.appendChild(title);
        }

        if (step.text) {
            const text = document.createElement('p');
            text.className = 'step-text';
            text.textContent = step.text;
            content.appendChild(text);
        }

        if (step.latex) {
            const formula = document.createElement('div');
            formula.className = 'step-formula';
            formula.innerHTML = '$$' + step.latex + '$$';
            content.appendChild(formula);
        }

        wrapper.appendChild(marker);
        wrapper.appendChild(content);
        return wrapper;
    }

    // =========================================================================
    // 4. buildOutput — РОУТЕР
    // =========================================================================

    function buildOutput(payload) {
        if (!payload) return '<div>Нет данных</div>';
        const kind = payload.kind;

        // --- Скаляр: det, rank, trace, значение
        if (kind === 'scalar') {
            const latex = payload.latex
                || String(payload.result === undefined ? '' : payload.result);
            return '<div style="font-size:1.1em;">$$' + latex + '$$</div>';
        }

        // --- Матрица: A+B, inverse, RREF, LU-части и т.п.
        if (kind === 'matrix') {
            let latex = payload.latex;
            if (!latex && Array.isArray(payload.result)) {
                latex = matrixToLatex(payload.result);
            }
            if (!latex) latex = '\\text{—}';
            return '<div>$$' + latex + '$$</div>';
        }

        // --- СЛАУ
        if (kind === 'system') {
            return buildSystemOutput(payload);
        }

        // --- Сравнение двух матриц (compare)
        if (kind === 'text'
            && payload.result
            && typeof payload.result === 'object'
            && !Array.isArray(payload.result)
            && ('equal' in payload.result || 'similar' in payload.result)) {
            return buildCompareOutput(payload.result);
        }

        // --- Спектр (eigenvalues)
        if (kind === 'text'
            && Array.isArray(payload.result)
            && payload.result[0]
            && payload.result[0].value_latex !== undefined) {
            return buildEigenvaluesOutput(payload.result);
        }

        // --- Разложения (объект частей)
        if (kind === 'text'
            && payload.result
            && typeof payload.result === 'object'
            && !Array.isArray(payload.result)) {
            return buildDecompositionOutput(payload);
        }

        // --- Свойства
        if (kind === 'properties') {
            return buildPropertiesOutput(payload.result);
        }

        // --- Общий fallback
        if (payload.latex) {
            return '<div>$$' + payload.latex + '$$</div>';
        }
        if (typeof payload.result === 'string') {
            return '<div>' + ML.escapeHtml(payload.result) + '</div>';
        }
        if (typeof payload.result === 'number') {
            return '<div>' + payload.result + '</div>';
        }
        if (Array.isArray(payload.result)
            || (payload.result && typeof payload.result === 'object')) {
            return '<pre style="overflow-x:auto;font-size:12px;line-height:1.4;">'
                + ML.escapeHtml(JSON.stringify(payload.result, null, 2))
                + '</pre>';
        }
        return '<div>' + ML.escapeHtml(
            String(payload.result === undefined ? '—' : payload.result)
        ) + '</div>';
    }

    // =========================================================================
    // 5. buildSystemOutput — СЛАУ
    // =========================================================================

    function buildSystemOutput(payload) {
        const r = payload.result || {};
        let html = '';

        if (r.kind === 'unique' && Array.isArray(r.solution)) {
            html += '<div class="result-solution-list">';
            r.solution.forEach(function (s) {
                html += '<div style="padding:6px 0;">$$'
                    + s.var_latex + ' = ' + s.value_latex
                    + '$$</div>';
            });
            html += '</div>';
        } else if (r.kind === 'infinite' && Array.isArray(r.parametric)) {
            html += '<div style="margin-bottom:12px;font-weight:600;">Общее решение:</div>';
            html += '<div class="result-solution-list">';
            r.parametric.forEach(function (s) {
                html += '<div style="padding:6px 0;">$$'
                    + s.var_latex + ' = ' + s.value_latex
                    + '$$</div>';
            });
            html += '</div>';
        } else if (r.kind === 'none') {
            html += '<div style="color:var(--danger);font-weight:600;">'
                + 'Система несовместна — решений нет.'
                + '</div>';
        }

        html += '<div style="margin-top:12px;font-size:0.9em;color:var(--text-secondary);">'
            + 'rank(A) = ' + r.rank_a
            + ', rank([A|b]) = ' + r.rank_aug
            + ', n = ' + r.n_vars
            + '</div>';

        return html;
    }

    // =========================================================================
    // 6. buildCompareOutput — СРАВНЕНИЕ ДВУХ МАТРИЦ
    // =========================================================================

    function buildCompareOutput(result) {
        if (!result || typeof result !== 'object') return '';

        function yesNo(v) {
            return v
                ? '<span style="color:var(--success);font-weight:700;">Да</span>'
                : '<span style="color:var(--danger);font-weight:700;">Нет</span>';
        }

        function esc(v) {
            return ML.escapeHtml(String(v === undefined || v === null ? '—' : v));
        }

        let html = '<div class="props-summary">';

        html += '<div class="prop-item">'
            + '<span class="prop-item-label">Размер A</span>'
            + '<span class="prop-item-value">' + esc(result.shape_a_label) + '</span>'
            + '</div>';

        html += '<div class="prop-item">'
            + '<span class="prop-item-label">Размер B</span>'
            + '<span class="prop-item-value">' + esc(result.shape_b_label) + '</span>'
            + '</div>';

        html += '<div class="prop-item">'
            + '<span class="prop-item-label">Одинаковый размер</span>'
            + '<span class="prop-item-value">' + yesNo(result.same_shape) + '</span>'
            + '</div>';

        html += '<div class="prop-item">'
            + '<span class="prop-item-label">A = B</span>'
            + '<span class="prop-item-value">' + yesNo(result.equal) + '</span>'
            + '</div>';

        html += '<div class="prop-item">'
            + '<span class="prop-item-label">A = Bᵀ</span>'
            + '<span class="prop-item-value">' + yesNo(result.equal_transpose) + '</span>'
            + '</div>';

        html += '<div class="prop-item">'
            + '<span class="prop-item-label">Подобные</span>'
            + '<span class="prop-item-value">' + yesNo(result.similar) + '</span>'
            + '</div>';

        html += '</div>';
        return html;
    }

    // =========================================================================
    // 7. buildEigenvaluesOutput — СПЕКТР
    // =========================================================================

    function buildEigenvaluesOutput(values) {
        let html = '<div class="eigen-values-list">';
        values.forEach(function (v) {
            html += '<div class="eigen-value-item">'
                + '<span class="eigen-value">$$' + v.latex + '$$</span>'
                + '<span class="eigen-value-mults">'
                + '<span>алг. кратность: <b>' + v.algebraic_multiplicity + '</b></span>'
                + '<span>геом. кратность: <b>' + v.geometric_multiplicity + '</b></span>'
                + '</span>'
                + '</div>';
        });
        html += '</div>';
        return html;
    }

    // =========================================================================
    // 8. buildDecompositionOutput — РАЗЛОЖЕНИЯ
    // =========================================================================

    function buildDecompositionOutput(payload) {
        const result = payload.result || {};
        const extra = payload.extra || {};
        const partsLatex = extra.parts_latex || {};

        // Разложение неприменимо
        if (extra.valid === false) {
            return '<div class="decomp-reason" style="display:block;">'
                + ML.escapeHtml(extra.reason || 'Разложение неприменимо.')
                + '</div>';
        }

        // Проверяем, что это действительно разложение:
        // либо есть parts_latex, либо все значения result — массивы (матрицы).
        const keys = Object.keys(result);
        const isDecomposition = keys.length > 0 && (
            Object.keys(partsLatex).length > 0
            || keys.every(function (k) { return Array.isArray(result[k]); })
        );

        if (!isDecomposition) {
            // Не разложение — отдаём общий fallback
            return '<pre style="overflow-x:auto;font-size:12px;line-height:1.4;">'
                + ML.escapeHtml(JSON.stringify(result, null, 2))
                + '</pre>';
        }

        let html = '<div class="decomp-parts">';
        keys.forEach(function (name) {
            const val = result[name];
            const latex = partsLatex[name]
                || (Array.isArray(val) ? matrixToLatex(val) : '');
            if (!latex) return;

            html += '<div class="decomp-part">'
                + '<div class="decomp-part-label">' + ML.escapeHtml(name) + ' =</div>'
                + '<div class="decomp-part-body">$$' + latex + '$$</div>'
                + '</div>';
        });
        html += '</div>';
        return html;
    }

    // =========================================================================
    // 9. buildPropertiesOutput — СВОЙСТВА
    // =========================================================================

    function buildPropertiesOutput(props) {
        if (!props || typeof props !== 'object') return '';
        let html = '<div class="props-summary">';

        const items = Array.isArray(props.summary) ? props.summary : [];

        items.forEach(function (item) {
            let valueClass = 'prop-item-value';

            if (item.kind === 'bool') {
                if (item.value === 'Да') valueClass += ' prop-item-value--yes';
                else if (item.value === 'Не применимо') valueClass += ' prop-item-value--na';
                else valueClass += ' prop-item-value--no';
            } else {
                valueClass += ' prop-item-value--number';
            }

            const valHtml = item.value_latex
                ? '<span class="' + valueClass + '">$$' + item.value_latex + '$$</span>'
                : '<span class="' + valueClass + '">' + ML.escapeHtml(item.value) + '</span>';

            html += '<div class="prop-item">'
                + '<span class="prop-item-label">' + ML.escapeHtml(item.label) + '</span>'
                + valHtml
                + '</div>';
        });

        html += '</div>';
        return html;
    }

    // =========================================================================
    // 10. renderError
    // =========================================================================

    function renderError(block, message, code) {
        if (!block) return;

        block.hidden = false;
        block.classList.add('is-error');

        const errorEl = block.querySelector('[data-result-error]');
        const msgEl = block.querySelector('[data-result-error-message]');

        block.querySelectorAll('[data-result-section], [data-result-explain-block]')
            .forEach(function (el) {
                el.style.display = 'none';
            });

        if (errorEl) {
            errorEl.hidden = false;
            errorEl.style.display = '';
        }
        if (msgEl) {
            msgEl.textContent = message || 'Не удалось выполнить операцию.';
        }

        try {
            block.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) { /* noop */ }
    }

    // =========================================================================
    // 11. ПЕРЕКЛЮЧАТЕЛЬ ВИДА
    // =========================================================================

    function initViewSwitcher() {
        document.addEventListener('click', function (e) {
            const btn = e.target.closest('[data-result-view]');
            if (!btn) return;

            const block = btn.closest('[data-result-block]');
            if (!block) return;

            const view = btn.dataset.resultView;

            block.querySelectorAll('[data-result-view]').forEach(function (b) {
                b.classList.toggle('is-active', b === btn);
                b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
            });

            const stepsSection = block.querySelector('[data-result-section="steps"]');
            if (stepsSection) {
                stepsSection.style.display = (view === 'brief') ? 'none' : '';
            }
        });
    }

    // =========================================================================
    // 12. КНОПКА «ЧТО ЭТО ЗНАЧИТ?»
    // =========================================================================

    function initExplainToggle() {
        document.addEventListener('click', function (e) {
            const btn = e.target.closest('[data-result-explain]');
            if (!btn) return;

            const block = btn.closest('[data-result-block]');
            if (!block) return;

            const explainBlock = block.querySelector('[data-result-explain-block]');
            const explainBody = block.querySelector('[data-result-explain-body]');
            if (!explainBlock || !explainBody) return;

            if (!explainBlock.hidden) {
                explainBlock.hidden = true;
                return;
            }

            const text = explainBody.dataset.text || 'Пояснение недоступно.';
            explainBody.innerHTML = markdownToHtml(text);
            explainBlock.hidden = false;
            ML.mathjax.typeset(explainBlock);
        });
    }

    // =========================================================================
    // 13. МИНИ-MARKDOWN
    // =========================================================================

    function markdownToHtml(md) {
        if (!md) return '';

        let html = ML.escapeHtml(md);

        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
        html = html.replace(/^---+$/gm, '<hr>');

        const lines = html.split('\n');
        const out = [];
        let inList = false;

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();

            if (/^[•\-\*]\s+/.test(trimmed)) {
                if (!inList) {
                    out.push('<ul>');
                    inList = true;
                }
                out.push('<li>' + trimmed.replace(/^[•\-\*]\s+/, '') + '</li>');
            } else {
                if (inList) {
                    out.push('</ul>');
                    inList = false;
                }
                if (trimmed === '') {
                    out.push('');
                } else {
                    out.push('<p>' + trimmed + '</p>');
                }
            }
        }
        if (inList) out.push('</ul>');

        return out.join('\n');
    }

    // =========================================================================
    // 14. ПУБЛИЧНЫЙ API + ИНИЦИАЛИЗАЦИЯ
    // =========================================================================
    ML.resultBlock = {
        render: renderResult,
        renderError: renderError,
        buildOutput: buildOutput,
    };

    function init() {
        initViewSwitcher();
        initExplainToggle();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();