export interface UserAction {
    type:
        'click'
        | 'input'
        | 'select'
        | 'change'
        | 'open_tab'
        | 'reload_tab'
        | 'dblclick',
    element: string,
    timestamp: number,
    selector: string,
    tabInfo: TabInfo,
    value?: string,
    labelText?: string
}

export interface ErrorLog {
    type: 'console' | 'network' | 'ui' | 'user',
    id?: string,
    message: string,
    timestamp: number,
    tabInfo: TabInfo,
    stack?: string,
    status?: number,
    method?: string,
    urlRequested?: string,
    requestHeaders?: Record<string, string>,
    requestBody?: string,
    responseHeaders?: Record<string, string>,
    responseBody?: string,
    screenshotId?: string,
    networkPayloadId?: string
}

export interface NetworkErrorPayload {
    id: string,
    errorId: string,
    timestamp: number,
    requestHeaders?: Record<string, string>,
    requestBody?: string,
    responseHeaders?: Record<string, string>,
    responseBody?: string
}

export interface UiErrorScreenshot {
    id: string,
    errorId: string,
    tabId?: number | string,
    timestamp: number,
    imageDataUrl: string
}

export interface TabInfo {
    id: number | string | undefined,
    url: string | undefined,
    title: string | undefined
}

export interface StorageData {
    userActions: UserAction[],
    errors: ErrorLog[],
    uiErrorScreenshots: UiErrorScreenshot[],
    networkErrorPayloads: NetworkErrorPayload[]
}

export interface TicketExample {
    summary: string,
    description: string
}

export interface DocumentationExample {
    title: string,
    steps: string
}

export interface EncryptedPassword {
    ciphertext: string,
    iv: string,
    salt: string
}

export interface ExtensionConfiguration {
    allowedUrls: string[],
    errorsDisabledUrls?: string[],
    llmEnabled?: boolean,
    errorMonitoring: {
        network: boolean,
        console: boolean,
        ui: boolean
    },
    uiErrorSelectors: string[],
    language: 'auto' | 'en' | 'ru',
    llm: {
        type: 'OpenAI' | 'DeepSeek' | 'custom',
        encryptedKey?: EncryptedPassword,
        apiUrl?: string,
        model?: string
    },
    userActionsLimit: number,
    errorsLimit: number,
    textLengthLimit: number,
    webhookEnabled?: boolean,
    webhook?: {
        url?: string,
        username?: string,
        encryptedPassword?: EncryptedPassword
    },
    redactUrlQueryParams?: boolean,
    ticketExample?: TicketExample,
    documentationExample?: DocumentationExample
}