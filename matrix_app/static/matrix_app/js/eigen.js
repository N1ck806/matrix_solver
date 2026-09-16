/* =============================================================================
   MatrixLab — eigen.js
   =============================================================================
   Страница /eigen/ — спектр матрицы: собственные значения и векторы,
   характеристический многочлен, полный спектральный анализ.

   Публичный API:
       ML.eigen.mount(root)
       ML.eigen.run(root, ctx)
       ML.eigen.runOperation(op, ctx)
       ML.eigen.updateRunButtonState(root)
       ML.eigen.setOperation(op, root)
       ML.eigen.getOperation()
       ML.eigen.list()
       ML.eigen.clear(root)
       ML.eigen.render(root, payload, opts)
       ML.eigen.renderError(root, message, code)

   ВАЖНО:
       Раньше здесь вызывался ML.resultBlock.render(), который ищет секции
       по [data-result-section] / [data-result-output]. На этой странице
       своя разметка [data-eigen-*] — рендер уходил «в никуда», и блок
       результата оставался пустым. Теперь всё рисуется в свои селекторы.

   Зависимости: main.js, matrix.js, steps.js (для ML.mathjax).
   ============================================================================= */
(function () {
    'use strict';

    const ML = window.MatrixLab;
    if (!ML) {
        console.error('[eigen.js] window.MatrixLab не найден — модуль не запущен.');
        return;
    }

    // =========================================================================
    // 1. РЕЕСТР ОПЕРАЦИЙ
    // =========================================================================

    const OPS = {
        eigenvalues: {
            url: '/api/matrix/eigenvalues/',
            label: 'Собственные значения',
            taskText: 'Найти собственные значения матрицы A.',
            kind: 'eigenvalues',
            square: true,
            autoSquare: true
        },
        eigenvectors: {
            url: '/api/matrix/eigenvectors/',
            label: 'Собственные векторы',
            taskText: 'Найти собственные векторы матрицы A.',
            kind: 'text',
            square: true,
            autoSquare: true
        },
        char_poly: {
            url: '/api/matrix/char-poly/',
            label: 'Характеристический многочлен',
            taskText: 'Найти характеристический многочлен матрицы A.',
            kind: 'text',
            square: true,
            autoSquare: true
        },
        full: {
            url: null,
            label: 'Полный спектральный анализ',
            taskText: 'Полный спектральный анализ матрицы A.',
            kind: 'text',
            square: true,
            autoSquare: true,
            composite: true
        }
    };

    function opInfo(op) {
        return OPS[op] || {
            url: null,
            label: op,
            taskText: '',
            kind: 'text',
            square: true,
            autoSquare: true
        };
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

    function findMatrixInput(root) {
        const scope = root || document;
        const grid = scope.querySelector('[data-matrix-input]');
        if (!grid) return null;
        return ML.matrixInputs[grid.id] || null;
    }

    function findResultBlock(root) {
        const scope = root || document;
        return scope.querySelector('[data-eigen-result]')
            || scope.querySelector('[data-result-block]');
    }

    function findRunBtn(root) {
        const scope = root || document;
        return scope.querySelector('[data-eigen-run]');
    }

    function findResetBtn(root) {
        const scope = root || document;
        return scope.querySelector('[data-eigen-reset]');
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
                .replace(/<span[^>]*ml-icon[^>]*>[\s\S]*?<\/span>/g, '')
                .replace(/&lt;span[^&]*ml-icon[\s\S]*?&lt;\/span&gt;/g, '')
                .trim();
        });
    }

    // =========================================================================
    // 3. ФРОНТОВЫЙ КЭШ РЕЗУЛЬТАТОВ
    // -------------------------------------------------------------------------
    // Если пользователь переключает вкладки «Собственные значения» →
    // «Собственные векторы» → «Характеристический многочлен» на одной и
    // той же матрице — второй и третий клик не делают сетевых запросов.
    // =========================================================================

    const _resultCache = new Map();
    const _CACHE_MAX = 20;

    function _cacheKey(op, matrix) {
        return op + '|' + JSON.stringify(matrix);
    }

    function _cacheGet(op, matrix) {
        return _resultCache.get(_cacheKey(op, matrix)) || null;
    }

    function _cachePut(op, matrix, response) {
        if (_resultCache.size >= _CACHE_MAX) {
            const firstKey = _resultCache.keys().next().value;
            _resultCache.delete(firstKey);
        }
        _resultCache.set(_cacheKey(op, matrix), response);
    }

    function _cacheClear() {
        _resultCache.clear();
    }

    // =========================================================================
    // 4. ТЕКУЩАЯ ОПЕРАЦИЯ
    // =========================================================================

    let currentOp = 'eigenvalues';

    function setOperation(op, root) {
        if (!OPS[op]) return;
        currentOp = op;
        const scope = root || document;

        ML.$$('[data-eigen-op]', scope).forEach(function (b) {
            const active = b.dataset.eigenOp === op;
            b.classList.toggle('is-active', active);
            b.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        autoResizeForCurrent(scope);
        updateRunButtonState(scope);
        ML.emit('eigen:operation', { op: op });
    }

    function getOperation() { return currentOp; }

    function listOperations() { return Object.keys(OPS); }

    // =========================================================================
    // 5. АВТО-ПОДГОНКА РАЗМЕРА
    // =========================================================================

    function autoResizeForCurrent(scope) {
        const info = opInfo(currentOp);
        if (!info.autoSquare) return;

        const mi = findMatrixInput(scope);
        if (!mi) return;

        if (mi.rows !== mi.cols) {
            const n = Math.max(mi.rows, mi.cols);
            mi.setSize(n, n, { preserve: true });

            ML.toast.info(
                tr('eigen.sizeAdjusted', 'Размер подстроен'),
                tr('eigen.matrix', 'Матрица') + ' ' + n + ' × ' + n
            );
        }
    }

    // =========================================================================
    // 6. ОБНОВЛЕНИЕ КНОПКИ
    // =========================================================================

    function updateRunButtonState(root) {
        const scope = root || document;
        const runBtn = findRunBtn(scope);
        if (!runBtn) return;

        const mi = findMatrixInput(scope);
        if (!mi) {
            runBtn.disabled = true;
            runBtn.title = tr('eigen.editorNotFound',
                'Редактор матрицы не найден');
            runBtn.setAttribute('aria-disabled', 'true');
            return;
        }

        const info = opInfo(currentOp);
        const matrix = mi.read();
        const empty = isEmptyMatrix(matrix);
        const invalid = mi.hasInvalid && mi.hasInvalid();
        const notSquare = info.square && mi.rows !== mi.cols;

        runBtn.disabled = empty || invalid || notSquare;

        if (invalid) {
            runBtn.title = tr('eigen.invalidValues',
                'Некорректные значения в матрице');
        } else if (empty) {
            runBtn.title = tr('eigen.fillMatrix', 'Заполните матрицу');
        } else if (notSquare) {
            runBtn.title = tr('eigen.needSquareFor',
                'Нужна квадратная матрица для') + ' «'
                + info.label + '»';
        } else {
            runBtn.title = tr('eigen.run', 'Выполнить') + ' '
                + info.label;
        }

        runBtn.setAttribute('aria-disabled', String(runBtn.disabled));
    }

    // =========================================================================
    // 7. РЕНДЕР РЕЗУЛЬТАТА
    // =========================================================================

    function clearRendered(root) {
        const scope = root || document;
        const block = findResultBlock(scope);
        if (!block) return;

        block.hidden = true;

        const taskText = block.querySelector('[data-eigen-task-text]');
        if (taskText) taskText.textContent = '';

        const taskFormula = block.querySelector('[data-eigen-task-formula]');
        if (taskFormula) taskFormula.innerHTML = '';

        const charpolySection = block.querySelector('[data-eigen-charpoly]');
        if (charpolySection) charpolySection.hidden = true;

        const charpolyBody = block.querySelector('[data-eigen-charpoly-body]');
        if (charpolyBody) charpolyBody.innerHTML = '';

        const valuesSection = block.querySelector('[data-eigen-values]');
        if (valuesSection) valuesSection.hidden = true;

        const valuesBody = block.querySelector('[data-eigen-values-body]');
        if (valuesBody) valuesBody.innerHTML = '';

        const trace = block.querySelector('[data-eigen-trace]');
        if (trace) trace.textContent = '';

        const det = block.querySelector('[data-eigen-det]');
        if (det) det.textContent = '';

        const vectorsSection = block.querySelector('[data-eigen-vectors]');
        if (vectorsSection) vectorsSection.hidden = true;

        const vectorsBody = block.querySelector('[data-eigen-vectors-body]');
        if (vectorsBody) vectorsBody.innerHTML = '';

        const diagSection = block.querySelector('[data-eigen-diagonalizable]');
        if (diagSection) diagSection.hidden = true;

        const diagBody = block.querySelector('[data-eigen-diag-body]');
        if (diagBody) diagBody.innerHTML = '';

        const error = block.querySelector('[data-eigen-error]');
        if (error) error.hidden = true;

        const errorMsg = block.querySelector('[data-eigen-error-message]');
        if (errorMsg) errorMsg.textContent = '';

        // Возвращаем task-секцию
        const taskSection = block.querySelector('.result-section--task');
        if (taskSection) taskSection.hidden = false;
    }

    function renderError(root, message, code) {
        const scope = root || document;
        const block = findResultBlock(scope);
        if (!block) return;

        block.hidden = false;

        // Прячем все result-section, оставляем только ошибку
        block.querySelectorAll('.result-section').forEach(function (s) {
            s.hidden = true;
        });

        const error = block.querySelector('[data-eigen-error]');
        const errorMsg = block.querySelector('[data-eigen-error-message]');

        if (error) error.hidden = false;
        if (errorMsg) {
            let text = message || tr('eigen.failed',
                'Не удалось найти спектр.');
            if (code) text += ' (' + code + ')';
            errorMsg.textContent = text;
        }

        try {
            block.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) { /* noop */ }

        ML.emit('eigen:render-error', { message: message, code: code });
    }

    /**
     * Собрать HTML для одного собственного значения.
     * Ожидаемые поля в item:
     *   value           — строка
     *   latex           — LaTeX
     *   algebraic_multiplicity
     *   geometric_multiplicity
     */
    function buildEigenValueItem(item) {
        const valueLatex = item.latex || esc(item.value || '');
        const alg = item.algebraic_multiplicity;
        const geo = item.geometric_multiplicity;

        let mults = '<span>'
            + esc(tr('eigen.algMult', 'алг. кратность'))
            + ': <b>' + esc(alg) + '</b></span>';
        if (geo !== undefined && geo !== null) {
            mults += '<span>'
                + esc(tr('eigen.geoMult', 'геом. кратность'))
                + ': <b>' + esc(geo) + '</b></span>';
        }

        return ''
            + '<div class="eigen-value-item">'
            +   '<span class="eigen-value-lambda">$$\\lambda = '
            +     valueLatex + '$$</span>'
            +   '<span class="eigen-value-detail">'
            +     '<span class="eigen-value-detail-title">'
            +       esc(tr('eigen.eigenvalue', 'Собственное значение'))
            +     '</span>'
            +     '<span class="eigen-value-detail-sub">' + mults + '</span>'
            +   '</span>'
            + '</div>';
    }

    /**
     * Собрать HTML для одного собственного вектора (группа).
     */
    function buildEigenVectorItem(item) {
        const valueLatex = item.value_latex || esc(item.value || '');
        const basis = isArr(item.eigenvectors_latex)
            ? item.eigenvectors_latex
            : [];

        let basisHtml = '';
        if (basis.length) {
            basisHtml = '<div class="eigen-vector-basis">'
                + basis.map(function (v) {
                    return '<div class="eigen-vector-basis-item">$$'
                        + v + '$$</div>';
                }).join('')
                + '</div>';
        } else {
            basisHtml = '<p class="eigen-vector-empty">'
                + esc(tr('eigen.noVectors',
                    'Собственные векторы не найдены.'))
                + '</p>';
        }

        let mults = '';
        if (item.algebraic_multiplicity !== undefined) {
            mults = '<span>' + esc(tr('eigen.algMult', 'алг. кратность'))
                + ': <b>' + esc(item.algebraic_multiplicity) + '</b></span>';
        }
        if (item.geometric_multiplicity !== undefined) {
            mults += '<span>' + esc(tr('eigen.geoMult', 'геом. кратность'))
                + ': <b>' + esc(item.geometric_multiplicity) + '</b></span>';
        }

        return ''
            + '<div class="eigen-vector-item">'
            +   '<div class="eigen-vector-head">'
            +     '<span class="eigen-value-lambda">$$\\lambda = '
            +       valueLatex + '$$</span>'
            +     '<span class="eigen-vector-mults">' + mults + '</span>'
            +   '</div>'
            +   basisHtml
            + '</div>';
    }

    /**
     * Основной рендер успешного ответа.
     *
     * payload — то, что вернул ML.api.post() или runComposite().
     * options.op — текущая операция ('eigenvalues' | 'eigenvectors'
     *              | 'char_poly' | 'full'), чтобы понимать, какие секции
     *              показывать.
     */
    function renderResult(root, payload, options) {
        options = options || {};
        const scope = root || document;
        const block = findResultBlock(scope);
        if (!block || !payload) return;

        const op = options.op || currentOp;
        const extra = payload.extra || {};
        const result = payload.result;

        block.hidden = false;

        // Всегда показываем секцию «Задание».
        const taskSection = block.querySelector('.result-section--task');
        if (taskSection) taskSection.hidden = false;

        // Прицельно скрываем остальные — включим по мере надобности.
        const charpolySection = block.querySelector('[data-eigen-charpoly]');
        const valuesSection = block.querySelector('[data-eigen-values]');
        const vectorsSection = block.querySelector('[data-eigen-vectors]');
        const diagSection = block.querySelector('[data-eigen-diagonalizable]');

        if (charpolySection) charpolySection.hidden = true;
        if (valuesSection) valuesSection.hidden = true;
        if (vectorsSection) vectorsSection.hidden = true;
        if (diagSection) diagSection.hidden = true;

        // --- Ошибку прячем (если была)
        const error = block.querySelector('[data-eigen-error]');
        if (error) error.hidden = true;

        // --- Задание
        const taskText = block.querySelector('[data-eigen-task-text]');
        if (taskText) {
            taskText.textContent = options.taskText || opInfo(op).taskText || '';
        }
        const taskFormula = block.querySelector('[data-eigen-task-formula]');
        if (taskFormula) {
            const latex = options.taskLatex || '';
            taskFormula.innerHTML = latex ? ('$$' + latex + '$$') : '';
        }

        // --- 1. Характеристический многочлен (всегда, если есть)
        const charpolyBody = block.querySelector('[data-eigen-charpoly-body]');
        if (charpolyBody && (extra.char_poly_latex || extra.factored_latex)) {
            let html = '';
            if (extra.char_poly_latex) {
                html += '<div class="eigen-charpoly-row">'
                    +   '<div class="eigen-charpoly-label">p(λ) =</div>'
                    +   '<div class="eigen-charpoly-value">$$'
                    +     extra.char_poly_latex + '$$</div>'
                    + '</div>';
            }
            if (extra.factored_latex
                && extra.factored_latex !== extra.char_poly_latex) {
                html += '<div class="eigen-charpoly-row">'
                    +   '<div class="eigen-charpoly-label">p(λ) =</div>'
                    +   '<div class="eigen-charpoly-value">$$'
                    +     extra.factored_latex + '$$</div>'
                    + '</div>';
            }
            if (html) {
                charpolyBody.innerHTML = html;
                if (charpolySection) charpolySection.hidden = false;
            }
        }

        // --- 2. Собственные значения (для eigenvalues, full)
        const valuesBody = block.querySelector('[data-eigen-values-body]');
        const traceEl = block.querySelector('[data-eigen-trace]');
        const detEl = block.querySelector('[data-eigen-det]');

        const eigenvalues = isArr(result) ? result : [];
        const showValues = (op === 'eigenvalues' || op === 'full'
            || op === 'eigenvectors') && eigenvalues.length > 0;

        if (valuesBody && showValues) {
            valuesBody.innerHTML = eigenvalues
                .map(buildEigenValueItem)
                .join('');
            if (valuesSection) valuesSection.hidden = false;

            if (traceEl) {
                traceEl.textContent = extra.trace_check
                    ? String(extra.trace_check)
                    : '—';
            }
            if (detEl) {
                detEl.textContent = extra.det_check
                    ? String(extra.det_check)
                    : '—';
            }
        }

        // --- 3. Собственные векторы (для eigenvectors, full)
        const vectorsBody = block.querySelector('[data-eigen-vectors-body]');
        const showVectors = (op === 'eigenvectors' || op === 'full')
            && eigenvalues.length > 0
            && eigenvalues[0].eigenvectors_latex !== undefined;

        if (vectorsBody && showVectors) {
            vectorsBody.innerHTML = eigenvalues
                .map(buildEigenVectorItem)
                .join('');
            if (vectorsSection) vectorsSection.hidden = false;
        }

        // --- 4. Диагонализируемость (если пришло)
        const diagBody = block.querySelector('[data-eigen-diag-body]');
        if (diagBody && extra.is_diagonalizable !== undefined) {
            const yes = !!extra.is_diagonalizable;
            const reason = extra.diagonalization_reason
                || (yes
                    ? tr('eigen.diagYes',
                        'Матрица диагонализируема.')
                    : tr('eigen.diagNo',
                        'Матрица не диагонализируема.'));

            diagBody.className = 'eigen-diag ' + (yes ? 'is-yes' : 'is-no');
            diagBody.innerHTML = ''
                + '<div class="eigen-diag-head">'
                +   '<span class="eigen-diag-icon">'
                +     (yes ? '✓' : '!') + '</span>'
                +   '<span>' + esc(yes
                    ? tr('eigen.diagYesTitle', 'Диагонализируема')
                    : tr('eigen.diagNoTitle', 'Не диагонализируема'))
                +   '</span>'
                + '</div>'
                + '<p class="eigen-diag-text">' + esc(reason) + '</p>';

            if (diagSection) diagSection.hidden = false;
        }

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
    // 8. ЗАПУСК ОПЕРАЦИИ
    // =========================================================================

    async function runOperation(op, ctx) {
        ctx = ctx || {};
        const scope = ctx.root || document;
        const resultBlock = ctx.resultBlock || findResultBlock(scope);
        const placeholder = ctx.placeholder
            || scope.querySelector(
                '[data-eigen-placeholder], [data-calc-placeholder]'
            );

        const mi = ctx.mi || findMatrixInput(scope);
        if (!mi) {
            ML.toast.warning(
                tr('eigen.noMatrix', 'Нет матрицы'),
                tr('eigen.editorNotFound',
                    'Редактор матрицы не найден.')
            );
            return null;
        }

        const info = opInfo(op);

        // --- Проверки
        if (isEmptyMatrix(mi.read())) {
            ML.toast.warning(
                tr('eigen.emptyMatrix', 'Пустая матрица'),
                tr('eigen.fillMatrix', 'Заполните матрицу.')
            );
            return null;
        }
        if (mi.hasInvalid && mi.hasInvalid()) {
            ML.toast.warning(
                tr('eigen.invalidInput', 'Некорректный ввод'),
                tr('eigen.fixCells', 'Исправьте подсвеченные ячейки.')
            );
            return null;
        }

        // --- AutoSquare
        if (info.autoSquare && mi.rows !== mi.cols) {
            const n = Math.max(mi.rows, mi.cols);
            mi.setSize(n, n, { preserve: true });
            ML.toast.info(
                tr('eigen.sizeAdjusted', 'Размер подстроен'),
                tr('eigen.matrix', 'Матрица') + ' ' + n + ' × ' + n
            );
        }

        if (info.square && mi.rows !== mi.cols) {
            ML.toast.warning(
                tr('eigen.needSquare', 'Нужна квадратная матрица'),
                tr('eigen.needSquareHint', 'Для') + ' «' + info.label
                    + '» ' + tr('eigen.needSquareHint2',
                        'требуется матрица n × n.')
            );
            return null;
        }

        // --- Валидация через ядро
        const validation = ML.validateMatrixFor(op, { a: mi });
        if (!validation.ok) {
            ML.toast.warning(validation.message, validation.hint || '');
            return null;
        }

        const matrix = mi.read();

        // --- Кэш: мгновенное переключение вкладок на той же матрице
        const cached = _cacheGet(op, matrix);
        if (cached) {
            renderResult(scope, cached, {
                op: op,
                taskText: info.taskText,
                taskLatex: 'A = ' + ML.format.matrixToLatex(matrix)
            });
            if (placeholder) placeholder.hidden = true;
            ML.toast.success(
                tr('common.ok', 'Готово'),
                info.label + ' ' + tr('eigen.fromCache', '(из кэша)')
            );
            return cached;
        }

        const payload = { matrix: matrix, show_steps: true };
        const snapshot = JSON.parse(JSON.stringify(payload));

        // --- Loading + skeleton
        ML.loader.show(
            tr('common.computing', 'Анализируем спектр…')
        );
        if (resultBlock) {
            resultBlock.hidden = false;
            const valuesBody = resultBlock.querySelector(
                '[data-eigen-values-body]'
            );
            if (valuesBody) {
                valuesBody.innerHTML = ''
                    + '<div class="skeleton skeleton-line"></div>'
                    + '<div class="skeleton skeleton-line"></div>'
                    + '<div class="skeleton skeleton-line short"></div>';
            }
            const valuesSection = resultBlock.querySelector(
                '[data-eigen-values]'
            );
            if (valuesSection) valuesSection.hidden = false;
        }

        try {
            let response;

            if (info.composite) {
                response = await runComposite(op, snapshot);
            } else {
                // 90 секунд — спектр может считаться долго
                response = await ML.api.post(info.url, payload, {
                    timeout: 90000
                });
            }

            // --- success: false
            if (response && response.success === false) {
                const backendMsg = response.error
                    || response.message
                    || tr('eigen.backendError',
                        'Бэкенд вернул ошибку.');
                const backendCode = response.code || 'backend_error';
                throw Object.assign(
                    new Error(backendMsg),
                    { code: backendCode }
                );
            }

            // --- Рендер
            renderResult(scope, response, {
                op: op,
                taskText: info.taskText,
                taskLatex: 'A = ' + ML.format.matrixToLatex(matrix)
            });
            if (placeholder) placeholder.hidden = true;

            // --- В кэш
            _cachePut(op, matrix, response);

            // --- Toast
            ML.toast.success(
                tr('common.ok', 'Готово'),
                info.label + ' ' + tr('eigen.done', 'выполнено.')
            );

            // --- История
            ML.history.push({
                op: op,
                label: info.label,
                matrix: snapshot.matrix,
                result: response,
                size: mi.rows + '×' + mi.cols
            });

            ML.emit('eigen:done', {
                op: op,
                payload: snapshot,
                result: response
            });

            return response;
        } catch (err) {
            renderError(scope, err.message, err.code);
            ML.toast.error(
                tr('eigen.failed', 'Не удалось выполнить'),
                err.message || ''
            );
            ML.emit('eigen:error', { op: op, error: err });
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
    // 9. СОСТАВНАЯ ОПЕРАЦИЯ 'full'
    // -------------------------------------------------------------------------
    // Пытаемся получить всё одним запросом, если бэк поддерживает
    // /api/matrix/eigen-full/. Если нет — фолбэк на два параллельных
    // запроса (старое поведение).
    // =========================================================================

    const EIGEN_FULL_URL = '/api/matrix/eigen-full/';

    async function runComposite(op, snapshot) {
        // --- Пытаемся единым запросом
        try {
            const unified = await ML.api.post(EIGEN_FULL_URL, snapshot, {
                timeout: 120000
            });
            if (unified && unified.success !== false) {
                return unified;
            }
        } catch (err) {
            // 404 — значит, эндпоинта нет. Идём фолбэком.
            // Любую другую ошибку тоже считаем поводом для фолбэка,
            // но залогируем.
            if (err && err.status && err.status !== 404) {
                console.warn('[eigen] eigen-full failed, fallback:', err);
            }
        }

        // --- Фолбэк: два параллельных запроса
        const [eigRes, vecRes] = await Promise.allSettled([
            ML.api.post(OPS.eigenvalues.url, snapshot, { timeout: 90000 }),
            ML.api.post(OPS.eigenvectors.url, snapshot, { timeout: 90000 })
        ]);

        const eigResp = eigRes.status === 'fulfilled' ? eigRes.value : null;
        const vecResp = vecRes.status === 'fulfilled' ? vecRes.value : null;

        if (!eigResp && !vecResp) {
            const firstError = eigRes.status === 'rejected'
                ? eigRes.reason
                : vecRes.reason;
            const err = firstError instanceof Error
                ? firstError
                : new Error(tr('eigen.compositeFailed',
                    'Не удалось получить данные спектра.'));
            throw err;
        }

        if (!eigResp || !vecResp) {
            const partial = !eigResp
                ? tr('eigen.partialNoEigen',
                    'Не удалось получить собственные значения')
                : tr('eigen.partialNoVec',
                    'Не удалось получить собственные векторы');
            ML.toast.warning(
                tr('eigen.partial', 'Частичный результат'),
                partial
            );
        }

        const safeEig = eigResp || {};
        const safeVec = vecResp || {};

        if (safeEig.success === false && safeVec.success === false) {
            throw new Error(
                safeEig.error || safeVec.error
                || tr('eigen.compositeFailed',
                    'Не удалось получить данные спектра.')
            );
        }

        // --- Собственные значения — берём из eigenvalues,
        //     дополняем векторами из eigenvectors, если есть.
        const eigList = isArr(safeEig.result) ? safeEig.result : [];
        const vecList = isArr(safeVec.result) ? safeVec.result : [];

        // Индексируем вектора по λ-latex, чтобы сшить.
        const vecByLambda = {};
        vecList.forEach(function (v) {
            if (v && v.value_latex) vecByLambda[v.value_latex] = v;
        });

        const merged = eigList.map(function (e) {
            const extra = vecByLambda[e.latex || e.value] || {};
            return Object.assign({}, e, extra);
        });

        // Если eigenvalues пуст, но eigenvectors что-то вернул — берём его.
        const result = merged.length ? merged : vecList;

        const mergedSteps = []
            .concat(isArr(safeEig.steps) ? safeEig.steps : [])
            .concat(isArr(safeVec.steps) ? safeVec.steps : []);

        const mergedChecks = []
            .concat(isArr(safeEig.checks) ? safeEig.checks : [])
            .concat(isArr(safeVec.checks) ? safeVec.checks : []);

        return {
            success: true,
            kind: 'text',
            result: result,
            latex: safeEig.latex || safeVec.latex || '',
            explanation: safeEig.explanation
                || safeVec.explanation
                || '',
            extra: Object.assign({},
                safeEig.extra || {},
                safeVec.extra || {}
            ),
            task: safeEig.task || safeVec.task || {},
            steps: mergedSteps,
            checks: mergedChecks
        };
    }

    // =========================================================================
    // 10. ПРИМЕРЫ
    // =========================================================================

    function initExamples() {
        document.addEventListener('click', async function (e) {
            const btn = e.target.closest(
                '[data-load-example], [data-load-eigen]'
            );
            if (!btn) return;

            const slug = btn.dataset.loadExample
                || btn.dataset.loadEigen;
            if (!slug) return;

            const mi = findMatrixInput(btn.closest('section'))
                || findMatrixInput(document);

            ML.loader.show(
                tr('eigen.loadingExample', 'Загружаем пример…')
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
                    _cacheClear();   // пример — новая матрица
                }
                if (data.op && OPS[data.op]) {
                    setOperation(data.op, document);
                }

                closeModalIfAny(btn);
                ML.toast.success(
                    tr('eigen.exampleLoaded', 'Пример загружен'),
                    data.title || slug
                );

                ML.emit('eigen:example-loaded', { slug: slug });
            } catch (err) {
                ML.toast.error(
                    tr('eigen.exampleFailed', 'Не удалось загрузить'),
                    err.message
                );
            } finally {
                ML.loader.hide();
            }
        });
    }

    // =========================================================================
    // 11. МОНТИРОВАНИЕ
    // =========================================================================

    function mount(root) {
        root = root || document;
        const runBtn = findRunBtn(root);
        if (!runBtn) return false;

        const section = runBtn.closest('section') || document;
        const resultBlock = findResultBlock(section);
        const resetBtn = findResetBtn(section);
        const placeholder = section.querySelector(
            '[data-eigen-placeholder], [data-calc-placeholder]'
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
                _cacheClear();   // матрица изменилась — кэш невалиден
            });
        }
        ML.on('matrix:change', updateDebounced);

        // --- Переключение операций
        ML.$$('[data-eigen-op]', section).forEach(function (btn) {
            btn.addEventListener('click', function () {
                setOperation(btn.dataset.eigenOp, section);
            });
        });

        // --- Начальная операция
        const initialBtn = section.querySelector('[data-eigen-op].is-active')
            || section.querySelector('[data-eigen-op]');
        if (initialBtn && initialBtn.dataset.eigenOp) {
            currentOp = initialBtn.dataset.eigenOp;
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
                _cacheClear();
                if (placeholder) placeholder.hidden = false;
                updateRunButtonState(section);

                ML.emit('eigen:reset', {});
            });
        }

        // --- Публичный API
        ML.eigen = ML.eigen || {};
        ML.eigen.mount = mount;
        ML.eigen.run = run;
        ML.eigen.runOperation = runOperation;
        ML.eigen.updateRunButtonState = updateRunButtonState;
        ML.eigen.setOperation = setOperation;
        ML.eigen.getOperation = getOperation;
        ML.eigen.list = listOperations;
        ML.eigen.cleanupMissingIcons = cleanupMissingIcons;
        ML.eigen.clear = clearRendered;
        ML.eigen.render = renderResult;
        ML.eigen.renderError = renderError;
        ML.eigen.clearCache = _cacheClear;

        ML.emit('eigen:ready', {});
        return true;
    }

    // =========================================================================
    // 12. ИНИЦИАЛИЗАЦИЯ
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

        if (document.querySelector('[data-eigen-run]')) {
            mount(document);
        }

        initExamples();

        ML.emit('eigen:module-ready', {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();