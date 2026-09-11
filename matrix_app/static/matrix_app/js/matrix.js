/* =============================================================================
   MatrixLab — matrix.js
   =============================================================================
   Работа с интерактивными сетками ввода матриц и векторов.

   Структура:
       1.  Класс MatrixInput
       2.  Класс VectorInput
       3.  Инициализация сеток
       4.  Chip-кнопки (инструменты матрицы)
       5.  Размерные контролы +/−
       6.  Ручной ввод размеров
       7.  Синхронизация вектора с матрицей
       8.  Динамическое добавление/удаление матриц (chain)
       9.  Инициализация модуля
   ============================================================================= */
(function () {
    'use strict';

    const ML = window.MatrixLab;
    if (!ML) return;

    // =========================================================================
    // 1. КЛАСС MatrixInput
    // =========================================================================
    class MatrixInput {
        constructor(container, letter) {
            this.el = container;
            this.letter = (letter || 'a').toLowerCase();
            this.rows = parseInt(container.dataset.rows || '3', 10);
            this.cols = parseInt(container.dataset.cols || '3', 10);
            this.inputs = [];
            this._build();
            this._bindEvents();
        }

        _build() {
            this.el.innerHTML = '';
            this.el.style.gridTemplateColumns = `repeat(${this.cols}, minmax(0, 1fr))`;
            this.inputs = [];

            for (let r = 0; r < this.rows; r++) {
                const rowInputs = [];
                for (let c = 0; c < this.cols; c++) {
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.autocomplete = 'off';
                    input.spellcheck = false;
                    input.setAttribute(
                        'aria-label',
                        `Элемент ${this.letter.toUpperCase()}${r + 1},${c + 1}`
                    );
                    input.dataset.row = String(r);
                    input.dataset.col = String(c);
                    this.el.appendChild(input);
                    rowInputs.push(input);
                }
                this.inputs.push(rowInputs);
            }
            this._updateBadge();
        }

        _updateBadge() {
            const card = this.el.closest('[data-matrix-card]');
            if (!card) return;
            const badge = card.querySelector(
                `[data-matrix-shape-label="${this.letter}"]`
            );
            if (badge) badge.textContent = `${this.rows} × ${this.cols}`;
        }

        _bindEvents() {
            this.el.addEventListener('keydown', (e) => {
                const target = e.target;
                if (!target.matches('input')) return;
                const r = parseInt(target.dataset.row, 10);
                const c = parseInt(target.dataset.col, 10);

                let next = null;
                switch (e.key) {
                    case 'ArrowUp':    next = this._at(r - 1, c); break;
                    case 'ArrowDown':  next = this._at(r + 1, c); break;
                    case 'ArrowLeft':
                        if (target.selectionStart === 0 && target.selectionEnd === 0)
                            next = this._at(r, c - 1);
                        break;
                    case 'ArrowRight':
                        if (target.selectionStart === target.value.length
                            && target.selectionEnd === target.value.length)
                            next = this._at(r, c + 1);
                        break;
                    case 'Enter':
                        next = this._at(r + 1, c) || this._at(0, c + 1);
                        e.preventDefault();
                        break;
                }

                if (next) {
                    e.preventDefault();
                    next.focus();
                    next.select();
                }
            });

            this.el.addEventListener('paste', (e) => {
                const target = e.target;
                if (!target.matches('input')) return;
                const text = (e.clipboardData || window.clipboardData).getData('text');
                if (!text) return;

                const hasTableChars = text.includes('\t')
                    || text.includes('\n')
                    || text.includes(',')
                    || text.includes(';');
                if (!hasTableChars) return;

                e.preventDefault();
                const startRow = parseInt(target.dataset.row, 10);
                const startCol = parseInt(target.dataset.col, 10);
                this.pasteMatrix(text, startRow, startCol);
            });
        }

        pasteMatrix(text, startRow, startCol) {
            if (startRow === undefined) startRow = 0;
            if (startCol === undefined) startCol = 0;

            const rowsRaw = text.replace(/\r/g, '').split('\n').filter(function (x) {
                return x.trim() !== '';
            });

            let rowList = rowsRaw;
            if (rowsRaw.length === 1 && rowsRaw[0].includes(';')) {
                rowList = rowsRaw[0].split(';');
            }

            let maxCols = 0;
            const parsed = rowList.map(function (line) {
                const cells = line.split(/\t|,|;/).map(function (x) {
                    return x.trim();
                });
                if (cells.length > maxCols) maxCols = cells.length;
                return cells;
            });

            const neededRows = Math.max(this.rows, startRow + parsed.length);
            const neededCols = Math.max(this.cols, startCol + maxCols);
            if (neededRows !== this.rows || neededCols !== this.cols) {
                this.setSize(neededRows, neededCols, { preserve: true });
            }

            const self = this;
            parsed.forEach(function (row, dr) {
                row.forEach(function (val, dc) {
                    const input = self._at(startRow + dr, startCol + dc);
                    if (input) input.value = val;
                });
            });
        }

        _at(r, c) {
            if (r < 0 || r >= this.rows) return null;
            if (c < 0 || c >= this.cols) return null;
            return this.inputs[r][c];
        }

        setSize(rows, cols, opts) {
            opts = opts || {};
            const preserve = opts.preserve !== false;

            rows = Math.max(1, Math.min(rows, ML.maxRows));
            cols = Math.max(1, Math.min(cols, ML.maxCols));

            if (rows === this.rows && cols === this.cols) return;

            const oldValues = preserve ? this.read() : null;

            this.rows = rows;
            this.cols = cols;
            this.el.dataset.rows = String(rows);
            this.el.dataset.cols = String(cols);
            this._build();

            if (oldValues) {
                const rMax = Math.min(oldValues.length, rows);
                for (let r = 0; r < rMax; r++) {
                    const cMax = Math.min(oldValues[r].length, cols);
                    for (let c = 0; c < cMax; c++) {
                        this.inputs[r][c].value = oldValues[r][c];
                    }
                }
            }
            this._syncSizeInputs();
        }

        _syncSizeInputs() {
            const card = this.el.closest('[data-matrix-card]');
            if (!card) return;
            const L = this.letter;

            const rInp = card.querySelector(`[data-${L}-rows]`);
            const cInp = card.querySelector(`[data-${L}-cols]`);
            if (rInp) rInp.value = this.rows;
            if (cInp && cInp !== rInp) cInp.value = this.cols;
        }

        makeSquare() {
            const n = Math.max(this.rows, this.cols);
            this.setSize(n, n);
            ML.toast.info(
                `Матрица ${this.letter.toUpperCase()} приведена к квадратной`,
                `${n} × ${n}`
            );
            return this;
        }

        read() {
            return this.inputs.map(function (row) {
                return row.map(function (input) {
                    return input.value.trim();
                });
            });
        }

        write(data) {
            if (!Array.isArray(data)) return;
            for (let r = 0; r < Math.min(data.length, this.rows); r++) {
                const rowData = data[r];
                if (!Array.isArray(rowData)) continue;
                for (let c = 0; c < Math.min(rowData.length, this.cols); c++) {
                    const val = rowData[c];
                    this.inputs[r][c].value =
                        (val === null || val === undefined) ? '' : String(val);
                }
            }
        }

        clear() {
            this.inputs.forEach(function (row) {
                row.forEach(function (inp) {
                    inp.value = '';
                    inp.classList.remove('has-error');
                });
            });
        }

        fillZero() {
            this.inputs.forEach(function (row) {
                row.forEach(function (inp) {
                    inp.value = '0';
                    inp.classList.remove('has-error');
                });
            });
        }

        fillIdentity() {
            if (this.rows !== this.cols) this.makeSquare();
            this.inputs.forEach(function (row, r) {
                row.forEach(function (inp, c) {
                    inp.value = r === c ? '1' : '0';
                    inp.classList.remove('has-error');
                });
            });
        }

        fillRandom() {
            this.inputs.forEach(function (row) {
                row.forEach(function (inp) {
                    inp.value = String(Math.floor(Math.random() * 19) - 9);
                    inp.classList.remove('has-error');
                });
            });
        }

        transposeInPlace() {
            const data = this.read();
            const newRows = this.cols;
            const newCols = this.rows;

            this.rows = newRows;
            this.cols = newCols;
            this.el.dataset.rows = String(newRows);
            this.el.dataset.cols = String(newCols);
            this._build();

            for (let r = 0; r < newRows; r++) {
                for (let c = 0; c < newCols; c++) {
                    this.inputs[r][c].value = data[c][r] || '';
                }
            }
            this._syncSizeInputs();
        }

        isEmpty() {
            return this.read().every(function (row) {
                return row.every(function (v) {
                    return v === '';
                });
            });
        }

        focusFirst() {
            if (this.inputs[0] && this.inputs[0][0]) this.inputs[0][0].focus();
        }

        markError(positions) {
            this.inputs.forEach(function (row) {
                row.forEach(function (inp) {
                    inp.classList.remove('has-error');
                });
            });
            if (!Array.isArray(positions)) return;
            const self = this;
            positions.forEach(function (pos) {
                const inp = self._at(pos[0], pos[1]);
                if (inp) inp.classList.add('has-error');
            });
        }
    }

    ML.MatrixInput = MatrixInput;
    ML.matrixInputs = {};

    // =========================================================================
    // 2. КЛАСС VectorInput
    // =========================================================================
    class VectorInput {
        constructor(container) {
            this.el = container;
            this.rows = parseInt(container.dataset.rows || '3', 10);
            this.inputs = [];
            this._build();
        }

        _build() {
            this.el.innerHTML = '';
            this.inputs = [];

            for (let i = 0; i < this.rows; i++) {
                const inp = document.createElement('input');
                inp.type = 'text';
                inp.autocomplete = 'off';
                inp.spellcheck = false;
                inp.setAttribute('aria-label', `b${i + 1}`);
                inp.dataset.row = String(i);
                this.el.appendChild(inp);
                this.inputs.push(inp);
            }
            this._updateBadge();
            this._bindEvents();
        }

        _updateBadge() {
            const badge = this.el
                .closest('.vector-input-card')
                ?.querySelector('[data-vector-shape-label]');
            if (badge) badge.textContent = `${this.rows} × 1`;
        }

        _bindEvents() {
            this.el.addEventListener('keydown', (e) => {
                const target = e.target;
                if (!target.matches('input')) return;
                const r = parseInt(target.dataset.row, 10);

                if (e.key === 'ArrowDown' || e.key === 'Enter') {
                    const next = this.inputs[r + 1];
                    if (next) {
                        e.preventDefault();
                        next.focus();
                        next.select();
                    }
                } else if (e.key === 'ArrowUp') {
                    const prev = this.inputs[r - 1];
                    if (prev) {
                        e.preventDefault();
                        prev.focus();
                        prev.select();
                    }
                }
            });

            this.el.addEventListener('paste', (e) => {
                const text = (e.clipboardData || window.clipboardData).getData('text');
                if (!text) return;
                const hasSeps = text.includes('\n')
                    || text.includes('\t')
                    || text.includes(',')
                    || text.includes(';');
                if (!hasSeps) return;

                e.preventDefault();
                const values = text.split(/[\n\t,;]+/).map(function (x) {
                    return x.trim();
                }).filter(function (x) { return x; });

                const self = this;
                values.forEach(function (v, i) {
                    if (self.inputs[i]) self.inputs[i].value = v;
                });
            });
        }

        setSize(rows) {
            rows = Math.max(1, Math.min(rows, ML.maxRows));
            if (rows === this.rows) return;
            const old = this.read();
            this.rows = rows;
            this.el.dataset.rows = String(rows);
            this._build();
            for (let i = 0; i < Math.min(old.length, rows); i++) {
                this.inputs[i].value = old[i];
            }
        }

        read() {
            return this.inputs.map(function (i) {
                return i.value.trim();
            });
        }

        write(data) {
            if (!Array.isArray(data)) return;
            this.setSize(data.length);
            const self = this;
            data.forEach(function (v, i) {
                if (self.inputs[i]) {
                    self.inputs[i].value =
                        (v === null || v === undefined) ? '' : String(v);
                }
            });
        }

        clear() {
            this.inputs.forEach(function (i) {
                i.value = '';
            });
        }

        isEmpty() {
            return this.read().every(function (v) {
                return v === '';
            });
        }

        focusFirst() {
            if (this.inputs[0]) this.inputs[0].focus();
        }
    }

    ML.VectorInput = VectorInput;
    ML.vectorInputs = {};

    // =========================================================================
    // 3. ИНИЦИАЛИЗАЦИЯ СЕТОК
    // =========================================================================
    function initMatrixInputs() {
        ML.$$('[data-matrix-input]').forEach(function (el) {
            const key = el.id || ('matrix-' + Object.keys(ML.matrixInputs).length);
            const card = el.closest('[data-matrix-card]');
            const letter = (card && card.dataset.matrixCard)
                || el.dataset.matrixLetter
                || 'a';
            ML.matrixInputs[key] = new MatrixInput(el, letter);
        });
    }

    function initVectorInputs() {
        ML.$$('[data-vector-input]').forEach(function (el) {
            const key = el.id || 'vector';
            ML.vectorInputs[key] = new VectorInput(el);
        });
    }

    ML.getMatrixByLetter = function (letter) {
        const card = document.querySelector(`[data-matrix-card="${letter}"]`);
        if (!card) return null;
        const grid = card.querySelector('[data-matrix-input]');
        if (!grid) return null;
        return ML.matrixInputs[grid.id] || null;
    };

    // =========================================================================
    // 4. CHIP-КНОПКИ
    // =========================================================================
    function initMatrixTools() {
        document.addEventListener('click', function (e) {
            const btn = e.target.closest('[data-matrix-action]');
            if (!btn) return;

            const target = (btn.dataset.matrixTarget || 'a').toLowerCase();
            const mi = ML.getMatrixByLetter(target);
            if (!mi) return;

            const action = btn.dataset.matrixAction;
            const label = target.toUpperCase();

            switch (action) {
                case 'zero': mi.fillZero(); ML.toast.info(`${label}: нули`, ''); break;
                case 'identity': mi.fillIdentity(); ML.toast.info(`${label}: единичная`, ''); break;
                case 'random': mi.fillRandom(); ML.toast.info(`${label}: случайные значения`, ''); break;
                case 'transpose': mi.transposeInPlace(); ML.toast.success(`${label} транспонирована`, ''); break;
                case 'copy': {
                    const text = mi.read().map(function (row) { return row.join('\t'); }).join('\n');
                    ML.copy.text(text, `Матрица ${label} скопирована`);
                    break;
                }
                case 'paste':
                    navigator.clipboard.readText().then(function (text) {
                        if (!text) { ML.toast.warning('Буфер пуст', ''); return; }
                        mi.pasteMatrix(text, 0, 0);
                        ML.toast.success(`Вставлено в ${label}`, '');
                    }).catch(function () {
                        ML.toast.warning('Доступ запрещён', 'Разрешите чтение буфера.');
                    });
                    break;
                case 'square': mi.makeSquare(); break;
                case 'clear': mi.clear(); ML.toast.info(`${label} очищена`, ''); break;
                case 'remove': ML.chain.remove(target); break;
            }
        });
    }

    // =========================================================================
    // 5. РАЗМЕРНЫЕ КОНТРОЛЫ +/−
    // =========================================================================
    function parseSizeAttr(dataset) {
        // Ищем ключи вида: sizeIncrXRows, sizeDecrXCols, sizeIncrARows, ...
        // Возвращаем { direction, axis, target } или null.
        let result = null;

        Object.keys(dataset).forEach(function (key) {
            let direction = null;
            let rest = '';

            if (key.indexOf('sizeIncr') === 0) {
                direction = 'incr';
                rest = key.slice('sizeIncr'.length);
            } else if (key.indexOf('sizeDecr') === 0) {
                direction = 'decr';
                rest = key.slice('sizeDecr'.length);
            } else {
                return;
            }

            // rest = "ARows" | "BCols" | "XRows" | ...
            const m = rest.match(/^([A-Z])(Rows|Cols)$/);
            if (!m) return;

            const targetLetter = m[1].toLowerCase();
            const axis = m[2] === 'Rows' ? 'rows' : 'cols';

            result = { direction, axis, target: targetLetter };
        });

        return result;
    }

    function handleSizeBtn(e) {
        const btn = e.currentTarget;
        const info = parseSizeAttr(btn.dataset);
        if (!info) return;

        const mi = ML.getMatrixByLetter(info.target);
        if (!mi) return;

        let rows = mi.rows;
        let cols = mi.cols;
        if (info.axis === 'rows') rows += (info.direction === 'incr' ? 1 : -1);
        else cols += (info.direction === 'incr' ? 1 : -1);

        mi.setSize(rows, cols);
        if (info.target === 'a') syncVectorToMatrix();
    }

    function initSizeControls() {
        document.querySelectorAll('.size-btn, [data-size-incr], [data-size-decr]')
            .forEach(function (btn) {
                btn.addEventListener('click', handleSizeBtn);
            });
    }

    // =========================================================================
    // 6. РУЧНОЙ ВВОД РАЗМЕРОВ
    // =========================================================================
    function initSizeInputs() {
        const rInp = document.querySelector('[data-rows-input], #rows-input, [data-n-input]');
        const cInp = document.querySelector('[data-cols-input], #cols-input, [data-n-input]');

        function applyMain() {
            const grid = document.querySelector('[data-matrix-card="a"] [data-matrix-input]');
            if (!grid) return;
            const mi = ML.matrixInputs[grid.id];
            if (!mi) return;

            let rows = parseInt(rInp && rInp.value, 10);
            let cols = cInp ? parseInt(cInp.value, 10) : rows;
            if (isNaN(rows)) rows = mi.rows;
            if (isNaN(cols)) cols = mi.cols;

            if (rInp && cInp && rInp === cInp) cols = rows;

            mi.setSize(rows, cols);
            syncVectorToMatrix();
        }

        if (rInp) rInp.addEventListener('change', applyMain);
        if (cInp && cInp !== rInp) cInp.addEventListener('change', applyMain);

        // Поля A/B/C/... (страница операций)
        ML.$$('[data-a-rows], [data-b-rows], [data-c-rows], [data-d-rows], [data-e-rows]')
            .forEach(function (r) {
                const letter = r.dataset.aRows !== undefined ? 'a'
                    : r.dataset.bRows !== undefined ? 'b'
                    : r.dataset.cRows !== undefined ? 'c'
                    : r.dataset.dRows !== undefined ? 'd' : 'e';
                const c = document.querySelector(`[data-${letter}-cols]`);

                function apply() {
                    const mi = ML.getMatrixByLetter(letter);
                    if (!mi) return;
                    let rows = parseInt(r.value, 10);
                    let cols = parseInt(c && c.value, 10);
                    if (isNaN(rows)) rows = mi.rows;
                    if (isNaN(cols)) cols = mi.cols;
                    mi.setSize(rows, cols);
                }

                r.addEventListener('change', apply);
                if (c) c.addEventListener('change', apply);
            });
    }

    // =========================================================================
    // 7. СИНХРОНИЗАЦИЯ ВЕКТОРА С МАТРИЦЕЙ
    // =========================================================================
    function syncVectorToMatrix() {
        const gridA = document.querySelector('[data-matrix-card="a"] [data-matrix-input]');
        const vecEl = document.querySelector('[data-vector-input]');
        if (!gridA || !vecEl) return;

        const miA = ML.matrixInputs[gridA.id];
        const vec = ML.vectorInputs[vecEl.id];
        if (!miA || !vec) return;

        vec.setSize(miA.rows);
    }

    ML.syncVectorToMatrix = syncVectorToMatrix;

    // =========================================================================
    // 8. ДИНАМИЧЕСКОЕ ДОБАВЛЕНИЕ / УДАЛЕНИЕ МАТРИЦ
    // =========================================================================
    ML.chain = {
        _letters: 'abcdefghijklmnopqrstuvwxyz'.split(''),

        letters: function () {
            return ML.$$('[data-matrix-card]').map(function (card) {
                return card.dataset.matrixCard;
            });
        },

        add: function () {
            const cards = ML.$$('[data-matrix-card]');
            const idx = cards.length;
            if (idx >= this._letters.length) {
                ML.toast.warning('Слишком много матриц', 'Максимум 26.');
                return null;
            }
            const letter = this._letters[idx];
            const tpl = document.getElementById('matrix-template');
            if (!tpl) {
                ML.toast.error('Шаблон не найден', '');
                return null;
            }

            const node = tpl.content.cloneNode(true);
            const card = node.querySelector('[data-matrix-card]');
            card.dataset.matrixCard = letter;

            // Буквы
            card.querySelectorAll('[data-matrix-letter]').forEach(function (el) {
                el.textContent = letter.toUpperCase();
            });
            card.querySelectorAll('[data-matrix-label]').forEach(function (el) {
                el.textContent = letter.toUpperCase();
            });

            // Сетка
            card.querySelectorAll('[data-matrix-input]').forEach(function (el) {
                el.dataset.matrixLetter = letter;
                el.id = `matrix-${letter}-input`;
                el.dataset.rows = '3';
                el.dataset.cols = '3';
            });

            // Бейдж размера
            card.querySelectorAll('[data-matrix-shape-label]').forEach(function (el) {
                el.dataset.matrixShapeLabel = letter;
            });

            // Ручной ввод размеров: data-x-rows → data-c-rows
            card.querySelectorAll('[data-x-rows]').forEach(function (el) {
                el.dataset[letter + 'Rows'] = el.dataset.xRows;
                delete el.dataset.xRows;
            });
            card.querySelectorAll('[data-x-cols]').forEach(function (el) {
                el.dataset[letter + 'Cols'] = el.dataset.xCols;
                delete el.dataset.xCols;
            });

            // Кнопки +/−: sizeIncrXRows → sizeIncrCRows
            card.querySelectorAll('[data-size-incr], [data-size-decr]').forEach(function (el) {
                ['sizeIncrXRows', 'sizeIncrXCols', 'sizeDecrXRows', 'sizeDecrXCols']
                    .forEach(function (k) {
                        if (el.dataset[k] !== undefined) {
                            const newKey = k.replace(
                                'X',
                                letter.charAt(0).toUpperCase() + letter.slice(1)
                            );
                            el.dataset[newKey] = el.dataset[k];
                            delete el.dataset[k];
                        }
                    });
            });

            // Chip-кнопки
            card.querySelectorAll('[data-matrix-action]').forEach(function (el) {
                if (el.dataset.matrixTarget === '') {
                    el.dataset.matrixTarget = letter;
                }
            });

            // Вставка
            const anchor = document.querySelector('[data-add-matrix]');
            if (anchor && anchor.parentNode) {
                anchor.parentNode.insertBefore(card, anchor);
            } else {
                const cont = document.querySelector('[data-extra-matrices]');
                if (cont) cont.appendChild(card);
            }

            // Инициализируем сетку
            const grid = card.querySelector('[data-matrix-input]');
            if (grid) {
                ML.matrixInputs[grid.id] = new MatrixInput(grid, letter);
            }

            // Привязываем кнопки +/− этой карточки
            card.querySelectorAll('.size-btn, [data-size-incr], [data-size-decr]')
                .forEach(function (btn) {
                    btn.addEventListener('click', handleSizeBtn);
                });

            // Привязываем поля ручного ввода
            const rInp = card.querySelector(`[data-${letter}-rows]`);
            const cInp = card.querySelector(`[data-${letter}-cols]`);
            if (rInp || cInp) {
                function apply() {
                    const mi = ML.getMatrixByLetter(letter);
                    if (!mi) return;
                    let r = parseInt(rInp && rInp.value, 10);
                    let c = parseInt(cInp && cInp.value, 10);
                    if (isNaN(r)) r = mi.rows;
                    if (isNaN(c)) c = mi.cols;
                    mi.setSize(r, c);
                }
                if (rInp) rInp.addEventListener('change', apply);
                if (cInp) cInp.addEventListener('change', apply);
            }

            return letter;
        },

        remove: function (letter) {
            if (letter === 'a') {
                ML.toast.warning('Матрицу A удалить нельзя', '');
                return;
            }
            const card = document.querySelector(`[data-matrix-card="${letter}"]`);
            if (!card) return;

            const grid = card.querySelector('[data-matrix-input]');
            if (grid) delete ML.matrixInputs[grid.id];

            card.remove();
            ML.toast.info(`Матрица ${letter.toUpperCase()} удалена`, '');
        },
    };

    function initAddMatrixButton() {
        const btn = document.querySelector('[data-add-matrix]');
        if (!btn) return;
        btn.addEventListener('click', function () {
            ML.chain.add();
        });
    }

    // =========================================================================
    // 9. ИНИЦИАЛИЗАЦИЯ МОДУЛЯ
    // =========================================================================
    ML.initMatrixModule = function () {
        const body = document.body;
        ML.maxRows = parseInt(
            body.dataset.maxRows || window.MATRIXLAB_MAX_ROWS || '10', 10
        );
        ML.maxCols = parseInt(
            body.dataset.maxCols || window.MATRIXLAB_MAX_COLS || '10', 10
        );

        initMatrixInputs();
        initVectorInputs();
        initMatrixTools();
        initSizeControls();
        initSizeInputs();
        initAddMatrixButton();
        syncVectorToMatrix();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            ML.initMatrixModule();
        });
    } else {
        ML.initMatrixModule();
    }

})();