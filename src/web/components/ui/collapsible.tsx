// Copied from Proma (https://github.com/proma-ai/Proma) at 86d9dfb5:
//   apps/electron/src/renderer/components/ui/collapsible.tsx
// Licensed under the GNU Affero General Public License v3.0. Unmodified unless noted below.

/**
 * Collapsible 折叠组件
 *
 * 基于 Radix UI Collapsible 原语，
 * 用于可折叠/展开的内容区域。
 */

import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"

const Collapsible = CollapsiblePrimitive.Root

const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger

const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
