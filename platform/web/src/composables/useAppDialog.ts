import { reactive } from 'vue'

export type DialogTone = 'default' | 'warning' | 'danger' | 'success'
export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: DialogTone
}
export interface PromptOptions extends ConfirmOptions {
  inputLabel?: string
  placeholder?: string
  initialValue?: string
  required?: boolean
}

type DialogMode = 'confirm' | 'prompt' | 'alert'
type Resolver = (value: boolean | string | null) => void

export const appDialogState = reactive({
  open: false,
  mode: 'confirm' as DialogMode,
  title: '',
  message: '',
  confirmLabel: 'Confirmar',
  cancelLabel: 'Cancelar',
  tone: 'default' as DialogTone,
  inputLabel: '',
  placeholder: '',
  inputValue: '',
  required: false,
})

let resolver: Resolver | null = null

function show(mode: DialogMode, options: ConfirmOptions | PromptOptions): Promise<boolean | string | null> {
  if (resolver) resolver(null)
  Object.assign(appDialogState, {
    open: true,
    mode,
    title: options.title,
    message: options.message,
    confirmLabel: options.confirmLabel || (mode === 'alert' ? 'Fechar' : 'Confirmar'),
    cancelLabel: options.cancelLabel || 'Cancelar',
    tone: options.tone || 'default',
    inputLabel: 'inputLabel' in options ? options.inputLabel || '' : '',
    placeholder: 'placeholder' in options ? options.placeholder || '' : '',
    inputValue: 'initialValue' in options ? options.initialValue || '' : '',
    required: 'required' in options ? Boolean(options.required) : false,
  })
  return new Promise(resolve => { resolver = resolve })
}

export async function appConfirm(options: ConfirmOptions): Promise<boolean> {
  return (await show('confirm', options)) === true
}

export async function appPrompt(options: PromptOptions): Promise<string | null> {
  const result = await show('prompt', options)
  return typeof result === 'string' ? result : null
}

export async function appAlert(options: Omit<ConfirmOptions, 'cancelLabel'>): Promise<void> {
  await show('alert', options)
}

export function resolveAppDialog(confirmed: boolean): void {
  if (!resolver) return
  const current = resolver
  resolver = null
  if (!confirmed) current(null)
  else if (appDialogState.mode === 'prompt') current(appDialogState.inputValue)
  else current(true)
  appDialogState.open = false
}
