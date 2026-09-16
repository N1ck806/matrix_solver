/* =============================================================================
   MatrixLab — eigen.js
   =============================================================================
   Страница /eigen/ — спектр матрицы.

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
       ML.eigen.loadPreset(slug, btn)
       ML.eigen.loadExample(json, btn)
       ML.eigen.clearCache()

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

    function isEmptyMatrix(m) {
        return ML.validators.isEmptyMatrix(m);
    }

    /* Возвращает экземпляр MatrixInput, если matrix.js уже его создал.
       Если нет — null. Не пытаемся создать руками. */
    function findMatrixInput(root) {
        const scope = root || document;
        const grid = scope.querySelector('[data-matrix-input]');
        if (!grid) return null;
        if (!grid.id) return null;
        return (ML.matrixInputs && ML.matrixInputs[grid.id]) || null;
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

    function findPageRoot(el) {
        if (!el) return document;
        return el.closest('.matrix-input-card')
            || el.closest('.eigen-layout')
            || el.closest('[data-eigen-root]')
            || el.closest('section')
            || document;
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
    // 3. ФРОНТОВЫЙ КЭШ
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
            /* Редактор ещё не создан — оставляем кнопку кликабельной,
               чтобы клик ушёл в runOperation и там показал тост. */
            runBtn.disabled = false;
            runBtn.title = tr('eigen.editorNotFound',
                'Редактор матрицы не найден');
            runBtn.setAttribute('aria-disabled', 'false');
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

        const taskSection = block.querySelector('.result-section--task');
        if (taskSection) taskSection.hidden = false;
    }

    function renderError(root, message, code) {
        const scope = root || document;
        const block = findResultBlock(scope);
        if (!block) return;

        block.hidden = false;

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

    function buildEigenValueItem(item) {
        const valueLatex = item.latex || ML.escapeHtml(item.value || '');
        const alg = item.algebraic_multiplicity;
        const geo = item.geometric_multiplicity;

        let mults = '<span>'
            + ML.escapeHtml(tr('eigen.algMult', 'алг. кратность'))
            + ': <b>' + ML.escapeHtml(alg) + '</b></span>';
        if (geo !== undefined && geo !== null) {
            mults += '<span>'
                + ML.escapeHtml(tr('eigen.geoMult', 'геом. кратность'))
                + ': <b>' + ML.escapeHtml(geo) + '</b></span>';
        }

        return ''
            + '<div class="eigen-value-item">'
            +   '<span class="eigen-value-lambda">$$\\lambda = '
            +     valueLatex + '$$</span>'
            +   '<span class="eigen-value-detail">'
            +     '<span class="eigen-value-detail-title">'
            +       ML.escapeHtml(tr('eigen.eigenvalue', 'Собственное значение'))
            +     '</span>'
            +     '<span class="eigen-value-detail-sub">' + mults + '</span>'
            +   '</span>'
            + '</div>';
    }

    function buildEigenVectorItem(item) {
        const valueLatex = item.value_latex || ML.escapeHtml(item.value || '');
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
                + ML.escapeHtml(tr('eigen.noVectors',
                    'Собственные векторы не найдены.'))
                + '</p>';
        }

        let mults = '';
        if (item.algebraic_multiplicity !== undefined) {
            mults = '<span>'
                + ML.escapeHtml(tr('eigen.algMult', 'алг. кратность'))
                + ': <b>' + ML.escapeHtml(item.algebraic_multiplicity)
                + '</b></span>';
        }
        if (item.geometric_multiplicity !== undefined) {
            mults += '<span>'
                + ML.escapeHtml(tr('eigen.geoMult', 'геом. кратность'))
                + ': <b>' + ML.escapeHtml(item.geometric_multiplicity)
                + '</b></span>';
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

    function renderResult(root, payload, options) {
        options = options || {};
        const scope = root || document;
        const block = findResultBlock(scope);
        if (!block || !payload) return;

        const op = options.op || currentOp;
        const extra = payload.extra || {};
        const result = payload.result;

        block.hidden = false;

        const taskSection = block.querySelector('.result-section--task');
        if (taskSection) taskSection.hidden = false;

        const charpolySection = block.querySelector('[data-eigen-charpoly]');
        const valuesSection = block.querySelector('[data-eigen-values]');
        const vectorsSection = block.querySelector('[data-eigen-vectors]');
        const diagSection = block.querySelector('[data-eigen-diagonalizable]');

        if (charpolySection) charpolySection.hidden = true;
        if (valuesSection) valuesSection.hidden = true;
        if (vectorsSection) vectorsSection.hidden = true;
        if (diagSection) diagSection.hidden = true;

        const error = block.querySelector('[data-eigen-error]');
        if (error) error.hidden = true;

        const taskText = block.querySelector('[data-eigen-task-text]');
        if (taskText) {
            taskText.textContent = options.taskText
                || opInfo(op).taskText || '';
        }
        const taskFormula = block.querySelector('[data-eigen-task-formula]');
        if (taskFormula) {
            const latex = options.taskLatex || '';
            taskFormula.innerHTML = latex ? ('$$' + latex + '$$') : '';
        }

        // Характеристический многочлен
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

        // Собственные значения
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

        // Собственные векторы
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

        // Диагонализируемость
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
                +   '<span>' + ML.escapeHtml(yes
                    ? tr('eigen.diagYesTitle', 'Диагонализируема')
                    : tr('eigen.diagNoTitle', 'Не диагонализируема'))
                +   '</span>'
                + '</div>'
                + '<p class="eigen-diag-text">'
                +   ML.escapeHtml(reason) + '</p>';

            if (diagSection) diagSection.hidden = false;
        }

        if (ML.mathjax && typeof ML.mathjax.typeset === 'function') {
            ML.mathjax.typeset(block);
        }

        try {
            block.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) { /* noop */ }
    }

    // =========================================================================
    // 8. ЗАПУСК ОПЕРАЦИИ
    // =========================================================================

    let _isRunning = false;

    async function runOperation(op, ctx) {
        if (_isRunning) return null;
        _isRunning = true;

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
            _isRunning = false;
            return null;
        }

        const info = opInfo(op);

        if (isEmptyMatrix(mi.read())) {
            ML.toast.warning(
                tr('eigen.emptyMatrix', 'Пустая матрица'),
                tr('eigen.fillMatrix', 'Заполните матрицу.')
            );
            _isRunning = false;
            return null;
        }
        if (mi.hasInvalid && mi.hasInvalid()) {
            ML.toast.warning(
                tr('eigen.invalidInput', 'Некорректный ввод'),
                tr('eigen.fixCells', 'Исправьте подсвеченные ячейки.')
            );
            _isRunning = false;
            return null;
        }

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
            _isRunning = false;
            return null;
        }

        if (ML.validateMatrixFor) {
            const validation = ML.validateMatrixFor(op, { a: mi });
            if (validation && !validation.ok) {
                ML.toast.warning(validation.message, validation.hint || '');
                _isRunning = false;
                return null;
            }
        }

        const matrix = mi.read();

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
            _isRunning = false;
            return cached;
        }

        const payload = { matrix: matrix, show_steps: true };
        const snapshot = JSON.parse(JSON.stringify(payload));

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
                response = await ML.api.post(info.url, payload, {
                    timeout: 500000
                });
            }

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

            renderResult(scope, response, {
                op: op,
                taskText: info.taskText,
                taskLatex: 'A = ' + ML.format.matrixToLatex(matrix)
            });
            if (placeholder) placeholder.hidden = true;

            _cachePut(op, matrix, response);

            ML.toast.success(
                tr('common.ok', 'Готово'),
                info.label + ' ' + tr('eigen.done', 'выполнено.')
            );

            if (ML.history && ML.history.push) {
                ML.history.push({
                    op: op,
                    label: info.label,
                    matrix: snapshot.matrix,
                    result: response,
                    size: mi.rows + '×' + mi.cols
                });
            }

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
            _isRunning = false;
        }
    }

    function run(root, ctx) {
        return runOperation(currentOp, Object.assign({}, ctx, {
            root: (ctx && ctx.root) || root || document
        }));
    }

    // =========================================================================
    // 9. СОСТАВНАЯ ОПЕРАЦИЯ 'full'
    // =========================================================================

    const EIGEN_FULL_URL = '/api/matrix/eigen-full/';

    async function runComposite(op, snapshot) {
        try {
            const unified = await ML.api.post(EIGEN_FULL_URL, snapshot, {
                timeout: 120000
            });
            if (unified && unified.success !== false) {
                return unified;
            }
        } catch (err) {
            if (err && err.status && err.status !== 404) {
                console.warn('[eigen] eigen-full failed, fallback:', err);
            }
        }

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
            throw (firstError instanceof Error
                ? firstError
                : new Error(tr('eigen.compositeFailed',
                    'Не удалось получить данные спектра.')));
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

        const eigList = isArr(safeEig.result) ? safeEig.result : [];
        const vecList = isArr(safeVec.result) ? safeVec.result : [];

        const vecByLambda = {};
        vecList.forEach(function (v) {
            if (v && v.value_latex) vecByLambda[v.value_latex] = v;
        });

        const merged = eigList.map(function (e) {
            const extra = vecByLambda[e.latex || e.value] || {};
            return Object.assign({}, e, extra);
        });

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
    // 10. ПРЕСЕТЫ
    // =========================================================================

    async function loadPreset(slug, btn) {
        if (!slug) return null;

        const scope = findPageRoot(btn) || document;
        const mi = findMatrixInput(scope) || findMatrixInput(document);

        if (!mi) {
            ML.toast.error(
                tr('eigen.editorNotFound', 'Редактор не найден'),
                ''
            );
            return null;
        }

        const op = (btn && btn.dataset.presetOp) || null;
        const autorun = !btn || btn.dataset.presetAutorun !== '0';

        ML.loader.show(
            tr('eigen.loadingExample', 'Загружаем пример…')
        );

        try {
            const resp = await ML.api.post(
                '/api/example/' + slug + '/', {}
            );
            const data = (resp && resp.result) || {};
            const matrix = data.matrix;

            if (!isArr(matrix) || !matrix.length) {
                ML.toast.warning(
                    tr('eigen.exampleEmpty', 'Пример пустой'),
                    slug
                );
                return null;
            }

            mi.setSize(
                matrix.length,
                matrix[0].length,
                { preserve: false }
            );
            mi.write(matrix);

            _cacheClear();

            if (op && OPS[op]) {
                setOperation(op, scope);
            }

            ML.toast.success(
                tr('eigen.exampleLoaded', 'Пример загружен'),
                data.title || slug
            );

            ML.emit('eigen:example-loaded', {
                slug: slug,
                op: op,
                autorun: autorun
            });

            if (autorun) {
                await runOperation(op || currentOp, {
                    root: scope,
                    mi: mi
                });
            }

            return data;
        } catch (err) {
            ML.toast.error(
                tr('eigen.exampleFailed', 'Не удалось загрузить'),
                err.message
            );
            return null;
        } finally {
            ML.loader.hide();
        }
    }

    /* Инлайн-пример: JSON прямо в data-eigen-example. */
    async function loadExample(rawJson, btn) {
        let data;
        try {
            data = typeof rawJson === 'string'
                ? JSON.parse(rawJson)
                : rawJson;
        } catch (e) {
            console.error('[eigen] Некорректный JSON примера:', e);
            return null;
        }

        if (!data || !isArr(data.matrix)) return null;

        const scope = findPageRoot(btn) || document;
        const mi = findMatrixInput(scope) || findMatrixInput(document);

        if (!mi) {
            ML.toast.error(
                tr('eigen.editorNotFound', 'Редактор не найден'),
                ''
            );
            return null;
        }

        const op = data.op || null;
        const autorun = data.autorun !== false;

        mi.setSize(
            data.matrix.length,
            data.matrix[0].length,
            { preserve: false }
        );
        mi.write(data.matrix);

        _cacheClear();

        if (op && OPS[op]) {
            setOperation(op, scope);
        }

        ML.toast.success(
            tr('eigen.exampleLoaded', 'Пример загружен'),
            data.title || ''
        );

        if (autorun) {
            await runOperation(op || currentOp, {
                root: scope,
                mi: mi
            });
        }

        return data;
    }

    // =========================================================================
    // 11. ДЕЛЕГИРОВАННЫЕ ОБРАБОТЧИКИ (все клики)
    // =========================================================================

    let _delegated = false;

    function initDelegated() {
        if (_delegated) return;
        _delegated = true;

        document.addEventListener('click', function (e) {
            // 1) Табы операций
            const opBtn = e.target.closest('[data-eigen-op]');
            if (opBtn) {
                e.preventDefault();
                const scope = findPageRoot(opBtn);
                setOperation(opBtn.dataset.eigenOp, scope);
                return;
            }

            // 2) Кнопка «Найти спектр»
            const runBtn = e.target.closest('[data-eigen-run]');
            if (runBtn) {
                e.preventDefault();
                const scope = findPageRoot(runBtn);
                runOperation(currentOp, {
                    root: scope,
                    resultBlock: findResultBlock(scope),
                    placeholder: scope.querySelector(
                        '[data-eigen-placeholder], [data-calc-placeholder]'
                    ),
                    mi: findMatrixInput(scope)
                });
                return;
            }

            // 3) Кнопка «Очистить»
            const resetBtn = e.target.closest('[data-eigen-reset]');
            if (resetBtn) {
                e.preventDefault();
                const scope = findPageRoot(resetBtn);
                const mi = findMatrixInput(scope);
                if (mi) mi.clear();
                clearRendered(scope);
                _cacheClear();
                const ph = scope.querySelector(
                    '[data-eigen-placeholder], [data-calc-placeholder]'
                );
                if (ph) ph.hidden = false;
                updateRunButtonState(scope);
                ML.emit('eigen:reset', {});
                return;
            }

            // 4) Пресет с бэкендом
            const presetBtn = e.target.closest('[data-eigen-preset]');
            if (presetBtn) {
                e.preventDefault();
                loadPreset(presetBtn.dataset.eigenPreset, presetBtn);
                return;
            }

            // 5) Инлайн-пример из шаблона
            const exampleBtn = e.target.closest('[data-eigen-example]');
            if (exampleBtn) {
                e.preventDefault();
                loadExample(exampleBtn.dataset.eigenExample, exampleBtn);
                return;
            }
        });
    }

    // =========================================================================
    // 12. МОНТИРОВАНИЕ
    // =========================================================================

    let _mounted = false;

    function mount(root) {
        root = root || document;

        // Делегирование — всегда
        initDelegated();

        if (_mounted) return true;

        const runBtn = findRunBtn(root);
        if (!runBtn) return false;

        /* Ждём, пока matrix.js создаст редакторы.
           Пока ML.matrixInputs пуст — пробуем ещё раз через 50мс,
           максимум 40 попыток (2 секунды). */
        const ready = ML.matrixInputs
            && Object.keys(ML.matrixInputs).length > 0;

        if (!ready) {
            if (!mount._tries) mount._tries = 0;
            mount._tries++;
            if (mount._tries > 40) {
                console.warn('[eigen] matrix.js так и не создал редакторы — ' +
                    'проверьте порядок подключения скриптов ' +
                    '(matrix.js должен идти до eigen.js).');
                return false;
            }
            setTimeout(function () { mount(root); }, 50);
            return false;
        }

        _mounted = true;

        const section = findPageRoot(runBtn);
        const mi = findMatrixInput(section);

        cleanupMissingIcons(document);

        const updateDebounced = ML.debounce(function () {
            updateRunButtonState(section);
        }, 80);

        if (mi && mi.el && mi.el.addEventListener) {
            mi.el.addEventListener('matrix:change', function () {
                autoResizeForCurrent(section);
                updateDebounced();
                _cacheClear();
            });
        }
        if (ML.on) ML.on('matrix:change', updateDebounced);

        // Начальное состояние табов
        const initialBtn = section.querySelector('[data-eigen-op].is-active')
            || section.querySelector('[data-eigen-op]');
        if (initialBtn && initialBtn.dataset.eigenOp) {
            currentOp = initialBtn.dataset.eigenOp;
        }
        setOperation(currentOp, section);

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
        ML.eigen.loadPreset = loadPreset;
        ML.eigen.loadExample = loadExample;

        ML.emit('eigen:ready', {});
        return true;
    }

    // =========================================================================
    // 13. ИНИЦИАЛИЗАЦИЯ
    // =========================================================================

    let _initialized = false;

    function init() {
        if (_initialized) return;
        _initialized = true;

        cleanupMissingIcons(document);
        initDelegated();

        /* Пытаемся смонтировать сразу. Если matrix.js ещё не отработал —
           mount() сам себя перезапустит по таймеру. */
        if (document.querySelector('[data-eigen-run]')) {
            mount(document);
        } else {
            /* DOM мог быть ещё не готов — ждём. */
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', function () {
                    if (document.querySelector('[data-eigen-run]')) {
                        mount(document);
                    }
                });
            }
        }

        ML.emit('eigen:module-ready', {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();