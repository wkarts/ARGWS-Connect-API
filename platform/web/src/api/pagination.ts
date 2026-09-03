import { api } from './client'
import type { Paginated } from '../types'

export async function fetchAllPages<T>(
  path: string,
  params: Record<string, unknown> = {},
  options: { perPage?: number; maxPages?: number } = {},
): Promise<T[]> {
  const perPage = Math.min(Math.max(options.perPage ?? 100, 1), 100)
  const maxPages = Math.max(options.maxPages ?? 100, 1)
  const items: T[] = []

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await api.get<Paginated<T>>(path, {
      params: { ...params, page, per_page: perPage },
    })
    items.push(...response.data.data)

    const pages = Math.max(Number(response.data.meta?.pages || 1), 1)
    if (page >= pages) break
  }

  return items
}
