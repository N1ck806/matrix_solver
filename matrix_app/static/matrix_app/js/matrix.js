/* =============================================================================
   MatrixLab — matrix.js
   =============================================================================
   Полностью переписанная версия.

   Возможности:
       • MatrixInput — сетка ячеек-кнопок (не <input>!) с кастомной клавиатурой;
       • VectorInput — вектор-столбец (для СЛАУ);
       • Цифровая клавиатура: тап по ячейке → popup 0–9, +/-, /, ., sqrt, pi, i;
       • Тап вне клавиатуры → сохранить и закрыть;
       • Клавиатура работает на ПК и на мобильном (на мобильном — снизу);
       • Поддержка обоих стилей size-кнопок: data-size-incr-a-rows и data-size-incr="rows";
       • Поддержка обоих стилей ручного ввода: data-a-rows и #rows-input;
       • Динамические матрицы C, D, E… через <template id="matrix-template">;
       • Работает и на calculator.html, и на operations.html.

   Структура:
       1.  Константы
       2.  Класс MatrixInput
       3.  Класс VectorInput
       4.  Цифровая клавиатура (DigitalKeyboard)
       5.  Инициализация сеток
       6.  Размерные контролы (+/−)
       7.  Ручной ввод размеров
       8.  Chip-кнопки (действия над матрицей)
       9.  Синхронизация вектора с матрицей
       10. Динамическое добавление/удаление матриц (chain)
       11. Утилиты
       12. Инициализация модуля
   ============================================================================= */
