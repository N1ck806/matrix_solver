/* =============================================================================
   MatrixLab — export.js
   =============================================================================
   Экспорт результата операции.

   Возможности:
       • Копировать — полный текстовый отчёт через ML.buildPlainText;
       • Копировать LaTeX — только LaTeX-представление результата;
       • Копировать Markdown — отчёт в Markdown;
       • Копировать JSON — сериализованный payload;
       • Скачать — диалог выбора формата:
           TXT  — текстовый отчёт;
           TeX  — минимальный LaTeX-документ (компилируется pdflatex);
           MD   — Markdown-отчёт;
           JSON — payload как есть;
           PDF  — открытие печатной версии в новом окне;
       • Учёт локали (ML.i18n.locale()) при выборе preamble и заголовков;
       • Сохранение последнего выбранного формата в ML.prefs;
       • Универсальное скачивание через Blob + URL.createObjectURL;
       • Работа с payload из [data-result-actions].dataset.payload;
       • Модалка экспорта — через ML.modal.open / close;
       • Публичный API ML.export.{download, toText, toLatex, toMarkdown,
         toJson, toPrint, openDialog, copyReport, formats}.

   Зависимости: main.js (ML.copy, ML.modal, ML.toast, ML.i18n, ML.prefs,
   ML.escapeHtml, ML.buildPlainText, ML.emit).
   ============================================================================= */
