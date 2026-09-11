/* =============================================================================
   MatrixLab — saved.js
   =============================================================================
   Страница /saved/ — сохранённые пользователем матрицы.

   Отвечает за:
       • рендер превью каждой матрицы через MathJax;
       • открытие сохранённой матрицы в калькуляторе (сессия + переход);
       • удаление матрицы с подтверждением;
       • работу модального окна сохранения (если понадобится).

   Зависимости: main.js, matrix.js.
   ============================================================================= */
(function () {
    'use strict';

    var ML = window.MatrixLab;
    if (!ML) return;

    // =========================================================================
    // Утилиты
    // =========================================================================

    /** Массив строк → LaTeX-матрица. */
    function matrixToLatex(data) {
        if (!Array.isArray(data) || !data.length) return '';
        var rows = data.map(function (row) {
            return row.map(function (v) { return String(v); }).join(' & ');
        });
        return '\\begin{bmatrix}' + rows.join(' \\\\ ') + '\\end{bmatrix}';
    }

    // =========================================================================
    // Рендер превью матриц через MathJax
    // =========================================================================

    function renderPreviews() {
        ML.$$('[data-saved-preview]').forEach(function (preview) {
            var pk = preview.getAttribute('data-saved-preview');
            if (!pk) return;

            var dataScript = document.querySelector('script[data-saved-data="' + pk + '"]');
            if (!dataScript) return;

            var matrixData;
            try {
                matrixData = JSON.parse(dataScript.textContent);
            } catch (e) {
                preview.innerHTML = '<span class="saved-card-preview-error">Некорректные данные</span>';
                return;
            }

            if (!Array.isArray(matrixData) || !matrixData.length) {
                preview.innerHTML = '<span class="saved-card-preview-error">Пустая матрица</span>';
                return;
            }

            // Убираем placeholder
            preview.innerHTML = '';

            var latex = matrixToLatex(matrixData);
            var container = document.createElement('div');
            container.className = 'saved-card-matrix';
            container.innerHTML = '$$' + latex + '$$';
            preview.appendChild(container);

            // Перерендерить MathJax для этого контейнера
            ML.mathjax.typeset(preview);
        });
    }

    // =========================================================================
    // Открыть сохранённую матрицу в калькуляторе
    // =========================================================================

    function openInCalculator(pk) {
        var item = document.querySelector('[data-saved-item="' + pk + '"]');
        if (!item) return;

        // Сохраняем матрицу в sessionStorage для передачи на страницу калькулятора
        var dataScript = document.querySelector('script[data-saved-data="' + pk + '"]');
        if (!dataScript) {
            ML.toast.error('Ошибка', 'Не удалось прочитать матрицу.');
            return;
        }

        try {
            var matrixData = JSON.parse(dataScript.textContent);
            sessionStorage.setItem('matrixlab.load_matrix', JSON.stringify(matrixData));
            ML.toast.info('Открываем матрицу', 'Переходим в калькулятор…');

            setTimeout(function () {
                window.location.href = '/calculator/';
            }, 300);
        } catch (e) {
            ML.toast.error('Ошибка', 'Некорректные данные матрицы.');
        }
    }

    // =========================================================================
    // Удаление матрицы
    // =========================================================================

    async function deleteMatrix(pk, btn) {
        if (!confirm('Удалить эту матрицу?')) return;

        try {
            await ML.api.post('/saved/' + pk + '/delete/', {});

            var item = document.querySelector('[data-saved-item="' + pk + '"]');
            if (item) item.remove();

            ML.toast.success('Удалено', 'Матрица удалена из сохранённых.');

            // Если больше нет сохранённых — перезагружаем страницу для пустого состояния
            var remaining = document.querySelectorAll('[data-saved-item]').length;
            if (remaining === 0) {
                setTimeout(function () {
                    location.reload();
                }, 400);
            }
        } catch (err) {
            ML.toast.error('Ошибка', err.message || 'Не удалось удалить.');
        }
    }

    // =========================================================================
    // Инициализация
    // =========================================================================

    function init() {
        // Рендер превью
        renderPreviews();

        // Делегированные обработчики
        document.addEventListener('click', function (e) {

            // --- Использовать матрицу (обе кнопки: иконка + текст) --------
            var useBtn = e.target.closest('[data-saved-use]');
            if (useBtn) {
                e.preventDefault();
                var pk = useBtn.dataset.savedUse;
                if (!pk) return;
                openInCalculator(pk);
                return;
            }

            // --- Удалить матрицу -------------------------------------------
            var delBtn = e.target.closest('[data-saved-delete]');
            if (delBtn) {
                e.preventDefault();
                var pk = delBtn.dataset.savedDelete;
                if (!pk) return;
                deleteMatrix(pk, delBtn);
                return;
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();