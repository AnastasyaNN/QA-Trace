import {type LlmPromptLocale} from "./prompt-i18n";

export class RequirementsTemplate {
    static buildRequirementsPrompt(
    mode: 'steps' | 'full' | 'document',
    promptLocale: LlmPromptLocale
): string {
    if (mode === 'full') {
        return promptLocale === "en"
            ? `* Summary: <general information about performed actions>.
* Time: <time for activity: start date and end date>.
* Amount of errors detected: <amount of errors found during test charter>.
* Detailed information about errors: <for each error provide information in Jira ticket format:
    ${RequirementsTemplate.buildRequirementsPrompt('steps', promptLocale)}
>    
* Information about tested areas: pages, dialogs, use cases (e.g. creation of elements).`
            : `* Короткое описание: <общая информация о выполненых действиях>.
* Время: <время сессии: начало и конец>.
* Количество обнаруженных ошибок: <количество ошибок обнаруженных во время сессии исследовательского тестирования>.
* Подробная информация об ошибках: <для каждой ошибки предоставь информацию в формате Jira тикета:
${RequirementsTemplate.buildRequirementsPrompt('steps', promptLocale)}
>    
* Информация о затронутых областях: страницы, диалоги, пользовательские сценарии(например, создание объектов).
`
    }

    if (mode === 'steps')
        return promptLocale === "en"
            ? `Provide output in Jira ticket format with the following data:
- Summary: <error description and what is wrong>.
- Description:
  Preconditions (optional): <short setup. For example, "Open DevTools" or "Open console".>
  Steps to reproduce: <numbered list of meaningful steps>.
- Actual result: <what has happened>.
- Expected result: <what should happen (in scope of known information. DO NOT IMAGINE! JUST USE WHAT YOU KNOW!)>.

Common rule:
If example of Jira ticket is provided, use it as a standard and generate steps in similar style as it is provided in the example of Jira ticket.

Rules for summary:
- Summary shouldn't be longer than 255 characters

Rules for steps:
- Steps should be straightforward and grouped by activity (e.g., combine login actions into one step "Login with username", combine creation steps into "Create object <> with configuration: ...").
- Don't use urls in the steps.
- Combine related filtering/sorting actions into single steps.
- Save actions performed in different tabs and log activities.
- Don't use bold, cursive or other styles. Use a numbered list.
- Do NOT add steps like "Open DevTools" or "Open console" (add this information in Preconditions section.`
            : `Предоставь вывод в формате Jira тикета со следующими данными:
- Краткое описание: <описание проблемы и того, что именно неправильно>.
- Описание:
  Предусловия (опционально): <предварительная настройка. Например, "Открыть DevTools" или "Открыть console".>
  Шаги для воспроизведения: <пронумерованный список значимых шагов>.
- Фактический результат: <что происходит>.
- Ожидаемый результат: <что должно происходить (в контексте известной информации. НИЧЕГО НЕ ПРИДУМАВЫЙ! ИСПОЛЬЗУЙ ТОЛЬКО ИМЕЮЩУЮСЯ ИНФОРМАЦИЮ!)>.

Общее правило:
Если есть пример Jira тикета, используй его в качестве стандарта и генерируй шаги в таком же стиле как в примере Jira тикета.

Правила для краткого описания:
- Описание должно быть короче 255 символов

Правила для шагов:
- Шаги должны быть понятны и сгруппированы по смыслу (например, сгруппируй все действия с логином в один шаг "Залогинься с кредами <>", сгруппируй шаги создания в "Создай объект <> с конфигурацией: ...").
- Не используй адреса в шагах.
- Группируй действия сортировки/фильтрации в один шаг.
- Сохраняй информацию о действиях из разных вкладок и логируй их.
- Не используй стили (жирный, курсивный, ...). Используй пронумерованный список.
- НЕ ДОБАВЛЯЙ шаги вроде "Открыть DevTools" или "Открыть console" (добавляй эту информацию в раздел Предусловия.`

    return promptLocale === "en"
        ? `Provide output in documentation style with the following data:
- Title: <title for documentation of further steps>.
- Steps: <numbered list of meaningful steps>.

Common rule:
If example of Documentation is provided, use it as a standard and generate steps in similar style as it is provided in the example of Documentation.

Rules for title:
- Title should be meaningful and describe general idea of the provided steps.

Rules for steps:
- Steps should be straightforward and grouped by activity (e.g., combine login actions into one step "Login with username", combine creation steps into "Create object <> with configuration: ...").
- Don't use urls in the steps.
- Combine related filtering/sorting actions into single steps.
- Save actions performed in different tabs and log activities.
- Don't use bold, cursive or other styles. Use a numbered list.
- Do NOT use real data in the steps. Steps should be anonymized and show its general idea as this is a step for documentation.`
        : `Предоставь вывод в формате документации со следующими данными:
- Заголовок: <заголовок для документации последующих шагов>.
- Шаги: <пронумерованный список значимых шагов>.

Общее правило:
Если есть пример сценария для документации, используй его в качестве стандарта и генерируй шаги в таком же стиле как в примере сценария для документации.

Правила для заголовка:
- Заголовок должен быть понятным и описывать общую идею для последующих шагов.

Правила для шагов:
- Шаги должны быть понятны и сгруппированы по смыслу (например, сгруппируй все действия с логином в один шаг "Залогинься с кредами <>", сгруппируй шаги создания в "Создай объект <> с конфигурацией: ...").
- Не используй адреса в шагах.
- Группируй действия сортировки/фильтрации в один шаг.
- Сохраняй информацию о действиях из разных вкладок и логируй их.
- Не используй стили (жирный, курсивный, ...). Используй пронумерованный список.
- НЕ ИСПОЛЬЗУЙ реальные данные для шагов. Шаги должны быть аниномизированы и отражать общую идею, так как это шаги для документации.`
    }
}
