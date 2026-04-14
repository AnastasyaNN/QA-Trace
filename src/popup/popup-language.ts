import {ExtensionConfiguration} from "../lib/types";

export class PopupLanguage {
    static getResolvedLanguageCode(configuration: ExtensionConfiguration): 'en' | 'ru' {
    const configured = configuration?.language
    if (configured === 'ru' || configured === 'en')
        return configured
    const browserLanguage = (navigator.language || (navigator.languages?.[0] || '')).toLowerCase()
    return browserLanguage.startsWith('ru') ? 'ru' : 'en'
    }
}
