/* =============================================================================
   MatrixLab — matrix.js
   =============================================================================
   Ядро редактора матриц и векторов.

   Ввод:
       • Каждая ячейка — <input type="text">. Кликнул → фокус → печатаешь.
       • Ввод с физической клавиатуры работает нативно, курсор не сбивается.
       • Цифровая клавиатура — только по явной кнопке (data-matrix-action="keypad").
       • Автооткрытия цифровой клавиатуры НЕТ.

   Возможности:
       • MatrixInput  — сетка инпутов;
       • VectorInput  — вектор-столбец (для СЛАУ);
       • Валидация ввода — через ML.validators.classifyInput;
       • Undo/Redo (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y);
       • Операции над строками/столбцами;
       • Заполнение: zero, identity, diagonal, symmetric, triangular, scalar, random;
       • Импорт: TSV, CSV, JSON, [[..],[..]], LaTeX;
       • Экспорт: TSV, CSV, JSON, LaTeX, Markdown, plain;
       • Буфер обмена — все форматы;
       • Батчинг изменений + дебаунс matrix:change / vector:change;
       • Событийная шина ML.on/off/emit;
       • Динамические матрицы через <template id="matrix-template">;
       • Доступность: role=grid, aria-*;
       • localStorage — сохранение состояния редактора (можно отключить
         флагом body[data-no-persist="1"]);
       • Haptic через ML.haptic.

   Зависимости (из main.js):
       ML.$, ML.$$, ML.on/off/emit
       ML.toast.{info,success,warning,error}
       ML.copy.{text,latex,markdown,json}
       ML.i18n.t
       ML.prefs.get/set
       ML.haptic
       ML.debounce
       ML.escapeHtml
       ML.storage
       ML.validators.{classifyInput,isEmptyMatrix,isEmptyVector}
   ============================================================================= */
