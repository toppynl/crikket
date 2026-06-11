import {
  DEFAULT_TAG_COLOR,
  isTagColor,
  type TagColor,
} from "@crikket/shared/constants/tag"

/** Classes for a filled, colored tag chip/badge. */
export const TAG_COLOR_BADGE: Record<TagColor, string> = {
  gray: "border-gray-200 bg-gray-100 text-gray-700 dark:border-gray-700/60 dark:bg-gray-800/60 dark:text-gray-200",
  red: "border-red-200 bg-red-100 text-red-700 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-300",
  orange:
    "border-orange-200 bg-orange-100 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/60 dark:text-orange-300",
  amber:
    "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-300",
  green:
    "border-green-200 bg-green-100 text-green-700 dark:border-green-900/60 dark:bg-green-950/60 dark:text-green-300",
  teal: "border-teal-200 bg-teal-100 text-teal-700 dark:border-teal-900/60 dark:bg-teal-950/60 dark:text-teal-300",
  blue: "border-blue-200 bg-blue-100 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/60 dark:text-blue-300",
  indigo:
    "border-indigo-200 bg-indigo-100 text-indigo-700 dark:border-indigo-900/60 dark:bg-indigo-950/60 dark:text-indigo-300",
  violet:
    "border-violet-200 bg-violet-100 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/60 dark:text-violet-300",
  pink: "border-pink-200 bg-pink-100 text-pink-700 dark:border-pink-900/60 dark:bg-pink-950/60 dark:text-pink-300",
}

/** Classes for a small solid color swatch/dot. */
export const TAG_COLOR_DOT: Record<TagColor, string> = {
  gray: "bg-gray-400",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  green: "bg-green-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
}

export function tagBadgeClasses(color: string): string {
  return TAG_COLOR_BADGE[isTagColor(color) ? color : DEFAULT_TAG_COLOR]
}

export function tagDotClasses(color: string): string {
  return TAG_COLOR_DOT[isTagColor(color) ? color : DEFAULT_TAG_COLOR]
}