(function () {
    'use strict';

    const ML = window.MatrixLab;
    if (!ML) {
        console.error('[export.js] window.MatrixLab не найден — модуль не запущен.');
        return;
    }

    // =========================================================================
    // 1. УТИЛИТЫ
    // =========================================================================

    function s(v) {
        return v === null || v === undefined ? '' : String(v);
    }

    function tr(key, fallback) {
        return ML.i18n.t(key, fallback);
    }

    function locale() {
        return ML.i18n.locale() || 'ru';
    }

    function pad2(n) {
        return n < 10 ? '0' + n : String(n);
    }

    function timestamp() {
        const d = new Date();
        return d.getFullYear()
            + pad2(d.getMonth() + 1)
            + pad2(d.getDate()) + '_'
            + pad2(d.getHours())
            + pad2(d.getMinutes())
            + pad2(d.getSeconds());
    }

    function fileName(op, ext) {
        const opPart = op
            ? (String(op).replace(/[^a-zA-Z0-9_-]/g, '') + '_')
            : '';
        return 'matrixlab_' + opPart + timestamp() + '.' + ext;
    }

    function detectOp(payload) {
        if (payload && payload.task && payload.task.operation_latex) {
            return String(payload.task.operation_latex)
                .replace(/[^a-zA-Z0-9]/g, '');
        }
        return '';
    }

    // =========================================================================
    // 2. СКАЧИВАНИЕ
    // =========================================================================

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

        // Освобождаем URL в следующем кадре — быстрее, чем setTimeout
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(function () {
                URL.revokeObjectURL(url);
            });
        } else {
            setTimeout(function () { URL.revokeObjectURL(url); }, 600);
        }
    }

    // =========================================================================
    // 3. ТЕКСТОВЫЙ ОТЧЁТ
    // =========================================================================

    function toText(payload) {
        if (!payload) return '';
        // Единый источник — ML.buildPlainText из main.js
        return ML.buildPlainText(payload);
    }

    // =========================================================================
    // 4. LATEX-ДОКУМЕНТ
    // =========================================================================

    function toLatex(payload) {
        if (!payload) return '';

        const loc = locale();
        const isRu = loc === 'ru';

        const out = [];

        out.push('% MatrixLab — ' + tr('export.report', 'отчёт'));
        out.push('% Дата: ' + new Date().toISOString());
        if (payload.task && payload.task.operation_latex) {
            out.push('% Операция: ' + s(payload.task.operation_latex));
        }
        out.push('');
        out.push('\\documentclass[11pt,a4paper]{article}');
        out.push('\\usepackage[utf8]{inputenc}');
        out.push('\\usepackage[T2A]{fontenc}');
        if (isRu) {
            out.push('\\usepackage[russian]{babel}');
        } else {
            out.push('\\usepackage[english]{babel}');
        }
        out.push('\\usepackage{amsmath, amssymb, amsthm}');
        out.push('\\usepackage[margin=2.5cm]{geometry}');
        out.push('');
        out.push('\\begin{document}');
        out.push('');

        // --- Задание
        const task = payload.task || {};
        if (task.operation_latex || task.matrix_latex
            || task.matrix_a_latex || task.vector_latex
            || (Array.isArray(task.matrices_latex)
                && task.matrices_latex.length)) {
            out.push('\\section*{' + tr('export.task', 'Задание') + '}');
            out.push('');
            if (task.operation_latex) {
                out.push('Операция: \\('
                    + s(task.operation_latex) + '\\)');
                out.push('');
            }
            if (Array.isArray(task.matrices_latex)
                && task.matrices_latex.length) {
                task.matrices_latex.forEach(function (m, i) {
                    out.push('\\[ M_{' + (i + 1) + '} = '
                        + s(m) + ' \\]');
                });
                out.push('');
            } else if (task.matrix_a_latex && task.matrix_b_latex) {
                out.push('\\[ A = ' + s(task.matrix_a_latex) + ' \\]');
                out.push('\\[ B = ' + s(task.matrix_b_latex) + ' \\]');
                out.push('');
            } else if (task.matrix_latex && task.vector_latex) {
                out.push('\\[ A = ' + s(task.matrix_latex) + ' \\]');
                out.push('\\[ b = ' + s(task.vector_latex) + ' \\]');
                out.push('');
            } else if (task.matrix_latex) {
                out.push('\\[ A = ' + s(task.matrix_latex) + ' \\]');
                out.push('');
            }
        }

        // --- Решение
        if (Array.isArray(payload.steps) && payload.steps.length) {
            out.push('\\section*{'
                + tr('export.solution', 'Решение') + '}');
            out.push('');
            payload.steps.forEach(function (step, i) {
                out.push('\\subsection*{'
                    + tr('export.step', 'Шаг') + ' ' + (i + 1)
                    + (step.title ? '. ' + s(step.title) : '') + '}');
                out.push('');
                if (step.text) { out.push(s(step.text)); out.push(''); }
                if (step.latex) {
                    out.push('\\[ ' + s(step.latex) + ' \\]');
                    out.push('');
                }
            });
        }

        // --- Результат
        out.push('\\section*{'
            + tr('export.result', 'Результат') + '}');
        out.push('');
        if (payload.latex) {
            out.push('\\[ ' + s(payload.latex) + ' \\]');
            out.push('');
        } else if (payload.result !== undefined) {
            out.push('\\begin{verbatim}');
            try {
                if (typeof payload.result === 'object') {
                    out.push(JSON.stringify(payload.result, null, 2));
                } else {
                    out.push(s(payload.result));
                }
            } catch (e) { /* noop */ }
            out.push('\\end{verbatim}');
            out.push('');
        }

        // --- Проверки
        if (Array.isArray(payload.checks) && payload.checks.length) {
            out.push('\\section*{'
                + tr('export.checks', 'Проверки') + '}');
            out.push('');
            out.push('\\begin{itemize}');
            payload.checks.forEach(function (c) {
                out.push('  \\item '
                    + (c.ok === false ? '[FAIL]' : '[OK]')
                    + ' ' + s(c.name));
            });
            out.push('\\end{itemize}');
            out.push('');
        }

        // --- Пояснение
        if (payload.explanation) {
            out.push('\\section*{'
                + tr('export.explanation', 'Пояснение') + '}');
            out.push('');
            out.push(s(payload.explanation));
            out.push('');
        }

        out.push('\\end{document}');
        return out.join('\n');
    }

    // =========================================================================
    // 5. MARKDOWN
    // =========================================================================

    function toMarkdown(payload) {
        if (!payload) return '';

        const md = [];
        md.push('# MatrixLab — ' + tr('export.report', 'отчёт'));
        md.push('');
        md.push('_' + tr('export.date', 'Дата') + ': '
            + new Date().toISOString() + '_');
        md.push('');

        const task = payload.task || {};
        if (task.operation_latex || task.matrix_latex
            || task.matrix_a_latex || task.vector_latex
            || (Array.isArray(task.matrices_latex)
                && task.matrices_latex.length)) {
            md.push('## ' + tr('export.task', 'Задание'));
            md.push('');
            if (task.operation_latex) {
                md.push('**' + tr('export.operation', 'Операция')
                    + ':** `' + s(task.operation_latex) + '`');
                md.push('');
            }
            if (Array.isArray(task.matrices_latex)
                && task.matrices_latex.length) {
                task.matrices_latex.forEach(function (m, i) {
                    md.push('$$M_{' + (i + 1) + '} = ' + s(m) + '$$');
                });
                md.push('');
            } else if (task.matrix_a_latex && task.matrix_b_latex) {
                md.push('$$A = ' + s(task.matrix_a_latex) + '$$');
                md.push('');
                md.push('$$B = ' + s(task.matrix_b_latex) + '$$');
                md.push('');
            } else if (task.matrix_latex && task.vector_latex) {
                md.push('$$A = ' + s(task.matrix_latex) + '$$');
                md.push('');
                md.push('$$b = ' + s(task.vector_latex) + '$$');
                md.push('');
            } else if (task.matrix_latex) {
                md.push('$$A = ' + s(task.matrix_latex) + '$$');
                md.push('');
            }
        }

        if (Array.isArray(payload.steps) && payload.steps.length) {
            md.push('## ' + tr('export.solution', 'Решение'));
            md.push('');
            payload.steps.forEach(function (step, i) {
                md.push('### ' + tr('export.step', 'Шаг') + ' ' + (i + 1)
                    + (step.title ? '. ' + s(step.title) : ''));
                md.push('');
                if (step.text) { md.push(s(step.text)); md.push(''); }
                if (step.latex) {
                    md.push('$$' + s(step.latex) + '$$');
                    md.push('');
                }
            });
        }

        md.push('## ' + tr('export.result', 'Результат'));
        md.push('');
        if (payload.latex) {
            md.push('$$' + s(payload.latex) + '$$');
            md.push('');
        } else if (payload.result !== undefined) {
            md.push('```json');
            try {
                if (typeof payload.result === 'object') {
                    md.push(JSON.stringify(payload.result, null, 2));
                } else {
                    md.push(s(payload.result));
                }
            } catch (e) { /* noop */ }
            md.push('```');
            md.push('');
        }

        if (Array.isArray(payload.checks) && payload.checks.length) {
            md.push('## ' + tr('export.checks', 'Проверки'));
            md.push('');
            payload.checks.forEach(function (c) {
                md.push('- ' + (c.ok === false ? '✗' : '✓')
                    + ' ' + s(c.name));
            });
            md.push('');
        }

        if (payload.explanation) {
            md.push('## ' + tr('export.explanation', 'Пояснение'));
            md.push('');
            md.push(s(payload.explanation));
            md.push('');
        }

        return md.join('\n');
    }

    // =========================================================================
    // 6. JSON
    // =========================================================================

    function toJson(payload) {
        try { return JSON.stringify(payload, null, 2); }
        catch (e) { return '{}'; }
    }

    // =========================================================================
    // 7. PDF (печатная версия в новом окне)
    // =========================================================================

    function toPrint(payload) {
        const w = window.open('', '_blank', 'width=900,height=1000');
        if (!w) {
            ML.toast.warning(
                tr('export.popupBlocked', 'Не удалось открыть окно'),
                tr('export.popupHint',
                    'Разрешите всплывающие окна для печати.')
            );
            return;
        }

        const title = 'MatrixLab — ' + tr('export.report', 'отчёт');
        const bodyHtml = buildPrintableHtml(payload);

        w.document.open();
        w.document.write(''
            + '<!doctype html><html lang="' + locale() + '"><head>'
            + '<meta charset="utf-8">'
            + '<title>' + ML.escapeHtml(title) + '</title>'
            + '<style>'
            + '  body{font-family:Georgia,serif;max-width:800px;margin:32px auto;padding:0 24px;color:#111;}'
            + '  h1{font-size:24px;margin:0 0 8px;}'
            + '  h2{font-size:18px;margin:24px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px;}'
            + '  h3{font-size:15px;margin:16px 0 6px;color:#333;}'
            + '  .meta{color:#666;font-size:12px;margin-bottom:16px;}'
            + '  .step{margin:8px 0 12px;padding:8px 12px;border-left:3px solid #4f46e5;background:#f8f8fc;}'
            + '  .check{font-family:monospace;font-size:13px;}'
            + '  .check.ok{color:#0a8f3a;}'
            + '  .check.fail{color:#b91c1c;}'
            + '  pre{background:#f4f4f7;padding:10px;border-radius:6px;overflow:auto;font-size:12px;}'
            + '  hr{border:0;border-top:1px dashed #ccc;margin:24px 0;}'
            + '  .footer{margin-top:32px;color:#888;font-size:11px;text-align:center;}'
            + '  @media print { body{margin:0;} .footer{display:none;} }'
            + '</style>'
            + '</head><body>'
            + bodyHtml
            + '<div class="footer">MatrixLab — '
            + ML.escapeHtml(new Date().toLocaleString())
            + '</div>'
            + '<script>window.onload=function(){setTimeout(function(){window.print();},150);};<\/script>'
            + '</body></html>');
        w.document.close();
    }

    function buildPrintableHtml(payload) {
        const parts = [];
        parts.push('<h1>MatrixLab — '
            + ML.escapeHtml(tr('export.report', 'отчёт')) + '</h1>');
        parts.push('<div class="meta">'
            + ML.escapeHtml(new Date().toLocaleString()) + '</div>');

        const task = payload.task || {};
        if (task.operation_latex || task.matrix_latex
            || task.matrix_a_latex || task.vector_latex
            || (Array.isArray(task.matrices_latex)
                && task.matrices_latex.length)) {
            parts.push('<h2>'
                + ML.escapeHtml(tr('export.task', 'Задание'))
                + '</h2>');
            if (task.operation_latex) {
                parts.push('<p><b>'
                    + ML.escapeHtml(tr('export.operation', 'Операция'))
                    + ':</b> <code>'
                    + ML.escapeHtml(task.operation_latex)
                    + '</code></p>');
            }
            if (Array.isArray(task.matrices_latex)
                && task.matrices_latex.length) {
                task.matrices_latex.forEach(function (m, i) {
                    parts.push('<pre>M' + (i + 1) + ' = '
                        + ML.escapeHtml(m) + '</pre>');
                });
            } else if (task.matrix_a_latex && task.matrix_b_latex) {
                parts.push('<pre>A = '
                    + ML.escapeHtml(task.matrix_a_latex) + '</pre>');
                parts.push('<pre>B = '
                    + ML.escapeHtml(task.matrix_b_latex) + '</pre>');
            } else if (task.matrix_latex && task.vector_latex) {
                parts.push('<pre>A = '
                    + ML.escapeHtml(task.matrix_latex) + '</pre>');
                parts.push('<pre>b = '
                    + ML.escapeHtml(task.vector_latex) + '</pre>');
            } else if (task.matrix_latex) {
                parts.push('<pre>A = '
                    + ML.escapeHtml(task.matrix_latex) + '</pre>');
            }
        }

        if (Array.isArray(payload.steps) && payload.steps.length) {
            parts.push('<h2>'
                + ML.escapeHtml(tr('export.solution', 'Решение'))
                + '</h2>');
            payload.steps.forEach(function (step, i) {
                parts.push('<div class="step">');
                parts.push('<h3>' + ML.escapeHtml(tr('export.step', 'Шаг'))
                    + ' ' + (i + 1)
                    + (step.title ? '. ' + ML.escapeHtml(step.title) : '')
                    + '</h3>');
                if (step.text) {
                    parts.push('<p>' + ML.escapeHtml(step.text) + '</p>');
                }
                if (step.latex) {
                    parts.push('<pre>' + ML.escapeHtml(step.latex)
                        + '</pre>');
                }
                parts.push('</div>');
            });
        }

        parts.push('<h2>'
            + ML.escapeHtml(tr('export.result', 'Результат'))
            + '</h2>');
        if (payload.latex) {
            parts.push('<pre>' + ML.escapeHtml(payload.latex) + '</pre>');
        } else if (payload.result !== undefined) {
            try {
                if (typeof payload.result === 'object') {
                    parts.push('<pre>'
                        + ML.escapeHtml(
                            JSON.stringify(payload.result, null, 2))
                        + '</pre>');
                } else {
                    parts.push('<pre>'
                        + ML.escapeHtml(payload.result) + '</pre>');
                }
            } catch (e) { /* noop */ }
        }

        if (Array.isArray(payload.checks) && payload.checks.length) {
            parts.push('<h2>'
                + ML.escapeHtml(tr('export.checks', 'Проверки'))
                + '</h2>');
            payload.checks.forEach(function (c) {
                parts.push('<div class="check '
                    + (c.ok === false ? 'fail' : 'ok') + '">'
                    + (c.ok === false ? '✗' : '✓')
                    + ' ' + ML.escapeHtml(c.name) + '</div>');
            });
        }

        if (payload.explanation) {
            parts.push('<h2>'
                + ML.escapeHtml(tr('export.explanation', 'Пояснение'))
                + '</h2>');
            parts.push('<p>' + ML.escapeHtml(payload.explanation) + '</p>');
        }

        return parts.join('\n');
    }

    // =========================================================================
    // 8. ПОЛУЧЕНИЕ PAYLOAD ИЗ БЛОКА
    // =========================================================================

    function getPayload(block) {
        if (!block) return null;
        const actions = block.querySelector('[data-result-actions]');
        if (!actions || !actions.dataset.payload) return null;
        try { return JSON.parse(actions.dataset.payload); }
        catch (e) { return null; }
    }

    // =========================================================================
    // 9. МОДАЛКА ВЫБОРА ФОРМАТА
    // =========================================================================

    const FORMATS = [
        {
            key: 'txt',
            labelKey: 'export.formatTxt',
            label: 'TXT — текстовый отчёт',
            ext: 'txt',
            mime: 'text/plain;charset=utf-8'
        },
        {
            key: 'tex',
            labelKey: 'export.formatTex',
            label: 'LaTeX — .tex документ',
            ext: 'tex',
            mime: 'application/x-tex;charset=utf-8'
        },
        {
            key: 'md',
            labelKey: 'export.formatMd',
            label: 'Markdown — .md отчёт',
            ext: 'md',
            mime: 'text/markdown;charset=utf-8'
        },
        {
            key: 'json',
            labelKey: 'export.formatJson',
            label: 'JSON — структурированные данные',
            ext: 'json',
            mime: 'application/json;charset=utf-8'
        },
        {
            key: 'pdf',
            labelKey: 'export.formatPdf',
            label: 'PDF — печатная версия',
            ext: 'pdf',
            mime: null
        }
    ];

    function ensureModal() {
        let modal = document.getElementById('export-modal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'export-modal';
        modal.className = 'modal';
        modal.hidden = true;

        const formatsHtml = FORMATS.map(function (f) {
            const label = tr(f.labelKey, f.label);
            return '<button type="button" class="btn btn-soft" '
                + 'data-export-format="' + f.key + '" '
                + 'aria-label="' + ML.escapeHtml(label) + '" '
                + 'style="justify-content:flex-start;">'
                + ML.escapeHtml(label)
                + '</button>';
        }).join('');

        modal.innerHTML = ''
            + '<div class="modal-backdrop" data-export-close></div>'
            + '<div class="modal-dialog" role="dialog" '
            + '     aria-labelledby="export-modal-title" aria-modal="true">'
            + '  <header class="modal-head">'
            + '    <h3 id="export-modal-title">'
            +      ML.escapeHtml(tr('export.title', 'Экспорт результата'))
            + '    </h3>'
            + '    <button type="button" class="modal-close" '
            + '            data-export-close aria-label="'
            +      ML.escapeHtml(tr('common.close', 'Закрыть')) + '">'
            + '      <svg width="16" height="16" viewBox="0 0 24 24" '
            + '           fill="none" stroke="currentColor" '
            + '           stroke-width="2" stroke-linecap="round" '
            + '           stroke-linejoin="round">'
            + '        <line x1="18" y1="6" x2="6" y2="18"/>'
            + '        <line x1="6" y1="6" x2="18" y2="18"/>'
            + '      </svg>'
            + '    </button>'
            + '  </header>'
            + '  <div class="modal-body">'
            + '    <p class="modal-hint">'
            +      ML.escapeHtml(tr('export.chooseFormat',
                'Выберите формат файла:'))
            + '    </p>'
            + '    <div class="export-formats">' + formatsHtml + '</div>'
            + '  </div>'
            + '</div>';

        document.body.appendChild(modal);

        // Обработчик выбора формата — один раз
        modal.addEventListener('click', function (e) {
            const fmtBtn = e.target.closest('[data-export-format]');
            if (!fmtBtn) return;
            const fmt = fmtBtn.dataset.exportFormat;
            const payload = modal._payload;
            if (!payload) return;
            runFormat(fmt, payload);
        });

        return modal;
    }

    function runFormat(fmt, payload) {
        const info = FORMATS.find(function (f) { return f.key === fmt; });
        if (!info) return;

        const opPart = detectOp(payload);

        ML.emit('export:format', { format: fmt });

        try {
            if (fmt === 'txt') {
                download(fileName(opPart, 'txt'),
                    toText(payload), info.mime);
            } else if (fmt === 'tex') {
                download(fileName(opPart, 'tex'),
                    toLatex(payload), info.mime);
            } else if (fmt === 'md') {
                download(fileName(opPart, 'md'),
                    toMarkdown(payload), info.mime);
            } else if (fmt === 'json') {
                download(fileName(opPart, 'json'),
                    toJson(payload), info.mime);
            } else if (fmt === 'pdf') {
                toPrint(payload);
            } else {
                return;
            }

            ML.prefs.set('export.format', fmt);
            ML.modal.close('#export-modal');
            ML.toast.success(
                tr('export.fileReady', 'Файл готов'),
                tr('export.formatLabel', 'Формат') + ': '
                    + fmt.toUpperCase()
            );
            ML.emit('export:done', { format: fmt, payload: payload });
        } catch (err) {
            ML.toast.error(
                tr('export.failed', 'Не удалось экспортировать'),
                err.message || ''
            );
            ML.emit('export:error', { format: fmt, error: err });
        }
    }

    function openDialog(payload) {
        if (!payload) {
            ML.toast.warning(
                tr('export.noData', 'Нет данных'),
                tr('export.runFirst', 'Сначала выполните операцию.')
            );
            return;
        }
        const modal = ensureModal();
        modal._payload = payload;

        // Подсветить последний использованный формат
        const last = ML.prefs.get('export.format');
        if (last) {
            ML.$$('[data-export-format]', modal).forEach(function (btn) {
                btn.classList.toggle(
                    'is-active',
                    btn.dataset.exportFormat === last
                );
            });
        }

        ML.modal.open('#export-modal');
    }

    // =========================================================================
    // 10. КОПИРОВАНИЕ В БУФЕР
    // =========================================================================

    function copyReport(block, format) {
        const payload = getPayload(block);
        if (!payload) {
            ML.toast.warning(
                tr('export.noResult', 'Нет результата'),
                tr('export.runFirst', 'Сначала выполните операцию.')
            );
            return;
        }
        switch (format) {
            case 'latex':
                ML.copy.latex(
                    payload.latex || '',
                    tr('export.latexCopied', 'LaTeX скопирован')
                );
                break;
            case 'markdown':
                ML.copy.markdown(
                    toMarkdown(payload),
                    tr('export.mdCopied', 'Markdown скопирован')
                );
                break;
            case 'json':
                ML.copy.json(
                    payload,
                    tr('export.jsonCopied', 'JSON скопирован')
                );
                break;
            case 'text':
            default:
                ML.copy.text(
                    toText(payload),
                    tr('export.reportCopied', 'Отчёт скопирован')
                );
        }
        ML.emit('export:copied', { format: format });
    }

    // =========================================================================
    // 11. ДЕЛЕГИРОВАННЫЕ ОБРАБОТЧИКИ
    // =========================================================================

    function initDelegation() {
        document.addEventListener('click', function (e) {

            const exportBtn = e.target.closest('[data-export-result]');
            if (exportBtn) {
                e.preventDefault();
                const block = exportBtn.closest('[data-result-block]');
                const payload = getPayload(block);
                openDialog(payload);
                return;
            }

            const copyText = e.target.closest(
                '[data-copy-result], [data-copy-text-result]'
            );
            if (copyText) {
                e.preventDefault();
                const block = copyText.closest('[data-result-block]');
                copyReport(block, 'text');
                return;
            }

            const copyLatex = e.target.closest('[data-copy-latex-result]');
            if (copyLatex) {
                e.preventDefault();
                const block = copyLatex.closest('[data-result-block]');
                copyReport(block, 'latex');
                return;
            }

            const copyMd = e.target.closest(
                '[data-copy-markdown-result]'
            );
            if (copyMd) {
                e.preventDefault();
                const block = copyMd.closest('[data-result-block]');
                copyReport(block, 'markdown');
                return;
            }

            const copyJson = e.target.closest(
                '[data-copy-json-result]'
            );
            if (copyJson) {
                e.preventDefault();
                const block = copyJson.closest('[data-result-block]');
                copyReport(block, 'json');
            }
        });
    }

    // =========================================================================
    // 12. ПУБЛИЧНЫЙ API
    // =========================================================================

    ML.export = {
        download:    download,
        toText:      toText,
        toLatex:     toLatex,
        toMarkdown:  toMarkdown,
        toJson:      toJson,
        toPrint:     toPrint,
        openDialog:  openDialog,
        copyReport:  copyReport,
        formats:     FORMATS.map(function (f) { return f.key; }),
        formatList:  FORMATS
    };

    // =========================================================================
    // 13. ИНИЦИАЛИЗАЦИЯ
    // =========================================================================

    let _initialized = false;

    function init() {
        if (_initialized) return;
        _initialized = true;

        initDelegation();
        ML.emit('export:module-ready', {});
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();