(function () {
    'use strict';

    var ML = window.MatrixLab;
    if (!ML) {
        console.error('[matrix.js] window.MatrixLab не найден — модуль не запущен.');
        return;
    }

    // =========================================================================
    // 0. КОНСТАНТЫ И УТИЛИТЫ
    // =========================================================================

    var LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

    function clamp(v, min, max) {
        if (v < min) return min;
        if (v > max) return max;
        return v;
    }

    function deepCopyMatrix(m) {
        return m.map(function (row) { return row.slice(); });
    }

    function isInputEl(el) {
        return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    }

    /**
     * Проверить, отключён ли persist на этой странице.
     *
     * Флаг ставится вручную до подключения matrix.js:
     *     document.body.dataset.noPersist = '1';
     *
     * Например, на странице /modules/ — чтобы матрица всегда
     * начиналась с 3×3, а не восстанавливалась из localStorage
     * как «4×4 из прошлого раза».
     */
    function isNoPersist() {
        var body = document.body;
        if (!body) return false;
        if (body.dataset && body.dataset.noPersist === '1') return true;
        if (body.getAttribute && body.getAttribute('data-no-persist') === '1') {
            return true;
        }
        return false;
    }

    // =========================================================================
    // 1. ИМПОРТ / ЭКСПОРТ
    // =========================================================================

    function parseMatrixText(text) {
        if (text == null) return null;
        var s = String(text).trim();
        if (s === '') return null;

        if (/^\[/.test(s)) {
            try {
                var j = JSON.parse(s);
                if (Array.isArray(j) && Array.isArray(j[0])) {
                    return {
                        matrix: j.map(function (row) {
                            return row.map(function (v) { return String(v); });
                        }),
                        format: 'json'
                    };
                }
            } catch (e) { /* not JSON */ }
        }

        var latexMatch = s.match(
            /\\begin\{[pbv]?matrix\*?\}([\s\S]*?)\\end\{[pbv]?matrix\*?\}/
        );
        if (latexMatch) {
            var body = latexMatch[1].trim();
            var rows = body.split(/\\\\/)
                .map(function (r) { return r.trim(); })
                .filter(function (r) { return r !== ''; });
            var parsed = rows.map(function (r) {
                return r.split('&').map(function (x) { return x.trim(); });
            });
            return { matrix: parsed, format: 'latex' };
        }

        var lines = s.replace(/\r/g, '')
            .split('\n')
            .filter(function (l) { return l.trim() !== ''; });

        if (lines.length === 1 && lines[0].indexOf(';') !== -1) {
            lines = lines[0].split(';');
        }

        var format = 'tsv';
        var result = lines.map(function (line) {
            if (line.indexOf('\t') !== -1) {
                return line.split('\t').map(function (x) { return x.trim(); });
            }
            if (line.indexOf(';') !== -1) {
                format = 'csv';
                return line.split(';').map(function (x) { return x.trim(); });
            }
            if (line.indexOf(',') !== -1) {
                format = 'csv';
                return line.split(',').map(function (x) { return x.trim(); });
            }
            return [line.trim()];
        });

        return { matrix: result, format: format };
    }

    function matrixToTSV(matrix) {
        return matrix.map(function (row) { return row.join('\t'); }).join('\n');
    }

    function matrixToCSV(matrix) {
        return matrix.map(function (row) {
            return row.map(function (v) {
                var s = String(v == null ? '' : v);
                if (/[",;\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
                return s;
            }).join(',');
        }).join('\n');
    }

    function matrixToJSON(matrix) {
        return JSON.stringify(matrix);
    }

    function matrixToLatex(matrix) {
        var body = matrix.map(function (row) {
            return row.map(function (v) {
                var s = String(v == null ? '' : v).trim();
                if (s === '') return '\\cdot';
                s = s.replace(/sqrt\(([^)]+)\)/g, '\\sqrt{$1}');
                s = s.replace(/\bpi\b/g, '\\pi');
                s = s.replace(/\*/g, ' \\cdot ');
                return s;
            }).join(' & ');
        }).join(' \\\\ ');
        return '\\begin{pmatrix} ' + body + ' \\end{pmatrix}';
    }

    function matrixToMarkdown(matrix) {
        if (!matrix.length) return '';
        var head = '| ' + matrix[0].map(function (_, i) {
            return 'c' + (i + 1);
        }).join(' | ') + ' |';
        var sep = '| ' + matrix[0].map(function () {
            return '---';
        }).join(' | ') + ' |';
        var body = matrix.map(function (row) {
            return '| ' + row.map(function (v) {
                return v === '' ? '·' : v;
            }).join(' | ') + ' |';
        }).join('\n');
        return head + '\n' + sep + '\n' + body;
    }

    function exportMatrix(matrix, format) {
        switch ((format || 'tsv').toLowerCase()) {
            case 'tsv':      return matrixToTSV(matrix);
            case 'csv':      return matrixToCSV(matrix);
            case 'json':     return matrixToJSON(matrix);
            case 'latex':    return matrixToLatex(matrix);
            case 'markdown':
            case 'md':       return matrixToMarkdown(matrix);
            case 'plain':
            default:         return matrix.map(function (row) {
                return row.join(' ');
            }).join('\n');
        }
    }

    // =========================================================================
    // 2. КЛАСС MatrixInput
    // =========================================================================

    function MatrixInput(container, letter) {
        this.el = container;
        this.letter = String(letter || 'a').toLowerCase();

        var maxRows = ML.maxRows || 10;
        var maxCols = ML.maxCols || 10;
        this.rows = clamp(parseInt(container.dataset.rows || '3', 10) || 3, 1, maxRows);
        this.cols = clamp(parseInt(container.dataset.cols || '3', 10) || 3, 1, maxCols);

        this.values = [];
        this.cells = [];

        this._silent = false;
        this._batchDepth = 0;
        this._changeTimer = null;

        this._undoStack = [];
        this._redoStack = [];
        this._undoLimit = 100;

        this._build();
        this._bindKeyboardNavigation();
        this._bindFocusTracking();
    }

    MatrixInput.prototype._build = function () {
        var old = this.values.length ? this.values : null;
        var self = this;

        this.el.innerHTML = '';
        this.el.style.gridTemplateColumns = 'repeat(' + this.cols + ', minmax(0, 1fr))';
        this.el.classList.add('matrix-grid');
        this.el.setAttribute('role', 'grid');
        this.el.setAttribute('aria-rowcount', String(this.rows));
        this.el.setAttribute('aria-colcount', String(this.cols));
        this.el.setAttribute('aria-label', 'Матрица ' + this.letter.toUpperCase());

        this.values = [];
        this.cells = [];

        var frag = document.createDocumentFragment();

        for (var r = 0; r < this.rows; r++) {
            var valueRow = [];
            var cellRow = [];
            for (var c = 0; c < this.cols; c++) {
                var wrap = document.createElement('div');
                wrap.className = 'matrix-cell-wrap';
                wrap.setAttribute('role', 'gridcell');
                wrap.setAttribute('aria-rowindex', String(r + 1));
                wrap.setAttribute('aria-colindex', String(c + 1));

                var cell = document.createElement('input');
                cell.type = 'text';
                cell.className = 'matrix-cell';
                cell.autocomplete = 'off';
                cell.autocapitalize = 'off';
                cell.spellcheck = false;
                cell.inputMode = 'text';
                cell.dataset.row = String(r);
                cell.dataset.col = String(c);
                cell.setAttribute(
                    'aria-label',
                    this.letter.toUpperCase() + (r + 1) + ',' + (c + 1)
                );

                var val = '';
                if (old && old[r] && old[r][c] !== undefined) val = old[r][c];

                cell.value = val;
                cell.dataset.value = val;
                if (val !== '') cell.classList.add('is-filled');

                this._applyKindClass(cell, val);

                // Единственный источник правды для ручного ввода:
                // input-событие → _setFromInput → модель.
                (function (cellRef, rr, cc) {
                    cellRef.addEventListener('input', function () {
                        self._setFromInput(rr, cc, cellRef.value);
                    });
                })(cell, r, c);

                wrap.appendChild(cell);
                frag.appendChild(wrap);

                valueRow.push(val);
                cellRow.push(cell);
            }
            this.values.push(valueRow);
            this.cells.push(cellRow);
        }

        this.el.appendChild(frag);

        this._updateBadge();
        this._updateSizeInputs();
    };

    MatrixInput.prototype._applyKindClass = function (cell, val) {
        cell.classList.remove(
            'is-invalid', 'is-fraction', 'is-complex', 'is-expr', 'is-sqrt'
        );

        var info = ML.validators.classifyInput(val);

        if (!info.valid) {
            cell.classList.add('is-invalid');
            cell.setAttribute('aria-invalid', 'true');
            cell.setAttribute('title', info.message);
        } else {
            cell.removeAttribute('aria-invalid');
            cell.removeAttribute('title');
            if (info.kind === 'fraction')   cell.classList.add('is-fraction');
            if (info.kind === 'complex')    cell.classList.add('is-complex');
            if (info.kind === 'sqrt')       cell.classList.add('is-sqrt');
            if (info.kind === 'expression') cell.classList.add('is-expr');
        }
    };

    MatrixInput.prototype._updateBadge = function () {
        var card = this.el.closest('[data-matrix-card]');
        if (!card) return;
        var badge = card.querySelector(
            '[data-matrix-shape-label="' + this.letter + '"]'
        );
        if (!badge) badge = card.querySelector('[data-matrix-shape-label]');
        if (badge) badge.textContent = this.rows + ' × ' + this.cols;
    };

    MatrixInput.prototype._updateSizeInputs = function () {
        var card = this.el.closest('[data-matrix-card]');
        var L = this.letter;
        var rowsVal = this.rows;
        var colsVal = this.cols;

        function setIfNotFocused(el, value) {
            if (!el) return;
            if (el === document.activeElement) return;
            if (el.value !== String(value)) el.value = value;
        }

        if (card) {
            card.querySelectorAll('[data-' + L + '-rows]').forEach(function (el) {
                setIfNotFocused(el, rowsVal);
            });
            card.querySelectorAll('[data-' + L + '-cols]').forEach(function (el) {
                setIfNotFocused(el, colsVal);
            });
        }
        document.querySelectorAll('[data-' + L + '-rows]').forEach(function (el) {
            setIfNotFocused(el, rowsVal);
        });
        document.querySelectorAll('[data-' + L + '-cols]').forEach(function (el) {
            setIfNotFocused(el, colsVal);
        });

        if (L === 'a') {
            setIfNotFocused(document.querySelector('#rows-input'), rowsVal);
            setIfNotFocused(document.querySelector('#cols-input'), colsVal);
        }
    };

    MatrixInput.prototype._at = function (r, c) {
        if (r < 0 || r >= this.rows) return null;
        if (c < 0 || c >= this.cols) return null;
        return this.cells[r][c];
    };

    MatrixInput.prototype._bindKeyboardNavigation = function () {
        var self = this;
        this.el.addEventListener('keydown', function (e) {
            var target = e.target;
            if (!target.classList.contains('matrix-cell')) return;

            var r = parseInt(target.dataset.row, 10);
            var c = parseInt(target.dataset.col, 10);
            var next = null;

            if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
                if (e.shiftKey) self.redo();
                else self.undo();
                e.preventDefault();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
                self.redo();
                e.preventDefault();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
                e.preventDefault();
                try { target.select(); } catch (err) { /* noop */ }
                return;
            }

            switch (e.key) {
                case 'ArrowUp':    next = self._at(r - 1, c); break;
                case 'ArrowDown':  next = self._at(r + 1, c); break;
                case 'ArrowLeft':
                    if (target.selectionStart === 0
                        && target.selectionEnd === 0) {
                        next = self._at(r, c - 1);
                    }
                    break;
                case 'ArrowRight':
                    if (target.selectionStart === target.value.length
                        && target.selectionEnd === target.value.length) {
                        next = self._at(r, c + 1);
                    }
                    break;
                case 'Tab':
                    next = e.shiftKey
                        ? (self._at(r, c - 1) || self._at(r - 1, self.cols - 1))
                        : (self._at(r, c + 1) || self._at(r + 1, 0));
                    e.preventDefault();
                    break;
                case 'Enter':
                    next = self._at(r + 1, c) || self._at(0, c + 1);
                    e.preventDefault();
                    break;
            }

            if (next) {
                e.preventDefault();
                try { next.focus({ preventScroll: false }); } catch (err) { /* noop */ }
                try { next.select(); } catch (err) { /* noop */ }
            }
        });
    };

    MatrixInput.prototype._bindFocusTracking = function () {
        var self = this;
        this.el.addEventListener('focusin', function () {
            ML._activeMatrix = self;
        });
    };

    MatrixInput.prototype._snapshot = function () {
        return {
            rows: this.rows,
            cols: this.cols,
            values: deepCopyMatrix(this.values)
        };
    };

    MatrixInput.prototype._restore = function (snap) {
        if (!snap) return;
        this._silent = true;
        this.rows = snap.rows;
        this.cols = snap.cols;
        this.el.dataset.rows = String(this.rows);
        this.el.dataset.cols = String(this.cols);
        this.values = [];
        this.cells = [];
        this._build();

        for (var r = 0; r < this.rows; r++) {
            for (var c = 0; c < this.cols; c++) {
                var v = (snap.values[r] && snap.values[r][c]) || '';
                this.setValue(r, c, v, true);
            }
        }
        this._silent = false;
        this._updateSizeInputs();
        this._dispatchChange();
    };

    MatrixInput.prototype.pushHistory = function () {
        this._undoStack.push(this._snapshot());
        if (this._undoStack.length > this._undoLimit) this._undoStack.shift();
        this._redoStack.length = 0;
    };

    MatrixInput.prototype.undo = function () {
        if (!this._undoStack.length) return;
        var cur = this._snapshot();
        var prev = this._undoStack.pop();
        this._redoStack.push(cur);
        this._restore(prev);
        ML.toast.info('Отменено', '');
    };

    MatrixInput.prototype.redo = function () {
        if (!this._redoStack.length) return;
        var cur = this._snapshot();
        var next = this._redoStack.pop();
        this._undoStack.push(cur);
        this._restore(next);
        ML.toast.info('Повторено', '');
    };

    MatrixInput.prototype.beginBatch = function () {
        this._batchDepth++;
        if (this._batchDepth === 1) {
            this.pushHistory();
            this._silent = true;
        }
    };

    MatrixInput.prototype.endBatch = function () {
        this._batchDepth = Math.max(0, this._batchDepth - 1);
        if (this._batchDepth === 0) {
            this._silent = false;
            this._updateSizeInputs();
            this._dispatchChange();
        }
    };

    /**
     * Вызывается ТОЛЬКО из обработчика input на ячейке.
     * Пишет в модель, НЕ трогая input.value (курсор не сбивается).
     */
    MatrixInput.prototype._setFromInput = function (r, c, value) {
        if (r < 0 || r >= this.rows) return;
        if (c < 0 || c >= this.cols) return;

        var cell = this.cells[r][c];
        var v = String(value == null ? '' : value);

        if (this.values[r][c] === v) return;

        // Один шаг undo на изменение ячейки (не на каждый символ —
        // pushHistory вызывается здесь, но _silent блокирует вложенные).
        if (!this._silent && this._batchDepth === 0) {
            this.pushHistory();
        }

        this.values[r][c] = v;
        cell.dataset.value = v;
        cell.classList.toggle('is-filled', v !== '');
        this._applyKindClass(cell, v);

        if (!this._silent && this._batchDepth === 0) {
            this._scheduleChange();
        }
    };

    /**
     * Программная установка значения (импорт, fillZero, restore, write).
     * Не трогает input.value, если фокус сейчас в этой ячейке.
     */
    MatrixInput.prototype.setValue = function (r, c, value, silent) {
        if (r < 0 || r >= this.rows) return;
        if (c < 0 || c >= this.cols) return;

        var cell = this.cells[r][c];
        var v = String(value == null ? '' : value);

        if (this.values[r][c] === v && cell.dataset.value === v) return;

        if (!silent && !this._silent && this._batchDepth === 0) {
            this.pushHistory();
        }

        this.values[r][c] = v;
        cell.dataset.value = v;

        if (isInputEl(cell)) {
            // Не перетираем значение, если фокус в этой ячейке —
            // иначе сбивается курсор при печати.
            if (document.activeElement !== cell && cell.value !== v) {
                cell.value = v;
            }
        } else {
            cell.textContent = v;
        }

        cell.classList.toggle('is-filled', v !== '');
        this._applyKindClass(cell, v);

        if (!silent && !this._silent && this._batchDepth === 0) {
            this._scheduleChange();
        }
    };

    MatrixInput.prototype._scheduleChange = function () {
        var self = this;
        if (this._changeTimer) clearTimeout(this._changeTimer);
        this._changeTimer = setTimeout(function () {
            self._changeTimer = null;
            self._dispatchChange();
        }, 60);
    };

    MatrixInput.prototype._dispatchChange = function () {
        var ev = new CustomEvent('matrix:change', {
            bubbles: true,
            detail: { matrix: this, letter: this.letter }
        });
        this.el.dispatchEvent(ev);
        ML.emit('matrix:change', { matrix: this, letter: this.letter });
    };

    MatrixInput.prototype.setSize = function (rows, cols, opts) {
        opts = opts || {};
        var preserve = opts.preserve !== false;

        var maxRows = ML.maxRows || 10;
        var maxCols = ML.maxCols || 10;
        rows = clamp(parseInt(rows, 10) || 1, 1, maxRows);
        cols = clamp(parseInt(cols, 10) || 1, 1, maxCols);

        if (rows === this.rows && cols === this.cols) return;

        this.pushHistory();

        var oldValues = deepCopyMatrix(this.values);

        this.rows = rows;
        this.cols = cols;
        this.el.dataset.rows = String(rows);
        this.el.dataset.cols = String(cols);

        var saved = preserve ? oldValues : null;

        this._silent = true;
        this.values = [];
        this.cells = [];
        this._build();

        if (saved) {
            var rMax = Math.min(saved.length, rows);
            for (var r = 0; r < rMax; r++) {
                var cMax = Math.min(saved[r].length, cols);
                for (var c = 0; c < cMax; c++) {
                    this.setValue(r, c, saved[r][c], true);
                }
            }
        }
        this._silent = false;

        this._updateSizeInputs();
        this._dispatchChange();
    };

    MatrixInput.prototype.addRow = function (index) {
        var maxRows = ML.maxRows || 10;
        if (this.rows >= maxRows) {
            ML.toast.warning('Достигнут максимум',
                'Максимум ' + maxRows + ' строк.');
            return;
        }
        var at = (index == null) ? this.rows : clamp(index, 0, this.rows);
        this.beginBatch();
        this._insertRowAt(at);
        this.endBatch();
    };

    MatrixInput.prototype.removeRow = function (index) {
        if (this.rows <= 1) {
            ML.toast.warning('Нельзя удалить',
                'Должна остаться хотя бы одна строка.');
            return;
        }
        var at = (index == null) ? this.rows - 1 : clamp(index, 0, this.rows - 1);
        this.beginBatch();
        this._deleteRowAt(at);
        this.endBatch();
    };

    MatrixInput.prototype.addCol = function (index) {
        var maxCols = ML.maxCols || 10;
        if (this.cols >= maxCols) {
            ML.toast.warning('Достигнут максимум',
                'Максимум ' + maxCols + ' столбцов.');
            return;
        }
        var at = (index == null) ? this.cols : clamp(index, 0, this.cols);
        this.beginBatch();
        this._insertColAt(at);
        this.endBatch();
    };

    MatrixInput.prototype.removeCol = function (index) {
        if (this.cols <= 1) {
            ML.toast.warning('Нельзя удалить',
                'Должен остаться хотя бы один столбец.');
            return;
        }
        var at = (index == null) ? this.cols - 1 : clamp(index, 0, this.cols - 1);
        this.beginBatch();
        this._deleteColAt(at);
        this.endBatch();
    };

    MatrixInput.prototype._rebuildWithValues = function (newValues) {
        this.rows = newValues.length;
        this.cols = newValues[0] ? newValues[0].length : 1;
        this.el.dataset.rows = String(this.rows);
        this.el.dataset.cols = String(this.cols);
        this.values = [];
        this.cells = [];
        this._silent = true;
        this._build();
        for (var r = 0; r < this.rows; r++) {
            for (var c = 0; c < this.cols; c++) {
                this.setValue(r, c, newValues[r][c] || '', true);
            }
        }
        this._silent = false;
    };

    MatrixInput.prototype._insertRowAt = function (at) {
        var v = deepCopyMatrix(this.values);
        v.splice(at, 0, new Array(this.cols).fill(''));
        this._rebuildWithValues(v);
        this._updateSizeInputs();
    };

    MatrixInput.prototype._deleteRowAt = function (at) {
        var v = deepCopyMatrix(this.values);
        v.splice(at, 1);
        this._rebuildWithValues(v);
        this._updateSizeInputs();
    };

    MatrixInput.prototype._insertColAt = function (at) {
        var v = deepCopyMatrix(this.values);
        v.forEach(function (row) { row.splice(at, 0, ''); });
        this._rebuildWithValues(v);
        this._updateSizeInputs();
    };

    MatrixInput.prototype._deleteColAt = function (at) {
        var v = deepCopyMatrix(this.values);
        v.forEach(function (row) { row.splice(at, 1); });
        this._rebuildWithValues(v);
        this._updateSizeInputs();
    };

    MatrixInput.prototype.makeSquare = function () {
        var n = Math.max(this.rows, this.cols);
        this.setSize(n, n);
        ML.toast.info(
            'Матрица ' + this.letter.toUpperCase() + ' приведена к квадратной',
            n + ' × ' + n
        );
        return this;
    };

    MatrixInput.prototype.read = function () {
        return deepCopyMatrix(this.values);
    };

    MatrixInput.prototype.write = function (data) {
        if (!Array.isArray(data)) return;
        this.beginBatch();
        var rMax = Math.min(data.length, this.rows);
        for (var r = 0; r < rMax; r++) {
            if (!Array.isArray(data[r])) continue;
            var cMax = Math.min(data[r].length, this.cols);
            for (var c = 0; c < cMax; c++) {
                var v = data[r][c];
                this.setValue(r, c, v == null ? '' : String(v), true);
            }
        }
        this.endBatch();
    };

    MatrixInput.prototype.clear = function () {
        this.beginBatch();
        for (var r = 0; r < this.rows; r++) {
            for (var c = 0; c < this.cols; c++) {
                this.setValue(r, c, '', true);
            }
        }
        this.endBatch();
    };

    MatrixInput.prototype.fillZero = function () {
        this.beginBatch();
        for (var r = 0; r < this.rows; r++) {
            for (var c = 0; c < this.cols; c++) {
                this.setValue(r, c, '0', true);
            }
        }
        this.endBatch();
    };

    MatrixInput.prototype.fillIdentity = function () {
        if (this.rows !== this.cols) this.makeSquare();
        this.beginBatch();
        for (var r = 0; r < this.rows; r++) {
            for (var c = 0; c < this.cols; c++) {
                this.setValue(r, c, r === c ? '1' : '0', true);
            }
        }
        this.endBatch();
    };

    MatrixInput.prototype.fillScalar = function (k) {
        if (this.rows !== this.cols) this.makeSquare();
        k = String(k == null ? '1' : k);
        this.beginBatch();
        for (var r = 0; r < this.rows; r++) {
            for (var c = 0; c < this.cols; c++) {
                this.setValue(r, c, r === c ? k : '0', true);
            }
        }
        this.endBatch();
    };

    MatrixInput.prototype.fillDiagonal = function () {
        if (this.rows !== this.cols) this.makeSquare();
        this.beginBatch();
        for (var r = 0; r < this.rows; r++) {
            for (var c = 0; c < this.cols; c++) {
                if (r === c) {
                    var cur = this.values[r][c];
                    if (cur === '' || cur === '0') {
                        this.setValue(r, c, String(r + 1), true);
                    }
                } else {
                    this.setValue(r, c, '0', true);
                }
            }
        }
        this.endBatch();
    };

    MatrixInput.prototype.fillSymmetric = function () {
        if (this.rows !== this.cols) this.makeSquare();
        this.beginBatch();
        var n = this.rows;
        for (var r = 0; r < n; r++) {
            for (var c = r; c < n; c++) {
                var v = this.values[r][c];
                if (v === '') v = String(Math.floor(Math.random() * 19) - 9);
                this.setValue(r, c, v, true);
                this.setValue(c, r, v, true);
            }
        }
        this.endBatch();
    };

    MatrixInput.prototype.fillUpperTriangular = function () {
        this.beginBatch();
        for (var r = 0; r < this.rows; r++) {
            for (var c = 0; c < this.cols; c++) {
                if (c < r) {
                    this.setValue(r, c, '0', true);
                } else if (this.values[r][c] === '') {
                    this.setValue(r, c,
                        String(Math.floor(Math.random() * 19) - 9), true);
                }
            }
        }
        this.endBatch();
    };

    MatrixInput.prototype.fillLowerTriangular = function () {
        this.beginBatch();
        for (var r = 0; r < this.rows; r++) {
            for (var c = 0; c < this.cols; c++) {
                if (c > r) {
                    this.setValue(r, c, '0', true);
                } else if (this.values[r][c] === '') {
                    this.setValue(r, c,
                        String(Math.floor(Math.random() * 19) - 9), true);
                }
            }
        }
        this.endBatch();
    };

    MatrixInput.prototype.fillRandom = function (opts) {
        opts = opts || {};
        var min = opts.min != null ? opts.min : -9;
        var max = opts.max != null ? opts.max : 9;
        var fractions = !!opts.fractions;
        this.beginBatch();
        for (var r = 0; r < this.rows; r++) {
            for (var c = 0; c < this.cols; c++) {
                var v;
                if (fractions && Math.random() < 0.3) {
                    var num = Math.floor(Math.random() * (max - min + 1)) + min;
                    var den = Math.floor(Math.random() * 8) + 2;
                    v = num + '/' + den;
                } else {
                    v = String(Math.floor(Math.random() * (max - min + 1)) + min);
                }
                this.setValue(r, c, v, true);
            }
        }
        this.endBatch();
    };

    MatrixInput.prototype.transposeInPlace = function () {
        this.pushHistory();
        var data = this.read();
        var newRows = this.cols;
        var newCols = this.rows;

        this._silent = true;
        this.rows = newRows;
        this.cols = newCols;
        this.el.dataset.rows = String(newRows);
        this.el.dataset.cols = String(newCols);
        this.values = [];
        this.cells = [];
        this._build();

        for (var r = 0; r < newRows; r++) {
            for (var c = 0; c < newCols; c++) {
                this.setValue(r, c, (data[c] && data[c][r]) || '', true);
            }
        }
        this._silent = false;
        this._updateSizeInputs();
        this._dispatchChange();
    };

    MatrixInput.prototype.isEmpty = function () {
        return ML.validators.isEmptyMatrix(this.values);
    };

    MatrixInput.prototype.hasInvalid = function () {
        for (var r = 0; r < this.rows; r++) {
            for (var c = 0; c < this.cols; c++) {
                if (!ML.validators.classifyInput(this.values[r][c]).valid) {
                    return true;
                }
            }
        }
        return false;
    };

    MatrixInput.prototype.importFrom = function (text, startRow, startCol) {
        startRow = startRow || 0;
        startCol = startCol || 0;
        var parsed = parseMatrixText(text);
        if (!parsed) return false;
        var data = parsed.matrix;

        var neededRows = Math.max(this.rows, startRow + data.length);
        var neededCols = Math.max(
            this.cols,
            startCol + (data[0] ? data[0].length : 0)
        );

        this.beginBatch();

        if (neededRows !== this.rows || neededCols !== this.cols) {
            var oldValues = deepCopyMatrix(this.values);
            this.rows = neededRows;
            this.cols = neededCols;
            this.el.dataset.rows = String(neededRows);
            this.el.dataset.cols = String(neededCols);
            this.values = [];
            this.cells = [];
            this._build();
            var rMax = Math.min(oldValues.length, neededRows);
            for (var r = 0; r < rMax; r++) {
                var cMax = Math.min(oldValues[r].length, neededCols);
                for (var c = 0; c < cMax; c++) {
                    this.setValue(r, c, oldValues[r][c], true);
                }
            }
        }

        for (var dr = 0; dr < data.length; dr++) {
            for (var dc = 0; dc < data[dr].length; dc++) {
                this.setValue(
                    startRow + dr,
                    startCol + dc,
                    data[dr][dc],
                    true
                );
            }
        }

        this.endBatch();
        this._updateSizeInputs();
        return true;
    };

    MatrixInput.prototype.pasteMatrix = function (text, sr, sc) {
        return this.importFrom(text, sr, sc);
    };

    MatrixInput.prototype.exportAs = function (format) {
        return exportMatrix(this.read(), format);
    };

    MatrixInput.prototype.copyAs = function (format) {
        var text = this.exportAs(format);
        var label = 'Матрица ' + this.letter.toUpperCase() + ' скопирована';

        if (format === 'latex') {
            ML.copy.latex(text, label);
        } else if (format === 'markdown' || format === 'md') {
            ML.copy.markdown(text, label);
        } else if (format === 'json') {
            ML.copy.json(this.read(), label);
        } else {
            ML.copy.text(text, label);
        }
        return text;
    };

    MatrixInput.prototype.toLatex = function () {
        return matrixToLatex(this.read());
    };

    // =========================================================================
    // 3. КЛАСС VectorInput
    // =========================================================================

    function VectorInput(container) {
        this.el = container;
        var maxRows = ML.maxRows || 10;
        this.rows = clamp(
            parseInt(container.dataset.rows || '3', 10) || 3,
            1, maxRows
        );
        this.values = [];
        this.cells = [];

        this._silent = false;
        this._changeTimer = null;

        this._undoStack = [];
        this._redoStack = [];
        this._undoLimit = 100;

        this._build();
        this._bindKeyboardNavigation();
        this._bindFocusTracking();
    }

    VectorInput.prototype._build = function () {
        var old = this.values.length ? this.values.slice() : null;
        var self = this;

        this.el.innerHTML = '';
        this.el.classList.add('vector-grid');
        this.el.setAttribute('role', 'grid');
        this.el.setAttribute('aria-rowcount', String(this.rows));
        this.el.setAttribute('aria-colcount', '1');
        this.el.setAttribute('aria-label', 'Вектор b');

        this.values = [];
        this.cells = [];

        var frag = document.createDocumentFragment();

        for (var i = 0; i < this.rows; i++) {
            var cell = document.createElement('input');
            cell.type = 'text';
            cell.className = 'matrix-cell';
            cell.autocomplete = 'off';
            cell.autocapitalize = 'off';
            cell.spellcheck = false;
            cell.dataset.row = String(i);
            cell.dataset.col = '0';
            cell.setAttribute('role', 'gridcell');
            cell.setAttribute('aria-rowindex', String(i + 1));
            cell.setAttribute('aria-colindex', '1');
            cell.setAttribute('aria-label', 'b' + (i + 1));

            var val = (old && old[i]) || '';
            cell.value = val;
            cell.dataset.value = val;
            if (val !== '') cell.classList.add('is-filled');
            this._applyKindClass(cell, val);

            (function (cellRef, ii) {
                cellRef.addEventListener('input', function () {
                    self._setFromInput(ii, cellRef.value);
                });
            })(cell, i);

            frag.appendChild(cell);
            this.values.push(val);
            this.cells.push(cell);
        }

        this.el.appendChild(frag);
    };

    VectorInput.prototype._applyKindClass = MatrixInput.prototype._applyKindClass;

    VectorInput.prototype._bindKeyboardNavigation = function () {
        var self = this;
        this.el.addEventListener('keydown', function (e) {
            var target = e.target;
            if (!target.classList.contains('matrix-cell')) return;

            var i = parseInt(target.dataset.row, 10);
            var next = null;

            if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
                if (e.shiftKey) self.redo();
                else self.undo();
                e.preventDefault();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
                self.redo();
                e.preventDefault();
                return;
            }

            switch (e.key) {
                case 'ArrowUp':   next = self.cells[i - 1]; break;
                case 'ArrowDown': next = self.cells[i + 1]; break;
                case 'Tab':
                    next = e.shiftKey ? self.cells[i - 1] : self.cells[i + 1];
                    e.preventDefault();
                    break;
                case 'Enter':
                    next = self.cells[i + 1] || self.cells[0];
                    e.preventDefault();
                    break;
            }

            if (next) {
                e.preventDefault();
                try { next.focus({ preventScroll: false }); } catch (err) { /* noop */ }
                try { next.select(); } catch (err) { /* noop */ }
            }
        });
    };

    VectorInput.prototype._bindFocusTracking = function () {
        var self = this;
        this.el.addEventListener('focusin', function () {
            ML._activeMatrix = self;
        });
    };

    VectorInput.prototype._snapshot = function () {
        return { rows: this.rows, values: this.values.slice() };
    };

    VectorInput.prototype._restore = function (snap) {
        if (!snap) return;
        this._silent = true;
        this.rows = snap.rows;
        this.el.dataset.rows = String(this.rows);
        this.values = [];
        this.cells = [];
        this._build();
        for (var i = 0; i < this.rows; i++) {
            this.setValue(i, snap.values[i] || '', true);
        }
        this._silent = false;
        this._dispatchChange();
    };

    VectorInput.prototype.pushHistory = function () {
        this._undoStack.push(this._snapshot());
        if (this._undoStack.length > this._undoLimit) this._undoStack.shift();
        this._redoStack.length = 0;
    };

    VectorInput.prototype.undo = function () {
        if (!this._undoStack.length) return;
        var cur = this._snapshot();
        var prev = this._undoStack.pop();
        this._redoStack.push(cur);
        this._restore(prev);
        ML.toast.info('Отменено', '');
    };

    VectorInput.prototype.redo = function () {
        if (!this._redoStack.length) return;
        var cur = this._snapshot();
        var next = this._redoStack.pop();
        this._undoStack.push(cur);
        this._restore(next);
        ML.toast.info('Повторено', '');
    };

    VectorInput.prototype._setFromInput = function (i, value) {
        if (i < 0 || i >= this.rows) return;

        var cell = this.cells[i];
        var v = String(value == null ? '' : value);

        if (this.values[i] === v) return;

        if (!this._silent) {
            this.pushHistory();
        }

        this.values[i] = v;
        cell.dataset.value = v;
        cell.classList.toggle('is-filled', v !== '');
        this._applyKindClass(cell, v);

        if (!this._silent) this._scheduleChange();
    };

    VectorInput.prototype.setValue = function (i, value, silent) {
        if (i < 0 || i >= this.rows) return;
        var cell = this.cells[i];
        var v = String(value == null ? '' : value);
        if (this.values[i] === v && cell.dataset.value === v) return;

        if (!silent && !this._silent) {
            this.pushHistory();
        }

        this.values[i] = v;
        cell.dataset.value = v;

        if (isInputEl(cell)) {
            if (document.activeElement !== cell && cell.value !== v) {
                cell.value = v;
            }
        } else {
            cell.textContent = v;
        }

        cell.classList.toggle('is-filled', v !== '');
        this._applyKindClass(cell, v);

        if (!silent) this._scheduleChange();
    };

    VectorInput.prototype._scheduleChange = function () {
        var self = this;
        if (this._changeTimer) clearTimeout(this._changeTimer);
        this._changeTimer = setTimeout(function () {
            self._changeTimer = null;
            self._dispatchChange();
        }, 60);
    };

    VectorInput.prototype._dispatchChange = function () {
        var ev = new CustomEvent('vector:change', {
            bubbles: true,
            detail: { vector: this }
        });
        this.el.dispatchEvent(ev);
        ML.emit('vector:change', { vector: this });
    };

    VectorInput.prototype.setSize = function (rows) {
        var maxRows = ML.maxRows || 10;
        rows = clamp(parseInt(rows, 10) || 1, 1, maxRows);
        if (rows === this.rows) return;
        var old = this.values.slice();
        this.pushHistory();
        this.rows = rows;
        this.el.dataset.rows = String(rows);
        this._silent = true;
        this.values = [];
        this.cells = [];
        this._build();
        for (var i = 0; i < Math.min(old.length, rows); i++) {
            this.setValue(i, old[i], true);
        }
        this._silent = false;
        this._dispatchChange();
    };

    VectorInput.prototype.read = function () {
        return this.values.slice();
    };

    VectorInput.prototype.write = function (data) {
        if (!Array.isArray(data)) return;
        this.setSize(data.length);
        this._silent = true;
        for (var i = 0; i < data.length; i++) {
            this.setValue(i, data[i] == null ? '' : String(data[i]), true);
        }
        this._silent = false;
        this._dispatchChange();
    };

    VectorInput.prototype.clear = function () {
        this.pushHistory();
        this._silent = true;
        for (var i = 0; i < this.rows; i++) this.setValue(i, '', true);
        this._silent = false;
        this._dispatchChange();
    };

    VectorInput.prototype.isEmpty = function () {
        return ML.validators.isEmptyVector(this.values);
    };

    VectorInput.prototype.hasInvalid = function () {
        for (var i = 0; i < this.rows; i++) {
            if (!ML.validators.classifyInput(this.values[i]).valid) {
                return true;
            }
        }
        return false;
    };

    VectorInput.prototype.importFrom = function (text) {
        var parsed = parseMatrixText(text);
        if (!parsed) return false;

        var data = parsed.matrix.map(function (row) { return row[0]; });

        this.pushHistory();
        this.setSize(data.length);
        this._silent = true;
        for (var i = 0; i < data.length; i++) {
            this.setValue(i, data[i], true);
        }
        this._silent = false;
        this._dispatchChange();
        return true;
    };

    VectorInput.prototype.exportAs = function (format) {
        var asMatrix = this.values.map(function (v) { return [v]; });
        return exportMatrix(asMatrix, format);
    };

    // =========================================================================
    // 4. ЦИФРОВАЯ КЛАВИАТУРА — ТОЛЬКО ПО ЯВНОЙ КНОПКЕ
    // =========================================================================

    var KEYPAD_KEYS = [
        { k: '7', t: '7' }, { k: '8', t: '8' }, { k: '9', t: '9' }, { k: '/', t: '/' },
        { k: '4', t: '4' }, { k: '5', t: '5' }, { k: '6', t: '6' }, { k: '*', t: '×' },
        { k: '1', t: '1' }, { k: '2', t: '2' }, { k: '3', t: '3' }, { k: '-', t: '−' },
        { k: '0', t: '0' }, { k: '.', t: '.' }, { k: 'pi', t: 'π' }, { k: '+', t: '+' },
        { k: 'i', t: 'i' }, { k: 'sqrt', t: '√' }, { k: '(', t: '(' }, { k: ')', t: ')' },
        { k: 'C', t: 'C', kind: 'danger' },
        { k: 'back', t: '⌫', kind: 'warning' },
        { k: 'done', t: 'Готово', kind: 'primary', wide: true }
    ];

    var keyboardEl = null;
    var currentCell = null;
    var currentInput = null;
    var currentKind = null;

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

        var preview = document.createElement('div');
        preview.className = 'digital-keyboard__preview';
        preview.innerHTML = ''
            + '<span class="digital-keyboard__preview-label">Значение:</span>'
            + '<span class="digital-keyboard__preview-value" data-keypad-preview>—</span>';
        keyboardEl.appendChild(preview);

        document.body.appendChild(keyboardEl);

        keyboardEl.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-key]');
            if (!btn) return;
            var k = btn.dataset.key;

            ML.haptic('light');

            if (k === 'done') { closeKeyboard(); return; }
            if (k === 'C')    { applyToCell(''); return; }
            if (k === 'back') {
                var cur = currentCell && currentCell.value
                    ? currentCell.value : '';
                applyToCell(cur.slice(0, -1));
                return;
            }

            var insert = k;
            if (k === 'sqrt') insert = 'sqrt(';

            var prev = currentCell && currentCell.value
                ? currentCell.value : '';
            applyToCell(prev + insert);
        });

        return keyboardEl;
    }

    function applyToCell(newValue) {
        if (!currentCell || !currentInput) return;

        // Обновляем сам input, чтобы курсор остался в нём
        if (isInputEl(currentCell)) {
            currentCell.value = newValue;
        }

        var r = parseInt(currentCell.dataset.row, 10);
        var c = parseInt(currentCell.dataset.col, 10);
        if (currentKind === 'matrix') {
            currentInput._setFromInput(r, c, newValue);
        } else {
            currentInput._setFromInput(r, newValue);
        }

        if (keyboardEl) {
            var pv = keyboardEl.querySelector('[data-keypad-preview]');
            if (pv) pv.textContent = newValue || '—';
        }
    }

    function positionKeyboard(cell) {
        if (!keyboardEl || !cell) return;
        var rect = cell.getBoundingClientRect();
        var kbRect = keyboardEl.getBoundingClientRect();
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var margin = 12;

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

        requestAnimationFrame(function () {
            positionKeyboard(cell);
            keyboardEl.classList.add('is-visible');
        });

        ML.$$('.matrix-cell.is-active').forEach(function (c) {
            c.classList.remove('is-active');
        });
        cell.classList.add('is-active');

        var prev = keyboardEl.querySelector('[data-keypad-preview]');
        if (prev) prev.textContent = cell.value || '—';
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
        // Автооткрытие ОТКЛЮЧЕНО. Клавиатура открывается только по кнопке.
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeKeyboard();
        });

        window.addEventListener('resize', function () {
            if (keyboardEl && !keyboardEl.hidden && currentCell) {
                positionKeyboard(currentCell);
            }
        });

        window.addEventListener('scroll', function () {
            if (keyboardEl && !keyboardEl.hidden && currentCell
                && window.innerWidth > 768) {
                positionKeyboard(currentCell);
            }
        }, { passive: true });
    }

    ML.digitalKeyboard = {
        openFor: function (cell, input) { openKeyboardFor(cell, input, 'matrix'); },
        openForVector: function (cell, input) { openKeyboardFor(cell, input, 'vector'); },
        close: closeKeyboard
    };

    // =========================================================================
    // 5. ИНИЦИАЛИЗАЦИЯ СЕТОК
    // =========================================================================

    function initMatrixInputs() {
        ML.$$('[data-matrix-input]').forEach(function (el) {
            var key = el.id || ('matrix-' + Object.keys(ML.matrixInputs).length);
            el.id = key;
            if (ML.matrixInputs[key]) return;

            var card = el.closest('[data-matrix-card]');
            var letter = (card && card.dataset.matrixCard)
                || el.dataset.matrixLetter || 'a';
            ML.matrixInputs[key] = new MatrixInput(el, letter);
        });
    }

    function initVectorInputs() {
        ML.$$('[data-vector-input]').forEach(function (el) {
            var key = el.id || 'vector';
            el.id = key;
            if (ML.vectorInputs[key]) return;
            ML.vectorInputs[key] = new VectorInput(el);
        });
    }

    ML.matrixInputs = ML.matrixInputs || {};
    ML.vectorInputs = ML.vectorInputs || {};

    ML.getMatrixByLetter = function (letter) {
        letter = String(letter || 'a').toLowerCase();
        var card = document.querySelector('[data-matrix-card="' + letter + '"]');
        if (!card && letter === 'a') {
            card = document.querySelector('[data-matrix-card]');
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

    ML.forEachMatrix = function (cb) {
        ML.getAllMatrices().forEach(function (item) {
            cb(item.mi, item.letter, item.card);
        });
    };

    // =========================================================================
    // 6. РАЗМЕРНЫЕ КОНТРОЛЫ
    // =========================================================================

    function parseSizeAttr(dataset) {
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

    function initSizeControls(root) {
        var scope = root || document;
        var selector = '.size-btn, [data-size-incr], [data-size-decr], '
            + '[data-size-incr-a-rows], [data-size-decr-a-rows], '
            + '[data-size-incr-a-cols], [data-size-decr-a-cols]';
        scope.querySelectorAll(selector).forEach(function (btn) {
            if (btn.dataset.sizeBound === '1') return;
            btn.dataset.sizeBound = '1';
            btn.addEventListener('click', handleSizeBtn);
        });
    }

    // =========================================================================
    // 7. РУЧНОЙ ВВОД РАЗМЕРОВ
    // =========================================================================

    function bindSizeInputsForCard(card) {
        if (!card) return;
        var letter = (card.dataset.matrixCard || 'a').toLowerCase();

        card.querySelectorAll('[data-' + letter + '-rows]').forEach(function (rInp) {
            if (rInp.dataset.sizeInputBound === '1') return;
            rInp.dataset.sizeInputBound = '1';
            rInp.addEventListener('change', function () {
                var mi = ML.getMatrixByLetter(letter);
                if (!mi) return;
                var r = parseInt(rInp.value, 10);
                if (isNaN(r)) r = mi.rows;
                var c = mi.cols;
                var cInp = card.querySelector('[data-' + letter + '-cols]');
                if (cInp) {
                    var cv = parseInt(cInp.value, 10);
                    if (!isNaN(cv)) c = cv;
                }
                mi.setSize(r, c);
                if (letter === 'a') syncVectorToMatrix();
            });
        });

        card.querySelectorAll('[data-' + letter + '-cols]').forEach(function (cInp) {
            if (cInp.dataset.sizeInputBound === '1') return;
            cInp.dataset.sizeInputBound = '1';
            cInp.addEventListener('change', function () {
                var mi = ML.getMatrixByLetter(letter);
                if (!mi) return;
                var c = parseInt(cInp.value, 10);
                if (isNaN(c)) c = mi.cols;
                var r = mi.rows;
                var rInp = card.querySelector('[data-' + letter + '-rows]');
                if (rInp) {
                    var rv = parseInt(rInp.value, 10);
                    if (!isNaN(rv)) r = rv;
                }
                mi.setSize(r, c);
                if (letter === 'a') syncVectorToMatrix();
            });
        });
    }

    function bindGlobalSizeInputs() {
        document.querySelectorAll('[data-a-rows]').forEach(function (rInp) {
            if (rInp.dataset.sizeInputBound === '1') return;
            rInp.dataset.sizeInputBound = '1';
            rInp.addEventListener('change', function () {
                var mi = ML.getMatrixByLetter('a');
                if (!mi) return;
                var r = parseInt(rInp.value, 10);
                if (isNaN(r)) r = mi.rows;
                var cInp = rInp.parentElement.querySelector('[data-a-cols]')
                    || document.querySelector('[data-a-cols]');
                var c = mi.cols;
                if (cInp) {
                    var cv = parseInt(cInp.value, 10);
                    if (!isNaN(cv)) c = cv;
                }
                mi.setSize(r, c);
                syncVectorToMatrix();
            });
        });

        document.querySelectorAll('[data-a-cols]').forEach(function (cInp) {
            if (cInp.dataset.sizeInputBound === '1') return;
            cInp.dataset.sizeInputBound = '1';
            cInp.addEventListener('change', function () {
                var mi = ML.getMatrixByLetter('a');
                if (!mi) return;
                var c = parseInt(cInp.value, 10);
                if (isNaN(c)) c = mi.cols;
                var rInp = cInp.parentElement.querySelector('[data-a-rows]')
                    || document.querySelector('[data-a-rows]');
                var r = mi.rows;
                if (rInp) {
                    var rv = parseInt(rInp.value, 10);
                    if (!isNaN(rv)) r = rv;
                }
                mi.setSize(r, c);
                syncVectorToMatrix();
            });
        });

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

    function initSizeInputs() {
        ML.$$('[data-matrix-card]').forEach(bindSizeInputsForCard);
        bindGlobalSizeInputs();
    }

    // =========================================================================
    // 8. КНОПКИ ДЕЙСТВИЙ НАД МАТРИЦЕЙ
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
                    ML.toast.info(label + ': нули', '');
                    break;
                case 'identity':
                    mi.fillIdentity();
                    ML.toast.info(label + ': единичная', '');
                    break;
                case 'diagonal':
                    mi.fillDiagonal();
                    ML.toast.info(label + ': диагональная', '');
                    break;
                case 'symmetric':
                    mi.fillSymmetric();
                    ML.toast.info(label + ': симметричная', '');
                    break;
                case 'upper':
                    mi.fillUpperTriangular();
                    ML.toast.info(label + ': верхнетреугольная', '');
                    break;
                case 'lower':
                    mi.fillLowerTriangular();
                    ML.toast.info(label + ': нижнетреугольная', '');
                    break;
                case 'random':
                    mi.fillRandom();
                    ML.toast.info(label + ': случайные значения', '');
                    break;
                case 'transpose':
                    mi.transposeInPlace();
                    ML.toast.success(label + ' транспонирована', '');
                    break;
                case 'copy':       mi.copyAs('tsv'); break;
                case 'copy-latex': mi.copyAs('latex'); break;
                case 'copy-md':    mi.copyAs('markdown'); break;
                case 'copy-json':  mi.copyAs('json'); break;
                case 'paste':
                    if (navigator.clipboard && navigator.clipboard.readText) {
                        navigator.clipboard.readText().then(function (t) {
                            if (!t) {
                                ML.toast.warning('Буфер пуст', '');
                                return;
                            }
                            mi.importFrom(t, 0, 0);
                            ML.toast.success('Вставлено в ' + label, '');
                        }).catch(function () {
                            ML.toast.warning('Доступ запрещён',
                                'Разрешите чтение буфера.');
                        });
                    } else {
                        ML.toast.warning('Не поддерживается',
                            'Браузер не даёт доступ к буферу.');
                    }
                    break;
                case 'keypad':
                    // Открыть цифровую клавиатуру для активной ячейки
                    var active = document.activeElement;
                    if (active && active.classList
                        && active.classList.contains('matrix-cell')) {
                        var grid = active.closest('[data-matrix-input]');
                        var vecGrid = active.closest('[data-vector-input]');
                        if (grid && ML.matrixInputs[grid.id]) {
                            openKeyboardFor(active, ML.matrixInputs[grid.id], 'matrix');
                            return;
                        }
                        if (vecGrid && ML.vectorInputs[vecGrid.id]) {
                            openKeyboardFor(active, ML.vectorInputs[vecGrid.id], 'vector');
                            return;
                        }
                    }
                    ML.toast.info('Клавиатура',
                        'Сначала выберите ячейку.');
                    break;
                case 'square':     mi.makeSquare(); break;
                case 'clear':
                    mi.clear();
                    ML.toast.info(label + ' очищена', '');
                    break;
                case 'undo':       mi.undo(); break;
                case 'redo':       mi.redo(); break;
                case 'add-row':    mi.addRow(); break;
                case 'remove-row': mi.removeRow(); break;
                case 'add-col':    mi.addCol(); break;
                case 'remove-col': mi.removeCol(); break;
            }
        });
    }

    // =========================================================================
    // 9. СИНХРОНИЗАЦИЯ ВЕКТОРА С МАТРИЦЕЙ
    // =========================================================================

    function syncVectorToMatrix() {
        var gridA = document.querySelector(
            '[data-matrix-card="a"] [data-matrix-input]'
        );
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

            var upperLetter = letter.toUpperCase();

            card.querySelectorAll('[data-x-rows]').forEach(function (el) {
                el.dataset[letter + 'Rows'] = el.dataset.xRows;
                delete el.dataset.xRows;
            });
            card.querySelectorAll('[data-x-cols]').forEach(function (el) {
                el.dataset[letter + 'Cols'] = el.dataset.xCols;
                delete el.dataset.xCols;
            });

            card.querySelectorAll('[data-size-incr-x-rows]').forEach(function (el) {
                el.dataset['sizeIncr' + upperLetter + 'Rows'] = '';
                delete el.dataset.sizeIncrXRows;
                delete el.dataset.sizeBound;
            });
            card.querySelectorAll('[data-size-decr-x-rows]').forEach(function (el) {
                el.dataset['sizeDecr' + upperLetter + 'Rows'] = '';
                delete el.dataset.sizeDecrXRows;
                delete el.dataset.sizeBound;
            });
            card.querySelectorAll('[data-size-incr-x-cols]').forEach(function (el) {
                el.dataset['sizeIncr' + upperLetter + 'Cols'] = '';
                delete el.dataset.sizeIncrXCols;
                delete el.dataset.sizeBound;
            });
            card.querySelectorAll('[data-size-decr-x-cols]').forEach(function (el) {
                el.dataset['sizeDecr' + upperLetter + 'Cols'] = '';
                delete el.dataset.sizeDecrXCols;
                delete el.dataset.sizeBound;
            });

            card.querySelectorAll('[data-matrix-letter], [data-matrix-label]')
                .forEach(function (el) {
                    el.textContent = upperLetter;
                });

            card.querySelectorAll('[data-matrix-shape-label]').forEach(function (el) {
                el.dataset.matrixShapeLabel = letter;
            });

            card.querySelectorAll('[data-matrix-action]').forEach(function (el) {
                if (el.dataset.matrixTarget === ''
                    || el.dataset.matrixTarget === undefined) {
                    el.dataset.matrixTarget = letter;
                }
            });

            var grid = card.querySelector('[data-matrix-input]');
            if (grid) {
                grid.id = 'matrix-' + letter + '-input';
                grid.dataset.rows = '3';
                grid.dataset.cols = '3';
                grid.dataset.matrixLetter = letter;
            }

            var anchor = document.querySelector('[data-add-matrix]');
            if (anchor && anchor.parentNode) {
                anchor.parentNode.insertBefore(card, anchor);
            } else {
                var cont = document.querySelector('[data-extra-matrices]');
                if (cont) cont.appendChild(card);
            }

            if (grid) {
                ML.matrixInputs[grid.id] = new MatrixInput(grid, letter);
            }

            initSizeControls(card);
            bindSizeInputsForCard(card);

            ML.emit('matrix:added', { letter: letter });
            return letter;
        },

        remove: function (letter) {
            if (letter === 'a') {
                ML.toast.warning('Матрицу A удалить нельзя', '');
                return;
            }
            var card = document.querySelector(
                '[data-matrix-card="' + letter + '"]'
            );
            if (!card) return;
            var grid = card.querySelector('[data-matrix-input]');
            if (grid && ML.matrixInputs[grid.id]) {
                delete ML.matrixInputs[grid.id];
            }
            card.remove();
            ML.emit('matrix:removed', { letter: letter });
            ML.toast.info(
                'Матрица ' + letter.toUpperCase() + ' удалена', ''
            );
        }
    };

    function initAddMatrixButton() {
        document.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-add-matrix]');
            if (!btn) return;
            ML.chain.add();
        });
    }

    // =========================================================================
    // 11. ВАЛИДАЦИЯ ОПЕРАЦИЙ
    // =========================================================================

    ML.validateMatrixFor = function (op, matrices) {
        matrices = matrices || {};
        var A = matrices.a;
        var B = matrices.b;

        switch (op) {
            case 'add':
            case 'subtract':
                if (!A || !B) {
                    return { ok: false, message: 'Нужны обе матрицы', hint: '' };
                }
                if (A.rows !== B.rows || A.cols !== B.cols) {
                    return {
                        ok: false,
                        message: 'Матрицы несовместимы для сложения',
                        hint: 'У A размер ' + A.rows + '×' + A.cols
                            + ', у B — ' + B.rows + '×' + B.cols
                            + '. Размеры должны совпадать.'
                    };
                }
                return { ok: true, message: '', hint: '' };

            case 'multiply':
                if (!A || !B) {
                    return { ok: false, message: 'Нужны обе матрицы', hint: '' };
                }
                if (A.cols !== B.rows) {
                    return {
                        ok: false,
                        message: 'Матрицы несовместимы для умножения',
                        hint: 'У A размер ' + A.rows + '×' + A.cols
                            + ', у B — ' + B.rows + '×' + B.cols
                            + '. Для A×B нужно cols(A) = rows(B).'
                    };
                }
                return { ok: true, message: '', hint: '' };

            case 'determinant':
            case 'inverse':
            case 'trace':
            case 'eigenvalues':
            case 'eigenvectors':
            case 'char_poly':
            case 'lu':
            case 'cholesky':
            case 'diagonalize':
                if (!A) return { ok: false, message: 'Нужна матрица A', hint: '' };
                if (A.rows !== A.cols) {
                    return {
                        ok: false,
                        message: 'Операция требует квадратной матрицы',
                        hint: 'У A размер ' + A.rows + '×' + A.cols
                            + '. Приведите к квадратной.'
                    };
                }
                return { ok: true, message: '', hint: '' };

            case 'transpose':
            case 'rref':
            case 'echelon':
            case 'properties':
            case 'rank':
            case 'qr':
                if (!A) return { ok: false, message: 'Нужна матрица A', hint: '' };
                return { ok: true, message: '', hint: '' };

            default:
                return { ok: true, message: '', hint: '' };
        }
    };

    ML.verifyResult = function (op, payload, result) {
        if (!result) return { ok: false, message: 'Пустой результат' };
        if (op === 'inverse' && result.status === 'singular') {
            return {
                ok: false,
                message: 'Матрица вырождена, обратной не существует'
            };
        }
        return { ok: true, message: '' };
    };

    // =========================================================================
    // 12. РАБОЧЕЕ ПРОСТРАНСТВО
    // =========================================================================

    ML.workspace = ML.workspace || {
        _items: {},
        set: function (name, mi) {
            this._items[name] = mi;
            ML.emit('workspace:change', { name: name, mi: mi });
        },
        get: function (name) { return this._items[name] || null; },
        remove: function (name) {
            delete this._items[name];
            ML.emit('workspace:change', { name: name });
        },
        list: function () {
            var self = this;
            return Object.keys(this._items).map(function (k) {
                return { name: k, mi: self._items[k] };
            });
        },
        clear: function () { this._items = {}; }
    };

    ML.on('matrix:added', function (d) {
        var mi = ML.getMatrixByLetter(d.letter);
        if (mi) ML.workspace.set(d.letter.toUpperCase(), mi);
    });

    // =========================================================================
    // 13. СОХРАНЕНИЕ СОСТОЯНИЯ
    // =========================================================================

    var STORAGE_KEY = 'editor.v1';

    function saveToStorage() {
        if (isNoPersist()) return;
        try {
            var data = {};
            ML.getAllMatrices().forEach(function (item) {
                data[item.letter] = {
                    rows: item.mi.rows,
                    cols: item.mi.cols,
                    values: item.mi.read()
                };
            });
            ML.storage.setJSON(STORAGE_KEY, data);
        } catch (e) { /* noop */ }
    }

    function loadFromStorage() {
        if (isNoPersist()) return;
        try {
            var data = ML.storage.getJSON(STORAGE_KEY, null);
            if (!data) return;
            Object.keys(data).forEach(function (letter) {
                var mi = ML.getMatrixByLetter(letter);
                if (!mi) return;
                var d = data[letter];
                if (!d || !Array.isArray(d.values)) return;
                if (d.rows !== mi.rows || d.cols !== mi.cols) {
                    mi.setSize(d.rows, d.cols, { preserve: false });
                }
                mi.write(d.values);
            });
        } catch (e) { /* noop */ }
    }

    ML.saveState = saveToStorage;
    ML.loadState = loadFromStorage;
    ML.isNoPersist = isNoPersist;

    ML.on('matrix:change', ML.debounce(saveToStorage, 400));

    // =========================================================================
    // 14. ИНИЦИАЛИЗАЦИЯ МОДУЛЯ
    // =========================================================================

    var _initialized = false;

    ML.initMatrixModule = function () {
        if (_initialized) return;

        var body = document.body;
        ML.maxRows = parseInt(
            body.dataset.maxRows || window.MATRIXLAB_MAX_ROWS || '10',
            10
        ) || 10;
        ML.maxCols = parseInt(
            body.dataset.maxCols || window.MATRIXLAB_MAX_COLS || '10',
            10
        ) || 10;

        ML.matrixInputs = ML.matrixInputs || {};
        ML.vectorInputs = ML.vectorInputs || {};

        initMatrixInputs();
        initVectorInputs();
        initKeyboard();
        initMatrixTools();
        initSizeControls();
        initSizeInputs();
        initAddMatrixButton();
        syncVectorToMatrix();

        if (!isNoPersist()
            && (!ML.prefs || ML.prefs.get('editorPersist') !== false)) {
            loadFromStorage();
        }

        _initialized = true;
        ML.emit('matrix:module-ready', {});
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            ML.initMatrixModule();
        });
    } else {
        ML.initMatrixModule();
    }

})();