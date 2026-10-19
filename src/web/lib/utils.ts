// Copied from Proma (https://github.com/proma-ai/Proma) at 86d9dfb5:
//   apps/electron/src/renderer/lib/utils.ts
// Licensed under the GNU Affero General Public License v3.0. Unmodified unless noted below.

import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
