/* =============================================================================
   MatrixLab — steps.js
   =============================================================================
   Универсальный рендер блока результата [data-result-block].

   Публичный API:
       ML.resultBlock.render(block, payload, options)
       ML.resultBlock.renderError(block, message, code)
       ML.resultBlock.renderSkeleton(block)
       ML.resultBlock.clear(block)
       ML.resultBlock.export(block, format)
       ML.resultBlock.buildOutput(payload)
       ML.resultBlock.buildPlainText(payload)   ← обёртка над ML.buildPlainText

   Поддерживаемые kind (через ML.resultRenderers):
       scalar       — det, rank, trace, значение
       matrix       — A+B, A·B, inverse, RREF, LU-части, транспонирование
       vector       — вектор-столбец
       system       — СЛАУ: unique / infinite / none
       compare      — A ? B: equal, transpose-equal, similar
       eigenvalues  — спектр с кратностями
       decomposition— LU, QR, Cholesky, диагонализация, спектральное
       properties   — анализ свойств
       text         — общий текстовый/структурированный результат

   Возможности:
       • три секции: Задание / Решение / Результат;
       • переключатель «Подробно / Кратко»;
       • пошаговые решения с MathJax;
       • проверки результата (✓ / ✗);
       • бейдж «Проверено», если verification.ok === true;
       • объяснение «Что это значит?» с безопасным mini-markdown;
       • сохранение payload в data-атрибут для export.js;
       • skeleton-загрузка;
       • корректная очистка и повторный рендер;
       • аккуратные ошибки с кодом и пояснением;
       • автоматический MathJax.typeset + плавный scroll;
       • делегированные обработчики переключателя и explain;
       • реестр рендереров ML.resultRenderers — можно расширять;
       • единый стиль через классы; никаких inline-стилей в логике.

   Зависимости: main.js (ML.mathjax, ML.escapeHtml, ML.format,
   ML.toast, ML.copy, ML.emit, ML.buildPlainText, ML.resultRenderers,
   ML.i18n).
   ============================================================================= */
