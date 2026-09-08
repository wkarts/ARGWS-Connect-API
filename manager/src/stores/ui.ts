import { defineStore } from 'pinia'

export const useUiStore = defineStore('ui', {
  state: () => ({
    sidebarOpen: false,
    theme: (localStorage.getItem('connect-theme') || 'light') as 'light' | 'dark',
    query: '',
  }),
  actions: {
    toggleSidebar() { this.sidebarOpen = !this.sidebarOpen },
    closeSidebar() { this.sidebarOpen = false },
    setTheme(theme: 'light' | 'dark') {
      this.theme = theme
      localStorage.setItem('connect-theme', this.theme)
      document.documentElement.dataset.theme = this.theme
    },
    toggleTheme() { this.setTheme(this.theme === 'dark' ? 'light' : 'dark') },
    applyTheme() { document.documentElement.dataset.theme = this.theme },
  },
})