(function () {
    'use strict';

    var ML = window.MatrixLab;
    if (!ML) {
        console.error('[matrix.js] window.MatrixLab не найден.');
        return;
    }

    // =========================================================================
    // 1. КОНСТАНТЫ
    // =========================================================================

    var LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

    // Клавиши цифровой клавиатуры — в порядке отображения
    var KEYPAD_KEYS = [
        { k: '7', t: '7' },
        { k: '8', t: '8' },
        { k: '9', t: '9' },
        { k: '/', t: '/' },
        { k: '4', t: '4' },
        { k: '5', t: '5' },
        { k: '6', t: '6' },
        { k: '*', t: '×' },
        { k: '1', t: '1' },
        { k: '2', t: '2' },
        { k: '3', t: '3' },
        { k: '-', t: '−' },
        { k: '0', t: '0' },
        { k: '.', t: '.' },
        { k: 'pi', t: 'π' },
        { k: '+', t: '+' },
        { k: 'i', t: 'i' },
        { k: 'sqrt', t: '√' },
        { k: '(', t: '(' },
        { k: ')', t: ')' },
        { k: 'C', t: 'C', kind: 'danger' },
        { k: 'back', t: '⌫', kind: 'warning' },
        { k: 'done', t: 'Готово', kind: 'primary', wide: true }
    ];

    // =========================================================================
    // 2. КЛАСС MatrixInput (сетка ячеек-кнопок)
    // =========================================================================

    function MatrixInput(container, letter) {
        this.el = container;
        this.letter = String(letter || 'a').toLowerCase();
        this.rows = parseInt(container.dataset.rows || '3', 10);
        this.cols = parseInt(container.dataset.cols || '3', 10);

        // Двумерный массив значений (строк)
        this.values = [];
        // Двумерный массив DOM-элементов ячеек
        this.cells = [];

        this._build();
        this._bindKeyboardNavigation();
    }

    MatrixInput.prototype._build = function () {
        var self = this;
        this.el.innerHTML = '';
        this.el.style.gridTemplateColumns = 'repeat(' + this.cols + ', minmax(0, 1fr))';
        this.el.classList.add('matrix-grid');

        // Сохраняем старые значения, если они есть
        var old = this.values.length ? this.values : null;

        this.values = [];
        this.cells = [];

        for (var r = 0; r < this.rows; r++) {
            var valueRow = [];
            var cellRow = [];
            for (var c = 0; c < this.cols; c++) {
                var cell = document.createElement('button');
                cell.type = 'button';
                cell.className = 'matrix-cell';
                cell.dataset.row = String(r);
                cell.dataset.col = String(c);
                cell.setAttribute(
                    'aria-label',
                    'Элемент ' + this.letter.toUpperCase() + (r + 1) + ',' + (c + 1)
                );

                var val = '';
                if (old && old[r] && old[r][c] !== undefined) {
                    val = old[r][c];
                }

                cell.textContent = val;
                cell.dataset.value = val;

                if (val !== '') cell.classList.add('is-filled');

                this.el.appendChild(cell);
                valueRow.push(val);
                cellRow.push(cell);
            }
            this.values.push(valueRow);
            this.cells.push(cellRow);
        }

        this._updateBadge();
        this._updateSizeInputs();
    };

    MatrixInput.prototype._updateBadge = function () {
        var card = this.el.closest('[data-matrix-card]');
        if (!card) return;
        var badge = card.querySelector('[data-matrix-shape-label="' + this.letter + '"]');
        if (!badge) {
            badge = card.querySelector('[data-matrix-shape-label]');
        }
        if (badge) {
            badge.textContent = this.rows + ' × ' + this.cols;
        }
    };

    MatrixInput.prototype._updateSizeInputs = function () {
        var card = this.el.closest('[data-matrix-card]');
        if (!card) return;
        var L = this.letter;

        // Новый стиль: data-a-rows / data-a-cols
        var rNew = card.querySelector('[data-' + L + '-rows]');
        var cNew = card.querySelector('[data-' + L + '-cols]');
        if (rNew) rNew.value = this.rows;
        if (cNew) cNew.value = this.cols;

        // Старый стиль: #rows-input / #cols-input
        if (L === 'a') {
            var rOld = document.querySelector('#rows-input');
            var cOld = document.querySelector('#cols-input');
            if (rOld) rOld.value = this.rows;
            if (cOld) cOld.value = this.cols;
        }
    };

    MatrixInput.prototype._bindKeyboardNavigation = function () {
        var self = this;
        this.el.addEventListener('keydown', function (e) {
            var target = e.target;
            if (!target.classList.contains('matrix-cell')) return;
            var r = parseInt(target.dataset.row, 10);
            var c = parseInt(target.dataset.col, 10);
            var next = null;

            switch (e.key) {
                case 'ArrowUp':    next = self._at(r - 1, c); break;
                case 'ArrowDown':  next = self._at(r + 1, c); break;
                case 'ArrowLeft':  next = self._at(r, c - 1); break;
                case 'ArrowRight': next = self._at(r, c + 1); break;
                case 'Enter':
                    next = self._at(r + 1, c) || self._at(0, c + 1);
                    e.preventDefault();
                    break;
                case 'Backspace':
                    self.setValue(r, c, '');
                    e.preventDefault();
                    return;
                case 'Delete':
                    self.setValue(r, c, '');
                    e.preventDefault();
                    return;
            }

            if (next) {
                e.preventDefault();
                ML.digitalKeyboard.openFor(next, self);
            }
        });
    };

    MatrixInput.prototype._at = function (r, c) {
        if (r < 0 || r >= this.rows) return null;
        if (c < 0 || c >= this.cols) return null;
        return this.cells[r][c];
    };

    MatrixInput.prototype.setValue = function (r, c, value) {
        if (r < 0 || r >= this.rows) return;
        if (c < 0 || c >= this.cols) return;
        var cell = this.cells[r][c];
        var v = String(value == null ? '' : value);
        this.values[r][c] = v;
        cell.dataset.value = v;
        cell.textContent = v;
        cell.classList.toggle('is-filled', v !== '');
        this._dispatchChange();
    };

    MatrixInput.prototype.getValue = function (r, c) {
        if (r < 0 || r >= this.rows) return '';
        if (c < 0 || c >= this.cols) return '';
        return this.values[r][c];
    };

    MatrixInput.prototype._dispatchChange = function () {
        var ev = new CustomEvent('matrix:change', {
            bubbles: true,
            detail: { matrix: this }
        });
        this.el.dispatchEvent(ev);
    };

    MatrixInput.prototype.setSize = function (rows, cols, opts) {
        opts = opts || {};
        var preserve = opts.preserve !== false;

        rows = Math.max(1, Math.min(rows, ML.maxRows));
        cols = Math.max(1, Math.min(cols, ML.maxCols));

        if (rows === this.rows && cols === this.cols) return;

        // Сохраняем значения, если нужно
        var oldValues = this.values.map(function (row) {
            return row.slice();
        });

        this.rows = rows;
        this.cols = cols;
        this.el.dataset.rows = String(rows);
        this.el.dataset.cols = String(cols);

        // Принудительно строим новую сетку, значения восстановим вручную
        var saved = preserve ? oldValues : null;
        this.values = [];
        this.cells = [];
        this._build();

        if (saved) {
            var rMax = Math.min(saved.length, rows);
            for (var r = 0; r < rMax; r++) {
                var cMax = Math.min(saved[r].length, cols);
                for (var c = 0; c < cMax; c++) {
                    this.setValue(r, c, saved[r][c]);
                }
            }
        }
    };

    MatrixInput.prototype.makeSquare = function () {
        var n = Math.max(this.rows, this.cols);
        this.setSize(n, n);
        if (ML.toast) {
            ML.toast.info(
                'Матрица ' + this.letter.toUpperCase() + ' приведена к квадратной',
                n + ' × ' + n
            );
        }
        return this;
    };

    MatrixInput.prototype.read = function () {
        return this.values.map(function (row) { return row.slice(); });
    };

    MatrixInput.prototype.write = function (data) {
        if (!Array.isArray(data)) return;
        var rMax = Math.min(data.length, this.rows);
        for (var r = 0; r < rMax; r++) {
            if (!Array.isArray(data[r])) continue;
            var cMax = Math.min(data[r].length, this.cols);
            for (var c = 0; c < cMax; c++) {
                var v = data[r][c];
                this.setValue(r, c, v == null ? '' : String(v));
            }
        }
    };

    MatrixInput.prototype.clear = function () {
        for (var r = 0; r < this.rows; r++) {
            for (var c = 0; c < this.cols; c++) {
                this.setValue(r, c, '');
            }
        }
    };

    MatrixInput.prototype.fillZero = function () {
        for (var r = 0; r < this.rows; r++) {
            for (var c = 0; c < this.cols; c++) {
                this.setValue(r, c, '0');
            }
        }
    };

    MatrixInput.prototype.fillIdentity = function () {
        if (this.rows !== this.cols) this.makeSquare();
        for (var r = 0; r < this.rows; r++) {
            for (var c = 0; c < this.cols; c++) {
                this.setValue(r, c, r === c ? '1' : '0');
            }
        }
    };

    MatrixInput.prototype.fillRandom = function () {
        for (var r = 0; r < this.rows; r++) {
            for (var c = 0; c < this.cols; c++) {
                this.setValue(r, c, String(Math.floor(Math.random() * 19) - 9));
            }
        }
    };

    MatrixInput.prototype.transposeInPlace = function () {
        var data = this.read();
        var newRows = this.cols;
        var newCols = this.rows;

        this.rows = newRows;
        this.cols = newCols;
        this.el.dataset.rows = String(newRows);
        this.el.dataset.cols = String(newCols);
        this.values = [];
        this.cells = [];
        this._build();

        for (var r = 0; r < newRows; r++) {
            for (var c = 0; c < newCols; c++) {
                this.setValue(r, c, (data[c] && data[c][r]) || '');
            }
        }
    };

    MatrixInput.prototype.isEmpty = function () {
        for (var r = 0; r < this.rows; r++) {
            for (var c = 0; c < this.cols; c++) {
                if (this.values[r][c] !== '') return false;
            }
        }
        return true;
    };

    MatrixInput.prototype.pasteMatrix = function (text, startRow, startCol) {
        startRow = startRow || 0;
        startCol = startCol || 0;

        var rowsRaw = String(text).replace(/\r/g, '').split('\n').filter(function (x) {
            return x.trim() !== '';
        });
        if (!rowsRaw.length) return;

        var rowList = rowsRaw;
        if (rowsRaw.length === 1 && rowsRaw[0].indexOf(';') !== -1) {
            rowList = rowsRaw[0].split(';');
        }

        var maxCols = 0;
        var parsed = rowList.map(function (line) {
            var cells = line.split(/\t|,|;/).map(function (x) { return x.trim(); });
            if (cells.length > maxCols) maxCols = cells.length;
            return cells;
        });

        var neededRows = Math.max(this.rows, startRow + parsed.length);
        var neededCols = Math.max(this.cols, startCol + maxCols);
        if (neededRows !== this.rows || neededCols !== this.cols) {
            this.setSize(neededRows, neededCols, { preserve: true });
        }

        for (var dr = 0; dr < parsed.length; dr++) {
            for (var dc = 0; dc < parsed[dr].length; dc++) {
                this.setValue(startRow + dr, startCol + dc, parsed[dr][dc]);
            }
        }
    };

    ML.MatrixInput = MatrixInput;
    ML.matrixInputs = {};

    // =========================================================================
    // 3. КЛАСС VectorInput
    // =========================================================================

    function VectorInput(container) {
        this.el = container;
        this.rows = parseInt(container.dataset.rows || '3', 10);
        this.values = [];
        this.cells = [];
        this._build();
    }

    VectorInput.prototype._build = function () {
        this.el.innerHTML = '';
        this.el.classList.add('vector-grid');
        var old = this.values.length ? this.values.slice() : null;

        this.values = [];
        this.cells = [];

        for (var i = 0; i < this.rows; i++) {
            var cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'matrix-cell';
            cell.dataset.row = String(i);
            cell.dataset.col = '0';
            cell.setAttribute('aria-label', 'b' + (i + 1));

            var val = (old && old[i]) || '';
            cell.textContent = val;
            cell.dataset.value = val;
            if (val !== '') cell.classList.add('is-filled');

            this.el.appendChild(cell);
            this.values.push(val);
            this.cells.push(cell);
        }
    };

    VectorInput.prototype.setValue = function (i, value) {
        if (i < 0 || i >= this.rows) return;
        var v = String(value == null ? '' : value);
        this.values[i] = v;
        var cell = this.cells[i];
        cell.dataset.value = v;
        cell.textContent = v;
        cell.classList.toggle('is-filled', v !== '');
    };

    VectorInput.prototype.setSize = function (rows) {
        rows = Math.max(1, Math.min(rows, ML.maxRows));
        if (rows === this.rows) return;
        var old = this.values.slice();
        this.rows = rows;
        this.el.dataset.rows = String(rows);
        this.values = [];
        this.cells = [];
        this._build();
        for (var i = 0; i < Math.min(old.length, rows); i++) {
            this.setValue(i, old[i]);
        }
    };

    VectorInput.prototype.read = function () {
        return this.values.slice();
    };

    VectorInput.prototype.write = function (data) {
        if (!Array.isArray(data)) return;
        this.setSize(data.length);
        for (var i = 0; i < data.length; i++) {
            this.setValue(i, data[i] == null ? '' : String(data[i]));
        }
    };

    VectorInput.prototype.clear = function () {
        for (var i = 0; i < this.rows; i++) this.setValue(i, '');
    };

    VectorInput.prototype.isEmpty = function () {
        return this.values.every(function (v) { return v === ''; });
    };

    ML.VectorInput = VectorInput;
    ML.vectorInputs = {};

    // =========================================================================
    // 4. ЦИФРОВАЯ КЛАВИАТУРА
    // =========================================================================

    var keyboardEl = null;
    var currentCell = null;
    var currentInput = null;
    var currentKind = null;  // 'matrix' | 'vector'

    function buildKeyboard() {
        if (keyboardEl) return keyboardEl;

        keyboardEl = document.createElement('div');
        keyboardEl.className = 'digital-keyboard';
        keyboardEl.setAttribute('role', 'dialog');
        keyboardEl.setAttribute('aria-label', 'Цифровая клавиатура');
        keyboardEl.hidden = true;

        var grid = document.createElement('div');
        grid.className = 'digital-keyboard__grid';

        KEYPAD_KEYS.forEach(function (key) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'digital-keyboard__key';
            btn.dataset.key = key.k;
            if (key.kind) btn.classList.add('digital-keyboard__key--' + key.kind);
            if (key.wide) btn.classList.add('digital-keyboard__key--wide');
            btn.textContent = key.t;
            grid.appendChild(btn);
        });

        keyboardEl.appendChild(grid);

        // Превью текущего значения
        var preview = document.createElement('div');
        preview.className = 'digital-keyboard__preview';
        preview.innerHTML = '<span class="digital-keyboard__preview-label">Значение:</span>' +
                            '<span class="digital-keyboard__preview-value" data-keypad-preview>—</span>';
        keyboardEl.appendChild(preview);

        document.body.appendChild(keyboardEl);

        // Обработка нажатий
        keyboardEl.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-key]');
            if (!btn) return;
            var k = btn.dataset.key;

            if (k === 'done') {
                closeKeyboard();
                return;
            }
            if (k === 'C') {
                setCellValue('');
                return;
            }
            if (k === 'back') {
                var cur = getCellValue();
                setCellValue(cur.slice(0, -1));
                return;
            }

            var insert = k;
            if (k === 'sqrt') insert = 'sqrt(';
            if (k === 'pi') insert = 'pi';
            if (k === '*') insert = '*';

            var cur2 = getCellValue();
            setCellValue(cur2 + insert);
        });

        return keyboardEl;
    }

    function getCellValue() {
        if (!currentCell) return '';
        return currentCell.dataset.value || '';
    }

    function setCellValue(v) {
        if (!currentCell || !currentInput) return;
        var r = parseInt(currentCell.dataset.row, 10);
        var c = parseInt(currentCell.dataset.col, 10);
        if (currentKind === 'matrix') {
            currentInput.setValue(r, c, v);
        } else {
            currentInput.setValue(r, v);
        }
        var prev = keyboardEl.querySelector('[data-keypad-preview]');
        if (prev) prev.textContent = v || '—';
    }

    function positionKeyboard(cell) {
        if (!keyboardEl || !cell) return;
        var rect = cell.getBoundingClientRect();
        var kbRect = keyboardEl.getBoundingClientRect();
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var margin = 12;

        // На мобильном — фиксированная нижняя панель
        if (vw <= 768) {
            keyboardEl.classList.add('digital-keyboard--bottom');
            keyboardEl.style.left = '';
            keyboardEl.style.top = '';
            keyboardEl.style.right = '';
            keyboardEl.style.bottom = '';
            return;
        }

        keyboardEl.classList.remove('digital-keyboard--bottom');

        var left = rect.left + rect.width / 2 - kbRect.width / 2;
        var top = rect.bottom + margin;

        // Если снизу не влезает — открываем сверху
        if (top + kbRect.height > vh - margin) {
            top = rect.top - kbRect.height - margin;
        }

        if (left < margin) left = margin;
        if (left + kbRect.width > vw - margin) {
            left = vw - kbRect.width - margin;
        }
        if (top < margin) top = margin;

        keyboardEl.style.left = left + 'px';
        keyboardEl.style.top = top + 'px';
        keyboardEl.style.right = '';
        keyboardEl.style.bottom = '';
    }

    function openKeyboardFor(cell, input, kind) {
        if (!keyboardEl) buildKeyboard();

        currentCell = cell;
        currentInput = input;
        currentKind = kind || 'matrix';

        keyboardEl.hidden = false;

        // Позиционируем после отображения
        requestAnimationFrame(function () {
            positionKeyboard(cell);
            keyboardEl.classList.add('is-visible');
        });

        // Подсветка активной ячейки
        ML.$$('.matrix-cell.is-active').forEach(function (c) {
            c.classList.remove('is-active');
        });
        cell.classList.add('is-active');

        // Фокус на ячейку (для доступности)
        try { cell.focus({ preventScroll: true }); } catch (e) { /* noop */ }

        var prev = keyboardEl.querySelector('[data-keypad-preview]');
        if (prev) prev.textContent = cell.dataset.value || '—';
    }

    function closeKeyboard() {
        if (!keyboardEl || keyboardEl.hidden) return;
        keyboardEl.classList.remove('is-visible');
        var el = keyboardEl;
        setTimeout(function () {
            if (!el.classList.contains('is-visible')) el.hidden = true;
        }, 160);
        ML.$$('.matrix-cell.is-active').forEach(function (c) {
            c.classList.remove('is-active');
        });
        currentCell = null;
        currentInput = null;
        currentKind = null;
    }

    function initKeyboard() {
        buildKeyboard();

        // Делегирование клика по ячейкам
        document.addEventListener('click', function (e) {
            var cell = e.target.closest('.matrix-cell');
            if (cell) {
                var grid = cell.closest('[data-matrix-input]');
                var vecGrid = cell.closest('[data-vector-input]');
                if (grid) {
                    var mi = ML.matrixInputs[grid.id];
                    if (mi) {
                        openKeyboardFor(cell, mi, 'matrix');
                        return;
                    }
                }
                if (vecGrid) {
                    var vi = ML.vectorInputs[vecGrid.id];
                    if (vi) {
                        openKeyboardFor(cell, vi, 'vector');
                        return;
                    }
                }
            }

            // Клик вне клавиатуры и вне ячейки — закрыть
            if (keyboardEl && !keyboardEl.hidden) {
                if (!e.target.closest('.digital-keyboard') && !e.target.closest('.matrix-cell')) {
                    closeKeyboard();
                }
            }
        });

        // Escape
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeKeyboard();
        });

        // Скролл/ресайз — перепозиционировать или закрыть
        window.addEventListener('resize', function () {
            if (keyboardEl && !keyboardEl.hidden && currentCell) {
                positionKeyboard(currentCell);
            }
        });
    }

    ML.digitalKeyboard = {
        openFor: function (cell, input) {
            openKeyboardFor(cell, input, 'matrix');
        },
        openForVector: function (cell, input) {
            openKeyboardFor(cell, input, 'vector');
        },
        close: closeKeyboard,
    };

    // =========================================================================
    // 5. ИНИЦИАЛИЗАЦИЯ СЕТОК
    // =========================================================================

    function initMatrixInputs() {
        ML.$$('[data-matrix-input]').forEach(function (el) {
            // Уникальный ключ: id или сгенерированный
            var key = el.id || ('matrix-' + Object.keys(ML.matrixInputs).length);
            el.id = key;
            var card = el.closest('[data-matrix-card]');
            var letter = (card && card.dataset.matrixCard) || el.dataset.matrixLetter || 'a';
            ML.matrixInputs[key] = new MatrixInput(el, letter);
        });
    }

    function initVectorInputs() {
        ML.$$('[data-vector-input]').forEach(function (el) {
            var key = el.id || 'vector';
            el.id = key;
            ML.vectorInputs[key] = new VectorInput(el);
        });
    }

    ML.getMatrixByLetter = function (letter) {
        letter = String(letter || 'a').toLowerCase();
        var card = document.querySelector('[data-matrix-card="' + letter + '"]');
        if (!card) {
            // fallback: первая карточка
            if (letter === 'a') card = document.querySelector('[data-matrix-card]');
        }
        if (!card) return null;
        var grid = card.querySelector('[data-matrix-input]');
        if (!grid) return null;
        return ML.matrixInputs[grid.id] || null;
    };

    ML.getFirstMatrix = function () {
        var grid = document.querySelector('[data-matrix-input]');
        if (!grid) return null;
        return ML.matrixInputs[grid.id] || null;
    };

    // =========================================================================
    // 6. РАЗМЕРНЫЕ КОНТРОЛЫ (+/−)
    // =========================================================================

    /**
     * Разбирает dataset кнопки и возвращает {direction, axis, target} или null.
     * Поддерживает оба стиля:
     *   • data-size-incr-a-rows  → dataset.sizeIncrARows
     *   • data-size-incr="rows"  → dataset.sizeIncr = "rows" (target = 'a' по умолчанию)
     */
    function parseSizeAttr(dataset) {
        // Новый стиль: sizeIncrARows / sizeDecrBCols / ...
        var keys = Object.keys(dataset);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var m = key.match(/^size(Incr|Decr)([A-Z])(Rows|Cols)$/);
            if (m) {
                return {
                    direction: m[1].toLowerCase(),
                    target: m[2].toLowerCase(),
                    axis: m[3] === 'Rows' ? 'rows' : 'cols'
                };
            }
        }

        // Старый стиль: data-size-incr="rows" / data-size-decr="cols"
        if (dataset.sizeIncr === 'rows' || dataset.sizeIncr === 'cols') {
            return { direction: 'incr', target: 'a', axis: dataset.sizeIncr };
        }
        if (dataset.sizeDecr === 'rows' || dataset.sizeDecr === 'cols') {
            return { direction: 'decr', target: 'a', axis: dataset.sizeDecr };
        }

        return null;
    }

    function handleSizeBtn(e) {
        var btn = e.currentTarget;
        var info = parseSizeAttr(btn.dataset);
        if (!info) return;

        var mi = ML.getMatrixByLetter(info.target);
        if (!mi) return;

        var rows = mi.rows;
        var cols = mi.cols;

        if (info.axis === 'rows') {
            rows += (info.direction === 'incr' ? 1 : -1);
        } else {
            cols += (info.direction === 'incr' ? 1 : -1);
        }

        mi.setSize(rows, cols);
        if (info.target === 'a') syncVectorToMatrix();
    }

    function initSizeControls() {
        // Перепривязываем при каждом вызове — на случай новых матриц
        ML.$$('.size-btn, [data-size-incr], [data-size-decr]').forEach(function (btn) {
            if (btn.dataset.sizeBound === '1') return;
            btn.dataset.sizeBound = '1';
            btn.addEventListener('click', handleSizeBtn);
        });
    }

    // =========================================================================
    // 7. РУЧНОЙ ВВОД РАЗМЕРОВ
    // =========================================================================

    function bindSizeInputsForCard(card) {
        if (!card || card.dataset.sizeInputsBound === '1') return;
        card.dataset.sizeInputsBound = '1';

        var letter = (card.dataset.matrixCard || 'a').toLowerCase();
        var rInp = card.querySelector('[data-' + letter + '-rows]');
        var cInp = card.querySelector('[data-' + letter + '-cols]');

        function apply() {
            var mi = ML.getMatrixByLetter(letter);
            if (!mi) return;
            var r = parseInt(rInp && rInp.value, 10);
            var c = parseInt(cInp && cInp.value, 10);
            if (isNaN(r)) r = mi.rows;
            if (isNaN(c)) c = mi.cols;
            mi.setSize(r, c);
            if (letter === 'a') syncVectorToMatrix();
        }

        if (rInp) rInp.addEventListener('change', apply);
        if (cInp) cInp.addEventListener('change', apply);
    }

    function initSizeInputs() {
        // Новый стиль — data-a-rows / data-a-cols на карточке A
        ML.$$('[data-matrix-card]').forEach(bindSizeInputsForCard);

        // Старый стиль — #rows-input / #cols-input (глобально на странице)
        var rOld = document.querySelector('#rows-input');
        var cOld = document.querySelector('#cols-input');
        if (rOld || cOld) {
            function applyOld() {
                var mi = ML.getFirstMatrix();
                if (!mi) return;
                var r = parseInt(rOld && rOld.value, 10);
                var c = parseInt(cOld && cOld.value, 10);
                if (isNaN(r)) r = mi.rows;
                if (isNaN(c)) c = mi.cols;
                if (rOld === cOld) c = r;
                mi.setSize(r, c);
                syncVectorToMatrix();
            }
            if (rOld && rOld.dataset.sizeInputBound !== '1') {
                rOld.dataset.sizeInputBound = '1';
                rOld.addEventListener('change', applyOld);
            }
            if (cOld && cOld.dataset.sizeInputBound !== '1') {
                cOld.dataset.sizeInputBound = '1';
                cOld.addEventListener('change', applyOld);
            }
        }
    }

    // =========================================================================
    // 8. CHIP-КНОПКИ
    // =========================================================================

    function initMatrixTools() {
        document.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-matrix-action]');
            if (!btn) return;

            var action = btn.dataset.matrixAction;
            var target = (btn.dataset.matrixTarget || 'a').toLowerCase();
            var mi = ML.getMatrixByLetter(target);

            if (action === 'remove') {
                if (ML.chain) ML.chain.remove(target);
                return;
            }

            if (!mi) return;
            var label = target.toUpperCase();

            switch (action) {
                case 'zero':
                    mi.fillZero();
                    if (ML.toast) ML.toast.info(label + ': нули', '');
                    break;
                case 'identity':
                    mi.fillIdentity();
                    if (ML.toast) ML.toast.info(label + ': единичная', '');
                    break;
                case 'random':
                    mi.fillRandom();
                    if (ML.toast) ML.toast.info(label + ': случайные значения', '');
                    break;
                case 'transpose':
                    mi.transposeInPlace();
                    if (ML.toast) ML.toast.success(label + ' транспонирована', '');
                    break;
                case 'copy':
                    var text = mi.read().map(function (row) {
                        return row.join('\t');
                    }).join('\n');
                    ML.copy.text(text, 'Матрица ' + label + ' скопирована');
                    break;
                case 'paste':
                    if (navigator.clipboard && navigator.clipboard.readText) {
                        navigator.clipboard.readText().then(function (t) {
                            if (!t) { ML.toast.warning('Буфер пуст', ''); return; }
                            mi.pasteMatrix(t, 0, 0);
                            ML.toast.success('Вставлено в ' + label, '');
                        }).catch(function () {
                            ML.toast.warning('Доступ запрещён', 'Разрешите чтение буфера.');
                        });
                    } else {
                        ML.toast.warning('Не поддерживается', 'Браузер не даёт доступ к буферу.');
                    }
                    break;
                case 'square':
                    mi.makeSquare();
                    break;
                case 'clear':
                    mi.clear();
                    if (ML.toast) ML.toast.info(label + ' очищена', '');
                    break;
            }
        });
    }

    // =========================================================================
    // 9. СИНХРОНИЗАЦИЯ ВЕКТОРА С МАТРИЦЕЙ
    // =========================================================================

    function syncVectorToMatrix() {
        var gridA = document.querySelector('[data-matrix-card="a"] [data-matrix-input]');
        if (!gridA) gridA = document.querySelector('[data-matrix-input]');
        var vecEl = document.querySelector('[data-vector-input]');
        if (!gridA || !vecEl) return;

        var miA = ML.matrixInputs[gridA.id];
        var vec = ML.vectorInputs[vecEl.id];
        if (!miA || !vec) return;

        vec.setSize(miA.rows);
    }

    ML.syncVectorToMatrix = syncVectorToMatrix;

    // =========================================================================
    // 10. ДИНАМИЧЕСКОЕ ДОБАВЛЕНИЕ / УДАЛЕНИЕ МАТРИЦ
    // =========================================================================

    ML.chain = {
        letters: function () {
            return ML.$$('[data-matrix-card]').map(function (c) {
                return c.dataset.matrixCard;
            });
        },

        add: function () {
            var cards = ML.$$('[data-matrix-card]');
            var idx = cards.length;
            if (idx >= LETTERS.length) {
                ML.toast.warning('Слишком много матриц', 'Максимум 26.');
                return null;
            }
            var letter = LETTERS[idx];
            var tpl = document.getElementById('matrix-template');
            if (!tpl) {
                ML.toast.error('Шаблон не найден', '');
                return null;
            }

            var node = tpl.content.cloneNode(true);
            var card = node.querySelector('[data-matrix-card]');
            card.dataset.matrixCard = letter;

            // Заменяем data-x-* на data-<letter>-*
            card.querySelectorAll('[data-x-rows]').forEach(function (el) {
                el.dataset[letter + 'Rows'] = el.dataset.xRows;
                delete el.dataset.xRows;
            });
            card.querySelectorAll('[data-x-cols]').forEach(function (el) {
                el.dataset[letter + 'Cols'] = el.dataset.xCols;
                delete el.dataset.xCols;
            });

            // data-size-incr-x-rows → data-size-incr-<letter>-rows
            card.querySelectorAll('[data-size-incr-x-rows]').forEach(function (el) {
                el.dataset['sizeIncr' + letter.toUpperCase() + 'Rows'] = '';
                delete el.dataset.sizeIncrXRows;
            });
            card.querySelectorAll('[data-size-decr-x-rows]').forEach(function (el) {
                el.dataset['sizeDecr' + letter.toUpperCase() + 'Rows'] = '';
                delete el.dataset.sizeDecrXRows;
            });
            card.querySelectorAll('[data-size-incr-x-cols]').forEach(function (el) {
                el.dataset['sizeIncr' + letter.toUpperCase() + 'Cols'] = '';
                delete el.dataset.sizeIncrXCols;
            });
            card.querySelectorAll('[data-size-decr-x-cols]').forEach(function (el) {
                el.dataset['sizeDecr' + letter.toUpperCase() + 'Cols'] = '';
                delete el.dataset.sizeDecrXCols;
            });

            // Буквы
            card.querySelectorAll('[data-matrix-letter], [data-matrix-label]').forEach(function (el) {
                el.textContent = letter.toUpperCase();
            });

            // Бейдж размера
            card.querySelectorAll('[data-matrix-shape-label]').forEach(function (el) {
                el.dataset.matrixShapeLabel = letter;
            });

            // Chip-кнопки
            card.querySelectorAll('[data-matrix-action]').forEach(function (el) {
                if (el.dataset.matrixTarget === '' || el.dataset.matrixTarget === undefined) {
                    el.dataset.matrixTarget = letter;
                }
            });

            // Сетка — назначаем ID и обнуляем размеры
            var grid = card.querySelector('[data-matrix-input]');
            if (grid) {
                grid.id = 'matrix-' + letter + '-input';
                grid.dataset.rows = '3';
                grid.dataset.cols = '3';
                grid.dataset.matrixLetter = letter;
            }

            // Вставка
            var anchor = document.querySelector('[data-add-matrix]');
            if (anchor && anchor.parentNode) {
                anchor.parentNode.insertBefore(card, anchor);
            } else {
                var cont = document.querySelector('[data-extra-matrices]');
                if (cont) cont.appendChild(card);
            }

            // Инициализация
            if (grid) {
                ML.matrixInputs[grid.id] = new MatrixInput(grid, letter);
            }
            initSizeControls();
            bindSizeInputsForCard(card);

            return letter;
        },

        remove: function (letter) {
            if (letter === 'a') {
                ML.toast.warning('Матрицу A удалить нельзя', '');
                return;
            }
            var card = document.querySelector('[data-matrix-card="' + letter + '"]');
            if (!card) return;
            var grid = card.querySelector('[data-matrix-input]');
            if (grid && ML.matrixInputs[grid.id]) {
                delete ML.matrixInputs[grid.id];
            }
            card.remove();
            ML.toast.info('Матрица ' + letter.toUpperCase() + ' удалена', '');
        },
    };

    function initAddMatrixButton() {
        var btn = document.querySelector('[data-add-matrix]');
        if (!btn) return;
        btn.addEventListener('click', function () {
            ML.chain.add();
        });
    }

    // =========================================================================
    // 11. УТИЛИТЫ
    // =========================================================================

    ML.isMatrixEmpty = function (m) {
        if (!Array.isArray(m) || !m.length) return true;
        return m.every(function (row) {
            return row.every(function (v) { return v === ''; });
        });
    };

    ML.getAllMatrices = function () {
        var result = [];
        ML.$$('[data-matrix-card]').forEach(function (card) {
            var letter = card.dataset.matrixCard;
            var grid = card.querySelector('[data-matrix-input]');
            if (!grid) return;
            var mi = ML.matrixInputs[grid.id];
            if (mi) result.push({ letter: letter, mi: mi, card: card });
        });
        return result;
    };

    // =========================================================================
    // 12. ИНИЦИАЛИЗАЦИЯ МОДУЛЯ
    // =========================================================================

    ML.initMatrixModule = function () {
        var body = document.body;
        ML.maxRows = parseInt(body.dataset.maxRows || window.MATRIXLAB_MAX_ROWS || '10', 10);
        ML.maxCols = parseInt(body.dataset.maxCols || window.MATRIXLAB_MAX_COLS || '10', 10);

        initMatrixInputs();
        initVectorInputs();
        initKeyboard();
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