(function () {
    'use strict';

    const ML = window.MatrixLab;
    if (!ML) {
        console.error('[steps.js] window.MatrixLab не найден — модуль не запущен.');
        return;
    }

    // =========================================================================
    // 1. УТИЛИТЫ
    // =========================================================================

    function esc(v) {
        return ML.escapeHtml(v === null || v === undefined ? '' : String(v));
    }

    function isArr(v) {
        return Array.isArray(v);
    }

    function isObj(v) {
        return v !== null && typeof v === 'object' && !Array.isArray(v);
    }

    /** Найти секцию по data-атрибуту */
    function section(block, name) {
        return block.querySelector('[data-result-section="' + name + '"]');
    }

    /** LaTeX задания (для секции «Задание») */
    function combineTaskLatex(payload, options) {
        if (options && options.taskLatex) return options.taskLatex;

        const task = payload.task || {};

        if (isArr(task.matrices_latex) && task.matrices_latex.length) {
            const op = task.operation_latex || '\\cdot';
            return task.matrices_latex.join(' \\; ' + op + ' \\; ');
        }
        if (task.matrix_a_latex && task.matrix_b_latex) {
            const op = task.operation_latex || '\\cdot';
            return 'A = ' + task.matrix_a_latex
                + ', \\quad B = ' + task.matrix_b_latex
                + ', \\quad ' + op;
        }
        if (task.matrix_latex && task.vector_latex) {
            return 'A = ' + task.matrix_latex
                + ', \\quad b = ' + task.vector_latex;
        }
        if (task.matrix_latex) {
            const op = task.operation_latex;
            return (op ? op + '\\;: \\quad ' : '') + 'A = ' + task.matrix_latex;
        }
        if (task.vector_latex) {
            return 'b = ' + task.vector_latex;
        }
        return '';
    }

    // =========================================================================
    // 2. ПУБЛИЧНЫЙ РЕНДЕР РЕЗУЛЬТАТА
    // =========================================================================

    function renderResult(block, payload, options) {
        if (!block) return;
        if (!payload) payload = {};
        if (!options) options = {};

        // --- Состояние блока
        block.hidden = false;
        block.classList.remove('is-error', 'is-loading');
        block.setAttribute('data-kind', payload.kind || 'text');

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

        // --- Скрыть explain-блок
        const explainBlock = block.querySelector('[data-result-explain-block]');
        if (explainBlock) explainBlock.hidden = true;

        // --- Бейдж verified
        renderVerifiedBadge(block, options.verified);

        // =====================================================================
        // Секция 1. Задание
        // =====================================================================
        const taskTextEl = block.querySelector('[data-result-task-text]');
        const taskFormulaEl = block.querySelector('[data-result-task-formula]');

        if (taskTextEl) {
            taskTextEl.textContent = options.taskText
                || (payload.extra && payload.extra.task_text)
                || ML.i18n.t('result.taskDefault', 'Выполнить операцию.');
        }
        if (taskFormulaEl) {
            const taskLatex = combineTaskLatex(payload, options);
            taskFormulaEl.innerHTML = taskLatex ? ('$$' + taskLatex + '$$') : '';
        }

        // =====================================================================
        // Секция 2. Решение
        // =====================================================================
        const stepsEl = block.querySelector('[data-result-steps]');
        const stepsEmptyEl = block.querySelector('[data-result-steps-empty]');

        if (stepsEl) {
            stepsEl.querySelectorAll('[data-step]').forEach(function (n) {
                n.remove();
            });

            const steps = isArr(payload.steps) ? payload.steps : [];
            if (steps.length > 0) {
                if (stepsEmptyEl) stepsEmptyEl.style.display = 'none';
                const frag = document.createDocumentFragment();
                steps.forEach(function (s, i) {
                    frag.appendChild(renderStep(s, i));
                });
                stepsEl.appendChild(frag);
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
                console.error('[resultBlock] buildOutput error:', e);
                outputEl.innerHTML = '<div class="result-render-error">'
                    + esc(ML.i18n.t('result.renderError',
                        'Не удалось отобразить результат.'))
                    + '</div>';
            }
        }

        // --- Проверки
        renderChecks(block, payload.checks);

        // --- Сохранить payload для export.js
        const actionsEl = block.querySelector('[data-result-actions]');
        if (actionsEl) {
            try { actionsEl.dataset.payload = JSON.stringify(payload); }
            catch (e) { actionsEl.dataset.payload = '{}'; }
        }

        // --- Объяснение
        const explainBody = block.querySelector('[data-result-explain-body]');
        if (explainBody) {
            explainBody.dataset.text = payload.explanation || '';
        }

        // --- MathJax + скролл
        ML.mathjax.typeset(block).then(function () {
            if (options.scroll !== false) {
                try {
                    block.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                } catch (e) { /* noop */ }
            }
            ML.emit('result:rendered', {
                block: block,
                payload: payload
            });
        });
    }

    // =========================================================================
    // 3. ШАГ РЕШЕНИЯ
    // =========================================================================

    function renderStep(step, idx) {
        const wrap = document.createElement('article');
        wrap.className = 'step';
        wrap.setAttribute('data-step', '');

        const marker = document.createElement('div');
        marker.className = 'step-marker';
        const num = document.createElement('span');
        num.className = 'step-number';
        num.textContent = String(idx + 1);
        marker.appendChild(num);

        const content = document.createElement('div');
        content.className = 'step-content';

        if (step.title) {
            const h = document.createElement('h4');
            h.className = 'step-title';
            h.textContent = step.title;
            content.appendChild(h);
        }
        if (step.text) {
            const p = document.createElement('p');
            p.className = 'step-text';
            p.textContent = step.text;
            content.appendChild(p);
        }
        if (step.latex) {
            const f = document.createElement('div');
            f.className = 'step-formula';
            f.innerHTML = '$$' + step.latex + '$$';
            content.appendChild(f);
        }
        if (step.note) {
            const n = document.createElement('div');
            n.className = 'step-note';
            n.textContent = step.note;
            content.appendChild(n);
        }

        wrap.appendChild(marker);
        wrap.appendChild(content);
        return wrap;
    }

    // =========================================================================
    // 4. БЕЙДЖ VERIFIED
    // =========================================================================

    function renderVerifiedBadge(block, verified) {
        let badge = block.querySelector('[data-result-verified]');

        if (verified === undefined || verified === null) {
            if (badge) badge.hidden = true;
            return;
        }

        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'result-verified-badge';
            badge.setAttribute('data-result-verified', '');
            const head = block.querySelector('[data-result-section="task"]');
            if (head && head.parentNode) {
                head.parentNode.insertBefore(badge, head);
            } else {
                block.insertBefore(badge, block.firstChild);
            }
        }

        badge.hidden = false;
        badge.classList.toggle('is-ok', !!verified);
        badge.classList.toggle('is-fail', !verified);
        badge.textContent = verified
            ? '✓ ' + ML.i18n.t('result.verified', 'Результат проверен')
            : '⚠ ' + ML.i18n.t('result.notVerified', 'Проверка не пройдена');
    }

    // =========================================================================
    // 5. ПРОВЕРКИ
    // =========================================================================

    function renderChecks(block, checks) {
        const checksEl = block.querySelector('[data-result-checks]');
        const listEl = block.querySelector('[data-result-checks-list]');
        if (!checksEl || !listEl) return;

        listEl.innerHTML = '';
        const list = isArr(checks) ? checks : [];

        if (!list.length) {
            checksEl.hidden = true;
            return;
        }

        const frag = document.createDocumentFragment();

        list.forEach(function (c) {
            const li = document.createElement('li');
            li.className = 'check-item '
                + (c.ok === false ? 'is-fail' : 'is-ok');

            const mark = document.createElement('span');
            mark.className = 'check-mark';
            mark.textContent = c.ok === false ? '✗' : '✓';

            const name = document.createElement('span');
            name.className = 'check-name';
            name.textContent = c.name || ML.i18n.t('result.check', 'Проверка');

            li.appendChild(mark);
            li.appendChild(name);

            if (c.latex) {
                const f = document.createElement('div');
                f.className = 'check-formula';
                f.innerHTML = '$$' + c.latex + '$$';
                li.appendChild(f);
            }
            frag.appendChild(li);
        });

        listEl.appendChild(frag);
        checksEl.hidden = false;
    }

    // =========================================================================
    // 6. РОУТЕР buildOutput
    // =========================================================================

    /**
     * Возвращает HTML для payload результата.
     * Сначала пытается использовать ML.resultRenderers (реестр рендереров).
     * Если для kind рендерера нет — использует fallback по умолчанию.
     */
    function buildOutput(payload) {
        if (!payload) {
            return '<div class="result-empty">'
                + esc(ML.i18n.t('result.empty', 'Нет данных'))
                + '</div>';
        }

        const kind = payload.kind || 'text';

        // Попытка через реестр
        const custom = ML.resultRenderers.render(kind, payload);
        if (custom != null) return custom;

        // Fallback по умолчанию
        switch (kind) {
            case 'scalar':        return buildScalarOutput(payload);
            case 'matrix':        return buildMatrixOutput(payload);
            case 'vector':        return buildVectorOutput(payload);
            case 'system':        return buildSystemOutput(payload);
            case 'compare':       return buildCompareOutput(payload.result);
            case 'eigenvalues':   return buildEigenvaluesOutput(payload.result);
            case 'decomposition': return buildDecompositionOutput(payload);
            case 'properties':    return buildPropertiesOutput(payload.result);
            case 'text':
                return buildTextWithAutoDetect(payload);
            default:
                if (payload.latex) {
                    return '<div class="result-latex-block">$$'
                        + payload.latex + '$$</div>';
                }
                return buildTextOutput(payload);
        }
    }

    function buildTextWithAutoDetect(payload) {
        if (isObj(payload.result) && 'equal' in payload.result) {
            return buildCompareOutput(payload.result);
        }
        if (isArr(payload.result) && payload.result[0]
            && payload.result[0].value_latex !== undefined) {
            return buildEigenvaluesOutput(payload.result);
        }
        if (isObj(payload.result) && payload.extra
            && payload.extra.parts_latex) {
            return buildDecompositionOutput(payload);
        }
        return buildTextOutput(payload);
    }

    // =========================================================================
    // 7. СКАЛЯР / МАТРИЦА / ВЕКТОР / ТЕКСТ
    // =========================================================================

    function buildScalarOutput(payload) {
        const latex = payload.latex
            || (payload.result === undefined ? '' : String(payload.result));
        return '<div class="result-scalar">$$' + latex + '$$</div>';
    }

    function buildMatrixOutput(payload) {
        let latex = payload.latex;
        if (!latex && isArr(payload.result)) {
            latex = ML.format.matrixToLatex(payload.result);
        }
        if (!latex) latex = '\\text{—}';
        return '<div class="result-matrix">$$' + latex + '$$</div>';
    }

    function buildVectorOutput(payload) {
        let latex = payload.latex;
        if (!latex && isArr(payload.result)) {
            latex = ML.format.matrixToLatex(payload.result);
        }
        if (!latex) latex = '\\text{—}';
        return '<div class="result-vector">$$' + latex + '$$</div>';
    }

    function buildTextOutput(payload) {
        if (payload.latex) {
            return '<div class="result-latex-block">$$'
                + payload.latex + '$$</div>';
        }
        if (typeof payload.result === 'string') {
            return '<div class="result-text">' + esc(payload.result) + '</div>';
        }
        if (typeof payload.result === 'number') {
            return '<div class="result-text">' + payload.result + '</div>';
        }
        if (isArr(payload.result) || isObj(payload.result)) {
            return '<pre class="result-json">'
                + esc(JSON.stringify(payload.result, null, 2))
                + '</pre>';
        }
        return '<div class="result-text">'
            + esc(payload.result === undefined ? '—' : payload.result)
            + '</div>';
    }

    // =========================================================================
    // 8. СЛАУ
    // =========================================================================

    function buildSystemOutput(payload) {
        const r = payload.result || {};
        let html = '';

        if (r.kind === 'unique' && isArr(r.solution)) {
            html += '<div class="result-solution-list">';
            r.solution.forEach(function (s) {
                html += '<div class="result-solution-item">$$'
                    + esc(s.var_latex) + ' = ' + esc(s.value_latex)
                    + '$$</div>';
            });
            html += '</div>';
        } else if (r.kind === 'infinite' && isArr(r.parametric)) {
            html += '<div class="result-solution-title">'
                + esc(ML.i18n.t('result.generalSolution', 'Общее решение:'))
                + '</div>';
            html += '<div class="result-solution-list">';
            r.parametric.forEach(function (s) {
                html += '<div class="result-solution-item">$$'
                    + esc(s.var_latex) + ' = ' + esc(s.value_latex)
                    + '$$</div>';
            });
            html += '</div>';
        } else if (r.kind === 'none') {
            html += '<div class="result-incompatible">'
                + esc(ML.i18n.t('result.incompatible',
                    'Система несовместна — решений нет.'))
                + '</div>';
        } else {
            html += buildTextOutput(payload);
        }

        if (r.rank_a !== undefined
            || r.rank_aug !== undefined
            || r.n_vars !== undefined) {
            html += '<div class="result-system-meta">'
                + 'rank(A) = ' + esc(r.rank_a)
                + ', rank([A|b]) = ' + esc(r.rank_aug)
                + ', n = ' + esc(r.n_vars)
                + '</div>';
        }
        return html;
    }

    // =========================================================================
    // 9. СРАВНЕНИЕ
    // =========================================================================

    function buildCompareOutput(result) {
        if (!isObj(result)) return buildTextOutput({ result: result });

        function yesNo(v) {
            return v
                ? '<span class="compare-yes">'
                    + esc(ML.i18n.t('common.yes', 'Да')) + '</span>'
                : '<span class="compare-no">'
                    + esc(ML.i18n.t('common.no', 'Нет')) + '</span>';
        }

        let html = '<div class="props-summary">';

        const rows = [
            [ML.i18n.t('result.sizeA', 'Размер A'),    result.shape_a_label],
            [ML.i18n.t('result.sizeB', 'Размер B'),    result.shape_b_label],
            [ML.i18n.t('result.sameShape', 'Одинаковый размер'),
                yesNo(result.same_shape)],
            ['A = B',                                  yesNo(result.equal)],
            ['A = Bᵀ',                                 yesNo(result.equal_transpose)],
            [ML.i18n.t('result.similar', 'Подобные'),  yesNo(result.similar)]
        ];

        rows.forEach(function (r) {
            if (r[1] === undefined || r[1] === null) return;
            html += '<div class="prop-item">'
                + '<span class="prop-item-label">' + esc(r[0]) + '</span>'
                + '<span class="prop-item-value">' + r[1] + '</span>'
                + '</div>';
        });

        html += '</div>';
        return html;
    }

    // =========================================================================
    // 10. СПЕКТР
    // =========================================================================

    function buildEigenvaluesOutput(values) {
        if (!isArr(values) || !values.length) {
            return buildTextOutput({ result: values });
        }
        let html = '<div class="eigen-values-list">';
        values.forEach(function (v) {
            html += '<div class="eigen-value-item">'
                + '<span class="eigen-value">$$' + esc(v.latex) + '$$</span>'
                + '<span class="eigen-value-mults">'
                + '<span>' + esc(ML.i18n.t('result.algMult',
                    'алг. кратность')) + ': <b>'
                + esc(v.algebraic_multiplicity) + '</b></span>'
                + '<span>' + esc(ML.i18n.t('result.geoMult',
                    'геом. кратность')) + ': <b>'
                + esc(v.geometric_multiplicity) + '</b></span>'
                + '</span>'
                + '</div>';
        });
        html += '</div>';
        return html;
    }

    // =========================================================================
    // 11. РАЗЛОЖЕНИЯ
    // =========================================================================

    function buildDecompositionOutput(payload) {
        const result = payload.result || {};
        const extra = payload.extra || {};
        const partsLatex = extra.parts_latex || {};

        if (extra.valid === false) {
            return '<div class="decomp-reason">'
                + esc(extra.reason
                    || ML.i18n.t('result.decompNotApplicable',
                        'Разложение неприменимо.'))
                + '</div>';
        }

        const keys = Object.keys(result);
        if (!keys.length) return buildTextOutput(payload);

        let html = '<div class="decomp-parts">';
        keys.forEach(function (name) {
            const val = result[name];
            const latex = partsLatex[name]
                || (isArr(val) ? ML.format.matrixToLatex(val) : '');
            if (!latex) return;
            html += '<div class="decomp-part">'
                + '<div class="decomp-part-label">' + esc(name) + ' =</div>'
                + '<div class="decomp-part-body">$$' + latex + '$$</div>'
                + '</div>';
        });
        html += '</div>';
        return html;
    }

    // =========================================================================
    // 12. СВОЙСТВА
    // =========================================================================

    function buildPropertiesOutput(props) {
        if (!isObj(props)) return buildTextOutput({ result: props });
        let html = '<div class="props-summary">';

        const items = isArr(props.summary) ? props.summary : [];

        items.forEach(function (item) {
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

            const valHtml = item.value_latex
                ? '<span class="' + valClass + '">$$'
                    + item.value_latex + '$$</span>'
                : '<span class="' + valClass + '">'
                    + esc(item.value) + '</span>';

            html += '<div class="prop-item">'
                + '<span class="prop-item-label">' + esc(item.label) + '</span>'
                + valHtml
                + '</div>';
        });

        html += '</div>';
        return html;
    }

    // =========================================================================
    // 13. РЕГИСТРАЦИЯ ВСТРОЕННЫХ РЕНДЕРЕРОВ
    // =========================================================================

    ML.resultRenderers.register('scalar',        buildScalarOutput);
    ML.resultRenderers.register('matrix',        buildMatrixOutput);
    ML.resultRenderers.register('vector',        buildVectorOutput);
    ML.resultRenderers.register('system',        buildSystemOutput);
    ML.resultRenderers.register('compare',       function (p) {
        return buildCompareOutput(p.result);
    });
    ML.resultRenderers.register('eigenvalues',   function (p) {
        return buildEigenvaluesOutput(p.result);
    });
    ML.resultRenderers.register('decomposition', buildDecompositionOutput);
    ML.resultRenderers.register('properties',    function (p) {
        return buildPropertiesOutput(p.result);
    });
    ML.resultRenderers.register('text',          buildTextWithAutoDetect);

    // =========================================================================
    // 14. SKELETON / CLEAR / ERROR
    // =========================================================================

    function renderSkeleton(block) {
        if (!block) return;
        block.hidden = false;
        block.classList.add('is-loading');
        block.classList.remove('is-error');

        const output = block.querySelector('[data-result-output]');
        if (output) {
            output.innerHTML = ''
                + '<div class="skeleton skeleton-line"></div>'
                + '<div class="skeleton skeleton-line"></div>'
                + '<div class="skeleton skeleton-line short"></div>';
        }

        const errorEl = block.querySelector('[data-result-error]');
        if (errorEl) errorEl.hidden = true;
    }

    function clearResult(block) {
        if (!block) return;
        block.hidden = true;
        block.classList.remove('is-error', 'is-loading');

        block.querySelectorAll('[data-result-section]').forEach(function (el) {
            el.style.display = '';
            el.hidden = false;
        });

        const output = block.querySelector('[data-result-output]');
        if (output) output.innerHTML = '';

        const stepsEl = block.querySelector('[data-result-steps]');
        if (stepsEl) {
            stepsEl.querySelectorAll('[data-step]').forEach(function (n) {
                n.remove();
            });
        }

        const listEl = block.querySelector('[data-result-checks-list]');
        if (listEl) listEl.innerHTML = '';

        const checksEl = block.querySelector('[data-result-checks]');
        if (checksEl) checksEl.hidden = true;

        const badge = block.querySelector('[data-result-verified]');
        if (badge) badge.hidden = true;

        const actionsEl = block.querySelector('[data-result-actions]');
        if (actionsEl) actionsEl.dataset.payload = '';

        const explainBlock = block.querySelector('[data-result-explain-block]');
        if (explainBlock) explainBlock.hidden = true;
    }

    function renderError(block, message, code) {
        if (!block) return;

        block.hidden = false;
        block.classList.add('is-error');
        block.classList.remove('is-loading');

        const errorEl = block.querySelector('[data-result-error]');
        const msgEl = block.querySelector('[data-result-error-message]');
        const codeEl = block.querySelector('[data-result-error-code]');

        block.querySelectorAll(
            '[data-result-section], [data-result-explain-block]'
        ).forEach(function (el) {
            el.style.display = 'none';
            el.hidden = true;
        });

        if (errorEl) {
            errorEl.hidden = false;
            errorEl.style.display = '';
        }
        if (msgEl) {
            msgEl.textContent = message
                || ML.i18n.t('result.error',
                    'Не удалось выполнить операцию.');
        }
        if (codeEl) {
            if (code) {
                codeEl.hidden = false;
                codeEl.textContent = 'Код: ' + code;
            } else {
                codeEl.hidden = true;
                codeEl.textContent = '';
            }
        }

        try {
            block.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) { /* noop */ }

        ML.emit('result:error', {
            block: block,
            message: message,
            code: code
        });
    }

    // =========================================================================
    // 15. ЭКСПОРТ PAYLOAD
    // =========================================================================

    function exportPayload(block, format) {
        if (!block) return;
        const actions = block.querySelector('[data-result-actions]');
        if (!actions || !actions.dataset.payload) {
            ML.toast.warning(
                ML.i18n.t('result.noData', 'Нет данных'),
                ML.i18n.t('result.runFirst', 'Сначала выполните операцию.')
            );
            return;
        }

        let payload;
        try { payload = JSON.parse(actions.dataset.payload); }
        catch (e) {
            ML.toast.error(
                ML.i18n.t('result.dataError', 'Ошибка данных'),
                ML.i18n.t('result.invalidPayload', 'Некорректный payload.')
            );
            return;
        }

        // Делегируем в export.js для сложных форматов (PDF/TeX)
        if (ML.export && typeof ML.export.openDialog === 'function'
            && format !== 'text'
            && format !== 'latex'
            && format !== 'json') {
            ML.export.openDialog(payload);
            return;
        }

        switch (format) {
            case 'text':
                ML.copy.text(
                    ML.buildPlainText(payload),
                    ML.i18n.t('result.reportCopied', 'Отчёт скопирован')
                );
                break;
            case 'latex':
                ML.copy.latex(
                    payload.latex || '',
                    ML.i18n.t('result.latexCopied', 'LaTeX скопирован')
                );
                break;
            case 'json':
                ML.copy.json(
                    payload,
                    ML.i18n.t('result.jsonCopied', 'JSON скопирован')
                );
                break;
            default:
                ML.copy.json(
                    payload,
                    ML.i18n.t('result.payloadCopied', 'Payload скопирован')
                );
        }
    }

    // =========================================================================
    // 16. ПЕРЕКЛЮЧАТЕЛЬ ВИДА (Подробно / Кратко)
    // =========================================================================

    function initViewSwitcher() {
        document.addEventListener('click', function (e) {
            const btn = e.target.closest('[data-result-view]');
            if (!btn) return;

            const block = btn.closest('[data-result-block]');
            if (!block) return;

            const view = btn.dataset.resultView;

            block.querySelectorAll('[data-result-view]').forEach(function (b) {
                const active = b === btn;
                b.classList.toggle('is-active', active);
                b.setAttribute('aria-selected', active ? 'true' : 'false');
            });

            const stepsSection = section(block, 'steps');
            if (stepsSection) {
                stepsSection.hidden = (view === 'brief');
                stepsSection.style.display = (view === 'brief') ? 'none' : '';
            }

            ML.emit('result:view', { view: view, block: block });
        });
    }

    // =========================================================================
    // 17. КНОПКА «ЧТО ЭТО ЗНАЧИТ?»
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

            const text = explainBody.dataset.text
                || ML.i18n.t('result.noExplanation',
                    'Пояснение недоступно.');
            explainBody.innerHTML = markdownToHtml(text);
            explainBlock.hidden = false;
            ML.mathjax.typeset(explainBlock);
        });
    }

    // =========================================================================
    // 18. БЕЗОПАСНЫЙ МИНИ-MARKDOWN
    // =========================================================================

    /**
     * Очень ограниченный markdown:
     *   `code`, **bold**, *italic*, --- (hr), • / - / * (список)
     *
     * Безопасность:
     *   1. Экранируем весь вход.
     *   2. Применяем замены только к уже экранированному тексту.
     *   3. Никаких <a href> и произвольных тегов.
     *   4. LaTeX ($$...$$) не трогаем — его обработает MathJax.
     */
    function markdownToHtml(md) {
        if (!md) return '';

        // Шаг 1. Экранирование всего входа
        let html = ML.escapeHtml(String(md));

        // Шаг 2. Защищаем LaTeX-блоки от обработки
        const latexPlaceholders = [];
        html = html.replace(/\$\$([^$]+)\$\$/g, function (_, inner) {
            const id = '\u0000LATEX' + latexPlaceholders.length + '\u0000';
            latexPlaceholders.push(inner);
            return id;
        });
        html = html.replace(/\$([^$\n]+)\$/g, function (_, inner) {
            const id = '\u0000LATEX' + latexPlaceholders.length + '\u0000';
            latexPlaceholders.push(inner);
            return id;
        });

        // Шаг 3. Простые замены
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
        html = html.replace(/^---+$/gm, '<hr>');

        // Шаг 4. Списки и параграфы
        const lines = html.split('\n');
        const out = [];
        let inList = false;

        for (let i = 0; i < lines.length; i++) {
            const t = lines[i].trim();

            if (/^[•\-\*]\s+/.test(t)) {
                if (!inList) { out.push('<ul>'); inList = true; }
                out.push('<li>' + t.replace(/^[•\-\*]\s+/, '') + '</li>');
            } else {
                if (inList) { out.push('</ul>'); inList = false; }
                if (t === '') out.push('');
                else out.push('<p>' + t + '</p>');
            }
        }
        if (inList) out.push('</ul>');

        // Шаг 5. Восстанавливаем LaTeX
        let result = out.join('\n');
        result = result.replace(/\u0000LATEX(\d+)\u0000/g, function (_, num) {
            const inner = latexPlaceholders[parseInt(num, 10)];
            return '$$' + inner + '$$';
        });

        return result;
    }

    // =========================================================================
    // 19. ДЕЛЕГИРОВАНИЕ ЭКСПОРТА
    // =========================================================================

    function initExportDelegation() {
        document.addEventListener('click', function (e) {
            const btn = e.target.closest('[data-result-export]');
            if (!btn) return;
            const block = btn.closest('[data-result-block]');
            if (!block) return;
            e.preventDefault();
            exportPayload(block, btn.dataset.resultExport || 'text');
        });
    }

    // =========================================================================
    // 20. ПУБЛИЧНЫЙ API
    // =========================================================================

    ML.resultBlock = {
        render:         renderResult,
        renderError:    renderError,
        renderSkeleton: renderSkeleton,
        clear:          clearResult,
        buildOutput:    buildOutput,
        export:         exportPayload,
        buildPlainText: ML.buildPlainText
    };

    // =========================================================================
    // 21. ИНИЦИАЛИЗАЦИЯ
    // =========================================================================

    let _initialized = false;

    function init() {
        if (_initialized) return;
        _initialized = true;

        initViewSwitcher();
        initExplainToggle();
        initExportDelegation();

        ML.emit('resultBlock:ready', {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();