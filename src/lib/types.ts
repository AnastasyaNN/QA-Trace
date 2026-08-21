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

export interface NetworkBodies {
    requestHeaders?: Record<string, string>,
    requestBody?: string,
    responseHeaders?: Record<string, string>,
    responseBody?: string
}

export interface NetworkExchange extends NetworkBodies {
    status?: number,
    method?: string,
    urlRequested?: string
}

export interface ErrorLog extends NetworkExchange {
    type: 'console' | 'network' | 'ui' | 'user',
    id?: string,
    message: string,
    timestamp: number,
    tabInfo: TabInfo,
    stack?: string,
    screenshotId?: string,
    networkPayloadId?: string
}

export interface NetworkRequestLog extends NetworkExchange {
    id?: string,
    timestamp: number,
    tabInfo: TabInfo
}

export interface NetworkErrorPayload extends NetworkBodies {
    id: string,
    errorId: string,
    timestamp: number
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
    networkRequests: NetworkRequestLog[],
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
    allNetworkRequestsUrls?: string[],
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
    networkRequestsLimit: number,
    textLengthLimit: number,
    webhookEnabled?: boolean,
    webhook?: {
        url?: string,
        username?: string,
        encryptedPassword?: EncryptedPassword
    },
    redactUrlQueryParams?: boolean,
    redactUrlOrigin?: boolean,
    disableBodyTruncation?: boolean,
    ticketExample?: TicketExample,
    documentationExample?: DocumentationExample
}