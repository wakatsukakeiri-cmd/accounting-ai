export interface CustomModeItem {
  id: string
  companyId: string
  name: string
  description?: string
  icon?: string
  customPrompt: string
  createdAt?: string
  updatedAt?: string
}

export interface CreateCustomModeInput {
  companyId: string
  name: string
  description?: string
  icon?: string
  customPrompt: string
}
