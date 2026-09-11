/* =============================================================================
   MatrixLab — export.js
   =============================================================================
   Экспорт результата операции.

   Отвечает за:
       • кнопку «Копировать»    — копирует полный текстовый отчёт;
       • кнопку «LaTeX»         — копирует только LaTeX результата;
       • кнопку «Текст»         — копирует отчёт (то же, что «Копировать»);
       • кнопку «Скачать»       — открывает диалог выбора формата;
       • скачивание файлов TXT / TeX / JSON.

   Форматы:
       TXT  — человекочитаемый текстовый отчёт (задание + шаги +
              результат + проверки);
       TeX  — минимальный LaTeX-документ, компилируется через pdflatex;
       JSON — сериализованный ответ API как есть, для интеграций.

   Зависимости: main.js (ML.copy, ML.modal, ML.toast).
   ============================================================================= */
(function () {
    'use strict';

    const ML = window.MatrixLab;
    if (!ML) return;

    // =========================================================================
    // Скачивание файла
    // =========================================================================

    /**
     * Скачать текстовый контент как файл.
     *
     * @param {string} filename
     * @param {string} content
     * @param {string} mimeType
     */
    function download(filename, content, mimeType) {
        mimeType = mimeType || 'text/plain;charset=utf-8';
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () {
            URL.revokeObjectURL(url);
        }, 500);
    }

    // =========================================================================
    // Утилиты
    // =========================================================================

    /** Безопасная проверка строки. */
    function s(v) {
        return (v === null || v === undefined) ? '' : String(v);
    }

    /** Имя файла с временной меткой. */
    function fileName(ext) {
        const now = new Date();
        const pad = function (n) { return String(n).padStart(2, '0'); };
        const stamp = now.getFullYear()
            + pad(now.getMonth() + 1)
            + pad(now.getDate()) + '_'
            + pad(now.getHours())
            + pad(now.getMinutes())
            + pad(now.getSeconds());
        return 'matrixlab_' + stamp + '.' + ext;
    }

    // =========================================================================
    // Сериализация payload
    // =========================================================================

    /**
     * Сформировать человекочитаемый текстовый отчёт.
     */
    function payloadToText(payload) {
        if (!payload) return '';
        let out = '';

        // --- ЗАДАНИЕ ---------------------------------------------------------
        out += '========================================\n';
        out += '            MatrixLab — отчёт\n';
        out += '========================================\n\n';

        const task = payload.task || {};
        if (task.operation_latex || task.matrix_latex
            || task.matrix_a_latex || task.vector_latex) {
            out += '--- ЗАДАНИЕ ---\n';

            if (task.operation_latex) {
                out += 'Операция: ' + s(task.operation_latex) + '\n';
            }
            if (task.matrix_a_latex && task.matrix_b_latex) {
                out += 'A = ' + s(task.matrix_a_latex) + '\n';
                out += 'B = ' + s(task.matrix_b_latex) + '\n';
            } else if (task.matrix_latex && task.vector_latex) {
                out += 'A = ' + s(task.matrix_latex) + '\n';
                out += 'b = ' + s(task.vector_latex) + '\n';
            } else if (task.matrix_latex) {
                out += 'A = ' + s(task.matrix_latex) + '\n';
            }
            out += '\n';
        }

        // --- РЕШЕНИЕ ---------------------------------------------------------
        const steps = Array.isArray(payload.steps) ? payload.steps : [];
        if (steps.length > 0) {
            out += '--- РЕШЕНИЕ ---\n';
            steps.forEach(function (step, i) {
                out += '\nШаг ' + (i + 1);
                if (step.title) out += '. ' + s(step.title);
                out += '\n';
                if (step.text) out += s(step.text) + '\n';
                if (step.latex) out += 'LaTeX: ' + s(step.latex) + '\n';
            });
            out += '\n';
        }

        // --- РЕЗУЛЬТАТ -------------------------------------------------------
        out += '--- РЕЗУЛЬТАТ ---\n';

        if (payload.latex) {
            out += 'LaTeX: ' + s(payload.latex) + '\n';
        }
        if (payload.plain) {
            out += s(payload.plain) + '\n';
        }
        if (typeof payload.result !== 'undefined') {
            if (Array.isArray(payload.result)
                || (payload.result && typeof payload.result === 'object')) {
                out += JSON.stringify(payload.result, null, 2) + '\n';
            } else {
                out += s(payload.result) + '\n';
            }
        }

        // --- ПРОВЕРКИ --------------------------------------------------------
        const checks = Array.isArray(payload.checks) ? payload.checks : [];
        if (checks.length > 0) {
            out += '\n--- ПРОВЕРКИ ---\n';
            checks.forEach(function (c) {
                out += (c.ok ? '[OK] ' : '[FAIL] ') + s(c.name) + '\n';
            });
        }

        // --- ПОЯСНЕНИЕ -------------------------------------------------------
        if (payload.explanation) {
            out += '\n--- ПОЯСНЕНИЕ ---\n';
            out += s(payload.explanation) + '\n';
        }

        return out;
    }

    /**
     * Сформировать LaTeX-документ, готовый к компиляции.
     */
    function payloadToLatex(payload) {
        if (!payload) return '';
        let out = '';

        // Шапка-комментарии
        out += '% MatrixLab — экспорт результата\n';
        out += '% Дата: ' + new Date().toISOString() + '\n';
        if (payload.task && payload.task.operation_latex) {
            out += '% Операция: ' + s(payload.task.operation_latex) + '\n';
        }
        out += '\n';

        // Документ
        out += '\\documentclass[11pt,a4paper]{article}\n';
        out += '\\usepackage[utf8]{inputenc}\n';
        out += '\\usepackage[T2A]{fontenc}\n';
        out += '\\usepackage[russian]{babel}\n';
        out += '\\usepackage{amsmath, amssymb, amsthm}\n';
        out += '\\usepackage[margin=2.5cm]{geometry}\n';
        out += '\n';
        out += '\\begin{document}\n\n';

        // Задание
        const task = payload.task || {};
        if (task.operation_latex || task.matrix_latex
            || task.matrix_a_latex || task.vector_latex) {
            out += '\\section*{Задание}\n\n';

            if (task.operation_latex) {
                out += 'Операция: \\(' + s(task.operation_latex) + '\\)\n\n';
            }
            if (task.matrix_a_latex && task.matrix_b_latex) {
                out += '\\[ A = ' + s(task.matrix_a_latex) + ' \\]\n';
                out += '\\[ B = ' + s(task.matrix_b_latex) + ' \\]\n\n';
            } else if (task.matrix_latex && task.vector_latex) {
                out += '\\[ A = ' + s(task.matrix_latex) + ' \\]\n';
                out += '\\[ b = ' + s(task.vector_latex) + ' \\]\n\n';
            } else if (task.matrix_latex) {
                out += '\\[ A = ' + s(task.matrix_latex) + ' \\]\n\n';
            }
        }

        // Решение
        const steps = Array.isArray(payload.steps) ? payload.steps : [];
        if (steps.length > 0) {
            out += '\\section*{Решение}\n\n';
            steps.forEach(function (step, i) {
                out += '\\subsection*{Шаг ' + (i + 1);
                if (step.title) out += '. ' + s(step.title);
                out += '}\n\n';
                if (step.text) out += s(step.text) + '\n\n';
                if (step.latex) out += '\\[ ' + s(step.latex) + ' \\]\n\n';
            });
        }

        // Результат
        out += '\\section*{Результат}\n\n';
        if (payload.latex) {
            out += '\\[ ' + s(payload.latex) + ' \\]\n\n';
        } else if (payload.result !== undefined) {
            out += '\\begin{verbatim}\n';
            if (typeof payload.result === 'object') {
                out += JSON.stringify(payload.result, null, 2);
            } else {
                out += s(payload.result);
            }
            out += '\n\\end{verbatim}\n\n';
        }

        // Проверки
        const checks = Array.isArray(payload.checks) ? payload.checks : [];
        if (checks.length > 0) {
            out += '\\section*{Проверки}\n\n';
            out += '\\begin{itemize}\n';
            checks.forEach(function (c) {
                out += '  \\item ' + (c.ok ? '[OK]' : '[FAIL]')
                    + ' ' + s(c.name) + '\n';
            });
            out += '\\end{itemize}\n\n';
        }

        out += '\\end{document}\n';
        return out;
    }

    /**
     * Сериализовать payload в красивый JSON.
     */
    function payloadToJson(payload) {
        try {
            return JSON.stringify(payload, null, 2);
        } catch (e) {
            return '{}';
        }
    }

    // =========================================================================
    // Получение payload из блока результата
    // =========================================================================

    /**
     * Достать payload из data-атрибута блока результата.
     * Возвращает null, если данных нет.
     */
    function getPayload(block) {
        if (!block) return null;
        const actions = block.querySelector('[data-result-actions]');
        if (!actions || !actions.dataset.payload) return null;
        try {
            return JSON.parse(actions.dataset.payload);
        } catch (e) {
            return null;
        }
    }

    // =========================================================================
    // Модальное окно выбора формата
    // =========================================================================

    /**
     * Открыть диалог экспорта для указанного payload.
     */
    function openExportDialog(payload) {
        let modal = document.getElementById('export-modal');

        // Создание модалки при первом вызове
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'export-modal';
            modal.className = 'modal';
            modal.hidden = true;
            modal.innerHTML = ''
                + '<div class="modal-backdrop" data-export-close></div>'
                + '<div class="modal-dialog" role="dialog" '
                + '     aria-labelledby="export-modal-title" aria-modal="true">'
                + '  <header class="modal-head">'
                + '    <h3 id="export-modal-title">Экспорт результата</h3>'
                + '    <button type="button" class="modal-close" '
                + '            data-export-close aria-label="Закрыть">'
                + '      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" '
                + '           stroke="currentColor" stroke-width="2" stroke-linecap="round" '
                + '           stroke-linejoin="round">'
                + '        <line x1="18" y1="6" x2="6" y2="18"/>'
                + '        <line x1="6" y1="6" x2="18" y2="18"/>'
                + '      </svg>'
                + '    </button>'
                + '  </header>'
                + '  <div class="modal-body">'
                + '    <p style="color:var(--text-secondary);font-size:var(--text-sm);'
                + '              margin-bottom:var(--space-4);">'
                + '      Выберите формат файла:'
                + '    </p>'
                + '    <div style="display:flex;flex-direction:column;gap:var(--space-2);">'
                + '      <button type="button" class="btn btn-soft" '
                + '              data-export-format="txt" '
                + '              style="justify-content:flex-start;">'
                + '        TXT — текстовый отчёт'
                + '      </button>'
                + '      <button type="button" class="btn btn-soft" '
                + '              data-export-format="tex" '
                + '              style="justify-content:flex-start;">'
                + '        LaTeX — .tex документ'
                + '      </button>'
                + '      <button type="button" class="btn btn-soft" '
                + '              data-export-format="json" '
                + '              style="justify-content:flex-start;">'
                + '        JSON — структурированные данные'
                + '      </button>'
                + '    </div>'
                + '  </div>'
                + '</div>';

            document.body.appendChild(modal);

            // Обработчики внутри модалки
            modal.addEventListener('click', function (e) {
                // Закрыть
                if (e.target.closest('[data-export-close]')) {
                    ML.modal.close('#export-modal');
                    return;
                }

                // Выбор формата
                const fmtBtn = e.target.closest('[data-export-format]');
                if (!fmtBtn) return;

                const fmt = fmtBtn.dataset.exportFormat;
                const currentPayload = modal._payload;
                if (!currentPayload) return;

                let ok = true;
                let ext = 'txt';

                if (fmt === 'txt') {
                    ext = 'txt';
                    download(fileName('txt'), payloadToText(currentPayload));
                } else if (fmt === 'tex') {
                    ext = 'tex';
                    download(
                        fileName('tex'),
                        payloadToLatex(currentPayload),
                        'application/x-tex;charset=utf-8'
                    );
                } else if (fmt === 'json') {
                    ext = 'json';
                    download(
                        fileName('json'),
                        payloadToJson(currentPayload),
                        'application/json;charset=utf-8'
                    );
                } else {
                    ok = false;
                }

                if (ok) {
                    ML.modal.close('#export-modal');
                    ML.toast.success('Файл скачан', 'Формат: ' + ext.toUpperCase());
                }
            });
        }

        // Сохранить текущий payload и открыть
        modal._payload = payload;
        ML.modal.open('#export-modal');
    }

    // =========================================================================
    // Делегированные обработчики кнопок
    // =========================================================================

    function initExportButtons() {
        document.addEventListener('click', function (e) {

            // --- Копировать полный отчёт -----------------------------------
            const copyBtn = e.target.closest('[data-copy-result]');
            if (copyBtn) {
                e.preventDefault();
                const block = copyBtn.closest('[data-result-block]');
                const payload = getPayload(block);
                if (!payload) {
                    ML.toast.warning('Нет результата', 'Сначала выполните операцию.');
                    return;
                }
                ML.copy.text(payloadToText(payload), 'Результат скопирован');
                return;
            }

            // --- Копировать LaTeX ------------------------------------------
            const latexBtn = e.target.closest('[data-copy-latex-result]');
            if (latexBtn) {
                e.preventDefault();
                const block = latexBtn.closest('[data-result-block]');
                const payload = getPayload(block);
                if (!payload) {
                    ML.toast.warning('Нет результата', 'Сначала выполните операцию.');
                    return;
                }
                const text = payload.latex
                    || (payload.task && payload.task.matrix_latex)
                    || '';
                if (!text) {
                    ML.toast.warning('Пусто', 'LaTeX-представление отсутствует.');
                    return;
                }
                ML.copy.text(text, 'LaTeX скопирован');
                return;
            }

            // --- Копировать как текст --------------------------------------
            const textBtn = e.target.closest('[data-copy-text-result]');
            if (textBtn) {
                e.preventDefault();
                const block = textBtn.closest('[data-result-block]');
                const payload = getPayload(block);
                if (!payload) {
                    ML.toast.warning('Нет результата', 'Сначала выполните операцию.');
                    return;
                }
                ML.copy.text(payloadToText(payload), 'Текст скопирован');
                return;
            }

            // --- Скачать ---------------------------------------------------
            const exportBtn = e.target.closest('[data-export-result]');
            if (exportBtn) {
                e.preventDefault();
                const block = exportBtn.closest('[data-result-block]');
                const payload = getPayload(block);
                if (!payload) {
                    ML.toast.warning('Нет результата', 'Сначала выполните операцию.');
                    return;
                }
                openExportDialog(payload);
                return;
            }
        });
    }

    // =========================================================================
    // Инициализация
    // =========================================================================
    initExportButtons();

    // Публичный API для внешнего использования
    ML.export = {
        download: download,
        toText: payloadToText,
        toLatex: payloadToLatex,
        toJson: payloadToJson,
        openDialog: openExportDialog,
    };

})();