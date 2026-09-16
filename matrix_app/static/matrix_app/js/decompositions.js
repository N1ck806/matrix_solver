/* =============================================================================
   MatrixLab — decompositions.js
   =============================================================================
   Страница /decompositions/ — LU, QR, Холецкий, диагонализация, спектральное.

   Публичный API:
       ML.decompositions.mount(root)
       ML.decompositions.run(root, ctx)
       ML.decompositions.runOperation(op, ctx)
       ML.decompositions.updateRunButtonState(root)
       ML.decompositions.setOperation(op, root)
       ML.decompositions.getOperation()
       ML.decompositions.list()
       ML.decompositions.cleanupMissingIcons(scope)
       ML.decompositions.clear(root)
       ML.decompositions.render(root, payload, opts)
       ML.decompositions.renderError(root, message, code)

   ВАЖНО:
       Раньше здесь вызывался ML.resultBlock.render(), который ищет секции
       по [data-result-section] / [data-result-output]. На этой странице
       своя разметка [data-decomp-*] — рендер уходил «в никуда», и блок
       результата оставался пустым. Теперь всё рисуется в свои селекторы.

   Зависимости: main.js, matrix.js, steps.js (для ML.mathjax).
   ============================================================================= */
(function () {
    'use strict';

    const ML = window.MatrixLab;
    if (!ML) {
        console.error('[decompositions.js] window.MatrixLab не найден — модуль не запущен.');
        return;
    }

    // =========================================================================
    // 1. РЕЕСТР РАЗЛОЖЕНИЙ
    // =========================================================================

    const DECOMPS = {
        lu: {
            url: '/api/matrix/lu/',
            label: 'LU-разложение',
            equation: 'A = L \\cdot U',
            square: true,
            autoSquare: true
        },
        qr: {
            url: '/api/matrix/qr/',
            label: 'QR-разложение',
            equation: 'A = Q \\cdot R',
            square: false,
            autoSquare: false
        },
        cholesky: {
            url: '/api/matrix/cholesky/',
            label: 'Разложение Холецкого',
            equation: 'A = L \\cdot L^{T}',
            square: true,
            autoSquare: true,
            symmetric: true
        },
        diagonalize: {
            url: '/api/matrix/diagonalize/',
            label: 'Диагонализация',
            equation: 'A = P \\cdot D \\cdot P^{-1}',
            square: true,
            autoSquare: true
        },
        spectral: {
            url: '/api/matrix/spectral/',
            label: 'Спектральное разложение',
            equation: 'A = Q \\cdot D \\cdot Q^{T}',
            square: true,
            autoSquare: true,
            symmetric: true
        }
    };

    function decompInfo(op) {
        return DECOMPS[op] || { url: null, label: op };
    }

    // =========================================================================
    // 2. УТИЛИТЫ
    // =========================================================================

    function tr(key, fallback) {
        return ML.i18n.t(key, fallback);
    }

    function isArr(v) { return Array.isArray(v); }

    function isObj(v) {
        return v !== null && typeof v === 'object' && !Array.isArray(v);
    }

    function esc(v) {
        return ML.escapeHtml(v === null || v === undefined ? '' : String(v));
    }

    function isEmptyMatrix(m) {
        return ML.validators.isEmptyMatrix(m);
    }

    function isSymmetric(matrix) {
        if (!isArr(matrix) || !matrix.length) return false;
        const n = matrix.length;
        for (let i = 0; i < n; i++) {
            if (!isArr(matrix[i]) || matrix[i].length !== n) return false;
        }
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const a = String(matrix[i][j] || '').trim();
                const b = String(matrix[j][i] || '').trim();
                if (a !== b) return false;
            }
        }
        return true;
    }

    function findMatrixInput(root) {
        const scope = root || document;
        const grid = scope.querySelector('[data-matrix-input]');
        if (!grid) return null;
        return ML.matrixInputs[grid.id] || null;
    }

    function findResultBlock(root) {
        const scope = root || document;
        return scope.querySelector('[data-decomp-result]')
            || scope.querySelector('[data-result-block]');
    }

    function findRunBtn(root) {
        const scope = root || document;
        return scope.querySelector('[data-decomp-run]');
    }

    function findResetBtn(root) {
        const scope = root || document;
        return scope.querySelector('[data-decomp-reset]');
    }

    function closeModalIfAny(btn) {
        const modal = btn && btn.closest('.modal');
        if (modal && ML.modal) {
            setTimeout(function () {
                ML.modal.close('#' + modal.id);
            }, 200);
        }
    }

    function cleanupMissingIcons(scope) {
        const s = scope || document;

        ML.$$('.ml-icon--missing', s).forEach(function (el) {
            el.remove();
        });

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
                .replace(/<span[^>]*ml-icon[^>]*><\/span>/g, '')
                .replace(/&lt;span[^&]*ml-icon[^&]*&gt;&lt;\/span&gt;/g, '')
                .trim();
        });
    }

    // =========================================================================
    // 3. ТЕКУЩАЯ ОПЕРАЦИЯ
    // =========================================================================

    let currentOp = 'lu';

    function setOperation(op, root) {
        if (!DECOMPS[op]) return;
        currentOp = op;
        const scope = root || document;

        ML.$$('[data-decomp]', scope).forEach(function (b) {
            const active = b.dataset.decomp === op;
            b.classList.toggle('is-active', active);
            b.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        autoResizeForCurrent(scope);
        updateRunButtonState(scope);
        ML.emit('decomposition:operation', { op: op });
    }

    function getOperation() { return currentOp; }

    function listOperations() { return Object.keys(DECOMPS); }

    // =========================================================================
    // 4. АВТО-ПОДГОНКА РАЗМЕРА
    // =========================================================================

    function autoResizeForCurrent(scope) {
        const info = decompInfo(currentOp);
        if (!info.autoSquare) return;

        const mi = findMatrixInput(scope);
        if (!mi) return;

        if (mi.rows !== mi.cols) {
            const n = Math.max(mi.rows, mi.cols);
            mi.setSize(n, n, { preserve: true });

            ML.toast.info(
                tr('decomp.sizeAdjusted', 'Размер подстроен'),
                tr('decomp.matrix', 'Матрица') + ' ' + n + ' × ' + n
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
            runBtn.title = tr('decomp.editorNotFound',
                'Редактор матрицы не найден');
            runBtn.setAttribute('aria-disabled', 'true');
            return;
        }

        const info = decompInfo(currentOp);
        const matrix = mi.read();
        const empty = isEmptyMatrix(matrix);
        const invalid = mi.hasInvalid && mi.hasInvalid();
        const notSquare = info.square && mi.rows !== mi.cols;
        const notSymmetric = info.symmetric && !empty && !isSymmetric(matrix);

        runBtn.disabled = empty || invalid || notSquare || notSymmetric;

        if (invalid) {
            runBtn.title = tr('decomp.invalidValues',
                'Некорректные значения в матрице');
        } else if (empty) {
            runBtn.title = tr('decomp.fillMatrix', 'Заполните матрицу');
        } else if (notSquare) {
            runBtn.title = tr('decomp.needSquareFor',
                'Нужна квадратная матрица для') + ' «'
                + info.label + '»';
        } else if (notSymmetric) {
            runBtn.title = tr('decomp.needSymmetric',
                'Нужна симметричная матрица (A = Aᵀ)');
        } else {
            runBtn.title = tr('decomp.run', 'Выполнить') + ' ' + info.label;
        }

        runBtn.setAttribute('aria-disabled', String(runBtn.disabled));
    }

    // =========================================================================
    // 6. РЕНДЕР РЕЗУЛЬТАТА
    // =========================================================================

    function clearRendered(root) {
        const scope = root || document;
        const block = findResultBlock(scope);
        if (!block) return;

        block.hidden = true;

        const taskText = block.querySelector('[data-decomp-task-text]');
        if (taskText) taskText.textContent = '';

        const taskFormula = block.querySelector('[data-decomp-task-formula]');
        if (taskFormula) taskFormula.innerHTML = '';

        const steps = block.querySelector('[data-decomp-steps]');
        if (steps) steps.innerHTML = '';

        const parts = block.querySelector('[data-decomp-parts]');
        if (parts) parts.innerHTML = '';

        const checks = block.querySelector('[data-decomp-checks]');
        if (checks) checks.hidden = true;

        const checksList = block.querySelector('[data-decomp-checks-list]');
        if (checksList) checksList.innerHTML = '';

        const reason = block.querySelector('[data-decomp-reason]');
        if (reason) {
            reason.hidden = true;
            reason.textContent = '';
        }

        const actions = block.querySelector('[data-decomp-actions]');
        if (actions) actions.hidden = true;

        const error = block.querySelector('[data-decomp-error]');
        if (error) error.hidden = true;

        const errorMsg = block.querySelector('[data-decomp-error-message]');
        if (errorMsg) errorMsg.textContent = '';

        // Показываем все секции обратно
        block.querySelectorAll('.result-section').forEach(function (s) {
            s.hidden = false;
        });
    }

    function renderError(root, message, code) {
        const scope = root || document;
        const block = findResultBlock(scope);
        if (!block) return;

        block.hidden = false;

        // Скрываем нормальные секции — оставляем только ошибку
        block.querySelectorAll('.result-section').forEach(function (s) {
            s.hidden = true;
        });

        const reason = block.querySelector('[data-decomp-reason]');
        if (reason) reason.hidden = true;

        const error = block.querySelector('[data-decomp-error]');
        const errorMsg = block.querySelector('[data-decomp-error-message]');
        if (error) error.hidden = false;
        if (errorMsg) {
            let text = message || tr('decomp.failed', 'Не удалось выполнить разложение.');
            if (code) text += ' (' + code + ')';
            errorMsg.textContent = text;
        }

        try {
            block.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) { /* noop */ }

        ML.emit('decomposition:render-error', {
            message: message,
            code: code
        });
    }

    /**
     * Отрисовать одну «часть» разложения: L, U, Q, R, P, D, P⁻¹, Qᵀ.
     */
    function buildPartHtml(name, matrixData, latex) {
        // latex — приоритетный источник: бэкенд отдаёт parts_latex
        const latexStr = latex
            || (isArr(matrixData)
                ? ML.format.matrixToLatex(matrixData)
                : '');

        if (!latexStr) return '';

        return ''
            + '<div class="decomp-part">'
            +   '<div class="decomp-part-label">' + esc(name) + ' =</div>'
            +   '<div class="decomp-part-body">$$' + latexStr + '$$</div>'
            + '</div>';
    }

    /**
     * Отрисовать одну проверку: { name, ok, latex }
     */
    function buildCheckHtml(check) {
        const ok = check.ok !== false;
        const cls = ok ? 'is-ok' : 'is-fail';
        const mark = ok ? '✓' : '✗';

        let html = '<li class="decomp-check-item ' + cls + '">'
            + '<span class="decomp-check-mark">' + mark + '</span>'
            + '<span class="decomp-check-name">' + esc(check.name || '') + '</span>';

        if (check.latex) {
            html += '<div class="decomp-check-formula">$$'
                + check.latex + '$$</div>';
        }
        html += '</li>';
        return html;
    }

    /**
     * Основной рендер ответа.
     */
    function renderResult(root, payload, options) {
        options = options || {};
        const scope = root || document;
        const block = findResultBlock(scope);
        if (!block || !payload) return;

        block.hidden = false;

        // --- Показываем секции
        block.querySelectorAll('.result-section').forEach(function (s) {
            s.hidden = false;
        });

        // --- Прячем ошибку
        const error = block.querySelector('[data-decomp-error]');
        if (error) error.hidden = true;

        // --- 1. Задание
        const taskText = block.querySelector('[data-decomp-task-text]');
        if (taskText) {
            taskText.textContent = options.taskText || '';
        }
        const taskFormula = block.querySelector('[data-decomp-task-formula]');
        if (taskFormula) {
            taskFormula.innerHTML = options.taskLatex
                ? ('$$' + options.taskLatex + '$$')
                : '';
        }

        // --- 2. Построение (steps)
        const stepsEl = block.querySelector('[data-decomp-steps]');
        if (stepsEl) {
            stepsEl.innerHTML = '';
            const steps = isArr(payload.steps) ? payload.steps : [];
            if (steps.length) {
                steps.forEach(function (s, i) {
                    const step = document.createElement('div');
                    step.className = 'decomp-step';
                    let inner = ''
                        + '<div class="decomp-step-num">' + (i + 1) + '</div>'
                        + '<div class="decomp-step-body">';
                    if (s.title) {
                        inner += '<div class="decomp-step-title">'
                            + esc(s.title) + '</div>';
                    }
                    if (s.text) {
                        inner += '<p class="decomp-step-text">'
                            + esc(s.text) + '</p>';
                    }
                    if (s.latex) {
                        inner += '<div class="decomp-step-formula">$$'
                            + s.latex + '$$</div>';
                    }
                    inner += '</div>';
                    step.innerHTML = inner;
                    stepsEl.appendChild(step);
                });
            } else {
                stepsEl.innerHTML = '<p class="decomp-step-empty">'
                    + esc(tr('decomp.noSteps', 'Пошаговое построение недоступно.'))
                    + '</p>';
            }
        }

        // --- 3. Результат (части разложения)
        const partsEl = block.querySelector('[data-decomp-parts]');
        const partsLatex = (payload.extra && payload.extra.parts_latex) || {};
        const partsData = payload.result || {};

        if (partsEl) {
            partsEl.innerHTML = '';
            const keys = Object.keys(partsData);
            if (!keys.length) {
                partsEl.innerHTML = '<div class="decomp-reason">'
                    + esc(tr('decomp.noParts', 'Разложение не дало частей.'))
                    + '</div>';
            } else {
                keys.forEach(function (name) {
                    const html = buildPartHtml(
                        name,
                        partsData[name],
                        partsLatex[name]
                    );
                    if (html) partsEl.insertAdjacentHTML('beforeend', html);
                });
            }
        }

        // --- Проверки
        const checksEl = block.querySelector('[data-decomp-checks]');
        const checksList = block.querySelector('[data-decomp-checks-list]');
        const checks = (payload.extra && payload.extra.checks) || null;

        if (checksEl && checksList) {
            checksList.innerHTML = '';
            if (isObj(checks) && Object.keys(checks).length) {
                // checks может быть объектом {name: value} или массивом
                Object.keys(checks).forEach(function (key) {
                    const val = checks[key];
                    let ok = true;
                    if (isObj(val) && 'ok' in val) ok = val.ok !== false;
                    else if (typeof val === 'boolean') ok = val;

                    checksList.insertAdjacentHTML('beforeend', buildCheckHtml({
                        name: key,
                        ok: ok,
                        latex: (isObj(val) && val.latex) || ''
                    }));
                });
                checksEl.hidden = false;
            } else if (isArr(checks) && checks.length) {
                checks.forEach(function (c) {
                    checksList.insertAdjacentHTML('beforeend',
                        buildCheckHtml(c));
                });
                checksEl.hidden = false;
            } else {
                checksEl.hidden = true;
            }
        }

        // --- Причина неприменимости
        const reasonEl = block.querySelector('[data-decomp-reason]');
        const valid = !(payload.extra && payload.extra.valid === false);
        if (reasonEl) {
            if (!valid) {
                reasonEl.hidden = false;
                reasonEl.textContent = (payload.extra && payload.extra.reason)
                    || tr('decomp.notApplicableHint',
                        'Матрица не подходит для выбранного разложения.');
            } else {
                reasonEl.hidden = true;
                reasonEl.textContent = '';
            }
        }

        // --- Кнопки
        const actions = block.querySelector('[data-decomp-actions]');
        if (actions) actions.hidden = false;

        // --- MathJax
        if (ML.mathjax && typeof ML.mathjax.typeset === 'function') {
            ML.mathjax.typeset(block);
        }

        // --- Скролл
        try {
            block.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) { /* noop */ }
    }

    // =========================================================================
    // 7. ЗАПУСК РАЗЛОЖЕНИЯ
    // =========================================================================

    async function runOperation(op, ctx) {
        ctx = ctx || {};
        const scope = ctx.root || document;
        const resultBlock = ctx.resultBlock || findResultBlock(scope);
        const placeholder = ctx.placeholder
            || scope.querySelector(
                '[data-decomp-placeholder], [data-calc-placeholder]'
            );

        const mi = ctx.mi || findMatrixInput(scope);
        if (!mi) {
            ML.toast.warning(
                tr('decomp.noMatrix', 'Нет матрицы'),
                tr('decomp.editorNotFound',
                    'Редактор матрицы не найден.')
            );
            return null;
        }

        const info = decompInfo(op);
        if (!info.url) {
            ML.toast.error(
                tr('common.error', 'Ошибка'),
                tr('decomp.notSupported', 'Разложение не поддерживается.')
                    + ' «' + info.label + '»'
            );
            return null;
        }

        // --- Проверки
        if (isEmptyMatrix(mi.read())) {
            ML.toast.warning(
                tr('decomp.emptyMatrix', 'Пустая матрица'),
                tr('decomp.fillMatrix', 'Заполните матрицу.')
            );
            return null;
        }
        if (mi.hasInvalid && mi.hasInvalid()) {
            ML.toast.warning(
                tr('decomp.invalidInput', 'Некорректный ввод'),
                tr('decomp.fixCells', 'Исправьте подсвеченные ячейки.')
            );
            return null;
        }

        // --- AutoSquare
        if (info.autoSquare && mi.rows !== mi.cols) {
            const n = Math.max(mi.rows, mi.cols);
            mi.setSize(n, n, { preserve: true });
            ML.toast.info(
                tr('decomp.sizeAdjusted', 'Размер подстроен'),
                tr('decomp.matrix', 'Матрица') + ' ' + n + ' × ' + n
            );
        }

        if (info.square && mi.rows !== mi.cols) {
            ML.toast.warning(
                tr('decomp.needSquare', 'Нужна квадратная матрица'),
                tr('decomp.needSquareHint', 'Для') + ' «' + info.label
                    + '» ' + tr('decomp.needSquareHint2',
                        'требуется матрица n × n.')
            );
            return null;
        }

        // --- Симметрия
        const matrix = mi.read();
        if (info.symmetric && !isSymmetric(matrix)) {
            ML.toast.warning(
                tr('decomp.needSymmetric', 'Нужна симметричная матрица'),
                tr('decomp.needSymmetricHint',
                    'Выбранное разложение требует симметричной матрицы '
                    + '(A = Aᵀ).')
            );
            return null;
        }

        // --- Валидация через ядро
        const validation = ML.validateMatrixFor(op, { a: mi });
        if (!validation.ok) {
            ML.toast.warning(validation.message, validation.hint || '');
            return null;
        }

        const payload = {
            matrix: matrix,
            show_steps: true
        };
        const snapshot = JSON.parse(JSON.stringify(payload));

        // --- Loading + skeleton
        ML.loader.show(
            tr('common.computing', 'Разлагаем…')
        );
        if (resultBlock) {
            resultBlock.hidden = false;
            const stepsEl = resultBlock.querySelector('[data-decomp-steps]');
            if (stepsEl) {
                stepsEl.innerHTML = ''
                    + '<div class="skeleton skeleton-line"></div>'
                    + '<div class="skeleton skeleton-line"></div>'
                    + '<div class="skeleton skeleton-line short"></div>';
            }
        }
        if (placeholder) placeholder.hidden = true;

        try {
            const response = await ML.api.post(info.url, payload);

            // --- Backend вернул success: false
            if (response && response.success === false) {
                throw Object.assign(
                    new Error(response.error || 'Backend error'),
                    { code: response.code || 'backend_error' }
                );
            }

            const valid = !(response && response.extra
                && response.extra.valid === false);

            // --- Свой рендер
            renderResult(scope, response, {
                taskText: tr('decomp.taskText',
                    'Выполнить разложение для матрицы A.') + ' '
                    + info.label + '.',
                taskLatex: 'A = ' + ML.format.matrixToLatex(matrix)
                    + ', \\quad ' + (info.equation || '')
            });

            // --- Toast по применимости
            if (!valid) {
                const reason = (response.extra && response.extra.reason) || '';
                ML.toast.warning(
                    tr('decomp.notApplicable', 'Разложение неприменимо'),
                    reason || tr('decomp.notApplicableHint',
                        'Матрица не подходит для выбранного разложения.')
                );
                ML.emit('decomposition:not-applicable', {
                    op: op,
                    reason: reason
                });
            } else {
                ML.toast.success(
                    tr('common.ok', 'Готово'),
                    info.label + ' ' + tr('decomp.done', 'выполнено.')
                );
            }

            // --- История
            ML.history.push({
                op: op,
                label: info.label,
                matrix: snapshot.matrix,
                result: response,
                size: mi.rows + '×' + mi.cols
            });

            ML.emit('decomposition:done', {
                op: op,
                payload: snapshot,
                result: response,
                valid: valid
            });

            return response;
        } catch (err) {
            renderError(scope, err.message, err.code);
            ML.toast.error(
                tr('decomp.failed', 'Не удалось выполнить'),
                err.message || ''
            );
            ML.emit('decomposition:error', { op: op, error: err });
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
    // 8. ПРИМЕРЫ
    // =========================================================================

    function initExamples() {
        document.addEventListener('click', async function (e) {
            const btn = e.target.closest('[data-load-decomp]');
            if (!btn) return;

            const slug = btn.dataset.loadDecomp;
            if (!slug) return;

            const mi = findMatrixInput(btn.closest('section'))
                || findMatrixInput(document);

            ML.loader.show(
                tr('decomp.loadingExample', 'Загружаем пример…')
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
                if (data.op && DECOMPS[data.op]) {
                    setOperation(data.op, document);
                }

                closeModalIfAny(btn);
                ML.toast.success(
                    tr('decomp.exampleLoaded', 'Пример загружен'),
                    data.title || slug
                );

                ML.emit('decompositions:example-loaded', { slug: slug });
            } catch (err) {
                ML.toast.error(
                    tr('decomp.exampleFailed', 'Не удалось загрузить'),
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
            '[data-decomp-placeholder], [data-calc-placeholder]'
        );

        const mi = findMatrixInput(section);

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

        // --- Переключение разложений
        ML.$$('[data-decomp]', section).forEach(function (btn) {
            btn.addEventListener('click', function () {
                setOperation(btn.dataset.decomp, section);
            });
        });

        // --- Начальная операция
        const initialBtn = section.querySelector('[data-decomp].is-active')
            || section.querySelector('[data-decomp]');
        if (initialBtn && initialBtn.dataset.decomp) {
            currentOp = initialBtn.dataset.decomp;
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
                clearRendered(section);
                if (placeholder) placeholder.hidden = false;
                updateRunButtonState(section);

                ML.emit('decompositions:reset', {});
            });
        }

        // --- Публичный API
        ML.decompositions = ML.decompositions || {};
        ML.decompositions.mount = mount;
        ML.decompositions.run = run;
        ML.decompositions.runOperation = runOperation;
        ML.decompositions.updateRunButtonState = updateRunButtonState;
        ML.decompositions.setOperation = setOperation;
        ML.decompositions.getOperation = getOperation;
        ML.decompositions.list = listOperations;
        ML.decompositions.cleanupMissingIcons = cleanupMissingIcons;
        ML.decompositions.clear = clearRendered;
        ML.decompositions.render = renderResult;
        ML.decompositions.renderError = renderError;

        ML.emit('decompositions:ready', {});
        return true;
    }

    // =========================================================================
    // 10. ИНИЦИАЛИЗАЦИЯ
    // =========================================================================

    let _initialized = false;

    function init() {
        if (_initialized) return;
        _initialized = true;

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () {
                cleanupMissingIcons(document);
            });
        } else {
            cleanupMissingIcons(document);
        }

        if (document.querySelector('[data-decomp-run]')) {
            mount(document);
        }

        initExamples();

        ML.emit('decompositions:module-ready', {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();