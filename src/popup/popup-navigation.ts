import {PopupDOM, PopupContext} from "./popup-context";
import {PromptConfirmation} from "./popup-prompt-confirmation";

export class PopupNavigation {
    static showMainViewDOM(): void {
        const mainView = PopupDOM.getHtmlElement('mainView')
        const configureView = PopupDOM.getHtmlElement('configureView')
        const promptConfirmationView = PopupDOM.getHtmlElement('promptConfirmationView')

        if (mainView && configureView && promptConfirmationView) {
            configureView.style.display = 'none'
            promptConfirmationView.style.display = 'none'
            mainView.style.display = 'block'
        }
    }

    static showConfigureViewDOM(): void {
        const mainView = PopupDOM.getHtmlElement('mainView')
        const configureView = PopupDOM.getHtmlElement('configureView')
        const promptConfirmationView = PopupDOM.getHtmlElement('promptConfirmationView')

        if (mainView && configureView && promptConfirmationView) {
            mainView.style.display = 'none'
            configureView.style.display = 'block'
            promptConfirmationView.style.display = 'none'
        } else if (mainView && configureView) {
            mainView.style.display = 'none'
            configureView.style.display = 'block'
        }
    }

    static showPromptConfirmationViewDOM(ctx: PopupContext): void {
        const mainView = PopupDOM.getHtmlElement('mainView')
        const configureView = PopupDOM.getHtmlElement('configureView')
        const promptConfirmationView = PopupDOM.getHtmlElement('promptConfirmationView')

        if (mainView && configureView && promptConfirmationView) {
            mainView.style.display = 'none'
            configureView.style.display = 'none'
            promptConfirmationView.style.display = 'block'
        }
        PromptConfirmation.updateSendToLLMOrTriggerWebhookVisibility(ctx)
    }
}
